/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// HUD：DOM 覆盖层（不画进 WebGL）。所有文字只在这一层。
import { CFG } from './config.js';
import { TEXT } from './text.js';

// 注意：#wrong-edge / #speed-lines 在 #hud 外层（#game 下），所以统一从 document 查找
const $ = s => {
  const el = document.querySelector(s);
  if (!el) throw new Error(`HUD element missing: ${s}`);
  return el;
};

export class Hud {
  constructor(root) {
    this.root = root;
    this.el = {
      speed: $('#hud-speed', root), score: $('#hud-score', root), combo: $('#hud-combo', root),
      gasFill: $('#gas-fill', root), gasEarn: $('#gas-earn', root), gasBar: $('#gas-bar', root), gasCap: $('#gas-cap', root),
      floats: $('#hud-floats', root), pops: $('#hud-pops', root), wrong: $('#wrong-edge', root), wrongRate: $('#wrong-rate', root),
      ring: $('#draft-ring', root), ringArc: $('#draft-arc', root), tip: $('#hud-tip', root),
      prog: $('#prog-fill', root), lines: $('#speed-lines', root), pending: $('#hud-pending', root),
    };
    this.tipT = 0; this.lastScore = -1; this.lastSpeed = -1;
  }

  floatGas(text, wasted) {
    const d = document.createElement('div');
    d.className = 'float' + (wasted ? ' wasted' : '');
    d.textContent = text;
    this.el.floats.appendChild(d);
    setTimeout(() => d.remove(), CFG.gas.hud?.floatMs ?? 650);
  }

  pop(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'pop ' + cls;
    d.textContent = text;
    this.el.pops.appendChild(d);
    while (this.el.pops.children.length > 4) this.el.pops.firstChild.remove();
    setTimeout(() => d.remove(), 1100);
  }

  tip(text, sec = 3) { this.el.tip.textContent = text; this.el.tip.classList.add('show'); this.tipT = sec; }

  // 结算/切场时立即收起提示，否则会在结算面板下半透明透出、压住成绩表
  hideTip() { this.tipT = 0; this.el.tip.classList.remove('show'); }

  // 冲线瞬间清掉还在飘的得分字（"完美落地 +80"之类），别压在冲线画面上
  clearPops() { this.el.pops.textContent = ''; this.el.floats.textContent = ''; }

  update(dt, sim, ctx) {
    const c = sim.c, e = this.el;
    const kmh = Math.round(c.vz * 3.6);
    if (kmh !== this.lastSpeed) { e.speed.textContent = kmh; this.lastSpeed = kmh; }
    const sc = Math.round(sim.score.total);
    if (sc !== this.lastScore) { e.score.textContent = sc.toLocaleString('en-US'); this.lastScore = sc; }
    e.combo.textContent = sim.score.combo > 1 ? TEXT.combo(sim.score.combo) : '';
    e.pending.textContent = c.air && sim.score.pending > 0 ? `+${Math.round(sim.score.pending)}` : '';

    // 气量条：从下往上填充；<20% 红色 0.8 Hz 脉冲；耗尽灰化；满罐白线封顶
    const g = sim.gasTotal / CFG.gas.cap;
    e.gasFill.style.transform = `scaleY(${g})`;
    e.gasBar.classList.toggle('low', g < CFG.gas.warn && g > 0);
    e.gasBar.classList.toggle('empty', g <= 0);
    e.gasCap.classList.toggle('on', g >= 0.999);
    // 可赚额标记：本场剩余可赚额度（100→0），赚满后熄灭
    const eb = sim.earnBudget / CFG.gas.earnMax;
    e.gasEarn.style.transform = `scaleY(${eb})`;
    e.gasEarn.classList.toggle('off', eb <= 0);

    e.wrong.classList.toggle('on', sim.wrongWay);
    e.wrongRate.classList.toggle('on', sim.wrongWay);

    // 尾随进度环：贴在前车尾部（屏幕投影）
    const d = sim.draft;
    if (d.id !== null && ctx.ringPos) {
      e.ring.style.display = 'block';
      e.ring.style.transform = `translate(${ctx.ringPos[0]}px, ${ctx.ringPos[1]}px) translate(-50%,-50%) scale(${ctx.ringPos[2]})`;
      const p = Math.min(1, d.t / CFG.gas.draft.hold);
      e.ringArc.style.strokeDashoffset = String(283 * (1 - p));
    } else e.ring.style.display = 'none';

    e.prog.style.transform = `scaleX(${sim.progress})`;
    // 速度线只在比赛段出现；冲线滑停/结算时强制归零（原来 c.vz 被冻住，线条会一直糊在画面上）
    const blur = Math.max(0, Math.min(1, (c.vz - CFG.cam.blurSpeed) / 25)) * 0.85 * (ctx.speedFx ?? 1);
    e.lines.style.opacity = String(blur);

    if (this.tipT > 0) { this.tipT -= dt; if (this.tipT <= 0) e.tip.classList.remove('show'); }
  }
}
