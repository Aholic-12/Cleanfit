// 演示模式：无摄像头时用一段合成姿态驱动人像，方便展示与自测
// 坐标约定与 BlazePose 世界坐标一致：x 向右、y 向下、z 越负越靠近相机，单位米

const N = 33;

function pt(x, y, z) {
  return { x, y, z, visibility: 0.99 };
}

export function mockPose(t) {
  const P = new Array(N);
  const bob = Math.sin(t * 1.6) * 0.009;
  const sway = Math.sin(t * 0.55) * 0.014;
  const armL = Math.sin(t * 1.05) * 0.17;
  const armR = Math.sin(t * 1.05 + 0.55) * 0.17;
  const headTurn = Math.sin(t * 0.42) * 0.02;

  const y0 = bob;

  // 头部
  P[0] = pt(0.0 + headTurn, -0.600 + y0, -0.02);           // 鼻
  P[1] = pt(0.018 + headTurn, -0.622 + y0, -0.03);
  P[2] = pt(0.030 + headTurn, -0.626 + y0, -0.03);
  P[3] = pt(0.042 + headTurn, -0.622 + y0, -0.02);
  P[4] = pt(-0.018 + headTurn, -0.622 + y0, -0.03);
  P[5] = pt(-0.030 + headTurn, -0.626 + y0, -0.03);
  P[6] = pt(-0.042 + headTurn, -0.622 + y0, -0.02);
  P[7] = pt(0.072 + headTurn, -0.625 + y0, 0.0);           // 左耳
  P[8] = pt(-0.072 + headTurn, -0.625 + y0, 0.0);          // 右耳
  P[9] = pt(0.022 + headTurn, -0.572 + y0, -0.03);
  P[10] = pt(-0.022 + headTurn, -0.572 + y0, -0.03);

  // 肩 / 胯
  const sx = 0.162, hx = 0.088;
  P[11] = pt(sx + sway, -0.495 + y0, 0.0);
  P[12] = pt(-sx + sway, -0.495 + y0, 0.0);
  P[23] = pt(hx + sway * 0.4, 0.0 + y0, 0.0);
  P[24] = pt(-hx + sway * 0.4, 0.0 + y0, 0.0);

  // 手臂（前后摆动，靠 z 体现）
  P[13] = pt(sx + 0.028 + sway, -0.245 + y0, 0.012 + armL);
  P[14] = pt(-sx - 0.028 + sway, -0.245 + y0, 0.012 + armR);
  P[15] = pt(sx + 0.038 + sway, 0.008 + y0, 0.02 + armL * 1.5);
  P[16] = pt(-sx - 0.038 + sway, 0.008 + y0, 0.02 + armR * 1.5);

  // 手：掌 + 三根指线
  const hand = (base, sgn, dz) => {
    const [wx, wy, wz] = base;
    P[sgn > 0 ? 17 : 18] = pt(wx + 0.02, wy + 0.045, wz + dz);
    P[sgn > 0 ? 19 : 20] = pt(wx + 0.012, wy + 0.062, wz + dz);
    P[sgn > 0 ? 21 : 22] = pt(wx - 0.006, wy + 0.036, wz + dz);
  };
  hand([P[15].x, P[15].y, P[15].z], 1, 0.004);
  hand([P[16].x, P[16].y, P[16].z], -1, 0.004);

  // 腿
  P[25] = pt(hx + 0.012 + sway * 0.3, 0.435 + y0, 0.006);
  P[26] = pt(-hx - 0.012 + sway * 0.3, 0.435 + y0, 0.006);
  P[27] = pt(hx + 0.005 + sway * 0.2, 0.835 + y0, 0.0);
  P[28] = pt(-hx - 0.005 + sway * 0.2, 0.835 + y0, 0.0);
  P[29] = pt(hx + 0.005 + sway * 0.2, 0.868 + y0, 0.055);
  P[30] = pt(-hx - 0.005 + sway * 0.2, 0.868 + y0, 0.055);
  P[31] = pt(hx + 0.005 + sway * 0.2, 0.876 + y0, -0.095);
  P[32] = pt(-hx - 0.005 + sway * 0.2, 0.876 + y0, -0.095);

  return P;
}

// 把世界坐标粗略投影回归一化画面坐标，供叠加层绘制
export function projectToNorm(P) {
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const p = P[i];
    out[i] = {
      x: 0.5 + p.x * 0.78,
      y: 0.5 + p.y * 0.46,
      z: p.z,
      visibility: 0.99,
    };
  }
  return out;
}
