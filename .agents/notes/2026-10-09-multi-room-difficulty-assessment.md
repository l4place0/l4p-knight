---
title: "多房间版三档难度的 600 局实测评定"
date: 2026-10-09
author: "gpt-6@codex"
operator: "L4place"
status: archived
type: session-archive
base: "00d9f02 · v1.13.0 每层多房间，旧难度参数沿用"
version: "v1.13.0 难度评定报告"
branch: main
commits:
  - "ab41492 补齐多房间评测指标，归档 600 局数据与难度评定"
tags: [difficulty, assessment, rooms, simulation, balance]
---

# 任务归档 · 多房间难度评定

- **起点**：多房间版未经新胜率标定 → **产出**：固定参数 600 局评定及可复现逐局数据。

## 完成内容

1. 沿用 v1.12 固定 M3 AI 和三个承伤系数，不修改游戏代码或难度数值。每档 200 局：seed 51–75 比较批、seed 101–125 新种子批，四英雄等权。
2. 评测脚本补齐层内房间进度、21 房肃清计数、区域到达/阵亡/受击/时间与商店、晶片信息；超时计时上限修正至 1200 秒。
3. 合计通关率：挑战 153/200（76.5%）、标准 191/200（95.5%）、休闲 200/200（100%）。挑战、标准显著高于原 37% / 67% 目标。
4. 同一比较批旧版→新版：挑战 36%→80%，标准 68%→95%，休闲 98%→100%。标准成功局中位时长 430.28→596.62 秒。
5. 挑战 47 次阵亡中，44 次在第 4 区、36 次在最终首领；标准 9 次阵亡全部在最终首领，说明固定标尺下压力集中在最后。
6. 汇总脚本验证参数、英雄等权与胜利流程完整性，并提供 Wilson 区间及按种子整组分层 bootstrap 区间。报告明确区分测量结果与未消融的机制解释。

## 验证状态

- 六批整局仿真合计 600 局：超时/停滞/异常/越界/嵌墙/NaN 故障全部为 0。
- `node test/difficulty-assessment.js`：全部文件与参数/计数契约验证通过，汇总成功。挑战聚类 95% 区间 70–83%，标准 92.5–98%，原目标均在区间外。
- `npm run test:difficulty`：三档承伤、重开、导航与新增 21 房/4 商店/逐区计数契约通过。
- `npm test`：完整自检通过，含 140 个楼层专项、实战通关、双 Boss、压力、稳定性与机制契约。
- `git diff --check`：通过。

## 复现命令

```powershell
foreach ($tier in 'challenge','standard','casual') {
  node test/difficulty-balance.js --difficulty $tier --size 100 --seed-start 51 --workers 3 --out "docs/balance/difficulty-v1.13-$tier-comparison.json"
  node test/difficulty-balance.js --difficulty $tier --size 100 --seed-start 101 --workers 3 --out "docs/balance/difficulty-v1.13-$tier-fresh.json"
}
node test/difficulty-assessment.js
npm run test:difficulty
npm test
```

## 遗留 / 注意事项

- 评测是固定 M3 AI 的概率，不等于人类胜率；可选宝箱路线未主动完整探索。
- 本任务只评定，挑战/标准仍未满足旧目标，不能把脚本退出码 0 当作目标达标：测量命令未加 `--verify`。
- 同种子四英雄共享环境，Wilson 逐局区间仅作旧口径参考；聚类 bootstrap 已另给。休闲全成功时 bootstrap 区间退化，不能证明真实必胜。
- 普通房同时威胁下降、清房补给机会增加与更多护盾恢复时间是实现支持的解释，未做消融来测量各因素贡献。
- 报告时长按仿真帧数计算，含选择/商店与 hitstop；旧新成功局集合不同，中位时长比较仅为条件描述。

## 后续建议

- 优先重新平衡普通房的波次压力和整层补给预算，避免只提高最终首领难度。
- 再标定 37% / 67% / 99% 目标，并使用全新种子作最终留出验收；本次两批已看过，不能继续称为独立最终留出。
