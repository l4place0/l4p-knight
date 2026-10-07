/* ============================================================
 * 零号协议 ZERO PROTOCOL —— test/matrix.js
 * 【无头场景矩阵】批量 × worker 并行 × 游戏时间预算 × JSON 报告
 *
 * 设计（对应测试漏斗上游）：
 *   - 场景 = 地图(或 Boss) × 英雄 × 种子 × 按区域深度的合成构筑，全确定性可复现
 *   - 断言只用"游戏时间"（确定性帧步进），墙钟仅作容量参考，并行不引入抖动
 *   - 每场景带停滞探测器（敌方血量总和 / 玩家 HP / 击杀数 20 秒无变化）与
 *     逐帧不变量检查（越界 / 嵌墙 / NaN）；失败时倾倒最近 30 秒实体轨迹
 *   - 失败场景的 JSON 报告自带 replayUrl（浏览器定向回放）与 rerun 命令
 *
 * 用法：
 *   node test/matrix.js --list                          # 枚举全部场景（JSON）
 *   node test/matrix.js --seeds 1-3 --workers 6        # 批量并行，人读摘要
 *   node test/matrix.js --seeds 1-5 --json             # 输出完整 JSON 报告
 *   node test/matrix.js --run z4b/stalker              # 只跑匹配前缀的场景
 *   node test/matrix.js --run z1a/vanguard/s1 --dmg 0.001   # 数值压制实验
 *   node test/matrix.js --seeds 1-5 --save-baseline test/matrix.baseline.json
 *   node test/matrix.js --seeds 1-5 --baseline test/matrix.baseline.json
 * ============================================================ */
'use strict';
const fs = require('fs');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
require('../js/core.js');
const CORE = require('../js/core.js');
const GAME = require('../js/game.js');
const BOT = require('../js/bot.js');
const { spatialViolations } = require('./invariants.js');

const DT = 1 / 60;
const STALL_SECONDS = 20;        // 敌方血量/玩家HP/击杀数持续无变化判定为停滞
const HANG_MS = 5000;            // 单帧墙钟熔断（并行满载下放宽）
const ROOM_CAP = 120;            // 战斗房间游戏秒硬上限（实测清房 20~40s）
const BOSS_CAP = 150;            // Boss 战游戏秒硬上限（实测 30~45s）

/* 按区域深度的合成构筑：模拟玩家打到该深度时的期望成长（白板会失真产生假阳性） */
const BUILDS = {
  1: { chips: [], power: 0, shield: 0 },
  2: { chips: ['overcharge', 'servo'], power: 0.08, shield: 0 },
  3: { chips: ['overcharge', 'servo', 'crit', 'capacitor'], power: 0.16, shield: 1 },
  4: { chips: ['overcharge', 'servo', 'crit', 'capacitor', 'pierce', 'nano'], power: 0.24, shield: 2 },
};
/* Boss 所属区域（决定 final 标记与所用构筑） */
const BOSS_ZONE = { boss: 3, boss2: 4 };

const round1 = (v) => Math.round(v * 10) / 10;

/* ---------------- 场景枚举 ---------------- */
function parseSeeds(s) {
  const out = [];
  for (const part of String(s).split(',')) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.push(i); }
    else if (part.trim()) out.push(parseInt(part, 10) || 1);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function enumerate(opts) {
  const seeds = parseSeeds(opts.seeds);
  const heroes = opts.heroes ? opts.heroes.split(',').filter(h => CORE.HEROES[h]) : Object.keys(CORE.HEROES);
  const specs = [];
  for (const zone of CORE.ZONES) {
    zone.maps.forEach((mapId, ri) => {
      for (const hero of heroes) for (const seed of seeds) {
        specs.push({
          idx: specs.length, kind: 'room', id: `${mapId}/${hero}/s${seed}`,
          mapId, zone: zone.idx, room: ri + 1, hero, seed,
          build: BUILDS[zone.idx], cap: ROOM_CAP,
        });
      }
    });
  }
  for (const bossId of Object.keys(BOSS_ZONE)) {
    const z = BOSS_ZONE[bossId];
    for (const hero of heroes) for (const seed of seeds) {
      specs.push({
        idx: specs.length, kind: 'boss', id: `${bossId}/${hero}/s${seed}`,
        bossId, zone: z, hero, seed,
        build: BUILDS[z], cap: BOSS_CAP,
      });
    }
  }
  return specs;
}

function replayUrl(spec, base, dmg) {
  const p = new URLSearchParams({ seed: spec.seed, hero: spec.hero, bot: 1, autostart: 1 });
  if (spec.kind === 'room') { p.set('zone', spec.zone); p.set('room', spec.room); }
  else { p.set('zone', spec.zone); p.set('boss', '1'); }
  if (spec.build.chips.length) p.set('chips', spec.build.chips.join(','));
  if (spec.build.power) p.set('power', String(spec.build.power));
  if (spec.build.shield) p.set('shield', String(spec.build.shield));
  if (dmg) p.set('dmg', String(dmg));
  return base + '/?' + p.toString();
}

/* ---------------- 单场景执行（主线程与 worker 共用） ---------------- */
function checkInvariants(G) {
  const issue=spatialViolations(G)[0];
  if(!issue)return null;
  const [kind,entity]=issue.split(':');return {kind,entity};
}

function runScenario(spec, opts) {
  const G = GAME.createGame({ seed: spec.seed, headless: true });
  // Boss 场景用 M3 人类化标尺（与 test/balance.js 标定口径一致），房间场景保持完美 bot
  const bot = BOT.createBot(spec.seed, spec.kind === 'boss'
    ? { commit: 30, trackK: 3, sight: 100, delay: 10, dashSkip: 0.6 } : undefined);
  G.startRun(spec.hero);
  G.debugJump(spec.zone, spec.kind === 'boss' ? 1 : spec.room);
  if (spec.kind === 'boss') G.loadBossRoom(spec.bossId);
  if (opts.dmg) G.debugDmg = opts.dmg;   // 须在 computeStats 之前（computeStats 读取该乘数）
  for (const id of spec.build.chips) if (!G.chips.includes(id)) G.chips.push(id);
  G.powerBonus = spec.build.power;
  G.bonusShield = spec.build.shield;
  G.computeStats();

  const trace = [];
  let frames = 0, wallMax = 0, wallSum = 0;
  let stallSecs = 0, lastHpSum = null, lastPhp = null, lastKills = -1;
  let outcome = null, extra = null;
  const maxFrames = spec.cap * 60;
  const t0 = Date.now();

  const snap = (t) => {
    const alive = G.enemies.filter(e => !e.dead).slice(0, 12);
    trace.push({
      t: +t.toFixed(1), p: [round1(G.player.x), round1(G.player.y), G.player.hp], k: G.kills,
      es: alive.map(e => [e.type, round1(e.x), round1(e.y), Math.round(e.hp)]),
    });
    if (trace.length > 64) trace.shift();   // 滚动保留最近 ~32 游戏秒
  };

  for (frames = 0; frames < maxFrames; frames++) {
    bot.update(G, DT, G.input);
    const w0 = process.hrtime.bigint();
    let err = null;
    try { G.update(DT); } catch (e) { err = e; }
    const ms = Number(process.hrtime.bigint() - w0) / 1e6;
    wallSum += ms; if (ms > wallMax) wallMax = ms;
    const t = frames * DT;

    if (err) { outcome = 'error'; extra = { stack: String(err.stack).split('\n').slice(0, 4).join(' | ') }; break; }
    if (ms > HANG_MS) { outcome = 'hang'; extra = { frame: frames, ms: +ms.toFixed(0) }; break; }
    if (spec.kind === 'room' && G.chipOffered) { outcome = 'clear'; break; }
    if (spec.kind === 'boss' && G.bossDown[spec.zone - 1]) { outcome = 'bossDown'; break; }
    if (G.state === 'defeat') { outcome = 'defeat'; break; }
    const vio = checkInvariants(G);
    if (vio) { outcome = 'violation'; extra = Object.assign({ t: +t.toFixed(1) }, vio); break; }

    if (frames % 60 === 59) {
      const alive = G.enemies.filter(e => !e.dead);
      const hpSum = alive.reduce((a, e) => a + Math.max(0, e.hp), 0);
      const prog = lastHpSum == null || Math.abs(hpSum - lastHpSum) > 0.5
        || G.player.hp !== lastPhp || G.kills !== lastKills;
      lastHpSum = hpSum; lastPhp = G.player.hp; lastKills = G.kills;
      if (alive.length > 0 && !prog) stallSecs++; else stallSecs = 0;
      if (stallSecs >= STALL_SECONDS) {
        outcome = 'stall'; extra = { at: +t.toFixed(1), idleSecs: stallSecs };
        break;
      }
    }
    if (frames % 30 === 29) snap(t);
  }
  if (!outcome) { outcome = 'timeout'; extra = { cap: spec.cap, stallSecs }; }

  const ok = outcome === 'clear' || outcome === 'bossDown';
  const r = {
    idx: spec.idx, id: spec.id, kind: spec.kind, mapId: spec.mapId || spec.bossId,
    hero: spec.hero, seed: spec.seed, ok, outcome,
    seconds: +(frames * DT).toFixed(1), kills: G.kills, damageTaken: G.damageTaken,
    hpEnd: G.player.hp, chips: G.chips.length,
    wallAvgMs: +(wallSum / Math.max(1, frames)).toFixed(3), wallMaxMs: +wallMax.toFixed(1),
    wallTotalMs: Date.now() - t0,
  };
  if (extra) r.detail = extra;
  if (!ok) {
    r.trace = trace;
    r.replayUrl = replayUrl(spec, opts.url, opts.dmg);
    r.rerun = `node test/matrix.js --seeds ${spec.seed} --run ${spec.id}` + (opts.dmg ? ` --dmg ${opts.dmg}` : '');
  }
  return r;
}

/* ---------------- 基线 ---------------- */
const templateOf = (id) => id.replace(/\/s\d+$/, '');
function pct(sorted, p) {
  const i = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}
function buildBaseline(results) {
  const templates = {};
  for (const r of results) (templates[templateOf(r.id)] = templates[templateOf(r.id)] || []).push(r.seconds);
  const out = { generatedAt: new Date().toISOString(), templates: {} };
  for (const tpl of Object.keys(templates)) {
    const arr = templates[tpl].sort((a, b) => a - b);
    out.templates[tpl] = { n: arr.length, p50: +pct(arr, 0.5).toFixed(1), p95: +pct(arr, 0.95).toFixed(1), max: arr[arr.length - 1] };
  }
  return out;
}
function compareBaseline(results, file) {
  if (!fs.existsSync(file)) return { compared: false, note: '基线文件不存在: ' + file, regressions: [] };
  let base;
  try { base = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return { compared: false, note: '基线解析失败: ' + e.message, regressions: [] }; }
  const regressions = [];
  for (const r of results) {
    const tpl = base.templates && base.templates[templateOf(r.id)];
    if (!tpl) continue;
    // 方差感知阈值：同时尊重基线 p95 与基线极值（高方差模板的单种子离群不算劣化）
    const thr = Math.max(tpl.p95 * 1.25 + 1, (tpl.max || 0) * 1.1);
    if (r.ok && r.seconds > thr) {
      regressions.push({ id: r.id, seconds: r.seconds, baselineP95: tpl.p95, baselineMax: tpl.max, threshold: +thr.toFixed(1) });
    }
  }
  return { compared: true, regressions };
}

/* ---------------- CLI ---------------- */
function parseArgs(argv) {
  const o = {
    seeds: '1-5', heroes: null, workers: 0, dmg: 0, json: false, out: null,
    baseline: null, saveBaseline: null, run: null, list: false,
    url: 'http://127.0.0.1:8942',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') o.list = true;
    else if (a === '--json') o.json = true;
    else if (a === '--seeds') o.seeds = argv[++i];
    else if (a === '--heroes') o.heroes = argv[++i];
    else if (a === '--workers') o.workers = parseInt(argv[++i], 10) || 0;
    else if (a === '--dmg') o.dmg = parseFloat(argv[++i]) || 0;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--baseline') o.baseline = argv[++i];
    else if (a === '--save-baseline') o.saveBaseline = argv[++i];
    else if (a === '--run') o.run = argv[++i];
    else if (a === '--url') o.url = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('用法见文件头注释；示例: node test/matrix.js --seeds 1-3 --workers 6');
      process.exit(0);
    }
  }
  return o;
}

async function main() {
  const opts = parseArgs(process.argv);
  let specs = enumerate(opts);
  if (opts.run) specs = specs.filter(s => s.id.startsWith(opts.run));
  if (opts.list) {
    console.log(JSON.stringify({
      count: specs.length,
      scenarios: specs.map(s => ({
        id: s.id, kind: s.kind, hero: s.hero, seed: s.seed,
        where: s.kind === 'room' ? `${s.mapId}(z${s.zone}r${s.room})` : `${s.bossId}(z${s.zone})`,
        build: s.build, capSeconds: s.cap,
      })),
    }, null, 1));
    return;
  }
  if (!specs.length) { console.error('没有匹配的场景: ' + (opts.run || '')); process.exit(2); }

  const runOpts = { dmg: opts.dmg, url: opts.url };
  const t0 = Date.now();
  const W = Math.max(1, Math.min(opts.workers || Math.max(1, os.cpus().length - 1), specs.length));
  let results;
  if (W === 1) {
    results = specs.map(s => runScenario(s, runOpts));
  } else {
    // 轮转分片：每 worker 顺序跑一批（摊薄 JIT 预热），结果按原顺序聚合
    const chunks = [];
    for (let i = 0; i < W; i++) chunks.push(specs.filter((_, j) => j % W === i));
    const lists = await Promise.all(chunks.filter(c => c.length).map(chunk => new Promise((resolve, reject) => {
      const w = new Worker(__filename, { workerData: { specs: chunk, opts: runOpts } });
      w.on('message', resolve);
      w.on('error', reject);
      w.on('exit', (code) => { if (code !== 0) reject(new Error('worker 退出码 ' + code)); });
    })));
    results = [].concat(...lists).sort((a, b) => a.idx - b.idx);
  }
  const wallMs = Date.now() - t0;

  const fails = results.filter(r => !r.ok);
  const byOutcome = {};
  for (const r of results) byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
  const slowest = results.slice().sort((a, b) => b.seconds - a.seconds).slice(0, 5);

  let baselineInfo = null;
  if (opts.baseline) baselineInfo = compareBaseline(results, opts.baseline);
  if (opts.saveBaseline) {
    const data = buildBaseline(results);
    data.config = { seeds: opts.seeds, heroes: opts.heroes || 'all', savedAt: new Date().toISOString() };
    fs.writeFileSync(opts.saveBaseline, JSON.stringify(data, null, 1));
  }

  if (opts.json || opts.out) {
    const report = {
      config: { seeds: opts.seeds, heroes: opts.heroes || 'all', workers: W, dmg: opts.dmg || null },
      wallMs, count: results.length, passed: results.length - fails.length, failed: fails.length,
      byOutcome, slowest, baseline: baselineInfo, results,
    };
    if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(report, null, 1));
    if (opts.json) console.log(JSON.stringify(report, null, 1));
  }

  if (!opts.json) {
    console.log('========================================');
    console.log(` 场景矩阵 · ${results.length} 场景 · workers=${W} · 墙钟 ${(wallMs / 1000).toFixed(1)}s`);
    console.log('========================================');
    console.log('结果分布: ' + Object.entries(byOutcome).map(([k, v]) => `${k}×${v}`).join(' · '));
    console.log('最慢 5: ' + slowest.map(r => `${r.id} ${r.seconds}s`).join(' · '));
    for (const f of fails) {
      const d = f.detail || {};
      console.log(` ✗ ${f.id} [${f.outcome}] @${f.seconds}s`
        + (d.at != null ? ` 停滞于 ${d.at}s` : '')
        + (d.kind ? ` ${d.kind} ${d.entity}@(${d.x},${d.y})` : '')
        + (d.stack ? ' ' + d.stack : ''));
      if (f.replayUrl) console.log(`     回放: ${f.replayUrl}`);
      if (f.rerun) console.log(`     复跑: ${f.rerun}`);
    }
    if (baselineInfo) {
      if (!baselineInfo.compared) console.log('基线: ' + baselineInfo.note);
      else if (!baselineInfo.regressions.length) console.log('基线对比: 无劣化场景');
      else {
        console.log('基线对比: ✗ 劣化 ' + baselineInfo.regressions.length + ' 个场景');
        for (const g of baselineInfo.regressions) {
          console.log(`   ~ ${g.id}: ${g.seconds}s > 基线p95 ${g.baselineP95}s`);
        }
      }
    }
    console.log('========================================');
  }
  const regressions = baselineInfo && baselineInfo.regressions ? baselineInfo.regressions.length : 0;
  process.exit(fails.length + regressions > 0 ? 1 : 0);
}

if (isMainThread) main();
else parentPort.postMessage(workerData.specs.map(s => runScenario(s, workerData.opts)));
