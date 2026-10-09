# 工程架构

浏览器入口 index.html 保留内联样式。运行无第三方依赖，工具要求 Node >=22。

加载顺序由 test/structure.check.js 守护：生成配置 → core → game 六部件 → game 门面 → 动画/绘制 → 音频/音乐 → bot → storage/input/hud/ui → main。

game 按 state → systems → player → enemies → bosses → rooms 装配。跨部件助手挂 ctx，公开状态/操作挂 G。createGame({seed,headless,difficulty}) 后通过 startRun(hero)、update(dt) 推进；无头仿真不装载绘制与 DOM。

| 目录 | 职责 |
| --- | --- |
| config/ | 正式 JSON 数据与 Schema |
| src/ | 游戏逻辑、绘制、输入、音频、界面 |
| assets/ | 二进制素材及资源说明 |
| scripts/ | 配置生成、服务与发布构建 |
| test/ | 仿真、回归、浏览器验收和实验 |
| docs/ | 人类与 Agent 共用文档 |
| .agents/ | Agent 任务、过程、交接和归档 |
| generated/、dist/ | 可重建产物，不入库 |

Node 直接校验并加载 JSON，浏览器使用同源生成的配置 JS。浏览器是参考实现，其他引擎依据配置、[玩法规格](gameplay.md)与测试重写；不假设替换引擎物理仍保持既有难度。
