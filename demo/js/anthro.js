/* ================================================================== *
 *  Cleanfit · 4D 人体测量引擎 (anthro.js)
 *
 *  「4D」= 3D 骨架段长（不受视角透视缩短影响） × 时间序列多样本稳健融合。
 *  设计目标是把单帧、单视角、模型先验尺度带来的误差压下去：
 *
 *   1. ROI 限定区域     —— 只认可框内的人体关键点，排除背景/旁人
 *   2. 姿态分桶         —— 正面 / 抬臂 / 斜侧 / 侧身 / 移动，逼出采样多样性
 *   3. 质量评分         —— 关键点可见度、ROI 命中率、朝向、运动模糊
 *   4. 稳健统计         —— MAD 离群剔除 + 截尾加权均值，抗误检尖峰
 *   5. 外部尺度标定     —— 激光测距 / 已知参照物 / 已知身高，把模型先验
 *                          尺度（BlazePose world 会把个体拉向平均）映射到真实厘米
 *   6. 手动锚点         —— 任一部位可填卷尺实测值，直接覆盖并校准该指标
 *
 *  纯计算模块，不依赖 DOM，便于数值测试与未来接深度/多摄像头数据源。
 * ================================================================== */

export const IDX = {
  nose: 0, lEar: 7, rEar: 8,
  lSh: 11, rSh: 12, lElb: 13, rElb: 14, lWr: 15, rWr: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28,
  lHeel: 29, rHeel: 30, lToe: 31, rToe: 32,
};

// kind: measured = 直接由 3D 骨架段长得到；estimated = 经验系数推算（围度类）
export const METRIC_DEFS = [
  { key: 'height', label: '身高', kind: 'measured', group: '纵向' },
  { key: 'headNeck', label: '头颈高', kind: 'measured', group: '纵向' },
  { key: 'torso', label: '躯干长', kind: 'measured', group: '纵向' },
  { key: 'legLength', label: '腿长', kind: 'measured', group: '纵向' },
  { key: 'thigh', label: '大腿长', kind: 'measured', group: '纵向' },
  { key: 'shank', label: '小腿长', kind: 'measured', group: '纵向' },
  { key: 'shoulder', label: '肩宽', kind: 'measured', group: '横向' },
  { key: 'hipWidth', label: '胯宽', kind: 'measured', group: '横向' },
  { key: 'upperArm', label: '上臂长', kind: 'measured', group: '四肢' },
  { key: 'forearm', label: '前臂长', kind: 'measured', group: '四肢' },
  { key: 'armSpan', label: '臂展（推算）', kind: 'estimated', group: '四肢' },
  { key: 'chestCirc', label: '胸围（估算）', kind: 'estimated', group: '围度' },
  { key: 'waistCirc', label: '腰围（估算）', kind: 'estimated', group: '围度' },
  { key: 'hipCirc', label: '臀围（估算）', kind: 'estimated', group: '围度' },
];

export const BUCKETS = [
  { key: 'front', label: '正面站立' },
  { key: 'arms', label: '正面抬臂' },
  { key: 'quarter', label: '斜侧 45°' },
  { key: 'side', label: '侧身 90°' },
  { key: 'move', label: '移动中' },
];

const vis = (p) => (p && p.visibility !== undefined ? p.visibility : 1);
const finite = (p) => !!p && isFinite(p.x) && isFinite(p.y) && isFinite(p.z);
const ok = (p, min = 0.45) => finite(p) && vis(p) >= min;
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
const avg = (a, b) => (a + b) / 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------------ *
 *  尺度标定：把「模型单位」映射到「真实米」
 *
 *  mode:
 *   'height'     已知身高（最省事，人人都有）
 *   'ref'        A4/信用卡等已知尺寸参照物，与人体处于同一深度平面
 *   'laser+ref'  激光测距给出人体距离，参照物在另一距离标定焦距
 *   'laser'      仅激光测距，焦距由摄像头水平视角估算（粗标定）
 * ------------------------------------------------------------------ */
export function calibrateHeight(o = {}) {
  const mode = o.mode || 'height';
  const H = Number(o.knownHeightCm) / 100;
  const pxH = Number(o.personPxHeight);
  const pxW = Number(o.refPx);
  const refM = Number(o.refRealM) || 0.21;   // A4 短边 210mm
  const dBody = Number(o.laserDistanceM);
  const dRef = Number(o.refDistanceM) || dBody;
  const fov = (Number(o.hfovDeg) || 65) * Math.PI / 180;
  const viewW = Number(o.viewW) || 1280;
  const fFromFov = viewW / (2 * Math.tan(fov / 2));

  if (mode === 'height' && H > 0.8 && H < 2.4) {
    return { heightM: H, detail: `已知身高 ${(H * 100).toFixed(1)} cm`, quality: 'high' };
  }
  if (mode === 'ref' && pxH > 0 && pxW > 0) {
    const h = (pxH / pxW) * refM;
    return { heightM: h, detail: `同平面参照物 ${(refM * 100).toFixed(0)}cm / ${pxW.toFixed(0)}px → ${(h * 100).toFixed(1)}cm`, quality: 'high' };
  }
  if (mode === 'laser+ref' && pxH > 0 && pxW > 0 && dBody > 0 && dRef > 0) {
    const f = (pxW * dRef) / refM;            // 针孔：f(px) = 像素宽 × 距离 / 实物宽
    const h = (pxH * dBody) / f;
    return { heightM: h, detail: `激光 ${dBody.toFixed(2)}m · f=${f.toFixed(0)}px → ${(h * 100).toFixed(1)}cm`, quality: 'high' };
  }
  if (mode === 'laser' && pxH > 0 && dBody > 0) {
    const h = (pxH * dBody) / fFromFov;
    return { heightM: h, detail: `激光 ${dBody.toFixed(2)}m · FOV 估算 f=${fFromFov.toFixed(0)}px → ${(h * 100).toFixed(1)}cm（粗）`, quality: 'rough' };
  }
  return { heightM: null, detail: '未标定：显示模型先验尺度，仅比例可信', quality: 'none' };
}

/* ------------------------------------------------------------------ *
 *  单帧：质量评估 + 姿态分桶 + 3D 段长抽取
 * ------------------------------------------------------------------ */

const CORE = [0, 11, 12, 23, 24, 25, 26, 27, 28];

export function frameQuality(world, norm, roi, prevHip) {
  const P = world;
  if (!P || P.length < 33) return null;

  let vs = 0;
  for (const i of CORE) vs += vis(P[i]);
  const visScore = vs / CORE.length;

  let inside = 0;
  if (norm) {
    for (const i of CORE) {
      const p = norm[i];
      if (p && p.x >= roi.x0 && p.x <= roi.x1 && p.y >= roi.y0 && p.y <= roi.y1) inside++;
    }
  } else {
    inside = CORE.length;
  }
  const roiScore = inside / CORE.length;

  // 肩向量的 z/x 比 → 朝向；正面时 dx 占主导
  const dx = Math.abs(P[IDX.lSh].x - P[IDX.rSh].x);
  const dz = Math.abs(P[IDX.lSh].z - P[IDX.rSh].z);
  const frontal = dx / (dx + dz + 1e-6);

  const hp = ok(P[IDX.lHip]) && ok(P[IDX.rHip]) ? mid(P[IDX.lHip], P[IDX.rHip]) : null;
  const motion = hp && prevHip ? d3(hp, prevHip) : 0;

  // 抬臂：腕高于肩即算（world y 向下为正）
  const wristsUp = ok(P[IDX.lWr], 0.3) && ok(P[IDX.rWr], 0.3)
    && (P[IDX.lWr].y + P[IDX.rWr].y) / 2 < (P[IDX.lSh].y + P[IDX.rSh].y) / 2;

  let bucket = 'front';
  if (motion > 0.025) bucket = 'move';
  else if (frontal < 0.55) bucket = 'side';
  else if (frontal < 0.82) bucket = 'quarter';
  else if (wristsUp) bucket = 'arms';

  // 运动本身是采样多样性的来源，只对极端位移（运动模糊）降权
  const blurPenalty = motion > 0.12 ? 0.55 : 1;
  // ROI 的「命中率」只轻微影响质量：区域过滤下沉到「段」级（见 SEG_POINTS），
  // 这样只框上半身时仍能测肩宽/臂长，而不会因为腿部点出框就整帧作废。
  const q = clamp(visScore * (0.75 + 0.25 * roiScore) * (0.6 + 0.4 * Math.max(frontal, 0.45)) * blurPenalty, 0, 1);
  return { q, bucket, visScore, roiScore, frontal, motion, hip: hp };
}

// 每个指标依赖哪些关键点 —— ROI 只放行「所需点全部落在框内」的指标。
// 于是框上半身就只出上半身数据，框全身才出腿长/身高，语义与「限定测量区域」一致。
const SEG_POINTS = {
  height: [0, 11, 12, 23, 24, 25, 26, 27, 28],
  headNeck: [0, 11, 12], torso: [11, 12, 23, 24],
  legLength: [23, 24, 25, 26, 27, 28],
  thigh: [23, 24, 25, 26], shank: [25, 26, 27, 28],
  shoulder: [11, 12], hipWidth: [23, 24],
  upperArm: [11, 12, 13, 14], forearm: [13, 14, 15, 16],
  armSpan: [11, 12, 13, 14, 15, 16],
  chestCirc: [11, 12], waistCirc: [23, 24], hipCirc: [23, 24],
};

function inROI(norm, id, roi) {
  if (!norm || !roi) return true;
  const p = norm[id];
  return !!p && p.x >= roi.x0 && p.x <= roi.x1 && p.y >= roi.y0 && p.y <= roi.y1;
}

export function extractSegments(P, norm = null, roi = null) {
  if (!P || P.length < 33) return null;
  const has = (...ids) => ids.every((i) => ok(P[i]));
  const s = {};

  if (has(IDX.lSh, IDX.rSh, IDX.lHip, IDX.rHip, IDX.nose)) {
    const sh = mid(P[IDX.lSh], P[IDX.rSh]);
    const hp = mid(P[IDX.lHip], P[IDX.rHip]);
    let headTop = P[IDX.nose].y - 0.115;
    if (has(IDX.lEar, IDX.rEar)) {
      headTop = (headTop + avg(P[IDX.lEar].y, P[IDX.rEar].y) - 0.062) / 2;
    }
    s.headNeck = Math.max(0.05, sh.y - headTop);
    s.torso = Math.max(0.05, d3(sh, hp));
    s.shoulder = d3(P[IDX.lSh], P[IDX.rSh]) + 0.05;   // 肩峰 → 三角肌外缘
    s.hipWidth = d3(P[IDX.lHip], P[IDX.rHip]) + 0.17; // 髋中心 → 大转子外缘
  }

  const leg = (h, k, a) => (has(h, k, a) ? [d3(P[h], P[k]), d3(P[k], P[a])] : null);
  const L = leg(IDX.lHip, IDX.lKnee, IDX.lAnk);
  const R = leg(IDX.rHip, IDX.rKnee, IDX.rAnk);
  if (L || R) {
    const th = L && R ? avg(L[0], R[0]) : (L || R)[0];
    const sk = L && R ? avg(L[1], R[1]) : (L || R)[1];
    s.thigh = th;
    s.shank = sk;
    s.legLength = th + sk + 0.055;                   // 踝 → 脚底
  }

  const arm = (sh, e, w) => (has(sh, e, w) ? [d3(P[sh], P[e]), d3(P[e], P[w])] : null);
  const A = arm(IDX.lSh, IDX.lElb, IDX.lWr);
  const B = arm(IDX.rSh, IDX.rElb, IDX.rWr);
  if (A || B) {
    s.upperArm = A && B ? avg(A[0], B[0]) : (A || B)[0];
    s.forearm = A && B ? avg(A[1], B[1]) : (A || B)[1];
  }

  // 身高：优先「分段骨架和」（弯腰/屈膝不会压缩），与直接头顶-脚底取均值
  if (s.headNeck && s.torso && s.legLength) s.height = s.headNeck + s.torso + s.legLength;
  if (has(IDX.nose, IDX.lAnk, IDX.rAnk)) {
    const foot = Math.max(P[IDX.lAnk].y, P[IDX.rAnk].y) + 0.055;
    const direct = foot - (P[IDX.nose].y - 0.115);
    if (direct > 0.6 && direct < 2.5) s.height = s.height ? avg(s.height, direct) : direct;
  }

  if (s.shoulder && s.upperArm && s.forearm) {
    s.armSpan = s.shoulder + 2 * (s.upperArm + s.forearm + 0.09);
  }
  // 围度：宽度 × 经验系数（无深度时只能估算，明确标注）
  if (s.shoulder) s.chestCirc = Math.PI * (s.shoulder * 0.92) * 0.62;
  if (s.hipWidth) {
    s.hipCirc = Math.PI * s.hipWidth * 0.62;
    s.waistCirc = Math.PI * s.hipWidth * 0.53;
  }
  if (norm && roi) {
    for (const key of Object.keys(s)) {
      const ids = SEG_POINTS[key];
      if (ids && !ids.every((i) => inROI(norm, i, roi))) delete s[key];
    }
  }
  return s;
}

/* ------------------------------------------------------------------ *
 *  稳健融合：MAD 离群剔除 + 10% 截尾加权均值
 * ------------------------------------------------------------------ */
export function robustCombine(samples) {
  const valid = samples.filter((s) => isFinite(s.v));
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => a.v - b.v);
  const medianOf = (arr) => {
    const n = arr.length;
    return n % 2 ? arr[(n - 1) / 2].v ?? arr[(n - 1) / 2]
      : ((arr[n / 2 - 1].v ?? arr[n / 2 - 1]) + (arr[n / 2].v ?? arr[n / 2])) / 2;
  };
  const med = medianOf(sorted);
  const dev = sorted.map((s) => Math.abs(s.v - med)).sort((a, b) => a - b);
  const mad = medianOf(dev);
  const sigma = 1.4826 * mad;
  // 相对下限：mad 退化为 0（样本几乎相同）时也能识别单个污染帧
  const cut = Math.max(3 * sigma, Math.abs(med) * 0.12);
  const kept = valid.filter((s) => Math.abs(s.v - med) <= cut);
  if (!kept.length) return null;

  const trim = Math.floor(kept.length * 0.1);
  const body = [...kept].sort((a, b) => a.v - b.v).slice(trim, kept.length - trim || undefined);
  const use = body.length ? body : kept;
  let sw = 0, sv = 0;
  for (const s of use) { const w = s.w || 1; sw += w; sv += s.v * w; }
  const value = sv / sw;
  let ssd = 0;
  for (const s of use) ssd += (s.v - value) ** 2;
  const sd = Math.sqrt(ssd / use.length);
  return {
    value, median: med, sd, cv: value > 0 ? sd / value : 1,
    n: kept.length, outliers: valid.length - kept.length,
    buckets: [...new Set(kept.map((s) => s.bucket).filter(Boolean))],
  };
}

/* ------------------------------------------------------------------ *
 *  AnthroMeter：跨帧累积器
 * ------------------------------------------------------------------ */
export class AnthroMeter {
  constructor(opts = {}) {
    this.roi = opts.roi || { x0: 0, y0: 0, x1: 1, y1: 1 };
    this.minQuality = opts.minQuality ?? 0.45;
    this.maxSamples = opts.maxSamples || 900;
    this.samples = {};                 // key -> [{v,w,bucket,t}]
    this.frames = 0;
    this.accepted = 0;
    this.rejected = 0;
    this.qualitySum = 0;
    this.lastHip = null;
    this.lastBucket = null;
    this.lastQuality = 0;
  }

  setROI(roi) { this.roi = roi; }

  reset() {
    this.samples = {};
    this.frames = 0; this.accepted = 0; this.rejected = 0; this.qualitySum = 0;
    this.lastHip = null; this.lastBucket = null; this.lastQuality = 0;
  }

  push(world, norm) {
    this.frames++;
    const fq = frameQuality(world, norm, this.roi, this.lastHip);
    if (!fq) { this.rejected++; return null; }
    this.lastHip = fq.hip || this.lastHip;
    this.lastQuality = fq.q;
    this.lastBucket = fq.bucket;
    if (fq.q < this.minQuality) { this.rejected++; return null; }

    const seg = extractSegments(world, norm, this.roi);
    if (!seg || !Object.keys(seg).length) { this.rejected++; return null; }
    this.accepted++;
    this.qualitySum += fq.q;
    for (const [k, v] of Object.entries(seg)) {
      if (!isFinite(v) || v <= 0) continue;
      const arr = this.samples[k] || (this.samples[k] = []);
      arr.push({ v, w: fq.q, bucket: fq.bucket, t: this.frames });
      if (arr.length > this.maxSamples) arr.shift();
    }
    return { q: fq.q, bucket: fq.bucket, seg };
  }

  bucketCounts() {
    const c = {};
    for (const b of BUCKETS) c[b.key] = 0;
    const src = this.samples.height || [];
    for (const s of src) if (c[s.bucket] !== undefined) c[s.bucket]++;
    return c;
  }

  /** calib: { heightM, overrides: {key: cm} } —— 输出单位统一为 cm */
  result(calib = {}) {
    const per = {};
    const heightModel = (this.samples.height && robustCombine(this.samples.height)) || null;
    const k = calib.heightM && heightModel ? calib.heightM / heightModel.value : 1;
    const overrides = calib.overrides || {};

    let cvSum = 0, cvN = 0;
    for (const def of METRIC_DEFS) {
      const r = robustCombine(this.samples[def.key] || []);
      if (!r) { per[def.key] = null; continue; }
      cvSum += r.cv; cvN++;
      const manual = Number(overrides[def.key]);
      per[def.key] = {
        value: manual > 0 ? manual : r.value * k * 100,
        source: manual > 0 ? 'manual' : 'fused',
        cv: r.cv, n: r.n, outliers: r.outliers, buckets: r.buckets,
      };
    }

    const counts = this.bucketCounts();
    const coverage = BUCKETS.filter((b) => counts[b.key] >= 8).length;
    const avgQ = this.accepted ? this.qualitySum / this.accepted : 0;
    const avgCv = cvN ? cvSum / cvN : 1;
    const n = this.accepted;
    const confidence = clamp(
      0.28 * Math.min(1, n / 150) +
      0.24 * (coverage / BUCKETS.length) +
      0.28 * avgQ +
      0.20 * (1 - Math.min(1, avgCv / 0.08)), 0, 1);
    const converged = n >= 90 && coverage >= 3 && avgCv < 0.035;

    return {
      metrics: per, scale: k, calibrated: !!calib.heightM,
      confidence, converged, coverage, avgCv, avgQuality: avgQ,
      samples: n, frames: this.frames, rejected: this.rejected,
      buckets: counts, heightModel: heightModel ? heightModel.value : null,
    };
  }

  export(calib = {}) {
    const r = this.result(calib);
    const rows = METRIC_DEFS.map((d) => ({
      key: d.key, label: d.label, kind: d.kind,
      cm: r.metrics[d.key] ? +r.metrics[d.key].value.toFixed(2) : null,
      cv: r.metrics[d.key] ? +r.metrics[d.key].cv.toFixed(4) : null,
      n: r.metrics[d.key] ? r.metrics[d.key].n : 0,
      source: r.metrics[d.key]?.source || null,
    }));
    return {
      generatedAt: new Date().toISOString(),
      calibrated: r.calibrated, scale: +r.scale.toFixed(5),
      confidence: +r.confidence.toFixed(3), converged: r.converged,
      samples: r.samples, buckets: r.buckets, rows,
    };
  }
}

/* 可选深度/多设备数据源挂载点。
 * 未来接 RealSense / LiDAR 时，实现 { getDistanceM(u, v, t) -> number|null }
 * 并挂到 window.CleanfitDepthSource；测量页会自动把它并入尺度标定。 */
export function depthSource() {
  return (typeof window !== 'undefined' && window.CleanfitDepthSource) || null;
}
