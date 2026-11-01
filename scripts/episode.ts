// Gestion du feuilleton : npm run episode -- <commande> [options]
//
//   status                                  état de l'arc, upgrades des héros, prévisibilité
//   scout  [--runs 100] [--from 1000]       meilleures seeds pour le prochain épisode
//   plan   --seed 47 [--recipient kevin] [--options laser_goggles,magic_sword,grenades]
//                                           fige le prochain épisode (vérifie le combat)
//   vote   --votes 120,340,95 | --comments export.txt
//                                           compte le vote et attribue l'upgrade gagnante
//   new-arc --id arc2 --title "..." [--heroes bob,kevin,...]
//   close                                   clôt l'arc en cours
//
// --arc arc1 choisit l'arc (par défaut : le seul arc ouvert).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData } from '../src/data';
import { arcHeroes, countVotes, parseArc, upgradesBefore, voteWinner, type Arc, type Episode } from '../src/data/arc';
import { opposingTeam } from '../src/sim';
import { aggregate, simulate, spectacleScore, WINNER_LABEL, type BattleSummary } from '../src/tools/metrics';

const ARCS_DIR = join(import.meta.dirname, '../src/data/arcs');
const [command = 'status', ...args] = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const data = loadGameData();

const arcPath = (id: string) => join(ARCS_DIR, `${id}.json`);

function loadArc(): Arc {
  const wanted = opt('arc');
  const files = readdirSync(ARCS_DIR).filter((f) => f.endsWith('.json'));
  const arcs = files.map((f) => parseArc(JSON.parse(readFileSync(join(ARCS_DIR, f), 'utf8')), data));
  const arc = wanted ? arcs.find((a) => a.id === wanted) : arcs.find((a) => a.status === 'open');
  if (!arc) throw new Error(wanted ? `arc introuvable : ${wanted}` : 'aucun arc ouvert (npm run episode -- new-arc --id ...)');
  return arc;
}

function saveArc(arc: Arc) {
  writeFileSync(arcPath(arc.id), JSON.stringify(arc, null, 2) + '\n');
}

/** Configuration d'un combat pour l'épisode n de l'arc. */
const setupFor = (arc: Arc, n: number, seed: string) => ({ seed, heroes: arcHeroes(arc, data), upgrades: upgradesBefore(arc, n) });

const label = (id: string) => data.equipment.find((e) => e.id === id)?.short ?? id;
const heroName = (id: string) => data.heroes.find((h) => h.id === id)?.name ?? id;
const heroTeam = (id: string) => data.units.find((u) => u.id === data.heroes.find((h) => h.id === id)?.base)?.team;
const nextNumber = (arc: Arc) => arc.episodes.length + 1;
const pendingVote = (arc: Arc): Episode | undefined => arc.episodes.find((e) => !e.upgrade);

function status() {
  const arc = loadArc();
  const n = nextNumber(arc);
  console.log(`${arc.title} (${arc.id}, ${arc.status === 'open' ? 'ouvert' : 'clos'}) — ${arc.episodes.length} épisode(s)\n`);
  const ups = upgradesBefore(arc, n);
  for (const h of arcHeroes(arc, data)) {
    const list = ups[h.id] ?? [];
    console.log(`  ${h.name.padEnd(10)} ${String(heroTeam(h.id)).padEnd(8)} ${list.length ? list.map(label).join(', ') : '—'}`);
  }
  for (const ep of arc.episodes) {
    const vote = ep.upgrade
      ? `${heroName(ep.recipient)} reçoit ${label(ep.upgrade)}`
      : `vote en attente (${heroName(ep.recipient)} : ${ep.options.map((o, i) => `${i + 1} ${label(o)}`).join(', ')})`;
    console.log(`\n  Ép. ${ep.number} · seed ${ep.seed} · ${WINNER_LABEL[ep.winner]} en ${ep.duration.toFixed(1)} s · ${vote}`);
    // Un épisode publié doit se rejouer à l'identique : sinon, une donnée a changé depuis.
    const replay = simulate(data, setupFor(arc, ep.number, ep.seed));
    if (replay.winner !== ep.winner || Math.abs(replay.duration - ep.duration) >= 0.2) {
      console.log(`    ⚠ ne se rejoue plus pareil : ${WINNER_LABEL[replay.winner]} en ${replay.duration.toFixed(1)} s (une donnée a changé depuis la planification)`);
    }
  }
  const report = aggregate(Array.from({ length: 60 }, (_, i) => simulate(data, setupFor(arc, n, String(90_000 + i)))));
  const top = Math.max(report.winRate.gnomes, report.winRate.goblins);
  console.log(
    `\nRapport de force pour l'épisode ${n} (60 seeds) : gnomes ${(report.winRate.gnomes * 100).toFixed(0)} % · gobelins ${(report.winRate.goblins * 100).toFixed(0)} % · retournements ${(report.comebackRate * 100).toFixed(0)} %`,
  );
  if (top > 0.8) console.log(`⚠ Combats devenus prévisibles (${(top * 100).toFixed(0)} % pour un camp) : envisager de clore l'arc.`);
  const pending = pendingVote(arc);
  if (pending) console.log(`\nÀ faire : compter le vote de l'épisode ${pending.number} (npm run episode -- vote --votes a,b,c).`);
}

function scout() {
  const arc = loadArc();
  const n = nextNumber(arc);
  const runs = Number(opt('runs') ?? 100);
  const from = Number(opt('from') ?? n * 1000);
  const list: BattleSummary[] = Array.from({ length: runs }, (_, i) => simulate(data, setupFor(arc, n, String(from + i))));
  console.log(`Épisode ${n} : ${runs} seeds simulées (${from} à ${from + runs - 1})\n`);
  for (const s of [...list].sort((a, b) => spectacleScore(b) - spectacleScore(a)).slice(0, Number(opt('top') ?? 8))) {
    console.log(
      `  seed ${String(s.seed).padEnd(6)} ${WINNER_LABEL[s.winner].padEnd(9)} ${s.duration.toFixed(1)} s · perdant +${(s.loserMaxLead * 100).toFixed(0)} %${s.lastStand ? ' · héros seul contre tous' : ''}`,
    );
  }
  console.log(`\nRevoir : http://localhost:5173/?arc=${arc.id}&ep=${n}&seed=<seed>  (ajouter &record=1 pour enregistrer)`);
}

/** Suggestion : le héros du camp perdant qui a le moins d'upgrades, puis le moins de K.O. dans ce combat. */
function suggestRecipient(arc: Arc, n: number, summary: BattleSummary): string | undefined {
  if (summary.winner === 'draw') return undefined;
  const loser = opposingTeam(summary.winner);
  const ups = upgradesBefore(arc, n);
  return arcHeroes(arc, data)
    .filter((h) => heroTeam(h.id) === loser)
    .sort((a, b) => (ups[a.id]?.length ?? 0) - (ups[b.id]?.length ?? 0) || (summary.heroKills[a.id] ?? 0) - (summary.heroKills[b.id] ?? 0))[0]?.id;
}

function plan() {
  const arc = loadArc();
  if (arc.status !== 'open') throw new Error(`l'arc ${arc.id} est clos`);
  const pending = pendingVote(arc);
  if (pending) throw new Error(`le vote de l'épisode ${pending.number} n'est pas encore compté`);
  const seed = opt('seed');
  if (!seed) throw new Error('--seed requis (voir npm run episode -- scout)');
  const n = nextNumber(arc);
  const summary = simulate(data, setupFor(arc, n, seed));
  if (summary.winner === 'draw') throw new Error(`seed ${seed} : égalité, choisir une autre seed`);
  const recipient = opt('recipient') ?? suggestRecipient(arc, n, summary);
  if (!recipient) throw new Error('aucun héros dans le camp perdant');
  if (heroTeam(recipient) === summary.winner) throw new Error(`${heroName(recipient)} est dans le camp vainqueur : l'upgrade va à un héros du camp perdant`);
  const owned = new Set(upgradesBefore(arc, n)[recipient] ?? []);
  const options = opt('options')?.split(',') ?? data.equipment.map((e) => e.id).filter((e) => !owned.has(e)).slice(0, 3);
  for (const o of options) if (owned.has(o)) throw new Error(`${heroName(recipient)} possède déjà ${label(o)}`);
  arc.episodes.push({
    number: n,
    seed,
    winner: summary.winner,
    duration: Math.round(summary.duration * 10) / 10,
    recipient,
    options,
    votes: null,
    upgrade: null,
  });
  saveArc(parseArc(arc, data));
  console.log(`Épisode ${n} figé : seed ${seed}, victoire des ${WINNER_LABEL[summary.winner]} en ${summary.duration.toFixed(1)} s.`);
  console.log(`${heroName(recipient)} recevra la prochaine upgrade — votez : ${options.map((o, i) => `${i + 1} ${label(o)}`).join(', ')}`);
  console.log(`\nEnregistrer : http://localhost:5173/?arc=${arc.id}&ep=${n}&record=1`);
}

function vote() {
  const arc = loadArc();
  const ep = pendingVote(arc);
  if (!ep) throw new Error('aucun vote en attente');
  const file = opt('comments');
  const votes = file ? countVotes(readFileSync(file, 'utf8'), ep.options.length) : opt('votes')?.split(',').map(Number);
  if (!votes || votes.length !== ep.options.length || votes.some((v) => !Number.isInteger(v) || v < 0)) {
    throw new Error(`--votes attend ${ep.options.length} nombres (ex. 120,340,95) ou --comments <fichier>`);
  }
  ep.votes = votes;
  ep.upgrade = voteWinner(ep.options, votes);
  saveArc(parseArc(arc, data));
  console.log(`Vote de l'épisode ${ep.number} : ${ep.options.map((o, i) => `${label(o)} ${votes[i]}`).join(' · ')}`);
  console.log(`${heroName(ep.recipient)} reçoit : ${data.equipment.find((e) => e.id === ep.upgrade)?.label}.`);
}

function newArc() {
  const id = opt('id');
  if (!id) throw new Error('--id requis');
  if (existsSync(arcPath(id))) throw new Error(`l'arc ${id} existe déjà`);
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

const commands: Record<string, () => void> = { status, scout, plan, vote, 'new-arc': newArc, close };
try {
  if (!commands[command]) throw new Error(`commande inconnue : ${command}`);
  commands[command]();
} catch (e) {
  console.error(`Erreur : ${(e as Error).message}`);
  process.exit(1);
}
