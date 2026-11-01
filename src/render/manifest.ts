// Manifeste d'assets : associe chaque clé visuelle à un placeholder généré ou à une sprite sheet.
// Le moteur ne connaît que les clés ; seul le rendu sait à quoi elles ressemblent.
import { z } from 'zod';
import raw from './assets.manifest.json';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const BRICKS = {
  attack: ['lunge', 'none'],
  shoot: ['recoil', 'none'],
  hurt: ['flash', 'none'],
  death: ['topple', 'fade'],
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

const PlaceholderSchema = z.object({
  type: z.literal('placeholder'),
  /** Silhouette : gnome = rond à bonnet, gobelin = triangle à oreilles. Les camps ne se distinguent pas que par la couleur. */
  body: z.enum(['gnome', 'goblin']),
  size: z.number().int().min(6).max(48),
  color,
  accent: color,
  mark: z.enum(['none', 'bow', 'helmet']),
  outline: color.optional(),
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
});

/** Accessoire d'upgrade superposé au héros, sans régénérer le personnage. */
const AccessorySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('placeholder'),
    kind: z.enum(['goggles', 'sword', 'grenades', 'jar', 'chicken', 'pot']),
    color,
    accent: color,
    /** Position relative au centre du sprite, en fraction de sa taille (x vers l'avant du regard). */
    anchor: z.tuple([z.number(), z.number()]),
  }),
  z.object({
    type: z.literal('image'),
    url: z.string(),
    /** Hauteur d'affichage en px monde. */
    size: z.number().positive(),
    anchor: z.tuple([z.number(), z.number()]),
  }),
]);

/** Rendu d'un effet, d'un projectile ou d'un incident, désigné par la clé "visual" des données. */
const EffectVisualSchema = z.object({
  kind: z.enum(['arrow', 'line', 'ball', 'ring', 'puddle', 'bolt', 'spark']),
  color,
  accent: color.optional(),
  /** Taille en px monde (épaisseur, diamètre). */
  size: z.number().positive().default(2),
  /** Durée d'affichage (s) pour les effets qui persistent (flaques, anneaux). */
  duration: z.number().positive().default(0.35),
});

const ManifestSchema = z.object({
  defaults: z.object({ bricks: BricksSchema }),
  assets: z.record(z.string(), z.discriminatedUnion('type', [PlaceholderSchema, SpriteSheetSchema])),
  accessories: z.record(z.string(), AccessorySchema),
  effects: z.record(z.string(), EffectVisualSchema),
});

export type AccessoryEntry = z.infer<typeof AccessorySchema>;
export type EffectVisual = z.infer<typeof EffectVisualSchema>;

export type PlaceholderAsset = z.infer<typeof PlaceholderSchema>;
export type SpriteSheetAsset = z.infer<typeof SpriteSheetSchema>;
export type AssetEntry = PlaceholderAsset | SpriteSheetAsset;
export type Manifest = z.infer<typeof ManifestSchema>;

export const manifest: Manifest = ManifestSchema.parse(raw);

/** Placeholder de secours pour une clé absente du manifeste : l'unité s'affiche quand même. */
export function resolveAsset(key: string, team: 'gnomes' | 'goblins'): AssetEntry {
  const entry = manifest.assets[key];
  if (entry) return entry;
  console.warn(`[manifest] clé visuelle inconnue « ${key} », placeholder générique utilisé`);
  return team === 'gnomes'
    ? { type: 'placeholder', body: 'gnome', size: 12, color: '#9aa7b8', accent: '#d83b3b', mark: 'none' }
    : { type: 'placeholder', body: 'goblin', size: 12, color: '#9ab88a', accent: '#7a4a26', mark: 'none' };
}

const FALLBACK_EFFECT: EffectVisual = { kind: 'spark', color: '#ffffff', size: 2, duration: 0.35 };

export function effectVisual(key: string): EffectVisual {
  return manifest.effects[key] ?? FALLBACK_EFFECT;
}

export function bricksFor(entry: AssetEntry): Bricks {
  return { ...manifest.defaults.bricks, ...entry.bricks };
}
