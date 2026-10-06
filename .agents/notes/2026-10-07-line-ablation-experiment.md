---
title: "逐行消融实验：3236 行全量盘点与覆盖盲区图谱"
date: 2026-10-07
author: "glm-5.3-flash@Zcode"
operator: "L4place"
status: archived
type: session-archive
base: "v1.8（工程化改造后）"
version: "实验报告（无代码版本变更）"
branch: main
commits:
  - "06f067a test: 消融实验基建——三场景快速探针 + 超时运行器"
tags: [ablation, mutation-testing, coverage, test-gap, multi-agent, worktree]
---

# 任务归档 · 逐行消融实验（8 Agent 并行）

- **起点**：v1.8 工程化完成后，操作者要求对代码做逐行消融实验
- **方法**：逐行移除每条可消融语句（注释优先，语法失败则整行删除，仍失败记 N/A-syntax）→
  快速探针（test/abl/abl-probe.js：通关流/boss1/boss2 三场景 + 逐帧不变量，0.7s/次）→
  探针放行者逐个升级 SEEDS=1 全量验收（~2.3s/次）→ 两层都杀不死 = **覆盖盲区（SURVIVED-full）**
- **隔离**：8 个 git worktree（D:\l4place\Workspace\abl-1..8）各派一个 Agent，文件/行范围严格分区；
  逐行结果即时落盘 test/abl-results/agent-N.md（gitignored）；每行消融后 git checkout -- 恢复并校验
- **协作事实**：8 路同时派发撞并发上限（约 3 路），分两波补齐；Agent1/5 曾受 tier-2 上限 40 约束，
  事后用 test/abl/backfill.js 补跑至零未确认

## 总量与杀伤漏斗

| 层 | 数量 |
| --- | --- |
| 盘点行数（core+game 六部件+facade+bot） | 3236 |
| SKIP（空行/注释/块注释内） | 382 |
| N/A-structural（纯括号结构） | 386 |
| N/A-syntax（单行不可消融） | 488 |
| **可消融（实跑探针）** | **1980** |
| 探针杀死 | 632（31.9%） |
| tier-2 全量验收追杀 | 123（6.2%） |
| **SURVIVED-full（两层验收均放行的覆盖盲区）** | **1225（61.9%）** |

分文件：core 209+261 可消融（盲区 154/254）· state+门面 186（90）· systems 182（106）·
player 217（123）· enemies 240（152）· bosses+bot前 351（187）· rooms+bot后 334（159）。
原始逐行数据：test/abl-results/agent-1..8.md（gitignored，含每行杀死原因，可回溯）。

## 系统性盲区（跨 Agent 汇总，按危害排序）

1. **玩家侧保护是单侧的（最危险）**：不变量逐帧检查敌人嵌墙/越界/NaN，**玩家完全无空间与承伤断言**——
   玩家碰撞回退（systems:30）、全部 5 类玩家承伤结算（敌弹/爆炸/地雷/引力井/激光）可删而全绿，
   玩家可以无敌通关。bot 危险场权重（躲避质量）同理不可见。
2. **只验结果不验手段**：通关判定之外无"机制生效"断言——导弹追踪、手雷起爆、穿透、格挡、
   地雷、引力井拉扯、boss 激光开火、**boss 八种攻击的全部内部参数**（弹数/弹速/间隔/落点/瞬移）
   整体裸奔，boss 可退化为不攻击的木桩仍全绿（sim 只断言"攻击种类出现过"）。
3. **静态数据零覆盖**：core 后段 77% 存活——SPRITES 全部像素画、FONT35、地图布局行、boss 攻击池、
   ZONES 权重。低成本补法：数据结构断言（精灵列数一致/字体键完整/地图边界闭合）即可全数杀死。
4. **效果断言缺失**：商店买血/买盾/换枪/+8% 的效果、endStats 结算链（score/rating/晶片映射）、
   bot 采购决策、敌人类型分布、连击/分数/精英词条——"买到什么、结算给什么"零断言。
5. **单局流盲区**：startRun 13 行重置全部存活（无二次开局/跨局残留测试）；
   bot 防卡死/脱困脉冲/僵局看门狗/冲刺在标准局从不触发（需对抗性用例）。
6. **检测器自举**：不变量与被测逻辑共享 G.solidAtPx，对该助手的变异使探针自盲——
   不变量应内联独立实现。
7. **设计内盲区（可接受但记录在案）**：表现层（粒子/音效/震屏/横幅）约 130 行，
   headless 原理性不可测；'use strict'、防御性冗余、池纯性能面。
8. **双端加载契约只测一半**：全局 ZERO_CORE 与 require 返回值两条路径需显式互等断言。
9. **探针时间盲**：wraith（4 区）/冰霜流在 150s 快速通关中从不执行，对应变异只有 tier-2 能杀——
   探针宜补一条强制遭遇后期敌人的短场景。

## 高性价比补测建议（Agent 共识汇总）

1. 玩家逐帧嵌墙/越界不变量 + "压力局玩家受伤次数>0"反向断言（杀掉最危险一类）
2. boss 弹幕密度/攻击次数下限断言（防 boss 木桩化）
3. 纯数据结构断言（精灵/字体/地图/权重——一次断言杀 254 个盲区）
4. 商店购买效果断言（hp/shield/weapons/powerBonus/coins）+ endStats 结构断言
5. 二次 startRun 残留断言；debugJump 后地图绑定断言
6. 构造受困场景驱动 bot 自救链；敌人 AI 行为覆盖率断言（charger 冲过刺/wraith 闪现过）
7. 探针增加后期敌人遭遇场景

## 复现

```bash
node test/abl/run.js                    # 探针（干净树应 PROBE=ALIVE，~0.7s）
node test/abl/backfill.js <md> <js>     # tier-2 回填工具
# 逐行明细：test/abl-results/agent-1..8.md（每行杀死原因可回溯）
```

## 备注

- 浏览器专用层（render/audio/music/input/hud/ui/storage/main 的 DOM 行为）不在无头消融范围，
  已在报告中注明；index.html/CSS 同理
- 8 worktree 已清理；实验产物仅 test/abl-results/（gitignored）与探针基建（已入库）
- 探针与 sim.test 的互补分工得到实证：探针杀 31.9%，tier-2 在探针放行者中再杀 6-17%
  （enemies 17/169、bosses+bot 36/223、每日挑战/玻璃开局断言均有追杀战果）
