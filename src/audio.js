/* ============================================================
 * 零号协议 ZERO PROTOCOL —— audio.js
 * 纯 Web Audio 实时合成电子音效：无采样、无外部资源、低刺耳度设计
 * （噪声走低通、方波短促、总线上挂压缩器限幅）
 * ============================================================ */
(function (root) {
'use strict';

const AudioSys = {
  ac: null, master: null, muted: false, inited: false,

  init() {
    if (this.inited) return;
    try {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      const comp = this.ac.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 20;
      comp.ratio.value = 8;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      this.master = this.ac.createGain();
      this.master.gain.value = 0.42;
      this.master.connect(comp);
      comp.connect(this.ac.destination);
      this.noiseBuf = this._makeNoise();
      this.inited = true;
    } catch (e) { /* 音频不可用不影响游戏 */ }
  },

  resume() {
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.42;
    return this.muted;
  },

  _makeNoise() {
    const len = this.ac.sampleRate * 1;
    const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  },

  _env(gain, t0, a, d, peak) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  },

  _osc(type, f0, f1, t0, dur, peak, dest) {
    const ac = this.ac;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    this._env(g, t0, Math.min(0.012, dur * 0.2), dur, peak);
    o.connect(g); g.connect(dest || this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  },

  _noise(t0, dur, peak, f0, f1, q, dest) {
    const ac = this.ac;
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = ac.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(f0, t0);
    if (f1) filt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
    filt.Q.value = q || 0.8;
    const g = ac.createGain();
    this._env(g, t0, 0.008, dur, peak);
    src.connect(filt); filt.connect(g); g.connect(dest || this.master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  },

  play(name, p) {
    if (!this.inited || this.muted || !this.ac) return;
    if (this.ac.state === 'suspended') { try { this.ac.resume(); } catch (e) {} }
    const ac = this.ac;
    const t = ac.currentTime;
    const det = p && p.pitch ? p.pitch : 1;
    try {
      switch (name) {
        case 'shoot': // 冲锋枪：短促电子脉冲
          this._osc('square', 760 * det, 320 * det, t, 0.055, 0.10);
          this._noise(t, 0.04, 0.05, 3000, 900);
          break;
        case 'shotgun': // 霰弹：厚噪声 + 低频冲击
          this._noise(t, 0.2, 0.32, 2400, 240);
          this._osc('sine', 150, 55, t, 0.16, 0.30);
          break;
        case 'rail': // 电磁炮：扫频 + 高能
          this._osc('sawtooth', 180, 1500, t, 0.14, 0.16);
          this._noise(t, 0.16, 0.18, 500, 4000, 2);
          break;
        case 'railImpact':
          this._noise(t + 0.02, 0.25, 0.24, 1800, 120);
          this._osc('sine', 120, 45, t + 0.02, 0.22, 0.26);
          break;
        case 'slash':
          this._noise(t, 0.09, 0.14, 1200, 4600, 1.2);
          break;
        case 'deflect':
          this._osc('square', 1050, 1400, t, 0.09, 0.12);
          this._osc('sine', 2100, 2600, t, 0.07, 0.08);
          break;
        case 'hit':
          this._osc('square', 240 * det, 130 * det, t, 0.045, 0.10);
          this._noise(t, 0.03, 0.06, 2200, 700);
          break;
        case 'kill':
          this._noise(t, 0.28, 0.24, 1600, 90);
          this._osc('triangle', 300, 60, t, 0.24, 0.22);
          break;
        case 'explosion':
          this._noise(t, 0.42, 0.32, 900, 60);
          this._osc('sine', 95, 35, t, 0.4, 0.3);
          break;
        case 'dash':
          this._noise(t, 0.14, 0.10, 400, 2600, 1);
          break;
        case 'hurt':
          this._osc('square', 170, 70, t, 0.16, 0.20);
          this._noise(t, 0.12, 0.12, 800, 200);
          break;
        case 'shieldHit':
          this._osc('sine', 520, 340, t, 0.1, 0.14);
          this._noise(t, 0.06, 0.06, 3000, 1200);
          break;
        case 'shieldBreak':
          this._osc('sawtooth', 700, 120, t, 0.3, 0.16);
          this._noise(t, 0.24, 0.14, 2600, 200);
          break;
        case 'clink': // 格挡
          this._osc('square', 1800, 1500, t, 0.04, 0.07);
          break;
        case 'guardBreak':
          this._osc('sawtooth', 420, 90, t, 0.3, 0.2);
          this._noise(t, 0.3, 0.18, 1400, 150);
          break;
        case 'enemyShoot':
          this._osc('square', 420 * det, 190 * det, t, 0.07, 0.06);
          break;
        case 'enemyDash':
          this._noise(t, 0.12, 0.08, 300, 1800, 1);
          break;
        case 'laserCharge':
          this._osc('sawtooth', 220, 880, t, 0.55, 0.05);
          break;
        case 'laserFire':
          this._noise(t, 0.12, 0.09, 4000, 800);
          this._osc('sawtooth', 1400, 500, t, 0.1, 0.06);
          break;
        case 'sniperFire':
          this._noise(t, 0.2, 0.2, 3200, 300);
          this._osc('sawtooth', 900, 200, t, 0.14, 0.1);
          break;
        case 'minePlace':
          this._osc('sine', 1300, 1300, t, 0.05, 0.07);
          this._osc('sine', 1300, 1300, t + 0.1, 0.05, 0.07);
          break;
        case 'coin':
          this._osc('square', 1400, 1900, t, 0.05, 0.06);
          break;
        case 'buy':
          this._osc('square', 700, 700, t, 0.06, 0.08);
          this._osc('square', 1050, 1050, t + 0.07, 0.1, 0.08);
          break;
        case 'heal':
          this._osc('sine', 660, 660, t, 0.08, 0.1);
          this._osc('sine', 990, 990, t + 0.09, 0.1, 0.1);
          break;
        case 'pickup':
          this._osc('square', 520, 520, t, 0.06, 0.08);
          this._osc('square', 780, 780, t + 0.07, 0.08, 0.08);
          break;
        case 'chipOffer':
          this._osc('sine', 440, 440, t, 0.1, 0.1);
          this._osc('sine', 550, 550, t + 0.11, 0.1, 0.1);
          this._osc('sine', 660, 660, t + 0.22, 0.14, 0.1);
          break;
        case 'chipPick':
          this._osc('square', 700, 700, t, 0.05, 0.08);
          this._osc('square', 1050, 1050, t + 0.06, 0.09, 0.08);
          break;
        case 'syn':
          [523, 659, 784, 1046].forEach((f, i) =>
            this._osc('triangle', f, f, t + i * 0.09, 0.14, 0.11));
          break;
        case 'phase':
          this._osc('sawtooth', 300, 150, t, 0.5, 0.18);
          this._osc('square', 200, 400, t + 0.25, 0.3, 0.12);
          this._noise(t, 0.5, 0.16, 600, 80);
          break;
        case 'bossRoar':
          this._osc('sawtooth', 90, 45, t, 0.8, 0.26);
          this._osc('sawtooth', 95, 48, t, 0.8, 0.2);
          this._noise(t, 0.7, 0.16, 400, 90);
          break;
        case 'bossDie':
          this._noise(t, 0.8, 0.3, 1000, 50);
          this._osc('sawtooth', 200, 30, t, 0.8, 0.24);
          break;
        case 'victory':
          [523, 659, 784, 1046, 1318].forEach((f, i) =>
            this._osc('square', f, f, t + i * 0.12, 0.22, 0.09));
          this._noise(t + 0.5, 0.5, 0.08, 3000, 600);
          break;
        case 'death':
          this._osc('sawtooth', 300, 40, t, 0.9, 0.22);
          this._noise(t, 0.6, 0.2, 1200, 60);
          break;
        case 'portalOpen':
          this._osc('sine', 300, 900, t, 0.4, 0.09);
          break;
        case 'portalEnter':
          this._osc('sine', 500, 1500, t, 0.3, 0.1);
          this._noise(t, 0.3, 0.06, 2000, 4000);
          break;
        case 'switch':
          this._osc('square', 900, 700, t, 0.04, 0.06);
          break;
        case 'ui':
          this._osc('square', 800, 800, t, 0.035, 0.06);
          break;
        default:
          break;
      }
    } catch (e) { /* 单个音效失败静默 */ }
  },
};

root.ZERO_AUDIO = AudioSys;
if (typeof module !== 'undefined' && module.exports) module.exports = AudioSys;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
