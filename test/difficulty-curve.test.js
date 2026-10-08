'use strict';
const assert=require('node:assert/strict');
const {loadMechanics}=require('./load-mechanics.js');
const {CORE:C,GAME,context}=loadMechanics();
const {summarizeCurve,run}=require('./difficulty-balance.js');
// 实际伤害入口：先按当前道中/首领缩放，再扣护盾和生命；含 Boss 召唤物危险源。
for(const difficulty of Object.keys(C.DIFFICULTIES)){
  const G=GAME.createGame({headless:true,difficulty});G.startRun();
  const hit=(factor)=>{
    G.state='playing';G.player.iframes=0;G.player.shield=0.1;G.player.hp=10;
    context(G).damagePlayer(2,100,100);
    const loss=2*C.DIFFICULTIES[difficulty].damageScale*factor;
    assert(Math.abs(G.player.hp-(10-Math.max(0,loss-0.1)))<1e-10);
    assert(Math.abs(G.player.shield-Math.max(0,0.1-loss))<1e-10);
  };
  for(let zone=0;zone<4;zone++){G.debugJump(zone+1,1);hit(C.DIFFICULTY_CURVE.routeDamage[zone]);}
  for(const [zone,type] of [[3,'boss'],[4,'boss2']]){
    G.debugJump(zone,1);G.loadBossRoom(type);
    assert.equal(G.bossRef.maxHp,C.ENEMY_DEFS[type].hp*C.DIFFICULTY_CURVE.bossHp[type]);
    hit(C.DIFFICULTY_CURVE.bossDamage[type]);
    G.damageTuning=1;G.player.iframes=0;G.player.shield=0;G.player.hp=10;
    context(G).damagePlayer(2,100,100);assert.equal(G.player.hp,8,'历史伤害覆盖必须绕过曲线');
    G.damageTuning=null;
  }
}
{
  const G=GAME.createGame({headless:true});G.startRun();G.debugJump(4,1);
  const expected=C.ENEMY_DEFS.gunner.hp*(1+0.32*3)*C.ENEMY_DIFF[4].hpMul*C.DIFFICULTY_CURVE.enemyHp;
  const ordinary=G.debugSpawn('gunner',240,180);
  assert(Math.abs(ordinary.maxHp-expected*(ordinary.elite?2.2:1))<1e-10,'普通敌人应缩短击杀时间，精英仍保留词条');
  G.enemyTuning={hpMul:1};
  const overridden=G.debugSpawn('gunner',240,180);
  assert.equal(overridden.maxHp,C.ENEMY_DEFS.gunner.hp*(1+0.32*3)*(overridden.elite?2.2:1),'显式 HP 探针仍可覆盖');
  G.loadBossRoom('boss2');
  const summoned=G.debugSpawn('echo',240,180);
  assert.equal(summoned.maxHp,C.ENEMY_DEFS.echo.hp*(1+0.32*3)*(summoned.elite?2.2:1),'Boss 召唤物不套普通敌人 HP 曲线');
  assert.equal(summoned.diff.hpMul,1);
  G.debugBossHp=900;G.loadBossRoom('boss2');assert.equal(G.bossRef.maxHp,900,'绝对血量探针不能被曲线再次缩放');
}
// 每次清房只判定一次补给，探针端点验证生成/禁止，不依赖概率抽样。
for(const chance of [0,1]){
  const G=GAME.createGame({headless:true,seed:3});
  G.curveTuning={...C.DIFFICULTY_CURVE,clearLootChance:chance};
  G.startRun();G.enterRoom(1);G.debugClear();G.pendSpawns=[];G.wavIdx=G.waves.length-1;
  for(let i=0;i<65;i++)G.update(1/60);
  assert.equal(G.pickups.length,chance);
  const pickups=G.pickups.length;
  for(let i=0;i<65;i++)G.update(1/60);
  assert.equal(G.pickups.length,pickups,'肃清不能重复生成补给');
}
// 条件失败率必须用进入该阶段的局数，不能除以所有开局数。
const samples=[
  {outcome:'defeat',zone:1,room:'combat',perZone:Array.from({length:4},(_,i)=>({reached:i===0,bossReached:false}))},
  {outcome:'defeat',zone:3,room:'boss',perZone:Array.from({length:4},(_,i)=>({reached:i<=2,bossReached:i===2}))},
  {outcome:'victory',zone:4,room:'boss',perZone:Array.from({length:4},(_,i)=>({reached:true,bossReached:i>=2}))},
];
const curve=summarizeCurve(samples);
assert.equal(curve.blocks.length,6);
assert.equal(curve.blocks.find(b=>b.zone===3&&b.kind==='boss').deathRate,50);
assert.equal(curve.route.attempts,8);assert.equal(curve.boss.attempts,3);
assert.equal(curve.route.deaths+curve.boss.deaths,2);
// 候选 H 曾在这两局超过硬上限；修正后按真实输入运行，阵亡也是有效结局。
for(const [hero,seed,difficulty] of [['vanguard',203,'standard'],['vanguard',222,'standard'],['bulwark',335,'standard'],['bulwark',344,'casual'],['stalker',438,'casual']]){
  const result=run({hero,seed},{difficulty});
  assert(['victory','defeat'].includes(result.outcome),'Seed '+seed+' must terminate within the unchanged 1200s cap');
}
console.log('PASS: six-stage shield/health scaling, enemy HP isolation, legacy override, once-only supply, conditional-risk denominators, five timeout regressions');
