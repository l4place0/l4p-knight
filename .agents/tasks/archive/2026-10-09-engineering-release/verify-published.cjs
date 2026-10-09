'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../../..'),base='https://l4place0.github.io/l4p-knight/';
const {list}=require('../../../../scripts/build.cjs');
async function main() {
  const release=await fetch(base+'release.json',{signal:AbortSignal.timeout(20000)}).then(r=>{if(!r.ok)throw new Error('Release HTTP '+r.status);return r.json();});
  if(release.configurationHash!==require('../../../../scripts/config.cjs').loadConfig().hash)throw new Error('Published configuration mismatch');
  const files=['index.html','generated/config.js',...list(path.join(root,'src')).map(f=>path.relative(root,f)),...list(path.join(root,'assets')).filter(f=>f.endsWith('.png')).map(f=>path.relative(root,f))];
  for(let start=0;start<files.length;start+=4) {
    await Promise.all(files.slice(start,start+4).map(async file=>{
      const response=await fetch(base+file.replace(/\\/g,'/'),{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(file+' HTTP '+response.status);
      const online=Buffer.from(await response.arrayBuffer()),local=fs.readFileSync(path.join(root,file));
      const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
      if(file.endsWith('.png')?hash(online)!==hash(local):online.toString().replace(/\r\n/g,'\n')!==local.toString().replace(/\r\n/g,'\n'))throw new Error('Published content mismatch: '+file);
    }));
  }
  console.log('PASS: published release '+release.version+', configuration, HTML, scripts and 18 PNG files match local content ('+files.length+' files).');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
