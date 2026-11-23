// Gestion du feuilleton : npm run episode -- <commande> [options]
//
//   status                                  état de l'arc, upgrades des héros, prévisibilité
//   scout  [--runs 100] [--from 1000]       meilleures seeds pour le prochain épisode
//   plan   --seed 47 [--recipient kevin] [--options laser_goggles,magic_sword,grenades]
//                                           fige le prochain épisode (vérifie le combat) ; sans --options,
//                                           tirage déterministe parmi les upgrades libres du héros
//   vote   --votes 120,340,95 | --comments export.txt
//                                           compte le vote et attribue l'upgrade gagnante
//   unvote [--ep 3]                         annule le dernier vote compté (tant que l'épisode suivant n'est pas figé)
//   new-arc --id arc2 --title "..." [--heroes bob,kevin,...]   (refusé tant qu'un arc est ouvert)
//   close                                   clôt l'arc en cours
//
// --arc arc1 choisit l'arc (par défaut : le seul arc ouvert).
//
// Règles de la boucle (src/data/arc.ts, communes avec la régie) :
//   - l'upgrade va au héros le moins équipé du camp perdant (puis le moins de K.O.), hors héros saturés ;
//   - match nul : pas de camp perdant, donc pas d'upgrade : l'épisode ne peut pas être figé ;
//   - égalité de voix : l'option au plus petit numéro l'emporte ; un vote sans aucune voix est refusé.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData } from '../src/data';
import {
  arcHeroes,
  cancelVote,
  countVotes,
  episodeSetup,
  freeUpgrades,
  heroTeam as teamOf,
  loserOf,
  parseArc,
  proposeOptions,
  recipientCandidates,
  suggestRecipient,
  upgradesBefore,
  voteWinner,
  type Arc,
  type Episode,
} from '../src/data/arc';
import { aggregate, END_LABEL, endType, scoutScore, simulate, WINNER_LABEL, type BattleSummary } from '../src/tools/metrics';

const ARCS_DIR = join(import.meta.dirname, '../src/data/arcs');
const [command = 'status', ...args] = process.argv.slice(2);
/** Valeur d'une option ; une valeur qui commence par « -- » est l'option suivante, pas une valeur. */
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  const value = i >= 0 ? args[i + 1] : undefined;
  return value === undefined || value.startsWith('--') ? undefined : value;
};

const data = loadGameData();

const arcPath = (id: string) => join(ARCS_DIR, `${id}.json`);

/** Tous les arcs, triés par identifiant (ordre stable, indépendant du système de fichiers). */
function loadArcs(): Arc[] {
  return readdirSync(ARCS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => parseArc(JSON.parse(readFileSync(join(ARCS_DIR, f), 'utf8')), data));
}

function loadArc(): Arc {
  const wanted = opt('arc');
  const arcs = loadArcs();
  if (wanted) {
    const arc = arcs.find((a) => a.id === wanted);
    if (!arc) throw new Error(`arc introuvable : ${wanted}`);
    return arc;
  }
  const open = arcs.filter((a) => a.status === 'open');
  if (open.length > 1) throw new Error(`plusieurs arcs ouverts (${open.map((a) => a.id).join(', ')}) : préciser --arc, ou clore les anciens`);
  if (!open.length) throw new Error('aucun arc ouvert (npm run episode -- new-arc --id ...)');
  return open[0];
}

function saveArc(arc: Arc) {
  writeFileSync(arcPath(arc.id), JSON.stringify(arc, null, 2) + '\n');
}

/** Simule l'épisode n avec les réglages de l'arc. */
const run = (arc: Arc, n: number, seed: string): BattleSummary => {
  const e = episodeSetup(arc, n, seed, data);
  return simulate(e.data, e.setup);
};

const label = (id: string) => data.equipment.find((e) => e.id === id)?.short ?? id;
const longLabel = (id: string) => data.equipment.find((e) => e.id === id)?.label ?? id;
const heroName = (id: string) => data.heroes.find((h) => h.id === id)?.name ?? id;
const heroTeam = (id: string) => teamOf(data, id);
const nextNumber = (arc: Arc) => arc.episodes.length + 1;
const pendingVote = (arc: Arc): Episode | undefined => arc.episodes.find((e) => !e.upgrade);
const numbered = (options: string[]) => options.map((o, i) => `${i + 1} ${label(o)}`).join(', ');

function status() {
  const arc = loadArc();
  const n = nextNumber(arc);
  console.log(`${arc.title} (${arc.id}, ${arc.status === 'open' ? 'ouvert' : 'clos'}) — ${arc.episodes.length} épisode(s)\n`);
  const ups = upgradesBefore(arc, n);
  for (const h of arcHeroes(arc, data)) {
    const list = ups[h.id] ?? [];
    const free = freeUpgrades(arc, n, h.id, data).length;
    const full = free < 2 ? `  (saturé : ${free} upgrade libre)` : '';
    console.log(`  ${h.name.padEnd(10)} ${String(heroTeam(h.id)).padEnd(8)} ${list.length ? list.map(label).join(', ') : '—'}${full}`);
  }
  for (const ep of arc.episodes) {
    const vote = ep.upgrade
      ? `${heroName(ep.recipient)} reçoit ${label(ep.upgrade)}${ep.votes ? '' : ' (d’office)'}`
      : `vote en attente (${heroName(ep.recipient)} : ${numbered(ep.options)})`;
    console.log(`\n  Ép. ${ep.number} · seed ${ep.seed} · ${WINNER_LABEL[ep.winner]} en ${ep.duration.toFixed(1)} s · ${vote}`);
    // Un épisode publié doit se rejouer à l'identique : sinon, une donnée a changé depuis.
    const replay = run(arc, ep.number, ep.seed);
    if (replay.winner !== ep.winner || Math.abs(replay.duration - ep.duration) >= 0.2) {
      console.log(`    ⚠ ne se rejoue plus pareil : ${WINNER_LABEL[replay.winner]} en ${replay.duration.toFixed(1)} s (une donnée a changé depuis la planification)`);
    }
  }
  const report = aggregate(Array.from({ length: 60 }, (_, i) => run(arc, n, String(90_000 + i))));
  const top = Math.max(report.winRate.gnomes, report.winRate.goblins);
  console.log(
    `\nRapport de force pour l'épisode ${n} (60 seeds) : gnomes ${(report.winRate.gnomes * 100).toFixed(0)} % · gobelins ${(report.winRate.goblins * 100).toFixed(0)} % · retournements ${(report.comebackRate * 100).toFixed(0)} %`,
  );
  if (top > 0.8) console.log(`⚠ Combats devenus prévisibles (${(top * 100).toFixed(0)} % pour un camp) : envisager de clore l'arc.`);
  const pending = pendingVote(arc);
  if (pending) console.log(`\nÀ faire : compter le vote de l'épisode ${pending.number} (npm run episode -- vote --votes ${pending.options.map(() => 'n').join(',')}).`);
}

function scout() {
  const arc = loadArc();
  const n = nextNumber(arc);
  const runs = Number(opt('runs') ?? 100);
  const from = Number(opt('from') ?? n * 1000);
  const list: BattleSummary[] = Array.from({ length: runs }, (_, i) => run(arc, n, String(from + i)));
  const previous = arc.episodes.at(-1)?.endType;
  console.log(`Épisode ${n} : ${runs} seeds simulées (${from} à ${from + runs - 1})${previous ? ` · fin précédente : ${END_LABEL[previous]} (pénalisée)` : ''}\n`);
  for (const s of [...list].sort((a, b) => scoutScore(b, previous) - scoutScore(a, previous)).slice(0, Number(opt('top') ?? 8))) {
    console.log(`  seed ${String(s.seed).padEnd(6)} ${WINNER_LABEL[s.winner].padEnd(9)} ${s.duration.toFixed(1)} s · ${END_LABEL[endType(s)]} · perdant +${(s.loserMaxLead * 100).toFixed(0)} %`);
  }
  console.log(`\nRevoir : http://localhost:5173/?arc=${arc.id}&ep=${n}&seed=<seed>  (ajouter &record=1 pour enregistrer)`);
}

function plan() {
  const arc = loadArc();
  if (arc.status !== 'open') throw new Error(`l'arc ${arc.id} est clos`);
  const pending = pendingVote(arc);
  if (pending) throw new Error(`le vote de l'épisode ${pending.number} n'est pas encore compté`);
  const seed = opt('seed');
  if (!seed) throw new Error('--seed requis (voir npm run episode -- scout)');
  const n = nextNumber(arc);
  const { settings } = episodeSetup(arc, n, seed, data);
  const summary = run(arc, n, seed);
  const loser = loserOf(summary.winner);
  if (!loser) throw new Error(`seed ${seed} : match nul, pas de camp perdant donc pas d'upgrade — choisir une autre seed`);

  const asked = opt('recipient');
  if (asked && !arc.heroes.includes(asked)) throw new Error(`${asked} n'est pas un héros de l'arc (${arc.heroes.join(', ')})`);
  if (asked && heroTeam(asked) !== loser) throw new Error(`${heroName(asked)} est dans le camp vainqueur : l'upgrade va à un héros du camp perdant`);
  const recipient = asked ?? suggestRecipient(arc, n, summary.winner, summary.heroKills, data);
  if (!recipient) {
    const all = recipientCandidates(arc, n, summary.winner, summary.heroKills, data);
    throw new Error(
      all.length
        ? `tous les héros du camp perdant sont saturés (${all.map((c) => heroName(c.hero)).join(', ')}) : choisir une seed où l'autre camp perd, ou --recipient pour leur dernière upgrade`
        : `aucun héros de l'arc dans le camp perdant (${WINNER_LABEL[loser]})`,
    );
  }

  const proposal = proposeOptions(arc, n, recipient, seed, data);
  const owned = new Set(upgradesBefore(arc, n)[recipient] ?? []);
  const manual = opt('options')?.split(',').filter(Boolean);
  if (manual) {
    for (const o of manual) {
      if (!data.equipment.some((e) => e.id === o)) throw new Error(`upgrade inconnue : ${o} (connues : ${data.equipment.map((e) => e.id).join(', ')})`);
      if (owned.has(o)) throw new Error(`${heroName(recipient)} possède déjà ${longLabel(o)}`);
      if (!proposal.free.includes(o)) console.log(`⚠ ${longLabel(o)} n'est pas prévue pour le rôle de ${heroName(recipient)} (champ roles d'equipment.json).`);
    }
    if (new Set(manual).size !== manual.length) throw new Error('--options : une option est en double');
  }
  const options = manual ?? proposal.options;
  if (!options.length) throw new Error(`${heroName(recipient)} n'a plus aucune upgrade libre : choisir un autre héros (--recipient)`);
  if (options.length === 1 && !asked && !manual) throw new Error(`${heroName(recipient)} est saturé : choisir un autre héros (--recipient)`);
  // Une seule option : pas de vote, l'upgrade est attribuée d'office.
  const single = options.length === 1;

  arc.episodes.push({
    number: n,
    seed,
    winner: summary.winner,
    duration: Math.round(summary.duration * 10) / 10,
    recipient,
    options,
    votes: null,
    upgrade: single ? options[0] : null,
    heroKills: summary.heroKills,
    endType: endType(summary),
    settings,
  });
  saveArc(parseArc(arc, data));
  console.log(`Épisode ${n} figé : seed ${seed}, victoire des ${WINNER_LABEL[summary.winner]} en ${summary.duration.toFixed(1)} s.`);
  if (single) console.log(`${heroName(recipient)} reçoit d'office sa dernière upgrade : ${longLabel(options[0])} (pas de vote).`);
  else console.log(`${heroName(recipient)} recevra la prochaine upgrade — votez : ${numbered(options)}${manual ? '' : ' (tirage, modifiable avec --options)'}`);
  console.log(`\nEnregistrer : http://localhost:5173/?arc=${arc.id}&ep=${n}&record=1`);
}

function vote() {
  const arc = loadArc();
  const ep = pendingVote(arc);
  if (!ep) throw new Error('aucun vote en attente');
  const file = opt('comments');
  const votes = file ? countVotes(readFileSync(file, 'utf8'), ep.options.length) : opt('votes')?.split(',').map(Number);
  if (!votes || votes.length !== ep.options.length || votes.some((v) => !Number.isInteger(v) || v < 0)) {
    throw new Error(`--votes attend ${ep.options.length} nombres (ex. ${ep.options.map((_, i) => [120, 340, 95, 60][i]).join(',')}) ou --comments <fichier>`);
  }
  if (!votes.some((v) => v > 0)) {
    throw new Error(file ? `aucun numéro de 1 à ${ep.options.length} reconnu dans ${file} : vote refusé` : 'aucune voix (tous les comptes à 0) : vote refusé');
  }
  ep.votes = votes;
  ep.upgrade = voteWinner(ep.options, votes);
  saveArc(parseArc(arc, data));
  const best = Math.max(...votes);
  const tie = votes.filter((v) => v === best).length > 1;
  console.log(`Vote de l'épisode ${ep.number} : ${ep.options.map((o, i) => `${label(o)} ${votes[i]}`).join(' · ')}`);
  if (tie) console.log(`Égalité de voix : l'option au plus petit numéro l'emporte.`);
  console.log(`${heroName(ep.recipient)} reçoit : ${longLabel(ep.upgrade)}.`);
  console.log(`(Erreur de saisie ? npm run episode -- unvote, tant que l'épisode ${ep.number + 1} n'est pas figé.)`);
}

function unvote() {
  const arc = loadArc();
  const asked = opt('ep');
  const ep = asked ? arc.episodes.find((e) => e.number === Number(asked)) : arc.episodes.filter((e) => e.upgrade).at(-1);
  if (!ep) throw new Error(asked ? `épisode ${asked} introuvable` : 'aucun vote compté dans cet arc');
  if (ep.upgrade && !ep.votes) throw new Error(`l'upgrade de l'épisode ${ep.number} a été attribuée d'office (pas de vote à annuler)`);
  const before = ep.upgrade;
  saveArc(parseArc(cancelVote(arc, ep.number), data));
  console.log(`Vote de l'épisode ${ep.number} annulé : ${heroName(ep.recipient)} ne reçoit plus ${longLabel(before ?? '')}.`);
  console.log(`Recompter : npm run episode -- vote --votes ${ep.options.map(() => 'n').join(',')}`);
}

function newArc() {
  const id = opt('id');
  if (!id) throw new Error('--id requis');
  if (existsSync(arcPath(id))) throw new Error(`l'arc ${id} existe déjà`);
  const open = loadArcs().filter((a) => a.status === 'open');
  if (open.length) throw new Error(`l'arc ${open.map((a) => a.id).join(', ')} est encore ouvert : le clore d'abord (npm run episode -- close)`);
  const heroes = opt('heroes')?.split(',') ?? data.heroes.filter((h) => h.active).map((h) => h.id);
  saveArc(parseArc({ id, title: opt('title') ?? id, heroes, status: 'open', episodes: [] }, data));
  console.log(`Arc ${id} créé avec ${heroes.map(heroName).join(', ')}.`);
}

function close() {
  const arc = loadArc();
  arc.status = 'closed';
  saveArc(arc);
  console.log(`Arc ${arc.id} clos après ${arc.episodes.length} épisode(s).`);
}

const commands: Record<string, () => void> = { status, scout, plan, vote, unvote, 'new-arc': newArc, close };
try {
  if (!commands[command]) throw new Error(`commande inconnue : ${command} (commandes : ${Object.keys(commands).join(', ')})`);
  commands[command]();
} catch (e) {
  console.error(`Erreur : ${(e as Error).message}`);
  process.exit(1);
}
