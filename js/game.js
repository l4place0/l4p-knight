/* ============================================================
 * 零号协议 ZERO PROTOCOL —— game.js（装配门面）
 * 游戏核心已拆为六部件（js/game/）：state / systems / player / enemies / bosses /
 * rooms，各自只注册工厂到 ZERO_GAME_PARTS，不做即时逻辑。本文件只负责装配：
 *   - 浏览器：index.html 按「六部件 → 本门面」顺序加载，部件先行注册；
 *   - Node：此处按同一顺序 require 六部件（注册幂等，重复 require 无副作用）。
 * createGame 按固定顺序装配 ctx 与 G：state → systems → player → enemies →
 * bosses → rooms。跨部件助手挂 ctx、公开面挂 G（与拆分前 game.js 完全一致）。
 * 逻辑与渲染完全分离：headless 模式下可在 Node 中直接 update(dt)。
 * ============================================================ */
(function (root) {
'use strict';
const PARTS = root.ZERO_GAME_PARTS || (root.ZERO_GAME_PARTS = {});

/* Node 侧装载六部件（浏览器由 <script> 先行注册，此分支不生效） */
if (typeof module !== 'undefined' && module.exports) {
  require('./game/state.js');
  require('./game/systems.js');
  require('./game/player.js');
  require('./game/enemies.js');
  require('./game/bosses.js');
  require('./game/rooms.js');
}

function createGame(opts) {
  opts = opts || {};
  /* 装配上下文：core 数据层 + 种子 + headless 标记，六部件向 ctx/G 挂载 */
  const ctx = {
    C: root.ZERO_CORE,
    headless: !!opts.headless,
    seed: opts.seed || 1,
    difficulty: opts.difficulty || 'standard',
  };
  /* 装配顺序钉死：state 打底（G 工厂/池/RNG）→ systems（碰撞/主更新管线）→
   * player（属性/玩家）→ enemies（敌人 AI/伤害）→ bosses（Boss 状态机）→
   * rooms（房间/流程/调试）。跨部件引用均为运行期经 ctx 晚绑定。 */
  PARTS.state(ctx);
  PARTS.systems(ctx);
  PARTS.player(ctx);
  PARTS.enemies(ctx);
  PARTS.bosses(ctx);
  PARTS.rooms(ctx);

  const G = ctx.G;
  if (!ctx.headless && root.ZERO_RENDER) root.ZERO_RENDER.attach(G);
  else G.render = function () {};
  G.computeStats();  // 标题界面 HUD 即会读取属性袋，创建时初始化避免空引用

  return G;
}

root.ZERO_GAME = { createGame };
if (typeof module !== 'undefined' && module.exports) module.exports = root.ZERO_GAME;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
