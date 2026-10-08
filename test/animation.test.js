'use strict';
const assert = require('node:assert/strict');
const A = require('../js/animation.js');
const C = require('../js/core.js');
global.ZERO_CORE = C;
const GAME = require('../js/game.js');
const BOT = require('../js/bot.js');
// A cycle visits every process frame; one-shot collapse must never return to life.
assert.deepEqual(Array.from({ length: 6 }, (_, i) => A.frameIndex((i + 0.1) / 6, 1, false)), [0,1,2,3,4,5]);
assert.equal(A.frameIndex(10, 1, false), 5);
assert.equal(A.frameIndex(1, 1, true), 0);
const P = { x: 80, y: 80, hp: 6, vx: 0, vy: 0, dashT: 0, slashT: 0 };
const G = { player: P, heroId: 'vanguard', time: 0, zoneIdx: 0, mapId: 'z1a', roomIdx: 0, state: 'playing' };
let wall = 0;
const playback = A.createPlayback(G, () => wall);
assert.equal(playback.sample(P).action, 'idle');
P.vx = 40; assert.equal(playback.sample(P).action, 'move');
P.dashT = 0.08; assert.deepEqual([playback.sample(P).action, playback.sample(P).frame], ['dash',3]);
P.dashT = 0; P.slashT = 0.08; assert.equal(playback.sample(P).action, 'melee'); P.slashT = 0;
playback.event('hurt', P); playback.event('attack', P);
assert.equal(playback.sample(P).action, 'hurt', 'Shooting cannot erase an impact reaction');
G.time = 0.31; assert.equal(playback.sample(P).action, 'move');
const e = { id: 2, type:'charger', x:90, y:90, vx:0,vy:0,state:'aim', t:0.275 };
assert.deepEqual([playback.sample(e).action,playback.sample(e).frame], ['windup',3]);
e.state='dash'; e.t=0.21; assert.equal(playback.sample(e).frame,3);
playback.event('death', e); assert.equal(playback.corpseCount,1);
playback.event('death', e); assert.equal(playback.corpseCount,1, 'Death event must be idempotent');
G.mapId='z1b'; assert.equal(playback.corpseCount,0, 'Corpses cannot leak across rooms');
const boss = {type:'boss',isBoss:true,st:'transition',t:0.75,vx:0,vy:0};
assert.deepEqual([playback.sample(boss).action,playback.sample(boss).frame],['phase',3]);
boss.st='dying';boss.t=0.65;
assert.deepEqual([playback.sample(boss).action,playback.sample(boss).frame],['death',3]);
G.state='defeat'; P.hp=0; playback.event('death',P); wall=0.9;
assert.equal(playback.sample(P).frame,5, 'Death advances after gameplay time has stopped');
G.player={...P,hp:6};G.state='playing';G.time=0;
assert.equal(playback.sample(G.player).action,'move', 'New run must discard previous death state');
// Real simulation equivalence: presentation callbacks must not affect RNG,
// damage, AI, kills, pickups or room progression at any simulation step.
for(const seed of [1,7,23]) {
  const games=[GAME.createGame({seed,headless:true}),GAME.createGame({seed,headless:true})];
  const bots=[BOT.createBot(seed),BOT.createBot(seed)]; let events=0;
  const actualPlayback=A.createPlayback(games[1]);
  games[1].visualEvent=(action,entity)=>{events++;actualPlayback.event(action,entity);};
  games.forEach(g=>g.startRun('vanguard'));
  for(let frame=0;frame<700;frame++) {
    games.forEach((g,i)=>{bots[i].update(g,1/60,g.input);g.update(1/60);});
    actualPlayback.sample(games[1].player);
    const snapshot=g=>JSON.stringify({state:g.state,time:g.time,hp:g.player.hp,shield:g.player.shield,
      x:g.player.x,y:g.player.y,kills:g.kills,score:g.score,coins:g.coins,enemies:g.enemies,bullets:g.bullets,pickups:g.pickups});
    assert.equal(snapshot(games[0]),snapshot(games[1]),'Presentation changed simulation at seed '+seed+' frame '+frame);
  }
  assert(events>0,'Real gameplay must dispatch animation events');
}
console.log('PASS: frame sequencing, priorities, combat state mapping, corpse/reset lifecycle, terminal playback, 3 seeds x 700 steps of simulation equivalence.');
