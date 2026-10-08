'use strict';
const assert = require('node:assert/strict');
const CORE = require('../js/core.js');
const { createGame } = require('../js/game.js');
const { spatialViolations } = require('./invariants.js');
const DT = 1 / 60;

function useDoor(G, to) {
  const door = G.doors.find(d => d.to === to);
  assert(door, '相邻房间必须有门');
  Object.assign(G.player, { x: door.x, y: door.y });
  G.input.interact = true;
  G.update(DT);
}
function clearCombat(G) {
  // 跳过战斗数值，仅推进真实肃清与奖励逻辑。
  G.debugClear(); G.pendSpawns = []; G.wavIdx = G.waves.length - 1;
  for (let i = 0; i < 65; i++) G.update(DT);
  assert.equal(G.doorsLocked, false);
  assert.equal(G.floor.rooms[G.floor.current].cleared, true);
}

// 所有区域/层/镜像布局：连通、环路、入口安全、战斗预算与门位可达。
for (let seed = 1; seed <= 20; seed++) {
  const G = createGame({ seed, headless: true }); G.startRun();
  for (let z = 0; z < CORE.ZONES.length; z++) for (let level = 0; level < CORE.ZONES[z].maps.length; level++) {
    G.zoneIdx = z; G.roomIdx = level; G.loadRoom();
    assert.equal(G.floor.current, 0); assert.equal(G.doorsLocked, false);
    assert.equal(G.waves.length, 0); assert.equal(G.portal, null);
    const seen = new Set(), visit = id => {
      if (seen.has(id)) return; seen.add(id); G.floor.rooms[id].links.forEach(visit);
    };
    visit(0); assert.equal(seen.size, 6);
    assert.equal(G.floor.rooms.reduce((n, r) => n + r.links.length, 0) / 2, 6);
    let budget = 0;
    for (const room of G.floor.rooms) {
      G.enterRoom(room.id);
      if (room.kind === 'combat') budget += G.waves.flat().length;
      assert.deepEqual(spatialViolations(G), []);
      for (const d of G.doors) {
        assert(G.spawnSpots.some(s => s.x === d.x && s.y === d.y), '门必须位于可达地面');
        Object.assign(G.player, { x: d.x, y: d.y });
        assert.deepEqual(spatialViolations(G), [], '门交互位置不能嵌墙');
      }
    }
    assert.equal(budget, 3 + (z + 1) * 2 + level * 2 + 3 * CORE.DIFFICULTY_CURVE.extraEnemies, '每层预算包含三个战斗房的增量');
  }
}

const G = createGame({ seed: 42, headless: true }); G.startRun();
const floor = G.floor;
G.nextLevel(); assert.equal(G.floor, floor, '未解锁不能跳层');
useDoor(G, 1); assert.equal(floor.current, 1); assert(G.doorsLocked);
useDoor(G, 0); assert.equal(floor.current, 1, '战斗时不能离开');
clearCombat(G); assert.equal(G.state, 'playing'); assert.equal(G.portal, null);
// 回访保留未拾取物与房间清除状态，清除弹幕与延迟攻击。
G.pickups.push({ x: 88, y: 88, kind: 'coin', t: 0 });
G.player.undyingUsed = true;
useDoor(G, 0); useDoor(G, 1);
assert(G.player.undyingUsed, '往返房门不能重置不死晶片');
assert(G.pickups.some(p => p.x === 88 && p.kind === 'coin'));
assert.equal(G.waves.length, 0); assert.equal(G.enemies.length, 0);
assert.equal(G.bullets.length, 0); assert.equal(G.state, 'playing');
useDoor(G, 2); clearCombat(G);
useDoor(G, 5); assert.equal(G.portal, null); assert.equal(G.state, 'playing', '未清第三间不发晶片');
useDoor(G, 2); useDoor(G, 3); clearCombat(G);
useDoor(G, 4); assert(G.pickups.some(p => p.kind === 'crate'), '宝箱支路有武器奖励');
// 模拟拾取后回访，宝箱不能重新出现。
G.pickups = []; useDoor(G, 1); useDoor(G, 4); assert.equal(G.pickups.length, 0);
useDoor(G, 3); useDoor(G, 2); useDoor(G, 5);
assert.equal(G.state, 'chip'); assert.equal(G.chipOffer.length, 3);
G.chooseChip(0); assert.equal(G.state, 'playing'); assert(G.portal);
const chips = G.chips.length;
useDoor(G, 2); useDoor(G, 5);
assert.equal(G.chips.length, chips); assert.equal(G.state, 'playing'); assert(G.portal);
G.nextLevel(); assert.equal(G.roomIdx, 1); assert.equal(G.floor.current, 0);
assert.notEqual(G.floor, floor); assert(G.floor.rooms.every(r => !r.visited || r.kind === 'entry'));
G.loadBossRoom('boss'); assert.deepEqual(G.doors, []); assert.equal(G.navigationDoor(), null);
G.startRun(); assert.equal(G.floor.current, 0); assert.equal(G.floor.rewarded, false);
console.log('✓ 多房间：140 层图结构/预算/碰撞 + 封门、回访、宝箱、出口、换层与重开通过');
