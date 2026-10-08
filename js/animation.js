/* ImageGen character animation: 13 sheets, 7 actions x 6 drawn frames.
 * Presentation only: no RNG, collision, AI, damage or combat timers are changed. */
(function (root) {
'use strict';
const HERO_ACTIONS = ['idle', 'move', 'attack', 'melee', 'dash', 'hurt', 'death'];
const ENEMY_ACTIONS = ['idle', 'move', 'windup', 'attack', 'special', 'hurt', 'death'];
const SPECS = {};
for (const id of ['vanguard', 'bulwark', 'stalker', 'prototype', 'charger', 'gunner', 'guard',
  'sniper', 'bomber', 'wraith', 'echo', 'boss', 'boss2']) {
  const hero = ['vanguard', 'bulwark', 'stalker', 'prototype'].includes(id);
  const boss = id.startsWith('boss');
  SPECS[id] = { cols: 6, rows: 7, size: boss ? 50 : 30,
    actions: hero ? HERO_ACTIONS : boss ? ['idle', 'move', 'windup', 'attack', 'phase', 'hurt', 'death'] : ENEMY_ACTIONS };
}
const images = {}, frameCache = new Map();
const ready = typeof document === 'undefined' ? Promise.resolve([]) : Promise.all(
  Object.keys(SPECS).map(id => new Promise(resolve => {
    const image = new Image();
    image.onload = () => { images[id] = image; resolve(true); };
    image.onerror = () => resolve(false);
    image.src = new URL('../assets/art/animations/' + id + '.png', document.currentScript.src).href;
  })));
function frameIndex(elapsed, duration, loop) {
  const step = Math.floor(Math.max(0, elapsed) / Math.max(0.001, duration) * 6);
  return loop ? step % 6 : Math.min(5, step);
}
function sprite(id, action, frame) {
  const spec = SPECS[id], image = images[id];
  if (!spec || !image) return null;
  const row = spec.actions.indexOf(action);
  if (row < 0) return null;
  frame = Math.max(0, Math.min(5, Math.floor(frame)));
  const key = id + ':' + action + ':' + frame;
  if (frameCache.has(key)) return frameCache.get(key);
  // Keep the entire registered cell, including its transparent margin. Never
  // normalize individual frame bounds: that causes walking and falling to jitter.
  const cv = document.createElement('canvas'); cv.width = cv.height = spec.size;
  const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const cw = image.width / 6, ch = image.height / 7;
  ctx.drawImage(image, frame * cw, row * ch, cw, ch, 1, 1, spec.size - 2, spec.size - 2);
  const flash = document.createElement('canvas'); flash.width = flash.height = spec.size;
  const fc = flash.getContext('2d'); fc.drawImage(cv, 0, 0); fc.globalCompositeOperation = 'source-in';
  fc.fillStyle = '#fff'; fc.fillRect(0, 0, spec.size, spec.size);
  const out = { cv, flash, w: spec.size, h: spec.size, id, action, frame };
  frameCache.set(key, out); return out;
}
function pose(G, e) {
  const player = e === G.player;
  if (player) {
    if (G.state === 'defeat' || e.hp <= 0) return { action: 'death' };
    if (e.dashT > 0) return { action: 'dash', progress: 1 - e.dashT / 0.16 };
    if (e.slashT > 0) return { action: 'melee', progress: 1 - e.slashT / 0.16 };
    if (e.chargeT > 0) return { action: 'attack', progress: Math.min(0.49, e.chargeT / 0.3 * 0.49) };
  } else {
    if (e.st === 'dying') return { action: 'death', progress: 1 - e.t / 1.3 };
    if (e.st === 'transition') return { action: 'phase', progress: 1 - e.t / 1.5 };
    if (e.spawning > 0) return { action: 'windup', progress: 1 - e.spawning / 0.7 };
    if (e.st === 'intro') return { action: 'windup' };
    if (e.st === 'attack') return { action: e.atk && e.atk.t < 0.35 ? 'windup' : 'attack',
      progress: e.atk && e.atk.t < 0.35 ? e.atk.t / 0.35 : undefined };
    if (e.type === 'charger' && e.state === 'dash') return { action: 'attack', progress: e.t / 0.42 };
    if (e.state === 'aim') return { action: 'windup', progress: e.type === 'sniper' ? 1 - e.aimT / 1.05 : e.t / 0.55 };
    if (e.state === 'charge') return { action: 'windup', progress: e.t / 0.55 };
    if (e.state === 'arm') return { action: 'special', progress: e.t / 0.5 };
    if (e.type === 'guard' && e.broken > 0) return { action: 'special', progress: Math.min(1, (6 - e.broken) / 0.5) };
    if (e.type === 'guard' && Math.hypot(e.x - G.player.x, e.y - G.player.y) < 28) return { action: 'attack' };
    if (e.burst > 0) return { action: 'attack' };
  }
  return { action: Math.hypot(e.vx || 0, e.vy || 0) > 5 ? 'move' : 'idle' };
}
function createPlayback(G, now = () => performance.now() / 1000) {
  let pending = new WeakMap(), corpses = [], run = null, room = '', endAnchor = null;
  const durations = { attack: 0.36, melee: 0.16, dash: 0.16, hurt: 0.3, special: 0.48, phase: 1.5, death: 0.8 };
  const priority = { attack: 1, special: 2, melee: 3, dash: 4, hurt: 5, phase: 6, death: 7 };
  function resetContext() {
    const key = [G.zoneIdx, G.mapId, G.roomIdx, G.isBossRoom].join(':');
    if (run !== G.player || room !== key) {
      run = G.player; room = key; pending = new WeakMap(); corpses = []; endAnchor = null;
    }
  }
  function time() {
    resetContext();
    if (G.state === 'defeat') {
      if (endAnchor === null) endAnchor = now();
      return G.time + Math.max(0, now() - endAnchor);
    }
    endAnchor = null; return G.time;
  }
  function event(action, entity) {
    resetContext(); const t = time(), old = pending.get(entity);
    if (action === 'death' && entity !== G.player && !entity.isBoss) {
      // Snapshot before the gameplay removes the entity, without retaining a
      // collidable corpse or changing kills, loot, wave completion or RNG.
      if (old && old.action === 'death') return;
      corpses.push({ id: entity.type, x: entity.x, y: entity.y,
        facing: entity.facing || 0, start: t, end: t + 0.8 });
      if (corpses.length > 64) corpses.shift();
    }
    if (old && t < old.end && priority[old.action] > priority[action]) return;
    const duration = durations[action] || 0.4;
    pending.set(entity, { action, start: old && old.action === action && t < old.end ? old.start : t,
      end: t + duration, duration });
  }
  function sample(entity) {
    const t = time(), id = entity === G.player ? G.heroId : entity.type;
    const state = pose(G, entity), active = pending.get(entity);
    // State-owned windows use combat progress; presentation events fill gaps
    // such as sniper recoil and hit/death events between two render frames.
    let action = state.action, frame;
    const statePriority = priority[action] || 0;
    if (active && (t < active.end || active.action === 'death') && priority[active.action] > statePriority) {
      action = active.action; frame = frameIndex(t - active.start, active.duration, action === 'attack');
    } else if (state.progress !== undefined) frame = Math.min(5, Math.floor(Math.max(0, state.progress) * 6));
    else if (active && active.action === action) frame = frameIndex(t - active.start, active.duration, action === 'attack');
    else frame = frameIndex(t + (entity.id || 0) * 0.07, action === 'move' ? 0.5 : 0.75, true);
    if (action === 'death' && entity === G.player && !active) {
      event('death', entity); return sample(entity);
    }
    return { id, action, frame, sprite: sprite(id, action, frame) };
  }
  function drawCorpses(ctx) {
    const t = time(); corpses = corpses.filter(c => t < c.end);
    for (const c of corpses) {
      const sp = sprite(c.id, 'death', frameIndex(t - c.start, 0.6, false)); if (!sp) continue;
      ctx.save(); ctx.translate(c.x, c.y); if (Math.cos(c.facing) < 0) ctx.scale(-1, 1);
      ctx.globalAlpha = Math.min(1, Math.max(0, (c.end - t) / 0.2));
      ctx.drawImage(sp.cv, -sp.w / 2, -sp.h / 2); ctx.restore();
    }
  }
  function deathDone() {
    if (!images[G.heroId]) return true; // Missing assets preserve original end-screen timing.
    const t = time(); const active = pending.get(G.player);
    return !!active && active.action === 'death' && t >= active.end;
  }
  G.visualEvent = event;
  return { sample, event, drawCorpses, deathDone, time, get corpseCount() { time(); return corpses.length; } };
}
root.ZERO_ANIMATION = { SPECS, ready, sprite, pose, frameIndex, createPlayback };
if (typeof module !== 'undefined' && module.exports) module.exports = root.ZERO_ANIMATION;
})(typeof globalThis !== 'undefined' ? globalThis : window);
