---
title: "seed=3 传送门停滞诊断：移动惯性与 BFS 路径跟随冲突"
date: 2026-10-07
author: "gpt-6@Codex"
operator: "L4place"
status: archived
type: session-archive
base: "main @ 458bd1a（v1.9）及 onboarding 实测停滞"
version: "v1.9 diagnosis"
branch: main
commits:
  - "458bd1a 引入 Boss 重标定与 bot 人类化基因，诊断所针对的现有基线"
tags: [diagnosis, bot, portal, navigation, commit, false-green]
---

# 任务归档 · seed=3 传送门停滞诊断

- **起点**：onboarding 发现完整流程 seed=3 超过 660 游戏秒仍在第 3 区 → **产出**：根因证据、四组可复现对照与修复建议。
- 本次为“先看看”的诊断任务：新增诊断脚本及本笔记，未修改游戏逻辑或验收断言。
- commits 关联被诊断的现有提交，本次未创建 Git 提交。保留 HANDOFF.md 原有未提交修改及 onboarding 笔记。

## 完成内容

### 现场确认

seed=3 在 164.0333 游戏秒完成区域守卫死亡流程：bossRef.dead=true、bossDown[2]=true，传送门位于(200,200)，
玩家位于(270.51,58.90)，传送门位置通过玩家碰撞盒空地检查。bossRef.st 保留 dying 字样只是已死亡对象的旧字段，
G.enemies 已移除该对象；负血量与 dying 快照不能用于判定死亡演出尚未结束。

随后玩家持续移动，但到 660 秒仍未进入第 4 区。开门后累计路程 41245.57px，距离传送门最小仍为 131.58px。
因此本例是有运动而无导航进展，交互逻辑一直达不到 bot 的 <15px/玩家更新的 <16px 触发距离。

### 对照实验与根因

test/diag.portal.js 对四组实验使用相同 seed=3、相同开局与相同基因，直到传送门打开才更改一个参数。
四组开门时间、玩家坐标、传送门位置和 Boss 标志完全一致。

| 开门后的处理 | 进入第 4 区 | 最近门距 | 开门后累计移动 |
| --- | --- | --- | --- |
| 原始基因 commit=45/delay=15 | 到 660s 仍未进入 | 131.58px | 41245.57px |
| 仅 commit=0 | 开门后 2.50s | 13.60px | 228.89px |
| 仅 commit=10 | 开门后约 2.63s | 13.71px | 240.24px |
| 仅 delay=0 | 到 660s 仍未进入 | 131.58px | 41245.57px |

定位：js/bot.js 的移动惯性分支把当前方向继续保持 45 帧（加首次选方向的一帧，共 46 帧），而 BFS 路径每 0.3s 重算，
路点间隔仅 16px。96px/s 基础速度下一个承诺段目标位移约 73.6px，容易越过路点；方向不会随当前路点及时纠正，
重算路径后又将玩家拉回局部路点，形成反复绕行。本例在 29758 个导航帧中有 12168 帧的实际输入与当前导航合力相反。
仅改变 commit 即恢复推进，而改变 delay 无效，支持“承诺移动与短路点导航冲突”的结论。

### 防卡死和验收为何漏报

- bot 的 stuckT 根据“上一帧位移 <1.2px”累计；本例持续移动，maxStuck 仅 0.52s，未达到 1.1s 脱困阈值。
- 战斗 stallT 要求场上存在未死亡敌人；Boss 击破后无敌人，因此不会检测传送门导航的零进展。
- test/lib.js 将超时写入 r.errors 并令 r.ok=false；test/sim.test.js 的完整种子与英雄局仅打印 r.errors，
  主要断言坐标不变量和聚合通关数。其他局可以通关时，seed=3 超时仍会得到整体退出码 0。
- 阵亡是当前难度标定允许的结果；超时与未捕获异常需要独立作为硬失败，不能只靠聚合胜率门槛。

## 验证状态

- node --check test/diag.portal.js：通过。
- node test/diag.portal.js：四组对照完成；原始与 delay-off 均停滞，commit-off 与 commit-10 均正常进入第 4 区。
- 使用 test/lib.js 的 simulateRun(3) 再次复现相同的 660 秒超时、传送门已开和无敌人快照。
- 未修改游戏源码；未声称 seed=3 全流程通关。对照实验在进入第 4 区即结束。

## 复现命令

```powershell
node test/diag.portal.js
# 每行 JSON 对应一组实验；checkpoint 应四组一致
node -e "const {simulateRun}=require('./test/lib.js'); const r=simulateRun(3,{quiet:true}); console.log(r.errors);"
# 显示单局错误但整体仍可能退出 0 的现有验收
node test/sim.test.js
```

## 遗留 / 注意事项

- 对照实验只在开门后改参数，未改变此前战斗难度；正式修复应限定作用范围或改用路径感知的承诺中断。
- 诊断脚本的原始基因与当前 test/lib.js 保持一致，未来更改验收标尺时需同步。
- 现有浏览器使用完美 bot，默认不会触发同一 commit=45 条件；该问题主要影响人类化仿真。
- M2/M3 标尺不一致、矩阵阵亡退出码语义仍是 onboarding 记录的独立待办，本次未处理。

## 后续建议

- P1：传送门导航阶段暂停移动承诺，或在到达/越过路点时中断承诺并向前推进路点；保留战斗的人类化惯性。
- P1：新增 seed=3 区域守卫击破后的限时导航回归，断言门开启后进入第 4 区，覆盖本次“有位移但无进展”。
- P1：为仿真返回结构化结局类型（胜利/阵亡/超时/异常），完整种子和英雄局允许阵亡但禁止超时/异常；
  加入故意停滞与故意抛错的负向验证，证明总验收会返回非零。
