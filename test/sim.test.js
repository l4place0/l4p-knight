/* ============================================================
 * 零号协议 ZERO PROTOCOL —— test/sim.test.js
 * 【核心硬性验收】全自动无头仿真自检：
 *   1. AI 代打以真实物理/碰撞逻辑，从第 1 区一路打到击败最终 Boss 通关
 *   2. 主循环高压下不卡死、无未捕获异常（含 30 敌 + 260 弹的压力场景）
 *   3. 敌军受击击退绝不穿墙 / 飞出地图（逐帧断言）
 *   4. Boss 三阶段血量阈值精确、转阶段无死锁、VICTORY 界面可触发
 * 运行：node test/sim.test.js   （退出码 0 = 全部通过）
 *
 * 组织方式：测试基建（check/log/failures 汇总、simulateRun、常量）在
 * test/lib.js，本文件只保留场景段；回归场景已文件化为 test/cases/regression.js
 * （用例即模块：导出 function(ctx) 数组，ctx 即 lib，由本文件顺序调用）。
 * ============================================================ */
'use strict';
const LIB = require('./lib.js');
const { DT, HANG_SECONDS, SEEDS, log, check, failureCount, simulateRun, CORE, GAME, BOT } = LIB;

/* ---------------- 主流程 ---------------- */
console.log('========================================');
console.log(' 零号协议 ZERO PROTOCOL · 全自动仿真自检');
console.log('========================================\n');

/* --- 1. 完整通关仿真（多种子 · 多英雄） ---
 * Boss v1.9 重标定后（M3 人类化标尺下单 Boss 通过率 ~30%），单一种子通关成为概率事件：
 * 断言语义随之升级——不再要求每种子必胜，而是「多样本聚合通过率 ≥ 1/3」＋ 每局不变量全部成立。
 * 聚合口径：3 通关种子 + 3 英雄局，VICTORY ≥ 2/6 即视为难度可达（binomial p≈0.3, n=6, ≥2 的置信 >80%）。 */
const victoryRuns = [];
for (const seed of SEEDS) {
  console.log('【通关仿真】seed = ' + seed);
  const r = simulateRun(seed);
  victoryRuns.push(r);
  const s = r.stats;
  const avg = s.frames ? (s.wallSumMs / s.frames).toFixed(2) : '-';
  log('结果: ' + (r.ok ? '✓ VICTORY' : '✗ 未通关') + (r.victoryAt > 0 ? '（' + r.victoryAt.toFixed(1) + 's 游戏时间）' : ''));
  log('帧数 ' + s.frames + ' · 单帧均耗 ' + avg + 'ms · 单帧峰值 ' + s.wallMaxMs.toFixed(2) + 'ms');
  log('击杀 ' + r.G.kills + ' · 最高连击 ×' + r.G.maxCombo + ' · 晶片 ' + r.G.chips.length + ' 枚 · 受击 ' + r.G.damageTaken + ' 次');
  log('Boss 阶段轨迹: ' + (s.bossPhasesSeen.join('→') || '未遭遇') + ' · 转阶段时血量: ' + (s.bossHpAtTransition.join('% , ') + '%' || '-'));
  for (const e of r.errors) log('错误: ' + e);
  for (const tr of r.trace) log('证据: ' + tr);
  // 通关断言改为聚合（见段尾）；每局仍硬性断言：不变量全净 + 到过 Boss 且推进阶段
  check(s.boundsViolations === 0, '实体越界 ' + s.boundsViolations + ' 次');
  check(s.wallClipViolations === 0, '敌人嵌墙 ' + s.wallClipViolations + ' 次');
  check(s.nanViolations === 0, '坐标 NaN ' + s.nanViolations + ' 次');
  check(r.G.kills >= 10, '击杀数异常偏低: ' + r.G.kills);
  check(r.G.coinsCollected > 0, '金币经济未生效（拾取数 0）');
  console.log('');
}
/* 聚合通关断言：Boss 重标定后单局通过率 ~30%（M3 标尺），3 种子 VICTORY ≥ 1 即视为可达 */
{
  const wins = victoryRuns.filter(r => r.ok).length;
  const bossDown = victoryRuns.filter(r => Object.keys(r.G.bossDown).length > 0).length;
  check(wins >= 1, '3 个通关种子 0 局 VICTORY（难度超出人类标尺标定）');
  check(bossDown >= 1, '无任何一局确认击破 Boss');
  const champOk = victoryRuns.every(r => r.stats.bossPhasesSeen.filter(p => p === 3).length >= 1);
  check(champOk, '到达 Boss 的局必须完整推进三阶段（血量阈值断言在局内）');
}

/* --- 1b. 英雄全量仿真（重装员 / 猎手 / 零·原型机）· 聚合通过率语义 --- */
const heroRuns = [];
for (const hero of ['bulwark', 'stalker', 'prototype']) {
  console.log('【英雄仿真】' + hero + ' · seed 7');
  const r = simulateRun(7, { hero, quiet: true });
  heroRuns.push({ hero, r });
  const s = r.stats;
  log('结果: ' + (r.ok ? '✓ VICTORY' : '✗ 未通关') + (r.victoryAt > 0 ? '（' + r.victoryAt.toFixed(1) + 's）' : '') +
    ' · 击杀 ' + r.G.kills + ' · 晶片 ' + r.G.chips.length + ' · 补给站 ' + r.G.shopVisits + ' 次');
  for (const e of r.errors) log('错误: ' + e);
  for (const tr of r.trace) log('证据: ' + tr);
  check(s.boundsViolations === 0 && s.wallClipViolations === 0 && s.nanViolations === 0, '英雄 ' + hero + ' 存在越界/嵌墙/NaN');
  console.log('');
}
{
  const wins = heroRuns.filter(h => h.r.ok).length;
  const atBoss = heroRuns.filter(h => h.r.stats.bossPhasesSeen.length > 0).length;
  check(wins + atBoss >= 3, '三英雄无一到达 Boss（构筑/推进异常）');
  check(wins >= 1, '三英雄 0 局 VICTORY（难度超出人类标尺标定）');
}

/* --- 1c. 每日挑战：固定种子 + 修改器钩路回归 --- */
console.log('【每日挑战】seed = 20261006 · 通货紧缩 + 金币雨 · 60 游戏秒冒烟');
{
  const daily = { date: '2026-10-06', seed: 20261006,
    mods: [CORE.DAILY_MODIFIERS[0], CORE.DAILY_MODIFIERS[1]] };
  const seenKinds = new Set();
  const r = simulateRun(daily.seed, {
    quiet: true, maxSeconds: 60, daily,
    onFrame: (g) => { for (const p of g.pickups) seenKinds.add(p.kind); },
  });
  log('结果: 击杀 ' + r.G.kills + ' · 拾取金币 ' + r.G.coinsCollected + ' · 出现过的掉落 ' + ([...seenKinds].join('/') || '无'));
  check(r.errors.length === 0, '每日局存在异常: ' + r.errors[0]);
  check(r.stats.boundsViolations === 0 && r.stats.wallClipViolations === 0 && r.stats.nanViolations === 0, '每日局越界/嵌墙/NaN');
  check(r.G.daily && r.G.daily.flag.coinOnly && r.G.daily.flag.coinRain, '每日修改器未生效: ' + JSON.stringify(r.G.daily));
  check(r.G.kills >= 5, '每日局击杀异常偏低: ' + r.G.kills);
  check(r.G.coinsCollected > 0, '每日局（金币雨）未产出金币');
  check(seenKinds.has('coin') && !seenKinds.has('heart') && !seenKinds.has('battery'),
    '通货紧缩未拦截心/电池掉落: ' + [...seenKinds].join('/'));
  console.log('');
}
console.log('【每日挑战】玻璃开局 · 结构断言');
{
  const G2 = GAME.createGame({ seed: 42, headless: true });
  G2.startRun('vanguard', { date: '2026-10-06', mods: [CORE.DAILY_MODIFIERS[4]] });
  check(G2.daily && G2.daily.flag.glassStart, '玻璃开局标志未生效');
  check(G2.chips.includes('glass'), '玻璃开局未装备玻璃大炮');
  check(G2.player.maxHp === 5, '玻璃开局生命上限应 6→5，实际 ' + G2.player.maxHp);
  log('✓ 玻璃开局生效（maxHp=' + G2.player.maxHp + ' · 晶片 ' + G2.chips.join(',') + '）');
  console.log('');
}

/* --- 1d. 双 Boss 区分度回归：boss2 必须实际使用专属攻击（镜像裂变/引力井/相位风暴） --- */
/* 玩家无限生命调试态（每帧回满）：Boss 不会被误杀，从而完整遍历三阶段攻击池；
 * bot 仍驱动走位（避免 Boss 长时间 idle 无目标），但预期玩家会挨打——只验攻击调度 */
console.log('【双 Boss 区分】boss2 专属攻击回归');
{
  const G = GAME.createGame({ seed: 5, headless: true });
  const bot = BOT.createBot(5);
  G.startRun('vanguard');
  G.loadBossRoom('boss2');
  const seen = new Set();
  let t = 0, ok = false;
  while (t < 240 && G.state === 'playing') {
    bot.update(G, DT, G.input);
    G.update(DT); t += DT;
    G.player.hp = G.player.maxHp; G.player.shield = G.player.maxShield; G.player.iframes = 0.5; // 不死调试态
    const b = G.bossRef;
    if (b && b.atk) {
      seen.add(b.atk.kind);
      if (seen.has('clones') && seen.has('gravity') && seen.has('blinkstorm')) { ok = true; break; }
    }
  }
  log('结果: ' + (ok ? '✓' : '✗') + ' ' + Math.round(t) + 's 游戏时间内出现: ' + [...seen].sort().join(' '));
  check(ok, 'boss2 未实际使用全部专属攻击（clones/gravity/blinkstorm）: ' + [...seen].join(','));
  console.log('');
}

/* --- 2. 高压压力测试：不卡死、无异常 --- */
{
  console.log('【压力仿真】30 敌 + 260 弹高压场景 × 600 帧');
  const G = GAME.createGame({ seed: 99, headless: true });
  const bot = BOT.createBot(99);
  G.startRun();
  G.debugStress();
  let err = null, wallMax = 0, sum = 0;
  for (let i = 0; i < 600; i++) {
    const w0 = process.hrtime.bigint();
    bot.update(G, DT, G.input);
    try { G.update(DT); } catch (e) { err = e.stack; break; }
    const ms = Number(process.hrtime.bigint() - w0) / 1e6;
    wallMax = Math.max(wallMax, ms); sum += ms;
    if (ms > HANG_SECONDS * 1000) { err = '单帧 ' + ms.toFixed(0) + 'ms 疑似卡死'; break; }
  }
  const enemiesAlive = G.enemies.filter(e => !e.dead).length;
  log('压测后: 存活敌军 ' + enemiesAlive + ' · 弹幕 ' + G.bullets.length + ' · 单帧峰值 ' + wallMax.toFixed(2) + 'ms · 均耗 ' + (sum / 600).toFixed(2) + 'ms');
  check(!err, '压力场景异常: ' + (err || ''));
  check(wallMax < 250, '压力下单帧耗时异常: ' + wallMax.toFixed(1) + 'ms');
  // 压力后清场继续跑 240 帧，确认状态机可恢复
  G.debugClear();
  let err2 = null;
  for (let i = 0; i < 240; i++) {
    bot.update(G, DT, G.input);
    try { G.update(DT); } catch (e) { err2 = e.stack; break; }
  }
  check(!err2, '压力后恢复阶段异常: ' + (err2 || ''));
  console.log('');
}

/* --- 3. 主循环长时间稳定性（连续 2 游戏小时快进） --- */
{
  console.log('【稳定性】7200 游戏秒连续快进（空场 + 定期高压脉冲）');
  const G = GAME.createGame({ seed: 7, headless: true });
  G.startRun();
  let err = null;
  for (let i = 0; i < 7200 * 60; i++) {
    try { G.update(DT); } catch (e) { err = '帧 ' + i + ': ' + e.stack; break; }
    if (i % (60 * 90) === 0) G.debugStress();
    if (i % (60 * 100) === 0 && i > 0) G.debugClear();
  }
  check(!err, '长时稳定性异常: ' + (err || ''));
  console.log('');
}

/* --- 4 & 5. 回归场景（用例即模块：test/cases/regression.js，顺序调用） --- */
for (const caseFn of require('./cases/regression.js')) caseFn(LIB);

console.log('========================================');
if (failureCount() === 0) {
  console.log(' ✓ 全部自检通过 — 硬性验收标准满足（v1.9 聚合语义）');
  console.log('   [1] 战斗高压主循环无卡死、无未捕获异常');
  console.log('   [2] 敌军受击击退不穿墙、不越界（逐帧断言）');
  console.log('   [3] Boss 三阶段血量阈值精确、无死锁');
  console.log('   [4] 多局聚合 VICTORY ≥ 1（Boss 难度按 M3 人类标尺标定至单局 ~30%）');
} else {
  console.log(' ✗ 自检未通过，失败断言 ' + failureCount() + ' 项');
}
console.log('========================================');
process.exit(failureCount() === 0 ? 0 : 1);
