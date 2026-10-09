# 工程整理与 GitHub 发布 · 过程归档

状态：已完成。范围：v1.14.3 → v1.15.0 工程整理，浏览器为主版本，保持玩法与正式数值；发布到 l4place0/l4p-knight 与 GitHub Pages。

最终结论、测试数字、复现命令和限制见 [会话总结](../../../notes/2026-10-09-engineering-release.md)，本目录只整理过程。

## 过程与决策

1. 明确目录边界：Agent 过程归 .agents/，共享资料归 docs/，源码使用 src/，二进制资源使用 LFS。
2. 将数值定义和主要调参项拆为 JSON；为双击运行保留 Node 生成浏览器配置 JS，Node 仿真直接读取 JSON。加入字段、引用和非法配置检查。
3. 决定浏览器为参考主版本，其他引擎依据同一配置、规则和验收重写，本阶段不建 Cocos 工程。
4. 明确全部 MIT，GitHub 账号 l4place0、作者名称 l4place、仓库 l4p-knight。保留 Git 历史，避免破坏归档与诊断的旧提交引用。
5. 执行源码、文档和配置迁移，建立构建与 Actions；以旧提交 5d189a7 做四英雄完整局逐帧对照。
6. 验证本地和全新克隆、受限画布、浏览器实际回放，再上传 32 个 LFS 对象，完成远端 Linux CI 与 Pages 部署。
7. 线上浏览器工具超时，改用 HTTP 内容核对；Node 网络脚本在本环境未完成，使用 PowerShell 核对 38 个运行文件。

## 材料用途

| 材料 | 用途与适用范围 |
| --- | --- |
| [任务清单](2026-10-09-engineering-refactor.md) | 原计划与完成状态 |
| [migrate-engineering.cjs](migrate-engineering.cjs) | 一次性迁移快照，只适用于 5d189a7 的旧 js/ 布局 |
| [generate-schemas.cjs](generate-schemas.cjs) | 初始 Schema 推导快照；不能用来覆盖后续人工维护的契约 |
| [finalize-engineering.cjs](finalize-engineering.cjs) | 中间状态的文档与资源整理快照，非幂等 |
| [verify-published.ps1](verify-published.ps1) | 已成功运行的线上内容核对；使用 PowerShell 7 |
| [verify-published.cjs](verify-published.cjs) | Node 核对备选，带请求超时；本环境成功证据来自 PowerShell 版本 |

前三份脚本保留原始代码和原始相对路径，供审阅迁移过程，**不要在当前项目中执行**。它们最初放在 .agents/tasks/，迁入归档后也不再具备原运行位置。两份核对脚本已适配当前归档位置，只进行读取，线上内容有意改变后需要以新发布状态核对。

日常命令仍是 package.json 的 config:generate、test:ci 与 build；不得用归档脚本替代正式工程工具。

## 提交溯源

- 82c52c6：工程、JSON、LFS、MIT 与发布流水线。
- 96e97c2：旧 Agent 计划与配置归并。
- 48ecec2：Agent-only 更新不重复触发 CI/Pages。
- ed49029：正式发布验证与会话归档。

双击 file:// 本次未重新实机验收、旧历史仍含二进制、部分攻击分支常量仍在源码等限制，均保留在会话总结中；不以这次过程整理改变既有验收结论。
