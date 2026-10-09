---
title: "浏览器主版本工程整理与 GitHub 发布"
date: 2026-10-09
author: "gpt-6@Codex"
operator: "L4place"
status: archived
type: session-archive
base: "5d189a7 / v1.14.3"
version: "1.15.0"
branch: main
commits:
  - "82c52c6 JSON 配置、src 迁移、LFS、MIT 与浏览器发布流水线"
  - "96e97c2 归并旧 Agent 计划与工具配置"
  - "48ecec2 Agent-only 归档推送跳过重复 CI 和部署"
tags: [engineering, configuration, lfs, github, pages, release]
---

# 任务归档 · 浏览器工程整理与发布

- **起点**：v1.14.3 → **产出**：v1.15.0 浏览器主版本、统一配置和 Actions 发布工程。

## 完成内容

1. Agent 任务、交接、提示词、旧 ZCode 计划与归档归入 .agents/；共享架构、开发、数值、玩法、发布与美术资料进入 docs/；版本历史从 README 拆至 CHANGELOG。
2. js/ 迁入 src/，同步浏览器、Node、测试、实验入口；历史 Git 诊断仍读取旧 js/，保留原提交和反例。
3. 12 组正式定义与主要调参项抽离 JSON，添加 Schema 子集校验和引用校验；Node 直接读取，浏览器由同源生成 JS。配置冻结、摘要与实验覆盖进入发布和仿真报告；晶片/羁绊按稳定 ID 绑定函数。
4. 18 张游戏 PNG 与 14 张 QA JPG 纳入 LFS，保留旧历史；构建拒绝指针文件并仅打包运行文件与 MIT LICENSE。根目录版权署名 l4place，公开 GitHub 身份 l4place0，仓库 l4p-knight。
5. CI 使用完整历史，检查结构、配置、构建、仿真、专项与定向变异；Pages workflow 下载 LFS 后发布 dist/，Agent-only 归档更新不触发重复流水线。
6. GitHub 公开仓库已上传，Pages 发布源为 workflow；首次部署和 Linux CI 均成功。

## 验证状态

- 迁移前 npm test 全绿。
- npm run test:ci：本地与全新独立克隆均通过；44 个机制定向变异全部检出。
- npm run test:equivalence：四英雄 seed=1979，131020 帧状态逐帧相同，均进入 victory；核心旧导出数据也保持一致。
- npm run check：配置校验、九种非法配置、浏览器/Node 一致性、冻结、ID 参数绑定、报告快照、发布 allowlist 和 LFS 指针拒绝均通过。
- git lfs fsck：通过，32 个 LFS 文件；全新克隆成功下载真实素材并构建。
- HTTP 根页面和 dist 子目录页面：标题、AI 开局、武器、地图与 HUD 正常；控制台 error/warn 均为空。
- [Linux CI](https://github.com/l4place0/l4p-knight/actions/runs/37915612267)：success，包含完整回归和逐帧对照。
- [Pages 部署](https://github.com/l4place0/l4p-knight/actions/runs/37915612443)：success；站点 HTTP 200，release.json 为 1.15.0，配置摘要一致。
- 线上文件核对：38 个 HTML/配置/源码/PNG 文件与本地内容一致，18 张真实 PNG 按 SHA-256 比较；验证脚本见 .agents/tasks/verify-published.ps1。
- 本地浏览器固定帧实际回放到 victory：休闲、prototype、seed=1，591.0 秒、94 击杀、35 受击、4 次商店；此前搜索见证独立仿真为 603.95 秒。

## 复现命令

```powershell
git clone https://github.com/l4place0/l4p-knight.git
cd l4p-knight
git lfs pull
npm run config:generate
npm run test:ci
npm run test:equivalence
npm run build
npm start
```

## 遗留 / 注意事项

- 浏览器工具禁止 file:// 导航，本次未重新进行双击实机验收；保留无 fetch 的配置加载、受限画布回归及此前 Edge 验收证据。
- 主要调参项和定义表在 JSON，部分敌人/Boss 攻击分支的时序、几何与特效常量仍在参考源码；其他引擎重写须结合配置、规格、源码和验收。
- 本次未进行全历史 LFS 迁移，旧二进制仍在历史，保持诊断和笔记哈希有效。
- generated/ 和 dist/ 不入库，首次克隆先生成配置；运行中不热加载。
- 正式站点浏览器工具两次超时，改用 HTTP 内容核对确认所有运行文件；本地浏览器已验证完整通关。Node 网络核对脚本在本环境未完成，改用 PowerShell 原生 HTTP 并为 Node 脚本补充 20 秒超时。
- 后续有意修改玩法或数值时，须更新/退役本次历史逐帧对照门，保留机制回归。

## 后续建议

- 平台重写以浏览器实现、共享规格、配置与测试为唯一事实源，不提前引入 Cocos 工程。
