/* ============================================================
 * 零号协议 ZERO PROTOCOL —— game/state.js
 * 部件：G 状态工厂 / 对象池 / RNG / 延时队列 / 地图与刷怪点 / 基础生成与特效助手
 * 只定义部件工厂（createGame 时由 facade 按固定顺序调用），无顶层即时逻辑。
 * 跨部件助手一律挂 ctx；G 上的公开面保持与原 game.js 完全一致。
 * ============================================================ */
(function (root) {
'use strict';
const PARTS = root.ZERO_GAME_PARTS = root.ZERO_GAME_PARTS || {};

PARTS.state = function (ctx) {
  const C = ctx.C;
  const { TAU, dist, lerp, RNG, VIEW_W, VIEW_H, TILE, MAPS } = C;
  const headless = ctx.headless;
  const seed = ctx.seed;
  const rng = ctx.rng = RNG(seed);

  const G = ctx.G = {
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
    chips: [], chipLv: {}, synActive: [],
    stats: null,
    combo: 0, comboT: 0, maxCombo: 0,
    coins: 0, coinsCollected: 0, shopVisits: 0, shopItems: null,
    heroId: 'vanguard', daily: null, bonusShield: 0, powerBonus: 0, dashEchoT: 0,
    difficultyId: Object.hasOwn(C.DIFFICULTIES, ctx.difficulty) ? ctx.difficulty : 'standard',
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
  G.solidAtPx = function (x, y) { return G.solidAt(Math.floor(x / TILE), Math.floor(y / TILE)); };
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

  /* ---------------- 对象池（freelist 复用，仅消除对象分配；行为逐位不变） ----------------
   * 铁律：push/splice/shift 的调用位置与顺序、数组遍历顺序、RNG 消费顺序一律不动。
   * acquire 从空闲链取对象并逐一重新初始化全部字段（字段集合与赋值顺序同原字面量
   * 完全一致，杜绝上一任对象的字段/嵌套引用泄漏），release 仅在对象出数组时归还。
   * 计数统计（整数自增）常开；peakLive 追踪经 G.__poolStats() 首次调用后开启。 */
  let poolStatsOn = false;
  function makePool(name) {
    const free = [];
    const st = { created: 0, reused: 0, released: 0, liveNow: 0, peakLive: 0 };
    return {
      name, free, st,
      acquire() {
        let o;
        if (free.length) { o = free.pop(); st.reused++; }
        else { o = {}; st.created++; }
        if (poolStatsOn) { st.liveNow++; if (st.liveNow > st.peakLive) st.peakLive = st.liveNow; }
        return o;
      },
      release(o) {
        st.released++;
        if (poolStatsOn) st.liveNow--;
        free.push(o);
      },
    };
  }
  const poolBullets = makePool('bullets');
  const poolParticles = makePool('particles');
  const poolFloaters = makePool('floaters');
  const poolRings = makePool('rings');
  /* 整表清空（原「length = 0」语义）：逐个归还回池后清零，数组对象与外部可见行为不变 */
  function pooledClear(arr, pool) {
    for (let i = 0; i < arr.length; i++) pool.release(arr[i]);
    arr.length = 0;
  }
  /* 各池 init：逐一重初始化全部字段（与原对象字面量逐字段等价） */
  function initBullet(b, x, y, ang, speed, dmg, friendly, o) {
    b.x = x; b.y = y;
    b.vx = Math.cos(ang) * speed; b.vy = Math.sin(ang) * speed;
    b.r = o.r || 2.5; b.dmg = dmg; b.friendly = friendly; b.color = o.color || '#ffffff';
    b.knock = o.knock || 0; b.pierce = o.pierce || 0; b.bounces = o.bounces || 0;
    b.life = o.life || 3; b.t = 0; b.hitIds = o.hitIds || null; b.bounced = false;
    b.kind = o.kind || null;
    b.core = o.core || '#ffffff'; b.glow = o.glow !== false;
  }
  function initParticle(p, x, y, vx, vy, life, color, size, drag, grav) {
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.max = 1; p.color = color; p.size = size;
    p.drag = drag; p.grav = grav;
  }
  function initFloater(f, x, y, txt, color, big) {
    f.x = x + rng.range(-4, 4); f.y = y - 6; f.vy = -34;
    f.life = 0.75; f.max = 0.75; f.txt = '' + txt;
    f.color = color || '#ffffff'; f.big = !!big;
  }
  function initRing(r, x, y, color, o) {
    r.x = x; r.y = y; r.r = o.r0 || 2; r.vr = o.vr || 160;
    r.life = o.life || 0.35; r.max = o.life || 0.35;
    r.color = color; r.width = o.width || 2;
  }
  G.__poolStats = function () {
    poolStatsOn = true;   // 首次调用后额外开启 peakLive 追踪（计数始终可用，此处之外零开销）
    const out = {};
    for (const pool of [poolBullets, poolParticles, poolFloaters, poolRings]) {
      const s = pool.st;
      const live = s.created - s.released + s.reused;   // 派生：在场对象数
      out[pool.name] = {
        created: s.created,           // 累计新建对象数
        reused: s.reused,             // 累计 freelist 复用次数
        released: s.released,         // 累计归还次数
        free: pool.free.length,       // 当前空闲链长度
        live,                         // 当前在场对象数（created - released + reused）
        peakLive: Math.max(s.peakLive, live),  // 在场峰值（池自然上界 = 历史峰值，无新增语义）
      };
    }
    return out;
  };

  /* ---------------- 特效数据 ---------------- */
  function addFloater(x, y, txt, color, big) {
    if (G.floaters.length > 90) poolFloaters.release(G.floaters.shift());
    const f = poolFloaters.acquire();
    initFloater(f, x, y, txt, color, big);
    G.floaters.push(f);
  }
  function addParts(x, y, n, color, o) {
    o = o || {};
    for (let i = 0; i < n; i++) {
      if (G.particles.length > 420) break;
      const a = rng.range(0, TAU), sp = rng.range(0.3, 1) * (o.spd || 90);
      const p = poolParticles.acquire();
      initParticle(p, x, y,
        Math.cos(a) * sp + (o.vx || 0), Math.sin(a) * sp + (o.vy || 0),
        rng.range(0.6, 1) * (o.life || 0.5),
        Array.isArray(color) ? rng.pick(color) : color,
        o.size || rng.range(1, 2.4), o.drag || 4, o.grav || 0);
      G.particles.push(p);
    }
  }
  function addRing(x, y, color, o) {
    o = o || {};
    const r = poolRings.acquire();
    initRing(r, x, y, color, o);
    G.rings.push(r);
  }
  function shake(a) { G.shake = Math.min(9, G.shake + a); }
  function flash(color, a) { G.flashFx = Math.max(G.flashFx, a); G.flashColor = color; }

  /* ---------------- 基础弹幕生成 ---------------- */
  function spawnBullet(x, y, ang, speed, dmg, friendly, o) {
    o = o || {};
    if (G.bullets.length > 420) poolBullets.release(G.bullets.shift());
    const b = poolBullets.acquire();
    initBullet(b, x, y, ang, speed, dmg, friendly, o);
    G.bullets.push(b);
  }

  /* ---------------- 提示 / 横幅 ---------------- */
  function toast(text, color) {
    G.toasts.push({ text, color: color || '#e8e8ee', life: 2.2 });
    if (G.toasts.length > 4) G.toasts.shift();
  }
  function banner(text, sub, color, dur) {
    G.banner = { text, sub: sub || '', color: color || '#ffffff', life: dur || 2.2, max: dur || 2.2 };
  }
  G.toast = toast; G.banner = banner;

  /* ---------------- 简易延迟队列（headless 也可用，不依赖 setTimeout） ---------------- */
  const timers = [];
  function setTimeoutLike(t, fn) { timers.push({ t, fn }); }
  function updateTimers(dt) {
    for (let i = timers.length - 1; i >= 0; i--) {
      timers[i].t -= dt;
      if (timers[i].t <= 0) { const fn = timers[i].fn; timers.splice(i, 1); fn(); }
    }
  }

  /* ---- 跨部件挂载：谁定义谁挂 ctx（不做任何额外即时逻辑） ---- */
  ctx.loadMap = loadMap;
  ctx.computeReachable = computeReachable;
  ctx.makePool = makePool;
  ctx.pooledClear = pooledClear;
  ctx.poolBullets = poolBullets;
  ctx.poolParticles = poolParticles;
  ctx.poolFloaters = poolFloaters;
  ctx.poolRings = poolRings;
  ctx.initBullet = initBullet;
  ctx.initParticle = initParticle;
  ctx.initFloater = initFloater;
  ctx.initRing = initRing;
  ctx.addFloater = addFloater;
  ctx.addParts = addParts;
  ctx.addRing = addRing;
  ctx.shake = shake;
  ctx.flash = flash;
  ctx.spawnBullet = spawnBullet;
  ctx.toast = toast;
  ctx.banner = banner;
  ctx.timers = timers;
  ctx.setTimeoutLike = setTimeoutLike;
  ctx.updateTimers = updateTimers;
  ctx.losClear = G.losClear;
  ctx.raycastWall = G.raycastWall;
};

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
