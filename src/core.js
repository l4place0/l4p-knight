/* ============================================================
 * 零号协议 ZERO PROTOCOL —— core.js
 * 数据层：常量 / 武器 / 敌人 / 战术晶片 / 协同羁绊 / 地图 / 像素画
 * 可在浏览器（挂 window.ZERO_CORE）与 Node（module.exports）双端加载。
 * ============================================================ */
(function (root) {
'use strict';

// JSON is authoritative; the browser receives the same validated data as generated JS.
const CONFIG = typeof module !== 'undefined' && module.exports
  ? require('../scripts/config.cjs').loadConfig() : root.ZERO_CONFIG;
if (!CONFIG) throw new Error('Missing configuration: run npm run config:generate');

/* ---------------- 基础工具 ---------------- */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }

/* 可播种随机数（mulberry32） */
function RNG(seed) {
  let s = (seed >>> 0) || 1;
  const f = function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + f() * (b - a);
  f.int = (a, b) => Math.floor(a + f() * (b - a + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.chance = (p) => f() < p;
  return f;
}

/* ---------------- 视口与色板 ---------------- */
const VIEW_W = 480, VIEW_H = 272, TILE = 16;

const PAL = {
  '0': '#101014', 'v': '#0a0a0e', '1': '#1d1d24', '2': '#2b2b34',
  '3': '#3d3d48', '4': '#6a6a76', '5': '#a9a9b4', '6': '#e8e8ee', 'w': '#ffffff',
  'b': '#232b38',
  'c': '#45f0e2', 'C': '#c8fff8',
  'r': '#ff4757', 'R': '#ff97a1',
  'a': '#ffb84d', 'A': '#ffe6b0',
};

/* ---------------- 武器定义 ---------------- */
const WEAPONS = CONFIG.weapons;

/* ---------------- 可选英雄 ---------------- */
const HEROES = CONFIG.heroes;

/* ---------------- Boss 阶段表（三阶段结构 · 转阶段仅触发一次由 game 层保证） ---------------- */
const BOSS_PHASES = CONFIG.enemies.boss.phases;
const BOSS2_PHASES = CONFIG.enemies.boss2.phases;

/* ---------------- 敌人定义 ----------------
 * isBoss: 走 Boss 状态机（滞场死亡流程）；final: 击破后触发 VICTORY
 * phases: 三阶段名/色；pools: 各阶段攻击池（game.startBossAttack 轮转）
 * ---------------------------------------- */
const ENEMY_DEFS = CONFIG.enemies;

/* 普通战斗房小怪基础难度（区域序号）；实际 HP 另乘 DIFFICULTY_CURVE.enemyHp。
 * Boss 房及其召唤物不套普通房倍率。
 * test/enemy-balance.js 标定；G.enemyTuning 可覆盖各字段做确定性对照实验。 */
const ENEMY_DIFF = CONFIG.difficulty.enemies;

/* 整局难度：固定 M3 AI、四英雄等权，从首房正常推进至最终 Boss。
 * damageScale 在统一伤害入口与分阶段曲线相乘，覆盖所有危险源。 */
const DIFFICULTIES = CONFIG.difficulty.profiles;

// v1.14：四段道中与两场首领按到达后的失败风险校准，补给按整层分摊。
// 仿真可经 G.curveTuning 做全局参数对照；实际游戏与种子/胜败记录无关。
const DIFFICULTY_CURVE = CONFIG.difficulty.curve;

/* ---------------- 战术晶片 ----------------
 * rarity: 1 常规(灰) 2 稀有(青) 3 史诗(琥珀)
 * apply(s, k) 修改属性袋；s 字段见 game.computeStats
 * k = 效果缩放（1.5^升级等级），晶片升级时数值面随之放大；
 * 整数型效果取 ceil 保证逐级单调，乘法减益设下限防负值/零值。
 * ---------------------------------------- */
const CHIP_PARAMS = Object.fromEntries(CONFIG.chips.map(c => [c.id, c.params]));
function missingEffect(id) { throw new Error('Missing effect implementation: ' + id); }
const CHIPS_EFFECTS = {
  overcharge: (s, k) => { s.dmg += CHIP_PARAMS.overcharge.damage * k; },
  overclock: (s, k) => { s.rate += CHIP_PARAMS.overclock.rate * k; },
  split: (s, k) => { s.proj += Math.ceil(CHIP_PARAMS.split.projectiles * k); s.dmg -= CHIP_PARAMS.split.damagePenalty * k; s.splitK = k; },
  pierce: (s, k) => { s.pierce += Math.ceil(k); },
  bounce: (s, k) => { s.bounce += Math.ceil(CHIP_PARAMS.bounce.bounces * k); },
  glass: (s, k) => { s.dmg += CHIP_PARAMS.glass.damage * k; s.maxHpAdd -= CHIP_PARAMS.glass.healthPenalty; },
  nano: (s, k) => { s.killHeal = Math.max(s.killHeal, Math.min(CHIP_PARAMS.nano.probabilityCap, CHIP_PARAMS.nano.healChance * k)); },
  kinetic: (s, k) => { s.killSpeed = CHIP_PARAMS.kinetic.duration * k; },
  capacitor: (s, k) => { s.shieldMax += Math.ceil(k); s.shieldDelay *= Math.max(CHIP_PARAMS.capacitor.delayFloor, CHIP_PARAMS.capacitor.delayBase - CHIP_PARAMS.capacitor.delayReduction * k); },
  bladecore: (s, k) => { s.melee += CHIP_PARAMS.bladecore.meleeDamage * k; s.meleeRange += CHIP_PARAMS.bladecore.meleeRange * k; },
  crit: (s, k) => { s.crit += CHIP_PARAMS.crit.critChance * k; s.critMul += CHIP_PARAMS.crit.critMultiplier * k; },
  servo: (s, k) => { s.speed += CHIP_PARAMS.servo.speed * k; s.dashCd *= Math.max(CHIP_PARAMS.servo.cooldownFloor, CHIP_PARAMS.servo.cooldownBase - CHIP_PARAMS.servo.cooldownReduction * k); },
  steady: (s, k) => { s.spreadMul *= Math.max(CHIP_PARAMS.steady.spreadFloor, CHIP_PARAMS.steady.spreadBase - CHIP_PARAMS.steady.spreadReduction * k); },
  vengeance: (s, k) => { s.revenge = Math.max(s.revenge, Math.min(CHIP_PARAMS.vengeance.damageCap, CHIP_PARAMS.vengeance.damage * k)); },
  frost: (s, k) => { s.frost = CHIP_PARAMS.frost.enabled; s.frostK = k; },
  chain: (s, k) => { s.chain = CHIP_PARAMS.chain.enabled; s.chainK = k; },
  reload: (s, k) => { s.reload = CHIP_PARAMS.reload.enabled; s.reloadK = k; },
  lucky: (s, k) => { s.lucky = CHIP_PARAMS.lucky.enabled; s.luckyK = k; },
  dashecho: (s, k) => { s.dashEcho = Math.max(s.dashEcho, Math.min(CHIP_PARAMS.dashecho.damageCap, CHIP_PARAMS.dashecho.damage * k)); }
};
const CHIPS = CONFIG.chips.map(({params, ...entry}) => ({...entry, apply: CHIPS_EFFECTS[entry.id] || missingEffect(entry.id)}));

/* ---------------- 协同羁绊（Synergy） ----------------
 * need: 需同时持有的晶片；bonus(G) 额外效果（返回描述文本供横幅使用）
 * ------------------------------------------------------- */
const SYNERGY_PARAMS = Object.fromEntries(CONFIG.synergies.map(c => [c.id, c.params]));
const SYNERGIES_EFFECTS = {
  infinite: s => { s.rate += SYNERGY_PARAMS.infinite.rate; s.dmg += SYNERGY_PARAMS.infinite.damage; },
  fullburst: s => { s.proj += SYNERGY_PARAMS.fullburst.projectiles; s.noSplitPenalty = true; },
  quantum: s => { s.bouncePierce = true; },
  undying: s => { s.undying = true; },
  shadowstep: s => { s.dashResetKill = true; },
  berserk: s => { s.dmg += SYNERGY_PARAMS.berserk.damage; s.melee += SYNERGY_PARAMS.berserk.meleeDamage; },
  finaljudge: s => { s.railMul *= SYNERGY_PARAMS.finaljudge.railMultiplier; s.railAoe = SYNERGY_PARAMS.finaljudge.explosionRadius; },
  chainreact: s => { s.chainBig = SYNERGY_PARAMS.chainreact.enabled; },
  zerocold: s => { s.frostAmp = SYNERGY_PARAMS.zerocold.enabled; },
  phasekill: s => { s.dashEcho = Math.max(s.dashEcho, SYNERGY_PARAMS.phasekill.damage); }
};
const SYNERGIES = CONFIG.synergies.map(({params, ...entry}) => ({...entry, apply: SYNERGIES_EFFECTS[entry.id] || missingEffect(entry.id)}));

/* ---------------- 每日挑战 ----------------
 * 修改器按日期确定性轮换（每日两枚，去重）；seed = YYYYMMDD。
 * flags 由 game.startRun 应用到 G.daily.flag，效果落点见各挂点（掉落/金币/精英/商店/开局晶片）。
 * ------------------------------------------------ */
const DAILY_MODIFIERS = CONFIG.daily;

// 由日期字符串（'YYYY-MM-DD'）确定性得出当日挑战：固定种子 + 两枚去重修改器
function dailyForDate(dateStr) {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) { h ^= dateStr.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const h2 = Math.imul(h, 2654435761) >>> 0;
  const a = DAILY_MODIFIERS[h % DAILY_MODIFIERS.length];
  const b = DAILY_MODIFIERS[h2 % DAILY_MODIFIERS.length];
  return { date: dateStr, seed: parseInt(dateStr.replace(/-/g, ''), 10), mods: a === b ? [a] : [a, b] };
}

/* ---------------- 地图（30 x 17，# = 墙） ---------------- */
const MAPS = CONFIG.maps;

/* ---------------- 区域与波次 ----------------
 * bossId: 区域末尾（补给站之后）进入的首领战；击破非 final 首领后开启传送门进入下一区
 * ---------------------------------------- */
const ZONES = CONFIG.zones;

/* ---------------- 3x5 像素数字字体（伤害浮字用） ---------------- */
const FONT35 = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111',
  '3': '111001111001111', '4': '101101111001001', '5': '111100111001111',
  '6': '111100111101111', '7': '111001001010010', '8': '111101111101111',
  '9': '111101111001111',
  '!': '110100000000100', '+': '000010111010000', '-': '000000111000000',
  '.': '000000000000100',
};

/* ---------------- 像素画（每字符一像素，'.' 为透明） ---------------- */
const SPRITES = {
  player: { pal: PAL, art: [
    '....5555....',
    '...566665...',
    '..56666665..',
    '..5cvvvvc5..',
    '..56vvvvv5..',
    '..55666655..',
    '.5255555525.',
    '.5233333325.',
    '.5236666325.',
    '..523333250.',
    '...525525...',
    '....11.11...',
  ]},
  charger: { pal: PAL, art: [
    '....22......',
    '...2332.....',
    '...2rr3.....',
    '..23333.....',
    '.2333332....',
    '233333332...',
    '2333223221..',
    '.23321122...',
    '..2321......',
    '..21.21.....',
    '.21...21....',
    '............',
  ]},
  gunner: { pal: PAL, art: [
    '............',
    '...222......',
    '..23332..2..',
    '.23r3332244.',
    '.233333333w.',
    '.23333322...',
    '..23332.2...',
    '...222......',
    '..2.22.2....',
    '.21..21.....',
    '............',
    '............',
  ]},
  guard: { pal: PAL, art: [
    '..2222.......',
    '.233332......',
    '.23rr32.5555.',
    '233333255665.',
    '233333256665.',
    '2333332w5555.',
    '23333325555..',
    '.233332.5w5..',
    '.233332..5...',
    '..2332...5...',
    '..2..2..55...',
    '.21..21......',
    '.21..21......',
    '.............',
  ]},
  sniper: { pal: PAL, art: [
    '............',
    '....2222....',
    '...233332...',
    '..23rrr324..',
    '..233333444w',
    '..2333332...',
    '...23332....',
    '...2222.....',
    '..2..22.....',
    '..2...2.....',
    '.21...21....',
    '............',
  ]},
  boss: { pal: PAL, art: [
    '..........cc..........cc..........',
    '.........c2c........c2c..........',
    '.........2233......3322...........',
    '..2222..233333333333332..2222....',
    '.23333223333333333333332233332...',
    '.23333233344444444444333233332...',
    '.23333333466666666666643333332...',
    '..2333333466vvvvvvvv6643333332...',
    '..233333346vvvvvvvvvv643333332...',
    '.2333333346vvvvvvvvvv6433333332..',
    '.23333333346vvvvvvvv6433333333...',
    '.23333333334444444443333333332...',
    '..233333233333333333333233332....',
    '..23332..2333333333332..23332....',
    '..2332...2333333333332...2332....',
    '..2332..233333333333332..2332....',
    '..2332..233222222222332..2332....',
    '..2332..232222222222232..2332....',
    '..2332..233222222222332..2332....',
    '........233222222222332..........',
    '........2333322233332............',
    '.........233322223332............',
    '.........23332..23332............',
    '.........2332....2332............',
    '.........232......232............',
    '.........22........22............',
    '..........2........2.............',
  ]},
  boss2: { pal: PAL, art: [
    '...............ww...............',
    '..............2332..............',
    '.............2344432............',
    '............23466643............',
    '...........2345666432...........',
    '..........234566w66432..........',
    '.........234566rr665432.........',
    '........234566rrrr665432........',
    '..2....234566rrrrrr665432.......',
    '.232..234566rrrrrrrr665432...2..',
    '..2..234566rRrrrrrrRr665432.232.',
    '....234566rRrrrrrrrrRr665432.2..',
    '...2345666rRrrrrrrrrRr6665432...',
    '...2343333rRrrrrrrrrRr3222111...',
    '....234333rRrrrrrrrrRr322111....',
    '.....234333rRrrrrrrRr322111.....',
    '......234333rrrrrrrr322111......',
    '.......23333rrrrrrrr32211.......',
    '........23333rrrrrr32211........',
    '.........23332rrrr32211.........',
    '..........2333rrrr3221..........',
    '...........233rrrr321...........',
    '............233rr221............',
    '.............23rr21.............',
    '..............2r32..............',
    '...............22...............',
  ]},
  smg: { pal: PAL, art: [
    '............',
    '.222222222..',
    '244444444444',
    '244444444444',
    '.221444444..',
    '...22..22...',
  ]},
  shotgun: { pal: PAL, art: [
    '..............',
    '.222222222222a',
    '24444444444444',
    '23344444444444',
    '.221144444422.',
    '...22....22...',
  ]},
  railgun: { pal: PAL, art: [
    '................',
    'w2444c4444c444c.',
    '2444444444444444',
    '2444c4444c4444c.',
    '.2211444444221..',
    '...22.....22....',
  ]},
  blade: { pal: PAL, art: [
    '..........w.',
    '.21......6w.',
    '.221....66w.',
    '..22166666w.',
    '...221666w..',
    '....221w....',
  ]},
  crate: { pal: PAL, art: [
    '.2222222222..',
    '233333333332.',
    '23a3333333a2.',
    '2333aaaa3332.',
    '2333aAAa3332.',
    '2333aaaa3332.',
    '23a3333333a2.',
    '233333333332.',
    '.2222222222..',
    '..2......2...',
  ]},
  bomber: { pal: PAL, art: [
    '...2222...',
    '..233332..',
    '.233rr332.',
    '.23r33r32.',
    '.23333332.',
    '..233332..',
    '...2222...',
    '..2....2..',
  ]},
  wraith: { pal: PAL, art: [
    '....2222....',
    '...233332...',
    '..23333332..',
    '..233rr332..',
    '..23333332..',
    '..23343332..',
    '..23333332..',
    '...233332...',
    '..23.33.32..',
    '..2..2..2...',
    '.2...2...2..',
    '............',
  ]},
  echo: { pal: PAL, art: [
    '....22....',
    '...2332...',
    '..233332..',
    '.233cc332.',
    '.233cc332.',
    '..233332..',
    '...2332...',
    '....22....',
    '..........',
    '..........',
  ]},
  homing: { pal: PAL, art: [
    '..............',
    '.2222222222a..',
    '2444444444444a',
    '24444444444444',
    '.22114444442..',
    '...22....22...',
  ]},
  grenade: { pal: PAL, art: [
    '..............',
    '..222222222a..',
    '.2444444444444',
    '.2444444444444',
    '..2211444422..',
    '....22..22....',
  ]},
  heart: { pal: PAL, art: [
    '............',
    '..rr....rr..',
    '.rRRr..rRRr.',
    'rRRRRrrRRRRr',
    'rRRRRRRRRRRr',
    'rRRRRRRRRRRr',
    '.rRRRRRRRRr.',
    '..rRRRRRRr..',
    '...rRRRRr...',
    '....rRRr....',
    '.....rr.....',
    '............',
  ]},
  battery: { pal: PAL, art: [
    '............',
    '....cccc....',
    '...cCCCCc...',
    '..cc3333cc..',
    '..c333333c..',
    '..c3c33c3c..',
    '..c3c33c3c..',
    '..c333333c..',
    '..c333333c..',
    '...c3333c...',
    '....cccc....',
    '............',
  ]},
};

/* 输出 */
const CORE = {
  TAU, clamp, lerp, dist, angDiff, RNG,
  VIEW_W, VIEW_H, TILE, PAL,
  CONFIG, WEAPONS, ENEMY_DEFS, ENEMY_DIFF, DIFFICULTIES, DIFFICULTY_CURVE, CHIPS, SYNERGIES, HEROES,
  DAILY_MODIFIERS, dailyForDate,
  MAPS, ZONES, BOSS_PHASES, BOSS2_PHASES, FONT35, SPRITES,
};
root.ZERO_CORE = CORE;
if (typeof module !== 'undefined' && module.exports) module.exports = CORE;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
