/* ============================================================
 * 零号协议 ZERO PROTOCOL —— test/lib.js
 * 仿真测试基建层：供 sim.test.js 与 test/cases/* 场景用例共用。
 *   - 常量：DT / MAX_SIM_SECONDS / HANG_SECONDS / SEEDS（env 覆盖）
 *   - 断言基建：log / check / failureCount（failures 汇总计数）
 *   - simulateRun(seed, opts)：一局完整通关无头仿真
 *     opts: hero / daily / maxSeconds / quiet / onFrame / perfectBot / enemyTuning
 *   - 模块引用：CORE / GAME / BOT（装载顺序固定：core → game → bot）
 * 场景用例不要复制粘贴本文件；用例即模块，见 test/cases/ 范式：
 *   每个用例文件导出 function(ctx) 形式的用例数组（ctx = 本模块的导出），
 *   由 sim.test.js 顺序调用。
 * ============================================================ */
'use strict';
require('../js/core.js');
const CORE = require('../js/core.js');
const GAME = require('../js/game.js');
const BOT = require('../js/bot.js');
const { spatialViolations } = require('./invariants.js');

/* ---------------- 常量 ---------------- */
const DT = 1 / 60;
const MAX_SIM_SECONDS = 60 * 11;     // 单局最长模拟 11 游戏分钟（Boss 重标定后全通关需更久）
const HANG_SECONDS = 3.0;            // 单帧逻辑耗时超过 3 秒视为卡死
const SEEDS = process.env.SEEDS ? process.env.SEEDS.split(',').map(Number) : [1, 2, 3];

/* ---------------- 断言基建（failures 汇总） ---------------- */
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
function failureCount() { return failures; }

/* ---------------- 一局完整通关仿真 ---------------- */
/* 历史全流程 M2 标尺；单房难度标定在 enemy-balance.js 使用与 Boss 相同的 M3。
 * 高难度下这些完整局可以阵亡；流程可达性另用 perfectBot 验证，不注入火力或不死。 */
const YARDSTICK_GENES = { commit: 45, trackK: 2, sight: 85, delay: 15, dashSkip: 0.85 };

function simulateRun(seed, opts) {
  opts = opts || {};
  const G = GAME.createGame({ seed, headless: true });
  if (opts.enemyTuning) G.enemyTuning = opts.enemyTuning;
  const bot = BOT.createBot(seed, opts.perfectBot ? null : YARDSTICK_GENES);
  const errors = [];
  const trace = [];
  const stats = {
    frames: 0, wallMaxMs: 0, wallSumMs: 0,
    boundsViolations: 0, wallClipViolations: 0, nanViolations: 0,
    bossPhasesSeen: [], bossTransitions: 0, bossHpAtTransition: [],
  };
  let t = 0, lastZone = -1, lastPhase = 0, victoryAt = -1, outcome = null;

  G.startRun(opts.hero, opts.daily || null);
  while (t < (opts.maxSeconds || MAX_SIM_SECONDS)) {
    const w0 = process.hrtime.bigint();
    try {
      bot.update(G, DT, G.input);
      G.update(DT);
    } catch (e) {
      outcome = 'error';
      errors.push('帧 ' + stats.frames + ' 未捕获异常: ' + e.stack);
      break;
    }
    const ms = Number(process.hrtime.bigint() - w0) / 1e6;
    stats.wallSumMs += ms;
    stats.wallMaxMs = Math.max(stats.wallMaxMs, ms);
    if (ms > HANG_SECONDS * 1000) { outcome = 'hang'; errors.push('帧 ' + stats.frames + ' 卡死（单帧 ' + ms.toFixed(0) + 'ms）'); break; }
    stats.frames++;
    t += DT;

    /* 玩家与敌人同验；地图读取独立于被测 solidAt/solidAtPx。 */
    for (const issue of spatialViolations(G)) {
      const kind=issue.split(':')[0], key={bounds:'boundsViolations',wallClip:'wallClipViolations',nan:'nanViolations'}[kind];
      stats[key]++;
      if(stats[key]<4)trace.push(issue+' @'+t.toFixed(1)+'s');
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

    if (opts.onFrame) opts.onFrame(G, t);
    if (G.state === 'victory') { outcome = 'victory'; victoryAt = t; break; }
    if (G.state === 'defeat') {
      outcome = 'defeat';
      errors.push('玩家在第 ' + (G.zoneIdx + 1) + ' 区阵亡 @' + t.toFixed(1) + 's（HP=' + G.player.hp + '，敌人=' + G.enemies.length + '）');
      break;
    }
  }

  if (!opts.maxSeconds && t >= MAX_SIM_SECONDS && G.state !== 'victory') {
    outcome = 'timeout';
    const boss = G.bossRef;
    errors.push('超过 ' + MAX_SIM_SECONDS + 's 仍未通关（死锁/停滞），state=' + G.state + '，区域=' + (G.zoneIdx + 1) + '，BossHP=' + (boss ? (boss.hp + '/' + boss.maxHp + ' st=' + boss.st + ' ph=' + boss.phase) : '-'));
    errors.push('快照: 玩家(' + G.player.x.toFixed(0) + ',' + G.player.y.toFixed(0) + ') portal=' + (G.portal ? '开' : '无')
      + ' wavIdx=' + G.wavIdx + '/' + G.waves.length + ' 待生成=' + G.pendSpawns.length
      + ' 敌军=' + (G.enemies.map(e => e.type + (e.spawning > 0 ? '*' : '') + ':' + (e.state || e.st) + '@(' + e.x.toFixed(0) + ',' + e.y.toFixed(0) + ')').join(' ') || '无'));
  }

  return {
    ok: G.state === 'victory' && errors.length === 0,
    outcome: outcome || (opts.maxSeconds ? 'limit' : 'timeout'),
    errors, trace, stats, G, victoryAt,
  };
}

module.exports = {
  DT, MAX_SIM_SECONDS, HANG_SECONDS, SEEDS,
  log, check, failureCount, simulateRun,
  CORE, GAME, BOT,
};
