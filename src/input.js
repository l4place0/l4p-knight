/* ============================================================
 * 零号协议 ZERO PROTOCOL —— input.js
 * 输入层：键盘 / 鼠标 / 手柄（Gamepad 标准映射） / 触控（虚拟摇杆+自动瞄准）
 * 跨模块依赖一律经 init(deps) 显式注入，不读其他新模块内部
 * ============================================================ */
(function () {
'use strict';
const C = window.ZERO_CORE, AUDIO = window.ZERO_AUDIO;

/* ---------- 内部状态 ---------- */
const keys = {};
const mouse = { x: C.VIEW_W / 2, y: C.VIEW_H / 2, cx: 0, cy: 0 };
const clamp1 = (v) => Math.max(-1, Math.min(1, v)); // 叠加输入后的钳位
let mouseFire = false;       // 左键按住中(手柄 RT 松开时据此判断开火权归属)
let touchOn = false;         // 触屏设备:触控件启用后常驻(init 时按 coarse 指针判定)
let touchAimA = null;        // 上次自动瞄准角(无敌且静止时保持)
const stick = { pid: null, lastPid: -1, cx: 0, cy: 0, r: 1, jx: 0, jy: 0 };
const touchState = { fire: false };
const padPrev = {};          // 手柄上一帧按键状态(按下沿检测,防连发)
let padSeen = false;         // 「手柄已接入」只提示一次,断开后重连再提示
let G = null, canvas = null, touchUI = null, deps = null;

/* init(deps) 依赖注入面：
 *   G            游戏实例（写 G.input / 读 G.state / G.toast）
 *   canvas       画布（指针事件与坐标换算）
 *   getBotOn()   bot 是否接管（接管时键鼠/手柄/触控全部让位）
 *   toggleBotOn() B 键切换 bot，返回切换后的开关值
 *   togglePause() P / Escape / 手柄 Start / 触控暂停钮共用
 *   startRun(withBot, dailyRun)  Enter 开局 / 结算重开
 *   getRunDaily() 结算重开时沿用本局是否每日挑战 */
function init(d) {
  deps = d;
  G = d.G;
  canvas = d.canvas;
  touchOn = matchMedia('(pointer: coarse)').matches; // 触屏设备:触控件启用后常驻
  touchUI = document.getElementById('touchUI');

  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (keys[e.code]) return;
    keys[e.code] = true;
    AUDIO.init(); AUDIO.resume();
    switch (e.code) {
      case 'ShiftLeft': case 'ShiftRight': case 'Space': G.input.dash = true; break;
      case 'KeyF': G.input.melee = true; break;
      case 'KeyE': G.input.interact = true; break;
      case 'Digit1': G.input.slot = 0; break;
      case 'Digit2': G.input.slot = 1; break;
      case 'KeyQ': G.input.slot = G.weaponSlot === 0 ? 1 : 0; break;
      case 'KeyB': {
        const on = deps.toggleBotOn();
        G.toast && G.toast(on ? 'AI 代打：已接入' : 'AI 代打：已断开', on ? '#45f0e2' : '#8b8b98');
        break;
      }
      case 'KeyM': {
        const m = AUDIO.toggleMute();
        G.toast && G.toast(m ? '声音：关' : '声音：开', '#8b8b98');
        break;
      }
      case 'KeyP': case 'Escape': deps.togglePause(); break;
      case 'Enter':
        if (G.state === 'title') deps.startRun(false);
        else if (G.state === 'victory' || G.state === 'defeat') deps.startRun(deps.getBotOn(), deps.getRunDaily());
        break;
    }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('pointermove', (e) => { mouse.cx = e.clientX; mouse.cy = e.clientY; });
  canvas.addEventListener('pointerdown', (e) => {
    AUDIO.init(); AUDIO.resume();
    if (e.button === 0) { G.input.fire = true; mouseFire = true; }
    if (e.button === 2) G.input.dash = true;
  });
  window.addEventListener('pointerup', (e) => {
    // 摇杆的触摸释放不算开火输入(pointerType 保险:鼠标释放永不吞掉)
    if (e.pointerType !== 'mouse' && e.pointerId === stick.lastPid) return;
    if (e.button === 0) { G.input.fire = false; mouseFire = false; }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    G.input.fire = false;
    mouseFire = false;
    stick.pid = null; stick.jx = 0; stick.jy = 0; touchState.fire = false; // 触控保持态一并复位
    for (const k in padPrev) padPrev[k] = false;
  });

  /* ---------- 触控(移动端:coarse 指针或首次触摸启用;控件各自捕获指针,容器不拦截) ---------- */
  if (touchUI) {
    window.addEventListener('touchstart', () => { touchOn = true; }, { passive: true }); // 非 coarse 环境首次触摸也启用
    touchUI.addEventListener('contextmenu', (e) => e.preventDefault());
    const base = document.getElementById('stickBase'), knob = document.getElementById('stickKnob');
    function stickTrack(e) {
      const dx = e.clientX - stick.cx, dy = e.clientY - stick.cy;
      const d = Math.hypot(dx, dy) || 0.001;
      if (d >= 8) { // 死区 8px,死区外按 (d-8)/(r-8) 归一化
        const mag = Math.min(1, (d - 8) / Math.max(1, stick.r - 8));
        stick.jx = dx / d * mag; stick.jy = dy / d * mag;
      } else { stick.jx = 0; stick.jy = 0; }
      const c = Math.min(1, stick.r / d); // 手柄头视觉位置钳在底座内
      knob.style.transform = 'translate(-50%,-50%) translate(' + (dx * c).toFixed(1) + 'px,' + (dy * c).toFixed(1) + 'px)';
    }
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (stick.pid !== null || deps.getBotOn()) return;
      AUDIO.init(); AUDIO.resume();
      stick.pid = e.pointerId; stick.lastPid = -1;
      const r = base.getBoundingClientRect();
      stick.cx = r.left + r.width / 2; stick.cy = r.top + r.height / 2; stick.r = Math.max(1, r.width / 2);
      try { base.setPointerCapture(e.pointerId); } catch (err) {}
      stickTrack(e);
    });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === stick.pid) stickTrack(e); });
    const stickEnd = (e) => {
      if (e.pointerId !== stick.pid) return;
      stick.pid = null; stick.lastPid = e.pointerId; stick.jx = 0; stick.jy = 0;
      knob.style.transform = 'translate(-50%,-50%)';
    };
    base.addEventListener('pointerup', stickEnd);
    base.addEventListener('pointercancel', stickEnd);
    // 射击钮(hold,瞄准走 touchAutoAim)
    const btnFire = document.getElementById('btnFire');
    btnFire.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (deps.getBotOn()) return;
      AUDIO.init(); AUDIO.resume();
      touchState.fire = true;
      btnFire.classList.add('press');
      try { btnFire.setPointerCapture(e.pointerId); } catch (err) {}
    });
    const fireEnd = () => {
      touchState.fire = false;
      btnFire.classList.remove('press');
      if (!mouseFire) G.input.fire = false; // 鼠标按住时开火权交还鼠标
    };
    btnFire.addEventListener('pointerup', fireEnd);
    btnFire.addEventListener('pointercancel', fireEnd);
    // 脉冲钮:按下沿直接置位(与键盘 keydown 同路径,当帧被 game 消费)
    const pulse = (id, fn) => {
      const b = document.getElementById(id);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (deps.getBotOn()) return;
        AUDIO.init(); AUDIO.resume();
        b.classList.add('press');
        fn();
      });
      const off = () => b.classList.remove('press');
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
    };
    pulse('btnDash', () => { G.input.dash = true; });
    pulse('btnMelee', () => { G.input.melee = true; });
    pulse('btnInteract', () => { G.input.interact = true; });
    pulse('btnPause', deps.togglePause);
  }
}

/* ---------- 键鼠读入(每帧第一步) ---------- */
function readMove() {
  let x = 0, y = 0;
  if (keys['KeyA'] || keys['ArrowLeft']) x -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) x += 1;
  if (keys['KeyW'] || keys['ArrowUp']) y -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) y += 1;
  if (deps.getBotOn()) return; // bot 接管时不动 moveX/Y（由 bot 写入）
  G.input.moveX = x; G.input.moveY = y;
  // 鼠标世界坐标
  const rect = canvas.getBoundingClientRect();
  if (rect.width > 0) {
    mouse.x = (mouse.cx - rect.left) / rect.width * C.VIEW_W;
    mouse.y = (mouse.cy - rect.top) / rect.height * C.VIEW_H;
  }
  G.input.mx = mouse.x; G.input.my = mouse.y;
  if (G.input.aimA != null) G.input.aimA = null;
}

/* ---------- 手柄(Gamepad API 标准映射) ---------- */
function padActive() {
  const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
  for (const p of pads) if (p && p.connected) return p;
  return null;
}
function pollPad() {
  if (deps.getBotOn()) { for (const k in padPrev) padPrev[k] = false; return; } // bot 接管时与键鼠一样让位
  const gp = padActive();
  if (gp && !padSeen) { padSeen = true; G.toast && G.toast('手柄已接入', '#45f0e2'); }
  if (!gp) {
    if (padSeen && padPrev[7] && !mouseFire) G.input.fire = false; // 拔线时结算按住的 RT
    padSeen = false;
    for (const k in padPrev) padPrev[k] = false;
    return;
  }
  const dz = (v) => (Math.abs(v) > 0.25 ? v : 0); // 摇杆死区
  // 左摇杆移动:与键盘叠加后钳位(摇杆归中时增量为 0,键鼠路径逐位不变)
  G.input.moveX = clamp1(G.input.moveX + dz(gp.axes[0] || 0));
  G.input.moveY = clamp1(G.input.moveY + dz(gp.axes[1] || 0));
  // 右摇杆瞄准:推动时写 aimA 覆盖鼠标瞄准(readMove 已复位为 null,两者不打架)
  const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
  if (rx || ry) G.input.aimA = Math.atan2(ry, rx);
  // 按键:RT 射击(hold) LT 冲刺 X 相位刃 B 互动 LB/RB 切枪 Start 暂停;除 RT 外均按下沿触发
  const b = gp.buttons;
  const held = (i) => !!(b[i] && (b[i].pressed || b[i].value > 0.5));
  if (held(7) && !padPrev[7]) G.input.fire = true;
  if (!held(7) && padPrev[7] && !mouseFire && !touchState.fire) G.input.fire = false;
  if (held(6) && !padPrev[6]) G.input.dash = true;
  if (held(2) && !padPrev[2]) G.input.melee = true;
  if (held(1) && !padPrev[1]) G.input.interact = true;
  if ((held(4) && !padPrev[4]) || (held(5) && !padPrev[5])) G.input.slot = G.weaponSlot === 0 ? 1 : 0;
  if (held(9) && !padPrev[9]) deps.togglePause();
  for (const i of [1, 2, 4, 5, 6, 7, 9]) padPrev[i] = held(i);
}

/* ---------- 触控(虚拟摇杆 + 自动瞄准) ---------- */
function touchAutoAim() { // 500px 内最近存活敌人;无敌时沿移动方向;null = 保持上次角度
  const P = G.player;
  let best = null, bd = 500 * 500;
  for (const e of G.enemies) {
    if (e.dead || e.spawning > 0) continue;
    const dx = e.x - P.x, dy = e.y - P.y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = e; }
  }
  if (best) return Math.atan2(best.y - P.y, best.x - P.x);
  if (G.input.moveX || G.input.moveY) return Math.atan2(G.input.moveY, G.input.moveX);
  return null;
}
function applyTouch() {
  if (!touchUI || !touchOn || deps.getBotOn()) return;
  G.input.moveX = clamp1(G.input.moveX + stick.jx); // 摇杆与键盘叠加后钳位
  G.input.moveY = clamp1(G.input.moveY + stick.jy);
  if (touchState.fire) G.input.fire = true;
  const a = touchAutoAim();
  if (a != null) touchAimA = a;
  if (touchAimA != null) G.input.aimA = touchAimA; // 与手柄右摇杆同一通道
}

/* ---------- 每帧驱动入口（顺序即写入优先级：键鼠 → 触控 → 手柄） ---------- */
function update() {
  readMove();
  applyTouch(); // 触控:摇杆/射击/自动瞄准
  pollPad();    // 手柄:最后写入,右摇杆手动瞄准优先于触控自动瞄准(bot 接管时两者都让位)
}

/* 触控层显隐:对局中常驻(暂停时也显示,供触屏恢复);标题/结算不显示 */
function updateTouchUI() {
  if (touchUI) touchUI.classList.toggle('show', touchOn &&
    (G.state === 'playing' || G.state === 'paused' || G.state === 'chip' || G.state === 'shop'));
}

/* 鼠标世界坐标对象（G.render 准星用;同一引用逐帧原地更新） */
function getMouse() { return mouse; }

window.ZERO_INPUT = { init, update, updateTouchUI, getMouse };
})();
