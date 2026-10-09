'use strict';
const assert=require('node:assert/strict');
const {loadMechanics}=require('./load-mechanics.js');
const {CORE:C,GAME,context}=loadMechanics();
const {scenarios,summarize}=require('./difficulty-balance.js');
assert.equal(Object.keys(C.DIFFICULTIES).length,3);
assert.deepEqual(Array.from(Object.values(C.DIFFICULTIES),d=>d.target),[37,67,99]);
assert.equal(GAME.createGame({headless:true}).difficultyId,'standard');
assert.equal(GAME.createGame({headless:true,difficulty:'invalid'}).difficultyId,'standard');
assert.equal(GAME.createGame({headless:true,difficulty:'constructor'}).difficultyId,'standard');
for(const id of Object.keys(C.DIFFICULTIES)){
  const G=GAME.createGame({headless:true,difficulty:id});G.startRun();
  G.player.iframes=0;G.player.shield=0;
  const hp=G.player.hp;context(G).damagePlayer(2,0,0);
  assert(Math.abs(hp-G.player.hp-2*C.DIFFICULTIES[id].damageScale*C.DIFFICULTY_CURVE.routeDamage[0])<1e-10);
  assert.equal(G.endStats().difficulty,id);
  G.startRun('stalker');assert.equal(G.difficultyId,id,'Retry retains difficulty');
  G.startRun('vanguard',null,'casual');assert.equal(G.difficultyId,'casual');
  G.startRun('vanguard',null,'invalid');assert.equal(G.difficultyId,'standard');
}
assert.equal(scenarios().length,100);assert.equal(new Set(scenarios().map(s=>s.seed)).size,25);
assert.equal(scenarios(100,26)[0].seed,26);
const samples=scenarios().map((s,i)=>({...s,outcome:i<67?'victory':'defeat',seconds:300}));
assert.equal(summarize(samples,67).passRate,67);assert.equal(summarize(samples,67).invalid,0);
assert(summarize(samples,67).confidence95[0]<67 && summarize(samples,67).confidence95[1]>67);
assert(summarize(samples.map(r=>({...r,outcome:'victory'})),37).confidence95[0]>37);
for(const outcome of ['timeout','stall','error','violation'])assert.equal(summarize(samples.map((r,i)=>i===99?{...r,outcome}:r),67).invalid,1);
// Historical post-Boss portal layout: ordinary movement and interact must
// reach zone four, without teleporting the player during the test.
{
  const G=GAME.createGame({seed:3,headless:true});G.startRun();G.debugJump(3,1);G.loadBossRoom('boss');G.debugClear();
  G.waves=[];G.wavIdx=99;G.pendSpawns=[];G.chipOffered=true;
  G.player.x=270.51;G.player.y=58.9;G.portal={x:200,y:200};
  const bot=require('../src/bot.js').createBot(3,{commit:45,trackK:2,sight:85,delay:15,dashSkip:0.85});
  for(let i=0;i<600&&G.zoneIdx===2;i++){bot.update(G,1/60,G.input);G.update(1/60);}
  assert.equal(G.zoneIdx,3,'Post-Boss portal navigation must finish in ten seconds');
}
const navigationRegression=require('./difficulty-balance.js').run({hero:'prototype',seed:33},{difficulty:'casual'});
assert.equal(navigationRegression.outcome,'victory','Seed 33 railgun hero must resolve the blocked guard route and complete the run');
assert.equal(navigationRegression.combatRoomsCleared,21,'New layout requires all 21 combat rooms');
assert.equal(navigationRegression.shopVisits,4);
assert(navigationRegression.perZone.every(z=>z.reached));
assert.equal(navigationRegression.perZone.reduce((n,z)=>n+z.hits,0),navigationRegression.hits);
assert.equal(navigationRegression.perZone.reduce((n,z)=>n+z.combatRoomsCleared,0),21);
assert(navigationRegression.perZone.every(z=>z.routeCleared),'Every regional route must finish before victory');
assert(navigationRegression.perZone.every(z=>z.routeHits+z.bossHits===z.hits));
console.log('PASS: three targets, defaults/invalid IDs, actual damage scaling, retries/end stats, equal-hero full-run cohorts, invalid-run rejection and seed 33 navigation regression.');
