// Cleanfit · Pose Mirror
// 摄像头取景 + BlazePose 实时姿态估计 + 3D 全息人像复刻
import { HoloScene, BONES } from './rig.js';
import { mockPose, projectToNorm } from './mock.js';

const $ = (id) => document.getElementById(id);
const N = 33;
const DEMO = new URLSearchParams(location.search).has('demo');

// 叠加层只标注这些关节，五官/指尖点太密集
const MAIN_JOINTS = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

const els = {
  video: $('video'),
  overlay: $('overlay'),
  camWrap: $('camWrap'),
  camIdle: $('camIdle'),
  camInfo: $('camInfo'),
  fpsInfo: $('fpsInfo'),
  statusText: $('statusText'),
  dot: $('dot'),
  hint: $('hint'),
  metrics: $('metrics'),
  viewport: $('viewport'),
  loadInfo: $('loadInfo'),
  btnCam: $('btnCam'),
  btnMirror: $('btnMirror'),
  btnMask: $('btnMask'),
  btnBones: $('btnBones'),
  camSelect: $('camSelect'),
  btnDiag: $('btnDiag'),
  btnDiagClose: $('btnDiagClose'),
  btnDiagCopy: $('btnDiagCopy'),
  diag: $('diag'),
  diagBody: $('diagBody'),
  idleTip: $('idleTip'),
  sensorDot: $('sensorDot'),
  sensorTag: $('sensorTag'),
  sensorName: $('sensorName'),
  sensorSpec: $('sensorSpec'),
  sensorDepth: $('sensorDepth'),
  sensorGain: $('sensorGain'),
};

const state = {
  mirror: true,
  showMask: false,
  showBones: true,
  running: false,
  busy: false,
  starting: false,
  ready: false,
  world: null,
  norm: null,
  mask: null,
  rows: null,        // 掩码行扫描结果 [{y, l, r}]
  m: null,           // 测量结果
  fps: 0,
  frames: 0,
  fpsT: 0,
  gain: true,        // 自动亮度增益
  gainNow: 1,
  gainTick: 0,
  luma: 1,
};

function setStatus(text, kind) {
  els.statusText.textContent = text;
  els.dot.className = kind || '';
}

// ---------------------------------------------------------------- 3D 场景

const holo = new HoloScene(els.viewport);
new ResizeObserver(() => holo.resize()).observe(els.viewport);

// ---------------------------------------------------------------- 指标面板

const METRIC_DEFS = [
  { key: 'height', label: '身高', unit: 'cm', digits: 1 },
  { key: 'shoulder', label: '肩宽', unit: 'cm', digits: 1 },
  { key: 'waist', label: '腰宽', unit: 'cm', digits: 1 },
  { key: 'hip', label: '胯宽', unit: 'cm', digits: 1 },
  { key: 'shr', label: '肩胯比 SHR', unit: '', digits: 2 },
  { key: 'shape', label: '身形判定', unit: '', digits: 0, accent: true, wide: true },
  { key: 'points', label: '有效关键点', unit: '/33', digits: 0 },
];

const metricEls = {};
for (const def of METRIC_DEFS) {
  const box = document.createElement('div');
  box.className = 'metric' + (def.accent ? ' accent' : '') + (def.wide ? ' wide' : '');
  const k = document.createElement('div');
  k.className = 'k';
  k.textContent = def.label;
  const v = document.createElement('div');
  v.className = 'v';
  v.textContent = '--';
  box.append(k, v);
  els.metrics.append(box);
  metricEls[def.key] = v;
}

function renderMetrics() {
  const m = state.m;
  for (const def of METRIC_DEFS) {
    const el = metricEls[def.key];
    const val = m ? m[def.key] : null;
    if (val === null || val === undefined) {
      el.innerHTML = '--';
      continue;
    }
    if (typeof val === 'string') {
      el.textContent = val;
      continue;
    }
    const txt = val.toFixed(def.digits);
    el.innerHTML = def.unit ? `${txt}<small>${def.unit}</small>` : txt;
  }
}

// ---------------------------------------------------------------- 测量

function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// 逐行扫描人像分割掩码，得到体表外轮廓的宽度曲线。
// 服装测量要的是「外轮廓」（三角肌外缘、大转子外缘），不是关节中心距，
// 所以肩宽 / 胯宽 / 腰宽统一从这里取，再用身高换算成米。
function scanMask(mask, norm) {
  if (!mask || !norm) return null;
  const w = mask.width, h = mask.height;
  let data;
  try {
    data = mask.getAsFloat32Array();
  } catch {
    return null;
  }
  const yS = ((norm[11].y + norm[12].y) / 2) * h;
  const yH = ((norm[23].y + norm[24].y) / 2) * h;
  if (!(yH - yS > 10)) return null;

  const rows = [];
  let top = -1, bottom = -1;
  for (let y = 0; y < h; y += 2) {
    const off = y * w;
    let l = -1, r = -1;
    for (let x = 0; x < w; x += 2) {
      if (data[off + x] > 0.55) { l = x; break; }
    }
    if (l < 0) continue;
    for (let x = w - 1; x >= l; x -= 2) {
      if (data[off + x] > 0.55) { r = x; break; }
    }
    if (r - l < 3) continue;
    if (top < 0) top = y;
    bottom = y;
    rows.push({ y, l, r, w: r - l });
  }
  if (rows.length < 8 || bottom - top < 40) return null;

  const span = yH - yS;
  // 肩宽：肩线上下 18% 范围内的最大宽度
  let shoulderPx = 0;
  for (const row of rows) {
    if (row.y >= yS - 6 && row.y <= yS + span * 0.18) shoulderPx = Math.max(shoulderPx, row.w);
  }
  // 胯宽：髋线以下 35% 范围内的最大宽度
  let hipPx = 0;
  for (const row of rows) {
    if (row.y >= yH - span * 0.08 && row.y <= yH + span * 0.35) hipPx = Math.max(hipPx, row.w);
  }
  // 腰宽：肩线与髋线之间的最窄处
  const cand = rows.filter((r) => r.y > yS + span * 0.28 && r.y < yH - span * 0.04);
  const waistRow = cand.length ? cand.reduce((a, b) => (b.w < a.w ? b : a)) : null;

  return { rows, top, bottom, yS, yH, shoulderPx, hipPx, waistRow };
}

function measure() {
  const P = state.world;
  const nm = state.norm;
  if (!P || P.length < N || !nm) return null;

  const shoulder = dist3(P[11], P[12]);
  const hip = dist3(P[23], P[24]);

  // 头顶：鼻尖上抬约 11.5cm，再与「耳中点 + 6.2cm」取均值，抵消单点噪声
  let headY = P[0].y - 0.115;
  if (P[7] && P[8]) {
    const earY = (P[7].y + P[8].y) / 2;
    headY = (headY + (earY - 0.062)) / 2;
  }

  // 脚底：取踝/跟/趾的最低点（world y 向下为正）
  let footY = null;
  for (const i of [29, 30, 31, 32, 27, 28]) {
    const p = P[i];
    if (!p || (p.visibility !== undefined && p.visibility < 0.25)) continue;
    footY = footY === null ? p.y : Math.max(footY, p.y);
  }

  const height = footY !== null ? footY - headY : null;

  // 逐行扫描比较重，每 3 帧算一次
  state.scanTick = (state.scanTick || 0) + 1;
  if (state.scanTick % 3 === 1) state.scan = scanMask(state.mask, nm);
  const scan = state.scan;
  state.rows = scan ? scan.rows : null;

  // 外轮廓宽度：优先用掩码，比例尺由身高给出；没有掩码时退回关节距 + 软组织修正
  let shW = null, hpW = null, waW = null;
  if (scan && height && height > 0.9 && scan.bottom > scan.top) {
    const scale = height / (scan.bottom - scan.top);   // 米 / 像素
    shW = scan.shoulderPx * scale;
    hpW = scan.hipPx * scale;
    waW = scan.waistRow ? scan.waistRow.w * scale : null;
  }
  if (shW === null) shW = shoulder + 0.05;      // 肩峰 → 三角肌外缘
  if (hpW === null) hpW = hip + 0.17;           // 髋关节中心 → 大转子外缘
  if (waW === null && DEMO) waW = Math.min(shW, hpW) * 0.82;

  // 指数平滑：缓存统一存「米」，与传入值同单位（面板输出时才换算成厘米）
  const sv = state.sv || (state.sv = {});
  const smooth = (key, val, k) => {
    if (val === null || !isFinite(val)) return sv[key] ?? null;
    if (sv[key] === undefined) sv[key] = val;
    else sv[key] += (val - sv[key]) * k;
    return sv[key];
  };

  const h = smooth('height', height, 0.08);
  const sh = smooth('shoulder', shW, 0.15);
  const hp = smooth('hip', hpW, 0.15);
  const wa = smooth('waist', waW, 0.15);

  const shr = hp > 0.02 ? sh / hp : null;
  const whr = hp > 0.02 && wa ? wa / hp : null;

  let shape = null;
  if (shr !== null) {
    if (whr !== null && whr >= 0.95) shape = '苹果型';
    else if (shr >= 1.12) shape = '倒三角';
    else if (shr <= 0.90) shape = '梨型';
    else shape = 'H 型';
  }

  let points = 0;
  for (const p of P) if (p && (p.visibility === undefined || p.visibility > 0.28)) points++;

  return {
    height: h !== null ? h * 100 : null,
    shoulder: sh !== null ? sh * 100 : null,
    waist: wa !== null ? wa * 100 : null,
    hip: hp !== null ? hp * 100 : null,
    shr,
    shape,
    points,
  };
}

// ---------------------------------------------------------------- 叠加层

const ctx = els.overlay.getContext('2d');

function fitOverlay() {
  const v = els.video;
  if (!v.videoWidth) return;
  els.overlay.width = v.videoWidth;
  els.overlay.height = v.videoHeight;
  els.camInfo.textContent = `${v.videoWidth}×${v.videoHeight}`;
}

// 演示模式没有视频流，用固定画布尺寸保证叠加层比例正确
function fitOverlayDemo() {
  els.overlay.width = 960;
  els.overlay.height = 720;
}

function drawOverlay() {
  const cv = els.overlay;
  const W = cv.width, H = cv.height;
  if (!W) return;
  ctx.clearRect(0, 0, W, H);

  const nm = state.norm;
  if (!nm) return;

  const mir = state.mirror;
  const px = (x) => (mir ? 1 - x : x) * W;
  const py = (y) => y * H;
  const ok = (i) => nm[i] && (nm[i].visibility === undefined || nm[i].visibility > 0.28);

  // 掩码行扫描带
  if (state.showMask && state.rows) {
    ctx.save();
    ctx.strokeStyle = 'rgba(34,211,238,0.28)';
    ctx.lineWidth = Math.max(1, H * 0.004);
    for (const row of state.rows) {
      const a = px(row.l / W), b = px(row.r / W);
      ctx.beginPath();
      ctx.moveTo(Math.min(a, b), row.y);
      ctx.lineTo(Math.max(a, b), row.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 骨架
  if (state.showBones) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(127,243,255,0.9)';
    ctx.shadowColor = 'rgba(34,211,238,0.95)';
    ctx.shadowBlur = H * 0.014;
    ctx.lineWidth = Math.max(1.4, H * 0.0045);
    for (const [a, b] of BONES) {
      if (!ok(a) || !ok(b)) continue;
      ctx.beginPath();
      ctx.moveTo(px(nm[a].x), py(nm[a].y));
      ctx.lineTo(px(nm[b].x), py(nm[b].y));
      ctx.stroke();
    }
    ctx.restore();

    // 只标注主要关节，五官与指尖太密集会糊成一团
    ctx.save();
    ctx.fillStyle = '#eafcff';
    ctx.shadowColor = 'rgba(34,211,238,0.95)';
    ctx.shadowBlur = H * 0.012;
    const r = Math.max(1.8, H * 0.005);
    for (const i of MAIN_JOINTS) {
      if (!ok(i)) continue;
      ctx.beginPath();
      ctx.arc(px(nm[i].x), py(nm[i].y), r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 测量线
  const m = state.m;
  if (!m) return;
  const lines = [];
  if (ok(11) && ok(12)) {
    lines.push({
      y: (nm[11].y + nm[12].y) / 2, a: nm[11].x, b: nm[12].x,
      text: `肩 ${m.shoulder ? m.shoulder.toFixed(1) : '--'}`, place: 'above',
    });
  }
  if (state.rows && m.waist) {
    const row = state.rows.reduce((a, b) => (b.w < a.w ? b : a));
    lines.push({
      y: row.y / H, a: row.l / W, b: row.r / W,
      text: `腰 ${m.waist.toFixed(1)}`, place: 'below',
    });
  }
  if (ok(23) && ok(24)) {
    lines.push({
      y: (nm[23].y + nm[24].y) / 2, a: nm[23].x, b: nm[24].x,
      text: `胯 ${m.hip ? m.hip.toFixed(1) : '--'}`, place: 'below',
    });
  }

  const fs = Math.round(H * 0.026);
  const pad = H * 0.014;
  ctx.save();
  ctx.strokeStyle = 'rgba(251,191,36,0.85)';
  ctx.fillStyle = 'rgba(251,191,36,0.96)';
  ctx.lineWidth = Math.max(1, H * 0.003);
  ctx.font = `600 ${fs}px "Cascadia Mono", Consolas, monospace`;
  ctx.textBaseline = 'middle';

  for (const ln of lines) {
    const x1 = px(ln.a), x2 = px(ln.b), y = py(ln.y);
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);

    ctx.setLineDash([H * 0.012, H * 0.009]);
    ctx.beginPath();
    ctx.moveTo(lo, y);
    ctx.lineTo(hi, y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const xx of [lo, hi]) {
      ctx.beginPath();
      ctx.moveTo(xx, y - H * 0.009);
      ctx.lineTo(xx, y + H * 0.009);
      ctx.stroke();
    }

    // 标签固定朝上/朝下错开，避免肩线与腰线撞在一起；文字不随镜像翻转
    const tw = ctx.measureText(ln.text).width;
    const tx = Math.min(Math.max(lo, H * 0.02), W - tw - H * 0.02);
    const ty = ln.place === 'above' ? y - pad - fs * 0.5 : y + pad + fs * 0.5;
    ctx.fillStyle = 'rgba(2,8,14,0.72)';
    ctx.fillRect(tx - H * 0.006, ty - fs * 0.62, tw + H * 0.012, fs * 1.24);
    ctx.fillStyle = 'rgba(251,191,36,0.96)';
    ctx.fillText(ln.text, tx, ty);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- 推理

let pose = null;

async function initPose() {
  if (typeof Pose === 'undefined') {
    setStatus('推理引擎加载失败（vendor 目录缺失？）', 'err');
    return;
  }
  pose = new Pose({
    locateFile: (f) => new URL('vendor/mediapipe/', location.href).href + f,
  });
  pose.setOptions({
    modelComplexity: 0,
    smoothLandmarks: true,
    enableSegmentation: true,
    smoothSegmentation: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  pose.onResults(onResults);

  try {
    await pose.initialize();
    state.ready = true;
    els.loadInfo.textContent = '引擎就绪 · BlazePose Lite';
    setStatus('引擎就绪，等待摄像头', '');
  } catch (e) {
    console.error(e);
    els.loadInfo.textContent = '引擎初始化失败';
    setStatus('引擎初始化失败：' + (e && e.message ? e.message : e), 'err');
  }
}

function onResults(res) {
  state.world = res.poseWorldLandmarks || res.ea || null;
  state.norm = res.poseLandmarks || res.eb || null;
  state.mask = res.segmentationMask || null;
  state.m = measure();

  const has = !!(state.norm && state.norm.length === N);
  els.hint.classList.toggle('hide', has);
}

// ---------------------------------------------------------------- 亮度增益

// SR300 的 RGB 在室内弱光下噪点很大，BlazePose 吃原帧容易丢点。
// 先缩到 40×30 估平均亮度，暗了就把整帧提亮后再送推理——比换模型便宜得多。
const lumaCv = document.createElement('canvas');
lumaCv.width = 40;
lumaCv.height = 30;
const lumaCtx = lumaCv.getContext('2d', { willReadFrequently: true });

const boostCv = document.createElement('canvas');
const boostCtx = boostCv.getContext('2d');

function meanLuma() {
  try {
    lumaCtx.drawImage(els.video, 0, 0, 40, 30);
    const d = lumaCtx.getImageData(0, 0, 40, 30).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    }
    return sum / (d.length / 4) / 255;
  } catch {
    return 1;
  }
}

// 推理输入固定缩到 256×256，原帧再大也没用，所以这里顺手限宽 960 省带宽
function boostFrame(gain) {
  const vw = els.video.videoWidth;
  const vh = els.video.videoHeight;
  if (!vw || !vh) return null;
  const s = Math.min(1, 960 / vw);
  const w = Math.round(vw * s);
  const h = Math.round(vh * s);
  if (boostCv.width !== w || boostCv.height !== h) {
    boostCv.width = w;
    boostCv.height = h;
  }
  boostCtx.filter = `brightness(${gain.toFixed(2)}) contrast(1.06) saturate(1.04)`;
  boostCtx.drawImage(els.video, 0, 0, w, h);
  boostCtx.filter = 'none';
  return boostCv;
}

async function pump() {
  if (state.running && state.ready && !state.busy && els.video.readyState >= 2) {
    state.busy = true;
    try {
      let input = els.video;
      if (state.gain) {
        // 每 10 帧重估一次亮度，避免每帧都读像素
        if (state.gainTick++ % 10 === 0) {
          const luma = meanLuma();
          state.luma = luma;
          const want = luma < 0.16 ? 2.2
            : luma < 0.28 ? 1.5
              : luma < 0.40 ? 1.28
                : luma < 0.52 ? 1.12 : 1;
          state.gainNow = want;
          els.sensorGain.textContent = want > 1 ? `GAIN ${want.toFixed(2)}×` : 'GAIN 关';
          els.sensorGain.classList.toggle('off', want <= 1);
        }
        if (state.gainNow > 1) {
          const cv = boostFrame(state.gainNow);
          if (cv) input = cv;
        }
      }
      await pose.send({ image: input });
    } catch (e) {
      console.warn('inference', e);
    }
    state.busy = false;
  }
  requestAnimationFrame(pump);
}

// ---------------------------------------------------------------- 渲染循环

let lastT = performance.now();

function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000) || 0.016;
  lastT = now;

  if (DEMO) {
    state.world = mockPose(now / 1000);
    state.norm = projectToNorm(state.world);
    state.m = measure();
    els.hint.classList.add('hide');
  }

  holo.update(state.world, dt);
  holo.render();
  drawOverlay();

  state.frames++;
  if (state.fpsT === 0 || now - state.fpsT > 500) {
    if (state.fpsT > 0) {
      state.fps = Math.round((state.frames * 1000) / (now - state.fpsT));
      els.fpsInfo.textContent = `${state.fps} FPS`;
    }
    state.frames = 0;
    state.fpsT = now;
    renderMetrics();
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- 设备诊断

const ERR_HINT = {
  NotAllowedError: '权限被拒绝。点地址栏左侧的锁/摄像头图标，把「摄像头」改成「允许」，然后刷新页面。',
  NotFoundError: '系统里找不到这个设备。检查 USB 是否插稳、设备管理器里有没有黄色感叹号。',
  NotReadableError: '设备被别的程序占用了。关掉 Windows「设置 → 摄像头」的预览、相机 App、以及任何开会软件后重试。（RealSense 深度流报这个错是格式不支持，属正常）',
  OverconstrainedError: '设备不支持请求的分辨率/参数。换一个摄像头试试。',
  AbortError: '系统层面的中断，通常是驱动问题。拔插一次 USB 再试。',
  SecurityError: '安全策略阻止。必须用 https 或 http://localhost 打开。',
};

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function diagnose() {
  const L = [];
  const add = (text, cls) => L.push(cls ? `<span class="${cls}">${esc(text)}</span>` : esc(text));

  add(`协议        ${location.protocol}//${location.host}`);
  add(`安全上下文  ${window.isSecureContext ? '是' : '否'}`,
    window.isSecureContext ? 'ok' : 'bad');
  if (!window.isSecureContext) {
    add('  → 摄像头 API 只在 https 或 http://localhost 下可用', 'warn');
  }
  add(`浏览器      ${navigator.userAgent.slice(0, 96)}`);
  add('');

  if (!navigator.mediaDevices) {
    add('navigator.mediaDevices 不存在 → 非安全上下文或浏览器过旧', 'bad');
    els.diagBody.innerHTML = L.join('\n');
    return;
  }

  // 权限
  let perm = '未知';
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const p = await navigator.permissions.query({ name: 'camera' });
      perm = p.state;
    } catch (e) {
      perm = `查询失败(${e.name})`;
    }
  }
  add(`摄像头权限  ${perm}`, perm === 'granted' ? 'ok' : perm === 'denied' ? 'bad' : 'warn');

  // 设备列表
  let devs = [];
  try {
    devs = await navigator.mediaDevices.enumerateDevices();
  } catch (e) {
    add(`enumerateDevices 失败: ${e.name} ${e.message}`, 'bad');
  }
  const cams = devs.filter((d) => d.kind === 'videoinput');
  add(`视频输入    ${cams.length} 个`, cams.length ? 'ok' : 'bad');
  cams.forEach((c, i) => {
    const fp = fingerprint(c.label);
    const tag = !c.label ? ''
      : fp.depth ? '  ← 深度流，浏览器打不开'
        : fp.rs ? '  ← RealSense 彩色流' : '';
    add(`  [${i}] ${c.label || '(无名称 · 未授权时属正常)'}${tag}  id=${(c.deviceId || '').slice(0, 10)}…`);
  });

  if (!cams.length) {
    add('');
    add('结论：浏览器完全看不到摄像头。', 'bad');
    add('排查顺序：', 'warn');
    add('  1. Windows 设置 → 隐私和安全性 → 摄像头 → 打开「允许桌面应用访问摄像头」');
    add('  2. 设备管理器里「图像设备」下能否看到 USB Camera');
    add('  3. 关掉 Windows 设置里的摄像头预览（它会独占设备），再刷新页面');
    add('  4. 换一个 USB 口，尽量直插主板而不是经 HUB');
    els.diagBody.innerHTML = L.join('\n');
    return;
  }

  // 逐个试开。先停掉当前流，否则会自己和自己抢设备
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
    state.running = false;
    els.video.srcObject = null;
  }

  add('');
  add('逐个试开：');
  const hints = new Set();
  for (const c of cams) {
    const name = c.label || `设备[${cams.indexOf(c)}]`;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: c.deviceId } },
      });
      const t = s.getVideoTracks()[0];
      const st = t.getSettings();
      add(`  ✓ ${name}  ${st.width}×${st.height}${st.frameRate ? ' ' + Math.round(st.frameRate) + 'fps' : ''}`, 'ok');
      s.getTracks().forEach((x) => x.stop());
    } catch (e) {
      add(`  ✗ ${name}  ${e.name}`, 'bad');
      add(`     ${e.message}`, 'bad');
      if (ERR_HINT[e.name]) hints.add(ERR_HINT[e.name]);
    }
  }

  if (hints.size) {
    add('');
    add('怎么处理：', 'warn');
    for (const h of hints) add(`  · ${h}`);
  }

  // RealSense 深度流的失败是预期行为，必须说清楚，否则会被当成故障去折腾驱动
  if (cams.some((c) => fingerprint(c.label).depth)) {
    add('');
    add('关于深度流（重要）：', 'warn');
    add('  检测到 RealSense 深度设备。它输出 Z16 / Y8 格式，浏览器的');
    add('  getUserMedia 不支持，所以「试开失败」是预期行为——不是权限、');
    add('  也不是被占用，装什么驱动都没用。');
    add('  本页面用的是同一台相机的彩色流（label 里带 RGB 的那一路）。');
    add('  真要用深度数据做精确测量，得走 Python + librealsense，');
    add('  把点云通过 WebSocket 推给前端渲染。');
  }

  add('');
  add('关闭诊断后点「重新连接」重试。');
  els.diagBody.innerHTML = L.join('\n');
}

function openDiag() {
  els.diag.hidden = false;
  els.diagBody.textContent = '检测中…';
  diagnose().catch((e) => {
    els.diagBody.textContent = '诊断本身出错：' + (e && e.message ? e.message : e);
  });
}

// ---------------------------------------------------------------- 摄像头

let stream = null;
let currentDeviceId = null;
let hasDepthDevice = false;

// RealSense SR300 / D4xx 在 Windows 上会注册成两个独立的 videoinput：
//   「… Camera SR300 Depth」→ 输出 Z16 / Y8，浏览器 getUserMedia 不支持这种格式
//   「… Camera SR300 RGB」  → 标准 UVC 彩色流，能正常开
// 所以这里不按枚举顺序挑设备，而是先按「能不能开」排优先级，深度设备永远垫底。
const RE_DEPTH = /depth|红外|infrared|\btof\b|3d camera/i;
const RE_RGB = /rgb|color|colour/i;
const RE_RS = /realsense|sr300|sr305|d4\d{3}|l5\d{2}|\br200\b/i;

function fingerprint(label) {
  const l = label || '';
  const depth = RE_DEPTH.test(l);
  const rs = RE_RS.test(l);
  const rgb = RE_RGB.test(l);
  let rank = 1;                          // 普通 USB 摄像头
  if (rgb || (rs && !depth)) rank = 0;   // RealSense 彩色流 / 明确标了 RGB
  if (depth) rank = 3;                   // 深度流：浏览器开不了，最后再试
  return { label: l, depth, rs, rank };
}

// 设备名太长会把状态条撑爆，去掉厂商前缀
function shortName(label) {
  return (label || '')
    .replace(/intel\(r\)\s*/i, '')
    .replace(/realsense\(tm\)\s*/i, 'RealSense ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 分辨率降级链。SR300 的 RGB 走 YUYV，1280×720@30 已接近 USB2 带宽上限，
// 开不出来就往下退，最后一级完全交给驱动决定。
const PROFILES = [
  [1280, 720, 30],
  [960, 540, 30],
  [640, 480, 30],
  [640, 360, 30],
  [null, null, null],
];

async function openWithFallback(deviceId) {
  const tried = [];
  let last = null;
  for (const [w, h, fps] of PROFILES) {
    const video = deviceId ? { deviceId: { exact: deviceId } } : {};
    if (w) {
      video.width = { ideal: w };
      video.height = { ideal: h };
      video.frameRate = { ideal: fps };
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      return { stream: s, spec: w ? `${w}×${h}` : '驱动默认', tried };
    } catch (e) {
      last = e;
      tried.push(`${w ? `${w}×${h}` : '默认'} ${e.name}`);
      // 权限和安全策略类错误，换分辨率也不会好，立刻中断
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw e;
    }
  }
  if (last) last.tried = tried;
  throw last || new Error('设备不可用');
}

async function permissionGranted() {
  if (!navigator.permissions || !navigator.permissions.query) return false;
  try {
    const p = await navigator.permissions.query({ name: 'camera' });
    return p.state === 'granted';
  } catch {
    return false;
  }
}

// 未授权前 enumerateDevices 返回的 label 全是空串，没法判断哪一路是 RGB。
// 先随便开一路把权限拿到（随即关掉），再按真实 label 排序重开。
async function unlockLabels() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    s.getTracks().forEach((t) => t.stop());
    await new Promise((r) => setTimeout(r, 150));
    return true;
  } catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw e;
    return false;   // 设备层面的失败，交给后面的逐设备探测
  }
}

// 列出所有摄像头。未授权前 label 是空的，所以拿到权限后要再列一次
async function listDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const cams = devs.filter((d) => d.kind === 'videoinput');
    els.camSelect.innerHTML = '';
    if (!cams.length) {
      const o = document.createElement('option');
      o.textContent = '未检测到摄像头';
      els.camSelect.append(o);
      els.sensorDepth.hidden = true;
      return;
    }
    const ranked = cams
      .map((c) => ({ c, fp: fingerprint(c.label) }))
      .sort((a, b) => a.fp.rank - b.fp.rank);
    hasDepthDevice = ranked.some((x) => x.fp.depth);

    ranked.forEach(({ c, fp }, i) => {
      const o = document.createElement('option');
      o.value = c.deviceId;
      if (fp.depth) o.dataset.depth = '1';
      o.textContent = (shortName(c.label) || `摄像头 ${i + 1}`)
        + (fp.depth ? ' · 深度流（不可用）' : '');
      els.camSelect.append(o);
    });
    if (currentDeviceId) els.camSelect.value = currentDeviceId;
    els.sensorDepth.hidden = !hasDepthDevice;
  } catch (e) {
    console.warn('enumerateDevices', e);
  }
}

function updateSensor(fp, settings, spec) {
  els.sensorDot.className = 's-dot live';
  els.sensorTag.textContent = fp.depth ? 'DEPTH' : fp.rs ? 'RGB·RS' : 'RGB';
  els.sensorTag.className = 's-tag' + (fp.depth ? ' depth' : '');
  els.sensorName.textContent = shortName(fp.label) || '未命名设备';

  const w = settings.width || 0;
  const h = settings.height || 0;
  const fps = settings.frameRate ? Math.round(settings.frameRate) : 0;
  els.sensorSpec.textContent = w ? `${w}×${h}${fps ? ` · ${fps}fps` : ''}` : spec;
  els.sensorDepth.hidden = !hasDepthDevice;
  els.sensorGain.hidden = false;
}

async function attach(s, dev, fp, spec) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = s;
  els.video.srcObject = s;
  await els.video.play();

  const st = s.getVideoTracks()[0].getSettings();
  currentDeviceId = st.deviceId || dev.deviceId || null;

  els.camIdle.classList.add('hide');
  state.running = true;
  els.btnCam.textContent = '重新连接';
  els.btnCam.classList.remove('primary');
  fitOverlay();
  setStatus('实时追踪中', 'live');
  els.loadInfo.textContent = '引擎就绪 · BlazePose Lite';
  updateSensor(fp, st, spec);
  await listDevices();
}

async function startCamera(preferredId) {
  if (state.starting) return;
  state.starting = true;
  els.btnCam.disabled = true;
  setStatus('正在请求摄像头权限…', 'warn');

  try {
    // 已授权过就不用再试探，label 直接就是真名
    if (!(await permissionGranted())) await unlockLabels();

    let cams = [];
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      cams = devs.filter((d) => d.kind === 'videoinput');
    } catch (e) {
      console.warn('enumerateDevices', e);
    }

    const ranked = cams
      .map((c) => ({ c, fp: fingerprint(c.label) }))
      .sort((a, b) => a.fp.rank - b.fp.rank);

    const order = [];
    if (preferredId) {
      const hit = ranked.find((x) => x.c.deviceId === preferredId);
      if (hit) order.push(hit);
    }
    for (const x of ranked) if (!order.includes(x)) order.push(x);
    // 列表为空时（权限没拿到但设备其实存在）仍给默认设备一次机会
    if (!order.length) order.push({ c: { deviceId: '' }, fp: fingerprint('') });

    const fails = [];
    for (const { c, fp } of order) {
      try {
        const { stream: s, spec } = await openWithFallback(c.deviceId || undefined);
        await attach(s, c, fp, spec);
        if (fails.length) console.info('[camera] 已跳过:', fails.join(' | '));
        return;
      } catch (e) {
        fails.push(`${shortName(fp.label) || '默认设备'}:${e.name}`);
      }
    }

    const err = new Error('没有可用的摄像头');
    err.name = 'NotFoundError';
    err.fails = fails;
    throw err;
  } catch (e) {
    console.error(e);
    const msg =
      e && e.name === 'NotAllowedError' ? '权限被拒绝，请允许摄像头访问'
        : e && e.name === 'NotReadableError' ? '摄像头被其他程序占用'
          : e && e.name === 'NotFoundError' ? '没有可用的摄像头设备'
            : '摄像头不可用：' + (e && e.message ? e.message : e);
    setStatus(msg, 'err');
    els.sensorDot.className = 's-dot err';
    els.sensorTag.textContent = 'OFFLINE';
    els.sensorName.textContent = '未连接';
    els.sensorSpec.textContent = '';
    els.idleTip.textContent = (e && e.fails && e.fails.length)
      ? `已尝试：${e.fails.join(' / ')}　点「诊断」看详情`
      : '点下方「诊断」查看详细原因';
  } finally {
    state.starting = false;
    els.btnCam.disabled = false;
  }
}

// ---------------------------------------------------------------- 事件

// 注意：直接绑 startCamera 会把 MouseEvent 当成 deviceId 传进去
els.btnCam.addEventListener('click', () => startCamera(currentDeviceId || undefined));

// 增益开关：自动估亮度 ↔ 关闭
els.sensorGain.addEventListener('click', () => {
  state.gain = !state.gain;
  if (!state.gain) {
    state.gainNow = 1;
    els.sensorGain.textContent = 'GAIN 关';
    els.sensorGain.classList.add('off');
  } else {
    state.gainTick = 0;          // 下一帧立刻重估
    els.sensorGain.classList.remove('off');
    els.sensorGain.textContent = 'GAIN 自动';
  }
});

els.btnMirror.addEventListener('click', () => {
  state.mirror = !state.mirror;
  els.video.classList.toggle('no-mirror', !state.mirror);
  els.btnMirror.classList.toggle('on', state.mirror);
  els.btnMirror.textContent = state.mirror ? '镜像 开' : '镜像 关';
});

els.btnMask.addEventListener('click', () => {
  state.showMask = !state.showMask;
  els.btnMask.classList.toggle('on', state.showMask);
  els.btnMask.textContent = state.showMask ? '掩码 开' : '掩码 关';
});

els.btnBones.addEventListener('click', () => {
  state.showBones = !state.showBones;
  els.btnBones.classList.toggle('on', state.showBones);
  els.btnBones.textContent = state.showBones ? '骨骼 开' : '骨骼 关';
});

els.video.addEventListener('loadedmetadata', fitOverlay);

els.btnDiag.addEventListener('click', openDiag);
els.btnDiagClose.addEventListener('click', () => { els.diag.hidden = true; });
els.btnDiagCopy.addEventListener('click', async () => {
  const text = els.diagBody.innerText;
  try {
    await navigator.clipboard.writeText(text);
    els.btnDiagCopy.textContent = '已复制';
    setTimeout(() => { els.btnDiagCopy.textContent = '复制'; }, 1500);
  } catch {
    // 剪贴板不可用时退化成选中文本，让用户自己 Ctrl+C
    const r = document.createRange();
    r.selectNodeContents(els.diagBody);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    els.btnDiagCopy.textContent = '已选中';
    setTimeout(() => { els.btnDiagCopy.textContent = '复制'; }, 1500);
  }
});

// 切换摄像头：停掉旧流，用新 deviceId 重新取流。
// 选到深度设备时不让它硬开（浏览器必然失败），直接改走自动排序
els.camSelect.addEventListener('change', async () => {
  const id = els.camSelect.value;
  if (!id) return;
  const opt = els.camSelect.selectedOptions[0];
  const isDepth = !!(opt && opt.dataset.depth === '1');
  currentDeviceId = id;
  if (!state.running) return;
  await startCamera(isDepth ? undefined : id);
  if (isDepth) els.loadInfo.textContent = '深度流浏览器不支持 · 已切到彩色流';
});

// ---------------------------------------------------------------- 启动

renderMetrics();
requestAnimationFrame(loop);
requestAnimationFrame(pump);

if (DEMO) {
  els.camIdle.style.display = 'none';
  fitOverlayDemo();
  els.camInfo.textContent = 'DEMO 合成信号';
  els.btnCam.disabled = true;
  els.btnCam.textContent = '演示模式';
  els.sensorDot.className = 's-dot live';
  els.sensorTag.textContent = 'SYNTH';
  els.sensorName.textContent = '合成姿态源';
  els.sensorSpec.textContent = '960×720 · 60fps';
  setStatus('演示模式 · 合成姿态驱动', 'live');
  els.loadInfo.textContent = '演示数据 · 未加载推理模型';
} else {
  listDevices();
  initPose();
  // 页面加载后自动尝试一次（浏览器会弹权限框）
  setTimeout(() => { if (!state.running) startCamera(); }, 600);
}
