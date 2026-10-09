/* In-browser acceptance for issues 001–003. Real game/DOM/renderers, isolated
 * fixtures; not a full-run substitute. Open test/visual-issues.html via npm start. */
'use strict';
const frame = document.getElementById('fixture'), result = document.getElementById('result');
let w, checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(message); }
function lineContext() {
  const lines = []; let start;
  return { lines, beginPath() {}, moveTo(x,y) { start = {x,y}; },
    lineTo(x,y) { lines.push({start, end:{x,y}}); }, stroke() {}, fillRect() {}, drawImage() {} };
}
function overlaps(a,b) { return Math.min(a.right,b.right)-Math.max(a.left,b.left)>0.5 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>0.5; }
function prepare() {
  const G=w.G; w.ZERO_UI.onRunStart(); G.startRun('vanguard',null,'casual');
  G.debugJump(4,1); G.fade=0; G.banner=null; G.shake=0; G.toasts=[];
  G.player.iframes=0; G.player.vx=G.player.vy=0;
  return G;
}
function scene(id) {
  const G=prepare();
  if (id==='visibility') { G.player.x=432; G.player.y=80; }
  if (id==='sniper') {
    G.enemies=[]; G.player.x=344; G.player.y=136;
    const e=G.debugSpawn('sniper',120,136); e.spawning=0;
    G.lasers=[{x0:120,y0:136,x1:344,y1:136,phase:'lock'}];
  }
  if (id==='boss') {
    G.loadBossRoom('boss2'); G.fade=0; G.banner=null; G.shake=0; G.player.iframes=0;
    G.player.x=344; G.player.y=136;
    G.bossRef.x=120; G.bossRef.y=136; G.bossRef.spawning=0;
    G.bossLaser={phase:'charge',x0:120,y0:136,a0:0,a1:0,t:0.9,charge:1,count:5,spread:0.8};
  }
  if (id==='doors'||id==='open') {
    G.startRun('vanguard',null,'casual'); G.enterRoom(1); G.fade=0; G.banner=null; G.shake=0; G.toasts=[];
    G.player.iframes=0;
    // Three doors in this room; the mirrored branch covers the fourth orientation.
    G.doorsLocked=id==='doors';
  }
  w.__draw();
}
async function run() {
  document.getElementById('run').disabled=true; checks=0; result.textContent='运行中…';
  try {
    await new Promise(resolve=>{frame.onload=resolve;frame.src='../?autostart=1&difficulty=casual';});
    w=frame.contentWindow;
    // Let the single already-scheduled frame finish, then keep fixtures stable.
    w.requestAnimationFrame=()=>0;
    await Promise.all([w.ZERO_RENDER.artReady,w.ZERO_ANIMATION.ready,new Promise(r=>setTimeout(r,60))]);
    const G=prepare(), R=w.ZERO_RENDER;
    // Actual DOM geometry, including a long chip list and a live boss bar.
    for(const [width,height] of [[1642,864],[1200,1000],[409,612],[844,390]]) {
      frame.style.width=width+'px';frame.style.height=height+'px';
      w.dispatchEvent(new w.Event('resize'));
      G.chips=w.ZERO_CORE.CHIPS.map(c=>c.id);G.loadBossRoom('boss2');G.fade=0;G.banner=null;
      G.prompt='按 E 前往 · 战斗 2';w.__draw();
      const canvas=w.document.getElementById('game').getBoundingClientRect();
      for(const id of ['hudTL','hudTC','hudTR','hudBL','toasts','bossBar','prompt','objective']) {
        const el=w.document.getElementById(id), box=el.getBoundingClientRect();
        if(w.getComputedStyle(el).display!=='none')check(!overlaps(box,canvas),width+'×'+height+' '+id+' 覆盖战场');
      }
      G.isBossRoom=false;w.__draw();
      check(!overlaps(w.document.getElementById('floorMap').getBoundingClientRect(),canvas),'小地图覆盖战场');
      const stage=w.document.getElementById('stage').getBoundingClientRect();
      check(stage.left>=0&&stage.right<=width+0.5&&stage.top>=0&&stage.bottom<=height+0.5,'窗口裁切');
      check(Math.abs(canvas.width/canvas.height-480/272)<0.01,'战场比例错误');
      check(w.document.getElementById('hudBL').scrollHeight>w.document.getElementById('hudBL').clientHeight,'长晶片列表应可滚动');
    }
    const Q=prepare();
    // Warning endpoints must stop before the first real wall, in both phases.
    for(const phase of ['charge','lock'])for(const l of [
      {x0:120,y0:136,x1:344,y1:136}, {x0:352,y0:136,x1:112,y1:136},
      {x0:104,y0:104,x1:104,y1:20}, {x0:104,y0:24,x1:104,y1:120},
      {x0:120,y0:136,x1:280,y1:56}, {x0:80,y0:24,x1:400,y1:24},
    ]) {
      Q.lasers=[{...l,phase}];const before=JSON.stringify(Q.lasers),ctx=lineContext();
      R.drawLasers(ctx,Q,1);
      check(ctx.lines.length===1,'狙击预警应只有一条射线');
      const end=ctx.lines[0].end;
      const fire=Q.raycastWall(l.x0,l.y0,Math.atan2(l.y1-l.y0,l.x1-l.x0),500);
      check(Math.hypot(end.x-fire.x,end.y-fire.y)<0.001,'预警与实际攻击终点不同');
      check(Q.losClear(l.x0,l.y0,end.x,end.y),'预警穿过掩体');
      check(before===JSON.stringify(Q.lasers),'渲染改变了瞄准/锁定目标');
      if(l.x0===120&&l.y1===136)check(end.x<176&&end.x>168,'预警没有停在第一面竖墙前');
      if(l.y0===24&&l.x0===80)check(end.x>400&&end.x<464,'开阔地未画出实际射程');
    }
    const L={phase:'charge',x0:120,y0:136,a0:-0.2,a1:0.2,t:0.5,charge:1,count:5,spread:0.6};
    const ctx=lineContext(), before=JSON.stringify(L);R.drawBossLaser(ctx,Q,L,1);
    check(ctx.lines.length===5,'首领扇形射线数量');
    for(const line of ctx.lines)check(line.end.x<176&&Q.losClear(120,136,line.end.x,line.end.y),'首领预告穿过第一面墙 '+JSON.stringify({map:Q.mapId,end:line.end}));
    check(before===JSON.stringify(L),'渲染改变了首领攻击');
    const fire=lineContext();R.drawBossLaser(fire,Q,{phase:'fire',beams:[{x0:120,y0:136,x1:173,y1:136}]},1);
    check(fire.lines.length===2&&fire.lines.every(l=>l.end.x===173&&l.end.y===136),'发射阶段没有使用实际伤害射线');
    // All reachable rooms/maps/mirrors: façade in a wall, approach on floor.
    const directions=new Set();let rooms=0;
    for(let seed=1;seed<=20;seed++) {
      const T=w.ZERO_GAME.createGame({seed,headless:true});T.startRun();
      for(let z=0;z<w.ZERO_CORE.ZONES.length;z++)for(let level=0;level<w.ZERO_CORE.ZONES[z].maps.length;level++) {
        T.zoneIdx=z;T.roomIdx=level;T.loadRoom();
        for(const room of T.floor.rooms) {
          T.enterRoom(room.id);rooms++;
          for(const door of T.doors) {
            const geom=R.doorGeometry(T,door);directions.add(Math.atan2(door.dy,door.dx));
            check(T.solidAtPx(geom.wallX,geom.wallY)===1,'门洞未贴墙');
            check(T.losClear(door.x,door.y,door.x+Math.cos(geom.angle)*geom.length,door.y+Math.sin(geom.angle)*geom.length),'门通道穿墙');
            check(T.spawnSpots.some(p=>p.x===door.x&&p.y===door.y),'门交互点不可达');
          }
        }
      }
    }
    check(rooms===840&&directions.size===4,'地图/房间/四向门覆盖不完整');
    frame.style.width='1642px';frame.style.height='864px';w.dispatchEvent(new w.Event('resize'));
    scene('visibility');document.getElementById('scene').disabled=false;
    result.textContent='PASS · '+checks+' 项断言\n4 种窗口尺寸：HUD/小地图/血条/提示均不覆盖战场，窄屏不裁切\n狙击双阶段、不同方向、首领扇形预警均在墙前终止，目标状态不变\n140 层 / 840 房间 / 四方向门：贴墙、通道与交互点可达\n下方可查看真实渲染场景；完整实战通关另行观察。';
  } catch(e) {result.textContent='FAIL · '+e.message;console.error(e);}
  finally {document.getElementById('run').disabled=false;}
}
document.getElementById('run').addEventListener('click',run);
document.getElementById('scene').addEventListener('change',e=>scene(e.target.value));
