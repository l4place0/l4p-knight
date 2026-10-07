---
title: "Boss 难度标定工具（1 batch 方法论）+ 关键发现：bot 对放射弹幕结构性免疫"
date: 2026-10-07
author: "glm-5.3-flash@Zcode"
operator: "L4place"
status: archived
type: session-archive
base: "v1.8（含消融实验与变异测试基建）"
version: "实验基建（游戏数值未变更）"
branch: main
commits:
  - "<batch-tool> test: Boss 难度标定工具（1 batch=100 场景）+ bossTuning 注入钩 + 弹幕密度钩"
tags: [balance, difficulty, batch, boss, yardstick, rl-adjacent, finding]
---

# 任务归档 · Boss 难度标定工具 + 结构性发现

- **起点**：操作者反馈「BOSS 还是太简单」，并给出方法论——BOSS 战场景 100 个/批、
  以当前 bot 通过率 < 37% 为达标线、打包为可并行的 batch 单元
- **产出**：test/balance.js 标定工具 + G.bossTuning 注入钩 + **一个推翻前提的关键发现**

## 交付物

1. **注入钩（js/game/bosses.js，默认空 = 行为逐位不变，矩阵基线已验证无劣化）**
   - `G.bossTuning.hpMul / speedMul`（loadBossRoom）· `aggression`（bossAtkInterval）·
     `bulletMul`（bossBullet）· `densityMul`（八攻击分支的弹幕计数：ring/echo-ring/fan/fanlaser/
     spiral/clones 扇/gravity 环/blinkstorm，全 TAU 均布化改造在 density=1 时与原版等价）
2. **test/balance.js（1 batch 工具）**
   - 1 batch = 100 场景（种子 × 3 英雄 × 区域构筑 BUILDS[3]/[4]，与 matrix 同表同源）
   - worker_threads 并行；通过率 = bossDown 占比（阵亡/超时/停滞/违规均计失败）
   - 模式：`--baseline`（当前数值）/ `--try k=v,...` / `--auto --target 37`
     （难度标量 d 五轴联动：hp 0.35/aggression 0.85/bullet 0.45/density 0.65/speed 0.25 每单位 d，
     线性爬升 + 二分收敛到最小达标配置）/ `--playerDmg X`（模拟测试 handicap）
3. 工具可直接复用为后续 bot 进化优化的 fitness 评估器（批量确定性仿真 = 环境，通过率 = reward）

## 关键发现（推翻了「调数值就能 <37%」的前提）

实测链条：
- 基线：两 Boss 通过率 **100%**，均损血 **-2.3/-3.3**（Boss 死后掉心+电池，净回血——Boss 战是血瓶）
- 难度标量 d=4.0（HP×2.05 / 攻击欲望×3.55 / 弹速×2.35 / **密度×2.95** / Boss 速度×1.75）：
  通过率仍 **100%**，均损血 -2.1
- 极限配置（HP×2 / 欲望×4 / 弹速×3 / **密度×5** / 速度×2.5）：仍 **100% 通过、零命中**
- 对照实验：站桩玩家 30s 吃 9 点伤害（伤害通路正常）——bot 的零命中是闪避，不是通路坏了

**结论：bot（逐帧闪避 + 冲刺无敌帧 + 护盾再生）对「单源放射/瞄准弹幕」在空旷竞技场里
结构性免疫，与数值无关。** 环弹间隙压到 < 玩家直径（约 94+ 弹/环）才会几何性无路，
且冲刺无敌帧还能硬穿。<37% 的通过率无法靠 HP/弹速/密度/欲望等数值轴达成——
**卡住的是"标尺"而非"刻度"**：bot 是完美反应的 superhuman，与人类玩家不同构。

## 三条可选路径（待操作者决策）

1. **机制变更**（真正改变难度形态）：给 Boss 加不可完美闪避的伤害形态——
   追踪弹（曲线弹道绕过直线闪避假设）、引力井拉力强化（破坏站位）、命中单位化
   （单发 2-3 伤，把"擦到"变"重创"）。可达 <37%，工作量中等。
2. **标尺人性化**（标定学正解）：给标尺 bot 加"人类化 handicap"基因——反应延迟、
   闪避失误概率 p、冲刺保守度——标定 p 使基线 Boss 的 bot 通过率落在合理区间
   （如 70%），再以 <37% 为目标标定 Boss。与强化学习设想天然衔接：
   以批量仿真为环境，进化/优化 bot 参数向量（含人类化基因）。
3. **双管齐下**：先做 1 的最小版（追踪弹）+ 2 的简化版（闪避失误率），互相校准。

## 附带数据（佐证「太简单」的体感）

- 站桩 30s 仅吃 9 伤：环弹在玩家距离的间隙约 44px（弹直径 6px）——随机走位都大概率穿过
- Boss 战净回血：死亡掉落（心+电池）> Boss 全程输出
- matrix 历史数据：boss 模板 p50 ~60s 全清、损血个位数

## 备注

- bosses.js 的密度钩在 densityMul=1 时与原版逐项等价（Math.round(n×1)=n、fan 5 发圆心
  重排等距、blinkstorm arms=4 时全 TAU 均布 ≡ 原正交四臂），探针/矩阵/structure.check 已验证
- 测试适配（sim/matrix 的标准 handicap）本轮未动——待难度形态决策后再统一处理
- balance.js 与 mutation.js 共享探针基建；后续 bot 参数进化可用 balance 的 batch 作 fitness
