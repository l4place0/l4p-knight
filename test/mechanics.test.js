'use strict';
const assert = require('node:assert/strict');
const { loadMechanics } = require('./load-mechanics.js');
const { spatialViolations } = require('./invariants.js');
const DT = 1/60;
const plain = x => JSON.parse(JSON.stringify(x));
function runMechanics(env = loadMechanics(), only) {
  const { CORE:C, GAME, BOT, context } = env;
  function fixture(hero='vanguard') {
    const G=GAME.createGame({seed:5,headless:true}); G.startRun(hero); G.debugClear();
    G.waves=[]; G.wavIdx=99; G.pendSpawns=[]; G.chipOffered=true;
    G.player.x=240; G.player.y=208; G.player.iframes=0;
    return G;
  }
  function step(G,n=1) { for(let i=0;i<n;i++) G.update(DT); }
  function target(G,x=300,y=208,type='gunner') {
    const e=G.debugSpawn(type,x,y); e.hp=e.maxHp=1000; e.cd=1000; e.contact=0;
    // 只冻结靶子的 AI，保留真实武器/碰撞/伤害管线。
    context(G).updateEnemy=()=>{}; return e;
  }
  const cases = {
    data() {
      for(const [id,m] of Object.entries(C.MAPS)) {
        assert.equal(m.length,17,id+' 地图高'); assert.ok(m.every(row=>row.length===30),id+' 地图宽');
        assert.ok(/^#+$/.test(m[0])&&/^#+$/.test(m.at(-1))&&m.every(row=>row[0]==='#'&&row.at(-1)==='#'),id+' 闭合边界');
      }
      for(const key of '0123456789!+-.') assert.match(C.FONT35[key],/^[01]{15}$/,key+' 字体完整');
      for(const [id,s] of Object.entries(C.SPRITES)) {
        // 渲染器支持不等宽透明边缘（boss 原图为 33/34 列），只约束实际可渲染内容。
        assert.ok(s.art.length>0&&s.art.every(row=>row.length>0&&row.length<=Math.max(...s.art.map(r=>r.length))),id+' 精灵非空');
        assert.ok(s.art.every(row=>[...row].every(k=>k==='.'||k in s.pal)),id+' 调色板');
      }
      for(const z of C.ZONES) {
        for(const id of z.maps) assert.ok(C.MAPS[id],id+' 地图引用');
        for(const [id,w]of Object.entries(z.weights)) assert.ok(C.ENEMY_DEFS[id]&&w>0&&Number.isFinite(w),'刷怪权重');
        if(z.bossId) assert.ok(C.ENEMY_DEFS[z.bossId].isBoss);
      }
      for(const h of Object.values(C.HEROES)) assert.ok(C.WEAPONS[h.weapon]&&h.maxHp>0&&h.shieldMax>=0);
      const attacks=new Set(['ring','fan','fanlaser','mines','spiral','clones','gravity','blinkstorm']);
      for(const id of ['boss','boss2']) for(const phase of [1,2,3]) {
        assert.ok(C.ENEMY_DEFS[id].pools[phase].length>0);
        assert.ok(C.ENEMY_DEFS[id].pools[phase].every(a=>attacks.has(a)));
      }
      assert.equal(require('../js/core.js'),globalThis.ZERO_CORE,'CommonJS/全局导出同一数据');
      assert.deepEqual(plain(C),plain(require('../js/core.js')),'浏览器加载/Node 数据契约');
    },
    heroes() {
      for(const id of Object.keys(C.HEROES)) {
        const G=fixture(id),h=C.HEROES[id];
        assert.equal(G.player.hp,h.maxHp,id+' 满生命开局'); assert.equal(G.player.shield,h.shieldMax,id+' 满护盾开局');
        assert.equal(G.weapons[0].id,h.weapon); assert.equal(G.stats.speed,h.speed);
      }
      const G=GAME.createGame({seed:7,headless:true});
      G.startRun('bulwark',{date:'test',mods:[C.DAILY_MODIFIERS[4]]});
      assert.equal(G.player.hp,6,'玻璃开局扣上限后仍满血'); assert.equal(G.player.shield,4);
    },
    cadence() {
      for(const id of ['smg','shotgun','railgun','homing','grenade','blade']) {
        const G=fixture(); G.weapons[0]=C.WEAPONS[id]; G.computeStats();
        const events=[],ctx=context(G),spawn=ctx.spawnBullet;
        ctx.spawnBullet=(...args)=>{ if(args[5]) events.push(G.runTime); return spawn(...args); };
        G.sfx=k=>{if(k==='rail'||k==='slash')events.push(G.runTime);};
        G.input.fire=true; G.input.aimA=0; step(G,600);
        assert.ok(G.bullets.filter(b=>b.friendly).every(b=>b.kind===(C.WEAPONS[id].kind||null)),id+' 武器弹种落地');
        const shots = id==='shotgun' ? events.filter((t,i)=>!i||t!==events[i-1]) : events;
        assert.ok(shots.length>=2,id+' 实际开火');
        const minGap=C.WEAPONS[id].interval/G.stats.rate;
        for(let i=1;i<shots.length;i++) assert.ok(shots[i]-shots[i-1]>=minGap-DT-1e-6,id+' 冷却被绕过');
        assert.ok(shots[0]<=0.35,id+' 首次攻击没有多余冷却');
      }
      const G=fixture('prototype'); G.input.fire=true; step(G,10); assert.ok(G.player.chargeT>0);
      G.input.fire=false; step(G); assert.equal(G.player.chargeT,0,'松开取消蓄力');
      G.input.slot=1; step(G); assert.equal(G.weaponSlot,1,'换枪生效'); assert.equal(G.player.chargeT,0);
      const fast=fixture('prototype'); fast.chips=['overclock']; fast.computeStats();
      fast.input.fire=true; const times=[]; fast.sfx=k=>{if(k==='rail')times.push(fast.runTime);}; step(fast,600);
      assert.ok(times.length>7,'射速晶片实际缩短电磁炮冷却');
    },
    damage() {
      const hazards={
        bullet:G=>context(G).spawnBullet(G.player.x,G.player.y,0,0,4,false),
        explosion:G=>context(G).explode(G.player.x,G.player.y,36,4,false),
        mine:G=>G.mines.push({x:G.player.x,y:G.player.y,r:36,dmg:4,t:0,fuse:0}),
        well:G=>G.wells.push({x:G.player.x,y:G.player.y,r:92,dmg:4,t:0,fuse:0,pull:820}),
        laser:G=>{G.bossLaser={x0:200,y0:208,a0:0,a1:0,count:3,spread:0,t:0,charge:0,active:1,dmg:4};},
        contact:G=>{const e=target(G,G.player.x+1,G.player.y,'charger');e.contact=4;},
      };
      for(const [name,hit] of Object.entries(hazards)) {
        const G=fixture(); hit(G); step(G);
        assert.equal(G.player.shield,0,name+' 护盾吸收'); assert.equal(G.player.hp,5,name+' 溢出生命伤害');
        assert.equal(G.damageTaken,1,name+' 受击计数'); assert.ok(G.player.iframes>0,name+' 无敌帧');
        const immune=fixture(); immune.player.iframes=2; hit(immune); step(immune);
        assert.equal(immune.player.hp+immune.player.shield,9,name+' 无敌帧拦截重复伤害');
      }
      const G=fixture(); context(G).damagePlayer(20,240,208);
      assert.equal(G.state,'defeat'); assert.equal(G.player.hp,0); assert.equal(G.endScreen.victory,false);
      const undying=fixture();undying.acquireChip('nano');undying.acquireChip('capacitor');
      undying.player.hp=2;undying.player.shield=4;context(undying).damagePlayer(3,240,208);
      assert.equal(undying.player.hp,2,'护盾能吸收时不能误触发不灭战意');assert.equal(undying.player.undyingUsed,false);
      undying.player.iframes=0;context(undying).damagePlayer(4,240,208);
      assert.equal(undying.player.hp,1,'真正致命伤保留生命');assert.equal(undying.player.undyingUsed,true);assert.equal(undying.player.shield,4);
    },
    movement() {
      const G=fixture(); G.input.moveX=1;
      const pushed=fixture();pushed.player.kx=60;step(pushed);assert.ok(pushed.player.x>240,'击退必须沿外力方向位移');
      const ray=G.raycastWall(17.1,208,Math.PI,50);
      assert.ok(ray.x>=16&&ray.x<17.1&&ray.len<2,'近墙射线必须停在墙面外侧');
      const before={x:21.1,y:208,r:5};
      assert.equal(context(G).moveAxis(before,'x',-4),true,'碰墙移动必须拒绝');
      assert.equal(before.x,21.1,'碰撞不能在解析之前先写入墙内位置');
      for(let i=0;i<300;i++) {step(G);assert.deepEqual(spatialViolations(G),[],'玩家走路碰墙');}
      const x=G.player.x; G.input.dash=true; step(G,25);
      assert.deepEqual(spatialViolations(G),[],'玩家冲刺碰墙'); assert.ok(G.player.x<=x+6);
      G.player.x=8;G.player.y=8;G.solidAtPx=()=>false;
      assert.ok(spatialViolations(G).includes('wallClip:player'),'独立探针必须检出玩家嵌墙');
      G.player.x=NaN;assert.ok(spatialViolations(G).includes('nan:player'));
      G.player.x=-10;assert.ok(spatialViolations(G).includes('bounds:player'));
      const pull=fixture();pull.wells.push({x:270,y:208,t:0,fuse:3,r:92,pull:820,dmg:4});step(pull);
      assert.ok(pull.player.vx>0,'引力井实际拉扯');
    },
    weapons() {
      const rail=fixture('prototype'),one=target(rail,280),two=target(rail,320); rail.stats.crit=0;
      rail.input.fire=true;rail.input.aimA=0;step(rail,20);
      assert.equal(one.hp,970,'电磁炮真实伤害');assert.equal(two.hp,1000,'白板电磁炮只能命中一人');
      const pierce=fixture('prototype'),a=target(pierce,280),b=target(pierce,320);pierce.chips=['pierce'];pierce.computeStats();pierce.stats.crit=0;
      pierce.input.fire=true;pierce.input.aimA=0;step(pierce,20);assert.equal(a.hp,970);assert.equal(b.hp,970,'贯穿晶片击中后方');
      const home=fixture(),e=target(home,300,200),ctx=context(home);
      ctx.spawnBullet(240,208,0,250,6,true,{kind:'homing',life:3});const bullet=home.bullets.at(-1);step(home);
      assert.ok(bullet.vy<0,'导弹实际转向目标');step(home,50);assert.ok(e.hp<1000,'导弹实际命中');
      const grenade=fixture(),g1=target(grenade,270),g2=target(grenade,290);
      context(grenade).spawnBullet(270,208,0,0,3,true,{kind:'grenade',life:DT/2});step(grenade);
      assert.equal(g1.hp,982,'榴弹到期爆炸');assert.equal(g2.hp,982,'榴弹范围伤害');
      const blade=fixture(),guard=target(blade,260,208,'guard'); guard.broken=0;blade.stats.crit=0;
      blade.input.melee=true;blade.input.aimA=0;step(blade);
      assert.ok(guard.broken>0,'挥砍破盾');assert.equal(guard.hp,991,'挥砍独立造成真实伤害');
      const deflect=fixture();context(deflect).spawnBullet(255,208,Math.PI,0,2,false);const hostile=deflect.bullets.at(-1);
      deflect.input.melee=true;deflect.input.aimA=0;step(deflect);assert.equal(hostile.friendly,true,'弧区弹反');
      const blocked=fixture(),shield=target(blocked,270,208,'guard');shield.broken=0;shield.facing=Math.PI;
      context(blocked).spawnBullet(268,208,0,100,5,true);step(blocked);assert.equal(shield.hp,1000,'盾牌正面挡弹');
      assert.equal(blocked.bullets.length,0,'格挡必须消除子弹');
      const reuse=fixture(),victim=target(reuse,270),reuseCtx=context(reuse);
      reuseCtx.spawnBullet(270,208,0,0,3,true,{kind:'grenade',life:DT/2});step(reuse);assert.equal(victim.hp,982);
      reuse.hitstop=0;reuseCtx.spawnBullet(270,208,0,0,1,true,{life:DT/2});
      assert.equal(reuse.bullets[0].kind,null,'池复用必须清除上一发弹种');step(reuse);assert.equal(victim.hp,982,'普通弹到期不能继承爆炸');
    },
    shop() {
      for(const kind of ['heal','battery','weapon','power','chip']) {
        const G=fixture();G.state='shop';G.coins=20;G.player.hp=3;G.player.shield=0;
        G.shopItems=[{kind,price:10,weapon:'homing',chipId:'overcharge'}];G.shopBuy(0);
        assert.equal(G.coins,10,kind+' 扣金币');assert.equal(G.shopItems[0].sold,true);
        if(kind==='heal')assert.equal(G.player.hp,5);
        if(kind==='battery'){assert.equal(G.player.maxShield,4);assert.equal(G.player.shield,4);}
        if(kind==='weapon'){assert.equal(G.weapons[0].id,'homing');assert.equal(G.weaponSlot,0);}
        if(kind==='power')assert.equal(G.stats.dmg,1.08);
        if(kind==='chip'){assert.ok(G.chips.includes('overcharge'));assert.equal(G.stats.dmg,1.25);}
        G.shopBuy(0);assert.equal(G.coins,10,'不可重复购买');
        const poor=fixture();poor.state='shop';poor.shopItems=[{kind,price:10,weapon:'homing',chipId:'overcharge'}];poor.shopBuy(0);
        assert.equal(poor.coins,0);assert.ok(!poor.shopItems[0].sold,'买不起不可发货');
      }
      const G=fixture();G.state='shop';G.coins=10;G.shopItems=[{kind:'power',price:10}];
      const bot=BOT.createBot(5);for(let i=0;i<31;i++)bot.update(G,DT,G.input);
      assert.equal(G.stats.dmg,1.08,'bot 采购实际强化');
    },
    settlement() {
      const G=fixture();G.runTime=299;G.damageTaken=6;G.kills=17;G.score=321;G.maxCombo=8;
      G.acquireChip('overcharge');G.acquireChip('overcharge');G.acquireChip('overclock');
      const s=G.endStats();assert.equal(s.rating,'S');assert.equal(s.time,299);assert.equal(s.kills,17);assert.equal(s.score,321);
      assert.equal(s.maxCombo,8);assert.equal(s.damageTaken,6);assert.ok(s.chips.includes('过载弹头·Lv2'));assert.ok(s.syn.includes('无限火力协议'));
      G.runTime=300;assert.equal(G.endStats().rating,'A');G.runTime=420;assert.equal(G.endStats().rating,'B');
      G.runTime=200;G.damageTaken=7;assert.equal(G.endStats().rating,'A');G.damageTaken=13;assert.equal(G.endStats().rating,'B');
    },
    restart() {
      const G=fixture('prototype');G.debugJump(4,2);G.acquireChip('glass');G.acquireChip('glass');
      G.coins=99;G.bonusShield=3;G.powerBonus=2;G.runTime=100;G.damageTaken=9;G.kills=20;G.score=500;
      G.bossDown={2:true};G.daily={flag:{coinOnly:true}};G.endScreen={victory:true};G.shopItems=[{sold:true}];G.state='defeat';
      Object.assign(G.player,{fireT:5,chargeT:0.2,meleeCd:4,slashT:1,dashT:0.1,kx:100,undyingUsed:true});
      Object.assign(G.input,{fire:true,dash:true,melee:true,moveX:1,slot:1});G.deathLog='上一局';
      G.startRun('bulwark');
      assert.equal(G.state,'playing');assert.equal(G.mapId,'z1a');assert.equal(G.zoneIdx,0);assert.equal(G.roomIdx,0);
      assert.deepEqual(plain(G.chips),[]);assert.deepEqual(plain(G.chipLv),{});assert.deepEqual(plain(G.bossDown),{});
      for(const k of ['coins','bonusShield','powerBonus','runTime','damageTaken','kills','score'])assert.equal(G[k],0,k+' 跨局重置');
      for(const k of ['fireT','chargeT','meleeCd','slashT','dashT','kx'])assert.equal(G.player[k],0,k+' 跨局重置');
      assert.equal(G.player.hp,7);assert.equal(G.player.shield,4);assert.equal(G.player.undyingUsed,false);
      assert.equal(G.input.fire,false);assert.equal(G.input.slot,-1);assert.equal(G.daily,null);assert.equal(G.endScreen,null);assert.equal(G.shopItems,null);assert.equal(G.deathLog,'');
      G.debugJump(4,2);assert.equal(G.mapId,'z4b');assert.deepEqual(spatialViolations(G),[],'跳关地图/碰撞绑定');
    },
    bosses() {
      for(const id of ['boss','boss2'])for(const phase of [1,2,3]) {
        const G=fixture();G.loadBossRoom(id);const e=G.bossRef;
        e.phase=phase;e.st='idle';e.atkT=0;const seen=[],intervals=[];
        for(let i=0;i<3600&&seen.length<e.pools[phase].length*2;i++) {
          const old=e.atk;G.player.iframes=10;step(G);
          if(e.atk&&!old)seen.push(e.atk.kind);
          if(old&&!e.atk)intervals.push(e.atkT);
        }
        assert.ok(e.pools[phase].every(k=>seen.includes(k)),id+'/'+phase+' 完整攻击池实际调度');
        assert.ok(intervals.length>0&&intervals.every(t=>t>0&&t<1.2),id+'/'+phase+' 攻击欲望实际缩短间隔');
      }
      for(const id of ['boss','boss2']) for(const kind of ['ring','fan','fanlaser','mines','spiral',...(id==='boss2'?['clones','gravity','blinkstorm']:[])]) {
        const G=fixture();G.loadBossRoom(id);const ctx=context(G),e=G.bossRef,spawn=ctx.spawnBullet,shots=[];
        const update=ctx.updateEnemy;ctx.updateEnemy=(foe,dt)=>{if(foe.isBoss)update(foe,dt);};
        ctx.spawnBullet=(...args)=>{if(!args[5])shots.push({speed:args[3],dmg:args[4],angle:args[2]});return spawn(...args);};
        e.phase=3;e.st='idle';e.atkT=0;e.pools={3:[kind]};e.invuln=0;
        let started=false,laser=false,mines=0,wells=0,echo=0,blink=0,last={x:e.x,y:e.y};
        for(let i=0;i<180;i++) {
          G.player.iframes=10;step(G);
          if(e.atk)started=true;
          if(started&&!e.atk)e.atkT=100;
          mines=Math.max(mines,G.mines.length);wells=Math.max(wells,G.wells.length);
          echo=Math.max(echo,G.enemies.filter(x=>x.type==='echo').length);
          if(G.bossLaser&&G.bossLaser.phase==='fire') {laser=true;assert.ok(G.bossLaser.beams.length>=10,'激光束实际生成');}
          if(Math.hypot(e.x-last.x,e.y-last.y)>10)blink++;
          last={x:e.x,y:e.y};assert.deepEqual(spatialViolations(G),[],id+'/'+kind+' 空间约束');
        }
        assert.ok(started,id+'/'+kind+' 调度启动');
        if(['ring','fan','spiral','clones','gravity','blinkstorm'].includes(kind)) {
          const minimum={ring:80,fan:30,spiral:65,clones:8,gravity:35,blinkstorm:60}[kind];
          assert.ok(shots.length>=minimum,id+'/'+kind+' 必须产生足够弹幕（'+shots.length+'）');
          assert.ok(shots.every(b=>b.speed>=200&&b.dmg===(id==='boss'?4:6)),id+'/'+kind+' 弹速/伤害落地');
        }
        if(kind==='fanlaser')assert.ok(laser,'激光必须实际开火');
        if(kind==='mines')assert.ok(mines>=2,'地雷实际落场');
        if(kind==='gravity')assert.equal(wells,2,'两口引力井实际落场');
        if(kind==='clones')assert.equal(echo,3,'三只残影实际落场');
        if(kind==='blinkstorm')assert.equal(blink,2,'两次相位跃迁');
        assert.equal(e.atk,null,id+'/'+kind+' 攻击完成');
      }
    },
    enemyAI() {
      const sniper=fixture();const s=sniper.debugSpawn('sniper',300,208);s.cd=0;
      for(let i=0;i<600&&sniper.damageTaken===0;i++)step(sniper);
      assert.equal(sniper.damageTaken,1,'狙击 AI 真实瞄准并命中玩家');assert.equal(sniper.player.hp,1,'真实狙击溢出伤害');
      const charger=fixture(),e=charger.debugSpawn('charger',300,208);e.cd=0;
      let dashed=false;for(let i=0;i<120;i++){charger.player.iframes=10;step(charger);if(e.state==='dash')dashed=true;}
      assert.ok(dashed,'突击机兵实际冲锋');assert.deepEqual(spatialViolations(charger),[]);
      const wraith=fixture();wraith.debugJump(1,2);wraith.debugClear();wraith.waves=[];wraith.wavIdx=99;wraith.chipOffered=true;
      wraith.player.x=40;wraith.player.y=232;
      const w=wraith.debugSpawn('wraith',40,40);w.blinkCd=0;
      step(wraith);assert.ok(Math.hypot(w.x-40,w.y-40)>30,'徘徊者隔墙实际闪现');assert.deepEqual(spatialViolations(wraith),[]);
      const cold=fixture(),foe=cold.debugSpawn('guard',300,208);cold.stats.frost=1;
      context(cold).damageEnemy(foe,1,0,0,false);assert.ok(foe.slowT>0);
      cold.hitstop=0;const warm=fixture(),normal=warm.debugSpawn('guard',300,208);
      step(cold,10);step(warm,10);
      assert.ok(300-normal.x>5&&300-foe.x<(300-normal.x)*0.8,'冰霜必须实际减速');
    },
    batchGates() {
      const {qualified,summarize,buildScenarios}=require('./balance.js');
      const samples=Array.from({length:100},(_,i)=>({hero:'vanguard',outcome:i<36?'bossDown':'defeat',hpLost:1,dmgTaken:1,seconds:1}));
      assert.equal(qualified(summarize(samples)),true);
      assert.equal(qualified(summarize(samples.map((r,i)=>i===36?{...r,outcome:'bossDown'}:r))),false,'37% Boss 门必须拒绝');
      for(const outcome of ['timeout','stall','error','violation'])assert.equal(qualified(summarize(samples.map((r,i)=>i===99?{...r,outcome}:r))),false,'Boss '+outcome+' 不能算困难达标');
      const specs=buildScenarios('boss',100,10001);assert.equal(specs.length,100);assert.equal(specs[0].seed,10001);
      assert.ok(specs.every(s=>s.seed>=10001),'留出种子生效');
    },
  };
  for(const [name,test] of Object.entries(cases)) if(!only||only===name)test();
  return Object.keys(cases).length;
}
if(require.main===module)console.log('✓ '+runMechanics()+' 组机制契约通过');
module.exports={runMechanics};
