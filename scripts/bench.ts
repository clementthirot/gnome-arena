// Mode accéléré en ligne de commande : npm run bench -- --runs 200 --from 1 [--set chemin=valeur] [--up grok:laser_goggles+iron_pot]
import { parseGameData, rawGameData } from '../src/data';
import { aggregate, formatReport, simulate, spectacleScore, WINNER_LABEL } from '../src/tools/metrics';

const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const runs = arg('runs', 100);
const from = arg('from', 1);
const top = arg('top', 5);

// --set battle.rules.damageScale=0.4 : teste un réglage sans modifier les JSON.
// Les éléments de tableau sont désignés par leur id : --set units.gnome_melee.hp=45
const raw = structuredClone(rawGameData);
args.forEach((a, i) => {
  if (a !== '--set') return;
  const [path, value] = args[i + 1].split('=');
  const keys = path.split('.');
  let node = raw as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) {
    node = (Array.isArray(node) ? node.find((x: { id: string }) => x.id === k) : node[k]) as Record<string, unknown>;
    if (!node) throw new Error(`--set : chemin inconnu « ${path} » (à « ${k} »)`);
  }
  node[keys[keys.length - 1]] = JSON.parse(value);
  console.log(`Réglage testé       : ${path} = ${value}`);
});
// Les réglages testés passent par la même validation que les JSON.
const data = parseGameData(raw);

const started = performance.now();
// --up : mesure l'effet d'une upgrade sur le rapport de force.
const upIndex = args.indexOf('--up');
const upgrades = upIndex >= 0
  ? Object.fromEntries(args[upIndex + 1].split(',').map((part) => { const [hero, items] = part.split(':'); return [hero, items.split('+')]; }))
  : undefined;
const summaries = Array.from({ length: runs }, (_, i) => simulate(data, { seed: from + i, upgrades }));
const elapsed = (performance.now() - started) / 1000;

console.log(formatReport(aggregate(summaries)));
console.log(`Temps de calcul     : ${elapsed.toFixed(1)} s (${(elapsed / runs * 1000).toFixed(0)} ms/combat)`);
console.log(`\nMeilleures seeds à rejouer :`);
for (const s of [...summaries].sort((a, b) => spectacleScore(b) - spectacleScore(a)).slice(0, top)) {
  console.log(
    `  seed ${String(s.seed).padEnd(6)} ${WINNER_LABEL[s.winner].padEnd(8)} ${s.duration.toFixed(1)} s · avance max du perdant +${(s.loserMaxLead * 100).toFixed(0)} %${s.lastStand ? ' · héros seul contre tous' : ''}`,
  );
}
