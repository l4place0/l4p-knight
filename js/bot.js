/* ============================================================
 * 零号协议 ZERO PROTOCOL —— bot.js
 * 内置 AI 代打系统：走位 / 弹幕规避 / 目标选择 / 破盾策略 / 晶片决策
 * 与人类玩家共用同一 G.input 输入接口，保证仿真的真实性。
 * ============================================================ */
(function (root) {
'use strict';
const C = root.ZERO_CORE;
const { TAU, clamp, dist, angDiff, RNG, TILE } = C;

const CHIP_SCORE = {
  overcharge: 3.0, overclock: 2.6, split: 2.0, pierce: 2.0, bounce: 1.2,
  glass: 2.2, nano: 1.6, kinetic: 1.2, capacitor: 2.0, bladecore: 1.2,
  crit: 2.4, servo: 1.8, steady: 1.4, vengeance: 2.0,
};
const WEAPON_TIER = { smg: 1, shotgun: 2, homing: 2, grenade: 2, railgun: 3 };
const BAND = { smg: [110, 170], shotgun: [55, 105], railgun: [150, 230], blade: [16, 26], homing: [120, 190], grenade: [100, 160] };
const CONE = { smg: 0.11, shotgun: 0.32, railgun: 0.06, blade: 0.5, homing: 0.6, grenade: 0.22 };

function createBot(seed) {
  const rng = RNG(((seed || 1) * 2654435761) >>> 0 || 7);
  let strafeDir = 1, strafeT = 0, stuckT = 0, lx = 0, ly = 0;
  let stuckReps = 0, escapeT = 0, escapeA = 0, lmx = 0, lmy = 0;
  let path = [], pathT = 0, pathI = 0, pathTargetKey = '';
  let chipDelay = 0, swapT = 0;
  // 盾卫战术僵局看门狗：目标盾卫持续无伤害进展（格挡/环绕失效）达到阈值时升级为贴身刃破盾
  let stallHp = null, stallKills = 0, stallT = 0;

  function pickChip(G) {
    let best = 0, bestScore = -1;
    G.chipOffer.forEach((meta, i) => {
      let sc = CHIP_SCORE[meta.id] || 1;
      for (const syn of C.SYNERGIES) {
        if (syn.need.includes(meta.id) && syn.need.every(n => n === meta.id || G.chips.includes(n))) sc += 6;
      }
      const w = G.weapons[G.weaponSlot];
      if (meta.id === 'pierce' && w.type === 'rail') sc += 3;
      if (meta.id === 'split' && w.id === 'shotgun') sc += 1.5;
      const P = G.player;
      if (meta.id === 'glass') sc += P.hp >= P.maxHp ? 1.2 : -1.5;
      if (P.hp <= 2) {
        if (meta.id === 'nano' || meta.id === 'capacitor' || meta.id === 'servo') sc += 1.2;
      }
      sc += rng.range(0, 0.3);
      if (sc > bestScore) { bestScore = sc; best = i; }
    });
    return best;
  }

  /* 危险场计算：返回躲避向量与危险度（ignoreBomber: 僵局升级时压制自爆蜂规避——
   * 冻结/不可及的自爆蜂只有贴近才能逼爆，规避力 ×2.1 缩放会在 ~73px 形成不可突破的力平衡） */
  function computeDanger(G, P, ignoreBomber) {
    let dx = 0, dy = 0, danger = 0;
    // 敌方子弹
    for (const b of G.bullets) {
      if (b.friendly) continue;
      const rx = P.x - b.x, ry = P.y - b.y;
      const d = Math.hypot(rx, ry);
      if (d > 130 || d < 0.01) continue;
      const vl = Math.hypot(b.vx, b.vy) || 1;
      const bx = b.vx / vl, by = b.vy / vl;
      const along = rx * bx + ry * by;
      if (along < -6) continue;
      const px = rx - bx * along, py = ry - by * along;
      const pd = Math.hypot(px, py);
      if (pd < 16) {
        const wgt = (1 - d / 130) * 6.5;
        const pl = Math.hypot(px, py) || 1;
        dx += px / pl * wgt; dy += py / pl * wgt;
        danger += wgt;
      }
    }
    // 地雷
    for (const m of G.mines) {
      const d = dist(P.x, P.y, m.x, m.y);
      const rr = m.r + 26;
      if (d < rr && d > 0.01) {
        const wgt = (1 - d / rr) * 10;
        dx += (P.x - m.x) / d * wgt; dy += (P.y - m.y) / d * wgt;
        danger += wgt;
      }
    }
    // 狙击瞄准线（仅当光束到玩家之间无墙体遮挡时才算威胁——隔墙的蓄力线打不到人）
    for (const l of G.lasers) {
      const pd = G.pointSegDist(P.x, P.y, l.x0, l.y0, l.x1, l.y1);
      if (pd < 24 && G.losClear(l.x0, l.y0, P.x, P.y)) {
        // 垂直于线方向躲避
        const lx0 = l.x1 - l.x0, ly0 = l.y1 - l.y0;
        const ll = Math.hypot(lx0, ly0) || 1;
        // 选择离玩家所在侧的垂直方向
        const cross = (lx0 * (P.y - l.y0) - ly0 * (P.x - l.x0)) / ll;
        const s = cross > 0 ? 1 : -1;
        const wgt = (l.phase === 'lock' ? 14 : 10) * (1 - pd / 24);
        dx += (-ly0 / ll * s) * wgt; dy += (lx0 / ll * s) * wgt;
        danger += wgt;
      }
    }
    // Boss 扇形激光（蓄力与发射阶段）
    const L = G.bossLaser;
    if (L && L.phase !== 'done') {
      let base;
      if (L.phase === 'charge') base = lerpN(L.a0, L.a1, clamp(L.t / L.charge, 0, 1));
      else base = lerpN(L.a0, L.a1, clamp((L.t - L.charge) / L.active, 0, 1));
      const wgt = L.phase === 'fire' ? 15 : 11;
      for (let i = 0; i < L.count; i++) {
        const a = base + (i / (L.count - 1) - 0.5) * L.spread;
        const hit = G.raycastWall(L.x0, L.y0, a, 520);
        const pd = G.pointSegDist(P.x, P.y, L.x0, L.y0, hit.x, hit.y);
        if (pd < 30) {
          const s = ((P.x - L.x0) * -Math.sin(a) + (P.y - L.y0) * Math.cos(a)) > 0 ? 1 : -1;
          const w2 = wgt * (1 - pd / 30);
          dx += -Math.sin(a) * s * w2; dy += Math.cos(a) * s * w2;
          danger += w2;
        }
      }
    }
    // 引力井：持续拉扯 + 内爆，越接近越危险（内爆前 1.2 秒最急）
    for (const w of G.wells) {
      const d = dist(P.x, P.y, w.x, w.y);
      const rr = w.r + 14;
      if (d < rr && d > 0.01) {
        const urgent = (w.fuse - w.t) < 1.2;
        const wgt = (1 - d / rr) * (urgent ? 13 : 8.5);
        dx += (P.x - w.x) / d * wgt; dy += (P.y - w.y) / d * wgt;
        danger += wgt;
      }
    }
    // 自爆蜂群：贴身即爆，保持距离（僵局升级时压制）
    for (const e of G.enemies) {
      if (ignoreBomber || e.dead || e.spawning > 0 || e.type !== 'bomber') continue;
      const d2 = dist(P.x, P.y, e.x, e.y);
      if (d2 < 78 && d2 > 0.01) {
        const wgt = (1 - d2 / 78) * (e.state === 'arm' ? 13 : 8);
        dx += (P.x - e.x) / d2 * wgt; dy += (P.y - e.y) / d2 * wgt;
        danger += wgt;
      }
    }
    // 突击机兵冲锋预警
    for (const e of G.enemies) {
      if (e.dead || e.type !== 'charger' || e.state !== 'aim') continue;
      const d = dist(P.x, P.y, e.x, e.y);
      if (d < 90) {
        const a = e.dashA || 0;
        const ex = e.x + Math.cos(a) * 90, ey = e.y + Math.sin(a) * 90;
        const pd = G.pointSegDist(P.x, P.y, e.x, e.y, ex, ey);
        if (pd < 18) {
          const s = ((P.x - e.x) * -Math.sin(a) + (P.y - e.y) * Math.cos(a)) > 0 ? 1 : -1;
          dx += -Math.sin(a) * s * 7; dy += Math.cos(a) * s * 7;
          danger += 7;
        }
      }
    }
    return { dx, dy, danger };
  }

  function lerpN(a, b, t) { return a + (b - a) * t; }

  /* BFS 网格寻路：返回从玩家瓦片到目标瓦片的路径点（瓦片中心），不含起点 */
  function bfsPath(G, P, tx, ty) {
    const mw = G.mw, mh = G.mh, solid = G.solid;
    if (!solid) return null;
    const sx = clamp((P.x / 16) | 0, 0, mw - 1), sy = clamp((P.y / 16) | 0, 0, mh - 1);
    const gx = clamp((tx / 16) | 0, 0, mw - 1), gy = clamp((ty / 16) | 0, 0, mh - 1);
    const goal = gy * mw + gx;
    if (solid[goal]) return null;
    const start = sy * mw + sx;
    if (start === goal) return [{ x: tx, y: ty }];
    const prev = new Int32Array(mw * mh).fill(-1);
    prev[start] = start;
    const q = [start];
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi];
      if (cur === goal) break;
      const cx = cur % mw, cy = (cur / mw) | 0;
      if (cx + 1 < mw && prev[cur + 1] === -1 && !solid[cur + 1]) { prev[cur + 1] = cur; q.push(cur + 1); }
      if (cx - 1 >= 0 && prev[cur - 1] === -1 && !solid[cur - 1]) { prev[cur - 1] = cur; q.push(cur - 1); }
      if (cy + 1 < mh && prev[cur + mw] === -1 && !solid[cur + mw]) { prev[cur + mw] = cur; q.push(cur + mw); }
      if (cy - 1 >= 0 && prev[cur - mw] === -1 && !solid[cur - mw]) { prev[cur - mw] = cur; q.push(cur - mw); }
    }
    if (prev[goal] === -1) return null;
    const tiles = [];
    let cur = goal;
    while (cur !== start) { tiles.push(cur); cur = prev[cur]; }
    tiles.reverse();
    return tiles.map(k => ({ x: (k % mw) * 16 + 8, y: ((k / mw) | 0) * 16 + 8 }));
  }

  function pickTarget(G, P) {
    let best = null, bestScore = -1;
    for (const e of G.enemies) {
      if (e.dead || e.spawning > 0) continue;
      let sc;
      if (e.type === 'boss' || e.type === 'boss2') sc = 3.0;
      else if (e.type === 'bomber') sc = 3.4;
      else if (e.type === 'charger') sc = 3.2;
      else if (e.type === 'wraith') sc = 2.5;
      else if (e.type === 'echo') sc = 2.3;
      else if (e.type === 'sniper') sc = 2.6;
      else if (e.type === 'gunner') sc = 2.2;
      else if (e.type === 'guard') sc = e.broken > 0 ? 2.8 : 0.7;
      else sc = 1.5;
      const d = dist(P.x, P.y, e.x, e.y);
      sc += 34 / Math.max(30, d);
      // 有视线（可立即输出）的目标优先，避免隔墙死锁目标
      if (G.losClear(P.x, P.y, e.x, e.y)) sc += 0.55;
      if (sc > bestScore) { bestScore = sc; best = e; }
    }
    return best;
  }

  function update(G, dt, input) {
    const P = G.player;
    input.moveX = 0; input.moveY = 0; input.fire = false;
    input.dash = false; input.melee = false; input.interact = false;

    if (G.state === 'chip') {
      chipDelay += dt;
      if (chipDelay > 0.45) { G.chooseChip(pickChip(G)); chipDelay = 0; }
      return;
    }
    if (G.state === 'shop') {
      // 采购优先级：回血 > 晶片 > 护盾 > 更好武器 > 攻击强化；买不起就离开
      chipDelay += dt;
      if (chipDelay > 0.5) {
        const items = G.shopItems || [];
        let act = -2;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (!it || it.sold || G.coins < it.price) continue;
          if (it.kind === 'heal' && P.hp < P.maxHp) { act = i; break; }
          if (it.kind === 'chip') { act = i; break; }
          if (it.kind === 'battery') { act = i; break; }
          if (it.kind === 'weapon' && (WEAPON_TIER[it.weapon] || 0) > (WEAPON_TIER[G.weapons[0].id] || 0)) { act = i; break; }
          if (it.kind === 'power') { act = i; break; }
        }
        if (act === -2) G.shopLeave(); else G.shopBuy(act);
        chipDelay = 0;
      }
      return;
    }
    if (G.state !== 'playing' || !P) return;

    /* ---- 防卡死检测（基于上一帧输出与位移） ---- */
    const prevMove = Math.abs(lmx) + Math.abs(lmy);
    const movedPrev = dist(P.x, P.y, lx, ly);
    if (prevMove > 0.1 && movedPrev < 1.2) {
      stuckT += dt;
      if (stuckT > 1.1) {
        stuckT = 0; strafeDir = -strafeDir;
        stuckReps++;
        // 连续受困 → 给一次随机方向的脱困脉冲，打破对称绕圈
        if (stuckReps >= 3) { stuckReps = 0; escapeT = 0.7; escapeA = rng.range(0, TAU); }
      }
    } else { stuckT = 0; stuckReps = 0; }
    lx = P.x; ly = P.y;

    /* ---- 目标 ---- */
    let target = pickTarget(G, P);
    const w = G.weapons[G.weaponSlot];
    const band = BAND[w.id] || BAND.smg;
    // 场上只剩未破盾的盾卫且无电磁炮 → 近战破盾战术
    const aliveList = G.enemies.filter(e => !e.dead && e.spawning <= 0);
    // 僵局看门狗（目标无关）：全场敌方血量总和 + 击杀数 4 秒零进展（被格挡/环绕失效/
    // 目标被地形卡死/顶墙走位带）→ 锁定最近敌人并升级贴身刃破盾战术
    const hpSumNow = G.enemies.reduce((a, e) => a + (e.dead ? 0 : Math.max(0, e.hp)), 0);
    if (stallHp != null && Math.abs(hpSumNow - stallHp) < 0.5 && G.kills === stallKills
      && G.enemies.some(e => !e.dead)) stallT += dt;
    else stallT = 0;
    stallHp = hpSumNow; stallKills = G.kills;
    const botStalled = stallT > 4;
    if (botStalled) {
      let nearest = null, nd = 1e9;
      for (const e of G.enemies) {
        if (e.dead || e.spawning > 0) continue;
        const d2 = dist(P.x, P.y, e.x, e.y);
        if (d2 < nd) { nd = d2; nearest = e; }
      }
      if (nearest) target = nearest;
    }
    const meleeBreaker = botStalled || (aliveList.length > 0 && aliveList.every(e => e.type === 'guard' && e.broken <= 0)
      && w.type !== 'rail');

    /* ---- 危险规避 ---- */
    const D = computeDanger(G, P, botStalled);
    let wx = D.dx * 2.1, wy = D.dy * 2.1;
    // 脱困脉冲生效中
    if (escapeT > 0) { escapeT -= dt; wx += Math.cos(escapeA) * 2.4; wy += Math.sin(escapeA) * 2.4; }

    /* ---- 索敌走位 ---- */
    let canSeeTarget = false;
    let navX = null, navY = null, navW = 0;
    if (target) {
      const d = dist(P.x, P.y, target.x, target.y);
      const aTo = Math.atan2(P.y - target.y, P.x - target.x); // 目标→玩家
      canSeeTarget = G.losClear(P.x, P.y, target.x, target.y);
      let lo = band[0], hi = band[1];
      if (meleeBreaker && target.type === 'guard') {
        // 贴脸相位刃：挥砍可直接击碎防暴盾
        lo = 12; hi = 19;
      } else if (botStalled) {
        // 僵局升级：一切目标都压近到刃击距离（含自爆蜂——冻结蜂只有贴近才能逼其起爆/击杀，代价 ≤1 血）
        lo = Math.min(lo, 20); hi = Math.min(hi, 34);
      }
      const guardFlank = target.type === 'guard' && target.broken <= 0
        && w.type !== 'rail' && w.id !== 'blade' && !meleeBreaker;
      if (guardFlank) {
        // 盾卫未破：侧翼包抄（选择离玩家近的一侧）
        const side = angDiff(Math.atan2(P.y - target.y, P.x - target.x), target.facing) > 0 ? 1 : -1;
        const fx = target.x + Math.cos(target.facing + Math.PI / 2) * 30 * side;
        const fy = target.y + Math.sin(target.facing + Math.PI / 2) * 30 * side;
        const dd = dist(P.x, P.y, fx, fy);
        if (dd > 14) { wx += (fx - P.x) / (dd || 1) * 1.15; wy += (fy - P.y) / (dd || 1) * 1.15; }
      } else if (!canSeeTarget) {
        // 无视线（隔墙/隔障碍）：交给 BFS 寻路绕行接敌，杜绝隔墙原地卡死
        navX = target.x; navY = target.y; navW = 1.5;
      } else if (d > hi) {
        wx += Math.cos(aTo + Math.PI) * 1.0; wy += Math.sin(aTo + Math.PI) * 1.0;
      } else if (d < lo) {
        wx += Math.cos(aTo) * 1.25; wy += Math.sin(aTo) * 1.25;
      } else {
        strafeT -= dt;
        if (strafeT <= 0) { strafeT = rng.range(1.0, 2.0); if (rng.chance(0.5)) strafeDir = -strafeDir; }
        wx += Math.cos(aTo + Math.PI / 2 * strafeDir) * 0.85;
        wy += Math.sin(aTo + Math.PI / 2 * strafeDir) * 0.85;
      }
      // 不要贴着敌人身体
      if (d < target.r + 14) {
        wx += (P.x - target.x) / (d || 1) * 1.6; wy += (P.y - target.y) / (d || 1) * 1.6;
      }
    } else if (G.portal) {
      // 传送门导航同样走寻路（避免被墙局部极小卡住）
      navX = G.portal.x; navY = G.portal.y; navW = 1.2;
    } else {
      // 无目标：回场地中心
      const cx = G.mw * TILE / 2, cy = G.mh * TILE / 2;
      const d = dist(P.x, P.y, cx, cy);
      if (d > 40) { wx += (cx - P.x) / d * 0.5; wy += (cy - P.y) / d * 0.5; }
    }

    /* ---- BFS 寻路跟随 ---- */
    if (navX != null) {
      pathT -= dt;
      const tkey = ((navX / 16) | 0) + ':' + ((navY / 16) | 0);
      // 路由粘滞：目标瓦片仅挪 1 格且旧路径终点仍邻接新目标时不重算——
      // 防止敌人贴墙小碎步使等长备选路线（上绕/下绕）反复翻转、bot 在原地振荡零进度
      const ttx = (navX / 16) | 0, tty = (navY / 16) | 0;
      const oldEnd = path.length ? path[path.length - 1] : null;
      const oldEndNear = oldEnd && Math.abs(((oldEnd.x / 16) | 0) - ttx) <= 1 && Math.abs(((oldEnd.y / 16) | 0) - tty) <= 1;
      if (pathT <= 0 || (tkey !== pathTargetKey && !oldEndNear)) {
        pathTargetKey = tkey; pathT = 0.3; pathI = 0;
        path = bfsPath(G, P, navX, navY) || [];
      }
      while (pathI < path.length && dist(P.x, P.y, path[pathI].x, path[pathI].y) < 9) pathI++;
      if (pathI < path.length) {
        const wp = path[pathI];
        const dd = dist(P.x, P.y, wp.x, wp.y) || 1;
        wx += (wp.x - P.x) / dd * navW; wy += (wp.y - P.y) / dd * navW;
      } else {
        const dd = dist(P.x, P.y, navX, navY) || 1;
        wx += (navX - P.x) / dd * navW; wy += (navY - P.y) / dd * navW;
      }
    }

    /* ---- 拾取需求（僵局升级期间全部压制：破僵局必须专注） ---- */
    const wantsWeapon = !botStalled && G.pickups.some(pk => pk.kind === 'crate' && (WEAPON_TIER[pk.weapon] || 0) > (WEAPON_TIER[G.weapons[0].id] || 0));
    if (!botStalled) for (const pk of G.pickups) {
      const d = dist(P.x, P.y, pk.x, pk.y);
      if (pk.kind === 'heart' && P.hp < P.maxHp && d < 110) { wx += (pk.x - P.x) / d * 0.8; wy += (pk.y - P.y) / d * 0.8; }
      else if (pk.kind === 'battery' && P.shield < P.maxShield && d < 90) { wx += (pk.x - P.x) / d * 0.6; wy += (pk.y - P.y) / d * 0.6; }
      else if (pk.kind === 'crate' && wantsWeapon && d < 130) { wx += (pk.x - P.x) / d * 0.7; wy += (pk.y - P.y) / d * 0.7; }
    }

    /* ---- 16 向评分移动（模拟真实箱体位移，墙敏感） ---- */
    let bestA = null, bestScore = -1e9;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU;
      const cx = Math.cos(a), cy = Math.sin(a);
      let sc = (cx * wx + cy * wy);
      // 短步进模拟真实碰撞：箱体被挡的方向重罚（避免"空转卡墙"）
      if (G.boxHitsWall(P.x + cx * 3, P.y + cy * 3, P.r)) sc -= 6.5;
      else {
        if (G.solidAtPx(P.x + cx * 10, P.y + cy * 10)) sc -= 1.2;
        else if (G.solidAtPx(P.x + cx * 22, P.y + cy * 22)) sc -= 0.6;
        if (G.solidAtPx(P.x + cx * 34, P.y + cy * 34)) sc -= 0.3;
      }
      if (sc > bestScore) { bestScore = sc; bestA = a; }
    }
    if (bestA != null && bestScore > -3.0) {
      input.moveX = Math.cos(bestA);
      input.moveY = Math.sin(bestA);
    }

    /* ---- 冲刺 ---- */
    if (D.danger > 6.0 && P.dashCd <= 0) {
      input.dash = true;
    }

    /* ---- 瞄准与开火 ---- */
    if (target) {
      const d = dist(P.x, P.y, target.x, target.y);
      let aimA = Math.atan2(target.y - P.y, target.x - P.x);
      // 预判提前量
      const bspd = w.type === 'rail' ? 0 : (w.speed || 350);
      if (bspd > 0) {
        const tt = Math.min(0.5, d / bspd);
        aimA = Math.atan2(target.y + (target.vy + target.ky) * tt * 0.55 - P.y,
          target.x + (target.vx + target.kx) * tt * 0.55 - P.x);
      }
      input.aimA = aimA;
      const actualA = Math.atan2(target.y - P.y, target.x - P.x);
      const err = Math.abs(angDiff(aimA, actualA));
      const canSee = G.losClear(P.x, P.y, target.x, target.y);
      const isGuardBlocked = target.type === 'guard' && target.broken <= 0 && w.type !== 'rail' && w.id !== 'blade'
        && Math.abs(angDiff(actualA, target.facing)) < 1.15;
      if (canSee && err < (CONE[w.id] || 0.12) && !isGuardBlocked) {
        input.fire = true;
      }
    } else {
      input.aimA = null;
    }

    /* ---- 相位刃：弹反 / 贴身反击 / 破盾 ---- */
    let needDeflect = false;
    for (const b of G.bullets) {
      if (b.friendly) continue;
      const d = dist(P.x, P.y, b.x, b.y);
      if (d < 26) {
        const aTo = Math.atan2(b.y - P.y, b.x - P.x);
        if (Math.abs(angDiff(P.aimA, aTo)) < 1.4) { needDeflect = true; break; }
      }
    }
    if (needDeflect && P.meleeCd <= 0) input.melee = true;
    else if (target && P.meleeCd <= 0 && target.type !== 'boss' && target.type !== 'boss2') {
      const d = dist(P.x, P.y, target.x, target.y);
      if ((meleeBreaker && d < 22) || (!meleeBreaker && d < 20)) {
        input.melee = true;
        input.aimA = Math.atan2(target.y - P.y, target.x - P.x);
      }
    }

    /* ---- 交互 ---- */
    if (G.portal && dist(P.x, P.y, G.portal.x, G.portal.y) < 15) input.interact = true;
    for (const pk of G.pickups) {
      if (pk.kind === 'crate' && (WEAPON_TIER[pk.weapon] || 0) > (WEAPON_TIER[G.weapons[0].id] || 0)
        && dist(P.x, P.y, pk.x, pk.y) < 14) {
        input.interact = true; swapT = 0.5;
      }
    }

    /* ---- 记录本帧输出，供下帧卡死检测 ---- */
    if (P.dashCd <= 0 && stuckT > 0.9 && (D.danger > 1.5 || !target || !canSeeTarget)) input.dash = true;
    if (G.__botdbg) G.__botdbg.push({ wx: +wx.toFixed(2), wy: +wy.toFixed(2), nav: navX != null, canSee: canSeeTarget, mb: meleeBreaker, bs: botStalled, stuckT: +stuckT.toFixed(2), danger: +D.danger.toFixed(1), d: +((target && dist(P.x, P.y, target.x, target.y)) || 0).toFixed(0), mx: +input.moveX.toFixed(2), my: +input.moveY.toFixed(2), wp: path[pathI] ? ((path[pathI].x / 16) | 0) + ',' + ((path[pathI].y / 16) | 0) : (navX != null ? '直行' : '-'), pi: pathI, pl: path.length });
    lmx = input.moveX; lmy = input.moveY;
  }

  return { update, pickChip };
}

root.ZERO_BOT = { createBot };
if (typeof module !== 'undefined' && module.exports) module.exports = root.ZERO_BOT;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
