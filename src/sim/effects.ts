// Bibliothèque d'effets : les seules briques de comportement que les données peuvent combiner.
// Un équipement ou un événement n'est qu'une liste d'effets ; aucun code spécifique par élément.
import type { EffectDef, TeamId } from '../data/schema';
import { hypot } from './detmath';
import type { BattleEvent, Unit } from './types';

/** Ce dont un effet a besoin du moteur. Implémenté par Battle. */
export interface EffectHost {
  readonly units: readonly Unit[];
  readonly maxRadius: number;
  random(): number;
  queryUnits(x: number, y: number, radius: number, visit: (u: Unit) => void): void;
  rollDamage(source: Unit, base: number): number;
  damage(target: Unit, amount: number, source: Unit | null, dirX: number, dirY: number, knockback: number): void;
  spawnEffectProjectile(effect: Extract<EffectDef, { type: 'projectile' }>, ctx: EffectContext): void;
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
  return fromSource + amount * (0.85 + host.random() * 0.3);
}

export function runEffects(host: EffectHost, effects: readonly EffectDef[], ctx: EffectContext): void {
  for (const effect of effects) runEffect(host, effect, ctx);
}

function runEffect(host: EffectHost, effect: EffectDef, ctx: EffectContext): void {
  switch (effect.type) {
    case 'damage': {
      if (effect.visual) host.emit({ type: 'effect', visual: effect.visual, x: ctx.x, y: ctx.y, radius: effect.radius });
      const dmg = baseDamage(host, ctx, effect.power, effect.amount);
      if (effect.radius <= 0) {
        const t = ctx.target && canHit(ctx.target, ctx, effect.friendlyFire) ? ctx.target : nearestAt(host, ctx.x, ctx.y, 2.5, (u) => canHit(u, ctx, effect.friendlyFire));
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
        const k = 1 - 0.5 * Math.min(1, d / (effect.radius + u.radius));
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
        const k = 1 - 0.5 * Math.min(1, d / (effect.radius + u.radius));
        u.kx += (dx * effect.force * k) / u.mass;
        u.ky += (dy * effect.force * k) / u.mass;
      });
      return;
    }
    case 'slow': {
      if (effect.visual) host.emit({ type: 'effect', visual: effect.visual, x: ctx.x, y: ctx.y, radius: effect.radius });
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
      let current: Unit | undefined = ctx.target ?? nearestAt(host, ctx.x, ctx.y, 6, accept);
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
    case 'projectile':
      host.spawnEffectProjectile(effect, ctx);
      return;
  }
}

function direction(fx: number, fy: number, tx: number, ty: number): [number, number] {
  const dx = tx - fx;
  const dy = ty - fy;
  const l = hypot(dx, dy);
  return l > 1e-6 ? [dx / l, dy / l] : [0, 1];
}
