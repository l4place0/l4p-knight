/* ============================================================
 * 零号协议 ZERO PROTOCOL —— game/enemies.js
 * 部件：伤害结算（damageEnemy / breakGuard / killEnemy）/ 敌人生成（含精英词条）/
 *       七种敌人 AI（charger·gunner·guard·sniper·bomber·wraith·echo）/
 *       敌人积分运动 / 虚空徘徊者相位闪现 / 敌间与敌玩家软分离
 * 只定义部件工厂（createGame 时由 facade 按固定顺序调用），无顶层即时逻辑。
 * ============================================================ */
(function (root) {
'use strict';
const PARTS = root.ZERO_GAME_PARTS = root.ZERO_GAME_PARTS || {};

PARTS.enemies = function (ctx) {
  const C = ctx.C;
  const { TAU, clamp, dist, angDiff, TILE, ENEMY_DEFS } = C;
  const G = ctx.G;
  const rng = ctx.rng;

  /* ---------------- 伤害处理 ---------------- */
  function damageEnemy(e, dmg, dir, knock, crit) {
    if (e.dead || e.spawning > 0) return;
    if (e.isBoss && (e.invuln > 0 || e.st === 'transition' || e.st === 'dying')) {
      if (rng.chance(0.08)) ctx.addFloater(e.x, e.y - 14, '免疫', '#8b8b98');
      return;
    }
    if (e.slowT > 0 && G.stats.frostAmp) dmg = dmg * 1.2;
    e.hp -= dmg;
    if (G.stats.frost) e.slowT = Math.max(e.slowT || 0, e.type === 'boss' ? 0.6 : (G.stats.frostAmp ? 2.2 : 1.8) * (G.stats.frostK || 1));
    e.flash = 1; e.hitCd = 0.05;
    if (G.visualEvent) G.visualEvent('hurt', e);
    if (knock) {
      const m = e.mass || 1;
      e.kx += Math.cos(dir) * knock / m;
      e.ky += Math.sin(dir) * knock / m;
    }
    ctx.addFloater(e.x, e.y - e.r - 2, crit ? Math.round(dmg) + '!' : (Math.round(dmg * 10) / 10),
      crit ? '#ffb84d' : '#f2f2f6', crit);
    ctx.addParts(e.x, e.y, crit ? 7 : 4, [crit ? '#ffb84d' : '#ffffff', '#45f0e2'], { spd: 110, life: 0.25 });
    G.score += Math.round(dmg);
    G.hitstop = Math.max(G.hitstop, crit ? 0.06 : 0.035);
    G.sfx('hit', { pitch: crit ? 1.3 : 1 });
    if (e.isBoss) {
      // Boss 阶段判定（血量逻辑：仅在正常阶段边界触发一次）
      const frac = e.hp / e.maxHp;
      if (e.st !== 'transition' && e.st !== 'dying') {
        if (e.phase === 1 && frac <= 2 / 3) ctx.bossTransition(e, 2);
        else if (e.phase === 2 && frac <= 1 / 3) ctx.bossTransition(e, 3);
      }
    }
    if (e.hp <= 0) killEnemy(e);
  }

  function breakGuard(e) {
    if (e.type !== 'guard' || e.broken > 0) return;
    e.broken = 6; e.staggerT = 1.6;
    if (G.visualEvent) G.visualEvent('special', e);
    ctx.addFloater(e.x, e.y - 12, '破盾!', '#ff4757', true);
    ctx.addParts(e.x, e.y, 12, ['#a9a9b4', '#ffffff'], { spd: 140, life: 0.4 });
    ctx.addRing(e.x, e.y, '#a9a9b4', { vr: 180, life: 0.3 });
    G.sfx('guardBreak'); ctx.shake(2.2);
  }

  function killEnemy(e) {
    if (e.dead) return;
    G.kills++;
    G.combo++; G.comboT = 3;
    G.maxCombo = Math.max(G.maxCombo, G.combo);
    G.score += Math.round(ENEMY_DEFS[e.type].score * (1 + G.combo * 0.03));
    const s = G.stats;
    if (s.killHeal && rng.chance(s.killHeal) && G.player.hp < G.player.maxHp) {
      G.player.hp++; ctx.addFloater(G.player.x, G.player.y - 12, '+1', '#45f0e2');
    }
    if (s.killSpeed) G.killSpeedT = s.killSpeed;
    if (s.dashResetKill) G.player.dashCd = 0;
    if (e.type === 'guard' && rng.chance(0.22)) G.pickups.push({ x: e.x, y: e.y, kind: (G.daily && G.daily.flag.coinOnly) ? 'coin' : 'heart', t: 0 });
    if (e.isBoss) {
      // Boss 走独立死亡流程：滞留场内直至演出结束（否则状态机死锁）
      ctx.bossDying(e);
      if (G.combo === 10 || G.combo === 15 || G.combo === 20) ctx.toast('连击 ×' + G.combo + '！', '#ffb84d');
      return;
    }
    e.dead = true;
    if (G.visualEvent) G.visualEvent('death', e);
    // 金币掉落
    const luckyMul = G.stats.lucky ? 1 + 0.6 * (G.stats.luckyK || 1) : 1;
    const coinN = (e.elite ? 3 : (e.type === 'guard' ? 2 : 1)) * (G.daily && G.daily.flag.coinRain ? 2 : 1);
    if (e.elite || rng.chance(0.65 * luckyMul)) {
      for (let ci = 0; ci < coinN; ci++) {
        G.pickups.push({ x: e.x + rng.range(-7, 7), y: e.y + rng.range(-7, 7), kind: 'coin', t: 0 });
      }
    }
    // 引爆核心：敌人死亡爆炸
    if (G.stats.chain) {
      ctx.explode(e.x, e.y, G.stats.chainBig ? 42 : 26, (G.stats.chainBig ? 9 : 6) * G.stats.dmg * (G.stats.chainK || 1), true, '#ffb84d');
    }
    // 弹药回涌
    if (G.stats.reload) G.player.fireT *= 1 - Math.min(0.6, 0.2 * (G.stats.reloadK || 1));
    ctx.addParts(e.x, e.y, 16, ['#a9a9b4', '#6a6a76', e.type === 'charger' ? '#ff4757' : '#45f0e2'], { spd: 150, life: 0.6, size: 2.4 });
    ctx.addRing(e.x, e.y, '#ffffff', { vr: 240, life: 0.3, width: 2 });
    ctx.shake(2);
    G.hitstop = Math.max(G.hitstop, 0.07);
    G.sfx('kill');
    if (G.combo === 10 || G.combo === 15 || G.combo === 20) ctx.toast('连击 ×' + G.combo + '！', '#ffb84d');
  }

  /* ---------------- 敌人 AI ---------------- */
  function spawnEnemy(type, x, y) {
    const d = ENEMY_DEFS[type];
    const z = G.zoneIdx;
    const tuned = !d.isBoss && !G.isBossRoom;
    const diff = Object.assign({ hpMul: 1, speedMul: 1, aggression: 1, bulletMul: 1, densityMul: 1, dmgMul: 1 },
      tuned ? C.ENEMY_DIFF[z + 1] : null, tuned ? G.enemyTuning : null);
    if (tuned && G.enemyTuning?.hpMul == null) diff.hpMul *= (G.curveTuning || C.DIFFICULTY_CURVE).enemyHp ?? 1;
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
      diff,
    };
    e.hp *= diff.hpMul; e.maxHp *= diff.hpMul;
    e.speed *= diff.speedMul; e.contact *= diff.dmgMul;
    // 精英词条（第 2 区起概率出现，越深入越高；每日「精英横行」约 3 倍）
    if (G.zoneIdx >= 1) {
      const eliteBase = G.zoneIdx >= 2 ? 0.22 : 0.15;
      const eliteP = (G.daily && G.daily.flag.eliteUp) ? Math.min(0.85, eliteBase * 3) : eliteBase;
      if (rng.chance(eliteP)) {
        e.elite = true;
        e.hp *= 2.2; e.maxHp *= 2.2;
        e.speed *= 1.05;
      }
    }
    G.enemies.push(e);
    ctx.addParts(x, y, 8, ['#45f0e2', '#a9a9b4'], { spd: 60, life: 0.5 });
    return e;
  }

  function enemyBullet(e, x, y, angle, speed, damage, opts) {
    if (G.visualEvent) G.visualEvent('attack', e);
    return ctx.spawnBullet(x, y, angle, speed * e.diff.bulletMul, damage * e.diff.dmgMul, false, opts);
  }

  function updateEnemy(e, dt) {
    e.flash = Math.max(0, e.flash - dt * 6);
    e.hitCd -= dt;
    if (e.spawning > 0) { e.spawning -= dt; e.vx = 0; e.vy = 0; return; }
    if (e.isBoss) { ctx.updateBoss(e, dt); integrateEnemy(e, dt); return; }

    const P = G.player;
    const d = dist(e.x, e.y, P.x, P.y);
    const aTo = Math.atan2(P.y - e.y, P.x - e.x);
    e.t += dt; e.cd -= dt * e.diff.aggression;
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
        e.vx = Math.cos(e.dashA) * 255 * e.diff.speedMul; e.vy = Math.sin(e.dashA) * 255 * e.diff.speedMul;
        ctx.addParts(e.x, e.y, 1, '#6a6a76', { spd: 20, life: 0.3 });
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
        e.burstT -= dt * e.diff.aggression;
        if (e.burstT <= 0) {
          e.burstT = 0.13; e.burst--;
          const spread = 0.07;
          const a = aTo + rng.range(-spread, spread);
          enemyBullet(e, e.x + Math.cos(a) * 8, e.y + Math.sin(a) * 8, a, 145 + G.zoneIdx * 12, 1,
            { color: '#ff4757', core: '#ffd9dd', r: 3, life: 5 });
          G.sfx('enemyShoot');
        }
      } else if (e.cd <= 0 && G.losClear(e.x, e.y, P.x, P.y) && d < 300) {
        e.pat = (G.zoneIdx >= 1 && rng.chance(0.4) && d > 130) ? 'ring' : 'aim';
        if (e.pat === 'ring') {
          const n = Math.max(1, Math.round(10 * e.diff.densityMul));
          for (let i = 0; i < n; i++) {
            const a = i / n * TAU + rng.range(0, 0.2);
            enemyBullet(e, e.x, e.y, a, 95, 1, { color: '#ff4757', core: '#ffd9dd', r: 3, life: 5 });
          }
          G.sfx('enemyShoot'); e.cd = rng.range(2.0, 2.6);
        } else { e.burst = Math.max(1, Math.round(3 * e.diff.densityMul)); e.burstT = 0.1; e.cd = rng.range(1.9, 2.5); }
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
          if (ctx.pointSegDist(P.x, P.y, e.x, e.y, hitP.x, hitP.y) < 6.5) ctx.damagePlayer(2 * e.diff.dmgMul, e.x, e.y);
          ctx.addParts(hitP.x, hitP.y, 6, ['#ff4757', '#ffffff'], { spd: 100, life: 0.3 });
          G.sfx('sniperFire');
          if (G.visualEvent) G.visualEvent('attack', e);
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
          if (G.visualEvent) G.visualEvent('death', e);
          ctx.explode(e.x, e.y, 38, e.diff.dmgMul, false, '#ff4757');
        }
      } else {
        e.vx = Math.cos(aTo) * e.speed; e.vy = Math.sin(aTo) * e.speed;
        e.facing = aTo;
        ctx.addParts(e.x, e.y, 1, '#ffb84d', { spd: 14, life: 0.25, size: 1.4 });
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
        const n = Math.max(3, Math.round(3 * e.diff.densityMul));
        for (let i = 0; i < n; i++) {
          const a = aTo + (i - (n - 1) / 2) * 0.17;
          enemyBullet(e, e.x + Math.cos(a) * 8, e.y + Math.sin(a) * 8, a, 150 + G.zoneIdx * 10, 1,
            { color: '#ff4757', core: '#ffd9dd', r: 3, life: 5 });
        }
        G.sfx('enemyShoot');
        e.cd = rng.range(2.0, 2.8);
      }
      e.blinkCd = (e.blinkCd == null ? rng.range(3.5, 5.5) : e.blinkCd) - dt;
      if (e.blinkCd <= 0 && (d > 260 || !G.losClear(e.x, e.y, P.x, P.y))) {
        e.blinkCd = rng.range(4.5, 6.5);
        wraithBlink(e, P);
        if (G.visualEvent) G.visualEvent('special', e);
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
          const n = Math.max(1, Math.round(e.diff.densityMul));
          for (let i = 0; i < n; i++) enemyBullet(e, e.x, e.y, aTo + (i - (n - 1) / 2) * 0.12, 150, 1,
            { color: '#ff4757', core: '#ffffff', r: 3, life: 5 });
          G.sfx('enemyShoot');
          e.cd = rng.range(1.7, 2.4);
        }
      } else {
        e.vx = Math.cos(ma) * e.speed * 0.8; e.vy = Math.sin(ma) * e.speed * 0.8;
        e.facing = aTo;
        if (e.cd <= 0 && d < 300 && G.losClear(e.x, e.y, P.x, P.y)) {
          e.state = 'charge'; e.t = 0;
          ctx.addRing(e.x, e.y, '#e8e8ee', { r0: 2, vr: 60, life: 0.5 });
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
    const hitX = ctx.moveAxis(e, 'x', dx);
    const hitY = ctx.moveAxis(e, 'y', dy);
    if (hitX) {
      if (Math.abs(e.kx) > 60) { ctx.addParts(e.x, e.y, 3, '#a9a9b4', { spd: 60, life: 0.25 }); }
      e.kx = -e.kx * 0.3; e.vx = 0;
      if (e.type === 'charger' && e.state === 'dash') { e.state = 'stun'; e.t = 0; ctx.shake(1.2); }
    }
    if (hitY) {
      e.ky = -e.ky * 0.3; e.vy = 0;
      if (e.type === 'charger' && e.state === 'dash') { e.state = 'stun'; e.t = 0; ctx.shake(1.2); }
    }
    const damp = Math.exp(-5.5 * dt);
    e.kx *= damp; e.ky *= damp;
    ctx.resolveOutOfWall(e);
  }

  /* 虚空徘徊者相位闪现：瞬移至玩家周边 55~110px 落点（绝不落墙内），落地 1 秒预热后才会开火 */
  function wraithBlink(e, P) {
    for (let i = 0; i < 12; i++) {
      const a = rng.range(0, TAU), d = rng.range(55, 110);
      const x = clamp(P.x + Math.cos(a) * d, TILE * 1.5, (G.mw - 1.5) * TILE);
      const y = clamp(P.y + Math.sin(a) * d, TILE * 1.5, (G.mh - 1.5) * TILE);
      if (ctx.boxHitsWall(x, y, e.r + 1.5)) continue;
      ctx.addParts(e.x, e.y, 10, ['#a9a9b4', '#6a6a76'], { spd: 100, life: 0.3 });
      ctx.addRing(e.x, e.y, '#a9a9b4', { vr: 180, life: 0.25 });
      e.x = x; e.y = y; e.vx = 0; e.vy = 0;
      ctx.addParts(x, y, 10, ['#a9a9b4', '#e8e8ee'], { spd: 100, life: 0.3 });
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
          ctx.resolveOutOfWall(a); ctx.resolveOutOfWall(b);
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
        ctx.resolveOutOfWall(a);
        if (a.contact > 0 && a.spawning <= 0 && P.iframes <= 0 && P.dashT <= 0
          && !(a.isBoss && a.st === 'dying')) ctx.damagePlayer(a.contact, a.x, a.y);
      }
    }
  }

  /* ---- 跨部件挂载：谁定义谁挂 ctx ---- */
  ctx.damageEnemy = damageEnemy;
  ctx.breakGuard = breakGuard;
  ctx.spawnEnemy = spawnEnemy;
  ctx.updateEnemy = updateEnemy;
  ctx.separation = separation;
};

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
