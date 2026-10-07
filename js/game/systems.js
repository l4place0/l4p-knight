/* ============================================================
 * 零号协议 ZERO PROTOCOL —— game/systems.js
 * 部件：碰撞助手 / 子弹 / 地雷 / 引力井 / 激光 / 爆炸结算 / 主更新管线
 * 只定义部件工厂（createGame 时由 facade 按固定顺序调用），无顶层即时逻辑。
 * ============================================================ */
(function (root) {
'use strict';
const PARTS = root.ZERO_GAME_PARTS = root.ZERO_GAME_PARTS || {};

PARTS.systems = function (ctx) {
  const C = ctx.C;
  const { TAU, clamp, lerp, dist, angDiff, TILE, WEAPONS } = C;
  const G = ctx.G;
  const rng = ctx.rng;

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
  function pointSegDist(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x0) * dx + (py - y0) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return dist(px, py, x0 + dx * t, y0 + dy * t);
  }

  /* ---------------- 爆炸（伤害结算） ---------------- */
  function explode(x, y, r, dmg, friendly, color) {
    ctx.addParts(x, y, 14, [color || '#ffb84d', '#ffffff', '#6a6a76'], { spd: 180, life: 0.45, size: 2.2 });
    ctx.addRing(x, y, color || '#ffb84d', { r0: 4, vr: 320, life: 0.32, width: 3 });
    ctx.shake(2.6); G.sfx('explosion');
    if (friendly) {
      for (const e of G.enemies) {
        if (e.dead || e.spawning > 0) continue;
        const d = dist(x, y, e.x, e.y);
        if (d < r + e.r) ctx.damageEnemy(e, dmg, Math.atan2(e.y - y, e.x - x), 140, false);
      }
    } else {
      const P = G.player;
      if (dist(x, y, P.x, P.y) < r + P.r) ctx.damagePlayer(dmg, x, y);
    }
  }

  /* ---------------- 子弹 / 地雷 / 激光 ---------------- */
  function grenadeBoom(b) {
    explode(b.x, b.y, 36, WEAPONS.grenade.blastDmg * G.stats.dmg * ctx.comboMul() * ctx.echoMul(), true, '#ff8a3d');
  }
  function updateBullets(dt) {
    const P = G.player, s = G.stats;
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      b.t += dt; b.life -= dt;
      if (b.life <= 0) {
        if (b.kind === 'grenade') grenadeBoom(b);
        G.bullets.splice(i, 1); ctx.poolBullets.release(b); continue;
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
          if (b.bounces > 0) { b.x -= stepX; b.vx = -b.vx * 0.92; b.bounces--; b.bounced = true; if (b.bounced && s.bouncePierce) b.pierce = 999; ctx.addParts(b.x, b.y, 3, b.color, { spd: 60, life: 0.2 }); }
          else { if (b.kind === 'grenade') grenadeBoom(b); ctx.addParts(b.x, b.y, 3, b.color, { spd: 70, life: 0.22 }); dead = true; }
        }
      }
      if (!dead && stepY) {
        b.y += stepY;
        if (G.solidAtPx(b.x, b.y)) {
          if (b.bounces > 0) { b.y -= stepY; b.vy = -b.vy * 0.92; b.bounces--; b.bounced = true; if (b.bounced && s.bouncePierce) b.pierce = 999; ctx.addParts(b.x, b.y, 3, b.color, { spd: 60, life: 0.2 }); }
          else { if (b.kind === 'grenade') grenadeBoom(b); ctx.addParts(b.x, b.y, 3, b.color, { spd: 70, life: 0.22 }); dead = true; }
        }
      }
      if (dead) { G.bullets.splice(i, 1); ctx.poolBullets.release(b); continue; }
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
                ctx.addParts(b.x, b.y, 5, ['#a9a9b4', '#ffffff'], { spd: 90, life: 0.25 });
                ctx.addFloater(e.x, e.y - 10, '格挡', '#8b8b98');
                G.sfx('clink');
                dead = true; break;
              }
            }
            const crit = b.crit || false;
            ctx.damageEnemy(e, b.dmg, Math.atan2(b.vy, b.vx), b.knock, crit);
            if (b.kind === 'grenade') { grenadeBoom(b); dead = true; break; }
            if (b.hitIds) b.hitIds.add(e.id);
            if (b.pierce > 0) { b.pierce--; }
            else { dead = true; break; }
          }
        }
      } else {
        if (P.iframes <= 0 && P.dashT <= 0 && dist(b.x, b.y, P.x, P.y) < b.r + P.r) {
          ctx.damagePlayer(b.dmg || 1, b.x, b.y);   // 弹体伤害生效（此前硬编码 1，b.dmg 对玩家从不生效）
          dead = true;
        }
      }
      if (dead) { G.bullets.splice(i, 1); ctx.poolBullets.release(b); }
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
        ctx.addRing(w.x, w.y, '#ffb84d', { r0: 6, vr: 340, life: 0.35, width: 3 });
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
          const p = ctx.poolParticles.acquire();
          ctx.initParticle(p,
            w.x + Math.cos(a) * rr, w.y + Math.sin(a) * rr,
            -Math.cos(a) * 130, -Math.sin(a) * 130,
            0.4, '#ffb84d', 1.4, 0.5, 0);
          G.particles.push(p);
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
            ctx.damagePlayer(L.dmg, L.x0, L.y0);
          }
        }
        if (Math.random() < 0.3) G.sfx('laserFire');
      } else {
        L.phase = 'done'; L.done = true;
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

    ctx.updateTimers(wdt);
    ctx.updatePlayer(wdt);
    for (const e of G.enemies) if (!e.dead) ctx.updateEnemy(e, wdt);
    ctx.separation();
    G.enemies = G.enemies.filter(e => !e.dead);
    updateBullets(wdt);
    updateMines(wdt);
    updateWells(wdt);
    updateLasers(wdt);
    ctx.updateWaves(wdt);

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
      if (p.life <= 0) { G.particles.splice(i, 1); ctx.poolParticles.release(p); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const dg = Math.exp(-(p.drag || 4) * dt);
      p.vx *= dg; p.vy *= dg;
      p.vy += (p.grav || 0) * dt;
    }
    for (let i = G.floaters.length - 1; i >= 0; i--) {
      const f = G.floaters[i];
      f.life -= dt;
      if (f.life <= 0) { G.floaters.splice(i, 1); ctx.poolFloaters.release(f); continue; }
      f.y += f.vy * dt; f.vy *= Math.exp(-2.5 * dt);
    }
    for (let i = G.rings.length - 1; i >= 0; i--) {
      const r = G.rings[i];
      r.life -= dt;
      if (r.life <= 0) { G.rings.splice(i, 1); ctx.poolRings.release(r); continue; }
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

  /* ---- 跨部件挂载：谁定义谁挂 ctx ---- */
  G.boxHitsWall = boxHitsWall;
  G.pointSegDist = pointSegDist;
  ctx.boxHitsWall = boxHitsWall;
  ctx.moveAxis = moveAxis;
  ctx.resolveOutOfWall = resolveOutOfWall;
  ctx.pointSegDist = pointSegDist;
  ctx.explode = explode;
};

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
