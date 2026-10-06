/* ============================================================
 * 零号协议 ZERO PROTOCOL —— render.js
 * 像素渲染：精灵预渲染 / 瓦片地图 / 实体 / 弹幕发光 / 特效 / 浮字
 * 逻辑无关，headless 下不会加载。
 * ============================================================ */
(function (root) {
'use strict';
const C = root.ZERO_CORE;
const { TAU, clamp, lerp, dist, angDiff, VIEW_W, VIEW_H, TILE,
  WEAPONS, ZONES, BOSS_PHASES, FONT35, SPRITES, PAL } = C;

/* ---------- 精灵预渲染缓存 ---------- */
const spriteCache = new Map();
function makeSprite(name, tint) {
  const key = name + (tint || '');
  if (spriteCache.has(key)) return spriteCache.get(key);
  const def = SPRITES[name];
  if (!def) return null;
  const art = def.art, pal = def.pal;
  const w = Math.max(...art.map(r => r.length)), h = art.length;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < art[y].length; x++) {
    const ch = art[y][x];
    if (ch === '.' || ch === ' ') continue;
    ctx.fillStyle = pal[ch] || '#ff00ff';
    ctx.fillRect(x, y, 1, 1);
  }
  // 白色剪影（受击闪光）
  const fv = document.createElement('canvas');
  fv.width = w; fv.height = h;
  const fc = fv.getContext('2d');
  fc.drawImage(cv, 0, 0);
  fc.globalCompositeOperation = 'source-in';
  fc.fillStyle = '#ffffff';
  fc.fillRect(0, 0, w, h);
  const out = { cv, w, h, flash: fv };
  spriteCache.set(key, out);
  return out;
}

/* ---------- 发光贴图缓存 ---------- */
const glowCache = new Map();
function makeGlow(color, r) {
  const key = color + r;
  if (glowCache.has(key)) return glowCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = r * 2;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, color);
  g.addColorStop(0.5, color + '66');
  g.addColorStop(1, color + '00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, r * 2, r * 2);
  glowCache.set(key, cv);
  return cv;
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ---------- 3x5 像素字体 ---------- */
function pixelText(ctx, str, x, y, scale, color) {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of str) {
    const g = FONT35[ch];
    if (g) {
      for (let i = 0; i < 15; i++) {
        if (g[i] === '1') ctx.fillRect(cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale);
      }
    }
    cx += (g ? 4 : 2) * scale;
  }
}
function pixelTextW(str, scale) {
  let w = 0;
  for (const ch of str) w += (FONT35[ch] ? 4 : 2) * scale;
  return w;
}

/* ---------- 地图瓦片渲染缓存（每区域一张底图） ---------- */
const bgCache = new Map();
function renderBG(G) {
  const key = G.mapId;
  if (bgCache.has(key)) return bgCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = VIEW_W; cv.height = VIEW_H;
  const ctx = cv.getContext('2d');
  const accent = ZONES[G.zoneIdx] ? ZONES[G.zoneIdx].accent : '#45f0e2';
  // 地板
  ctx.fillStyle = '#121217';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  let seedN = 7;
  const rnd = () => { seedN = (seedN * 1103515245 + 12345) & 0x7fffffff; return seedN / 0x7fffffff; };
  for (let ty = 0; ty < G.mh; ty++) for (let tx = 0; tx < G.mw; tx++) {
    const x = tx * TILE, y = ty * TILE;
    if (G.solid[ty * G.mw + tx]) {
      // 墙体：顶面 + 正面
      const below = ty + 1 < G.mh ? G.solid[(ty + 1) * G.mw + tx] : 1;
      ctx.fillStyle = '#3a3a44';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#2b2b34';
      ctx.fillRect(x, y + TILE - 5, TILE, 5);
      if (!below) {
        ctx.fillStyle = '#3a3a44';
        ctx.fillRect(x, y, TILE, TILE - 6);
        ctx.fillStyle = '#23232b';
        ctx.fillRect(x, y + TILE - 6, TILE, 6);
      }
      ctx.fillStyle = '#565662';
      ctx.fillRect(x, y, TILE, 1);
      ctx.fillStyle = '#1a1a20';
      ctx.fillRect(x, y + TILE - 1, TILE, 1);
      if (rnd() < 0.22) { ctx.fillStyle = '#44444f'; ctx.fillRect(x + 2 + ((rnd() * 10) | 0), y + 2 + ((rnd() * 8) | 0), 2, 1); }
      if (rnd() < 0.1) { ctx.fillStyle = hexA(accent, 0.25); ctx.fillRect(x + 3, y + TILE - 4, 4, 1); }
    } else {
      // 地板：微网格 + 杂点
      ctx.fillStyle = (tx + ty) % 2 ? '#17171c' : '#15151a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#101015';
      ctx.fillRect(x, y, TILE, 1);
      ctx.fillRect(x, y, 1, TILE);
      const n = rnd();
      if (n < 0.16) { ctx.fillStyle = '#1d1d24'; ctx.fillRect(x + 3 + ((rnd() * 9) | 0), y + 3 + ((rnd() * 9) | 0), 2, 1); ctx.fillRect(x + 3 + ((rnd() * 9) | 0), y + 4 + ((rnd() * 8) | 0), 1, 1); }
      else if (n < 0.2) { ctx.fillStyle = hexA(accent, 0.13); ctx.fillRect(x + 7, y + 7, 2, 2); }
      else if (n < 0.24) { ctx.fillStyle = '#1a1a21'; ctx.fillRect(x + 2, y + 11, 5, 1); }
    }
  }
  bgCache.set(key, cv);
  return cv;
}

/* ---------- 附加到游戏实例 ---------- */
function attach(G) {
  const cv = document.createElement('canvas');
  G.render = function (ctx, mouse) {
    const t = G.time;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // 标题背景
    if (G.state === 'title') { drawTitleBg(ctx, t); ctx.restore(); return; }
    // 屏幕震动
    const sx = G.shake ? (Math.random() - 0.5) * G.shake * 2 : 0;
    const sy = G.shake ? (Math.random() - 0.5) * G.shake * 2 : 0;
    ctx.translate(Math.round(sx), Math.round(sy));

    ctx.drawImage(renderBG(G), 0, 0);
    const accent = ZONES[G.zoneIdx] ? ZONES[G.zoneIdx].accent : '#45f0e2';

    drawPortal(ctx, G.portal, t, accent);
    drawPickups(ctx, G, t);
    drawMines(ctx, G, t);
    drawWells(ctx, G, t);
    drawLasers(ctx, G, t);
    drawBossLaser(ctx, G.bossLaser, t);
    drawGhosts(ctx, G);
    drawEnemies(ctx, G, t);
    drawPlayer(ctx, G, t);
    drawBullets(ctx, G, t);
    drawBeams(ctx, G);
    drawRings(ctx, G);
    drawParticles(ctx, G);
    drawFloaters(ctx, G);
    drawSpawning(ctx, G, t);
    drawCrosshair(ctx, G, mouse, t);
    ctx.restore();

    // 全屏闪光（不受震动影响）
    if (G.flashFx > 0) {
      ctx.fillStyle = hexA(G.flashColor, Math.min(0.55, G.flashFx));
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  };
}

/* ---------- 标题背景 ---------- */
function drawTitleBg(ctx, t) {
  ctx.fillStyle = '#0b0b0f';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = '#14141a';
  const off = (t * 12) % 24;
  for (let x = -24; x < VIEW_W + 24; x += 24) ctx.fillRect(Math.round(x + off), 0, 1, VIEW_H);
  for (let y = -24; y < VIEW_H + 24; y += 24) ctx.fillRect(0, Math.round(y + off * 0.5), VIEW_W, 1);
  for (let i = 0; i < 26; i++) {
    const a = i * 2.4 + t * 0.4;
    const r = 40 + (i * 37 % 190);
    const x = VIEW_W / 2 + Math.cos(a) * r * 1.6;
    const y = VIEW_H / 2 + Math.sin(a) * r;
    const col = i % 5 === 0 ? '#45f0e2' : i % 5 === 1 ? '#ff4757' : '#3d3d48';
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
    ctx.globalAlpha = 1;
  }
}

/* ---------- 传送门 ---------- */
function drawPortal(ctx, portal, t, accent) {
  if (!portal) return;
  const { x, y } = portal;
  const pulse = 0.7 + Math.sin(t * 4) * 0.3;
  ctx.drawImage(makeGlow(accent, 18), x - 18, y - 18);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const r = 5 + i * 4 + Math.sin(t * 3 + i) * 1.5;
    const a0 = t * (2 + i * 0.8) + i * 2;
    ctx.beginPath();
    ctx.arc(x, y, r, a0, a0 + 4.2);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = pulse * 0.8;
  ctx.fillRect(x - 1, y - 1, 2, 2);
  ctx.globalAlpha = 1;
}

/* ---------- 拾取物 ---------- */
function drawPickups(ctx, G, t) {
  for (const pk of G.pickups) {
    const bobY = Math.sin(t * 3 + pk.x) * 1.5;
    const x = Math.round(pk.x), y = Math.round(pk.y + bobY);
    if (pk.kind === 'coin') {
      ctx.drawImage(makeGlow('#ffb84d', 7), x - 7, y - 7);
      ctx.fillStyle = '#ffb84d';
      ctx.fillRect(x - 2, y - 2, 4, 4);
      ctx.fillStyle = '#ffe6b0';
      ctx.fillRect(x - 1, y - 1, 2, 2);
      continue;
    }
    const sp = makeSprite(pk.kind === 'crate' ? 'crate' : pk.kind);
    if (!sp) continue;
    if (pk.kind !== 'crate') ctx.drawImage(makeGlow(pk.kind === 'heart' ? '#ff4757' : '#45f0e2', 10), x - 10, y - 10);
    ctx.drawImage(sp.cv, x - (sp.w >> 1), y - (sp.h >> 1));
    if (pk.kind === 'crate') {
      ctx.fillStyle = '#ffb84d';
      ctx.globalAlpha = 0.6 + Math.sin(t * 5) * 0.4;
      ctx.fillRect(x - 1, y - sp.h / 2 - 4, 2, 2);
      ctx.globalAlpha = 1;
    }
  }
}

/* ---------- 地雷 ---------- */
function drawMines(ctx, G, t) {
  for (const m of G.mines) {
    const frac = clamp(m.fuse / 1.05, 0, 1);
    const blink = (Math.sin(t * (14 + (1 - frac) * 26)) > 0) ? 1 : 0.25;
    ctx.strokeStyle = hexA('#ffb84d', 0.85);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r * (0.98 - (1 - frac) * 0.1), 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    // 落点扩散预警
    const shrink = m.r * frac;
    ctx.strokeStyle = hexA('#ffb84d', 0.5);
    ctx.beginPath();
    ctx.arc(m.x, m.y, Math.max(2, shrink), 0, TAU);
    ctx.stroke();
    ctx.fillStyle = hexA('#ffb84d', blink);
    ctx.fillRect(m.x - 2, m.y - 2, 4, 4);
    ctx.drawImage(makeGlow('#ffb84d', 8), m.x - 8, m.y - 8);
  }
}

/* ---------- 引力井（虚线圈 + 内旋粒子感 + 核心收缩预警） ---------- */
function drawWells(ctx, G, t) {
  for (const w of G.wells) {
    const frac = clamp(w.t / w.fuse, 0, 1);
    // 引力范围
    ctx.strokeStyle = hexA('#ffb84d', 0.22 + frac * 0.15);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(w.x, w.y, w.r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    // 内旋碎片
    for (let i = 0; i < 3; i++) {
      const a = t * (2.4 + i * 0.6) + i * 2.1;
      const rr = w.r * (0.9 - frac * 0.55) * (0.55 + 0.45 * Math.sin(t * 3.1 + i * 2.2));
      const x = w.x + Math.cos(a) * rr, y = w.y + Math.sin(a) * rr * 0.8;
      ctx.fillStyle = hexA('#ffb84d', 0.55);
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    // 收缩核心（内爆预警）
    ctx.strokeStyle = hexA('#ffb84d', 0.55 + frac * 0.45);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(w.x, w.y, Math.max(2.5, (1 - frac) * 16), 0, TAU);
    ctx.stroke();
    ctx.drawImage(makeGlow('#ffb84d', 8), w.x - 8, w.y - 8);
  }
}

/* ---------- 狙击激光瞄准线 ---------- */
function drawLasers(ctx, G, t) {
  for (const l of G.lasers) {
    const locked = l.phase === 'lock';
    const a = locked ? 0.9 : 0.35 + Math.sin(t * 20) * 0.15;
    ctx.strokeStyle = hexA('#ff4757', a);
    ctx.lineWidth = locked ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(l.x0, l.y0);
    ctx.lineTo(l.x1, l.y1);
    ctx.stroke();
    ctx.fillStyle = hexA('#ff4757', 0.9);
    ctx.fillRect(l.x1 - 1, l.y1 - 1, 2, 2);
  }
}

/* ---------- Boss 扇形扫射激光 ---------- */
function drawBossLaser(ctx, L, t) {
  if (!L || L.phase === 'done') return;
  if (L.phase === 'charge') {
    // 蓄力预告：细线
    const prog = clamp(L.t / L.charge, 0, 1);
    const base = lerp(L.a0, L.a1, prog);
    for (let i = 0; i < L.count; i++) {
      const a = base + (i / (L.count - 1) - 0.5) * L.spread;
      const hit = G0ray(ctx, L.x0, L.y0, a);
      ctx.strokeStyle = hexA('#ff4757', 0.18 + prog * 0.4);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L.x0, L.y0); ctx.lineTo(hit.x, hit.y); ctx.stroke();
    }
  } else if (L.phase === 'fire' && L.beams) {
    for (const b of L.beams) {
      ctx.strokeStyle = hexA('#ff4757', 0.9);
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke();
      ctx.drawImage(makeGlow('#ff4757', 10), b.x1 - 10, b.y1 - 10);
    }
  }
}
function G0ray(ctx, x, y, a) {
  // 渲染层用的射线终点（粗略，用于预告线）
  const steps = 130;
  for (let i = 1; i <= steps; i++) {
    const x1 = x + Math.cos(a) * i * 4, y1 = y + Math.sin(a) * i * 4;
    if (x1 < 0 || y1 < 0 || x1 > VIEW_W || y1 > VIEW_H) return { x: x1, y: y1 };
  }
  return { x: x + Math.cos(a) * 520, y: y + Math.sin(a) * 520 };
}

/* ---------- 残影 ---------- */
function drawGhosts(ctx, G) {
  for (const gh of G.ghosts) {
    ctx.globalAlpha = (gh.life / gh.max) * 0.4;
    ctx.fillStyle = '#45f0e2';
    const x = Math.round(gh.x), y = Math.round(gh.y);
    ctx.fillRect(x - 4, y - 5, 8, 10);
    ctx.globalAlpha = 1;
  }
}

/* ---------- 玩家 ---------- */
function drawPlayer(ctx, G, t) {
  const P = G.player;
  if (G.state === 'defeat') return;
  const x = Math.round(P.x), y = Math.round(P.y + Math.sin(P.bob * 6) * 0.5);
  // 护盾光环
  if (P.shield > 0) {
    ctx.strokeStyle = hexA('#45f0e2', 0.25 + Math.sin(t * 3) * 0.1);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, TAU);
    ctx.stroke();
  }
  // 无敌闪烁
  const blink = P.iframes > 0 && Math.floor(t * 18) % 2 === 0;
  if (!blink) {
    const sp = makeSprite('player');
    if (sp) {
      ctx.drawImage(sp.cv, x - (sp.w >> 1), y - (sp.h >> 1));
      if (P.flashWhite > 0) { ctx.globalAlpha = P.flashWhite; ctx.drawImage(sp.flash, x - (sp.w >> 1), y - (sp.h >> 1)); ctx.globalAlpha = 1; }
    }
  }
  // 武器（朝向 aim）
  const w = G.weapons[G.weaponSlot];
  const sp = makeSprite(w.id);
  if (sp && w.type !== 'melee') {
    const rec = P.recoil * 2;
    ctx.save();
    ctx.translate(x + Math.cos(P.aimA) * (6 - rec), y + Math.sin(P.aimA) * (6 - rec) + 1);
    ctx.rotate(P.aimA);
    if (Math.cos(P.aimA) < 0) ctx.scale(1, -1);
    ctx.drawImage(sp.cv, -2, -(sp.h >> 1));
    ctx.restore();
    // 枪口火光
    if (P.muzzleT > 0) {
      const mx = x + Math.cos(P.aimA) * 12, my = y + Math.sin(P.aimA) * 12;
      ctx.drawImage(makeGlow(w.color, 7), mx - 7, my - 7);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(mx - 1, my - 1, 3, 3);
    }
    // 电磁炮蓄力
    if (w.type === 'rail' && P.chargeT > 0) {
      const prog = clamp(P.chargeT / w.charge, 0, 1);
      const mx = x + Math.cos(P.aimA) * 12, my = y + Math.sin(P.aimA) * 12;
      const ex = x + Math.cos(P.aimA) * 90, ey = y + Math.sin(P.aimA) * 90;
      ctx.strokeStyle = hexA('#b9bcff', 0.2 + prog * 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.drawImage(makeGlow('#b9bcff', 4 + prog * 6), mx - 10, my - 10);
    }
  }
  // 相位刃挥砍弧
  if (P.slashT > 0) {
    const prog = 1 - P.slashT / 0.16;
    const a0 = P.slashA - 0.95 + prog * 1.9;
    const range = 26 * G.stats.meleeRange;
    ctx.strokeStyle = hexA('#ffffff', 0.9);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, range * 0.8, a0 - 0.55, a0 + 0.55);
    ctx.stroke();
    ctx.strokeStyle = hexA('#45f0e2', 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, range * 0.95, a0 - 0.4, a0 + 0.4);
    ctx.stroke();
  }
  // 复仇状态提示
  if (G.vengeanceT > 0) {
    ctx.strokeStyle = hexA('#ff4757', 0.4 + Math.sin(t * 10) * 0.2);
    ctx.beginPath(); ctx.arc(x, y, 10, 0, TAU); ctx.stroke();
  }
}

/* ---------- 敌人 ---------- */
function drawEnemies(ctx, G, t) {
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (e.spawning > 0) continue; // 生成预告单独绘制
    const x = Math.round(e.x), y = Math.round(e.y);
    const sp = makeSprite(e.type);
    if (!sp) continue;
    const sc = e.elite ? 1.18 : 1;
    const bob = e.type === 'boss' ? Math.sin(t * 2) * 1.5 : Math.sin(t * 4 + e.id) * 0.5;
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + e.r + 1, e.r * 0.9, e.r * 0.4, 0, 0, TAU);
    ctx.fill();
    if (e.isBoss) {
      // 阶段色核心
      const pc = (e.phases || BOSS_PHASES)[e.phase - 1].color;
      ctx.drawImage(makeGlow(pc, 22), x - 22, y - 22 + bob);
      ctx.save();
      if (Math.cos(e.aimA || 0) < 0) { /* boss 对称，不翻转 */ }
      ctx.drawImage(sp.cv, x - (sp.w >> 1), y - (sp.h >> 1) + Math.round(bob));
      if (e.flash > 0) { ctx.globalAlpha = e.flash; ctx.drawImage(sp.flash, x - (sp.w >> 1), y - (sp.h >> 1) + Math.round(bob)); ctx.globalAlpha = 1; }
      // 核心亮点
      const pulse = 0.6 + Math.sin(t * 6) * 0.4;
      ctx.fillStyle = pc;
      ctx.globalAlpha = pulse;
      ctx.fillRect(x - 2, y - 2 + Math.round(bob), 5, 5);
      ctx.globalAlpha = 1;
      // 蓄力提示
      if (e.st === 'attack' && e.atk && !e.atk.fired && e.atk.t < 0.35) {
        ctx.strokeStyle = hexA(pc, 0.8);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 18 + e.atk.t * 30, 0, TAU); ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    if (e.elite) ctx.drawImage(makeGlow('#ff4757', 13), x - 13, y - 13 + bob);
    ctx.save();
    if (e.type !== 'guard') {
      ctx.translate(x, y + bob);
      const face = e.facing || 0;
      if (Math.cos(face) < 0) ctx.scale(-1, 1);
      ctx.drawImage(sp.cv, -(sp.w * sc >> 1), -(sp.h * sc >> 1), sp.w * sc, sp.h * sc);
      if (e.flash > 0) { ctx.globalAlpha = Math.min(1, e.flash); ctx.drawImage(sp.flash, -(sp.w * sc >> 1), -(sp.h * sc >> 1), sp.w * sc, sp.h * sc); ctx.globalAlpha = 1; }
    } else {
      ctx.translate(x, y + bob);
      const face = e.facing || 0;
      if (Math.cos(face) < 0) ctx.scale(-1, 1);
      ctx.drawImage(sp.cv, -(sp.w * sc >> 1), -(sp.h * sc >> 1), sp.w * sc, sp.h * sc);
      if (e.flash > 0) { ctx.globalAlpha = Math.min(1, e.flash); ctx.drawImage(sp.flash, -(sp.w * sc >> 1), -(sp.h * sc >> 1), sp.w * sc, sp.h * sc); ctx.globalAlpha = 1; }
      // 盾牌高亮 / 破盾状态
      if (e.broken > 0) {
        ctx.fillStyle = hexA('#ff4757', 0.5 + Math.sin(t * 12) * 0.3);
        ctx.fillRect(2, -7, 2, 14);
      } else {
        ctx.strokeStyle = hexA('#c8fff8', 0.35);
        ctx.lineWidth = 1;
        ctx.strokeRect(3.5, -6.5, 6, 12);
      }
    }
    ctx.restore();
    // 自爆蜂起爆预警
    if (e.type === 'bomber' && e.state === 'arm') {
      ctx.strokeStyle = hexA('#ff4757', 0.5 + Math.sin(t * 30) * 0.4);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 12 + (e.t / 0.5) * 18, 0, TAU);
      ctx.stroke();
    }
    // 冰霜减速光环
    if (e.slowT > 0) {
      ctx.strokeStyle = hexA('#45f0e2', 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, e.r + 3.5, 0, TAU);
      ctx.stroke();
    }
    // 血条（受损时）
    if (e.hp < e.maxHp) {
      const bw = Math.max(10, e.r * 2.4);
      const frac = clamp(e.hp / e.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - bw / 2, y - e.r - 6, bw, 2);
      ctx.fillStyle = frac > 0.4 ? '#e8e8ee' : '#ff4757';
      ctx.fillRect(x - bw / 2, y - e.r - 6, bw * frac, 2);
    }
    // 防暴盾卫冲锋预警
    if (e.type === 'charger' && e.state === 'aim') {
      ctx.strokeStyle = hexA('#ff4757', 0.5 + Math.sin(t * 22) * 0.3);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(e.dashA || 0) * 60, y + Math.sin(e.dashA || 0) * 60);
      ctx.stroke();
    }
  }
}

/* ---------- 生成预告 ---------- */
function drawSpawning(ctx, G, t) {
  const accent = ZONES[G.zoneIdx] ? ZONES[G.zoneIdx].accent : '#45f0e2';
  for (const e of G.enemies) {
    if (e.dead || e.spawning <= 0) continue;
    const prog = 1 - e.spawning / 0.7;
    const x = Math.round(e.x), y = Math.round(e.y);
    ctx.strokeStyle = hexA(accent, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 10 * (1 - prog) + 3, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = hexA(accent, 0.35);
    ctx.fillRect(x - 1, y - 12 + 12 * prog, 2, 12 - 12 * prog + 2);
    ctx.globalAlpha = prog * 0.8;
    const sp = makeSprite(e.type);
    if (sp) ctx.drawImage(sp.cv, x - (sp.w >> 1), y - (sp.h >> 1));
    ctx.globalAlpha = 1;
  }
}

/* ---------- 子弹 ---------- */
function drawBullets(ctx, G, t) {
  for (const b of G.bullets) {
    const x = b.x, y = b.y;
    // 拖尾
    const vl = Math.hypot(b.vx, b.vy) || 1;
    const tl = b.friendly ? 7 : 5;
    ctx.strokeStyle = hexA(b.friendly ? b.color : '#ff4757', 0.4);
    ctx.lineWidth = b.r * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - b.vx / vl * tl, y - b.vy / vl * tl);
    ctx.stroke();
    // 发光
    if (b.glow) ctx.drawImage(makeGlow(b.friendly ? b.color : '#ff4757', 5), x - 5, y - 5);
    // 弹体
    ctx.fillStyle = b.friendly ? b.color : '#ff4757';
    ctx.fillRect(Math.round(x - b.r / 1.4), Math.round(y - b.r / 1.4), Math.ceil(b.r / 1.4 * 2), Math.ceil(b.r / 1.4 * 2));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(x - 0.5), Math.round(y - 0.5), 1.5, 1.5);
  }
}

/* ---------- 射线（电磁炮 / 狙击开火） ---------- */
function drawBeams(ctx, G) {
  for (const b of G.beams) {
    const prog = b.t / b.max;
    ctx.strokeStyle = hexA(b.color, 0.85 * prog);
    ctx.lineWidth = (b.w0 || 4) * prog + 1;
    ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke();
    ctx.strokeStyle = hexA('#ffffff', prog);
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke();
  }
}

/* ---------- 粒子 / 波纹 / 浮字 ---------- */
function drawParticles(ctx, G) {
  for (const p of G.particles) {
    const a = clamp(p.life / 0.5, 0, 1);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = a;
    const s = Math.max(1, p.size * a);
    ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), Math.ceil(s), Math.ceil(s));
  }
  ctx.globalAlpha = 1;
}
function drawRings(ctx, G) {
  for (const r of G.rings) {
    ctx.strokeStyle = hexA(r.color, clamp(r.life / r.max, 0, 1));
    ctx.lineWidth = r.width;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, TAU);
    ctx.stroke();
  }
}
function drawFloaters(ctx, G) {
  for (const f of G.floaters) {
    const a = clamp(f.life / f.max, 0, 1);
    const scale = f.big ? 2 : 1;
    const w = pixelTextW(f.txt, scale);
    ctx.globalAlpha = a;
    pixelText(ctx, f.txt, Math.round(f.x - w / 2), Math.round(f.y), scale, f.color);
    ctx.globalAlpha = 1;
  }
}

/* ---------- 准星 ---------- */
function drawCrosshair(ctx, G, mouse, t) {
  if (G.input.aimA != null) return; // bot 代打时不画鼠标准星
  if (!mouse) return;
  const x = Math.round(mouse.x), y = Math.round(mouse.y);
  const P = G.player;
  const firing = G.input.fire;
  const r = firing ? 6 : 8;
  ctx.strokeStyle = 'rgba(232,232,238,0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(69,240,226,0.9)';
  ctx.fillRect(x - 0.5, y - 0.5, 1.5, 1.5);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * (r + 2), y + Math.sin(a) * (r + 2));
    ctx.lineTo(x + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5));
    ctx.stroke();
  }
}

root.ZERO_RENDER = { attach, makeSprite };
if (typeof module !== 'undefined' && module.exports) module.exports = root.ZERO_RENDER;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
