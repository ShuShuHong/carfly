/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// 程序化车辆模型（依据 05_车辆模型参考/三视图_V1.jpg + 03_美术与资产/车辆外观规范.md）
// 模型坐标：+X 右、+Y 上、-Z 前（与世界一致，便于相机从 +Z 往 -Z 看）。原点在车底中心地面接触点。
// 层级：root(位置) → rollPivot(横滚，轴在车体中心高度) → att(yaw/pitch/表现偏移) → body
import * as THREE from 'three';
import { mergeByMaterial } from './merge.js';
import { buildBodyGeometry, halfW, yTop, yShoulder, sideX, F_FRONT, F_REAR } from './carbody.js';

const PIVOT_Y = 0.62;
const f2z = f => -f;  // 前向坐标 f（米，车头为正）→ 模型 z

// 俯视楔形收窄：车头尖、车尾略收
function taper(f) {
  if (f > 1.2) return 1 - 0.38 * Math.pow((f - 1.2) / 1.13, 1.6);
  if (f < -1.9) return 1 - 0.06 * ((-1.9 - f) / 0.43);
  return 1;
}

// 侧视轮廓（f, y）→ 沿 X 拉伸，再按 taper 收窄
function sideExtrude(points, width, bevel, xShape) {
  const s = new THREE.Shape(points.map(([f, y]) => new THREE.Vector2(f, y)));
  const g = new THREE.ExtrudeGeometry(s, {
    depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, curveSegments: 8,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  // shape(u=f, v=y), 拉伸沿 z → 旋转使 u→-Z、拉伸→X
  g.rotateY(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setX(i, x * taper(-z) * (xShape ? xShape(y, -z) : 1));
  }
  g.computeVertexNormals();
  return g;
}

function arch(cf, R, a0, a1, n = 10) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    out.push([cf + R * Math.cos(a), 0.39 + R * Math.sin(a)]);
  }
  return out;
}

function spokeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#121316'; x.fillRect(0, 0, 256, 256);
  x.fillStyle = '#2a2d31'; x.beginPath(); x.arc(128, 128, 100, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#4a4e55'; x.lineWidth = 2.2;
  for (let i = 0; i < 36; i++) {         // 密辐涡轮：36 条细辐
    const a = (i / 36) * Math.PI * 2, b = a + 0.18;
    x.beginPath();
    x.moveTo(128 + Math.cos(a) * 22, 128 + Math.sin(a) * 22);
    x.lineTo(128 + Math.cos(b) * 98, 128 + Math.sin(b) * 98);
    x.stroke();
  }
  x.fillStyle = '#3A3D42'; x.beginPath(); x.arc(128, 128, 22, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#1b1d20'; x.beginPath(); x.arc(128, 128, 8, 0, Math.PI * 2); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// 喷焰锥：核心近白 #FFFFFF → 外缘冷蓝 #6FB7FF，加法混合，无黑边
export function plumeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uT: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv; varying float vFres;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vec3 n = normalize(normalMatrix * normal);
        vFres = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uI; uniform float uT; varying vec2 vUv; varying float vFres;
      void main(){
        float along = 1.0 - vUv.y;                 // 0 = 喷口, 1 = 末端
        float flick = 0.85 + 0.15*sin(uT*90.0 + vUv.x*40.0);
        float a = pow(1.0 - along, 1.6) * pow(vFres, 1.3) * uI * flick;
        vec3 col = mix(vec3(1.0), vec3(0.435,0.718,1.0), smoothstep(0.05,0.7,along) + (1.0-vFres)*0.6);
        gl_FragColor = vec4(col * a * 1.6, a);
      }`,
  });
}

function makePlume(r, len) {
  // 短锥：喷口端（y=0）窄，向 -Y 张开到 y=-1；uv.y=1 在喷口
  const g = new THREE.CylinderGeometry(r * 0.45, r, 1, 14, 1, true);
  g.translate(0, -0.5, 0);
  const m = new THREE.Mesh(g, plumeMaterial());
  m.scale.set(1, len, 1);
  m.frustumCulled = false;
  m.renderOrder = 10;
  return m;
}

export function buildCar() {
  const M = {
    body: new THREE.MeshStandardMaterial({ color: 0xECEEF0, roughness: 0.35, metalness: 0.55 }),
    black: new THREE.MeshStandardMaterial({ color: 0x1A1C1F, roughness: 0.6, metalness: 0.1 }),
    // 透光 ~15%：只让红色防滚架的轮廓隐约透出
    glass: new THREE.MeshStandardMaterial({ color: 0x0E1114, roughness: 0.08, metalness: 0.7, transparent: true, opacity: 0.93, emissive: 0x3A3226, emissiveIntensity: 0.06 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.9 }),
    rim: new THREE.MeshStandardMaterial({ map: spokeTexture(), roughness: 0.7, metalness: 0.4 }),
    ti: new THREE.MeshStandardMaterial({ color: 0x8A9099, metalness: 0.9, roughness: 0.25 }),
    inco: new THREE.MeshStandardMaterial({ color: 0x6E6A62, metalness: 0.95, roughness: 0.35 }),
    nozzle: new THREE.MeshStandardMaterial({ color: 0x1B1D20, roughness: 0.5, metalness: 0.6 }),
    cage: new THREE.MeshStandardMaterial({ color: 0xD8232A, roughness: 0.5, emissive: 0x200303 }),
    tail: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xFF2D2D).multiplyScalar(3.0), toneMapped: false }),
    head: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xF4F7FF).multiplyScalar(2.2), toneMapped: false }),
    amber: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xFF8A3D).multiplyScalar(1.6), toneMapped: false }),
  };

  const root = new THREE.Group();
  const rollPivot = new THREE.Group(); rollPivot.position.y = PIVOT_Y; root.add(rollPivot);
  const att = new THREE.Group(); rollPivot.add(att);
  const body = new THREE.Group(); body.position.y = -PIVOT_Y; att.add(body);
  const add = (geo, mat, x = 0, y = 0, f = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, f2z(f)); body.add(m); return m; };

  // —— 车身：放样（loft）曲面，一体成型的白车身 / 黑下包围 / 整片深色玻璃舱（见 carbody.js）——
  const lofted = buildBodyGeometry();
  const shell = new THREE.Mesh(lofted.geo, [M.body, M.black, M.glass]);
  body.add(shell);
  add(lofted.capWhite, M.body);
  add(lofted.capBlack, M.black);
  // 透过玻璃隐约可见的红色防滚架（收在玻璃舱内）
  const hoop = new THREE.TorusGeometry(0.5, 0.022, 6, 20, Math.PI);
  const h1 = add(hoop, M.cage, 0, 0.74, -0.35); h1.scale.set(0.98, 0.98, 1);
  const h2 = add(hoop, M.cage, 0, 0.74, 0.30); h2.scale.set(1.0, 0.82, 1);

  // —— 车头：尖楔鼻 + 黑色前唇/分流器 + 一条极细横向灯槽 + 翼子板前端两处细长大灯 ——
  const noseW = halfW(F_FRONT);
  add(new THREE.BoxGeometry(noseW * 2 + 0.25, 0.035, 0.42), M.black, 0, 0.14, F_FRONT - 0.15);      // 前唇（比车身略低、向前伸）
  add(new THREE.BoxGeometry(noseW * 1.9, 0.018, 0.02), M.head, 0, yTop(F_FRONT) - 0.015, F_FRONT + 0.006); // 贯穿细灯槽
  for (const sx of [-1, 1]) {
    // 翼子板前端的细长大灯：沿楔形前脸外缘斜放（只绕 Y 轴顺着俯视的尖角走向）
    const f = 2.12, y = 0.43, x = sideX(f, y) - 0.10;
    const hl = add(new THREE.BoxGeometry(0.26, 0.024, 0.03), M.head, sx * x, y, f + 0.01);
    hl.rotation.y = sx * 0.62;
  }
  // 前翼子板琥珀侧标志灯（贴车身侧面）
  for (const sx of [-1, 1]) {
    const f = 1.0, y = 0.60, m = add(new THREE.BoxGeometry(0.02, 0.028, 0.18), M.amber, sx * (sideX(f, y) + 0.004), y, f);
    m.rotation.y = sx * 0.04;
  }

  // —— 车尾：贯穿式红尾灯带（两端上翘）+ 扩散器 + A 组 4 根等长推进器喷口（与尾板齐平，不外凸）——
  const tailY = 0.885, tailHW = sideX(F_REAR, tailY) * 0.96;
  add(new THREE.BoxGeometry(tailHW * 2 - 0.2, 0.03, 0.02), M.tail, 0, tailY, F_REAR - 0.006);
  for (const sx of [-1, 1]) { const e = add(new THREE.BoxGeometry(0.16, 0.03, 0.02), M.tail, sx * (tailHW - 0.08), tailY + 0.025, F_REAR - 0.006); e.rotation.z = sx * 0.32; }
  add(new THREE.BoxGeometry(1.62, 0.26, 0.20), M.black, 0, 0.30, F_REAR + 0.06);   // 扩散器体
  for (let i = 0; i < 7; i++) add(new THREE.BoxGeometry(0.022, 0.20, 0.30), M.black, -0.66 + i * 0.22, 0.26, F_REAR - 0.02); // 竖鳍 7 片
  add(new THREE.BoxGeometry(0.40, 0.13, 0.012), new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.6 }), 0, 0.66, F_REAR - 0.007); // 空白牌照板（无字符）
  // A 组喷口的"点火亮点"贴图：后端看过去就是 4 个亮点（喷锥是开口圆筒，正对时看不见内壁）
  const flashTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(226,242,255,0.75)');
    gr.addColorStop(0.6, 'rgba(150,200,255,0.22)'); gr.addColorStop(1, 'rgba(120,180,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const tubeGlow = [];
  const tubeRingG = new THREE.TorusGeometry(0.062, 0.012, 8, 20);
  const tubeHoleG = new THREE.CircleGeometry(0.058, 20);
  const tubeCoreG = new THREE.CircleGeometry(0.032, 20);
  const tubes = [];
  for (const tx of [-0.62, -0.24, 0.24, 0.62]) {
    add(tubeRingG, M.ti, tx, 0.47, F_REAR - 0.008);                              // 钛合金管口
    const d1 = add(tubeHoleG, M.nozzle, tx, 0.47, F_REAR - 0.006); d1.rotation.y = Math.PI;  // 暗色喷道
    const d2 = add(tubeCoreG, M.inco, tx, 0.47, F_REAR - 0.007); d2.rotation.y = Math.PI;    // 内层 Inconel 分流段
    // A 组后向喷焰：喷锥沿 +Z（车后方）；只在弹射起步时点火
    // 起点放在扩散器之后（z=2.42），否则气柱会从黑色扩散器里穿出来
    const pl = makePlume(0.14, 1);
    pl.rotation.x = -Math.PI / 2;
    pl.position.set(tx, 0.47, f2z(F_REAR + 0.10));
    pl.visible = false;
    body.add(pl); tubes.push(pl);
    // 点火亮点：正后方看过来能数出 4 个喷口
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true, opacity: 0 }));
    gl.scale.set(0.75, 0.75, 1);
    gl.position.set(tx, 0.47, f2z(F_REAR + 0.02));
    gl.visible = false;
    body.add(gl); tubeGlow.push(gl);
  }

  // —— 车底：平整黑底板 + B 组 4 喷点（四角）——
  // （平整底板已包含在放样车身里；这里只加两条纵向加强筋，倒转时车底不至于一片空）
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.03, 3.2), M.ti, sx * 0.32, 0.148, 0);
  // 轮拱内衬（车底仰视时可见）
  const linerM = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.9, side: THREE.DoubleSide });
  for (const f of [1.29, -1.29]) for (const sx of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.455, 0.455, 0.28, 18, 1, true, 0, Math.PI); g.rotateZ(Math.PI / 2); g.rotateX(Math.PI / 2);
    add(g, linerM, sx * 0.84, 0.39, f);
  }
  const B = [];   // 顺序：前左、前右、后左、后右
  const nozG = new THREE.CylinderGeometry(0.1, 0.12, 0.06, 18);
  const nozRingG = new THREE.TorusGeometry(0.1, 0.018, 6, 18); nozRingG.rotateX(Math.PI / 2);
  for (const [nx, nf, side, rear] of [[-0.5, 1.92, -1, 0], [0.5, 1.92, 1, 0], [-0.5, -1.92, -1, 1], [0.5, -1.92, 1, 1]]) {
    add(nozG, M.nozzle, nx, 0.135, nf);
    add(nozRingG, M.ti, nx, 0.11, nf);
    const pl = makePlume(0.16, 0.7);
    pl.position.set(nx, 0.105, f2z(nf));
    body.add(pl);
    B.push({ mesh: pl, side, rear });
  }
  // C 组：车体前部左右 2 台偏航喷口，朝外略向上
  const C = [];
  for (const sx of [-1, 1]) {
    const cf = 1.75, cy = 0.46, cx = sideX(cf, cy);
    const n = add(new THREE.CylinderGeometry(0.045, 0.055, 0.03, 12), M.nozzle, sx * (cx - 0.005), cy, cf);
    n.rotation.z = Math.PI / 2;
    const pl = makePlume(0.08, 0.45);
    pl.position.set(sx * (cx + 0.01), cy, f2z(cf));
    pl.rotation.z = sx > 0 ? Math.PI / 2 + 0.25 : -Math.PI / 2 - 0.25;   // 指向 ±X，略向上
    body.add(pl);
    C.push({ mesh: pl, side: sx });
  }

  // —— 车轮：深色密辐涡轮轮毂 + 低扁平胎 ——
  const wheelG = new THREE.CylinderGeometry(0.39, 0.39, 0.27, 30); wheelG.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [wx, wf] of [[-0.855, 1.29], [0.855, 1.29], [-0.86, -1.29], [0.86, -1.29]]) {
    const w = new THREE.Mesh(wheelG, [M.tire, M.rim, M.rim]);
    w.position.set(wx, 0.39, f2z(wf));
    body.add(w); wheels.push(w);
  }

  // 静态部件按材质合并，车辆只剩 ~14 个 draw call（多材质的车身壳单独保留）
  const dynamic = new Set([shell, ...wheels, ...tubes, ...tubeGlow, ...B.map(b => b.mesh), ...C.map(c => c.mesh)]);
  mergeByMaterial(body, o => !dynamic.has(o));
  return { root, rollPivot, att, body, wheels, B, C, tubes, tubeGlow, M, PIVOT_Y };
}
