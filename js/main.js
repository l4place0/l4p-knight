/* ============================================================
 * 零号协议 ZERO PROTOCOL —— main.js
 * 启动 / 输入映射 / 固定步长主循环 / HUD DOM 更新 / 界面流转
 * ============================================================ */
(function () {
'use strict';
const C = window.ZERO_CORE, GAME = window.ZERO_GAME, AUDIO = window.ZERO_AUDIO, BOT = window.ZERO_BOT;
const MUSIC = window.ZERO_MUSIC || null; // 缺省可删（音乐层与渲染层同级，可随时移除）

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

/* ---------- URL 参数（调试 / 自检） ---------- */
const q = new URLSearchParams(location.search);
const dailyParam = q.get('daily') === '1';
const _d = new Date();
const todayStr = _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()).padStart(2, '0');
const today = C.dailyForDate(todayStr);   // 每日挑战：日期 → 固定种子 + 修改器
const seed = dailyParam ? today.seed : (parseInt(q.get('seed') || '1') || 1);
const botParam = q.get('bot') === '1';
const autostart = q.get('autostart') === '1';
const jumpZone = q.get('zone') ? parseInt(q.get('zone')) : null;
const jumpRoom = q.get('room') ? parseInt(q.get('room')) : null;
const fpsParam = q.get('fps') === '1';

const G = GAME.createGame({ seed, canvas });
window.G = G;
const bot = BOT.createBot(seed);
let botOn = botParam;
let selHero = 'vanguard';
// 场景矩阵回放：URL 指定英雄（与无头矩阵同一套场景参数编码）
if (q.get('hero') && C.HEROES[q.get('hero')]) selHero = q.get('hero');

/* 历史纪录（localStorage，file:// 下同样可用） */
const store = {
  get() { try { return JSON.parse(localStorage.getItem('zp_records') || 'null'); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem('zp_records', JSON.stringify(v)); } catch (e) {} },
};
function showRecords() {
  const el2 = document.getElementById('records');
  if (!el2) return;
  const r = store.get();
  el2.textContent = r ? ('最佳纪录 · 通关 ' + r.clears + ' 次 · 最高分 ' + r.bestScore + ' · 最高连击 ×' + r.maxCombo + (isFinite(r.bestTime) ? ' · 最速 ' + r.bestTime.toFixed(0) + 's' : '')) : '尚无通关纪录 · 成为第一位协议完成者';
}

/* 每日挑战：本地排行（localStorage，每日保留前 5 名） */
const dStore = {
  get() { try { return JSON.parse(localStorage.getItem('zp_daily') || '{}'); } catch (e) { return {}; } },
  set(v) { try { localStorage.setItem('zp_daily', JSON.stringify(v)); } catch (e) {} },
};

/* 元进度：初始晶片槽选择（localStorage zp_meta；解锁条件读 zp_records.clears） */
const meta = {
  get() { try { return JSON.parse(localStorage.getItem('zp_meta') || '{}'); } catch (e) { return {}; } },
  set(v) { try { localStorage.setItem('zp_meta', JSON.stringify(v)); } catch (e) {} },
};
function startChipId() {
  if (!unlocks().chipSlot) return '';
  const sc = meta.get().startChip || '';
  return C.CHIPS.some(c => c.id === sc) ? sc : '';
}
function buildChipSlot() {
  const row = document.getElementById('chipSlot');
  const label = document.getElementById('chipSlotLabel');
  if (!row || !label) return;
  if (!unlocks().chipSlot) {
    label.textContent = '初始晶片槽 · 累计通关 3 次解锁';
    row.innerHTML = '';
    row.classList.add('lockedSlot');
    return;
  }
  label.textContent = '初始晶片槽（点选起手晶片 · 再点取消）';
  row.classList.remove('lockedSlot');
  const cur = meta.get().startChip || '';
  row.innerHTML = '';
  for (const c of C.CHIPS) {
    const t = document.createElement('span');
    t.className = 'chipTag r' + c.rarity + (cur === c.id ? ' sel' : '');
    t.textContent = c.name;
    t.addEventListener('click', () => {
      const m = meta.get();
      m.startChip = (m.startChip === c.id) ? '' : c.id;
      meta.set(m);
      AUDIO.play('ui');
      buildChipSlot();
    });
    row.appendChild(t);
  }
}
function dailyBest() { const l = dStore.get()[today.date]; return l && l.length ? l[0] : null; }
function recordDaily(es) {
  const b = dStore.get();
  const list = b[today.date] || [];
  const entry = { score: es.stats.score, time: +es.stats.time.toFixed(1), kills: es.stats.kills,
    hero: (C.HEROES[G.heroId] || C.HEROES.vanguard).name, rating: es.stats.rating };
  list.push(entry);
  list.sort((x, y) => y.score - x.score);
  const rank = list.indexOf(entry) + 1;   // 挤出前 5 则记 0（未上榜）
  b[today.date] = list.slice(0, 5);
  dStore.set(b);
  return rank;
}
function buildDailyPanel() {
  const elDate = document.getElementById('dailyDate');
  if (!elDate) return;
  elDate.textContent = today.date + ' · ' + today.seed;
  document.getElementById('dailyMods').innerHTML = today.mods.map(m =>
    '<div class="dailyMod"><b>▍' + m.name + '</b>' + m.desc + '</div>').join('');
  const best = dailyBest();
  document.getElementById('dailyBest').textContent = best
    ? ('今日最佳 ' + best.score + ' 分 · ' + best.hero)
    : '今日暂无记录 · 虚位以待';
}

/* 英雄选择卡片（含元进度锁定：仅 UI 门控，无头仿真/URL 回放不受影响） */
function unlocks() {
  const r = store.get() || {};
  const clears = r.clears || 0;
  return {
    heroZero: clears >= 1,   // 零·原型机：累计通关 1 次
    chipSlot: clears >= 3,   // 初始晶片槽：累计通关 3 次
  };
}
function buildHeroCards() {
  const row = document.getElementById('heroRow');
  if (!row) return;
  row.innerHTML = '';
  const un = unlocks();
  for (const hid of Object.keys(C.HEROES)) {
    const h = C.HEROES[hid];
    const locked = hid === 'prototype' && !un.heroZero;
    const d = document.createElement('div');
    d.className = 'heroCard' + (hid === selHero ? ' sel' : '') + (locked ? ' locked' : '');
    d.innerHTML = '<div class="hName">' + (locked ? '🔒 ' : '') + h.name + '</div>' +
      '<div class="hDesc">' + (locked ? '<span class="lockedTag">累计通关 1 次解锁</span>' : h.desc) + '</div>';
    d.addEventListener('click', () => {
      if (locked) { AUDIO.play('clink'); G.toast && G.toast('未解锁：累计通关 1 次以启动零号原型机', '#8b8b98'); return; }
      selHero = hid; AUDIO.play('ui');
      row.querySelectorAll('.heroCard').forEach(x => x.classList.remove('sel'));
      d.classList.add('sel');
    });
    row.appendChild(d);
  }
}
buildHeroCards();
showRecords();
buildDailyPanel();
buildChipSlot();

/* ---------- 缩放 ---------- */
function fit() {
  const s = Math.max(1, Math.min(4, Math.floor(Math.min(window.innerWidth / C.VIEW_W, window.innerHeight / C.VIEW_H))));
  document.documentElement.style.setProperty('--s', s);
}
window.addEventListener('resize', fit);
fit();

/* ---------- 输入 ---------- */
const keys = {};
const mouse = { x: C.VIEW_W / 2, y: C.VIEW_H / 2, cx: 0, cy: 0 };

window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (keys[e.code]) return;
  keys[e.code] = true;
  AUDIO.init(); AUDIO.resume();
  switch (e.code) {
    case 'ShiftLeft': case 'ShiftRight': case 'Space': G.input.dash = true; break;
    case 'KeyF': G.input.melee = true; break;
    case 'KeyE': G.input.interact = true; break;
    case 'Digit1': G.input.slot = 0; break;
    case 'Digit2': G.input.slot = 1; break;
    case 'KeyQ': G.input.slot = G.weaponSlot === 0 ? 1 : 0; break;
    case 'KeyB':
      botOn = !botOn;
      G.toast && G.toast(botOn ? 'AI 代打：已接入' : 'AI 代打：已断开', botOn ? '#45f0e2' : '#8b8b98');
      break;
    case 'KeyM': {
      const m = AUDIO.toggleMute();
      G.toast && G.toast(m ? '声音：关' : '声音：开', '#8b8b98');
      break;
    }
    case 'KeyP': case 'Escape':
      if (G.state === 'playing') { G.state = 'paused'; showPause(true); }
      else if (G.state === 'paused') { G.state = 'playing'; showPause(false); }
      break;
    case 'Enter':
      if (G.state === 'title') startRun(false);
      else if (G.state === 'victory' || G.state === 'defeat') startRun(botOn, runDaily);
      break;
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('pointermove', (e) => { mouse.cx = e.clientX; mouse.cy = e.clientY; });
canvas.addEventListener('pointerdown', (e) => {
  AUDIO.init(); AUDIO.resume();
  if (e.button === 0) G.input.fire = true;
  if (e.button === 2) G.input.dash = true;
});
window.addEventListener('pointerup', (e) => { if (e.button === 0) G.input.fire = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  G.input.fire = false;
});

function readMove() {
  let x = 0, y = 0;
  if (keys['KeyA'] || keys['ArrowLeft']) x -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) x += 1;
  if (keys['KeyW'] || keys['ArrowUp']) y -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) y += 1;
  if (botOn) return; // bot 接管时不动 moveX/Y（由 bot 写入）
  G.input.moveX = x; G.input.moveY = y;
  // 鼠标世界坐标
  const rect = canvas.getBoundingClientRect();
  if (rect.width > 0) {
    mouse.x = (mouse.cx - rect.left) / rect.width * C.VIEW_W;
    mouse.y = (mouse.cy - rect.top) / rect.height * C.VIEW_H;
  }
  G.input.mx = mouse.x; G.input.my = mouse.y;
  if (G.input.aimA != null) G.input.aimA = null;
}

/* ---------- 界面流转 ---------- */
const el = (id) => document.getElementById(id);
const ui = {
  hpPips: el('hpPips'), shieldFill: el('shieldFill'), wpnRow: el('wpnRow'),
  dashFill: el('dashFill'), zoneLabel: el('zoneLabel'), roomLabel: el('roomLabel'),
  score: el('score'), combo: el('combo'), hudBL: el('hudBL'), toasts: el('toasts'),
  bossBar: el('bossBar'), bossName: el('bossName'), bossFill: el('bossFill'),
  bossGhost: el('bossGhost'), bossPhases: document.querySelectorAll('#bossPhases .bphase'),
  prompt: el('prompt'), banner: el('banner'), bannerText: el('bannerText'), bannerSub: el('bannerSub'),
  chipOverlay: el('chipOverlay'), chipCards: el('chipCards'),
  screenTitle: el('screenTitle'), screenEnd: el('screenEnd'), screenPause: el('screenPause'),
  endTitle: el('endTitle'), endEn: el('endEn'), endRating: el('endRating'),
  endStats: el('endStats'), endChips: el('endChips'),
  fxHurt: el('fxHurt'), fxLow: el('fxLow'), fps: el('fps'),
  btnStart: el('btnStart'), btnBot: el('btnBot'), btnHelp: el('btnHelp'), btnRetry: el('btnRetry'),
  coins: el('coins'), shopOverlay: el('shopOverlay'), shopCards: el('shopCards'), btnShopLeave: el('btnShopLeave'),
  helpBox: document.querySelector('#helpBox'),
};

let runDaily = false;
function startRun(withBot, dailyRun) {
  AUDIO.init(); AUDIO.resume();
  if (MUSIC) MUSIC.init();
  botOn = !!withBot;
  runDaily = !!dailyRun;
  G.startRun(selHero, runDaily ? today : null);
  if (runDaily) G.banner = { text: '每日挑战 · ' + G.daily.name, sub: today.mods.map(m => m.desc).join('　'), color: '#ffb84d', life: 3.4, max: 3.4 };
  ui.screenTitle.classList.remove('show');
  ui.screenEnd.classList.remove('show');
  if (jumpZone) G.debugJump(jumpZone, jumpRoom || 1);
  if (q.get('boss') === '1') G.loadBossRoom((C.ZONES[G.zoneIdx] && C.ZONES[G.zoneIdx].bossId) || 'boss');
  // 场景矩阵回放：构筑注入（与无头矩阵 setup 顺序一致：起跑 → 定场景 → 注入 → 一次性 computeStats）
  // 元进度初始晶片槽：解锁后每次开局固定携带所选晶片（与每日修改器、URL 注入共存，去重）
  const chipIds = (q.get('chips') || '').split(',').filter(x => x && C.CHIPS.some(c => c.id === x));
  const sc = startChipId();
  if (sc) chipIds.push(sc);
  if (chipIds.length || q.get('power') || q.get('shield')) {
    for (const id of chipIds) if (!G.chips.includes(id)) G.chips.push(id);
    if (q.get('power')) G.powerBonus = parseFloat(q.get('power')) || 0;
    if (q.get('shield')) G.bonusShield = parseInt(q.get('shield'), 10) || 0;
    G.computeStats();
  }
}
ui.btnStart.addEventListener('click', () => { AUDIO.play('ui'); startRun(false); });
ui.btnBot.addEventListener('click', () => { AUDIO.play('ui'); startRun(true); });
const btnDaily = el('btnDaily');
if (btnDaily) btnDaily.addEventListener('click', () => { AUDIO.play('ui'); startRun(false, true); });
ui.btnHelp.addEventListener('click', () => {
  AUDIO.play('ui');
  ui.helpBox.style.display = ui.helpBox.style.display === 'none' ? 'block' : 'none';
});
ui.btnRetry.addEventListener('click', () => { AUDIO.play('ui'); startRun(botOn, runDaily); });
function showPause(on) { ui.screenPause.classList.toggle('show', on); }

if (q.get('dmg')) G.debugDmg = parseFloat(q.get('dmg')) || 1;
if (q.get('bosshp')) G.debugBossHp = parseFloat(q.get('bosshp')) || null;
if (autostart) startRun(botParam, dailyParam);
if (fpsParam) ui.fps.style.display = 'block';

/* ---------- 晶片卡片 ---------- */
function showChipOffer() {
  if (!G.chipOffer) return;
  ui.chipCards.innerHTML = '';
  G.chipOffer.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'chipCard r' + c.rarity;
    const rarName = ['', '常规', '稀有', '史诗'][c.rarity];
    const owned = G.chips.includes(c.id);
    const upBadge = owned ? '<div class="ccUp">升级 → Lv.' + (c.lv + 2) + '（效果 ×1.5）</div>' : '';
    div.innerHTML =
      '<div class="ccRarity">' + '★'.repeat(c.rarity) + ' ' + rarName + '</div>' +
      '<div class="ccName">' + c.name + '</div>' + upBadge +
      '<div class="ccDesc">' + c.desc + '</div>' +
      (c.syn && c.syn.length ? '<div class="ccSyn">羁绊：' + c.syn.map(s => s.name).join(' / ') + '</div>' : '');
    div.addEventListener('click', () => { AUDIO.play('chipPick'); G.chooseChip(i); });
    ui.chipCards.appendChild(div);
  });
  ui.chipOverlay.classList.add('show');
}

/* ---------- 商店 ---------- */
let shopSig = '';
function showShop() {
  if (!G.shopItems) return;
  ui.shopOverlay.classList.add('show');
  // 签名守卫：仅开新店/购买后重绘。此前的每帧重建会不断替换 DOM 节点，
  // 点击事件落在已移除的节点上——商店卡片因此无法点击（实机 bug）
  const sig = G.shopVisits + ':' + G.shopItems.map(it => it.sold ? 1 : 0).join('');
  if (sig === shopSig && ui.shopCards.childElementCount === G.shopItems.length) return;
  shopSig = sig;
  ui.shopCards.innerHTML = '';
  G.shopItems.forEach((it, i) => {
    const div = document.createElement('div');
    div.className = 'shopCard' + (it.sold ? ' sold' : '');
    const isUp = it.kind === 'chip' && G.chips.includes(it.chipId);
    div.innerHTML =
      '<div class="ccRarity" style="color:' + ['', '#a9a9b4', '#45f0e2', '#ffb84d'][it.rarity || 1] + '">' + it.name + (isUp ? ' · 升级' : '') + '</div>' +
      '<div class="sDesc">' + (isUp ? '已持有 → 升一级（效果 ×1.5）<br>' : '') + it.desc + '</div>' +
      '<div class="sPrice">' + (it.sold ? '已购入' : '\u25C6 ' + it.price + ' 金币') + '</div>';
    if (!it.sold) div.addEventListener('click', () => { G.shopBuy(i); AUDIO.play('buy'); });
    ui.shopCards.appendChild(div);
  });
}
ui.btnShopLeave.addEventListener('click', () => { AUDIO.play('ui'); G.shopLeave(); });

/* ---------- HUD ---------- */
let lastCombo = 0, comboPopT = 0, bossGhostV = 1;
function updateHUD(dt) {
  document.getElementById('hud').style.display = (G.state === 'title') ? 'none' : 'block';
  const P = G.player;
  // 生命
  const pipCount = P.maxHp;
  if (ui.hpPips.childElementCount !== pipCount) {
    ui.hpPips.innerHTML = '';
    for (let i = 0; i < pipCount; i++) {
      const d = document.createElement('div');
      d.className = 'pip';
      ui.hpPips.appendChild(d);
    }
  }
  for (let i = 0; i < pipCount; i++) {
    ui.hpPips.children[i].classList.toggle('on', i < P.hp);
  }
  ui.shieldFill.style.width = (P.shield / P.maxShield * 100) + '%';
  // 武器（按武器签名重建：换装不改数量，仅凭数量判断会残留旧文案）
  const wSig = G.weapons.map(w => w.id).join(',');
  if (ui.wpnRow.childElementCount !== G.weapons.length || ui.wpnRow.dataset.sig !== wSig) {
    ui.wpnRow.dataset.sig = wSig;
    ui.wpnRow.innerHTML = '';
    G.weapons.forEach((w, i) => {
      const d = document.createElement('div');
      d.className = 'wslot';
      d.textContent = (i + 1) + '·' + w.name;
      ui.wpnRow.appendChild(d);
    });
  }
  G.weapons.forEach((w, i) => {
    ui.wpnRow.children[i].classList.toggle('cur', i === G.weaponSlot);
  });
  ui.dashFill.style.width = ((1 - P.dashCd / (0.9 * G.stats.dashCd)) * 100) + '%';
  // 关卡
  const zone = C.ZONES[G.zoneIdx];
  ui.zoneLabel.textContent = G.state === 'title' ? '待命' : (G.daily ? '每日 · ' : '') + zone.name;
  ui.roomLabel.textContent = G.state === 'title' ? '' : (G.roomLabel || '');
  // 金币
  ui.coins.textContent = '金币 ' + G.coins;
  // 得分 / 连击
  ui.score.textContent = '得分 ' + G.score;
  if (G.combo >= 2) {
    ui.combo.textContent = '连击 ×' + G.combo;
    ui.combo.classList.toggle('hot', G.combo >= 10);
    if (G.combo !== lastCombo) { ui.combo.classList.remove('pop'); void ui.combo.offsetWidth; ui.combo.classList.add('pop'); }
  } else ui.combo.textContent = '';
  lastCombo = G.combo;
  // 晶片
  let html = '';
  for (const id of G.chips) {
    const c = C.CHIPS.find(x => x.id === id);
    const lv = (G.chipLv && G.chipLv[id]) || 0;
    html += '<span class="chipTag r' + c.rarity + '">' + c.name + (lv > 0 ? '·Lv' + (lv + 1) : '') + '</span>';
  }
  for (const syn of G.synActive) {
    html += '<span class="chipTag synTag">羁绊·' + syn.name + '</span>';
  }
  if (ui.hudBL.innerHTML !== html) ui.hudBL.innerHTML = html;
  // 提示
  if (G.prompt) { ui.prompt.textContent = G.prompt; ui.prompt.style.display = 'block'; }
  else ui.prompt.style.display = 'none';
  // 横幅
  if (G.banner) {
    ui.banner.classList.add('show');
    ui.bannerText.textContent = G.banner.text;
    ui.bannerText.style.color = G.banner.color;
    ui.bannerSub.textContent = G.banner.sub;
  } else ui.banner.classList.remove('show');
  // 浮动提示
  let tHtml = '';
  for (const t of G.toasts) {
    tHtml += '<div class="toast" style="color:' + t.color + '">' + t.text + '</div>';
  }
  if (ui.toasts.innerHTML !== tHtml) ui.toasts.innerHTML = tHtml;
  // Boss 条
  const boss = G.bossRef;
  const showBoss = boss && !boss.dead && G.isBossRoom;
  ui.bossBar.classList.toggle('show', !!showBoss);
  if (showBoss) {
    const frac = Math.max(0, boss.hp / boss.maxHp);
    bossGhostV += (frac - bossGhostV) * Math.min(1, dt * 3);
    ui.bossFill.style.width = (frac * 100) + '%';
    ui.bossGhost.style.width = (bossGhostV * 100) + '%';
    const ph = (boss.phases || C.BOSS_PHASES)[boss.phase - 1];
    ui.bossName.textContent = boss.name + ' —— ' + ['Ⅰ', 'Ⅱ', 'Ⅲ'][boss.phase - 1] + ' · ' + ph.name;
    ui.bossPhases.forEach((d, i) => d.classList.toggle('cur', i < boss.phase));
  } else bossGhostV = 1;
  // 受击 / 低血
  ui.fxHurt.style.opacity = G.hurtFx > 0 ? Math.min(1, G.hurtFx) : 0;
  const low = P.hp <= 2 && G.state === 'playing';
  ui.fxLow.classList.toggle('on', low);
}

/* ---------- 主循环 ---------- */
let last = performance.now(), acc = 0;
const STEP = 1 / 60;
let fpsN = 0, fpsT = 0, fpsV = 60;

function tick(dt) {
  readMove();
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
  if (fpsT >= 0.5) { fpsV = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; ui.fps.textContent = fpsV + ' FPS'; }
}

function drawFrame(dt) {
  // 渲染
  G.render(ctx, G.input.aimA == null ? mouse : null);
  if (G.fade > 0) {
    ctx.fillStyle = 'rgba(5,5,8,' + Math.min(1, G.fade) + ')';
    ctx.fillRect(0, 0, C.VIEW_W, C.VIEW_H);
  }
  // 界面
  updateHUD(dt || 0.016);
  if (G.state === 'chip' && G.chipOffer && !ui.chipOverlay.classList.contains('show')) showChipOffer();
  if (G.state !== 'chip') ui.chipOverlay.classList.remove('show');
  if (G.state === 'shop' && !ui.shopOverlay.classList.contains('show')) showShop();
  else if (G.state === 'shop') showShop();
  if (G.state !== 'shop') ui.shopOverlay.classList.remove('show');
  if ((G.state === 'victory' || G.state === 'defeat') && G.endScreen && !ui.screenEnd.classList.contains('show')) {
    showEnd(G.endScreen);
  }
}

/* 无头调试推进（供自动化截图 / QA 使用） */
window.__advance = function (frames) {
  for (let i = 0; i < frames; i++) tick(STEP);
};
window.__draw = function () { drawFrame(0.016); };

function showEnd(es) {
  if (es.victory) {
    const r = store.get() || { clears: 0, bestScore: 0, maxCombo: 0, bestTime: Infinity };
    r.clears = (r.clears || 0) + 1;
    r.bestScore = Math.max(r.bestScore || 0, es.stats.score);
    r.maxCombo = Math.max(r.maxCombo || 0, es.stats.maxCombo);
    r.bestTime = Math.min(r.bestTime || Infinity, es.stats.time);
    store.set(r);
  }
  showRecords();
  ui.endTitle.textContent = es.victory ? '通 关 胜 利' : '任 务 失 败';
  ui.endTitle.className = es.victory ? 'win' : 'lose';
  ui.endEn.textContent = es.victory ? '— VICTORY —' : '— GAME OVER —';
  ui.endRating.textContent = '评价 ' + es.stats.rating;
  ui.endStats.innerHTML =
    '<span>通关用时</span><b>' + es.stats.time.toFixed(1) + ' 秒</b>' +
    '<span>击杀数</span><b>' + es.stats.kills + '</b>' +
    '<span>最高连击</span><b>×' + es.stats.maxCombo + '</b>' +
    '<span>受击次数</span><b>' + es.stats.damageTaken + '</b>' +
    '<span>得分</span><b>' + es.stats.score + '</b>';
  if (G.daily) {
    const rank = recordDaily(es);
    const best = dailyBest();
    ui.endStats.innerHTML +=
      '<span>每日挑战</span><b>' + G.daily.name + '</b>' +
      '<span>每日排行</span><b>' + (rank ? '第 ' + rank + ' 名' : '未上榜') + '</b>' +
      '<span>今日最佳</span><b>' + (best ? best.score : '—') + '</b>';
  }
  ui.endChips.textContent =
    (es.stats.chips.length ? '晶片：' + es.stats.chips.join('、') : '晶片：无') +
    (es.stats.syn.length ? '　|　羁绊：' + es.stats.syn.join('、') : '');
  ui.screenEnd.classList.add('show');
  if (G.daily) buildDailyPanel();
  buildHeroCards();       // 通关后解锁态即时刷新（新英雄/晶片槽可能解锁）
  buildChipSlot();
}

requestAnimationFrame(frame);

})();
