/* ================================================================== *
 *  Cleanfit · 4D 人体尺寸测量工作台
 *
 *  摄像头 RGB ──▶ BlazePose(3D world landmarks) ──▶ AnthroMeter
 *      ▲                                              │
 *      └── ROI 限定区域 / 多摄像头视角                  ├─ 姿态分桶（正面/抬臂/斜侧/侧身/移动）
 *  激光测距 / A4 参照物 / 已知身高 ─────────────────────┴─ 尺度标定 → 真实厘米
 *
 *  与试衣页的区别：这里不追求实时好看，只追求测得准，
 *  所以刻意用「多帧 + 多姿态 + 多视角 + 稳健统计」替代单帧瞬时值。
 * ================================================================== */

import {
  AnthroMeter, METRIC_DEFS, BUCKETS, calibrateHeight, depthSource, framingCheck,
} from './anthro.js';
import { mockPose, projectToNorm } from './mock.js';

const $ = (id) => document.getElementById(id);
const N = 33;
// ?demo 用合成 3D 姿态驱动，无摄像头也能验证「采样 → 融合 → 导出」全链路
const DEMO = new URLSearchParams(location.search).has('demo');

const els = {
  video: $('video'), overlay: $('overlay'), view: $('view'), idle: $('idle'),
  guide: $('guide'), bucketTag: $('bucketTag'), note: $('note'),
  statusText: $('statusText'), dot: $('dot'), camInfo: $('camInfo'),
  camSelect: $('camSelect'), btnCam: $('btnCam'), btnSample: $('btnSample'),
  btnReset: $('btnReset'), btnRoiDraw: $('btnRoiDraw'), btnRoiClear: $('btnRoiClear'),
  btnRefDraw: $('btnRefDraw'), btnJson: $('btnJson'), btnCsv: $('btnCsv'),
  calMode: $('calMode'), knownHeight: $('knownHeight'), refRealM: $('refRealM'),
  laserDist: $('laserDist'), refDist: $('refDist'), refInfo: $('refInfo'),
  calOut: $('calOut'), calTag: $('calTag'), depthTag: $('depthTag'),
  confBar: $('confBar'), confVal: $('confVal'), cvVal: $('cvVal'),
  nVal: $('nVal'), covVal: $('covVal'), sampleInfo: $('sampleInfo'),
  buckets: $('buckets'), nextHint: $('nextHint'), resultBody: $('resultBody'),
  viewMode: $('viewMode'), sensSlider: $('sensSlider'), sensVal: $('sensVal'),
  modeSel: $('modeSel'), autoStop: $('autoStop'), frameTip: $('frameTip'),
  fpsVal: $('fpsVal'), qVal: $('qVal'),
};

// 采集模式：达标即收尾，不必凑满 5 个姿态桶
const MODE_CFG = {
  // 快速档只要「一种姿态 + 40 帧」就收尾，站着不动也能几秒出结果；
  // 想压随机误差再切标准/高精度，让系统引导你多做几组动作。
  fast:    { minSamples: 40,  minCoverage: 1, maxCv: 0.060, perBucket: 12, target: 12, label: '快速' },
  normal:  { minSamples: 90,  minCoverage: 2, maxCv: 0.040, perBucket: 25, target: 25, label: '标准' },
  precise: { minSamples: 200, minCoverage: 4, maxCv: 0.025, perBucket: 45, target: 45, label: '高精度' },
};

// 4:3 是传感器的原生比例，16:9 往往是上下裁切出来的 → 4:3 垂直视野更大，更容易拍全
const VIEW_CFG = {
  full: { width: { ideal: 640 },  height: { ideal: 480 },  frameRate: { ideal: 30 } },
  auto: { width: { ideal: 1280 }, height: { ideal: 720 },  frameRate: { ideal: 30 } },
  wide: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
};
const FULL_ROI = { x0: 0, y0: 0, x1: 1, y1: 1 };

const meter = new AnthroMeter({ minQuality: 0.26, minVis: 0.26, maxSamples: 1200 });
const state = {
  stream: null, pose: null, ready: false, running: false, busy: false,
  sampling: false, world: null, norm: null,
  roi: null, refBox: null, drawMode: null, drag: null,
  overrides: {}, pxH: [], devices: new Set(), lastBucket: null,
  sensitivity: 8, mode: 'fast', autoStop: true,
  fps: 0, fpsT: 0, fpsN: 0, lastQ: 0,
};

const NEXT_TEXT = {
  front: '请正面站立，双臂自然下垂',
  arms: '请双臂侧平举或上举过头',
  quarter: '请转到斜侧 45°',
  side: '请完全侧身 90°',
  move: '请在框内前后走动几步',
};

function setStatus(text, kind = '') {
  els.statusText.textContent = text;
  els.dot.className = kind;
}

// 灵敏度同时放宽「整帧质量门槛」和「单个关键点可见度门槛」：
// 高档几乎每帧都收，低档只留最稳的帧。
function applySensitivity(v) {
  let s = Math.round(Number(v));
  if (!isFinite(s)) s = 8;
  s = Math.max(1, Math.min(10, s));
  state.sensitivity = s;
  meter.minQuality = +(0.62 - s * 0.045).toFixed(3);   // 8 → 0.26（原来固定 0.40）
  meter.minVis = +(0.50 - s * 0.030).toFixed(3);       // 8 → 0.26（原来固定 0.45）
  els.sensSlider.value = String(s);
  els.sensVal.textContent = String(s);
  try { localStorage.setItem('cleanfit.sens', String(s)); } catch { /* 隐私模式 */ }
}
function applyMode(v) {
  const k = MODE_CFG[v] ? v : 'fast';
  state.mode = k;
  els.modeSel.value = k;
  try { localStorage.setItem('cleanfit.mode', k); } catch { /* 隐私模式 */ }
}
const cfg = () => MODE_CFG[state.mode] || MODE_CFG.fast;

/* ---------------------------------------------------------------- 表格 */

const rowEls = {};
function buildTable() {
  let lastGroup = null;
  for (const def of METRIC_DEFS) {
    const tr = document.createElement('tr');
    if (def.group !== lastGroup) { tr.classList.add('group-start'); lastGroup = def.group; }
    if (def.kind === 'estimated') tr.classList.add('est');

    const lb = document.createElement('td');
    lb.className = 'lb';
    lb.textContent = def.label + (def.kind === 'estimated' ? ' *' : '');
    const v = document.createElement('td'); v.className = 'v empty'; v.textContent = '--';
    const cv = document.createElement('td'); cv.className = 'cv'; cv.textContent = '--';
    const n = document.createElement('td'); n.className = 'n'; n.textContent = '0';
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.step = '0.1'; input.placeholder = '实测';
    input.title = '用卷尺量到的真实值；填了会直接覆盖该指标，并作为校准锚点';
    input.addEventListener('input', () => {
      const x = Number(input.value);
      if (x > 0) state.overrides[def.key] = x;
      else delete state.overrides[def.key];
    });
    td.append(input);
    tr.append(lb, v, cv, n, td);
    els.resultBody.append(tr);
    rowEls[def.key] = { v, cv, n };
  }
}

const bucketEls = {};
function buildBuckets() {
  for (const b of BUCKETS) {
    const row = document.createElement('div');
    row.className = 'm-bk';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = b.label;
    const tr = document.createElement('span'); tr.className = 'tr';
    const fill = document.createElement('i'); tr.append(fill);
    const ct = document.createElement('span'); ct.className = 'ct'; ct.textContent = '0';
    row.append(nm, tr, ct);
    els.buckets.append(row);
    bucketEls[b.key] = { row, fill, ct };
  }
}

/* ---------------------------------------------------------------- 摄像头 */

const RE_DEPTH = /depth|红外|infrared|tof|3d camera/i;

async function listDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'videoinput')
      .sort((a, b) => (RE_DEPTH.test(a.label) ? 1 : 0) - (RE_DEPTH.test(b.label) ? 1 : 0));
    const cur = els.camSelect.value;
    els.camSelect.innerHTML = '';
    for (const d of devs) {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = (d.label || `摄像头 ${els.camSelect.length + 1}`) + (RE_DEPTH.test(d.label) ? '（深度流，浏览器不可用）' : '');
      els.camSelect.append(o);
    }
    if (cur && [...els.camSelect.options].some((o) => o.value === cur)) els.camSelect.value = cur;
  } catch (e) { console.warn('enumerateDevices', e); }
}

function stopCamera() {
  if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
  state.running = false;
  state.sampling = false;
  state.world = null; state.norm = null;
  els.video.srcObject = null;
  syncButtons();
  drawOverlay();
}

function camError(e) {
  const name = e?.name || '';
  if (/NotReadable|TrackStart/i.test(name)) return '摄像头被其他程序占用（请关闭 Windows 相机 / 会议软件 / OBS）';
  if (/NotAllowed|Permission/i.test(name)) return '摄像头权限被拒绝，请在浏览器地址栏放行';
  if (/NotFound|DevicesNotFound/i.test(name)) return '没有找到可用的摄像头设备';
  if (/Overconstrained/i.test(name)) return '摄像头不支持请求的分辨率';
  return e?.message || name || '未知错误';
}

async function startCamera(preferredId) {
  stopCamera();
  setStatus('正在打开摄像头…', '');
  // 默认 4:3 全身优先：传感器原生比例，垂直视野比 16:9 大
  const base = VIEW_CFG[els.viewMode.value] || VIEW_CFG.full;
  const tries = [];
  if (preferredId) tries.push({ video: { ...base, deviceId: { exact: preferredId } }, audio: false });
  tries.push({ video: { ...base }, audio: false });
  tries.push({ video: true, audio: false });   // 最后兜底：驱动默认格式

  let lastErr = null;
  for (const constraints of tries) {
    try {
      state.stream = await navigator.mediaDevices.getUserMedia(constraints);
      lastErr = null;
      break;
    } catch (e) { lastErr = e; }
  }
  if (lastErr) {
    setStatus('摄像头失败：' + camError(lastErr), 'err');
    els.guide.hidden = true;
    return;
  }

  els.video.srcObject = state.stream;
  try { await els.video.play(); } catch { /* autoplay 被拦时用户可手动点 */ }
  state.running = true;
  const track = state.stream.getVideoTracks()[0];
  const s = track?.getSettings?.() || {};
  els.camInfo.textContent = `${s.width || els.video.videoWidth || '?'}×${s.height || els.video.videoHeight || '?'} · ${track?.label?.slice(0, 24) || 'RGB'}`;
  if (track?.getSettings?.().deviceId) state.devices.add(track.getSettings().deviceId);
  await listDevices();
  setStatus(state.ready ? '摄像头就绪，可框区域并开始采样' : '摄像头就绪，推理引擎仍在加载…', 'live');
  fitOverlay();
  syncButtons();
}

/* ---------------------------------------------------------------- 推理 */

function initPose() {
  if (typeof Pose === 'undefined') {
    setStatus('推理引擎加载失败（vendor/mediapipe 缺失）', 'err');
    return;
  }
  try {
    state.pose = new Pose({ locateFile: (f) => new URL('vendor/mediapipe/', location.href).href + f });
    state.pose.setOptions({
      // lite：full 模型在 CPU/WASM 上单帧要几百毫秒，会拖垮采样帧数；
      // 这里的精度靠「多帧 + 多视角 + 尺度标定 + 稳健统计」拿到，不靠单帧模型。
      modelComplexity: 0,
      smoothLandmarks: false,      // 关闭内置时域平滑，噪声交给多帧稳健融合处理
      enableSegmentation: false,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    state.pose.onResults(onResults);
    state.pose.initialize().then(() => {
      state.ready = true;
      setStatus(state.running ? '就绪 · 可开始采样' : '引擎就绪，等待摄像头', 'ok');
      syncButtons();
    }).catch((e) => setStatus('引擎初始化失败：' + (e?.message || e), 'err'));
  } catch (e) {
    setStatus('引擎创建失败：' + (e?.message || e), 'err');
  }
}

function personNormHeight(nm) {
  if (!nm || !nm[0]) return 0;
  let bot = 0;
  for (const i of [27, 28, 29, 30, 31, 32]) if (nm[i] && nm[i].y > bot) bot = nm[i].y;
  const h = bot - nm[0].y;
  return h > 0.08 ? h * 1.075 : 0;   // 鼻 → 头顶外推约 7%
}

function medianPxH() {
  if (!state.pxH.length) return 0;
  const a = [...state.pxH].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

function feed(world, norm) {
  state.world = world; state.norm = norm;
  if (!world || !norm) return;

  const px = personNormHeight(norm) * (els.video.videoHeight || 720);
  if (px > 0) { state.pxH.push(px); if (state.pxH.length > 400) state.pxH.shift(); }

  if (state.sampling) {
    const r = meter.push(world, norm);
    if (r) state.lastBucket = r.bucket;
    state.lastQ = meter.lastQuality;
  }
  drawOverlay();
}

function onResults(res) {
  feed(res.poseWorldLandmarks || res.ea || null, res.poseLandmarks || res.eb || null);
}

// 演示用：绕 Y 轴旋转模拟转体，抬臂 / 平移命中不同姿态桶
function demoFrame(t) {
  const ph = Math.floor(t / 1.2) % 5;   // 6 秒一轮，覆盖全部 5 个姿态桶
  const P = mockPose(t);
  const yaw = [0, 0, 0.62, 1.35, 0][ph];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const shift = ph === 4 ? 0.05 * Math.sin(t * 22) : 0;
  for (const p of P) {
    if (!p) continue;
    const x = p.x, z = p.z;
    p.x = x * c - z * s + shift;
    p.z = x * s + z * c;
  }
  if (ph === 1) {
    P[15].y = -0.62; P[16].y = -0.62;
    P[13].y = -0.52; P[14].y = -0.52;
  }
  return P;
}

async function pump() {
  if (DEMO) {
    state.demoT = (state.demoT || 0) + 0.033;
    const P = demoFrame(state.demoT);
    feed(P, projectToNorm(P));
    requestAnimationFrame(pump);
    return;
  }
  if (state.running && state.ready && !state.busy && els.video.readyState >= 2) {
    state.busy = true;
    try { await state.pose.send({ image: els.video }); }
    catch (e) { console.warn('inference', e); }
    state.busy = false;
  }
  requestAnimationFrame(pump);
}

/* ---------------------------------------------------------------- 绘制 / ROI */

function fitOverlay() {
  const c = els.overlay;
  c.width = Math.max(1, c.clientWidth);
  c.height = Math.max(1, c.clientHeight);
  drawOverlay();
}

function frameRect() {
  const cw = els.overlay.clientWidth || 1;
  const ch = els.overlay.clientHeight || 1;
  const vw = els.video.videoWidth || 1280;
  const vh = els.video.videoHeight || 720;
  const s = Math.min(cw / vw, ch / vh);
  const w = vw * s, h = vh * s;
  return { ox: (cw - w) / 2, oy: (ch - h) / 2, w, h };
}
const toC = (x, y) => { const r = frameRect(); return { x: r.ox + x * r.w, y: r.oy + y * r.h }; };
const toN = (x, y) => {
  const r = frameRect();
  return { x: Math.max(0, Math.min(1, (x - r.ox) / r.w)), y: Math.max(0, Math.min(1, (y - r.oy) / r.h)) };
};
const clampBox = (a, b) => ({
  x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
  x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y),
});

const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

function strokeBox(ctx, box, color, dash, fill) {
  if (!box) return;
  const a = toC(box.x0, box.y0), b = toC(box.x1, box.y1);
  ctx.save();
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); }
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash(dash || []);
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.restore();
}

// 8 个手柄让「可以拖」这件事一眼可见
function drawHandles(ctx, box, color) {
  if (!box) return;
  const a = toC(box.x0, box.y0), b = toC(box.x1, box.y1);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const pts = [[a.x, a.y], [mx, a.y], [b.x, a.y], [a.x, my], [b.x, my],
    [a.x, b.y], [mx, b.y], [b.x, b.y]];
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = '#04121a'; ctx.lineWidth = 1;
  for (const [x, y] of pts) {
    ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
    ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
  }
  ctx.restore();
}

function drawOverlay() {
  const c = els.overlay;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);

  const nm = state.norm;
  if (nm && nm.length >= N) {
    ctx.save();
    ctx.strokeStyle = 'rgba(34,211,238,0.55)'; ctx.lineWidth = 1.6;
    for (const [a, b] of BONES) {
      const p = nm[a], q = nm[b];
      if (!p || !q) continue;
      if ((p.visibility ?? 1) < 0.4 || (q.visibility ?? 1) < 0.4) continue;
      const P = toC(p.x, p.y), Q = toC(q.x, q.y);
      ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(127,243,255,0.85)';
    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const p = nm[i]; if (!p || (p.visibility ?? 1) < 0.4) continue;
      const P = toC(p.x, p.y);
      ctx.beginPath(); ctx.arc(P.x, P.y, 2.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  strokeBox(ctx, state.roi, state.drag ? '#eafcff' : 'rgba(34,211,238,0.9)',
    state.drag ? [] : [6, 4], 'rgba(34,211,238,0.055)');
  strokeBox(ctx, state.refBox, 'rgba(251,191,36,0.95)', [4, 3], 'rgba(251,191,36,0.07)');

  if (state.roi) {
    drawHandles(ctx, state.roi, '#22d3ee');
    const a = toC(state.roi.x0, state.roi.y0);
    ctx.fillStyle = '#7ff3ff';
    ctx.font = '10px Consolas, monospace';
    const pct = `${((state.roi.x1 - state.roi.x0) * 100).toFixed(0)}% × ${((state.roi.y1 - state.roi.y0) * 100).toFixed(0)}%`;
    ctx.fillText(`ROI ${pct} · 拖边缩放 / 双击删除`, a.x + 4, Math.max(12, a.y - 5));
  }
  if (state.refBox) {
    drawHandles(ctx, state.refBox, '#fbbf24');
    const a = toC(state.refBox.x0, state.refBox.y0);
    ctx.fillStyle = 'rgba(251,191,36,0.95)';
    ctx.font = '10px Consolas, monospace';
    ctx.fillText('REF · 参照物', a.x + 4, Math.max(12, a.y - 5));
  }
}

function pointerPos(e) {
  const r = els.overlay.getBoundingClientRect();
  return toN(e.clientX - r.left, e.clientY - r.top);
}

/* ---- 直接鼠标交互：空白处拖出新框 / 框内拖动 / 拖边与四角缩放 / 双击删除 ---- */

function hitROI(p) {
  const b = state.roi;
  if (!b) return null;
  const r = frameRect();
  const tx = 10 / Math.max(1, r.w), ty = 10 / Math.max(1, r.h);
  const l = Math.abs(p.x - b.x0) < tx, rr = Math.abs(p.x - b.x1) < tx;
  const t = Math.abs(p.y - b.y0) < ty, bb = Math.abs(p.y - b.y1) < ty;
  const inside = p.x > b.x0 - tx && p.x < b.x1 + tx && p.y > b.y0 - ty && p.y < b.y1 + ty;
  if (!inside) return null;
  const edges = { l, r: rr, t, b: bb };
  if (l || rr || t || bb) return { edges };
  return { move: true };
}
const hitRef = (p) => {
  const b = state.refBox;
  return !!b && p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
};
function cursorFor(hit) {
  if (!hit) return 'crosshair';
  if (hit.move) return 'move';
  const e = hit.edges;
  if ((e.l && e.t) || (e.r && e.b)) return 'nwse-resize';
  if ((e.r && e.t) || (e.l && e.b)) return 'nesw-resize';
  if (e.l || e.r) return 'ew-resize';
  return 'ns-resize';
}
function dragBox(d, cur) {
  if (d.kind === 'draw' || d.kind === 'ref') return clampBox(d.start, cur);
  const b0 = d.box0 || FULL_ROI;
  const dx = cur.x - d.start.x, dy = cur.y - d.start.y;
  if (d.kind === 'move') {
    const w = b0.x1 - b0.x0, h = b0.y1 - b0.y0;
    const x0 = Math.max(0, Math.min(1 - w, b0.x0 + dx));
    const y0 = Math.max(0, Math.min(1 - h, b0.y0 + dy));
    return { x0, y0, x1: x0 + w, y1: y0 + h };
  }
  let { x0, y0, x1, y1 } = b0;
  const e = d.edges;
  if (e.l) x0 = Math.min(b0.x1 - 0.02, Math.max(0, b0.x0 + dx));
  if (e.r) x1 = Math.max(b0.x0 + 0.02, Math.min(1, b0.x1 + dx));
  if (e.t) y0 = Math.min(b0.y1 - 0.02, Math.max(0, b0.y0 + dy));
  if (e.b) y1 = Math.max(b0.y0 + 0.02, Math.min(1, b0.y1 + dy));
  return { x0, y0, x1, y1 };
}
function commitROI(box) {
  state.roi = box;
  meter.setROI(box || FULL_ROI);
}

els.overlay.addEventListener('pointerdown', (e) => {
  if (!state.running || e.detail >= 2) return;   // 双击交给 dblclick
  const p = pointerPos(e);
  // 「重画区域 / 框参照物」按钮按下后强制画新框，不受已有框的命中影响
  const forceDraw = state.drawMode === 'ref' || state.drawMode === 'roi';
  const hit = forceDraw ? null : hitROI(p);
  let d;
  if (state.drawMode === 'ref') d = { kind: 'ref', start: p, box0: state.refBox ? { ...state.refBox } : null };
  else if (hit && hit.move) d = { kind: 'move', start: p, box0: { ...state.roi } };
  else if (hit) d = { kind: 'resize', start: p, box0: { ...state.roi }, edges: hit.edges };
  else d = { kind: 'draw', start: p, box0: state.roi ? { ...state.roi } : null };
  state.drag = d;
  state.drawMode = null;                          // 一次操作后回到直接编辑模式
  els.guide.hidden = true;
  els.overlay.classList.remove('drawing');
  try { els.overlay.setPointerCapture(e.pointerId); } catch { /* 合成事件无 capture */ }
  drawOverlay();
});

els.overlay.addEventListener('pointermove', (e) => {
  const p = pointerPos(e);
  if (!state.drag) { els.overlay.style.cursor = cursorFor(hitROI(p)); return; }
  const box = dragBox(state.drag, p);
  if (state.drag.kind === 'ref') {
    state.refBox = box;
    els.overlay.style.cursor = 'crosshair';
  } else {
    commitROI(box);                               // 实时生效，采样立刻按新区域过滤
    els.overlay.style.cursor = state.drag.kind === 'move' ? 'move' : 'crosshair';
  }
  drawOverlay();
});

function endDrag(e) {
  const d = state.drag;
  if (!d) return;
  const box = dragBox(d, pointerPos(e));
  state.drag = null;
  try { els.overlay.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
  const valid = box && box.x1 - box.x0 >= 0.02 && box.y1 - box.y0 >= 0.02;
  if (!valid) {
    if (d.kind === 'ref') state.refBox = d.box0;
    else commitROI(d.box0);
    setStatus('框太小了，已恢复原区域', 'err');
  } else if (d.kind === 'ref') {
    state.refBox = box;
    const px = (box.x1 - box.x0) * (els.video.videoWidth || 1280);
    els.refInfo.textContent = `${px.toFixed(0)} px 宽`;
    setStatus('参照物框已记录 · 可直接重拖', 'ok');
  } else {
    commitROI(box);
    setStatus('测量区域已更新 · 可拖动 / 拖边缩放 / 双击删除', 'ok');
  }
  drawOverlay();
}
els.overlay.addEventListener('pointerup', endDrag);
els.overlay.addEventListener('pointercancel', endDrag);

els.overlay.addEventListener('dblclick', (e) => {
  const p = pointerPos(e);
  if (hitROI(p)) { commitROI(null); setStatus('测量区域已删除 · 恢复全画面', ''); }
  else if (hitRef(p)) {
    state.refBox = null;
    els.refInfo.textContent = '未框选';
    setStatus('参照物框已删除', '');
  }
  drawOverlay();
});

// 按钮只是「强制重画」，正常情况直接在画面上拖即可
function beginDraw(mode) {
  if (!state.running) { setStatus('请先启动摄像头', 'err'); return; }
  state.drawMode = mode;
  els.guide.hidden = false;
  els.guide.textContent = mode === 'roi'
    ? '按住鼠标拖出新区域（已有框也能直接拖边/拖角调整）'
    : '拖拽框住参照物（如 A4 纸短边 21cm），尽量与人体处在同一深度';
  els.overlay.classList.add('drawing');
  els.overlay.style.cursor = 'crosshair';
}

/* ---------------------------------------------------------------- 标定 */

function currentCalibration() {
  const mode = els.calMode.value;
  if (mode === 'none') {
    return { heightM: null, detail: '未标定：显示模型先验尺度，仅「比例」可信', quality: 'none' };
  }
  const vw = els.video.videoWidth || 1280;
  const pxH = medianPxH();
  const refPx = state.refBox ? (state.refBox.x1 - state.refBox.x0) * vw : 0;
  const ds = depthSource();
  let laser = Number(els.laserDist.value);
  try {
    const auto = ds?.getDistanceM?.(0.5, 0.5, performance.now() / 1000);
    if (auto > 0) laser = auto;
  } catch { /* 深度源异常时退回手动值 */ }
  return calibrateHeight({
    mode,
    knownHeightCm: Number(els.knownHeight.value),
    personPxHeight: pxH,
    refPx,
    refRealM: Number(els.refRealM.value) / 100,
    laserDistanceM: laser,
    refDistanceM: Number(els.refDist.value),
    viewW: vw,
    hfovDeg: 65,
  });
}

function syncCalRows() {
  const mode = els.calMode.value;
  document.querySelectorAll('[data-mode]').forEach((el) => {
    el.hidden = !(el.dataset.mode || '').split(' ').includes(mode);
  });
}

/* ---------------------------------------------------------------- 刷新 */

function refresh() {
  const cal = currentCalibration();
  const suffix = cal.heightM ? ` → 身高 ${(cal.heightM * 100).toFixed(1)} cm` : '';
  els.calOut.textContent = cal.detail + suffix;
  els.calOut.classList.toggle('warn', cal.quality === 'none' || cal.quality === 'rough');
  els.calTag.textContent = cal.heightM ? `${(cal.heightM * 100).toFixed(1)} cm 已标定` : '未标定';

  const C = cfg();
  const r = meter.result({ heightM: cal.heightM, overrides: state.overrides }, C);
  for (const def of METRIC_DEFS) {
    const m = r.metrics[def.key];
    const e = rowEls[def.key];
    e.v.textContent = m ? m.value.toFixed(1) : '--';
    e.v.classList.toggle('empty', !m);
    e.cv.textContent = m ? (m.cv * 100).toFixed(1) + '%' : '--';
    e.n.textContent = m ? m.n : '0';
  }

  // 实时采集速率与本帧质量，方便判断「灵敏度」够不够；停采后保留最后一次读数
  if (state.sampling) {
    const now = performance.now();
    if (state.fpsT === 0) { state.fpsT = now; state.fpsN = meter.accepted; }
    else if (now - state.fpsT > 250) {
      state.fps = (meter.accepted - state.fpsN) / ((now - state.fpsT) / 1000);
      state.fpsT = now; state.fpsN = meter.accepted;
    }
  }
  els.fpsVal.textContent = `${state.fps.toFixed(0)} fps`;
  els.qVal.textContent = `Q ${state.lastQ.toFixed(2)}`;

  els.confBar.style.width = (r.confidence * 100).toFixed(0) + '%';
  els.confVal.textContent = (r.confidence * 100).toFixed(0) + '%';
  els.cvVal.textContent = (r.avgCv * 100).toFixed(2) + '%';
  els.nVal.textContent = String(r.samples);
  els.covVal.textContent = `${r.coverage}/5`;
  els.sampleInfo.textContent = `${C.label} · 目标 ${C.minSamples} 帧 / ${C.minCoverage} 类姿态 · 丢弃 ${r.rejected} · ${state.devices.size} 个视角`;

  let weakest = null;
  for (const b of BUCKETS) {
    const c = r.buckets[b.key] || 0;
    const el = bucketEls[b.key];
    el.fill.style.width = Math.min(100, (c / C.target) * 100).toFixed(0) + '%';
    el.ct.textContent = String(c);
    el.row.classList.toggle('done', c >= C.perBucket);
    el.row.classList.toggle('cur', state.sampling && b.key === state.lastBucket);
    if (!weakest || c < weakest.c) weakest = { key: b.key, c };
  }

  // 人物是否完整入画 + 具体可行的补救建议
  const fc = framingCheck(state.norm);
  els.frameTip.hidden = fc.ok || !state.running;
  if (!fc.ok) els.frameTip.textContent = `⚠ ${fc.issues.join(' / ')} — ${fc.advice.join('；')}`;

  // 达标自动收尾：不用一直等，也不必凑满 5 个姿态桶
  if (state.sampling && els.autoStop.checked && r.converged && r.samples >= C.minSamples) {
    state.sampling = false;
    syncButtons();
    setStatus(`采集完成 · ${r.samples} 帧 · 置信度 ${(r.confidence * 100).toFixed(0)}% · 可以导出了`, 'ok');
  }

  let hint;
  if (!state.running) hint = '先启动摄像头，再在画面上直接拖出测量区域';
  else if (!state.ready) hint = '推理引擎加载中…';
  else if (!state.sampling) hint = r.samples
    ? `已采 ${r.samples} 帧 · 可继续采样，或直接导出（${C.label}模式）`
    : '在画面上拖框 → 填标定 → 点「开始采样」';
  else if (r.converged && cal.heightM) hint = `已达标 · ${r.samples} 帧 · 置信度 ${(r.confidence * 100).toFixed(0)}%，可继续或导出`;
  else if (!cal.heightM) hint = '注意：当前未标定尺度，数值仅为模型先验，建议填真实身高';
  else if (weakest) hint = `下一步：${NEXT_TEXT[weakest.key]}（该类 ${weakest.c}/${C.target}）`;
  else hint = '继续采样…';
  els.nextHint.textContent = hint;
  els.nextHint.classList.toggle('ok', /已达标|已采|采集完成/.test(hint));

  els.bucketTag.hidden = !(state.sampling && state.lastBucket);
  if (state.sampling && state.lastBucket) {
    const b = BUCKETS.find((x) => x.key === state.lastBucket);
    els.bucketTag.textContent = `采样中 · ${b ? b.label : state.lastBucket}`;
  }

  const ds = depthSource();
  els.depthTag.textContent = ds ? '深度源 已接入' : '深度源 未接入';
}

/* ---------------------------------------------------------------- 导出 */

function doExport(kind) {
  const cal = currentCalibration();
  const data = meter.export({ heightM: cal.heightM, overrides: state.overrides }, cfg());
  data.calibration = { mode: els.calMode.value, detail: cal.detail, quality: cal.quality };
  data.capture = { mode: state.mode, sensitivity: state.sensitivity, viewMode: els.viewMode.value, ...cfg() };
  data.roi = state.roi;
  data.referenceBox = state.refBox;
  data.viewports = state.devices.size;
  let text, mime, ext;
  if (kind === 'json') {
    text = JSON.stringify(data, null, 2); mime = 'application/json'; ext = 'json';
  } else {
    const head = '项目,数值(cm),变异系数,样本数,类型,来源';
    const lines = data.rows.map((r) => `"${r.label}",${r.cm ?? ''},${r.cv ?? ''},${r.n},${r.kind},${r.source ?? ''}`);
    text = '\uFEFF' + [head, ...lines].join('\n');
    mime = 'text/csv;charset=utf-8'; ext = 'csv';
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = `cleanfit-anthro-${Date.now()}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  setStatus(`已导出 ${ext.toUpperCase()} · ${data.samples} 帧样本`, 'ok');
}

/* ---------------------------------------------------------------- 控件 */

function syncButtons() {
  els.btnCam.textContent = state.running ? '关闭摄像头' : '启动摄像头';
  els.btnCam.classList.toggle('danger', state.running);
  els.btnCam.classList.toggle('primary', !state.running);
  els.btnSample.disabled = !state.running || !state.ready;
  els.btnSample.textContent = state.sampling ? '暂停采样' : '开始采样';
  els.btnSample.classList.toggle('on', state.sampling);
  els.idle.hidden = state.running;
  if (DEMO) { els.btnCam.textContent = '演示中'; els.btnCam.disabled = true; }
}

els.btnCam.addEventListener('click', () => {
  if (DEMO) { setStatus('演示模式使用合成姿态，无需摄像头', ''); return; }
  if (state.running) { stopCamera(); setStatus('摄像头已关闭', ''); }
  else startCamera(els.camSelect.value || undefined);
});
els.camSelect.addEventListener('change', () => {
  if (state.running) startCamera(els.camSelect.value || undefined);
});
els.btnSample.addEventListener('click', () => {
  state.sampling = !state.sampling;
  syncButtons();
  setStatus(state.sampling ? '采样中 · 请按右侧引导变换姿态' : '采样已暂停，现有样本保留', state.sampling ? 'live' : '');
});
els.btnReset.addEventListener('click', () => {
  meter.reset(); state.pxH.length = 0; state.devices.clear(); state.lastBucket = null;
  state.fpsT = 0; state.fpsN = 0; state.fps = 0; state.lastQ = 0;
  setStatus('样本已清空，ROI 与标定保留', '');
});
els.btnRoiDraw.addEventListener('click', () => beginDraw('roi'));
els.btnRefDraw.addEventListener('click', () => beginDraw('ref'));
els.btnRoiClear.addEventListener('click', () => {
  commitROI(null);
  state.refBox = null;
  els.refInfo.textContent = '未框选';
  drawOverlay();
  setStatus('区域已清除，恢复全画面', '');
});
els.sensSlider.addEventListener('input', (e) => applySensitivity(e.target.value));
els.modeSel.addEventListener('change', (e) => applyMode(e.target.value));
els.viewMode.addEventListener('change', () => {
  // 换画面比例必须重新协商摄像头分辨率
  if (state.running && !DEMO) startCamera(els.camSelect.value || undefined);
});
els.calMode.addEventListener('change', syncCalRows);
els.btnJson.addEventListener('click', () => doExport('json'));
els.btnCsv.addEventListener('click', () => doExport('csv'));
window.addEventListener('resize', fitOverlay);

/* ---------------------------------------------------------------- 启动 */

buildTable();
buildBuckets();
syncCalRows();
fitOverlay();
try {
  const s = Number(localStorage.getItem('cleanfit.sens'));
  applySensitivity(s > 0 ? s : 8);
  applyMode(localStorage.getItem('cleanfit.mode') || 'fast');
} catch {
  applySensitivity(8);
  applyMode('fast');
}

if (DEMO) {
  state.running = true; state.ready = true;
  els.idle.hidden = true;
  els.camInfo.textContent = 'DEMO · 合成 3D 姿态';
  setStatus('演示模式 · 无需摄像头，直接点「开始采样」', 'ok');
} else {
  initPose();
  listDevices();
}
syncButtons();
setInterval(refresh, 250);
requestAnimationFrame(pump);
refresh();
