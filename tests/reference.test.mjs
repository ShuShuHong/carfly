/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// 验收基准自测：对应 参数表 computed_reference_cases 与 需求 §12。运行：node tests/reference.test.mjs
// v1.7 注：g 16→18、thrust 34→36（g 是参数表标 tunable 12–20 的项）。
//   上升段净加速度仍为 18 m/s²，所以"喷 0.70 s 离地 4.4 m / 越 4.2 m 货车"不变；
//   顶点与滞空按 g=18 重算（下落更快，正是本次调参目的）。改 g 请同步这里的期望值。
import { Sim, rollOffset } from '../src/sim.js';
import { CFG, OPEN } from '../src/config.js';

// 参数表的基准值是"纯物理"推导（无自动稳姿），先关掉辅助跑基准，最后单独测辅助
OPEN.autoAssist = false;

let fail = 0;
const check = (name, val, want, tol) => {
  const ok = Math.abs(val - want) <= tol;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${val.toFixed(3)} (want ${want} ±${tol})`);
};
const idle = { throttle: 0, brake: false, strafe: 0, thrust: false, roll: 0 };
const fresh = () => { const s = new Sim(1); s.spawnOwnAt = Infinity; s.c.vz = 40; return s; };

// 1. 满喷 10 秒耗尽（地面上压住，避免受滚转影响）
{
  const s = fresh(); let t = 0;
  while (s.gasTotal > 0 && t < 20) { s.step({ ...idle, thrust: true }); t += CFG.dt; }
  check('满喷耗尽时间 s', t, 10.0, 0.2);
}
// 2. 越 4.2m 货车：喷 0.70s 离地高度、顶点、滞空、耗气
{
  const s = fresh(); let t = 0, apex = 0, burnEnd = 0;
  const g0 = s.gasTotal;
  while (t < 0.70 - 1e-9) { s.step({ ...idle, thrust: true }); t += CFG.dt; }
  burnEnd = s.c.y;
  check('喷 0.70s 离地 m', burnEnd, 4.40, 0.15);
  check('喷 0.70s 耗气', g0 - s.gasTotal, 7.0, 0.2);
  while (s.c.air || t < 0.8) { s.step(idle); t += CFG.dt; apex = Math.max(apex, s.c.y); if (t > 10) break; }
  check('顶点 m（g=18 重算）', apex, 8.82, 0.3);
  check('滞空 s（g=18 重算）', t, 2.39, 0.08);
}
// 3. 满喷 1s
{
  const s = fresh(); let t = 0, apex = 0;
  while (t < 1 - 1e-9) { s.step({ ...idle, thrust: true }); t += CFG.dt; }
  check('满喷1s 离地 m', s.c.y, 9.0, 0.2);
  while (s.c.air) { s.step(idle); t += CFG.dt; apex = Math.max(apex, s.c.y); }
  check('满喷1s 顶点 m（g=18 重算）', apex, 18.0, 0.4);
  check('满喷1s 滞空 s（g=18 重算）', t, 3.42, 0.08);
}
// 4. 横滚一圈耗气（空中、无主喷；临时关重力保持滞空）
{
  const s = fresh(); s.c.y = 50; s.c.air = true; s.c.airStartRoll = 0;
  const g = CFG.g; CFG.g = 0;
  const g0 = s.gasTotal; let t = 0;
  while (Math.abs(s.c.roll) < Math.PI * 2) { s.step({ ...idle, roll: 1 }); t += CFG.dt; }
  CFG.g = g;
  check('横滚一圈耗气', g0 - s.gasTotal, 3.62, 0.362);
  console.log(`      一圈用时 ${t.toFixed(3)}s；横滚分 ${s.score.pending}`);
  if (s.score.pending !== 100) { fail++; console.log('FAIL  第一圈应得 100 分'); }
}
// 5. 第二圈 ×1.5、松手惯性保留
{
  const s = fresh(); s.c.y = 80; s.c.air = true;
  const g = CFG.g; CFG.g = 0;
  while (Math.abs(s.c.roll) < Math.PI * 4) s.step({ ...idle, roll: 1 });
  const w = s.c.w; s.step(idle); s.step(idle);
  CFG.g = g;
  check('两圈累计分', s.score.pending, 250, 0);
  check('松手后角速度保留', s.c.w, w, 1e-9);
  check('中段峰值角速度', w, 5.6, 0.05);
}
// 6. 0→100km/h
{
  const s = new Sim(1); s.spawnOwnAt = Infinity; let t = 0;
  while (s.c.vz < 100 / 3.6) { s.step({ ...idle, throttle: 1 }); t += CFG.dt; }
  // 参数表 1.98 是忽略阻力的值（27.78/14）；规格 §3.2 含阻力写的是"≈2.0 s"，含阻力解析解 ≈2.06
  check('0-100 km/h s（含阻力）', t, 2.0, 0.1);
}
// 7. 落地翻车判定
check('rollOffset(2π+0.1)', rollOffset(Math.PI * 2 + 0.1), 0.1, 1e-9);
check('rollOffset(-π)', rollOffset(-Math.PI), Math.PI, 1e-9);
// 8. 逆向赚气 10/s，耗了气之后才入账
{
  const s = fresh(); s.gas.base = 50; s.c.x = -5; s.c.vz = 40;
  for (let i = 0; i < 120; i++) s.step(idle);
  check('逆向 1s 赚气', s.gas.earnedTotal, 10, 0.1);
}
// 9. 满罐赚取作废
{
  const s = fresh(); const got = s.earn(12, 'draft');
  check('满罐赚取入账', got, 0, 0);
}
// 10. 尾随：贴 3–12m 1.0s 得 +12；高速刷过不给
{
  const s = fresh(); s.gas.base = 50;
  const tr = s.spawnTruck(1, s.c.x, s.c.z + 2.3 + 8 + 8); tr.v = 20; s.c.vz = 20;
  for (let i = 0; i < 125; i++) s.step(idle);
  check('尾随 +12', s.gas.earnedTotal, 12, 0.5);
  const s2 = fresh(); s2.gas.base = 50; s2.c.vz = 85;
  const t2 = s2.spawnTruck(1, s2.c.x + 0, s2.c.z + 30); t2.v = 20;
  for (let i = 0; i < 30; i++) s2.step({ ...idle, thrust: i < 60 });
  check('高速刷过不判尾随', s2.draft.t, 0, 0.2);
}
// 11. 高速穿模：90m/s 撞货车尾必须被检测
{
  const s = fresh(); s.c.vz = 90;
  const tr = s.spawnTruck(1, s.c.x, s.c.z + 40); tr.v = 20;
  let hit = false;
  for (let i = 0; i < 240; i++) { s.step(idle); if (s.events.some(e => e.type === 'crash')) { hit = true; break; } }
  check('高速撞尾被检测', hit ? 1 : 0, 1, 0);
}
// 11b. 逆向迎头撞车：罐里已赚的气作废，但"还能再赚多少"的额度不能回填（否则撞一辆车就重刷满管）
{
  const s = fresh(); s.c.x = 5.25; s.c.vz = 40;
  s.gas.earned = 40; s.gas.earnedTotal = 40;             // 本场已赚满 40，且都还在罐里
  const budget0 = s.earnBudget;
  const tr = s.spawnTruck(-1, s.c.x, s.c.z + 20); tr.v = 20;
  let crash = null;
  for (let i = 0; i < 400; i++) {
    s.step(idle);
    crash = s.events.find(e => e.type === 'crash' && e.kind === 'headon') || crash;
    if (crash) break;
  }
  check('迎头撞车 罐内已赚气清零', s.gas.earned, 0, 0);
  check('迎头撞车 可赚额度不回填', s.earnBudget, budget0, 0);
  check('迎头撞车 总赚气量不被重置', s.gas.earnedTotal, 40, 0);
}
// 12. v1.3 自动稳姿：歪着下落、松手 → 自动扶正 + PID 反喷，稳稳落地
OPEN.autoAssist = true;
const dropTest = (h0, roll0, label) => {
  const s = fresh(); s.c.y = h0; s.c.air = true; s.c.roll = roll0; s.c.airStartRoll = roll0; s.c.vy = 0;
  const g0 = s.gasTotal; let landEv = null, flip = false, t = 0;
  while (t < 10) {
    s.step(idle); t += CFG.dt;
    for (const e of s.events) { if (e.type === 'land') landEv = e; if (e.type === 'flip') flip = true; }
    s.events.length = 0;
    if (!s.c.air) break;
  }
  const used = g0 - s.gasTotal;
  const ok = landEv && !flip && Math.abs(landEv.vy) < CFG.score.perfectVy;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  自动稳姿 ${label}: 触地 vy=${landEv ? landEv.vy.toFixed(2) : '翻车'} m/s, 完美=${landEv?.perfect}, 耗气 ${used.toFixed(2)}, 用时 ${t.toFixed(2)}s`);
  return used;
};
const gLow = dropTest(6, 0.9, '6 m / 歪 52°');
const gMid = dropTest(12, -2.4, '12 m / 歪 -138°');
const gHigh = dropTest(19, Math.PI, '19 m / 倒扣 180°');
{
  const ok = gLow < gMid && gMid < gHigh;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  下落越快越费气: ${gLow.toFixed(2)} < ${gMid.toFixed(2)} < ${gHigh.toFixed(2)}`);
}
// 按住右摇杆时辅助不介入
{
  const s = fresh(); s.c.y = 20; s.c.air = true; s.c.roll = 1;
  for (let i = 0; i < 60; i++) s.step({ ...idle, roll: 1 });
  const ok = !s.c.assisting;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  玩家操作时辅助不介入`);
}
// 13. v1.8 防刷分：完美落地必须有高度门槛（轻点点火落地不再白送 80 分）
{
  const jump = (thrustT) => {
    const s = fresh();
    let t = 0, landEv = null;
    while (t < thrustT - 1e-9) { s.step({ ...idle, thrust: true }); t += CFG.dt; }
    while (t < 15) {
      s.step(idle); t += CFG.dt;
      const le = s.events.find(e => e.type === 'land');
      if (le) landEv = le;
      s.events.length = 0;
      if (!s.c.air) break;
    }
    return { s, landEv };
  };
  const tap = jump(0.18);                                  // 轻点一下：顶点不到 1 m
  const ok1 = tap.landEv && !tap.landEv.perfect && tap.s.score.perfect === 0;
  if (!ok1) fail++;
  console.log(`${ok1 ? 'PASS' : 'FAIL'}  轻点点火（顶点 ${(tap.landEv?.apexY ?? -1).toFixed(2)} m）不算完美落地，完美计数 ${tap.s.score.perfect}`);

  const full = jump(0.70);                                 // 正常起跳：顶点约 8.8 m
  const ok2 = full.landEv && full.landEv.perfect && full.s.score.perfect === 1;
  if (!ok2) fail++;
  console.log(`${ok2 ? 'PASS' : 'FAIL'}  正常起跳（顶点 ${(full.landEv?.apexY ?? -1).toFixed(2)} m）仍判完美落地，完美计数 ${full.s.score.perfect}`);
}

// 14. v1.9 NPC 小轿车：碰撞盒比货车小、车道偏好、贴顶阈值分档
{
  const sc = fresh();
  sc.trucks.length = 0;
  const car = sc.spawnCar(1, 5.25, 200);
  check('小轿车车身尺寸 h', car.h, CFG.cars.h, 1e-9);
  check('小轿车车身尺寸 w', car.w, CFG.cars.w, 1e-9);
  const tr = sc.spawnTruck(1, 5.25, 400);
  const okBox = car.w < tr.w && car.h < tr.h;
  if (!okBox) fail++;
  console.log(`${okBox ? 'PASS' : 'FAIL'}  碰撞盒更小：轿车 ${car.w}×${car.h} m < 货车 ${tr.w}×${tr.h} m`);

  // 横向偏移 2.10 m：货车会撞（2.10 < 1.0+1.25），轿车不会（2.10 > 1.0+0.93）
  const hitWith = (kind) => {
    const s = fresh(); s.trucks.length = 0; s.c.x = 5.25; s.c.vz = 40;
    const v = kind === 'car' ? s.spawnCar(1, 5.25 + 2.10, s.c.z + 30) : s.spawnTruck(1, 5.25 + 2.10, s.c.z + 30);
    v.v = 20;
    for (let i = 0; i < 200; i++) { s.step(idle); if (s.events.some(e => e.type === 'crash')) return true; }
    return false;
  };
  const carHit = hitWith('car'), truckHit = hitWith('truck');
  const okHit = !carHit && truckHit;
  if (!okHit) fail++;
  console.log(`${okHit ? 'PASS' : 'FAIL'}  偏移 2.10 m：蹭到货车(${truckHit}) / 没蹭到轿车(${carHit})`);

  // 贴顶阈值分档（v2.1 放宽：货车 1.5 / 轿车 1.1）
  const shaveWith = (kind, clear) => {
    const s = fresh(); s.trucks.length = 0;
    const v = kind === 'car' ? s.spawnCar(1, 5.25, 100) : s.spawnTruck(1, 5.25, 100);
    v.overAir = true; v.minClear = clear;
    s.passTruck(v);
    return s.score.total;
  };
  check('1.40 m 间隙越货车 = 越车+贴顶', shaveWith('truck', 1.40), CFG.score.hurdle + CFG.score.shave, 1e-9);
  check('1.40 m 间隙越轿车 = 只算越轿车', shaveWith('car', 1.40), CFG.score.hurdle, 1e-9);
  check('0.90 m 间隙越货车 = 贴顶', shaveWith('truck', 0.90), CFG.score.hurdle + CFG.score.shave, 1e-9);
  check('0.90 m 间隙越轿车 = 贴顶（放宽后）', shaveWith('car', 0.90), CFG.score.hurdle + CFG.score.shave, 1e-9);
  check('货车贴顶阈值', CFG.gas.closeShave.clearance, 1.5, 1e-9);
  check('轿车贴顶阈值', CFG.gas.closeShave.clearanceCar, 1.1, 1e-9);

  // 车道偏好：轿车约 88% 在左侧两股（0,1），货车约 88% 在右侧两股（2,3）
  const s2 = new Sim(7);
  let carLeft = 0, truckRight = 0; const N = 600;
  for (let i = 0; i < N; i++) { if (i % 2 === 0) { if ([0, 1].includes(s2.laneForKind('car'))) carLeft++; } else if ([2, 3].includes(s2.laneForKind('truck'))) truckRight++; }
  const okLane = carLeft / (N / 2) > 0.78 && truckRight / (N / 2) > 0.78;
  if (!okLane) fail++;
  console.log(`${okLane ? 'PASS' : 'FAIL'}  车道偏好：轿车在左侧两股 ${(carLeft / (N / 2) * 100).toFixed(0)}% / 货车在右侧两股 ${(truckRight / (N / 2) * 100).toFixed(0)}%`);
}

// 15. v2.0 轿车车队：2–3 辆跟车、同车道、间距贴紧、速度与领车一致
{
  const s = new Sim(3);
  s.spawnOwnAt = Infinity; s.spawnOncAt = Infinity;
  s.c.z = 0; s.trucks.length = 0; s.firstTruck = false; s.waveKind = 'truck';
  let lead = null;
  for (let i = 0; i < 40 && !lead; i++) {                 // 找到一波车队
    s.waveKind = 'truck';                                  // 强制下一波是轿车
    s.c.z += 400;
    s.spawnOwnWave();
    lead = s.trucks.find(t => t.kind === 'car' && s.trucks.some(f => f.convoy === t.id));
  }
  const followers = lead ? s.trucks.filter(t => t.convoy === lead.id) : [];
  const okN = !!lead && followers.length >= CFG.cars.convoyN[0] && followers.length <= CFG.cars.convoyN[1];
  if (!okN) fail++;
  console.log(`${okN ? 'PASS' : 'FAIL'}  车队规模：领车 ${lead ? 1 : 0} + 跟车 ${followers.length} 辆（要求 ${CFG.cars.convoyN.join('–')}）`);

  if (lead) {
    const sameLane = followers.every(f => Math.abs(f.x - lead.x) < 1e-6);
    if (!sameLane) fail++;
    console.log(`${sameLane ? 'PASS' : 'FAIL'}  跟车与领车同车道（x=${lead.x.toFixed(2)}）`);

    const sameSpeed = followers.every(f => Math.abs(f.v - lead.v) / lead.v < 0.02);
    if (!sameSpeed) fail++;
    console.log(`${sameSpeed ? 'PASS' : 'FAIL'}  跟车速度与领车一致：${lead.v.toFixed(1)} vs [${followers.map(f => f.v.toFixed(1)).join(', ')}] m/s`);

    // 间距：相邻车（含领车）中心距 − 两车半长 = 车头间距，应落在 convoyGap ±0.6 m
    const line = [lead, ...followers].sort((a, b) => b.z - a.z);
    let okGap = true; const gaps = [];
    for (let i = 1; i < line.length; i++) {
      const gap = (line[i - 1].z - line[i - 1].len / 2) - (line[i].z + line[i].len / 2);
      gaps.push(gap);
      if (gap < CFG.cars.convoyGap[0] - 0.6 || gap > CFG.cars.convoyGap[1] + 0.6) okGap = false;
    }
    if (!okGap) fail++;
    console.log(`${okGap ? 'PASS' : 'FAIL'}  跟车间距 ${gaps.map(g => g.toFixed(1)).join('/')} m（要求 ${CFG.cars.convoyGap.join('–')}）`);

    // 跑 5 秒后车队不能散：相对顺序与间距都要保持（同速才可能）
    const z0 = line.map(t => t.z - lead.z);
    for (let i = 0; i < 600; i++) { s.step(idle); s.events.length = 0; }
    const z1 = line.map(t => t.z - lead.z);
    const drift = Math.max(...z1.map((z, i) => Math.abs(z - z0[i])));
    const okHold = drift < 4;
    if (!okHold) fail++;
    console.log(`${okHold ? 'PASS' : 'FAIL'}  跑 5 s 车队不散：相对位移最大 ${drift.toFixed(2)} m`);
  }
}

// 16. v2.0 密度：同向车辆上限翻倍、生成间隔减半
check('同向上限', CFG.trucks.maxOwn, 12, 0);
check('对向上限', CFG.trucks.maxOnc, 6, 0);
check('同向生成间隔上限 s', CFG.trucks.every[1], 6, 1e-9);

// 17. v2.1 车顶落地判罚：货车=拍脑袋砍半 / 轿车=你主责清零 / 同一辆车只罚一次
{
  // 让玩家从高空落到指定车辆的车顶上
  const landOnRoof = (kind) => {
    const s = fresh();
    s.trucks.length = 0; s.spawnOwnAt = Infinity;
    s.c.x = 5.25; s.c.z = 0; s.c.vz = 30; s.c.y = 12; s.c.vy = -2; s.c.air = true; s.c.airStartRoll = 0;
    const v = kind === 'car' ? s.spawnCar(1, 5.25, 6) : s.spawnTruck(1, 5.25, 6);
    v.v = 20;
    s.score.pending = 200;                     // 本段腾空已攒 200 特技分
    const ev = [];
    const o = s.emit.bind(s); s.emit = (t, d) => { ev.push(t + (d && d.kind ? ':' + d.kind : '')); return o(t, d); };
    for (let i = 0; i < 240; i++) {
      s.step(idle);
      s.events.length = 0;
      if (v.roofHit) break;
    }
    return { s, v, ev };
  };

  const truck = landOnRoof('truck');
  check('落货车顶 特技分砍半', truck.s.score.pending, 100, 1e-9);
  const okT = truck.v.roofHit && truck.ev.includes('crash:roofTruck');
  if (!okT) fail++;
  console.log(`${okT ? 'PASS' : 'FAIL'}  落货车顶判「拍脑袋」：${truck.ev.filter(e => e.startsWith('crash')).join(',')}`);

  const car = landOnRoof('car');
  check('落轿车顶 特技分清零', car.s.score.pending, 0, 1e-9);
  const okC = car.v.roofHit && car.ev.includes('crash:roofCar');
  if (!okC) fail++;
  console.log(`${okC ? 'PASS' : 'FAIL'}  落轿车顶判「你主责」：${car.ev.filter(e => e.startsWith('crash')).join(',')}`);

  // 同一辆车二次接触不重复罚：继续滑行若干步，分数不应再变
  {
    const s = truck.s, v = truck.v;
    const before = s.score.pending;
    for (let i = 0; i < 30; i++) { s.step(idle); s.events.length = 0; }
    check('同一辆车二次接触不重复罚', s.score.pending, before, 1e-9);
    void v;
  }
}

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
