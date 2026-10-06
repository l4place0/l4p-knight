/* ============================================================
 * 零号协议 ZERO PROTOCOL —— test/cases/regression.js
 * 【用例即模块】回归场景用例（sim.test.js 场景段文件化的范式范例）：
 *   - 每个用例 = 一个 function(ctx)，ctx 即 test/lib.js 导出的测试基建
 *     （check / log / simulateRun / DT / CORE / GAME / BOT …）
 *   - 用例文件导出「function(ctx) 形式」的用例数组，由 sim.test.js 顺序调用；
 *     断言基建（check/log/failures 汇总）一律取自 ctx，不在用例内复制粘贴
 *   - 新增场景：在 test/cases/ 新建文件，导出用例函数数组，并在
 *     sim.test.js 的用例调用区按顺序挂载即可
 * ============================================================ */
'use strict';

/* --- 隔墙锁定回归：目标与玩家被长墙完全阻隔，bot 必须绕墙接敌 --- */
function wallLockRegression(ctx) {
  const { check, log, GAME, BOT, DT } = ctx;
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

/* --- 墙角嵌入回归：箱体角搭接墙角必须被推出（resolveOutOfWall 兜底分支） --- */
function cornerEmbedRegression(ctx) {
  const { check, log, GAME } = ctx;
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

/* 用例注册表：由 sim.test.js 按数组顺序调用 */
module.exports = [wallLockRegression, cornerEmbedRegression];
