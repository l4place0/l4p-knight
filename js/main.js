/* ============================================================
 * 零号协议 ZERO PROTOCOL —— main.js（薄启动层）
 * URL 参数解析 / 模块 init 接线 / startRun 编排 / 固定步长主循环 / 结算写纪录
 * 输入层见 input.js · HUD 见 hud.js · 界面流转见 ui.js · localStorage 见 storage.js
 * ============================================================ */
(function () {
'use strict';
const C = window.ZERO_CORE, GAME = window.ZERO_GAME, AUDIO = window.ZERO_AUDIO, BOT = window.ZERO_BOT;
const STORAGE = window.ZERO_STORAGE, INPUT = window.ZERO_INPUT, HUD = window.ZERO_HUD, UI = window.ZERO_UI;
const MUSIC = window.ZERO_MUSIC || null; // 缺省可删（音乐层与渲染层同级，可随时移除）
const today = STORAGE.today;             // 每日挑战：日期 → 固定种子 + 修改器

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

/* ---------- URL 参数（调试 / 自检） ---------- */
const q = new URLSearchParams(location.search);
const dailyParam = q.get('daily') === '1';
const seed = dailyParam ? today.seed : (parseInt(q.get('seed') || '1') || 1);
const botParam = q.get('bot') === '1';
const autostart = q.get('autostart') === '1';
const jumpZone = q.get('zone') ? parseInt(q.get('zone')) : null;
const jumpRoom = q.get('room') ? parseInt(q.get('room')) : null;
const fpsParam = q.get('fps') === '1';

const G = GAME.createGame({ seed, canvas });
window.G = G;
const bot = BOT.createBot(seed);
let botOn = botParam;    // AI 代打开关（B 键 / 按钮 / 结算重试共用）
let runDaily = false;    // 本局是否每日挑战（Enter 重开 / 重试按钮沿用）
let selHero = 'vanguard';
const savedDifficulty = STORAGE.getMeta().difficulty;
let selDifficulty = Object.hasOwn(C.DIFFICULTIES, q.get('difficulty')) ? q.get('difficulty') :
  (Object.hasOwn(C.DIFFICULTIES, savedDifficulty) ? savedDifficulty : 'standard');
// 场景矩阵回放：URL 指定英雄（与无头矩阵同一套场景参数编码）
if (q.get('hero') && C.HEROES[q.get('hero')]) selHero = q.get('hero');

/* ---------- 模块接线（跨模块依赖显式注入，模块间不互读内部） ---------- */
UI.init({
  G, startRun,
  getBotOn: () => botOn,
  getRunDaily: () => runDaily,
  getSelHero: () => selHero,
  setSelHero: (h) => { selHero = h; },
  getDifficulty: () => selDifficulty,
  setDifficulty: (id) => {
    selDifficulty = Object.hasOwn(C.DIFFICULTIES, id) ? id : 'standard';
    const meta = STORAGE.getMeta(); meta.difficulty = selDifficulty; STORAGE.setMeta(meta);
  },
});
HUD.init(UI.els, G);
INPUT.init({
  G, canvas, startRun,
  getBotOn: () => botOn,
  toggleBotOn: () => { botOn = !botOn; return botOn; },
  togglePause: UI.togglePause,
  getRunDaily: () => runDaily,
});

/* ---------- 缩放 ---------- */
function fit() {
  const s = Math.max(1, Math.min(4, Math.floor(Math.min(window.innerWidth / C.VIEW_W, window.innerHeight / C.VIEW_H))));
  document.documentElement.style.setProperty('--s', s);
}
window.addEventListener('resize', fit);
fit();

/* ---------- startRun 编排 ---------- */
function startRun(withBot, dailyRun) {
  AUDIO.init(); AUDIO.resume();
  if (MUSIC) MUSIC.init();
  botOn = !!withBot;
  runDaily = !!dailyRun;
  UI.onRunStart();   // 商店签名跨局失效 + 收起标题/结算屏（时序与拆分前一致）
  G.startRun(selHero, runDaily ? today : null, selDifficulty);
  if (runDaily) G.banner = { text: '每日挑战 · ' + G.daily.name, sub: today.mods.map(m => m.desc).join('　'), color: '#ffb84d', life: 3.4, max: 3.4 };
  if (jumpZone) G.debugJump(jumpZone, jumpRoom || 1);
  if (q.get('boss') === '1') G.loadBossRoom((C.ZONES[G.zoneIdx] && C.ZONES[G.zoneIdx].bossId) || 'boss');
  // 场景矩阵回放：构筑注入（与无头矩阵 setup 顺序一致：起跑 → 定场景 → 注入 → 一次性 computeStats）
  // 元进度初始晶片槽：解锁后每次开局固定携带所选晶片（与每日修改器、URL 注入共存，去重）
  const chipIds = (q.get('chips') || '').split(',').filter(x => x && C.CHIPS.some(c => c.id === x));
  const sc = STORAGE.startChipId();
  if (sc) chipIds.push(sc);
  if (chipIds.length || q.get('power') || q.get('shield')) {
    for (const id of chipIds) if (!G.chips.includes(id)) G.chips.push(id);
    if (q.get('power')) G.powerBonus = parseFloat(q.get('power')) || 0;
    if (q.get('shield')) G.bonusShield = parseInt(q.get('shield'), 10) || 0;
    G.computeStats();
  }
}

/* ---------- 结算写纪录（localStorage；结算屏 DOM 渲染在 ui.showEnd） ---------- */
function settleEnd(es) {
  if (es.victory) {
    const r = STORAGE.getRecords() || { clears: 0, bestScore: 0, maxCombo: 0, bestTime: Infinity };
    r.clears = (r.clears || 0) + 1;
    r.bestScore = Math.max(r.bestScore || 0, es.stats.score);
    r.maxCombo = Math.max(r.maxCombo || 0, es.stats.maxCombo);
    r.bestTime = Math.min(r.bestTime || Infinity, es.stats.time);
    STORAGE.setRecords(r);
  }
  if (!G.daily) return null;
  return { rank: STORAGE.recordDaily(es, G), best: STORAGE.dailyBest(G.difficultyId) }; // 同档位今日最佳
}

/* ---------- 固定步长主循环 ---------- */
let last = performance.now(), acc = 0;
const STEP = 1 / 60;
let fpsN = 0, fpsT = 0, fpsV = 60;

function tick(dt) {
  INPUT.update(); // 键鼠 → 触控 → 手柄（手柄最后写入；bot 接管时全部让位）
  if (botOn && (G.state === 'playing' || G.state === 'chip' || G.state === 'shop')) {
    bot.update(G, dt, G.input);
  }
  G.update(dt);
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.12) dt = 0.12;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 6) { tick(STEP); acc -= STEP; n++; }
  if (n === 6) acc = 0;
  drawFrame(dt);
  if (MUSIC) MUSIC.update(G); // BGM：探索/Boss 按战况自动切换
  // FPS
  fpsN++; fpsT += dt;
  if (fpsT >= 0.5) { fpsV = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; UI.els.fps.textContent = fpsV + ' FPS'; }
}

function drawFrame(dt) {
  // 渲染
  G.render(ctx, G.input.aimA == null ? INPUT.getMouse() : null);
  if (G.fade > 0) {
    ctx.fillStyle = 'rgba(5,5,8,' + Math.min(1, G.fade) + ')';
    ctx.fillRect(0, 0, C.VIEW_W, C.VIEW_H);
  }
  // 界面
  HUD.update(dt || 0.016);
  INPUT.updateTouchUI();        // 触控层显隐（对局中常驻，标题/结算不显示）
  UI.updateOverlays(settleEnd); // 晶片/商店/结算屏流转（结算先写纪录再渲染）
}

/* 无头调试推进（供自动化截图 / QA 使用） */
window.__advance = function (frames) {
  for (let i = 0; i < frames; i++) tick(STEP);
};
window.__draw = function () { drawFrame(0.016); };

/* ---------- 调试参数与自动开局（须在首帧前生效） ---------- */
if (q.get('dmg')) G.debugDmg = parseFloat(q.get('dmg')) || 1;
if (q.get('bosshp')) G.debugBossHp = parseFloat(q.get('bosshp')) || null;
if (autostart) startRun(botParam, dailyParam);
if (fpsParam) UI.els.fps.style.display = 'block';

requestAnimationFrame(frame);

})();
