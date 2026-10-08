---
title: "角色完整动作绘图与过程帧接入"
date: 2026-10-08
author: "gpt-6@Codex"
operator: "L4place"
status: archived
type: session-archive
base: "d5124b4：v1.11 游戏素材静态重绘已归档"
version: "v1.11 + 角色动作图集"
branch: main
commits:
  - "1dbaeb4 绘制 13 张角色动作图集并接入战斗动画"
tags: [animation, imagegen, art, gameplay]
---

# 任务归档 · 角色完整动作与过程帧

- **起点**：静态角色图 → **产出**：13 角色、91 动作组、546 绘制帧及交互预览。

## 完成内容

1. 内置 ImageGen 为四英雄、七小怪、双 Boss 各绘制七行六帧透明图集。提示词与修整历史保存在 animations/prompts.json。
2. 固定单格缩放缓存，保留动作位移；接入移动、开火、挥刃、冲刺、受击、特殊状态、Boss 转阶段和死亡过程。向左镜像，死亡不循环。
3. 玩家死亡立即结束战斗，结算界面等待动画末帧；普通敌人死亡快照只用于绘制，房间和角色变化时清理。
4. 预览支持原始帧放大、六帧排列、角色/动作切换、播放暂停、速度、逐帧滑块与翻转。主说明与静态总览均提供入口。

## 验证状态

- node test/animation-browser.js：13 PNG、546 帧透明且非空、91 组至少三帧有区别；实际移动遍历全部六帧，挥刃/冲刺/受击/死亡时序、预览缩略图与回退通过，浏览器错误 0。
- npm run test:animation：播放优先级、终帧、状态映射、房间残骸清理；真实动画回调与无动画仿真 3 种子 × 700 步等价。
- node test/art-assets.js：5 静态图、52 精灵及闪白、英雄/四区/双 Boss/UI/回退通过。
- node test/structure.check.js：18 脚本编排与模块/语法检查通过。
- npm run test:mechanics：12 组机制契约通过。
- npm run test:mechanics-mutation：44 个变异全部被检出。
- npm test：全流程仿真通过。
- git diff --check：通过。

## 复现命令

```powershell
npm start
# 另一个终端；需本地 Playwright 与 Edge：
npm run test:animation
node test/animation-browser.js http://127.0.0.1:8941 msedge
node test/art-assets.js http://127.0.0.1:8941 msedge
# 打开 http://127.0.0.1:8941/assets/art/animations/preview.html
```

## 遗留 / 注意事项

- 图集为单视角高分辨率像素插画，左右共用镜像；没有上下或八方向独立动作。
- 已修整明显越格刀光与大面积噪点。生成图中的个别细小光点、发光边缘及姿态留白仍有差异；并非逐像素手工动画。
- 浏览器测试通过 PLAYWRIGHT_MODULE 指定已安装模块时无需新增项目依赖。截图保存在已忽略的 test/art-preview/。

## 后续建议

- 如后续需要多方向攻击，按角色分别补充方向图集，再扩展动作映射；当前战斗方向与碰撞仍使用原逻辑。

