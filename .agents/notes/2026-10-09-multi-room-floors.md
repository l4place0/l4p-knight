---
title: "每层多房间与房门探索流程"
date: 2026-10-09
author: "gpt-6@codex"
operator: "L4place"
status: archived
type: session-archive
base: "6c45be0 · v1.12 三档难度与既有单房楼层"
version: "v1.13.0"
branch: main
commits:
  - "c6b7fcd 每层六个相连房间、战斗封门、小地图、跨房间 AI 与回归测试"
tags: [rooms, floors, minimap, navigation, gameplay]
---

# 任务归档 · 每层多房间

- **起点**：v1.12 每层单房 → **产出**：v1.13 每层六个相连房间。

## 完成内容

1. 每层含入口、三个战斗房、宝箱房、出口，带环路与按种子选择方向的宝箱支路；每层总敌人预算沿用原值，分配至三个战斗房。
2. 靠近门按 E 往返相邻房间；进入未清战斗房后封门，两波肃清后解锁。保存未拾取物与地图状态，回访不重复刷怪或生成宝箱，不重置本层不死晶片使用状态。
3. 三个战斗房清完后，在出口领取一次晶片三选一，再开启楼层传送门；区域末层商店与双 Boss 流程保持可达。
4. 小地图显示房间图、当前房间与清房进度；AI 使用房间图 BFS 和真实 E 输入推进。切换房间时清理路径与尸体动画，即使地图模板相同也重置。
5. 新增无头房间专项与浏览器回归，专项已接入 npm test；README 与 HANDOFF 更新楼层语义及评测口径。

## 验证状态

- `npm run test:rooms`：20 种子 × 7 层 = 140 实例的连通、环路、预算、门位碰撞通过；封门、回访、宝箱去重、出口奖励、换层、Boss 房与重开通过。
- `npm test`：全部验收通过；标准难度种子 1/2/3 均通关，原型机完美 bot 种子 1979 于 471.0 秒通关，四次商店、双 Boss 三阶段完整，逐帧越界/嵌墙/NaN 为零。重装员种子 7 阵亡属于允许的实战结果。
- `npm run test:mechanics`：12 组机制契约通过。
- `npm run test:animation`：帧序、战斗映射、相同地图房间尸体重置与三种子仿真等价通过。
- `npm run test:difficulty`：三档难度配置、实际承伤、重开与导航回归通过。
- `node test/rooms-browser.js`：Edge 无头浏览器真实房门输入、封门/解封与渲染通过，无页面异常；入口、战斗、清房三张截图人工查看，调整小地图以避开 HUD。
- `git diff --check`：通过。

## 复现命令

```powershell
npm run test:rooms
npm test
npm run test:mechanics
npm run test:animation
npm run test:difficulty
# 在另一个终端运行 npm start；浏览器测试需可解析的 Playwright 包和 Edge。
$env:PLAYWRIGHT_MODULE='C:\Users\l4place\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
node test/rooms-browser.js
```

## 遗留 / 注意事项

- 三档难度承伤参数未改变，但拆房、安全房旅行和分房掉落影响实战难度；旧布局的整局胜率与单房标定不代表新布局，未重新校准 37%/67%/99% 胜率目标。
- `roomIdx` 仍使用原字段名，语义为楼层；层内房间由 `floor.current` 指定。`debugJump(zone, room)` 进入目标楼层的首个战斗房，旧单房 balance 脚本会评测该子房。
- 房门以 E 交互切换单屏地图，房间图为固定六间环路模板及上下镜像；未实现连续大地图走廊与任意房数随机生成。
- 浏览器截图写入已忽略的 `test/art-preview/`，可通过测试重新生成。

## 后续建议

- 优先按多房间完整流程重新标定三档难度与单房评测口径。
- 需要更多探索变化时再增加房间图模板与专用入口/宝箱房地图。
