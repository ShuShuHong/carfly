/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// 粒子：白烟/扬尘/火花/喷气残雾。全部在世界坐标（不跟车走），THREE.Points + 自定义 shader，总量上限 2000。
import * as THREE from 'three';

const MAX = 2000;

export class Particles {
  constructor(scene) {
    this.n = 0;
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.max = new Float32Array(MAX);
    this.s0 = new Float32Array(MAX);
    this.s1 = new Float32Array(MAX);
    this.col = new Float32Array(MAX * 3);
    this.a0 = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.kind = new Uint8Array(MAX);          // 0 = 烟（普通混合） 1 = 发光（加法）
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);

    const mk = (additive) => {
      const g = new THREE.BufferGeometry();
      const P = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
      const S = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
      const A = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
      const C = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', P); g.setAttribute('size', S); g.setAttribute('alpha', A); g.setAttribute('color', C);
      g.setDrawRange(0, 0);
      const m = new THREE.ShaderMaterial({
        uniforms: { uScale: { value: 800 } },
        transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        vertexShader: `
          attribute float size; attribute float alpha; attribute vec3 color;
          uniform float uScale; varying float vA; varying vec3 vC;
          void main(){
            vA = alpha; vC = color;
            vec4 mv = modelViewMatrix * vec4(position,1.0);
            gl_PointSize = min(512.0, size * uScale / max(0.1, -mv.z));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: additive ? `
          varying float vA; varying vec3 vC;
          void main(){ vec2 d = gl_PointCoord-0.5; float r = dot(d,d)*4.0; float a = exp(-r*3.5)*vA; gl_FragColor = vec4(vC*a, a); }` : `
          varying float vA; varying vec3 vC;
          void main(){ vec2 d = gl_PointCoord-0.5; float r = length(d)*2.0; float a = smoothstep(1.0,0.2,r)*vA; gl_FragColor = vec4(vC, a); }`,
      });
      const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = additive ? 12 : 11;
      scene.add(p);
      return p;
    };
    this.smoke = mk(false);
    this.glow = mk(true);
  }

  setScale(px) { this.smoke.material.uniforms.uScale.value = px; this.glow.material.uniforms.uScale.value = px; }

  emit(o) {
    let i = this.n < MAX ? this.n++ : (Math.random() * MAX) | 0;
    this.pos[i * 3] = o.x; this.pos[i * 3 + 1] = o.y; this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx || 0; this.vel[i * 3 + 1] = o.vy || 0; this.vel[i * 3 + 2] = o.vz || 0;
    this.life[i] = 0; this.max[i] = o.life;
    this.s0[i] = o.s0; this.s1[i] = o.s1 ?? o.s0;
    const c = o.color || [1, 1, 1];
    this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
    this.a0[i] = o.a ?? 1; this.drag[i] = o.drag ?? 1.5; this.grav[i] = o.g ?? 0;
    this.kind[i] = o.glow ? 1 : 0;
  }

  clear() { this.n = 0; }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      if (this.life[i] >= this.max[i]) {
        const j = --this.n;
        if (i !== j) {
          for (const arr of [this.pos, this.vel, this.col]) { arr[i * 3] = arr[j * 3]; arr[i * 3 + 1] = arr[j * 3 + 1]; arr[i * 3 + 2] = arr[j * 3 + 2]; }
          for (const arr of [this.life, this.max, this.s0, this.s1, this.a0, this.drag, this.grav, this.kind]) arr[i] = arr[j];
        }
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.3; }
      i++;
    }
    // 写入 GPU 缓冲
    const fill = (pts, kind) => {
      const g = pts.geometry, P = g.attributes.position.array, S = g.attributes.size.array, A = g.attributes.alpha.array, C = g.attributes.color.array;
      let m = 0;
      for (let q = 0; q < this.n; q++) {
        if (this.kind[q] !== kind) continue;
        const t = this.life[q] / this.max[q];
        P[m * 3] = this.pos[q * 3]; P[m * 3 + 1] = this.pos[q * 3 + 1]; P[m * 3 + 2] = this.pos[q * 3 + 2];
        C[m * 3] = this.col[q * 3]; C[m * 3 + 1] = this.col[q * 3 + 1]; C[m * 3 + 2] = this.col[q * 3 + 2];
        S[m] = this.s0[q] + (this.s1[q] - this.s0[q]) * Math.sqrt(t);
        A[m] = this.a0[q] * (kind ? (1 - t) : Math.min(1, t * 8) * (1 - t) * (1 - t));
        m++;
      }
      g.setDrawRange(0, m);
      for (const k of ['position', 'size', 'alpha', 'color']) g.attributes[k].needsUpdate = true;
    };
    fill(this.smoke, 0);
    fill(this.glow, 1);
  }

  // ---------- 预设 ----------
  // S2 弹射起步白烟：两个后轮各一团，直径 0.3→2.2 m，0.9 s，世界坐标
  launchSmoke(x, z) {
    for (const sx of [-0.86, 0.86]) for (let k = 0; k < 26; k++) {
      this.emit({ x: x + sx + (Math.random() - 0.5) * 0.3, y: 0.25 + Math.random() * 0.3, z: z + 1.3 + Math.random() * 0.6,
        vx: sx * (0.5 + Math.random() * 1.6), vy: 0.4 + Math.random() * 1.2, vz: 1 + Math.random() * 3,
        life: 0.9, s0: 0.3, s1: 2.2, color: [0.86, 0.88, 0.9], a: 0.5, drag: 2.2 });
    }
  }
  // S6 落地环形扬尘：半径 0→1.8 m / 0.4 s
  dustRing(x, z, strength = 1) {
    const N = 40;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const sp = 4.5 * (0.85 + Math.random() * 0.3);    // 0.4 s 内带阻尼扩到 ~1.8 m
      this.emit({ x, y: 0.12, z, vx: Math.cos(a) * sp, vy: 0.3 + Math.random() * 0.4, vz: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.25, s0: 0.35, s1: 1.3, color: [0.8, 0.82, 0.86], a: 0.45 * strength, drag: 3.2 });
    }
  }
  // 起跳冷气白烟（喷口向下打到地面散开），留在世界坐标
  liftSmoke(x, y, z, k = 1) {
    if (y > 5) return;
    for (let n = 0; n < 5; n++) {
      const a = Math.random() * Math.PI * 2, sp = 2.5 + Math.random() * 4;
      this.emit({ x: x + Math.cos(a) * 0.9, y: 0.15, z: z + Math.sin(a) * 1.8, vx: Math.cos(a) * sp, vy: 0.35 + Math.random() * 0.7, vz: Math.sin(a) * sp,
        life: 1.0, s0: 0.35, s1: 2.6, color: [0.84, 0.87, 0.92], a: 0.36 * k * (1 - y / 5), drag: 1.8 });
    }
  }
  // 喷口残雾（冷气，蓝白，短命）
  plumeMist(x, y, z, dx, dy, dz, scale = 1) {
    this.emit({ x, y, z, vx: dx * 6 + (Math.random() - 0.5), vy: dy * 6 + (Math.random() - 0.5), vz: dz * 6 + (Math.random() - 0.5),
      life: 0.22, s0: 0.25 * scale, s1: 0.7 * scale, color: [0.55, 0.75, 1.0], a: 0.35, drag: 4, glow: true });
  }
  // v1.5 起步 A 组后向喷流：高速冷气柱（蓝白发光）+ 大团白色膨胀气云，留在世界坐标
  rearJet(x, y, z, k = 1) {
    this.emit({ x: x + (Math.random() - 0.5) * 0.15, y: y + (Math.random() - 0.5) * 0.1, z, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.2) * 1.5, vz: 26 + Math.random() * 14,
      life: 0.28, s0: 0.35 * k, s1: 1.4 * k, color: [0.62, 0.82, 1.0], a: 0.55 * k, drag: 5, glow: true });
    this.emit({ x, y, z: z + 0.6, vx: (Math.random() - 0.5) * 4, vy: 0.4 + Math.random() * 1.6, vz: 8 + Math.random() * 10,
      life: 1.3, s0: 0.6, s1: 3.6 * k, color: [0.9, 0.92, 0.95], a: 0.42 * k, drag: 2.4 });
  }
  // v1.5 落地反喷：气流打到地面后向四周炸开的扬尘 + 蓝白冲击光
  retroBlast(x, z, h, k = 1) {
    const near = Math.max(0, 1 - h / 7);       // 离地越近越猛
    if (near <= 0) return;
    for (let n = 0; n < 9; n++) {
      const a = Math.random() * Math.PI * 2, sp = (7 + Math.random() * 9) * (0.6 + near);
      this.emit({ x: x + Math.cos(a) * 0.5, y: 0.22, z: z + Math.sin(a) * 1.2, vx: Math.cos(a) * sp, vy: 1.2 + Math.random() * 1.8, vz: Math.sin(a) * sp,
        life: 0.9 + Math.random() * 0.5, s0: 0.55, s1: 3.4, color: [0.86, 0.89, 0.94], a: 0.5 * k * near, drag: 2.6 });
    }
    this.emit({ x: x + (Math.random() - 0.5), y: 0.1, z: z + (Math.random() - 0.5) * 2, vx: 0, vy: 0, vz: 0,
      life: 0.18, s0: 3.2 * near, s1: 5.6 * near, color: [0.55, 0.78, 1.0], a: 0.6 * k * near, drag: 0, glow: true });
  }
  sparks(x, y, z, dirx = 0, n = 34) {
    for (let k = 0; k < n; k++) {
      this.emit({ x, y, z, vx: dirx * 4 + (Math.random() - 0.5) * 9, vy: 1 + Math.random() * 5, vz: (Math.random() - 0.3) * 10,
        life: 0.25 + Math.random() * 0.35, s0: 0.12, s1: 0.04, color: [1.0, 0.62, 0.22], a: 1, drag: 1.2, g: 14, glow: true });
    }
  }
  crashSmoke(x, y, z) {
    for (let k = 0; k < 18; k++) this.emit({ x, y, z, vx: (Math.random() - 0.5) * 4, vy: 0.5 + Math.random() * 2, vz: (Math.random() - 0.5) * 4,
      life: 1.0, s0: 0.5, s1: 2.5, color: [0.5, 0.52, 0.55], a: 0.5, drag: 2 });
  }

  // 尾喷口白色冷气（v1.6 起步）：沿喷口朝向高速喷出、迅速膨胀变淡；冷气略下沉，不上升
  // 小颗粒 + 多数量 = 连续的雾，不要大颗粒（大颗粒会变成一颗颗气泡）
  nozzleVapor(x, y, z, dx, dy, dz, k = 1) {
    const sp = 4.5 + Math.random() * 6.5;
    this.emit({
      x, y, z,
      vx: dx * sp + (Math.random() - 0.5) * 1.0,
      vy: dy * sp + (Math.random() - 0.5) * 1.0 - 0.4,
      vz: dz * sp + (Math.random() - 0.5) * 1.0,
      life: 0.55 + Math.random() * 0.65,
      s0: 0.09 * k, s1: (0.30 + Math.random() * 0.28) * k,
      color: [0.93, 0.96, 1.0], a: 0.26 + Math.random() * 0.12, drag: 2.2, g: -0.9,
    });
  }
  // 起步时车尾地面被冷气吹起的白雾（贴地、横向散开，把气流"钉"在路面上）
  rearSmoke(x, z, k = 1) {
    for (let n = 0; n < 2; n++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 3;
      this.emit({ x: x + Math.cos(a) * 0.7, y: 0.12, z: z + Math.sin(a) * 0.9,
        vx: Math.cos(a) * sp, vy: 0.25 + Math.random() * 0.4, vz: 1.5 + Math.random() * 2.5,
        life: 0.7 + Math.random() * 0.4, s0: 0.3, s1: 1.6 * k, color: [0.88, 0.91, 0.95], a: 0.26 * k, drag: 2.2 });
    }
  }
  // 冲线抱死刹车：轮胎处横向喷出的白烟（细颗粒、低不透明度，靠数量叠成烟）
  tireSmoke(x, z, k = 1, a = 0.15) {
    const s = Math.random() < 0.5 ? -1 : 1;
    this.emit({
      x, y: 0.2, z,
      vx: s * (2.4 + Math.random() * 3.4), vy: 0.5 + Math.random() * 0.9, vz: 0.3 + Math.random() * 1.1,
      life: 0.55 + Math.random() * 0.45, s0: 0.14, s1: (0.55 + Math.random() * 0.5) * k,
      color: [0.88, 0.9, 0.94], a: a * k, drag: 2.4,
    });
  }
}
