/* ============================================================
 * 零号协议 ZERO PROTOCOL —— hud.js
 * 对局 HUD DOM 更新：生命/护盾/武器/冲刺/关卡/金币/得分/连击/晶片/提示/
 * 横幅/浮动提示/Boss 条/受击与低血特效
 * init(ui, G) 注入 DOM 引用与游戏实例；每帧入口 update(dt)
 * ============================================================ */
(function () {
'use strict';
const C = window.ZERO_CORE;

let ui = null, G = null;
let lastCombo = 0, comboPopT = 0, bossGhostV = 1;
const toastEls = new Map(); // 存活 toast 对象 → DOM 节点(增量更新用)

function init(uiRefs, game) { ui = uiRefs; G = game; }

function update(dt) {
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
  // 浮动提示(按 toast 对象增量增删:全量 innerHTML 会让存留 toast 重播入场动画)
  const alive = new Map();
  for (const t of G.toasts) {
    let el = toastEls.get(t);
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.textContent = t.text;
      el.style.color = t.color;
      toastEls.set(t, el);
      ui.toasts.appendChild(el);
    }
    alive.set(t, el);
  }
  for (const [t, el] of toastEls) {
    if (!alive.has(t)) { el.remove(); toastEls.delete(t); }
  }
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

window.ZERO_HUD = { init, update };
})();
