// Réalisateur : la caméra suit brièvement un héros lors d'un moment spectaculaire, puis revient
// sur l'arène entière. Uniquement visuel : le combat simulé ne change pas.
import type Phaser from 'phaser';
import type { Staging } from './manifest';

type Moment = 'heroDeath' | 'heroDuel' | 'heroCharge' | 'misfire' | 'lastStand';

interface Shot {
  /** Position écran suivie (appelée à chaque image : la cible bouge). */
  target: () => { x: number; y: number };
  /** Fin du plan, en secondes de combat. */
  until: number;
  priority: number;
}

const PRIORITY: Record<Moment, number> = { misfire: 1, heroCharge: 1, heroDuel: 2, heroDeath: 3, lastStand: 4 };

export class Director {
  private shot: Shot | null = null;
  private readyAt = 0;
  private x: number;
  private y: number;

  constructor(
    private readonly cam: Phaser.Cameras.Scene2D.Camera,
    private readonly config: Staging['camera'],
    private readonly width: number,
    private readonly height: number,
  ) {
    this.x = width / 2;
    this.y = height / 2;
    cam.setBounds(0, 0, width, height);
  }

  /** Demande un plan rapproché. Ignoré pendant le temps de repos, sauf s'il est plus important que le plan en cours. */
  request(moment: Moment, target: () => { x: number; y: number }, now: number, hold = this.config.hold): void {
    if (!this.config.enabled || !this.config.triggers[moment]) return;
    const priority = PRIORITY[moment];
    if (this.shot && this.shot.priority >= priority) return;
    if (!this.shot && now < this.readyAt && priority < PRIORITY.lastStand) return;
    this.shot = { target, until: now + hold, priority };
  }

  /** Retour immédiat au plan large (fin de combat, cartons). */
  release(now: number): void {
    this.shot = null;
    this.readyAt = now;
  }

  update(now: number): void {
    if (this.shot && now >= this.shot.until) {
      this.shot = null;
      this.readyAt = now + this.config.cooldown;
    }
    const wide = { x: this.width / 2, y: this.height / 2 };
    const focus = this.shot ? this.shot.target() : wide;
    const zoom = this.shot ? this.config.zoom : 1;
    const k = this.config.follow;
    this.x += (focus.x - this.x) * k;
    this.y += (focus.y - this.y) * k;
    this.cam.setZoom(this.cam.zoom + (zoom - this.cam.zoom) * k);
    this.cam.centerOn(this.x, this.y);
  }
}
