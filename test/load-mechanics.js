'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync}=require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const FILES = ['js/core.js', ...['state','player','enemies','bosses','rooms','systems'].map(p=>'js/game/'+p+'.js'), 'js/game.js', 'js/bot.js'];
function loadMechanics(mutation, ref) {
  const world = vm.createContext({ console, Math });
  for (const file of FILES) {
    let source = (ref ? execFileSync('git',['show',ref+':'+file],{cwd:ROOT,encoding:'utf8'}) : fs.readFileSync(path.join(ROOT,file),'utf8')).replace(/\r\n/g,'\n');
    if (mutation && file === mutation.file) {
      if (source.split(mutation.from).length !== 2) throw new Error('变异锚点必须唯一：'+mutation.name);
      source = source.replace(mutation.from, mutation.to);
    }
    vm.runInContext(source, world, { filename:file, timeout:3000 });
  }
  const contexts = new WeakMap(), rooms = world.ZERO_GAME_PARTS.rooms;
  world.ZERO_GAME_PARTS.rooms = ctx => { rooms(ctx); contexts.set(ctx.G,ctx); };
  return { CORE:world.ZERO_CORE, GAME:world.ZERO_GAME, BOT:world.ZERO_BOT, context:G=>contexts.get(G) };
}
module.exports = { loadMechanics };
