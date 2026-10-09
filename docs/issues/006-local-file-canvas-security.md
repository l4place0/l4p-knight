# 006 · Edge 直接打开 index.html 后只显示地图

- 优先级：P1。
- 状态：修复已落地，受限画布回归与 HTTP 浏览器验收通过；待用户 Edge 本地文件复核。
- 发现版本：v1.14.2；修复版本：v1.14.3。
- 来源：2026-10-09 用户截图，地址为 `D:/l4place/Workspace/soul-knight/index.html`，地图显示但角色与 HUD 消失。
- 修复提交：见后续归档。

## 原因与修复

图集精灵通过 `getImageData()` 读取 alpha 以裁掉透明留白。Chromium 的本地文件图片可能可以绘制，但画布不允许读取其像素；
未处理的 `SecurityError` 中断绘制与后续 HUD 更新，表现与截图吻合。
依据：[MDN 画布安全限制](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image)。

只捕获像素读取的 `SecurityError`，改为绘制完整图集格，角色、武器、晶片和受击闪光继续显示；
正常 HTTP 模式仍裁剪透明边缘，其他类型的渲染错误继续抛出。
受限模式会保留图集透明留白，因此部分静态图标可能稍小；不改变逻辑尺寸上限、碰撞、战斗或难度。

## 验证

- `npm run test:render`：正常 alpha 裁剪、空图块、受限画布精灵/闪光/图标、缓存、非安全异常传播均通过。
- 从 `f4d71cc` 加载旧渲染器，在同一受限画布测试中重现 `SecurityError`。
- `npm test` 全部通过，测试纳入常规验收；完美 bot 流程仍在 577.1 秒正常通关。
- 普通 HTTP 页面：标题加载、点击开始游戏、角色与 HUD 正常。
- [HTTP 故障注入页面](../../test/restricted-canvas.html)：真实 PNG、游戏 UI 与主循环，强制拒绝像素读取后仍能开局，生命/武器/关卡 HUD 正常，未捕获异常为 0。
- [浏览器证据](../qa/local-file-canvas-after.jpg)。该页面测试的是受限画布兼容，没有访问本地文件协议。

当前浏览器工具没有 Edge 通道，内置浏览器安全策略禁止 `file://`；因此没有宣称完成 Edge 双击文件的实机验收。
用户重新打开或刷新 `index.html` 后复核；也可用 `npm start` 后打开 `http://127.0.0.1:8941/` 游玩。

## 复现与验收命令

```powershell
npm run test:render
npm test
npm start
# HTTP 故障注入验收： http://127.0.0.1:8941/test/restricted-canvas.html
```
