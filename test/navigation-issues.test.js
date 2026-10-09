'use strict';
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {loadMechanics}=require('./load-mechanics.js');
const {spatialViolations}=require('./invariants.js');
const N=require('./navigation-issues.js'),env=loadMechanics();
const fault=process.argv.find(a=>a.startsWith('--fault='));
if(fault) {
  const s=N.z4b(env);
  if(fault==='--fault=error')s.G.update=()=>{throw new Error('injected main-loop failure');};
  else if(fault==='--fault=stall') {
    s.G.debugSpawn('gunner',40,40);s.G.update=()=>{}; // frozen physics, live enemy
  } else throw new Error('Unknown injected fault');
  const r=N.run(s,spatialViolations);console.log(JSON.stringify(r));
  process.exit(r.outcome==='clear'?0:1);
}
const results=[];
for(const [hero,seed]of [['prototype',21],['stalker',9],['prototype',43],['prototype',46],['prototype',52]]) {
  const r=N.run(N.z4b(env,seed,hero),spatialViolations);
  assert.equal(r.outcome,'clear',hero+'/'+seed+' must clear without a 20-second stall');
  results.push({hero,seed,...r});
}
const p=N.run(N.portal(env),spatialViolations);
assert.equal(p.outcome,'entered','Current post-Boss layout must enter zone four within ten seconds');
// Recreate the actual 164.03s historical checkpoint rather than only a snapshot.
// Keep historical game/combat intact; replace only the bot after the door opens.
const legacy=loadMechanics(null,'458bd1a'),G=legacy.GAME.createGame({seed:3,headless:true});
G.startRun();const oldBot=legacy.BOT.createBot(3,{...N.GENES});let frames=0;
for(;frames<660*60&&!(G.zoneIdx===2&&G.isBossRoom&&G.portal);frames++){oldBot.update(G,1/60,G.input);G.update(1/60);}
assert.ok(G.portal&&G.bossRef.dead&&G.bossDown[2],'Historical guard must die and open its portal');
assert.ok(Math.abs(frames/60-164.03)<0.02,'Original pre-portal combat must stay unchanged');
assert.ok(Math.abs(G.player.x-270.51)<0.02&&Math.abs(G.player.y-58.9)<0.02);
const original=N.run(N.portal(env,G),spatialViolations);
assert.equal(original.outcome,'entered','Actual historical checkpoint must enter zone four within ten seconds');
// The broader candidate passed rooms but timed out in this complete run.
const full=require('./difficulty-balance.js').run({hero:'bulwark',seed:518},{difficulty:'casual'});
assert.equal(full.outcome,'victory','Bulwark/518 must finish the actual full run under the unchanged time limit');
assert.equal(full.combatRoomsCleared,21);assert.equal(full.shopVisits,4);assert.equal(full.bossDown,2);
// Negative controls: removing each repair must make its acceptance fail.
const noRail=loadMechanics({name:'remove stalled rail fire',file:'src/bot.js',
  from:"const railStallFire = botStalled && w.type === 'rail';",to:'const railStallFire = false;'});
assert.equal(N.run(N.z4b(noRail),spatialViolations).outcome,'stall','Rail repair removal must reproduce the stall');
const noChargerWall=loadMechanics({name:'restore hidden charger fear',file:'src/bot.js',
  from:'if (d < 90 && (!ignoreBomber || G.losClear(e.x, e.y, P.x, P.y))) {',to:'if (d < 90) {'});
assert.equal(N.run(N.z4b(noChargerWall,52),spatialViolations).outcome,'stall','Wall-threat repair removal must reproduce seed 52 stall');
const noPortal=loadMechanics({name:'restore portal inertia',file:'src/bot.js',
  from:'const portalNavigation = !target && (!!G.portal || !!(G.navigationDoor && G.navigationDoor()));',
  to:'const portalNavigation = false;'});
assert.equal(N.run(N.portal(noPortal),spatialViolations).outcome,'timeout','Portal repair removal must reproduce navigation timeout');
for(const kind of ['stall','error']) {
  const child=spawnSync(process.execPath,[__filename,'--fault='+kind],{encoding:'utf8'});
  assert.equal(child.status,1,'Injected '+kind+' must exit nonzero');
  assert.equal(JSON.parse(child.stdout.trim()).outcome,kind);
}
console.log('PASS: issues 004/005, original historical checkpoint, five z4b seeds, full bulwark/518 run, three repair removals and nonzero stall/error exits.');
console.log(JSON.stringify({portal:p,originalPortal:original,z4b:results,fullRun:{hero:full.hero,seed:full.seed,outcome:full.outcome,seconds:full.seconds}}));
