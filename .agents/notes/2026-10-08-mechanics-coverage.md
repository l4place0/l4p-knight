---
title: "v1.11：补强承伤、Boss、商店与跨局重置测试"
date: 2026-10-08
author: "gpt-6@Codex"
operator: "L4place"
status: archived
type: session-archive
base: "main @ 458bd1a，历史消融与变异实验暴露测试盲区"
version: "v1.11.0"
branch: main
commits:
  - "eacc460 机制契约、独立空间断言、变异基线防假绿与最终验证报告"
tags: [tests, mechanics, mutation, invariants, regression]
---

# 任务归档 · 机制测试覆盖

- **起点**：玩家承伤、Boss 效果、商店收益、跨局重置存在盲区 → **产出**：12 组真实机制契约与 44 个定向变异，纳入完整验收。

## 完成内容

1. 在隔离 VM 中加载真实游戏部件，验证六类玩家承伤、护盾／无敌帧／致命伤、六武器开火效果、Boss 三阶段轮换与八类攻击、商店收益与扣款、结算、重启状态。
2. 玩家和敌人的空间断言直接读取地图定义，覆盖完整仿真、普通房、Boss、矩阵与消融探针；不调用被测碰撞助手。
3. Boss batch 拒绝超时、停滞、异常与空间违规；37% 不能因运行故障而达标。随机变异先要求未变异探针和全量测试通过，避免基线失败产生假检出。
4. 44 个定向删改必须由实际断言检出，语法／装载失败不算检出。随机变异暴露的击退方向、狙击角度、射线墙面端点盲区已补测。
5. 历史传送门诊断冻结加载 458bd1a 的完整源码，保持四组对照可精确复现；矩阵复现命令补上对应种子。

## 验证状态

- npm test、npm run test:enemies、结构守护、未变异消融探针通过；12 组机制契约全绿。
- 定向变异 44/44 检出；固定 seed=42 的 30 个随机样本 24 检出、6 幸存（80%）。隔离快照与生产源码哈希记录在报告中。
- 矩阵诊断 1800 场景：701 clear、109 bossDown、988 defeat、2 stall，其他故障 0。退出 1 如实保留，不作为难度门全绿证据。
- 浏览器固定帧真实游戏界面完整通关；Node／实时浏览器结果存在差异，记录在 [报告](../../../docs/balance/hero-difficulty-v1.11.md)。

## 复现命令

```powershell
npm test
npm run test:enemies
npm run test:mechanics-mutation
node test/structure.check.js
node test/mutation.js --count 30 --seed 42 --json
node test/diag.portal.js 3
```

## 遗留 / 注意事项

- 随机变异幸存项涉及表现层、边界比较与 bot 决策参数；该样本不代表全仓库覆盖率，strict 仍非强制门。
- 两份系统临时目录的隔离变异快照删除被自动审批拦截，保留在系统临时目录，未纳入提交。
- 传送门与 z4b 停滞仍登记于 docs/issue/，本次未修复。

## 后续建议

- 按已登记 issue 继续处理导航停滞；根据幸存变异逐项判断业务契约与表现层验证价值。
