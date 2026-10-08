/* ============================================================
 * 零号协议 ZERO PROTOCOL —— game/player.js
 * 部件：属性计算 / 玩家状态初始化 / 玩家更新（移动·冲刺·换枪·拾取·传送门）/
 *       武器开火（枪械 fireGun · 轨道 fireRail · 近战 meleeSlash）/ 玩家受击
 * 只定义部件工厂（createGame 时由 facade 按固定顺序调用），无顶层即时逻辑；
 * G.weapons / G.player 的字面量初始化沿用原 createGame 的立即赋值语义。
 * ============================================================ */
(function (root) {
'use strict';
const PARTS = root.ZERO_GAME_PARTS = root.ZERO_GAME_PARTS || {};

PARTS.player = function (ctx) {
  const C = ctx.C;
  const { clamp, dist, angDiff, WEAPONS, CHIPS, SYNERGIES, HEROES } = C;
  const G = ctx.G;
  const rng = ctx.rng;

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
    // 晶片：lv = 升级次数，效果缩放 k = 1.5^lv
    for (const id of G.chips) {
      const c = CHIPS.find(c => c.id === id); if (!c) continue;
      const lv = (G.chipLv && G.chipLv[id]) || 0;
      c.apply(s, lv > 0 ? Math.pow(1.5, lv) : 1);
    }
    G.synActive = [];
    for (const syn of SYNERGIES) {
      if (syn.need.every(n => G.chips.includes(n))) { syn.apply(s); G.synActive.push(syn); }
    }
    if (s.noSplitPenalty && G.chips.includes('split')) s.dmg += 0.22 * (s.splitK || 1);
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
      ctx.spawnBullet(mx, my, p.a, w.speed * rng.range(0.95, 1.05), p.dmg, true, {
        color: w.color, knock: w.knock, pierce: s.pierce, bounces: s.bounce,
        life: w.bulletLife || w.range / w.speed, r: w.bulletR || 2.5, kind: w.kind,
      });
    }
    P.vx -= Math.cos(aim) * (w.id === 'shotgun' ? 55 : 12);
    P.vy -= Math.sin(aim) * (w.id === 'shotgun' ? 55 : 12);
    P.recoil = 1; P.muzzleT = 0.06;
    if (G.visualEvent) G.visualEvent('attack', P);
    ctx.addParts(mx, my, 4, [w.color, '#ffffff'], { spd: 60, life: 0.15, size: 1.6 });
    ctx.shake(w.shake);
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
      if (ctx.pointSegDist(e.x, e.y, P.x, P.y, x1, y1) < e.r + 4) {
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
      if (e.type === 'guard' && !e.broken) ctx.breakGuard(e);
      ctx.damageEnemy(e, dmg, P.aimA, w.knock, crit);
      if (s.railAoe > 0) ctx.explode(e.x, e.y, s.railAoe, 9 * s.dmg, true, w.color);
    }
    ctx.addParts(x1, y1, 10, [w.color, '#ffffff'], { spd: 120, life: 0.3 });
    ctx.addRing(x1, y1, w.color, { vr: 200, life: 0.25 });
    P.recoil = 1.6; ctx.shake(w.shake); ctx.flash('#b9bcff', 0.08);
    if (G.visualEvent) G.visualEvent('attack', P);
    G.sfx('rail');
    G.sfx('railImpact');
  }

  function meleeSlash() {
    const P = G.player, s = G.stats, w = WEAPONS.blade;
    if (P.meleeCd > 0) return;
    P.meleeCd = w.interval / s.rate;
    P.slashT = 0.16; P.slashA = P.aimA;
    if (G.visualEvent) G.visualEvent('melee', P);
    const range = w.range * s.meleeRange, arc = w.arc;
    let hitAny = false;
    for (const e of G.enemies) {
      if (e.dead || e.spawning > 0) continue;
      const d = dist(P.x, P.y, e.x, e.y);
      if (d < range + e.r && Math.abs(angDiff(P.aimA, Math.atan2(e.y - P.y, e.x - P.x))) < arc / 2) {
        const crit = rng.chance(s.crit);
        let dmg = w.dmg * s.dmg * s.melee * comboMul() * echoMul() * (G.vengeanceT > 0 ? 1 + s.revenge : 1);
        if (crit) dmg *= s.critMul;
        if (e.type === 'guard' && !e.broken) ctx.breakGuard(e);
        ctx.damageEnemy(e, dmg, Math.atan2(e.y - P.y, e.x - P.x), w.knock, crit);
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
    if (deflect) { G.sfx('deflect'); ctx.addRing(P.x, P.y, '#45f0e2', { vr: 220, life: 0.2, r0: 8 }); }
    else G.sfx('slash');
    if (hitAny) { G.hitstop = Math.max(G.hitstop, 0.05); ctx.shake(1.8); }
  }

  /* ---------------- 伤害处理 ---------------- */
  function damagePlayer(n, sx, sy) {
    const P = G.player;
    if (P.iframes > 0 || G.state !== 'playing') return;
    n *= G.damageTuning == null ? C.DIFFICULTIES[G.difficultyId].damageScale : G.damageTuning;
    const s = G.stats;
    if (s.undying && !P.undyingUsed && P.hp - Math.max(0, n - P.shield) <= 0) {
      P.undyingUsed = true;
      P.hp = 1; P.shield = P.maxShield; P.iframes = 1.6;
      ctx.toast('不灭战意：拒绝倒下！', '#45f0e2');
      ctx.addRing(P.x, P.y, '#45f0e2', { vr: 300, life: 0.5, width: 3 });
      G.sfx('deflect'); return;
    }
    const absorb = Math.min(P.shield, n);
    P.shield -= absorb; n -= absorb;
    if (n > 0) P.hp -= n;
    P.iframes = 0.9; P.shieldT = 0;
    G.damageTaken++;
    G.vengeanceT = 3;
    G.hurtFx = 1; ctx.shake(3.5); ctx.flash('#ff4757', 0.10);
    if (G.visualEvent) G.visualEvent('hurt', P);
    if (sx != null) { P.vx += (P.x - sx) * 2.2; P.vy += (P.y - sy) * 2.2; }
    G.sfx(absorb > 0 && n <= 0 ? 'shieldHit' : 'hurt');
    if (P.shield <= 0 && absorb > 0) { G.sfx('shieldBreak'); ctx.addRing(P.x, P.y, '#45f0e2', { vr: 200, life: 0.3 }); }
    if (P.hp <= 0) {
      P.hp = 0; G.state = 'defeat';
      if (G.visualEvent) G.visualEvent('death', P);
      G.deathLog = '在第 ' + (G.zoneIdx + 1) + ' 区倒下 · 击杀 ' + G.kills;
      G.endScreen = { victory: false, stats: ctx.endStats() };
      ctx.addParts(P.x, P.y, 40, ['#ffffff', '#ff4757', '#a9a9b4'], { spd: 200, life: 0.8, size: 2.6 });
      ctx.addRing(P.x, P.y, '#ff4757', { vr: 320, life: 0.6, width: 3 });
      G.sfx('death'); ctx.shake(8);
    }
  }

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
      if (G.visualEvent) G.visualEvent('dash', P);
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
        // 冷却结束后才能蓄力；持续按住也必须遵守射击间隔。
        if (P.fireT <= 0) {
          P.chargeT += dt;
          if (P.chargeT >= w.charge) { P.chargeT = 0; fireRail(); P.fireT = w.interval / s.rate; }
        }
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
    if (ctx.moveAxis(P, 'x', dx)) { P.vx = 0; P.kx = -P.kx * 0.3; }
    if (ctx.moveAxis(P, 'y', dy)) { P.vy = 0; P.ky = -P.ky * 0.3; }
    P.kx *= Math.exp(-6 * dt); P.ky *= Math.exp(-6 * dt);
    ctx.resolveOutOfWall(P);

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
          ctx.toast('已换装：' + WEAPONS[pk.weapon].name, '#ffb84d');
          G.sfx('pickup'); ctx.addParts(P.x, P.y, 8, '#ffb84d', { spd: 80, life: 0.4 });
        }
      } else if (d < 13) {
        if (pk.kind === 'heart' && P.hp < P.maxHp) {
          P.hp = Math.min(P.maxHp, P.hp + 1);
          ctx.addFloater(P.x, P.y - 12, '+1', '#ff4757');
          G.sfx('heal'); G.pickups.splice(i, 1);
        } else if (pk.kind === 'battery' && P.shield < P.maxShield) {
          P.shield = P.maxShield;
          ctx.addFloater(P.x, P.y - 12, '护盾', '#45f0e2');
          G.sfx('heal'); G.pickups.splice(i, 1);
        }
      }
    }

    // 房门：战斗封锁，肃清后按 E 往返相邻房间。
    for (const door of (G.doors || [])) {
      if (dist(P.x, P.y, door.x, door.y) < 18) {
        G.prompt = G.doorsLocked ? '战斗中 · 房门已封锁' : '按 E 前往 · ' + door.name;
        if (!G.doorsLocked && interactPressed) { G.useDoor(door.to); return; }
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

  /* ---- 跨部件挂载：谁定义谁挂 ctx ---- */
  ctx.comboMul = comboMul;
  ctx.echoMul = echoMul;
  ctx.damagePlayer = damagePlayer;
  ctx.updatePlayer = updatePlayer;
};

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
