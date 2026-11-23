// Réalisateur : la caméra suit brièvement un héros lors d'un moment spectaculaire, puis revient
// sur l'arène entière. Uniquement visuel : le combat simulé ne change pas.
import type Phaser from 'phaser';
import type { Staging } from './manifest';
import { SAFE } from './safeZone';

type Moment = 'heroDeath' | 'heroDuel' | 'heroCharge' | 'misfire' | 'lastStand' | 'bigImpact';

interface Shot {
  /** Position écran suivie (appelée à chaque image : la cible bouge). */
  target: () => { x: number; y: number };
  /** Fin du plan, en secondes de combat. */
  until: number;
  priority: number;
  /** Zoom propre au plan (ralenti de cinéma), sinon celui du manifeste. */
  zoom?: number;
}

const PRIORITY: Record<Moment, number> = { misfire: 1, heroCharge: 1, bigImpact: 2, heroDuel: 2, heroDeath: 3, lastStand: 4 };
/** Plans de cinéma (ralenti du dernier K.O., plan du vainqueur) : rien ne les interrompt. */
const CINEMA = 5;

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
    /** Plafond de durée d'un gros plan (s de combat) : un plan rapproché reste un plan court. */
    private readonly maxShot = 1.5,
  ) {
    this.x = width / 2;
    this.y = height / 2;
    // Un peu de marge à droite : une cible collée au bord peut être recadrée à gauche du rail des boutons.
    cam.setBounds(0, 0, width + SAFE.right / 2, height);
  }

  /** Demande un plan rapproché. Ignoré pendant le temps de repos, sauf s'il est plus important que le plan en cours. */
  request(moment: Moment, target: () => { x: number; y: number }, now: number, hold = this.config.hold): void {
    if (!this.config.enabled || !this.config.triggers[moment]) return;
    const priority = PRIORITY[moment];
    if (this.shot && this.shot.priority >= priority) return;
    if (!this.shot && now < this.readyAt && priority < PRIORITY.lastStand) return;
    this.shot = { target, until: now + Math.min(hold, this.maxShot), priority };
  }

  /** Plan imposé (ralenti, vainqueur) : zoom et durée propres, au-dessus de tout autre plan. */
  cinema(target: () => { x: number; y: number }, now: number, hold: number, zoom: number): void {
    if (!this.config.enabled) return;
    this.shot = { target, until: now + hold, priority: CINEMA, zoom };
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
    const zoom = this.shot ? (this.shot.zoom ?? this.config.zoom) : 1;
    let focus = wide;
    if (this.shot) {
      // La cible apparaît au centre de la zone utile (y 860), pas au milieu du canvas (960).
      const t = this.shot.target();
      focus = { x: t.x, y: t.y + (this.height / 2 - SAFE.centerY) / zoom };
    }
    const k = this.config.follow;
    this.x += (focus.x - this.x) * k;
    this.y += (focus.y - this.y) * k;
    this.cam.setZoom(this.cam.zoom + (zoom - this.cam.zoom) * k);
    this.cam.centerOn(this.x, this.y);
  }
}
