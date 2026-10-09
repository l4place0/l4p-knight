# HANDOFF · 零号协议 ZERO PROTOCOL 开发交接文档

> 交接日期：2026-10-09 · 交接版本：v1.14.2（AI 导航与战斗停滞修复）
> 项目来源：`ai-benchmark/glm-5,3-flash/zcode/My Soul Knight/shot01`（已完整复制至本目录，逐文件 diff 校验一致）
> 本文目标：让任何开发者（人或 AI）在不询问原作者的情况下继续开发。

---

v1.14.2：保留 v1.12 的传送门导航修复，补充真实历史检查点验证。`botStalled` 触发后电磁炮保持开火输入，
避免墙边反复取消蓄力；同一脱困阶段忽略隔墙冲锋预警，普通战斗感知与数值保持。
`npm run test:navigation`（亦在 npm test 内）覆盖五种子、原始门检查点、三项修复移除和停滞/异常非零退出。
`test/navigation-browser.html` 为按真实时间运行的固定验收场景。完整记录见 [004/005 修复报告](docs/qa/navigation-issues-v1.14.2.md)。

v1.14.1：常驻 HUD 从战场移到上下栏，`floorMap` 为独立画布，鼠标仍按游戏画布矩形换算坐标。
`fit` 将 HUD 高度计入缩放，窄屏允许小于 1 倍；晶片区可滚动。房门绘制沿外向射线贴到第一面墙，
交互点和地图边界碰撞保留。预告与实际攻击共用 `raycastWall`，其斜向终点额外检查落点不在墙内。
`test/visual-issues.html` 点击运行，在真实浏览器检查四尺寸和 140 层/840 房间（5,149 断言）；
完整回归、实战结算和 600 局难度复测见 [修复报告](docs/qa/browser-fixes-v1.14.1.md)。

v1.14：`DIFFICULTY_CURVE` 集中配置分区/首领承伤、NPC/首领 HP、每房追加敌人和补给概率。
固定 M3 最终留出 600 局通过率 37.5% / 67.5% / 98%，道中/首领风险差距最大 1.09 个百分点，故障 0。
见 [完整曲线报告](docs/balance/difficulty-v1.14.md)。`test/difficulty-balance.js` 输出六段条件失败率，
`test/difficulty-curve-report.js` 校验最终参数/目标/曲线；`npm run test:curve`（亦在 npm test 内）验证实际结算与五个旧超时回归。
旧单房与首领平衡表为历史基础值，实际游戏还应用新曲线，继续调参时必须用新的独立种子验收。

v1.13：`zoneIdx` 为区域、`roomIdx` 为楼层，`G.floor.current` 为层内房间。
每层入口/三个战斗房/宝箱/出口共六间，通过 `G.doors` 的 E 交互往返，战斗中 `doorsLocked` 封门。
`loadRoom` 建立整层图，`enterRoom` 切换并保存拾取物与地图状态；`roomVisit` 在切换时递增，
供 AI 路径与动画残影重置。三个战斗房肃清后，在出口只发放一次晶片三选一。
`debugJump` 进入指定楼层的首个战斗房；旧单房评测现衡量这个子房，历史胜率不再是新布局标定。
新增 `npm run test:rooms`（也包含在 `npm test`）与 `node test/rooms-browser.js`（需 Playwright/Edge 与本地服务器）。

## 1. 这是什么项目

类《元气骑士》的黑白灰像素风 2D 肉鸽弹幕射击游戏。纯原生 HTML5 Canvas + Web Audio，
**零依赖、零外部资源、零构建步骤**。当前内容：**4 英雄**（第 4 英雄与初始晶片槽为元进度解锁）/
4 区域 / 6 武器 / 19 晶片（同名重复
获取转为升级，×1.5/级）/ 10 羁绊 / 7 敌种 + 精英词条 / **双三阶段 Boss**（第 3 区守卫 +
最终首领）/ 金币商店 / 历史纪录存档 / **两首合成 BGM**（探索/Boss，战况自动切换）/
**每日挑战**（固定种子 + 按日轮换修改器 + 本地排行）/ **元进度解锁**（纪录达标解锁英雄/初始晶片槽）/
**手柄与移动端触控**（Gamepad 标准映射 + 虚拟摇杆自动瞄准）/ 高频实体对象池。

**当前状态：功能完备、验收全绿。** 接手后第一件事：跑一遍验收（见 §3），确认基线。

## 2. ⚠️ 本项目最重要的规则

> **任何代码改动，必须在改动后保持 `node test/sim.test.js` 全绿。**

这不是普通测试，而是本项目的核心验收机制：无头仿真以**真实物理与碰撞**运行游戏本体（零 mock），
人类化完整局允许阵亡，运行故障必须失败；用实际当前数值的完美 bot 验证从第 1 区
打到最终 Boss 的 VICTORY（prototype/seed=1979，无火力、不死或跳关注入），并逐帧断言：

1. 主循环高压下不卡死、无未捕获异常（含 30 敌 + 260 弹压力场景、7200 游戏秒稳定性）
2. 玩家／敌军不穿墙、不越界（独立读取地图定义，不复用被测碰撞助手）
3. Boss 三阶段血量阈值精确（2/3、1/3）、转阶段无死锁
4. VICTORY 可触发；另含全英雄不变量与"隔墙锁定回归"场景

**难度独立验收**：`node test/enemy-balance.js --verify`，每个普通房 1 batch=100（4 英雄×25 种子），
M3 标尺与 Boss 标定一致，满生命/护盾 + 区域期望构筑。单房通过率须 >0 且 <37%，任何超时、停滞、
异常、坐标违规均失败。种子 1–25 的 7 房通过率为 28/22/30/3/10/30/23%，种子 10001–10025 为 15/10/21/12/23/26/16%。
`npm run balance:heroes` 另要求每英雄跨七房通过率 ≥10% 且 <37%，两批各自英雄差距 ≤15 个百分点。
这不是每房每英雄的单独上限，也不等于真人／整局胜率。五种远程主武器必须有真实清房，
相位刃保留弹反副手定位。完整说明见 [v1.11 标定报告](docs/balance/hero-difficulty-v1.11.md)。

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
node test/balance.js --boss boss --baseline   # Boss 难度标定：1 batch=100 场景通过率（--try/--auto/--human/--fresh）
node test/enemy-balance.js --verify          # 每房 M3 batch 难度硬验收
node test/enemy-balance.js --seed-start 10001 --verify # 留出种子验证
node test/hero-balance.js                    # 两批英雄平衡 + 六武器对照
node test/mechanics.test.js                  # 12 组机制契约
node test/mechanics-mutation.js              # 44 个定向变异必须检出
node test/enemy-balance.test.js              # 真实危险源、Boss 隔离及故障负向验证
node test/diag.js <seed>       # 卡点诊断：逐秒打印玩家/敌人/输入微观状态
node test/serve.js 8941        # 本地服务器 → http://127.0.0.1:8941/
node test/structure.check.js   # 结构守护：脚本编排顺序/模块导出面/逐文件语法（patch 后必做）
node test/mutation.js --count 30   # 随机变异测试（SQLite 思想：注入变异验证测试系统，详见 test/mutation.js 头注）
node --check js/<file>.js      # 语法检查（patch 后必做）
```

**场景矩阵（test/matrix.js）**：测试漏斗上游——地图×英雄×种子×按区域深度的合成构筑，
全确定性、worker 并行、断言只用游戏时间。基线对比用**方差感知阈值**
（`max(基线p95×1.25+1, 基线max×1.1)`，高方差模板的单种子离群不算劣化）。失败场景输出 JSON 报告：结局分类
（timeout / stall 停滞 / defeat / violation 越界嵌墙NaN / error）、最近 ~32 游戏秒实体轨迹、
`replayUrl`（浏览器定向回放，URL 即场景编码：`?seed&hero&bot&autostart&zone&room|boss&chips&power&shield`）
与 `rerun` 命令。回放纪律：**每次回放用新建标签页**，不要按 URL 模式匹配旧标签（会绑到陈旧状态）。

矩阵仍将任意阵亡计为失败，因此高难度版本可能返回 1；它用于诊断与耗时基线，不作为难度达标门。
不要为追求矩阵全绿而降低已标定难度，难度门使用 enemy-balance.js --verify。

直接双击 `index.html` 也能玩（file:// 可用，无 fetch/模块依赖）。

调试 URL 参数：`?seed=1` `?bot=1`（AI 代打） `?autostart=1` `?daily=1`（每日挑战：强制 seed=YYYYMMDD +
当日修改器 + 结算计入本地排行） `?zone=2&room=1` `?boss=1`
`?dmg=8` `?bosshp=210`（数值调试）`?fps=1`。页面暴露 `window.__advance(frames)` / `window.__draw()`
（无头推进 + 重绘，供自动化截图与 QA）。
`test/browser-smoke.html` 可在浏览器内搜索正常数值的通关种子并回放真实游戏界面。
v1.11 固定帧浏览器见证为 prototype/seed=1131（367.1 秒）；实时 seed=1979 则阵亡，
与 Node 结果有差异，详见标定报告，不能将固定帧结果视为实时胜率。

## 4. 架构与文件地图

> v1.8 起采用「经典脚本 + ZERO_* 命名空间 + 双端导出」的部件化结构（零构建、file:// 可玩不变）。
> 加载顺序由 test/structure.check.js 钉死守护；依赖方向：core ← game 部件 ← 门面 ← render/audio/music/bot ← UI 模块 ← main。

```
index.html          界面壳：canvas + 全中文 HUD/横幅/晶片卡片/商店/结算屏（DOM 层，CSS 内联）
js/core.js          纯数据层：常量、武器、英雄、敌人、晶片、羁绊、地图、3x5 像素字体、字符画精灵（单一数据文件是有意设计）
js/game/            逻辑层部件（每个 = ZERO_GAME_PARTS 注册的工厂，facade 按 state→systems→player→
                    enemies→bosses→rooms 顺序装配；跨部件依赖一律经 ctx 显式传递）
  state.js            G 状态工厂 / RNG / timers / 对象池基础设施 / spawn 基础助手 / loadMap / computeReachable
  systems.js          碰撞（boxHitsWall/moveAxis/resolveOutOfWall/pointSegDist）/爆炸 / 子弹·地雷·激光·
                      光束·引力井·拾取物更新
  player.js           computeStats / 玩家更新 / 冲刺 / 武器开火 / 近战 / damagePlayer
  enemies.js          spawnEnemy（含精英）/ updateEnemy（7 种 AI）/ damageEnemy / killEnemy / separation
  bosses.js           loadBossRoom / updateBoss（8 种攻击）/ 三阶段转阶段 / 濒死演出 / 引力井布设
  rooms.js            loadRoom / 波次 / nextLevel / 晶片三选一 / 商店 / 传送门 / endStats / startRun / debug 系列
js/game.js          逻辑层装配 facade（54 行）：按序调部件工厂、拼装 ctx 与 G、保持 ZERO_GAME.createGame 导出面
js/render.js        渲染层：精灵预渲染缓存、瓦片底图缓存、发光弹幕、特效（仅浏览器加载）
js/bot.js           AI 代打：BFS 寻路接敌（含路由粘滞）+ 16 向评分走位 + 弹幕/地雷/激光规避 + 破盾战术 +
                    僵局看门狗 + 晶片/商店购买决策（与人类玩家共用同一 G.input 接口）
js/audio.js         Web Audio 合成音效（约 35 种），压缩器限幅
js/music.js         步进音序器 BGM：探索/Boss 双曲目，低通氛围区分（950/2800Hz），Boss 战自动切换；
                    输出挂 audio.js 主总线（M 键一并静音）；仅浏览器加载，可随时删除
js/storage.js       UI 数据模块：zp_records/zp_daily/zp_meta 三组存取（含形状校验）/ 解锁推导 / 每日排行
js/input.js         输入模块：键鼠 / 手柄（Gamepad 标准映射）/ 触控（虚拟摇杆 + 自动瞄准）→ G.input；
                    bot 接管时让位；触控件显隐
js/hud.js           HUD 模块：生命/护盾/武器/关卡/金币/连击/晶片标签/横幅/浮动提示/Boss 条（增量 DOM 更新）
js/ui.js            界面流转模块：标题构建（英雄卡/每日面板/晶片槽）/ 晶片三选一 / 商店 / 结算屏 /
                    暂停 / 帮助 / 覆盖层逐帧流转
js/main.js          薄启动层（155 行）：URL 参数解析 / 模块接线 / startRun 编排 / 固定步长主循环 / 结算写档
test/sim.test.js    ★ 验收测试入口（§2；基建已抽至 test/lib.js，回归用例在 test/cases/ 以模块注册）
test/lib.js         测试基建：check/log/failureCount + simulateRun（多种子/英雄/每日/限时/观测钩）
test/cases/         回归用例（模块化注册，新场景照此范式）
test/structure.check.js  结构守护：index.html 脚本编排顺序钉死 / 模块导出面 / 逐文件语法 / UI 模块存在性
test/matrix.js      场景矩阵：无头批量 × worker 并行 × 停滞检测 × 失败轨迹 + 回放 URL（§3）
test/diag.js        卡点诊断工具
test/serve.js       静态服务器
```

### 模块边界契约（改动前必读）

- **逻辑层（js/game.js 门面 + js/game/ 部件）必须保持 headless 可运行**：逻辑中禁止直接触 DOM / canvas / AudioContext /
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
| 碰撞 | game/systems.js `moveAxis` / `resolveOutOfWall` | 逐轴回退式（位移 < 9px < 墙厚 16px 防隧穿）+ 中心在墙内时最小面推出 + **箱体角嵌入墙角时最小穿透轴兜底推出**（历史 bug #4、#9）。**不要改回钳位式** |
| 刷怪点 | `computeReachable` / `farSpot` | 只用玩家出生瓦片 BFS 可达点，杜绝封闭凹室死局 |
| Boss 定义 | core.js `ENEMY_DEFS.boss / .boss2` | `isBoss` 走 Boss 状态机；`phases` 三阶段名/色；`pools` 各阶段攻击池；`final` 标记最终首领（击破 → VICTORY），非 final 击破 → 传送门进下一区 |
| Boss 难度 | bosses.js `BOSS_DIFF` + core.js hp/speed | v1.9 重标定：M3 人类化标尺（bot 基因 commit30/trackK3/sight100/delay10/dashSkip0.6）下单 Boss 通过率 <37%（boss1 29%/boss2 30%，全流程语境）；`G.bossTuning` 为实验叠加钩（balance.js --try 注入）；数值变动须重跑 test/balance.js 标定 |
| 小怪难度 | core.js `ENEMY_DIFF` + enemies.js | v1.11：既有区域成长上 HP×3（第 4 区 ×3.2）/speed×1.8/冷却消耗×4.5/弹速×2.4/密度×3/伤害×4；`G.enemyTuning` 覆盖字段用于实验。Boss 房与召唤物排除，预警时间和波次预算保留；改后跑每房 batch 与留出验证 |
| Boss 死亡 | `bossDying` / `updateBoss` | Boss 死后**滞留** enemies 列表走 dying 演出，完成后置 `dead` 并写 `G.bossDown[zoneIdx]`；提前移除会死锁（历史 bug #2） |
| 房间流程 | `loadRoom` → `enterRoom` / `useDoor` → `updateWaves` 解封 → 三间清完进出口 `offerChips` → `chooseChip` → 区域末尾 `openShop` → `shopLeave` → `openPortal` → `nextLevel` | `nextLevel`：下一层 → 区域末尾有 `bossId` 且未击破 → 首领房；首领房传送门 → 下一区。`floor.rewarded` 防本层重复领奖；`room.cleared` 防回访刷怪 |
| 引力井 | game/systems.js `G.wells`·`updateWells`（布设于 game/bosses.js） | Boss2 专属：范围内拉扯玩家（冲刺 `dashT > 0` 时免疫拉扯），到期内爆 `explode`；bot 在 `computeDanger` 规避 |
| 属性系统 | game/player.js `computeStats` | 晶片 apply → 羁绊 apply → 武器自适应（pierce+电磁炮=无限贯穿）→ 商店永久加成（bonusShield/powerBonus）→ 英雄底子；**createGame 时即初始化**（标题 HUD 依赖，bug #10） |
| 晶片升级 | `G.chipLv` / `G.acquireChip` | 已持有晶片再次获取 → `chipLv[id]++`（不重复入列表）；`computeStats` 以 k = 1.5^lv 调 `apply(s, k)`；整数型效果 ceil 进位、乘法减益设下限、触发型晶片缩放数值面（`frostK/chainK/reloadK/luckyK/splitK` 随属性袋传递）；分裂减伤的羁绊退款按 `s.splitK` 同步 |
| 每日挑战 | core.js `DAILY_MODIFIERS` / `dailyForDate` | 日期字符串 FNV 哈希 → 当日两枚去重修改器 + seed=YYYYMMDD；`startRun(hero, daily)` 写 `G.daily.flag`，效果落点：守卫/Boss/清房掉落（coinOnly）、金币数（coinRain）、精英概率（eliteUp）、商店折扣（shopSale）、开局晶片（glassStart）；**非每日路径逐位不变**（矩阵基线不受影响）；排行在 main.js localStorage `zp_daily`（每日前 5） |
| 对象池 | game/state.js `makePool` × 4 | bullets/particles/floaters/rings freelist 复用：acquire 逐一重初始化全部字段（防上一任字段泄漏）、release 在出数组时归还、整表清空走 `pooledClear`；**数组顺序与 RNG 消费顺序零改动**（逐位一致已由逐帧状态哈希对比证明）；`G.__poolStats()` 可观测（峰值追踪惰性开启）；**新增弹种/字段必须在对应 init 中重置**，否则池化复用会泄漏 |
| 弹道扩展 | `updateBullets` | `b.kind`：'homing'（转向最近敌人）/ 'grenade'（撞墙/命中/超时引爆 `grenadeBoom`） |
| 状态机 | `G.state` | title / playing / chip / shop / victory / defeat / paused；chip 与 shop 冻结世界 |
| bot 导航 | bot.js `bfsPath` + 16 向评分 | 无视线目标或传送门 → BFS 路径跟随；评分含**箱体真实位移模拟**（防卡墙）；连续受困 3 次给随机脱困脉冲 |
| bot 决策 | `pickChip` / shop 分支 | 晶片按权重+羁绊完成度+武器适配打分；商店按 回血>晶片>护盾>武器>强化 采购，买不起就离开（保证无死锁） |

## 5. 常见扩展怎么做（改哪些文件）

### 加一把武器
1. `core.js` WEAPONS 加定义（特殊弹道加 `kind`/`bulletLife`/`bulletR`，在 `updateBullets` 实现行为）
2. `core.js` SPRITES 加武器字符画（枪口朝右，渲染时按瞄准角旋转）
3. `bot.js` WEAPON_TIER / BAND / CONE 加条目（bot 才会用它）
4. 加入晶片箱池（game/rooms.js `loadRoom` 的 crate pool）与商店武器池（`openShop`）
5. 跑验收：bot 需要能用它通关

### 加一种敌人
1. `core.js` ENEMY_DEFS 加数值（contact: 0 表示无接触伤害，如自爆蜂）
2. 区域 `weights` 加入（控制出现区段与频率）
3. game/enemies.js `updateEnemy` 加 AI 分支（注意复用 `e.state/e.t/e.cd` 计时惯例）
4. `core.js` SPRITES 加精灵
5. bot.js：`pickTarget` 权重 + `computeDanger` 威胁场（若它有爆发性威胁，如自爆蜂）
6. 若它会自爆/召唤，注意与 `killEnemy`（连击/金币/引爆核心链）的交互

### 加晶片 / 羁绊
1. `core.js` CHIPS / SYNERGIES（晶片 `apply(s, k)` 修改属性袋，**k = 1.5^升级等级**：加成写 `s.x += 基值*k`，
   整数型用 `Math.ceil(基值*k)`，乘法减益设下限；触发型晶片把 k 存入属性袋如 `s.chainK = k`，在效果落点读取）；
   羁绊 `need` 引用晶片 id
2. game/player.js `computeStats` 的 `s` 默认值加字段；效果落点通常在 `damageEnemy` / `killEnemy` / `updatePlayer`
3. bot.js `CHIP_SCORE` 加权重（bot 才会选它）

### 加英雄
`core.js` HEROES 加条目即可 —— 标题英雄卡由 `main.js buildHeroCards` 自动生成；
并在 sim.test.js 的英雄仿真循环里加 id（逐帧不变量与正常胜负结局）；难度 batch 按 HEROES 自动枚举。
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
3. **高难度完整局常提前阵亡**：单房 <37% 不保证完整局高胜率；当前全流程胜利证据来自原型机完美 bot，
   英雄平衡改动后重跑全英雄分房统计与流程样本。
4. **z2a 地图有 32 格封闭内室**（装饰性，BFS 可达刷怪已规避死局，纯浪费空间）；如改造需重验第 2 区平衡。
5. **引力井仅拉扯玩家**：如需拉扯敌军，注意与击退衰减、`resolveOutOfWall` 的交互并重跑嵌墙回归。
6. **人类化 bot 传送门导航停滞**：已于 v1.12（`c924f23`）修复，见 [issue 004](docs/issues/004-seed3-portal-navigation-stall.md)。
   `test/difficulty.test.js` 保留十秒内通过的回归；`test/diag.portal.js` 从 `458bd1a` 加载历史源码，以保持旧场景可复现。仿真提供结构化 outcome，超时/异常会使验收失败。
7. **z4b 完美 bot 战斗停滞**：v1.14.2 复核旧种子，并修复 seed=46 的电磁炮蓄力取消和 seed=52 的隔墙冲锋规避循环，
   见 [issue 005](docs/issues/005-z4b-perfect-bot-stall.md)。四英雄 × 200 种子场景通过；后续改动仍需保持固定场景与整局验收。

## 7. 建议开发路线图（按优先级）

1. ~~第 4 区 + 第二 Boss~~ ✅ 已完成（v1.2：z4a/z4b + 终焉·回响体 + 虚空徘徊者/镜像残影 + 双 Boss 流程）
2. ~~晶片去重与升级~~ ✅ 已完成（v1.3：同 id 重复获取转为升级 ×1.5/级，商店同规则，UI/bot/矩阵基线全同步）
3. ~~背景音乐~~ ✅ 已完成（v1.4：探索/Boss 双曲步进音序器 + 低通氛围区分 + Boss 战自动切换 + M 键统一静音）
4. ~~每日挑战~~ ✅ 已完成（v1.5：seed=YYYYMMDD + 五枚按日轮换修改器 + 标题面板 + localStorage 每日前 5）
5. ~~元进度解锁~~ ✅ 已完成（v1.6：通关 1 次解锁第 4 英雄「零·原型机」，通关 3 次解锁初始晶片槽，纪录推导 + UI 门控）
6. ~~手柄 / 移动端触控~~ ✅ 已完成（v1.7：Gamepad 标准映射 + 虚拟摇杆/自动瞄准触控层，bot 接管时让位，键鼠逐位不变）
7. ~~性能~~ ✅ 已完成（v1.7：bullets/particles/floaters/rings 对象池，纯分配消除——逐帧状态哈希证明行为逐位一致，
   一局消除 98.1% 分配；分帧碰撞会改物理语义，仅当弹幕规模真正上千且池化不够时再议）

## 8. 改动完成标准（Definition of Done）

- [ ] `node --check js/*.js js/game/*.js` 全部通过
- [ ] `node test/structure.check.js` 通过（脚本编排顺序 / 模块导出面 / 语法）
- [ ] `node test/sim.test.js` 全绿（全部种子 + 全英雄 + 压力/稳定性/隔墙回归）
- [ ] 小怪数值改动：`node test/enemy-balance.test.js` 与 `node test/enemy-balance.js --verify` 通过；留出种子也验一次
- [ ] 英雄／武器改动：`npm run balance:heroes`、机制契约及定向变异通过；若影响 Boss，按原 M3 口径重验两位 Boss
- [ ] 浏览器冒烟：标题 → 开一局 → 见到 Boss → VICTORY，控制台零报错
- [ ] 若改了玩法/内容：更新 README 的内容清单与自检结果数字
- [ ] 若发现新 bug：先写复现测试（diag.js 或 sim.test.js 场景），修复后保留为回归
- [ ] 逻辑层改动若涉及时序/RNG 顺序：跑逐帧状态哈希黄金对比（对照 `git show HEAD:js/game.js`）
- [ ] （可选门）`node test/mutation.js --count 30 --strict`：随机变异杀率达标且逻辑层无幸存者——
      v1.11 已补主要机制盲区，44 个定向变异全检出；随机样本杀率另记于 v1.11 报告，
      仍有表现层与参数盲区，尚未升级为全仓库必选门

---
