'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8941';
const out = path.join(__dirname, 'art-preview'); fs.mkdirSync(out, {recursive:true});
(async()=>{
  const browser = await chromium.launch({channel:process.argv[3] || 'msedge',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1200,height:1000}}), errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    // Freeze the browser loop; test calls real gameplay updates explicitly.
    await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;});
    await page.goto(base+'/?autostart=1');
    const report = await page.evaluate(async()=>{
      const A=ZERO_ANIMATION;const loaded=await A.ready;await ZERO_RENDER.artReady;
      const bad=[],actions=[];let total=0;
      for(const [id,spec] of Object.entries(A.SPECS))for(const action of spec.actions){
        const hashes=new Set();
        for(let frame=0;frame<6;frame++){
          total++;const sp=A.sprite(id,action,frame);
          if(!sp){bad.push(id+':'+action+':'+frame+' missing');continue}
          const data=sp.cv.getContext('2d').getImageData(0,0,sp.w,sp.h).data;
          let content=0,empty=0;for(let i=3;i<data.length;i+=4){if(data[i]>0)content++;else empty++}
          if(!content||!empty||sp.w!==spec.size||sp.h!==spec.size)bad.push(id+':'+action+':'+frame+' invalid cell');
          hashes.add(sp.cv.toDataURL());
        }
        actions.push({id,action,distinct:hashes.size});
      }
      return {loaded,bad,actions,total};
    });
    assert(report.loaded.every(Boolean),'All 13 animation PNGs must decode');
    assert.equal(report.total,546);assert.deepEqual(report.bad,[]);
    assert(report.actions.every(a=>a.distinct>=3),JSON.stringify(report.actions.filter(a=>a.distinct<3)));
    const movement = await page.evaluate(()=>{
      G.startRun('vanguard');ZERO_UI.onRunStart();G.fade=0;G.banner=null;G.enemies=[];
      const playback=G.visualPlayback,hashes=new Set(),frames=new Set(),x=G.player.x;
      G.input.moveX=1;G.input.moveY=0;G.input.aimA=0;
      for(let i=0;i<36;i++){G.update(1/60);const pose=playback.sample(G.player);
        if(pose.action==='move'){frames.add(pose.frame);hashes.add(pose.sprite.cv.toDataURL())}}
      __draw();return {frames:[...frames].sort(),unique:hashes.size,moved:G.player.x>x};
    });
    assert(movement.moved);assert.deepEqual(movement.frames,[0,1,2,3,4,5]);assert(movement.unique>=3);
    await page.locator('#stage').screenshot({path:path.join(out,'animated-game.png')});
    const triggers=await page.evaluate(()=>{
      const p=G.player,playback=G.visualPlayback;G.input.moveX=0;G.input.fire=false;
      G.input.melee=true;G.update(1/60);const melee=playback.sample(p).action;
      p.dashCd=0;G.input.dash=true;G.update(1/60);const dash=playback.sample(p).action;
      p.dashT=0;p.slashT=0;p.iframes=0;p.shield=0;p.hp=2;
      G.hitstop=0;G.mines.push({x:p.x,y:p.y,r:40,t:0,fuse:0,dmg:1});G.update(1/60);
      const hurt=playback.sample(p).action;
      return {melee,dash,hurt};
    });
    assert.deepEqual(triggers,{melee:'melee',dash:'dash',hurt:'hurt'});
    // Lethal damage ends combat immediately; the real end overlay waits for
    // the drawn collapse sequence, whose terminal frame never loops.
    const defeat=await page.evaluate(()=>{
      window.animWall=0;G.visualPlayback=ZERO_ANIMATION.createPlayback(G,()=>window.animWall);
      G.player.iframes=0;G.player.shield=0;G.player.hp=1;G.hitstop=0;
      G.mines.push({x:G.player.x,y:G.player.y,r:40,t:0,fuse:0,dmg:10});G.update(1/60);
      __draw();return {state:G.state,frame:G.visualPlayback.sample(G.player).frame,endVisible:ZERO_UI.els.screenEnd.classList.contains('show')};
    });
    assert.equal(defeat.state,'defeat');assert.equal(defeat.frame,0);assert.equal(defeat.endVisible,false);
    const mid=await page.evaluate(()=>{window.animWall=0.42;__draw();return G.visualPlayback.sample(G.player).frame});
    assert(mid>=2 && mid<=4,'Must display intermediate death frames');
    const end=await page.evaluate(()=>{window.animWall=0.92;__draw();return {frame:G.visualPlayback.sample(G.player).frame,shown:ZERO_UI.els.screenEnd.classList.contains('show')}});
    assert.deepEqual(end,{frame:5,shown:true});
    await page.goto(base+'/assets/art/animations/preview.html');
    await page.waitForFunction(()=>document.body.dataset.ready==='true');
    assert.equal(await page.locator('.actor').count(),13);assert.equal(await page.locator('.film canvas').count(),6);
    await page.locator('#action').selectOption('melee');
    await page.locator('#scrub').fill('3');await page.locator('#scrub').dispatchEvent('input');
    const beforeFlip=await page.locator('#large').evaluate(cv=>cv.toDataURL());
    await page.locator('#flip').check();
    const afterFlip=await page.locator('#large').evaluate(cv=>cv.toDataURL());
    assert.notEqual(beforeFlip,afterFlip,'Facing toggle must mirror the actual drawn frame');
    await page.locator('#flip').uncheck();
    await page.screenshot({path:path.join(out,'animation-preview.png'),fullPage:true});
    await page.locator('#actor').selectOption('boss2');await page.locator('#action').selectOption('phase');
    const emptyThumbnails=await page.locator('.actor canvas').evaluateAll(canvases=>canvases.filter(cv=>{
      const pixels=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
      return !pixels.some((value,index)=>index%4===3 && value>0);
    }).length);
    assert.equal(emptyThumbnails,0,'Unsupported actions must use a valid thumbnail fallback');
    await page.screenshot({path:path.join(out,'boss-phase-frames.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    const fallback=await browser.newPage();const fallbackErrors=[];fallback.on('pageerror',e=>fallbackErrors.push(e.message));
    await fallback.route('**/assets/art/animations/*.png',r=>r.abort());
    await fallback.goto(base+'/?autostart=1');
    const missing=await fallback.evaluate(async()=>{await ZERO_ANIMATION.ready;await ZERO_RENDER.artReady;__draw();return G.visualPlayback.sample(G.player).sprite===null && ZERO_RENDER.makeSprite('vanguard')!==null});
    assert(missing);assert.deepEqual(fallbackErrors,[]);
    console.log('PASS: 13 PNGs / 546 transparent registered frames / 91 distinct action sequences; real movement visits all six frames; melee/dash/hurt events; death process before end overlay; preview scrub/flip controls; missing-animation fallback; zero browser errors.');
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
