/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// 双摇杆输入：Pointer Events + 指针捕获 + Map<pointerId, stick>。
// 归属在 pointerdown 时按落点（左半屏/右半屏）决定，锁死到抬起；必须处理 pointercancel。
import { CFG } from './config.js';

const I = CFG.input;
const dz = v => (Math.abs(v) < I.dead ? 0 : v);
const clamp1 = v => Math.max(-1, Math.min(1, v));

export class Input {
  constructor(layer, toLogical, sticksEls) {
    this.layer = layer;
    this.toLogical = toLogical;           // (clientX, clientY) -> [lx, ly] in 1080×1920
    this.els = sticksEls;                 // { L: {ring, knob}, R: {ring, knob} }
    this.owner = new Map();               // pointerId -> 'L' | 'R'
    this.stick = { L: { on: false, x: 0, y: 0 }, R: { on: false, x: 0, y: 0 } };
    this.keys = new Set();
    this.enabled = false;

    layer.style.touchAction = 'none';
    layer.addEventListener('pointerdown', e => this.down(e), { passive: false });
    layer.addEventListener('pointermove', e => this.move(e), { passive: false });
    layer.addEventListener('pointerup', e => this.up(e));
    layer.addEventListener('pointercancel', e => this.up(e));
    layer.addEventListener('lostpointercapture', e => this.up(e));
    layer.addEventListener('contextmenu', e => e.preventDefault());

    addEventListener('keydown', e => {
      if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
  }

  releaseAll() {
    this.owner.clear();
    this.keys.clear();
    for (const k of ['L', 'R']) { this.stick[k].on = false; this.stick[k].x = this.stick[k].y = 0; this.paint(k); }
  }

  down(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const [lx, ly] = this.toLogical(e.clientX, e.clientY);
    if (ly < 700) return;                          // 上半屏不接管（避开 HUD）
    const id = lx < 540 ? 'L' : 'R';
    if ([...this.owner.values()].includes(id)) return; // 每个摇杆只认一根手指
    this.owner.set(e.pointerId, id);
    try { this.layer.setPointerCapture(e.pointerId); } catch { /* 部分浏览器对 mouse 已隐式捕获 */ }
    this.stick[id].on = true;
    this.update(id, lx, ly);
  }

  move(e) {
    const id = this.owner.get(e.pointerId);
    if (!id) return;
    e.preventDefault();
    const [lx, ly] = this.toLogical(e.clientX, e.clientY);
    this.update(id, lx, ly);
  }

  up(e) {
    const id = this.owner.get(e.pointerId);
    if (!id) return;
    this.owner.delete(e.pointerId);
    const s = this.stick[id];
    s.on = false; s.x = 0; s.y = 0;
    this.paint(id);
  }

  update(id, lx, ly) {
    const c = id === 'L' ? I.L : I.R;
    const s = this.stick[id];
    // 两轴独立取值，不做归一化（斜推时油门不掉到 0.7）
    s.x = clamp1((lx - c[0]) / I.r);
    s.y = clamp1((ly - c[1]) / I.r);
    this.paint(id);
  }

  paint(id) {
    const el = this.els[id]; if (!el) return;
    const s = this.stick[id];
    el.knob.style.transition = s.on ? 'none' : 'transform 120ms ease-out';
    el.knob.style.transform = `translate(${s.x * I.r}px, ${s.y * I.r}px)`;
    el.ring.classList.toggle('on', s.on);
  }

  read() {
    const L = this.stick.L, R = this.stick.R, k = this.keys;
    const lx = dz(L.x), ly = dz(L.y);
    let throttle = Math.max(0, -ly);
    let brake = ly > 0;
    let strafe = lx;
    let thrust = R.on;
    let roll = 0;
    if (R.on) roll = R.x <= I.rollTh * -1 ? -1 : R.x >= I.rollTh ? 1 : 0;
    if (k.has('KeyW') || k.has('ArrowUp')) throttle = 1;
    if (k.has('KeyS') || k.has('ArrowDown')) brake = true;
    if (k.has('KeyA')) strafe = -1;
    if (k.has('KeyD')) strafe = 1;
    if (k.has('Space')) thrust = true;
    if (k.has('ArrowLeft')) roll = -1;
    if (k.has('ArrowRight')) roll = 1;
    return { throttle, brake, strafe, thrust, roll };
  }
}
