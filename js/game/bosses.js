/* ============================================================
 * 零号协议 ZERO PROTOCOL —— game/bosses.js
 * 部件：Boss 三阶段状态机（updateBoss：ring/fan/fanlaser/mines/spiral/
 *       clones/gravity/blinkstorm）/ 转阶段 bossTransition / 濒死 bossDying /
 *       相位跃迁 bossBlink / 攻击轮换 / 首领房装载 loadBossRoom
 * 只定义部件工厂（createGame 时由 facade 按固定顺序调用），无顶层即时逻辑。
 * ============================================================ */
(function (root) {
'use strict';
const PARTS = root.ZERO_GAME_PARTS = root.ZERO_GAME_PARTS || {};

PARTS.bosses = function (ctx) {
  const C = ctx.C;
  const { TAU, clamp, dist, TILE, ENEMY_DEFS, ZONES, BOSS_PHASES } = C;
  const G = ctx.G;
  const rng = ctx.rng;

  /* Boss 难度表（test/balance.js · M3 标尺 commit30/trackK3/sight100/delay10/dashSkip0.6 标定，
   * 全流程语境=预扣生命；两 Boss 均通过率 < 37%）：
   * v1.11 修正武器/护盾结算后重标：boss1 25% · boss2 30%。HP/弹速/单发伤害保留。
   * G.bossTuning（实验注入钩）与之相乘。 */
  const BOSS_DIFF = {
    boss: { aggression: 2.3374, bulletMul: 2.637, densityMul: 3.291, dmgMul: 4.068 },
    boss2: { aggression: 4.912, bulletMul: 3.869, densityMul: 7.3675, dmgMul: 6.14 },
  };

  function diffOf(e) { return BOSS_DIFF[e.type] || {}; }

  /* ---------------- Boss ---------------- */
  function bossTransition(e, ph) {
    e.st = 'transition'; e.t = 1.5; e.phase = ph; e.invuln = 1.6;
    if (G.visualEvent) G.visualEvent('phase', e);
    e.atk = null; e.atkIdx = 0;   // 转阶段重置攻击轮换 → 下一段以该阶段签名攻击开场
    G.bossLaser = null;
    // 清除敌方弹幕 → 火花
    for (const b of G.bullets) if (!b.friendly) { ctx.addParts(b.x, b.y, 2, '#ff4757', { spd: 40, life: 0.3 }); b.life = 0; }
    const ph1 = (e.phases || BOSS_PHASES)[ph - 1];
    ctx.addRing(e.x, e.y, ph1.color, { r0: 6, vr: 380, life: 0.6, width: 3 });
    ctx.flash('#ffffff', 0.16); ctx.shake(6); G.sfx('phase');
    ctx.banner('阶段 ' + ['Ⅰ', 'Ⅱ', 'Ⅲ'][ph - 1] + ' · ' + ph1.name, e.name, ph1.color, 2.0);
  }

  function bossDying(e) {
    e.st = 'dying'; e.t = 1.3; e.expT = 0;
    if (G.visualEvent) G.visualEvent('death', e);
    for (const b of G.bullets) if (!b.friendly) b.life = 0;
    G.bossLaser = null; G.mines.length = 0; G.wells.length = 0;
    G.timeScale = 0.35;
    ctx.addParts(e.x, e.y, 40, ['#ff4757', '#ffb84d', '#ffffff'], { spd: 220, life: 0.7, size: 2.6 });
    ctx.addRing(e.x, e.y, '#ffffff', { vr: 300, life: 0.5, width: 3 });
    ctx.shake(6); G.sfx('kill');
    ctx.banner('核心击穿', e.name, '#ffffff', 2.2);
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
        ctx.addParts(e.x + rng.range(-14, 14), e.y + rng.range(-14, 14), 10, ['#ff4757', '#ffb84d', '#ffffff'], { spd: 150, life: 0.5, size: 2.4 });
        ctx.addRing(e.x + rng.range(-10, 10), e.y + rng.range(-10, 10), '#ffb84d', { vr: 200, life: 0.3 });
        ctx.shake(3); G.sfx('explosion');
      }
      if (e.t <= 0) {
        G.timeScale = 1;
        ctx.addParts(e.x, e.y, 80, ['#ffffff', '#ffb84d', '#ff4757'], { spd: 260, life: 0.9, size: 3 });
        ctx.flash('#ffffff', 0.6); ctx.shake(9);
        e.dead = true;
        G.bossDown[G.zoneIdx] = true;
        if (e.final) {
          G.state = 'victory';
          G.endScreen = { victory: true, stats: ctx.endStats() };
          G.sfx('victory');
        } else {
          // 区域守卫击破：掉落补给 → 开启传送门挺进下一区（非最终 Boss 不结算）
          for (let ci = 0, n = 8 * (G.daily && G.daily.flag.coinRain ? 2 : 1); ci < n; ci++) {
            G.pickups.push({ x: e.x + rng.range(-20, 20), y: e.y + rng.range(-16, 16), kind: 'coin', t: 0 });
          }
          if (G.daily && G.daily.flag.coinOnly) {
            G.pickups.push({ x: e.x, y: e.y + 10, kind: 'coin', t: 0 });  // 通货紧缩：补给折算为金币
          } else {
            G.pickups.push({ x: e.x - 14, y: e.y + 10, kind: 'heart', t: 0 });
            G.pickups.push({ x: e.x + 14, y: e.y + 10, kind: 'battery', t: 0 });
          }
          ctx.banner('区域守卫已击破', '传送门开启 · 挺进下一区', ZONES[G.zoneIdx].accent, 2.6);
          G.sfx('phase');
          ctx.openPortal();
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
    // 弹幕密度：BOSS_DIFF 难度表 × G.bossTuning 实验注入钩（默认空 = 仅难度表生效）
    const dm = (diffOf(e).densityMul || 1) * ((G.bossTuning && G.bossTuning.densityMul) || 1);

    function bossBullet(ang, speed) {
      // 弹速/单发伤害：BOSS_DIFF 难度表 × G.bossTuning 实验注入钩
      const bt = G.bossTuning || {};
      const df = diffOf(e);
      ctx.spawnBullet(e.x, e.y, ang, speed * (df.bulletMul || 1) * (bt.bulletMul || 1),
        Math.max(1, Math.round(1 * (df.dmgMul || 1) * (bt.dmgMul || 1))), false, {
        color: '#ff4757', core: '#ffd9dd', r: 3, knock: 0, life: 6,
      });
    }

    if (atk.kind === 'ring') {
      if (!atk.fired && atk.t > 0.35) {
        atk.fired = true;
        const n = Math.round((20 + e.phase * 4) * dm);
        e.ringOff = (e.ringOff || 0) + 0.37;
        for (let i = 0; i < n; i++) bossBullet(e.ringOff + i / n * TAU, 92 + e.phase * 8);
        if (e.phase >= 2) {
          ctx.setTimeoutLike(0.25, () => {
            if (!e.dead && e.st !== 'dying') {
              const n2 = Math.round(18 * dm); e.ringOff += 0.19;
              for (let i = 0; i < n2; i++) bossBullet(e.ringOff + i / n2 * TAU + 0.17, 105);
              G.sfx('shoot');
            }
          });
        }
        G.sfx('shoot'); ctx.shake(1.5);
        e.st = 'idle'; e.atkT = bossAtkInterval(e); e.atk = null;
      }
    } else if (atk.kind === 'fan') {
      if (atk.t > atk.step * 0.2) {
        const base = Math.atan2(P.y - e.y, P.x - e.x);
        const cnt = Math.max(3, Math.round(5 * dm));
        for (let i = 0; i < cnt; i++) bossBullet(base + (i - (cnt - 1) / 2) * 0.16, 150 + e.phase * 8);
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
          count: Math.max(3, Math.round(5 * dm)), spread: 1.25, t: 0, charge: 0.8, active: 1.2,
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
        const stepIv = 0.09 / dm;
        atk.acc = (atk.acc || 0) + dt;
        while (atk.acc > stepIv) {
          atk.acc -= stepIv;
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
          if (ctx.boxHitsWall(x, y, 6)) continue;
          const m = ctx.spawnEnemy('echo', x, y);
          m.spawning = 0.5;
          ctx.addRing(x, y, '#e8e8ee', { vr: 150, life: 0.3 });
          if (++spawned >= want) break;
        }
        const base = Math.atan2(P.y - e.y, P.x - e.x);
        const cnt = Math.max(3, Math.round(3 * dm));
        for (let i = 0; i < cnt; i++) bossBullet(base + (i - (cnt - 1) / 2) * 0.22, 165);
        G.sfx('shoot');
        e.st = 'idle'; e.atkT = bossAtkInterval(e); e.atk = null;
      }
    } else if (atk.kind === 'gravity') {
      // 引力陷阱：在玩家附近布设引力井（持续拉扯，结束时内爆）+ 缓速环弹
      if (!atk.fired && atk.t > 0.5) {
        atk.fired = true;
        if (G.wells.length < 4) {
          // 引力井注入钩：wellCount（数量）/ pullMul（拉力）——难度标定用，默认 2 井 × 820
          const bt2 = G.bossTuning || {};
          const df2 = diffOf(e);
          const n = Math.min(4, Math.max(1, Math.round(2 * (df2.wellCount || bt2.wellCount || 1))));
          const pull = 820 * (df2.pullMul || 1) * (bt2.pullMul || 1);
          for (let i = 0; i < n; i++) {
            const ox = rng.range(-75, 75), oy = rng.range(-55, 55);
            let wx = clamp(P.x + ox, TILE * 2, (G.mw - 2) * TILE);
            let wy = clamp(P.y + oy, TILE * 2, (G.mh - 2) * TILE);
            if (G.solidAtPx(wx, wy)) { wx = P.x; wy = P.y; }
            G.wells.push({
              x: wx, y: wy, t: 0, fuse: e.phase >= 3 ? 2.6 : 3.2,
              r: 92, pull, dmg: 2 * (df2.dmgMul || 1) * (bt2.dmgMul || 1),
            });
            ctx.addRing(wx, wy, '#ffb84d', { r0: 4, vr: 220, life: 0.4 });
            G.sfx('minePlace');
          }
        }
        const n2 = Math.max(6, Math.round(14 * dm));
        for (let i = 0; i < n2; i++) bossBullet(i / n2 * TAU + rng.range(0, 0.3), 85);
        G.sfx('shoot');
        e.st = 'idle'; e.atkT = bossAtkInterval(e); e.atk = null;
      }
    } else if (atk.kind === 'blinkstorm') {
      // 相位风暴：两次相位跃迁，各接一组弹幕
      if (!atk.st1 && atk.t > 0.35) {
        atk.st1 = true;
        bossBlink(e);
        const arms = Math.max(4, Math.round(4 * dm));
        for (let arm = 0; arm < arms; arm++)
          for (let i = 0; i < 4; i++) bossBullet(atk.a0 + arm / arms * TAU + i * 0.055, 118 + i * 9);
        G.sfx('enemyDash'); ctx.shake(2);
      }
      if (!atk.st2 && atk.t > 1.15) {
        atk.st2 = true;
        bossBlink(e);
        const n = Math.round(18 * dm);
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
      if (ctx.boxHitsWall(x, y, e.r + 2)) continue;
      ctx.addParts(e.x, e.y, 12, ['#e8e8ee', '#a9a9b4'], { spd: 120, life: 0.35 });
      ctx.addRing(e.x, e.y, '#e8e8ee', { vr: 220, life: 0.3 });
      e.x = x; e.y = y; e.vx = 0; e.vy = 0;
      ctx.addParts(x, y, 12, ['#e8e8ee', '#6a6a76'], { spd: 120, life: 0.35 });
      return true;
    }
    return false;
  }

  function bossAtkInterval(e) {
    // 攻击欲望：BOSS_DIFF 难度表 × G.bossTuning 实验注入钩（>1 缩短攻击间隔）
    const aggr = (diffOf(e).aggression || 1) * ((G.bossTuning && G.bossTuning.aggression) || 1);
    return (e.phase === 1 ? 1.7 : e.phase === 2 ? 1.4 : 1.1) * rng.range(0.85, 1.15) / aggr;
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

  G.loadBossRoom = function (bossId) {
    bossId = bossId || 'boss';
    G.doors = []; G.doorsLocked = false;
    G.roomVisit = (G.roomVisit || 0) + 1;
    ctx.loadMap('boss');
    G.enemies.length = 0; ctx.pooledClear(G.bullets, ctx.poolBullets); G.pickups.length = 0;
    G.mines.length = 0; G.lasers.length = 0; G.beams.length = 0;
    G.bossLaser = null; G.wells.length = 0;
    ctx.pooledClear(G.particles, ctx.poolParticles); ctx.pooledClear(G.rings, ctx.poolRings); G.ghosts.length = 0;
    ctx.pooledClear(G.floaters, ctx.poolFloaters); ctx.timers.length = 0;
    G.isBossRoom = true; G.portal = null; G.roomClearT = 0; G.fade = 1;
    const P = G.player;
    P.x = (G.mw * TILE) / 2; P.y = (G.mh - 2.5) * TILE;
    while (ctx.boxHitsWall(P.x, P.y, P.r) && P.y > TILE * 3) P.y -= TILE;
    P.vx = 0; P.vy = 0; P.iframes = 1.2; P.undyingUsed = false;
    ctx.computeReachable(P.x, P.y);
    let d = ENEMY_DEFS[bossId];
    if (G.debugBossHp) d = Object.assign({}, d, { hp: G.debugBossHp });
    // Boss 数值注入钩：G.bossTuning.hpMul/speedMul（难度标定用，默认空 = 行为不变）
    const bt = G.bossTuning || {};
    const boss = {
      id: ++G.eid, type: bossId, isBoss: true, x: (G.mw * TILE) / 2, y: TILE * 4,
      vx: 0, vy: 0, kx: 0, ky: 0, r: d.r, mass: d.mass, speed: d.speed * (bt.speedMul || 1),
      hp: d.hp * (bt.hpMul || 1), maxHp: d.hp * (bt.hpMul || 1), contact: d.contact, name: d.name,
      phases: d.phases, pools: d.pools, final: !!d.final,
      flash: 0, hitCd: 0, spawning: 0, dead: false,
      st: 'intro', t: 1.8, phase: 1, invuln: 0.8, atk: null, atkT: 1.2,
      orbitDir: 1, ringOff: 0, aimA: Math.PI / 2, bob: 0,
    };
    G.enemies.push(boss);
    G.bossRef = boss;
    ctx.banner(d.name, d.sub || 'BOSS', d.color || '#ff4757', 2.6);
    G.roomLabel = d.final ? '最终首领战' : '首领战 · ' + (ZONES[G.zoneIdx] ? ZONES[G.zoneIdx].short : '');
    G.sfx('bossRoar'); ctx.shake(5);
  };

  /* ---- 跨部件挂载：谁定义谁挂 ctx ---- */
  ctx.bossTransition = bossTransition;
  ctx.bossDying = bossDying;
  ctx.updateBoss = updateBoss;
};

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
