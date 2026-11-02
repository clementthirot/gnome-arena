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
  /** Envol de la cible principale à l'impact (px/s) : 0 = reste au sol. */
  lift: z.number().min(0).default(0),
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

/** Où s'applique un effet de zone : sur la cible (défaut) ou autour du lanceur (tourbillon). */
const at = z.enum(['target', 'self']).default('target');

/** Dégâts ponctuels ou de zone. power est relatif aux dégâts du porteur, amount est absolu. */
const DamageEffect = z.object({
  type: z.literal('damage'),
  at,
  power: z.number().min(0).default(0),
  amount: z.number().min(0).default(0),
  /** 0 = la seule unité visée ; sinon tout ce qui est dans le rayon, avec atténuation vers le bord. */
  radius: z.number().min(0).default(0),
  /** Part de l'effet conservée au bord de la zone (1 = uniforme). */
  edge: fraction.default(0.5),
  knockback: z.number().min(0).default(0),
  /** Touche aussi son propre camp (grenades, catastrophes). */
  friendlyFire: z.boolean().default(false),
  visual: visualKey.optional(),
});

const KnockbackEffect = z.object({
  type: z.literal('knockback'),
  at,
  force: positive,
  radius: positive,
  edge: fraction.default(0.5),
  friendlyFire: z.boolean().default(false),
});

const SlowEffect = z.object({
  type: z.literal('slow'),
  at,
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

/** Propulsion dans les airs : recul horizontal et envol. Les unités lourdes volent moins haut. */
const LaunchEffect = z.object({
  type: z.literal('launch'),
  at,
  /** Vitesse horizontale donnée au centre (px/s, divisée par la masse). */
  force: positive,
  /** Vitesse d'envol au centre (px/s, divisée par la racine de la masse). */
  lift: positive,
  radius: positive,
  edge: fraction.default(0.5),
  friendlyFire: z.boolean().default(false),
});

/** Rayon instantané qui traverse tout ce qui est sur sa ligne jusqu'au mur, puis rebondit. */
const BeamEffect = z.object({
  type: z.literal('beam'),
  /** Largeur du rayon (px monde). */
  width: positive,
  power: z.number().min(0).default(0),
  amount: z.number().min(0).default(0),
  knockback: z.number().min(0).default(0),
  /** Rebonds sur les murs du terrain avant de disparaître. */
  bounces: z.number().int().min(0).default(1),
  /** Temps de charge (s) : le rayon se dessine sur sa trajectoire avant de frapper. On peut l'esquiver. */
  delay: z.number().min(0).default(0),
  /** Part des dégâts conservée après chaque rebond. */
  falloff: fraction.default(0.8),
  friendlyFire: z.boolean().default(false),
  visual: visualKey,
});

/** Renforts : des unités entrent dans l'arène en sautant le muret (supporters du public). */
const SpawnEffect = z.object({
  type: z.literal('spawn'),
  /** Unité créée pour chaque camp. */
  units: z.record(TeamId, id),
  /** Nombre d'unités par camp concerné. */
  count: z.number().int().positive(),
  /** Camps qui reçoivent des renforts : l'un, l'autre, les deux, ou celui qui est mené. */
  team: z.enum(['gnomes', 'goblins', 'both', 'losing']),
  /** Hauteur du saut par-dessus le muret (px/s). */
  jump: z.number().min(0).default(140),
});

export type EffectDef =
  | z.infer<typeof DamageEffect>
  | z.infer<typeof KnockbackEffect>
  | z.infer<typeof SlowEffect>
  | z.infer<typeof RicochetEffect>
  | z.infer<typeof LaunchEffect>
  | z.infer<typeof BeamEffect>
  | z.infer<typeof SpawnEffect>
  | ProjectileEffectDef;

export interface ProjectileEffectDef {
  type: 'projectile';
  speed: number;
  spread: number;
  /** Hauteur de la cloche (visuel uniquement ; le moteur reste en 2D). */
  arc: number;
  visual: string;
  /** Durée de vol imposée (s) ; sinon distance / vitesse. */
  duration?: number;
  /** Tombe du ciel sur le point visé au lieu de partir du tireur ou des gradins. */
  fromSky: boolean;
  /** Effets déclenchés au point d'impact. */
  effects: EffectDef[];
}

export const EffectSchema: z.ZodType<EffectDef, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [
    DamageEffect,
    KnockbackEffect,
    SlowEffect,
    RicochetEffect,
    LaunchEffect,
    BeamEffect,
    SpawnEffect,
    z.object({
      type: z.literal('projectile'),
      speed: positive,
      spread: z.number().min(0).default(0),
      arc: z.number().min(0).default(0),
      visual: visualKey,
      duration: positive.optional(),
      fromSky: z.boolean().default(false),
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
  /** Plus après ce moment (s) : par exemple, pas de renforts juste avant la fin. */
  until: z.number().positive().optional(),
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

const range = z.tuple([z.number(), z.number()]);

/**
 * Réglages fins du comportement. Chaque valeur a un défaut : battle.json peut n'en citer qu'une partie.
 * Facteurs de vitesse relatifs à la vitesse de l'unité, distances en px monde, temps en secondes.
 */
const TuningSchema = z
  .object({
    /** Variation aléatoire des dégâts (multiplicateur tiré dans l'intervalle). */
    damageSpread: range.default([0.75, 1.25]),
    /** Variation des dégâts absolus des effets (incidents d'arène). */
    effectSpread: range.default([0.85, 1.15]),
    /** Variation aléatoire des recharges d'attaque et de spéciale. */
    cooldownJitter: range.default([0.85, 1.15]),
    /** Recharge initiale des attaques spéciales. */
    specialStartCooldown: range.default([1, 3]),
    /** Durée d'une ruée téméraire. */
    rushDuration: range.default([2, 4]),
    /** Moral rendu au-dessus du seuil de panique quand la fuite se termine. */
    panicRecovery: z.number().min(0).default(0.3),
    /** Poids de la mort d'un héros sur le moral de ses voisins. */
    heroDeathWeight: z.number().min(0).default(2.5),
    /** Moral regagné par l'ennemi quand une unité tombe près de lui. */
    moraleGainOnEnemyDeath: z.number().min(0).default(0.05),
    fleeSpeed: positive.default(1.1),
    /** Rayon dans lequel un fuyard évite les ennemis. */
    fleeRadius: positive.default(70),
    /** Probabilité par seconde de quitter une cible surchargée. */
    crowdedRetargetChance: z.number().min(0).default(2),
    /** Temps sans progresser derrière la foule avant de changer de cible. */
    blockedRetargetAfter: positive.default(1.5),
    targeting: z
      .object({
        /** Pénalité de score d'une cible déjà entourée. */
        saturatedPenalty: positive.default(4),
        /** Bonus de score d'un fuyard (moins = plus attirant). */
        fleeingFactor: positive.default(0.8),
        /** Pénalité de la cible qu'on vient d'abandonner. */
        avoidPenalty: positive.default(3),
      })
      .default({}),
    /** Les tireurs qui gardent leurs distances. */
    ranged: z
      .object({
        /** Recule quand la cible est plus près que cette part de la distance voulue. */
        retreatBelow: fraction.default(0.75),
        retreatSpeed: positive.default(0.85),
        /** Vitesse du pas de côté quand il tient sa position. */
        holdSpeed: z.number().min(0).default(0.35),
        holdMargin: z.number().min(0).default(12),
        /** Part de la portée de tir au-delà de laquelle il se rapproche. */
        holdRangeShare: fraction.default(0.85),
        /** Distance au mur en dessous de laquelle il se sent acculé. */
        wallDistance: positive.default(24),
        /** Acculé au-delà de ce niveau (0..1), il se retourne et se bat. */
        corneredAt: fraction.default(0.7),
        corneredRush: positive.default(1.5),
      })
      .default({}),
    /** Un fantassin s'arrête à cette part de sa portée de mêlée. */
    meleeApproach: fraction.default(0.7),
    charge: z
      .object({
        /** Probabilité par seconde de lancer une charge quand elle est possible. */
        chancePerSecond: z.number().min(0).default(1.5),
        splashDamage: fraction.default(0.5),
        splashKnockback: fraction.default(0.7),
        /** Part de la direction de charge dans la projection (le reste : éloignement du point d'impact). */
        pushAlong: fraction.default(0.6),
        /** Rebond du chargeur à l'impact. */
        recoil: z.number().min(0).default(40),
        cooldownJitter: range.default([0.8, 1.3]),
        /** Part de la recharge appliquée quand la charge ne touche personne. */
        missCooldown: fraction.default(0.5),
        /** Délai minimal avant de frapper après un impact. */
        attackLock: z.number().min(0).default(0.4),
      })
      .default({}),
    separation: z
      .object({
        allyGap: z.number().min(0).default(2.5),
        enemyGap: z.number().min(0).default(0.5),
        /** Distance au-delà de l'écart minimal où la répulsion commence. */
        reach: positive.default(3),
        /** Force de répulsion entre ennemis, relative à celle entre alliés. */
        enemyFactor: z.number().min(0).default(0.6),
      })
      .default({}),
    /** Vitesse à laquelle tourne la direction d'errance (rad/s). */
    wanderTurn: z.number().min(0).default(4),
    walls: z.object({ margin: positive.default(16), push: z.number().min(0).default(1.2) }).default({}),
    /** Attraction vers le centre pour une unité hors de la zone. */
    zonePull: z.number().min(0).default(0.8),
    /** Tolérance (px) pour qu'un tir ou un effet ponctuel touche une unité. */
    hitTolerance: z.number().min(0).default(2.5),
    /** Portée initiale d'un ricochet quand il ne part pas d'une unité visée. */
    ricochetStartReach: z.number().min(0).default(6),
    /** Un gros recul fait sauter l'unité ; à l'atterrissage, elle rebondit tant que la chute est assez rapide. */
    bounce: z
      .object({
        /** Recul (après division par la masse) au-delà duquel l'unité décolle. */
        threshold: z.number().min(0).default(90),
        /** Vitesse d'envol par unité de recul au-delà du seuil. */
        lift: z.number().min(0).default(1),
        /** Part de la vitesse de chute rendue au rebond. */
        restitution: fraction.default(0.45),
        /** Vitesse de chute minimale (px/s) pour rebondir au lieu de se poser. */
        minImpact: z.number().min(0).default(60),
      })
      .default({}),
    /** Unités projetées en l'air : elles ne combattent plus jusqu'à l'atterrissage. */
    airborne: z
      .object({
        /** Gravité (px/s²). */
        gravity: positive.default(520),
        /** Part de la vitesse horizontale conservée par seconde en vol (peu de frottement : on vole loin). */
        airDecay: fraction.default(0.55),
        /** Étourdissement après l'atterrissage (s). */
        stun: z.number().min(0).default(0.4),
        /** Dégâts à l'atterrissage, en part des PV max par 100 px/s de vitesse de chute. */
        landingDamage: z.number().min(0).default(0.03),
      })
      .default({}),
    /** K.O. aériens : une unité vaincue est parfois projetée en l'air avant de retomber. */
    koLaunch: z
      .object({
        /** Probabilité de base. */
        chance: fraction.default(0.12),
        /** Probabilité ajoutée par 100 de recul du coup fatal. */
        perKnockback: z.number().min(0).default(0.12),
        maxChance: fraction.default(0.7),
        /** Probabilité pour un héros. */
        heroChance: fraction.default(1),
        lift: range.default([130, 210]),
        /** Multiplicateur du recul horizontal du coup fatal. */
        push: z.number().min(0).default(1.6),
      })
      .default({}),
  })
  .default({});
export type Tuning = z.infer<typeof TuningSchema>;

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
    tuning: TuningSchema,
  }),
  /** Fréquence des incidents d'arène. */
  events: z.object({
    /** Incidents par minute en début de combat. */
    perMinute: z.number().min(0),
    /** Multiplicateur atteint quand l'arène a fini de rétrécir : les catastrophes s'intensifient. */
    endRamp: z.number().min(1),
    /** Pas d'incident avant (s). */
    firstAt: z.number().min(0),
    /** Variation aléatoire de l'intervalle entre deux incidents. */
    intervalJitter: range.default([0.6, 1.4]),
    /** Les projectiles d'incident partent des gradins : décalage latéral max et recul derrière le muret. */
    launchSpread: z.number().min(0).default(30),
    launchDepth: z.number().min(0).default(20),
    /** Cible "densest" : nombre de candidats tirés et rayon de comptage des voisins. */
    densestCandidates: z.number().int().positive().default(6),
    densestRadius: positive.default(20),
    /** Cible "random_point" : marge par rapport au bord de la zone (0..0.5). */
    pointMargin: z.number().min(0).max(0.45).default(0.1),
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
    const t = rules.tuning;
    for (const [name, r] of [['damageSpread', t.damageSpread], ['effectSpread', t.effectSpread], ['cooldownJitter', t.cooldownJitter], ['specialStartCooldown', t.specialStartCooldown], ['rushDuration', t.rushDuration], ['charge.cooldownJitter', t.charge.cooldownJitter], ['events.intervalJitter', data.battle.events.intervalJitter]] as const) {
      if (r[0] > r[1] || r[0] < 0) issue(['battle', 'rules', 'tuning', name], 'attendu : [min, max] positifs avec min <= max');
    }
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
    // Les renforts doivent désigner des unités du bon camp, où qu'ils soient dans l'arbre des effets.
    const walk = (effects: readonly EffectDef[], path: (string | number)[]) =>
      effects.forEach((e, i) => {
        if (e.type === 'projectile') walk(e.effects, [...path, i, 'effects']);
        if (e.type !== 'spawn') return;
        for (const [team, unitId] of Object.entries(e.units)) {
          const unit = data.units.find((u) => u.id === unitId);
          if (!unit) issue([...path, i, 'units', team], `unité inconnue : ${unitId}`);
          else if (unit.team !== team) issue([...path, i, 'units', team], `${unitId} appartient au camp ${unit.team}`);
        }
      });
    data.events.forEach((ev, i) => walk(ev.effects, ['events', i, 'effects']));
    data.equipment.forEach((eq, i) => eq.special && walk(eq.special.effects, ['equipment', i, 'special', 'effects']));
    for (const [team, army] of Object.entries(data.battle.armies)) {
      for (const unitId of Object.keys(army)) {
        const unit = data.units.find((u) => u.id === unitId);
        if (!unit) issue(['battle', 'armies', team, unitId], `unité inconnue : ${unitId}`);
        else if (unit.team !== team) issue(['battle', 'armies', team, unitId], `${unitId} appartient au camp ${unit.team}`);
      }
    }
  });
export type GameData = z.infer<typeof GameDataSchema>;
