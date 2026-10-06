# HANDOFF · 零号协议 ZERO PROTOCOL 开发交接文档

> 交接日期：2026-10-06 · 交接版本：v1.6（基于 v1.5，按路线图第 5 项扩展）
> 项目来源：`ai-benchmark/glm-5,3-flash/zcode/My Soul Knight/shot01`（已完整复制至本目录，逐文件 diff 校验一致）
> 本文目标：让任何开发者（人或 AI）在不询问原作者的情况下继续开发。

---

## 1. 这是什么项目

类《元气骑士》的黑白灰像素风 2D 肉鸽弹幕射击游戏。纯原生 HTML5 Canvas + Web Audio，
**零依赖、零外部资源、零构建步骤**。当前内容：**4 英雄**（第 4 英雄与初始晶片槽为元进度解锁）/
4 区域 / 6 武器 / 19 晶片（同名重复
获取转为升级，×1.5/级）/ 10 羁绊 / 7 敌种 + 精英词条 / **双三阶段 Boss**（第 3 区守卫 +
最终首领）/ 金币商店 / 历史纪录存档 / **两首合成 BGM**（探索/Boss，战况自动切换）/
**每日挑战**（固定种子 + 按日轮换修改器 + 本地排行）/ **元进度解锁**（纪录达标解锁英雄/初始晶片槽）。

**当前状态：功能完备、验收全绿。** 接手后第一件事：跑一遍验收（见 §3），确认基线。

## 2. ⚠️ 本项目最重要的规则

> **任何代码改动，必须在改动后保持 `node test/sim.test.js` 全绿。**

这不是普通测试，而是本项目的核心验收机制：无头仿真以**真实物理与碰撞**运行游戏本体（零 mock），
由内置 AI 代打从第 1 区打到击败最终 Boss 触发 VICTORY，并逐帧断言：

1. 主循环高压下不卡死、无未捕获异常（含 30 敌 + 260 弹压力场景、7200 游戏秒稳定性）
2. 敌军受击击退不穿墙、不越界（逐帧四角采样断言）
3. Boss 三阶段血量阈值精确（2/3、1/3）、转阶段无死锁
4. VICTORY 可触发；另含全英雄通关与"隔墙锁定回归"场景

历史上 8 个严重 bug 全部由该机制或其配套诊断脚本抓出（详见 README 评测章节）。
**如果你改了游戏逻辑而测试没跑，等于没改。**

## 3. 常用命令

```bash
node test/sim.test.js          # 完整验收（约 1-2 分钟，退出码 0 = 全绿）
SEEDS=1 node test/sim.test.js  # 快速单种子冒烟
node test/matrix.js --seeds 1-3 --workers 6   # 场景矩阵：批量并行（秒级，见下）
node test/matrix.js --list                    # 枚举全部场景（JSON）
node test/matrix.js --run z4b/stalker         # 只跑匹配前缀的场景
node test/matrix.js --seeds 1-5 --save-baseline test/matrix.baseline.json  # 存基线（p50/p95）
node test/matrix.js --seeds 1-5 --baseline test/matrix.baseline.json       # 与基线对比劣化
node test/diag.js <seed>       # 卡点诊断：逐秒打印玩家/敌人/输入微观状态
node test/serve.js 8941        # 本地服务器 → http://127.0.0.1:8941/
node --check js/<file>.js      # 语法检查（patch 后必做）
```

**场景矩阵（test/matrix.js）**：测试漏斗上游——地图×英雄×种子×按区域深度的合成构筑，
全确定性、worker 并行、断言只用游戏时间。基线对比用**方差感知阈值**
（`max(基线p95×1.25+1, 基线max×1.1)`，高方差模板的单种子离群不算劣化）。失败场景输出 JSON 报告：结局分类
（timeout / stall 停滞 / defeat / violation 越界嵌墙NaN / error）、最近 ~32 游戏秒实体轨迹、
`replayUrl`（浏览器定向回放，URL 即场景编码：`?seed&hero&bot&autostart&zone&room|boss&chips&power&shield`）
与 `rerun` 命令。回放纪律：**每次回放用新建标签页**，不要按 URL 模式匹配旧标签（会绑到陈旧状态）。

直接双击 `index.html` 也能玩（file:// 可用，无 fetch/模块依赖）。

调试 URL 参数：`?seed=1` `?bot=1`（AI 代打） `?autostart=1` `?daily=1`（每日挑战：强制 seed=YYYYMMDD +
当日修改器 + 结算计入本地排行） `?zone=2&room=1` `?boss=1`
`?dmg=8` `?bosshp=210`（数值调试）`?fps=1`。页面暴露 `window.__advance(frames)` / `window.__draw()`
（无头推进 + 重绘，供自动化截图与 QA）。

## 4. 架构与文件地图

```
index.html      界面壳：canvas + 全中文 HUD/横幅/晶片卡片/商店/结算屏（DOM 层，CSS 内联）
js/core.js      纯数据层：常量、武器、英雄、敌人、晶片、羁绊、地图、3x5 像素字体、字符画精灵
js/game.js      游戏逻辑层：状态机、玩家、敌人 AI、Boss、子弹/地雷/激光、波次、商店、碰撞
js/render.js    渲染层：精灵预渲染缓存、瓦片底图缓存、发光弹幕、特效（仅浏览器加载）
js/bot.js       AI 代打：BFS 寻路接敌（含路由粘滞：目标瓦片挪 1 格不重算路径，防等长备选路线反复
                横跳）+ 16 向评分走位 + 弹幕/地雷/激光（隔墙光束不规避）/引力井/自爆蜂威胁场 +
                破盾战术 + 全场进展僵局看门狗（4 秒零伤害进展 → 锁定最近敌人 + 贴身刃破盾 +
                压制拾取物吸引与自爆蜂规避）+ 晶片/商店购买决策（与人类玩家共用同一 G.input 接口）
js/audio.js     Web Audio 合成音效（约 35 种），压缩器限幅
js/music.js     步进音序器 BGM：探索/Boss 双曲目，低通氛围区分（950/2800Hz），Boss 战自动切换，
                前瞻调度（音频时钟）+ 标签页隐藏停排；输出挂 audio.js 主总线（M 键一并静音）；
                仅浏览器加载，main.js 以 `ZERO_MUSIC || null` 引用，删文件即下线
js/main.js        启动、输入映射、固定步长主循环、HUD DOM 更新、界面流转、localStorage 纪录、
                  每日挑战面板与排行、场景回放 URL 参数（hero/chips/power/shield）
test/sim.test.js  ★ 验收测试（§2）
test/matrix.js    场景矩阵：无头批量 × worker 并行 × 停滞检测 × 失败轨迹 + 回放 URL（§3）
test/diag.js      卡点诊断工具
test/serve.js     静态服务器
```

### 模块边界契约（改动前必读）

- **game.js 必须保持 headless 可运行**：逻辑中禁止直接触 DOM / canvas / AudioContext /
  `setTimeout`。渲染通过 `root.ZERO_RENDER.attach(G)` 在非 headless 时注入；
  音效通过 `G.sfx(name)` 钩子（headless 为空函数）；延时用内置 `setTimeoutLike` 队列。
  这是无头仿真得以成立的前提。
- **bot 与人类同权**：bot 只能写 `G.input`（moveX/moveY/aimA/fire/dash/melee/interact），
  与键鼠映射走同一路径。不要给 bot 开后门（如直接改玩家坐标）。
- **渲染与音乐层可随时删除**：删掉 render.js / music.js，逻辑与测试不受影响（音乐经
  `ZERO_MUSIC || null` 守卫，frame 中 `if (MUSIC) MUSIC.update(G)` 驱动）。

### 关键机制速查

| 机制 | 位置 | 要点 |
| --- | --- | --- |
| 碰撞 | game.js `moveAxis` / `resolveOutOfWall` | 逐轴回退式（位移 < 9px < 墙厚 16px 防隧穿）+ 中心在墙内时最小面推出 + **箱体角嵌入墙角时最小穿透轴兜底推出**（历史 bug #4、#9）。**不要改回钳位式** |
| 刷怪点 | `computeReachable` / `farSpot` | 只用玩家出生瓦片 BFS 可达点，杜绝封闭凹室死局 |
| Boss 定义 | core.js `ENEMY_DEFS.boss / .boss2` | `isBoss` 走 Boss 状态机；`phases` 三阶段名/色；`pools` 各阶段攻击池；`final` 标记最终首领（击破 → VICTORY），非 final 击破 → 传送门进下一区 |
| Boss 死亡 | `bossDying` / `updateBoss` | Boss 死后**滞留** enemies 列表走 dying 演出，完成后置 `dead` 并写 `G.bossDown[zoneIdx]`；提前移除会死锁（历史 bug #2） |
| 房间流程 | `updateWaves` → `offerChips` → `chooseChip` → 区域末尾 `openShop` → `shopLeave` → `openPortal` → `nextLevel` | `nextLevel`：房内推进 → 区域末尾有 `bossId` 且未击破 → 首领房；首领房传送门 → 下一区。`chipOffered` 一次性标志防重复触发 |
| 引力井 | game.js `G.wells` / `updateWells` | Boss2 专属：范围内拉扯玩家（冲刺 `dashT > 0` 时免疫拉扯），到期内爆 `explode`；bot 在 `computeDanger` 规避 |
| 属性系统 | `computeStats` | 晶片 apply → 羁绊 apply → 武器自适应（pierce+电磁炮=无限贯穿）→ 商店永久加成（bonusShield/powerBonus）→ 英雄底子；**createGame 时即初始化**（标题 HUD 依赖，bug #10） |
| 晶片升级 | `G.chipLv` / `G.acquireChip` | 已持有晶片再次获取 → `chipLv[id]++`（不重复入列表）；`computeStats` 以 k = 1.5^lv 调 `apply(s, k)`；整数型效果 ceil 进位、乘法减益设下限、触发型晶片缩放数值面（`frostK/chainK/reloadK/luckyK/splitK` 随属性袋传递）；分裂减伤的羁绊退款按 `s.splitK` 同步 |
| 每日挑战 | core.js `DAILY_MODIFIERS` / `dailyForDate` | 日期字符串 FNV 哈希 → 当日两枚去重修改器 + seed=YYYYMMDD；`startRun(hero, daily)` 写 `G.daily.flag`，效果落点：守卫/Boss/清房掉落（coinOnly）、金币数（coinRain）、精英概率（eliteUp）、商店折扣（shopSale）、开局晶片（glassStart）；**非每日路径逐位不变**（矩阵基线不受影响）；排行在 main.js localStorage `zp_daily`（每日前 5） |
| 弹道扩展 | `updateBullets` | `b.kind`：'homing'（转向最近敌人）/ 'grenade'（撞墙/命中/超时引爆 `grenadeBoom`） |
| 状态机 | `G.state` | title / playing / chip / shop / victory / defeat / paused；chip 与 shop 冻结世界 |
| bot 导航 | bot.js `bfsPath` + 16 向评分 | 无视线目标或传送门 → BFS 路径跟随；评分含**箱体真实位移模拟**（防卡墙）；连续受困 3 次给随机脱困脉冲 |
| bot 决策 | `pickChip` / shop 分支 | 晶片按权重+羁绊完成度+武器适配打分；商店按 回血>晶片>护盾>武器>强化 采购，买不起就离开（保证无死锁） |

## 5. 常见扩展怎么做（改哪些文件）

### 加一把武器
1. `core.js` WEAPONS 加定义（特殊弹道加 `kind`/`bulletLife`/`bulletR`，在 `updateBullets` 实现行为）
2. `core.js` SPRITES 加武器字符画（枪口朝右，渲染时按瞄准角旋转）
3. `bot.js` WEAPON_TIER / BAND / CONE 加条目（bot 才会用它）
4. 加入晶片箱池（game.js `loadRoom` 的 crate pool）与商店武器池（`openShop`）
5. 跑验收：bot 需要能用它通关

### 加一种敌人
1. `core.js` ENEMY_DEFS 加数值（contact: 0 表示无接触伤害，如自爆蜂）
2. 区域 `weights` 加入（控制出现区段与频率）
3. game.js `updateEnemy` 加 AI 分支（注意复用 `e.state/e.t/e.cd` 计时惯例）
4. `core.js` SPRITES 加精灵
5. bot.js：`pickTarget` 权重 + `computeDanger` 威胁场（若它有爆发性威胁，如自爆蜂）
6. 若它会自爆/召唤，注意与 `killEnemy`（连击/金币/引爆核心链）的交互

### 加晶片 / 羁绊
1. `core.js` CHIPS / SYNERGIES（晶片 `apply(s, k)` 修改属性袋，**k = 1.5^升级等级**：加成写 `s.x += 基值*k`，
   整数型用 `Math.ceil(基值*k)`，乘法减益设下限；触发型晶片把 k 存入属性袋如 `s.chainK = k`，在效果落点读取）；
   羁绊 `need` 引用晶片 id
2. game.js `computeStats` 的 `s` 默认值加字段；效果落点通常在 `damageEnemy` / `killEnemy` / `updatePlayer`
3. bot.js `CHIP_SCORE` 加权重（bot 才会选它）

### 加英雄
`core.js` HEROES 加条目即可 —— 标题英雄卡由 `main.js buildHeroCards` 自动生成；
并在 sim.test.js 的英雄仿真循环里加 id（验收要求全英雄可通关）。
元进度锁定的英雄（如 `prototype`）：锁只是 main.js 的 UI 门控（`unlocks()` 读 `zp_records.clears`），
无头仿真与 URL `?hero=` 回放不受影响；**新英雄会扩大矩阵模板面**（模板按 `Object.keys(HEROES)` 枚举），
合入后须 `--save-baseline` 重建基线。

### 加区域 / 新 Boss
1. `core.js` MAPS 加地图（30×17，`#` 为墙；行宽与出生点连通性有校验脚本，见 §3 后自查）
2. ZONES 加区域：`maps` 列表、`weights`、区域色 `accent`；若该区末尾要打 Boss，加 `bossId: 'xxx'`
3. 新 Boss 在 `ENEMY_DEFS` 加条目：`isBoss: true`、`phases`（三阶段名/色）、`pools`（各阶段攻击池，
   可复用 ring/fan/fanlaser/mines/spiral，或在 `updateBoss` 加新 atk 分支）、`final: true` 仅给最终首领
   —— **务必保持转阶段只触发一次**的标志位写法（`e.st` 与血量阈值双保险，`bossTransition` 只在 phase 边界触发）
4. 新敌人填充：ENEMY_DEFS 数值 → 区域 weights → `updateEnemy` AI 分支（复用 `e.state/e.t/e.cd` 计时惯例）→
   SPRITES 精灵 → bot.js `pickTarget` 权重（有爆发威胁再加 `computeDanger`）
5. 波次预算公式在 `loadRoom`：`budget = 3 + (zoneIdx+1)*2 + roomIdx*2`
6. 跑验收：bot 需要从第 1 区一路通关（含全部首领）

### 加回归测试
sim.test.js 各段落互相独立，复制一段改场景即可（参考【隔墙回归】：debugJump 定图、
debugClear 清场、debugSpawn 摆怪、限时断言）。诊断卡点用 `test/diag.js` 改参数。

## 6. 已知限制 / 技术债（遗留）

1. **bot 单帧峰值有 JIT 预热尖峰**（首次 BFS/大量分配）：无害（远低于 3s 熔断），
   若扩展弹幕规模建议做对象池。
2. **纪录仅存 localStorage**：file:// 与 http 的存储隔离，无跨设备。
3. **bot 高压下仍可能掉血但能通关**：英雄平衡改动后务必重跑全英雄仿真。
4. **z2a 地图有 32 格封闭内室**（装饰性，BFS 可达刷怪已规避死局，纯浪费空间）；如改造需重验第 2 区平衡。
5. **引力井仅拉扯玩家**：如需拉扯敌军，注意与击退衰减、`resolveOutOfWall` 的交互并重跑嵌墙回归。

## 7. 建议开发路线图（按优先级）

1. ~~第 4 区 + 第二 Boss~~ ✅ 已完成（v1.2：z4a/z4b + 终焉·回响体 + 虚空徘徊者/镜像残影 + 双 Boss 流程）
2. ~~晶片去重与升级~~ ✅ 已完成（v1.3：同 id 重复获取转为升级 ×1.5/级，商店同规则，UI/bot/矩阵基线全同步）
3. ~~背景音乐~~ ✅ 已完成（v1.4：探索/Boss 双曲步进音序器 + 低通氛围区分 + Boss 战自动切换 + M 键统一静音）
4. ~~每日挑战~~ ✅ 已完成（v1.5：seed=YYYYMMDD + 五枚按日轮换修改器 + 标题面板 + localStorage 每日前 5）
5. ~~元进度解锁~~ ✅ 已完成（v1.6：通关 1 次解锁第 4 英雄「零·原型机」，通关 3 次解锁初始晶片槽，纪录推导 + UI 门控）
6. **手柄 / 移动端触控**：main.js 输入层已隔离，加映射即可。
7. **性能**：若弹幕规模扩到 1000+，particles/bullets 改对象池 + 分帧碰撞。

## 8. 改动完成标准（Definition of Done）

- [ ] `node --check js/*.js` 全部通过
- [ ] `node test/sim.test.js` 全绿（全部种子 + 全英雄 + 压力/稳定性/隔墙回归）
- [ ] 浏览器冒烟：标题 → 开一局 → 见到 Boss → VICTORY，控制台零报错
- [ ] 若改了玩法/内容：更新 README 的内容清单与自检结果数字
- [ ] 若发现新 bug：先写复现测试（diag.js 或 sim.test.js 场景），修复后保留为回归

---

*本目录由评测工作目录完整复制而来，可与原目录独立演进。原目录保留于
`ai-benchmark/glm-5,3-flash/zcode/My Soul Knight/shot01`（含当时的评测记录）。*
