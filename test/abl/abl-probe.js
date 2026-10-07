/* ============================================================
 * 消融实验快速探针（仅供 test/abl 逐行消融使用；正常验收跑 test/sim.test.js）
 * 三场景连打：S1 通关流（全链路推进）· S2 boss1 击杀 · S3 boss2 击杀
 * 每帧不变量：坐标有限 / 不越界 / 敌人不嵌墙
 * 退出码：0 = 变异存活（探针未捕获）· 非 0 = 变异被杀死（reason 见 stdout）
 * 用法：node test/abl/run.js（带 90s 墙钟强杀，防变异死循环卡死调用方）
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let CORE, GAME, BOT;
try {
  CORE = require(path.join(ROOT, 'js', 'core.js'));
  GAME = require(path.join(ROOT, 'js', 'game.js'));
  BOT = require(path.join(ROOT, 'js', 'bot.js'));
} catch (e) {
  console.log('KILLED-LOAD: ' + e.message);
  process.exit(1);
}
const DT = 1 / 60;

function invariants(G, t) {
  const mw = G.mw * 16, mh = G.mh * 16;
  const all = [G.player].concat(G.enemies);
  for (const e of all) {
    if (!isFinite(e.x) || !isFinite(e.y)) return 'NaN@' + t.toFixed(1);
    if (e.x < -2 || e.x > mw + 2 || e.y < -2 || e.y > mh + 2) return '越界:' + e.type + '@' + t.toFixed(1);
  }
  for (const e of G.enemies) {
    const r = e.r - 1;
    if (G.solidAtPx(e.x - r, e.y - r) || G.solidAtPx(e.x + r, e.y - r) ||
        G.solidAtPx(e.x - r, e.y + r) || G.solidAtPx(e.x + r, e.y + r)) {
      return '嵌墙:' + e.type + '@' + t.toFixed(1);
    }
  }
  return null;
}

function scenario(name, seed, hero, dmg, frames, setup, judge) {
  const G = GAME.createGame({ seed, headless: true });
  const bot = BOT.createBot(seed);
  G.debugDmg = dmg;
  G.startRun(hero);
  setup && setup(G);
  let t = 0;
  try {
    for (let i = 0; i < frames; i++) {
      if (G.state === 'victory' || G.state === 'defeat') break;
      // bot 也接管 chip/shop 态（与 sim.test 同构），不能在冻结态停帧
      bot.update(G, DT, G.input);
      G.update(DT);
      t += DT;
      const bad = invariants(G, t);
      if (bad) return { ok: false, reason: name + ' ' + bad };
      if (judge.tick && judge.tick(G, t)) return { ok: true, note: name + ' 提前达成@' + t.toFixed(1) + 's' };
    }
  } catch (e) {
    return { ok: false, reason: name + ' 异常: ' + (e && e.message) };
  }
  return judge.judge(G, t);
}

const results = [];
let failed = false;
function record(r) {
  results.push(r);
  if (!r.ok) { failed = true; console.log('KILLED ' + r.reason); }
  else console.log('ALIVE ' + r.note);
}

// S1 通关流：dmg=20 快速击杀，150 游戏秒内应 VICTORY（覆盖房间/敌人/晶片/商店/传送门全链路）
// （boss 重标定后血量大涨，dmg=8 已不够在时限内击破最终 Boss——探测目标是链路推进而非数值）
record(scenario('S1 通关流', 1, 'vanguard', 20, 60 * 150, null, {
  tick: (G) => G.state === 'victory',
  judge: (G, t) => G.state === 'victory'
    ? { ok: true, note: 'S1 VICTORY@' + t.toFixed(1) + 's' }
    : { ok: false, reason: 'S1 未通关: kills=' + G.kills + ' room=' + G.roomIdx + ' zone=' + (G.zoneIdx + 1) + ' state=' + G.state },
}));

// S2 boss1 击杀：dmg=12，75 游戏秒内应被击杀（或至少走完三阶段）
record(scenario('S2 boss1', 5, 'vanguard', 12, 60 * 75, (G) => G.loadBossRoom('boss'), {
  tick: (G) => G.bossRef && G.bossRef.dead,
  judge: (G) => (G.bossRef && (G.bossRef.dead || G.bossRef.phase >= 3)) || G.bossDown[0]
    ? { ok: true, note: 'S2 boss1 击破/三阶段' }
    : { ok: false, reason: 'S2 boss1 未击破: hp=' + (G.bossRef ? G.bossRef.hp : '-') + ' phase=' + (G.bossRef ? G.bossRef.phase : '-') },
}));

// S3 boss2 击杀：dmg=12，80 游戏秒内应被击杀（覆盖镜像/引力井/相位风暴）
record(scenario('S3 boss2', 7, 'vanguard', 12, 60 * 80, (G) => G.loadBossRoom('boss2'), {
  tick: (G) => G.bossRef && G.bossRef.dead,
  judge: (G) => (G.bossRef && (G.bossRef.dead || G.bossRef.phase >= 3)) || G.bossDown[0]
    ? { ok: true, note: 'S3 boss2 击破/三阶段' }
    : { ok: false, reason: 'S3 boss2 未击破: hp=' + (G.bossRef ? G.bossRef.hp : '-') + ' phase=' + (G.bossRef ? G.bossRef.phase : '-') },
}));

console.log(failed ? 'PROBE=KILLED' : 'PROBE=ALIVE');
process.exit(failed ? 1 : 0);
