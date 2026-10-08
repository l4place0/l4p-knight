---
title: "v1.14 道中与首领难度曲线平衡"
date: 2026-10-09
author: "gpt-6@codex"
operator: "L4place"
status: archived
type: session-archive
base: "908e47d · v1.13 多房间难度评定，道中偏易、失败集中最终首领"
version: "v1.14.0"
branch: main
commits:
  - "035a93c 平衡六段条件风险，缩短战斗、重标三档并归档最终与拒绝数据"
tags: [difficulty, curve, balance, rooms, bosses, simulation]
---

# 任务归档 · 道中与关底等难

- **起点**：v1.13 道中较轻、关底集中兑现压力 → **产出**：v1.14 六段压力分布与三档目标复位。

## 完成内容

1. 将等难定义为进入阶段后的条件失败率，流程分成四区道中与两场首领。新增分段受击、时间、到达与清除指标及汇总验证，不用原始阵亡总数比较不同到达分母。
2. 每房增加 1 名普通敌人、普通敌人 HP 乘 0.8；清房补给概率从每房 0.7 改为 0.7/3，恢复整层期望补给预算。
3. 四区道中承伤因子 1.6/1.45/1.85/1.5；区域守卫/最终首领承伤因子 2.05/1.5，HP 因子 0.85/0.6。三档基础系数 0.252/0.207/0.12。
4. 参数集中在 DIFFICULTY_CURVE，完整游戏按当前阶段缩放实际伤害、先扣护盾后扣生命；Boss 召唤物不套普通敌人 HP。实验伤害/敌人 HP/绝对首领 HP 探针保留原语义。
5. 最终标定 seed 1–25，每档 100 局；独立留出 seed 501–550，每档 200 局。实际默认参数无实验覆盖，固定 M3 AI、四英雄等权。
6. 最终留出通关率挑战 37.5%、标准 67.5%、休闲 98%；道中/首领条件失败率分别 14.49%/15.00%、5.83%/6.92%、0.50%/0%。差距最大 1.09 个百分点。
7. 被拒绝的 H/J/L 验证三批均保留原始数据，最终独立种子另选；旧五例超时回归现均在 1200 秒内正常胜利或阵亡。每日挑战冒烟延长至 120 秒，金币与修改器断言保留。
8. README/HANDOFF、完整报告与机器汇总已更新；历史 v1.13 汇总脚本读取当时的 profile，当前曲线不会污染旧报告。

## 验证状态

- 最终六批共 900 局（300 标定 + 600 独立留出）：超时/停滞/异常/越界/嵌墙/NaN 为 0。
- 标定 36%/67%/97%，均满足目标 ±5 个百分点；留出 37.5%/67.5%/98%，目标均在 Wilson 95% 区间内。
- `node test/difficulty-curve-report.js`：实际配置、样本数、完整 21 房/4 商店/双 Boss、总失败归属、三档目标及道中/首领差距验证通过。
- `npm test`：140 个楼层实例、阶段结算与五个旧超时回归、真实流程、压力、稳定性、机制契约全部通过；完美原型机种子 1979 于 786.7 秒通关。
- `npm run test:difficulty`、`npm run test:enemies`、`npm run test:animation`：通过，含小怪完整验收故障注入负向验证。
- `npm run test:mechanics-mutation`：44/44 检出，0 存活。
- 难度与房间浏览器回归：UI 选择/保存/实际开局/重试、门交互、封门/解封与渲染通过，页面异常 0。
- 历史 v1.13 汇总重生成无数据变化；`git diff --check` 通过。

## 复现命令

```powershell
foreach ($tier in 'challenge','standard','casual') {
  node test/difficulty-balance.js --difficulty $tier --size 100 --seed-start 1 --workers 4 --out "docs/balance/difficulty-v1.14-$tier-calibration.json" --verify
  node test/difficulty-balance.js --difficulty $tier --size 200 --seed-start 501 --workers 4 --out "docs/balance/difficulty-v1.14-$tier-holdout.json" --holdout --verify
}
node test/difficulty-curve-report.js
npm test
npm run test:difficulty
npm run test:enemies
npm run test:animation
npm run test:mechanics-mutation
# npm start；另一个终端需要 Playwright 与 Edge：
$env:PLAYWRIGHT_MODULE='C:\Users\l4place\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
node test/difficulty-browser.js
node test/rooms-browser.js
```

## 遗留 / 注意事项

- 同档道中/首领聚合风险相近，不代表每小房、各英雄或人类体验完全相同。标准首区 2%、第 4 区道中 9.32%，仍有区间差异；每英雄留出仅 50 局。
- Wilson 区间沿用旧逐局口径，同种子四英雄共享环境，独立性有限；不把点估计接近当作正式统计等效证明。
- 休闲仅四次阵亡，不能证明首领必胜。多房间 AI 不主动完整遍历可选宝箱支路。
- 被拒绝的 seed 201–250、301–350、401–450 共 1800 验证局不计入最终独立留出；H/J/L 数据明确标为 rejected。最终留出使用未参与选择的 501–550。
- 时长按仿真帧数计算，包含菜单和 hitstop；硬上限没有提高，最终留出最长局 1089.05 秒。
- 历史单房与 Boss 标定表为基础值，实际游戏还套新曲线；不能沿用旧胜率。

## 后续建议

- 优先通过真人试玩观察首区教学与第 4 区道中体验；当前聚合目标已达成，继续调整时保留固定 M3 标尺与全新独立留出。
- 若要求英雄间也等难，应作为单独平衡任务扩大每英雄样本，当前不以英雄选择强行补偿结果。
