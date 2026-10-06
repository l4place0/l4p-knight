/* 消融探针运行器：90 秒墙钟强杀（防变异引入死循环卡死调用方）
 * 用法：node test/abl/run.js
 * 退出码：0 = 探针通过（变异存活）· 1 = 探针失败/超时/崩溃（变异被杀） */
'use strict';
const { spawn } = require('child_process');
const path = require('path');

let settled = false;
function finish(code, why) {
  if (settled) return;
  settled = true;
  if (why) console.log('KILLED-TIMEOUT ' + why);
  process.exit(code);
}

const child = spawn(process.execPath, [path.join(__dirname, 'abl-probe.js')], { stdio: 'inherit' });
const timer = setTimeout(() => {
  child.kill();
  setTimeout(() => finish(1, '90s'), 300);
}, 90000);
child.on('exit', (code) => { clearTimeout(timer); finish(code === 0 ? 0 : 1); });
child.on('error', (e) => { clearTimeout(timer); console.log('KILLED-SPAWN ' + e.message); finish(1); });
