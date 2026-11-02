// Couche d'effets visuels : projectiles, explosions, éclairs, flaques et télégraphes.
// Chaque rendu est choisi par la clé "visual" des données, via la section effects du manifeste.
import type Phaser from 'phaser';
import type { BeamSegment, Projectile } from '../sim/types';
import type { Particle } from './animations';
import { effectVisual, type EffectVisual } from './manifest';

interface Lasting {
  visual: EffectVisual;
  x: number;
  y: number;
  radius: number;
  /** Second point (rayons, éclairs). */
  toX?: number;
  toY?: number;
  /** Largeur d'un rayon traversant (px monde). */
  width?: number;
  /** Rayon en charge : trajectoire qui se dessine progressivement. */
  charge?: BeamSegment[];
  age: number;
  life: number;
  telegraph?: boolean;
  /** Graine du zigzag d'un éclair, pour qu'il ne tremble pas d'une image à l'autre. */
  seed: number;
}

const hex = (c: string) => parseInt(c.slice(1), 16);

export class FxLayer {
  private lasting: Lasting[] = [];

  constructor(
    private readonly g: Phaser.GameObjects.Graphics,
    private readonly ground: Phaser.GameObjects.Graphics,
    private readonly particles: Particle[],
    private readonly scale: number,
    private readonly fieldTop: number,
  ) {}

  /** Effet ponctuel à un point (explosion, étincelle, flaque, éclair). */
  effect(key: string, x: number, y: number, radius: number): void {
    const v = effectVisual(key);
    const r = Math.max(radius, v.size * 3);
    if (v.kind === 'spark' || v.kind === 'ring') this.burst(x, y, v, v.kind === 'ring' ? 14 : 6, v.kind === 'ring' ? 70 : 40);
    if (v.kind === 'bolt') this.burst(x, y, v, 10, 60);
    // Gros impact : plus de débris, qui volent plus loin.
    if (v.kind === 'ring' && radius >= 25) this.burst(x, y, v, 40, 150);
    this.lasting.push({ visual: v, x, y, radius: r, age: 0, life: v.duration, seed: Math.random() * 1000 });
    if (v.decal) this.lasting.push({ visual: effectVisual(v.decal), x, y, radius: r * 0.75, age: 0, life: effectVisual(v.decal).duration, seed: 0 });
  }

  beam(key: string, fromX: number, fromY: number, toX: number, toY: number, width?: number): void {
    const v = effectVisual(key);
    this.lasting.push({ visual: v, x: fromX, y: fromY, toX, toY, width, radius: 0, age: 0, life: Math.max(0.15, v.duration), seed: Math.random() * 1000 });
    // Étincelles au point de rebond.
    if (width) this.burst(toX, toY, v, 10, 70);
  }

  /** Le rayon se dessine le long de sa trajectoire pendant sa charge, puis frappe. */
  beamCharge(key: string, segments: BeamSegment[], width: number, duration: number): void {
    const v = effectVisual(key);
    this.lasting.push({ visual: v, x: segments[0].fromX, y: segments[0].fromY, radius: 0, width, charge: segments, age: 0, life: duration, seed: Math.random() * 1000 });
  }

  /** Avertissement avant un incident : ombre qui grossit et contour qui clignote. */
  telegraph(key: string, x: number, y: number, radius: number, duration: number): void {
    this.lasting.push({ visual: effectVisual(key), x, y, radius, age: 0, life: duration, telegraph: true, seed: 0 });
  }

  private burst(x: number, y: number, v: EffectVisual, count: number, speed: number): void {
    const colors = [hex(v.color), hex(v.accent ?? v.color)];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, life: 0.45, maxLife: 0.45, color: colors[i % 2], size: Math.random() < 0.4 ? 2 : 1 });
    }
  }

  draw(dt: number, projectiles: readonly Projectile[]): void {
    const S = this.scale;
    const g = this.g;
    const ground = this.ground;
    ground.clear();

    for (let i = this.lasting.length - 1; i >= 0; i--) {
      const e = this.lasting[i];
      e.age += dt;
      if (e.age >= e.life) {
        this.lasting.splice(i, 1);
        continue;
      }
      const k = e.age / e.life;
      const v = e.visual;
      const color = hex(v.color);
      const accent = hex(v.accent ?? v.color);
      if (e.charge && e.width) {
        this.drawCharge(g, e.charge, e.width, k, e.age, color, accent);
        continue;
      }
      if (e.telegraph) {
        // L'ombre grossit jusqu'à l'impact ; le contour clignote de plus en plus vite.
        ground.fillStyle(0x000000, 0.25 + 0.25 * k).fillEllipse(e.x * S, e.y * S, e.radius * 2 * S * (0.4 + 0.6 * k), e.radius * 1.4 * S * (0.4 + 0.6 * k));
        if (Math.floor(e.age * (6 + 14 * k)) % 2 === 0) {
          ground.lineStyle(S, color, 0.9).strokeEllipse(e.x * S, e.y * S, e.radius * 2 * S, e.radius * 1.4 * S);
        }
        continue;
      }
      if (e.toX !== undefined && e.toY !== undefined && e.width) {
        // Grand rayon : halo large qui s'amincit, cœur blanc qui scintille.
        const fade = 1 - k;
        const flicker = 0.75 + 0.25 * Math.sin(e.age * 90 + e.seed);
        g.lineStyle(e.width * S * 2.2 * fade, color, 0.25 * fade).lineBetween(e.x * S, e.y * S, e.toX * S, e.toY * S);
        g.lineStyle(e.width * S * fade, color, 0.85 * fade).lineBetween(e.x * S, e.y * S, e.toX * S, e.toY * S);
        g.lineStyle(Math.max(S, e.width * S * 0.35 * fade), accent, flicker * fade).lineBetween(e.x * S, e.y * S, e.toX * S, e.toY * S);
        continue;
      }
      if (e.toX !== undefined && e.toY !== undefined) {
        g.lineStyle(v.size * S * 2.5, color, 0.35 * (1 - k)).lineBetween(e.x * S, e.y * S, e.toX * S, e.toY * S);
        if (v.kind === 'bolt') this.zigzag(g, e.x, e.y, e.toX, e.toY, accent, v.size, e.seed);
        else g.lineStyle(v.size * S, accent, 1 - k).lineBetween(e.x * S, e.y * S, e.toX * S, e.toY * S);
        continue;
      }
      switch (v.kind) {
        case 'ring':
          const big = e.radius >= 25;
          g.lineStyle(v.size * S * (big ? 2 : 1), color, 1 - k).strokeCircle(e.x * S, e.y * S, e.radius * S * (0.3 + (big ? 1.1 : 0.7) * k));
          if (big) g.lineStyle(v.size * S, accent, (1 - k) * 0.8).strokeCircle(e.x * S, e.y * S, e.radius * S * (0.2 + 0.6 * k));
          g.fillStyle(accent, 0.5 * (1 - k)).fillCircle(e.x * S, e.y * S, e.radius * S * 0.6 * (1 - k));
          break;
        case 'swirl': {
          // Tourbillon : arcs qui tournent autour du lanceur en s'élargissant.
          const turn = e.age * 22;
          const r = e.radius * S * (0.6 + 0.5 * k);
          for (let a = 0; a < 4; a++) {
            const start = turn + (a * Math.PI) / 2;
            g.lineStyle(v.size * S * (1.5 - k), a % 2 ? accent : color, 1 - k).beginPath().arc(e.x * S, e.y * S, r, start, start + 1.1).strokePath();
          }
          g.fillStyle(color, 0.18 * (1 - k)).fillCircle(e.x * S, e.y * S, r);
          break;
        }
        case 'puddle': {
          const fade = k > 0.8 ? (1 - k) / 0.2 : 1;
          ground.fillStyle(color, 0.45 * fade).fillEllipse(e.x * S, e.y * S, e.radius * 2 * S, e.radius * 1.4 * S);
          ground.fillStyle(accent, 0.35 * fade).fillEllipse((e.x - e.radius * 0.3) * S, (e.y - e.radius * 0.2) * S, e.radius * 0.6 * S, e.radius * 0.3 * S);
          break;
        }
        case 'bolt':
          // Éclair tombé du ciel jusqu'au point d'impact.
          this.zigzag(g, e.x + 6, this.fieldTop - 10, e.x, e.y, color, v.size * (1 - k * 0.5), e.seed);
          g.fillStyle(0xffffff, 0.6 * (1 - k)).fillCircle(e.x * S, e.y * S, (e.radius + 4) * S * (1 - k));
          break;
        default:
          break;
      }
    }

    for (const p of projectiles) this.drawProjectile(p);
  }

  /** Charge : un trait fin qui avance sur la trajectoire, un noyau lumineux qui grossit au départ. */
  private drawCharge(g: Phaser.GameObjects.Graphics, segments: BeamSegment[], width: number, k: number, age: number, color: number, accent: number): void {
    const S = this.scale;
    const lengths = segments.map((s) => Math.hypot(s.toX - s.fromX, s.toY - s.fromY));
    let remaining = (lengths.reduce((a, b) => a + b, 0) * Math.min(1, k * 1.25));
    const flicker = 0.6 + 0.4 * Math.sin(age * 60);
    segments.forEach((s, i) => {
      if (remaining <= 0) return;
      const part = Math.min(1, remaining / (lengths[i] || 1));
      remaining -= lengths[i];
      const ex = s.fromX + (s.toX - s.fromX) * part;
      const ey = s.fromY + (s.toY - s.fromY) * part;
      g.lineStyle(Math.max(S, width * S * 0.5 * k), color, 0.35 * flicker).lineBetween(s.fromX * S, s.fromY * S, ex * S, ey * S);
      g.lineStyle(S, accent, 0.8 * flicker).lineBetween(s.fromX * S, s.fromY * S, ex * S, ey * S);
    });
    const o = segments[0];
    g.fillStyle(color, 0.5).fillCircle(o.fromX * S, o.fromY * S, (2 + width * k) * S * flicker);
    g.fillStyle(accent, 0.9).fillCircle(o.fromX * S, o.fromY * S, (1 + width * 0.4 * k) * S);
  }

  private zigzag(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number, color: number, size: number, seed: number): void {
    const S = this.scale;
    const steps = 7;
    let px = x0;
    let py = y0;
    g.lineStyle(Math.max(1, size) * S, color, 1);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const jitter = i === steps ? 0 : Math.sin(seed + i * 12.9898) * 5;
      const nx = x0 + (x1 - x0) * t + jitter;
      const ny = y0 + (y1 - y0) * t;
      g.lineBetween(px * S, py * S, nx * S, ny * S);
      px = nx;
      py = ny;
    }
  }

  private drawProjectile(p: Projectile): void {
    const S = this.scale;
    const g = this.g;
    const v = effectVisual(p.visual);
    const dx = p.toX - p.fromX;
    const dy = p.toY - p.fromY;
    const l = Math.hypot(dx, dy) || 1;
    const k = p.age / p.flightTime;
    // Chute du ciel : part de haut et accélère ; sinon, une cloche.
    const lift = p.fall ? p.arc * (1 - k * k) : Math.sin(k * Math.PI) * p.arc;
    const x = p.x * S;
    const y = (p.y - lift) * S;
    const color = hex(v.color);
    const accent = hex(v.accent ?? v.color);
    switch (v.kind) {
      case 'line': {
        // Rayon : trait lumineux du tireur jusqu'à la tête du tir.
        g.lineStyle(v.size * S * 3, color, 0.35).lineBetween(p.fromX * S, p.fromY * S, x, y);
        g.lineStyle(v.size * S, accent, 1).lineBetween(p.fromX * S, p.fromY * S, x, y);
        break;
      }
      case 'ball': {
        const r = (v.size / 2) * S;
        // Gros projectile (météore) : halo et traînée de flammes.
        if (v.size >= 10) {
          g.fillStyle(accent, 0.25).fillCircle(x, y, r * 1.8);
          for (let i = 0; i < 3; i++) {
            this.particles.push({ x: p.x + (Math.random() - 0.5) * v.size * 0.6, y: p.y - lift + (Math.random() - 0.5) * v.size * 0.6, vx: (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 40, life: 0.5, maxLife: 0.5, color: i % 2 ? color : accent, size: 2 });
          }
        }
        // Ombre au sol pour lire la cloche.
        if (p.arc > 0) this.ground.fillStyle(0x000000, 0.25).fillEllipse(x, p.y * S, r * 2, r);
        g.fillStyle(color, 1).fillCircle(x, y, r);
        g.fillStyle(accent, 1).fillRect(x - r * 0.5, y - r * 0.6, Math.max(S, r * 0.5), Math.max(S, r * 0.5));
        if (Math.random() < 0.5) this.particles.push({ x: p.x, y: p.y - lift, vx: 0, vy: -10, life: 0.25, maxLife: 0.25, color: accent, size: 1 });
        break;
      }
      default:
        g.lineStyle(v.size * S, accent, 1).lineBetween(x, y, x - (dx / l) * 5 * S, y - (dy / l) * 5 * S);
        g.fillStyle(color, 1).fillRect(x - 2, y - 2, 4, 4);
    }
  }
}
