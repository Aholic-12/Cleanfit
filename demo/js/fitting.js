// AD 试衣渲染层：把上传的衣服图实时贴到「真实人物」身上（摄像头画面）
//
// 这是一个独立的窗口/视图，和右边的全息 3D 小人互不影响。
//
// 渲染管线（全部在浏览器里跑，不依赖任何云服务）：
//   ① 躯干网格贴图   按肩/胯关键点算轮廓，6×12 网格逐三角仿射变形
//   ② 袖子 / 领口     袖子沿上臂画管，领口用 destination-out 真的「挖空」露出脖子
//   ③ 光影合成       在离屏层上用 source-atop 只对衣服像素叠加：
//                       · 圆柱体积（两侧压暗、中间提亮）
//                       · 顶光渐变（肩亮 → 下摆暗）
//                       · 纵向褶皱（低频正弦明暗带，随时间轻微摆动）
//                       · 环境光匹配（从视频帧取样，暗场景把衣服一起压暗）
//   ④ 柔边合成       先画一层轻微模糊打底，再叠清晰层 → 边缘不再是硬锯齿
//   ⑤ 遮挡还原       手臂压在身前时，用视频帧把手臂区域重新盖回衣服上面
//
// 这套做法的效果上限受限于「没有真正的布料模拟」——要完全达到扩散模型的
// 水准必须上云端实时 VTON（见 docs/recon-tryanywear.md），但去掉 90% 的
// 「贴纸感」是够的。
import { prepareGarmentCanvas, averageColor } from './garment.js';
import { BONES } from './rig.js';

const N = 33;

function lerp2(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// 双线性插值：Q = [TL, TR, BR, BL]，u 横向、v 纵向（0=肩，1=下摆）
function bilerp(Q, u, v) {
  const top = lerp2(Q[0], Q[1], u);
  const bot = lerp2(Q[3], Q[2], u);
  return lerp2(top, bot, v);
}

// 解 3×3 线性方程组 A·x = b（高斯消元），返回 [x0, x1, x2]
function solve3(A, b) {
  const m = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-9) return [0, 0, 0];
    if (p !== c) { const t = m[p]; m[p] = m[c]; m[c] = t; }
    const piv = m[c][c];
    for (let k = c; k < 4; k++) m[c][k] /= piv;
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c];
      if (!f) continue;
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
}

// 把三角形的三个顶点沿「质心 → 顶点」方向外扩 px 像素。
// 相邻网格单元因此会重叠一点点，clip 的抗锯齿就不会在接缝处留下半透明细线
// —— 否则整件衣服会浮出 6×12 的网格，一眼就是贴图。
function inflateTri(d, px) {
  const cx = (d[0] + d[2] + d[4]) / 3;
  const cy = (d[1] + d[3] + d[5]) / 3;
  const out = new Array(6);
  for (let i = 0; i < 3; i++) {
    const vx = d[i * 2] - cx;
    const vy = d[i * 2 + 1] - cy;
    const L = Math.hypot(vx, vy) || 1;
    out[i * 2] = d[i * 2] + (vx / L) * px;
    out[i * 2 + 1] = d[i * 2 + 1] + (vy / L) * px;
  }
  return out;
}

// 颜色提亮 / 压暗：k>0 往白走，k<0 往黑走
function tint(hex, k) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (k >= 0) {
    r += (255 - r) * k;
    g += (255 - g) * k;
    b += (255 - b) * k;
  } else {
    r *= 1 + k;
    g *= 1 + k;
    b *= 1 + k;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// 把源三角形映射到目标三角形，用仿射 + clip 画图（canvas 不能直接画三角）
function mapTri(ctx, img, s, d) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d[0], d[1]);
  ctx.lineTo(d[2], d[3]);
  ctx.lineTo(d[4], d[5]);
  ctx.closePath();
  ctx.clip();

  const A = [[s[0], s[1], 1], [s[2], s[3], 1], [s[4], s[5], 1]];
  const mx = solve3(A, [d[0], d[2], d[4]]);
  const my = solve3(A, [d[1], d[3], d[5]]);
  ctx.transform(mx[0], my[0], mx[1], my[1], mx[2], my[2]);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

// 胶囊形路径：A→B 两端加半圆。用来 clip 出「一条手臂」的区域。
// clip 只认填充区域、不认 lineWidth，所以不能直接用粗线 stroke 来裁。
function capsulePath(ctx, A, B, r) {
  const ang = Math.atan2(B.y - A.y, B.x - A.x);
  ctx.beginPath();
  ctx.arc(A.x, A.y, r, ang + Math.PI / 2, ang - Math.PI / 2);
  ctx.arc(B.x, B.y, r, ang - Math.PI / 2, ang + Math.PI / 2);
  ctx.closePath();
}

export class FittingView {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.garment = null;
    this.srcImg = null;
    this.removeWhite = true;
    this.scale = 1;
    this.showBones = true;

    // 离屏合成层：衣服 + 袖子 + 明暗都在这里拼好，再整层贴到主画布。
    // 复用同一个 canvas，避免每帧新建。
    this._layer = null;
    this._lctx = null;

    // 1×1 采样画布：把整帧缩成 1 像素 = 自动求平均色，成本可以忽略
    this._probe = null;
    this._probeCtx = null;
    this._amb = 0;
    this._ambTick = 0;

    // 光照场：把躯干区域缩成 8×10 的小网格，得到「哪边亮、哪边暗」的低频光图。
    // 衣服按这张图做提亮/压暗，就会跟着场景的真实打光走，而不是自己一套假光。
    this._lfCv = null;
    this._lfCtx = null;
    this._darkCv = null;
    this._brightCv = null;
    this._lfReady = false;
    this._lfTick = 0;
  }

  loadImage(img) {
    this.srcImg = img;
    // flatten:false —— 真实人物贴图要保留衣服的 alpha 轮廓（T 恤形状），
    // 铺底色会变成一个矩形块，贴上去不像衣服。
    this.garment = prepareGarmentCanvas(img, { removeWhite: this.removeWhite, flatten: false });
    this.baseGarment = this.garment;
    this._syncColor();
    return { width: this.garment.width, height: this.garment.height };
  }

  setRemoveWhite(v) {
    this.removeWhite = !!v;
    if (this.srcImg) {
      this.garment = prepareGarmentCanvas(this.srcImg, { removeWhite: this.removeWhite, flatten: false });
      this.baseGarment = this.garment;
      this._syncColor();
    }
  }

  // 取衣服平均色，给袖子 / 领口用，保证它们和主体同色系
  _syncColor() {
    if (!this.garment) return;
    const c = averageColor(this.garment);
    this.color = '#' + c.toString(16).padStart(6, '0');
  }

  setScale(s) {
    this.scale = Math.max(0.7, Math.min(1.35, s));
  }

  clear() {
    this.garment = null;
    this.srcImg = null;
  }

  draw(video, norm, mirror, W, H, opts = {}) {
    const ctx = this.ctx;
    if (!W || !H) return;
    const t = performance.now() / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.clearRect(0, 0, W, H);

    const hasVideo = !!(video && video.videoWidth && video.readyState >= 2);
    if (hasVideo) {
      // 视频和摄像头画面一样做镜像（自拍视角），衣服坐标也随之镜像
      ctx.save();
      if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, 0, 0, W, H);
      ctx.restore();
    } else {
      this._backdrop(ctx, W, H, t);
    }

    if (!norm || norm.length !== N) return;

    const px = (x) => (mirror ? 1 - x : x) * W;
    const py = (y) => y * H;
    const ok = (i) => norm[i] && (norm[i].visibility === undefined || norm[i].visibility > 0.28);

    // 骨架（可选，和摄像头叠加层风格一致）
    if (opts.showBones !== false && this.showBones) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(127,243,255,0.9)';
      ctx.shadowColor = 'rgba(34,211,238,0.9)';
      ctx.shadowBlur = H * 0.012;
      ctx.lineWidth = Math.max(1.4, H * 0.004);
      for (const [a, b] of BONES) {
        if (!ok(a) || !ok(b)) continue;
        ctx.beginPath();
        ctx.moveTo(px(norm[a].x), py(norm[a].y));
        ctx.lineTo(px(norm[b].x), py(norm[b].y));
        ctx.stroke();
      }
      ctx.restore();
    }

    if (this.garment && ok(11) && ok(12) && ok(23) && ok(24)) {
      this._compose(video, norm, px, py, W, H, mirror, t, hasVideo);
    }
  }

  // ---------------------------------------------------------------- 几何

  /** 算一次躯干几何，后面几步共用，避免每步重算关键点。 */
  _geometry(norm, px, py) {
    const shLx = px(norm[11].x);
    const shRx = px(norm[12].x);
    const shY = py((norm[11].y + norm[12].y) / 2);
    const hpLx = px(norm[23].x);
    const hpRx = px(norm[24].x);
    const hpY = py((norm[23].y + norm[24].y) / 2);

    // 领口略高于肩线（盖住斜方肌），下摆随「衣长」滑块向下延伸
    const topY = shY - (hpY - shY) * 0.12;
    const botY = hpY + (hpY - shY) * (this.scale - 1) * 0.5;
    const padX = (shRx - shLx) * 0.06;   // 布料松量

    // 收腰轮廓：肩 → 腰（收到肩宽 0.82）→ 胯。
    // 单一四边形会把衣服贴成直筒，收腰后才像紧身衣裹在躯干上。
    const cx = (shLx + shRx) / 2;
    const shHalf = (shRx - shLx) / 2 + padX;
    const waHalf = shHalf * 0.82;
    const hpHalf = (hpRx - hpLx) / 2 + padX;
    const maxHalf = Math.max(shHalf, waHalf, hpHalf);

    // 下摆下垂量：布料中间比两侧低一点，边缘就不是一条水平硬线了
    const sag = Math.max(0, hpY - shY) * 0.07;
    // 肩斜：真实衣服的肩缝从领口往外是往下走的，水平一条直线是最强的「假」信号
    const slope = shHalf * 0.16;

    const prof = (v) => {
      const y = topY + (botY - topY) * v;
      const half = v <= 0.55
        ? shHalf + (waHalf - shHalf) * (v / 0.55)
        : waHalf + (hpHalf - waHalf) * ((v - 0.55) / 0.45);
      return { l: cx - half, r: cx + half, y };
    };

    const at = (u, v) => {
      const p = prof(v);
      const bow = 1 - Math.pow(2 * u - 1, 2);   // 中间 1、两侧 0
      // 肩斜只影响上沿，到腰以下就没了
      const drop = (1 - bow) * slope * (1 - v) * (1 - v);
      return { x: p.l + (p.r - p.l) * u, y: p.y + bow * sag * v * v + drop };
    };

    return { cx, topY, botY, shY, hpY, shHalf, waHalf, hpHalf, maxHalf, sag, slope, prof, at };
  }

  _ensureLayer(W, H) {
    if (!this._layer) {
      this._layer = document.createElement('canvas');
      this._lctx = this._layer.getContext('2d');
    }
    if (this._layer.width !== W || this._layer.height !== H) {
      this._layer.width = W;
      this._layer.height = H;
    }
    const L = this._lctx;
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.globalCompositeOperation = 'source-over';
    L.globalAlpha = 1;
    L.filter = 'none';
    L.clearRect(0, 0, W, H);
    return L;
  }

  // ---------------------------------------------------------------- 合成

  _compose(video, norm, px, py, W, H, mirror, t, hasVideo) {
    const geo = this._geometry(norm, px, py);
    this.lastGeo = geo;
    const L = this._ensureLayer(W, H);

    // 衣服落地前先在下面垫一层接触阴影，下摆外沿会有一点「压在裤子上」的暗，
    // 这一层被衣服本身盖住大半，只在轮廓外露出来。
    this._contactShadow(this.ctx, geo);

    this._cloth(L, geo);
    this._sleeves(L, norm, px, py, geo);
    this._neckOpening(L, geo);
    this._shade(L, geo, t, hasVideo, video, W, H, mirror);

    // 合成：先画一层轻微模糊的底（柔化边缘），再叠清晰层（保住印花细节）
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.7;
    try { ctx.filter = `blur(${Math.max(0.6, H * 0.0018).toFixed(2)}px)`; } catch (_) {}
    ctx.drawImage(this._layer, 0, 0);
    ctx.restore();
    ctx.drawImage(this._layer, 0, 0);

    this._occlude(video, norm, px, py, W, H, mirror);
  }

  /** 躯干网格贴图：6×12 网格，每格两个三角。 */
  _cloth(L, geo) {
    const g = this.garment;
    const sw = g.width;
    const sh = g.height;
    const GX = 6;
    const GY = 12;

    for (let gy = 0; gy < GY; gy++) {
      for (let gx = 0; gx < GX; gx++) {
        const u0 = gx / GX;
        const u1 = (gx + 1) / GX;
        const v0 = gy / GY;
        const v1 = (gy + 1) / GY;
        const s0 = u0 * sw;
        const s1 = u1 * sw;
        const t0 = v0 * sh;
        const t1 = v1 * sh;
        const p00 = geo.at(u0, v0);
        const p10 = geo.at(u1, v0);
        const p11 = geo.at(u1, v1);
        const p01 = geo.at(u0, v1);
        mapTri(L, g, [s0, t0, s1, t0, s1, t1],
          inflateTri([p00.x, p00.y, p10.x, p10.y, p11.x, p11.y], 0.9));
        mapTri(L, g, [s0, t0, s1, t1, s0, t1],
          inflateTri([p00.x, p00.y, p11.x, p11.y, p01.x, p01.y], 0.9));
      }
    }
  }

  /**
   * 两只短袖。
   *
   * 两个要点，缺一个袖子就会「飞」出去：
   *   ① 内边必须落在衣身的肩缝上（`geo.at(0|1, v)`），和衣身共用一条边；
   *   ② 外形必须沿**手臂轴线**（肩点 → 肘点）铺开，而不是沿衣身边缘。
   * 之前只做了 ①，袖子的生长方向跟着衣身边缘走，画出来是一片翘在肩外的深色鳍。
   * 现在用「肩缝两点 + 手臂外缘两点」连成一个六边形，袖山贴着肩、袖口包着上臂。
   */
  _sleeves(ctx, norm, px, py, geo) {
    const col = this.color || '#2a4a7a';

    for (const side of [0, 1]) {
      const [a, b] = side === 0 ? [11, 13] : [12, 14];
      if (!norm[a] || !norm[b]) continue;
      const S = { x: px(norm[a].x), y: py(norm[a].y) };
      const E = { x: px(norm[b].x), y: py(norm[b].y) };
      const len = Math.hypot(E.x - S.x, E.y - S.y);
      if (len < 8) continue;

      // 手臂方向（肩 → 肘）。n 取「朝身体外侧」，左右两侧要反向，
      // 否则右边那条袖子会往身体里长。
      const dx = (E.x - S.x) / len;
      const dy = (E.y - S.y) / len;
      const sgn = side === 0 ? 1 : -1;
      const nx = -dy * sgn;
      const ny = dx * sgn;

      // 袖缝：肩点 → 腋下。这条斜线就是真实短袖的袖窿，比沿着衣身边缘画更自然，
      // 也不会在肩头留出一个凹口（凹口会被光照压暗，看起来像一块肩垫）。
      const r = len * 0.19;          // 袖管半径 ≈ 上臂粗的一半
      const reach = len * 0.50;      // 短袖到上臂一半

      const seamTop = { x: S.x + nx * r * 0.12, y: S.y + ny * r * 0.12 };
      const seamBot = geo.at(side, 0.34);
      const a1 = { x: S.x + dx * reach + nx * r, y: S.y + dy * reach + ny * r };
      const a2 = { x: S.x + dx * reach - nx * r * 0.80, y: S.y + dy * reach - ny * r * 0.80 };
      // 袖口鼓包控制点：从外缘到内缘，沿手臂方向再探出一点
      const ctl = {
        x: (a1.x + a2.x) / 2 + dx * r * 1.15,
        y: (a1.y + a2.y) / 2 + dy * r * 1.15,
      };

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(seamTop.x, seamTop.y);
      ctx.lineTo(a1.x, a1.y);
      ctx.quadraticCurveTo(ctl.x, ctl.y, a2.x, a2.y);
      ctx.lineTo(seamBot.x, seamBot.y);
      ctx.closePath();

      // 柱面光照：外缘暗 → 受光面亮 → 内侧暗，和躯干是同一套打光
      const g = ctx.createLinearGradient(a1.x, a1.y, seamBot.x, seamBot.y);
      g.addColorStop(0, tint(col, -0.04));
      g.addColorStop(0.26, tint(col, 0.11));
      g.addColorStop(0.70, tint(col, 0.03));
      g.addColorStop(1, tint(col, -0.13));
      ctx.fillStyle = g;
      ctx.fill();

      // 袖口：只压外端那一段弧，不要整圈描边（整圈会变成一个黑圆盘）
      ctx.beginPath();
      ctx.moveTo(a1.x, a1.y);
      ctx.quadraticCurveTo(ctl.x, ctl.y, a2.x, a2.y);
      ctx.strokeStyle = 'rgba(0,0,0,0.20)';
      ctx.lineWidth = Math.max(1.5, r * 0.20);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * 领口：真的把布「挖掉」一块，露出下面的脖子，而不是盖一块黑色椭圆。
   * 挖完之后布的上沿就是一个 U 形开口 —— 这是「穿在身上」最关键的信号。
   */
  _neckOpening(L, geo) {
    const rx = Math.max(6, geo.shHalf * 0.30);
    const ry = rx * 0.78;
    const cy = geo.topY + ry * 0.30;   // 椭圆顶部探出布的上沿 → 露出 U 形

    L.save();
    L.globalCompositeOperation = 'destination-out';
    L.translate(geo.cx, cy);
    L.scale(1, ry / rx);
    const g = L.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.70, 'rgba(0,0,0,0.98)');
    g.addColorStop(1, 'rgba(0,0,0,0)');    // 软边：不留下锯齿状的布口
    L.fillStyle = g;
    L.beginPath();
    L.arc(0, 0, rx, 0, Math.PI * 2);
    L.fill();
    L.restore();

    // 记下来给 _shade 画领口内壁的暗边
    this._neck = { cx: geo.cx, cy, rx, ry };
  }

  /**
   * 光影：全部用 source-atop 叠加，只会落在已经画了布的像素上，
   * 不会漏到背景和皮肤上，也就不需要额外的遮罩。
   */
  _shade(L, geo, t, hasVideo, video, W, H, mirror) {
    const { cx, topY, botY, maxHalf } = geo;
    const h = Math.max(1, botY - topY);
    // 袖子伸在躯干轮廓之外，环境光和顶光要按更宽的范围铺，否则袖子和衣身
    // 会是两种亮度，看起来就像两块分开的布
    const wideL = cx - maxHalf * 2.1;
    const wideW = maxHalf * 4.2;

    L.save();
    L.globalCompositeOperation = 'source-atop';

    // ① 环境光匹配：画面暗就把衣服一起压暗，别让它像自带背光的贴纸
    const amb = this._ambient(hasVideo, video, W, H);
    if (amb !== 0) {
      L.fillStyle = amb < 0
        ? `rgba(0,0,0,${Math.min(0.42, -amb).toFixed(3)})`
        : `rgba(255,255,255,${Math.min(0.14, amb).toFixed(3)})`;
      L.fillRect(wideL, topY - 4, wideW, h + 8);
    }

    // ② 圆柱体积：两侧压暗、正面偏亮，衣服立刻从「平面」变成「包着身体的曲面」
    const gx = L.createLinearGradient(cx - maxHalf, 0, cx + maxHalf, 0);
    gx.addColorStop(0.00, 'rgba(0,0,0,0.46)');
    gx.addColorStop(0.10, 'rgba(0,0,0,0.22)');
    gx.addColorStop(0.30, 'rgba(0,0,0,0.04)');
    gx.addColorStop(0.44, 'rgba(255,255,255,0.07)');
    gx.addColorStop(0.58, 'rgba(255,255,255,0.02)');
    gx.addColorStop(0.76, 'rgba(0,0,0,0.12)');
    gx.addColorStop(0.92, 'rgba(0,0,0,0.30)');
    gx.addColorStop(1.00, 'rgba(0,0,0,0.50)');
    L.fillStyle = gx;
    L.fillRect(cx - maxHalf - 4, topY - 4, maxHalf * 2 + 8, h + 8);

    // ③ 顶光：肩部亮、下摆暗
    const gy = L.createLinearGradient(0, topY, 0, botY);
    gy.addColorStop(0.00, 'rgba(255,255,255,0.16)');
    gy.addColorStop(0.30, 'rgba(255,255,255,0.03)');
    gy.addColorStop(0.72, 'rgba(0,0,0,0.04)');
    gy.addColorStop(1.00, 'rgba(0,0,0,0.24)');
    L.fillStyle = gy;
    L.fillRect(wideL, topY - 4, wideW, h + 8);

    // ④ 纵向褶皱：布料从肩部垂下来形成的竖条明暗。
    //    频率和相位都不规则，避免看出正弦的规律；随时间极缓地摆动，像布料在呼吸。
    const folds = 7;
    for (let i = 0; i < folds; i++) {
      const seed = i * 1.93;
      const drift = Math.sin(t * 0.55 + seed) * 0.035;
      const u = 0.08 + (i / (folds - 1)) * 0.84 + drift;
      const x = cx - maxHalf + maxHalf * 2 * u;
      const w = maxHalf * (0.055 + 0.045 * Math.abs(Math.sin(seed * 1.7)));
      const dark = i % 2 === 0;
      const lg = L.createLinearGradient(x - w, 0, x + w, 0);
      lg.addColorStop(0, 'rgba(0,0,0,0)');
      lg.addColorStop(0.5, dark ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.09)');
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      L.fillStyle = lg;
      // 褶皱只从肩下一点开始，到胯部收敛 —— 上沿和领口附近不该有竖条
      L.fillRect(x - w, topY + h * 0.10, w * 2, h * 0.82);
    }

    // ⑤ 光照场：把场景里躯干那块的真实明暗贴到衣服上。
    //    压暗层和提亮层分开画，alpha 来自 8×10 的采样网格，放大后是平滑渐变。
    this._sampleLight(video, geo, mirror, W, H);
    if (this._lfReady) {
      L.imageSmoothingEnabled = true;
      L.globalAlpha = 0.62;
      L.drawImage(this._darkCv, wideL, topY - 4, wideW, h + 8);
      L.drawImage(this._brightCv, wideL, topY - 4, wideW, h + 8);
      L.globalAlpha = 1;
    }

    // ⑥ 领口内壁：贴着挖开的边缘压一圈很细的暗，布口就有了厚度。
    //    太粗会变成一条项圈，宁细勿粗。
    if (this._neck) {
      const { cx: ncx, cy: ncy, rx, ry } = this._neck;
      L.save();
      L.translate(ncx, ncy);
      L.scale(1, ry / rx);
      L.beginPath();
      L.arc(0, 0, rx * 1.03, 0, Math.PI * 2);
      L.strokeStyle = 'rgba(0,0,0,0.22)';
      L.lineWidth = rx * 0.11;
      L.stroke();
      L.restore();
    }

    L.restore();
  }

  /**
   * 采样光照场：把躯干区域缩成 8×10 的小网格，得到一张「哪边亮、哪边暗」的
   * 低频光图，再拆成「压暗」和「提亮」两张带 alpha 的蒙版。
   *
   * 之前只有全局平均亮度，等于假设整个躯干受光是均匀的 —— 衣服会像自带柔光箱。
   * 有了这张图，光从左边来衣服左边就亮，人往暗处走衣服跟着暗，才是「在这个房间里」。
   */
  _sampleLight(video, geo, mirror, W, H) {
    if (!video || !video.videoWidth) { this._lfReady = false; return; }
    // 每 6 帧采一次：光不会一帧一变，采样本身也要 drawImage + 读像素
    if (this._lfTick++ % 6 !== 0 && this._lfReady) return;

    const GW = 8;
    const GH = 10;
    if (!this._lfCv) {
      this._lfCv = document.createElement('canvas');
      this._lfCv.width = GW;
      this._lfCv.height = GH;
      this._lfCtx = this._lfCv.getContext('2d', { willReadFrequently: true });
      this._darkCv = document.createElement('canvas');
      this._darkCv.width = GW;
      this._darkCv.height = GH;
      this._brightCv = document.createElement('canvas');
      this._brightCv.width = GW;
      this._brightCv.height = GH;
      this._darkData = this._darkCv.getContext('2d').createImageData(GW, GH);
      this._brightData = this._brightCv.getContext('2d').createImageData(GW, GH);
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    // 画布坐标 → 视频坐标
    let sx = ((geo.cx - geo.maxHalf) / W) * vw;
    const sy = (geo.topY / H) * vh;
    let sw = ((geo.maxHalf * 2) / W) * vw;
    const sh = ((geo.botY - geo.topY) / H) * vh;
    if (mirror) sx = vw - sx - sw;          // 画布是镜像的，采样区要跟着翻
    // 裁到画面内，否则 drawImage 会画歪
    const cx0 = Math.max(0, Math.min(vw - 4, sx));
    const cy0 = Math.max(0, Math.min(vh - 4, sy));
    const cw = Math.max(4, Math.min(vw - cx0, sw));
    const chh = Math.max(4, Math.min(vh - cy0, sh));

    try {
      this._lfCtx.drawImage(video, cx0, cy0, cw, chh, 0, 0, GW, GH);
      const px = this._lfCtx.getImageData(0, 0, GW, GH).data;
      const n = GW * GH;
      const lum = new Float32Array(n);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        const l = (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255;
        lum[i] = l;
        sum += l;
      }
      const mean = sum / n;

      const dk = this._darkData.data;
      const br = this._brightData.data;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        const d = Math.max(0, mean - lum[i]) / Math.max(0.05, mean);
        const b = Math.max(0, lum[i] - mean) / Math.max(0.05, 1 - mean);
        // 压暗：纯黑 + alpha；提亮：纯白 + alpha
        dk[o] = 0; dk[o + 1] = 0; dk[o + 2] = 0;
        dk[o + 3] = Math.min(255, d * 255 * 1.7);
        br[o] = 255; br[o + 1] = 255; br[o + 2] = 255;
        br[o + 3] = Math.min(255, b * 255 * 1.7);
      }
      this._darkCv.getContext('2d').putImageData(this._darkData, 0, 0);
      this._brightCv.getContext('2d').putImageData(this._brightData, 0, 0);
      this._lfReady = true;
    } catch (_) {
      this._lfReady = false;
    }
  }

  /** 从视频帧取平均亮度，换算成环境光修正量（负=压暗，正=提亮）。 */
  _ambient(hasVideo, video, W, H) {    if (!hasVideo || !video) return 0;
    // 每 12 帧采一次就够了，光照不会一帧一变
    if (this._ambTick++ % 12 !== 0) return this._amb;
    try {
      if (!this._probe) {
        this._probe = document.createElement('canvas');
        this._probe.width = 1;
        this._probe.height = 1;
        this._probeCtx = this._probe.getContext('2d', { willReadFrequently: true });
      }
      // 整帧缩到 1×1，浏览器会做区域平均，等于免费的亮度采样
      this._probeCtx.drawImage(video, 0, 0, 1, 1);
      const d = this._probeCtx.getImageData(0, 0, 1, 1).data;
      const lum = (0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]) / 255;
      // 0.42 当作中性亮度：比它暗就压，比它亮就提（提亮上限很小，避免过曝）
      this._amb = Math.max(-0.34, Math.min(0.12, (lum - 0.42) * 0.62));
    } catch (_) {
      this._amb = 0;
    }
    return this._amb;
  }

  /** 衣服下摆投在身上的接触阴影。 */
  _contactShadow(ctx, geo) {
    const h = Math.max(1, geo.botY - geo.topY);
    const g = ctx.createLinearGradient(0, geo.botY - h * 0.04, 0, geo.botY + h * 0.10);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.35, 'rgba(0,0,0,0.26)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(geo.cx - geo.maxHalf * 1.02, geo.botY - h * 0.04, geo.maxHalf * 2.04, h * 0.16);
    ctx.restore();
  }

  /**
   * 遮挡还原：手臂压在躯干前面时，衣服不该盖在手臂上。
   * 用 BlazePose 的 z 判断前后（z 越小越靠近镜头），再把视频帧沿手臂区域贴回去。
   */
  _occlude(video, norm, px, py, W, H, mirror) {
    if (!video || !video.videoWidth || video.readyState < 2) return;
    const baseZ = norm[23] && norm[23].z !== undefined ? norm[23].z : 0;
    const ctx = this.ctx;

    for (const [a, b] of [[11, 13], [12, 14], [13, 15], [14, 16]]) {
      if (!norm[a] || !norm[b]) continue;
      const za = norm[a].z;
      const zb = norm[b].z;
      if (za === undefined || zb === undefined) continue;
      // 两端都比髋部更靠近镜头，才认为这条手臂挡在身前
      if (Math.max(za, zb) > baseZ - 0.10) continue;

      const A = { x: px(norm[a].x), y: py(norm[a].y) };
      const B = { x: px(norm[b].x), y: py(norm[b].y) };
      const len = Math.hypot(B.x - A.x, B.y - A.y);
      if (len < 8) continue;
      const r = Math.max(6, len * 0.27);

      ctx.save();
      capsulePath(ctx, A, B, r);
      ctx.clip();
      if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, 0, 0, W, H);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- AI 精修

  /** 生成躯干遮罩：白色 = 交给模型重绘的区域，边缘羽化避免出现硬缝。 */
  buildMask(W, H) {
    const geo = this.lastGeo;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const c = cv.getContext('2d');
    if (!geo) return cv;
    c.fillStyle = '#000';
    c.fillRect(0, 0, W, H);

    const GX = 6;
    const GY = 12;
    const path = () => {
      c.beginPath();
      for (let i = 0; i <= GX; i++) {
        const p = geo.at(i / GX, 0);
        if (i === 0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y);
      }
      for (let j = 1; j <= GY; j++) {
        const p = geo.at(1, j / GY);
        c.lineTo(p.x, p.y);
      }
      for (let i = GX - 1; i >= 0; i--) {
        const p = geo.at(i / GX, 1);
        c.lineTo(p.x, p.y);
      }
      for (let j = GY - 1; j >= 1; j--) {
        const p = geo.at(0, j / GY);
        c.lineTo(p.x, p.y);
      }
      c.closePath();
    };

    c.fillStyle = '#fff';
    try { c.filter = 'blur(5px)'; } catch (_) {}
    path();
    c.fill();
    c.filter = 'none';
    return cv;
  }

  /**
   * 把「重绘后的画面」烘焙回衣服贴图。
   *
   * 重绘结果是在画布坐标里的，直接当贴图用会跟着人一起漂。这里把每个网格单元
   * 反向采样一遍（目标三角 → 源矩形，也就是把 mapTri 的 s/d 对调），得到一张
   * 和原来 UV 空间对齐的新贴图，实时追踪就能继续用。
   * 最后用原始衣服的 alpha 剪一遍，避免把脖子、背景也烘进贴图。
   */
  applyRefined(src) {
    const geo = this.lastGeo;
    const base = this.baseGarment || this.garment;
    if (!geo || !base) return false;
    const sw = base.width;
    const sh = base.height;
    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    const o = out.getContext('2d');

    const GX = 6;
    const GY = 12;
    for (let gy = 0; gy < GY; gy++) {
      for (let gx = 0; gx < GX; gx++) {
        const u0 = gx / GX;
        const u1 = (gx + 1) / GX;
        const v0 = gy / GY;
        const v1 = (gy + 1) / GY;
        const s0 = u0 * sw;
        const s1 = u1 * sw;
        const t0 = v0 * sh;
        const t1 = v1 * sh;
        const p00 = geo.at(u0, v0);
        const p10 = geo.at(u1, v0);
        const p11 = geo.at(u1, v1);
        const p01 = geo.at(u0, v1);
        mapTri(o, src, [p00.x, p00.y, p10.x, p10.y, p11.x, p11.y], [s0, t0, s1, t0, s1, t1]);
        mapTri(o, src, [p00.x, p00.y, p11.x, p11.y, p01.x, p01.y], [s0, t0, s1, t1, s0, t1]);
      }
    }

    o.globalCompositeOperation = 'destination-in';
    o.drawImage(base, 0, 0, sw, sh);

    this.garment = out;
    this._syncColor();
    return true;
  }

  _backdrop(ctx, W, H, t) {
    ctx.fillStyle = '#04080d';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.strokeStyle = 'rgba(34,211,238,0.07)';
    ctx.lineWidth = 1;
    const step = H * 0.06;
    for (let y = 0; y < H; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    const ph = (t * 0.28) % 1;
    const g = ctx.createLinearGradient(0, ph * H, 0, (ph + 0.22) * H);
    g.addColorStop(0, 'rgba(34,211,238,0)');
    g.addColorStop(0.5, 'rgba(34,211,238,0.10)');
    g.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, ph * H, W, 0.22 * H);
    ctx.restore();
  }
}
