/* ============================================================
 * 零号协议 ZERO PROTOCOL —— game/rooms.js
 * 部件：房间流程（loadRoom / 波次 updateWaves / 刷怪点 farSpot / pickType）/
 *       结算 endStats / 晶片三选一 offerChips·chooseChip·acquireChip /
 *       补给站 openShop·shopBuy·shopLeave / 传送门 openPortal / 推进 nextLevel /
 *       开局 startRun / 调试系列 debugStress·debugClear·debugSpawn·debugJump
 * 只定义部件工厂（createGame 时由 facade 按固定顺序调用），无顶层即时逻辑。
 * ============================================================ */
(function (root) {
'use strict';
const PARTS = root.ZERO_GAME_PARTS = root.ZERO_GAME_PARTS || {};

PARTS.rooms = function (ctx) {
  const C = ctx.C;
  const { TAU, clamp, dist, TILE, CHIPS, SYNERGIES, WEAPONS, HEROES, ZONES } = C;
  const G = ctx.G;
  const rng = ctx.rng;

  /* ---------------- 结算 ---------------- */
  function endStats() {
    const t = G.runTime;
    const rating = (t < 300 && G.damageTaken <= 6) ? 'S' : (t < 420 && G.damageTaken <= 12) ? 'A' : 'B';
    return {
      time: t, kills: G.kills, maxCombo: G.maxCombo, damageTaken: G.damageTaken,
      score: G.score, rating, difficulty: G.difficultyId,
      chips: G.chips.map(id => {
        const c = CHIPS.find(c => c.id === id);
        const lv = (G.chipLv && G.chipLv[id]) || 0;
        return c.name + (lv > 0 ? '·Lv' + (lv + 1) : '');
      }),
      syn: G.synActive.map(s => s.name),
    };
  }
  G.endStats = endStats;

  /* ---------------- 波次 / 房间 / 区域 ---------------- */
  function pickType(weights) {
    let total = 0;
    for (const k in weights) total += weights[k];
    let r = rng() * total;
    for (const k in weights) { r -= weights[k]; if (r <= 0) return k; }
    return 'charger';
  }

  // roomIdx 表示楼层，floor.current 表示该层当前房间。房间图含环路与可选支路。
  G.loadRoom = function () {
    const zone = ZONES[G.zoneIdx];
    const flip = rng.chance(0.5) ? 1 : -1;
    const defs = [
      ['入口', 'entry', 0, 0], ['战斗 1', 'combat', 1, 0],
      ['战斗 2', 'combat', 2, 0], ['战斗 3', 'combat', 2, flip],
      ['宝箱', 'treasure', 1, flip], ['出口', 'exit', 3, 0],
    ];
    G.floor = {
      current: 0, rewarded: false, zone: G.zoneIdx, level: G.roomIdx,
      rooms: defs.map(([name, kind, x, y], id) => ({
        id, name, kind, x, y, links: [], visited: false, cleared: kind !== 'combat',
        mapId: kind === 'combat' ? zone.maps[(G.roomIdx + id - 1) % zone.maps.length] : zone.maps[G.roomIdx],
        pickups: [], solid: null,
      })),
    };
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1], [2, 5]]) {
      G.floor.rooms[a].links.push(b); G.floor.rooms[b].links.push(a);
    }
    G.enterRoom(0);
  };

  G.floorCleared = function () {
    return G.floor && G.floor.rooms.every(r => r.cleared);
  };

  G.enterRoom = function (id, from) {
    const floor = G.floor;
    const room = floor && floor.rooms[id];
    if (!room) return;
    if (from != null && (!floor.rooms[from].links.includes(id) || G.doorsLocked)) return;
    if (from != null) {
      const previous = floor.rooms[from];
      previous.pickups = G.pickups.slice(); previous.solid = G.solid.slice();
    }
    floor.current = id;
    const zone = ZONES[G.zoneIdx];
    ctx.loadMap(room.mapId);
    if (room.solid) G.solid.set(room.solid);
    G.enemies.length = 0; ctx.pooledClear(G.bullets, ctx.poolBullets); G.pickups.length = 0;
    G.mines.length = 0; G.lasers.length = 0; G.beams.length = 0;
    G.bossLaser = null; G.wells.length = 0;
    ctx.pooledClear(G.particles, ctx.poolParticles); ctx.pooledClear(G.rings, ctx.poolRings); G.ghosts.length = 0;
    ctx.pooledClear(G.floaters, ctx.poolFloaters); ctx.timers.length = 0;
    G.isBossRoom = false; G.portal = null; G.roomClearT = 0;
    G.prompt = null;
    G.chipOffered = false;
    G.fade = 1;
    // 玩家出生点：底部中央附近的空地
    const P = G.player;
    P.x = (G.mw * TILE) / 2; P.y = (G.mh - 2.5) * TILE;
    while (ctx.boxHitsWall(P.x, P.y, P.r) && P.y > TILE * 3) P.y -= TILE;
    P.vx = 0; P.vy = 0; P.kx = 0; P.ky = 0; P.iframes = 1.0;
    P.dashT = 0; P.chargeT = 0;
    if (from == null) P.undyingUsed = false;
    ctx.computeReachable(P.x, P.y);
    // 门位选在可达的边缘地面，沿用原地图障碍，保证玩家与敌人碰撞一致。
    G.doors = room.links.map(to => {
      const other = floor.rooms[to];
      const dx = other.x - room.x, dy = other.y - room.y;
      const ax = dx ? (dx > 0 ? (G.mw - 2.5) * TILE : 2.5 * TILE) : G.mw * TILE / 2;
      const ay = dy ? (dy > 0 ? (G.mh - 2.5) * TILE : 2.5 * TILE) : G.mh * TILE / 2;
      const spots = G.spawnSpots.filter(s => !ctx.boxHitsWall(s.x, s.y, P.r + 2));
      spots.sort((a, b) => dist(a.x, a.y, ax, ay) - dist(b.x, b.y, ax, ay));
      const spot = spots[0] || { x: P.x, y: P.y };
      return { to, x: spot.x, y: spot.y, name: other.name, dx, dy };
    });
    if (from != null) {
      const door = G.doors.find(d => d.to === from);
      const spots = G.spawnSpots.filter(s => dist(s.x, s.y, door.x, door.y) >= 32 && !ctx.boxHitsWall(s.x, s.y, P.r));
      spots.sort((a, b) => dist(a.x, a.y, door.x, door.y) - dist(b.x, b.y, door.x, door.y));
      if (spots[0]) { P.x = spots[0].x; P.y = spots[0].y; }
    }
    G.doorsLocked = !room.cleared;
    G.roomVisit = (G.roomVisit || 0) + 1;
    // 波次
    const total = 3 + (G.zoneIdx + 1) * 2 + G.roomIdx * 2;
    const budget = Math.floor(total / 3) + (id <= total % 3 ? 1 : 0);
    const w1 = Math.ceil(budget / 2);
    G.waves = [
      Array.from({ length: w1 }, () => pickType(zone.weights)),
      Array.from({ length: budget - w1 }, () => pickType(zone.weights)),
    ];
    G.wavIdx = -1; G.pendSpawns = []; G.waveDelay = 1.0;
    G.spawnT = 0;
    if (room.cleared) { G.waves = []; G.chipOffered = true; }
    ctx.banner(zone.name, '第 ' + (G.roomIdx + 1) + ' 层 · ' + room.name, zone.accent, 1.3);
    G.roomLabel = '第 ' + (G.zoneIdx + 1) + ' 区 · ' + (G.roomIdx + 1) + ' 层 · ' + room.name;
    G.pickups = room.pickups.slice();
    // 宝箱房必出武器箱；后续楼层每个战斗房首次进入时有 20% 概率。
    if (!room.visited && (room.kind === 'treasure' || (room.kind === 'combat' && (G.zoneIdx >= 1 || G.roomIdx >= 1) && rng.chance(0.2)))) {
      const spot = farSpot(140);
      if (spot) {
        const pool = ['smg', 'shotgun', 'railgun'].filter(w => w !== G.weapons[0].id);
        G.pickups.push({ x: spot.x, y: spot.y, kind: 'crate', weapon: rng.pick(pool), t: 0 });
      }
    }
    room.visited = true;
    if (room.kind === 'exit' && G.floorCleared()) {
      if (!floor.rewarded) { floor.rewarded = true; offerChips(); }
      else openPortal();
    }
  };

  G.useDoor = function (to) {
    if (G.state !== 'playing' || G.isBossRoom || G.doorsLocked) return;
    const door = (G.doors || []).find(d => d.to === to);
    if (!door || dist(G.player.x, G.player.y, door.x, door.y) >= 18) return;
    G.sfx('ui'); G.enterRoom(to, G.floor.current);
  };

  // AI 与玩家共用门交互；BFS 优先探索未清战斗房，最后前往出口。
  G.navigationDoor = function () {
    if (!G.floor || G.isBossRoom || G.doorsLocked || G.portal) return null;
    const rooms = G.floor.rooms, start = G.floor.current;
    const queue = [[start, null]], seen = new Set([start]);
    while (queue.length) {
      const [id, first] = queue.shift(), r = rooms[id];
      if (id !== start && ((!r.cleared && r.kind === 'combat') || (G.floorCleared() && r.kind === 'exit'))) {
        return G.doors.find(d => d.to === first);
      }
      for (const to of r.links) if (!seen.has(to)) { seen.add(to); queue.push([to, first == null ? to : first]); }
    }
    return null;
  };

  function farSpot(minD) {
    const P = G.player;
    const src = (G.spawnSpots && G.spawnSpots.length) ? G.spawnSpots : G.floorSpots;
    const cands = src.filter(s =>
      dist(s.x, s.y, P.x, P.y) > minD && !ctx.boxHitsWall(s.x, s.y, 6));
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
    const room = G.floor && G.floor.rooms[G.floor.current];
    if (room && room.cleared) return;
    // 场上存活 < 7 时，从待生成队列落人
    const alive = G.enemies.filter(e => !e.dead).length;
    if (G.pendSpawns.length && alive < 7) {
      G.spawnT = (G.spawnT || 0) - dt;
      if (G.spawnT <= 0) {
        G.spawnT = 0.35;
        const type = G.pendSpawns.shift();
        const spot = farSpot(110);
        if (spot) ctx.spawnEnemy(type, spot.x, spot.y);
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
        const co = G.daily && G.daily.flag.coinOnly;
        if (rng.chance(0.4)) G.pickups.push({ x: spot.x, y: spot.y, kind: co ? 'coin' : 'heart', t: 0 });
        else if (rng.chance(0.5)) G.pickups.push({ x: spot.x, y: spot.y, kind: co ? 'coin' : 'battery', t: 0 });
        if (room) {
          room.cleared = true; G.doorsLocked = false;
          ctx.toast('房间已肃清 · 房门开启' + (G.floorCleared() ? ' · 前往出口领取晶片' : ''), '#45f0e2');
        } else offerChips();
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
      owned: G.chips.includes(c.id), lv: (G.chipLv && G.chipLv[c.id]) || 0,
      syn: SYNERGIES.filter(s => s.need.includes(c.id) && s.need.every(n2 => n2 === c.id || G.chips.includes(n2))),
    }));
    G.state = 'chip';
    G.sfx('chipOffer');
  }

  // 获取晶片：已持有 → 升级一级（效果 ×1.5），否则新装备。返回 'new' | 'up'
  G.acquireChip = function (id) {
    if (G.chips.includes(id)) {
      G.chipLv[id] = (G.chipLv[id] || 0) + 1;
      G.computeStats();
      return 'up';
    }
    G.chips.push(id);
    G.computeStats();
    return 'new';
  };

  G.chooseChip = function (i) {
    if (G.state !== 'chip' || !G.chipOffer || !G.chipOffer[i]) return;
    const c = G.chipOffer[i];
    const before = G.synActive.map(s => s.id);
    const res = G.acquireChip(c.id);
    const newly = G.synActive.filter(s => !before.includes(s.id));
    for (const syn of newly) {
      ctx.banner('羁绊激活 · ' + syn.name, syn.desc, '#ffb84d', 2.4);
      G.sfx('syn');
    }
    if (!newly.length) {
      if (res === 'up') ctx.toast('晶片升级：' + c.name + ' → Lv.' + ((G.chipLv[c.id] || 0) + 1) + '（效果 ×1.5）', '#ffb84d');
      else ctx.toast('已装备晶片：' + c.name, '#45f0e2');
    }
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
      return d > 60 && d < 170 && !ctx.boxHitsWall(s.x, s.y, 8);
    });
    if (!cands.length) {
      cands = src.filter(s => dist(s.x, s.y, P.x, P.y) > 40 && !ctx.boxHitsWall(s.x, s.y, 8));
      cands.sort((a, b) => dist(a.x, a.y, P.x, P.y) - dist(b.x, b.y, P.x, P.y));
      cands = cands.slice(0, 3);
    }
    const spot = cands.length ? rng.pick(cands) : { x: P.x, y: P.y };
    G.portal = { x: spot.x, y: spot.y, open: true, t: 0 };
    G.sfx('portalOpen');
    ctx.toast('传送门已开启', '#45f0e2');
  };

  function openShop() {
    let disc = G.stats.lucky ? 1 - Math.min(0.5, 0.15 * (G.stats.luckyK || 1)) : 1;
    if (G.daily && G.daily.flag.shopSale) disc *= 0.7;
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
    ctx.toast('补给站已接入 · 使用金币采购', '#ffb84d');
  }

  G.shopBuy = function (i) {
    if (G.state !== 'shop' || !G.shopItems || !G.shopItems[i] || G.shopItems[i].sold) return;
    const it = G.shopItems[i];
    if (G.coins < it.price) { ctx.toast('金币不足', '#ff4757'); G.sfx('clink'); return; }
    G.coins -= it.price;
    it.sold = true;
    if (it.kind === 'heal') {
      G.player.hp = Math.min(G.player.maxHp, G.player.hp + 2);
      ctx.addFloater(G.player.x, G.player.y - 12, '+2', '#ff4757');
    } else if (it.kind === 'chip') {
      const before = G.synActive.map(s2 => s2.id);
      const res = G.acquireChip(it.chipId);
      const newly = G.synActive.filter(s2 => !before.includes(s2.id));
      for (const syn of newly) { ctx.banner('羁绊激活 · ' + syn.name, syn.desc, '#ffb84d', 2.4); G.sfx('syn'); }
      if (!newly.length && res === 'up') ctx.toast('晶片升级：' + it.name + ' → Lv.' + ((G.chipLv[it.chipId] || 0) + 1) + '（效果 ×1.5）', '#ffb84d');
    } else if (it.kind === 'battery') {
      G.bonusShield = (G.bonusShield || 0) + 1;
      G.computeStats();
      G.player.shield = G.player.maxShield;
    } else if (it.kind === 'weapon') {
      G.weapons[0] = WEAPONS[it.weapon]; G.weaponSlot = 0;
      G.computeStats();
      ctx.toast('已换装：' + WEAPONS[it.weapon].name, '#ffb84d');
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
    if (!G.portal || (!G.isBossRoom && !G.floorCleared())) return;
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

  /* ---------------- 开始 / 调试 ---------------- */
  G.startRun = function (heroId, daily, difficulty) {
    if (difficulty != null) G.difficultyId = Object.hasOwn(C.DIFFICULTIES, difficulty) ? difficulty : 'standard';
    G.heroId = heroId || 'vanguard';
    G.chips = []; G.chipLv = {}; G.synActive = []; G.weaponSlot = 0;
    // 每日挑战：按当日修改器设置 G.daily.flag（非每日路径逐位不变，矩阵基线不受影响）
    G.daily = null;
    if (daily && daily.mods && daily.mods.length) {
      G.daily = { date: daily.date, name: daily.mods.map(m => m.name).join('+'), flag: {} };
      for (const m of daily.mods) for (const k in m.flag) G.daily.flag[k] = m.flag[k];
      if (G.daily.flag.glassStart) G.chips.push('glass');
    }
    G.weapons = [WEAPONS[(HEROES[G.heroId] || HEROES.vanguard).weapon], WEAPONS.blade];
    G.coins = 0; G.coinsCollected = 0; G.shopVisits = 0;
    G.bonusShield = 0; G.powerBonus = 0; G.dashEchoT = 0; G.shopItems = null;
    const P = G.player;
    P.hp = 6; P.maxHp = 6; P.shield = 3; P.maxShield = 3; P.shieldT = 0;
    P.iframes = 0; P.dashCd = 0; P.dashT = 0; P.undyingUsed = false;
    P.vx = 0; P.vy = 0; P.kx = 0; P.ky = 0; P.dashA = 0; P.aimA = 0;
    P.fireT = 0; P.chargeT = 0; P.meleeCd = 0; P.slashT = 0; P.slashA = 0;
    P.bob = 0; P.recoil = 0; P.muzzleT = 0;
    Object.assign(G.input, { aimA: null, moveX: 0, moveY: 0, fire: false, dash: false, melee: false, interact: false, slot: -1 });
    G.zoneIdx = 0; G.roomIdx = 0; G.isBossRoom = false; G.bossDown = {};
    G.score = 0; G.kills = 0; G.damageTaken = 0; G.combo = 0; G.maxCombo = 0;
    G.runTime = 0; G.timeScale = 1; G.hitstop = 0;
    G.vengeanceT = 0; G.killSpeedT = 0; G.bossRef = null;
    G.endScreen = null; G.chipOffer = null; G.toasts = []; G.banner = null;
    G.deathLog = ''; G.prompt = null;
    G.computeStats();
    P.hp = P.maxHp; P.shield = P.maxShield;
    G.loadRoom();
    G.state = 'playing';
  };

  G.debugStress = function () {
    for (let i = 0; i < 30; i++) {
      const spot = farSpot(60) || { x: 100, y: 100 };
      const e = ctx.spawnEnemy(rng.pick(['charger', 'gunner', 'guard', 'sniper']), spot.x, spot.y);
      e.spawning = 0;
    }
    for (let i = 0; i < 260; i++) {
      const a = rng.range(0, TAU);
      ctx.spawnBullet(rng.range(60, 420), rng.range(60, 220), a, rng.range(80, 200), 1, false, { life: 8 });
    }
  };
  G.debugClear = function () {
    G.enemies.length = 0; ctx.pooledClear(G.bullets, ctx.poolBullets); G.mines.length = 0;
    G.lasers.length = 0; G.bossLaser = null; G.wells.length = 0; ctx.pooledClear(G.particles, ctx.poolParticles);
  };
  G.debugSpawn = function (type, x, y) {
    const e = ctx.spawnEnemy(type, x, y);
    e.spawning = 0;
    return e;
  };
  G.debugJump = function (zone, room) {
    G.zoneIdx = clamp(zone - 1, 0, ZONES.length - 1);
    G.roomIdx = clamp(room - 1, 0, ZONES[G.zoneIdx].maps.length - 1);
    G.loadRoom(); G.enterRoom(1); G.state = 'playing';
  };

  /* ---- 跨部件挂载：谁定义谁挂 ctx ---- */
  ctx.updateWaves = updateWaves;
  ctx.endStats = endStats;
  ctx.openPortal = openPortal;
};

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
