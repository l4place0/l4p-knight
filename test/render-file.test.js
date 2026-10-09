'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/render.js'), 'utf8');

// Emulate the canvas contract: local images may be drawn, but pixel reads throw.
// This is a renderer fault regression, not a substitute for Edge file:// QA.
function load(readMode, renderSource = source) {
  const pending = [];
  class Canvas {
    constructor() {
      this.width = this.height = 4;
      this.ctx = {
        draws: [],
        drawImage(...args) { this.draws.push(args); },
        fillRect() {}, clearRect() {},
        getImageData: () => {
          if (readMode === 'blocked' || readMode === 'broken') {
            const e = new Error('Pixel read rejected');
            e.name = readMode === 'blocked' ? 'SecurityError' : 'TypeError';
            throw e;
          }
          const data = new Uint8ClampedArray(this.width * this.height * 4);
          if (readMode !== 'empty') for (let y=1;y<3;y++) for(let x=1;x<3;x++) data[(y*this.width+x)*4+3]=255;
          return {data};
        },
      };
    }
    getContext() { return this.ctx; }
    setAttribute() {}
  }
  class Image {
    set src(url) {
      this.width = url.includes('chips.png') ? 20 : 16; this.height = 16;
      pending.push(this);
    }
  }
  const world = vm.createContext({console, URL, Image, document: {
    currentScript: {src:'https://example.test/js/render.js'},
    createElement: () => new Canvas(),
  }});
  vm.runInContext(fs.readFileSync(path.join(root,'js/core.js'),'utf8'), world);
  vm.runInContext(renderSource, world);
  for(const img of pending) img.onload();
  return {R:world.ZERO_RENDER,C:world.ZERO_CORE};
}
const normal=load('normal');
const sp=normal.R.makeSprite('vanguard');
assert.deepEqual(sp.cv.ctx.draws[0].slice(1,5),[1,1,2,2],'Readable atlas still trims alpha');
assert.equal(normal.R.makeSprite('vanguard'),sp,'Sprite cache remains effective');
assert.equal(load('empty').R.makeSprite('power'),null,'Empty atlas-only cell remains absent');
const blocked=load('blocked');
for(const id of ['vanguard','smg','portal','coin','power',...blocked.C.CHIPS.map(c=>c.id)]) {
  const s=blocked.R.makeSprite(id);
  assert.ok(s&&s.flash,'SecurityError must preserve sprite and hit flash: '+id);
  assert.deepEqual(s.cv.ctx.draws[0].slice(1,5),[0,0,4,4],'Use full registered cell without reading pixels');
  assert.ok(blocked.R.icon(id).ctx.draws.length,'HUD/title icon must render: '+id);
}
assert.throws(()=>load('broken').R.makeSprite('vanguard'),{name:'TypeError'},'Unexpected rendering errors remain visible');
// The previous production renderer fails under the same browser restriction.
const previous=execFileSync('git',['show','f4d71cc:js/render.js'],{cwd:root,encoding:'utf8'});
assert.throws(()=>load('blocked',previous).R.makeSprite('smg'),{name:'SecurityError'});
console.log('PASS: restricted canvas sprites, flashes and UI icons; normal alpha trim; old-renderer negative control.');
