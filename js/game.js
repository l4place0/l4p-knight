/* ============================================================
 * 零号协议 ZERO PROTOCOL —— game.js
 * 游戏核心逻辑：玩家 / 敌人AI / Boss三阶段 / 子弹 / 碰撞 / 波次 / 晶片
 * 逻辑与渲染完全分离：headless 模式下可在 Node 中直接 update(dt)。
 * ============================================================ */
(function (root) {
'use strict';
const C = root.ZERO_CORE;
const { TAU, clamp, lerp, dist, angDiff, RNG, VIEW_W, VIEW_H, TILE,
  WEAPONS, ENEMY_DEFS, CHIPS, SYNERGIES, HEROES, MAPS, ZONES, BOSS_PHASES } = C;

function createGame(opts) {
  opts = opts || {};
  const headless = !!opts.headless;
  const seed = opts.seed || 1;
  const rng = RNG(seed);

  const G = {
    seed, rng, headless,
    state: 'title',          // title | playing | chip | victory | defeat
    time: 0, runTime: 0,
    timeScale: 1, hitstop: 0,
    shake: 0, flashFx: 0, flashColor: '#ffffff', hurtFx: 0, fade: 0,
    banner: null, toasts: [], prompt: null,
    zoneIdx: 0, roomIdx: 0, isBossRoom: false,
    enemies: [], bullets: [], pickups: [], mines: [],
    lasers: [], beams: [], bossLaser: null, wells: [],
    particles: [], floaters: [], rings: [], ghosts: [],
    chips: [], synActive: [],
    stats: null,
    combo: 0, comboT: 0, maxCombo: 0,
    coins: 0, coinsCollected: 0, shopVisits: 0, shopItems: null,
    heroId: 'vanguard', bonusShield: 0, powerBonus: 0, dashEchoT: 0,
    score: 0, kills: 0, damageTaken: 0,
    eid: 0, wavIdx: 0, waves: [], pendSpawns: [], waveDelay: 0, roomClearT: 0,
    portal: null, chipOffer: null, endScreen: null, bossDown: {},
    input: { mx: VIEW_W / 2, my: VIEW_H / 2, aimA: null, moveX: 0, moveY: 0, fire: false, dash: false, melee: false, interact: false, slot: -1 },
    deathLog: '', botOn: false,
  };
  G.sfx = function (name, p) {
    if (headless) return;
    const A = root.ZERO_AUDIO;
    if (A) A.play(name, p);
  };

  /* ---------------- 地图 ---------------- */
  G.mapId = 'z1a'; G.mw = 30; G.mh = 17; G.solid = null; G.floorSpots = [];
  function loadMap(id) {
    const m = MAPS[id]; G.mapId = id;
    G.mw = m[0].length; G.mh = m.length;
    G.solid = new Uint8Array(G.mw * G.mh);
    G.floorSpots = [];
    for (let y = 0; y < G.mh; y++) for (let x = 0; x < G.mw; x++) {
      const ch = m[y][x];
      if (ch === '#') G.solid[y * G.mw + x] = 1;
      else G.floorSpots.push({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
    }
  }
  /* 从玩家出生瓦片做 BFS，只把"可达"地面作为刷怪/交互点（杜绝封闭凹室僵局） */
  function computeReachable(px, py) {
    const seen = new Uint8Array(G.mw * G.mh);
    const q = [[Math.floor(px / TILE), Math.floor(py / TILE)]];
    seen[q[0][1] * G.mw + q[0][0]] = 1;
    const spots = [];
    while (q.length) {
      const [tx, ty] = q.pop();
      spots.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
      const nb = [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= G.mw || ny >= G.mh) continue;
        const k = ny * G.mw + nx;
        if (seen[k] || G.solid[k]) continue;
        seen[k] = 1;
        q.push([nx, ny]);
      }
    }
    G.spawnSpots = spots;
  }
  G.solidAt = function (tx, ty) {
    if (tx < 0 || ty < 0 || tx >= G.mw || ty >= G.mh) return 1;
    return G.solid[ty * G.mw + tx];
  };
  G.boxHitsWall = boxHitsWall;
  G.solidAtPx = function (x, y) { return G.solidAt(Math.floor(x / TILE), Math.floor(y / TILE)); };

  /* ---------------- 碰撞（AABB 对瓦片，逐轴解析，绝不允许穿墙） ---------------- */
  function boxHitsWall(x, y, r) {
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++)
      if (G.solidAt(tx, ty)) return true;
    return false;
  }
  function moveAxis(e, axis, d) {
    if (!d) return false;
    const old = e[axis];
    e[axis] += d;
    if (boxHitsWall(e.x, e.y, e.r)) {
      // 回退式解析：所有实体单帧位移 < 9px < 墙厚 16px，绝不隧穿
      e[axis] = old;
      return true;
    }
    return false;
  }
  /* 位置被外力推入墙时，向最近墙面/墙角推出（中心已在墙内也正确处理） */
  function resolveOutOfWall(e) {
    for (let iter = 0; iter < 4 && boxHitsWall(e.x, e.y, e.r); iter++) {
      const cx = Math.floor(e.x / TILE), cy = Math.floor(e.y / TILE);
      let bx = null, by = null, bestD = 1e9;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const tx = cx + dx, ty = cy + dy;
        if (!G.solidAt(tx, ty)) continue;
        const L = tx * TILE, T = ty * TILE, R = L + TILE, B = T + TILE;
        const nx = clamp(e.x, L, R), ny = clamp(e.y, T, B);
        const d = dist(e.x, e.y, nx, ny);
        if (d < bestD && d < e.r) {
          bestD = d;
          if (d < 0.001) {
            // 中心在瓦片内：向最薄的一墙面推出
            const dl = e.x - L, dr = R - e.x, dtp = e.y - T, db = B - e.y;
            const m = Math.min(dl, dr, dtp, db);
            if (m === dl) { bx = L - e.r - 0.02; by = e.y; }
            else if (m === dr) { bx = R + e.r + 0.02; by = e.y; }
            else if (m === dtp) { bx = e.x; by = T - e.r - 0.02; }
            else { bx = e.x; by = B + e.r + 0.02; }
          } else {
            // 框与瓦片搭接：沿中心-最近点方向推出
            const ux = (e.x - nx) / d, uy = (e.y - ny) / d;
            const push = e.r - d + 0.02;
            bx = e.x + ux * push; by = e.y + uy * push;
          }
        }
      }
      if (bx == null) {
        // 箱体角搭接墙角（圆判定无重叠但碰撞盒角嵌入）：沿穿透最小的轴推出
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const tx = cx + dx, ty = cy + dy;
          if (!G.solidAt(tx, ty)) continue;
          const L = tx * TILE, T = ty * TILE, R = L + TILE, B = T + TILE;
          const ox = Math.min(e.x + e.r, R) - Math.max(e.x - e.r, L);
          const oy = Math.min(e.y + e.r, B) - Math.max(e.y - e.r, T);
          if (ox > 0 && oy > 0) {
            if (ox < oy) { bx = e.x < (L + R) / 2 ? L - e.r - 0.02 : R + e.r + 0.02; by = e.y; }
            else { bx = e.x; by = e.y < (T + B) / 2 ? T - e.r - 0.02 : B + e.r + 0.02; }
            break;
          }
        }
      }
      if (bx == null) break;
      e.x = bx; e.y = by;
    }
  }
  G.losClear = function (x0, y0, x1, y1) {
    const d = dist(x0, y0, x1, y1);
    const steps = Math.max(1, Math.ceil(d / 5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (G.solidAtPx(lerp(x0, x1, t), lerp(y0, y1, t))) return false;
    }
    return true;
  };
  G.raycastWall = function (x0, y0, ang, maxLen) {
    const cx = Math.cos(ang), cy = Math.sin(ang);
    const steps = Math.ceil(maxLen / 4);
    for (let i = 1; i <= steps; i++) {
      const x = x0 + cx * i * 4, y = y0 + cy * i * 4;
      if (G.solidAtPx(x, y)) return { x: x - cx * 3, y: y - cy * 3, len: i * 4 - 3 };
    }
    return { x: x0 + cx * maxLen, y: y0 + cy * maxLen, len: maxLen };
  };
  function pointSegDist(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x0) * dx + (py - y0) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return dist(px, py, x0 + dx * t, y0 + dy * t);
  }
  G.pointSegDist = pointSegDist;

  /* ---------------- 特效数据 ---------------- */
  function addFloater(x, y, txt, color, big) {
    if (G.floaters.length > 90) G.floaters.shift();
    G.floaters.push({ x: x + rng.range(-4, 4), y: y - 6, vy: -34, life: 0.75, max: 0.75, txt: '' + txt, color: color || '#ffffff', big: !!big });
  }
  function addParts(x, y, n, color, o) {
    o = o || {};
    for (let i = 0; i < n; i++) {
      if (G.particles.length > 420) break;
      const a = rng.range(0, TAU), sp = rng.range(0.3, 1) * (o.spd || 90);
      G.particles.push({
        x, y, vx: Math.cos(a) * sp + (o.vx || 0), vy: Math.sin(a) * sp + (o.vy || 0),
        life: rng.range(0.6, 1) * (o.life || 0.5), max: 1,
        color: Array.isArray(color) ? rng.pick(color) : color,
        size: o.size || rng.range(1, 2.4), drag: o.drag || 4, grav: o.grav || 0,
      });
    }
  }
  function addRing(x, y, color, o) {
    o = o || {};
    G.rings.push({ x, y, r: o.r0 || 2, vr: o.vr || 160, life: o.life || 0.35, max: o.life || 0.35, color, width: o.width || 2 });
  }
  function shake(a) { G.shake = Math.min(9, G.shake + a); }
  function flash(color, a) { G.flashFx = Math.max(G.flashFx, a); G.flashColor = color; }

  /* ---------------- 属性计算 ---------------- */
  G.computeStats = function () {
    const s = {
      dmg: 1, rate: 1, proj: 0, spreadMul: 1, pierce: 0, bounce: 0,
      crit: 0.10, critMul: 2, speed: 1, dashCd: 1, shieldMax: 0, shieldDelay: 1,
      melee: 1, meleeRange: 1, killHeal: 0, killSpeed: 0, revenge: 0, maxHpAdd: 0,
      noSplitPenalty: false, bouncePierce: false, undying: false, dashResetKill: false,
      railMul: 1, railAoe: 0,
      frost: 0, chain: 0, reload: 0, lucky: 0, dashEcho: 0, chainBig: 0, frostAmp: 0,
    };
    for (const id of G.chips) { const c = CHIPS.find(c => c.id === id); if (c) c.apply(s); }
    G.synActive = [];
    for (const syn of SYNERGIES) {
      if (syn.need.every(n => G.chips.includes(n))) { syn.apply(s); G.synActive.push(syn); }
    }
    if (s.noSplitPenalty && G.chips.includes('split')) s.dmg += 0.22;
    // 商店永久强化与英雄底子
    s.shieldMax += (G.bonusShield || 0);
    s.dmg *= (1 + (G.powerBonus || 0));
    const H = HEROES[G.heroId] || HEROES.vanguard;
    s.dmg *= H.dmg; s.speed *= H.speed; s.dashCd *= H.dashCd; s.crit += H.crit || 0;
    if (G.debugDmg) s.dmg *= G.debugDmg;
    const w = G.weapons[G.weaponSlot];
    if (w && w.type === 'rail' && s.pierce > 0) s.pierceAll = true;
    G.stats = s;
    if (G.player) {
      G.player.maxHp = Math.max(2, H.maxHp + s.maxHpAdd);
      G.player.maxShield = H.shieldMax + s.shieldMax;
      G.player.hp = Math.min(G.player.hp, G.player.maxHp);
      G.player.shield = Math.min(G.player.shield, G.player.maxShield);
    }
    return s;
  };

  /* ---------------- 玩家 ---------------- */
  G.weapons = [WEAPONS.smg, WEAPONS.blade];
  G.weaponSlot = 0;
  G.player = {
    x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0, r: 5,
    hp: 6, maxHp: 6, shield: 3, maxShield: 3, shieldT: 0,
    dashT: 0, dashCd: 0, dashA: 0, iframes: 0, aimA: 0,
    fireT: 0, chargeT: 0, meleeCd: 0, slashT: 0, slashA: 0,
    bob: 0, recoil: 0, undyingUsed: false, muzzleT: 0,
  };

  function comboMul() { return 1 + Math.min(G.combo, 25) * 0.02; }
  function echoMul() { return G.dashEchoT > 0 ? 1 + (G.stats ? (G.stats.dashEcho || 0) : 0) : 1; }

  function spawnBullet(x, y, ang, speed, dmg, friendly, o) {
    o = o || {};
    if (G.bullets.length > 420) G.bullets.shift();
    G.bullets.push({
      x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      r: o.r || 2.5, dmg, friendly, color: o.color || '#ffffff',
      knock: o.knock || 0, pierce: o.pierce || 0, bounces: o.bounces || 0,
      life: o.life || 3, t: 0, hitIds: o.hitIds || null, bounced: false,
      core: o.core || '#ffffff', glow: o.glow !== false,
    });
  }

  function fireGun(w, pellets, spread, dmgMul) {
    const P = G.player, s = G.stats;
    // 轻微自动瞄准辅助
    let aim = P.aimA;
    let best = null, bestD = 0.14;
    for (const e of G.enemies) {
      if (e.dead || e.spawning > 0) continue;
      const a = Math.atan2(e.y - P.y, e.x - P.x);
      const d = Math.abs(angDiff(aim, a));
      if (d < bestD && dist(P.x, P.y, e.x, e.y) < 320 && G.losClear(P.x, P.y, e.x, e.y)) { bestD = d; best = a; }
    }
    if (best != null) aim = aim + angDiff(aim, best) * 0.65;
    const pelletsArr = [];
    for (let i = 0; i < pellets; i++) {
      let a;
      if (pellets > 2) a = aim + (i / (pellets - 1) - 0.5) * spread + rng.range(-0.03, 0.03);
      else a = aim + rng.range(-spread / 2, spread / 2);
      const crit = rng.chance(s.crit);
      let dmg = w.dmg * s.dmg * dmgMul * comboMul() * echoMul() * (G.vengeanceT > 0 ? 1 + s.revenge : 1);
      if (crit) dmg *= s.critMul;
      pelletsArr.push({ a, dmg, crit });
    }
    const mx = P.x + Math.cos(aim) * 8, my = P.y + Math.sin(aim) * 8;
    for (const p of pelletsArr) {
      spawnBullet(mx, my, p.a, w.speed * rng.range(0.95, 1.05), p.dmg, true, {
        color: w.color, knock: w.knock, pierce: s.pierce, bounces: s.bounce,
        life: w.bulletLife || w.range / w.speed, r: w.bulletR || 2.5, kind: w.kind,
      });
    }
    P.vx -= Math.cos(aim) * (w.id === 'shotgun' ? 55 : 12);
    P.vy -= Math.sin(aim) * (w.id === 'shotgun' ? 55 : 12);
    P.recoil = 1; P.muzzleT = 0.06;
    addParts(mx, my, 4, [w.color, '#ffffff'], { spd: 60, life: 0.15, size: 1.6 });
    shake(w.shake);
    G.sfx(w.id === 'shotgun' ? 'shotgun' : 'shoot');
  }

  function fireRail() {
    const P = G.player, s = G.stats, w = WEAPONS.railgun;
    const hit = G.raycastWall(P.x, P.y, P.aimA, w.range);
    const x1 = hit.x, y1 = hit.y;
    G.beams.push({ x0: P.x + Math.cos(P.aimA) * 8, y0: P.y + Math.sin(P.aimA) * 8, x1, y1, t: 0.16, max: 0.16, color: w.color, w0: 4 });
    // 收集线上的敌人（按距离排序）
    const hits = [];
    for (const e of G.enemies) {
      if (e.dead || e.spawning > 0) continue;
      if (pointSegDist(e.x, e.y, P.x, P.y, x1, y1) < e.r + 4) {
        const t = ((e.x - P.x) * (x1 - P.x) + (e.y - P.y) * (y1 - P.y)) / Math.max(1, dist(P.x, P.y, x1, y1) ** 2);
        hits.push({ e, t });
      }
    }
    hits.sort((a, b) => a.t - b.t);
    const maxHits = s.pierceAll ? 999 : 1 + s.pierce;
    for (let i = 0; i < hits.length && i < maxHits; i++) {
      const e = hits[i].e;
      const crit = rng.chance(s.crit);
      let dmg = w.dmg * s.dmg * s.railMul * comboMul() * echoMul() * (G.vengeanceT > 0 ? 1 + s.revenge : 1);
      if (crit) dmg *= s.critMul;
      if (e.type === 'guard' && !e.broken) breakGuard(e);
      damageEnemy(e, dmg, P.aimA, w.knock, crit);
      if (s.railAoe > 0) explode(e.x, e.y, s.railAoe, 9 * s.dmg, true, w.color);
    }
    addParts(x1, y1, 10, [w.color, '#ffffff'], { spd: 120, life: 0.3 });
    addRing(x1, y1, w.color, { vr: 200, life: 0.25 });
    P.recoil = 1.6; shake(w.shake); flash('#b9bcff', 0.08);
    G.sfx('rail');
    G.sfx('railImpact');
  }

  function meleeSlash() {
    const P = G.player, s = G.stats, w = WEAPONS.blade;
    if (P.meleeCd > 0) return;
    P.meleeCd = w.interval / s.rate;
    P.slashT = 0.16; P.slashA = P.aimA;
    const range = w.range * s.meleeRange, arc = w.arc;
    let hitAny = false;
    for (const e of G.enemies) {
      if (e.dead || e.spawning > 0) continue;
      const d = dist(P.x, P.y, e.x, e.y);
      if (d < range + e.r && Math.abs(angDiff(P.aimA, Math.atan2(e.y - P.y, e.x - P.x))) < arc / 2) {
        const crit = rng.chance(s.crit);
        let dmg = w.dmg * s.dmg * s.melee * comboMul() * echoMul() * (G.vengeanceT > 0 ? 1 + s.revenge : 1);
        if (crit) dmg *= s.critMul;
        if (e.type === 'guard' && !e.broken) breakGuard(e);
        damageEnemy(e, dmg, Math.atan2(e.y - P.y, e.x - P.x), w.knock, crit);
        hitAny = true;
      }
    }
    // 弹反：弧区内的敌方子弹转为己方
    let deflect = 0;
    for (const b of G.bullets) {
      if (b.friendly) continue;
      const d = dist(P.x, P.y, b.x, b.y);
      if (d < range * 1.2 && Math.abs(angDiff(P.aimA, Math.atan2(b.y - P.y, b.x - P.x))) < arc / 2 + 0.35) {
        const a = P.aimA + rng.range(-0.18, 0.18);
        b.friendly = true; b.vx = Math.cos(a) * 280; b.vy = Math.sin(a) * 280;
        b.dmg = 3.5 * s.dmg; b.color = '#45f0e2'; b.core = '#ffffff';
        b.pierce = 1 + s.pierce; b.life = 2; b.hitIds = null; b.knock = 90;
        deflect++;
      }
    }
    if (deflect) { G.sfx('deflect'); addRing(P.x, P.y, '#45f0e2', { vr: 220, life: 0.2, r0: 8 }); }
    else G.sfx('slash');
    if (hitAny) { G.hitstop = Math.max(G.hitstop, 0.05); shake(1.8); }
  }

  /* ---------------- 伤害处理 ---------------- */
  function damageEnemy(e, dmg, dir, knock, crit) {
    if (e.dead || e.spawning > 0) return;
    if (e.isBoss && (e.invuln > 0 || e.st === 'transition' || e.st === 'dying')) {
      if (rng.chance(0.08)) addFloater(e.x, e.y - 14, '免疫', '#8b8b98');
      return;
    }
    if (e.slowT > 0 && G.stats.frostAmp) dmg = dmg * 1.2;
    e.hp -= dmg;
    if (G.stats.frost) e.slowT = Math.max(e.slowT || 0, e.type === 'boss' ? 0.6 : (G.stats.frostAmp ? 2.2 : 1.8));
    e.flash = 1; e.hitCd = 0.05;
    if (knock) {
      const m = e.mass || 1;
      e.kx += Math.cos(dir) * knock / m;
      e.ky += Math.sin(dir) * knock / m;
    }
    addFloater(e.x, e.y - e.r - 2, crit ? Math.round(dmg) + '!' : (Math.round(dmg * 10) / 10),
      crit ? '#ffb84d' : '#f2f2f6', crit);
    addParts(e.x, e.y, crit ? 7 : 4, [crit ? '#ffb84d' : '#ffffff', '#45f0e2'], { spd: 110, life: 0.25 });
    G.score += Math.round(dmg);
    G.hitstop = Math.max(G.hitstop, crit ? 0.06 : 0.035);
    G.sfx('hit', { pitch: crit ? 1.3 : 1 });
    if (e.isBoss) {
      // Boss 阶段判定（血量逻辑：仅在正常阶段边界触发一次）
      const frac = e.hp / e.maxHp;
      if (e.st !== 'transition' && e.st !== 'dying') {
        if (e.phase === 1 && frac <= 2 / 3) bossTransition(e, 2);
        else if (e.phase === 2 && frac <= 1 / 3) bossTransition(e, 3);
      }
    }
    if (e.hp <= 0) killEnemy(e);
  }

  function breakGuard(e) {
    if (e.type !== 'guard' || e.broken > 0) return;
    e.broken = 6; e.staggerT = 1.6;
    addFloater(e.x, e.y - 12, '破盾!', '#ff4757', true);
    addParts(e.x, e.y, 12, ['#a9a9b4', '#ffffff'], { spd: 140, life: 0.4 });
    addRing(e.x, e.y, '#a9a9b4', { vr: 180, life: 0.3 });
    G.sfx('guardBreak'); shake(2.2);
  }

  function killEnemy(e) {
    if (e.dead) return;
    G.kills++;
    G.combo++; G.comboT = 3;
    G.maxCombo = Math.max(G.maxCombo, G.combo);
    G.score += Math.round(ENEMY_DEFS[e.type].score * (1 + G.combo * 0.03));
    const s = G.stats;
    if (s.killHeal && rng.chance(s.killHeal) && G.player.hp < G.player.maxHp) {
      G.player.hp++; addFloater(G.player.x, G.player.y - 12, '+1', '#45f0e2');
    }
    if (s.killSpeed) G.killSpeedT = s.killSpeed;
    if (s.dashResetKill) G.player.dashCd = 0;
    if (e.type === 'guard' && rng.chance(0.22)) G.pickups.push({ x: e.x, y: e.y, kind: 'heart', t: 0 });
    if (e.isBoss) {
      // Boss 走独立死亡流程：滞留场内直至演出结束（否则状态机死锁）
      bossDying(e);
      if (G.combo === 10 || G.combo === 15 || G.combo === 20) toast('连击 ×' + G.combo + '！', '#ffb84d');
      return;
    }
    e.dead = true;
    // 金币掉落
    const luckyMul = G.stats.lucky ? 1.6 : 1;
    const coinN = e.elite ? 3 : (e.type === 'guard' ? 2 : 1);
    if (e.elite || rng.chance(0.65 * luckyMul)) {
      for (let ci = 0; ci < coinN; ci++) {
        G.pickups.push({ x: e.x + rng.range(-7, 7), y: e.y + rng.range(-7, 7), kind: 'coin', t: 0 });
      }
    }
    // 引爆核心：敌人死亡爆炸
    if (G.stats.chain) {
      explode(e.x, e.y, G.stats.chainBig ? 42 : 26, (G.stats.chainBig ? 9 : 6) * G.stats.dmg, true, '#ffb84d');
    }
    // 弹药回涌
    if (G.stats.reload) G.player.fireT *= 0.8;
    addParts(e.x, e.y, 16, ['#a9a9b4', '#6a6a76', e.type === 'charger' ? '#ff4757' : '#45f0e2'], { spd: 150, life: 0.6, size: 2.4 });
    addRing(e.x, e.y, '#ffffff', { vr: 240, life: 0.3, width: 2 });
    shake(2);
    G.hitstop = Math.max(G.hitstop, 0.07);
    G.sfx('kill');
    if (G.combo === 10 || G.combo === 15 || G.combo === 20) toast('连击 ×' + G.combo + '！', '#ffb84d');
  }

  function damagePlayer(n, sx, sy) {
    const P = G.player;
    if (P.iframes > 0 || G.state !== 'playing') return;
    const s = G.stats;
    if (s.undying && !P.undyingUsed && P.hp - n <= 0) {
      P.undyingUsed = true;
      P.hp = 1; P.shield = P.maxShield; P.iframes = 1.6;
      toast('不灭战意：拒绝倒下！', '#45f0e2');
      addRing(P.x, P.y, '#45f0e2', { vr: 300, life: 0.5, width: 3 });
      G.sfx('deflect'); return;
    }
    const absorb = Math.min(P.shield, n);
    P.shield -= absorb; n -= absorb;
    if (n > 0) P.hp -= n;
    P.iframes = 0.9; P.shieldT = 0;
    G.damageTaken++;
    G.vengeanceT = 3;
    G.hurtFx = 1; shake(3.5); flash('#ff4757', 0.10);
    if (sx != null) { P.vx += (P.x - sx) * 2.2; P.vy += (P.y - sy) * 2.2; }
    G.sfx(absorb > 0 && n <= 0 ? 'shieldHit' : 'hurt');
    if (P.shield <= 0 && absorb > 0) { G.sfx('shieldBreak'); addRing(P.x, P.y, '#45f0e2', { vr: 200, life: 0.3 }); }
    if (P.hp <= 0) {
      P.hp = 0; G.state = 'defeat';
      G.deathLog = '在第 ' + (G.zoneIdx + 1) + ' 区倒下 · 击杀 ' + G.kills;
      G.endScreen = { victory: false, stats: endStats() };
      addParts(P.x, P.y, 40, ['#ffffff', '#ff4757', '#a9a9b4'], { spd: 200, life: 0.8, size: 2.6 });
      addRing(P.x, P.y, '#ff4757', { vr: 320, life: 0.6, width: 3 });
      G.sfx('death'); shake(8);
    }
  }

  function explode(x, y, r, dmg, friendly, color) {
    addParts(x, y, 14, [color || '#ffb84d', '#ffffff', '#6a6a76'], { spd: 180, life: 0.45, size: 2.2 });
    addRing(x, y, color || '#ffb84d', { r0: 4, vr: 320, life: 0.32, width: 3 });
    shake(2.6); G.sfx('explosion');
    if (friendly) {
      for (const e of G.enemies) {
        if (e.dead || e.spawning > 0) continue;
        const d = dist(x, y, e.x, e.y);
        if (d < r + e.r) damageEnemy(e, dmg, Math.atan2(e.y - y, e.x - x), 140, false);
      }
    } else {
      const P = G.player;
      if (dist(x, y, P.x, P.y) < r + P.r) damagePlayer(dmg, x, y);
    }
  }

  function toast(text, color) {
    G.toasts.push({ text, color: color || '#e8e8ee', life: 2.2 });
    if (G.toasts.length > 4) G.toasts.shift();
  }
  function banner(text, sub, color, dur) {
    G.banner = { text, sub: sub || '', color: color || '#ffffff', life: dur || 2.2, max: dur || 2.2 };
  }
  G.toast = toast; G.banner = banner;

  function endStats() {
    const t = G.runTime;
    const rating = (t < 300 && G.damageTaken <= 6) ? 'S' : (t < 420 && G.damageTaken <= 12) ? 'A' : 'B';
    return {
      time: t, kills: G.kills, maxCombo: G.maxCombo, damageTaken: G.damageTaken,
      score: G.score, rating,
      chips: G.chips.map(id => CHIPS.find(c => c.id === id).name),
      syn: G.synActive.map(s => s.name),
    };
  }
  G.endStats = endStats;

  /* ---------------- Boss ---------------- */
  function bossTransition(e, ph) {
    e.st = 'transition'; e.t = 1.5; e.phase = ph; e.invuln = 1.6;
    G.bossLaser = null;
    // 清除敌方弹幕 → 火花
    for (const b of G.bullets) if (!b.friendly) { addParts(b.x, b.y, 2, '#ff4757', { spd: 40, life: 0.3 }); b.life = 0; }
    const ph1 = (e.phases || BOSS_PHASES)[ph - 1];
    addRing(e.x, e.y, ph1.color, { r0: 6, vr: 380, life: 0.6, width: 3 });
    flash('#ffffff', 0.16); shake(6); G.sfx('phase');
    banner('阶段 ' + ['Ⅰ', 'Ⅱ', 'Ⅲ'][ph - 1] + ' · ' + ph1.name, e.name, ph1.color, 2.0);
  }

  function bossDying(e) {
    e.st = 'dying'; e.t = 1.3; e.expT = 0;
    for (const b of G.bullets) if (!b.friendly) b.life = 0;
    G.bossLaser = null; G.mines.length = 0; G.wells.length = 0;
    G.timeScale = 0.35;
    addParts(e.x, e.y, 40, ['#ff4757', '#ffb84d', '#ffffff'], { spd: 220, life: 0.7, size: 2.6 });
    addRing(e.x, e.y, '#ffffff', { vr: 300, life: 0.5, width: 3 });
    shake(6); G.sfx('kill');
    banner('核心击穿', e.name, '#ffffff', 2.2);
    G.sfx('bossDie');
  }

  function updateBoss(e, dt) {
    const P = G.player;
    e.invuln = Math.max(0, e.invuln - dt);
    e.t -= dt;
    const zc = { x: (G.mw * TILE) / 2, y: (G.mh * TILE) / 2 - 20 };

    if (e.st === 'intro') {
      e.vx = 0; e.vy = 0;
      if (e.t <= 0) { e.st = 'idle'; e.atkT = 1.2; }
      return;
    }
    if (e.st === 'transition') {
      // 移向场地中心
      const a = Math.atan2(zc.y - e.y, zc.x - e.x);
      e.vx = Math.cos(a) * 60; e.vy = Math.sin(a) * 60;
      if (e.t <= 0) { e.st = 'idle'; e.atkT = 0.9; e.vx = 0; e.vy = 0; }
      return;
    }
    if (e.st === 'dying') {
      e.vx = 0; e.vy = 0;
      e.expT = (e.expT || 0) - dt;
      if (e.expT <= 0) {
        e.expT = 0.14;
        addParts(e.x + rng.range(-14, 14), e.y + rng.range(-14, 14), 10, ['#ff4757', '#ffb84d', '#ffffff'], { spd: 150, life: 0.5, size: 2.4 });
        addRing(e.x + rng.range(-10, 10), e.y + rng.range(-10, 10), '#ffb84d', { vr: 200, life: 0.3 });
        shake(3); G.sfx('explosion');
      }
      if (e.t <= 0) {
        G.timeScale = 1;
        addParts(e.x, e.y, 80, ['#ffffff', '#ffb84d', '#ff4757'], { spd: 260, life: 0.9, size: 3 });
        flash('#ffffff', 0.6); shake(9);
        e.dead = true;
        G.bossDown[G.zoneIdx] = true;
        if (e.final) {
          G.state = 'victory';
          G.endScreen = { victory: true, stats: endStats() };
          G.sfx('victory');
        } else {
          // 区域守卫击破：掉落补给 → 开启传送门挺进下一区（非最终 Boss 不结算）
          for (let ci = 0; ci < 8; ci++) {
            G.pickups.push({ x: e.x + rng.range(-20, 20), y: e.y + rng.range(-16, 16), kind: 'coin', t: 0 });
          }
          G.pickups.push({ x: e.x - 14, y: e.y + 10, kind: 'heart', t: 0 });
          G.pickups.push({ x: e.x + 14, y: e.y + 10, kind: 'battery', t: 0 });
          banner('区域守卫已击破', '传送门开启 · 挺进下一区', ZONES[G.zoneIdx].accent, 2.6);
          G.sfx('phase');
          openPortal();
        }
      }
      return;
    }

    // ---- 攻击状态机 ----
    if (e.st === 'idle') {
      // 环绕玩家保持距离
      const d = dist(e.x, e.y, P.x, P.y);
      const a = Math.atan2(e.y - P.y, e.x - P.x);
      const want = 130;
      const spd = (e.phase === 3 ? 55 : 42) * (1 + 0.05 * (G.zoneIdx));
      let ma = a;
      if (d > want + 30) ma = a + Math.PI;      // 靠近
      else if (d < want - 30) ma = a;           // 远离
      else ma = a + Math.PI / 2 * e.orbitDir;   // 环绕
      e.orbitT = (e.orbitT || 0) - dt;
      if (e.orbitT <= 0) { e.orbitT = rng.range(1.5, 3); if (rng.chance(0.4)) e.orbitDir = -(e.orbitDir || 1); }
      e.vx = Math.cos(ma) * spd; e.vy = Math.sin(ma) * spd;
      e.aimA = Math.atan2(P.y - e.y, P.x - e.x);
      e.atkT -= dt;
      if (e.atkT <= 0) startBossAttack(e);
    } else {
      e.vx *= Math.exp(-4 * dt); e.vy *= Math.exp(-4 * dt);
    }
    const atk = e.atk;
    if (!atk) return;
    atk.t += dt;

    function bossBullet(ang, speed) {
      spawnBullet(e.x, e.y, ang, speed, 1, false, {
        color: '#ff4757', core: '#ffd9dd', r: 3, knock: 0, life: 6,
      });
    }

    if (atk.kind === 'ring') {
      if (!atk.fired && atk.t > 0.35) {
        atk.fired = true;
        const n = 20 + e.phase * 4;
        e.ringOff = (e.ringOff || 0) + 0.37;
        for (let i = 0; i < n; i++) bossBullet(e.ringOff + i / n * TAU, 92 + e.phase * 8);
        if (e.phase >= 2) {
          setTimeoutLike(0.25, () => {
            if (!e.dead && e.st !== 'dying') {
              const n2 = 18; e.ringOff += 0.19;
              for (let i = 0; i < n2; i++) bossBullet(e.ringOff + i / n2 * TAU + 0.17, 105);
              G.sfx('shoot');
            }
          });
        }
        G.sfx('shoot'); shake(1.5);
        e.st = 'idle'; e.atkT = bossAtkInterval(e); e.atk = null;
      }
    } else if (atk.kind === 'fan') {
      if (atk.t > atk.step * 0.2) {
        const base = Math.atan2(P.y - e.y, P.x - e.x);
        for (let i = -2; i <= 2; i++) bossBullet(base + i * 0.16, 150 + e.phase * 8);
        G.sfx('shoot');
        atk.step++;
        if (atk.step > 3) { e.st = 'idle'; e.atkT = bossAtkInterval(e); e.atk = null; }
      }
    } else if (atk.kind === 'fanlaser') {
      if (!atk.started && atk.t > 0.4) {
        atk.started = true;
        const base = Math.atan2(P.y - e.y, P.x - e.x);
        const dir = rng.chance(0.5) ? 1 : -1;
        G.bossLaser = {
          x0: e.x, y0: e.y, a0: base - dir * 0.5, a1: base + dir * 0.5,
          count: 5, spread: 1.25, t: 0, charge: 0.8, active: 1.2,
          color: '#ff4757', dmg: 1,
        };
        G.sfx('laserCharge');
      }
      if (atk.started && (!G.bossLaser || G.bossLaser.done)) {
        e.st = 'idle'; e.atkT = bossAtkInterval(e); e.atk = null;
      }
    } else if (atk.kind === 'mines') {
      if (atk.t > atk.step * 0.55 && atk.step < 3) {
        atk.step++;
        const ox = rng.range(-55, 55), oy = rng.range(-55, 55);
        let mx = clamp(P.x + ox, TILE * 2, G.mw * TILE - TILE * 2);
        let my = clamp(P.y + oy, TILE * 2, G.mh * TILE - TILE * 2);
        if (G.solidAtPx(mx, my)) { mx = P.x; my = P.y; }
        G.mines.push({ x: mx, y: my, fuse: 1.05, r: 36, dmg: 2, t: 0 });
        G.sfx('minePlace');
      }
      if (atk.step >= 3 && atk.t > 2.0) { e.st = 'idle'; e.atkT = bossAtkInterval(e); e.atk = null; }
    } else if (atk.kind === 'spiral') {
      if (atk.t < 1.6) {
        atk.acc = (atk.acc || 0) + dt;
        while (atk.acc > 0.09) {
          atk.acc -= 0.09;
          atk.a = (atk.a || 0) + 0.30;
          bossBullet(atk.a, 118); bossBullet(atk.a + Math.PI, 118);
        }
      }
      if (atk.t > 1.9) { e.st = 'idle'; e.atkT = bossAtkInterval(e); e.atk = null; }
    } else if (atk.kind === 'clones') {
      // 镜像裂变：在水晶周围裂变出镜像残影（场上限 5）+ 朝玩家三连扇
      if (!atk.fired && atk.t > 0.45) {
        atk.fired = true;
        const aliveEcho = G.enemies.filter(x => !x.dead && x.type === 'echo').length;
        const want = Math.min(e.phase >= 3 ? 3 : 2, 5 - aliveEcho);
        let spawned = 0;
        for (let i = 0; i < want * 5; i++) {
          if (!want) break;
          const a = rng.range(0, TAU), rr = rng.range(46, 92);
          const x = clamp(e.x + Math.cos(a) * rr, TILE * 2, (G.mw - 2) * TILE);
          const y = clamp(e.y + Math.sin(a) * rr, TILE * 2, (G.mh - 2) * TILE);
          if (boxHitsWall(x, y, 6)) continue;
          const m = spawnEnemy('echo', x, y);
          m.spawning = 0.5;
          addRing(x, y, '#e8e8ee', { vr: 150, life: 0.3 });
          if (++spawned >= want) break;
        }
        const base = Math.atan2(P.y - e.y, P.x - e.x);
        for (let i = -1; i <= 1; i++) bossBullet(base + i * 0.22, 165);
        G.sfx('shoot');
        e.st = 'idle'; e.atkT = bossAtkInterval(e); e.atk = null;
      }
    } else if (atk.kind === 'gravity') {
      // 引力陷阱：在玩家附近布设引力井（持续拉扯，结束时内爆）+ 缓速环弹
      if (!atk.fired && atk.t > 0.5) {
        atk.fired = true;
        if (G.wells.length < 4) {
          const n = 2;
          for (let i = 0; i < n; i++) {
            const ox = rng.range(-75, 75), oy = rng.range(-55, 55);
            let wx = clamp(P.x + ox, TILE * 2, (G.mw - 2) * TILE);
            let wy = clamp(P.y + oy, TILE * 2, (G.mh - 2) * TILE);
            if (G.solidAtPx(wx, wy)) { wx = P.x; wy = P.y; }
            G.wells.push({
              x: wx, y: wy, t: 0, fuse: e.phase >= 3 ? 2.6 : 3.2,
              r: 92, pull: 820, dmg: 2,
            });
            addRing(wx, wy, '#ffb84d', { r0: 4, vr: 220, life: 0.4 });
            G.sfx('minePlace');
          }
        }
        const n2 = 14;
        for (let i = 0; i < n2; i++) bossBullet(i / n2 * TAU + rng.range(0, 0.3), 85);
        G.sfx('shoot');
        e.st = 'idle'; e.atkT = bossAtkInterval(e); e.atk = null;
      }
    } else if (atk.kind === 'blinkstorm') {
      // 相位风暴：两次相位跃迁，各接一组弹幕
      if (!atk.st1 && atk.t > 0.35) {
        atk.st1 = true;
        bossBlink(e);
        for (let arm = 0; arm < 4; arm++)
          for (let i = 0; i < 4; i++) bossBullet(atk.a0 + arm * Math.PI / 2 + i * 0.055, 118 + i * 9);
        G.sfx('enemyDash'); shake(2);
      }
      if (!atk.st2 && atk.t > 1.15) {
        atk.st2 = true;
        bossBlink(e);
        const n = 18;
        for (let i = 0; i < n; i++) bossBullet(i / n * TAU, 100);
        G.sfx('shoot');
      }
      if (atk.t > 2.0) { e.st = 'idle'; e.atkT = bossAtkInterval(e); e.atk = null; }
    }
  }

  /* Boss2 相位跃迁：瞬移至玩家周边随机落点（绝不落墙内），两端各留残响 */
  function bossBlink(e) {
    const P = G.player;
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, TAU), d = rng.range(70, 150);
      const x = clamp(P.x + Math.cos(a) * d, TILE * 2, (G.mw - 2) * TILE);
      const y = clamp(P.y + Math.sin(a) * d, TILE * 2, (G.mh - 2) * TILE);
      if (boxHitsWall(x, y, e.r + 2)) continue;
      addParts(e.x, e.y, 12, ['#e8e8ee', '#a9a9b4'], { spd: 120, life: 0.35 });
      addRing(e.x, e.y, '#e8e8ee', { vr: 220, life: 0.3 });
      e.x = x; e.y = y; e.vx = 0; e.vy = 0;
      addParts(x, y, 12, ['#e8e8ee', '#6a6a76'], { spd: 120, life: 0.35 });
      return true;
    }
    return false;
  }

  function bossAtkInterval(e) {
    return (e.phase === 1 ? 1.7 : e.phase === 2 ? 1.4 : 1.1) * rng.range(0.85, 1.15);
  }
  function startBossAttack(e) {
    const pools = e.pools || {
      1: ['ring', 'fan'],
      2: ['fanlaser', 'ring', 'fan'],
      3: ['mines', 'spiral', 'ring', 'mines', 'fan'],
    };
    const pool = pools[e.phase] || pools[1];
    e.atkIdx = ((e.atkIdx || 0) + 1) % pool.length;
    const kind = pool[e.atkIdx];
    e.st = 'attack';
    e.atk = { kind, t: 0, step: kind === 'fan' ? 1 : 1, fired: false };
  }
  /* 简易延迟队列（headless 也可用，不依赖 setTimeout） */
  const timers = [];
  function setTimeoutLike(t, fn) { timers.push({ t, fn }); }
  function updateTimers(dt) {
    for (let i = timers.length - 1; i >= 0; i--) {
      timers[i].t -= dt;
      if (timers[i].t <= 0) { const fn = timers[i].fn; timers.splice(i, 1); fn(); }
    }
  }

  /* ---------------- 敌人 AI ---------------- */
  function spawnEnemy(type, x, y) {
    const d = ENEMY_DEFS[type];
    const z = G.zoneIdx;
    const e = {
      id: ++G.eid, type, x, y, vx: 0, vy: 0, kx: 0, ky: 0,
      r: d.r, mass: d.mass, speed: d.speed * (1 + 0.06 * z),
      hp: d.hp * (1 + 0.32 * z), maxHp: d.hp * (1 + 0.32 * z),
      contact: d.contact, name: d.name,
      flash: 0, hitCd: 0, spawning: 0.7, dead: false,
      state: 'stalk', t: 0, cd: rng.range(0.6, 1.6),
      burst: 0, burstT: 0, pat: null, strafe: rng.chance(0.5) ? 1 : -1,
      strafeT: rng.range(1, 2), facing: Math.PI / 2, broken: 0, staggerT: 0,
      dashA: 0, locked: false,
    };
    // 精英词条（第 2 区起概率出现，越深入越高）
    if (G.zoneIdx >= 1 && rng.chance(G.zoneIdx >= 2 ? 0.22 : 0.15)) {
      e.elite = true;
      e.hp *= 2.2; e.maxHp *= 2.2;
      e.speed *= 1.05;
    }
    G.enemies.push(e);
    addParts(x, y, 8, ['#45f0e2', '#a9a9b4'], { spd: 60, life: 0.5 });
    return e;
  }

  function updateEnemy(e, dt) {
    e.flash = Math.max(0, e.flash - dt * 6);
    e.hitCd -= dt;
    if (e.spawning > 0) { e.spawning -= dt; e.vx = 0; e.vy = 0; return; }
    if (e.isBoss) { updateBoss(e, dt); integrateEnemy(e, dt); return; }

    const P = G.player;
    const d = dist(e.x, e.y, P.x, P.y);
    const aTo = Math.atan2(P.y - e.y, P.x - e.x);
    e.t += dt; e.cd -= dt;
    e.strafeT -= dt;
    if (e.strafeT <= 0) { e.strafeT = rng.range(1.2, 2.2); if (rng.chance(0.5)) e.strafe = -e.strafe; }

    if (e.type === 'charger') {
      if (e.state === 'stalk') {
        e.vx = Math.cos(aTo) * e.speed; e.vy = Math.sin(aTo) * e.speed;
        e.facing = aTo;
        if (d < 175 && e.cd <= 0 && G.losClear(e.x, e.y, P.x, P.y)) { e.state = 'aim'; e.t = 0; e.locked = false; }
      } else if (e.state === 'aim') {
        e.vx *= Math.exp(-6 * dt); e.vy *= Math.exp(-6 * dt);
        if (e.t < 0.38) { e.dashA = aTo; e.facing = aTo; }
        if (e.t > 0.55) { e.state = 'dash'; e.t = 0; G.sfx('enemyDash'); }
      } else if (e.state === 'dash') {
        e.vx = Math.cos(e.dashA) * 255; e.vy = Math.sin(e.dashA) * 255;
        addParts(e.x, e.y, 1, '#6a6a76', { spd: 20, life: 0.3 });
        if (e.t > 0.42) { e.state = 'rest'; e.t = 0; }
      } else if (e.state === 'stun') {
        e.vx *= Math.exp(-8 * dt); e.vy *= Math.exp(-8 * dt);
        if (e.t > 0.55) { e.state = 'rest'; e.t = 0; }
      } else { // rest
        e.vx *= Math.exp(-5 * dt); e.vy *= Math.exp(-5 * dt);
        if (e.t > 0.4) { e.state = 'stalk'; e.cd = rng.range(1.1, 2.0); }
      }
    } else if (e.type === 'gunner') {
      const want = 155;
      let ma;
      if (d < want - 30) ma = aTo + Math.PI;
      else if (d > want + 30) ma = aTo;
      else ma = aTo + Math.PI / 2 * e.strafe;
      e.vx = Math.cos(ma) * e.speed; e.vy = Math.sin(ma) * e.speed;
      e.facing = aTo;
      if (e.burst > 0) {
        e.burstT -= dt;
        if (e.burstT <= 0) {
          e.burstT = 0.13; e.burst--;
          const spread = 0.07;
          const a = aTo + rng.range(-spread, spread);
          spawnBullet(e.x + Math.cos(a) * 8, e.y + Math.sin(a) * 8, a, 145 + G.zoneIdx * 12, 1, false,
            { color: '#ff4757', core: '#ffd9dd', r: 3, life: 5 });
          G.sfx('enemyShoot');
        }
      } else if (e.cd <= 0 && G.losClear(e.x, e.y, P.x, P.y) && d < 300) {
        e.pat = (G.zoneIdx >= 1 && rng.chance(0.4) && d > 130) ? 'ring' : 'aim';
        if (e.pat === 'ring') {
          const n = 10;
          for (let i = 0; i < n; i++) {
            const a = i / n * TAU + rng.range(0, 0.2);
            spawnBullet(e.x, e.y, a, 95, 1, false, { color: '#ff4757', core: '#ffd9dd', r: 3, life: 5 });
          }
          G.sfx('enemyShoot'); e.cd = rng.range(2.0, 2.6);
        } else { e.burst = 3; e.burstT = 0.1; e.cd = rng.range(1.9, 2.5); }
      }
    } else if (e.type === 'guard') {
      if (e.broken > 0) {
        e.broken -= dt;
        e.vx = Math.cos(e.t * 9) * 20; e.vy = Math.sin(e.t * 7) * 20;
      } else {
        e.facing += angDiff(e.facing, aTo) * Math.min(1, 3 * dt);
        if (d > 24) { e.vx = Math.cos(aTo) * e.speed; e.vy = Math.sin(aTo) * e.speed; }
        else { e.vx *= Math.exp(-6 * dt); e.vy *= Math.exp(-6 * dt); }
      }
    } else if (e.type === 'sniper') {
      const want = 215;
      let ma;
      if (d < want - 25) ma = aTo + Math.PI;
      else if (d > want + 40) ma = aTo;
      else ma = aTo + Math.PI / 2 * e.strafe;
      e.vx = Math.cos(ma) * e.speed; e.vy = Math.sin(ma) * e.speed;
      e.facing = aTo;
      if (e.state === 'aim') {
        e.vx *= Math.exp(-6 * dt); e.vy *= Math.exp(-6 * dt);
        e.aimT -= dt;
        const la = e.laser;
        if (la) {
          // 蓄力追踪：前段缓慢跟踪，末段锁定
          if (e.aimT > 0.32) {
            const k = 1 - Math.exp(-2.0 * dt);
            la.ex += (P.x - la.ex) * k; la.ey += (P.y - la.ey) * k;
            la.x1 = la.ex; la.y1 = la.ey;
          }
          la.phase = e.aimT > 0.32 ? 'charge' : 'lock';
        }
        if (e.aimT <= 0) {
          // 开火：瞬时激光
          const end = G.raycastWall(e.x, e.y, Math.atan2(la.ey - e.y, la.ex - e.x), 500);
          const aimA = Math.atan2(la.ey - e.y, la.ex - e.x);
          const hitP = G.raycastWall(e.x, e.y, aimA, 500);
          G.beams.push({ x0: e.x, y0: e.y, x1: hitP.x, y1: hitP.y, t: 0.18, max: 0.18, color: '#ff4757', w0: 3 });
          if (pointSegDist(P.x, P.y, e.x, e.y, hitP.x, hitP.y) < 6.5) damagePlayer(2, e.x, e.y);
          addParts(hitP.x, hitP.y, 6, ['#ff4757', '#ffffff'], { spd: 100, life: 0.3 });
          G.sfx('sniperFire');
          if (la) la.dead = true;
          e.state = 'rest'; e.t = 0; e.cd = rng.range(2.4, 3.2);
        }
      } else {
        if (e.cd <= 0 && d < 400 && G.losClear(e.x, e.y, P.x, P.y)) {
          e.state = 'aim'; e.aimT = 1.05;
          e.laser = { x0: e.x, y0: e.y, x1: e.x, y1: e.y, ex: P.x, ey: P.y, phase: 'charge', owner: e };
          G.lasers.push(e.laser);
          G.sfx('laserCharge');
        }
      }
    } else if (e.type === 'bomber') {
      if (e.state === 'arm') {
        e.vx *= Math.exp(-3 * dt); e.vy *= Math.exp(-3 * dt);
        if (e.t > 0.5) {
          // 起爆：不计击杀（无连击/金币）
          e.dead = true;
          explode(e.x, e.y, 38, 1, false, '#ff4757');
        }
      } else {
        e.vx = Math.cos(aTo) * e.speed; e.vy = Math.sin(aTo) * e.speed;
        e.facing = aTo;
        addParts(e.x, e.y, 1, '#ffb84d', { spd: 14, life: 0.25, size: 1.4 });
        if (d < 30) { e.state = 'arm'; e.t = 0; G.sfx('minePlace'); }
      }
    } else if (e.type === 'wraith') {
      // 虚空徘徊者：中距环绕压制，三连扇形弹；失去视线或离得过远时相位闪现逼近
      const want = 165;
      let ma;
      if (d < want - 35) ma = aTo + Math.PI;
      else if (d > want + 45) ma = aTo;
      else ma = aTo + Math.PI / 2 * e.strafe;
      e.vx = Math.cos(ma) * e.speed; e.vy = Math.sin(ma) * e.speed;
      e.facing = aTo;
      if (e.cd <= 0 && G.losClear(e.x, e.y, P.x, P.y) && d < 330) {
        for (let i = -1; i <= 1; i++) {
          const a = aTo + i * 0.17;
          spawnBullet(e.x + Math.cos(a) * 8, e.y + Math.sin(a) * 8, a, 150 + G.zoneIdx * 10, 1, false,
            { color: '#ff4757', core: '#ffd9dd', r: 3, life: 5 });
        }
        G.sfx('enemyShoot');
        e.cd = rng.range(2.0, 2.8);
      }
      e.blinkCd = (e.blinkCd == null ? rng.range(3.5, 5.5) : e.blinkCd) - dt;
      if (e.blinkCd <= 0 && (d > 260 || !G.losClear(e.x, e.y, P.x, P.y))) {
        e.blinkCd = rng.range(4.5, 6.5);
        wraithBlink(e, P);
      }
    } else if (e.type === 'echo') {
      // 镜像残影：缓慢逼近保持中距，蓄力后发射一枚镜像弹（无接触伤害）
      const want = 150;
      let ma;
      if (d < want - 40) ma = aTo + Math.PI;
      else if (d > want + 60) ma = aTo;
      else ma = aTo + Math.PI / 2 * e.strafe;
      if (e.state === 'charge') {
        e.vx *= Math.exp(-3 * dt); e.vy *= Math.exp(-3 * dt);
        if (e.t > 0.55) {
          e.state = 'stalk'; e.t = 0;
          spawnBullet(e.x, e.y, aTo, 150, 1, false,
            { color: '#ff4757', core: '#ffffff', r: 3, life: 5 });
          G.sfx('enemyShoot');
          e.cd = rng.range(1.7, 2.4);
        }
      } else {
        e.vx = Math.cos(ma) * e.speed * 0.8; e.vy = Math.sin(ma) * e.speed * 0.8;
        e.facing = aTo;
        if (e.cd <= 0 && d < 300 && G.losClear(e.x, e.y, P.x, P.y)) {
          e.state = 'charge'; e.t = 0;
          addRing(e.x, e.y, '#e8e8ee', { r0: 2, vr: 60, life: 0.5 });
        }
      }
    }

    integrateEnemy(e, dt);
  }

  function integrateEnemy(e, dt) {
    // 冰霜减速
    if (e.slowT > 0) {
      e.slowT -= dt;
      const f = e.type === 'boss' ? 0.85 : (G.stats.frostAmp ? 0.45 : 0.65);
      e.vx *= f; e.vy *= f;
    }
    // 控制速度 + 击退速度，击退独立衰减（边界阻尼）
    const dx = (e.vx + e.kx) * dt, dy = (e.vy + e.ky) * dt;
    const hitX = moveAxis(e, 'x', dx);
    const hitY = moveAxis(e, 'y', dy);
    if (hitX) {
      if (Math.abs(e.kx) > 60) { addParts(e.x, e.y, 3, '#a9a9b4', { spd: 60, life: 0.25 }); }
      e.kx = -e.kx * 0.3; e.vx = 0;
      if (e.type === 'charger' && e.state === 'dash') { e.state = 'stun'; e.t = 0; shake(1.2); }
    }
    if (hitY) {
      e.ky = -e.ky * 0.3; e.vy = 0;
      if (e.type === 'charger' && e.state === 'dash') { e.state = 'stun'; e.t = 0; shake(1.2); }
    }
    const damp = Math.exp(-5.5 * dt);
    e.kx *= damp; e.ky *= damp;
    resolveOutOfWall(e);
  }

  /* 虚空徘徊者相位闪现：瞬移至玩家周边 55~110px 落点（绝不落墙内），落地 1 秒预热后才会开火 */
  function wraithBlink(e, P) {
    for (let i = 0; i < 12; i++) {
      const a = rng.range(0, TAU), d = rng.range(55, 110);
      const x = clamp(P.x + Math.cos(a) * d, TILE * 1.5, (G.mw - 1.5) * TILE);
      const y = clamp(P.y + Math.sin(a) * d, TILE * 1.5, (G.mh - 1.5) * TILE);
      if (boxHitsWall(x, y, e.r + 1.5)) continue;
      addParts(e.x, e.y, 10, ['#a9a9b4', '#6a6a76'], { spd: 100, life: 0.3 });
      addRing(e.x, e.y, '#a9a9b4', { vr: 180, life: 0.25 });
      e.x = x; e.y = y; e.vx = 0; e.vy = 0;
      addParts(x, y, 10, ['#a9a9b4', '#e8e8ee'], { spd: 100, life: 0.3 });
      e.cd = Math.max(e.cd, 1.0);
      G.sfx('enemyDash');
      return true;
    }
    return false;
  }

  function separation() {
    const es = G.enemies;
    for (let i = 0; i < es.length; i++) {
      const a = es[i];
      if (a.dead || a.spawning > 0) continue;
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j];
        if (b.dead || b.spawning > 0) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = a.r + b.r;
        if (d > 0 && d < min) {
          const push = (min - d) * 0.5 * 0.55;
          const ux = dx / d, uy = dy / d;
          const ma = a.mass, mb = b.mass;
          a.x -= ux * push * (mb / (ma + mb)) * 2; a.y -= uy * push * (mb / (ma + mb)) * 2;
          b.x += ux * push * (ma / (ma + mb)) * 2; b.y += uy * push * (ma / (ma + mb)) * 2;
          resolveOutOfWall(a); resolveOutOfWall(b);
        }
      }
      // 与玩家软分离（避免贴脸磨血）
      const P = G.player;
      const dx = P.x - a.x, dy = P.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = a.r + P.r;
      if (d > 0 && d < min) {
        const push = (min - d) * 0.6;
        a.x -= dx / d * push; a.y -= dy / d * push;
        resolveOutOfWall(a);
        if (a.contact > 0 && a.spawning <= 0 && P.iframes <= 0 && P.dashT <= 0
          && !(a.isBoss && a.st === 'dying')) damagePlayer(a.contact, a.x, a.y);
      }
    }
  }

  /* ---------------- 子弹 / 地雷 / 激光 ---------------- */
  function grenadeBoom(b) {
    explode(b.x, b.y, 36, 10 * G.stats.dmg * comboMul() * echoMul(), true, '#ff8a3d');
  }
  function updateBullets(dt) {
    const P = G.player, s = G.stats;
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      b.t += dt; b.life -= dt;
      if (b.life <= 0) {
        if (b.kind === 'grenade') grenadeBoom(b);
        G.bullets.splice(i, 1); continue;
      }
      // 游隼导弹：转向最近敌人
      if (b.kind === 'homing' && b.friendly) {
        let best = null, bd = 280;
        for (const e of G.enemies) {
          if (e.dead || e.spawning > 0) continue;
          const dd = dist(b.x, b.y, e.x, e.y);
          if (dd < bd) { bd = dd; best = e; }
        }
        if (best) {
          const want = Math.atan2(best.y - b.y, best.x - b.x);
          const cur = Math.atan2(b.vy, b.vx);
          const na = cur + angDiff(cur, want) * Math.min(1, 3.6 * dt);
          const sp = Math.hypot(b.vx, b.vy) || 1;
          b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
        }
      }
      let dead = false;
      // 逐轴移动 + 撞墙
      const stepX = b.vx * dt, stepY = b.vy * dt;
      if (stepX) {
        b.x += stepX;
        if (G.solidAtPx(b.x, b.y)) {
          if (b.bounces > 0) { b.x -= stepX; b.vx = -b.vx * 0.92; b.bounces--; b.bounced = true; if (b.bounced && s.bouncePierce) b.pierce = 999; addParts(b.x, b.y, 3, b.color, { spd: 60, life: 0.2 }); }
          else { if (b.kind === 'grenade') grenadeBoom(b); addParts(b.x, b.y, 3, b.color, { spd: 70, life: 0.22 }); dead = true; }
        }
      }
      if (!dead && stepY) {
        b.y += stepY;
        if (G.solidAtPx(b.x, b.y)) {
          if (b.bounces > 0) { b.y -= stepY; b.vy = -b.vy * 0.92; b.bounces--; b.bounced = true; if (b.bounced && s.bouncePierce) b.pierce = 999; addParts(b.x, b.y, 3, b.color, { spd: 60, life: 0.2 }); }
          else { if (b.kind === 'grenade') grenadeBoom(b); addParts(b.x, b.y, 3, b.color, { spd: 70, life: 0.22 }); dead = true; }
        }
      }
      if (dead) { G.bullets.splice(i, 1); continue; }
      // 命中判定
      if (b.friendly) {
        for (const e of G.enemies) {
          if (e.dead || e.spawning > 0) continue;
          if (b.hitIds && b.hitIds.has(e.id)) continue;
          if (dist(b.x, b.y, e.x, e.y) < b.r + e.r) {
            // 防暴盾格挡判定
            if (e.type === 'guard' && e.broken <= 0) {
              const bdir = Math.atan2(b.vy, b.vx);
              if (Math.abs(angDiff(bdir + Math.PI, e.facing)) < 1.15) {
                addParts(b.x, b.y, 5, ['#a9a9b4', '#ffffff'], { spd: 90, life: 0.25 });
                addFloater(e.x, e.y - 10, '格挡', '#8b8b98');
                G.sfx('clink');
                dead = true; break;
              }
            }
            const crit = b.crit || false;
            damageEnemy(e, b.dmg, Math.atan2(b.vy, b.vx), b.knock, crit);
            if (b.kind === 'grenade') { grenadeBoom(b); dead = true; break; }
            if (b.hitIds) b.hitIds.add(e.id);
            if (b.pierce > 0) { b.pierce--; }
            else { dead = true; break; }
          }
        }
      } else {
        if (P.iframes <= 0 && P.dashT <= 0 && dist(b.x, b.y, P.x, P.y) < b.r + P.r) {
          damagePlayer(1, b.x, b.y);
          dead = true;
        }
      }
      if (dead) G.bullets.splice(i, 1);
    }
  }

  function updateMines(dt) {
    for (let i = G.mines.length - 1; i >= 0; i--) {
      const m = G.mines[i];
      m.t += dt; m.fuse -= dt;
      if (m.fuse <= 0) {
        G.mines.splice(i, 1);
        explode(m.x, m.y, m.r, m.dmg, false, '#ffb84d');
      }
    }
  }

  /* 引力井：范围内持续拉扯玩家（相位冲刺可挣脱），到期内爆 */
  function updateWells(dt) {
    const P = G.player;
    for (let i = G.wells.length - 1; i >= 0; i--) {
      const w = G.wells[i];
      w.t += dt;
      if (w.t >= w.fuse) {
        G.wells.splice(i, 1);
        addRing(w.x, w.y, '#ffb84d', { r0: 6, vr: 340, life: 0.35, width: 3 });
        explode(w.x, w.y, 34, w.dmg, false, '#ffb84d');
        continue;
      }
      const d = dist(P.x, P.y, w.x, w.y);
      if (d < w.r && d > 0.01 && P.dashT <= 0) {
        const k = w.pull * (0.35 + 0.65 * (1 - d / w.r));
        P.vx += (w.x - P.x) / d * k * dt;
        P.vy += (w.y - P.y) / d * k * dt;
        if (G.particles.length < 400 && rng.chance(0.35)) {
          const a = rng.range(0, TAU), rr = rng.range(w.r * 0.5, w.r);
          G.particles.push({
            x: w.x + Math.cos(a) * rr, y: w.y + Math.sin(a) * rr,
            vx: -Math.cos(a) * 130, vy: -Math.sin(a) * 130,
            life: 0.4, max: 1, color: '#ffb84d', size: 1.4, drag: 0.5, grav: 0,
          });
        }
      }
    }
  }

  function updateLasers(dt) {
    // 狙击手瞄准线
    for (let i = G.lasers.length - 1; i >= 0; i--) {
      const l = G.lasers[i];
      if (l.dead || (l.owner && l.owner.dead)) G.lasers.splice(i, 1);
    }
    // Boss 扇形扫射激光
    const L = G.bossLaser;
    if (L) {
      L.t += dt;
      if (L.t < L.charge) { L.phase = 'charge'; }
      else if (L.t < L.charge + L.active) {
        L.phase = 'fire';
        const prog = (L.t - L.charge) / L.active;
        const cur = lerp(L.a0, L.a1, prog);
        L.beams = [];
        const P = G.player;
        for (let i = 0; i < L.count; i++) {
          const a = cur + (i / (L.count - 1) - 0.5) * L.spread;
          const hit = G.raycastWall(L.x0, L.y0, a, 520);
          L.beams.push({ x0: L.x0, y0: L.y0, x1: hit.x, y1: hit.y, a });
          if (pointSegDist(P.x, P.y, L.x0, L.y0, hit.x, hit.y) < 7 && P.iframes <= 0 && P.dashT <= 0) {
            damagePlayer(L.dmg, L.x0, L.y0);
          }
        }
        if (Math.random() < 0.3) G.sfx('laserFire');
      } else {
        L.phase = 'done'; L.done = true;
      }
    }
  }

  /* ---------------- 波次 / 房间 / 区域 ---------------- */
  function pickType(weights) {
    let total = 0;
    for (const k in weights) total += weights[k];
    let r = rng() * total;
    for (const k in weights) { r -= weights[k]; if (r <= 0) return k; }
    return 'charger';
  }

  G.loadRoom = function () {
    const zone = ZONES[G.zoneIdx];
    loadMap(zone.maps[G.roomIdx]);
    G.enemies.length = 0; G.bullets.length = 0; G.pickups.length = 0;
    G.mines.length = 0; G.lasers.length = 0; G.beams.length = 0;
    G.bossLaser = null; G.wells.length = 0;
    G.particles.length = 0; G.rings.length = 0; G.ghosts.length = 0;
    G.floaters.length = 0; timers.length = 0;
    G.isBossRoom = false; G.portal = null; G.roomClearT = 0;
    G.chipOffered = false;
    G.fade = 1;
    // 玩家出生点：底部中央附近的空地
    const P = G.player;
    P.x = (G.mw * TILE) / 2; P.y = (G.mh - 2.5) * TILE;
    while (boxHitsWall(P.x, P.y, P.r) && P.y > TILE * 3) P.y -= TILE;
    P.vx = 0; P.vy = 0; P.kx = 0; P.ky = 0; P.iframes = 1.0; P.undyingUsed = false;
    computeReachable(P.x, P.y);
    // 波次
    const budget = 3 + (G.zoneIdx + 1) * 2 + G.roomIdx * 2;
    const w1 = Math.ceil(budget / 2);
    G.waves = [
      Array.from({ length: w1 }, () => pickType(zone.weights)),
      Array.from({ length: budget - w1 }, () => pickType(zone.weights)),
    ];
    G.wavIdx = -1; G.pendSpawns = []; G.waveDelay = 1.0;
    banner(zone.name, '区域 ' + (G.roomIdx + 1) + ' / ' + zone.maps.length, zone.accent, 2.2);
    G.roomLabel = '区域 ' + (G.roomIdx + 1) + '/' + zone.maps.length;
    // 晶片箱（第 2 区起 60% 概率）
    if ((G.zoneIdx >= 1 || G.roomIdx >= 1) && rng.chance(0.6)) {
      const spot = farSpot(140);
      if (spot) {
        const pool = ['smg', 'shotgun', 'railgun'].filter(w => w !== G.weapons[0].id);
        G.pickups.push({ x: spot.x, y: spot.y, kind: 'crate', weapon: rng.pick(pool), t: 0 });
      }
    }
  };

  G.loadBossRoom = function (bossId) {
    bossId = bossId || 'boss';
    loadMap('boss');
    G.enemies.length = 0; G.bullets.length = 0; G.pickups.length = 0;
    G.mines.length = 0; G.lasers.length = 0; G.beams.length = 0;
    G.bossLaser = null; G.wells.length = 0;
    G.particles.length = 0; G.rings.length = 0; G.ghosts.length = 0;
    G.floaters.length = 0; timers.length = 0;
    G.isBossRoom = true; G.portal = null; G.roomClearT = 0; G.fade = 1;
    const P = G.player;
    P.x = (G.mw * TILE) / 2; P.y = (G.mh - 2.5) * TILE;
    while (boxHitsWall(P.x, P.y, P.r) && P.y > TILE * 3) P.y -= TILE;
    P.vx = 0; P.vy = 0; P.iframes = 1.2; P.undyingUsed = false;
    computeReachable(P.x, P.y);
    let d = ENEMY_DEFS[bossId];
    if (G.debugBossHp) d = Object.assign({}, d, { hp: G.debugBossHp });
    const boss = {
      id: ++G.eid, type: bossId, isBoss: true, x: (G.mw * TILE) / 2, y: TILE * 4,
      vx: 0, vy: 0, kx: 0, ky: 0, r: d.r, mass: d.mass, speed: d.speed,
      hp: d.hp, maxHp: d.hp, contact: d.contact, name: d.name,
      phases: d.phases, pools: d.pools, final: !!d.final,
      flash: 0, hitCd: 0, spawning: 0, dead: false,
      st: 'intro', t: 1.8, phase: 1, invuln: 0.8, atk: null, atkT: 1.2,
      orbitDir: 1, ringOff: 0, aimA: Math.PI / 2, bob: 0,
    };
    G.enemies.push(boss);
    G.bossRef = boss;
    banner(d.name, d.sub || 'BOSS', d.color || '#ff4757', 2.6);
    G.roomLabel = d.final ? '最终首领战' : '首领战 · ' + (ZONES[G.zoneIdx] ? ZONES[G.zoneIdx].short : '');
    G.sfx('bossRoar'); shake(5);
  };

  function farSpot(minD) {
    const P = G.player;
    const src = (G.spawnSpots && G.spawnSpots.length) ? G.spawnSpots : G.floorSpots;
    const cands = src.filter(s =>
      dist(s.x, s.y, P.x, P.y) > minD && !boxHitsWall(s.x, s.y, 6));
    if (!cands.length) return null;
    return rng.pick(cands);
  }

  function spawnWave() {
    const list = G.waves[G.wavIdx];
    G.pendSpawns = list.slice();
    // 交由 wave 逻辑按存活数逐个落场
  }

  function updateWaves(dt) {
    if (G.isBossRoom) return;
    // 场上存活 < 7 时，从待生成队列落人
    const alive = G.enemies.filter(e => !e.dead).length;
    if (G.pendSpawns.length && alive < 7) {
      G.spawnT = (G.spawnT || 0) - dt;
      if (G.spawnT <= 0) {
        G.spawnT = 0.35;
        const type = G.pendSpawns.shift();
        const spot = farSpot(110);
        if (spot) spawnEnemy(type, spot.x, spot.y);
        else G.pendSpawns.unshift(type);
      }
    }
    // 下一波
    if (G.wavIdx < G.waves.length - 1) {
      const aliveNow = G.enemies.filter(e => !e.dead).length;
      if (G.wavIdx >= 0 && G.pendSpawns.length === 0 && aliveNow === 0) {
        G.waveDelay -= dt;
        if (G.waveDelay <= 0) { G.wavIdx++; spawnWave(); G.waveDelay = 0.8; }
      } else if (G.wavIdx === -1) {
        G.waveDelay -= dt;
        if (G.waveDelay <= 0) { G.wavIdx = 0; spawnWave(); }
      }
    }
    // 房间肃清
    if (G.wavIdx >= G.waves.length - 1 && G.pendSpawns.length === 0
      && G.enemies.filter(e => !e.dead).length === 0 && G.roomClearT === 0 && G.chipOffer == null) {
      G.roomClearT = 0.01;
    }
    if (G.roomClearT > 0) {
      G.roomClearT += dt;
      if (G.roomClearT > 0.9 && !G.chipOffered && G.chipOffer == null && G.state === 'playing') {
        G.chipOffered = true;
        // 战利品（掉在可达点）
        const spot = farSpot(30) || { x: G.player.x, y: G.player.y };
        if (rng.chance(0.4)) G.pickups.push({ x: spot.x, y: spot.y, kind: 'heart', t: 0 });
        else if (rng.chance(0.5)) G.pickups.push({ x: spot.x, y: spot.y, kind: 'battery', t: 0 });
        offerChips();
      }
    }
  }

  function offerChips() {
    // 加权抽 3 个不重复晶片
    const pool = CHIPS.slice();
    const picks = [];
    for (let n = 0; n < 3 && pool.length; n++) {
      let total = 0;
      for (const c of pool) total += c.weight;
      let r = rng() * total;
      let chosen = pool[0];
      for (const c of pool) { r -= c.weight; if (r <= 0) { chosen = c; break; } }
      picks.push(chosen);
      pool.splice(pool.indexOf(chosen), 1);
    }
    G.chipOffer = picks.map(c => ({
      id: c.id, name: c.name, desc: c.desc, rarity: c.rarity,
      syn: SYNERGIES.filter(s => s.need.includes(c.id) && s.need.every(n2 => n2 === c.id || G.chips.includes(n2))),
    }));
    G.state = 'chip';
    G.sfx('chipOffer');
  }

  G.chooseChip = function (i) {
    if (G.state !== 'chip' || !G.chipOffer || !G.chipOffer[i]) return;
    const c = G.chipOffer[i];
    const before = G.synActive.map(s => s.id);
    G.chips.push(c.id);
    G.computeStats();
    const newly = G.synActive.filter(s => !before.includes(s.id));
    for (const syn of newly) {
      banner('羁绊激活 · ' + syn.name, syn.desc, '#ffb84d', 2.4);
      G.sfx('syn');
    }
    if (!newly.length) toast('已装备晶片：' + c.name, '#45f0e2');
    G.sfx('chipPick');
    G.chipOffer = null;
    G.state = 'playing';
    const zc = ZONES[G.zoneIdx];
    if (G.roomIdx + 1 >= zc.maps.length) openShop();  // 区域末尾 → 补给站
    else openPortal();
  };

  function openPortal() {
    // 传送门开在玩家附近的可达安全点；无理想候选时选最近的可达点（绝不出现在墙内）
    const P = G.player;
    const src = (G.spawnSpots && G.spawnSpots.length) ? G.spawnSpots : G.floorSpots;
    let cands = src.filter(s => {
      const d = dist(s.x, s.y, P.x, P.y);
      return d > 60 && d < 170 && !boxHitsWall(s.x, s.y, 8);
    });
    if (!cands.length) {
      cands = src.filter(s => dist(s.x, s.y, P.x, P.y) > 40 && !boxHitsWall(s.x, s.y, 8));
      cands.sort((a, b) => dist(a.x, a.y, P.x, P.y) - dist(b.x, b.y, P.x, P.y));
      cands = cands.slice(0, 3);
    }
    const spot = cands.length ? rng.pick(cands) : { x: P.x, y: P.y };
    G.portal = { x: spot.x, y: spot.y, open: true, t: 0 };
    G.sfx('portalOpen');
    toast('传送门已开启', '#45f0e2');
  };

  function openShop() {
    const disc = G.stats.lucky ? 0.85 : 1;
    const P = (n) => Math.max(1, Math.round(n * disc));
    const items = [{ kind: 'heal', name: '纳米医疗包', desc: '回复 2 点生命', price: P(6), rarity: 1 }];
    const pool = ['chip', 'battery', 'weapon', 'power'];
    for (let i = 0; i < 2; i++) {
      const k = rng.pick(pool);
      if (k === 'chip') {
        const c = rng.pick(CHIPS);
        items.push({ kind: 'chip', chipId: c.id, name: c.name, desc: c.desc, rarity: c.rarity, price: P(12) });
      } else if (k === 'battery') {
        items.push({ kind: 'battery', name: '护盾电容组', desc: '护盾上限 +1 并回满护盾', price: P(10), rarity: 2 });
      } else if (k === 'weapon') {
        const w = rng.pick(['smg', 'shotgun', 'railgun', 'homing', 'grenade'].filter(x => x !== G.weapons[0].id));
        items.push({ kind: 'weapon', weapon: w, name: WEAPONS[w].name, desc: WEAPONS[w].desc, price: P(10), rarity: 2 });
      } else {
        items.push({ kind: 'power', name: '攻击强化剂', desc: '永久伤害 +8%', price: P(14), rarity: 3 });
      }
    }
    G.shopItems = items;
    G.shopVisits = (G.shopVisits || 0) + 1;
    G.state = 'shop';
    G.sfx('chipOffer');
    toast('补给站已接入 · 使用金币采购', '#ffb84d');
  }

  G.shopBuy = function (i) {
    if (G.state !== 'shop' || !G.shopItems || !G.shopItems[i] || G.shopItems[i].sold) return;
    const it = G.shopItems[i];
    if (G.coins < it.price) { toast('金币不足', '#ff4757'); G.sfx('clink'); return; }
    G.coins -= it.price;
    it.sold = true;
    if (it.kind === 'heal') {
      G.player.hp = Math.min(G.player.maxHp, G.player.hp + 2);
      addFloater(G.player.x, G.player.y - 12, '+2', '#ff4757');
    } else if (it.kind === 'chip') {
      const before = G.synActive.map(s2 => s2.id);
      G.chips.push(it.chipId);
      G.computeStats();
      const newly = G.synActive.filter(s2 => !before.includes(s2.id));
      for (const syn of newly) { banner('羁绊激活 · ' + syn.name, syn.desc, '#ffb84d', 2.4); G.sfx('syn'); }
    } else if (it.kind === 'battery') {
      G.bonusShield = (G.bonusShield || 0) + 1;
      G.computeStats();
      G.player.shield = G.player.maxShield;
    } else if (it.kind === 'weapon') {
      G.weapons[0] = WEAPONS[it.weapon]; G.weaponSlot = 0;
      G.computeStats();
      toast('已换装：' + WEAPONS[it.weapon].name, '#ffb84d');
    } else if (it.kind === 'power') {
      G.powerBonus = (G.powerBonus || 0) + 0.08;
      G.computeStats();
    }
    G.sfx('buy');
  };

  G.shopLeave = function () {
    if (G.state !== 'shop') return;
    G.shopItems = null;
    G.state = 'playing';
    G.sfx('ui');
    openPortal();
  };

  G.nextLevel = function () {
    const zone = ZONES[G.zoneIdx];
    // 首领房内的传送门：区域守卫已击破 → 进入下一区
    if (G.isBossRoom) {
      G.isBossRoom = false;
      G.zoneIdx++; G.roomIdx = 0;
      G.loadRoom();
      return;
    }
    if (G.roomIdx + 1 < zone.maps.length) {
      G.roomIdx++;
      G.loadRoom();
    } else if (zone.bossId && !G.bossDown[G.zoneIdx]) {
      // 区域末尾（补给站之后）：进入该区首领战
      G.loadBossRoom(zone.bossId);
    } else if (G.zoneIdx + 1 < ZONES.length) {
      G.zoneIdx++; G.roomIdx = 0;
      G.loadRoom();
    } else {
      G.loadBossRoom(zone.bossId || 'boss');
    }
  };

  /* ---------------- 玩家更新 ---------------- */
  function updatePlayer(dt) {
    const P = G.player, inp = G.input, s = G.stats;
    if (!isFinite(P.x) || !isFinite(P.y)) { P.x = 100; P.y = 100; P.vx = 0; P.vy = 0; }

    // 指针瞄准（bot 直接给 aimA）
    P.aimA = (inp.aimA != null) ? inp.aimA
      : Math.atan2(inp.my - P.y, inp.mx - P.x);
    if (!isFinite(P.aimA)) P.aimA = 0;

    const dashPressed = inp.dash; inp.dash = false;
    const meleePressed = inp.melee; inp.melee = false;
    const interactPressed = inp.interact; inp.interact = false;
    if (inp.slot >= 0) {
      if (inp.slot !== G.weaponSlot && inp.slot < G.weapons.length) {
        G.weaponSlot = inp.slot; G.computeStats(); P.fireT = Math.max(P.fireT, 0.18); P.chargeT = 0;
        G.sfx('switch');
      }
      inp.slot = -1;
    }

    P.iframes = Math.max(0, P.iframes - dt);
    P.dashCd = Math.max(0, P.dashCd - dt);
    P.fireT -= dt; P.meleeCd -= dt; P.slashT = Math.max(0, P.slashT - dt);
    P.muzzleT = Math.max(0, P.muzzleT - dt);
    P.recoil = Math.max(0, P.recoil - dt * 8);
    P.bob += dt;
    G.vengeanceT = Math.max(0, (G.vengeanceT || 0) - dt);
    G.killSpeedT = Math.max(0, (G.killSpeedT || 0) - dt);
    G.dashEchoT = Math.max(0, (G.dashEchoT || 0) - dt);

    // 护盾充能
    P.shieldT += dt;
    if (P.shieldT > 2.6 * s.shieldDelay && P.shield < P.maxShield) {
      P.shield = Math.min(P.maxShield, P.shield + 1.4 * dt);
    }

    // 冲刺
    if (dashPressed && P.dashCd <= 0) {
      let a;
      const ml = Math.hypot(inp.moveX, inp.moveY);
      if (ml > 0.1) a = Math.atan2(inp.moveY, inp.moveX);
      else a = P.aimA;
      P.dashA = a; P.dashT = 0.16;
      P.dashCd = 0.9 * s.dashCd;
      P.iframes = Math.max(P.iframes, 0.24);
      G.dashEchoT = G.stats.dashEcho ? (G.synActive.some(s2 => s2.id === 'phasekill') ? 2.0 : 1.0) : 0;
      G.sfx('dash');
    }

    // 移动
    let mx = clamp(inp.moveX, -1, 1), my = clamp(inp.moveY, -1, 1);
    const mlen = Math.hypot(mx, my);
    if (mlen > 1) { mx /= mlen; my /= mlen; }
    const spd = 96 * s.speed * (G.killSpeedT > 0 ? 1.3 : 1);
    if (P.dashT > 0) {
      P.dashT -= dt;
      P.vx = Math.cos(P.dashA) * 345; P.vy = Math.sin(P.dashA) * 345;
      if (G.ghosts.length < 30) G.ghosts.push({ x: P.x, y: P.y, life: 0.25, max: 0.25, aimA: P.aimA });
    } else {
      const k = 1 - Math.exp(-13 * dt);
      P.vx += (mx * spd - P.vx) * k;
      P.vy += (my * spd - P.vy) * k;
    }

    // 攻击输入
    const w = G.weapons[G.weaponSlot];
    if (meleePressed) meleeSlash();
    if (inp.fire) {
      if (w.type === 'melee') {
        if (P.fireT <= 0) { meleeSlash(); P.fireT = w.interval / s.rate; }
      } else if (w.type === 'rail') {
        P.chargeT += dt;
        if (P.chargeT >= w.charge) { P.chargeT = 0; fireRail(); P.fireT = w.interval / s.rate; }
      } else {
        if (P.fireT <= 0) {
          P.fireT = w.interval / s.rate;
          let pellets = w.pellets + s.proj;
          if (w.id === 'shotgun' && G.chips.includes('split')) pellets += 1;
          const spread = w.spread * (w.id === 'shotgun' ? Math.max(0.5, s.spreadMul) : s.spreadMul);
          fireGun(w, pellets, spread, 1);
        }
      }
    } else {
      P.chargeT = 0;
    }
    // 相位刃主手挥砍冷却与 gun 共用 fireT

    // 位移 + 碰撞
    const dx = (P.vx + P.kx) * dt, dy = (P.vy + P.ky) * dt;
    if (moveAxis(P, 'x', dx)) { P.vx = 0; P.kx = -P.kx * 0.3; }
    if (moveAxis(P, 'y', dy)) { P.vy = 0; P.ky = -P.ky * 0.3; }
    P.kx *= Math.exp(-6 * dt); P.ky *= Math.exp(-6 * dt);
    resolveOutOfWall(P);

    // 拾取物
    for (let i = G.pickups.length - 1; i >= 0; i--) {
      const pk = G.pickups[i];
      pk.t += dt;
      const d = dist(P.x, P.y, pk.x, pk.y);
      if (pk.kind === 'coin') {
        if (d < 32 && d > 0.01) {
          const pull = Math.min(d, 170 * dt);
          pk.x += (P.x - pk.x) / d * pull; pk.y += (P.y - pk.y) / d * pull;
        }
        if (d < 10) { G.coins++; G.coinsCollected++; G.sfx('coin'); G.pickups.splice(i, 1); }
      } else if (pk.kind === 'crate') {
        if (d < 15) G.prompt = '按 E 拾取 · ' + WEAPONS[pk.weapon].name;
        if (d < 15 && interactPressed) {
          G.weapons[0] = WEAPONS[pk.weapon]; G.weaponSlot = 0;
          G.computeStats(); G.pickups.splice(i, 1);
          toast('已换装：' + WEAPONS[pk.weapon].name, '#ffb84d');
          G.sfx('pickup'); addParts(P.x, P.y, 8, '#ffb84d', { spd: 80, life: 0.4 });
        }
      } else if (d < 13) {
        if (pk.kind === 'heart' && P.hp < P.maxHp) {
          P.hp = Math.min(P.maxHp, P.hp + 1);
          addFloater(P.x, P.y - 12, '+1', '#ff4757');
          G.sfx('heal'); G.pickups.splice(i, 1);
        } else if (pk.kind === 'battery' && P.shield < P.maxShield) {
          P.shield = P.maxShield;
          addFloater(P.x, P.y - 12, '护盾', '#45f0e2');
          G.sfx('heal'); G.pickups.splice(i, 1);
        }
      }
    }

    // 传送门
    if (G.portal) {
      G.portal.t += dt;
      const d = dist(P.x, P.y, G.portal.x, G.portal.y);
      if (d < 16) {
        G.prompt = '按 E 进入传送门';
        if (interactPressed) { G.sfx('portalEnter'); G.nextLevel(); return; }
      }
    }
  }

  /* ---------------- 主更新 ---------------- */
  G.update = function (dt) {
    if (G.state !== 'playing') { G.prompt = null; return; }
    dt = Math.min(dt, 1 / 30);
    // 卡顿硬保护
    if (G.hitstop > 0) { G.hitstop -= dt; return; }
    const wdt = dt * G.timeScale;
    G.time += dt; G.runTime += wdt;
    G.prompt = null;

    updateTimers(wdt);
    updatePlayer(wdt);
    for (const e of G.enemies) if (!e.dead) updateEnemy(e, wdt);
    separation();
    G.enemies = G.enemies.filter(e => !e.dead);
    updateBullets(wdt);
    updateMines(wdt);
    updateWells(wdt);
    updateLasers(wdt);
    updateWaves(wdt);

    // 拾取物漂浮 & 移除标记
    for (let i = G.pickups.length - 1; i >= 0; i--) {
      const pk = G.pickups[i];
      pk.t += dt;
      if ((pk.kind === 'heart' || pk.kind === 'battery') && pk.t > 20) G.pickups.splice(i, 1);
    }

    // 连击计时
    if (G.combo > 0) { G.comboT -= dt; if (G.comboT <= 0) G.combo = 0; }

    // 特效衰减
    G.shake *= Math.exp(-6.5 * dt);
    if (G.shake < 0.03) G.shake = 0;
    G.flashFx = Math.max(0, G.flashFx - dt * 2.2);
    G.hurtFx = Math.max(0, G.hurtFx - dt * 1.8);
    G.fade = Math.max(0, G.fade - dt * 2.4);
    if (G.banner) { G.banner.life -= dt; if (G.banner.life <= 0) G.banner = null; }
    for (let i = G.toasts.length - 1; i >= 0; i--) {
      G.toasts[i].life -= dt;
      if (G.toasts[i].life <= 0) G.toasts.splice(i, 1);
    }
    // 粒子/浮字/环/残影
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const p = G.particles[i];
      p.life -= dt;
      if (p.life <= 0) { G.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const dg = Math.exp(-(p.drag || 4) * dt);
      p.vx *= dg; p.vy *= dg;
      p.vy += (p.grav || 0) * dt;
    }
    for (let i = G.floaters.length - 1; i >= 0; i--) {
      const f = G.floaters[i];
      f.life -= dt;
      if (f.life <= 0) { G.floaters.splice(i, 1); continue; }
      f.y += f.vy * dt; f.vy *= Math.exp(-2.5 * dt);
    }
    for (let i = G.rings.length - 1; i >= 0; i--) {
      const r = G.rings[i];
      r.life -= dt;
      if (r.life <= 0) { G.rings.splice(i, 1); continue; }
      r.r += r.vr * dt;
    }
    for (let i = G.ghosts.length - 1; i >= 0; i--) {
      G.ghosts[i].life -= dt;
      if (G.ghosts[i].life <= 0) G.ghosts.splice(i, 1);
    }
    for (let i = G.beams.length - 1; i >= 0; i--) {
      G.beams[i].t -= dt;
      if (G.beams[i].t <= 0) G.beams.splice(i, 1);
    }
  };

  /* ---------------- 开始 / 调试 ---------------- */
  G.startRun = function (heroId) {
    G.heroId = heroId || 'vanguard';
    G.chips = []; G.synActive = []; G.weaponSlot = 0;
    G.weapons = [WEAPONS[(HEROES[G.heroId] || HEROES.vanguard).weapon], WEAPONS.blade];
    G.coins = 0; G.coinsCollected = 0; G.shopVisits = 0;
    G.bonusShield = 0; G.powerBonus = 0; G.dashEchoT = 0; G.shopItems = null;
    const P = G.player;
    P.hp = 6; P.maxHp = 6; P.shield = 3; P.maxShield = 3; P.shieldT = 0;
    P.iframes = 0; P.dashCd = 0; P.dashT = 0; P.undyingUsed = false;
    G.zoneIdx = 0; G.roomIdx = 0; G.isBossRoom = false; G.bossDown = {};
    G.score = 0; G.kills = 0; G.damageTaken = 0; G.combo = 0; G.maxCombo = 0;
    G.runTime = 0; G.timeScale = 1; G.hitstop = 0;
    G.vengeanceT = 0; G.killSpeedT = 0; G.bossRef = null;
    G.endScreen = null; G.chipOffer = null; G.toasts = [];
    G.computeStats();
    G.loadRoom();
    G.state = 'playing';
  };

  G.debugStress = function () {
    for (let i = 0; i < 30; i++) {
      const spot = farSpot(60) || { x: 100, y: 100 };
      const e = spawnEnemy(rng.pick(['charger', 'gunner', 'guard', 'sniper']), spot.x, spot.y);
      e.spawning = 0;
    }
    for (let i = 0; i < 260; i++) {
      const a = rng.range(0, TAU);
      spawnBullet(rng.range(60, 420), rng.range(60, 220), a, rng.range(80, 200), 1, false, { life: 8 });
    }
  };
  G.debugClear = function () {
    G.enemies.length = 0; G.bullets.length = 0; G.mines.length = 0;
    G.lasers.length = 0; G.bossLaser = null; G.wells.length = 0; G.particles.length = 0;
  };
  G.debugSpawn = function (type, x, y) {
    const e = spawnEnemy(type, x, y);
    e.spawning = 0;
    return e;
  };
  G.debugJump = function (zone, room) {
    G.zoneIdx = clamp(zone - 1, 0, ZONES.length - 1);
    G.roomIdx = clamp(room - 1, 0, ZONES[G.zoneIdx].maps.length - 1);
    G.loadRoom(); G.state = 'playing';
  };

  if (!headless && root.ZERO_RENDER) root.ZERO_RENDER.attach(G);
  else G.render = function () {};
  G.computeStats();  // 标题界面 HUD 即会读取属性袋，创建时初始化避免空引用

  return G;
}

root.ZERO_GAME = { createGame };
if (typeof module !== 'undefined' && module.exports) module.exports = root.ZERO_GAME;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
