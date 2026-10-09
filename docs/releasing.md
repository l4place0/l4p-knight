# 发布与许可

作者 l4place，GitHub 账号 l4place0，仓库 l4p-knight。源码、文档和随仓库发布的素材统一 MIT，见根 LICENSE。美术使用 ImageGen 生成，提示词与图集说明保留溯源。

```powershell
git lfs pull
npm run config:generate
npm run test:ci
npm run build
```

dist/ 包含 index.html、src/、generated/config.js、运行素材、LICENSE、release.json 和 .nojekyll，排除 Agent 文档、工具、测试、共享文档和提示词。可压缩 dist/ 为离线版，双击其中 index.html。

assets 二进制与 QA 截图使用 LFS；文本仍是普通 Git。当前版本重新纳入 LFS，保留历史与哈希，旧二进制仍在历史中；全历史迁移须更新诊断和归档引用，不在本阶段自动执行。

Pages 发布源选 GitHub Actions。pages.yml 在 main 推送/手动触发时检出完整历史与 LFS，生成配置、执行 test:ci、构建 dist、上传 artifact、部署。仅 deploy job 获 pages:write 和 id-token:write。

目标地址 https://l4place0.github.io/l4p-knight/。运行资源全部使用相对路径支持仓库子目录。Pages 不解析 LFS 指针，Actions 下载真实素材后打包；build 拒绝残留指针。

ci.yml 对 push/PR/手动运行回归与本次迁移对照，fetch-depth:0 保留历史反例。之后正式修改玩法/数值须更新或退役一次性历史对照，保留共同机制回归。

发布更新版本与 CHANGELOG。部署后检查实际站点的图片、动画、标题、开局及控制台。正式站点与本地存档隔离。
