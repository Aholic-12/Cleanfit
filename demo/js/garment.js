// 衣服图片预处理：抠白底 + 裁掉透明边 + 铺底色，返回可直接当贴图用的 canvas

const HI = 246;   // 亮度 ≥ 此值 → 完全透明
const LO = 228;   // 此值到 HI 之间 → 线性羽化，避免边缘锯齿

function alphaBBox(px, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (px[row + x * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * 只抠「和图片边缘连通的白色」，不能按全局亮度一刀切。
 * 一刀切会把衣服印花里的白（白底 logo、白色条纹）一起抠成透明，
 * 贴到身上就是一个个露肉的洞。这里用从四边出发的洪水填充，只吃背景。
 */
function keyWhiteBackground(px, w, h) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;

  const whiteish = (i) => {
    const o = i * 4;
    return Math.min(px[o], px[o + 1], px[o + 2]) >= LO;
  };
  const push = (i) => {
    if (seen[i] || !whiteish(i)) return;
    seen[i] = 1;
    queue[tail++] = i;
  };

  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }

  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }

  for (let i = 0; i < n; i++) {
    if (!seen[i]) continue;
    const o = i * 4;
    const m = Math.min(px[o], px[o + 1], px[o + 2]);
    px[o + 3] = m >= HI ? 0 : Math.round((px[o + 3] * (HI - m)) / (HI - LO));
  }
}

/**
 * 取图片里非透明像素的平均色，用来给袖子配一个同色系的纯色。
 * 纯色 T 恤能取到准确的底色，印花 T 恤会得到偏中性的混合色，够用了。
 */
export function averageColor(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 40) continue;
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
    n++;
  }
  if (!n) return 0xffffff;
  return (((r / n) | 0) << 16) | (((g / n) | 0) << 8) | ((b / n) | 0);
}

// 把透明区铺成衣服底色：贴图要整圈包住躯干，边缘留透明会在身体两侧露出肉色竖条
function flattenOnBase(canvas, color) {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

/** 把上传的图片转成适合贴到躯干上的 canvas（可选抠白底 + 裁边 + 铺底色）。 */
export function prepareGarmentCanvas(img, { removeWhite = true, flatten = true } = {}) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  let cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  if (removeWhite) {
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    keyWhiteBackground(px, w, h);
    ctx.putImageData(data, 0, 0);

    // 商品图常常四周留大片白边，裁掉后衣服才能真正铺满躯干
    const box = alphaBBox(px, w, h);
    if (box && (box.w < w * 0.98 || box.h < h * 0.98)) {
      const out = document.createElement('canvas');
      out.width = box.w;
      out.height = box.h;
      out.getContext('2d').drawImage(cv, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      cv = out;
    }
  }

  if (flatten) cv = flattenOnBase(cv, averageColor(cv));
  return cv;
}
