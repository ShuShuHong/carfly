/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// 全部数值来自 01_需求规格/参数表_spec.json（v1.2），单位 SI。
// 标 tunable 的可在运行时改；OPEN 段是需求 §13 未定项的默认实现 + 开关。
export const CFG = {
  dt: 1 / 120,
  g: 18,                       // tunable 12–20；v1.7 16→18：空中不再"飘"，下落更快
  car: { L: 4.6, W: 2.0, H: 1.3, wheelbase: 2.58, wheelR: 0.39 },
  lon: { throttle: 14, vmax: 90, k: 0.001728, brake: 22 },
  lat: { accGround: 26, accAir: 13, vGround: 14, vAir: 10, damp: 12 },
  thrust: 36,                  // v1.7 34→36：与 g=18 配平，净加速度仍是 18（0.70 s 仍能越 4.2 m 货车）
  roll: {
    acc1: 18, acc2: 6, wMax: 5.2, wPeak: 5.6, split: [0.3, 0.8],
    counter: 24, apexBonus: 1.06,
  },
  gas: {
    initial: 100, cap: 100, earnMax: 100, mainCost: 10, rollCost: 3, warn: 0.2,
    wrongWay: { perSec: 10, minSpeed: 20, scorePerSec: 5 },
    draft: { units: 12, gap: [3, 12], hold: 1.0, overMax: 8, tol: 0.5, cooldown: 3, score: 30 },
    overtake: { units: 8, lead: 3 },
    // v2.1 贴顶越车：判断标准放宽容（货车 1.0→1.5 m，轿车 0.75→1.1 m）；
    // 车顶高度仍按车型各自算（t.h），所以轿车"更低更贴"的判定关系没变，只是达标更容易
    closeShave: { units: 4, clearance: 1.5, clearanceCar: 1.1 },
    medianMul: 0.92,
    headOn: { speed: 15 },
  },
  input: { dead: 0.12, rollTh: 0.35, L: [200, 1600], R: [880, 1600], r: 180 },
  // v1.3（甲方测试反馈）：机位抬高；随速度拉远/前视；离地后随高度升高并下俯，保证车与路面同框
  cam: {
    back: 8.5, backSpeed: 1.5, airBack: 0.45,      // 后距 = 8.5 + 1.5·(v/vmax) + 0.45·离地高
    height: 4.0, heightSpeed: 0.6, airRise: 0.75,   // 机高 = 4.0 + 0.6·(v/vmax) + 0.75·离地高
    ahead: 14, aheadSpeed: 10, airLook: 0.25,       // 看向车前 14→24 m，注视点高度 = 0.25·离地高
    fov: 62, fovSpeed: 4,                           // 高速 FOV 微增 4°（速度感），不做大 FOV
    latTau: 0.25, springW: 5.5, aheadW: 2.0,        // 横向一阶平滑；其余为临界阻尼弹簧（连续、无过冲）
    shakeThrust: 0.5, shakeImpact: 12, impactDecay: 0.4, blurSpeed: 60,
  },
  // v1.3 自动稳姿：空中松开右摇杆 → 车底 4 点差动扶正 + PID 落地反喷（按实际推力计耗气）
  assist: {
    delay: 0.12,                 // 松手后 0.12 s 接管（保留一点甩出去的惯性）
    levelDecel: 16,              // 扶正：角度→目标角速度用 √(2·a·|e|) 曲线（时间最优、不过冲）
    levelKp: 8,                  // 小角度段改线性 ω = 8·e，避免在 0° 附近抖
    levelDoneDeg: 0.5,
    retroRollDeg: 20,            // 扶到 ±20° 内才允许反喷（推力按 cos(roll) 投影）
    vLand: 6,                    // 目标触地垂直速度 m/s（< 8 即完美落地）
    decel: 15,                   // 参考减速度 m/s²（前馈油门 (16+15)/34 = 0.91，留 9% 给 PID）
    kp: 0.08, ki: 0.05, kd: 0.01, iMax: 4,
  },
  score: {
    roll: 100, combo: [1, 1.5, 2, 2.5, 3], airPerSec: 10, airMin: 0.15,
    hurdle: 50, shave: 150, perfect: 80, perfectRoll: 5, perfectVy: 8,
    // v1.8 防刷分：完美落地必须"真的飞起来"——本次腾空最高点 ≥ perfectMinH 米才认。
    // 4.0 m 恰好卡在"轻点约 3.6 m"与"能越过 4.2 m 货车（顶点 4.4 m+）"之间；
    // 想更严就往上加，想宽松回到 3.5；改这里必须同步 tests 里的防刷分用例。
    perfectMinH: 4.0,
    timePerSec: 20, parKmh: 165, earnedMul: 0.5,
  },
  landing: { safeDeg: 25, flipDur: 0.6, flipMul: 0.6 },
  // 路面横向布局（x=0 为中央分隔中心，+x 向右）
  track: {
    length: 4000, laneW: 3.5, own: 4, onc: 3, median: 1.0, shoulder: 1.0,
    guardMul: 0.85,
  },
  trucks: {
    len: [14, 18], w: 2.5, h: 4.2, v: [17, 24], first: 8, every: [3, 6],
    // v2.0 车流密度翻倍：every 6–12 → 3–6 s；同向 6 → 12 辆；对向上限 3 → 6 辆
    sideBySide: 0.2, lastThirdBoost: 1.5, maxOwn: 12, maxOnc: 6,
    rearMul: 1.05, roofMul: 0.85, sideMul: 0.9, glowDist: 50,
    lanes: [2, 3], kindShare: 0.88,     // v1.9 货车偏爱右侧两股道（88%，偶尔并到左侧）
    oncEvery: [1.3, 2.8],               // 对向生成间隔 s（原 2.5–5.5，一并翻倍）
  },
  // v1.9 NPC 小轿车：比货车短、窄、矮、快，密度与货车相当（同一条生成节奏，按波交替车型）
  // v2.0 新增车队：2–3 辆轿车同车道紧跟领车，速度锁死与领车一致，不会跑散
  cars: {
    len: [4.4, 5.0], w: 1.86, h: 1.45, v: [26, 34],
    lanes: [0, 1], kindShare: 0.88,     // 偏爱左侧两股道
    convoy: 0.45,                       // 45% 的轿车波是"车队"
    convoyN: [2, 3],                    // 跟车 2–3 辆
    convoyGap: [3.5, 7.0],              // 跟车车头间距 m（贴得很近才像"跟着跑"）
  },
  stunt: {
    pulse: 0.08, duty: 0.7, cone: [0.5, 0.9], rearDelay: 0.03,
    fadeIn: 0.04, fadeOut: 0.08, diff: [1.6, 0.4],
    punch: { dur: 0.18, setback: 0.12, pitch: 4, camDip: 0.25, shake: [0.5, 3] },
    apex: { vy: 2, particle: 1.15, camRise: 0.08 },
    yawDrift: 6, pitchJitter: 2,
    land: { comp: 0.10, reb: 0.02, camDip: 0.2, camRet: 0.25, dustR: 1.8, dustT: 0.4 },
    smoke: { d: [0.3, 2.2], t: 0.9 },
    // v1.6 起步：A 组 4 根尾喷口向后喷白色冷气助跑（视觉，不另计耗气）
    launchA: {
      dur: 1.8,         // 总时长（含收尾）：够长，车能"从白气里冲出来"
      ramp: 0.05,       // 点火冲满时间
      plateau: 0.42,    // 平台段结束点（占总时长比例），之后指数衰减
      len: [0.35, 0.95],  // 喷焰长度 m（弱 / 满）：短而粗才像"喷"，拉长会变成白条
      pulseMs: 55, duty: 0.72,   // 冷气脉冲
      light: 1.6,       // 尾喷照亮后方路面（PointLight 强度）
    },
  },
  // v1.6 冲线收尾：过线立即甩尾急停（1 s 内降到很慢），停稳马上出结算
  outro: {
    stopTime: 0.68,   // 从过线速度收到的时长 s（1 s 内必须"很慢"，留 30% 余量扛掉帧）
    v0max: 60,        // 参与曲线计算的最高初速（超速冲线也按这个收，避免曲线过抖）
    creep: 0.9,       // 最后 0.9 m/s 用附加减速吃掉，停得干净不顿挫
    settle: 0.10,     // 停稳后再停这么久就出面板（面板 ≈0.78 s 出现）
    driftYaw: 26,     // 甩尾偏航角 deg（视觉，仅收尾段；比赛内 yaw 仍恒为 0）
    driftRoll: 5.5,   // 侧倾 deg
    driftSide: 3.2,   // 横向滑移 m/s
    driftPitch: 2.6,  // 急刹点头 deg
    smoke: 210,       // 每秒轮胎白烟粒子数（四轮合计）：再多会糊成一片白雾
    smokeA: 0.19,     // 单颗粒不透明度
    camBack: 2.6,     // 停稳后机位后拉 m
    camRise: 1.0,     // 停稳后机位抬高 m
  },
};

// 需求 §13 未定项：按默认实现，留开关，不自行拍板
export const OPEN = {
  aiOpponents: false,
  crashEndsRace: false,
  trackLength: 4000,
  oncomingLanes: 3,
  draftOverMax: 8,          // 可放宽到 15
  bgm: false,
  headlightsOn: true,
  rearDash: false,          // A 组后向冲刺，默认不做
  autoAssist: true,         // v1.3 甲方新增：空中松手自动扶正 + 落地反喷
  // v1.4 甲方新增：高速广告牌（新能源热梗）。注意这与 v1.2「3D 场景零文字」红线冲突，
  // 甲方本次明确要求，默认开；关掉后广告牌只保留图形、不出字
  billboardText: true,
  roadArches: false,        // v1.4 甲方要求去掉路上的红色桁架门架（像监控探头）
};

const T = CFG.track;
export const LANES = {
  own: [...Array(T.own)].map((_, i) => T.median / 2 + T.laneW * (i + 0.5)),
  onc: [...Array(T.onc)].map((_, i) => -(T.median / 2 + T.laneW * (i + 0.5))),
  rightEdge: T.median / 2 + T.own * T.laneW + T.shoulder,   // 15.5
  leftEdge: -(T.median / 2 + T.onc * T.laneW + T.shoulder), // -12
  oncInner: -T.median / 2,                                   // -0.5
};

export const PAR_TIME = CFG.track.length / (CFG.score.parKmh / 3.6);
