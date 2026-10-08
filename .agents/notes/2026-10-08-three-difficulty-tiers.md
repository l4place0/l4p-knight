---
title: "三档难度与整局 AI 通关率标定"
date: 2026-10-08
author: "gpt-6@Codex"
operator: "L4place"
status: archived
type: session-archive
base: "103fef4：角色动作绘图归档；游戏 v1.11"
version: "v1.12"
branch: main
commits:
  - "c924f23 三档难度、整局标定、寻路修正与完整评测报告"
tags: [difficulty, balance, ai, full-run]
---

# 任务归档 · 三档难度

- **起点**：统一高强度单房难度 → **产出**：挑战/标准/休闲，整局目标 37%/67%/99%，默认标准。

## 完成内容

1. 用户明确要求整局通关率。固定 M3 AI、四英雄等权，从首房到最终 Boss，使用真实输入、经济与成长。
2. 统一承伤入口以 0.265/0.2035/0.12 缩放所有敌方危险源，护盾与不灭战意按缩放后伤害结算。
3. 开始界面选择并保存，重试沿用，HUD/结算显示档位，每日排行按难度分开。
4. 修复清场传送门方向承诺与补给干扰，以及十二秒无进展的隔墙追盾卫寻路。
5. 保存最终六份逐局报告与方法说明。探索用 seed 26–50 不作为最终留出集；最终留出 seed 51–75 未参与调参。

## 验证状态

- 三档各 100 局标定 + 各 100 局留出，共 600 局，超时/停滞/异常/空间不变量故障 0。
- 标定通过率 40%/69%/100%；未参与调参的留出通过率 36%/68%/98%，距目标各 1 个百分点。
- 留出验收：目标均位于 95% Wilson 区间，脚本 --holdout --verify 通过。
- npm run test:difficulty：档位与默认值、非法 ID、实际承伤、重试/结算、评测口径、故障拒绝、十秒门导航和 seed 33 整局回归通过。
- node test/difficulty-browser.js：选择保存、启动/重试/HUD、URL、非法存值、独立每日排行榜通过，浏览器错误 0。
- npm test、npm run test:enemies、npm run test:mechanics：通过。
- npm run test:mechanics-mutation：44/44 检出，存活 0。
- npm run test:animation、node test/animation-browser.js：通过。
- node test/structure.check.js 与 git diff --check：通过。

## 复现命令

```powershell
npm start
npm run test:difficulty
node test/difficulty-balance.js --difficulty challenge --verify
node test/difficulty-balance.js --difficulty standard --verify
node test/difficulty-balance.js --difficulty casual --verify
node test/difficulty-balance.js --difficulty standard --seed-start 51 --holdout --verify
npm test
```

## 遗留 / 注意事项

- 有限样本通过率不是玩家通关概率或每批必达值。目标属于固定 M3、四英雄等权的普通局；每日修改器与元进度未纳入评测。
- AI 演示仍使用默认较强 bot。各英雄单独通过率有差异，报告保留逐英雄数据。
- 原单房和 Boss 标定工具显式采用 damageTuning=1 保留历史口径；当前三档用 difficulty-balance 整局验收。
- 全局累计通关记录保留；新的每日成绩按日期和难度分桶，旧日期桶保留在存档中。

## 后续建议

- 调整武器/英雄/地图/AI 后重新跑固定标定和新种子留出；完整方法见 docs/balance/difficulty-v1.12.md。

