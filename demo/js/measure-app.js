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
  AnthroMeter, METRIC_DEFS, BUCKETS, calibrateHeight, depthSource,
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
};

const meter = new AnthroMeter({ minQuality: 0.4, maxSamples: 1200 });
const state = {
  stream: null, pose: null, ready: false, running: false, busy: false,
  sampling: false, world: null, norm: null,
  roi: null, refBox: null, drawMode: null, drag: null,
  overrides: {}, pxH: [], devices: new Set(), lastBucket: null,
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
  const base = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
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

  strokeBox(ctx, state.roi, 'rgba(34,211,238,0.9)', [6, 4], 'rgba(34,211,238,0.055)');
  strokeBox(ctx, state.refBox, 'rgba(251,191,36,0.95)', [4, 3], 'rgba(251,191,36,0.07)');
  if (state.drag) strokeBox(ctx, clampBox(state.drag.a, state.drag.b), '#eafcff', [3, 3], null);

  if (state.roi) {
    const a = toC(state.roi.x0, state.roi.y0);
    ctx.fillStyle = 'rgba(34,211,238,0.9)';
    ctx.font = '10px Consolas, monospace';
    ctx.fillText('ROI · 限定测量区域', a.x + 4, a.y - 5);
  }
  if (state.refBox) {
    const a = toC(state.refBox.x0, state.refBox.y0);
    ctx.fillStyle = 'rgba(251,191,36,0.95)';
    ctx.font = '10px Consolas, monospace';
    ctx.fillText('REF · 参照物', a.x + 4, a.y - 5);
  }
}

function pointerPos(e) {
  const r = els.overlay.getBoundingClientRect();
  return toN(e.clientX - r.left, e.clientY - r.top);
}

els.overlay.addEventListener('pointerdown', (e) => {
  if (!state.drawMode) return;
  const p = pointerPos(e);
  state.drag = { a: p, b: p };
  els.overlay.setPointerCapture(e.pointerId);
  drawOverlay();
});
els.overlay.addEventListener('pointermove', (e) => {
  if (!state.drag) return;
  state.drag.b = pointerPos(e);
  drawOverlay();
});
els.overlay.addEventListener('pointerup', (e) => {
  if (!state.drag) return;
  state.drag.b = pointerPos(e);
  const box = clampBox(state.drag.a, state.drag.b);
  state.drag = null;
  try { els.overlay.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }

  if (box.x1 - box.x0 < 0.02 || box.y1 - box.y0 < 0.02) {
    setStatus('框太小了，请拖出一个有效区域', 'err');
  } else if (state.drawMode === 'roi') {
    state.roi = box;
    meter.setROI(box);
    setStatus('测量区域已设定 · 只统计框内关键点', 'ok');
  } else {
    state.refBox = box;
    const px = (box.x1 - box.x0) * (els.video.videoWidth || 1280);
    els.refInfo.textContent = `${px.toFixed(0)} px 宽`;
    setStatus('参照物框已记录', 'ok');
  }
  state.drawMode = null;
  els.guide.hidden = true;
  els.overlay.classList.remove('drawing');
  drawOverlay();
});

function beginDraw(mode) {
  if (!state.running) { setStatus('请先启动摄像头', 'err'); return; }
  state.drawMode = mode;
  els.guide.hidden = false;
  els.guide.textContent = mode === 'roi'
    ? '拖拽框出「限定测量区域」：框全身测全身，框上半身只出上半身指标'
    : '拖拽框住参照物（如 A4 纸短边 21cm），尽量与人体处在同一深度';
  els.overlay.classList.add('drawing');
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

  const r = meter.result({ heightM: cal.heightM, overrides: state.overrides });
  for (const def of METRIC_DEFS) {
    const m = r.metrics[def.key];
    const e = rowEls[def.key];
    e.v.textContent = m ? m.value.toFixed(1) : '--';
    e.v.classList.toggle('empty', !m);
    e.cv.textContent = m ? (m.cv * 100).toFixed(1) + '%' : '--';
    e.n.textContent = m ? m.n : '0';
  }

  els.confBar.style.width = (r.confidence * 100).toFixed(0) + '%';
  els.confVal.textContent = (r.confidence * 100).toFixed(0) + '%';
  els.cvVal.textContent = (r.avgCv * 100).toFixed(2) + '%';
  els.nVal.textContent = String(r.samples);
  els.covVal.textContent = `${r.coverage}/5`;
  els.sampleInfo.textContent = `${r.samples} 帧 · 丢弃 ${r.rejected} · ${state.devices.size} 个视角`;

  let weakest = null;
  for (const b of BUCKETS) {
    const c = r.buckets[b.key] || 0;
    const el = bucketEls[b.key];
    el.fill.style.width = Math.min(100, (c / 60) * 100).toFixed(0) + '%';
    el.ct.textContent = String(c);
    el.row.classList.toggle('done', c >= 40);
    el.row.classList.toggle('cur', state.sampling && b.key === state.lastBucket);
    if (!weakest || c < weakest.c) weakest = { key: b.key, c };
  }

  let hint;
  if (!state.running) hint = '先启动摄像头，再框出测量区域';
  else if (!state.ready) hint = '推理引擎加载中…';
  else if (!state.sampling) hint = '设定 ROI 与标定方式后，点「开始采样」';
  else if (r.converged && r.coverage >= 4 && cal.heightM) hint = '已收敛 · 数据稳定，可以导出了';
  else if (!cal.heightM) hint = '注意：当前未标定尺度，数值仅为模型先验，建议填真实身高';
  else if (weakest) hint = `下一步：${NEXT_TEXT[weakest.key]}（该类样本 ${weakest.c}/60）`;
  else hint = '继续采样…';
  els.nextHint.textContent = hint;
  els.nextHint.classList.toggle('ok', /已收敛/.test(hint));

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
  const data = meter.export({ heightM: cal.heightM, overrides: state.overrides });
  data.calibration = { mode: els.calMode.value, detail: cal.detail, quality: cal.quality };
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
  setStatus('样本已清空，ROI 与标定保留', '');
});
els.btnRoiDraw.addEventListener('click', () => beginDraw('roi'));
els.btnRefDraw.addEventListener('click', () => beginDraw('ref'));
els.btnRoiClear.addEventListener('click', () => {
  state.roi = null; state.refBox = null;
  meter.setROI({ x0: 0, y0: 0, x1: 1, y1: 1 });
  els.refInfo.textContent = '未框选';
  drawOverlay();
  setStatus('区域已清除，恢复全画面', '');
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
