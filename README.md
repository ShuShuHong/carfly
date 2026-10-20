# 特技飞天跑车 (Carfly)

竖屏 3D 飙车网页游戏：夜间高速上喷气离地、空中横滚飞越货车，攒气、刷特技分、冲线拿高分。

纯静态站点，无需构建——打开 `index.html` 就能跑（建议通过本地服务访问）。

## 玩法

- **目标**：在气罐耗尽前冲到终点。喷气飞行耗气，靠危险驾驶赚气
- **赚气**：逆行 +10/秒 · 尾随货车 1 秒 +12 · 超车 +8 · 贴顶越车 +4
- **特技分**：空中横滚 100 分/圈（连击有倍率）· 越车 50 · 贴顶越车 150 · 完美落地 80
- **结算**：最终得分 = 特技分 + 时间奖励 + 赚气折分，最高纪录存本地

## 操作

| 输入 | 作用 |
| --- | --- |
| 左摇杆 | 上推油门 · 下拉刹车 · 左右横移 |
| 右摇杆 | 按住 = 喷气离地；左右推 = 空中横滚 |
| 键盘 | WASD 驾驶 · 空格喷气 · ←/→ 横滚 |

手机竖屏游玩体验最佳；桌面浏览器会自动适配竖屏视口。

## 本地运行

需要 Node.js（仅用于本地服务和测试，游戏本身零依赖零构建）：

```bash
npm run serve   # 启动 http://localhost:5173
npm test        # 运行物理/判罚基准测试
```

首次运行 `serve` 会自动下载固定版本的 Three.js (0.170.0) 到 `lib/`。也可以把本目录丢给任意静态服务器（如 `npx serve`）直接跑。

## 部署

整个目录就是产物，原样上传到任意静态托管（GitHub Pages、Vercel、Nginx……）即可，注意保持 `lib/three.module.min.js` 存在。

## 技术栈

- Three.js 0.170.0（本地打包，无 CDN 运行时依赖）
- 原生 ES Modules + Web Audio，无框架、无构建步骤
- 自研定点步长物理（1/120 s）：纵向/横向动力学、喷气色悬浮、横滚角动力学、PID 自动稳姿落地

## 项目结构

```
index.html      入口页面
style.css       HUD 与布局样式（9:16 竖屏，按 1080 宽缩放）
src/
  main.js       启动、主循环、状态机、相机
  config.js     全部物理/计分/气量参数（tunable）
  sim.js        车辆物理仿真
  stunt.js      特技判定与计分
  hud.js        HUD 渲染
  text.js       全部 UI 文案（改文案只动这里）
  ...           world / scenery / vfx / audio / input / car / carbody / merge
tools/serve.mjs 本地静态服务（自动补全 three.js）
tests/          物理与判罚基准测试
```

## 许可

MIT License © 2026 ShuShuHong，详见 [LICENSE](LICENSE)。
第三方组件声明见 [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES)。
