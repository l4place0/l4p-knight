/* 诊断脚本 2：观测单只贴墙 gunner 停滞时 bot 的微观决策 */
'use strict';
require('../js/core.js');
const { dist } = require('../js/core.js');
const GAME = require('../js/game.js');
const BOT = require('../js/bot.js');

const seed = parseInt(process.argv[2] || '1');
const DT = 1 / 60;
const G = GAME.createGame({ seed, headless: true });
const bot = BOT.createBot(seed);
G.startRun();

let t = 0, stallStart = -1, lastKills = 0, lastLog = -10;
while (t < 480) {
  bot.update(G, DT, G.input);
  G.update(DT);
  t += DT;
  if (G.state === 'victory') { console.log('VICTORY @', t.toFixed(1)); process.exit(0); }
  if (G.state === 'defeat') { console.log('DEFEAT @', t.toFixed(1)); process.exit(0); }
  if (G.kills !== lastKills) { lastKills = G.kills; stallStart = -1; }
  const alive = G.enemies.filter(e => !e.dead);
  if (alive.length === 1 && G.kills === lastKills) {
    if (stallStart < 0) stallStart = t;
    if (t - stallStart > 8 && t - lastLog >= 2) {
      lastLog = t;
      const P = G.player, e = alive[0];
      const los = G.losClear(P.x, P.y, e.x, e.y);
      const d = dist(P.x, P.y, e.x, e.y);
      console.log(`t=${t.toFixed(0)} 玩家(${P.x.toFixed(0)},${P.y.toFixed(0)}) 敌${e.type}(${e.x.toFixed(0)},${e.y.toFixed(0)}) `
        + `d=${d.toFixed(0)} LOS=${los ? 1 : 0} 敌hp=${e.hp.toFixed(1)} 敌st=${e.state} 敌burst=${e.burst} `
        + `输入(m${G.input.moveX.toFixed(2)},${G.input.moveY.toFixed(2)} fire=${G.input.fire ? 1 : 0} dash=${G.input.dash ? 1 : 0}) `
        + `敌弹=${G.bullets.filter(b => !b.friendly).length} 玩家弹=${G.bullets.filter(b => b.friendly).length}`);
    }
  } else if (alive.length !== 1) stallStart = -1;
}
console.log('TIMEOUT kills=' + G.kills);
