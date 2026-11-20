// Procedural ambient audio (Web Audio): city rumble, traffic wash, air, birds by day, footsteps, DLR hum.
export class CityAudio {
  constructor() { this.ctx = null; this.muted = false; this.night = 0; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    let ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } // silent fallback
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.55; this.master.connect(ctx.destination);
    const noise = (type, secs = 4) => {
      const b = ctx.createBuffer(1, ctx.sampleRate * secs, ctx.sampleRate); const d = b.getChannelData(0);
      let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else if (type === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11; }
        else d[i] = w;
      }
      const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; return s;
    };
    // low city rumble
    const rumble = noise('brown'); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0.7; rumble.connect(lp).connect(this.rumbleGain).connect(this.master); rumble.start();
    // traffic wash with slow swells
    const wash = noise('pink'); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 0.5;
    this.washGain = ctx.createGain(); this.washGain.gain.value = 0.25; wash.connect(bp).connect(this.washGain).connect(this.master); wash.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06; const lfoG = ctx.createGain(); lfoG.gain.value = 0.12; lfo.connect(lfoG).connect(this.washGain.gain); lfo.start();
    // air / distant hiss
    const air = noise('white'); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
    const airG = ctx.createGain(); airG.gain.value = 0.012; air.connect(hp).connect(airG).connect(this.master); air.start();
    // DLR hum (gain driven by proximity)
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 62;
    const hum = noise('brown'); const humLp = ctx.createBiquadFilter(); humLp.type = 'lowpass'; humLp.frequency.value = 420;
    this.trainGain = ctx.createGain(); this.trainGain.gain.value = 0;
    const oscG = ctx.createGain(); oscG.gain.value = 0.08; osc.connect(oscG).connect(humLp); hum.connect(humLp); humLp.connect(this.trainGain).connect(this.master); osc.start(); hum.start();
    this.white = noise('white', 1).buffer;
    this.nextBird = ctx.currentTime + 2;
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.1); }
  setNight(n) { this.night = n; if (!this.ctx) return; const t = this.ctx.currentTime; this.washGain.gain.setTargetAtTime(n >= 1 ? 0.12 : 0.25, t, 1); this.rumbleGain.gain.setTargetAtTime(n >= 1 ? 0.5 : 0.7, t, 1); }

  footstep(intensity = 0.5) {
    if (!this.ctx || this.muted) return; const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.white; s.playbackRate.value = 0.7 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 500; f.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18 * intensity + 0.05, t + 0.005); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + 0.12);
  }

  update(dt, ctxInfo) {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime;
    // DLR proximity
    const d = ctxInfo.trainDist ?? 1e9; const g = d < 160 ? Math.pow(1 - d / 160, 2) * 0.5 : 0;
    this.trainGain.gain.setTargetAtTime(g, t, 0.3);
    // birds in parks by day
    if (this.night < 1 && t > this.nextBird) {
      this.nextBird = t + 1.5 + Math.random() * 5;
      const near = ctxInfo.parkDist < 80; if (!near) return;
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const o = ctx.createOscillator(); o.type = 'sine'; const gg = ctx.createGain(); const st = t + i * 0.13;
        const f0 = 3000 + Math.random() * 2000; o.frequency.setValueAtTime(f0, st); o.frequency.exponentialRampToValueAtTime(f0 * (0.7 + Math.random() * 0.6), st + 0.09);
        gg.gain.setValueAtTime(0, st); gg.gain.linearRampToValueAtTime(0.02 * (1 - ctxInfo.parkDist / 80), st + 0.01); gg.gain.exponentialRampToValueAtTime(0.0001, st + 0.1);
        o.connect(gg).connect(this.master); o.start(st); o.stop(st + 0.12);
      }
    }
  }
}
