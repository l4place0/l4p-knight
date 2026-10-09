'use strict';
const CORE = require('../src/core.js');
// 独立读取地图定义；不调用被测碰撞助手，避免助手出错时探针也失明。
function spatialViolations(G) {
  const map = CORE.MAPS[G.mapId], issues = [];
  for (const e of [G.player, ...G.enemies]) {
    const who = e === G.player ? 'player' : e.type;
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) { issues.push('nan:' + who); continue; }
    const width = map[0].length * CORE.TILE, height = map.length * CORE.TILE;
    if (e.x < -2 || e.y < -2 || e.x > width + 2 || e.y > height + 2) issues.push('bounds:' + who);
    const r = e.r - 1;
    for (let y = Math.floor((e.y-r)/CORE.TILE); y <= Math.floor((e.y+r)/CORE.TILE); y++) {
      for (let x = Math.floor((e.x-r)/CORE.TILE); x <= Math.floor((e.x+r)/CORE.TILE); x++) {
        if (!map[y] || map[y][x] === undefined || map[y][x] === '#') {
          issues.push('wallClip:' + who); y = Infinity; break;
        }
      }
    }
  }
  return issues;
}
module.exports = { spatialViolations };
