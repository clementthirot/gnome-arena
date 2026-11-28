// Blizzard : la zone qui se resserre devient une tempête de neige et de grêle qui cingle tout ce qui est
// dehors, gradins compris. Même rôle que le gaz (gas.ts), autre habillage, choisi par staging.gas.style = "blizzard".
// La tempête monte peu à peu jusqu'à devenir intense, puis s'estompe quand le combat est fini.
// Le ciel bouché et la congère sont peints sous les unités (calque `ground`), la neige et la grêle par-dessus.
// Purement visuel : les dégâts hors zone restent ceux du moteur.
import type Phaser from 'phaser';
import type { FieldRect } from '../sim/types';
import type { Staging } from './manifest';
import { rand } from './random';
import { sound } from './audio';

/** Flocon poussé par le vent : dessiné en trait (traînée de vitesse). */
interface Flake {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** Longueur de la traînée (s de trajet), épaisseur et teinte. */
  trail: number;
  thick: number;
  tone: number;
}

/** Grêlon qui tombe en biais et rebondit au sol. */
interface Hail {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  bounced: boolean;
  age: number;
}

/** Éclat au sol (grêlon qui éclate, neige qui gicle). */
interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

/** Rafale de neige : gros nuage blanc qui balaie la bande extérieure. */
interface Gust {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  life: number;
}

const hex = (c: string) => parseInt(c.slice(1), 16);

export class BlizzardLayer {
  private flakes: Flake[] = [];
  private hail: Hail[] = [];
  private shards: Shard[] = [];
  private gusts: Gust[] = [];
  private flakeDebt = 0;
  private hailDebt = 0;
  private gustDebt = 0;
  /** Horloge de combat de la tempête (s), pour les rafales. */
  private clock = 0;
  private strength = 0;
  /** Temps écoulé depuis le début du resserrement (s) : la tempête monte avec lui. */
  private elapsed = 0;
  /** Givre accumulé hors zone (0 à 1) : le sol blanchit à mesure que la tempête dure. */
  private frost = 0;

  /**
   * @param g calque au-dessus des unités (neige, grêle, rafales)
   * @param ground calque sous les unités (ciel bouché, congère le long de la limite)
   * @param field terrain de combat ; @param world toute l'arène, gradins compris (la tempête y souffle aussi)
   */
  constructor(
    private readonly g: Phaser.GameObjects.Graphics,
    private readonly ground: Phaser.GameObjects.Graphics,
    private readonly field: FieldRect,
    private readonly world: FieldRect,
    private readonly config: Staging['gas'],
    private readonly scale: number,
  ) {}

  /** Force actuelle de la tempête (0 = calme, ~1,3 = au plus fort). */
  get intensity(): number {
    return this.strength;
  }

  /** Direction du vent (unitaire) et force des rafales à l'instant t : le vent tourne un peu et souffle par à-coups. */
  private wind(t: number): { x: number; y: number; gust: number } {
    const a = 0.45 + Math.sin(t * 0.35) * 0.25;
    const gust = 0.75 + 0.25 * Math.sin(t * 2.1) + 0.2 * Math.max(0, Math.sin(t * 0.9 + 1.3));
    return { x: Math.cos(a), y: Math.sin(a), gust };
  }

  /** Point au hasard hors zone, gradins compris (rejet simple : la zone ne couvre qu'une partie de l'arène). */
  private outside(zone: FieldRect): { x: number; y: number } | null {
    const f = this.world;
    for (let k = 0; k < 6; k++) {
      const x = f.x + rand() * f.width;
      const y = f.y + rand() * f.height;
      if (!this.inZone(zone, x, y)) return { x, y };
    }
    return null;
  }

  private inZone(z: FieldRect, x: number, y: number, margin = 0): boolean {
    return x > z.x + margin && x < z.x + z.width - margin && y > z.y + margin && y < z.y + z.height - margin;
  }

  /**
   * Tire les flocons, grêlons et rafales. Appelé à chaque tick de simulation : le tirage ne dépend ni du
   * framerate ni de ?speed, comme le gaz.
   */
  emit(dt: number, zoneScale: number, zone?: FieldRect, over = false): void {
    if (dt <= 0) return;
    this.clock += dt;
    if (zoneScale < 1) this.elapsed += dt;
    // Quelques flocons quand la zone bouge, puis la tempête forcit pendant ~18 s et redouble à mesure que la
    // zone se resserre. Combat fini : elle retombe en quelques secondes.
    const ramp = Math.min(1, this.elapsed / 18);
    const target = over || zoneScale >= 1 ? 0 : Math.min(1.3, 0.12 + ramp * ramp * 0.75 + (1 - zoneScale) * 0.45);
    const rate = over ? 0.7 : target > this.strength ? 0.8 : 1.5;
    this.strength += (target - this.strength) * Math.min(1, dt * rate);
    if (zoneScale < 1 && !over) this.frost = Math.min(1, this.frost + dt * 0.05 * Math.min(1, this.strength));
    if (over) this.frost = Math.max(0, this.frost - dt * 0.2);
    if (this.strength < 0.02 || !zone) return;
    const f = this.world;
    const band = 1 - (zone.width * zone.height) / (f.width * f.height);
    const w = this.wind(this.clock);
    const speed = 260 * w.gust * (0.8 + this.strength * 0.4);
    const flow = this.config.ventRate / 3;

    this.flakeDebt += dt * 1100 * band * this.strength * flow;
    while (this.flakeDebt >= 1 && this.flakes.length < 1400) {
      this.flakeDebt -= 1;
      const p = this.outside(zone);
      if (!p) continue;
      const s = speed * (0.7 + rand() * 0.6);
      const jitter = (rand() - 0.5) * 0.35;
      this.flakes.push({
        x: p.x,
        y: p.y,
        vx: (w.x - w.y * jitter) * s,
        vy: (w.y + w.x * jitter) * s,
        age: 0,
        life: 0.25 + rand() * 0.35,
        trail: 0.03 + rand() * 0.04,
        thick: rand() < 0.3 ? 2 : 1.25,
        tone: rand(),
      });
    }

    this.hailDebt += dt * 110 * band * this.strength * flow;
    while (this.hailDebt >= 1 && this.hail.length < 160) {
      this.hailDebt -= 1;
      const p = this.outside(zone);
      if (!p) continue;
      const z = 40 + rand() * 40;
      // Le grêlon part en amont du vent pour toucher le sol au point tiré.
      const fall = 320 + rand() * 120;
      const tFall = z / fall;
      const vx = w.x * speed * 0.45;
      const vy = w.y * speed * 0.45;
      this.hail.push({ x: p.x - vx * tFall, y: p.y - vy * tFall, z, vx, vy, vz: -fall, size: rand() < 0.35 ? 2.4 : 1.6, bounced: false, age: 0 });
    }

    this.gustDebt += dt * 2.2 * this.strength * w.gust;
    while (this.gustDebt >= 1) {
      this.gustDebt -= 1;
      // Les rafales entrent par le bord au vent et traversent le terrain.
      const fromLeft = rand() < Math.abs(w.x) / (Math.abs(w.x) + Math.abs(w.y));
      const x = fromLeft ? f.x - 10 : f.x + rand() * f.width;
      const y = fromLeft ? f.y + rand() * f.height : f.y - 10;
      const s = speed * 0.55;
      this.gusts.push({ x, y, vx: w.x * s, vy: w.y * s, r: 18 + rand() * 18, age: 0, life: 1.6 + rand() * 0.8 });
    }
    if (rand() < dt * 1.4 * this.strength) sound.play('wind');
  }

  update(dt: number, zone: FieldRect): void {
    const g = this.g;
    const S = this.scale;
    const f = this.world;
    g.clear();
    this.ground.clear();
    if (this.strength < 0.02 && !this.flakes.length && !this.hail.length && !this.gusts.length) return;
    const color = hex(this.config.color);
    const accent = hex(this.config.accent);
    const w = this.wind(this.clock);
    const inside = (x: number, y: number) => this.inZone(zone, x, y);

    // Ciel bouché hors zone, gradins compris : le sol s'assombrit (la neige blanche ressort même sur un sol
    // enneigé), plus fort pendant les rafales et à mesure que la tempête dure. Peint sous les unités : les
    // combattants et le public restent nets par-dessus.
    const veil = Math.min(0.6, (0.28 + this.frost * 0.14 + (w.gust - 0.75) * 0.3) * Math.min(1, this.strength * 1.6));
    if (veil > 0 && zone.width < this.field.width) {
      const gr = this.ground;
      gr.fillStyle(hex(this.config.shade), veil);
      gr.fillRect(f.x * S, f.y * S, f.width * S, (zone.y - f.y) * S);
      gr.fillRect(f.x * S, (zone.y + zone.height) * S, f.width * S, (f.y + f.height - zone.y - zone.height) * S);
      gr.fillRect(f.x * S, zone.y * S, (zone.x - f.x) * S, zone.height * S);
      gr.fillRect((zone.x + zone.width) * S, zone.y * S, (f.x + f.width - zone.x - zone.width) * S, zone.height * S);
      // Congère le long de la limite : liseré de neige tassée contre le mur invisible.
      gr.fillStyle(accent, Math.min(0.85, veil * 1.8));
      const t = 3 * S;
      gr.fillRect(zone.x * S - t, zone.y * S - t, zone.width * S + 2 * t, t);
      gr.fillRect(zone.x * S - t, (zone.y + zone.height) * S, zone.width * S + 2 * t, t);
      gr.fillRect(zone.x * S - t, zone.y * S, t, zone.height * S);
      gr.fillRect((zone.x + zone.width) * S, zone.y * S, t, zone.height * S);
    }

    // Rafales : grands nuages blancs qui ne pénètrent pas dans la zone saine.
    for (let i = this.gusts.length - 1; i >= 0; i--) {
      const p = this.gusts[i];
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += 10 * dt;
      if (p.age >= p.life || p.x > f.x + f.width + 40 || p.y > f.y + f.height + 40) {
        this.gusts.splice(i, 1);
        continue;
      }
      if (inside(p.x, p.y)) continue;
      const k = p.age / p.life;
      const a = Math.min(1, k * 5) * (1 - k) * 0.3;
      g.fillStyle(accent, a).fillCircle(p.x * S, p.y * S, p.r * S);
      g.fillStyle(color, a * 0.8).fillCircle((p.x + p.r * 0.5) * S, (p.y - p.r * 0.2) * S, p.r * 0.7 * S);
    }

    // Neige cinglante : traits orientés dans le vent, invisibles dans la zone saine.
    for (let i = this.flakes.length - 1; i >= 0; i--) {
      const p = this.flakes[i];
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.age >= p.life || p.x > f.x + f.width || p.y > f.y + f.height) {
        this.flakes.splice(i, 1);
        continue;
      }
      if (inside(p.x, p.y)) continue;
      const k = p.age / p.life;
      const a = Math.min(1, k * 6) * (1 - k * 0.6);
      const tx = p.x - p.vx * p.trail;
      const ty = p.y - p.vy * p.trail;
      g.lineStyle(p.thick * S * 0.6, p.tone < 0.7 ? 0xffffff : color, 0.9 * a);
      g.lineBetween(tx * S, ty * S, p.x * S, p.y * S);
    }

    // Grêle : chute en biais avec son ombre, éclate au sol et rebondit une fois.
    for (let i = this.hail.length - 1; i >= 0; i--) {
      const h = this.hail[i];
      h.age += dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.z += h.vz * dt;
      if (h.bounced) h.vz -= 500 * dt;
      if (h.z <= 0) {
        h.z = 0;
        if (h.bounced || inside(h.x, h.y)) {
          this.hail.splice(i, 1);
          continue;
        }
        h.bounced = true;
        h.vz = 70 + (h.size > 2 ? 30 : 0);
        h.vx *= 0.3;
        h.vy *= 0.3;
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + h.age * 7;
          this.shards.push({ x: h.x, y: h.y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 25 - 10, age: 0, life: 0.22 });
        }
        if (h.size > 2) sound.play('hail');
      }
      if (inside(h.x, h.y)) continue;
      const sz = h.size * S;
      g.fillStyle(0x000000, 0.18).fillRect(h.x * S - sz / 2, h.y * S - sz / 4, sz, sz / 2);
      g.fillStyle(0xffffff, 1).fillRect(h.x * S - sz / 2, (h.y - h.z) * S - sz / 2, sz, sz);
      g.fillStyle(color, 1).fillRect(h.x * S - sz / 2, (h.y - h.z) * S + sz / 4, sz, sz / 4);
    }

    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.age += dt;
      if (s.age >= s.life) {
        this.shards.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      g.fillStyle(0xffffff, 1 - s.age / s.life).fillRect(s.x * S, s.y * S, S * 0.75, S * 0.75);
    }
  }
}
