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
};

const state = {
  mirror: true,
  showMask: false,
  showBones: true,
  running: false,
  busy: false,
  ready: false,
  world: null,
  norm: null,
  mask: null,
  rows: null,        // 掩码行扫描结果 [{y, l, r}]
  m: null,           // 测量结果
  fps: 0,
  frames: 0,
  fpsT: 0,
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

async function pump() {
  if (state.running && state.ready && !state.busy && els.video.readyState >= 2) {
    state.busy = true;
    try {
      await pose.send({ image: els.video });
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

// ---------------------------------------------------------------- 摄像头

let stream = null;
let currentDeviceId = null;

// 列出所有摄像头。注意：未授权前 label 是空的，所以拿到权限后再列一次
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
      return;
    }
    cams.forEach((c, i) => {
      const o = document.createElement('option');
      o.value = c.deviceId;
      o.textContent = c.label || `摄像头 ${i + 1}`;
      els.camSelect.append(o);
    });
    if (currentDeviceId) els.camSelect.value = currentDeviceId;
  } catch (e) {
    console.warn('enumerateDevices', e);
  }
}

async function startCamera(deviceId) {
  els.btnCam.disabled = true;
  setStatus('正在请求摄像头权限…', 'warn');
  try {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    // 指定了设备就用 exact，否则让浏览器挑默认（通常是内置摄像头）
    const video = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } };

    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    els.video.srcObject = stream;
    await els.video.play();

    const settings = stream.getVideoTracks()[0].getSettings();
    currentDeviceId = settings.deviceId || deviceId || null;

    els.camIdle.classList.add('hide');
    state.running = true;
    els.btnCam.disabled = false;
    els.btnCam.textContent = '摄像头已开启';
    els.btnCam.classList.remove('primary');
    fitOverlay();
    setStatus('实时追踪中', 'live');
    els.loadInfo.textContent = '引擎就绪 · BlazePose Lite';
    await listDevices();
  } catch (e) {
    console.error(e);
    els.btnCam.disabled = false;
    const msg =
      e && e.name === 'NotAllowedError' ? '权限被拒绝，请允许摄像头访问'
        : e && e.name === 'NotFoundError' ? '未找到摄像头设备'
          : '摄像头不可用：' + (e && e.message ? e.message : e);
    setStatus(msg, 'err');
  }
}

// ---------------------------------------------------------------- 事件

els.btnCam.addEventListener('click', startCamera);

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

// 切换摄像头：停掉旧流，用新 deviceId 重新取流
els.camSelect.addEventListener('change', () => {
  const id = els.camSelect.value;
  if (!id) return;
  currentDeviceId = id;
  if (state.running) startCamera(id);
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
  setStatus('演示模式 · 合成姿态驱动', 'live');
  els.loadInfo.textContent = '演示数据 · 未加载推理模型';
} else {
  listDevices();
  initPose();
  // 页面加载后自动尝试一次（浏览器会弹权限框）
  setTimeout(() => { if (!state.running) startCamera(); }, 600);
}
