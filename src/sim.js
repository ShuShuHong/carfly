/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// 纯逻辑仿真层：不依赖 three.js，可在 node 里跑测试。
// 坐标：+X 右、+Y 上、+Z 前（行驶方向）。y = 车底离地高度。yaw 恒为 0。
import { CFG, OPEN, LANES, PAR_TIME } from './config.js';

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

// 带符号的到 0 最短夹角，(−π, π]
export function wrapPi(a) {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
}
const HL = CFG.car.L / 2, HW = CFG.car.W / 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 到 0 的最短夹角（弧度，非负）。roll 为累积弧度，不取模。
export function rollOffset(roll) {
  let r = (roll + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return Math.abs(r - Math.PI);
}

export class Sim {
  constructor(seed = Date.now()) {
    this.rand = mulberry32(seed);
    this.reset();
  }

  rr(a, b) { return a + (b - a) * this.rand(); }

  reset() {
    this.t = 0;               // 比赛计时（倒计时结束后开始）
    this.finished = false;
    this.events = [];
    this.c = {
      x: LANES.own[1], y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      roll: 0, w: 0, spinStart: 0, apexDone: false,
      air: false, airT: 0, airStartRoll: 0, revsScored: 0, airMaxY: 0,
      roofOn: 0, roofT: 0, roofHitAir: false,
      thrusting: false, rolling: 0, punchT: 0, braking: false,
      launchArmed: true, canRearm: false,
      flipT: 0, invuln: 0,
      // v1.3 自动稳姿状态
      freeT: 0, assisting: false, levelDir: 0, assistBoost: false,
      retro: 0, retroOn: false, retroI: 0, retroErr: 0, assistNotified: false,
    };
    this.assistGas = 0;          // 本场自动稳姿累计耗气（结算/调参用）
    this.gas = { base: CFG.gas.initial, earned: 0, earnedTotal: 0, emptyNotified: false };
    this.score = { total: 0, pending: 0, combo: 0, rolls: 0, hurdles: 0, perfect: 0, flips: 0, crashes: 0 };
    this.trucks = [];
    this.nextId = 1;
    this.spawnOwnAt = CFG.trucks.first;
    this.spawnOncAt = Infinity;
    this.firstTruck = true;
    this.waveKind = 'truck';          // 车型按波交替的游标（教学那波是货车，所以下一波先给轿车）
    this.draft = { id: null, t: 0, gap: 0, cooldown: new Map() };
    this.wrongWay = false;
    this.wrongWayAcc = 0;
    // v1.6 冲线收尾：过线后进入滑停段（不再接受输入），停稳才出结算
    this.outroT = 0;
    this.stopped = false;
    this.outroStopT = 0;
    this.result = null;
    this.runIn = false;
    this.finishVz = 0;
    this.driftSide = 1;
  }

  get gasTotal() { return this.gas.base + this.gas.earned; }
  get progress() { return Math.min(1, this.c.z / OPEN.trackLength); }
  get earnBudget() { return Math.max(0, CFG.gas.earnMax - this.gas.earnedTotal); }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  consume(u) {
    const g = this.gas;
    const fromBase = Math.min(g.base, u);
    g.base -= fromBase; u -= fromBase;
    g.earned = Math.max(0, g.earned - u);
  }

  // 赚气入账：只有罐内空余 + 剩余可赚额度时才实际入账；溢出部分作废（不转分数）
  earn(units, src, silent = false) {
    const g = this.gas;
    const space = CFG.gas.cap - this.gasTotal;
    const amt = Math.max(0, Math.min(units, this.earnBudget, space));
    g.earned += amt; g.earnedTotal += amt;
    if (amt > 0) g.emptyNotified = false;
    if (!silent) this.emit('earn', { units: amt, wasted: units - amt, src, capped: this.earnBudget <= 0 });
    return amt;
  }

  addScore(pts, label, air = false) {
    if (air) this.score.pending += pts; else this.score.total += pts;
    if (label) this.emit('score', { pts, label, air });
  }

  zeroTrick(silent = false) {
    if (this.score.pending > 0 && !silent) this.emit('trickLost', { pts: this.score.pending, mode: 'zero' });
    this.score.pending = 0;
  }

  // v2.1 拍脑袋：车顶落地只砍一半（不是清零），四舍五入到整数分
  halveTrick(silent = false) {
    const before = this.score.pending;
    this.score.pending = Math.round(before / 2);
    if (before > 0 && !silent) this.emit('trickLost', { pts: before - this.score.pending, mode: 'half' });
  }

  // input: { throttle 0..1, brake bool, strafe -1..1, thrust bool, roll -1|0|1 }
  step(inp, dt = CFG.dt) {
    if (this.finished) { this.outroStep(dt); return; }
    const c = this.c, P = CFG;
    this.t += dt;
    c.invuln = Math.max(0, c.invuln - dt);
    c.flipT = Math.max(0, c.flipT - dt);
    const prev = { x: c.x, y: c.y, z: c.z };

    // ---------- 纵向 ----------
    let az = inp.throttle * P.lon.throttle - P.lon.k * c.vz * c.vz;
    if (inp.brake) az -= P.lon.brake;
    c.vz = Math.max(0, c.vz + az * dt);

    // S2 弹射起步判定
    if (c.vz > 10) c.canRearm = true;
    if (c.canRearm && c.vz < 5) { c.launchArmed = true; c.canRearm = false; }
    if (c.launchArmed && inp.throttle > 0.8 && c.vz < 5 && !c.air) {
      c.launchArmed = false; this.emit('launch');
    }

    // ---------- 喷气 / 横滚输入 ----------
    const hasGas = this.gasTotal > 0;
    const wantThrust = inp.thrust && hasGas;
    if (wantThrust && !c.thrusting) {
      if (c.y < 0.6) c.punchT = P.stunt.punch.dur;
      this.emit('thrustStart', { onGround: !c.air });
    }
    if (!wantThrust && c.thrusting) this.emit('thrustEnd');
    c.thrusting = wantThrust;
    c.punchT = Math.max(0, c.punchT - dt);

    let gasUse = 0;
    if (c.thrusting) gasUse += P.gas.mainCost * dt;
    const rollIn = c.air && hasGas ? inp.roll : 0;
    c.rolling = rollIn;
    if (rollIn) gasUse += P.gas.rollCost * dt;

    // ---------- v1.3 自动稳姿：右摇杆松开（没按）→ 差动扶正 + PID 落地反喷 ----------
    const A = P.assist;
    const stickFree = !inp.thrust && !inp.roll;
    c.freeT = stickFree ? c.freeT + dt : 0;
    c.levelDir = 0; c.retro = 0; c.assistBoost = false;
    c.assisting = OPEN.autoAssist && c.air && stickFree && c.freeT >= A.delay && hasGas;
    if (c.assisting) {
      if (!c.assistNotified) { c.assistNotified = true; this.emit('assist'); }
      // 1) 扶正：用车底 4 点差动产生的角加速度，把 roll 拉回最近的 0°（2π 整数倍）
      const e = wrapPi(c.roll), ae = Math.abs(e);
      if (ae > A.levelDoneDeg * D2R || Math.abs(c.w) > 0.05) {
        const wDes = -Math.sign(e) * Math.min(P.roll.wMax, Math.sqrt(2 * A.levelDecel * ae), A.levelKp * ae);
        const dw = wDes - c.w;
        const braking = c.w !== 0 && Math.sign(dw) !== Math.sign(c.w);
        const aMax = (braking ? P.roll.counter : P.roll.acc1) * dt;
        c.w += Math.max(-aMax, Math.min(aMax, dw));
        if (Math.abs(dw) > 1e-3) c.levelDir = Math.sign(dw);
        c.assistBoost = !braking && c.w !== 0;           // 辅助在"帮着转"时完成的圈不计分
        gasUse += P.gas.rollCost * dt;
        this.assistGas += P.gas.rollCost * dt;
      } else { c.roll -= e; c.w = 0; }
      // 2) 落地反喷：沿"理想下落曲线" v_t(h) = −√(vLand² + 2·decel·h) 做 PID 速度跟踪。
      //    下落越快 → 越早越久地反喷 → 越费气（耗气 = 主喷消耗 × 实际油门）
      if (c.vy < -A.vLand && rollOffset(c.roll) < A.retroRollDeg * D2R) {
        const vt = -Math.sqrt(A.vLand * A.vLand + 2 * A.decel * Math.max(0, c.y));
        const err = vt - c.vy;                            // > 0：比理想曲线掉得快
        if (err > 0) c.retroOn = true;
        if (c.retroOn) {
          const cosR = Math.max(0.3, Math.cos(c.roll));
          c.retroI = Math.max(-A.iMax, Math.min(A.iMax, c.retroI + err * dt));
          const dErr = (err - c.retroErr) / dt; c.retroErr = err;
          const ff = (P.g + A.decel) / (P.thrust * cosR);
          c.retro = Math.max(0, Math.min(1, ff + A.kp * err + A.ki * c.retroI + A.kd * dErr));
          gasUse += P.gas.mainCost * c.retro * dt;
          this.assistGas += P.gas.mainCost * c.retro * dt;
        }
      }
    } else if (!stickFree) {
      c.retroOn = false; c.retroI = 0; c.retroErr = 0;   // 玩家重新接管
    }
    if (gasUse) {
      this.consume(gasUse);
      if (this.gasTotal <= 0 && !this.gas.emptyNotified) { this.gas.emptyNotified = true; this.emit('gasEmpty'); }
    }

    // ---------- 横向（平移，不转向） ----------
    const acc = c.air ? P.lat.accAir : P.lat.accGround;
    const vmaxL = c.air ? P.lat.vAir : P.lat.vGround;
    if (Math.abs(inp.strafe) > 0) c.vx += inp.strafe * acc * dt;
    else c.vx *= Math.exp(-P.lat.damp * dt);
    if (c.vx > vmaxL) c.vx = Math.max(vmaxL, c.vx - acc * 2 * dt);
    if (c.vx < -vmaxL) c.vx = Math.min(-vmaxL, c.vx + acc * 2 * dt);

    // ---------- 竖直 + 推力投影 ----------
    let ay = -P.g;
    const throttleV = c.thrusting ? 1 : c.retro;    // 反喷同样走车底 4 点，按 cos(roll) 投影
    if (throttleV > 0) {
      ay += P.thrust * throttleV * Math.cos(c.roll);           // 有效升力 = 推力·cos(roll)
      c.vx += P.thrust * throttleV * Math.sin(c.roll) * dt;    // 侧向分量 = 推力·sin(roll)
    }
    if (c.punchT > 0 && c.y < 0.6) c.vx = 0;        // 起跳冲击期间横向锁定
    c.vy += ay * dt;

    // ---------- 横滚（车底 4 点差动；角速度曲线不均匀） ----------
    if (c.air) {
      const R = P.roll;
      if (rollIn) {
        if (c.w !== 0 && Math.sign(c.w) !== rollIn) {
          const nw = c.w + rollIn * R.counter * dt;   // 反向输入：-24 rad/s² 刹停
          if (Math.sign(nw) !== Math.sign(c.w)) { c.w = 0; c.spinStart = c.roll; }
          else c.w = nw;
        } else {
          if (c.w === 0) c.spinStart = c.roll;
          const p = (Math.abs(c.roll - c.spinStart) % TAU) / TAU;
          let a = 0, cap = R.wMax;
          if (p < R.split[0]) { a = R.acc1; cap = R.wMax; }
          else if (p < R.split[1]) { a = R.acc2; cap = R.wPeak; }
          const nw = c.w + rollIn * a * dt;
          c.w = Math.abs(nw) > cap ? rollIn * Math.max(cap, Math.abs(c.w)) : nw;
        }
      }
      // 顶点：正在滚时角速度微增 6%
      if (!c.apexDone && Math.abs(c.vy) < P.stunt.apex.vy && c.y > 1) {
        c.apexDone = true;
        if (Math.abs(c.w) > 0.5) c.w *= R.apexBonus;
        this.emit('apex');
      }
      c.roll += c.w * dt;                          // 松手：角速度保留，无阻尼

      // 圈数计分
      const revs = Math.floor(Math.abs(c.roll - c.airStartRoll) / TAU);
      while (c.revsScored < revs) {
        if (c.assistBoost) { c.revsScored++; continue; }   // 自动扶正"补完"的圈不白送分
        const mul = P.score.combo[Math.min(c.revsScored, P.score.combo.length - 1)];
        c.revsScored++;
        this.score.rolls++;
        this.score.combo = mul;
        this.addScore(P.score.roll * mul, `横滚 ×${mul}`, true);
      }
    }

    // ---------- 积分位置 ----------
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.z += c.vz * dt;
    if (c.air) c.airMaxY = Math.max(c.airMaxY, c.y);   // 本次腾空最高点（完美落地的高度门槛用）

    // 护栏
    const minX = LANES.leftEdge + HW, maxX = LANES.rightEdge - HW;
    if (c.x < minX || c.x > maxX) {
      const side = c.x < minX ? -1 : 1;
      c.x = side < 0 ? minX : maxX;
      // 撞护栏：速度 ×0.85 + 横向弹回 + 火花；0.5 s 内持续贴着不重复扣速
      if (c.y < 1.2 && this.t - (c.guardT ?? -9) > 0.5) {
        c.guardT = this.t;
        c.vz *= P.track.guardMul;
        this.emit('guardrail', { side, x: c.x + side * HW, y: 0.6, z: c.z });
      }
      c.vx = -side * Math.max(3, Math.abs(c.vx) * 0.5);
    }

    // 着地 / 离地
    if (c.y <= 0) {
      c.y = 0;
      if (c.air) this.land();
      if (c.vy < 0) c.vy = 0;
    } else if (!c.air && c.y > 0.001) {
      c.air = true; c.airT = 0; c.airStartRoll = c.roll; c.revsScored = 0;
      c.airMaxY = c.y;                                  // 重置本次腾空最高点
      c.roofOn = 0; c.roofT = 0; c.roofHitAir = false;   // 新一段腾空：清掉车顶状态
      c.apexDone = false; this.score.combo = 0;
      c.retroOn = false; c.retroI = 0; c.retroErr = 0; c.assistNotified = false;
      this.emit('takeoff');
    }
    if (c.air) c.airT += dt;

    // 压中央双黄线（地面上，一次性）
    if (!c.air && Math.sign(prev.x) !== Math.sign(c.x) && prev.x !== 0) {
      c.vz *= P.gas.medianMul;
      this.emit('median');
    }

    // 逆向行驶：车身完全进入对向车道
    this.wrongWay = c.x + HW < LANES.oncInner && c.vz > P.gas.wrongWay.minSpeed;
    if (this.wrongWay) {
      this.earn(P.gas.wrongWay.perSec * dt, 'wrong', true);
      this.score.total += P.gas.wrongWay.scorePerSec * dt;
      this.wrongWayAcc += dt;
    }

    this.updateTraffic(dt, prev);
    this.updateDraft(dt);

    if (!this.runIn && c.z >= OPEN.trackLength - 70) {
      this.runIn = true;
      this.emit('finishRunIn');                       // 距终点 70 m：门架提前点亮
    }
    if (c.z >= OPEN.trackLength) {
      this.finished = true;
      if (c.air) this.bankAir();
      // 成绩在过线这一刻冻结；之后只走急停，不再改分、不再刷车
      this.result = this.results();
      this.outroT = 0; this.stopped = false;
      this.finishVz = c.vz;                                  // 记下过线速度，急停曲线按它收
      this.driftSide = c.x >= 0 ? 1 : -1;                    // 往路外侧甩尾
      this.spawnOwnAt = Infinity; this.spawnOncAt = Infinity;
      this.emit('finish', this.result);
    }
  }

  // ---------------- 冲线急停（v1.6）----------------
  // 过线立即锁输入 + 抱死刹车：速度按 (1-k)^1.9 收到 0（默认 0.85 s），同时横向甩出去一截。
  // 空中过线也在这里把落体跑完（落地不再判翻车、不再清零，分早就结算了）。
  outroStep(dt) {
    const c = this.c, P = CFG.outro;
    this.outroT += dt;
    this.wrongWay = false;

    // 落地（若在空中过线）
    if (c.air) {
      c.vy -= CFG.g * dt;
      c.y += c.vy * dt;
      c.roll += c.w * dt;
      if (c.y <= 0) {
        const vy = c.vy;
        c.y = 0; c.vy = 0; c.air = false; c.roll = 0; c.w = 0; c.airT = 0;
        c.retroOn = false; c.retroI = 0; c.retro = 0; c.levelDir = 0;
        this.emit('land', { vy, perfect: false, banked: 0, airT: 0 });
      }
    }

    c.thrusting = false; c.rolling = 0; c.retro = 0; c.levelDir = 0; c.punchT = 0;
    c.braking = !this.stopped;

    // 纵向：抱死刹车的速度曲线（先猛后缓，末段 creep 吃干净）
    const k = Math.min(1, this.outroT / P.stopTime);
    if (!this.stopped) {
      const v0 = Math.min(this.finishVz || c.vz, P.v0max);
      let v = v0 * Math.pow(1 - k, 1.9);
      if (v <= P.creep) v -= P.creep * 1.5 * dt;
      c.vz = Math.max(0, v);
    }

    // 横向：车身甩出去（driftSide），滑到停为止；护栏照旧兜底
    if (!this.stopped) {
      const slide = P.driftSide * Math.pow(1 - k, 1.3);
      c.vx = this.driftSide * slide;
      c.x += c.vx * dt;
      const minX = LANES.leftEdge + HW, maxX = LANES.rightEdge - HW;
      if (c.x < minX) { c.x = minX; c.vx = 0; }
      if (c.x > maxX) { c.x = maxX; c.vx = 0; }
    } else {
      c.vx = 0;
    }
    c.z += c.vz * dt;

    // 交通照常走（只是不再新生），免得画面里货车冻在半路
    for (const t of this.trucks) t.z += t.dir * t.v * dt;
    this.trucks = this.trucks.filter(t => t.z > c.z - 80 && t.z < c.z + 700);

    if (!this.stopped && (this.outroT >= P.stopTime || c.vz <= 1e-3)) {
      c.vz = 0;
      this.stopped = true; this.outroStopT = this.outroT;
      this.emit('stopped');
    }
  }

  // 车停稳且过了 settle 秒 → 可以出结算面板
  get outroDone() { return this.stopped && this.outroT - this.outroStopT >= CFG.outro.settle; }

  bankAir() {
    const c = this.c;
    if (c.airT >= CFG.score.airMin) this.score.pending += CFG.score.airPerSec * c.airT;
    this.score.total += this.score.pending;
    const banked = this.score.pending;
    this.score.pending = 0;
    return banked;
  }

  land() {
    const c = this.c, P = CFG;
    const off = rollOffset(c.roll);
    const vy = c.vy;
    c.air = false;
    const deg = off * 180 / Math.PI;
    if (deg >= P.landing.safeDeg) {
      this.zeroTrick();
      c.vz *= P.landing.flipMul;
      c.flipT = P.landing.flipDur;
      this.score.flips++;
      this.emit('flip', { fromRoll: c.roll, vy });
    } else {
      let perfect = false;
      // v1.8：完美落地 = 姿态正 + 触地慢 + 本次腾空最高点够高（否则轻点点火就能刷 80 分）
      // v2.1：本段腾空里顶到过车顶（拍脑袋/你主责）→ 不再给完美落地
      const highEnough = c.airMaxY >= P.score.perfectMinH;
      if (deg < P.score.perfectRoll && Math.abs(vy) < P.score.perfectVy && highEnough && !c.roofHitAir) {
        perfect = true; this.score.perfect++;
        this.addScore(P.score.perfect, '完美落地', true);
      }
      const banked = this.bankAir();
      const clean = deg < P.score.perfectRoll && Math.abs(vy) < P.score.perfectVy;
      this.emit('land', { vy, perfect, banked, airT: c.airT, apexY: c.airMaxY, highEnough, clean });
    }
    c.roll = 0; c.w = 0; c.vy = 0;
    c.retroOn = false; c.retroI = 0; c.retro = 0; c.levelDir = 0;
    c.roofOn = 0; c.roofT = 0; c.roofHitAir = false;
    this.score.combo = 0;
  }

  // ---------------- 交通 ----------------
  // v1.9 统一车辆模型：kind='truck' | 'car'，每辆车自带 len/w/h（碰撞盒与贴顶判定都按它算）
  spawnVehicle(kind, dir, x, z) {
    const C = kind === 'car' ? CFG.cars : CFG.trucks;
    const t = {
      kind, dir, x, z,
      len: this.rr(C.len[0], C.len[1]), w: C.w, h: C.h,
      v: this.rr(C.v[0], C.v[1]),
      id: this.nextId++,
      passed: false, crashed: false, lastHit: -9, overAir: false, minClear: Infinity,
      tutorial: false, dead: false,
    };
    this.trucks.push(t);
    return t;
  }

  spawnTruck(dir, x, z) { return this.spawnVehicle('truck', dir, x, z); }
  spawnCar(dir, x, z) { return this.spawnVehicle('car', dir, x, z); }

  // 按车型挑车道：轿车偏爱左侧两股、货车偏爱右侧两股，各留 1−kindShare 的概率并线
  laneForKind(kind) {
    const C = kind === 'car' ? CFG.cars : CFG.trucks;
    if (this.rand() < C.kindShare) return C.lanes[Math.floor(this.rand() * C.lanes.length)];
    const other = [...Array(CFG.track.own).keys()].filter(i => !C.lanes.includes(i));
    return other[Math.floor(this.rand() * other.length)];
  }

  // 同车型相邻两股道（并排用）
  pairForKind(kind) {
    const C = kind === 'car' ? CFG.cars : CFG.trucks;
    const a = C.lanes[Math.floor(this.rand() * C.lanes.length)];
    const b = a + (this.rand() < 0.5 ? 1 : -1);
    return C.lanes.includes(b) ? [a, b] : [a, a === C.lanes[0] ? a + 1 : a - 1];
  }

  laneFree(x, z, gap = 40) {
    return !this.trucks.some(t => Math.abs(t.x - x) < 1 && Math.abs(t.z - z) < gap);
  }

  spawnOwnWave() {
    const c = this.c, T = CFG.trucks, p = this.progress;
    const own = this.trucks.filter(t => t.dir > 0).length;
    if (own >= T.maxOwn) return;
    const base = c.z + this.rr(240, 300);
    const put = (li, z, kind) => { const x = LANES.own[li]; if (this.laneFree(x, z)) return this.spawnVehicle(kind, 1, x, z); };

    if (this.firstTruck) {
      // 教学：第一辆货车放在玩家当前车道，并显示尾随提示（货车才有尾流，教学必须是货车）
      this.firstTruck = false;
      let li = 0, best = 99;
      LANES.own.forEach((lx, i) => { if (Math.abs(lx - c.x) < best) { best = Math.abs(lx - c.x); li = i; } });
      const t = put(li, base, 'truck');
      if (t) { t.tutorial = true; this.emit('tutorialTruck', { id: t.id }); }
      return;
    }

    // 车型按波交替 → 两种车的密度基本相等
    const kind = (this.waveKind = this.waveKind === 'truck' ? 'car' : 'truck');

    // v2.0 轿车车队：领车 + 2–3 辆同车道紧跟（速度锁死，车队不会跑散）
    if (kind === 'car' && this.rand() < CFG.cars.convoy) {
      const li = this.laneForKind('car');
      const lead = put(li, base, 'car');
      if (lead) {
        const n = CFG.cars.convoyN[0] + Math.floor(this.rand() * (CFG.cars.convoyN[1] - CFG.cars.convoyN[0] + 1));
        let prev = lead;
        for (let i = 0; i < n; i++) {
          const gap = this.rr(CFG.cars.convoyGap[0], CFG.cars.convoyGap[1]);
          // 跟车：直接 spawn（不走 laneFree，否则会被刚生成的领车挡住）；生成后按自身车长把车头对齐到 gap
          const f = this.spawnVehicle('car', 1, LANES.own[li], prev.z - prev.len / 2 - gap);
          f.z = prev.z - prev.len / 2 - gap - f.len / 2;
          f.v = lead.v;
          f.convoy = lead.id;             // 车队归属（统计用）
          f.ahead = prev.id;              // 正前方那辆车（队形保持用它，而不是用领车）
          f.gapTarget = gap;              // 目标车头间距
          prev = f;
        }
        this.emit('convoy', { id: lead.id, n });
      }
      return;
    }

    if (p < 0.25) { put(this.laneForKind(kind), base, kind); return; }
    if (p < 0.70) {
      if (this.rand() < T.sideBySide) { const [a, b] = this.pairForKind(kind); put(a, base, kind); put(b, base + this.rr(0, 6), kind); }
      else if (this.rand() < 0.5) put(this.laneForKind(kind), base, kind);
      else { const li = this.laneForKind(kind); put(li, base, kind); put(li, base + this.rr(30, 60), kind); }
      return;
    }
    // 70–100%：并排 + 连续三辆
    if (this.rand() < 0.5) {
      const [a, b] = this.pairForKind(kind); put(a, base, kind); put(b, base + this.rr(0, 6), kind);
    } else {
      const a = this.laneForKind(kind); for (let i = 0; i < 3; i++) put(a, base + i * this.rr(26, 34), kind);
      if (this.rand() < 0.4) put(this.laneForKind(kind), base + 50, kind);
    }
  }

  updateTraffic(dt, prev) {
    const c = this.c, T = CFG.trucks, p = this.progress;

    // 同向生成
    if (this.t >= this.spawnOwnAt) {
      this.spawnOwnWave();
      const boost = p > 2 / 3 ? T.lastThirdBoost : 1;
      this.spawnOwnAt = this.t + this.rr(T.every[0], T.every[1]) / boost;
    }
    // 对向生成：25% 段以后开始出现
    if (p >= 0.25 && this.spawnOncAt === Infinity) { this.spawnOncAt = this.t; this.emit('oncomingStart'); }
    if (this.t >= this.spawnOncAt) {
      const n = this.trucks.filter(t => t.dir < 0).length;
      if (n < T.maxOnc) {
        const li = Math.floor(this.rand() * LANES.onc.length);
        const z = c.z + this.rr(380, 460);          // 远超 250 m 安全距离，不会"凭空出现在眼前"
        if (this.laneFree(LANES.onc[li], z, 60)) this.spawnTruck(-1, LANES.onc[li], z);
      }
      this.spawnOncAt = this.t + this.rr(T.oncEvery[0], T.oncEvery[1]) / (p > 2 / 3 ? 1.3 : 1);
    }

    const cx0 = c.x;
    // v2.1 车顶滑行：贴住车顶期间锁高度、不受重力；滑出车顶（或超时 0.9 s）才掉下去
    if (c.roofOn) {
      const v = this.trucks.find(x => x.id === c.roofOn && !x.dead);
      const over = v && Math.abs(c.x - v.x) < HW + v.w / 2 + 0.15 && Math.abs(c.z - v.z) < v.len / 2 + HL;
      if (!over || (c.roofT ?? 0) > 0.9) { c.roofOn = 0; }
      else { c.y = v.h; c.vy = 0; c.roofT = (c.roofT ?? 0) + dt; }
    }
    // v2.0.1 车队队形保持：跟车按"目标车头间距"做 ACC 式微调，长程不会跑散
    {
      const byId = new Map(this.trucks.map(t => [t.id, t]));
      for (const t of this.trucks) {
        if (!t.convoy) continue;
        const lead = byId.get(t.ahead ?? t.convoy);
        if (!lead || lead.dead) { t.convoy = 0; continue; }
        const want = lead.z - lead.len / 2 - t.len / 2 - (t.gapTarget ?? 5);
        const err = want - t.z;                                   // >0：离得太远，需要追
        t.v = lead.v + Math.max(-2.5, Math.min(2.5, err * 0.6));   // 限幅，避免忽快忽慢
      }
    }
    for (const t of this.trucks) {
      const tzPrev = t.z;
      t.z += t.dir * t.v * dt;
      if (t.dead) continue;
      const hl = t.len / 2;
      const dx = Math.abs(c.x - t.x);
      const xOverlap = dx < HW + t.w / 2;                  // v1.9 碰撞盒按车型宽度
      const relPrev = prev.z - tzPrev, rel = c.z - t.z;
      const zOverlapNow = Math.abs(rel) < hl + HL;
      // 越车间隙跟踪（v1.9：车顶高度按车型，轿车 1.45 m / 货车 4.2 m）
      if (xOverlap && zOverlapNow && c.y >= t.h) {
        t.overAir = true;
        t.minClear = Math.min(t.minClear, c.y - t.h);
      }
      // 扫掠碰撞：上一步→当前步的相对位移区间与 AABB 求交（防高速穿模）
      const zLo = Math.min(relPrev, rel) - HL, zHi = Math.max(relPrev, rel) + HL;
      const zHit = zHi > -hl && zLo < hl;
      if (xOverlap && zHit && c.y < t.h) {
        this.collide(t, prev, relPrev, hl);
      }
      // 越过判定
      if (!t.passed) {
        if (t.dir > 0 && c.z + HL > t.z + hl + CFG.gas.overtake.lead) this.passTruck(t);
        else if (t.dir < 0 && c.z - HL > t.z + hl) this.passTruck(t);
      }
    }
    void cx0;
    this.trucks = this.trucks.filter(t => !t.dead && t.z > c.z - 80 && t.z < c.z + 700);
  }

  passTruck(t) {
    t.passed = true;
    if (t.crashed) return;          // 撞过的车不给越车分/超车气
    if (t.dir > 0) this.earn(CFG.gas.overtake.units, 'overtake');
    if (t.overAir) {
      this.score.hurdles++;
      this.addScore(CFG.score.hurdle, t.kind === 'car' ? '越轿车' : '越车', this.c.air);
      // v1.9 贴顶阈值分档：货车 1.0 m / 轿车 0.75 m（轿车更矮，同样"贴"的绝对间隙更小）
      const thr = t.kind === 'car' ? CFG.gas.closeShave.clearanceCar : CFG.gas.closeShave.clearance;
      if (t.minClear < thr) {
        this.addScore(CFG.score.shave, '贴顶越车', this.c.air);
        this.earn(CFG.gas.closeShave.units, 'shave');
      }
    }
  }

  collide(t, prev, relPrev, hl) {
    const c = this.c, T = CFG.trucks;
    const recent = this.t - t.lastHit < 1.0;
    t.lastHit = this.t;
    const wasAbove = prev.y >= t.h - 0.05;        // v1.9 车顶高度按车型
    const wasBehind = relPrev + HL <= -hl + 0.8;   // 上一步车头仍在货车尾之后
    if (recent && wasAbove) {
      // 仍压在同一辆车顶上：贴住滑行（v2.1 不再弹飞），不重复罚
      c.y = t.h; c.vy = 0;
      c.roofOn = t.id;
      return;
    }
    if (recent && t.dir > 0 && wasBehind && !wasAbove) {
      // 仍贴着同一辆车的尾：静默顶住，不重复判撞
      c.z = t.z - hl - HL - 0.05;
      c.vz = Math.min(c.vz, t.v);
      return;
    }
    if (recent && !wasAbove && !wasBehind) {
      const s = Math.sign(c.x - t.x) || 1;
      c.x = t.x + s * (HW + t.w / 2 + 0.02);
      return;
    }
    this.score.crashes++;
    t.crashed = true;
    if (wasAbove) {
      // v2.1 掉在车顶上：立刻贴住车顶滑过去（不再弹飞），并按车型判罚
      c.y = t.h; c.vy = 0;
      c.vz *= T.roofMul;                       // 顶这一下要掉速（和撞车顶一致）
      c.roofOn = t.id; c.roofT = 0;
      c.roofHitAir = true;                     // 本段腾空已经"顶到过车"，不再给完美落地
      if (!t.roofHit) {
        t.roofHit = true;
        if (t.kind === 'car') {
          // 落小轿车顶上：你主责，当次特技分全部罚没
          this.zeroTrick(true);                  // 静默：具体提示由下面的 roofCar 事件统一播
          this.emit('crash', { kind: 'roofCar', x: c.x, y: c.y, z: c.z + HL });
        } else {
          // 掉大货车顶上：拍脑袋，当次特技分砍半
          this.halveTrick(true);
          this.emit('crash', { kind: 'roofTruck', x: c.x, y: c.y, z: c.z + HL, lost: this.score.pending });
        }
      } else {
        this.emit('crash', { kind: 'roof', x: c.x, y: c.y, z: c.z + HL });   // 同一辆车二次接触：只贴住，不重复罚
      }
      return;
    }
    if (t.dir < 0 && wasBehind) {
      // 逆向迎面撞车：速度 15、特技分清零、本场已赚的气（罐里那部分）全部作废
      c.vz = CFG.gas.headOn.speed;
      this.zeroTrick();
      const lost = this.gas.earned;
      // ⚠ 只清"罐里已赚的气"，不动 earnedTotal：
      // earnBudget = earnMax − earnedTotal 是"本场还能再赚多少"的额度，把 earnedTotal 清零
      // 等于白送一整管赚气额度（撞一辆车就能重刷满黄条），是刷气漏洞。
      this.gas.earned = 0;
      t.dead = true;
      this.emit('crash', { kind: 'headon', lost, x: c.x, y: c.y + 0.6, z: c.z + HL });
      return;
    }
    if (t.dir > 0 && wasBehind) {
      // 撞货车尾：速度 = 货车 ×1.05，镜头震动，特技分清零
      c.vz = t.v * T.rearMul;
      c.z = t.z - hl - HL - 0.05;
      this.zeroTrick();
      this.emit('crash', { kind: 'rear', x: c.x, y: c.y + 0.6, z: c.z + HL });
      return;
    }
    // 侧面蹭
    const s = Math.sign(c.x - t.x) || 1;
    c.x = t.x + s * (HW + t.w / 2 + 0.02);
    c.vx = s * 5;
    c.vz *= T.sideMul;
    this.emit('crash', { kind: 'side', x: c.x - s * HW, y: c.y + 0.6, z: c.z });
  }

  updateDraft(dt) {
    const c = this.c, D = CFG.gas.draft, d = this.draft;
    let cand = null, gap = 0;
    for (const t of this.trucks) {
      if (t.dir < 0 || t.dead) continue;
      if (t.kind === 'car') continue;          // v1.9 尾流只认货车：轿车太小，没有可蹭的尾流
      if (Math.abs(c.x - t.x) > 1.2) continue;
      const g = (t.z - t.len / 2) - (c.z + HL);
      if (g < D.gap[0] || g > D.gap[1]) continue;
      if (c.vz > t.v + OPEN.draftOverMax) continue;
      if ((d.cooldown.get(t.id) || -9) > this.t) continue;
      cand = t; gap = g; break;
    }
    if (cand && (d.id === null || d.id === cand.id)) {
      d.id = cand.id; d.t += dt; d.gap = 0;
      if (d.t >= D.hold) {
        d.cooldown.set(cand.id, this.t + D.cooldown);
        this.earn(D.units, 'draft');
        this.addScore(D.score, '尾随', false);
        this.emit('draftLock', { id: cand.id });
        d.id = null; d.t = 0;
      }
    } else if (cand) {
      d.id = cand.id; d.t = dt; d.gap = 0;
    } else if (d.id !== null) {
      d.gap += dt;
      if (d.gap > D.tol) { d.id = null; d.t = 0; d.gap = 0; }
    }
    void gap;
  }

  results() {
    const time = this.t;
    const timeBonus = Math.max(0, PAR_TIME - time) * CFG.score.timePerSec;
    const earned = this.gas.earnedTotal;
    const stunt = Math.round(this.score.total);
    const final = Math.round(stunt + timeBonus + earned * CFG.score.earnedMul);
    return { time, par: PAR_TIME, timeBonus: Math.round(timeBonus), stunt, earned: Math.round(earned), final, ...this.score };
  }
}
