'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const C=require('../src/core.js');
const {batch,enumerate,summarize,GENES,BUILDS}=require('./enemy-balance.js');
function heroSummary(results) {
  const heroes={};
  for(const hero of Object.keys(C.HEROES))heroes[hero]=summarize(results.filter(r=>r.hero===hero));
  const rates=Object.values(heroes).map(h=>h.passRate);
  return {heroes,spread:+(Math.max(...rates)-Math.min(...rates)).toFixed(2),
    qualified:rates.every(r=>r>=10&&r<37)&&Math.max(...rates)-Math.min(...rates)<=15};
}
async function run(seedStart) {
  const results=await batch(enumerate('all',100,seedStart),{},4),rooms={};
  for(const z of C.ZONES)for(const room of z.maps)rooms[room]=summarize(results.filter(r=>r.mapId===room));
  const summary=heroSummary(results);
  return {seedStart,rooms,...summary,results,qualified:summary.qualified&&Object.values(rooms).every(r=>r.qualified)};
}
async function main() {
  const calibration=await run(1);console.log('calibration',JSON.stringify({rooms:Object.fromEntries(Object.entries(calibration.rooms).map(([k,v])=>[k,v.passRate])),heroes:Object.fromEntries(Object.entries(calibration.heroes).map(([k,v])=>[k,v.passRate])),spread:calibration.spread,qualified:calibration.qualified}));
  const holdout=await run(10001);console.log('holdout',JSON.stringify({rooms:Object.fromEntries(Object.entries(holdout.rooms).map(([k,v])=>[k,v.passRate])),heroes:Object.fromEntries(Object.entries(holdout.heroes).map(([k,v])=>[k,v.passRate])),spread:holdout.spread,qualified:holdout.qualified}));
  const weapons={};
  for(const weapon of Object.keys(C.WEAPONS)) {
    // 同一突击兵、相同地图/构筑/种子；移除换枪箱，避免把别的武器表现算进来。
    const specs=enumerate('all',100,1).filter(s=>s.hero==='vanguard');
    const results=await batch(specs,{weapon},4);
    weapons[weapon]={...summarize(results),role:weapon==='blade'?'secondary-defense':'primary',results};
    console.log('weapon',weapon,weapons[weapon].passRate,weapons[weapon].outcomes);
  }
  const report={configurationHash:C.CONFIG.hash,version:require('../package.json').version,genes:GENES,builds:BUILDS,difficulty:C.ENEMY_DIFF,heroDefinitions:C.HEROES,weaponDefinitions:C.WEAPONS,
    criteria:{room:'每房 M3 等权通过率 >0 且 <37%，运行故障 0',hero:'每英雄跨七房通过率 >=10% 且 <37%，英雄差距 <=15 个百分点，两批独立判定',weapon:'远程主武器跨七房通过率 >0 且 <37%，六武器均无运行故障；相位刃是副手防御，不要求单持清房'},calibration,holdout,weapons};
  const args=process.argv.slice(2),out=args.includes('--out')?args[args.indexOf('--out')+1]:'docs/balance/hero-difficulty-v1.11.json';
  fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  assert.ok(calibration.qualified&&holdout.qualified,'英雄/房间平衡门未通过');
  for(const [id,w]of Object.entries(weapons)) {assert.equal(w.invalid,0,id+' 运行故障');if(id!=='blade')assert.ok(w.qualified,id+' 主武器通过率范围');}
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={heroSummary};
