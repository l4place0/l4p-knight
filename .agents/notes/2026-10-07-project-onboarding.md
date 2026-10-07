---
title: "项目 onboarding：架构、开发入口与 v1.9 验收基线"
date: 2026-10-07
author: "gpt-6@Codex"
operator: "L4place"
status: archived
type: session-archive
base: "main @ 458bd1a（v1.9）；HANDOFF.md 已有未提交修改"
version: "v1.9 onboarding"
branch: main
commits:
  - "458bd1a v1.9 Boss 难度重标定，当前代码与验收基线"
  - "66c0cde v1.8 部件化重构与结构守护，当前架构来源"
tags: [onboarding, architecture, baseline, testing, documentation]
---

# 任务归档 · 项目 onboarding

- **起点**：零号协议 ZERO PROTOCOL v1.9 → **产出**：项目开发导览与实际验收基线。
- 本次仅新增此归档笔记；commits 关联被调研的现有提交，不代表本次产生了代码提交。

## 完成内容

### 项目与运行

原生 JavaScript 的 2D 肉鸽弹幕射击游戏，HTML5 Canvas 渲染、Web Audio 合成音效与音乐。
无第三方依赖、无构建步骤，双击 index.html 可玩；开发服务器使用 npm start，端口 8941。
当前内容包括 4 英雄、4 区域、6 武器、19 晶片、10 羁绊、7 普通敌种与两位三阶段 Boss，
另有每日挑战、localStorage 元进度、键鼠/手柄/触控和 AI 代打。package.json 版本为 1.9.0。

### 架构与阅读顺序

1. README.md 了解玩法与运行；HANDOFF.md 阅读模块契约和历史缺陷。
2. js/main.js 理解启动、URL 参数、模块接线与固定 1/60 秒步长循环。
3. js/game.js 理解 createGame：按 state → systems → player → enemies → bosses → rooms 装配六部件。
4. js/game/systems.js 的 G.update 是世界更新入口；js/game/rooms.js 管理开局、波次、晶片、商店与区域推进。
5. test/lib.js、test/sim.test.js、test/cases/regression.js 理解真实游戏逻辑的无头验收。

| 修改内容 | 入口 |
| --- | --- |
| 武器、英雄、晶片、羁绊、地图及像素画数据 | js/core.js |
| 状态、种子 RNG、BFS 可达点、对象池 | js/game/state.js |
| 碰撞、弹幕、地雷、激光与引力井 | js/game/systems.js |
| 玩家属性、开火、冲刺、近战与受伤 | js/game/player.js |
| 普通敌人 AI、生成、伤害与死亡 | js/game/enemies.js |
| Boss 攻击、阶段、难度与死亡演出 | js/game/bosses.js |
| 房间、掉落、晶片升级、商店与通关流程 | js/game/rooms.js |
| AI 导航、走位与采购决策 | js/bot.js |
| Canvas 表现与音效/BGM | js/render.js、js/audio.js、js/music.js |
| 存档、输入、HUD、界面切换 | js/storage.js、js/input.js、js/hud.js、js/ui.js |

浏览器使用经典 script 和 ZERO_* 全局命名空间，Node 使用 CommonJS 导出；并非 ES modules 项目。
index.html 共加载 17 个脚本，顺序受 test/structure.check.js 约束。
浏览器一帧：INPUT.update → 可选 bot.update → G.update；绘制、HUD、覆盖层和 BGM 在 frame 中更新。
G.state 包括 title、playing、chip、shop、victory、defeat、paused；世界逻辑只在 playing 推进。

### 开发契约

- 游戏逻辑必须保持 headless 可运行，避免直接操作 DOM、Canvas、AudioContext 或真实 setTimeout；使用 ctx、G.sfx 与逻辑计时器。
- bot 的移动/射击等操控共用 G.input；晶片与商店选择调用相同游戏 API，不额外赋予战斗优势。
- 改碰撞需保留逐轴回退与墙角最小穿透轴推出；刷怪和传送门使用 BFS 可达区域。
- Boss 死后保留 dying 演出再完成流程；chipOffered 防止重复弹出晶片选择。
- 对象池新增字段须在 init 中重置；时序和 RNG 消费变化须关注确定性与基线漂移。
- 修改 Boss 数值需用 test/balance.js 重新标定；浏览器 HUD/交互仍需浏览器冒烟，无头测试覆盖不到。

## 验证状态

环境：Windows PowerShell，Node v26.4.0，分支 main，HEAD 458bd1a。

- node test/structure.check.js：退出码 0；脚本顺序、模块导出、17 个 JS 文件语法与 UI 注册检查通过。
- node test/sim.test.js：退出码 0；6 个完整流程样本中 2 个 VICTORY（seed=1 的 vanguard 364.8s，seed=7 的 bulwark 299.7s）。
  另有 3 局阵亡、1 局超时；每日挑战、Boss2 专属攻击、压力、7200 游戏秒稳定性、隔墙和墙角回归通过。
- node test/matrix.js --seeds 1-3 --workers 4 --baseline test/matrix.baseline.json：108 场景，84 clear、8 bossDown、16 defeat，退出码 1。
  16 个失败均为 Boss 场景阵亡；输出“无劣化场景”仅表示成功场景的耗时没有超比较阈值，并不代表全部场景通过。
- 本次未做浏览器视觉/交互冒烟，未重跑 100 场景 Boss 标定、变异或消融实验。

## 复现命令

```powershell
npm start
# 浏览器访问 http://127.0.0.1:8941/
# AI 演示：http://127.0.0.1:8941/?seed=1&bot=1&autostart=1&fps=1
node test/structure.check.js
npm test
node test/matrix.js --seeds 1-3 --workers 4 --baseline test/matrix.baseline.json
node test/matrix.js --run boss/vanguard/s1
# 单独观察全流程 seed=3；输出停滞快照，不改文件
node -e "const {simulateRun}=require('./test/lib.js'); const r=simulateRun(3,{quiet:true}); console.log(r.errors);"
# Boss 标定需明确指定标尺；默认没有 human 参数时是完美 bot
node test/balance.js --boss boss1 --baseline --size 100 --workers 4 --human commit=30,trackK=3,sight=100,delay=10,dashSkip=0.6
```

## 遗留 / 注意事项

1. **验收有假绿风险**：seed=3 超过 660 游戏秒仍停在第 3 区。快照为玩家(223,21)、传送门已开、无敌人，
   bossRef 为负 HP 的 dying 状态；这是流程停滞证据，根因尚未诊断，不能直接归因于 Boss 死亡状态机。
   sim.test.js 对完整局只打印 r.errors，未把超时/异常统一纳入失败计数；聚合胜利条件仍可让整个测试退出 0。
2. **标尺不一致**：test/lib.js 实际为 commit45/trackK2/sight85/delay15/dashSkip0.85；matrix 的 Boss 场景和
   bosses.js 标定注释为 M3（commit30/trackK3/sight100/delay10/dashSkip0.6）。浏览器 main.js 不传 genes，使用完美 bot。
   README 所述 3 种子及全英雄全部通关时间与本次实测不一致，应以当前代码和本次结果为准。
3. **矩阵退出口径**：Boss 难度目标允许一定比例阵亡，但 matrix 仍把每个 defeat 当失败；需先确定成功标准再把它接作 CI 门禁。
   回放 URL 默认生成端口 8942，npm start 使用 8941；复放时调整端口或以 node test/serve.js 8942 启动。
   浏览器默认完美 bot，与 Boss 矩阵的人类化 bot 不同，现有回放不保证复现同样的战斗结果。
4. **存档按来源隔离**：file:// 与 HTTP、不同端口的 localStorage 互不共用。
5. **工作区已有修改**：HANDOFF.md 的未提交修改为移除末尾原目录说明，本次保留。

## 后续建议

- P1：先复现 seed=3 的传送门导航停滞，并将“允许阵亡”和“禁止超时/异常”分开断言，防止聚合胜率掩盖运行缺陷。
- P2：统一或明确命名验收、矩阵、Boss 标定与浏览器回放的 bot 标尺，同步 README/HANDOFF 的结果及命令。
- P2：明确矩阵 Boss 阵亡的聚合验收标准与 CI 退出码语义，再扩展玩法内容。
