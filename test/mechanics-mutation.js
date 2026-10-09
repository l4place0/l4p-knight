'use strict';
// 在隔离 VM 中定向删除机制；不修改工作树，不用语法/装载失败冒充断言检出。
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {loadMechanics}=require('./load-mechanics.js');
const {runMechanics}=require('./mechanics.test.js');
const mutations=[];
function add(name,group,file,from,to='') {mutations.push({name,group,file,from,to});}
const player='src/game/player.js',systems='src/game/systems.js',rooms='src/game/rooms.js',bosses='src/game/bosses.js';
add('rail-cooldown','cadence',player,'if (P.fireT <= 0) {\n          P.chargeT += dt;','{\n          P.chargeT += dt;');
add('hero-full-start','heroes',rooms,'P.hp = P.maxHp; P.shield = P.maxShield;');
add('bullet-kind','weapons','src/game/state.js','b.kind = o.kind || null;');
add('shield-absorb','damage',player,'P.shield -= absorb; n -= absorb;','n -= absorb;');
add('hp-damage','damage',player,'if (n > 0) P.hp -= n;');
add('undying-shield','damage',player,'P.hp - Math.max(0, n - P.shield) <= 0','P.hp - n <= 0');
add('enemy-bullet-hit','damage',systems,'ctx.damagePlayer(b.dmg || 1, b.x, b.y);','');
add('explosion-hit','damage',systems,'if (dist(x, y, P.x, P.y) < r + P.r) ctx.damagePlayer(dmg, x, y);');
add('mine-update','damage',systems,'updateMines(wdt);');
add('well-update','damage',systems,'updateWells(wdt);');
add('contact-hit','damage','src/game/enemies.js','&& !(a.isBoss && a.st === \'dying\')) ctx.damagePlayer(a.contact, a.x, a.y);','&& !(a.isBoss && a.st === \'dying\')) {}');
add('well-pull','movement',systems,'P.vx += (w.x - P.x) / d * k * dt;');
add('laser-hit','damage',systems,'ctx.damagePlayer(L.dmg, L.x0, L.y0);');
add('collision-rollback','movement',systems,'e[axis] = old;');
add('player-knock-direction','movement',player,'const dx = (P.vx + P.kx) * dt','const dx = (P.vx - P.kx) * dt');
add('ray-wall-step','movement','src/game/state.js','for (let i = 1; i <= steps; i++)','for (let i = 2; i <= steps; i++)');
add('homing-steer','weapons',systems,'b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;');
add('grenade-detonation','weapons',systems,"if (b.life <= 0) {\n        if (b.kind === 'grenade') grenadeBoom(b);","if (b.life <= 0) {");
add('rail-pierce','weapons',player,'const maxHits = s.pierceAll ? 999 : 1 + s.pierce;','const maxHits = 1;');
add('melee-hit','weapons',player,'ctx.damageEnemy(e, dmg, Math.atan2(e.y - P.y, e.x - P.x), w.knock, crit);');
add('deflect','weapons',player,'b.friendly = true; b.vx = Math.cos(a) * 280; b.vy = Math.sin(a) * 280;');
add('guard-block','weapons',systems,'dead = true; break;\n              }','break;\n              }');
add('shop-coins','shop',rooms,'G.coins -= it.price;');
add('shop-heal','shop',rooms,'G.player.hp = Math.min(G.player.maxHp, G.player.hp + shop.heal);');
add('shop-shield','shop',rooms,'G.bonusShield = (G.bonusShield || 0) + shop.shield;');
add('shop-weapon','shop',rooms,'G.weapons[0] = WEAPONS[it.weapon]; G.weaponSlot = 0;');
add('shop-power','shop',rooms,'G.powerBonus = (G.powerBonus || 0) + shop.power;');
add('shop-chip','shop',rooms,'const res = G.acquireChip(it.chipId);',"const res = 'new';");
add('rating','settlement',rooms,"(t < progression.rating.sTime && G.damageTaken <= progression.rating.sHits) ? 'S'","(t < 301 && G.damageTaken <= 6) ? 'S'");
add('score','settlement',rooms,'score: G.score, rating,','score: 0, rating,');
add('chip-name','settlement',rooms,"return c.name + (lv > 0 ? '·Lv' + (lv + 1) : '');","return c.name;");
add('restart-charge','restart',rooms,'P.fireT = 0; P.chargeT = 0; P.meleeCd = 0; P.slashT = 0; P.slashA = 0;');
add('restart-coins','restart',rooms,'G.coins = 0; G.coinsCollected = 0; G.shopVisits = 0;');
add('boss-projectiles','bosses',bosses,"ctx.spawnBullet(e.x, e.y, ang, speed * (df.bulletMul || 1) * (bt.bulletMul || 1),","false && ctx.spawnBullet(e.x, e.y, ang, speed * (df.bulletMul || 1) * (bt.bulletMul || 1),");
add('boss-laser','bosses',bosses,"count: Math.max(3, Math.round(5 * dm)), spread: 1.25",'count: 3, spread: 1.25');
add('boss-mines','bosses',bosses,'G.mines.push({ x: mx, y: my, fuse: 1.05, r: 36, dmg: 2, t: 0 });');
add('boss-clones','bosses',bosses,"const want = Math.min(e.phase >= 3 ? 3 : 2, 5 - aliveEcho);",'const want = 0;');
add('boss-wells','bosses',bosses,'const n = Math.min(4, Math.max(1, Math.round(2 * (df2.wellCount || bt2.wellCount || 1))));','const n = 1;');
add('boss-blink','bosses',bosses,'e.x = x; e.y = y; e.vx = 0; e.vy = 0;');
add('boss-aggression','bosses',bosses,'/ aggr;','/ 1;');
add('charger-dash','enemyAI','src/game/enemies.js',"if (e.t > 0.55) { e.state = 'dash'; e.t = 0; G.sfx('enemyDash'); }",'');
add('wraith-blink','enemyAI','src/game/enemies.js','wraithBlink(e, P);');
add('frost-speed','enemyAI','src/game/enemies.js','e.vx *= f; e.vy *= f;');
add('sniper-aim','enemyAI','src/game/enemies.js','const aimA = Math.atan2(la.ey - e.y, la.ex - e.x);','const aimA = Math.atan2(la.ey + e.y, la.ex - e.x);');
runMechanics();
const results=[];
for(const mutation of mutations) {
  const env=loadMechanics(mutation); // 语法/装载错误直接失败，不能算 KILLED。
  try {runMechanics(env,mutation.group);results.push({name:mutation.name,outcome:'survived'});}
  catch(e) {if(e.code!=='ERR_ASSERTION')throw e;results.push({name:mutation.name,outcome:'killed',assertion:e.message.split('\n')[0]});}
}
const survived=results.filter(r=>r.outcome==='survived');
const report={scope:'定向机制变异，不代表全仓库随机变异杀率',count:results.length,killed:results.length-survived.length,results};
if(process.argv.includes('--out'))fs.writeFileSync(process.argv[process.argv.indexOf('--out')+1],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({count:report.count,killed:report.killed,survived}));
assert.equal(survived.length,0,'必须检出全部定向机制变异');
