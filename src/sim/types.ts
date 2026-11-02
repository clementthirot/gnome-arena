// Types publics du moteur : ce que le rendu et les outils ont le droit de lire.
import type { AttackDef, EffectDef, EquipmentDef, PersonalityDef, RoleDef, TeamId } from '../data/schema';

/** Les 5 états de la machine à états d'une entité. */
export type UnitState = 'choose' | 'approach' | 'attack' | 'flee' | 'dead';

export interface Unit {
  readonly index: number;
  readonly team: TeamId;
  readonly defId: string;
  readonly visual: string;
  readonly role: RoleDef;
  readonly personality: PersonalityDef;
  /** Défini pour les héros uniquement. */
  readonly hero?: { id: string; name: string; label: string };
  readonly radius: number;
  readonly mass: number;
  readonly maxHp: number;
  readonly damage: number;
  readonly speed: number;
  /** Upgrades portées (héros). */
  readonly equipment: readonly EquipmentDef[];

  x: number;
  y: number;
  /** Vitesse volontaire (px/s). */
  vx: number;
  vy: number;
  /** Vitesse de recul subie, amortie dans le temps. */
  kx: number;
  ky: number;
  /** Direction du regard (-1 gauche, 1 droite), pour le rendu. */
  facing: number;
  hp: number;
  morale: number;
  state: UnitState;
  target: number;
  retargetIn: number;
  attackCooldowns: number[];
  /** Temps restant de panique ou de charge. */
  stateTimer: number;
  charging: boolean;
  chargeCooldown: number;
  chargeDir: { x: number; y: number };
  /** Ruée téméraire en cours (un peureux qui se jette dans la mêlée). */
  rushTimer: number;
  /** Hauteur au-dessus du sol (0 = au sol) et vitesse verticale : unité projetée en l'air. */
  z: number;
  vz: number;
  /** Étourdissement restant après un atterrissage. */
  stunTimer: number;
  /** Temps passé à approcher sans se rapprocher (bloqué par la foule). */
  blockedTime: number;
  lastGap: number;
  /** Recharge de l'attaque spéciale de chaque équipement. */
  specialCooldowns: number[];
  /** Ralentissement en cours (glu, boue). */
  slowUntil: number;
  slowFactor: number;
  kills: number;
  damageDealt: number;
  deathTime: number;
}

export interface Projectile {
  readonly id: number;
  /** Camp épargné ; null = touche tout le monde. */
  readonly team: TeamId | null;
  /** Tireur, ou -1 pour un incident d'arène. */
  readonly owner: number;
  /** Flèche ordinaire : attaque du rôle et dégâts déjà tirés. */
  readonly attack?: AttackDef;
  readonly damage: number;
  /** Projectile d'effet : effets déclenchés à l'impact. */
  readonly effects?: readonly EffectDef[];
  readonly visual: string;
  readonly arc: number;
  /** Tombe du ciel (météore) : le rendu le fait chuter en accélérant au lieu de suivre une cloche. */
  readonly fall?: boolean;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly flightTime: number;
  age: number;
  x: number;
  y: number;
  done: boolean;
}

/** Événements émis pendant un tick, consommés par le rendu (animations) et les mesures. */
export type BattleEvent =
  | { type: 'attack'; unit: number; target: number; kind: 'melee' | 'ranged' }
  | { type: 'hit'; unit: number; source: number; damage: number; knockback: number }
  | { type: 'miss'; x: number; y: number; source: number }
  | { type: 'charge'; unit: number }
  | { type: 'impact'; unit: number; x: number; y: number }
  | { type: 'panic'; unit: number }
  | { type: 'rush'; unit: number }
  | { type: 'death'; unit: number; killer: number }
  | { type: 'zone'; scale: number }
  | { type: 'special'; unit: number; equipment: string; misfire: boolean }
  | { type: 'effect'; visual: string; x: number; y: number; radius: number; source: number }
  | { type: 'beam'; visual: string; fromX: number; fromY: number; toX: number; toY: number; width?: number }
  | { type: 'launch'; unit: number }
  | { type: 'bounce'; unit: number; x: number; y: number; impact: number }
  /** Le rayon se charge : sa trajectoire complète, dessinée avant le tir. */
  | { type: 'beamCharge'; visual: string; width: number; duration: number; source: number; segments: BeamSegment[] }
  | { type: 'spawn'; unit: number }
  | { type: 'land'; unit: number; x: number; y: number; impact: number; dead: boolean }
  | { type: 'telegraph'; event: string; visual: string; x: number; y: number; radius: number; duration: number }
  /** Annonce d'un incident (au moment où son télégraphe apparaît). */
  | { type: 'incident'; event: string; label: string; visual: string; x: number; y: number }
  | { type: 'end'; winner: TeamId | 'draw'; reason: 'elimination' | 'timeout' };

export interface BeamSegment {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface FieldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BattleResult {
  winner: TeamId | 'draw';
  reason: 'elimination' | 'timeout';
  duration: number;
  survivors: Record<TeamId, number>;
}
