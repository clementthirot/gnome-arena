// Bibliothèque d'effets : les seules briques de comportement que les données peuvent combiner.
// Un équipement ou un événement n'est qu'une liste d'effets ; aucun code spécifique par élément.
import type { EffectDef, TeamId, Tuning } from '../data/schema';
import { hypot } from './detmath';
import type { BattleEvent, BeamSegment, FieldRect, Unit } from './types';

/** Ce dont un effet a besoin du moteur. Implémenté par Battle. */
export interface EffectHost {
  readonly units: readonly Unit[];
  readonly maxRadius: number;
  readonly tuning: Tuning;
  readonly field: FieldRect;
  launchUnit(u: Unit, lift: number): void;
  random(): number;
  queryUnits(x: number, y: number, radius: number, visit: (u: Unit) => void): void;
  rollDamage(source: Unit, base: number): number;
  damage(target: Unit, amount: number, source: Unit | null, dirX: number, dirY: number, knockback: number): void;
  spawnEffectProjectile(effect: Extract<EffectDef, { type: 'projectile' }>, ctx: EffectContext): void;
  spawnReinforcements(effect: Extract<EffectDef, { type: 'spawn' }>, ctx: EffectContext): void;
  /** Exécute une action plus tard (en secondes de combat), dans l'ordre des demandes. */
  defer(delay: number, run: () => void): void;
  emit(event: BattleEvent): void;
  readonly time: number;
}

export interface EffectContext {
  /** Unité à l'origine de l'effet (null pour un incident d'arène). */
  source: Unit | null;
  /** Camp épargné ; null = tout le monde est touché (incident, tir raté). */
  team: TeamId | null;
  x: number;
  y: number;
  /** Unité visée, si l'effet vise quelqu'un en particulier. */
  target?: Unit;
  /** Point de départ des projectiles. */
  fromX: number;
  fromY: number;
}

const alive = (u: Unit) => u.state !== 'dead';

function canHit(u: Unit, ctx: EffectContext, friendlyFire: boolean): boolean {
  return alive(u) && (friendlyFire || ctx.team === null || u.team !== ctx.team);
}

function nearestAt(host: EffectHost, x: number, y: number, reach: number, accept: (u: Unit) => boolean): Unit | undefined {
  let best: Unit | undefined;
  let bestD = Infinity;
  host.queryUnits(x, y, reach + host.maxRadius, (u) => {
    if (!accept(u)) return;
    const d = hypot(u.x - x, u.y - y) - u.radius;
    if (d <= reach && d < bestD) {
      bestD = d;
      best = u;
    }
  });
  return best;
}

function baseDamage(host: EffectHost, ctx: EffectContext, power: number, amount: number): number {
  const fromSource = ctx.source && power > 0 ? host.rollDamage(ctx.source, ctx.source.damage * power) : 0;
  const [lo, hi] = host.tuning.effectSpread;
  return fromSource + amount * (lo + host.random() * (hi - lo));
}

export function runEffects(host: EffectHost, effects: readonly EffectDef[], ctx: EffectContext): void {
  for (const effect of effects) runEffect(host, effect, ctx);
}

function runEffect(host: EffectHost, effect: EffectDef, base: EffectContext): void {
  // Tourbillon & co : l'effet se centre sur le lanceur au lieu de la cible.
  const ctx =
    'at' in effect && effect.at === 'self' && base.source
      ? { ...base, x: base.source.x, y: base.source.y, fromX: base.source.x, fromY: base.source.y, target: undefined }
      : base;
  const source = ctx.source?.index ?? -1;
  switch (effect.type) {
    case 'damage': {
      if (effect.visual) host.emit({ type: 'effect', visual: effect.visual, x: ctx.x, y: ctx.y, radius: effect.radius, source });
      const dmg = baseDamage(host, ctx, effect.power, effect.amount);
      if (effect.radius <= 0) {
        const t = ctx.target && canHit(ctx.target, ctx, effect.friendlyFire) ? ctx.target : nearestAt(host, ctx.x, ctx.y, host.tuning.hitTolerance, (u) => canHit(u, ctx, effect.friendlyFire));
        if (!t) return;
        const [dx, dy] = direction(ctx.fromX, ctx.fromY, t.x, t.y);
        host.damage(t, dmg, ctx.source, dx, dy, effect.knockback);
        return;
      }
      const victims: Unit[] = [];
      host.queryUnits(ctx.x, ctx.y, effect.radius + host.maxRadius, (u) => {
        if (canHit(u, ctx, effect.friendlyFire) && hypot(u.x - ctx.x, u.y - ctx.y) <= effect.radius + u.radius) victims.push(u);
      });
      for (const u of victims) {
        const d = hypot(u.x - ctx.x, u.y - ctx.y);
        // Plein effet au centre, moitié au bord.
        const k = 1 - (1 - effect.edge) * Math.min(1, d / (effect.radius + u.radius));
        const [dx, dy] = d > 0.5 ? direction(ctx.x, ctx.y, u.x, u.y) : direction(ctx.fromX, ctx.fromY, u.x, u.y);
        host.damage(u, dmg * k, ctx.source, dx, dy, effect.knockback * k);
      }
      return;
    }
    case 'knockback': {
      host.queryUnits(ctx.x, ctx.y, effect.radius + host.maxRadius, (u) => {
        if (!canHit(u, ctx, effect.friendlyFire)) return;
        const d = hypot(u.x - ctx.x, u.y - ctx.y);
        if (d > effect.radius + u.radius) return;
        const [dx, dy] = d > 0.5 ? direction(ctx.x, ctx.y, u.x, u.y) : direction(ctx.fromX, ctx.fromY, u.x, u.y);
        const k = 1 - (1 - effect.edge) * Math.min(1, d / (effect.radius + u.radius));
        u.kx += (dx * effect.force * k) / u.mass;
        u.ky += (dy * effect.force * k) / u.mass;
      });
      return;
    }
    case 'slow': {
      if (effect.visual) host.emit({ type: 'effect', visual: effect.visual, x: ctx.x, y: ctx.y, radius: effect.radius, source });
      const apply = (u: Unit) => {
        const until = host.time + effect.duration;
        if (u.slowUntil <= host.time) {
          u.slowFactor = effect.factor;
          u.slowUntil = until;
        } else if (effect.factor <= u.slowFactor) {
          // Un ralentissement plus fort remplace le précédent ; un plus faible ne le prolonge pas.
          u.slowFactor = effect.factor;
          u.slowUntil = Math.max(u.slowUntil, until);
        }
      };
      if (effect.radius <= 0) {
        if (ctx.target && canHit(ctx.target, ctx, effect.friendlyFire)) apply(ctx.target);
        return;
      }
      host.queryUnits(ctx.x, ctx.y, effect.radius + host.maxRadius, (u) => {
        if (canHit(u, ctx, effect.friendlyFire) && hypot(u.x - ctx.x, u.y - ctx.y) <= effect.radius + u.radius) apply(u);
      });
      return;
    }
    case 'ricochet': {
      const accept = (u: Unit) => canHit(u, ctx, effect.friendlyFire) && u !== ctx.source;
      // Part de la cible visée même si l'effet précédent vient de la tuer : elle reste le premier maillon.
      let current: Unit | undefined = ctx.target ?? nearestAt(host, ctx.x, ctx.y, host.tuning.ricochetStartReach, accept);
      if (!current) return;
      const hit = new Set<Unit>([current]);
      let dmg = baseDamage(host, ctx, effect.power, effect.amount);
      for (let i = 0; i < effect.bounces; i++) {
        const from: Unit = current;
        let next: Unit | undefined;
        let bestD = Infinity;
        host.queryUnits(from.x, from.y, effect.range + host.maxRadius, (u) => {
          if (hit.has(u) || !accept(u)) return;
          const d = hypot(u.x - from.x, u.y - from.y);
          if (d <= effect.range && d < bestD) {
            bestD = d;
            next = u;
          }
        });
        if (!next) return;
        dmg *= effect.falloff;
        hit.add(next);
        host.emit({ type: 'beam', visual: effect.visual, fromX: from.x, fromY: from.y, toX: next.x, toY: next.y });
        const [dx, dy] = direction(from.x, from.y, next.x, next.y);
        host.damage(next, dmg, ctx.source, dx, dy, effect.knockback);
        current = next;
      }
      return;
    }
    case 'launch': {
      host.queryUnits(ctx.x, ctx.y, effect.radius + host.maxRadius, (u) => {
        if (!canHit(u, ctx, effect.friendlyFire)) return;
        const d = hypot(u.x - ctx.x, u.y - ctx.y);
        if (d > effect.radius + u.radius) return;
        const k = 1 - (1 - effect.edge) * Math.min(1, d / (effect.radius + u.radius));
        const [dx, dy] = d > 0.5 ? direction(ctx.x, ctx.y, u.x, u.y) : direction(ctx.fromX, ctx.fromY, u.x, u.y);
        u.kx += (dx * effect.force * k) / u.mass;
        u.ky += (dy * effect.force * k) / u.mass;
        host.launchUnit(u, (effect.lift * k) / Math.sqrt(u.mass));
      });
      return;
    }
    case 'beam': {
      // Rayon : du tireur vers la cible, jusqu'au mur, puis rebond ; la trajectoire est fixée au moment du tir.
      const [dx, dy] = direction(ctx.fromX, ctx.fromY, ctx.x, ctx.y);
      const segments = beamPath(host.field, ctx.fromX, ctx.fromY, dx, dy, effect.bounces);
      const fire = () => {
        // Le tireur est tombé pendant la charge : le rayon s'éteint.
        if (effect.delay > 0 && ctx.source && ctx.source.state === 'dead') return;
        const hit = new Set<Unit>();
        if (ctx.source) hit.add(ctx.source);
        let dmg = baseDamage(host, ctx, effect.power, effect.amount);
        for (const s of segments) {
          host.emit({ type: 'beam', visual: effect.visual, ...s, width: effect.width });
          const [sx, sy] = direction(s.fromX, s.fromY, s.toX, s.toY);
          const len = hypot(s.toX - s.fromX, s.toY - s.fromY);
          for (const u of host.units) {
            if (hit.has(u) || !canHit(u, ctx, effect.friendlyFire)) continue;
            const rx = u.x - s.fromX;
            const ry = u.y - s.fromY;
            const along = rx * sx + ry * sy;
            if (along < 0 || along > len) continue;
            if (Math.abs(rx * sy - ry * sx) > effect.width / 2 + u.radius) continue;
            hit.add(u);
            host.damage(u, dmg, ctx.source, sx, sy, effect.knockback);
          }
          dmg *= effect.falloff;
        }
      };
      if (effect.delay <= 0) return fire();
      host.emit({ type: 'beamCharge', visual: effect.visual, width: effect.width, duration: effect.delay, source, segments });
      host.defer(effect.delay, fire);
      return;
    }
    case 'spawn':
      host.spawnReinforcements(effect, ctx);
      return;
    case 'projectile':
      host.spawnEffectProjectile(effect, ctx);
      return;
  }
}

/** Trajectoire d'un rayon : jusqu'au mur, puis un segment par rebond. */
function beamPath(field: FieldRect, ox: number, oy: number, dx: number, dy: number, bounces: number): BeamSegment[] {
  const out: BeamSegment[] = [];
  for (let i = 0; i <= bounces; i++) {
    const [len, wall] = rayToWall(field, ox, oy, dx, dy);
    const ex = ox + dx * len;
    const ey = oy + dy * len;
    out.push({ fromX: ox, fromY: oy, toX: ex, toY: ey });
    if (wall === 'x') dx = -dx;
    else dy = -dy;
    ox = ex;
    oy = ey;
  }
  return out;
}

/** Distance jusqu'au mur du terrain le long d'un rayon, et l'axe du mur touché. */
function rayToWall(f: FieldRect, ox: number, oy: number, dx: number, dy: number): [number, 'x' | 'y'] {
  const tx = dx > 0 ? (f.x + f.width - ox) / dx : dx < 0 ? (f.x - ox) / dx : Infinity;
  const ty = dy > 0 ? (f.y + f.height - oy) / dy : dy < 0 ? (f.y - oy) / dy : Infinity;
  return tx < ty ? [Math.max(0, tx), 'x'] : [Math.max(0, ty), 'y'];
}

function direction(fx: number, fy: number, tx: number, ty: number): [number, number] {
  const dx = tx - fx;
  const dy = ty - fy;
  const l = hypot(dx, dy);
  return l > 1e-6 ? [dx / l, dy / l] : [0, 1];
}
