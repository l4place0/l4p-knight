'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const GROUPS = ['weapons','heroes','enemies','bosses','difficulty','chips','synergies','player','progression','zones','maps','daily'];

// Dependency-free validator for the documented JSON Schema subset used by this project.
function validate(value, schema, at = 'config') {
  const fail = message => { throw new Error(at + ': ' + message); };
  if (schema.anyOf) {
    if (!schema.anyOf.some(s => { try {validate(value,s,at); return true;} catch {return false;} })) fail('does not match an allowed definition');
    return;
  }
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (schema.type === 'integer' ? !Number.isInteger(value) : type !== schema.type) fail('expected ' + schema.type);
  if (schema.enum && !schema.enum.includes(value)) fail('unsupported value');
  if (type === 'number') {
    if (!Number.isFinite(value)) fail('must be finite');
    if (schema.minimum !== undefined && value < schema.minimum) fail('below minimum ' + schema.minimum);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fail('must exceed ' + schema.exclusiveMinimum);
    if (schema.maximum !== undefined && value > schema.maximum) fail('above maximum ' + schema.maximum);
  }
  if (type === 'string' && schema.minLength && value.length < schema.minLength) fail('empty string');
  if (type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value,key)) fail('missing ' + key);
    for (const [key, item] of Object.entries(value)) {
      const child = schema.properties?.[key] ?? schema.additionalProperties;
      if (child === false || child === undefined) fail('unknown field ' + key);
      if (child !== true) validate(item,child,at + '.' + key);
    }
  }
  if (type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail('too few entries');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail('too many entries');
    value.forEach((item,i) => validate(item,schema.items,at + '[' + i + ']'));
  }
}
function validateConfig(data, configDir = path.join(ROOT,'config')) {
  for (const name of GROUPS) validate(data[name],JSON.parse(fs.readFileSync(path.join(configDir,'schemas',name+'.schema.json'),'utf8')),name);
  const need = (condition, message) => { if (!condition) throw new Error(message); };
  for(const id of ['smg','shotgun','railgun','blade','homing','grenade']) need(data.weapons[id],'Missing required weapon: '+id);
  need(data.heroes.vanguard,'Missing default hero: vanguard');
  need(data.difficulty.profiles.standard,'Missing default difficulty: standard');
  for (const [id,w] of Object.entries(data.weapons)) {
    need(w.id===id, 'Weapon id mismatch: '+id);
    need(['gun','rail','melee'].includes(w.type),'Unknown weapon type: '+id);
    if(w.kind)need(['homing','grenade'].includes(w.kind),'Unknown projectile kind: '+id);
    if(w.type==='gun')need(w.speed>0,'Gun requires positive projectile speed: '+id);
    if(w.type==='rail')need(w.charge>0,'Rail requires positive charge: '+id);
    if(w.type==='melee')need(w.arc>0,'Melee requires positive arc: '+id);
  }
  for (const [id,h] of Object.entries(data.heroes)) need(h.id===id && data.weapons[h.weapon], 'Hero weapon/id: '+id);
  for (const table of ['chips','synergies','daily']) need(new Set(data[table].map(x=>x.id)).size===data[table].length,'Duplicate id: '+table);
  for (const syn of data.synergies) for (const id of syn.need) need(data.chips.some(c=>c.id===id),'Unknown synergy chip: '+id);
  const attacks = new Set(['ring','fan','fanlaser','mines','spiral','clones','gravity','blinkstorm']);
  for (const id of ['boss','boss2']) {
    const boss=data.enemies[id]; need(boss?.isBoss && boss.phases.length===3,'Missing boss phases: '+id);
    for (const phase of [1,2,3]) need(boss.pools[phase]?.length && boss.pools[phase].every(a=>attacks.has(a)),'Unknown boss attack: '+id);
  }
  need(data.zones.length===data.difficulty.curve.routeDamage.length,'Zone/route curve length mismatch');
  for (const z of data.zones) {
    for (const id of z.maps) need(data.maps[id], 'Unknown map: '+id);
    for (const id of Object.keys(z.weights)) need(data.enemies[id] && !data.enemies[id].isBoss,'Unknown ordinary enemy: '+id);
    if(z.bossId) need(data.enemies[z.bossId]?.isBoss,'Unknown zone boss: '+z.bossId);
  }
  for (const [id,rows] of Object.entries(data.maps)) need(rows.length===17 && rows.every(r=>r.length===30 && r[0]==='#' && r.at(-1)==='#') && /^#+$/.test(rows[0]) && /^#+$/.test(rows.at(-1)), 'Invalid map boundary: '+id);
  for (const id of data.progression.shop.weaponPool) need(data.weapons[id],'Unknown shop weapon: '+id);
  need(data.progression.shop.weaponPool.length>=2,'Shop requires at least two weapons');
  need(data.progression.rating.sTime < data.progression.rating.aTime,'Rating time order');
  need(data.progression.rating.sHits <= data.progression.rating.aHits,'Rating damage order');
  need(data.player.stats.shieldDelay>0 && data.player.stats.rate>0,'Stats rate/shield delay must be positive');
  return data;
}
function freeze(data) { if(data && typeof data==='object') {Object.values(data).forEach(freeze); Object.freeze(data);} return data; }
function loadConfig(configDir = path.join(ROOT,'config')) {
  const data={};
  for(const name of GROUPS) data[name]=JSON.parse(fs.readFileSync(path.join(configDir,name+'.json'),'utf8'));
  validateConfig(data,configDir);
  data.hash=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return freeze(data);
}
function browserSource(data=loadConfig()) {
  return '// Generated from config/*.json by npm run config:generate; do not edit.\n(function(root){\n"use strict";\nconst data = '+JSON.stringify(data)+';\nfunction freeze(v){if(v && typeof v === "object"){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}\nroot.ZERO_CONFIG = freeze(data);\n})(globalThis);\n';
}
function generate(check=false) {
  const data=loadConfig(), file=path.join(ROOT,'generated/config.js'),source=browserSource(data);
  if(check) {
    if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==source) throw new Error('Browser config is missing/stale: run npm run config:generate');
  } else {fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);}
  console.log('Configuration '+(check?'verified':'generated')+' · sha256 '+data.hash);
  return data;
}
module.exports={GROUPS,validate,validateConfig,loadConfig,browserSource,generate};
if(require.main===module) {try {generate(process.argv.includes('--check'));} catch(e) {console.error(e.message);process.exitCode=1;}}
