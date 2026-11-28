// Son synthétisé (WebAudio) : aucun fichier, tout est généré. Un flux est exposé pour que
// l'enregistrement vidéo embarque le son.

export type SoundKind =
  | 'hit'
  | 'heavy'
  | 'explosion'
  | 'laserCharge'
  | 'laser'
  | 'whoosh'
  | 'land'
  | 'bonk'
  | 'cheer'
  | 'ooh'
  | 'beep'
  | 'gong'
  | 'tick'
  | 'ding'
  | 'arrow'
  | 'splat'
  | 'wind'
  | 'hail';

/** Écart minimal entre deux sons identiques (ms), pour ne pas saturer pendant la mêlée. */
const GAP: Partial<Record<SoundKind, number>> = { hit: 45, heavy: 80, arrow: 60, whoosh: 90, land: 70, tick: 30, cheer: 600, ooh: 900, wind: 900, hail: 55 };

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private noise!: AudioBuffer;
  private last = new Map<SoundKind, number>();
  private musicTimer: number | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  /** Décalage de lecture dans le buffer de bruit, pour varier sans hasard. */
  private noiseOffset = 0;
  muted = false;

  constructor(private readonly volume = 0.5) {}

  /** Crée le contexte (à appeler après un geste de l'utilisateur, sinon il reste suspendu). */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.18;
    this.musicGain.connect(this.master);
    this.dest = this.ctx.createMediaStreamDestination();
    this.master.connect(this.dest);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    // Bruit pseudo-aléatoire fixe : le son ne dépend pas du hasard du navigateur.
    let s = 12345;
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      d[i] = (s / 4294967296) * 2 - 1;
    }
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Piste audio pour l'enregistrement. */
  get track(): MediaStreamTrack | undefined {
    return this.dest?.stream.getAudioTracks()[0];
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  private tone(type: OscillatorType, from: number, to: number, duration: number, gain: number, at = 0): void {
    const c = this.ctx!;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.02);
  }

  private burst(duration: number, gain: number, filter: BiquadFilterType, from: number, to: number, at = 0): void {
    const c = this.ctx!;
    const t = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f).connect(g).connect(this.master);
    this.noiseOffset = (this.noiseOffset + 0.137) % 0.5;
    src.start(t, this.noiseOffset);
    src.stop(t + duration + 0.02);
  }

  play(kind: SoundKind): void {
    if (!this.ready || this.muted) return;
    const now = performance.now();
    const gap = GAP[kind] ?? 0;
    if (now - (this.last.get(kind) ?? -1e9) < gap) return;
    this.last.set(kind, now);
    switch (kind) {
      case 'hit':
        this.burst(0.06, 0.25, 'bandpass', 1800, 600);
        this.tone('square', 180, 90, 0.05, 0.08);
        break;
      case 'heavy':
        this.burst(0.12, 0.4, 'lowpass', 1200, 200);
        this.tone('sine', 120, 50, 0.15, 0.35);
        break;
      case 'explosion':
        this.burst(0.6, 0.7, 'lowpass', 2200, 80);
        this.tone('sine', 90, 30, 0.5, 0.5);
        break;
      case 'laserCharge':
        this.tone('sawtooth', 200, 1400, 0.8, 0.08);
        break;
      case 'laser':
        this.tone('sawtooth', 1600, 300, 0.35, 0.18);
        this.tone('square', 800, 150, 0.35, 0.08);
        break;
      case 'whoosh':
        this.burst(0.25, 0.18, 'bandpass', 400, 2400);
        break;
      case 'land':
        this.tone('sine', 140, 60, 0.12, 0.25);
        this.burst(0.08, 0.15, 'lowpass', 900, 200);
        break;
      case 'bonk':
        this.tone('square', 620, 300, 0.12, 0.18);
        this.tone('square', 930, 450, 0.12, 0.1, 0.04);
        break;
      case 'cheer':
        this.burst(1.1, 0.12, 'bandpass', 900, 1400);
        break;
      case 'ooh':
        this.tone('triangle', 330, 220, 0.6, 0.08);
        this.burst(0.6, 0.06, 'bandpass', 700, 500);
        break;
      case 'beep':
        this.tone('square', 660, 660, 0.15, 0.15);
        break;
      case 'gong':
        this.tone('square', 990, 990, 0.12, 0.15);
        this.tone('triangle', 220, 110, 0.9, 0.3);
        break;
      case 'tick':
        this.tone('square', 1200, 1200, 0.03, 0.06);
        break;
      case 'ding':
        this.tone('triangle', 1320, 1320, 0.4, 0.2);
        this.tone('triangle', 1760, 1760, 0.4, 0.12, 0.05);
        break;
      case 'arrow':
        this.burst(0.08, 0.08, 'highpass', 3000, 1500);
        break;
      case 'splat':
        this.burst(0.15, 0.25, 'lowpass', 1500, 300);
        break;
      case 'wind':
        // Hurlement de rafale : bruit filtré dont la bande monte puis retombe.
        this.burst(0.7, 0.14, 'bandpass', 380, 900);
        this.burst(0.9, 0.1, 'bandpass', 900, 420, 0.5);
        break;
      case 'hail':
        this.burst(0.03, 0.12, 'highpass', 5200, 3800);
        break;
    }
  }

  /** Roulement de tambour (attente de la roulette) : coups de caisse claire de plus en plus serrés. */
  drumroll(duration: number): void {
    if (!this.ready || this.muted) return;
    let at = 0;
    let gap = 0.09;
    while (at < duration) {
      this.burst(0.05, 0.16 + (at / duration) * 0.12, 'bandpass', 2200, 1200, at);
      at += gap;
      gap = Math.max(0.035, gap * 0.96);
    }
    this.tone('triangle', 180, 120, 0.4, 0.25, duration);
  }

  /** Fanfare d'intro : quelques notes carrées, façon 16 bits. */
  fanfare(): void {
    if (!this.ready || this.muted) return;
    const notes = [523, 659, 784, 1047, 784, 1047];
    const lengths = [0.12, 0.12, 0.12, 0.3, 0.12, 0.5];
    let at = 0;
    notes.forEach((f, i) => {
      this.tone('square', f, f, lengths[i], 0.14, at);
      this.tone('triangle', f / 2, f / 2, lengths[i], 0.1, at);
      at += lengths[i] + 0.02;
    });
  }

  /** Petite boucle musicale pendant le combat : basse et arpège, 128 bpm. */
  startMusic(): void {
    if (!this.ready || this.musicTimer !== null) return;
    const c = this.ctx!;
    const beat = 60 / 128 / 2;
    const bass = [110, 110, 131, 98];
    const arp = [440, 523, 659, 523, 494, 587, 740, 587];
    let step = 0;
    let next = c.currentTime + 0.05;
    const schedule = () => {
      while (next < c.currentTime + 0.3) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = step % 2 ? 'square' : 'triangle';
        const f = step % 2 ? arp[step % arp.length] : bass[Math.floor(step / 4) % bass.length];
        o.frequency.setValueAtTime(f, next);
        g.gain.setValueAtTime(step % 2 ? 0.12 : 0.3, next);
        g.gain.exponentialRampToValueAtTime(0.0001, next + beat * 0.9);
        o.connect(g).connect(this.musicGain);
        o.start(next);
        o.stop(next + beat);
        next += beat;
        step++;
      }
    };
    schedule();
    this.musicTimer = window.setInterval(schedule, 100);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

/** Instance partagée par les scènes. */
export const sound = new Sound();
