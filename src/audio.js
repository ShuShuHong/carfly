/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// WebAudio 音频：manifest 只认 key。初版全部为程序合成占位音（CC0 等价，零下载），
// 后期在 AUDIO_MANIFEST 里把 key 填成文件路径即可替换，不动代码。
export const AUDIO_MANIFEST = {
  engine_loop: null, thruster_main: null, thruster_roll_left: null, thruster_roll_right: null,
  impact: null, landing: null, wind_loop: null, nitro_earn: null, wrong_way_warn: null,
  draft_lock: null, valve_empty: null, score_pop: null, bgm: null,
};

export class Audio {
  constructor() { this.ctx = null; this.muted = false; this.buffers = {}; }

  // iOS：必须在用户手势里调用（首屏"开始比赛"按钮）
  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.build();
      this.loadManifest();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
    s.buffer = b; s.connect(this.ctx.destination); s.start(0);   // 静音 buffer 占位
  }

  async loadManifest() {
    for (const [k, url] of Object.entries(AUDIO_MANIFEST)) {
      if (!url) continue;
      try { const r = await fetch(url); this.buffers[k] = await this.ctx.decodeAudioData(await r.arrayBuffer()); } catch { /* 占位继续 */ }
    }
  }

  noise(sec = 2) {
    const c = this.ctx, b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  loopNoise(filterType, freq, q = 0.7) {
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master); src.start();
    return { src, f, g };
  }

  build() {
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.7;
    const comp = c.createDynamicsCompressor(); this.master.connect(comp).connect(c.destination);
    this.noiseBuf = this.noise(2);
    // v2.0 动力音：新能源电机（三层谐波 + 逆变器啸叫），不是内燃机
    //   基频 96→640 Hz 随车速升调；2× 三角波与 4.02× 正弦微失谐做"电机齿音"；
    //   5.5 Hz 颤音 LFO 让啸叫带一点"科幻"抖动；Q=9 的窄带噪声是逆变器的高频嘶叫。
    const eg = c.createGain(); eg.gain.value = 0;
    const ef = c.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 2400; ef.Q.value = 5;
    const o1 = c.createOscillator(); o1.type = 'sine';
    const o2 = c.createOscillator(); o2.type = 'triangle';
    const o3 = c.createOscillator(); o3.type = 'sine';
    const o2g = c.createGain(); o2g.gain.value = 0.32;
    const o3g = c.createGain(); o3g.gain.value = 0.34;   // 4× 泛音给足，才有电机的"齿音"亮度
    // 颤音：±2.5 Hz 调制基频（听着像电机换流的脉动）
    const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.5;
    const lfoG = c.createGain(); lfoG.gain.value = 2.5;
    lfo.connect(lfoG); lfoG.connect(o1.frequency); lfoG.connect(o3.frequency);
    o1.connect(ef); o2.connect(o2g).connect(ef); o3.connect(o3g).connect(ef);
    ef.connect(eg).connect(this.master);
    o1.start(); o2.start(); o3.start(); lfo.start();
    this.engine = { o1, o2, o3, g: eg, f: ef };
    // 逆变器啸叫：窄带高频噪声（随车速上扫）
    this.inverter = this.loopNoise('bandpass', 2600, 9);
    this.wind = this.loopNoise('bandpass', 900, 0.5);
    // 主喷气：白噪声 + 低频轰鸣
    this.thr = this.loopNoise('highpass', 700, 0.4);
    const rum = c.createOscillator(); rum.type = 'sine'; rum.frequency.value = 48;
    const rg = c.createGain(); rg.gain.value = 0; rum.connect(rg).connect(this.master); rum.start();
    this.rumble = rg;
    // 横滚 RCS 嘶声：左右声道偏置
    this.rcs = {};
    for (const side of [-1, 1]) {
      const n = this.loopNoise('bandpass', 3800, 1.2);
      const p = c.createStereoPanner ? c.createStereoPanner() : null;
      if (p) { n.g.disconnect(); p.pan.value = side * 0.8; n.g.connect(p).connect(this.master); }
      this.rcs[side] = n;
    }
    // 逆向警示
    const wo = c.createOscillator(); wo.type = 'triangle'; wo.frequency.value = 110;
    const wl = c.createOscillator(); wl.frequency.value = 3; const wlg = c.createGain(); wlg.gain.value = 0.5;
    const wg = c.createGain(); wg.gain.value = 0; const wmod = c.createGain(); wmod.gain.value = 0.5;
    wl.connect(wlg).connect(wmod.gain); wo.connect(wmod).connect(wg).connect(this.master); wo.start(); wl.start();
    this.warn = wg;
  }

  set(param, v, tau) { if (this.ctx) param.setTargetAtTime(v, this.ctx.currentTime, tau); }

  frame(st) {
    if (!this.ctx || this.muted) return;
    const v = st.speed;
    const k = Math.min(1, v / 90);
    // 电机音：基频 96 Hz 起步 → 640 Hz 满速；三层谐波 + 逆变器啸叫同时上扫
    const f = 96 + v * 6.0;
    this.set(this.engine.o1.frequency, f, 0.05);
    this.set(this.engine.o2.frequency, f * 2, 0.05);
    this.set(this.engine.o3.frequency, f * 4.02, 0.05);        // 微失谐 → 金属"齿"感
    this.set(this.engine.f.frequency, 1400 + v * 55, 0.08);    // 滤波随速打开，越跑越亮（Q=5 → 扫动的共振峰）
    this.set(this.engine.g.gain, st.running ? 0.055 + k * 0.075 + st.throttle * 0.025 : 0, 0.1);
    this.set(this.inverter.f.frequency, 1500 + v * 52, 0.12);  // 逆变器啸叫中心频率
    this.set(this.inverter.g.gain, st.running ? 0.008 + k * 0.05 : 0, 0.15);
    this.set(this.wind.g.gain, st.running ? k * 0.2 : 0, 0.2);
    this.set(this.wind.f.frequency, 500 + v * 14, 0.2);
    // 喷气 40 ms 淡入 / 80 ms 淡出（setTargetAtTime τ = 时长/3）
    const on = st.thrust ? 1 : 0;
    this.set(this.thr.g.gain, on * 0.38 * (0.75 + 0.25 * st.pulse), on ? 0.013 : 0.027);
    this.set(this.rumble.gain, on * 0.35, on ? 0.013 : 0.027);
    this.set(this.rcs[-1].g.gain, st.roll < 0 ? 0.16 : 0, 0.02);
    this.set(this.rcs[1].g.gain, st.roll > 0 ? 0.16 : 0, 0.02);
    this.set(this.warn.gain, st.wrongWay ? 0.05 + st.danger * 0.14 : 0, 0.08);   // warn 是 GainNode，不是 AudioParam
    // 顶点：一声极轻的风声空档 0.12 s
    if (st.apexDip) { const t = this.ctx.currentTime; this.wind.g.gain.cancelScheduledValues(t); this.wind.g.gain.setValueAtTime(0.02, t); }
  }

  oneShot(key, opt = {}) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    if (this.buffers[key]) { const s = c.createBufferSource(); s.buffer = this.buffers[key]; const g = c.createGain(); g.gain.value = opt.vol ?? 1; s.connect(g).connect(this.master); s.start(); return; }
    const env = (node, peak, a, d) => { const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); node.connect(g).connect(this.master); return g; };
    const nz = (type, freq, q, peak, a, d) => { const s = c.createBufferSource(); s.buffer = this.noiseBuf; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; s.connect(f); env(f, peak, a, d); s.start(t); s.stop(t + a + d + 0.05); };
    const tone = (type, f0, f1, peak, a, d) => { const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + a + d); env(o, peak, a, d); o.start(t); o.stop(t + a + d + 0.05); };
    switch (key) {
      case 'impact':
        if (this._lastImpact && t - this._lastImpact < 0.25) return;      // 一次一触发，不叠加
        this._lastImpact = t;
        nz('lowpass', 900, 0.8, 0.8, 0.003, 0.35); nz('highpass', 4000, 0.6, 0.35, 0.002, 0.5); tone('square', 140, 50, 0.3, 0.002, 0.25); break;
      case 'landing': tone('sine', 90, 38, 0.25 + 0.35 * (opt.k ?? 0.5), 0.004, 0.22); nz('lowpass', 300, 0.7, 0.25 * (opt.k ?? 0.5), 0.003, 0.15); break;
      case 'nitro_earn': tone('sine', 660, 1320, 0.12, 0.01, 0.18); tone('triangle', 990, 1760, 0.06, 0.02, 0.16); break;
      case 'draft_lock': tone('square', 330, 330, 0.08, 0.002, 0.06); tone('sine', 880, 880, 0.1, 0.05, 0.15); break;
      case 'valve_empty': nz('bandpass', 2400, 3, 0.25, 0.002, 0.12); tone('sine', 300, 120, 0.12, 0.002, 0.1); break;
      case 'score_pop': tone('triangle', 880, 1100, 0.06, 0.005, 0.1); break;
      case 'launch': nz('lowpass', 1500, 0.7, 0.3, 0.01, 0.6); break;
      // v1.6 冲线：两音上行 + 高频气声扫过（音量克制，不与胎噪/引擎抢）
      case 'finish':
        tone('sine', 784, 784, 0.13, 0.004, 0.34);
        tone('sine', 1175, 1175, 0.10, 0.004, 0.42);
        nz('highpass', 5200, 0.7, 0.22, 0.005, 0.85);
        break;
      case 'guard': nz('highpass', 2500, 1, 0.3, 0.002, 0.25); break;
      default: break;
    }
  }
}
