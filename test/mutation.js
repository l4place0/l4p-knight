/* ============================================================
 * 零号协议 ZERO PROTOCOL —— test/mutation.js
 * 随机变异测试（SQLite 思想）：测试系统本身也要被测试。
 * 随机在无头可测层注入一个小变异 → 快速探针 → 全量验收，
 * 两层都杀不死 = 测试盲区（幸存变异暴露的是验收缺口，不是代码 bug）。
 *
 * 用法：
 *   node test/mutation.js [--count N=20] [--seed S] [--file <路径关键词>]
 *                         [--strict [杀率阈值=60]] [--json]
 *
 * 安全：启动断言工作树干净（脏树拒绝运行）；每个变异后 git checkout -- 恢复并校验；
 *       全程结束断言树干净。不修改 test/abl 探针与任何其他文件。
 * 退出码：0 = 正常完成（--strict 时另判门槛）· 2 = 前置条件不满足。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const CORE = require('../src/core.js');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf(name);
  if (i === -1) return dflt;
  const v = args[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v;
}
const COUNT = Math.max(1, parseInt(argVal('--count', 20), 10) || 20);
const SEED = parseInt(argVal('--seed', (Date.now() % 100000)), 10) || 1;
const FILE_FILTER = argVal('--file', null);
const STRICT = args.includes('--strict');
const STRICT_MIN = parseInt(argVal('--strict', 60), 10) || 60;
const WANT_JSON = args.includes('--json');

/* ---------------- 目标池（无头可测层；浏览器专用层不在无头检测范围） ---------------- */
const FILES = [
  'src/core.js',
  'src/game/state.js', 'src/game/systems.js', 'src/game/player.js',
  'src/game/enemies.js', 'src/game/bosses.js', 'src/game/rooms.js',
  'src/bot.js',
].filter(f => !FILE_FILTER || f.includes(FILE_FILTER));

/* ---------------- 变异点采集（行级分类，块注释深度感知） ---------------- */
function collectSites(rel) {
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
  const sites = [];
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (depth > 0) { if (t.includes('*/')) depth--; continue; }
    if (t.includes('/*')) { if (!t.includes('*/')) depth++; continue; }
    if (!t || t.startsWith('//')) continue;                          // 空行/纯注释
    if (/^[\s{}()\[\];,]+$/.test(t) || /^}\s*else\s*\{?$/.test(t)) continue; // 纯结构符号
    sites.push({ rel, no: i + 1, text: raw });
  }
  return sites;
}

/* 引号感知：返回该行中「代码区」的字符区间（字符串字面量内部不可变异） */
function codeMask(line) {
  const mask = new Array(line.length).fill(true);
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { mask[i] = false; if (c === '\\') { if (i + 1 < line.length) mask[i + 1] = false; i++; } else if (c === q) q = null; }
    else if (c === '\'' || c === '"' || c === '`') { q = c; mask[i] = false; }
    else if (c === '/' && line[i + 1] === '/') { for (; i < line.length; i++) mask[i] = false; } // 行尾注释区
  }
  return mask;
}
/* 在代码区找第一个匹配（返回 {index, length}），找不到返回 null */
function findInCode(line, re) {
  const mask = codeMask(line);
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    let ok = true;
    for (let i = m.index; i < m.index + m[0].length; i++) if (!mask[i]) { ok = false; break; }
    if (ok) return m;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return null;
}

/* ---------------- 八种变异算子（SQLite 风格） ---------------- */
/* 统一变异实现：返回 {text, desc} 或 null（该算子对此行不适用） */
function applyOp(opId, line, rng) {
  const sub = (re, fn) => {
    const m = findInCode(line, re);
    if (!m) return null;
    const text = line.slice(0, m.index) + fn(m) + line.slice(m.index + m[0].length);
    return text === line ? null : { text, desc: m[0] + ' → ' + text.slice(m.index, m.index + fn(m).length) };
  };
  switch (opId) {
    case 'CONST': {
      const m = findInCode(line, /(?<![\w.])\d+(?:\.\d+)?(?![\w.)])/g);
      if (!m) return null;
      const n = parseFloat(m[0]);
      const nn = rng() < 0.5 ? n + 1 : Math.round(n * 2 * 100) / 100;
      const text = line.slice(0, m.index) + nn + line.slice(m.index + m[0].length);
      return { text, desc: m[0] + ' → ' + nn };
    }
    case 'CMP': {
      const pairs = [[/===/, '!=='], [/!==/, '==='], [/(?<![<>=!])<=(?!=)/, '<'], [/(?<![<>=!])<(?![<=])/, '<='], [/(?<![<>=!])>=(?!=)/, '>'], [/(?<![<>=!])>(?![>=])/, '>='], [/(?<![=!])==(?!=)/, '!=']];
      for (const [re, to] of pairs) { const r = sub(re, () => to); if (r) return r; }
      return null;
    }
    case 'LOGIC': {
      const r1 = sub(/&&/g, () => '||'); if (r1) return r1;
      return sub(/\|\|/g, () => '&&');
    }
    case 'ARITH': {
      const pairs = [[/(?<![+\-*/%])\+(?![+=])/, '-'], [/(?<![+\-*/%])-(?![=>\-])/, '+'], [/(?<![*/])\*(?![*\/=])/, '/'], [/(?<![+\-*/])\/(?![\/=])/, '*']];
      for (const [re, to] of pairs) { const r = sub(re, () => to); if (r) return r; }
      return null;
    }
    case 'BOOL': {
      const r1 = sub(/\btrue\b/g, () => 'false'); if (r1) return r1;
      return sub(/\bfalse\b/g, () => 'true');
    }
    case 'NEG': {
      const m = findInCode(line, /(?<![!=\w])!(?![=])/g);
      if (m) return { text: line.slice(0, m.index) + line.slice(m.index + 1), desc: '移除 !' };
      const head = findInCode(line, /\(\s*(?=[\w])/g);
      if (head) return { text: line.slice(0, head.index + 1) + '!' + line.slice(head.index + 1), desc: '插入 !' };
      return null;
    }
    case 'DEL':
      return { text: null, desc: '整行删除' }; // 删除由调用方特判
    case 'RET': {
      const m = findInCode(line, /return\s+\S[^;]*/g);
      if (!m) return null;
      return { text: line.slice(0, m.index) + 'return' + line.slice(m.index + m[0].length), desc: 'return → return undefined' };
    }
    default: return null;
  }
}
const OP_IDS = ['CONST', 'CMP', 'LOGIC', 'ARITH', 'BOOL', 'NEG', 'DEL', 'RET'];

/* 幸存者归类（继承消融实验的聚类结论） */
function classify(rel, line) {
  if (rel === 'src/core.js' && /^\s*'/.test(line)) return '数据-表现层（精灵/地图/字体行）';
  if (/G\.sfx\(|addParts\(|addRing\(|addFloater\(|flash\(|banner\(|shake\(|toast\(/.test(line)) return '表现层（音效/粒子/反馈）';
  return '逻辑盲区';
}

/* ---------------- 主流程 ---------------- */
const rng = CORE.RNG(SEED);
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

// 前置条件：已跟踪文件必须干净（未跟踪文件不参与变异与恢复，不影响精确恢复现场）
const pre = require('child_process').execSync('git status --porcelain --untracked-files=no', { cwd: ROOT, encoding: 'utf8' });
if (pre.trim()) { console.error('拒绝运行：工作树不干净（变异测试需要精确恢复现场）\n' + pre); process.exit(2); }
// 必须先证明未变异基线是绿的，否则会把既有失败误算为变异被检出。
for(const entry of ['test/abl/run.js','test/sim.test.js']) {
  const baseline=spawnSync(process.execPath,[entry],{cwd:ROOT,timeout:300000,encoding:'utf8',env:{...process.env,SEEDS:'1'}});
  if(baseline.status!==0){console.error('拒绝运行：未变异基线失败 '+entry+'\n'+baseline.stdout+'\n'+baseline.stderr);process.exit(2);}
}

// 采集候选点
const allSites = [];
for (const rel of FILES) for (const s of collectSites(rel)) allSites.push(s);
shuffle(allSites);
console.log('【随机变异测试】seed=' + SEED + ' · 文件 ' + FILES.length + ' · 候选变异点 ' + allSites.length + ' · 注入目标 ' + COUNT + (FILE_FILTER ? ' · 范围 ' + FILE_FILTER : ''));

const touched = new Set();
function restore(rel) {
  execFileSync('git', ['checkout', '--', rel], { cwd: ROOT });
  touched.delete(rel);
}
function restoreAll() { for (const rel of [...touched]) restore(rel); }

function syntaxOk(rel) {
  return spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' }).status === 0;
}

const results = [];
let injected = 0, killedProbe = 0, killedFull = 0, survived = 0;
const seen = new Set();
let attempts = 0, skippedSyntax = 0;
const MAX_ATTEMPTS = COUNT * 15;

try {
  while (injected < COUNT && attempts < MAX_ATTEMPTS) {
    attempts++;
    const site = allSites[Math.floor(rng() * allSites.length)];
    const opId = OP_IDS[Math.floor(rng() * OP_IDS.length)];
    const key = site.rel + ':' + site.no + ':' + opId;
    if (seen.has(key)) continue;
    seen.add(key);

    // 生成变异
    const lines = fs.readFileSync(path.join(ROOT, site.rel), 'utf8').split('\n');
    const orig = lines[site.no - 1];
    let mutatedText = null, desc = '';
    if (opId === 'DEL') { mutatedText = null; desc = '整行删除'; }
    else {
      const r = applyOp(opId, orig, rng);
      if (!r) continue;
      mutatedText = r.text; desc = r.desc;
      if (mutatedText === orig) continue;
    }
    // 写入 + 语法门槛
    if (mutatedText === null) lines.splice(site.no - 1, 1);
    else lines[site.no - 1] = mutatedText;
    fs.writeFileSync(path.join(ROOT, site.rel), lines.join('\n'));
    touched.add(site.rel);
    if (!syntaxOk(site.rel)) { restore(site.rel); skippedSyntax++; continue; }

    // 检测 tier-1：快速探针
    injected++;
    const probe = spawnSync(process.execPath, ['test/abl/run.js'], { cwd: ROOT, timeout: 120000, encoding: 'utf8' });
    let verdict, layer, reason = '';
    if (probe.status !== 0) {
      verdict = 'KILLED'; layer = 'probe';
      const kl = (probe.stdout || '').split('\n').filter(l => l.startsWith('KILLED')).pop();
      reason = kl || ('exit=' + probe.status);
      killedProbe++;
    } else {
      // tier-2：全量验收（SEEDS=1）
      const sim = spawnSync(process.execPath, ['test/sim.test.js'], {
        cwd: ROOT, timeout: 300000, encoding: 'utf8',
        env: Object.assign({}, process.env, { SEEDS: '1' }),
      });
      if (sim.status !== 0) {
        verdict = 'KILLED'; layer = 'full';
        reason = 'sim exit=' + sim.status;
        killedFull++;
      } else {
        verdict = 'SURVIVED'; layer = 'both';
        survived++;
      }
    }
    const tag = verdict === 'SURVIVED' ? classify(site.rel, orig) : '';
    results.push({
      no: injected, file: site.rel, line: site.no, operator: opId, desc,
      original: orig.trim(), verdict, layer, reason, tag,
    });
    console.log('#' + injected + ' ' + verdict.padEnd(8) + ' ' + layer.padEnd(5) + ' ' + opId.padEnd(6) + ' ' +
      site.rel + ':' + site.no + ' │ ' + desc + (tag ? ' │ ' + tag : ''));
    restore(site.rel);
  }
} finally {
  restoreAll();
}

/* ---------------- 汇总 ---------------- */
const killRate = injected ? Math.round((killedProbe + killedFull) / injected * 100) : 0;
console.log('──────────────────────────────');
console.log('注入 ' + injected + ' · KILLED-probe ' + killedProbe + ' · KILLED-full ' + killedFull +
  ' · SURVIVED ' + survived + ' · 杀率 ' + killRate + '%' + ' · 语法不适用重采样 ' + skippedSyntax);
const survivors = results.filter(r => r.verdict === 'SURVIVED');
if (survivors.length) {
  console.log('幸存变异（测试盲区）:');
  for (const s of survivors) console.log('  - ' + s.file + ':' + s.line + ' [' + s.tag + '] ' + s.operator + ' ' + s.desc);
}
console.log('结果文件: ' + (WANT_JSON ? writeJson() : '（未启用 --json）'));
console.log('工作树: ' + (require('child_process').execSync('git status --porcelain --untracked-files=no', { cwd: ROOT, encoding: 'utf8' }).trim() || '干净'));

if (WANT_JSON) { /* 已在 writeJson 写盘 */ }
function writeJson() {
  const dir = path.join(ROOT, 'test', 'mutation-results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'mutation-' + SEED + '.json');
  fs.writeFileSync(file, JSON.stringify({
    seed: SEED, count: injected, files: FILES,
    summary: { injected, killedProbe, killedFull, survived, killRate },
    results,
  }, null, 2));
  return file;
}

if (STRICT) {
  const logicSurvivors = survivors.filter(s => s.file.startsWith('src/game/'));
  if (killRate < STRICT_MIN || logicSurvivors.length) {
    console.log('STRICT 未过门槛：杀率 ' + killRate + '% < ' + STRICT_MIN + '% 或逻辑层存在 ' + logicSurvivors.length + ' 个幸存者');
    process.exit(1);
  }
  console.log('STRICT 门槛通过（杀率 ' + killRate + '% ≥ ' + STRICT_MIN + '%）');
}
process.exit(0);
