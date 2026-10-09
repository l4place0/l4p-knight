---
title: "修复浏览器通关观察的 HUD、预警与房门问题"
date: 2026-10-09
author: "gpt-6@codex"
operator: "L4place"
status: archived
type: session-archive
base: "v1.14 浏览器实际通关观察"
version: "v1.14.1"
branch: main
commits:
  - "5eff024 建立三个本地 issue，保留现场与验收条件"
  - "2b5105b 修复 HUD、预警射线与房门，补充浏览器和难度验收"
tags: [browser, issues, hud, raycast, rooms, regression]
---

# 任务归档 · 浏览器观察问题建 issue 并修复

- **起点**：v1.14 实际浏览器通关发现三个界面问题 → **产出**：v1.14.1，三个 issue 已验收关闭。

## 完成内容

1. 仓库没有远程地址，使用 docs/issues 跟踪三个问题，保留现场截图、复现步骤、验收条件和修复提交。
2. 将常驻 HUD、小地图、晶片、提示和首领血条移到战场外；窄屏按比例缩放，长晶片列表可滚动。
3. 狙击与首领蓄力预告使用实际墙体遮挡；补充斜向射线终点落入实心格时的退回修正。
4. 房门绘制贴合墙体的门框、通道、封锁门板与开启门洞；保留 E 交互和原碰撞边界。
5. 提供真实游戏 iframe 浏览器验收页面，保存 HUD、预告、房门和实战结算截图；README/HANDOFF 与修复报告同步。

## 验证状态

- 实际浏览器视觉回归：5,149 断言 PASS，四窗口尺寸，140 层 / 840 房间 / 四方向门。
- 实际对局：手动移动和 E 进入首房后启用内置 B 代打，VICTORY 628.1 秒 / 92 击杀 / 18 受击 / 15,490 分；该局页面早于附加斜向端点修正，最终端点另经重新加载的浏览器回归验证。
- npm test：完整流程、压力、7200 秒稳定性、六段曲线、碰撞和机制均通过；最终代码 prototype/1979 完美 bot 正常输入通关 803.3 秒。
- test:rooms、test:difficulty、test:animation、test:mechanics 通过；test:mechanics-mutation 检出 44/44。
- 原 seed 501–550 四英雄等权每档 200 局，共 600 局回归：37% / 67% / 98%，运行故障 0，道中/首领条件失败率最大差 1.40 个百分点。
- git diff --check 通过。

## 复现命令

```powershell
npm start
# 浏览器打开 http://127.0.0.1:8941/test/visual-issues.html，点击运行
npm test
npm run test:difficulty
npm run test:animation
npm run test:mechanics-mutation
foreach ($tier in 'challenge','standard','casual') {
  node test/difficulty-balance.js --difficulty $tier --size 200 --seed-start 501 --workers 4 --holdout --verify
}
```

## 遗留 / 注意事项

- 600 局使用既有种子作回归比较，不再称为独立留出；逐局数据和现场证据见 docs/qa/browser-fixes-v1.14.1.md。
- 浏览器验收页面构造固定场景，和实际从入口打到结算的记录分别说明；本次关闭三个已观察问题，没有宣称所有设备与随机局无缺陷。

## 后续建议

- 新的具体问题继续保留真实浏览器复现、截图和 issue 验收条件。
