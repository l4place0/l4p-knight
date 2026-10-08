---
title: "使用 ImageGen 全面重绘零号协议游戏素材"
date: 2026-10-08
author: "gpt-6@Codex"
operator: "L4place"
status: archived
type: session-archive
base: "v1.11 / a90c5c0 英雄武器平衡与机制验证归档"
version: "v1.11 美术重绘"
branch: main
commits:
  - "21947d2 使用 ImageGen 全面重绘游戏素材并接入渲染"
tags: [imagegen, game-art, sprites, atlas, browser-qa]
---

# 任务归档 · 游戏素材全面重绘

- **起点**：v1.11 代码内嵌像素画 → **产出**：五张本地 PNG 生产图集/背景、69 项素材、完整提示词与总览页。

## 完成内容

1. 使用内置 image_gen 生成四英雄、七小怪、双 Boss、装置、六武器、补给、弹体及特效；四区共 16 个地墙材质；19 枚晶片及强化剂图标；标题工业反应堆场景。
2. 用同一绘图工具修正角色图集留白，消除终焉 Boss 侵入自爆蜂单格的问题；原生成与修正共六条实际提示词均保存。
3. Canvas 按图集单格与 alpha 边界提取精灵，统一保留透明边缘，缓存受击闪白；选择卡、对局、武器 HUD、晶片和商店显示图片。四英雄独立外观。
4. 加载完成时清理地图/精灵缓存；加载失败保留原渲染。资源使用相对渲染脚本的 URL，总览页与游戏均可加载同一素材。
5. 保留原战斗数值、地图碰撞、音效与动态攻击预警。新增真实浏览器素材验收及可重建截图，总览在 assets/art/preview.html。

## 验证状态

- `node test/structure.check.js`：A 编排、B 导出、C 语法、D UI 模块全部通过。
- `npm run test:mechanics`：12 组机制契约通过。
- `npm test`：全自动仿真自检通过；人类化 seed 1 阵亡属于允许结果，完美 bot 通关与逐帧不变量通过。
- `node test/art-assets.js`（Edge / Playwright）：五 PNG 解码、52 个透明精灵与闪白、四英雄、四区、双 Boss、晶片/商店图标、PNG 请求阻断回退通过；浏览器运行错误 0。最终角色图替换后再次通过。
- 视觉复核：总览、标题、首区、最终 Boss 与晶片界面；最终总览自爆蜂单格无邻格碎片，双 Boss 轮廓完整。
- `git diff --check` 与六条 prompts JSON 读取验证通过。

## 复现命令

```powershell
npm start
# 另一个终端（现有桌面运行时；其他环境可指向自己的 Playwright 安装）：
$env:PLAYWRIGHT_MODULE = 'C:/Users/l4place/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
node test/art-assets.js http://127.0.0.1:8941 msedge
node test/structure.check.js
npm run test:mechanics
npm test
# 浏览器打开 http://127.0.0.1:8941/assets/art/preview.html
```

## 遗留 / 注意事项

- 浏览器验收需要本地 Playwright 与 Edge；运行游戏不增加包依赖。截图位于 git 忽略的 test/art-preview/，可重建。
- 图片为高分辨率像素插画，运行时缩小；动画沿用原漂浮、翻转、闪白和程序特效。动态预警继续使用 Canvas。
- 通过 HTTP 服务打开游戏与总览，确保 Canvas alpha 边界读取同源。现有传送门诊断问题仍按原 issue 跟踪。

## 后续建议

- 以素材总览与实际对局作为后续美术迭代参考；生成变体时保持图集次序与透明留白。
