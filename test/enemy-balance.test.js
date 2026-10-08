/* 小怪难度回归：真实危险源伤害、Boss 召唤物隔离、标定失败口径。
 * node test/enemy-balance.test.js
 */
'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const CORE = require('../js/core.js');
const GAME = require('../js/game.js');
const { ORIGINAL, enumerate, summarize } = require('./enemy-balance.js');
const { simulateRun } = require('./lib.js');
function isolated() {
  const G = GAME.createGame({ seed: 3, headless: true });
  G.startRun(); G.debugClear(); G.waves = []; G.wavIdx = 99; G.pendSpawns = []; G.chipOffered = true;
  G.damageTuning=1;
  G.player.iframes = 0;
  return G;
}
for (const type of ['gunner', 'sniper', 'bomber']) {
  const G = isolated(), P = G.player;
  const spot = G.spawnSpots.find(s => {
    const d = Math.hypot(s.x-P.x,s.y-P.y);
    return d > 45 && d < 90 && G.losClear(s.x,s.y,P.x,P.y);
  });
  assert.ok(spot, '危险源测试需要有视线的空地');
  const e = G.debugSpawn(type, spot.x, spot.y); e.cd = 0;
  if (type === 'bomber') { e.x=P.x+10; e.y=P.y; e.state='arm'; e.t=0.49; }
  const start = P.hp+P.shield;
  for(let i=0;i<600 && G.damageTaken===0;i++) G.update(1/60);
  assert.ok(G.damageTaken > 0, type+' 应实际命中玩家');
  assert.equal(start-P.hp-P.shield, type==='sniper'?8:4, type+' 的难度倍率必须到达实际伤害结算');
  if(type==='bomber') assert.equal(e.contact,0,'自爆蜂不能新增接触伤害');
}
{
  const G=isolated(); G.enemyTuning={hpMul:20,dmgMul:20};
  G.debugJump(4,1); G.loadBossRoom('boss2');
  const e=G.debugSpawn('echo',240,180);
  assert.equal(e.maxHp,CORE.ENEMY_DEFS.echo.hp*(1+0.32*3),'Boss 召唤物不受普通房倍率影响');
  assert.equal(e.diff.dmgMul,1); assert.equal(e.contact,0);
}
{
  const G=isolated(); G.enemyTuning=ORIGINAL;
  const e=G.debugSpawn('gunner',240,180);
  assert.equal(e.maxHp,CORE.ENEMY_DEFS.gunner.hp); assert.equal(e.speed,CORE.ENEMY_DEFS.gunner.speed);
}
assert.equal(enumerate('all',100,1).length,700,'七房必须各有一个完整 batch');
assert.equal(new Set(enumerate('z1a',100,26).map(s=>s.seed)).size,25,'留出批必须覆盖 25 个种子');
const samples=Array.from({length:100},(_,i)=>({hero:'vanguard',outcome:i<36?'clear':'defeat',seconds:10,hits:1}));
assert.equal(summarize(samples).qualified,true,'36% 正常战斗通过率应达标');
assert.equal(summarize(samples.map((r,i)=>i===36?{...r,outcome:'clear'}:r)).qualified,false,'37% 必须拒绝');
for(const outcome of ['timeout','stall','error','violation']) {
  assert.equal(summarize(samples.map((r,i)=>i===99?{...r,outcome}:r)).qualified,false,outcome+' 不可充当难度达标');
}
const crashed = simulateRun(1,{quiet:true,maxSeconds:1,onFrame(G){G.update=()=>{throw new Error('故障注入');};}});
assert.equal(crashed.outcome,'error','实际更新异常必须返回 error');
assert.match(crashed.errors[0],/故障注入/);
const frozen = simulateRun(1,{quiet:true,onFrame(G){G.update=()=>{};}});
assert.equal(frozen.outcome,'timeout','实际冻结世界必须返回 timeout');
assert.equal(frozen.ok,false);
/* 负向验证整套验收：只给一个真实样本的报告注入运行故障，整体必须返回非零。 */
for(const outcome of ['timeout','error']) {
  const code=`const lib=require('./test/lib.js'); const run=lib.simulateRun; let injected=false;
    lib.simulateRun=function(seed,opts){const r=run(seed,opts);if(!injected){injected=true;r.outcome='${outcome}';r.errors.push('injected ${outcome}');}return r;};
    require('./test/sim.test.js');`;
  const result=spawnSync(process.execPath,['-e',code],{cwd:require('node:path').join(__dirname,'..'),encoding:'utf8'});
  assert.equal(result.status,1,'完整验收必须拒绝 '+outcome);
  assert.match(result.stdout,/完整局运行故障/,'故障必须由完整局断言检出');
}
console.log('✓ 小怪难度回归通过（真实伤害 / Boss 隔离 / batch 口径 / 完整验收负向验证）');
