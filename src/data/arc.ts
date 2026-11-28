// Arcs et épisodes : l'état du feuilleton. Un arc est un fichier JSON versionné ;
// l'état des héros à l'épisode N se déduit des upgrades votées aux épisodes précédents.
import { z } from 'zod';
import { hashSeed, Rng } from '../sim/rng';
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
  /**
   * Résultat attendu, vérifié à la planification (même seed + même état = même combat).
   * Match nul : il n'y a pas de camp perdant, donc pas d'upgrade ; un tel épisode ne peut pas être
   * figé (parseArc le refuse), il faut choisir une autre seed. En vidéo, l'écran de fin annonce un
   * « MATCH NUL » et le vote est reporté (même règle dans la CLI, la régie et l'arène).
   */
  winner: z.union([TeamId, z.literal('draw')]),
  duration: z.number().positive(),
  /** Héros de l'équipe perdante qui recevra l'upgrade votée. */
  recipient: id,
  /**
   * Options proposées au vote, dans l'ordre des numéros : 3 en général, 2 s'il n'en reste que 2.
   * Une seule option (dernière upgrade d'un héros, choisie à la main) : attribuée d'office, sans vote.
   */
  options: z.array(id).min(1).max(4),
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
  /** Thème visuel de l'arc (src/render/themes/<id>.json) : l'arène et la régie l'ouvrent dans ce thème. */
  theme: id.optional(),
  /**
   * Upgrades que l'arc peut proposer au vote (pool). Absent : toutes les upgrades de base (sans pack).
   * Un pack de thème cite ici ses reskins et ses upgrades propres.
   */
  upgrades: z.array(id).min(2).optional(),
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
  for (const up of arc.upgrades ?? []) {
    const eq = data.equipment.find((e) => e.id === up);
    if (!eq) problems.push(`upgrade inconnue dans le pool : ${up}`);
    else if (eq.innate) problems.push(`${up} est une capacité propre de héros, pas une upgrade votable`);
  }
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
    if (ep.winner === 'draw') problems.push(`épisode ${ep.number} : match nul, pas de camp perdant pour recevoir l'upgrade (choisir une autre seed)`);
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

/**
 * Option gagnante d'un vote. Égalité de voix : l'option au plus petit numéro l'emporte (règle fixe et
 * déterministe). Refuse un vote sans aucune voix (sinon l'option 1 gagnerait en silence) et des
 * comptes qui ne correspondent pas aux options.
 */
export function voteWinner(options: readonly string[], votes: readonly number[]): string {
  if (votes.length !== options.length) throw new Error(`${votes.length} comptes de voix pour ${options.length} options`);
  if (votes.some((v) => !Number.isInteger(v) || v < 0)) throw new Error(`comptes de voix invalides : ${votes.join(', ')}`);
  if (!votes.some((v) => v > 0)) throw new Error('aucune voix comptée : vote refusé (vérifier les comptes ou l’export des commentaires)');
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
    // Export à plusieurs colonnes (auteur, texte, likes…) : seul le texte compte.
    const rest = sep > 0 ? line.slice(sep + 1) : line;
    const body = sep > 0 && sep === tab ? rest.split('\t')[0] : rest;
    const match = body.match(/(?<![\d])([1-9])(?![\d])/);
    if (!match) continue;
    const choice = Number(match[1]);
    if (choice >= 1 && choice <= optionCount) byAuthor.set(author, choice - 1);
  }
  for (const choice of byAuthor.values()) counts[choice]++;
  return counts;
}

// ------------------------------------------------------------ boucle d'upgrade (partagée par la CLI et la régie)

/** Camp d'un héros (celui de son unité de base). */
export function heroTeam(data: GameData, heroId: string): TeamId | undefined {
  const hero = data.heroes.find((h) => h.id === heroId);
  return data.units.find((u) => u.id === hero?.base)?.team;
}

/** Rôle d'un héros (celui de son unité de base). */
export function heroRole(data: GameData, heroId: string): string | undefined {
  const hero = data.heroes.find((h) => h.id === heroId);
  return data.units.find((u) => u.id === hero?.base)?.role;
}

/** Camp perdant d'un combat ; aucun en cas de match nul (pas d'upgrade, vote reporté). */
export function loserOf(winner: TeamId | 'draw'): TeamId | undefined {
  return winner === 'gnomes' ? 'goblins' : winner === 'goblins' ? 'gnomes' : undefined;
}

/** Nombre d'options du vote quand il reste assez d'upgrades libres. */
export const VOTE_OPTIONS = 3;

/** Upgrades que le héros peut encore recevoir à l'épisode n : autorisées pour son rôle et pas encore possédées (ordre du JSON). */
export function freeUpgrades(arc: Arc, n: number, heroId: string, data: GameData): string[] {
  const owned = new Set(upgradesBefore(arc, n)[heroId] ?? []);
  const role = heroRole(data, heroId);
  return votablePool(arc, data).filter((e) => !owned.has(e.id) && (!e.roles || (role !== undefined && e.roles.includes(role)))).map((e) => e.id);
}

/** Upgrades votables de l'arc : son pool s'il en a un, sinon toutes les upgrades de base ; jamais une capacité propre. */
export function votablePool(arc: Pick<Arc, 'upgrades'>, data: GameData) {
  const pool = arc.upgrades;
  return data.equipment.filter((e) => !e.innate && (pool ? pool.includes(e.id) : !e.pack));
}

/** Héros saturé : moins de 2 upgrades libres, donc plus de vrai vote possible pour lui. */
export function isSaturated(arc: Arc, n: number, heroId: string, data: GameData): boolean {
  return freeUpgrades(arc, n, heroId, data).length < 2;
}

export interface OptionProposal {
  /** Options proposées, dans l'ordre des numéros du vote : 3, ou 2 s'il n'en reste que 2 (1 ou 0 : héros saturé). */
  options: string[];
  /** Toutes les upgrades libres du héros (menus de la régie). */
  free: string[];
  /** Moins de 2 upgrades libres : le héros ne devrait pas être choisi comme bénéficiaire. */
  saturated: boolean;
}

/**
 * Options proposées par défaut pour le vote de l'épisode n : tirage déterministe (id d'arc, numéro
 * d'épisode, seed) parmi les upgrades libres du héros, filtrées par rôle. L'auteur peut toujours les
 * remplacer (--options de la CLI, menus de la régie pré-remplis avec ce tirage).
 */
export function proposeOptions(arc: Arc, n: number, recipient: string, seed: string, data: GameData): OptionProposal {
  const free = freeUpgrades(arc, n, recipient, data);
  const pool = [...free];
  const rng = new Rng(hashSeed(`${arc.id}|${n}|${seed}`));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return { options: pool.slice(0, VOTE_OPTIONS), free, saturated: free.length < 2 };
}

export interface RecipientCandidate {
  hero: string;
  upgrades: number;
  kills: number;
  saturated: boolean;
}

/**
 * Bénéficiaires possibles de l'upgrade : les héros de l'arc du camp perdant, du plus au moins indiqué.
 * Règle : le moins équipé d'abord, puis le moins de K.O. dans ce combat, puis l'ordre de l'arc ;
 * les héros saturés passent en dernier. Match nul : aucun candidat.
 */
export function recipientCandidates(arc: Arc, n: number, winner: TeamId | 'draw', heroKills: Record<string, number>, data: GameData): RecipientCandidate[] {
  const loser = loserOf(winner);
  if (!loser) return [];
  const ups = upgradesBefore(arc, n);
  return arc.heroes
    .filter((h) => heroTeam(data, h) === loser)
    .map((hero) => ({ hero, upgrades: ups[hero]?.length ?? 0, kills: heroKills[hero] ?? 0, saturated: isSaturated(arc, n, hero, data) }))
    .sort((a, b) => Number(a.saturated) - Number(b.saturated) || a.upgrades - b.upgrades || a.kills - b.kills);
}

/** Héros suggéré pour recevoir l'upgrade : le premier candidat non saturé (aucun si match nul ou si tous sont saturés). */
export function suggestRecipient(arc: Arc, n: number, winner: TeamId | 'draw', heroKills: Record<string, number>, data: GameData): string | undefined {
  return recipientCandidates(arc, n, winner, heroKills, data).find((c) => !c.saturated)?.hero;
}

/** Le vote de l'épisode n peut être annulé tant qu'aucun épisode suivant n'est figé. */
export function canCancelVote(arc: Arc, n: number): boolean {
  const ep = arc.episodes.find((e) => e.number === n);
  return !!ep?.upgrade && !arc.episodes.some((e) => e.number > n);
}

/** Copie de l'arc avec le vote de l'épisode n annulé (refusé si un épisode suivant est déjà figé). */
export function cancelVote(arc: Arc, n: number): Arc {
  const ep = arc.episodes.find((e) => e.number === n);
  if (!ep?.upgrade) throw new Error(`l'épisode ${n} n'a pas de vote compté`);
  if (!canCancelVote(arc, n)) throw new Error(`l'épisode ${n + 1} est déjà figé avec l'upgrade de l'épisode ${n} : vote non annulable`);
  const next = structuredClone(arc);
  const target = next.episodes.find((e) => e.number === n)!;
  target.votes = null;
  target.upgrade = null;
  return next;
}

export interface PreviousVote {
  recipient: string;
  team: TeamId;
  upgrade: string;
  options: string[];
  /** Voix par option (même ordre) ; null pour une upgrade attribuée d'office. */
  votes: number[] | null;
}

/** Vote de l'épisode n-1, à révéler au début de l'épisode n ; null s'il n'y en a pas (ép. 1, vote pas encore compté). */
export function previousVote(arc: Arc, n: number, data: GameData): PreviousVote | null {
  const ep = arc.episodes.find((e) => e.number === n - 1);
  const team = ep && heroTeam(data, ep.recipient);
  if (!ep?.upgrade || !team) return null;
  return { recipient: ep.recipient, team, upgrade: ep.upgrade, options: [...ep.options], votes: ep.votes ? [...ep.votes] : null };
}

/**
 * Upgrades saisies à la main (?up=, essais d'équilibrage) : refuse un héros ou un équipement inconnu
 * avec un message clair, et retire les doublons (une upgrade ne se cumule pas avec elle-même).
 */
export function normalizeUpgrades(raw: Record<string, readonly string[]>, data: GameData): Record<string, string[]> {
  const known = data.equipment.map((e) => e.id);
  const out: Record<string, string[]> = {};
  for (const [hero, list] of Object.entries(raw)) {
    if (!data.heroes.some((h) => h.id === hero)) throw new Error(`héros inconnu : ${hero} (connus : ${data.heroes.map((h) => h.id).join(', ')})`);
    for (const up of list) if (!known.includes(up)) throw new Error(`upgrade inconnue pour ${hero} : ${up} (connues : ${known.join(', ')})`);
    out[hero] = [...new Set(list)];
  }
  return out;
}
