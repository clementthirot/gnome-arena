// Arcs et épisodes : l'état du feuilleton. Un arc est un fichier JSON versionné ;
// l'état des héros à l'épisode N se déduit des upgrades votées aux épisodes précédents.
import { z } from 'zod';
import type { GameData } from './schema';
import { TeamId } from './schema';

const id = z.string().regex(/^[a-z0-9_-]+$/);
const fraction = z.number().min(0).max(1);

/**
 * Réglages de la régie pour un arc : biome, effectifs, fréquence des incidents et des gags.
 * Chaque épisode figé en garde une copie, pour rester rejouable même si l'arc change ensuite.
 */
export const ArcSettingsSchema = z.object({
  biome: id.optional(),
  armies: z.record(TeamId, z.record(id, z.number().int().min(0))).optional(),
  eventsPerMinute: z.number().min(0).optional(),
  /** Poids des incidents (0 = désactivé). */
  eventWeights: z.record(id, z.number().min(0)).optional(),
  gagChances: z.object({ headClash: fraction, victoryDance: fraction, lostWeapon: fraction }).partial().optional(),
});
export type ArcSettings = z.infer<typeof ArcSettingsSchema>;

/** Type de fin d'un combat : le scout évite d'enchaîner deux fois le même. */
export const EndType = z.enum(['lastStand', 'comeback', 'timeout', 'blowout', 'close']);
export type EndType = z.infer<typeof EndType>;

export const EpisodeSchema = z.object({
  number: z.number().int().positive(),
  seed: z.string(),
  /** Résultat attendu, vérifié à la planification (même seed + même état = même combat). */
  winner: z.union([TeamId, z.literal('draw')]),
  duration: z.number().positive(),
  /** Héros de l'équipe perdante qui recevra l'upgrade votée. */
  recipient: id,
  /** Les 3 options proposées au vote, dans l'ordre des numéros. */
  options: z.array(id).min(2).max(4),
  /** Voix par option (même ordre), une fois le vote compté. */
  votes: z.array(z.number().int().min(0)).nullable().default(null),
  /** Upgrade gagnante, attribuée à recipient pour les épisodes suivants. */
  upgrade: id.nullable().default(null),
  publishedAt: z.string().optional(),
  /** K.O. de chaque héros dans ce combat (statistiques cumulées de l'arc). */
  heroKills: z.record(z.string(), z.number().int().min(0)).optional(),
  endType: EndType.optional(),
  /** Réglages au moment où l'épisode a été figé. */
  settings: ArcSettingsSchema.optional(),
});
export type Episode = z.infer<typeof EpisodeSchema>;

export const ArcSchema = z.object({
  id,
  title: z.string(),
  /** Héros engagés dans l'arc (les autres sont mis de côté). */
  heroes: z.array(id).min(2),
  status: z.enum(['open', 'closed']).default('open'),
  /** Biome de l'arène pour tout l'arc (ancien emplacement ; settings.biome prime). */
  biome: id.optional(),
  /** Réglages courants de la régie, appliqués au prochain épisode. */
  settings: ArcSettingsSchema.default({}),
  episodes: z.array(EpisodeSchema).default([]),
});
export type Arc = z.infer<typeof ArcSchema>;

export function parseArc(raw: unknown, data: GameData): Arc {
  const result = ArcSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Arc invalide :\n${result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  const arc = result.data;
  const heroIds = new Set(data.heroes.map((h) => h.id));
  const equipment = new Set(data.equipment.map((e) => e.id));
  const problems: string[] = [];
  for (const h of arc.heroes) if (!heroIds.has(h)) problems.push(`héros inconnu : ${h}`);
  const checkSettings = (s: ArcSettings | undefined, where: string) => {
    if (!s) return;
    if (s.biome && !data.biomes.some((b) => b.id === s.biome)) problems.push(`${where} : biome inconnu ${s.biome}`);
    for (const [team, army] of Object.entries(s.armies ?? {}))
      for (const unitId of Object.keys(army)) {
        const unit = data.units.find((u) => u.id === unitId);
        if (!unit || unit.team !== team) problems.push(`${where} : unité ${unitId} invalide pour ${team}`);
      }
    for (const ev of Object.keys(s.eventWeights ?? {})) if (!data.events.some((e) => e.id === ev)) problems.push(`${where} : incident inconnu ${ev}`);
  };
  checkSettings(arc.settings, 'réglages');
  arc.episodes.forEach((ep) => checkSettings(ep.settings, `épisode ${ep.number}`));
  arc.episodes.forEach((ep, i) => {
    if (ep.number !== i + 1) problems.push(`épisode ${i + 1} numéroté ${ep.number}`);
    if (!arc.heroes.includes(ep.recipient)) problems.push(`épisode ${ep.number} : ${ep.recipient} n'est pas dans l'arc`);
    for (const o of ep.options) if (!equipment.has(o)) problems.push(`épisode ${ep.number} : équipement inconnu ${o}`);
    if (ep.upgrade && !ep.options.includes(ep.upgrade)) problems.push(`épisode ${ep.number} : l'upgrade ${ep.upgrade} ne faisait pas partie des options`);
    if (new Set(ep.options).size !== ep.options.length) problems.push(`épisode ${ep.number} : option en double`);
    const owned = upgradesBefore(arc, ep.number)[ep.recipient] ?? [];
    for (const o of ep.options) if (owned.includes(o)) problems.push(`épisode ${ep.number} : ${ep.recipient} possède déjà ${o}`);
    if (ep.votes && ep.votes.length !== ep.options.length) problems.push(`épisode ${ep.number} : ${ep.votes.length} comptes de voix pour ${ep.options.length} options`);
  });
  if (problems.length) throw new Error(`Arc ${arc.id} incohérent :\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  return arc;
}

/** Upgrades gagnées par chaque héros avant l'épisode demandé (1 = début d'arc). */
export function upgradesBefore(arc: Arc, episodeNumber: number): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const ep of arc.episodes) {
    if (ep.number >= episodeNumber || !ep.upgrade) continue;
    (out[ep.recipient] ??= []).push(ep.upgrade);
  }
  return out;
}

/** K.O. cumulés de chaque héros sur les épisodes précédents. */
export function killsBefore(arc: Arc, episodeNumber: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ep of arc.episodes) {
    if (ep.number >= episodeNumber || !ep.heroKills) continue;
    for (const [hero, k] of Object.entries(ep.heroKills)) out[hero] = (out[hero] ?? 0) + k;
  }
  return out;
}

/** Réglages qui s'appliquent à l'épisode n : sa copie s'il est figé, sinon les réglages courants de l'arc. */
export function settingsFor(arc: Arc, episodeNumber: number): ArcSettings {
  const ep = arc.episodes.find((e) => e.number === episodeNumber);
  return ep?.settings ?? { ...arc.settings, biome: arc.settings.biome ?? arc.biome };
}

/** Données de jeu avec les réglages de la régie appliqués (copie ; l'original n'est pas modifié). */
export function withSettings(data: GameData, s: ArcSettings): GameData {
  const d = structuredClone(data);
  if (s.biome) d.battle.biome = s.biome;
  if (s.armies) d.battle.armies = { ...d.battle.armies, ...s.armies };
  if (s.eventsPerMinute !== undefined) d.battle.events.perMinute = s.eventsPerMinute;
  if (s.eventWeights) {
    d.events = d.events
      .map((e) => (s.eventWeights![e.id] === undefined ? e : { ...e, weight: s.eventWeights![e.id] }))
      .filter((e) => e.weight > 0);
  }
  const g = s.gagChances ?? {};
  if (g.headClash !== undefined) d.battle.gags.headClash.chance = g.headClash;
  if (g.victoryDance !== undefined) d.battle.gags.victoryDance.chance = g.victoryDance;
  if (g.lostWeapon !== undefined) d.battle.gags.lostWeapon.chance = g.lostWeapon;
  return d;
}

/** Tout ce qu'il faut pour simuler l'épisode n d'un arc. */
export function episodeSetup(arc: Arc, n: number, seed: string, data: GameData) {
  const settings = settingsFor(arc, n);
  return {
    data: withSettings(data, settings),
    setup: { seed, heroes: arcHeroes(arc, data), upgrades: upgradesBefore(arc, n), biome: settings.biome },
    settings,
  };
}

/** Héros de l'arc, avec leur définition (pour lancer un combat). */
export function arcHeroes(arc: Arc, data: GameData) {
  return data.heroes.filter((h) => arc.heroes.includes(h.id));
}

/** Option gagnante d'un vote (égalité : la première dans l'ordre, pour rester déterministe). */
export function voteWinner(options: readonly string[], votes: readonly number[]): string {
  let best = 0;
  for (let i = 1; i < votes.length; i++) if (votes[i] > votes[best]) best = i;
  return options[best];
}

/**
 * Compte les votes d'un export de commentaires : un commentaire par ligne, éventuellement
 * précédé de l'auteur ("auteur<TAB>texte", ou "auteur;texte" si l'auteur ne contient ni chiffre
 * ni espace). Une voix par auteur (la dernière), en ne gardant que le premier numéro isolé de 1 à n.
 */
export function countVotes(text: string, optionCount: number): number[] {
  const byAuthor = new Map<string, number>();
  let anonymous = 0;
  const counts = Array<number>(optionCount).fill(0);
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tab = line.indexOf('\t');
    const semi = line.indexOf(';');
    const sep = tab > 0 ? tab : semi > 0 && !/[\s\d]/.test(line.slice(0, semi)) ? semi : -1;
    const author = sep > 0 ? line.slice(0, sep).trim().toLowerCase() : `#${anonymous++}`;
    const body = sep > 0 ? line.slice(sep + 1) : line;
    const match = body.match(/(?<![\d])([1-9])(?![\d])/);
    if (!match) continue;
    const choice = Number(match[1]);
    if (choice >= 1 && choice <= optionCount) byAuthor.set(author, choice - 1);
  }
  for (const choice of byAuthor.values()) counts[choice]++;
  return counts;
}
