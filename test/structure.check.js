/* ============================================================
 * 零号协议 ZERO PROTOCOL —— test/structure.check.js
 * 【结构守护】独立可跑：node test/structure.check.js（退出码 0 = 通过，秒级完成）
 * 守护四组结构不变量（不跑游戏逻辑、不启动服务器）：
 *   A. index.html <script src> 编排：与磁盘 js 文件一一对应、无重复，
 *      且与下方「编排顺序表」完全一致 —— 硬性钉死：
 *      js/game/ 六部件（state/systems/player/enemies/bosses/rooms）必须在
 *      js/game.js 之前、js/main.js 必须最后。
 *   B. Node 可加载模块（core / game 门面 / bot / audio）require 不抛错且导出面非空：
 *      ZERO_CORE 含 CHIPS / HEROES / ZONES / dailyForDate，
 *      ZERO_GAME 含 createGame，ZERO_BOT 含 createBot。
 *   C. js/*.js 与 js/game/*.js 每个文件通过 node --check 语法检查。
 *   D. UI 模块（storage/input/hud/ui/main）存在且含 ZERO_ 命名空间注册字样
 *      —— 浏览器专用文件，仅做文本级检查，绝不 require。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const rel = (...p) => path.join(ROOT, ...p).split(path.sep).join('/');

/* ---------------- 编排者定死的加载顺序表 ----------------
 * 浏览器按此顺序加载：数据层 → game 六部件 → game 门面 → 渲染层 →
 * 音频/音乐 → AI 代打 → UI 模块（storage → input → hud → ui）→ main 入口。
 * 依赖依据：core 供全局 ZERO_CORE；game 六部件经 ZERO_GAME_PARTS 注册、门面装配；
 * render 仅在 createGame 调用时经 ZERO_RENDER.attach 生效，排在门面之后即可；
 * main 引用以上全部命名空间，故必须末位。 */
const SCRIPT_ORDER = [
  'js/core.js',
  'js/game/state.js',
  'js/game/systems.js',
  'js/game/player.js',
  'js/game/enemies.js',
  'js/game/bosses.js',
  'js/game/rooms.js',
  'js/game.js',
  'js/render.js',
  'js/audio.js',
  'js/music.js',
  'js/bot.js',
  'js/storage.js',
  'js/input.js',
  'js/hud.js',
  'js/ui.js',
  'js/main.js',
];
const GAME_PARTS = ['state', 'systems', 'player', 'enemies', 'bosses', 'rooms'];
const UI_MODULES = ['storage', 'input', 'hud', 'ui', 'main'];

/* ---------------- 断言基建 ---------------- */
let failures = 0;
function ok(cond, msg) {
  console.log('  ' + (cond ? '✓ ' : '✗ ') + msg);
  if (!cond) failures++;
  return !!cond;
}

/* 磁盘上的 js/*.js 与 js/game/*.js 全集（正斜杠相对路径，排序稳定） */
function listGameJs() {
  const out = [];
  const jsDir = rel('js');
  for (const f of fs.readdirSync(jsDir)) {
    if (f.endsWith('.js') && fs.statSync(path.join(jsDir, f)).isFile()) out.push('js/' + f);
  }
  const gDir = rel('js', 'game');
  if (fs.existsSync(gDir) && fs.statSync(gDir).isDirectory()) {
    for (const f of fs.readdirSync(gDir)) {
      if (f.endsWith('.js') && fs.statSync(path.join(gDir, f)).isFile()) out.push('js/game/' + f);
    }
  }
  return out.sort();
}

function nonEmpty(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/* ---------------- 【A】index.html 编排守护 ---------------- */
console.log('【A】index.html <script src> 编排（一一对应 · 无重复 · 顺序表钉死）');
const html = fs.readFileSync(rel('index.html'), 'utf8');
const scripts = [];
const tagRe = /<script\b[^>]*\bsrc\s*=\s*"([^"]+)"/g;
let m;
while ((m = tagRe.exec(html)) !== null) scripts.push(m[1].replace(/^\.\//, ''));
ok(scripts.length > 0, '解析到 <script src> 列表（非空，实际 ' + scripts.length + ' 项）');

const dup = scripts.filter((s, i) => scripts.indexOf(s) !== i);
ok(dup.length === 0, '无重复脚本项' + (dup.length ? '（重复: ' + [...new Set(dup)].join(', ') + '）' : ''));

const missingOnDisk = scripts.filter(s => !fs.existsSync(rel(s)));
ok(missingOnDisk.length === 0, '每个 <script src> 都对应磁盘文件' + (missingOnDisk.length ? '（缺失: ' + missingOnDisk.join(', ') + '）' : ''));

const notListed = listGameJs().filter(f => !scripts.includes(f));
ok(notListed.length === 0, '磁盘 js 文件全部被编排' + (notListed.length ? '（未编排: ' + notListed.join(', ') + '）' : ''));

const orderOk = scripts.length === SCRIPT_ORDER.length && scripts.every((s, i) => s === SCRIPT_ORDER[i]);
if (orderOk) ok(true, 'script 列表与编排顺序表完全一致');
else {
  let at = 0;
  while (at < Math.max(scripts.length, SCRIPT_ORDER.length) && scripts[at] === SCRIPT_ORDER[at]) at++;
  ok(false, 'script 列表与编排顺序表完全一致（首个分歧 @' + at + ': 期望 ' + (SCRIPT_ORDER[at] || '（无）')
    + ' · 实际 ' + (scripts[at] || '（缺）') + '）');
}
/* 钉死项单独断言：即使顺序表整体失配，也能精确定位违例 */
const facadeIdx = scripts.indexOf('js/game.js');
const partIdx = GAME_PARTS.map(n => scripts.indexOf('js/game/' + n + '.js'));
ok(partIdx.every(i => i !== -1) && facadeIdx !== -1 && partIdx.every(i => i < facadeIdx),
  'game 六部件（' + GAME_PARTS.join('/') + '）全部位于 js/game.js 之前');
ok(scripts.length > 0 && scripts[scripts.length - 1] === 'js/main.js', 'js/main.js 位于编排末位');

/* ---------------- 【B】Node 可加载模块与导出面 ---------------- */
console.log('【B】Node 可加载模块 require 与导出面');
function requireMod(relPath) {
  try { return { mod: require(rel(relPath)) }; }
  catch (e) { return { err: e }; }
}
const coreR = requireMod('js/core.js');
if (coreR.err) ok(false, 'js/core.js require 不抛错 — ' + coreR.err.message);
else {
  ok(true, 'js/core.js require 不抛错');
  ok(nonEmpty(coreR.mod.CHIPS), 'ZERO_CORE.CHIPS 非空');
  ok(nonEmpty(coreR.mod.HEROES), 'ZERO_CORE.HEROES 非空');
  ok(nonEmpty(coreR.mod.ZONES), 'ZERO_CORE.ZONES 非空');
  ok(typeof coreR.mod.dailyForDate === 'function', 'ZERO_CORE.dailyForDate 为函数');
}
const gameR = requireMod('js/game.js');
if (gameR.err) ok(false, 'js/game.js（门面）require 不抛错 — ' + gameR.err.message);
else {
  ok(true, 'js/game.js（门面）require 不抛错');
  ok(typeof gameR.mod.createGame === 'function', 'ZERO_GAME.createGame 为函数');
}
const botR = requireMod('js/bot.js');
if (botR.err) ok(false, 'js/bot.js require 不抛错 — ' + botR.err.message);
else {
  ok(true, 'js/bot.js require 不抛错');
  ok(typeof botR.mod.createBot === 'function', 'ZERO_BOT.createBot 为函数');
}
const audioR = requireMod('js/audio.js');
if (audioR.err) ok(false, 'js/audio.js require 不抛错 — ' + audioR.err.message);
else ok(nonEmpty(audioR.mod), 'js/audio.js require 不抛错且导出面非空');

/* ---------------- 【C】语法检查（node --check） ---------------- */
console.log('【C】js/*.js 与 js/game/*.js 逐文件 node --check');
for (const f of listGameJs()) {
  try {
    execFileSync(process.execPath, ['--check', rel(f)], { stdio: ['ignore', 'pipe', 'pipe'] });
    ok(true, '语法 ' + f);
  } catch (e) {
    const detail = String((e.stderr && e.stderr.toString()) || e.message).trim().split('\n').slice(0, 3).join(' | ');
    ok(false, '语法 ' + f + ' — ' + detail);
  }
}

/* ---------------- 【D】UI 模块（文本级检查，不 require） ---------------- */
console.log('【D】UI 模块存在性与 ZERO_ 命名空间注册字样（浏览器专用，仅文本级）');
for (const name of UI_MODULES) {
  const f = 'js/' + name + '.js';
  if (!fs.existsSync(rel(f))) { ok(false, 'UI 模块 ' + f + ' 存在'); continue; }
  ok(true, 'UI 模块 ' + f + ' 存在');
  const src = fs.readFileSync(rel(f), 'utf8');
  ok(src.includes('ZERO_'), 'UI 模块 ' + f + ' 含 ZERO_ 命名空间注册字样');
}

/* ---------------- 汇总 ---------------- */
console.log('========================================');
if (failures === 0) console.log(' ✓ 结构守护通过（A 编排 / B 模块导出面 / C 语法 / D UI 模块）');
else console.log(' ✗ 结构守护未通过，红项 ' + failures + ' 个（见上方 ✗ 行）');
console.log('========================================');
process.exit(failures === 0 ? 0 : 1);
