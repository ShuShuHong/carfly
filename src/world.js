/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// 场景：夜景湿路面、红色霓虹拱架、护栏、远景、货车（同向/对向）、灯光与环境。
// 世界坐标映射：three.X = sim.x，three.Y = sim.y，three.Z = -sim.z（相机从 +Z 往 -Z 看）。
// 红线：3D 场景里不出现任何文字（所有贴图均为纯图形，无字符）。
import * as THREE from 'three';
import { CFG, LANES, OPEN } from './config.js';
import { Scenery } from './scenery.js';
import { mergeByMaterial } from './merge.js';

const TILE_L = 12;                         // 路面贴图一个周期 12 m（3 m 实线 + 9 m 间隔）
const ROAD_X0 = LANES.leftEdge - 2, ROAD_X1 = LANES.rightEdge + 2;
const ROAD_W = ROAD_X1 - ROAD_X0;
const ARCH_GAP = 90, ARCH_N = 7;
const POST_GAP = 4, POST_N = 190;

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function roadTextures() {
  const W = 1024, H = Math.round(1024 * TILE_L / ROAD_W);
  const px = x => ((x - ROAD_X0) / ROAD_W) * W;
  const m = W / ROAD_W;
  const lines = (g, emissive) => {
    const line = (x, color, dashed, w = 0.15) => {
      g.fillStyle = color;
      if (dashed) g.fillRect(px(x) - (w * m) / 2, 0, w * m, 3 * (H / TILE_L));
      else g.fillRect(px(x) - (w * m) / 2, 0, w * m, H);
    };
    const white = emissive ? '#bfc6d0' : '#d8dde4', yellow = emissive ? '#d9a21a' : '#e8b622';
    line(LANES.leftEdge + 1, white, false, 0.2);
    line(LANES.rightEdge - 1, white, false, 0.2);
    for (let k = 1; k < CFG.track.own; k++) line(CFG.track.median / 2 + k * 3.5, white, true);
    for (let k = 1; k < CFG.track.onc; k++) line(-(CFG.track.median / 2 + k * 3.5), white, true);
    line(-0.18, yellow, false, 0.14); line(0.18, yellow, false, 0.14);   // 中央双黄实线
    // 反光道钉
    g.fillStyle = emissive ? '#ffb040' : '#ffcc66';
    for (const yy of [H * 0.25, H * 0.75]) { g.beginPath(); g.arc(px(0), yy, 3, 0, Math.PI * 2); g.fill(); }
  };
  const map = canvasTex(W, H, (g) => {
    g.fillStyle = '#1d2025'; g.fillRect(0, 0, W, H);
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() * 18) | 0; d[i] += n; d[i + 1] += n; d[i + 2] += n + 2; }
    g.putImageData(img, 0, 0);
    // 路肩外略深
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, px(LANES.leftEdge), H); g.fillRect(px(LANES.rightEdge), 0, W - px(LANES.rightEdge), H);
    // 车辙光带（湿感）
    g.fillStyle = 'rgba(255,255,255,0.025)';
    for (const l of [...LANES.own, ...LANES.onc]) for (const o of [-0.9, 0.9]) g.fillRect(px(l + o) - 10, 0, 20, H);
    lines(g, false);
  });
  const emissive = canvasTex(W, H, (g) => { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); lines(g, true); });
  const rough = canvasTex(W, H, (g) => {
    g.fillStyle = '#5a5a5a'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) {                 // 积水斑块：更低粗糙度 → 更亮的反射
      g.fillStyle = `rgba(20,20,20,${0.25 + Math.random() * 0.4})`;
      g.beginPath(); g.ellipse(Math.random() * W, Math.random() * H, 10 + Math.random() * 50, 4 + Math.random() * 18, 0, 0, Math.PI * 2); g.fill();
    }
  }, false);
  for (const t of [map, emissive, rough]) { t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; }
  return { map, emissive, rough };
}

function skyTexture() {
  return canvasTex(64, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#02030a'); gr.addColorStop(0.55, '#070b1c'); gr.addColorStop(0.78, '#101a36'); gr.addColorStop(1, '#141c33');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 14; i++) g.fillRect(Math.random() * w, Math.random() * h * 0.45, 0.6, 0.35);
  });
}

function skylineTexture() {
  return canvasTex(2048, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    let x = 0;
    while (x < w) {
      const bw = 20 + Math.random() * 70, bh = 30 + Math.random() * 170;
      g.fillStyle = `rgb(${14 + Math.random() * 8},${18 + Math.random() * 8},${34 + Math.random() * 10})`;
      g.fillRect(x, h - bh, bw, bh);
      g.fillStyle = 'rgba(255,200,140,0.35)';
      for (let wy = h - bh + 6; wy < h - 6; wy += 9) for (let wx = x + 4; wx < x + bw - 4; wx += 7) if (Math.random() < 0.12) g.fillRect(wx, wy, 2, 3);
      x += bw + Math.random() * 6;
    }
    // 远处一排红色航空障碍灯
    g.fillStyle = 'rgba(255,60,60,0.9)';
    for (let i = 0; i < 12; i++) g.fillRect(Math.random() * w, h - 150 - Math.random() * 60, 3, 3);
  });
}

function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,240,220,0.35)') {
  return canvasTex(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, inner); gr.addColorStop(0.18, mid); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
}

// 黑白格贴图（终点横幅 / 地面终点线）：纯图形，无文字
function checkerTexture(cols, rows, cell) {
  return canvasTex(cols * cell, rows * cell, (g, w, h) => {
    g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0d0f12';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if ((r + c) % 2 === 0) g.fillRect(c * cell, r * cell, cell, cell);
    }
  });
}

function corrugationTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#d9dcdf'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) {
      const gr = g.createLinearGradient(x, 0, x + 8, 0);
      gr.addColorStop(0, '#bfc3c7'); gr.addColorStop(0.5, '#eef0f2'); gr.addColorStop(1, '#b4b8bc');
      g.fillStyle = gr; g.fillRect(x, 0, 8, h);
    }
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
  });
}

function rearDoorTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#cfd2d5'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#9da1a6'; g.fillRect(w / 2 - 2, 0, 4, h);            // 对开门缝
    g.fillStyle = '#7d8187';
    for (const x of [w * 0.2, w * 0.38, w * 0.62, w * 0.8]) g.fillRect(x - 3, 8, 6, h - 16); // 锁杆
    g.fillStyle = '#5b5f64'; for (const y of [h * 0.12, h * 0.5, h * 0.88]) for (const x of [6, w - 18]) g.fillRect(x, y - 8, 12, 16); // 合页
  });
}

export class World {
  constructor(renderer) {
    this.renderer = renderer;
    const scene = this.scene = new THREE.Scene();
    scene.background = skyTexture();
    scene.fog = new THREE.Fog(0x121a30, 40, 330);
    this.environment(renderer);

    scene.add(new THREE.HemisphereLight(0x5a6c9a, 0x0a0a12, 0.55));
    const moon = this.moon = new THREE.DirectionalLight(0xdfe8ff, 1.5);
    moon.position.set(-6, 14, 10); scene.add(moon); scene.add(moon.target);
    const key = this.key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(4, 9, -6); scene.add(key); scene.add(key.target);
    this.underGlow = new THREE.PointLight(0x9fd0ff, 0, 9, 2); scene.add(this.underGlow);

    this.buildRoad();
    this.arches = [];
    if (OPEN.roadArches) this.buildArches();      // v1.4 默认去掉路上的红色门架
    this.buildRails();
    this.truckMeshes = new Map();
    this.tex = { corr: corrugationTexture(), door: rearDoorTexture(), head: glowTexture(), spot: glowTexture('rgba(255,236,205,0.55)', 'rgba(255,230,190,0.25)') };
    this.scenery = new Scenery(scene, this.tex.head);   // 树 / 火箭发射场 / 广告牌 / 赛博朋克城市
    this.buildFinishGate();                             // v1.6 终点门架（依赖 this.tex.head）
    this.truckShared = {
      black: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7, metalness: 0.2 }),
      cab: new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.4, metalness: 0.5 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.1, metalness: 0.8 }),
      tail: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4422).multiplyScalar(2.4), toneMapped: false }),
      band: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2020).multiplyScalar(1.4), toneMapped: false }),
      headL: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff1dc).multiplyScalar(3), toneMapped: false }),
      door: new THREE.MeshStandardMaterial({ map: this.tex.door, roughness: 0.5, metalness: 0.4 }),
      // 5500K 暖白头灯光晕：fog:false，保证 200 m 外仍是两个亮点
      flare: new THREE.SpriteMaterial({ map: this.tex.head, color: 0xffeedd, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }),
      spot: new THREE.MeshBasicMaterial({ map: this.tex.spot, color: 0xfff0dc, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    };
    // v1.9 小轿车共用材质 + 车漆色板（每辆车克隆 paintBase 上色，供 50 m 提示改 emissiveIntensity）
    this.carShared = {
      paintBase: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.55 }),
      colors: [0xd23a3a, 0x3f74c8, 0xe3e7ec, 0x9aa1ab, 0x2f8f6f, 0xc98b3a, 0x5f6670],
      glass: new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.08, metalness: 0.85 }),
      black: new THREE.MeshStandardMaterial({ color: 0x121417, roughness: 0.75, metalness: 0.2 }),
      tire: new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.95 }),
      tail: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3322).multiplyScalar(2.2), toneMapped: false }),
      head: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4e2).multiplyScalar(2.6), toneMapped: false }),
      flare: this.truckShared.flare,
      spot: this.truckShared.spot,
    };
  }

  environment(renderer) {
    // 简易夜景环境图：让金属车漆/湿路面有东西可反射（不用 HDRI）
    const env = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'varying vec3 p; void main(){ float h = normalize(p).y; vec3 c = mix(vec3(0.05,0.06,0.09), vec3(0.03,0.05,0.12), smoothstep(-0.2,0.6,h)); c += vec3(0.12,0.14,0.2)*smoothstep(0.15,-0.05,abs(h)); gl_FragColor = vec4(c,1.); }',
    }));
    env.add(sky);
    const panel = (color, x, y, z, w, h, s = 1) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(s), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
    };
    panel(0xffffff, 0, 30, 0, 30, 8, 2.2);           // 顶光
    panel(0xff2a2a, -30, 8, -10, 4, 30, 2.0);        // 红色霓虹
    panel(0xff2a2a, 30, 8, -20, 4, 30, 2.0);
    panel(0xaecbff, 20, 4, 30, 25, 4, 0.8);
    panel(0xffe2c0, -25, 3, 25, 18, 3, 0.6);
    const pm = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pm.fromScene(env, 0.04).texture;
    this.scene.environmentIntensity = 0.9;
    pm.dispose();
  }

  buildRoad() {
    const t = this.roadTex = roadTextures();
    const len = 760;
    for (const k of ['map', 'emissive', 'rough']) t[k].repeat.set(1, len / TILE_L);
    const mat = new THREE.MeshStandardMaterial({
      map: t.map, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 0.55,
      roughness: 0.42, roughnessMap: t.rough, metalness: 0.35,
    });
    const road = this.road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, len), mat);
    road.rotation.x = -Math.PI / 2;
    road.position.x = (ROAD_X0 + ROAD_X1) / 2;
    road.userData.len = len;
    this.scene.add(road);
    const ground = this.ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0x07080b, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02;
    this.scene.add(ground);
  }

  buildArches() {
    // 红色桁架/霓虹拱架（对齐 The Ramp 的红色 LED 光带结构），实例化复用
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.5, metalness: 0.8 });
    const led = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1f2a).multiplyScalar(2.2), toneMapped: false });
    const xl = LANES.leftEdge - 1.6, xr = LANES.rightEdge + 1.6, H = 10.5;
    const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); };
    for (const x of [xl, xr]) {
      for (const dx of [-0.45, 0.45]) for (const dz of [-0.45, 0.45]) box(0.12, H, 0.12, x + dx, H / 2, dz, metal);
      for (let y = 0.8; y < H; y += 1.1) { box(1.0, 0.07, 0.07, x, y, 0.45, metal); box(1.0, 0.07, 0.07, x, y, -0.45, metal); box(0.07, 0.07, 1.0, x + 0.45, y, 0, metal); }
      box(0.08, H - 0.4, 0.08, x + (x < 0 ? 0.56 : -0.56), H / 2, 0.5, led);
    }
    const span = xr - xl;
    for (const dy of [0, 1.0]) for (const dz of [-0.45, 0.45]) box(span, 0.12, 0.12, (xl + xr) / 2, H + dy, dz, metal);
    for (let x = xl; x < xr; x += 1.2) box(0.06, 1.0, 0.06, x, H + 0.5, 0.45, metal);
    box(span - 1.2, 0.1, 0.1, (xl + xr) / 2, H - 0.12, 0.5, led);
    box(span - 1.2, 0.05, 0.05, (xl + xr) / 2, 0.03, 0.9, led);         // 地面 LED 线
    // 湿路面上的红色倒影（廉价反射：加法混合长条）
    const refl = new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,40,50,0.6)', 'rgba(255,30,40,0.18)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const rp = new THREE.Mesh(new THREE.PlaneGeometry(span - 3, 26), refl);
    rp.rotation.x = -Math.PI / 2; rp.position.set((xl + xr) / 2, 0.02, 8); g.add(rp);
    for (const x of [xl + 0.6, xr - 0.6]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 20), refl); s.rotation.x = -Math.PI / 2; s.position.set(x, 0.025, 8); g.add(s);
    }
    const merged = mergeByMaterial(g);
    this.arches = merged.map(m => {
      const im = new THREE.InstancedMesh(m.geometry, m.material, ARCH_N);
      im.frustumCulled = false; this.scene.add(im); return im;
    });
    this.archBase = null;
  }

  // ---------------- v1.6 终点装置：冲线门架 + 地面终点线 ----------------
  // 仪式感全用图形做：黑白格横幅/终点线 + 青白 LED 立柱 + 顶部探照灯，不写任何文字（红线：3D 场景零文字）。
  buildFinishGate() {
    const g = new THREE.Group();
    const T = this.tex;
    const metal = new THREE.MeshStandardMaterial({ color: 0x6b727c, roughness: 0.4, metalness: 0.8 });
    const ledM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xbfe9ff).multiplyScalar(2.4), toneMapped: false });
    const lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff6e8).multiplyScalar(3.0), toneMapped: false });
    const xl = LANES.leftEdge - 1.4, xr = LANES.rightEdge + 1.4, H = 13.5, span = xr - xl;
    const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };

    // 格构塔：4 根主弦 + 横撑（比路上拱架更密、更"工程"）
    for (const x of [xl, xr]) {
      for (const dx of [-0.7, 0.7]) for (const dz of [-0.7, 0.7]) box(0.18, H, 0.18, x + dx, H / 2, dz, metal);
      for (let y = 1.2; y < H; y += 1.5) {
        box(1.6, 0.1, 0.1, x, y, 0.7, metal); box(1.6, 0.1, 0.1, x, y, -0.7, metal);
        box(0.1, 0.1, 1.6, x + 0.7, y, 0, metal); box(0.1, 0.1, 1.6, x - 0.7, y, 0, metal);
      }
      // 立柱竖向 LED 灯带（加粗；夜里这是唯一能看见的塔身轮廓）
      const ex = x + (x < 0 ? 0.78 : -0.78);
      box(0.16, H - 1.0, 0.16, ex, H / 2, 0.6, ledM);
      box(0.16, H - 1.0, 0.16, ex, H / 2, -0.6, ledM);
      // 每 3 m 一圈横向灯带，让塔身在远处读得出来
      for (let y = 2.4; y < H - 0.8; y += 3.0) {
        box(1.7, 0.1, 0.1, x, y, 0.72, ledM);
        box(1.7, 0.1, 0.1, x, y, -0.72, ledM);
      }
    }
    // 横梁 + 桁架
    for (const dz of [-0.6, 0.6]) box(span, 0.24, 0.24, (xl + xr) / 2, H, dz, metal);
    for (let x = xl; x < xr; x += 1.6) box(0.08, 1.2, 0.08, x, H - 0.6, 0.6, metal);
    box(span, 0.1, 0.1, (xl + xr) / 2, H - 1.2, 0.6, metal);
    box(span, 0.16, 0.16, (xl + xr) / 2, H - 0.05, 0.9, ledM);          // 横梁前沿灯条

    // 黑白格横幅（挂在横梁下方，正对来车）
    const bw = span - 2.2, bh = 1.9;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: checkerTexture(16, 2, 128), toneMapped: false }));
    banner.position.set((xl + xr) / 2, H - 2.3, 0.72);
    g.add(banner);
    // 横幅上下包边（让黑白格像一块实体的旗面，不是贴纸）
    box(bw + 0.3, 0.16, 0.22, (xl + xr) / 2, H - 2.3 + bh / 2 + 0.08, 0.72, metal);
    box(bw + 0.3, 0.16, 0.22, (xl + xr) / 2, H - 2.3 - bh / 2 - 0.08, 0.72, metal);

    // 顶部探照灯 6 只（朝下打车道，冲线时全亮）
    const lamps = [];
    for (let i = 0; i < 6; i++) {
      const x = xl + span * (0.12 + 0.152 * i);
      const l = box(1.0, 0.22, 0.5, x, H - 1.35, 1.05, lampM);
      lamps.push(l);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.head, color: 0xfff2dd, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
      s.scale.set(5, 5, 1); s.position.set(x, H - 1.35, 1.2); s.userData.base = 5; g.add(s);
      lamps.push(s);
    }

    // 两根直上夜空的探照灯光柱（仪式感主力：远看就知道"那是终点"）
    const beamTex = canvasTex(64, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, h, 0, 0);
      gr.addColorStop(0, 'rgba(220,240,255,0.85)'); gr.addColorStop(0.45, 'rgba(170,215,255,0.28)'); gr.addColorStop(1, 'rgba(140,190,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      // 两侧收边，做出光束的"柱"感
      const side = g.createLinearGradient(0, 0, w, 0);
      side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.5, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
      g.globalCompositeOperation = 'destination-out'; g.fillStyle = side; g.fillRect(0, 0, w, h);
    });
    const beams = [];
    for (const x of [xl, xr]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 46),
        new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5, fog: false, toneMapped: false }));
      m.position.set(x, H + 23, 0);
      g.add(m); beams.push(m);
    }

    // 地面终点线：黑白格横条 + 一条发白的地面灯线（正下方就是"线"）
    const lineZ = 0;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W - 1.2, 1.7),
      new THREE.MeshBasicMaterial({ map: checkerTexture(20, 2, 96), toneMapped: false, transparent: false }));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set((ROAD_X0 + ROAD_X1) / 2, 0.03, lineZ);
    g.add(strip);
    const glowLine = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W - 1.2, 0.22),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xeaf7ff).multiplyScalar(2.2), toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glowLine.rotation.x = -Math.PI / 2;
    glowLine.position.set((ROAD_X0 + ROAD_X1) / 2, 0.035, lineZ - 0.95);
    g.add(glowLine);

    g.position.z = -OPEN.trackLength;
    this.scene.add(g);
    this.gate = { g, leds: [], lamps, beams, ledM, lampM, glowLine, flash: 0, passed: false, base: { led: ledM.color.clone(), lamp: lampM.color.clone() } };
    // 真正需要变亮的材质只有这几个，收集起来统一调
    g.traverse(o => { if (o.isMesh && o.material === ledM) this.gate.leds.push(o); });
    return this.gate;
  }

  // 冲线灯光爆闪：flash 从 1 衰减到 0（约 1.6 s）
  flashGate() { if (this.gate) { this.gate.flash = 1; this.gate.passed = true; } }

  updateGate(dt) {
    const G = this.gate;
    if (!G) return;
    if (G.flash > 0) G.flash = Math.max(0, G.flash - dt / 1.6);
    const f = G.flash * G.flash;                 // 起手最亮，随后快速回落
    G.ledM.color.copy(G.base.led).multiplyScalar(1 + 2.6 * f);
    G.lampM.color.copy(G.base.lamp).multiplyScalar(1 + 1.8 * f);
    G.glowLine.material.opacity = 0.55 + 0.45 * f;
    G.glowLine.material.color.setHex(0xeaf7ff).multiplyScalar(2.2 + 3.4 * f);
    for (const b of G.beams || []) b.material.opacity = 0.34 + 0.5 * f;
  }


  buildRails() {
    const rail = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.85 });
    this.rails = [];
    for (const x of [LANES.leftEdge - 0.15, LANES.rightEdge + 0.15]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 800), rail);
      r.position.set(x, 0.7, 0); this.scene.add(r); this.rails.push(r);
    }
    const post = new THREE.Group();
    const pm = new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.6, metalness: 0.6 });
    const reflector = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3030).multiplyScalar(1.6), toneMapped: false });
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), pm); p1.position.y = 0.4; post.add(p1);
    const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.08), reflector); p2.position.y = 0.7; post.add(p2);
    const merged = mergeByMaterial(post);
    this.posts = merged.map(m => { const im = new THREE.InstancedMesh(m.geometry, m.material, POST_N * 2); im.frustumCulled = false; this.scene.add(im); return im; });
    this.postBase = null;
  }

  buildSkyline() {
    const m = new THREE.MeshBasicMaterial({ map: skylineTexture(), transparent: true, fog: false, opacity: 0.85, depthWrite: false });
    this.skyline = new THREE.Mesh(new THREE.PlaneGeometry(1400, 170), m);
    this.skyline.renderOrder = -1;
    this.scene.add(this.skyline);
  }

  // ---------------- 货车 ----------------
  makeTruck(t) {
    const S = this.truckShared, L = t.len, T = CFG.trucks;
    const g = new THREE.Group();
    const cabL = 2.3, gap = 0.4, contL = L - cabL - gap;
    const zc0 = L / 2 - cabL - gap;           // 集装箱前端（局部 f 坐标，车头为 +f）
    const add = (geo, mat, x, y, f) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, -f); g.add(m); return m; };
    // 集装箱（每辆一份材质，用于 50 m 边缘自发光提示）
    const corr = this.tex.corr.clone(); corr.needsUpdate = true; corr.wrapS = corr.wrapT = THREE.RepeatWrapping; corr.repeat.set(contL / 2.6, 1);
    const cont = new THREE.MeshStandardMaterial({ map: corr, roughness: 0.45, metalness: 0.35, emissive: 0xdde6ff, emissiveIntensity: 0 });
    const contMesh = add(new THREE.BoxGeometry(T.w, 2.95, contL), cont, 0, 1.25 + 1.475, zc0 - contL / 2);
    void contMesh;
    add(new THREE.PlaneGeometry(T.w - 0.06, 2.85), S.door, 0, 2.725, zc0 - contL - 0.005);   // 尾门朝 +Z（朝追尾相机）
    // 底盘与车轮
    add(new THREE.BoxGeometry(1.9, 0.45, L - 0.4), S.black, 0, 0.85, 0);
    const wg = new THREE.CylinderGeometry(0.52, 0.52, 0.5, 16); wg.rotateZ(Math.PI / 2);
    for (const f of [L / 2 - 1.2, zc0 - contL + 1.3, zc0 - contL + 2.6, zc0 - contL + 3.9]) for (const sx of [-1, 1]) add(wg, S.black, sx * 0.95, 0.52, f);
    add(new THREE.BoxGeometry(2.4, 0.25, 0.08), S.black, 0, 0.75, -L / 2 + 0.06);  // 防钻撞杠
    // 尾部红色反光带 + 尾灯（橙红）
    add(new THREE.BoxGeometry(T.w - 0.1, 0.09, 0.04), S.band, 0, 1.32, -L / 2 - 0.01);
    for (const sx of [-1, 1]) {
      add(new THREE.BoxGeometry(0.06, 2.6, 0.04), S.band, sx * (T.w / 2 - 0.05), 2.7, -L / 2 - 0.01);
      add(new THREE.BoxGeometry(0.34, 0.16, 0.06), S.tail, sx * 0.9, 0.95, -L / 2 - 0.02);
    }
    // 车头（同向车被集装箱挡住看不到；对向车迎面可见）
    add(new THREE.BoxGeometry(T.w, 2.9, cabL), S.cab, 0, 1.0 + 1.45, L / 2 - cabL / 2);
    add(new THREE.BoxGeometry(T.w - 0.2, 1.0, 0.05), S.glass, 0, 3.1, L / 2 + 0.005);
    add(new THREE.BoxGeometry(T.w - 0.4, 0.06, 0.05), S.headL, 0, 1.75, L / 2 + 0.01);
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.42, 0.14, 0.05), S.headL, sx * 0.85, 1.25, L / 2 + 0.015);
    mergeByMaterial(g, o => o.material !== cont);
    if (t.dir < 0) {
      for (const sx of [-1, 1]) {
        const s = new THREE.Sprite(S.flare); s.scale.set(2.6, 2.6, 1); s.position.set(sx * 0.85, 1.25, -(L / 2 + 0.3)); g.add(s);
      }
      // 头灯在湿路面照出的椭圆光斑，随车前进
      const spot = new THREE.Mesh(new THREE.PlaneGeometry(7, 26), S.spot);
      spot.rotation.x = -Math.PI / 2; spot.position.set(0, 0.03, -(L / 2 + 13)); g.add(spot);
      g.rotation.y = Math.PI;               // 对向：车头朝向玩家（+Z）
    }
    g.userData = { cont, corr, glow: [cont], own: [cont] };
    this.scene.add(g);
    return g;
  }

  // ---------------- NPC 小轿车（v1.9）----------------
  // 低多边形三厢轿车：长 4.4–5.0 / 宽 1.86 / 高 1.45，比货车矮得多，飞过去是"贴顶"的最佳对象。
  // 每辆一份车漆材质（用于 50 m 边缘自发光提示），其余材质共用。
  makeCar(t) {
    const S = this.carShared, L = t.len, W = t.w;
    const g = new THREE.Group();
    const add = (geo, mat, x, y, f) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, -f); g.add(m); return m; };
    const paint = S.paintBase.clone();
    paint.color.setHex(S.colors[(t.id * 2654435761 >>> 0) % S.colors.length]);
    // 自发光取自身车漆的暗色版：夜里车不会全黑，远处也能看出一团车形
    paint.emissive = paint.color.clone().multiplyScalar(0.55);
    paint.emissiveIntensity = 0.5;

    const bodyH = 0.56, sill = 0.30, cabH = 0.52;
    // 车身（下段）+ 前后收窄的鼻/尾
    add(new THREE.BoxGeometry(W, bodyH, L * 0.98), paint, 0, sill + bodyH / 2, 0);
    add(new THREE.BoxGeometry(W * 0.94, bodyH * 0.62, L * 0.16), paint, 0, sill + bodyH * 0.42, L * 0.52);   // 车头
    add(new THREE.BoxGeometry(W * 0.92, bodyH * 0.5, L * 0.12), paint, 0, sill + bodyH * 0.38, -L * 0.53);   // 车尾
    // 座舱（玻璃）：顶面收窄 + 前后错位 → 风挡有倾角，不再是方盒子
    const cabin = new THREE.BoxGeometry(W * 0.84, cabH, L * 0.46);
    {
      const p = cabin.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.80); p.setZ(i, p.getZ(i) * 0.70 + L * 0.03); }
      }
      cabin.computeVertexNormals();
    }
    add(cabin, S.glass, 0, sill + bodyH + cabH / 2 - 0.04, -L * 0.03);
    add(new THREE.BoxGeometry(W * 0.62, 0.09, L * 0.30), paint, 0, sill + bodyH + cabH + 0.01, -L * 0.045);
    // 前后保险杠 / 底裙
    add(new THREE.BoxGeometry(W * 0.98, 0.16, L * 0.99), S.black, 0, sill - 0.06, 0);
    // 车轮
    const wg = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14); wg.rotateZ(Math.PI / 2);
    for (const f of [L * 0.30, -L * 0.30]) for (const sx of [-1, 1]) add(wg, S.tire, sx * (W / 2 - 0.09), 0.32, f);
    // 灯：尾灯（红）+ 头灯（白）
    for (const sx of [-1, 1]) {
      add(new THREE.BoxGeometry(0.34, 0.13, 0.05), S.tail, sx * (W * 0.31), sill + bodyH * 0.72, -L * 0.545);
      add(new THREE.BoxGeometry(0.30, 0.12, 0.05), S.head, sx * (W * 0.31), sill + bodyH * 0.66, L * 0.555);
    }
    mergeByMaterial(g, o => o.material !== paint);
    if (t.dir < 0) {
      for (const sx of [-1, 1]) {
        const s = new THREE.Sprite(S.flare); s.scale.set(1.7, 1.7, 1); s.position.set(sx * (W * 0.31), 0.78, -(L / 2 + 0.25)); g.add(s);
      }
      const spot = new THREE.Mesh(new THREE.PlaneGeometry(5, 18), S.spot);
      spot.rotation.x = -Math.PI / 2; spot.position.set(0, 0.03, -(L / 2 + 9)); g.add(spot);
      g.rotation.y = Math.PI;
    }
    g.userData = { glow: [paint], own: [paint], baseGlow: 0.5 };
    this.scene.add(g);
    return g;
  }

  syncTrucks(trucks, carZ, alpha, prevZ) {
    const seen = new Set();
    for (const t of trucks) {
      seen.add(t.id);
      let g = this.truckMeshes.get(t.id);
      if (!g) { g = t.kind === 'car' ? this.makeCar(t) : this.makeTruck(t); this.truckMeshes.set(t.id, g); }
      const pz = prevZ.has(t.id) ? prevZ.get(t.id) : t.z;
      const z = pz + (t.z - pz) * alpha;
      g.position.set(t.x, 0, -z);
      // 50 m 内极轻的车身自发光提示（余光可感知）；轿车目标更小，提示更亮一点
      const d = Math.abs(z - carZ) - t.len / 2;
      const glow = d < CFG.trucks.glowDist ? (1 - Math.max(0, d) / CFG.trucks.glowDist) : 0;
      const gain = t.kind === 'car' ? 0.16 : 0.08;
      const base = g.userData.baseGlow || 0;
      for (const m of g.userData.glow || []) m.emissiveIntensity = base + gain * glow;
    }
    for (const [id, g] of this.truckMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(g);
      g.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } });
      if (g.userData.cont) g.userData.cont.dispose();
      if (g.userData.corr) g.userData.corr.dispose();
      for (const m of g.userData.own || []) m.dispose();
      this.truckMeshes.delete(id);
    }
  }

  clearTrucks() { this.syncTrucks([], 0, 1, new Map()); }

  update(carZ, carX, dt = 0) {
    this.updateGate(dt);
    const len = this.road.userData.len, start = carZ - 120;
    this.road.position.z = -(start + len / 2);
    const off = (start / TILE_L) % 1;
    for (const k of ['map', 'emissive', 'rough']) this.roadTex[k].offset.y = off;
    this.ground.position.set(carX, -0.02, -carZ - 200);
    for (const r of this.rails) r.position.z = -(carZ + 280);
    this.scenery.update(carZ, carX);

    const ab = Math.floor((carZ - 30) / ARCH_GAP);
    if (this.arches.length && ab !== this.archBase) {
      this.archBase = ab;
      const m = new THREE.Matrix4();
      for (let i = 0; i < ARCH_N; i++) { m.makeTranslation(0, 0, -((ab + i) * ARCH_GAP + 40)); for (const im of this.arches) im.setMatrixAt(i, m); }
      for (const im of this.arches) im.instanceMatrix.needsUpdate = true;
    }
    const pb = Math.floor((carZ - 40) / POST_GAP);
    if (pb !== this.postBase) {
      this.postBase = pb;
      const m = new THREE.Matrix4();
      for (let i = 0; i < POST_N; i++) {
        const z = -((pb + i) * POST_GAP);
        m.makeTranslation(LANES.leftEdge - 0.25, 0, z); for (const im of this.posts) im.setMatrixAt(i * 2, m);
        m.makeTranslation(LANES.rightEdge + 0.25, 0, z); for (const im of this.posts) im.setMatrixAt(i * 2 + 1, m);
      }
      for (const im of this.posts) im.instanceMatrix.needsUpdate = true;
    }
    this.moon.target.position.set(carX, 0, -carZ); this.moon.position.set(carX - 6, 14, -carZ + 10);
    this.key.target.position.set(carX, 0.5, -carZ); this.key.position.set(carX + 4, 9, -carZ - 6);
  }
}
