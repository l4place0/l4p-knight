/* tier-2 回填：解析结果文件中标记「SURVIVED-probe-未确认」的行，逐个重新消融并跑
 * SEEDS=1 sim.test 确认，把结果追加到原结果文件末尾。用后可删。
 * 用法：node test/abl/backfill.js <resultsMd> <targetJs> */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const [, , resultsPath, targetRel] = process.argv;
if (!resultsPath || !targetRel) { console.error('用法: node backfill.js <resultsMd> <targetJs>'); process.exit(2); }
const ROOT = path.resolve(__dirname, '..', '..');
const targetAbs = path.join(ROOT, targetRel);
const original = fs.readFileSync(targetAbs, 'utf8').split('\n');

// 解析未确认行号
const rows = fs.readFileSync(resultsPath, 'utf8').split('\n');
const pending = [];
for (const row of rows) {
  const m = row.match(new RegExp('^\\| ' + targetRel.replace(/\./g, '\\.') + ':(\\d+) \\| SURVIVED-probe-未确认 \\|'));
  if (m) pending.push(parseInt(m[1], 10));
}
console.log('待回填: ' + pending.length + ' 行 (' + targetRel + ')');

let killed = 0, survived = 0, na = 0;
const out = [];
function restore() {
  fs.writeFileSync(targetAbs, original.join('\n'));
  execFileSync('git', ['checkout', '--', targetRel], { cwd: ROOT });
}
for (const ln of pending) {
  const lines = original.slice();
  const idx = ln - 1;
  if (idx < 0 || idx >= lines.length) { out.push('| ' + targetRel + ':' + ln + ' | 回填-N/A | 行号越界 | |'); na++; continue; }
  // 消融：先注释
  let cur = lines.slice();
  cur[idx] = '//' + cur[idx];
  fs.writeFileSync(targetAbs, cur.join('\n'));
  let chk = spawnSync(process.execPath, ['--check', targetAbs]);
  if (chk.status !== 0) {
    // 整行删除兜底
    cur = lines.slice(); cur.splice(idx, 1);
    fs.writeFileSync(targetAbs, cur.join('\n'));
    chk = spawnSync(process.execPath, ['--check', targetAbs]);
    if (chk.status !== 0) { restore(); out.push('| ' + targetRel + ':' + ln + ' | 回填-N/A-syntax | 单行不可消融 | |'); na++; continue; }
  }
  // tier-2:SEEDS=1 sim.test
  const sim = spawnSync(process.execPath, ['test/sim.test.js'], {
    cwd: ROOT, timeout: 300000, env: Object.assign({}, process.env, { SEEDS: '1' }), encoding: 'utf8',
  });
  const cls = sim.status === 0 ? 'SURVIVED-full(回填)' : 'KILLED-full(回填)';
  if (sim.status === 0) survived++; else killed++;
  out.push('| ' + targetRel + ':' + ln + ' | ' + cls + ' | (回填 tier-2) | exit=' + sim.status + ' |');
  restore();
}
fs.appendFileSync(resultsPath, '\n## tier-2 回填（backfill.js）\n\n' +
  '- 回填总数 ' + pending.length + '：KILLED-full ' + killed + ' · SURVIVED-full ' + survived + ' · N/A ' + na + '\n\n' +
  out.join('\n') + '\n');
console.log('回填完成: KILLED-full ' + killed + ' · SURVIVED-full ' + survived + ' · N/A ' + na);
