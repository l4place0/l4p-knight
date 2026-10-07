---
title: "随机变异测试功能（test/mutation.js）· SQLite 思想落地"
date: 2026-10-07
author: "glm-5.3-flash@Zcode"
operator: "L4place"
status: archived
type: session-archive
base: "v1.8（消融实验之后）"
version: "实验基建（无代码版本变更）"
branch: main
commits:
  - "aa16f6f test: 随机变异测试工具（SQLite 思想——测试系统本身也要被测试）"
tags: [mutation-testing, sqlite, test-quality, cli, determinism]
---

# 任务归档 · 随机变异测试功能

- **起点**：逐行消融实验之后，操作者要求把"故意改一行、看测试能否发现"产品化为常驻功能（SQLite 的天才设计）
- **先计划后实现**：EnterPlanMode 出设计稿获批后实现

## 功能设计

- **目标池**：无头可测层 8 文件（core + game 六部件 + bot，2424 个候选变异点）；
  浏览器专用层排除（headless 原理性不可测，消融实验已实证）
- **八种 SQLite 风格算子**：CONST（数值 ±1/×2）· CMP（比较符翻转）· LOGIC（&&↔||）·
  ARITH（+↔-、*↔/）· BOOL · NEG（! 移除/插入）· DEL（整行删除）· RET（返回值 undefined 化）；
  引号感知扫描保护字符串字面量（精灵画/地图行安全），`node --check` 门槛 + 换算子重采样
- **双层检测**（复用消融基建）：tier-1 探针 test/abl/run.js（0.7s）→ tier-2 SEEDS=1 sim.test（~2.3s）；
  两层都杀不死 = 测试盲区，幸存者自动归类（数据-表现层/表现层/逻辑盲区）
- **安全**：脏树拒绝运行（--untracked-files=no 语义）；逐变异 git checkout -- 恢复并校验；
  finally 兜底恢复；结束断言树干净
- **CLI**：`--count 20 --seed S --file 关键词 --strict [阈值=60] --json`；结果落
  test/mutation-results/mutation-<seed>.json（gitignored），完全可复现

## 验证状态（提交时）

- seed 42 × count 20 连跑两次输出逐字节一致（REPRODUCIBLE，单轮 47s）
- 首轮结果：注入 20 · 探针杀 8 · 幸存 12 · 杀率 40%（与消融实验的 38% 基线吻合）
- 杀伤样例正确：DEL 自爆蜂群定义行 → 探针杀（区域权重引用致崩溃）；
  幸存样例归类正确（rooms.js:86 CMP >→>= → 逻辑盲区）
- --strict 在杀率 40% < 60% 时正确退出 1；运行前后工作树干净；structure.check 不受影响

## 首轮抽样发现（seed 42）

12 个幸存者中 8 个逻辑盲区（bot 走位力场、敌人伤害计分、rooms 重试逻辑、player 暴击倍率
*→/ 等）、1 个数据-表现层（精灵行）、1 个表现层（boss 音效）——与消融实验的系统性结论一致，
验证了工具的判别力。

## 遗留 / 注意事项

- --strict 当前必红（杀率 40%）：它是"测试质量债务"的诚实计量，补测落地（见消融实验报告
  的 7 条建议）后再转为必选门
- tier-2 在该 20 样本中 0 次追杀——样本内探针幸存者恰好都非 sim 断言覆盖面；消融实验已证明
  tier-2 平均追杀幸存者的 6-17%，样本量增大后会出现
- 管道会吃退出码（`| tail` 后 $? 取 tail 的）——验证退出码时须重定向后 echo

## 后续建议

按消融实验补测清单补杀率 → 达标后把 --strict 接入 DoD；可加 --file 按模块定向轰炸
