'use strict';
// 只寻找真实数值的可达性见证；按英雄遇到首胜即停，不能当作胜率估计。
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs');
const {simulateRun}=require('./lib.js');
if(!isMainThread) {
  const outcomes={};
  for(let seed=1;seed<=workerData.limit;seed++) {
    const r=simulateRun(seed,{hero:workerData.hero,perfectBot:true,quiet:true});
    outcomes[r.outcome]=(outcomes[r.outcome]||0)+1;
    if(r.ok) {parentPort.postMessage({done:true,hero:workerData.hero,seed,seconds:r.victoryAt,outcomes,
      phases:r.stats.bossPhasesSeen,shops:r.G.shopVisits,kills:r.G.kills,
      violations:r.stats.boundsViolations+r.stats.wallClipViolations+r.stats.nanViolations});break;}
    if(seed%250===0)parentPort.postMessage({hero:workerData.hero,scanned:seed});
    if(seed===workerData.limit)parentPort.postMessage({done:true,hero:workerData.hero,seed:null,outcomes});
  }
} else {
  const C=require('../src/core.js'),limit=Number(process.argv[2]||10000);
  const any=process.argv.includes('--any'),workers=[];
  const tasks=Object.keys(C.HEROES).map(hero=>new Promise((resolve,reject)=>{
    const w=new Worker(__filename,{workerData:{hero,limit}});
    workers.push(w);
    w.on('message',r=>{console.log(JSON.stringify(r));if(r.done){if(any&&!r.seed)reject(new Error(hero+' 无胜局'));else resolve(r);}});w.on('error',reject);
    w.on('exit',code=>{if(code)reject(new Error('worker exit '+code));});
  }));
  (any?Promise.any(tasks).then(r=>[r]):Promise.all(tasks)).then(async results=>{
    fs.writeFileSync('docs/balance/hero-flow-v1.11.json',JSON.stringify({difficulty:C.ENEMY_DIFF,heroes:C.HEROES,weapons:C.WEAPONS,
      sampling:any?'四英雄并行顺序搜索，发现任一真实首胜就停；只作存在性见证，不能估计整局胜率':'每英雄顺序搜索首个真实胜局，只是存在性见证，不能估计整局胜率',limit,results},null,2)+'\n');
    if(any)await Promise.allSettled(workers.map(w=>w.terminate()));
    if(results.some(r=>!r.seed||r.violations))process.exitCode=1;
  }).catch(e=>{console.error(e.stack);process.exitCode=1;});
}
