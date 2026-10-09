'use strict';
// 汇总固定参数评测；只读逐局文件，不调难度或生成新战斗样本。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const C=require('../src/core.js');
const {summarize}=require('./difficulty-balance.js');
const dir=path.join(__dirname,'../docs/balance');
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
const round=n=>+n.toFixed(2);
const mean=xs=>xs.length?round(xs.reduce((a,b)=>a+b,0)/xs.length):null;
const median=xs=>{const a=xs.slice().sort((a,b)=>a-b),n=a.length;return n?round((a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2):null;};

// 同一种子的四英雄共享环境；按种子整组重采样，且保持两批种子各占一半。
function clusterInterval(batches){
  const rng=C.RNG(20261009),groups=batches.map(results=>{
    const seeds=[...new Set(results.map(r=>r.seed))];
    return seeds.map(seed=>results.filter(r=>r.seed===seed).filter(r=>r.outcome==='victory').length);
  });
  const rates=[];
  for(let i=0;i<20000;i++){
    let wins=0;for(const batch of groups)for(let j=0;j<batch.length;j++)wins+=batch[Math.floor(rng()*batch.length)];
    rates.push(wins*100/batches.flat().length);
  }
  rates.sort((a,b)=>a-b);return [round(rates[499]),round(rates[19499])];
}

const tiers={};
for(const id of Object.keys(C.DIFFICULTIES)){
  const compared=read(`difficulty-v1.13-${id}-comparison.json`);
  const fresh=read(`difficulty-v1.13-${id}-fresh.json`);
  const old=read(`difficulty-v1.12-${id}-holdout.json`);
  for(const batch of [compared,fresh]){
    assert.equal(batch.gameVersion,'1.13.0');assert.equal(batch.config.difficulty,id);
    assert.equal(batch.results.length,100);assert.equal(batch.config.scale,undefined);
    assert.deepEqual(batch.genes,old.genes);assert.deepEqual(batch.profile,old.profile);
    for(const hero of Object.keys(C.HEROES))assert.equal(batch.results.filter(r=>r.hero===hero).length,25);
    for(const r of batch.results){
      assert.equal(r.perZone.reduce((n,z)=>n+z.hits,0),r.hits);
      if(r.outcome==='victory'){assert.equal(r.combatRoomsCleared,21);assert.equal(r.shopVisits,4);assert.equal(r.bossDown,2);}
    }
  }
  assert.equal(compared.config.seedStart,51);assert.equal(fresh.config.seedStart,101);
  const results=[...compared.results,...fresh.results],wins=results.filter(r=>r.outcome==='victory');
  const paired={lost:0,gained:0,bothVictory:0,bothDefeat:0,invalid:0};
  for(const r of compared.results){
    const prev=old.results.find(p=>p.seed===r.seed&&p.hero===r.hero);assert(prev);
    if(!['victory','defeat'].includes(r.outcome))paired.invalid++;
    else if(prev.outcome==='victory'&&r.outcome==='victory')paired.bothVictory++;
    else if(prev.outcome==='defeat'&&r.outcome==='defeat')paired.bothDefeat++;
    else if(r.outcome==='victory')paired.gained++;else paired.lost++;
  }
  tiers[id]={profile:compared.profile,summary:summarize(results,compared.profile.target),
    clusterConfidence95:clusterInterval([compared.results,fresh.results]),
    comparison:{oldRate:old.summary.passRate,newRate:compared.summary.passRate,
      changePoints:round(compared.summary.passRate-old.summary.passRate),paired,
      oldVictoryMedianSeconds:median(old.results.filter(r=>r.outcome==='victory').map(r=>r.seconds)),
      newVictoryMedianSeconds:median(compared.results.filter(r=>r.outcome==='victory').map(r=>r.seconds))},
    freshSummary:fresh.summary,
    victory:{n:wins.length,meanSeconds:mean(wins.map(r=>r.seconds)),medianSeconds:median(wins.map(r=>r.seconds)),
      meanHits:mean(wins.map(r=>r.hits)),meanChips:mean(wins.map(r=>r.chips))},
    zones:C.ZONES.map((z,i)=>({zone:i+1,name:z.short,reached:results.filter(r=>r.perZone[i].reached).length,
      defeated:results.filter(r=>r.outcome==='defeat'&&r.zone===i+1).length,
      bossDefeated:results.filter(r=>r.outcome==='defeat'&&r.zone===i+1&&r.room==='boss').length,
      meanHitsWhenReached:mean(results.filter(r=>r.perZone[i].reached).map(r=>r.perZone[i].hits)),
      meanSecondsWhenReached:mean(results.filter(r=>r.perZone[i].reached).map(r=>r.perZone[i].seconds))})),
    invalid:results.filter(r=>!['victory','defeat'].includes(r.outcome))};
}
const report={date:'2026-10-09',gameVersion:'1.13.0',gameCommit:'c6b7fcd',genes:read('difficulty-v1.13-standard-fresh.json').genes,
  cohorts:[{seedStart:51,seedEnd:75,role:'comparison'},{seedStart:101,seedEnd:125,role:'fresh'}],
  bootstrap:{unit:'seed with all four heroes',stratified:true,replicates:20000,rngSeed:20261009},tiers};
fs.writeFileSync(path.join(dir,'difficulty-v1.13-summary.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
