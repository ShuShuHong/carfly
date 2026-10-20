/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// 路边景物（v1.4）：树林、火箭发射场（不锈钢重型火箭 + 发射塔 / 白色中型火箭 + 支撑塔）、
// 高速广告牌（新能源热梗，文案见 text.js）、远处升空的火箭、极远处赛博朋克城市。
// 全部按车的位置循环复用（InstancedMesh / 对象池），不随赛道长度增加内存。
// 注：火箭与城市上不画任何标志/文字；广告牌文字是甲方 v1.4 明确要求，可用 OPEN.billboardText 关闭。
import * as THREE from 'three';
import { LANES, OPEN } from './config.js';
import { TEXT } from './text.js';
import { mergeByMaterial } from './merge.js';

const R_EDGE = LANES.rightEdge + 0.4, L_EDGE = LANES.leftEdge - 0.4;
const hash = (i, k) => { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); };

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- 树
const TREE_GAP = 9, TREE_PER_ROW = 52;
const TREE_ROWS = [R_EDGE + 8, R_EDGE + 16, R_EDGE + 27, L_EDGE - 8, L_EDGE - 16, L_EDGE - 27];

function buildTrees(scene) {
  const foliageM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
  const trunkM = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 1 });
  // 松树：3 层锥；阔叶树：低多边形球
  const pine = new THREE.Group();
  [[0, 3.2, 2.4, 3.6], [0, 5.0, 1.9, 3.2], [0, 6.6, 1.3, 2.6]].forEach(([x, y, r, h]) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), foliageM); m.position.set(x, y, 0); pine.add(m);
  });
  const broad = new THREE.Group();
  [[0, 4.4, 2.3], [0.9, 3.7, 1.6], [-0.8, 3.9, 1.7]].forEach(([x, y, r]) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), foliageM); m.position.set(x, y, 0); broad.add(m);
  });
  const trunkG = new THREE.CylinderGeometry(0.18, 0.28, 2.6, 6); trunkG.translate(0, 1.3, 0);
  const types = [pine, broad].map(g => {
    const geo = mergeByMaterial(g)[0].geometry;
    const N = TREE_ROWS.length * TREE_PER_ROW;
    const fol = new THREE.InstancedMesh(geo, foliageM, N);
    const tru = new THREE.InstancedMesh(trunkG, trunkM, N);
    for (const im of [fol, tru]) { im.frustumCulled = false; scene.add(im); }
    return { fol, tru };
  });
  return { types, base: null };
}

function updateTrees(T, carZ) {
  const base = Math.floor((carZ - 40) / TREE_GAP);
  if (base === T.base) return;
  T.base = base;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  TREE_ROWS.forEach((rx, r) => {
    for (let k = 0; k < TREE_PER_ROW; k++) {
      const i = base + k, slot = r * TREE_PER_ROW + k;
      const type = hash(i, r * 7 + 1) < 0.55 ? 0 : 1;
      const skip = hash(i, r * 7 + 2) < (r % 3 === 0 ? 0.35 : 0.2);
      const sc = 0.75 + hash(i, r * 7 + 3) * 0.8;
      p.set(rx + (hash(i, r * 7 + 4) - 0.5) * 6, 0, -(i * TREE_GAP + (hash(i, r * 7 + 5) - 0.5) * 6));
      q.setFromAxisAngle(up, hash(i, r * 7 + 6) * 6.28);
      s.set(sc, sc * (0.85 + hash(i, r) * 0.4), sc);
      m.compose(p, q, s);
      col.setHSL(0.27 + hash(i, r * 3) * 0.12, 0.35, 0.10 + hash(i, r * 5) * 0.08);
      T.types.forEach((t, ti) => {
        const show = !skip && ti === type;
        t.fol.setMatrixAt(slot, show ? m : zero);
        t.tru.setMatrixAt(slot, show ? m : zero);
        if (show) t.fol.setColorAt(slot, col);
      });
    }
  });
  for (const t of T.types) {
    t.fol.instanceMatrix.needsUpdate = true; t.tru.instanceMatrix.needsUpdate = true;
    if (t.fol.instanceColor) t.fol.instanceColor.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- 广告牌
const BB_GAP = 240, BB_N = 4, BB_W = 13, BB_H = 4.6;
const BB_THEMES = [
  ['#06c8ff', '#0040c0', '#ffffff'], ['#ff2bd6', '#5a0fa8', '#ffffff'], ['#ffb020', '#d0281c', '#ffffff'],
  ['#2af0a0', '#0a6a7a', '#06202a'], ['#f4f6f8', '#c9ced6', '#d8232a'], ['#7a5cff', '#1a1050', '#ffe14a'],
];

function drawIcon(g, kind, x, y, s, color) {
  g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = color; g.strokeStyle = color; g.lineWidth = 6;
  g.beginPath(); g.arc(0, 0, 52, 0, Math.PI * 2); g.stroke();
  g.beginPath();
  if (kind === 0) {        // 闪电（充电）
    g.moveTo(8, -40); g.lineTo(-22, 6); g.lineTo(-2, 6); g.lineTo(-10, 40); g.lineTo(22, -8); g.lineTo(2, -8); g.closePath(); g.fill();
  } else if (kind === 1) { // 火箭
    g.moveTo(0, -42); g.quadraticCurveTo(16, -20, 14, 18); g.lineTo(-14, 18); g.quadraticCurveTo(-16, -20, 0, -42); g.fill();
    g.beginPath(); g.moveTo(-14, 6); g.lineTo(-26, 30); g.lineTo(-12, 22); g.fill();
    g.beginPath(); g.moveTo(14, 6); g.lineTo(26, 30); g.lineTo(12, 22); g.fill();
    g.beginPath(); g.moveTo(-7, 24); g.lineTo(0, 44); g.lineTo(7, 24); g.fill();
  } else if (kind === 2) { // 插头
    g.fillRect(-20, -14, 40, 30); g.fillRect(-14, -36, 8, 24); g.fillRect(6, -36, 8, 24); g.fillRect(-5, 16, 10, 24);
  } else {                 // 楔形跑车剪影 + 翅膀
    g.moveTo(-40, 16); g.lineTo(-30, 2); g.lineTo(-6, -8); g.lineTo(14, -10); g.lineTo(40, 6); g.lineTo(40, 16); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(-6, -8); g.lineTo(-30, -34); g.lineTo(6, -12); g.fill();
  }
  g.restore();
}

function billboardTexture(idx, main, sub, opt) {
  const [c1, c2, ink] = BB_THEMES[idx % BB_THEMES.length];
  const showIcon = !(opt && opt.icon === false);
  return canvasTex(1024, 362, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // 斜向速度条纹
    g.globalAlpha = 0.12; g.fillStyle = '#fff';
    for (let x = -200; x < w; x += 70) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 40, h); g.lineTo(x + 240, 0); g.lineTo(x + 200, 0); g.fill(); }
    g.globalAlpha = 1;
    if (showIcon) drawIcon(g, idx % 4, 130, h / 2, 1.5, ink);
    if (OPEN.billboardText) {
      const fam = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Heiti SC",sans-serif';
      const fit = (text, size, maxW) => { let s = size; do { g.font = `900 ${s}px ${fam}`; s -= 4; } while (g.measureText(text).width > maxW && s > 20); };
      // 有图标：右侧起排；无图标：整块居中（不留左侧空当）
      const x0 = showIcon ? 250 : w / 2;
      const maxW = showIcon ? w - 300 : w - 120;
      g.textAlign = showIcon ? 'left' : 'center';
      g.textBaseline = 'middle'; g.fillStyle = ink;
      g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 8; g.shadowOffsetY = 4;
      fit(main, 118, maxW); g.fillText(main, x0, h * 0.40);
      g.shadowBlur = 0; g.shadowOffsetY = 0; g.globalAlpha = 0.88;
      fit(sub, 56, maxW); g.font = g.font.replace('900', '700'); g.fillText(sub, showIcon ? x0 + 4 : x0, h * 0.76);
      g.globalAlpha = 1;
      g.textAlign = 'left';
    }
    // 顶部射灯照出的亮区
    for (const lx of [0.2, 0.5, 0.8]) {
      const rg = g.createRadialGradient(w * lx, -20, 10, w * lx, -20, 300);
      rg.addColorStop(0, 'rgba(255,250,235,0.35)'); rg.addColorStop(1, 'rgba(255,250,235,0)');
      g.fillStyle = rg; g.fillRect(0, 0, w, h);
    }
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  });
}

function buildBillboards(scene, glowTex) {
  const texs = TEXT.billboards.map(([a, b, o], i) => billboardTexture(i, a, b, o));
  const metal = new THREE.MeshStandardMaterial({ color: 0x3b3f46, roughness: 0.55, metalness: 0.7 });
  const lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4dc).multiplyScalar(2.5), toneMapped: false });
  const glowM = new THREE.SpriteMaterial({ map: glowTex, color: 0xfff0d8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const pool = [];
  for (let n = 0; n < BB_N; n++) {
    const g = new THREE.Group();
    const struct = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 7.4, 10), metal); pole.position.y = 3.7; struct.add(pole);
    const back = new THREE.Mesh(new THREE.BoxGeometry(BB_W + 0.5, BB_H + 0.5, 0.35), metal); back.position.set(0, 7.4 + BB_H / 2, -0.25); struct.add(back);
    const walk = new THREE.Mesh(new THREE.BoxGeometry(BB_W + 0.4, 0.12, 1.1), metal); walk.position.set(0, 7.2, 0.4); struct.add(walk);
    for (const lx of [-0.3, 0, 0.3]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.6), metal); arm.position.set(lx * BB_W, 7.4 + BB_H + 0.35, 0.6); struct.add(arm);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.4), lampM); lamp.position.set(lx * BB_W, 7.4 + BB_H + 0.3, 1.35); struct.add(lamp);
      const s = new THREE.Sprite(glowM); s.scale.set(3, 3, 1); s.position.set(lx * BB_W, 7.4 + BB_H + 0.2, 1.4); g.add(s);
    }
    mergeByMaterial(struct);
    g.add(struct);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(BB_W, BB_H), new THREE.MeshBasicMaterial({ map: texs[0], toneMapped: false }));
    panel.position.set(0, 7.4 + BB_H / 2, 0);
    g.add(panel);
    scene.add(g);
    pool.push({ g, panel, idx: null });
  }
  return { pool, texs };
}

function updateBillboards(B, carZ) {
  const base = Math.floor((carZ - 60) / BB_GAP);
  B.pool.forEach((b, n) => {
    // 每个池对象负责 i ≡ n (mod BB_N) 的那一块
    let i = base + ((n - base) % BB_N + BB_N) % BB_N;
    if (b.idx === i) return;
    b.idx = i;
    const side = hash(i, 91) < 0.62 ? 1 : -1;                 // 多数在右侧（同向车道一侧）
    const x = side > 0 ? R_EDGE + 6.5 : L_EDGE - 6.5;
    const gz = -(i * BB_GAP + 150);
    // 终点门架两侧 60 m 内不放广告牌：否则会正好挡住门架（夜里广告牌比门架亮得多）
    if (Math.abs(gz - -OPEN.trackLength) < 60) { b.g.visible = false; return; }
    b.g.visible = true;
    b.g.position.set(x, 0, gz);
    b.g.rotation.y = -side * 0.28;                           // 面板朝向来车并略向路中偏
    b.panel.material.map = B.texs[((i % B.texs.length) + B.texs.length) % B.texs.length];
  });
}

// ---------------------------------------------------------------- 火箭发射场
const SITE_GAP = 820;

function latticeTexture() {
  const t = canvasTex(128, 128, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.strokeStyle = '#fff'; g.lineWidth = 9;
    g.strokeRect(4, 4, w - 8, w - 8);
    g.lineWidth = 6; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, w); g.moveTo(w, 0); g.lineTo(0, w); g.stroke();
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function beamTexture() {
  return canvasTex(8, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, h, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

function lathe(profile, seg = 32) { return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg); }

function buildSite(kind, latTex, beamTex, glowTex) {
  const site = new THREE.Group();
  const mats = [];
  const M = (o) => { const m = new THREE.MeshStandardMaterial({ fog: false, transparent: true, ...o }); mats.push(m); return m; };
  const steel = M({ color: 0xd9dde2, metalness: 0.85, roughness: 0.3, emissive: 0x23272e });
  const white = M({ color: 0xf2f3f5, metalness: 0.1, roughness: 0.45, emissive: 0x1e2128 });
  const dark = M({ color: 0x16181c, metalness: 0.4, roughness: 0.6, emissive: 0x050608 });
  const concrete = M({ color: 0x3a3c40, roughness: 0.95, emissive: 0x0a0b0d });
  const lat = latTex.clone(); lat.needsUpdate = true;
  const tower = M({ color: 0x5a5e66, metalness: 0.7, roughness: 0.5, map: lat, alphaTest: 0.4, side: THREE.DoubleSide, emissive: 0x101216 });
  const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a2a).multiplyScalar(2.5), fog: false, toneMapped: false, transparent: true });
  mats.push(red);
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); site.add(m); return m; };

  let towerH, towerX;
  if (kind === 'heavy') {
    // 不锈钢两级重型火箭：助推器 71 m + 热分离环 + 飞船 38 m + 鼻锥 12 m，直径 9 m
    add(new THREE.BoxGeometry(34, 7, 34), concrete, 0, 3.5, 0);                     // 发射台
    for (const [x, z] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) add(new THREE.BoxGeometry(3, 12, 3), concrete, x, 13, z);
    add(new THREE.CylinderGeometry(10, 10, 2, 24, 1, true), dark, 0, 19, 0);         // 发射环
    add(new THREE.CylinderGeometry(4.5, 4.5, 71, 32), steel, 0, 20 + 35.5, 0);
    add(new THREE.CylinderGeometry(4.55, 4.55, 2, 32), dark, 0, 92, 0);              // 热分离环
    add(new THREE.CylinderGeometry(4.5, 4.5, 38, 32), steel, 0, 93 + 19, 0);
    add(lathe([[4.5, 0], [4.4, 3], [3.9, 6], [2.9, 9], [1.4, 11.3], [0, 12]]), steel, 0, 131, 0);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.5, 9, 4), dark, s * 5.6, 99, 0);                     // 后襟翼
      add(new THREE.BoxGeometry(0.5, 6, 2.6), dark, s * 4.6, 132, 0);                  // 前襟翼
      add(new THREE.BoxGeometry(0.4, 60, 0.8), steel, s * 4.6, 56, 0);                 // 助推器侧条
    }
    for (const [x, z] of [[4.9, 0], [-4.9, 0], [0, 4.9], [0, -4.9]]) add(new THREE.BoxGeometry(x ? 0.4 : 3.2, 3.6, z ? 0.4 : 3.2), dark, x, 86, z); // 栅格舵
    towerH = 146; towerX = 17;
    add(new THREE.BoxGeometry(10, towerH, 10), tower, towerX, towerH / 2, 0);
    for (const dz of [-4.5, 4.5]) add(new THREE.BoxGeometry(14, 2.2, 1.2), dark, towerX - 9, 104, dz);  // 筷子机械臂
    add(new THREE.BoxGeometry(12, 1.6, 2), dark, towerX - 7, 122, 0);                   // 快速断开臂
  } else {
    // 白色中型火箭：一级 42 m + 黑色级间段 + 二级 12 m + 整流罩 13 m，直径 3.7 m
    add(new THREE.BoxGeometry(22, 5, 22), concrete, 0, 2.5, 0);
    add(new THREE.CylinderGeometry(1.85, 1.85, 42, 24), white, 0, 5 + 21, 0);
    add(new THREE.CylinderGeometry(1.86, 1.86, 6, 24), dark, 0, 50, 0);
    add(new THREE.CylinderGeometry(1.85, 1.85, 12, 24), white, 0, 59, 0);
    add(lathe([[1.85, 0], [2.6, 1.5], [2.6, 7], [2.2, 10], [1.2, 12.2], [0, 13]]), white, 0, 65, 0);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      const leg = add(new THREE.BoxGeometry(0.5, 10, 0.9), dark, Math.cos(a) * 1.95, 10, Math.sin(a) * 1.95);
      leg.rotation.y = -a;
      add(new THREE.BoxGeometry(1.4, 1.2, 0.2), dark, Math.cos(a) * 2.0, 46, Math.sin(a) * 2.0).rotation.y = -a + Math.PI / 2;  // 栅格舵
    }
    towerH = 84; towerX = 7;
    add(new THREE.BoxGeometry(4.5, towerH, 4.5), tower, towerX, towerH / 2, 0);
    for (const y of [24, 44, 62]) add(new THREE.BoxGeometry(5, 0.8, 1), dark, towerX - 3.5, y, 0);
  }
  lat.repeat.set(1, towerH / (kind === 'heavy' ? 10 : 4.5));
  // 塔顶航空障碍灯（闪烁）
  const beacon = add(new THREE.SphereGeometry(kind === 'heavy' ? 0.9 : 0.6, 8, 6), red, towerX, towerH + 1, 0);
  // 地面射灯：向上的光柱 + 光晕
  const beamM = new THREE.MeshBasicMaterial({ map: beamTex, color: 0xdfe8ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
  const glowM = new THREE.SpriteMaterial({ map: glowTex, color: 0xeef3ff, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, transparent: true });
  mats.push(beamM, glowM);
  const H = kind === 'heavy' ? 120 : 70;
  for (const [x, z] of [[-22, 18], [22, 18], [-22, -18], [22, -18]]) {
    const geo = new THREE.CylinderGeometry(kind === 'heavy' ? 7 : 4, 0.6, H, 16, 1, true); geo.translate(0, H / 2, 0);
    const beam = add(geo, beamM, x * (kind === 'heavy' ? 1 : 0.6), 0.5, z * (kind === 'heavy' ? 1 : 0.6));
    beam.lookAt(0, H * 0.75, 0); beam.rotateX(Math.PI / 2);
    const s = new THREE.Sprite(glowM); s.scale.set(9, 9, 1); s.position.set(beam.position.x, 1.5, beam.position.z); site.add(s);
  }
  // 静态网格按材质合并
  const keep = new Set([beacon]);
  site.traverse(o => { if (o.isMesh && o.material === beamM) keep.add(o); });
  mergeByMaterial(site, o => !keep.has(o) && !o.isSprite);
  return { g: site, mats, beacon, red, kind, idx: null };
}

function buildSites(scene, glowTex) {
  const lat = latticeTexture(), beam = beamTexture();
  const sites = [buildSite('heavy', lat, beam, glowTex), buildSite('medium', lat, beam, glowTex)];
  for (const s of sites) scene.add(s.g);
  return sites;
}

function updateSites(sites, carZ, carX, time) {
  // 站点 i 在 z = i·820 + 520；偶数 = 重型、奇数 = 中型；左右交替
  sites.forEach((s, n) => {
    let i = Math.floor((carZ + 300) / SITE_GAP);
    if (((i % 2) + 2) % 2 !== n) i += 1;
    const z = i * SITE_GAP + 520;
    const side = hash(i, 17) < 0.5 ? -1 : 1;
    // 竖屏水平视角只有 ~38°，离路太远会一直在画面外；拉近到 45–60 m，在前方 150–700 m 都能入画
    const x = side < 0 ? L_EDGE - (s.kind === 'heavy' ? 60 : 45) : R_EDGE + (s.kind === 'heavy' ? 60 : 45);
    s.g.position.set(x, 0, -z);
    s.g.rotation.y = side < 0 ? Math.PI : 0;                  // 发射塔始终在火箭远离公路的一侧
    // 距离淡入（这些材质不吃雾，用不透明度代替雾，避免远处突然出现）
    const d = z - carZ;
    const a = Math.min(1, Math.max(0, (720 - d) / 200)) * Math.min(1, Math.max(0, (d + 260) / 100));
    s.g.visible = a > 0.01;
    for (const m of s.mats) {
      const base = m.userData.baseOpacity ?? (m.userData.baseOpacity = m.opacity);
      m.opacity = base * a;
      m.depthWrite = m.blending !== THREE.AdditiveBlending && a > 0.98;
    }
    s.red.opacity = a * (Math.sin(time * 3.2 + n) > 0.2 ? 1 : 0.08);
    void carX;
  });
}

// ---------------------------------------------------------------- 远处升空的火箭
function buildLaunch(scene, glowTex) {
  const trailTex = canvasTex(64, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,240,210,1)'); gr.addColorStop(0.06, 'rgba(255,170,90,0.8)');
    gr.addColorStop(0.4, 'rgba(200,190,220,0.35)'); gr.addColorStop(1, 'rgba(160,160,200,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const sg = g.createLinearGradient(0, 0, w, 0);
    sg.addColorStop(0, 'rgba(0,0,0,1)'); sg.addColorStop(0.5, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = sg; g.fillRect(0, 0, w, h);
  });
  const trail = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: trailTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd9a0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
  trail.renderOrder = -1; flame.renderOrder = -1;
  scene.add(trail, flame);
  return { trail, flame, t0: -12 };
}

function updateLaunch(L, carZ, carX, time) {
  const CYCLE = 38, DUR = 24;
  const t = ((time - L.t0) % CYCLE + CYCLE) % CYCLE;
  const on = t < DUR;
  L.trail.visible = L.flame.visible = on;
  if (!on) return;
  const k = t / DUR;
  const y = 6 + 420 * k * k;                       // 加速升空
  const drift = 70 * k * k;                         // 重力转弯
  const x = carX - 330 + drift, z = -(carZ + 760);
  L.flame.position.set(x, y, z);
  const fl = 18 + 6 * Math.sin(time * 40);
  L.flame.scale.set(fl, fl * 1.4, 1);
  const len = Math.min(y - 2, 40 + 260 * k);
  L.trail.position.set(x - drift * 0.15 * (len / Math.max(1, y)), y - len / 2, z);
  L.trail.scale.set(10 + 22 * k, len, 1);
  L.trail.material.opacity = Math.min(1, t / 1.5) * (1 - Math.max(0, (k - 0.85) / 0.15));
}

// ---------------------------------------------------------------- 赛博朋克城市（两层视差剪影）
function cityTexture(layer) {
  const W = 2048, H = 512;
  return canvasTex(W, H, (g) => {
    g.clearRect(0, 0, W, H);
    const neon = ['#ff2bd6', '#22e6ff', '#ffe14a', '#7a5cff', '#ff4060'];
    const rnd = (() => { let s = layer * 9973 + 17; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    let x = 0;
    while (x < W) {
      const far = layer === 0;
      const bw = (far ? 26 : 34) + rnd() * (far ? 70 : 110);
      let bh = (far ? 70 : 40) + Math.pow(rnd(), 1.6) * (far ? 300 : 230);
      if (rnd() < 0.06) bh = Math.min(H - 20, bh * 1.5);
      const top = H - bh;
      const base = far ? [16, 18, 44] : [8, 9, 24];
      g.fillStyle = `rgb(${base[0] + rnd() * 10},${base[1] + rnd() * 10},${base[2] + rnd() * 16})`;
      // 楼顶造型：平顶 / 斜切 / 阶梯
      g.beginPath();
      const style = rnd();
      if (style < 0.25) { g.moveTo(x, H); g.lineTo(x, top + 18); g.lineTo(x + bw, top); g.lineTo(x + bw, H); }
      else if (style < 0.45) { g.moveTo(x, H); g.lineTo(x, top + 26); g.lineTo(x + bw * 0.3, top + 26); g.lineTo(x + bw * 0.3, top); g.lineTo(x + bw * 0.75, top); g.lineTo(x + bw * 0.75, top + 14); g.lineTo(x + bw, top + 14); g.lineTo(x + bw, H); }
      else { g.rect(x, top, bw, bh); }
      g.fill();
      // 窗户
      const wc = rnd() < 0.5 ? 'rgba(120,220,255,' : 'rgba(255,170,230,';
      for (let wy = top + 10; wy < H - 6; wy += far ? 7 : 9) {
        for (let wx = x + 4; wx < x + bw - 4; wx += far ? 5 : 7) if (rnd() < (far ? 0.10 : 0.14)) { g.fillStyle = wc + (0.25 + rnd() * 0.5) + ')'; g.fillRect(wx, wy, far ? 2 : 3, far ? 2 : 3); }
      }
      const nc = neon[(rnd() * neon.length) | 0];
      g.shadowColor = nc; g.shadowBlur = far ? 8 : 14;
      // 霓虹竖边 / 横带 / 无字全息屏
      if (rnd() < 0.55) { g.fillStyle = nc; g.fillRect(x + (rnd() < 0.5 ? 1 : bw - 4), top + 8, far ? 2 : 3, bh * (0.4 + rnd() * 0.5)); }
      if (rnd() < 0.35) { g.fillStyle = nc; g.fillRect(x + 3, top + bh * (0.15 + rnd() * 0.5), bw - 6, far ? 2 : 3); }
      if (!far && rnd() < 0.3 && bw > 50) {
        const hx = x + bw * 0.15, hy = top + bh * (0.2 + rnd() * 0.3), hw = bw * 0.7, hh = 18 + rnd() * 30;
        const hg = g.createLinearGradient(hx, hy, hx + hw, hy + hh); hg.addColorStop(0, nc); hg.addColorStop(1, neon[(rnd() * neon.length) | 0]);
        g.globalAlpha = 0.75; g.fillStyle = hg; g.fillRect(hx, hy, hw, hh); g.globalAlpha = 1;
      }
      g.shadowBlur = 0;
      // 天线 + 红色航空灯
      if (rnd() < 0.3) { g.fillStyle = base.map(v => v + 10).reduce((s, v, i) => s + (i ? ',' : '') + v, 'rgb(') + ')'; g.fillRect(x + bw / 2 - 1, top - 30, 2, 30); g.fillStyle = '#ff3a3a'; g.fillRect(x + bw / 2 - 2, top - 32, 4, 4); }
      x += bw + rnd() * (far ? 4 : 10);
    }
    // 底部霓虹雾霾
    const hz = g.createLinearGradient(0, H, 0, H - 200);
    hz.addColorStop(0, layer === 0 ? 'rgba(255,60,200,0.30)' : 'rgba(40,200,255,0.22)'); hz.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'lighter'; g.fillStyle = hz; g.fillRect(0, H - 200, W, 200);
    g.globalCompositeOperation = 'source-over';
  });
}

function buildCity(scene) {
  const mk = (layer, w, h) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: cityTexture(layer), transparent: true, fog: false, depthWrite: false, toneMapped: false, opacity: layer === 0 ? 0.8 : 1 }));
    m.renderOrder = -2 + layer; scene.add(m); return m;
  };
  // 天际线压低：只占地平线以上一小条，不抢赛道视线
  const far = mk(0, 3000, 300), near = mk(1, 2400, 190);
  far.material.color.setScalar(0.75); near.material.color.setScalar(0.85);
  return { far, near };
}

// ---------------------------------------------------------------- 汇总
export class Scenery {
  constructor(scene, glowTex) {
    this.trees = buildTrees(scene);
    this.billboards = buildBillboards(scene, glowTex);
    this.sites = buildSites(scene, glowTex);
    this.launch = buildLaunch(scene, glowTex);
    this.city = buildCity(scene);
  }

  update(carZ, carX) {
    const time = performance.now() / 1000;
    updateTrees(this.trees, carZ);
    updateBillboards(this.billboards, carZ);
    updateSites(this.sites, carZ, carX, time);
    updateLaunch(this.launch, carZ, carX, time);
    // 城市：极远处，横向随车轻微视差
    this.city.far.position.set(carX * 0.95, 300 / 2 - 25, -(carZ + 820));
    this.city.near.position.set(carX * 0.9, 190 / 2 - 18, -(carZ + 760));
  }
}
