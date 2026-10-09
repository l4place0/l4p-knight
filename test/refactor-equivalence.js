'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {loadMechanics}=require('./load-mechanics.js');
const old=loadMechanics(null,'5d189a7'),current=loadMechanics();
const plain=value=>typeof value==='function'?undefined:JSON.parse(JSON.stringify(value));
for(const key of Object.keys(old.CORE))assert.deepEqual(plain(current.CORE[key]),plain(old.CORE[key]),'Core data '+key);
function digest(G) {
  const seen=new WeakMap();let next=0;
  return crypto.createHash('sha256').update(JSON.stringify(G,(key,value)=>{
    if(key==='configuration')return undefined;
    if(value && typeof value==='object') {
      if(seen.has(value))return {$ref:seen.get(value)};
      seen.set(value,next++);
    }
    return value;
  })).digest('hex');
}
let total=0;
for(const hero of Object.keys(current.CORE.HEROES)) {
  const games=[old,current].map(env=>{const G=env.GAME.createGame({seed:1979,headless:true});G.startRun(hero);return {G,bot:env.BOT.createBot(1979)};});
  for(let frame=0;frame<72000;frame++) {
    for(const {G,bot} of games){bot.update(G,1/60,G.input);G.update(1/60);}
    assert.equal(digest(games[1].G),digest(games[0].G),hero+' frame '+frame);total++;
    if(['victory','defeat'].includes(games[0].G.state))break;
    if(frame===71999)throw new Error(hero+' did not reach a terminal state');
  }
  console.log('Equivalent: '+hero+' · '+games[0].G.state+' · '+games[0].G.kills+' kills');
}
console.log('PASS: baseline 5d189a7 and migrated version match for '+total+' individual frames.');
