'use strict';
const fs=require('node:fs'),path=require('node:path');
const {batch,summarize,summarizeCurve}=require('./difficulty-balance.js');
const C=require('../js/core.js');
(async()=>{
  const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  for(const [i,candidate] of config.candidates.entries()){
    const opts={difficulty:candidate.difficulty||'standard',size:config.size||40,seedStart:config.seedStart||1,workers:config.workers||4,curve:candidate.curve};
    const results=await batch(opts),summary=summarize(results,C.DIFFICULTIES[opts.difficulty].target),stages=summarizeCurve(results);
    const data={name:candidate.name,opts,summary,stages,results};
    const out=path.join(config.out||'test/art-preview/curve-probes',candidate.name+'.json');
    fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(data,null,2)+'\n');
    console.log(JSON.stringify({index:i,name:candidate.name,summary,stages}));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
