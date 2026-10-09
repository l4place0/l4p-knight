/* Shared Node/browser fixtures for issues 004/005. Setup only; every step uses
 * the real bot inputs, game movement, weapons, damage and room interactions. */
(function(root) {
'use strict';
const DT=1/60;
const GENES={commit:45,trackK:2,sight:85,delay:15,dashSkip:0.85};
function z4b(env,seed=46,hero='prototype') {
  const G=env.GAME.createGame({seed,headless:true}),bot=env.BOT.createBot(seed);
  G.startRun(hero);G.debugJump(4,2);
  G.chips.push('overcharge','servo','crit','capacitor','pierce','nano');
  G.powerBonus=0.24;G.bonusShield=2;G.computeStats();
  return {G,bot,kind:'room',seconds:0,idle:0,maxIdle:0,last:null,shots:0,cancelledCharges:0};
}
function portal(env,G) {
  if(!G) {
    G=env.GAME.createGame({seed:3,headless:true});G.startRun();
    G.debugJump(3,1);G.loadBossRoom('boss');G.debugClear();
    G.waves=[];G.wavIdx=99;G.pendSpawns=[];G.chipOffered=true;
    G.player.x=270.51;G.player.y=58.9;G.portal={x:200,y:200};
  }
  return {G,bot:env.BOT.createBot(3,{...GENES}),kind:'portal',seconds:0,idle:0,maxIdle:0,last:null,shots:0,cancelledCharges:0};
}
function step(s, invariant) {
  const G=s.G,P=G.player,charge=P.chargeT,cooldown=P.fireT;
  try {
    s.bot.update(G,DT,G.input);
    if(charge>0&&!G.input.fire)s.cancelledCharges++;
    G.update(DT);
  } catch(e) {s.outcome='error';s.reason=e.message;return false;}
  s.seconds+=DT;
  if(cooldown<=0&&P.fireT>0&&G.weapons[G.weaponSlot].type==='rail')s.shots++;
  const violation=invariant&&invariant(G)[0];
  if(violation){s.outcome='violation';s.reason=violation;return false;}
  if(s.kind==='portal'&&G.zoneIdx===3){s.outcome='entered';return false;}
  if(s.kind==='room'&&G.chipOffered&&G.floor.rooms[1].cleared){s.outcome='clear';return false;}
  if(G.state==='defeat'){s.outcome='defeat';return false;}
  if(s.kind==='room'&&Math.round(s.seconds/DT)%60===0) {
    const alive=G.enemies.filter(e=>!e.dead),hp=alive.reduce((n,e)=>n+Math.max(0,e.hp),0);
    const progress=!s.last||Math.abs(hp-s.last.hp)>0.5||P.hp!==s.last.playerHp||G.kills!==s.last.kills;
    s.idle=alive.length&&!progress?s.idle+1:0;s.maxIdle=Math.max(s.maxIdle,s.idle);
    s.last={hp,playerHp:P.hp,kills:G.kills};
    if(s.idle>=20){s.outcome='stall';return false;}
  }
  if(s.seconds+DT/2>=(s.kind==='portal'?10:120)){s.outcome='timeout';return false;}
  return true;
}
function result(s) {return {kind:s.kind,outcome:s.outcome,seconds:+s.seconds.toFixed(2),maxIdle:s.maxIdle,
  kills:s.G.kills,shots:s.shots,cancelledCharges:s.cancelledCharges,...(s.reason?{reason:s.reason}:{})};}
function run(s,invariant) {while(step(s,invariant)){}return result(s);}
const api={GENES,z4b,portal,step,result,run};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else root.ZERO_NAV_TEST=api;
})(typeof globalThis!=='undefined'?globalThis:window);
