/* 普通战斗房标定：每房 1 batch=100 场景（4 英雄 × 25 种子）。
 * node test/enemy-balance.js --room all --workers 4
 * node test/enemy-balance.js --room z1a --try hpMul=1.6,speedMul=1.4,aggression=2,dmgMul=2
 * --original 原始小怪；--perfect 完美 bot；--seed-start 26 留出验证；--out <报告路径>
 * --verify 要求每房通过率 <37%、至少一局通关、无超时/停滞/异常/碰撞违规，失败退出 1。
 * 开局满生命/护盾，按区域配置期望构筑；保留真实波次/刷怪/补给，清房即结束，不进入导航。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const CORE = require('../js/core.js');
const GAME = require('../js/game.js');
const BOT = require('../js/bot.js');
const { spatialViolations } = require('./invariants.js');
const DT = 1 / 60, ROOM_CAP = 180, STALL_SECONDS = 30;
const GENES = { commit: 30, trackK: 3, sight: 100, delay: 10, dashSkip: 0.6 };
const ORIGINAL = { hpMul: 1, speedMul: 1, aggression: 1, bulletMul: 1, densityMul: 1, dmgMul: 1 };
const BUILDS = {
  1: { chips: [], power: 0, shield: 0 },
  2: { chips: ['overcharge', 'servo'], power: 0.08, shield: 0 },
  3: { chips: ['overcharge', 'servo', 'crit', 'capacitor'], power: 0.16, shield: 1 },
  4: { chips: ['overcharge', 'servo', 'crit', 'capacitor', 'pierce', 'nano'], power: 0.24, shield: 2 },
};
const round = n => +n.toFixed(2);
function enumerate(room, size, seedStart) {
  const heroes = Object.keys(CORE.HEROES), specs = [];
  for (const zone of CORE.ZONES) for (const [ri, mapId] of zone.maps.entries()) {
    if (room !== 'all' && room !== mapId) continue;
    for (let i = 0; i < size; i++) specs.push({ mapId, zone: zone.idx, room: ri + 1,
      hero: heroes[i % heroes.length], seed: seedStart + Math.floor(i / heroes.length) });
  }
  if (!specs.length) throw new Error('未知普通战斗房：' + room);
  return specs;
}
function invariant(G) {
  return spatialViolations(G)[0] || null;
}
function runScenario(spec, opts) {
  const G = GAME.createGame({ seed: spec.seed, headless: true });
  const bot = BOT.createBot(spec.seed, opts.perfect ? null : GENES);
  G.enemyTuning = opts.original ? ORIGINAL : opts.tuning;
  G.startRun(spec.hero); G.debugJump(spec.zone, spec.room);
  if (opts.weapon) {
    G.weapons[0] = CORE.WEAPONS[opts.weapon];
    G.pickups = G.pickups.filter(p => p.kind !== 'crate');
  }
  const build = BUILDS[spec.zone];
  G.chips.push(...build.chips); G.powerBonus = build.power; G.bonusShield = build.shield;
  G.computeStats(); G.player.hp = G.player.maxHp; G.player.shield = G.player.maxShield;
  let frames = 0, outcome = 'timeout', reason = null, stall = 0, previousProgress = null;
  for (; frames < ROOM_CAP * 60; frames++) {
    try { bot.update(G, DT, G.input); G.update(DT); }
    catch (e) { outcome = 'error'; reason = String(e.stack); break; }
    reason = invariant(G);
    if (reason) { outcome = 'violation'; break; }
    if (G.state === 'defeat') { outcome = 'defeat'; break; }
    if (G.chipOffered) { outcome = 'clear'; break; }
    if (frames % 60 === 59) {
      const enemies = G.enemies.filter(e => !e.dead);
      const progress = [G.kills, G.damageTaken, G.wavIdx, G.pendSpawns.length,
        round(enemies.reduce((sum, e) => sum + Math.max(0, e.hp), 0))].join(':');
      stall = enemies.length && progress === previousProgress ? stall + 1 : 0;
      previousProgress = progress;
      if (stall >= STALL_SECONDS) { outcome = 'stall'; break; }
    }
  }
  return { ...spec, outcome, seconds: round((frames + (outcome === 'timeout' ? 0 : 1)) * DT),
    hits: G.damageTaken, hpEnd: round(G.player.hp), shieldEnd: round(G.player.shield), kills: G.kills,
    ...(reason ? { reason } : {}) };
}
function summarize(results) {
  const n = results.length, outcomes = {};
  for (const r of results) outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1;
  const passRate = (outcomes.clear || 0) / n * 100;
  const invalid = results.filter(r => r.outcome !== 'clear' && r.outcome !== 'defeat').length;
  const perHero = {};
  for (const hero of Object.keys(CORE.HEROES)) {
    const group = results.filter(r => r.hero === hero);
    if (group.length) perHero[hero] = round(group.filter(r => r.outcome === 'clear').length / group.length * 100);
  }
  return { n, passRate: round(passRate), outcomes, invalid, perHero,
    avgSeconds: round(results.reduce((sum,r) => sum+r.seconds,0)/n),
    avgHits: round(results.reduce((sum,r) => sum+r.hits,0)/n),
    qualified: passRate > 0 && passRate < 37 && invalid === 0 };
}
async function batch(specs, opts, workers) {
  const n = Math.min(workers, specs.length);
  const chunks = Array.from({length:n},(_,i) => specs.filter((_,j) => j%n === i));
  const groups = await Promise.all(chunks.map(specs => new Promise((resolve,reject) => {
    const worker = new Worker(__filename,{workerData:{specs,opts}});
    worker.on('message',resolve); worker.on('error',reject);
    worker.on('exit',code => { if(code) reject(new Error('worker exit '+code)); });
  })));
  return groups.flat().sort((a,b) => a.mapId.localeCompare(b.mapId) || a.seed-b.seed || a.hero.localeCompare(b.hero));
}
function parseArgs(args) {
  const opts = { room:'all', size:100, seedStart:1, workers:4, tuning:null, original:false, perfect:false, verify:false, out:null };
  const values = {'--room':'room','--size':'size','--seed-start':'seedStart','--workers':'workers','--out':'out'};
  for(let i=0;i<args.length;i++) {
    const a=args[i];
    if(values[a]) { if(!args[i+1] || args[i+1].startsWith('--')) throw new Error('缺少参数：'+a); opts[values[a]]=args[++i]; }
    else if(a==='--original') opts.original=true;
    else if(a==='--perfect') opts.perfect=true;
    else if(a==='--verify') opts.verify=true;
    else if(a==='--try') {
      const text=args[++i]; if(!text) throw new Error('--try 缺少配置'); opts.tuning={};
      for(const pair of text.split(',')) {
        const [key,value]=pair.split('='); const number=Number(value);
        if(!(key in ORIGINAL) || !Number.isFinite(number) || number<=0) throw new Error('无效倍率：'+pair);
        opts.tuning[key]=number;
      }
    } else throw new Error('未知参数：'+a);
  }
  for(const key of ['size','seedStart','workers']) {
    opts[key]=Number(opts[key]); if(!Number.isSafeInteger(opts[key]) || opts[key]<1) throw new Error(key+' 必须为正整数');
  }
  if(opts.original && opts.tuning) throw new Error('--original 与 --try 不可并用');
  return opts;
}
async function main() {
  const opts=parseArgs(process.argv.slice(2)); const specs=enumerate(opts.room,opts.size,opts.seedStart);
  const results=await batch(specs,opts,opts.workers), rooms={};
  for(const mapId of [...new Set(specs.map(s=>s.mapId))]) {
    rooms[mapId]=summarize(results.filter(r=>r.mapId===mapId));
    console.log(mapId+' '+JSON.stringify(rooms[mapId]));
  }
  if(opts.out) {
    const file=path.resolve(opts.out); fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,JSON.stringify({config:opts,genes:opts.perfect?null:GENES,difficulty:CORE.ENEMY_DIFF,rooms,results},null,2)+'\n');
  }
  if(opts.verify && Object.values(rooms).some(r=>!r.qualified)) process.exitCode=1;
  if(results.some(r=>!['clear','defeat'].includes(r.outcome))) process.exitCode=1;
}
if(!isMainThread) parentPort.postMessage(workerData.specs.map(s=>runScenario(s,workerData.opts)));
else if(require.main===module) main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={GENES,ORIGINAL,BUILDS,enumerate,invariant,runScenario,summarize,batch};
