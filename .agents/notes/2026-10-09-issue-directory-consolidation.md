---
title: "将旧 issue 目录统一迁入 issues"
date: 2026-10-09
author: "gpt-6@codex"
operator: "L4place"
status: archived
type: session-archive
base: "v1.14.1，docs/issue 与 docs/issues 并存"
version: "v1.14.1 文档整理"
branch: main
commits:
  - "84090ff 将两项历史 issue 迁入统一目录，补齐编号、状态和引用"
tags: [issues, documentation, migration]
---

# 任务归档 · issue 目录统一

- **起点**：旧 docs/issue 含两项历史问题，新 docs/issues 含三项浏览器问题 → **产出**：统一的五项 issue 索引。

## 完成内容

1. 将 seed=3 传送门导航停滞迁为 004，将 z4b 完美 bot 战斗停滞迁为 005；原复现、数据、诊断与版本复核保留，删除空旧目录。
2. 004 按原文末尾的 v1.12 修复说明和实际 c924f23 提交统一为 closed；005 保留 open，明确此次没有复测当前版本。
3. 更新 README、HANDOFF、历史平衡报告与归档笔记的 issue 链接；同步当前交接文档中的传送门状态。
4. 修正相关 v1.10 归档笔记中多退一级的三个相对链接。历史笔记中的旧目录名称作为当时事实保留。

## 验证状态

- 检查受影响文档及全部 issue 的 55 个本地 Markdown 链接：全部目标存在，无旧目录链接。
- 对照迁移前 git 内容，两项原始诊断正文均保留；旧目录不再存在，Git 识别两次重命名。
- git diff --cached --check 通过；只整理文档，未改动游戏代码。

## 复现命令

```powershell
Get-Content docs/issues/README.md
rg --files docs/issues
# 旧目录只会作为来源/历史文字出现，不应存在 Markdown 链接
rg -n --hidden --glob '!.git/**' 'issue/.*\.md\)' .
git show --stat 84090ff
```

## 遗留 / 注意事项

- 005 的最新原始复核来自 v1.11；本次迁移不代表重新验证其当前可复现性，也不代表已修复。
- 历史 issue 未重新评定优先级，索引显示“未评定”。

## 后续建议

- 后续 issue 继续使用 docs/issues，并从 006 续接编号。
