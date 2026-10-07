/* ============================================================
 * 零号协议 ZERO PROTOCOL —— test/balance.js
 * Boss 难度标定：1 batch = 100 个 Boss 战场景（种子 × 英雄 × 区域构筑），
 * worker 并行跑完，统计通过率（bossDown 占比）。以当前等级玩家 AI（bot）为标尺。
 *
 * 用法：
 *   node test/balance.js --boss boss1 --baseline                  # 当前数值基线通过率
 *   node test/balance.js --boss boss1 --try hpMul=1.3,aggression=1.25,bulletMul=1.1
 *   node test/balance.js --boss boss1 --auto --target 37          # 搜索通过率 <37% 的最小配置
 *   可选：--size 100 --workers 6 --playerDmg 4（模拟测试 handicap）
 *
 * 通过率定义：BOSS_CAP 游戏秒内击破 Boss（bossDown）；阵亡/超时/停滞/违规均计失败。
 * 依赖 js/game/bosses.js 的 G.bossTuning 注入钩（hpMul/speedMul/aggression/bulletMul）。
 * ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');


/* ---------------- 场景与执行（worker 内运行） ---------------- */
const HEROES = ['vanguard', 'bulwark', 'stalker'];
const DT = 1 / 60;
const BOSS_CAP = 150;          // 与 matrix 一致：Boss 战游戏秒硬上限
const STALL_SECONDS = 20;

function buildScenarios(bossId, size) {
  const zone = bossId === 'boss2' ? 4 : 3;
  // 区域构筑：模拟玩家打到该深度时的期望成长（与 matrix.js 同表）
  const BUILDS = {
    3: { chips: ['overcharge', 'servo', 'crit', 'capacitor'], power: 0.16, shield: 1 },
    4: { chips: ['overcharge', 'servo', 'crit', 'capacitor', 'pierce', 'nano'], power: 0.24, shield: 2 },
  };
  const build = BUILDS[zone];
  const specs = [];
  const nSeeds = Math.ceil(size / HEROES.length);
  for (let s = 1; s <= nSeeds; s++) {
    for (const hero of HEROES) {
      if (specs.length >= size) break;
      specs.push({ bossId, zone, hero, seed: s, build });
    }
  }
  return specs;
}

function runScenario(spec) {
  const CORE = require(path.join(ROOT, 'js', 'core.js'));
  const GAME = require(path.join(ROOT, 'js', 'game.js'));
  const BOT = require(path.join(ROOT, 'js', 'bot.js'));
  const G = GAME.createGame({ seed: spec.seed, headless: true });
  const bot = BOT.createBot(spec.seed);
  const wd = workerData;
  G.debugDmg = wd.playerDmg || 0;
  G.startRun(spec.hero);
  if (wd.tuning) G.bossTuning = wd.tuning;
  G.debugJump(spec.zone, 1);
  G.loadBossRoom(spec.bossId);
  for (const id of spec.build.chips) if (!G.chips.includes(id)) G.chips.push(id);
  G.powerBonus = spec.build.power;
  G.bonusShield = spec.build.shield;
  G.computeStats();

  let frames = 0, stallSecs = 0, lastHpSum = null, lastKills = -1;
  let outcome = 'timeout';
  const maxFrames = BOSS_CAP * 60;
  let hpStart = G.player.hp + G.player.shield;

  for (frames = 0; frames < maxFrames; frames++) {
    bot.update(G, DT, G.input);
    try { G.update(DT); } catch (e) { return { outcome: 'error', seconds: +(frames * DT).toFixed(1), reason: String(e.message) }; }
    const t = frames * DT;
    if (G.bossDown[spec.zone - 1]) { outcome = 'bossDown'; break; }
    if (G.state === 'defeat') { outcome = 'defeat'; break; }
    // 不变量（与 matrix 同源）：坐标有限 / 不越界 / 敌人不嵌墙
    const mw = G.mw * 16, mh = G.mh * 16;
    let bad = null;
    for (const e of [G.player].concat(G.enemies)) {
      if (!isFinite(e.x) || !isFinite(e.y)) { bad = 'nan'; break; }
      if (e.x < -2 || e.x > mw + 2 || e.y < -2 || e.y > mh + 2) { bad = 'bounds:' + e.type; break; }
    }
    if (bad) { outcome = 'violation'; break; }
    // 停滞探测：场上仍有敌军而血量/击杀 20 秒无变化
    if (frames % 60 === 59) {
      const alive = G.enemies.filter(e => !e.dead);
      const hpSum = alive.reduce((a, e) => a + Math.max(0, e.hp), 0);
      const prog = lastHpSum == null || Math.abs(hpSum - lastHpSum) > 0.5 || G.kills !== lastKills;
      lastHpSum = hpSum; lastKills = G.kills;
      if (alive.length > 0 && !prog) stallSecs++; else stallSecs = 0;
      if (stallSecs >= STALL_SECONDS) { outcome = 'stall'; break; }
    }
  }
  const hpLost = hpStart - (G.player.hp + G.player.shield);
  return {
    outcome, seconds: +(frames * DT).toFixed(1),
    hpLost, hero: spec.hero, seed: spec.seed,
  };
}

function workerMain() {
  const { specs } = workerData;
  const results = specs.map(runScenario);
  parentPort.postMessage(results);
}

/* ---------------- batch（1 batch = size 个场景，worker 并行） ---------------- */
async function runBatch(bossId, tuning, size, workers, playerDmg) {
  const specs = buildScenarios(bossId, size);
  const nWorkers = Math.min(workers, specs.length);
  const chunks = [];
  for (let i = 0; i < nWorkers; i++) chunks.push(specs.filter((_, j) => j % nWorkers === i));
  const all = await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { specs: chunk, tuning, playerDmg } });
    w.on('message', resolve);
    w.on('error', reject);
    w.on('exit', (c) => { if (c !== 0) reject(new Error('worker exit ' + c)); });
  })));
  return all.flat();
}

function summarize(results) {
  const n = results.length;
  const count = (o) => results.filter(r => r.outcome === o).length;
  const passRate = Math.round(count('bossDown') / n * 100);
  const perHero = {};
  for (const h of HEROES) {
    const rs = results.filter(r => r.hero === h);
    perHero[h] = Math.round(rs.filter(r => r.outcome === 'bossDown').length / rs.length * 100) + '%(' + rs.length + ')';
  }
  const avgHpLost = Math.round(results.reduce((a, r) => a + r.hpLost, 0) / n * 10) / 10;
  const avgSecs = Math.round(results.reduce((a, r) => a + r.seconds, 0) / n * 10) / 10;
  return { n, bossDown: count('bossDown'), defeat: count('defeat'), timeout: count('timeout'),
    stall: count('stall'), violation: count('violation'), error: count('error'),
    passRate, perHero, avgHpLost, avgSecs };
}

/* ---------------- CLI ---------------- */
function parseKV(s) {
  const o = {};
  for (const pair of String(s).split(',')) {
    const [k, v] = pair.split('=');
    if (k && v !== undefined) o[k.trim()] = parseFloat(v);
  }
  return o;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
  const has = (name) => args.includes(name);
  const bossId = get('--boss', 'boss1') === 'boss2' ? 'boss2' : 'boss';   // 定义键：boss / boss2
  const size = parseInt(get('--size', 100), 10) || 100;
  const workers = Math.max(1, parseInt(get('--workers', Math.min(7, os.cpus().length - 1)), 10));
  const playerDmg = parseFloat(get('--playerDmg', 0)) || 0;
  const target = parseInt(get('--target', 37), 10);
  const tuning = has('--try') ? parseKV(get('--try', '')) : null;
  const auto = has('--auto');
  const label = (t) => t ? Object.entries(t).map(([k, v]) => k + '=' + v).join(',') : 'baseline(当前数值)';

  let cfg = tuning || {};
  if (auto) {
    // 难度标量搜索：d 越大 → HP/攻击欲望/弹速同步抬升；找到通过率 < target 的最小 d
    const map = (d) => ({
      hpMul: Math.round((1 + 0.35 * (d - 1)) * 100) / 100,
      aggression: Math.round((1 + 0.85 * (d - 1)) * 100) / 100,
      bulletMul: Math.round((1 + 0.45 * (d - 1)) * 100) / 100,
      densityMul: Math.round((1 + 0.65 * (d - 1)) * 100) / 100,
      speedMul: Math.round((1 + 0.25 * (d - 1)) * 100) / 100,
    });
    let d = 1, prev = null;
    for (d = 1.15; d <= 4.01; d = Math.round((d + 0.15) * 100) / 100) {
      cfg = map(d);
      const s = summarize(await runBatch(bossId, cfg, size, workers, playerDmg));
      console.log('[auto d=' + d.toFixed(2) + '] ' + label(cfg) + ' → 通过率 ' + s.passRate + '%（击破 ' + s.bossDown + '/' + s.n +
        ' · 阵亡 ' + s.defeat + ' · 超时 ' + s.timeout + ' · 停滞 ' + s.stall + ' · 均损血 ' + s.avgHpLost + ' · 均时 ' + s.avgSecs + 's）');
      if (s.passRate < target) {
        // 二分收敛到最小满足配置
        let lo = prev === null ? d - 0.15 : prev.d, hi = d;
        for (let k = 0; k < 5 && hi - lo > 0.05; k++) {
          const mid = Math.round((lo + hi) / 2 * 100) / 100;
          const ms = summarize(await runBatch(bossId, map(mid), size, workers, playerDmg));
          console.log('[bisect d=' + mid.toFixed(2) + '] 通过率 ' + ms.passRate + '%');
          if (ms.passRate < target) hi = mid; else lo = mid;
        }
        cfg = map(hi);
        break;
      }
      prev = { d };
    }
  }

  console.log('【' + bossId + ' 难度标定】配置: ' + label(cfg) + ' · playerDmg=' + playerDmg + ' · 1 batch = ' + size + ' 场景 × ' + workers + ' workers');
  const final = await runBatch(bossId, cfg, size, workers, playerDmg);
  const s = summarize(final);
  console.log('通过率: ' + s.passRate + '%（目标 < ' + target + '%）');
  console.log('明细: 击破 ' + s.bossDown + ' · 阵亡 ' + s.defeat + ' · 超时 ' + s.timeout + ' · 停滞 ' + s.stall +
    ' · 违规 ' + s.violation + ' · 异常 ' + s.error + ' · 均损血 ' + s.avgHpLost + ' · 均耗时 ' + s.avgSecs + 's');
  console.log('分英雄: ' + Object.entries(s.perHero).map(([h, p]) => h + ' ' + p).join(' · '));
  console.log(s.passRate < target ? '✔ 达标：通过率 < ' + target + '%' : '✘ 未达标：通过率 ≥ ' + target + '%');
  if (has('--json')) {
    const dir = path.join(ROOT, 'test', 'mutation-results');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'balance-' + bossId + '-' + Date.now() + '.json');
    fs.writeFileSync(f, JSON.stringify({ bossId, tuning: cfg, playerDmg, summary: s, results: final }, null, 2));
    console.log('结果: ' + f);
  }
}

if (!isMainThread) { workerMain(); } else { main(); }
