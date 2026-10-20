/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// 极简几何合并：把同材质的静态 Mesh 烘焙到同一个 BufferGeometry，压 draw call。
import * as THREE from 'three';

export function mergeGeometries(geos) {
  const parts = geos.map(g => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

// 合并 group 内（相对 group）所有满足 filter 的单材质 Mesh；返回新的合并 Mesh 列表
export function mergeByMaterial(group, filter = () => true) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const victims = [];
  group.traverse(o => {
    if (!o.isMesh || Array.isArray(o.material) || !filter(o)) return;
    const g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(g);
    victims.push(o);
  });
  for (const v of victims) v.parent.remove(v);
  const out = [];
  for (const [mat, geos] of buckets) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    group.add(m); out.push(m);
  }
  return out;
}
