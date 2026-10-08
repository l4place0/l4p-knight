'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = path.join(__dirname, 'art-preview'); fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await page.goto((process.argv[2] || 'http://127.0.0.1:8941') + '/?autostart=1');
    await page.evaluate(async () => {
      await ZERO_RENDER.artReady; await ZERO_ANIMATION.ready;
      G.startRun('vanguard'); ZERO_UI.onRunStart(); G.fade = 0; G.banner = null; __draw();
    });
    await page.locator('#stage').screenshot({ path: path.join(out, 'rooms-entry.png') });
    const locked = await page.evaluate(() => {
      const door = G.doors[0]; Object.assign(G.player, { x: door.x, y: door.y });
      G.input.interact = true; G.update(1 / 60); G.fade = 0; G.banner = null; __draw();
      return { current: G.floor.current, locked: G.doorsLocked, label: G.roomLabel };
    });
    assert.equal(locked.current, 1); assert(locked.locked); assert(locked.label.includes('战斗 1'));
    await page.locator('#stage').screenshot({ path: path.join(out, 'rooms-combat.png') });
    const clear = await page.evaluate(() => {
      G.debugClear(); G.pendSpawns = []; G.wavIdx = G.waves.length - 1;
      for (let i = 0; i < 65; i++) G.update(1 / 60);
      G.fade = 0; G.banner = null; __draw();
      return { cleared: G.floor.rooms[1].cleared, locked: G.doorsLocked, state: G.state };
    });
    assert.deepEqual(clear, { cleared: true, locked: false, state: 'playing' });
    await page.locator('#stage').screenshot({ path: path.join(out, 'rooms-cleared.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: browser rendering, room-door input, combat lock/unlock; 3 screenshots in test/art-preview');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
