// Manifeste d'assets : associe chaque clé visuelle à un placeholder généré ou à une sprite sheet.
// Le moteur ne connaît que les clés ; seul le rendu sait à quoi elles ressemblent.
import { z } from 'zod';
import raw from './assets.manifest.json';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const BRICKS = {
  attack: ['lunge', 'none'],
  shoot: ['recoil', 'none'],
  hurt: ['flash', 'none'],
  // stay : le corps reste tel que l'a laissé l'animation de mort de la sheet (juste grisé).
  death: ['topple', 'fade', 'stay'],
  impact: ['explode', 'none'],
  panic: ['exclaim', 'none'],
} as const;

const BricksSchema = z.object({
  attack: z.enum(BRICKS.attack),
  shoot: z.enum(BRICKS.shoot),
  hurt: z.enum(BRICKS.hurt),
  death: z.enum(BRICKS.death),
  impact: z.enum(BRICKS.impact),
  panic: z.enum(BRICKS.panic),
});
export type Bricks = z.infer<typeof BricksSchema>;

const PlaceholderShapeSchema = z.object({
  /** Silhouette : gnome = rond à bonnet, gobelin = triangle à oreilles. Les camps ne se distinguent pas que par la couleur. */
  body: z.enum(['gnome', 'goblin']),
  size: z.number().int().min(6).max(48),
  color,
  accent: color,
  mark: z.enum(['none', 'bow', 'helmet']),
  outline: color.optional(),
});

const PlaceholderSchema = PlaceholderShapeSchema.extend({
  type: z.literal('placeholder'),
  bricks: BricksSchema.partial().optional(),
});

const AnimationSchema = z.object({ frames: z.array(z.number().int().min(0)).min(1), fps: z.number().positive() });

const SpriteSheetSchema = z.object({
  type: z.literal('spritesheet'),
  /** Chemin relatif au dossier public/. */
  url: z.string(),
  frameWidth: z.number().int().positive(),
  frameHeight: z.number().int().positive(),
  /** Taille d'affichage en px monde (hauteur). */
  size: z.number().positive(),
  animations: z.object({ idle: AnimationSchema, walk: AnimationSchema.optional(), attack: AnimationSchema.optional(), death: AnimationSchema.optional() }),
  bricks: BricksSchema.partial().optional(),
  /** Silhouette de secours si l'image ne charge pas ; sert aussi à générer une sheet de remplacement. */
  placeholder: PlaceholderShapeSchema.optional(),
});

/** Accessoire d'upgrade superposé au héros, sans régénérer le personnage. */
const AccessoryShapeSchema = z.object({
  kind: z.enum(['goggles', 'sword', 'grenades', 'jar', 'chicken', 'pot']),
  color,
  accent: color,
});

const AccessorySchema = z.discriminatedUnion('type', [
  AccessoryShapeSchema.extend({
    type: z.literal('placeholder'),
    /** Position relative au centre du sprite, en fraction de sa taille (x vers l'avant du regard). */
    anchor: z.tuple([z.number(), z.number()]),
  }),
  z.object({
    type: z.literal('image'),
    url: z.string(),
    /** Hauteur d'affichage en px monde. */
    size: z.number().positive(),
    anchor: z.tuple([z.number(), z.number()]),
    /** Dessin de secours si l'image ne charge pas. */
    placeholder: AccessoryShapeSchema.optional(),
  }),
]);

/** Rendu d'un effet, d'un projectile ou d'un incident, désigné par la clé "visual" des données. */
const EffectVisualSchema = z.object({
  kind: z.enum(['arrow', 'line', 'ball', 'ring', 'puddle', 'bolt', 'spark', 'swirl']),
  /** Le lanceur tournoie sur lui-même pendant l'effet (tourbillon). */
  spinSource: z.boolean().default(false),
  color,
  accent: color.optional(),
  /** Taille en px monde (épaisseur, diamètre). */
  size: z.number().positive().default(2),
  /** Durée d'affichage (s) pour les effets qui persistent (flaques, anneaux). */
  duration: z.number().positive().default(0.35),
  /** Trace laissée au sol après l'effet (clé d'un autre effet, en général une flaque) : cratère… */
  decal: z.string().optional(),
});

/** Mise en scène : caméra, présentation des héros, tirs perdus dans le public. */
const StagingSchema = z.object({
  camera: z.object({
    enabled: z.boolean().default(true),
    zoom: z.number().min(1).max(3).default(1.7),
    /** Durée d'un plan rapproché (s de combat). */
    hold: z.number().positive().default(1.8),
    /** Repos minimal entre deux plans rapprochés (s de combat). */
    cooldown: z.number().min(0).default(7),
    /** Douceur du suivi (0..1 par image). */
    follow: z.number().min(0.01).max(1).default(0.1),
    /** Rayon (px monde) à partir duquel un effet compte comme un gros impact (météore). */
    bigImpactRadius: z.number().positive().default(30),
    triggers: z
      .object({
        heroDeath: z.boolean(),
        heroDuel: z.boolean(),
        heroCharge: z.boolean(),
        misfire: z.boolean(),
        lastStand: z.boolean(),
        bigImpact: z.boolean(),
      })
      .partial()
      .default({}),
  }),
  heroIntro: z.object({ enabled: z.boolean().default(true), duration: z.number().positive().default(2.8) }),
  /** Onomatopée de bande dessinée quand un K.O. aérien retombe. */
  koSplash: z.object({
    words: z.array(z.string()).min(1),
    color: color,
    /** Vitesse de chute minimale (px/s) pour mériter une onomatopée. */
    minImpact: z.number().min(0).default(110),
    /** Écart minimal entre deux onomatopées (ms). */
    gapMs: z.number().min(0).default(800),
  }),
  /** Gaz toxique de la zone qui se resserre, craché par des conduits. */
  gas: z.object({
    color: color,
    accent: color,
    /** Bouffées par seconde et par conduit au début du resserrement. */
    ventRate: z.number().min(0).default(3),
    /** Durée de vie d'une bouffée (s). */
    puffLife: z.number().positive().default(3),
    banner: z.string().default('GAZ TOXIQUE !'),
  }),
  /** Morts plus trash : gouttes et flaque sous les corps. */
  gore: z.object({
    enabled: z.boolean().default(true),
    color: color,
    dark: color,
    /** Taille de la flaque, en multiple du rayon de l'unité. */
    puddle: z.number().positive().default(2.6),
    /** Gouttes projetées à chaque coup reçu. */
    dropsPerHit: z.number().int().min(0).default(2),
  }),
  strayShots: z.object({
    /** Probabilité qu'une flèche ratée près du bord file dans les gradins. */
    chance: z.number().min(0).max(1).default(0.35),
    /** Distance au bord du terrain (px monde) en dessous de laquelle un raté peut partir dans le public. */
    edgeDistance: z.number().min(0).default(30),
  }),
});
export type Staging = z.infer<typeof StagingSchema>;

const ManifestSchema = z.object({
  defaults: z.object({ bricks: BricksSchema }),
  assets: z.record(z.string(), z.discriminatedUnion('type', [PlaceholderSchema, SpriteSheetSchema])),
  accessories: z.record(z.string(), AccessorySchema),
  effects: z.record(z.string(), EffectVisualSchema),
  staging: StagingSchema,
});

export type AccessoryEntry = z.infer<typeof AccessorySchema>;
export type EffectVisual = z.infer<typeof EffectVisualSchema>;

export type PlaceholderAsset = z.infer<typeof PlaceholderSchema>;
export type SpriteSheetAsset = z.infer<typeof SpriteSheetSchema>;
export type AssetEntry = PlaceholderAsset | SpriteSheetAsset;
export type Manifest = z.infer<typeof ManifestSchema>;

export const manifest: Manifest = ManifestSchema.parse(raw);

/** Une sheet qui n'a pas chargé retombe sur sa silhouette de secours. */
export function asPlaceholder(entry: SpriteSheetAsset): PlaceholderAsset | undefined {
  return entry.placeholder && { type: 'placeholder', ...entry.placeholder, bricks: entry.bricks?.death === 'stay' ? { ...entry.bricks, death: 'topple' } : entry.bricks };
}

/** Placeholder de secours pour une clé absente du manifeste : l'unité s'affiche quand même. */
export function resolveAsset(key: string, team: 'gnomes' | 'goblins'): AssetEntry {
  const entry = manifest.assets[key];
  if (entry) return entry;
  console.warn(`[manifest] clé visuelle inconnue « ${key} », placeholder générique utilisé`);
  return team === 'gnomes'
    ? { type: 'placeholder', body: 'gnome', size: 12, color: '#9aa7b8', accent: '#d83b3b', mark: 'none' }
    : { type: 'placeholder', body: 'goblin', size: 12, color: '#9ab88a', accent: '#7a4a26', mark: 'none' };
}

const FALLBACK_EFFECT: EffectVisual = { kind: 'spark', color: '#ffffff', size: 2, duration: 0.35, spinSource: false };

export function effectVisual(key: string): EffectVisual {
  return manifest.effects[key] ?? FALLBACK_EFFECT;
}

export function bricksFor(entry: AssetEntry): Bricks {
  return { ...manifest.defaults.bricks, ...entry.bricks };
}
