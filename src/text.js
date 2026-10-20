/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// UI 文案配置表（甲方可能改口径，如"气量"→"氮气"，只改这里）
export const TEXT = {
  title: '特技飞天跑车',
  subtitle: '夜间高速 · 喷气离地 · 空中横滚越货车',
  start: '开始比赛',
  again: '再来一局',
  lowQ: '低画质',
  sound: '声音',
  best: '最高分',
  bestStunt: '最佳特技分',
  howto: [
    ['左摇杆', '上推油门 · 下拉刹车 · 左右横移（车不转向）'],
    ['右摇杆', '按住 = 车底 4 喷口满推力离地；左右推 = 空中横滚（松手惯性继续转）'],
    ['气罐', '起跑 10 秒料。逆行 +10/秒 · 贴货车尾 1 秒 +12 · 超车 +8'],
    ['键盘', 'WASD 驾驶 · 空格喷气 · ←/→ 横滚'],
  ],
  rotate: '请竖屏游玩',
  loading: '加载中',
  kmh: 'km/h',
  gas: '气量',
  full: '满',
  combo: c => `×${c} 连击`,
  wrongRate: '+10/s',
  tips: {
    stickL: '左摇杆：上推油门，左右是横移',
    stickR: '按住右摇杆喷气离地，左右推空中横滚',
    draft: '先减速，贴住前车尾 3–12 m 保持 1 秒：+12 气',
    wrong: '逆行进对向车道：+10 气/秒。看到头灯就撤！',
    gasEmpty: '气罐空了，去逆行 / 尾随 / 超车赚气',
    earnCapped: '本场可赚气量已满',
  },
  pop: {
    perfect: '完美落地', flip: '翻车', lost: '特技分清零', headon: '迎面相撞！本场赚的气全没了',
    lowLand: '高度不足 · 无落地分',
    headBonk: '拍脑袋 · 特技分砍半',
    carFault: '你主责 · 特技分清零',
    draft: '尾随', hurdle: '越车', shave: '贴顶越车', land: '落地',
  },
  // 高速广告牌文案（新能源汽车热梗，主标 + 副标）。不含任何真实品牌名
  // 第三项为可选样式：{ icon: false } = 这一块不出左侧图标，文字居中
  billboards: [
    ['充电五分钟，飙车两小时', '前方 2 km 超充站 · 排队请自带小板凳'],
    ['续航焦虑？不存在的', '因为这车会飞 · 堵车直接越过去'],
    ['零百 1.9 秒', '比你点外卖还快'],
    ['遥遥领先', '你的后视镜里全是别人', { icon: false }],
    ['电车不加油，只加气', '逆行 +10 / 秒 · 请勿模仿'],
    ['方向盘？那是什么', '本车只会平移和起飞'],
    ['冷气推进 · 零排放', '喷的是空气 · 不是尾气'],
    ['请保持车距', '除非你打算从它头上飞过去'],
  ],
  result: {
    title: '冲线',
    time: '用时', par: '目标用时', stunt: '特技分', timeBonus: '时间奖励', earned: '本场赚取气量',
    earnedScore: '赚气折分', final: '最终得分', newBest: '新纪录',
    rolls: '横滚圈数', hurdles: '越车', perfect: '完美落地', crashes: '碰撞',
  },
};
