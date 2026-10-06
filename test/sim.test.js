/* ============================================================
 * 零号协议 ZERO PROTOCOL —— test/sim.test.js
 * 【核心硬性验收】全自动无头仿真自检：
 *   1. AI 代打以真实物理/碰撞逻辑，从第 1 区一路打到击败最终 Boss 通关
 *   2. 主循环高压下不卡死、无未捕获异常（含 30 敌 + 260 弹的压力场景）
 *   3. 敌军受击击退绝不穿墙 / 飞出地图（逐帧断言）
 *   4. Boss 三阶段血量阈值精确、转阶段无死锁、VICTORY 界面可触发
 * 运行：node test/sim.test.js   （退出码 0 = 全部通过）
 * ============================================================ */
'use strict';
require('../js/core.js');
const GAME = require('../js/game.js');
const BOT = require('../js/bot.js');

const DT = 1 / 60;
const MAX_SIM_SECONDS = 60 * 8;      // 单局最长模拟 8 游戏分钟
const HANG_SECONDS = 3.0;            // 单帧逻辑耗时超过 3 秒视为卡死
const SEEDS = process.env.SEEDS ? process.env.SEEDS.split(',').map(Number) : [1, 2, 3];

let failures = 0;

function log(s) { console.log('  ' + s); }
function check(cond, msg, ctx) {
  if (!cond) {
    failures++;
    log('✗ 断言失败: ' + msg + (ctx ? '　[' + ctx + ']' : ''));
    return false;
  }
  return true;
}

/* ---------------- 一局完整通关仿真 ---------------- */
function simulateRun(seed, opts) {
  opts = opts || {};
  const G = GAME.createGame({ seed, headless: true });
  const bot = BOT.createBot(seed);
  const errors = [];
  const trace = [];
  const stats = {
    frames: 0, wallMaxMs: 0, wallSumMs: 0,
    boundsViolations: 0, wallClipViolations: 0, nanViolations: 0,
    bossPhasesSeen: [], bossTransitions: 0, bossHpAtTransition: [],
  };
  let t = 0, lastZone = -1, lastPhase = 0, victoryAt = -1;

  G.startRun(opts.hero);
  while (t < MAX_SIM_SECONDS) {
    const w0 = process.hrtime.bigint();
    bot.update(G, DT, G.input);
    try {
      G.update(DT);
    } catch (e) {
      errors.push('帧 ' + stats.frames + ' 未捕获异常: ' + e.stack);
      break;
    }
    const ms = Number(process.hrtime.bigint() - w0) / 1e6;
    stats.wallSumMs += ms;
    stats.wallMaxMs = Math.max(stats.wallMaxMs, ms);
    if (ms > HANG_SECONDS * 1000) { errors.push('帧 ' + stats.frames + ' 卡死（单帧 ' + ms.toFixed(0) + 'ms）'); break; }
    stats.frames++;
    t += DT;

    const mw = G.mw * 16, mh = G.mh * 16;

    /* ---- 不变量 1：所有实体不出地图边界 ---- */
    const allEnts = [G.player].concat(G.enemies);
    for (const e of allEnts) {
      if (e.x < -2 || e.x > mw + 2 || e.y < -2 || e.y > mh + 2) {
        stats.boundsViolations++;
        if (stats.boundsViolations < 4) trace.push('越界: ' + e.type + ' (' + e.x.toFixed(1) + ',' + e.y.toFixed(1) + ') @' + t.toFixed(1) + 's');
      }
    }
    /* ---- 不变量 2：敌人不嵌墙（击退/挤压后仍被推出） ---- */
    for (const e of G.enemies) {
      const r = e.r - 1;
      if (G.solidAtPx(e.x - r, e.y - r) || G.solidAtPx(e.x + r, e.y - r) ||
          G.solidAtPx(e.x - r, e.y + r) || G.solidAtPx(e.x + r, e.y + r)) {
        stats.wallClipViolations++;
        if (stats.wallClipViolations < 4) trace.push('嵌墙: ' + e.type + ' (' + e.x.toFixed(1) + ',' + e.y.toFixed(1) + ') @' + t.toFixed(1) + 's');
      }
    }
    /* ---- 不变量 3：无 NaN 传染 ---- */
    if (!isFinite(G.player.x) || !isFinite(G.player.y)) {
      stats.nanViolations++;
      if (stats.nanViolations < 3) trace.push('玩家 NaN @' + t.toFixed(1) + 's');
    }
    for (const e of G.enemies) {
      if (!isFinite(e.x) || !isFinite(e.y)) { stats.nanViolations++; break; }
    }

    /* ---- Boss 阶段血量逻辑 ---- */
    const boss = G.bossRef;
    if (boss && !boss.dead) {
      if (boss.phase !== lastPhase) {
        const frac = boss.hp / boss.maxHp;
        stats.bossPhasesSeen.push(boss.phase);
        stats.bossHpAtTransition.push(+frac.toFixed(3));
        // 阈值精确性：进入 P2 时血量应已 ≤ 2/3；进入 P3 时 ≤ 1/3
        if (boss.phase === 2) check(frac <= 2 / 3 + 0.001, 'Boss 转二阶段血量阈值', 'frac=' + frac.toFixed(3));
        if (boss.phase === 3) check(frac <= 1 / 3 + 0.001, 'Boss 转三阶段血量阈值', 'frac=' + frac.toFixed(3));
        stats.bossTransitions++;
        lastPhase = boss.phase;
      }
    }

    if (G.zoneIdx !== lastZone) {
      lastZone = G.zoneIdx;
      if (!opts.quiet) log('→ 进入 ' + (boss && !boss.dead && G.isBossRoom ? 'Boss 房间' : '第 ' + (G.zoneIdx + 1) + ' 区') + ' @ ' + t.toFixed(1) + 's');
    }

    if (G.state === 'victory') { victoryAt = t; break; }
    if (G.state === 'defeat') {
      errors.push('玩家在第 ' + (G.zoneIdx + 1) + ' 区阵亡 @' + t.toFixed(1) + 's（HP=' + G.player.hp + '，敌人=' + G.enemies.length + '）');
      break;
    }
  }

  if (t >= MAX_SIM_SECONDS && G.state !== 'victory') {
    const boss = G.bossRef;
    errors.push('超过 ' + MAX_SIM_SECONDS + 's 仍未通关（死锁/停滞），state=' + G.state + '，区域=' + (G.zoneIdx + 1) + '，BossHP=' + (boss ? (boss.hp + '/' + boss.maxHp + ' st=' + boss.st + ' ph=' + boss.phase) : '-'));
    errors.push('快照: 玩家(' + G.player.x.toFixed(0) + ',' + G.player.y.toFixed(0) + ') portal=' + (G.portal ? '开' : '无')
      + ' wavIdx=' + G.wavIdx + '/' + G.waves.length + ' 待生成=' + G.pendSpawns.length
      + ' 敌军=' + (G.enemies.map(e => e.type + (e.spawning > 0 ? '*' : '') + ':' + (e.state || e.st) + '@(' + e.x.toFixed(0) + ',' + e.y.toFixed(0) + ')').join(' ') || '无'));
  }

  return {
    ok: G.state === 'victory' && errors.length === 0,
    errors, trace, stats, G, victoryAt,
  };
}

/* ---------------- 主流程 ---------------- */
console.log('========================================');
console.log(' 零号协议 ZERO PROTOCOL · 全自动仿真自检');
console.log('========================================\n');

/* --- 1. 完整通关仿真（多种子） --- */
for (const seed of SEEDS) {
  console.log('【通关仿真】seed = ' + seed);
  const r = simulateRun(seed);
  const s = r.stats;
  const avg = s.frames ? (s.wallSumMs / s.frames).toFixed(2) : '-';
  log('结果: ' + (r.ok ? '✓ VICTORY' : '✗ 未通关') + (r.victoryAt > 0 ? '（' + r.victoryAt.toFixed(1) + 's 游戏时间）' : ''));
  log('帧数 ' + s.frames + ' · 单帧均耗 ' + avg + 'ms · 单帧峰值 ' + s.wallMaxMs.toFixed(2) + 'ms');
  log('击杀 ' + r.G.kills + ' · 最高连击 ×' + r.G.maxCombo + ' · 晶片 ' + r.G.chips.length + ' 枚 · 受击 ' + r.G.damageTaken + ' 次');
  log('Boss 阶段轨迹: ' + (s.bossPhasesSeen.join('→') || '未遭遇') + ' · 转阶段时血量: ' + (s.bossHpAtTransition.join('% , ') + '%' || '-'));
  for (const e of r.errors) log('错误: ' + e);
  for (const tr of r.trace) log('证据: ' + tr);
  check(r.ok, 'seed=' + seed + ' 未达成 VICTORY');
  check(s.boundsViolations === 0, '实体越界 ' + s.boundsViolations + ' 次');
  check(s.wallClipViolations === 0, '敌人嵌墙 ' + s.wallClipViolations + ' 次');
  check(s.nanViolations === 0, '坐标 NaN ' + s.nanViolations + ' 次');
  check(s.bossPhasesSeen.includes(2) && s.bossPhasesSeen.includes(3), 'Boss 三阶段未完整推进: ' + s.bossPhasesSeen.join(','));
  check(s.bossPhasesSeen.filter(p => p === 3).length >= 2, '两位 Boss 均需完整走完三阶段: ' + s.bossPhasesSeen.join(','));
  check(r.G.bossDown[2] && r.G.bossDown[3], '第 3 区守卫与最终 Boss 均未确认击破: ' + JSON.stringify(r.G.bossDown));
  check(r.G.chips.length >= 6, '局内晶片获取异常（每战斗房间 1 枚，7 房应 ≥6，实际 ' + r.G.chips.length + '）');
  check(r.G.kills >= 10, '击杀数异常偏低: ' + r.G.kills);
  check(r.G.shopVisits >= 4, '补给站访问异常（4 个区域末尾应各开店一次，实际 ' + r.G.shopVisits + ' 次）');
  check(r.G.coinsCollected > 0, '金币经济未生效（拾取数 0）');
  console.log('');
}

/* --- 1b. 英雄全量可通关（重装员 / 猎手） --- */
for (const hero of ['bulwark', 'stalker']) {
  console.log('【英雄仿真】' + hero + ' · seed 7');
  const r = simulateRun(7, { hero, quiet: true });
  const s = r.stats;
  log('结果: ' + (r.ok ? '✓ VICTORY' : '✗ 未通关') + (r.victoryAt > 0 ? '（' + r.victoryAt.toFixed(1) + 's）' : '') +
    ' · 击杀 ' + r.G.kills + ' · 晶片 ' + r.G.chips.length + ' · 补给站 ' + r.G.shopVisits + ' 次');
  for (const e of r.errors) log('错误: ' + e);
  for (const tr of r.trace) log('证据: ' + tr);
  check(r.ok, '英雄 ' + hero + ' 未达成 VICTORY');
  check(s.boundsViolations === 0 && s.wallClipViolations === 0 && s.nanViolations === 0, '英雄 ' + hero + ' 存在越界/嵌墙/NaN');
  check(s.bossPhasesSeen.includes(3), '英雄 ' + hero + ' Boss 阶段未完整推进');
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

/* --- 4. 隔墙锁定回归场景：目标与玩家被长墙完全阻隔，bot 必须绕墙接敌 --- */
{
  console.log('【隔墙回归】z1b 长墙阻隔 + 弹幕炮台，60 秒内必须完成击杀（不允许隔墙原地卡死）');
  const G = GAME.createGame({ seed: 5, headless: true });
  const bot = BOT.createBot(5);
  G.startRun();
  G.debugJump(1, 2);           // z1b：横向长墙地形
  G.debugClear();
  G.waves = []; G.pendSpawns = []; G.wavIdx = 9;  // 屏蔽常规波次，构造纯场景
  G.player.x = 40; G.player.y = 232;              // 左下角
  const foe = G.debugSpawn('gunner', 40, 40);     // 左上角，视线被 row-7 长墙完全阻隔
  let err = null, killed = false, killedAt = 0;
  for (let i = 0; i < 60 * 60; i++) {
    bot.update(G, DT, G.input);
    try { G.update(DT); } catch (e) { err = e.stack; break; }
    if (foe.dead) { killed = true; killedAt = (i / 60).toFixed(1); break; }
  }
  log('结果: ' + (killed ? '✓ 隔墙目标已绕墙击杀 @ ' + killedAt + 's' : '✗ 60 秒未击杀（隔墙卡死复现）')
    + ' · 玩家HP ' + G.player.hp + '/' + G.player.maxHp);
  check(!err, '隔墙场景异常: ' + (err || ''));
  check(killed, '隔墙目标未被击杀 —— bot 仍存在隔墙锁定卡死问题');
  check(G.player.hp >= G.player.maxHp - 2, '隔墙场景玩家损血过多: hp=' + G.player.hp);
  console.log('');
}

/* --- 5. 墙角嵌入回归：箱体角搭接墙角必须被推出（resolveOutOfWall 兜底分支） --- */
{
  console.log('【墙角回归】z4a 单格宽立柱墙角：构造箱体角嵌入墙角状态，5 帧内必须解除');
  const G = GAME.createGame({ seed: 5, headless: true });
  G.startRun();
  G.debugJump(4, 1);             // z4a：中央单格宽立柱（墙角暴露最多）
  G.debugClear();
  G.waves = []; G.pendSpawns = []; G.wavIdx = 9;   // 屏蔽常规波次，构造纯场景
  // 立柱位于瓦片 (11, 6..10)。构造历史实测的嵌入态：
  // 防暴盾卫中心 (196.7, 90.7)，碰撞盒左下角 (191.2, 96.2) 嵌入墙瓦片 (11,6) 0.2px
  const guard = G.debugSpawn('guard', 196.7, 90.7);
  let err = null, fixed = false, fixedAt = 0;
  for (let i = 0; i < 300; i++) {
    try { G.update(1 / 60); } catch (e) { err = e.stack; break; }
    const r = guard.r - 1;
    const embedded = G.solidAtPx(guard.x - r, guard.y - r) || G.solidAtPx(guard.x + r, guard.y - r) ||
      G.solidAtPx(guard.x - r, guard.y + r) || G.solidAtPx(guard.x + r, guard.y + r);
    if (!embedded && i < 5) { fixed = true; fixedAt = (i / 60).toFixed(2); break; }
  }
  log('结果: ' + (fixed ? '✓ 嵌入已解除 @ ' + fixedAt + 's' : '✗ 墙角嵌入未解除（箱体角卡墙复现）')
    + ' · 守卫位置 (' + guard.x.toFixed(1) + ',' + guard.y.toFixed(1) + ')');
  check(!err, '墙角回归场景异常: ' + (err || ''));
  check(fixed, '箱体角嵌入墙角未被推出 —— resolveOutOfWall 兜底分支失效');
  console.log('');
}

console.log('========================================');
if (failures === 0) {
  console.log(' ✓ 全部自检通过 — 4 项硬性验收标准全部满足');
  console.log('   [1] 战斗高压主循环无卡死、无未捕获异常');
  console.log('   [2] 敌军受击击退不穿墙、不越界（逐帧断言）');
  console.log('   [3] Boss 三阶段血量阈值精确、无死锁');
  console.log('   [4] 从第 1 区打到击败最终 Boss，VICTORY 可触发');
} else {
  console.log(' ✗ 自检未通过，失败断言 ' + failures + ' 项');
}
console.log('========================================');
process.exit(failures === 0 ? 0 : 1);
