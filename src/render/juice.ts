// « Juice » cartoon : étoiles au-dessus des étourdis, gouttes de sueur des fuyards, débris,
// objets perdus qui restent au sol, flaques qui sèchent. Uniquement visuel ; le hasard vient de
// random.ts (tiré de la seed), donc la même seed donne la même vidéo.
import type Phaser from 'phaser';
import type { Unit } from '../sim/types';
import type { Particle } from './animations';
import type { Staging } from './manifest';
import { DARK_OUTLINE } from './pixels';
import { rand } from './random';

const hex = (c: string) => parseInt(c.slice(1), 16);

/** Flaque en pixel art : une tache irrégulière dont le bord est tramé, pour se fondre dans le sable. */
function puddleCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const bumps = Array.from({ length: 6 }, () => 0.75 + rand() * 0.35);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / (w / 2);
      const dy = (y - cy) / (h / 2);
      const a = Math.atan2(dy, dx);
      const edge = bumps[Math.floor(((a + Math.PI) / (Math.PI * 2)) * bumps.length) % bumps.length];
      const d = Math.hypot(dx, dy) / edge;
      if (d > 1) continue;
      // Bord tramé (un pixel sur deux), cœur plein.
      if (d > 0.75 && (x + y) % 2 === 1) continue;
      ctx.fillStyle = d < 0.45 ? '#ffffff' : '#d8d8d8';
      ctx.fillRect(x, y, 1, 1);
    }
  return canvas;
}

function hatCanvas(color: string): HTMLCanvasElement {
  const art = ['..o..', '.oco.', '.occo', 'occco', 'ooooo'];
  const canvas = document.createElement('canvas');
  canvas.width = 5;
  canvas.height = 5;
  const ctx = canvas.getContext('2d')!;
  art.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = ch === 'o' ? DARK_OUTLINE : color;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return canvas;
}

export class Juice {
  private readonly status: Phaser.GameObjects.Graphics;
  private readonly litterGfx: Phaser.GameObjects.Graphics;
  private litter = 0;
  private puddleKeys: string[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly particles: Particle[],
    private readonly scale: number,
    private readonly config: Staging['juice'],
    private readonly gore: Staging['gore'],
  ) {
    this.status = scene.add.graphics().setDepth(9700);
    this.litterGfx = scene.add.graphics().setDepth(-415);
    for (let i = 0; i < 4; i++) {
      const key = `puddle_${i}`;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      scene.textures.addCanvas(key, puddleCanvas(10 + i * 2, 6 + i));
      this.puddleKeys.push(key);
    }
    for (const [team, color] of [['gnomes', '#d83b3b'], ['goblins', '#a8b0bc']] as const) {
      const key = `lost_hat_${team}`;
      if (!scene.textures.exists(key)) scene.textures.addCanvas(key, hatCanvas(color));
    }
  }

  /** Flaque qui s'étale puis sèche et vire au brun. */
  puddle(x: number, y: number, radius: number, big: boolean): void {
    if (!this.gore.enabled) return;
    const S = this.scale;
    const key = this.puddleKeys[Math.floor(rand() * this.puddleKeys.length)];
    const size = (radius * this.gore.puddle * (big ? 1.5 : 1)) / 6;
    const img = this.scene.add.image(x * S, (y + 1) * S, key).setDepth(-420).setScale(0.1).setFlipX(rand() < 0.5);
    const wet = hex(this.gore.color);
    const dry = hex(this.gore.dryColor);
    img.setTint(wet);
    this.scene.tweens.add({ targets: img, scale: S * size, duration: 900, ease: 'Quad.easeOut' });
    const fade = { k: 0 };
    this.scene.tweens.add({
      targets: fade,
      k: 1,
      delay: 1200,
      duration: this.gore.dryAfter * 1000,
      onUpdate: () => {
        const mix = (a: number, b: number, s: number) => Math.round(((a >> s) & 255) * (1 - fade.k) + ((b >> s) & 255) * fade.k) << s;
        img.setTint(mix(wet, dry, 16) | mix(wet, dry, 8) | mix(wet, dry, 0));
        img.setAlpha(1 - 0.35 * fade.k);
      },
    });
  }

  /** Débris éphémères projetés en cloche : dents, mottes de terre. */
  debris(x: number, y: number, count: number): void {
    const n = Math.min(count, Math.max(0, this.config.maxParticles - this.particles.length));
    for (let i = 0; i < n; i++) {
      const tooth = rand() < 0.35;
      const a = -Math.PI / 2 + (rand() - 0.5) * 2.2;
      const v = 50 + rand() * 60;
      this.particles.push({ x, y: y - 3, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.7, maxLife: 0.7, color: tooth ? 0xf8f4e8 : 0x8a6a40, size: tooth ? 1 : 2 });
    }
  }

  /** Bonnet ou casque qui tombe et reste au sol. */
  dropItem(u: Unit, x: number, y: number): void {
    if (this.litter >= this.config.maxLitter || rand() > this.config.itemChance) return;
    this.litter++;
    const S = this.scale;
    const img = this.scene.add.image(x * S, (y - 4) * S, `lost_hat_${u.team}`).setScale(S).setDepth(9600);
    const tx = x + (rand() - 0.5) * 16;
    const ty = y + 2 + (rand() - 0.5) * 6;
    this.scene.tweens.add({ targets: img, x: tx * S, duration: 450 });
    this.scene.tweens.add({
      targets: img,
      y: [(y - 14) * S, ty * S],
      angle: (rand() < 0.5 ? -1 : 1) * (90 + rand() * 120),
      duration: 450,
      ease: 'Sine.easeIn',
      onComplete: () => img.setDepth(-414),
    });
  }

  /** Flèche plantée dans le sable. */
  plantArrow(x: number, y: number, dirX: number, dirY: number): void {
    if (this.litter >= this.config.maxLitter) return;
    this.litter++;
    const S = this.scale;
    const g = this.litterGfx;
    const l = Math.hypot(dirX, dirY) || 1;
    g.lineStyle(S, 0x6a4a2a, 1).lineBetween(x * S, y * S, (x - (dirX / l) * 3) * S, (y - (dirY / l) * 3 - 2) * S);
    g.fillStyle(0xf4f0e0, 1).fillRect((x - (dirX / l) * 3) * S - S / 2, (y - (dirY / l) * 3 - 2) * S - S / 2, S, S);
  }

  /** Étoiles au-dessus des étourdis, goutte de sueur sur les fuyards. */
  drawStatus(units: readonly Unit[], views: { sprite: Phaser.GameObjects.Sprite }[], now: number): void {
    const g = this.status;
    const S = this.scale;
    g.clear();
    for (const u of units) {
      if (u.state === 'dead' || !views[u.index]) continue;
      const s = views[u.index].sprite;
      const top = s.y - s.displayHeight * 0.8;
      if (this.config.stars && u.stunTimer > 0) {
        for (let k = 0; k < 3; k++) {
          const a = now / 160 + (k * Math.PI * 2) / 3;
          const px = s.x + Math.cos(a) * u.radius * S * 1.2;
          const py = top + Math.sin(a) * S * 1.5;
          g.fillStyle(0xffe14a, 1).fillRect(px - S, py, S * 2, S / 2 + 1).fillRect(px - S / 4, py - S / 2 - 1, S / 2 + 1, S * 1.5);
        }
      }
      if (this.config.sweat && u.state === 'flee' && Math.floor(now / 250 + u.index) % 3 !== 0) {
        const px = s.x - u.facing * u.radius * S;
        const py = top + ((now / 8 + u.index * 37) % 20);
        g.fillStyle(0x8ad0ff, 1).fillRect(px, py, S, S * 1.5).fillRect(px - S / 2, py + S, S * 2, S);
      }
    }
  }
}
