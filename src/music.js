/* ============================================================
 * 零号协议 ZERO PROTOCOL —— music.js
 * 两首步进音序器合成 BGM（探索 / Boss）：16 分音符步进、前瞻调度、
 * 低通滤波区分氛围（探索暗哑 / Boss 明亮高速），Boss 战自动切换。
 * 仅浏览器加载；不参与无头仿真，游戏逻辑零依赖（与渲染层同级，可随时删除）。
 * 输出挂到 ZERO_AUDIO 主总线（共享压缩器限幅与 M 键静音）。
 * ============================================================ */
(function (root) {
'use strict';

const AHEAD = 0.45;        // 前瞻调度时长（秒）
const TICK_MS = 90;        // 调度器轮询间隔
const STEPS = 64;          // 循环长度：4 小节 × 16 步
const f = (semi, base) => (base || 110) * Math.pow(2, semi / 12); // 半音 → 频率（基准 A2）

/* 音序数据：null = 休止；音高为相对当小节根音的半音数（roots 以 A2 为 0）
 * explore：Am-F-C-G 慢板（92 BPM，低通 950Hz）；boss：A 弗里几亚急板（148 BPM，低通 2800Hz） */
const TRACKS = {
  explore: {
    bpm: 92, cutoff: 950,
    roots: [0, -4, 3, -2],                       // Am F C G
    bass: [                                       // 三角波，松弛切分
      0, null, null, null, null, null, null, 0, 0, null, null, null, 0, null, 7, null,
      0, null, null, null, null, null, null, 0, 0, null, null, null, 0, null, 7, null,
      3, null, null, null, null, null, null, 3, 3, null, null, null, 3, null, 10, null,
      -2, null, null, null, null, null, null, -2, -2, null, null, null, -2, null, 5, null,
    ],
    arp: [12, 15, 19, 24],                       // 小三和弦分解（偶数步轮替）
    lead: null,                                   // 探索曲无主旋律
    hat: [2, 6, 10, 14],                          // 反拍噪声tick
    pad: true,                                    // 每小节根音+五度的长音铺底
  },
  boss: {
    bpm: 148, cutoff: 2800,
    roots: [0, 0, -4, -2],                       // A A F G
    bass: [                                       // 锯齿波 8 分推进（b9 色彩）
      0, null, 0, null, 0, null, 1, null, 0, null, 0, null, 3, null, 1, null,
      0, null, 0, null, 0, null, 1, null, 0, null, 3, null, 1, null, 0, null,
      -4, null, -4, null, -4, null, -3, null, -4, null, -4, null, -1, null, -3, null,
      -2, null, -2, null, -2, null, -1, null, -2, null, 0, null, 3, null, 5, null,
    ],
    arp: null,
    lead: [                                       // 方波刺音主题
      12, null, null, 15, null, null, 12, null, null, 17, null, 15, null, null, 12, null,
      12, null, null, 15, null, null, 12, null, null, 17, null, 19, null, 17, 15, null,
      8, null, null, 12, null, null, 8, null, null, 13, null, 12, null, null, 8, null,
      10, null, null, 14, null, null, 10, null, 12, null, 14, null, 15, null, 17, null,
    ],
    hat: 'eighth',                                // 8 分噪声，反拍重音
    kick: [0, 4, 8, 12],                          // 四分底鼓
    pad: false,
  },
};

const Music = {
  ac: null, out: null, lp: null, timer: null,
  inited: false, playing: false,
  track: null, step: 0, nextT: 0,
  stats: { steps: 0, switches: 0 },              // 供自动化冒烟观测

  init() {
    if (this.inited) return true;
    const A = root.ZERO_AUDIO;
    if (!A || !A.inited || !A.ac) return false;
    try {
      this.ac = A.ac;
      this.out = this.ac.createGain();
      this.out.gain.value = 0.16;
      this.lp = this.ac.createBiquadFilter();
      this.lp.type = 'lowpass';
      this.lp.frequency.value = TRACKS.explore.cutoff;
      this.lp.Q.value = 0.7;
      this.out.connect(this.lp);
      this.lp.connect(A.master);
      this.inited = true;
    } catch (e) { /* 音频不可用不影响游戏 */ }
    return this.inited;
  },

  /* 由 main.js 每帧调用：按游戏状态决定 播哪首 / 切换 / 停止 */
  update(G) {
    if (!this.inited) return;
    let want = null;
    if (G.state === 'playing' || G.state === 'chip' || G.state === 'shop' || G.state === 'paused') {
      const b = G.bossRef;
      want = (G.isBossRoom && b && !b.dead) ? 'boss' : 'explore';
    }
    if (want === this.track) return;
    if (want == null) { this._stop(); return; }
    this._start(want);
  },

  _start(name) {
    const t = this.ac.currentTime;
    this.track = name;
    this.step = 0;
    this.nextT = t + 0.08;
    this.stats.switches++;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.linearRampToValueAtTime(0.16, t + 0.3);
    this.lp.frequency.cancelScheduledValues(t);
    this.lp.frequency.setTargetAtTime(TRACKS[name].cutoff, t, 0.25);
    if (!this.playing) { this.playing = true; this._schedStart(); }
  },

  _stop() {
    this.track = null;
    this.playing = false;
    this._schedStop();
  },

  _schedStart() {
    if (this.timer) return;
    this.timer = setInterval(() => this._schedule(), TICK_MS);
    this._schedule();
  },
  _schedStop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  },

  /* 前瞻调度：以音频时钟为准逐 16 分音符排音符（标签页隐藏时暂停，回前无爆音） */
  _schedule() {
    const T = TRACKS[this.track];
    if (!T) return;
    const stepDur = 60 / T.bpm / 4;
    while (this.nextT < this.ac.currentTime + AHEAD) {
      this._playStep(T, this.step, this.nextT, stepDur);
      this.nextT += stepDur;
      this.step = (this.step + 1) % STEPS;
      this.stats.steps++;
    }
  },

  _playStep(T, step, t, stepDur) {
    const bar = (step >> 4) & 3, s = step & 15;
    const root = T.roots[bar];
    // 贝斯
    const b = T.bass[s];
    if (b != null) this._tone(T === TRACKS.boss ? 'sawtooth' : 'triangle', f(root + b - 12), t, 0.24, 0.15);
    // 底鼓 / 噪声帽
    if (T.kick && T.kick.includes(s)) this._kick(t);
    if (T.hat === 'eighth' ? (s % 2 === 0) : T.hat.includes(s)) this._hat(t, (s % 4) === 2 ? 0.055 : 0.032);
    // 分解和弦（探索）
    if (T.arp && s % 2 === 0) this._tone('square', f(root + T.arp[(s >> 1) % T.arp.length] + 12), t, 0.1, 0.026);
    // 主旋律刺音（Boss）
    if (T.lead) {
      const n = T.lead[step];
      if (n != null) this._tone('square', f(root + n), t, 0.16, 0.055);
    }
    // 长音铺底（探索，每小节头）
    if (T.pad && s === 0) {
      this._pad(f(root + 12), t, stepDur * 16);
      this._pad(f(root + 19), t, stepDur * 16);
    }
  },

  _tone(type, freq, t, dur, peak) {
    const ac = this.ac;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + dur + 0.03);
  },

  _pad(freq, t, dur) {
    const ac = this.ac;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.042, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + dur + 0.05);
  },

  _kick(t) {
    const ac = this.ac;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + 0.15);
  },

  _hat(t, peak) {
    const A = root.ZERO_AUDIO;
    if (!A || !A.noiseBuf) return;
    const ac = this.ac;
    const src = ac.createBufferSource();
    src.buffer = A.noiseBuf;
    src.loop = true;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5200;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    src.connect(hp); hp.connect(g); g.connect(this.out);
    src.start(t); src.stop(t + 0.06);
  },

  /* 标签页隐藏 → 停调度器（防 1s 节流产生断音）；回前从当前时刻续排 */
  setVisibility(vis) {
    if (!this.inited || !this.playing) return;
    if (vis) {
      this.nextT = Math.max(this.nextT, this.ac.currentTime + 0.06);
      this._schedStart();
    } else this._schedStop();
  },
};

root.ZERO_MUSIC = Music;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => Music.setVisibility(!document.hidden));
}

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
