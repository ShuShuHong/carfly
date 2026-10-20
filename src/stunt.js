/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// 喷气特技表现层（验收第一优先级）：掀（punch）→ 甩（whip）→ 砸（plant）。
// 物理在 sim.js；这里只叠视觉：起跳冲击、顶点失重、角速度附加运动、落地悬挂、4 点脉冲 RCS + 差动、C 组偏航点喷。
import * as THREE from 'three';
import { CFG } from './config.js';

const S = CFG.stunt;
const D2R = Math.PI / 180;
const clamp01 = v => Math.max(0, Math.min(1, v));
const smooth = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Stunt {
  constructor(car, fx, world) {
    this.car = car; this.fx = fx; this.world = world;
    // v1.5 起步尾喷照亮路面 / 反喷照亮落点
    this.rearLight = new THREE.PointLight(0xbfe0ff, 0, 18, 2);
    this.retroLight = new THREE.PointLight(0x9fd0ff, 0, 16, 2);
    world.scene.add(this.rearLight, this.retroLight);
    this.reset();
  }

  reset() {
    this.time = 0;
    this.punchT = -1; this.launchT = -1; this.landT = -1; this.landK = 0;
    this.apexT = -1; this.flipT = -1; this.flipSide = 1; this.dentT = 0;
    this.thrustOnT = -9; this.intens = [0, 0, 0, 0]; this.cInt = [0, 0]; this.cFire = [0, 0];
    this.yaw = 0; this.yawSign = 0; this.pitchAir = 0;
    this.shakePx = 0; this.impactT = -1; this.landShake = 0;
    this.mistAcc = 0; this.smokeAcc = 0; this.wheelRot = 0;
    this.rearT = -1; this.rearAcc = 0; this.retroAcc = 0; this.retroSm = 0;
    this.cam = { dip: 0, back: 0, rise: 0 };
    // v1.6 冲线甩尾（纯表现，不进物理）：偏航/侧倾/点头各自平滑
    this.driftYaw = 0; this.driftRoll = 0; this.driftPitch = 0; this.driftSide = 1; this.smokeAcc = 0;
    // v1.6 起步尾喷（A 组 4 根）
    this.aT = -1; this.aI = [0, 0, 0, 0]; this.aSum = 0;
    // 刹车时尾灯加亮（M.tail 是共用材质，全车尾灯一起亮，正好符合"踩刹车"）
    if (this.tailBase === undefined) {
      this.tailBase = this.car.M.tail.color.clone();
      this.tailBrake = this.car.M.tail.color.clone().multiplyScalar(1.9);
    }
    this.car.M.tail.color.copy(this.tailBase);
  }

  on(e) {
    switch (e.type) {
      case 'thrustStart': this.thrustOnT = this.time; if (e.onGround) this.punchT = 0; break;
      case 'launch': this.launchT = 0; this.rearT = 0; this.aT = 0; this.fx.launchSmoke(this.x ?? 0, this.zw ?? 0); break;
      case 'stopped': this.aT = -1; for (let i = 0; i < 4; i++) this.aI[i] = 0; break;
      case 'apex': this.apexT = 0; break;
      case 'land': {
        this.landT = 0; this.landK = clamp01(Math.abs(e.vy) / 20);
        this.pitchAir = 0; this.yaw = 0;
        this.landShake = 3 + 5 * this.landK;
        this.fx.dustRing(this.x, this.zw, 1.2 + 0.8 * this.landK);
        // v1.7 落地反喷的白烟：触地瞬间连补三记向下炸开的烟（反喷气流打到地面）
        this.fx.retroBlast(this.x, this.zw, 0.3, 1.8 + 0.8 * this.landK);
        this.fx.retroBlast(this.x, this.zw, 0.5, 1.5 + 0.6 * this.landK);
        this.fx.retroBlast(this.x, this.zw, 0.8, 1.2 + 0.4 * this.landK);
        break;
      }
      case 'flip': {
        this.flipT = 0;
        let r = (e.fromRoll + Math.PI) % (Math.PI * 2); if (r < 0) r += Math.PI * 2; r -= Math.PI;
        this.flipSide = Math.sign(r) || 1;
        this.pitchAir = 0; this.yaw = 0;
        this.landShake = 8; this.fx.dustRing(this.x, this.zw, 1.4);
        break;
      }
      case 'crash': this.impactT = 0; if (e.kind === 'rear' || e.kind === 'headon') this.dentT = 2.5; break;
      default: break;
    }
  }

  // s：插值后的车辆状态 {x,y,z,roll,vy,vz,air,thrusting,rolling,w}
  frame(dt, s) {
    const c = this.car, P = S.punch;
    this.time += dt;
    this.x = s.x; this.zw = -s.z;
    let setback = 0, pitch = 0, susp = 0, camDip = 0, camBack = 0, shake = 0, lift = 0, visRoll = 0;

    // ---- S3 起跳冲击（0–180 ms）----
    if (this.punchT >= 0) {
      const t = (this.punchT += dt) * 1000;
      const k = t < 60 ? t / 60 : t < 180 ? 1 - (t - 60) / 120 : 0;
      setback += P.setback * k; pitch += P.pitch * k;
      camDip -= P.camDip * (t < 40 ? 0 : t < 120 ? (t - 40) / 80 : Math.max(0, 1 - (t - 120) / 180));
      shake = Math.max(shake, t < 40 ? P.shake[0] : t < 120 ? P.shake[0] + (P.shake[1] - P.shake[0]) * (t - 40) / 80 : t < 180 ? P.shake[1] * (1 - (t - 120) / 60) : 0);
      if (t > 300) this.punchT = -1;
    }
    // ---- S2 弹射起步：车头 +2.5°/0.25 s，悬挂压缩 0.04，相机后坐 0.18/0.3 s ----
    if (this.launchT >= 0) {
      const t = (this.launchT += dt);
      const k = t < 0.25 ? Math.sin(Math.PI * t / 0.25) : 0;
      pitch += 2.5 * k; susp -= 0.04 * k;
      camBack += 0.18 * (t < 0.06 ? t / 0.06 : Math.max(0, 1 - (t - 0.06) / 0.3));
      if (t > 0.5) this.launchT = -1;
    }
    // ---- 空中 pitch：上升 +4 → −2，下坠微微上抬；滚转时噪声 ±2° ----
    if (s.air) {
      const target = s.vy > 0 ? -2 : 1.5;
      this.pitchAir = smooth(this.pitchAir, target, dt, 0.35);
      pitch += this.punchT >= 0 ? 0 : this.pitchAir;
      if (Math.abs(s.w) > 0.5) {
        const t = this.time;
        pitch += S.pitchJitter * (0.6 * Math.sin(t * 5.3) + 0.4 * Math.sin(t * 8.9 + 1.3));
      }
    }
    // ---- 甩滚：±6° yaw 漂移，正负交替，由 C 组前侧 2 喷口点喷 ----
    let yawTarget = 0;
    if (s.air && Math.abs(s.w) > 0.5) {
      const sg = Math.sin(s.roll + 0.6) >= 0 ? 1 : -1;
      if (sg !== this.yawSign) { this.yawSign = sg; this.cFire[sg > 0 ? 1 : 0] = 0.12; }  // 车头左偏 ← 右侧点喷
      yawTarget = S.yawDrift * sg;
    } else this.yawSign = 0;
    this.yaw = smooth(this.yaw, yawTarget, dt, 0.18);

    // ---- S6 干脆落地：0.08 s 压 0.10 → 0.10 s 回弹 +0.02 → 归位，总 0.30 s，最多 1 次微弹 ----
    if (this.landT >= 0) {
      const t = (this.landT += dt), A = S.land.comp * (0.55 + 0.45 * this.landK), R = S.land.reb * (0.55 + 0.45 * this.landK);
      susp += t < 0.08 ? -A * (t / 0.08) : t < 0.18 ? -A + (A + R) * ((t - 0.08) / 0.10) : t < 0.30 ? R * (1 - (t - 0.18) / 0.12) : 0;
      camDip -= S.land.camDip * (t < 0.06 ? t / 0.06 : Math.max(0, 1 - (t - 0.06) / S.land.camRet));
      shake = Math.max(shake, this.landShake * Math.max(0, 1 - t / 0.25));
      if (t > 0.4) this.landT = -1;
    }
    // ---- 顶点失重：相机上抬 0.08 m / 0.2 s ----
    let apexScale = 1;
    if (this.apexT >= 0) {
      const t = (this.apexT += dt);
      this.cam.rise = S.apex.camRise * (t < 0.2 ? t / 0.2 : Math.max(0, 1 - (t - 0.2) / 0.4));
      if (t < 0.6) apexScale = S.apex.particle;
      if (t > 0.6) { this.apexT = -1; this.cam.rise = 0; }
    }
    // ---- 翻车：侧翻 0.6 s 后自动扶正 ----
    if (this.flipT >= 0) {
      const u = (this.flipT += dt) / CFG.landing.flipDur;
      const amp = u < 0.25 ? u / 0.25 : Math.max(0, 1 - (u - 0.25) / 0.75);
      const e = Math.sin(amp * Math.PI / 2);
      visRoll = this.flipSide * (Math.PI / 2) * e;
      lift = 0.42 * e;
      if (u >= 1) this.flipT = -1;
    }
    // ---- 撞击震动 12 px / 0.4 s ----
    if (this.impactT >= 0) {
      const t = (this.impactT += dt);
      shake = Math.max(shake, CFG.cam.shakeImpact * Math.max(0, 1 - t / CFG.cam.impactDecay));
      if (t > CFG.cam.impactDecay) this.impactT = -1;
    }
    if (s.thrusting) shake = Math.max(shake, CFG.cam.shakeThrust);

    // ---- v1.6 冲线甩尾急停：车身甩出去 → 停稳后回正 ----
    const O = CFG.outro;
    if (s.finished) {
      const sliding = !s.stopped;
      // 甩尾方向 = sim 给的外侧方向
      const side = this.driftSide = (s.driftSide || 1);
      const tau = sliding ? 0.10 : 0.22;
      const yawT = sliding ? -side * O.driftYaw : 0;             // 车尾向右甩 = 车头向左偏
      const rollT = sliding ? side * O.driftRoll : 0;
      const pitchT = sliding ? O.driftPitch : 0;                 // 急刹点头
      this.driftYaw += (yawT - this.driftYaw) * (1 - Math.exp(-dt / tau));
      this.driftRoll += (rollT - this.driftRoll) * (1 - Math.exp(-dt / tau));
      this.driftPitch += (pitchT - this.driftPitch) * (1 - Math.exp(-dt / 0.08));
      if (sliding) {
        this.yaw = this.driftYaw;
        shake = Math.max(shake, 1.6 + 2.4 * Math.max(0, s.vz / 40));
        // 四轮抱死白烟：从后轮位置冒出来，别往镜头方向喷（否则会变成糊在镜头前的大光斑）
        this.smokeAcc += dt * O.smoke * Math.min(1, s.vz / 25);
        while (this.smokeAcc > 1) {
          this.smokeAcc--;
          this.fx.tireSmoke(s.x + (Math.random() - 0.5) * 1.8, -s.z + 2.2 + (Math.random() - 0.5) * 0.5, 0.6 + 0.4 * Math.min(1, s.vz / 25), O.smokeA);
        }
      }
    }
    this.shakePx = shake;
    this.cam.dip = camDip; this.cam.back = camBack;
    this.dentT = Math.max(0, this.dentT - dt);

    // ---- 应用到模型 ----
    c.root.position.set(s.x, s.y + lift, -s.z);
    c.rollPivot.rotation.set(0, 0, -(s.roll + visRoll + this.driftRoll * D2R));   // roll>0 = 向右滚（从车后看顺时针）
    c.att.rotation.set((pitch + this.driftPitch) * D2R, this.yaw * D2R, 0, 'YXZ');
    c.att.position.set(0, susp, setback);                      // 后坐：沿 -Z(行驶反方向) → three +Z
    c.att.scale.set(1, 1, 1 - 0.025 * Math.min(1, this.dentT));
    this.wheelRot -= (s.vz / CFG.car.wheelR) * dt;              // 车轮空转，转速随车速
    for (const w of c.wheels) { w.rotation.x = this.wheelRot; w.position.y = 0.39 - (s.air ? 0 : susp); }

    this.nozzles(dt, s, apexScale);
  }

  nozzles(dt, s, apexScale) {
    const c = this.car, R = S, t = this.time;
    // 有效净加速度 → 喷锥长度（正加速长，接近顶点短）
    const net = CFG.thrust * Math.cos(s.roll) - CFG.g;
    const kAcc = clamp01(0.45 + net / 36);
    let sum = 0;
    // v1.3 自动稳姿的视觉：扶正 = 只有一侧 2 点点喷（纯差动）；落地反喷 = 4 点按 PID 油门齐喷
    const retro = s.thrusting ? 0 : (s.retro || 0);
    const levelDir = s.thrusting || s.rolling ? 0 : (s.levelDir || 0);
    if (retro > 0.02 && !this.retroVis) { this.retroVis = true; this.thrustOnT = t; }
    if (retro <= 0.02) this.retroVis = false;
    c.B.forEach((b, i) => {
      const delay = b.rear ? R.rearDelay : 0;                 // 后二点比前二点晚 30 ms
      const since = t - this.thrustOnT - delay;
      // 目标亮度：主喷 1 / 反喷 = PID 油门 / 扶正时该侧 0.45
      let target = 0;
      if (s.thrusting && since >= 0) target = 1;
      else if (retro > 0.02 && since >= 0) target = 0.35 + 0.65 * retro;
      else if (levelDir && b.side === levelDir) target = 0.45;
      const cur = this.intens[i];
      const rate = target > cur ? dt / R.fadeIn : dt / R.fadeOut;   // 40 ms 淡入 / 80 ms 淡出
      this.intens[i] = target > cur ? Math.min(target, cur + rate) : Math.max(target, cur - rate);
      const on = target > 0;
      const ph = ((since % R.pulse) + R.pulse) % R.pulse / R.pulse;
      const pulse = on ? (ph < R.duty ? 1 : 0.28) : 1;       // 80 ms 脉冲，占空比 70%
      // 差动：往左滚 → 左二 ×1.6 / 右二 ×0.4（扶正时同理，由 levelDir 决定哪侧强）
      let diff = 1;
      const dirIn = s.rolling || levelDir;
      if (dirIn && (s.thrusting || retro > 0.02)) diff = b.side === dirIn ? R.diff[0] : R.diff[1];
      const I = this.intens[i] * pulse * (0.65 + 0.35 * diff) * (apexScale > 1 ? 0.82 : 1);
      const len = (R.cone[0] + (R.cone[1] - R.cone[0]) * kAcc) * (0.55 + 0.45 * diff) * (0.85 + 0.15 * pulse);
      const u = b.mesh.material.uniforms; u.uI.value = I; u.uT.value = t;
      b.mesh.scale.set(apexScale, Math.max(0.05, len), apexScale);
      b.mesh.visible = I > 0.01;
      sum += I;
      // 冷气残雾（世界坐标）
      if (I > 0.3 && Math.random() < dt * 70) {
        b.mesh.getWorldPosition(_v); b.mesh.getWorldQuaternion(_q);
        _d.set(0, -1, 0).applyQuaternion(_q);
        this.fx.plumeMist(_v.x + _d.x * len * 0.6, _v.y + _d.y * len * 0.6, _v.z + _d.z * len * 0.6, _d.x, _d.y, _d.z, apexScale);
      }
    });
    // 地面白烟：喷口靠近地面时打散（v1.7：反喷时更猛，且额外向下炸开一层）
    if ((s.thrusting || retro > 0.3) && s.y < 5) {
      const near = Math.min(1, 1 - s.y / 5);                 // 越贴地越浓
      this.smokeAcc += dt * (s.thrusting ? 40 : 0) * (0.4 + 0.6 * near)
        + dt * 150 * retro * (0.35 + 0.65 * near);
      while (this.smokeAcc > 1) { this.smokeAcc--; this.fx.liftSmoke(s.x, s.y, -s.z, Math.abs(Math.cos(s.roll))); }
    }
    // 反喷下压气流：车底 4 点往下喷时，气流打到路面再向四周炸开（retroBlast 之前一直没接上）
    if (retro > 0.08) {
      this.retroAcc += dt * 80 * retro * Math.min(1, 1 - Math.min(1, s.y / 6));
      while (this.retroAcc > 1) {
        this.retroAcc--;
        // 发射点略靠车前（-z 方向），否则烟雾全散在镜头脚下、看不见
        this.fx.retroBlast(s.x, -s.z - 0.8, Math.min(s.y, 6), 0.9 + 0.7 * retro);
      }
    }
    // C 组偏航点喷
    c.C.forEach((n, i) => {
      this.cFire[i] = Math.max(0, this.cFire[i] - dt);
      this.cInt[i] = clamp01(this.cInt[i] + (this.cFire[i] > 0 ? dt / 0.03 : -dt / 0.08));
      const u = n.mesh.material.uniforms; u.uI.value = this.cInt[i] * 0.9; u.uT.value = t;
      n.mesh.visible = this.cInt[i] > 0.01;
    });
    // 车底蓝白补光（照到路面上）
    const L = this.world.underGlow;
    L.intensity = sum * 8 * Math.max(0, Math.cos(s.roll));
    L.position.set(s.x, s.y + 0.05, -s.z);

    this.rearJets(dt, s);
    // 刹车：尾灯加亮（冲线滑停段才亮）
    c.M.tail.color.copy(s.braking ? this.tailBrake : this.tailBase);
  }

  // ---------------- v1.6 起步：A 组 4 根尾喷口喷白色冷气 ----------------
  // 包络：点火 50 ms 冲满 → 50% 时长平台（冷气脉冲）→ 指数衰减收尾；
  // 视觉三层：喷焰锥（近白→冷蓝）+ 尾部白气粒子 + 一盏照亮后方路面的点光。
  rearJets(dt, s) {
    const c = this.car, A = S.launchA, t = this.time;
    if (this.aT >= 0) {
      this.aT += dt;
      const u = this.aT / A.dur;
      if (u >= 1) { this.aT = -1; this.aI.fill(0); }
      else {
        const env = u < A.ramp / A.dur ? u / (A.ramp / A.dur)
          : u < A.plateau ? 1
            : Math.pow(1 - (u - A.plateau) / (1 - A.plateau), 1.7);
        // 4 根管口不同相位，避免四道气柱完全同步（真实气瓶放气不会整齐）
        for (let i = 0; i < 4; i++) {
          const off = ((this.aT * 1000 + i * 13) % A.pulseMs) / A.pulseMs;
          this.aI[i] = env * (off < A.duty ? 1 : 0.42);
        }
      }
    }
    let sum = 0;
    c.tubes.forEach((pl, i) => {
      const I = this.aI[i] || 0;
      sum += I;
      const u = pl.material.uniforms;
      u.uI.value = I * 0.9;
      u.uT.value = t;
      const len = A.len[0] + (A.len[1] - A.len[0]) * I;
      pl.scale.set(1 + 0.3 * I, Math.max(0.02, len), 1 + 0.3 * I);
      pl.visible = I > 0.01;
      // 喷口亮点：4 个点跟着脉冲亮暗，正后方一眼能数出 4 台喷口
      const gl = c.tubeGlow[i];
      if (gl) {
        gl.visible = I > 0.02;
        if (gl.visible) {
          gl.material.opacity = Math.min(1, I * 0.95);
          const k = (0.55 + 0.75 * I) * (0.85 + 0.3 * Math.random());
          gl.scale.set(k, k, 1);
        }
      }
      // 白气：沿喷口朝向（局部 -Y → 世界车后）喷出
      if (I > 0.18) {
        pl.getWorldPosition(_v); pl.getWorldQuaternion(_q);
        _d.set(0, -1, 0).applyQuaternion(_q);
        // 近口蓝白高速气柱（发光核心）：负责"喷"的方向感
        if (Math.random() < dt * 40 * I) this.fx.rearJet(_v.x, _v.y, _v.z + 0.15, 0.7 + 0.35 * I);
        // 外侧白色气团：负责"白色气体"的体积感（每 tick 3 颗小颗粒，凑成连续的雾）
        const n = Math.random() < dt * 95 * I ? 3 : 0;
        for (let j = 0; j < n; j++) {
          const d0 = 0.25 + Math.random() * len * 0.75;
          this.fx.nozzleVapor(
            _v.x + _d.x * d0 + (Math.random() - 0.5) * 0.18,
            _v.y + _d.y * d0,
            _v.z + _d.z * d0,
            _d.x, _d.y, _d.z, 0.8 + 0.7 * I,
          );
        }
        // 贴地白雾：起步瞬间车尾地面被吹起来（让气流有落点，不是飘在空中）
        if (Math.random() < dt * 26 * I) this.fx.rearSmoke(s.x, this.zw + 2.0, 0.9 + 0.3 * I);
      }
    });
    this.aSum = sum / 4;
    // 尾喷照亮后方路面（压低到贴地位置，只照路面不糊车身）
    this.rearLight.position.set(s.x, 0.3, -s.z + 3.4);
    this.rearLight.intensity = this.aSum * A.light * 2.2;
  }
}
