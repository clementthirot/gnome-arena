// Arcs et épisodes : l'état du feuilleton. Un arc est un fichier JSON versionné ;
// l'état des héros à l'épisode N se déduit des upgrades votées aux épisodes précédents.
import { z } from 'zod';
import type { GameData } from './schema';
import { TeamId } from './schema';

const id = z.string().regex(/^[a-z0-9_-]+$/);

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
});
export type Episode = z.infer<typeof EpisodeSchema>;

export const ArcSchema = z.object({
  id,
  title: z.string(),
  /** Héros engagés dans l'arc (les autres sont mis de côté). */
  heroes: z.array(id).min(2),
  status: z.enum(['open', 'closed']).default('open'),
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
