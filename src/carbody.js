/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// 车身（v1.5 棱面版）：对照实拍 A_前3-4 / B_正后 —— 这台车是"大平面 + 硬折线"的楔形，不是圆润的流线体。
// 做法：沿车长取截面，每个截面由 9 个"折点"组成多边形（底板 / 轮拱 / 下包围斜面 / 侧面 / 肩线折边 /
// 翼子板顶 / 窗沿 / 车顶），相邻折点之间是一条独立的面带（strip），面带之间不共享顶点 → 折线处法线不平滑，棱角锐利。
// 沿车长的轮廓线也用折线（分段线性）插值，所以风挡顶、前舱盖后沿、轮拱顶这些转折也是硬的。
// 尺寸依据 三视图_V1.jpg：长 4.6 / 宽 2.0 / 高 1.30 / 轴距 2.58 / 轮径 0.78。
// 坐标：f = 车长方向（车头 +），模型 z = −f；x 右；y 上（地面 0）。
import * as THREE from 'three';

// 分段线性插值（折线），返回函数 + 断点（用于把截面放在每个转折处）
function lin(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  const fn = x => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[p.length - 1][0]) return p[p.length - 1][1];
    let i = 0; while (x > p[i + 1][0]) i++;
    const t = (x - p[i][0]) / (p[i + 1][0] - p[i][0]);
    return p[i][1] + (p[i + 1][1] - p[i][1]) * t;
  };
  fn.breaks = p.map(q => q[0]);
  return fn;
}

export const F_FRONT = 2.34, F_REAR = -2.32;
export const AXLE = 1.29, ARCH_R = 0.44, WHEEL_R = 0.39;

// 侧视中线：车头上缘是一条硬边 → 平直前舱盖 → 前舱盖后沿折线 → 大倾角平直风挡 → 短车顶 → 长直溜背 → 鸭尾
export const yTop = lin([[2.34, 0.36], [2.29, 0.44], [0.98, 0.80], [-0.12, 1.28], [-0.62, 1.30], [-2.14, 0.955], [-2.32, 0.985]]);
// 肩线（侧面与翼子板顶之间的折边）：前轮处的翼子板棱、腰部微降、后轮"臀部"抬高
export const yShoulder = lin([[2.34, 0.36], [2.27, 0.45], [1.29, 0.88], [0.55, 0.80], [-0.45, 0.83], [-1.29, 0.95], [-2.32, 0.935]]);
// 俯视最大半宽：车头是带倒角的楔形尖头，前后轮处最宽
export const halfW = lin([[2.34, 0.58], [2.18, 0.80], [1.85, 0.95], [1.29, 0.995], [0.55, 0.965], [-0.45, 0.975], [-1.29, 1.0], [-2.0, 0.985], [-2.32, 0.94]]);
// 窗沿 / 车顶边线的半宽（座舱明显内收，形成两侧的平台）
const roofHW = lin([[2.34, 0.40], [0.98, 0.70], [0.45, 0.60], [-0.12, 0.50], [-0.62, 0.48], [-1.4, 0.50], [-2.32, 0.58]]);
// 车底板高度（前后略翘）
const yBot = lin([[2.34, 0.20], [2.05, 0.165], [1.7, 0.16], [-1.8, 0.16], [-2.32, 0.24]]);
// 黑色下包围上沿（= 下包围斜面与白色侧面之间的折线）：前唇 → 厚侧裙 → 后轮前斜升黑块 → 尾部黑块
export const yClad = lin([[2.34, 0.27], [2.05, 0.25], [0.86, 0.29], [-0.25, 0.35], [-0.78, 0.61], [-1.0, 0.66], [-1.75, 0.71], [-2.32, 0.78]]);

function archY(f) {
  let y = 0;
  for (const c of [AXLE, -AXLE]) {
    const d = Math.abs(f - c);
    if (d < ARCH_R) y = Math.max(y, WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - d * d));
  }
  return y;
}

const clamp01 = v => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a + (b - a) * t;
// 座舱系数：车顶比肩线高出越多越接近 1（=玻璃舱截面），前舱盖 / 车尾处为 0
const cabinK = f => clamp01((yTop(f) - yShoulder(f) - 0.02) / 0.14);
export const hasCabin = f => cabinK(f) > 0.45 && f < 1.0 && f > -2.05;

// 截面的 9 个折点（右半，从底板中心沿外轮廓到车顶中心）
// 0 底中  1 底板外缘  2 轮拱内墙顶  3 下包围斜面下沿  4 下包围上沿（最宽处）  5 肩线折边
// 6 翼子板顶 / 窗台内缘  7 车顶边线  8 车顶中心
function keys(f) {
  const w = halfW(f), yb = yBot(f), ys = yShoulder(f), yt = yTop(f);
  const ya = Math.min(ys - 0.04, Math.max(yb, archY(f)));
  const yc = Math.min(ys - 0.04, Math.max(ya, yClad(f)));
  const floor = Math.min(0.70, w * 0.84);
  const c = cabinK(f);
  // 前舱盖段：翼子板顶向内一条折线 → 斜面下到平直舱盖
  const hood6 = [w * 0.80, ys - 0.006], hood7 = [w * 0.42, mix(yt, ys, 0.12)];
  // 座舱段：窗台平台 → 内收的侧窗 → 车顶边线
  const cab6 = [Math.min(w * 0.82, roofHW(f) + 0.30), ys + 0.025], cab7 = [roofHW(f), yt - 0.035];
  return [
    [0, yb], [floor, yb], [floor, ya], [w * 0.915, ya], [w, yc], [w * 0.955, ys],
    [mix(hood6[0], cab6[0], c), mix(hood6[1], cab6[1], c)],
    [mix(hood7[0], cab7[0], c), mix(hood7[1], cab7[1], c)],
    [0, yt],
  ];
}

// 供 car.js 摆放灯具 / 喷口：侧面在高度 y 处的 x
export function sideX(f, y) {
  const k = keys(f);
  if (y <= k[3][1]) return k[3][0];
  if (y <= k[4][1]) return mix(k[3][0], k[4][0], (y - k[3][1]) / Math.max(1e-4, k[4][1] - k[3][1]));
  if (y <= k[5][1]) return mix(k[4][0], k[5][0], (y - k[4][1]) / Math.max(1e-4, k[5][1] - k[4][1]));
  return k[5][0];
}

function stations() {
  const s = new Set();
  for (let f = F_REAR; f < F_FRONT; f += 0.05) s.add(+f.toFixed(4));
  for (const fn of [yTop, yShoulder, halfW, roofHW, yClad, yBot]) for (const b of fn.breaks) s.add(b);
  for (const c of [AXLE, -AXLE]) for (let k = -10; k <= 10; k++) s.add(+(c + ARCH_R * k / 10).toFixed(4));
  s.add(F_FRONT); s.add(F_REAR);
  const out = [...s].filter(f => f >= F_REAR && f <= F_FRONT).sort((a, b) => a - b);
  return out.filter((f, i) => i === 0 || f - out[i - 1] > 0.004);
}

// 面带材质：0 白车身 / 1 黑下包围 / 2 玻璃
const STRIP_MAT = (strip, f) => {
  if (strip <= 3) return 1;
  if (strip >= 6 && hasCabin(f)) return 2;
  return 0;
};

export function buildBodyGeometry() {
  const fs = stations();
  const K = fs.map(keys);
  const pos = [], idx = [[], [], []];
  // 每个面带单独一套顶点（折线处不共享 → 硬边）；左右两侧都按"外轮廓前进方向"绕序，朝向一致
  for (const side of [1, -1]) {
    for (let s = 0; s < 8; s++) {
      const base = pos.length / 3;
      // 左侧倒序遍历（车顶中心 → 底中），镜像坐标 (−x, y)，保证整圈外轮廓方向连续
      const ka = side > 0 ? s : 8 - s, kb = side > 0 ? s + 1 : 7 - s;
      for (let i = 0; i < fs.length; i++) {
        const A = K[i][ka], B = K[i][kb];
        pos.push(side * A[0], A[1], -fs[i], side * B[0], B[1], -fs[i]);
      }
      for (let i = 0; i < fs.length - 1; i++) {
        const v = base + i * 2;
        const g = STRIP_MAT(side > 0 ? s : 7 - s, (fs[i] + fs[i + 1]) / 2);
        idx[g].push(v, v + 1, v + 3, v, v + 3, v + 2);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  const all = [...idx[0], ...idx[1], ...idx[2]];
  geo.setIndex(all);
  geo.addGroup(0, idx[0].length, 0);
  geo.addGroup(idx[0].length, idx[1].length, 1);
  geo.addGroup(idx[0].length + idx[1].length, idx[2].length, 2);
  // 绕序自检：用车顶面（右侧第 7 条面带）的面法线判断，必须朝上
  const ix = geo.index.array;
  const triNormalY = (t) => {
    const P = k => new THREE.Vector3(pos[ix[t + k] * 3], pos[ix[t + k] * 3 + 1], pos[ix[t + k] * 3 + 2]);
    const a = P(0), b = P(1), c = P(2);
    return b.sub(a).cross(c.sub(a)).y;
  };
  // 找一个位于车顶中段的三角形
  let probe = -1;
  for (let t = 0; t < ix.length; t += 3) {
    const v = ix[t];
    if (Math.abs(pos[v * 3]) < 0.25 && pos[v * 3 + 1] > 1.2) { probe = t; break; }
  }
  if (probe >= 0 && triNormalY(probe) < 0) {
    for (let t = 0; t < ix.length; t += 3) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
    geo.index.needsUpdate = true;
  }
  geo.computeVertexNormals();

  // 首尾封盖：在 yClad 折点（第 4 点）处横切，上白下黑，各自三角剖分
  const capWhite = [], capBlack = [];
  for (const [i, outZ] of [[0, 1], [fs.length - 1, -1]]) {
    const k = K[i], z = -fs[i];
    const right = k.map(([x, y]) => new THREE.Vector2(x, y));
    const ring = [...right, ...right.slice(1, -1).reverse().map(v => new THREE.Vector2(-v.x, v.y))];
    const n = right.length;   // 9
    // 白：右 4..8 + 左 7..4（ring 中左侧点下标：n + (7 - j) 对应右侧第 j 点的镜像）
    const L = j => ring[n + (7 - j)];
    const white = [...right.slice(4), ...[7, 6, 5, 4].map(L)];
    const black = [...right.slice(0, 5), ...[4, 3, 2, 1].map(L)];
    for (const [poly, out] of [[white, capWhite], [black, capBlack]]) {
      const tris = THREE.ShapeUtils.triangulateShape(poly, []);
      const ccw = THREE.ShapeUtils.isClockWise(poly) ? -1 : 1;
      for (const [a, b, c] of tris) {
        // 尾盖法线朝 +Z（outZ=1），头盖朝 −Z
        const order = ccw * outZ > 0 ? [a, b, c] : [a, c, b];
        for (const q of order) out.push(poly[q].x, poly[q].y, z);
      }
    }
  }
  const capGeo = arr => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((arr.length / 3) * 2).fill(0), 2));
    g.computeVertexNormals();
    return g;
  };
  return { geo, capWhite: capGeo(capWhite), capBlack: capGeo(capBlack) };
}
