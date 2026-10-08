/* Browser acceptance for real PNG decoding, transparency, UI and fallback.
 * Start npm start; PLAYWRIGHT_MODULE may point to an installed Playwright module.
 * node test/art-assets.js [baseURL] [browser channel]
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8941';
const output = path.join(__dirname, 'art-preview');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: process.argv[3] || 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 680 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    const result = await page.evaluate(async () => {
      const R = ZERO_RENDER, C = ZERO_CORE;
      const loaded = await R.artReady;
      const ids = [...Object.keys(C.HEROES), ...Object.keys(C.ENEMY_DEFS), ...Object.keys(C.WEAPONS),
        ...C.CHIPS.map(c => c.id), 'power', 'portal', 'mine', 'ghost', 'crate', 'heart', 'battery',
        'coin', 'plasma', 'enemyOrb', 'missile', 'grenadeShot', 'muzzle', 'slash'];
      const sprites = ids.map(id => {
        const sp = R.makeSprite(id);
        if (!sp) return { id, valid: false };
        const pixels = sp.cv.getContext('2d').getImageData(0, 0, sp.w, sp.h).data;
        let filled = 0, transparent = 0;
        for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] > 0) filled++; if (pixels[i] === 0) transparent++; }
        const flash = sp.flash.getContext('2d').getImageData(0, 0, sp.w, sp.h).data;
        let validFlash = true;
        for (let i = 0; i < flash.length; i += 4) if (flash[i + 3] > 0 && (flash[i] < 250 || flash[i+1] < 250 || flash[i+2] < 250)) validFlash = false;
        return { id, valid: filled > 0 && transparent > 0 && validFlash };
      });
      const heroes = Object.keys(C.HEROES).map(id => R.makeSprite(id).cv.toDataURL());
      return { loaded, sprites, heroCount: new Set(heroes).size };
    });
    assert(result.loaded.every(Boolean), 'All five image files must decode');
    assert(result.sprites.every(s => s.valid), JSON.stringify(result.sprites.filter(s => !s.valid)));
    assert.equal(result.heroCount, 4, 'Four visually distinct heroes');
    await page.locator('#stage').screenshot({ path: path.join(output, 'title.png') });
    // A paused simulation gives reproducible snapshots without autonomous combat.
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    for (let zone = 1; zone <= 4; zone++) {
      await page.evaluate(zone => { G.startRun('vanguard'); ZERO_UI.onRunStart(); G.debugJump(zone, 1); G.fade = 0; G.banner = null; __draw(); }, zone);
      await page.locator('#stage').screenshot({ path: path.join(output, 'zone-' + zone + '.png') });
    }
    for (const boss of ['boss', 'boss2']) {
      await page.evaluate(boss => { G.startRun('prototype'); G.debugJump(boss === 'boss' ? 3 : 4, 1); G.loadBossRoom(boss); G.fade = 0; G.banner = null; G.enemies.forEach(e => { e.spawning = 0; }); __draw(); }, boss);
      await page.locator('#stage').screenshot({ path: path.join(output, boss + '.png') });
    }
    await page.evaluate(() => { G.state = 'chip'; G.chipOffer = ZERO_CORE.CHIPS.slice(0, 3); __draw(); });
    assert.equal(await page.locator('#chipCards canvas').count(), 3);
    await page.locator('#stage').screenshot({ path: path.join(output, 'chips.png') });
    await page.evaluate(() => { G.state = 'shop'; G.shopItems = [{ kind:'heal',name:'医疗包',desc:'回复生命',price:6 }, {kind:'weapon',weapon:'shotgun',name:'霰弹枪',desc:'武器',price:10}, {kind:'chip',chipId:'glass',name:'玻璃大炮',desc:'晶片',price:12}]; __draw(); });
    assert.equal(await page.locator('#shopCards canvas').count(), 3);
    await page.locator('#stage').screenshot({ path: path.join(output, 'shop.png') });
    assert.deepEqual(errors, [], 'Browser must have no runtime errors');
    const fallback = await browser.newPage();
    const fallbackErrors = []; fallback.on('pageerror', e => fallbackErrors.push(e.message));
    await fallback.route('**/assets/art/*.png', route => route.abort());
    await fallback.goto(base + '/?autostart=1');
    const original = await fallback.evaluate(async () => { await ZERO_RENDER.artReady; __draw(); return ZERO_RENDER.makeSprite('player').w; });
    assert.equal(original, 12, 'Missing PNGs must retain original sprites');
    assert.deepEqual(fallbackErrors, []);
    await page.setViewportSize({ width: 1200, height: 1500 });
    await page.goto(base + '/assets/art/preview.html');
    await page.waitForFunction(() => document.querySelectorAll('.card canvas').length === 52 && document.querySelectorAll('.tiles canvas').length === 4);
    await page.screenshot({ path: path.join(output, 'overview.png'), fullPage: true });
    console.log('PASS: 5 PNGs, ' + result.sprites.length + ' transparent sprites/flash masks, 4 heroes, 4 zones, 2 bosses, chip/shop UI, missing-file fallback, zero browser errors.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
