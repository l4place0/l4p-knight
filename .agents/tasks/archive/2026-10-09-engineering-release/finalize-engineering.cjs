'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');process.chdir(root);
const read=p=>fs.readFileSync(p,'utf8'),write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);};
let core=read('src/core.js');
for(const [table,registry] of [['chips','CHIP_PARAMS'],['synergies','SYNERGY_PARAMS']]) {
  const data=JSON.parse(read('config/'+table+'.json'));
  core=core.replace('const '+(table==='chips'?'CHIPS':'SYNERGIES')+'_EFFECTS = {',
    'const '+registry+' = Object.fromEntries(CONFIG.'+table+'.map(c => [c.id, c.params]));\nconst '+(table==='chips'?'CHIPS':'SYNERGIES')+'_EFFECTS = {');
  data.forEach((entry,i)=>{core=core.split('CONFIG.'+table+'['+i+'].params').join(registry+'.'+entry.id);});
}
core=core.replace('apply: CHIPS_EFFECTS[entry.id]', "apply: CHIPS_EFFECTS[entry.id] || missingEffect(entry.id)").replace('apply: SYNERGIES_EFFECTS[entry.id]',"apply: SYNERGIES_EFFECTS[entry.id] || missingEffect(entry.id)");
core=core.replace('const CHIPS_EFFECTS = {',"function missingEffect(id) { throw new Error('Missing effect implementation: ' + id); }\nconst CHIPS_EFFECTS = {");
write('src/core.js',core);
let game=read('src/game.js').replace('  const G = ctx.G;',
 "  const G = ctx.G;\n  G.getConfiguration = () => ({hash: ctx.C.CONFIG.hash, overrides: JSON.parse(JSON.stringify({\n    enemyTuning:G.enemyTuning, bossTuning:G.bossTuning, curveTuning:G.curveTuning, damageTuning:G.damageTuning, debugDmg:G.debugDmg\n  }))});");write('src/game.js',game);
write('src/game/rooms.js',read('src/game/rooms.js').replace('score: G.score, rating, difficulty: G.difficultyId,','score: G.score, rating, difficulty: G.difficultyId, configuration: G.getConfiguration(),'));
write('test/lib.js',read('test/lib.js').replace('    G, ok, outcome,','    G, ok, outcome, configuration: G.getConfiguration(),'));
write('test/difficulty-balance.js',read('test/difficulty-balance.js').replace('return {...spec,outcome,','return {...spec,configuration:G.getConfiguration(),outcome,').replace('gameVersion:require', 'configurationHash:C.CONFIG.hash,gameVersion:require'));
write('test/enemy-balance.js',read('test/enemy-balance.js').replace('return { ...spec, outcome,','return { ...spec, configuration:G.getConfiguration(), outcome,').replace('{config:opts,genes:', '{configurationHash:CORE.CONFIG.hash,config:opts,genes:'));
write('test/hero-balance.js',read('test/hero-balance.js').replace("const report={version:'1.11'", "const report={configurationHash:C.CONFIG.hash,version:require('../package.json').version"));
write('test/matrix.js',read('test/matrix.js').replace('config: { seeds: opts.seeds, heroes:', 'configurationHash: CORE.CONFIG.hash, config: { seeds: opts.seeds, heroes:'));
// Shared art docs and Agent-only generation records get separate homes.
fs.mkdirSync('docs/art',{recursive:true});fs.mkdirSync('.agents/art',{recursive:true});
fs.renameSync('assets/art/README.md','docs/art/README.md');
fs.renameSync('assets/art/animations/README.md','docs/art/animations.md');
fs.renameSync('assets/art/prompts.json','.agents/art/prompts.json');
fs.renameSync('assets/art/animations/prompts.json','.agents/art/animation-prompts.json');
write('docs/art/README.md',read('docs/art/README.md').replace('(prompts.json)','(../../.agents/art/prompts.json)').replace('(animations/README.md)','(animations.md)').replace(/\(([^()]+\.png)\)/g,'(../../assets/art/$1)')+'\n源码、文档与素材统一 MIT，作者署名 l4place。\n');
write('docs/art/animations.md',read('docs/art/animations.md').replace('(prompts.json)','(../../.agents/art/animation-prompts.json)').replace('(preview.html)','(../../assets/art/animations/preview.html)')+'\n所有动画资源采用根目录 MIT LICENSE。\n');
let changelog=read('CHANGELOG.md').replace('(assets/art/README.md)','(docs/art/README.md)').replace('(assets/art/animations/README.md)','(docs/art/animations.md)');
write('CHANGELOG.md',changelog.replace('以下为历史版本的发布记录；数值证据以对应版本报告为准。','以下为历史版本的发布记录；数值证据以对应版本报告为准。\n\n## 1.15.0 工程整理（2026-10-09）\n\n源码迁入 src/，正式定义与主要调参项抽离 JSON，增加配置校验/浏览器生成、LFS、MIT、发布构建和 GitHub Actions。保留历史诊断与浏览器双击运行，玩法与数值沿用 1.14.3。'));
const pkg=JSON.parse(read('package.json'));pkg.version='1.15.0';pkg.license='MIT';pkg.author='l4place';pkg.repository={type:'git',url:'https://github.com/l4place0/l4p-knight.git'};pkg.homepage='https://l4place0.github.io/l4p-knight/';write('package.json',JSON.stringify(pkg,null,2)+'\n');
write('README.md',`# 零号协议 ZERO PROTOCOL

黑白灰像素风 2D 肉鸽弹幕射击游戏：四名英雄、六种武器、七种小怪、两位 Boss、多房间探索、晶片升级与羁绊，内置 AI 代打。

原生 HTML5 Canvas + Web Audio，零第三方运行依赖。浏览器为主版本，正式数值保存在 JSON，Node 提供确定性仿真与发布构建。

![游戏标题素材](assets/art/title.png)

[在线游玩](https://l4place0.github.io/l4p-knight/) · [版本历史](CHANGELOG.md) · [问题追踪](docs/issues/README.md)

## 运行

需要 Node >=22 和 Git LFS，无第三方依赖，无需 npm install。

\
\
\

打开 http://127.0.0.1:8941/。也可先执行 npm run config:generate，再双击 index.html。npm run build 生成 dist/ 离线发布目录。

## 操作

| 输入 | 功能 |
| --- | --- |
| WASD / 方向键 | 移动 |
| 鼠标 / 左键 | 瞄准 / 射击 |
| Shift / 右键 / 空格 | 冲刺 |
| F | 相位刃与弹反 |
| E | 互动、房门与传送门 |
| Q / 1 / 2 | 切换武器 |
| B / M / P | AI 代打 / 静音 / 暂停 |
| 手柄 | 左右摇杆移动/瞄准，RT 射击，LT 冲刺，X 近战，B 互动 |
| 触屏 | 虚拟摇杆与动作按钮，射击自动瞄准 |

URL 支持 ?seed=1&bot=1&autostart=1 固定种子自动游玩。

## 开发与发布

npm run config:generate → npm run test:ci → npm run build。

[架构](docs/architecture.md) · [配置与数值](docs/configuration.md) · [玩法规格](docs/gameplay.md) · [开发与验收](docs/development.md) · [发布流程](docs/releasing.md) · [美术资源](docs/art/README.md)

GitHub Actions 检查后部署 dist/ 到 GitHub Pages。素材使用 Git LFS，构建时下载并打包真实文件。

作者 **l4place**（GitHub：**l4place0**）。源码、文档及素材统一采用 [MIT License](LICENSE)。
`);
const commandBlock=['```powershell','git clone https://github.com/l4place0/l4p-knight.git','cd l4p-knight','git lfs pull','npm start','```'].join('\n');
write('README.md',read('README.md').replace('需要 Node >=22 和 Git LFS，无第三方依赖，无需 npm install。','需要 Node >=22 和 Git LFS，无第三方依赖，无需 npm install。\n\n'+commandBlock));
console.log('Documentation, licensing, stable IDs and configuration reporting completed.');
