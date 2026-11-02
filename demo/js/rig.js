// 全息人像渲染层：把 BlazePose 的 33 点世界坐标（米）映射成一具「全息投影」人体
//
// 视觉参考：钢铁侠电影里 J.A.R.V.I.S / Friday 的全息台——半透明青蓝色人体、
// 边缘菲涅尔辉光、水平扫描线、轻微闪烁，配合发光的骨架线（X 光扫描感）。
// 衣服不在这里，衣服是「AD 渲染」单独开一个窗口实时贴到真实人物身上的
// （见 fitting.js）。这里只负责一个干净的全息人体。
import * as THREE from '../vendor/three.module.js';

const UP = new THREE.Vector3(0, 1, 0);
const N = 33;
const LERP = (a, b, t) => a + (b - a) * t;
const SMOOTH = (t) => t * t * (3 - 2 * t);

// 骨架连线（BlazePose 索引）—— 2D 叠加层也在用，必须导出
export const BONES = [
  // 躯干
  [11, 12], [11, 23], [12, 24], [23, 24],
  // 上臂 / 前臂
  [11, 13], [13, 15], [12, 14], [14, 16],
  // 手（掌 + 三根指线）
  [15, 17], [15, 19], [15, 21], [16, 18], [16, 20], [16, 22],
  // 左腿
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  // 右腿
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
  // 头颈
  [0, 7], [0, 8], [7, 8], [11, 0], [12, 0],
];

// 骨架叠加层的关节点
const SKEL_JOINTS = {
  0: 1.0, 7: 0.62, 8: 0.62,
  11: 1.0, 12: 1.0, 13: 0.66, 14: 0.66, 15: 0.55, 16: 0.55,
  17: 0.36, 18: 0.36, 19: 0.36, 20: 0.36, 21: 0.36, 22: 0.36,
  23: 1.0, 24: 1.0, 25: 0.7, 26: 0.7, 27: 0.55, 28: 0.55,
  29: 0.48, 30: 0.48, 31: 0.34, 32: 0.34,
};

// 四肢：r0 在近端（靠躯干），r1 在远端。半径单位米，写死成人体比例。
const LIMBS = [
  { a: 11, b: 13, r0: 0.052, r1: 0.041 },   // 左上臂
  { a: 13, b: 15, r0: 0.041, r1: 0.029 },   // 左前臂
  { a: 12, b: 14, r0: 0.052, r1: 0.041 },   // 右上臂
  { a: 14, b: 16, r0: 0.041, r1: 0.029 },   // 右前臂
  { a: 23, b: 25, r0: 0.082, r1: 0.055 },   // 左大腿
  { a: 25, b: 27, r0: 0.055, r1: 0.034 },   // 左小腿
  { a: 24, b: 26, r0: 0.082, r1: 0.055 },   // 右大腿
  { a: 26, b: 28, r0: 0.055, r1: 0.034 },   // 右小腿
];

// 实体层的关节球，用来填掉圆柱接缝，同时充当三角肌 / 髋部这些肉感部位
// 肩球半径按盂肱关节算：它挂在肩峰内侧，球心 + 半径刚好和躯干肩宽齐平
const JOINT_BALLS = [
  { i: 11, r: 0.050 }, { i: 12, r: 0.050 },   // 肩（三角肌）
  { i: 13, r: 0.040 }, { i: 14, r: 0.040 },   // 肘
  { i: 15, r: 0.029 }, { i: 16, r: 0.029 },   // 腕
  { i: 23, r: 0.080 }, { i: 24, r: 0.080 },   // 髋
  { i: 25, r: 0.053 }, { i: 26, r: 0.053 },   // 膝
  { i: 27, r: 0.034 }, { i: 28, r: 0.034 },   // 踝
];

// 手：腕 → 食指，用椭球近似
const HANDS = [
  { wrist: 15, tip: 19, flip: 1 },
  { wrist: 16, tip: 20, flip: 1 },
];

// 脚：踝 → 脚尖
const FEET = [
  { ankle: 27, toe: 31 },
  { ankle: 28, toe: 32 },
];

// 躯干横向半宽随高度变化：t=0 在肩线，t=1 在胯，t<0 表示肩线以上（颈根）。
// 肩线以上必须快速收窄成脖子，否则躯干顶部是个平顶，看起来像块板子。
function torsoHalfWidth(t, w) {
  if (t < 0) {
    const u = SMOOTH(Math.min(1, -t / 0.26));
    return LERP(w.shoulder * 0.9, w.neck, u);
  }
  if (t <= 0.55) {
    const u = SMOOTH(t / 0.55);
    return LERP(w.shoulder * 0.9, w.waist * 0.94, u);
  }
  const u = SMOOTH(Math.min(1, (t - 0.55) / 0.45));
  return LERP(w.waist * 0.94, w.hip * 0.98, u);
}

// 前后厚度也跟着高度变：胸腔厚、腰细、胯略厚
function torsoDepthRatio(t) {
  if (t < 0) return LERP(0.68, 0.72, Math.min(1, -t / 0.26));
  if (t <= 0.55) return LERP(0.68, 0.58, SMOOTH(t / 0.55));
  return LERP(0.58, 0.64, SMOOTH(Math.min(1, (t - 0.55) / 0.45)));
}

// ---------------------------------------------------------------- 全息材质
//
// 不用 Three 自带的受光材质，自己写一段 shader 做出「全息投影」质感：
//   · 半透明，整体偏青蓝
//   · 菲涅尔边缘辉光（edge glow）：越靠近轮廓越亮，像能量壳
//   · 水平扫描线（scanline）：随时间从下往上扫，营造电子感
//   · 轻微闪烁（flicker）：模拟投影不稳定
// depthWrite 关掉，让多层半透明叠出通透的体积感，而不是互相遮挡。
const HOLO_VERT = `
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const HOLO_FRAG = `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vWorld;
  void main() {
    // 镜像（rig.scale.x = -1）会让法线翻面，菲涅尔取绝对值，边缘对称不受影响
    float ndv = abs(dot(normalize(vN), normalize(vView)));
    float fres = pow(1.0 - ndv, 2.2);

    // 水平扫描线：世界 Y 方向的正弦，随时间向上扫
    float scan = 0.5 + 0.5 * sin(vWorld.y * 34.0 - uTime * 2.2);
    scan = smoothstep(0.5, 1.0, scan);

    // 整体闪烁
    float flick = 0.92 + 0.08 * sin(uTime * 8.0 + vWorld.y * 12.0);

    float a = (0.14 + fres * 0.78 + scan * 0.10) * flick;
    a = clamp(a, 0.0, 0.95);

    vec3 col = uColor * (0.55 + fres * 1.7 + scan * 0.35);
    gl_FragColor = vec4(col, a);
  }
`;

export class HoloScene {
  constructor(container) {
    this.el = container;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.el.appendChild(this.renderer.domElement);

    // 视角：球坐标，可拖拽旋转 / 滚轮缩放
    this.orbit = { theta: 0, phi: 1.47, dist: 2.62, drag: false, lx: 0, ly: 0 };
    this._bindOrbit();

    this.rig = new THREE.Group();
    this.scene.add(this.rig);

    // 复用向量，避免每帧 new
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._shMid = new THREE.Vector3();
    this._hpMid = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._basis = new THREE.Matrix4();
    this._q = new THREE.Quaternion();

    // 肩关节锚点（11/12）：从肩峰往身体中线内侧挪，上臂都挂在这儿
    this._armRoot = {};
    this._frameOk = false;
    this.mirrored = false;

    this._buildLights();
    this._buildBody();
    this._buildSkeleton();
    this._buildStage();

    // 每个关节的平滑缓存
    this.smooth = new Array(N).fill(null).map(() => new THREE.Vector3());
    this.inited = new Array(N).fill(false);
    this.hasPoint = new Array(N).fill(false);
    this.presence = 0;
    this.footY = -0.95;

    this._clock = new THREE.Clock();
    this.resize();
  }

  // ---------- 光照 ----------
  // 全息不靠真实光照（shader 自发光），但天光给舞台一点氛围；主光/轮廓光其实
  // 对 shader 材质无效，这里只留一盏很弱的暖光点缀骨架层的高光，避免死黑。
  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x9fe8ff, 0x0a1418, 0.5));
    const rim = new THREE.DirectionalLight(0x2fd4f0, 1.0);
    rim.position.set(-2.4, 1.4, -2.2);
    this.scene.add(rim);
  }

  // ---------- 全息人体 ----------
  _buildBody() {
    this.holoUniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x3fd8f2) },
    };
    this.skinMat = new THREE.ShaderMaterial({
      uniforms: this.holoUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: HOLO_VERT,
      fragmentShader: HOLO_FRAG,
    });

    this.sphereGeo = new THREE.SphereGeometry(1, 16, 12);

    // 躯干：环状网格，半径逐层变化，才能做出肩宽 → 腰窄 → 胯宽的锥度
    this.torsoSeg = 16;
    this.torsoRings = 13;
    const vCount = this.torsoRings * this.torsoSeg + 2;   // +2 是上下封盖中心
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vCount * 3), 3));

    const idx = [];
    for (let r = 0; r < this.torsoRings - 1; r++) {
      for (let s = 0; s < this.torsoSeg; s++) {
        const s2 = (s + 1) % this.torsoSeg;
        const a = r * this.torsoSeg + s;
        const b = r * this.torsoSeg + s2;
        const c = (r + 1) * this.torsoSeg + s;
        const d = (r + 1) * this.torsoSeg + s2;
        idx.push(a, c, b, b, c, d);
      }
    }
    const topC = this.torsoRings * this.torsoSeg;
    const botC = topC + 1;
    for (let s = 0; s < this.torsoSeg; s++) {
      const s2 = (s + 1) % this.torsoSeg;
      idx.push(topC, s2, s);
      const base = (this.torsoRings - 1) * this.torsoSeg;
      idx.push(botC, base + s, base + s2);
    }
    tg.setIndex(idx);

    this.torsoGroup = new THREE.Group();
    this.rig.add(this.torsoGroup);

    this.torso = new THREE.Mesh(tg, this.skinMat);
    this.torsoGroup.add(this.torso);

    this._ringAng = [];
    for (let s = 0; s < this.torsoSeg; s++) this._ringAng.push((s / this.torsoSeg) * Math.PI * 2);

    // 四肢：每段单独建几何，把 r0 / r1 烘进去，之后只缩放 y 到实际长度
    this.limbs = LIMBS.map((L) => {
      const g = new THREE.CylinderGeometry(L.r1, L.r0, 1, 10, 1);
      const m = new THREE.Mesh(g, this.skinMat);
      this.rig.add(m);
      return { ...L, mesh: m };
    });

    // 关节球
    this.jointBalls = JOINT_BALLS.map((J) => {
      const m = new THREE.Mesh(this.sphereGeo, this.skinMat);
      m.scale.setScalar(J.r);
      this.rig.add(m);
      return { ...J, mesh: m };
    });

    // 头：椭球 + 一点五官提示。没有五官时球体从背后看和正面一模一样，
    // 人分不清人物朝向；加两个眼窝和一个鼻凸，正面一眼就能认出来。
    // 全息下眼睛是发光亮点，而不是深色凹陷。
    this.headGroup = new THREE.Group();
    this.rig.add(this.headGroup);

    this.head = new THREE.Mesh(this.sphereGeo, this.skinMat);
    this.head.scale.set(0.086, 0.110, 0.100);   // 17.2 × 22 × 20 cm，接近成人头围
    this.headGroup.add(this.head);

    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xbff6ff });
    this.eyes = [-1, 1].map((s) => {
      const m = new THREE.Mesh(this.sphereGeo, this.eyeMat);
      m.scale.set(0.0085, 0.0075, 0.006);   // 全息下是小亮点，别做成两颗大眼球
      m.position.set(s * 0.028, 0.013, 0.090);
      this.headGroup.add(m);
      return m;
    });

    this.noseMesh = new THREE.Mesh(this.sphereGeo, this.skinMat);
    this.noseMesh.scale.set(0.012, 0.019, 0.015);
    this.noseMesh.position.set(0, -0.008, 0.094);
    this.headGroup.add(this.noseMesh);

    // 脖子
    this.neck = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1), this.skinMat);
    this.rig.add(this.neck);

    // 手
    this.hands = HANDS.map((H) => {
      const m = new THREE.Mesh(this.sphereGeo, this.skinMat);
      this.rig.add(m);
      return { ...H, mesh: m };
    });

    // 脚
    this.feet = FEET.map((F) => {
      const m = new THREE.Mesh(this.sphereGeo, this.skinMat);
      this.rig.add(m);
      return { ...F, mesh: m };
    });

    this.rig.visible = false;
  }

  // ---------- 骨架叠加层 ----------

  _buildSkeleton() {
    this.skeleton = new THREE.Group();
    this.skeleton.renderOrder = 20;
    this.rig.add(this.skeleton);

    // depthTest=false 让骨线透过实体显示，形成 X 光扫描感；加法混合做出辉光
    const common = { transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending };
    this.skelJointMat = new THREE.MeshBasicMaterial({ color: 0xd8f8ff, opacity: 0.14, ...common });
    this.skelBoneMat = new THREE.MeshBasicMaterial({ color: 0x6fe4f7, opacity: 0.09, ...common });

    const cyl = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);

    this.skelJoints = new Map();
    for (const [idxStr, scale] of Object.entries(SKEL_JOINTS)) {
      const idx = Number(idxStr);
      const r = 0.013 * scale;
      const m = new THREE.Mesh(this.sphereGeo, this.skelJointMat);
      m.scale.setScalar(r);
      m.renderOrder = 21;
      this.skeleton.add(m);
      this.skelJoints.set(idx, { mesh: m, r });
    }

    this.skelBones = BONES.map(([a, b]) => {
      const m = new THREE.Mesh(cyl, this.skelBoneMat);
      m.renderOrder = 20;
      this.skeleton.add(m);
      return { a, b, mesh: m };
    });

    this.skeleton.visible = true;
  }

  setSkeletonVisible(v) {
    this.skeleton.visible = !!v;
  }

  // ---------- 舞台 ----------

  _buildStage() {
    const stage = new THREE.Group();
    this.scene.add(stage);
    this.stage = stage;

    // 地面网格
    this.grid = new THREE.GridHelper(9, 36, 0x1e6b80, 0x0d3543);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.5;
    stage.add(this.grid);

    // 同心环
    const ring = (radius, seg, color, opacity) => {
      const pts = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    };
    stage.add(ring(0.55, 64, 0x22d3ee, 0.5));
    stage.add(ring(1.05, 96, 0x22d3ee, 0.22));

    // 刻度环（缓慢旋转）
    const ticks = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const r0 = i % 4 === 0 ? 1.14 : 1.18;
      ticks.push(
        new THREE.Vector3(Math.cos(a) * r0, 0, Math.sin(a) * r0),
        new THREE.Vector3(Math.cos(a) * 1.26, 0, Math.sin(a) * 1.26),
      );
    }
    const tg = new THREE.BufferGeometry().setFromPoints(ticks);
    this.ticks = new THREE.LineSegments(
      tg, new THREE.LineBasicMaterial({ color: 0x2aa6bd, transparent: true, opacity: 0.4 }),
    );
    stage.add(this.ticks);

    // 脉冲扫描环
    this.pulse = ring(1, 96, 0x7ff3ff, 0.6);
    stage.add(this.pulse);

    // 背景粒子
    const pcount = 260;
    const pos = new Float32Array(pcount * 3);
    for (let i = 0; i < pcount; i++) {
      const r = 3.2 + Math.random() * 4.5;
      const a = Math.random() * Math.PI * 2;
      const h = (Math.random() - 0.45) * 6;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = h;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      pg,
      new THREE.PointsMaterial({
        color: 0x2aa6bd, size: 0.02, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    stage.add(this.dust);
  }

  _bindOrbit() {
    const el = this.renderer.domElement;
    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', (e) => {
      this.orbit.drag = true;
      this.orbit.lx = e.clientX;
      this.orbit.ly = e.clientY;
      el.style.cursor = 'grabbing';
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.orbit.drag) return;
      this.orbit.theta -= (e.clientX - this.orbit.lx) * 0.007;
      this.orbit.phi = Math.max(0.75, Math.min(2.0, this.orbit.phi - (e.clientY - this.orbit.ly) * 0.005));
      this.orbit.lx = e.clientX;
      this.orbit.ly = e.clientY;
    });
    el.addEventListener('pointerup', (e) => {
      this.orbit.drag = false;
      el.style.cursor = 'grab';
      el.releasePointerCapture(e.pointerId);
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbit.dist = Math.max(1.8, Math.min(7, this.orbit.dist + e.deltaY * 0.0022));
    }, { passive: false });
  }

  setMirror(on) {
    this.mirrored = !!on;
    this.rig.scale.x = on ? -1 : 1;
  }

  // ---------- 各部位更新 ----------

  /** 躯干半宽。有测量数据就用实测，否则按肩峰距推一个比例。 */
  _bodyWidths(metrics) {
    if (metrics && metrics.shoulder > 40 && metrics.hip > 40) {
      return {
        shoulder: metrics.shoulder / 200,
        waist: (metrics.waist || metrics.shoulder * 0.8) / 200,
        hip: metrics.hip / 200,
        neck: 0.062,
      };
    }
    // 没有实测数据时按肩峰距推：躯干略窄于肩峰，剩下的交给三角肌去撑
    const span = this.smooth[11].distanceTo(this.smooth[12]);
    const shoulder = span * 0.53;
    return { shoulder, waist: shoulder * 0.8, hip: shoulder * 0.94, neck: 0.062 };
  }

  _seg(mesh, A, B, radiusScale = 1) {
    const D = this._d.subVectors(B, A);
    const len = D.length();
    if (len < 1e-4) {
      mesh.visible = false;
      return false;
    }
    mesh.position.copy(A).addScaledVector(D, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, D.normalize());
    mesh.scale.set(radiusScale, len, radiusScale);
    mesh.visible = true;
    return true;
  }

  _updateLimbs() {
    for (const L of this.limbs) {
      const ok = this.hasPoint[L.a] && this.hasPoint[L.b];
      if (!ok) {
        L.mesh.visible = false;
        continue;
      }
      // 几何已经把 r0/r1 烘进去了，这里只把 y 缩放到实际骨长
      const root = this._armRoot[L.a];
      const A = this._a.copy(root && this._frameOk ? root : this.smooth[L.a]);
      const B = this._b.copy(this.smooth[L.b]);
      const D = this._d.subVectors(B, A);
      const len = D.length();
      if (len < 1e-4) {
        L.mesh.visible = false;
        continue;
      }
      L.mesh.position.copy(A).addScaledVector(D, 0.5);
      L.mesh.quaternion.setFromUnitVectors(UP, D.normalize());
      L.mesh.scale.set(1, len, 1);
      L.mesh.visible = true;
    }

    for (const J of this.jointBalls) {
      J.mesh.visible = this.hasPoint[J.i];
      if (!J.mesh.visible) continue;
      const root = this._armRoot[J.i];
      J.mesh.position.copy(root && this._frameOk ? root : this.smooth[J.i]);
    }
  }

  _updateHeadNeck(metrics) {
    const hasNose = this.hasPoint[0];
    this.headGroup.visible = hasNose;
    this.neck.visible = false;

    if (!hasNose) return;

    // 头围跟身高走（以 165cm 为基准），否则高个子会顶个小头
    const k = metrics && metrics.height > 100
      ? Math.max(0.88, Math.min(1.16, metrics.height / 165))
      : 1;
    this.headGroup.scale.setScalar(k);

    const mid = this._a.copy(this.smooth[0]);
    if (this.hasPoint[7] && this.hasPoint[8]) {
      mid.add(this.smooth[7]).add(this.smooth[8]).multiplyScalar(1 / 3);
    }
    // 鼻尖大约在面部中段偏下，颅心还要往上挪一点，否则下巴会陷进锁骨
    mid.y += 0.008;
    this.headGroup.position.copy(mid);

    // 头部朝向跟随躯干，保证眼睛始终朝着人物正脸那侧
    if (this._frameOk) this.headGroup.quaternion.copy(this.torsoGroup.quaternion);

    if (this.hasPoint[11] && this.hasPoint[12]) {
      const shMid = this._shMid.addVectors(this.smooth[11], this.smooth[12]).multiplyScalar(0.5);
      const top = this._b.copy(mid);
      top.y -= 0.085;
      const bot = this._a.copy(shMid);
      bot.y += 0.012;
      this._seg(this.neck, bot, top, 0.050);
    }
  }

  _updateHandsFeet() {
    for (const H of this.hands) {
      const ok = this.hasPoint[H.wrist] && this.hasPoint[H.tip];
      H.mesh.visible = false;
      if (!ok) continue;
      const A = this._a.copy(this.smooth[H.wrist]);
      const B = this._b.copy(this.smooth[H.tip]);
      const D = this._d.subVectors(B, A);
      const len = D.length();
      if (len < 1e-4) continue;
      D.normalize();
      H.mesh.position.copy(A).addScaledVector(D, len * 0.55);
      H.mesh.quaternion.setFromUnitVectors(UP, D);
      H.mesh.scale.set(0.042, len * 0.62, 0.026);
      H.mesh.visible = true;
    }

    for (const F of this.feet) {
      const ok = this.hasPoint[F.ankle] && this.hasPoint[F.toe];
      F.mesh.visible = false;
      if (!ok) continue;
      const A = this._a.copy(this.smooth[F.ankle]);
      const B = this._b.copy(this.smooth[F.toe]);
      const D = this._d.subVectors(B, A);
      const len = D.length();
      if (len < 1e-4) continue;
      D.normalize();
      F.mesh.position.copy(A).addScaledVector(D, len * 0.5);
      F.mesh.quaternion.setFromUnitVectors(UP, D);
      F.mesh.scale.set(0.05, len * 0.62, 0.036);
      F.mesh.visible = true;
    }
  }

  _updateTorso(metrics) {
    const ok = this.hasPoint[11] && this.hasPoint[12] && this.hasPoint[23] && this.hasPoint[24];
    this.torso.visible = ok;
    this._frameOk = false;
    if (!ok) return;

    const shMid = this._shMid.addVectors(this.smooth[11], this.smooth[12]).multiplyScalar(0.5);
    const hpMid = this._hpMid.addVectors(this.smooth[23], this.smooth[24]).multiplyScalar(0.5);

    const up = this._up.subVectors(shMid, hpMid);
    const len = up.length();
    if (len < 1e-3) {
      this.torso.visible = false;
      return;
    }
    up.normalize();

    // 左右轴取「左肩 - 右肩」，这样 fwd = side × up 正好指向人物正前方；
    // 人转身时左右互换，骨架和躯干也会跟着转。
    const side = this._side.subVectors(this.smooth[11], this.smooth[12]);
    side.addScaledVector(up, -side.dot(up));
    if (side.lengthSq() < 1e-8) return;
    side.normalize();
    const fwd = this._fwd.crossVectors(side, up).normalize();

    // 肩关节：BlazePose 的肩点是肩峰（锁骨外端），真正的上臂转轴在它内侧约 4cm、
    // 略低一点。直接用肩峰当上臂起点，三角肌会往外鼓出一整圈，肩膀看起来像垫了护肩。
    const ARM_IN = 0.040;
    const ARM_DN = 0.030;
    for (const i of [11, 12]) {
      if (!this._armRoot[i]) this._armRoot[i] = new THREE.Vector3();
      const inward = i === 11 ? -ARM_IN : ARM_IN;
      this._armRoot[i]
        .copy(this.smooth[i])
        .addScaledVector(side, inward)
        .addScaledVector(up, -ARM_DN);
    }
    this._frameOk = true;

    this._basis.makeBasis(side, up, fwd);
    this.torsoGroup.quaternion.setFromRotationMatrix(this._basis);
    this.torsoGroup.position.addVectors(shMid, hpMid).multiplyScalar(0.5);

    const w = this._bodyWidths(metrics);
    const SEG = this.torsoSeg;
    const RINGS = this.torsoRings;
    const pa = this.torso.geometry.attributes.position;

    // 纵向范围要越过肩线，往上留出颈根和斜方肌的坡度
    const yTop = 0.5 * len + 0.10;
    const yBot = -0.5 * len - 0.015;

    for (let r = 0; r < RINGS; r++) {
      const u = r / (RINGS - 1);
      const y = LERP(yTop, yBot, u);
      const t = (0.5 * len - y) / len;      // 肩线以上是负值
      const hw = torsoHalfWidth(t, w);
      const hd = hw * torsoDepthRatio(t);
      const base = r * SEG;
      for (let s = 0; s < SEG; s++) {
        const ang = this._ringAng[s];
        pa.setXYZ(base + s, Math.sin(ang) * hw, y, Math.cos(ang) * hd);
      }
    }
    pa.setXYZ(RINGS * SEG, 0, yTop, 0);
    pa.setXYZ(RINGS * SEG + 1, 0, yBot, 0);
    pa.needsUpdate = true;
    this.torso.geometry.computeVertexNormals();
  }

  _updateSkeleton() {
    for (const [idx, j] of this.skelJoints) {
      j.mesh.visible = this.hasPoint[idx];
      if (j.mesh.visible) j.mesh.position.copy(this.smooth[idx]);
    }
    const A = this._a;
    const B = this._b;
    const D = this._d;
    for (const b of this.skelBones) {
      const ok = this.hasPoint[b.a] && this.hasPoint[b.b];
      b.mesh.visible = ok;
      if (!ok) continue;
      A.copy(this.smooth[b.a]);
      B.copy(this.smooth[b.b]);
      D.subVectors(B, A);
      const len = D.length();
      if (len < 1e-4) {
        b.mesh.visible = false;
        continue;
      }
      b.mesh.position.copy(A).addScaledVector(D, 0.5);
      b.mesh.quaternion.setFromUnitVectors(UP, D.normalize());
      b.mesh.scale.set(0.007, len, 0.007);
    }
  }

  // ---------- 每帧更新 ----------

  update(world, dt, metrics) {
    const o = this.orbit;
    const sph = Math.sin(o.phi);
    this.camera.position.set(
      o.dist * sph * Math.sin(o.theta),
      o.dist * Math.cos(o.phi),
      o.dist * sph * Math.cos(o.theta),
    );
    this.camera.lookAt(0, 0.05, 0);

    const live = world && world.length === N;
    this.presence += ((live ? 1 : 0) - this.presence) * Math.min(1, dt * 6);
    this.rig.visible = this.presence > 0.03;

    if (live) {
      // 世界坐标：x 右、y 下、z 越负越近 → three：x 右、y 上、z 朝观察者
      const k = Math.min(1, dt * 14);
      for (let i = 0; i < N; i++) {
        const p = world[i];
        const vis = p && (p.visibility === undefined ? 1 : p.visibility);
        const ok = vis > 0.28;
        this.hasPoint[i] = ok;
        if (!ok) continue;
        const tx = p.x;
        const ty = -p.y;
        const tz = -p.z;
        const v = this.smooth[i];
        if (!this.inited[i]) {
          v.set(tx, ty, tz);
          this.inited[i] = true;
        } else {
          v.x += (tx - v.x) * k;
          v.y += (ty - v.y) * k;
          v.z += (tz - v.z) * k;
        }
      }

      // 躯干先算：它给出肩关节锚点和朝向基，四肢 / 头都要用
      this._updateTorso(metrics);
      this._updateLimbs();
      this._updateHeadNeck(metrics);
      this._updateHandsFeet();
      this._updateSkeleton();

      // 脚底高度 → 地面跟随
      let foot = null;
      for (const i of [29, 30, 31, 32]) {
        if (this.hasPoint[i]) foot = foot === null ? this.smooth[i].y : Math.min(foot, this.smooth[i].y);
      }
      if (foot !== null) this.footY += (foot - this.footY) * Math.min(1, dt * 5);
    }

    this.stage.position.y = this.footY + 0.02;

    // 舞台动效 + 全息材质时间
    const t = this._clock.getElapsedTime();
    this.holoUniforms.uTime.value = t;
    this.ticks.rotation.y = t * 0.16;
    this.dust.rotation.y = t * 0.02;
    const ph = (t * 0.55) % 1;
    this.pulse.scale.setScalar(0.35 + ph * 1.5);
    this.pulse.material.opacity = 0.5 * (1 - ph) * (0.4 + this.presence * 0.6);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.el.clientWidth || 1;
    const h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
