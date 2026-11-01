// Couche d'effets visuels : projectiles, explosions, éclairs, flaques et télégraphes.
// Chaque rendu est choisi par la clé "visual" des données, via la section effects du manifeste.
import type Phaser from 'phaser';
import type { Projectile } from '../sim/types';
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
    this.lasting.push({ visual: v, x, y, radius: r, age: 0, life: v.duration, seed: Math.random() * 1000 });
  }

  beam(key: string, fromX: number, fromY: number, toX: number, toY: number): void {
    const v = effectVisual(key);
    this.lasting.push({ visual: v, x: fromX, y: fromY, toX, toY, radius: 0, age: 0, life: Math.max(0.15, v.duration), seed: Math.random() * 1000 });
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
      if (e.telegraph) {
        // L'ombre grossit jusqu'à l'impact ; le contour clignote de plus en plus vite.
        ground.fillStyle(0x000000, 0.25 + 0.25 * k).fillEllipse(e.x * S, e.y * S, e.radius * 2 * S * (0.4 + 0.6 * k), e.radius * 1.4 * S * (0.4 + 0.6 * k));
        if (Math.floor(e.age * (6 + 14 * k)) % 2 === 0) {
          ground.lineStyle(S, color, 0.9).strokeEllipse(e.x * S, e.y * S, e.radius * 2 * S, e.radius * 1.4 * S);
        }
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
          g.lineStyle(v.size * S, color, 1 - k).strokeCircle(e.x * S, e.y * S, e.radius * S * (0.3 + 0.7 * k));
          g.fillStyle(accent, 0.5 * (1 - k)).fillCircle(e.x * S, e.y * S, e.radius * S * 0.6 * (1 - k));
          break;
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
    const lift = Math.sin(k * Math.PI) * p.arc;
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
