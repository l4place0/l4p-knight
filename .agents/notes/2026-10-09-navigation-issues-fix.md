---
title: "004/005 导航与战斗停滞修复及验收"
date: 2026-10-09
author: "gpt-6@codex"
operator: "L4place"
status: archived
type: session-archive
base: "v1.14.1，历史 issue 004/005 已统一迁入 docs/issues"
version: "v1.14.2"
branch: main
commits:
  - "f4d71cc 修复电磁炮与隔墙冲锋停滞，补齐原始门检查点、浏览器及完整局验收"
  - "c924f23 已有清场传送门惯性修复，本次验证保留"
tags: [navigation, bot, regression, browser, issues, difficulty]
---

# 任务归档 · 004/005 导航与战斗停滞修复

- **起点**：v1.14.1，两个历史 issue → **产出**：v1.14.2，两个 issue 验收关闭。

## 完成内容

1. 004 保留已有修复，从 `458bd1a` 实际运行原 seed=3 战斗至 164.03 秒开门、原玩家位置与守卫死亡；仅替换开门后的 bot，保留原人类化基因，2.18 秒经正常输入进入第四区。当前地图门场景 Node/浏览器均 2.15 秒。
2. 005 旧三个种子已能清房，扩样复现 prototype/46 电磁炮墙边反复取消蓄力、prototype/52 隔墙冲锋规避覆盖 BFS 路线。只在现有四秒战斗零进展的脱困阶段保持电磁炮射击、过滤隔墙冲锋预警，没有调整伤害、冷却与难度系数。
3. 共享固定场景纳入 `test:navigation` 和 `npm test`。移除三个修复分别复现停滞/超时，冻结物理与更新异常 CLI 均退出 1；独立空间检查持续生效。
4. 浏览器实时运行普通输入与物理，46/52 分别在 28.47/25.22 秒清房并开门；保留三个最终截图与开发验收页面。
5. 全局过滤冲锋预警的候选虽过 800 子房，却导致 bulwark/518/休闲档完整局超时，因此拒绝并保留失败数据。最终收窄后该局 707.47 秒胜利，纳入固定回归。

## 验证状态

- `npm test` 通过；完美 prototype/1979 577.1 秒胜利，商店、两个首领全部阶段覆盖。
- `npm run test:navigation` 通过五个 z4b 种子、历史原检查点、完整 bulwark/518、三项修复移除及错误退出码。
- 机制变异检测 44/44；动画三种子各 700 帧等价；三档难度及曲线回归通过。
- 四英雄 × seed 1–200：800/800 z4b clear，无停滞、超时或空间违规。
- 三档各 200 完整局，seed 501–550：挑战 37.5%，标准 65.5%，休闲 98%；超时/异常 0，所有胜利局均清完 21 战斗房、4 商店、2 首领。
- 道中/首领阵亡率差距分别 3.74/1.50/0.50pp；原目标胜率均在 95% 置信区间内。

## 复现命令

```powershell
npm test
npm run test:navigation
node test/matrix.js --seeds 1-200 --run z4b --workers 4
foreach ($tier in 'challenge','standard','casual') {
  node test/difficulty-balance.js --difficulty $tier --size 200 --seed-start 501 --workers 4 --holdout --verify
}
npm start
# http://127.0.0.1:8941/test/navigation-browser.html
```

## 遗留 / 注意事项

- 浏览器为问题固定场景验收；完整流程统计来自 Node 自动仿真。本次没有宣称手动从第一区通关。
- 浏览器与 Node 耗时单列，不宣称跨引擎逐帧等价；seed 501–550 是既有回归样本，不是新的独立留出。
- `diag.portal.js` 固定旧代码以保留历史失败，当前修复验收使用 `test:navigation`。
- 完整数据、候选失败及截图见 [修复报告](../../docs/qa/navigation-issues-v1.14.2.md)。

## 后续建议

- 后续导航改动继续运行固定卡点与完整局回归，防止只过子房测试而破坏整局推进。
