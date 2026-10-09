'use strict';
// One-off, reviewable migration; source expressions are evaluated only from the trusted local baseline.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
process.chdir(root);
const read = p => fs.readFileSync(p, 'utf8');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, s); };
const json = (p, v) => write(p, JSON.stringify(v, null, 2) + '\n');
const C = require('../../js/core.js');
let core = read('js/core.js');
function replaceDeclaration(name, expression) {
  const re = new RegExp('const ' + name + ' = [\\s\\S]*?\\n(?:};|\\];)');
  if (!re.test(core)) throw new Error('Missing declaration ' + name);
  core = core.replace(re, 'const ' + name + ' = ' + expression + ';');
}
for (const [file, name] of [['weapons','WEAPONS'],['heroes','HEROES'],['enemies','ENEMY_DEFS'],['zones','ZONES'],['maps','MAPS'],['daily','DAILY_MODIFIERS']]) {
  json('config/' + file + '.json', C[name]);
  replaceDeclaration(name, 'CONFIG.' + file);
}
json('config/difficulty.json', {enemies:C.ENEMY_DIFF, profiles:C.DIFFICULTIES, curve:C.DIFFICULTY_CURVE});
replaceDeclaration('ENEMY_DIFF','CONFIG.difficulty.enemies');
replaceDeclaration('DIFFICULTIES','CONFIG.difficulty.profiles');
replaceDeclaration('DIFFICULTY_CURVE','CONFIG.difficulty.curve');
replaceDeclaration('BOSS_PHASES',"CONFIG.enemies.boss.phases");
replaceDeclaration('BOSS2_PHASES',"CONFIG.enemies.boss2.phases");
const bossSource = read('js/game/bosses.js');
const bossExpr = bossSource.match(/const BOSS_DIFF = ([\s\S]*?\n  });/)[1];
json('config/bosses.json', vm.runInNewContext('(' + bossExpr + ')'));
write('js/game/bosses.js', bossSource.replace(/const BOSS_DIFF = [\s\S]*?\n  };/,'const BOSS_DIFF = C.CONFIG.bosses;'));
const chipKeys = [
 ['damage'],['rate'],['projectiles','damagePenalty'],[],['bounces'],['damage','healthPenalty'],
 ['probabilityCap','healChance'],['duration'],['delayFloor','delayBase','delayReduction'],['meleeDamage','meleeRange'],
 ['critChance','critMultiplier'],['speed','cooldownFloor','cooldownBase','cooldownReduction'],['spreadFloor','spreadBase','spreadReduction'],
 ['damageCap','damage'],['enabled'],['enabled'],['enabled'],['enabled'],['damageCap','damage']
];
const synKeys = [['rate','damage'],['projectiles'],[],[],[],['damage','meleeDamage'],['railMultiplier','explosionRadius'],['enabled'],['enabled'],['damage']];
for (const [name, table, keys] of [['CHIPS','chips',chipKeys],['SYNERGIES','synergies',synKeys]]) {
  const config = [];
  const funcs = [];
  C[name].forEach((entry, i) => {
    const {apply, ...data} = entry;
    const params = {}; let at = 0;
    let code = apply.toString().replace(/\b\d+(?:\.\d+)?\b/g, n => {
      const key = keys[i][at++]; if (!key) throw new Error('Parameter keys ' + entry.id);
      params[key] = Number(n); return 'CONFIG.' + table + '[' + i + '].params.' + key;
    });
    if (at !== keys[i].length) throw new Error('Parameter count ' + entry.id);
    config.push({...data, params}); funcs.push('  ' + entry.id + ': ' + code);
  });
  json('config/' + table + '.json', config);
  const registry = 'const ' + name + '_EFFECTS = {\n' + funcs.join(',\n') + '\n};\nconst ' + name + ' = CONFIG.' + table + '.map(({params, ...entry}) => ({...entry, apply: ' + name + '_EFFECTS[entry.id]}));';
  core = core.replace(new RegExp('const ' + name + ' = \\[[\\s\\S]*?\\n\\];'), registry);
}
const playerSource=read('js/game/player.js');
const statsExpr=playerSource.match(/const s = ({[\s\S]*?\n    });/)[1];
json('config/player.json', {stats:vm.runInNewContext('(' + statsExpr + ')'),radius:5,minHealth:2,moveSpeed:96,moveResponse:13,
  shieldDelay:2.6,shieldRegen:1.4,dashDuration:0.16,dashCooldown:0.9,dashInvulnerability:0.24,dashSpeed:345,
  hurtInvulnerability:0.9,undyingInvulnerability:1.6,killSpeedMultiplier:1.3,comboCap:25,comboDamage:0.02});
json('config/progression.json', {budget:{base:3,zone:2,floor:2},combatCrateChance:0.2,clearHeartChance:4/7,chipUpgradeMultiplier:1.5,
  shop:{prices:{heal:6,chip:12,battery:10,weapon:10,power:14},heal:2,shield:1,power:0.08,sale:0.7,luckyDiscount:0.15,maxLuckyDiscount:0.5,extraItems:2,weaponPool:['smg','shotgun','railgun','homing','grenade']},
  rating:{sTime:300,sHits:6,aTime:420,aHits:12},unlocks:{heroZero:1,chipSlot:3}});
core=core.replace("'use strict';", "'use strict';\n\n// JSON is authoritative; the browser receives the same validated data as generated JS.\nconst CONFIG = typeof module !== 'undefined' && module.exports\n  ? require('../scripts/config.cjs').loadConfig() : root.ZERO_CONFIG;\nif (!CONFIG) throw new Error('Missing configuration: run npm run config:generate');");
core=core.replace('  WEAPONS, ENEMY_DEFS,','  CONFIG, WEAPONS, ENEMY_DEFS,');
write('js/core.js',core);
fs.renameSync('js','src');
fs.mkdirSync('scripts',{recursive:true}); fs.renameSync('test/serve.js','scripts/serve.js');
function files(dir) {return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for (const file of [...files('src'),...files('test'),...files('assets')].filter(p=>/\.(js|html|md)$/.test(p))) {
  let s=read(file).replace(/\bjs\//g,'src/').replace(/(['"])js\1/g,'$1src$1');
  // References to historical objects must retain historical paths.
  s=s.replace(/([0-9a-f]{7,40}):src\//g,'$1:js/');
  if (/\.html$/.test(file)) s=s.replace(/(<script\b[^>]*src="[^"\n]*)(src\/core\.js"[^>]*><\/script>)/g,
    (all,prefix,tail)=>prefix+tail.replace('src/core.js','generated/config.js')+'\n'+all);
  write(file,s);
}
write('index.html',read('index.html').replace('<script src="js/core.js">','<script src="generated/config.js"></script>\n<script src="src/core.js">').replace(/\bjs\//g,'src/'));
let structure=read('test/structure.check.js').replace('const SCRIPT_ORDER = [','const SCRIPT_ORDER = [\n  \'generated/config.js\','); write('test/structure.check.js',structure);
let loader=read('test/load-mechanics.js').replace('  for (const file of FILES) {',
  "  if (!ref) world.ZERO_CONFIG = require('../scripts/config.cjs').loadConfig();\n  for (const file of FILES) {\n    const historicalFile = file.replace(/^src\\//, 'js/');");
loader=loader.replace("ref+':'+file","ref+':'+historicalFile"); write('test/load-mechanics.js',loader);
let renderTest=read('test/render-file.test.js').replace('console, URL, Image, document:',"console, URL, Image, ZERO_CONFIG: require('../scripts/config.cjs').loadConfig(), document:"); write('test/render-file.test.js',renderTest);
let player=read('src/game/player.js').replace(/const s = {[\s\S]*?\n    };/,'const s = {...C.CONFIG.player.stats};');
const replacements=[['Math.pow(1.5, lv)','Math.pow(C.CONFIG.progression.chipUpgradeMultiplier, lv)'],['s.dmg += 0.22 *','s.dmg += C.CONFIG.chips.find(c => c.id === \'split\').params.damagePenalty *'],['Math.max(2, H.maxHp','Math.max(C.CONFIG.player.minHealth, H.maxHp'],['ky: 0, r: 5','ky: 0, r: C.CONFIG.player.radius'],['Math.min(G.combo, 25) * 0.02','Math.min(G.combo, C.CONFIG.player.comboCap) * C.CONFIG.player.comboDamage'],['P.iframes = 1.6','P.iframes = C.CONFIG.player.undyingInvulnerability'],['P.iframes = 0.9','P.iframes = C.CONFIG.player.hurtInvulnerability'],['2.6 * s.shieldDelay','C.CONFIG.player.shieldDelay * s.shieldDelay'],['P.shield + 1.4 * dt','P.shield + C.CONFIG.player.shieldRegen * dt'],['P.dashT = 0.16','P.dashT = C.CONFIG.player.dashDuration'],['0.9 * s.dashCd','C.CONFIG.player.dashCooldown * s.dashCd'],['Math.max(P.iframes, 0.24)','Math.max(P.iframes, C.CONFIG.player.dashInvulnerability)'],['const spd = 96 *','const spd = C.CONFIG.player.moveSpeed *'],['G.killSpeedT > 0 ? 1.3 : 1','G.killSpeedT > 0 ? C.CONFIG.player.killSpeedMultiplier : 1'],['* 345','* C.CONFIG.player.dashSpeed'],['Math.exp(-13 * dt)','Math.exp(-C.CONFIG.player.moveResponse * dt)']];
for(const [from,to] of replacements) {if(!player.includes(from))throw new Error(from); player=player.split(from).join(to);} write('src/game/player.js',player);
let rooms=read('src/game/rooms.js').replace('  const rng = ctx.rng;','  const rng = ctx.rng;\n  const progression = C.CONFIG.progression, shop = progression.shop;');
const roomReplacements=[['t < 300 && G.damageTaken <= 6','t < progression.rating.sTime && G.damageTaken <= progression.rating.sHits'],['t < 420 && G.damageTaken <= 12','t < progression.rating.aTime && G.damageTaken <= progression.rating.aHits'],['3 + (G.zoneIdx + 1) * 2 + G.roomIdx * 2','progression.budget.base + (G.zoneIdx + 1) * progression.budget.zone + G.roomIdx * progression.budget.floor'],['rng.chance(0.2)','rng.chance(progression.combatCrateChance)'],['rng.chance(4 / 7)','rng.chance(progression.clearHeartChance)'],['Math.min(0.5, 0.15 *','Math.min(shop.maxLuckyDiscount, shop.luckyDiscount *'],['disc *= 0.7','disc *= shop.sale'],['i < 2; i++','i < shop.extraItems; i++'],["rng.pick(['smg', 'shotgun', 'railgun', 'homing', 'grenade'].filter",'rng.pick(shop.weaponPool.filter'],['G.player.hp + 2','G.player.hp + shop.heal'],['(G.bonusShield || 0) + 1','(G.bonusShield || 0) + shop.shield'],['(G.powerBonus || 0) + 0.08','(G.powerBonus || 0) + shop.power']];
for(const [from,to] of roomReplacements) {if(!rooms.includes(from))throw new Error(from); rooms=rooms.split(from).join(to);}
rooms=rooms.replace('price: P(6)','price: P(shop.prices.heal)').replace('price: P(12)','price: P(shop.prices.chip)').replace("price: P(10), rarity: 2 });\n      } else if", "price: P(shop.prices.battery), rarity: 2 });\n      } else if").replace('price: P(10)','price: P(shop.prices.weapon)').replace('price: P(14)','price: P(shop.prices.power)');
rooms=rooms.replace("desc: '回复 2 点生命'","desc: '回复 ' + shop.heal + ' 点生命'").replace("desc: '护盾上限 +1 并回满护盾'","desc: '护盾上限 +' + shop.shield + ' 并回满护盾'").replace("desc: '永久伤害 +8%'","desc: '永久伤害 +' + Math.round(shop.power * 100) + '%'").replace("'+2', '#ff4757'","'+' + shop.heal, '#ff4757'");
write('src/game/rooms.js',rooms);
// Update meaningful mutation anchors without weakening their assertions.
let mut=read('test/mechanics-mutation.js');
for (const [from,to] of roomReplacements.slice(0,2).concat(roomReplacements.slice(-3))) mut=mut.split(from).join(to);
write('test/mechanics-mutation.js',mut);
write('src/storage.js',read('src/storage.js').replace('clears >= 1','clears >= C.CONFIG.progression.unlocks.heroZero').replace('clears >= 3','clears >= C.CONFIG.progression.unlocks.chipSlot'));
const oldReadme=read('README.md');
write('CHANGELOG.md','# 版本历史\n\n以下为历史版本的发布记录；数值证据以对应版本报告为准。\n\n'+oldReadme.slice(oldReadme.indexOf('## v1.14.3'),oldReadme.indexOf('## 评测过程')).replace(/\bjs\//g,'src/'));
write('.agents/handoff-history.md','# 历史交接归档\n\n原 HANDOFF.md，保留历史语境；当前工程约定见 handoff.md 与 ../docs/。\n\n'+read('HANDOFF.md')); fs.unlinkSync('HANDOFF.md');
json('package.json', {...JSON.parse(read('package.json')),engines:{node:'>=22'},scripts:{...JSON.parse(read('package.json')).scripts,start:'node scripts/config.cjs && node scripts/serve.js 8941', 'config:generate':'node scripts/config.cjs','config:check':'node scripts/config.cjs --check',check:'node scripts/config.cjs --check && node test/structure.check.js && node test/config.test.js && node test/build.test.js',build:'node scripts/build.cjs','test:equivalence':'node test/refactor-equivalence.js','test:ci':'npm run check && npm test && npm run test:animation && npm run test:difficulty && npm run test:enemies && npm run test:mechanics-mutation'}});
write('.gitignore',read('.gitignore')+'\n# 可重建产物与本地依赖\ngenerated/\ndist/\nnode_modules/\ncoverage/\n.env\n.env.*\n!.env.example\n');
write('.gitattributes','* text=auto\n*.sh text eol=lf\n*.yml text eol=lf\nassets/**/*.png filter=lfs diff=lfs merge=lfs -text\nassets/**/*.jpg filter=lfs diff=lfs merge=lfs -text\nassets/**/*.jpeg filter=lfs diff=lfs merge=lfs -text\nassets/**/*.webp filter=lfs diff=lfs merge=lfs -text\nassets/**/*.ogg filter=lfs diff=lfs merge=lfs -text\nassets/**/*.mp3 filter=lfs diff=lfs merge=lfs -text\nassets/**/*.wav filter=lfs diff=lfs merge=lfs -text\ndocs/**/*.jpg filter=lfs diff=lfs merge=lfs -text\n');
console.log('Migration complete. Generate schemas/config next.');
