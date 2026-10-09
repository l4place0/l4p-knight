---
title: "本地文件图片像素读取限制下的渲染兼容"
date: 2026-10-09
author: "gpt-6@codex"
operator: "L4place"
status: archived
type: session-archive
base: "v1.14.2，用户 Edge 双击 index.html 后只显示地图"
version: "v1.14.3"
branch: main
commits:
  - "0674cd6 捕获图集像素读取 SecurityError，补齐受限画布回归与浏览器证据"
tags: [render, canvas, local-file, browser, regression]
---

# 任务归档 · 本地文件画布渲染兼容

- **起点**：v1.14.2 用户截图 → **产出**：v1.14.3 兼容修复及 issue 006。

## 完成内容

1. 图集裁剪使用 getImageData，未处理 SecurityError；地图可画但后续精灵和 HUD 绘制中断，与用户症状吻合。
2. 只处理 SecurityError，受限画布绘制完整图集格；HTTP 正常画布继续 alpha 裁剪，其他异常继续传播。
3. 回归覆盖精灵、受击闪光、标题/武器/晶片图标、缓存、空图块和正常裁剪；旧提交渲染器在相同限制下重现异常。
4. HTTP 故障注入页面加载真实游戏与 PNG，禁止像素读取，用户界面仍能正常开局；截图保留在 issue 006。

## 验证状态

- npm run test:render：通过，并纳入 npm test。
- npm test：全部通过；正常输入完美 bot 仍 577.1 秒通关。
- node test/structure.check.js：编排、模块、语法与 UI 注册全部通过。
- 普通 HTTP 浏览器开局正常；故障注入浏览器拒绝 6 次像素读取、未捕获异常 0，角色和 HUD 正常。

## 复现命令

```powershell
npm run test:render
npm test
node test/structure.check.js
npm start
# http://127.0.0.1:8941/test/restricted-canvas.html
```

## 遗留 / 注意事项

- Edge 通道未启用，内置浏览器安全策略禁止 file://；未绕过限制，未宣称 Edge 双击实机验收。用户刷新/重新打开本地文件后复核。
- 受限模式保留透明留白，部分静态图标可能稍小；动画、伤害、物理与难度没有改动。
- [issue 006 与浏览器证据](../../docs/issues/006-local-file-canvas-security.md)。

## 后续建议

- 后续渲染改动保留像素读取被拒绝的回归，HTTP 与本地文件打开方式分别验收。
