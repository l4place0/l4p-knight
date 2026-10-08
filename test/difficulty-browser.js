'use strict';
const assert=require('node:assert/strict');
require('node:fs').mkdirSync('test/art-preview',{recursive:true});
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base='http://127.0.0.1:8941';await page.goto(base);
  assert.equal(await page.locator('#difficultySelect').inputValue(),'standard');
  assert.equal(await page.locator('#difficultySelect option').count(),3);
  await page.locator('#difficultySelect').selectOption('casual');await page.reload();
  assert.equal(await page.locator('#difficultySelect').inputValue(),'casual');
  await page.locator('#btnStart').click();assert.equal(await page.evaluate(()=>G.difficultyId),'casual');
  await page.waitForFunction(()=>document.getElementById('zoneLabel').textContent.includes('休闲'));
  await page.evaluate(()=>{G.startRun('vanguard',null,'casual');G.endScreen={victory:false,stats:G.endStats()};G.state='defeat';G.visualPlayback=null;__draw();});
  await page.locator('#btnRetry').click();assert.equal(await page.evaluate(()=>G.difficultyId),'casual');
  await page.goto(base+'/?autostart=1&difficulty=challenge');assert.equal(await page.evaluate(()=>G.difficultyId),'challenge');
  await page.evaluate(()=>ZERO_STORAGE.setMeta({difficulty:'constructor'}));
  await page.goto(base+'/?autostart=1&difficulty=constructor');assert.equal(await page.evaluate(()=>G.difficultyId),'standard');
  // Local daily rankings must not mix runs with different difficulty.
  const separated=await page.evaluate(()=>{
    for(const [id,score]of [['casual',1000],['challenge',20]]){G.difficultyId=id;ZERO_STORAGE.recordDaily({stats:{score,time:100,kills:10,rating:'B'}},G);}
    return [ZERO_STORAGE.dailyBest('casual').score,ZERO_STORAGE.dailyBest('challenge').score];
  });assert.deepEqual(separated,[1000,20]);
  await page.goto(base+'/?difficulty=standard');await page.locator('#difficultySelect').selectOption('standard');
  await page.screenshot({path:'test/art-preview/difficulty-title.png'});
  assert.deepEqual(errors,[]);console.log('PASS: three UI choices, standard default, persisted selection, actual start/retry/HUD, URL replay, separate daily rankings, zero browser errors.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
