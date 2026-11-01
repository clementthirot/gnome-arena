// Schémas Zod des données de jeu. Tout ce qui décrit une unité, un héros, un rôle,
// une personnalité ou un combat passe par ici : le moteur ne lit jamais un JSON brut.
import { z } from 'zod';

export const TeamId = z.enum(['gnomes', 'goblins']);
export type TeamId = z.infer<typeof TeamId>;

const id = z.string().regex(/^[a-z0-9_]+$/, 'identifiant en snake_case attendu');
const positive = z.number().positive();
const fraction = z.number().min(0).max(1);

/** Une attaque utilisable par un rôle. Le moteur choisit la première dont la portée couvre la distance. */
export const AttackSchema = z.object({
  kind: z.enum(['melee', 'ranged']),
  /** Portée minimale (bord à bord, en px monde). Sous ce seuil, l'attaque n'est pas utilisée. */
  minRange: z.number().min(0).default(0),
  /** Portée maximale (bord à bord, en px monde). */
  maxRange: positive,
  /** Multiplicateur appliqué aux dégâts de l'unité. */
  damage: positive,
  /** Secondes entre deux attaques. */
  cooldown: positive,
  /** Impulsion de recul appliquée à la cible (px/s, divisée par la masse de la cible). */
  knockback: z.number().min(0),
  /** Vitesse du projectile (attaques à distance). */
  projectileSpeed: positive.optional(),
  /** Dispersion du tir en px monde au point d'impact. */
  spread: z.number().min(0).default(0),
});
export type AttackDef = z.infer<typeof AttackSchema>;

export const ChargeSchema = z.object({
  /** Distance (bord à bord) à partir de laquelle la charge peut se déclencher. */
  minDistance: positive,
  maxDistance: positive,
  speedMultiplier: positive,
  /** Durée maximale de la charge, en secondes. */
  duration: positive,
  cooldown: positive,
  damage: positive,
  knockback: positive,
  /** Rayon des dégâts et du recul à l'impact (projette les voisins). */
  splashRadius: z.number().min(0),
});

export const RoleSchema = z.object({
  id,
  label: z.string(),
  attacks: z.array(AttackSchema).min(1),
  /** Distance (bord à bord) que l'unité cherche à garder avec sa cible ; elle recule en deçà. 0 = colle. */
  keepDistance: z.number().min(0).default(0),
  charge: ChargeSchema.optional(),
});
export type RoleDef = z.infer<typeof RoleSchema>;

/** Les personnalités sont des tendances : chaque champ module une probabilité, jamais une règle fixe. */
export const PersonalitySchema = z.object({
  id,
  label: z.string(),
  /** Multiplie la distance gardée par les tireurs (peureux > 1, téméraire < 1). */
  distanceFactor: positive,
  /** Probabilité par seconde de se jeter dans la mêlée malgré sa nature. */
  recklessChance: fraction,
  /** Seuil de moral sous lequel la panique devient possible. */
  panicThreshold: fraction,
  /** Probabilité par seconde de paniquer une fois sous le seuil. */
  panicChance: fraction,
  /** Probabilité de changer de cible à chaque réévaluation. */
  fickleness: fraction,
  /** Multiplicateur de vitesse. */
  speedFactor: positive.default(1),
});
export type PersonalityDef = z.infer<typeof PersonalitySchema>;

export const UnitSchema = z.object({
  id,
  team: TeamId,
  label: z.string(),
  role: id,
  /** Clé visuelle résolue par le manifeste d'assets du rendu, jamais un fichier. */
  visual: id,
  hp: positive,
  damage: positive,
  /** Vitesse de déplacement en px monde par seconde. */
  speed: positive,
  /** Rayon de collision en px monde (une troupe ~16 px de haut => rayon ~5). */
  radius: positive,
  mass: positive.default(1),
  /** Personnalités possibles pour une troupe anonyme, tirées au sort selon leur poids. */
  personalities: z.record(id, positive),
});
export type UnitDef = z.infer<typeof UnitSchema>;

// ------------------------------------------------------------------ effets
// Briques de comportement fournies par le moteur. Les équipements et les événements
// les combinent : une boule de feu = un projectile qui déclenche des dégâts de zone.

const visualKey = z.string().regex(/^[a-z0-9_]+$/);

/** Dégâts ponctuels ou de zone. power est relatif aux dégâts du porteur, amount est absolu. */
const DamageEffect = z.object({
  type: z.literal('damage'),
  power: z.number().min(0).default(0),
  amount: z.number().min(0).default(0),
  /** 0 = la seule unité visée ; sinon tout ce qui est dans le rayon, avec atténuation vers le bord. */
  radius: z.number().min(0).default(0),
  knockback: z.number().min(0).default(0),
  /** Touche aussi son propre camp (grenades, catastrophes). */
  friendlyFire: z.boolean().default(false),
  visual: visualKey.optional(),
});

const KnockbackEffect = z.object({
  type: z.literal('knockback'),
  force: positive,
  radius: positive,
  friendlyFire: z.boolean().default(false),
});

const SlowEffect = z.object({
  type: z.literal('slow'),
  /** Multiplicateur de vitesse pendant l'effet (0.5 = moitié moins vite). */
  factor: z.number().min(0.05).max(1),
  duration: positive,
  radius: z.number().min(0).default(0),
  friendlyFire: z.boolean().default(false),
  visual: visualKey.optional(),
});

/** Rebonds d'une unité touchée à la suivante (laser qui ricoche, éclair en chaîne). */
const RicochetEffect = z.object({
  type: z.literal('ricochet'),
  bounces: z.number().int().positive(),
  range: positive,
  power: z.number().min(0).default(0),
  amount: z.number().min(0).default(0),
  /** Part des dégâts conservée à chaque rebond. */
  falloff: fraction.default(0.7),
  knockback: z.number().min(0).default(0),
  /** Un rebond peut repartir vers un allié : c'est le défaut des upgrades loufoques. */
  friendlyFire: z.boolean().default(false),
  visual: visualKey.default('beam'),
});

export type EffectDef =
  | z.infer<typeof DamageEffect>
  | z.infer<typeof KnockbackEffect>
  | z.infer<typeof SlowEffect>
  | z.infer<typeof RicochetEffect>
  | ProjectileEffectDef;

export interface ProjectileEffectDef {
  type: 'projectile';
  speed: number;
  spread: number;
  /** Hauteur de la cloche (visuel uniquement ; le moteur reste en 2D). */
  arc: number;
  visual: string;
  /** Effets déclenchés au point d'impact. */
  effects: EffectDef[];
}

export const EffectSchema: z.ZodType<EffectDef, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [
    DamageEffect,
    KnockbackEffect,
    SlowEffect,
    RicochetEffect,
    z.object({
      type: z.literal('projectile'),
      speed: positive,
      spread: z.number().min(0).default(0),
      arc: z.number().min(0).default(0),
      visual: visualKey,
      effects: z.array(EffectSchema).min(1),
    }),
  ]),
) as z.ZodType<EffectDef, z.ZodTypeDef, unknown>;

// ------------------------------------------------------------------ équipements

export const EquipmentSchema = z.object({
  id,
  label: z.string(),
  /** Numéro court affiché lors du vote. */
  short: z.string().max(14),
  /** Accessoire superposé au héros par le rendu (clé du manifeste, section accessories). */
  visual: visualKey,
  stats: z
    .object({
      hp: positive.default(1),
      damage: positive.default(1),
      speed: positive.default(1),
      mass: positive.default(1),
    })
    .default({}),
  /** Attaque spéciale utilisée quand la cible est à portée et la recharge prête. */
  special: z
    .object({
      minRange: z.number().min(0).default(0),
      maxRange: positive,
      cooldown: positive,
      effects: z.array(EffectSchema).min(1),
      /** Défaut de l'upgrade : le tir part vers un allié, sur soi ou au hasard. */
      misfire: z
        .object({ chance: fraction, mode: z.enum(['ally', 'self', 'random']) })
        .optional(),
    })
    .optional(),
});
export type EquipmentDef = z.infer<typeof EquipmentSchema>;

// ------------------------------------------------------------------ événements d'arène

export const ArenaEventSchema = z.object({
  id,
  label: z.string(),
  /** Poids relatif dans le tirage. */
  weight: positive,
  /** Pas avant ce moment du combat (s). */
  from: z.number().min(0).default(0),
  /** Où l'incident tombe. */
  target: z.enum(['random_point', 'densest', 'random_unit', 'hero']),
  /** Avertissement visible avant l'impact (s) : ombre au sol, zone qui clignote. */
  telegraph: z.number().min(0).default(0),
  telegraphRadius: z.number().min(0).default(10),
  visual: visualKey,
  /** Les projectiles d'événement partent des gradins. */
  effects: z.array(EffectSchema).min(1),
});
export type ArenaEventDef = z.infer<typeof ArenaEventSchema>;

export const HeroSchema = z.object({
  id,
  name: z.string(),
  /** Surnom affiché sous le nom ("le vaillant"). */
  label: z.string(),
  /** Unité de base dont le héros hérite les règles. */
  base: id,
  visual: id,
  /** Personnalité fixe d'un combat à l'autre : c'est l'archétype du héros. */
  personality: id,
  stats: z
    .object({
      hp: positive.default(1),
      damage: positive.default(1),
      speed: positive.default(1),
      size: positive.default(1),
      mass: positive.default(1),
    })
    .default({}),
  /** Équipements de départ ; un arc y ajoute les upgrades gagnées au fil des épisodes. */
  upgrades: z.array(id).default([]),
  active: z.boolean().default(true),
});
export type HeroDef = z.infer<typeof HeroSchema>;

export const BattleConfigSchema = z.object({
  tickRate: z.number().int().positive(),
  arena: z.object({
    width: positive,
    height: positive,
    /** Terrain de combat (le reste est occupé par le public). */
    field: z.object({ x: z.number(), y: z.number(), width: positive, height: positive }),
  }),
  /** Composition de chaque armée : identifiant d'unité -> nombre. Les héros actifs s'y ajoutent. */
  armies: z.record(TeamId, z.record(id, z.number().int().min(0))),
  rules: z.object({
    maxAttackersPerTarget: z.number().int().positive(),
    /** Aléatoire dans le choix de cible (0 = toujours le plus proche). */
    targetRandomness: z.number().min(0),
    /** Intervalle (s) entre deux réévaluations de cible. */
    retargetInterval: z.tuple([positive, positive]),
    /** Multiplicateur global des dégâts : principal levier de la durée des combats. */
    damageScale: positive,
    /** Amortissement du recul par seconde (0..1, part conservée). */
    knockbackDecay: fraction,
    separationStrength: z.number().min(0),
    /** Petite errance permanente pour que la mêlée reste vivante. */
    wander: z.number().min(0),
    moraleRegen: z.number().min(0),
    moraleLossOnHit: z.number().min(0),
    moraleLossOnAllyDeath: z.number().min(0),
    allyDeathRadius: positive,
    /** Rage du camp mené, pour garder des retournements possibles malgré l'écart. */
    underdog: z.object({
      /** Écart de force (0..1) à partir duquel la rage commence. */
      threshold: z.number().min(0),
      /** Écart auquel le bonus est maximal. */
      fullAt: positive,
      /** Bonus de dégâts maximal (0.5 = +50 %). */
      maxBonus: z.number().min(0),
      /** Multiplicateur du bonus pour les héros. */
      heroFactor: z.number().min(0),
    }),
    /** Durée de panique (s). */
    panicDuration: z.tuple([positive, positive]),
  }),
  /** Fréquence des incidents d'arène. */
  events: z.object({
    /** Incidents par minute en début de combat. */
    perMinute: z.number().min(0),
    /** Multiplicateur atteint quand l'arène a fini de rétrécir : les catastrophes s'intensifient. */
    endRamp: z.number().min(1),
    /** Pas d'incident avant (s). */
    firstAt: z.number().min(0),
  }),
  /** Fin de combat maîtrisée : l'arène rétrécit, puis on tranche aux points. */
  ending: z.object({
    shrinkStart: positive,
    shrinkEnd: positive,
    /** Taille finale du terrain, en fraction de sa taille initiale. */
    minScale: z.number().min(0.05).lt(1),
    /** Dégâts par seconde (fraction des PV max) hors de la zone. */
    zoneDamage: z.number().min(0),
    /** Au-delà, victoire aux PV restants. */
    hardCap: positive,
  }),
});
export type BattleConfig = z.infer<typeof BattleConfigSchema>;

export const GameDataSchema = z
  .object({
    roles: z.array(RoleSchema),
    equipment: z.array(EquipmentSchema),
    events: z.array(ArenaEventSchema),
    personalities: z.array(PersonalitySchema),
    units: z.array(UnitSchema),
    heroes: z.array(HeroSchema),
    battle: BattleConfigSchema,
  })
  .superRefine((data, ctx) => {
    const roles = new Set(data.roles.map((r) => r.id));
    const personalities = new Set(data.personalities.map((p) => p.id));
    const units = new Set(data.units.map((u) => u.id));
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    for (const [name, list] of [
      ['roles', data.roles],
      ['personalities', data.personalities],
      ['units', data.units],
      ['heroes', data.heroes],
      ['equipment', data.equipment],
      ['events', data.events],
    ] as const) {
      const seen = new Set<string>();
      list.forEach((item, i) => {
        if (seen.has(item.id)) issue([name, i, 'id'], `identifiant en double : ${item.id}`);
        seen.add(item.id);
      });
    }
    data.units.forEach((u, i) => {
      if (!roles.has(u.role)) issue(['units', i, 'role'], `rôle inconnu : ${u.role}`);
      for (const p of Object.keys(u.personalities)) {
        if (!personalities.has(p)) issue(['units', i, 'personalities'], `personnalité inconnue : ${p}`);
      }
    });
    const equipment = new Set(data.equipment.map((e) => e.id));
    data.heroes.forEach((h, i) => {
      h.upgrades.forEach((up, j) => {
        if (!equipment.has(up)) issue(['heroes', i, 'upgrades', j], `équipement inconnu : ${up}`);
      });
    });
    data.heroes.forEach((h, i) => {
      if (!units.has(h.base)) issue(['heroes', i, 'base'], `unité de base inconnue : ${h.base}`);
      if (!personalities.has(h.personality)) issue(['heroes', i, 'personality'], `personnalité inconnue : ${h.personality}`);
    });
    const { ending, rules } = data.battle;
    if (!(ending.shrinkStart < ending.shrinkEnd && ending.shrinkEnd <= ending.hardCap))
      issue(['battle', 'ending'], 'attendu : shrinkStart < shrinkEnd <= hardCap');
    if (rules.underdog.threshold >= rules.underdog.fullAt) issue(['battle', 'rules', 'underdog'], 'attendu : threshold < fullAt');
    for (const key of ['retargetInterval', 'panicDuration'] as const) {
      if (rules[key][0] > rules[key][1]) issue(['battle', 'rules', key], 'attendu : [min, max] avec min <= max');
    }
    data.roles.forEach((r, i) => {
      r.attacks.forEach((a, j) => {
        if (a.minRange >= a.maxRange) issue(['roles', i, 'attacks', j], 'attendu : minRange < maxRange');
        if (a.kind === 'ranged' && !a.projectileSpeed) issue(['roles', i, 'attacks', j], 'projectileSpeed requis pour une attaque à distance');
      });
      if (r.charge && r.charge.minDistance >= r.charge.maxDistance) issue(['roles', i, 'charge'], 'attendu : minDistance < maxDistance');
    });
    for (const [team, army] of Object.entries(data.battle.armies)) {
      for (const unitId of Object.keys(army)) {
        const unit = data.units.find((u) => u.id === unitId);
        if (!unit) issue(['battle', 'armies', team, unitId], `unité inconnue : ${unitId}`);
        else if (unit.team !== team) issue(['battle', 'armies', team, unitId], `${unitId} appartient au camp ${unit.team}`);
      }
    }
  });
export type GameData = z.infer<typeof GameDataSchema>;
