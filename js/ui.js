/* ============================================================
 * 零号协议 ZERO PROTOCOL —— ui.js
 * 界面流转：标题构建（英雄卡/每日面板/晶片槽/纪录）/ 晶片三选一 / 商店 /
 * 结算屏 / 暂停 / 帮助 / 覆盖层逐帧流转
 * init(deps) 注入 G 与回调；DOM 引用集中在模块内 ui 对象（经 ZERO_UI.els 暴露）
 * 浮动提示/横幅的 DOM 渲染归 hud.js（toastEls 增量逻辑仅存于彼处）
 * ============================================================ */
(function () {
'use strict';
const C = window.ZERO_CORE, AUDIO = window.ZERO_AUDIO, STORAGE = window.ZERO_STORAGE;

const el = (id) => document.getElementById(id);
let ui = null, G = null, deps = null;
let shopSig = ''; // 商店签名守卫用（onRunStart 跨局失效）

/* init(deps) 依赖注入面：
 *   G            游戏实例（读 state/chipOffer/shopItems 等，调 chooseChip/shopBuy/shopLeave）
 *   startRun(withBot, dailyRun)  开始/重试按钮
 *   getBotOn() / getRunDaily()   重试按钮沿用本局设置
 *   getSelHero() / setSelHero(h) 英雄选中态（选中状态归 main，UI 只经此读写） */
function init(d) {
  deps = d;
  G = d.G;
  ui = {
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

  ui.btnStart.addEventListener('click', () => { AUDIO.play('ui'); deps.startRun(false); });
  ui.btnBot.addEventListener('click', () => { AUDIO.play('ui'); deps.startRun(true); });
  const btnDaily = el('btnDaily');
  if (btnDaily) btnDaily.addEventListener('click', () => { AUDIO.play('ui'); deps.startRun(false, true); });
  ui.btnHelp.addEventListener('click', () => {
    AUDIO.play('ui');
    ui.helpBox.style.display = ui.helpBox.style.display === 'none' ? 'block' : 'none';
  });
  ui.btnRetry.addEventListener('click', () => { AUDIO.play('ui'); deps.startRun(deps.getBotOn(), deps.getRunDaily()); });
  ui.btnShopLeave.addEventListener('click', () => { AUDIO.play('ui'); G.shopLeave(); });

  // 标题界面初始构建（拆分前为 main.js 加载末尾的同步执行，顺序不变）
  buildHeroCards();
  showRecords();
  buildDailyPanel();
  buildChipSlot();
}

/* ---------- 标题：历史纪录（数据读 storage，渲染在此） ---------- */
function showRecords() {
  const el2 = document.getElementById('records');
  if (!el2) return;
  const r = STORAGE.getRecords();
  el2.textContent = r ? ('最佳纪录 · 通关 ' + r.clears + ' 次 · 最高分 ' + r.bestScore + ' · 最高连击 ×' + r.maxCombo + (isFinite(r.bestTime) ? ' · 最速 ' + r.bestTime.toFixed(0) + 's' : '')) : '尚无通关纪录 · 成为第一位协议完成者';
}

/* ---------- 标题：每日挑战面板 ---------- */
function buildDailyPanel() {
  const elDate = document.getElementById('dailyDate');
  if (!elDate) return;
  const today = STORAGE.today;
  elDate.textContent = today.date + ' · ' + today.seed;
  document.getElementById('dailyMods').innerHTML = today.mods.map(m =>
    '<div class="dailyMod"><b>▍' + m.name + '</b>' + m.desc + '</div>').join('');
  const best = STORAGE.dailyBest();
  document.getElementById('dailyBest').textContent = best
    ? ('今日最佳 ' + best.score + ' 分 · ' + best.hero)
    : '今日暂无记录 · 虚位以待';
}

/* ---------- 标题：英雄选择卡片（含元进度锁定：仅 UI 门控，无头仿真/URL 回放不受影响） ---------- */
function buildHeroCards() {
  const row = document.getElementById('heroRow');
  if (!row) return;
  row.innerHTML = '';
  const un = STORAGE.unlocks();
  for (const hid of Object.keys(C.HEROES)) {
    const h = C.HEROES[hid];
    const locked = hid === 'prototype' && !un.heroZero;
    const d = document.createElement('div');
    d.className = 'heroCard' + (hid === deps.getSelHero() ? ' sel' : '') + (locked ? ' locked' : '');
    d.innerHTML = '<div class="hName">' + (locked ? '🔒 ' : '') + h.name + '</div>' +
      '<div class="hDesc">' + (locked ? '<span class="lockedTag">累计通关 1 次解锁</span>' : h.desc) + '</div>';
    if (window.ZERO_RENDER) d.prepend(window.ZERO_RENDER.icon(hid));
    d.addEventListener('click', () => {
      if (locked) { AUDIO.play('clink'); G.toast && G.toast('未解锁：累计通关 1 次以启动零号原型机', '#8b8b98'); return; }
      deps.setSelHero(hid); AUDIO.play('ui');
      row.querySelectorAll('.heroCard').forEach(x => x.classList.remove('sel'));
      d.classList.add('sel');
    });
    row.appendChild(d);
  }
}

/* ---------- 标题：初始晶片槽（元进度解锁后可选起手晶片） ---------- */
function buildChipSlot() {
  const row = document.getElementById('chipSlot');
  const label = document.getElementById('chipSlotLabel');
  if (!row || !label) return;
  if (!STORAGE.unlocks().chipSlot) {
    label.textContent = '初始晶片槽 · 累计通关 3 次解锁';
    row.innerHTML = '';
    row.classList.add('lockedSlot');
    return;
  }
  label.textContent = '初始晶片槽（点选起手晶片 · 再点取消）';
  row.classList.remove('lockedSlot');
  const cur = STORAGE.getMeta().startChip || '';
  row.innerHTML = '';
  for (const c of C.CHIPS) {
    const t = document.createElement('span');
    t.className = 'chipTag r' + c.rarity + (cur === c.id ? ' sel' : '');
    t.textContent = c.name;
    t.addEventListener('click', () => {
      const m = STORAGE.getMeta();
      m.startChip = (m.startChip === c.id) ? '' : c.id;
      STORAGE.setMeta(m);
      AUDIO.play('ui');
      buildChipSlot();
    });
    row.appendChild(t);
  }
}

/* ---------- 暂停 ---------- */
function showPause(on) { ui.screenPause.classList.toggle('show', on); }
function togglePause() { // P 键 / 手柄 Start / 触控暂停钮共用(仅 playing↔paused)
  if (G.state === 'playing') { G.state = 'paused'; showPause(true); }
  else if (G.state === 'paused') { G.state = 'playing'; showPause(false); }
}

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
    if (window.ZERO_RENDER) div.prepend(window.ZERO_RENDER.icon(c.id));
    div.addEventListener('click', () => { AUDIO.play('chipPick'); G.chooseChip(i); });
    ui.chipCards.appendChild(div);
  });
  ui.chipOverlay.classList.add('show');
}

/* ---------- 商店 ---------- */
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
    if (window.ZERO_RENDER) div.prepend(window.ZERO_RENDER.icon(it.chipId || it.weapon || (it.kind === 'heal' ? 'heart' : it.kind === 'power' ? 'power' : 'battery')));
    if (!it.sold) div.addEventListener('click', () => { G.shopBuy(i); AUDIO.play('buy'); });
    ui.shopCards.appendChild(div);
  });
}

/* ---------- 结算屏（纪录写入在 main.settleEnd，先于本函数发生） ---------- */
function showEnd(es, daily) {
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
  if (daily) {
    ui.endStats.innerHTML +=
      '<span>每日挑战</span><b>' + G.daily.name + '</b>' +
      '<span>每日排行</span><b>' + (daily.rank ? '第 ' + daily.rank + ' 名' : '未上榜') + '</b>' +
      '<span>今日最佳</span><b>' + (daily.best ? daily.best.score : '—') + '</b>';
  }
  ui.endChips.textContent =
    (es.stats.chips.length ? '晶片：' + es.stats.chips.join('、') : '晶片：无') +
    (es.stats.syn.length ? '　|　羁绊：' + es.stats.syn.join('、') : '');
  ui.screenEnd.classList.add('show');
  if (G.daily) buildDailyPanel();
  buildHeroCards();       // 通关后解锁态即时刷新（新英雄/晶片槽可能解锁）
  buildChipSlot();
}

/* ---------- 开局时的界面复位（由 main.startRun 调用，时序与拆分前一致） ---------- */
function onRunStart() {
  shopSig = '';   // 跨局失效:shopVisits 会被 startRun 归零,签名撞车会显示上一局的商品
  ui.screenTitle.classList.remove('show');
  ui.screenEnd.classList.remove('show');
}

/* ---------- 每帧覆盖层流转（drawFrame 调用；settleEnd 为 main 的结算写纪录） ---------- */
function updateOverlays(settleEnd) {
  if (G.state === 'chip' && G.chipOffer && !ui.chipOverlay.classList.contains('show')) showChipOffer();
  if (G.state !== 'chip') ui.chipOverlay.classList.remove('show');
  if (G.state === 'shop') showShop();
  if (G.state !== 'shop') ui.shopOverlay.classList.remove('show');
  if ((G.state === 'victory' || G.state === 'defeat') && G.endScreen && !ui.screenEnd.classList.contains('show')) {
    if (G.state === 'defeat' && G.visualPlayback && !G.visualPlayback.deathDone()) return;
    showEnd(G.endScreen, settleEnd(G.endScreen));
  }
}

window.ZERO_UI = {
  get els() { return ui; },
  init, togglePause, onRunStart, updateOverlays,
};
})();
