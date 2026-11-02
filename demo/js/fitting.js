// AD 试衣渲染层：把上传的衣服图实时贴到「真实人物」身上（摄像头画面）
//
// 这是一个独立的窗口/视图，和右边的全息 3D 小人互不影响。
// 当前是「简单贴图」：用 BlazePose 的 2D 关键点（肩 11/12、胯 23/24）构造
// 一个躯干四边形，把衣服图用双线性网格变形铺上去。后续深度细节（布料褶皱、
// 光照匹配、遮挡、物理模拟）再在这个基础上加。
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

export class FittingView {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.garment = null;
    this.srcImg = null;
    this.removeWhite = true;
    this.scale = 1;
    this.showBones = true;
  }

  loadImage(img) {
    this.srcImg = img;
    // flatten:false —— 真实人物贴图要保留衣服的 alpha 轮廓（T 恤形状），
    // 铺底色会变成一个矩形块，贴上去不像衣服。
    this.garment = prepareGarmentCanvas(img, { removeWhite: this.removeWhite, flatten: false });
    this._syncColor();
    return { width: this.garment.width, height: this.garment.height };
  }

  setRemoveWhite(v) {
    this.removeWhite = !!v;
    if (this.srcImg) {
      this.garment = prepareGarmentCanvas(this.srcImg, { removeWhite: this.removeWhite, flatten: false });
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
      this._garment(ctx, norm, px, py);
    }
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

  _garment(ctx, norm, px, py) {
    const g = this.garment;
    const sw = g.width;
    const sh = g.height;

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

    const prof = (t) => {
      const y = topY + (botY - topY) * t;
      const half = t <= 0.55
        ? shHalf + (waHalf - shHalf) * (t / 0.55)
        : waHalf + (hpHalf - waHalf) * ((t - 0.55) / 0.45);
      return { l: cx - half, r: cx + half, y };
    };
    const at = (u, v) => {
      const p = prof(v);
      return { x: p.l + (p.r - p.l) * u, y: p.y };
    };

    const GX = 6;
    const GY = 12;
    const draw = () => {
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
          const p00 = at(u0, v0);
          const p10 = at(u1, v0);
          const p11 = at(u1, v1);
          const p01 = at(u0, v1);
          mapTri(ctx, g, [s0, t0, s1, t0, s1, t1], [p00.x, p00.y, p10.x, p10.y, p11.x, p11.y]);
          mapTri(ctx, g, [s0, t0, s1, t1, s0, t1], [p00.x, p00.y, p11.x, p11.y, p01.x, p01.y]);
        }
      }
    };

    // 能量描边：先画一遍带青蓝阴影的，衣服边缘会晕出一圈光，
    // 接近纳米战衣 / 共生体那种「附着在体表」的发光轮廓。
    ctx.save();
    ctx.shadowColor = 'rgba(34,211,238,0.85)';
    ctx.shadowBlur = Math.max(8, sh * 0.02);
    draw();
    ctx.restore();

    // 再画一遍正常层
    draw();

    // 袖子和领口：让衣服像「穿」在身上，而不是一张贴在胸口的贴纸
    this._sleeves(ctx, norm, px, py);
    this._collar(ctx, norm, px, py);
  }

  /** 两只短袖：沿上臂方向画一段粗管，带袖口暗边和上缘高光。 */
  _sleeves(ctx, norm, px, py) {
    const col = this.color || '#2a4a7a';
    for (const [a, b] of [[11, 13], [12, 14]]) {
      if (!norm[a] || !norm[b]) continue;
      const A = { x: px(norm[a].x), y: py(norm[a].y) };
      const B = { x: px(norm[b].x), y: py(norm[b].y) };
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const len = Math.hypot(dx, dy);
      if (len < 4) continue;

      const w = Math.max(10, len * 0.42);                 // 袖管直径 ≈ 上臂粗
      const end = { x: A.x + dx * 0.52, y: A.y + dy * 0.52 };   // 短袖到上臂一半
      const ux = dx / len;
      const uy = dy / len;
      const nxv = -uy;                                    // 垂直方向
      const nyv = ux;

      ctx.save();
      ctx.lineCap = 'round';
      // 袖管底色
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      // 袖口暗边
      ctx.strokeStyle = 'rgba(0,0,0,0.30)';
      ctx.lineWidth = w * 0.18;
      ctx.beginPath();
      ctx.moveTo(end.x - ux * w * 0.10, end.y - uy * w * 0.10);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      // 上缘高光
      ctx.strokeStyle = 'rgba(255,255,255,0.20)';
      ctx.lineWidth = w * 0.18;
      ctx.beginPath();
      ctx.moveTo(A.x + nxv * w * 0.26, A.y + nyv * w * 0.26);
      ctx.lineTo(end.x + nxv * w * 0.26, end.y + nyv * w * 0.26);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** 领口：脖子根部的开口阴影 + 一圈领边，让衣服上沿「包住」脖子。 */
  _collar(ctx, norm, px, py) {
    if (!norm[0] || !norm[11] || !norm[12]) return;
    const sx = (px(norm[11].x) + px(norm[12].x)) / 2;
    const sy = (py(norm[11].y) + py(norm[12].y)) / 2;
    const neckY = py(norm[0].y);
    const span = Math.abs(sy - neckY);
    if (span < 6) return;

    const cx = sx;
    const cy = sy - span * 0.16;                 // 肩线上方一点，脖子根部
    const rx = Math.abs(px(norm[11].x) - px(norm[12].x)) * 0.13;
    const ry = rx * 0.6;
    if (rx < 3) return;

    ctx.save();
    // 领口开口
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fill();
    // 领边
    ctx.strokeStyle = this.color || '#2a4a7a';
    ctx.lineWidth = Math.max(2, rx * 0.26);
    ctx.stroke();
    ctx.restore();
  }
}
