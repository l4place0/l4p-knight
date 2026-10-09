'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {build,list,assertAssets}=require('../scripts/build.cjs');
const root=build();
assertAssets(root);
for(const dir of ['.agents','docs','test','scripts','config','.git'])assert.ok(!fs.existsSync(path.join(root,dir)),dir+' excluded');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const [,ref] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if(/^(?:https?:|data:)/.test(ref))continue;
  assert.ok(!ref.startsWith('/'),'project-site relative URL: '+ref);
  assert.ok(fs.existsSync(path.join(root,ref.split('?')[0])),ref+' exists');
}
const src=fs.readFileSync(path.join(root,'src/animation.js'),'utf8');
const ids=Array.from(src.matchAll(/^  (\w+): \{/gm),m=>m[1]);
for(const id of ids)assert.ok(fs.existsSync(path.join(root,'assets/art/animations',id+'.png')),id+' animation');
assert.ok(list(root).some(f=>f.endsWith('characters.png')));
const temporary=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'l4p-knight-lfs-test-'));
try {
  fs.mkdirSync(path.join(temporary,'assets'));
  fs.writeFileSync(path.join(temporary,'assets/test.png'),'version https://git-lfs.github.com/spec/v1\noid sha256:test\nsize 1\n');
  assert.throws(()=>assertAssets(temporary),/LFS pointer instead of asset/);
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
console.log('PASS: release allowlist, scripts/assets, relative URLs and resolved LFS assets.');
