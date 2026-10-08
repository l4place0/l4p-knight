'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const C=require('../js/core.js');
const {summarize,summarizeCurve}=require('./difficulty-balance.js');
const dir=path.join(__dirname,'../docs/balance');
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
const tiers={};
for(const id of Object.keys(C.DIFFICULTIES)){
  const calibration=read(`difficulty-v1.14-${id}-calibration.json`),holdout=read(`difficulty-v1.14-${id}-holdout.json`);
  for(const data of [calibration,holdout]){
    assert.equal(data.gameVersion,'1.14.0');assert.deepEqual(data.profile,C.DIFFICULTIES[id]);
    assert.deepEqual(data.curve,C.DIFFICULTY_CURVE);assert.equal(data.config.curve,undefined);assert.equal(data.config.scale,undefined);
    const summary=summarize(data.results,C.DIFFICULTIES[id].target);assert.equal(summary.invalid,0);
    assert.deepEqual(summary,data.summary);
    const stages=summarizeCurve(data.results);assert.deepEqual(stages,data.stages);
    assert.equal(stages.route.deaths+stages.boss.deaths,data.results.filter(r=>r.outcome==='defeat').length);
    for(const r of data.results)if(r.outcome==='victory'){
      assert.equal(r.combatRoomsCleared,21);assert.equal(r.shopVisits,4);assert.equal(r.bossDown,2);
    }
  }
  assert.equal(calibration.results.length,100);assert.equal(calibration.config.seedStart,1);
  assert.equal(holdout.results.length,200);assert.equal(holdout.config.seedStart,501);
  assert(Math.abs(calibration.summary.passRate-calibration.summary.target)<=5,'Calibration missed target');
  assert(holdout.summary.confidence95[0]<=holdout.summary.target&&holdout.summary.target<=holdout.summary.confidence95[1],'Holdout missed target');
  const oldResults=['comparison','fresh'].flatMap(group=>read(`difficulty-v1.13-${id}-${group}.json`).results);
  const oldStages=summarizeCurve(oldResults);
  const gap=+(Math.abs(holdout.stages.route.deathRate-holdout.stages.boss.deathRate)).toFixed(2);
  assert(gap<=5,'Route/Boss conditional risk gap exceeds five percentage points');
  const wins=holdout.results.filter(r=>r.outcome==='victory').map(r=>r.seconds).sort((a,b)=>a-b);
  const n=wins.length,median=n?(wins[Math.floor((n-1)/2)]+wins[Math.floor(n/2)])/2:null;
  tiers[id]={profile:holdout.profile,calibration:calibration.summary,holdout:holdout.summary,
    stages:holdout.stages,routeBossGapPoints:gap,
    old:{summary:summarize(oldResults,C.DIFFICULTIES[id].target),stages:oldStages},
    victoryMedianSeconds:median==null?null:+median.toFixed(2),maxSeconds:Math.max(...holdout.results.map(r=>r.seconds))};
}
const out={date:'2026-10-09',gameVersion:'1.14.0',curve:C.DIFFICULTY_CURVE,
  calibrationSeeds:[1,25],holdoutSeeds:[501,550],tiers};
fs.writeFileSync(path.join(dir,'difficulty-v1.14-summary.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out,null,2));
