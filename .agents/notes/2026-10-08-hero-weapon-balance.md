---
title: "v1.11：英雄／武器平衡与小怪、Boss 联动重标"
date: 2026-10-08
author: "gpt-6@Codex"
operator: "L4place"
status: archived
type: session-archive
base: "main @ 458bd1a 与 v1.10 未提交小怪候选"
version: "v1.11.0"
branch: main
commits:
  - "eacc460 合并小怪难度、英雄武器机制修正、联动标定与测试证据"
tags: [balance, heroes, weapons, enemies, bosses, batch]
---

# 任务归档 · 英雄／武器平衡

- **起点**：原型机跨七房通过率 64.57%，其余英雄 12–17.14% → **产出**：最终配置的两批英雄差距 13.71／12 个百分点。
- 操作者要求完成英雄／武器平衡与补测，并同此前的小怪平衡一起提交。完整数字与口径见 [v1.11 报告](../../../docs/balance/hero-difficulty-v1.11.md)。

## 完成内容

1. 修复电磁炮绕过冷却、对象池丢失追踪／榴弹弹种、重装员未按定义满状态开局、不灭战意忽略护盾，以及跨局蓄力／攻击／移动状态残留。
2. 提升冲锋枪、霰弹、导弹与榴弹输出；相位刃维持副手弹反定位。小怪区域血量附加倍率改为 3／3／3／3.2，其余五倍率保留。
3. 单房仍按四英雄平均 >0 且 <37% 验收；新增跨七房英雄 ≥10% 且 <37%、差距 ≤15 个百分点的工程门，未改成每房每英雄分别 <37%。
4. 规则修正令原 Boss batch 变为 37%／87%，同步重标攻击欲望与密度，保留生命、弹速、单发伤害、攻击池及预警。
5. 校准与最终未参与选参的 10001–10025 留出分开记录，保留 v1.10 为历史证据。

## 验证状态

- 英雄／房间共 1400 场景：269 clear、1131 defeat、运行故障 0；留出七房通过率 15/10/21/12/23/26/16%。
- 五种远程主武器通过率 17.71/10.29/34.29/13.71/17.71%，六武器共 1050 场景无运行故障；刃单持 0%，只作为副手验收。
- 两 Boss 校准 25%／30%、留出 26%／27%，400 场景无运行故障。
- Node 正常数值 prototype/seed=1979 完整通关 454.7 秒；浏览器固定帧真实界面 prototype/seed=1131 通关 367.1 秒，控制台无警告／错误。
- 实时浏览器 seed=1979 在最终 Boss 第二阶段阵亡，与 Node 有差异。上述见证只证明可达性，不是整局胜率。

## 复现命令

```powershell
npm run balance:heroes
node test/balance.js --boss boss1 --verify --human commit=30,trackK=3,sight=100,delay=10,dashSkip=0.6
node test/balance.js --boss boss2 --seed-start 10001 --verify --human commit=30,trackK=3,sight=100,delay=10,dashSkip=0.6
node test/serve.js 8941
# /test/browser-smoke.html：搜索正常数值见证，再回放真实游戏界面
```

## 遗留 / 注意事项

- 传送门导航按操作者安排延期；z4b 完美 bot 停滞 seed=9／43 仍存在，未计入难度达标证据。
- batch 是固定场景标尺，不代表真人体验；不宣称全英雄都有最终配置的整局胜局。

## 后续建议

- 后续若调整 bot 或攻防机制，重新执行房间、英雄、武器和双 Boss 门；不要沿用旧数值结论。
