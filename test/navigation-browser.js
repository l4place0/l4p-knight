'use strict';
const fixture=document.getElementById('fixture'),status=document.getElementById('status'),N=ZERO_NAV_TEST;
let w,s,paused=false,last,acc=0,ready=false;
function draw() {
  const canvas=w.document.getElementById('game'),ctx=canvas.getContext('2d');
  s.G.render(ctx,null);w.ZERO_HUD.update(1/60);
  status.textContent=(s.outcome==='entered'||s.outcome==='clear'?'PASS · ':s.outcome?'FAIL · ':'运行中 · ')+
    (s.kind==='portal'?'004 传送门':'005 z4b / prototype / seed '+s.seed)+'\n'+
    JSON.stringify(N.result(s))+'\n'+(paused?'已暂停':s.outcome?'验收结束，场景已停住':'每步使用真实移动、开火和 E 交互');
}
function start(kind) {
  if(!ready)return;
  const env={GAME:w.ZERO_GAME,BOT:w.ZERO_BOT};s=kind==='portal'?N.portal(env):N.z4b(env,kind==='charger'?52:46);
  s.seed=kind==='charger'?52:46;
  w.ZERO_UI.onRunStart();w.ZERO_RENDER.attach(s.G);w.ZERO_HUD.init(w.ZERO_UI.els,s.G);
  paused=false;acc=0;last=performance.now();draw();
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt=Math.min(0.1,(now-last)/1000);last=now;
  if(!s||paused||s.outcome)return;
  acc+=dt;let frames=0;
  while(acc>=1/60&&frames++<6&&!s.outcome){N.step(s);acc-=1/60;}
  draw();
}
fixture.onload=async()=>{
  w=fixture.contentWindow;w.requestAnimationFrame=()=>0;
  await Promise.all([w.ZERO_RENDER.artReady,w.ZERO_ANIMATION.ready,new Promise(r=>setTimeout(r,60))]);
  ready=true;for(const id of ['portal','z4b','charger','pause'])document.getElementById(id).disabled=false;
  status.textContent='选择一个 issue 运行实时验收。';last=performance.now();requestAnimationFrame(frame);
};
fixture.src='../?autostart=1&difficulty=standard';
document.getElementById('portal').onclick=()=>start('portal');
document.getElementById('z4b').onclick=()=>start('room');
document.getElementById('charger').onclick=()=>start('charger');
document.getElementById('pause').onclick=()=>{paused=!paused;if(s)draw();};
