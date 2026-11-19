// Page sounds: real recorded page flips (CC0, "10 book page flips" by
// StarNinjas, opengameart.org). Each turn picks a different recording and
// varies pitch and level slightly so repeated turns never sound identical.
// If the files can't be loaded we fall back to a synthesized swish.

const FILES = Array.from({ length: 10 }, (_, i) => `page-flip-${i + 1}.mp3`);
// short recordings suit a light grab, longer ones a full turn
const SHORT = [0, 3, 4, 5, 7];
const FULL = [1, 2, 6, 8, 9];

export class PaperSound {
  constructor(base = '/sounds/') {
    this.enabled = true;
    this.base = base;
    this.ctx = null;
    this.buffers = [];
    this.last = -1;
    // download right away so the very first turn already has its sound
    this.raw = FILES.map((f) => fetch(base + f).then((r) => r.arrayBuffer()).catch(() => null));
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.9;
      this.out.connect(this.ctx.destination);
      this._load();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  async _load() {
    await Promise.all(FILES.map(async (f, i) => {
      try {
        const data = await this.raw[i];
        if (!data) return;
        this.buffers[i] = await new Promise((ok, bad) => this.ctx.decodeAudioData(data, ok, bad));
      } catch { /* keep the synth fallback for this slot */ }
    }));
  }

  _pick(pool) {
    const ready = pool.filter((i) => this.buffers[i]);
    if (!ready.length) return -1;
    let i;
    do { i = ready[Math.floor(Math.random() * ready.length)]; } while (ready.length > 1 && i === this.last);
    this.last = i;
    return i;
  }

  _play(i, { gain = 1, rate = 1, delay = 0 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[i];
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.out);
    src.start(this.ctx.currentTime + delay);
  }

  flip({ quick = false } = {}) {
    if (!this.enabled || !this.ensure()) return;
    const i = this._pick(quick ? SHORT : FULL);
    if (i < 0) return this._synthFlip();
    this._play(i, { gain: 0.85 + Math.random() * 0.25, rate: (quick ? 1.08 : 0.95) + Math.random() * 0.1 });
  }

  grab() {
    if (!this.enabled || !this.ensure()) return;
    const i = this._pick(SHORT);
    if (i < 0) return;
    this._play(i, { gain: 0.18, rate: 1.25 + Math.random() * 0.1 });
  }

  // ---- fallback: filtered pink noise
  _noise() {
    if (this._nb) return this._nb;
    const len = this.ctx.sampleRate;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    return (this._nb = b);
  }

  _synthFlip() {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.6;
    bp.frequency.setValueAtTime(2200, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(bp).connect(g).connect(this.out);
    src.start(t, 0, 0.55);
  }
}
