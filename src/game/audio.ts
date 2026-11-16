export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  private screechGain: GainNode | null = null;
  private screechFilter: BiquadFilterNode | null = null;
  private nitroGain: GainNode | null = null;
  private nitroFilter: BiquadFilterNode | null = null;

  private muted = false;
  private active = false;

  public unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.32;
    master.connect(ctx.destination);
    this.masterGain = master;

    // Engine harmonic pair
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 320;
    engineFilter.Q.value = 2.4;

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.0;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 55;

    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = 110;

    osc1.connect(engineFilter);
    osc2.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);

    osc1.start();
    osc2.start();

    this.engineOsc1 = osc1;
    this.engineOsc2 = osc2;
    this.engineFilter = engineFilter;
    this.engineGain = engineGain;

    // Shared noise buffer for drift screech + nitro whoosh
    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    // Tire screech chain
    const screechSrc = ctx.createBufferSource();
    screechSrc.buffer = noiseBuffer;
    screechSrc.loop = true;

    const screechFilter = ctx.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.frequency.value = 1350;
    screechFilter.Q.value = 5.5;

    const screechGain = ctx.createGain();
    screechGain.gain.value = 0;

    screechSrc.connect(screechFilter);
    screechFilter.connect(screechGain);
    screechGain.connect(master);
    screechSrc.start();

    this.screechFilter = screechFilter;
    this.screechGain = screechGain;

    // Nitro boost whoosh chain
    const nitroSrc = ctx.createBufferSource();
    nitroSrc.buffer = noiseBuffer;
    nitroSrc.loop = true;

    const nitroFilter = ctx.createBiquadFilter();
    nitroFilter.type = 'bandpass';
    nitroFilter.frequency.value = 420;
    nitroFilter.Q.value = 1.6;

    const nitroGain = ctx.createGain();
    nitroGain.gain.value = 0;

    nitroSrc.connect(nitroFilter);
    nitroFilter.connect(nitroGain);
    nitroGain.connect(master);
    nitroSrc.start();

    this.nitroFilter = nitroFilter;
    this.nitroGain = nitroGain;

    this.active = true;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.32, this.ctx.currentTime, 0.04);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public updateDrive(
    playing: boolean,
    rpmNorm: number,
    speedRatio: number,
    driftIntensity: number,
    nitroActive: boolean
  ): void {
    if (!this.active || !this.ctx || !this.engineGain || !this.engineOsc1 || !this.engineOsc2 || !this.engineFilter) {
      return;
    }
    const now = this.ctx.currentTime;
    if (!playing) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      this.screechGain?.gain.setTargetAtTime(0, now, 0.06);
      this.nitroGain?.gain.setTargetAtTime(0, now, 0.06);
      return;
    }

    const baseFreq = 46 + rpmNorm * 115 + speedRatio * 30;
    this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.03);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * 1.98, now, 0.03);
    this.engineFilter.frequency.setTargetAtTime(240 + rpmNorm * 950 + (nitroActive ? 400 : 0), now, 0.04);
    this.engineGain.gain.setTargetAtTime(0.14 + rpmNorm * 0.12, now, 0.05);

    if (this.screechGain && this.screechFilter) {
      const targetScreech = Math.min(0.16, driftIntensity * 0.16);
      this.screechGain.gain.setTargetAtTime(targetScreech, now, 0.04);
      this.screechFilter.frequency.setTargetAtTime(1150 + speedRatio * 450, now, 0.05);
    }

    if (this.nitroGain && this.nitroFilter) {
      this.nitroGain.gain.setTargetAtTime(nitroActive ? 0.22 : 0, now, 0.05);
      this.nitroFilter.frequency.setTargetAtTime(nitroActive ? 540 + speedRatio * 380 : 320, now, 0.05);
    }
  }

  public playCountdownTone(isGo: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isGo ? 880 : 440, now);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 0.35 : 0.18));
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + (isGo ? 0.36 : 0.2));
  }

  public playLapChime(isFinal: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const notes = isFinal ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
    const now = this.ctx.currentTime;
    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = now + idx * 0.075;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.18, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  }

  public playCollision(strength: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.14);
    const vol = Math.min(0.32, 0.08 + strength * 0.22);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.active = false;
  }
}
