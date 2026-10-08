'use strict';
const fs=require('node:fs');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const C=require('../js/core.js'),GAME=require('../js/game.js'),BOT=require('../js/bot.js');
const {spatialViolations}=require('./invariants.js');
const GENES={commit:30,trackK:3,sight:100,delay:10,dashSkip:0.6};
function scenarios(size=100,seedStart=1){return Array.from({length:size},(_,i)=>({hero:Object.keys(C.HEROES)[i%4],seed:seedStart+Math.floor(i/4)}));}
function run(spec,opts={}){
  const G=GAME.createGame({seed:spec.seed,headless:true,difficulty:opts.difficulty});
  if(opts.scale!=null)G.damageTuning=opts.scale;
  const bot=BOT.createBot(spec.seed,GENES);G.startRun(spec.hero);
  const perZone=C.ZONES.map((z,i)=>({zone:i+1,reached:false,bossReached:false,seconds:0,hits:0,combatRoomsCleared:0}));
  const cleared=new Set();
  let outcome='timeout',reason=null,frames=0,lastKey='',idle=0;
  for(;frames<1200*60;frames++){
    const area=perZone[G.zoneIdx],previousHits=G.damageTaken;
    area.reached=true;area.bossReached ||= G.isBossRoom;
    try{bot.update(G,1/60,G.input);G.update(1/60);}catch(e){outcome='error';reason=e.stack;break;}
    area.seconds+=1/60;area.hits+=G.damageTaken-previousHits;
    if(G.floor)for(const room of G.floor.rooms)if(room.kind==='combat'&&room.cleared){
      const key=[G.floor.zone,G.floor.level,room.id].join(':');
      if(!cleared.has(key)){cleared.add(key);perZone[G.floor.zone].combatRoomsCleared++;}
    }
    reason=spatialViolations(G)[0];if(reason){outcome='violation';break;}
    if(G.state==='victory'||G.state==='defeat'){outcome=G.state;break;}
    if(frames%60===59){
      const key=[G.zoneIdx,G.roomIdx,G.isBossRoom,G.isBossRoom?'boss':G.floor?.current,cleared.size,G.state,G.kills,G.damageTaken,G.wavIdx,G.pendSpawns.length,
        Math.round(G.enemies.reduce((sum,e)=>sum+Math.max(0,e.hp),0))].join(':');
      idle=key===lastKey?idle+1:0;lastKey=key;
      if(idle>=60){outcome='stall';reason='60s without combat/room/state progress';break;}
    }
  }
  return {...spec,outcome,seconds:+(Math.min(frames+1,1200*60)/60).toFixed(2),zone:G.zoneIdx+1,map:G.mapId,kills:G.kills,hits:G.damageTaken,
    floor:G.roomIdx+1,room:G.isBossRoom?'boss':G.floor?.rooms[G.floor.current].kind,
    combatRoomsCleared:cleared.size,shopVisits:G.shopVisits,chips:G.chips.length,
    perZone:perZone.map(z=>({...z,seconds:+z.seconds.toFixed(2)})),
    bossDown:Object.keys(G.bossDown).length,...(reason?{reason,player:{x:G.player.x,y:G.player.y,weapon:G.weapons[G.weaponSlot].id},
      enemies:G.enemies.filter(e=>!e.dead).map(e=>({type:e.type,x:e.x,y:e.y,hp:e.hp,state:e.state||e.st}))}:{})};
}
function summarize(results,target){
  const n=results.length,outcomes={};for(const r of results)outcomes[r.outcome]=(outcomes[r.outcome]||0)+1;
  const rate=(outcomes.victory||0)*100/n,invalid=results.filter(r=>!['victory','defeat'].includes(r.outcome)).length;
  const p=rate/100,z=1.96,den=1+z*z/n,mid=(p+z*z/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
  return {n,passRate:+rate.toFixed(2),target,confidence95:[+((mid-half)*100).toFixed(2),+((mid+half)*100).toFixed(2)],outcomes,invalid,perHero:Object.fromEntries(Object.keys(C.HEROES).map(id=>{
    const group=results.filter(r=>r.hero===id);return[id,group.length?+(100*group.filter(r=>r.outcome==='victory').length/group.length).toFixed(2):null];})),
    avgSeconds:+(results.reduce((sum,r)=>sum+r.seconds,0)/n).toFixed(2)};
}
async function batch(opts={}){
  const specs=scenarios(opts.size||100,opts.seedStart||1),workers=Math.min(opts.workers||4,specs.length);
  const groups=await Promise.all(Array.from({length:workers},(_,i)=>new Promise((resolve,reject)=>{
    const w=new Worker(__filename,{workerData:{specs:specs.filter((_,j)=>j%workers===i),opts}});
    w.on('message',resolve);w.on('error',reject);w.on('exit',code=>{if(code)reject(new Error('worker exit '+code));});
  })));
  return groups.flat().sort((a,b)=>a.seed-b.seed||a.hero.localeCompare(b.hero));
}
async function main(){
  const args=process.argv.slice(2),get=(flag,def)=>args.includes(flag)?args[args.indexOf(flag)+1]:def;
  const difficulty=get('--difficulty','standard');if(!Object.hasOwn(C.DIFFICULTIES,difficulty))throw new Error('Unknown difficulty');
  const opts={difficulty,size:Number(get('--size',100)),seedStart:Number(get('--seed-start',1)),workers:Number(get('--workers',4))};
  for(const key of ['size','seedStart','workers'])if(!Number.isInteger(opts[key])||opts[key]<1)throw new Error('Invalid '+key);
  if(args.includes('--scale')){opts.scale=Number(get('--scale'));if(!Number.isFinite(opts.scale)||opts.scale<=0)throw new Error('Invalid scale');}
  const results=await batch(opts),summary=summarize(results,C.DIFFICULTIES[difficulty].target);
  console.log(JSON.stringify({opts,summary,invalid:results.filter(r=>!['victory','defeat'].includes(r.outcome))}));
  const out=get('--out');if(out){fs.mkdirSync(require('node:path').dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({gameVersion:require('../package.json').version,genes:GENES,config:opts,profile:C.DIFFICULTIES[difficulty],summary,results},null,2)+'\n');}
  const meetsTarget=args.includes('--holdout') ? summary.confidence95[0]<=summary.target&&summary.target<=summary.confidence95[1] :
    Math.abs(summary.passRate-summary.target)<=Number(get('--tolerance',5));
  if(summary.invalid||(args.includes('--verify')&&!meetsTarget))process.exitCode=1;
}
if(!isMainThread)parentPort.postMessage(workerData.specs.map(spec=>run(spec,workerData.opts)));
else if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={GENES,scenarios,run,summarize,batch};
