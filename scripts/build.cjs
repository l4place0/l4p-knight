'use strict';
const fs=require('node:fs'),path=require('node:path');
const {generate}=require('./config.cjs');
const ROOT=path.resolve(__dirname,'..');
function list(dir) {return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?list(path.join(dir,e.name)):[path.join(dir,e.name)]);}
function assertAssets(root=ROOT) {
  for(const file of list(path.join(root,'assets'))) {
    const fd=fs.openSync(file,'r'), buf=Buffer.alloc(128);const n=fs.readSync(fd,buf,0,128,0);fs.closeSync(fd);
    if(buf.subarray(0,n).toString().startsWith('version https://git-lfs.github.com/spec/v1'))throw new Error('LFS pointer instead of asset: '+path.relative(root,file)+'; run git lfs pull');
  }
}
function build(output=path.join(ROOT,'dist')) {
  const dest=path.resolve(output);
  if(dest!==path.join(ROOT,'dist'))throw new Error('Build destination must be the workspace dist directory');
  const data=generate();assertAssets();
  // Only the fixed, verified workspace dist target may be replaced.
  fs.rmSync(dest,{recursive:true,force:true});fs.mkdirSync(dest,{recursive:true});
  for(const file of ['index.html','LICENSE'])fs.copyFileSync(path.join(ROOT,file),path.join(dest,file));
  for(const dir of ['src','generated'])fs.cpSync(path.join(ROOT,dir),path.join(dest,dir),{recursive:true});
  for(const file of list(path.join(ROOT,'assets')).filter(f=>/\.(png|jpg|jpeg|webp|ogg|mp3|wav|json)$/i.test(f))) {
    if(path.basename(file)==='prompts.json')continue;
    const target=path.join(dest,path.relative(ROOT,file));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);
  }
  fs.writeFileSync(path.join(dest,'.nojekyll'),'');
  fs.writeFileSync(path.join(dest,'release.json'),JSON.stringify({version:require('../package.json').version,configurationHash:data.hash},null,2)+'\n');
  console.log('Built dist/ with real assets · '+data.hash);return dest;
}
module.exports={build,assertAssets,list};
if(require.main===module) {try {build();} catch(e) {console.error(e.message);process.exitCode=1;}}
