'use strict';
// Baseline schemas are committed and edited explicitly when the configuration contract changes.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const {GROUPS}=require('../../scripts/config.cjs');
function infer(v,key='') {
  if(Array.isArray(v)) {
    const unique=[...new Map(v.map(x=>{const s=infer(x);if(x?.id)s.properties.id.enum=[x.id];return[JSON.stringify(s),s];})).values()];
    return {type:'array',minItems:v.length?1:0,items:unique.length===1?unique[0]:{anyOf:unique}};
  }
  if(v!==null&&typeof v==='object')return {type:'object',properties:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,infer(x,k)])),required:Object.keys(v),additionalProperties:false};
  if(typeof v==='number') {
    const s={type:/^(pellets|tier|rarity|extraEnemies|base|zone|floor|extraItems|heroZero|chipSlot|sHits|aHits|idx)$/.test(key)?'integer':'number',minimum:0};
    if(/^(hp|maxHp|r|mass|interval|rate|shieldDelay|moveSpeed|moveResponse|dashSpeed|chipUpgradeMultiplier|aggression|bulletMul|densityMul|dmgMul|hpMul|speedMul|enemyHp|damageScale)$/.test(key)) {delete s.minimum;s.exclusiveMinimum=0;}
    if(/chance|probability|discount|reduction|floor$/i.test(key)&&!['floor','sTime','aTime'].includes(key))s.maximum=1;
    if(key==='target')s.maximum=100;
    return s;
  }
  return {type:typeof v,...(typeof v==='string'?{minLength:1}:{})};
}
fs.mkdirSync(path.join(root,'config/schemas'),{recursive:true});
for(const group of GROUPS) {
  const value=JSON.parse(fs.readFileSync(path.join(root,'config',group+'.json'),'utf8'));
  const schema=infer(value);
  if(['weapons','heroes'].includes(group)) {
    const shapes=Object.values(schema.properties); shapes.forEach(s=>{s.required=s.required.filter(k=>!['charge','arc','kind','bulletLife','bulletR','blastDmg'].includes(k));});
    schema.properties={};schema.required=[];schema.additionalProperties={anyOf:shapes};
  }
  fs.writeFileSync(path.join(root,'config/schemas',group+'.schema.json'),JSON.stringify({$schema:'https://json-schema.org/draft/2020-12/schema',title:group,...schema},null,2)+'\n');
}
