// 全息人像渲染层：把 BlazePose 的 33 点世界坐标（米）映射成一具可动的人形骨架
import * as THREE from '../vendor/three.module.js';

const UP = new THREE.Vector3(0, 1, 0);
const N = 33;

// 骨架连线（BlazePose 索引）
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

// 需要显示的关节点及其粗细系数
const JOINTS = {
  0: 1.0, 7: 0.62, 8: 0.62,
  11: 1.0, 12: 1.0, 13: 0.66, 14: 0.66, 15: 0.55, 16: 0.55,
  17: 0.36, 18: 0.36, 19: 0.36, 20: 0.36, 21: 0.36, 22: 0.36,
  23: 1.0, 24: 1.0, 25: 0.7, 26: 0.7, 27: 0.55, 28: 0.55,
  29: 0.48, 30: 0.48, 31: 0.34, 32: 0.34,
};

// 骨骼粗细：躯干粗、四肢细
function boneRadius(a, b) {
  const pair = `${Math.min(a, b)}-${Math.max(a, b)}`;
  if (['11-12', '11-23', '12-24', '23-24'].includes(pair)) return 0.036;
  if (['11-13', '12-14', '23-25', '24-26'].includes(pair)) return 0.028;
  if (['13-15', '14-16', '25-27', '26-28'].includes(pair)) return 0.022;
  if (['27-29', '28-30'].includes(pair)) return 0.018;
  return 0.010;
}

export class HoloScene {
  constructor(container) {
    this.el = container;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.el.appendChild(this.renderer.domElement);

    // 视角：球坐标，可拖拽旋转 / 滚轮缩放
    this.orbit = { theta: 0, phi: 1.47, dist: 3.1, drag: false, lx: 0, ly: 0 };
    this._bindOrbit();

    this.rig = new THREE.Group();
    this.scene.add(this.rig);

    this._buildRig();
    this._buildStage();

    // 每个关节的平滑缓存
    this.smooth = new Array(N).fill(null).map(() => new THREE.Vector3());
    this.inited = new Array(N).fill(false);
    this.hasPoint = new Array(N).fill(false);
    this._tmp = new THREE.Vector3();
    this.presence = 0;
    this.footY = -0.95;

    this._clock = new THREE.Clock();
    this.resize();
  }

  // ---------- 构建 ----------

  _buildRig() {
    this.jointMat = new THREE.MeshBasicMaterial({ color: 0xc8f8ff });
    this.jointGlowMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.boneMat = new THREE.MeshBasicMaterial({ color: 0x4fd8ea, transparent: true, opacity: 0.92 });
    this.boneGlowMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee, transparent: true, opacity: 0.10,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    const sphere = new THREE.SphereGeometry(1, 14, 10);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);

    // 关节
    this.joints = new Map();
    for (const [idxStr, scale] of Object.entries(JOINTS)) {
      const idx = Number(idxStr);
      const r = 0.026 * scale;
      const core = new THREE.Mesh(sphere, this.jointMat);
      core.scale.setScalar(r);
      const glow = new THREE.Mesh(sphere, this.jointGlowMat);
      glow.scale.setScalar(r * 2.4);
      const g = new THREE.Group();
      g.add(core, glow);
      this.rig.add(g);
      this.joints.set(idx, { group: g, r });
    }

    // 骨骼
    this.bones = BONES.map(([a, b]) => {
      const core = new THREE.Mesh(cyl, this.boneMat);
      const glow = new THREE.Mesh(cyl, this.boneGlowMat);
      const g = new THREE.Group();
      g.add(core, glow);
      this.rig.add(g);
      return { a, b, group: g, core, glow, r: boneRadius(a, b) };
    });

    // 头部球壳
    this.headMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee, wireframe: true, transparent: true, opacity: 0.22,
    });
    this.headFillMat = new THREE.MeshBasicMaterial({
      color: 0x0e7490, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.head = new THREE.Group();
    const hs = new THREE.SphereGeometry(0.108, 16, 12);
    this.head.add(new THREE.Mesh(hs, this.headMat), new THREE.Mesh(hs, this.headFillMat));
    this.rig.add(this.head);

    // 躯干面片：肩 - 腰 - 胯 六边形，比四边形更像人体
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
    tg.setIndex([0, 1, 2, 0, 2, 5, 5, 2, 3, 5, 3, 4]);
    this.torsoMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee, transparent: true, opacity: 0.09,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.torso = new THREE.Mesh(tg, this.torsoMat);
    this.rig.add(this.torso);

    this._wl = new THREE.Vector3();
    this._wr = new THREE.Vector3();

    this.rig.visible = false;
  }

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
    this.pulse.material.linewidth = 2;
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

  // ---------- 每帧更新 ----------

  update(world, dt) {
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
      const tmp = this._tmp;
      for (let i = 0; i < N; i++) {
        const p = world[i];
        const vis = p && (p.visibility === undefined ? 1 : p.visibility);
        const ok = vis > 0.28;
        this.hasPoint[i] = ok;
        if (!ok) continue;
        tmp.set(p.x, -p.y, -p.z);
        const v = this.smooth[i];
        if (!this.inited[i]) { v.copy(tmp); this.inited[i] = true; }
        else v.lerp(tmp, k);
      }

      // 关节
      for (const [idx, j] of this.joints) {
        j.group.visible = this.hasPoint[idx];
        if (j.group.visible) j.group.position.copy(this.smooth[idx]);
      }

      // 骨骼
      const A = new THREE.Vector3(), B = new THREE.Vector3(), D = new THREE.Vector3();
      for (const b of this.bones) {
        const ok = this.hasPoint[b.a] && this.hasPoint[b.b];
        b.group.visible = ok;
        if (!ok) continue;
        A.copy(this.smooth[b.a]);
        B.copy(this.smooth[b.b]);
        D.subVectors(B, A);
        const len = D.length();
        if (len < 1e-4) { b.group.visible = false; continue; }
        b.group.position.copy(A).addScaledVector(D, 0.5);
        b.group.quaternion.setFromUnitVectors(UP, D.normalize());
        b.core.scale.set(b.r, len, b.r);
        b.glow.scale.set(b.r * 2.6, len, b.r * 2.6);
      }

      // 头部球壳：鼻尖 + 双耳中点，再往上抬一点
      if (this.hasPoint[0]) {
        const nose = this.smooth[0];
        const mid = new THREE.Vector3().copy(nose);
        if (this.hasPoint[7] && this.hasPoint[8]) {
          mid.add(this.smooth[7]).add(this.smooth[8]).multiplyScalar(1 / 3);
        }
        this.head.position.copy(mid);
        this.head.visible = true;
      } else {
        this.head.visible = false;
      }

      // 躯干面片
      const tOk = this.hasPoint[11] && this.hasPoint[12] && this.hasPoint[23] && this.hasPoint[24];
      this.torso.visible = tOk;
      if (tOk) {
        const pa = this.torso.geometry.attributes.position;
        const wl = this._wl.lerpVectors(this.smooth[11], this.smooth[23], 0.55);
        const wr = this._wr.lerpVectors(this.smooth[12], this.smooth[24], 0.55);
        const cx = (wl.x + wr.x) / 2;
        wl.x = cx + (wl.x - cx) * 0.74;
        wr.x = cx + (wr.x - cx) * 0.74;
        pa.setXYZ(0, this.smooth[11].x, this.smooth[11].y, this.smooth[11].z);
        pa.setXYZ(1, this.smooth[12].x, this.smooth[12].y, this.smooth[12].z);
        pa.setXYZ(2, wr.x, wr.y, wr.z);
        pa.setXYZ(3, this.smooth[24].x, this.smooth[24].y, this.smooth[24].z);
        pa.setXYZ(4, this.smooth[23].x, this.smooth[23].y, this.smooth[23].z);
        pa.setXYZ(5, wl.x, wl.y, wl.z);
        pa.needsUpdate = true;
      }

      // 脚底高度 → 地面跟随
      let foot = null;
      for (const i of [29, 30, 31, 32]) {
        if (this.hasPoint[i]) foot = foot === null ? this.smooth[i].y : Math.min(foot, this.smooth[i].y);
      }
      if (foot !== null) this.footY += (foot - this.footY) * Math.min(1, dt * 5);
    } else {
      this.head.visible = false;
      this.torso.visible = false;
    }

    this.stage.position.y = this.footY + 0.02;

    // 舞台动效
    const t = this._clock.getElapsedTime();
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
