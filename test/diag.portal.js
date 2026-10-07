/* seed=3 传送门停滞诊断：使用 v1.9 原始小怪，保持开门前过程一致，仅在开门后改变一个 bot 基因。
 * node test/diag.portal.js [seed]；输出四组对照，不修改游戏源码或存档。
 * 本工具观测区域守卫后的导航，不评定 Boss 难度或整局通过率。
 */
'use strict';
// 固定历史源码，武器/英雄后续校正不能改变已登记 BUG 的复现前置条件。
const {GAME,BOT}=require('./load-mechanics.js').loadMechanics(null,'458bd1a');
const seed = Number(process.argv[2] || 3);
if (!Number.isInteger(seed) || seed < 1) throw new Error('seed 必须为正整数');
const DT = 1 / 60, MAX_FRAMES = 660 * 60;
const variants = [
  ['baseline', null],
  ['commit-off-after-portal', ['commit', 0]],
  ['commit-10-after-portal', ['commit', 10]],
  ['delay-off-after-portal', ['delay', 0]],
];
const round = n => +n.toFixed(2);

for (const [variant, mutation] of variants) {
  const genes = { commit: 45, trackK: 2, sight: 85, delay: 15, dashSkip: 0.85 };
  const G = GAME.createGame({ seed, headless: true });
  G.enemyTuning = { hpMul: 1, speedMul: 1, aggression: 1, bulletMul: 1, densityMul: 1, dmgMul: 1 };
  const bot = BOT.createBot(seed, genes);
  G.startRun();
  let checkpoint = null, openedAt = null, enteredAt = null, elapsed = 0;
  let minDistance = Infinity, moved = 0, previous = null;
  let navFrames = 0, opposingFrames = 0, maxStuck = 0;
  for (let i = 0; i < MAX_FRAMES; i++) {
    bot.update(G, DT, G.input);
    const debug = G.__botdbg && G.__botdbg.pop();
    G.update(DT);
    elapsed = (i + 1) * DT;
    if (G.zoneIdx === 2 && G.isBossRoom && G.portal) {
      const P = G.player;
      if (!checkpoint) {
        openedAt = elapsed;
        checkpoint = {
          at: round(elapsed), player: [round(P.x), round(P.y)],
          portal: [G.portal.x, G.portal.y], bossDead: G.bossRef.dead,
          bossDown: !!G.bossDown[2], portalClear: !G.boxHitsWall(G.portal.x, G.portal.y, P.r),
        };
        if (mutation) genes[mutation[0]] = mutation[1];
        G.__botdbg = [];
      }
      minDistance = Math.min(minDistance, Math.hypot(P.x - G.portal.x, P.y - G.portal.y));
      if (previous) moved += Math.hypot(P.x - previous.x, P.y - previous.y);
      previous = { x: P.x, y: P.y };
      if (debug && debug.nav) {
        navFrames++;
        if (debug.wx * debug.mx + debug.wy * debug.my < 0) opposingFrames++;
        maxStuck = Math.max(maxStuck, debug.stuckT);
      }
    }
    if (checkpoint && G.zoneIdx === 3) { enteredAt = elapsed; break; }
    if (G.state === 'defeat' || G.state === 'victory') break;
  }
  console.log(JSON.stringify({
    seed, variant, checkpoint, enteredAt: enteredAt == null ? null : round(enteredAt),
    portalWait: checkpoint && enteredAt != null ? round(enteredAt - openedAt) : null,
    elapsed: round(elapsed), state: G.state, minDistance: Number.isFinite(minDistance) ? round(minDistance) : null,
    moved: round(moved), navFrames, opposingFrames, maxStuck,
  }));
}
