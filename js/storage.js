/* ============================================================
 * 零号协议 ZERO PROTOCOL —— storage.js
 * localStorage 数据层：历史纪录 zp_records / 每日排行 zp_daily / 元进度 zp_meta
 * 纯函数、不持有 DOM 引用（DOM 渲染在 ui.js，写档编排在 main.js）
 * ============================================================ */
(function () {
'use strict';
const C = window.ZERO_CORE;

/* ---------- 每日挑战：日期 → 固定种子 + 修改器 ---------- */
const _d = new Date();
const todayStr = _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()).padStart(2, '0');
const today = C.dailyForDate(todayStr);

/* 历史纪录（localStorage，file:// 下同样可用） */
const store = {
  get() {
    try {
      const v = JSON.parse(localStorage.getItem('zp_records') || 'null');
      return (v && typeof v === 'object') ? v : null;   // 形状校验:外部改写为标量时不炸标题
    } catch (e) { return null; }
  },
  set(v) { try { localStorage.setItem('zp_records', JSON.stringify(v)); } catch (e) {} },
};

/* 每日挑战：本地排行（localStorage，每日保留前 5 名） */
const dStore = {
  get() {
    try {
      const v = JSON.parse(localStorage.getItem('zp_daily') || '{}');
      return (v && typeof v === 'object') ? v : {};
    } catch (e) { return {}; }
  },
  set(v) { try { localStorage.setItem('zp_daily', JSON.stringify(v)); } catch (e) {} },
};

/* 元进度：初始晶片槽选择（localStorage zp_meta；解锁条件读 zp_records.clears） */
const meta = {
  get() {
    try {
      const v = JSON.parse(localStorage.getItem('zp_meta') || '{}');
      return (v && typeof v === 'object') ? v : {};
    } catch (e) { return {}; }
  },
  set(v) { try { localStorage.setItem('zp_meta', JSON.stringify(v)); } catch (e) {} },
};

/* 元进度解锁推导（仅 UI 门控：无头仿真 / URL 回放不受影响） */
function unlocks() {
  const r = store.get() || {};
  const clears = r.clears || 0;
  return {
    heroZero: clears >= 1,   // 零·原型机：累计通关 1 次
    chipSlot: clears >= 3,   // 初始晶片槽：累计通关 3 次
  };
}

/* 初始晶片槽当前选中的晶片 id（未解锁 / 存值非法时返回空串） */
function startChipId() {
  if (!unlocks().chipSlot) return '';
  const sc = meta.get().startChip || '';
  return C.CHIPS.some(c => c.id === sc) ? sc : '';
}

/* 今日排行榜第一名（无记录返回 null） */
function dailyBest(difficulty='standard') { const l = dStore.get()[today.date + ':' + difficulty]; return l && l.length ? l[0] : null; }

/* 结算写入每日排行，返回名次（G 仅用于取英雄名） */
function recordDaily(es, G) {
  const b = dStore.get();
  const key = today.date + ':' + G.difficultyId;
  const list = b[key] || [];
  const entry = { score: es.stats.score, time: +es.stats.time.toFixed(1), kills: es.stats.kills,
    hero: (C.HEROES[G.heroId] || C.HEROES.vanguard).name, rating: es.stats.rating, difficulty: G.difficultyId };
  list.push(entry);
  list.sort((x, y) => y.score - x.score);
  const rank = list.indexOf(entry) + 1;   // 挤出前 5 则记 0（未上榜）
  b[key] = list.slice(0, 5);
  dStore.set(b);
  return rank;
}

window.ZERO_STORAGE = {
  today,
  getRecords: store.get, setRecords: store.set,   // zp_records
  getDaily: dStore.get, setDaily: dStore.set,     // zp_daily
  getMeta: meta.get, setMeta: meta.set,           // zp_meta
  unlocks, startChipId, dailyBest, recordDaily,
};
})();
