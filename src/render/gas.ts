// Gaz toxique : la zone qui se resserre devient un nuage vert craché par des conduits dans les murets.
// Purement visuel : les dégâts hors zone restent ceux du moteur.
import type Phaser from 'phaser';
import type { FieldRect } from '../sim/types';
import type { Staging } from './manifest';
import { rand } from './random';

interface Vent {
  x: number;
  y: number;
  /** Direction de sortie du gaz, vers l'intérieur du terrain. */
  nx: number;
  ny: number;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  life: number;
  tone: number;
  spin: number;
  image?: Phaser.GameObjects.Image;
}

const hex = (c: string) => parseInt(c.slice(1), 16);

export class GasLayer {
  private readonly vents: Vent[];
  private puffs: Puff[] = [];
  private emitDebt = 0;
  /** Textures de bouffée chargées (gas_puff_<i>) ; vide = disques dessinés. */
  private readonly textures: string[];

  constructor(
    private readonly g: Phaser.GameObjects.Graphics,
    private readonly pipes: Phaser.GameObjects.Graphics,
    field: FieldRect,
    private readonly config: Staging['gas'],
    private readonly scale: number,
  ) {
    const f = field;
    this.vents = [
      { x: f.x + f.width * 0.25, y: f.y, nx: 0, ny: 1 },
      { x: f.x + f.width * 0.75, y: f.y, nx: 0, ny: 1 },
      { x: f.x + f.width * 0.25, y: f.y + f.height, nx: 0, ny: -1 },
      { x: f.x + f.width * 0.75, y: f.y + f.height, nx: 0, ny: -1 },
      { x: f.x, y: f.y + f.height * 0.35, nx: 1, ny: 0 },
      { x: f.x, y: f.y + f.height * 0.65, nx: 1, ny: 0 },
      { x: f.x + f.width, y: f.y + f.height * 0.35, nx: -1, ny: 0 },
      { x: f.x + f.width, y: f.y + f.height * 0.65, nx: -1, ny: 0 },
    ];
    this.textures = config.sprites.map((_, i) => `gas_puff_${i}`).filter((k) => g.scene.textures.exists(k));
    this.drawPipes();
  }

  /** Bouches de conduits dans le muret, en pixel art. */
  private drawPipes(): void {
    const S = this.scale;
    const p = this.pipes;
    for (const v of this.vents) {
      const horizontal = v.ny !== 0;
      const w = horizontal ? 10 : 5;
      const h = horizontal ? 5 : 10;
      const x = v.x - w / 2 + v.nx * 1.5;
      const y = v.y - h / 2 + v.ny * 1.5;
      p.fillStyle(0x2a2a32, 1).fillRect((x - 1) * S, (y - 1) * S, (w + 2) * S, (h + 2) * S);
      p.fillStyle(0x6a6a76, 1).fillRect(x * S, y * S, w * S, h * S);
      p.fillStyle(0x8a8a96, 1).fillRect(x * S, y * S, w * S, S);
      // Bouche sombre côté terrain, grille.
      const mx = v.x - (horizontal ? 3 : 1.5) + v.nx * 3;
      const my = v.y - (horizontal ? 1.5 : 3) + v.ny * 3;
      p.fillStyle(0x101014, 1).fillRect(mx * S, my * S, (horizontal ? 6 : 3) * S, (horizontal ? 3 : 6) * S);
      p.fillStyle(0x4a4a52, 1);
      for (let k = 1; k < 3; k++) {
        if (horizontal) p.fillRect((mx + k * 2) * S, my * S, S, 3 * S);
        else p.fillRect(mx * S, (my + k * 2) * S, 3 * S, S);
      }
    }
  }

  /**
   * Les conduits crachent dès que la zone se resserre, de plus en plus fort. Appelé à chaque tick de
   * simulation (pas à chaque image) : les bouffées tirées ne dépendent ni du framerate ni de ?speed.
   */
  emit(dt: number, zoneScale: number): void {
    if (zoneScale < 1 && dt > 0) {
      this.emitDebt += dt * this.config.ventRate * this.vents.length * (1 + (1 - zoneScale) * 2);
      while (this.emitDebt >= 1) {
        this.emitDebt -= 1;
        const v = this.vents[Math.floor(rand() * this.vents.length)];
        const speed = 25 + rand() * 35;
        const side = (rand() - 0.5) * 30;
        this.puffs.push({
          x: v.x + v.nx * 4,
          y: v.y + v.ny * 4,
          vx: v.nx * speed + (v.ny !== 0 ? side : 0),
          vy: v.ny * speed + (v.nx !== 0 ? side : 0),
          r: 3 + rand() * 3,
          age: 0,
          life: this.config.puffLife * (0.7 + rand() * 0.6),
          tone: rand(),
          spin: (rand() - 0.5) * 1.2,
        });
      }
    }
  }

  update(dt: number, zone: FieldRect): void {
    const g = this.g;
    const S = this.scale;
    g.clear();
    const color = hex(this.config.color);
    const accent = hex(this.config.accent);
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 0.8 * dt;
      p.vy *= 1 - 0.8 * dt;
      p.r += 6 * dt;
      // Le nuage ne déborde pas dans la zone saine : il s'y dissipe vite.
      const inside = p.x > zone.x + 3 && p.x < zone.x + zone.width - 3 && p.y > zone.y + 3 && p.y < zone.y + zone.height - 3;
      if (inside) p.age += dt * 4;
      if (p.age >= p.life) {
        p.image?.destroy();
        this.puffs.splice(i, 1);
        continue;
      }
      const k = p.age / p.life;
      const alpha = Math.min(1, k * 4) * (1 - k);
      if (this.textures.length) {
        // Bouffée PixelLab : grossit, tourne lentement, s'efface.
        p.image ??= g.scene.add.image(0, 0, this.textures[Math.floor(p.tone * this.textures.length)]).setDepth(g.depth).setFlipX(p.spin < 0);
        p.image.setPosition(p.x * S, p.y * S).setDisplaySize(p.r * 2.4 * S, p.r * 2.4 * S).setRotation(p.spin * p.age).setAlpha(0.6 * alpha);
      } else {
        g.fillStyle(p.tone < 0.5 ? color : accent, 0.32 * alpha).fillCircle(p.x * S, p.y * S, p.r * S);
      }
    }
  }
}
