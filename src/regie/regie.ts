// Régie : préparer un épisode (scout, héros bénéficiaire, options de vote), régler l'arc
// (biome, effectifs, incidents, gags), compter les votes, clore un arc. Les arcs sont lus et
// écrits par le relais du serveur de dev (vite.config.ts), qui les valide avant d'écrire.
import { loadGameData } from '../data';
import { countVotes, killsBefore, parseArc, upgradesBefore, voteWinner, type Arc, type ArcSettings, type Episode } from '../data/arc';
import type { TeamId } from '../data/schema';
import { END_LABEL, WINNER_LABEL } from '../tools/metrics';
import type { ScoutMessage, ScoutRequest, ScoutRow } from './scout.worker';

const data = loadGameData();
const app = document.getElementById('app')!;
const arcSelect = document.getElementById('arc') as HTMLSelectElement;
const arcInfo = document.getElementById('arcInfo')!;

let arcs: Arc[] = [];
let arc: Arc | undefined;
let scoutRows: ScoutRow[] = [];
let picked: ScoutRow | undefined;
let worker: Worker | undefined;
/** Lecture des réglages tels qu'ils sont dans le formulaire (même non enregistrés). */
let readSettings: (() => ArcSettings) | undefined;
/** Carte de vote en cours de préparation (héros et options choisis). */
let draftVote: { recipient: string; options: string[] } | undefined;

// ------------------------------------------------------------ aperçu de l'arène (colonne de droite)

const frame = document.getElementById('preview') as HTMLIFrameElement;
const previewLabel = document.getElementById('previewLabel')!;
const skipIntro = document.getElementById('skipIntro') as HTMLInputElement;
const speedSelect = document.getElementById('speed') as HTMLSelectElement;

interface PreviewTarget {
  episode: number;
  seed: string;
  /** Réglages et vote en brouillon : seulement pour un épisode pas encore figé. */
  draft?: ArcSettings;
  vote?: { recipient: string; options: string[] };
  label: string;
}
let previewTarget: PreviewTarget | undefined;

function previewUrl(t: PreviewTarget, inTab = false): string {
  const q = new URLSearchParams({ arc: arc!.id, ep: String(t.episode), seed: t.seed });
  if (t.draft) q.set('draft', JSON.stringify(t.draft));
  if (t.vote) q.set('vote', `${t.vote.recipient}:${t.vote.options.join(',')}`);
  if (skipIntro.checked && !inTab) q.set('intro', '0');
  if (!inTab) q.set('speed', speedSelect.value);
  return `./?${q}`;
}

function preview(t: PreviewTarget): void {
  if (!arc) return;
  previewTarget = t;
  previewLabel.textContent = t.label;
  frame.src = previewUrl(t);
}

let previewTimer: number | undefined;
/** Aperçu du prochain épisode avec l'état courant du formulaire, après une courte pause de saisie. */
function previewNext(delay = 600): void {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    if (!arc) return;
    const n = arc.episodes.length + 1;
    const seed = picked ? String(picked.seed) : (previewTarget?.episode === n ? previewTarget.seed : String(n * 1000));
    preview({ episode: n, seed, draft: readSettings?.(), vote: picked ? draftVote : undefined, label: `Épisode ${n} · seed ${seed} · brouillon` });
  }, delay);
}

document.getElementById('replay')!.onclick = () => previewTarget && preview(previewTarget);
skipIntro.onchange = () => previewTarget && preview(previewTarget);
speedSelect.onchange = () => previewTarget && preview(previewTarget);
document.getElementById('openTab')!.onclick = () => previewTarget && window.open(previewUrl(previewTarget, true), '_blank');

// Séparation régie / arène : glisser, ou boutons 2/3, 3/4, 4/5. Mémorisée dans ce navigateur.
const root = document.documentElement;
function setRatio(r: number): void {
  const ratio = Math.min(0.85, Math.max(0.35, r));
  root.style.setProperty('--left', `${(ratio * 100).toFixed(1)}%`);
  try {
    localStorage.setItem('regie.ratio', String(ratio));
  } catch {
    // stockage indisponible : on garde la valeur pour cette visite
  }
}
try {
  const saved = Number(localStorage.getItem('regie.ratio'));
  if (saved) setRatio(saved);
} catch {
  // stockage indisponible
}
document.querySelectorAll<HTMLButtonElement>('button[data-ratio]').forEach((b) => (b.onclick = () => setRatio(Number(b.dataset.ratio))));
const splitter = document.getElementById('splitter')!;
splitter.onpointerdown = (e) => {
  splitter.setPointerCapture(e.pointerId);
  splitter.classList.add('dragging');
  // L'iframe avalerait les mouvements de la souris pendant le glissement.
  frame.style.pointerEvents = 'none';
  splitter.onpointermove = (m) => setRatio(m.clientX / window.innerWidth);
  splitter.onpointerup = () => {
    splitter.classList.remove('dragging');
    frame.style.pointerEvents = '';
    splitter.onpointermove = null;
  };
};

const heroName = (id: string) => data.heroes.find((h) => h.id === id)?.name ?? id;
const heroTeam = (id: string): TeamId | undefined => data.units.find((u) => u.id === data.heroes.find((h) => h.id === id)?.base)?.team;
const eqLabel = (id: string) => data.equipment.find((e) => e.id === id)?.label ?? id;

// ------------------------------------------------------------ petits outils DOM

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function button(label: string, onClick: () => void, kind = ''): HTMLButtonElement {
  const b = el('button', kind ? { class: kind } : {}, label);
  b.onclick = onClick;
  return b;
}

function message(target: HTMLElement, text: string, ok: boolean): void {
  target.querySelector('.msg')?.remove();
  target.append(el('div', { class: `msg ${ok ? 'okmsg' : 'err'}` }, text));
}

function numberInput(value: number, step = 1, min = 0, max?: number): HTMLInputElement {
  const i = el('input', { type: 'number', step: String(step), min: String(min) });
  if (max !== undefined) i.max = String(max);
  i.value = String(value);
  return i;
}

// ------------------------------------------------------------ relais serveur

async function fetchArcs(): Promise<void> {
  const res = await fetch('./__regie/arcs');
  if (!res.ok) throw new Error('relais de la régie indisponible : lancer « npm run dev »');
  arcs = ((await res.json()) as unknown[]).map((a) => parseArc(a, data));
}

async function saveArc(next: Arc, status: HTMLElement, okText: string): Promise<boolean> {
  const res = await fetch(`./__regie/arcs/${next.id}`, { method: 'PUT', body: JSON.stringify(next), headers: { 'Content-Type': 'application/json' } });
  const body = await res.json();
  if (!res.ok) {
    message(status, `Refusé : ${body.error}`, false);
    return false;
  }
  await fetchArcs();
  arc = arcs.find((a) => a.id === next.id);
  render();
  message(app.querySelector('section') ?? app, okText, true);
  return true;
}

// ------------------------------------------------------------ sections

function arcSection(a: Arc): HTMLElement {
  const s = el('section', {}, el('h2', {}, 'ARC'));
  const n = a.episodes.length + 1;
  const ups = upgradesBefore(a, n);
  const kills = killsBefore(a, n);
  const table = el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Héros'), el('th', {}, 'Upgrades'), el('th', {}, 'K.O. arc'))));
  const tbody = el('tbody');
  for (const id of a.heroes) {
    const team = heroTeam(id) ?? 'gnomes';
    tbody.append(el('tr', {}, el('td', { class: team }, heroName(id)), el('td', {}, (ups[id] ?? []).map(eqLabel).join(', ') || '—'), el('td', {}, String(kills[id] ?? 0))));
  }
  table.append(tbody);
  s.append(table);

  for (const ep of a.episodes) {
    const line = `Ép. ${ep.number} · seed ${ep.seed} · ${WINNER_LABEL[ep.winner]} en ${ep.duration} s${ep.endType ? ` · ${END_LABEL[ep.endType]}` : ''}`;
    const block = el('div', { class: 'row' }, el('span', {}, line));
    if (ep.upgrade) block.append(el('span', { class: 'muted' }, `→ ${heroName(ep.recipient)} reçoit ${eqLabel(ep.upgrade)}`));
    else block.append(voteForm(a, ep));
    block.append(button('Revoir', () => preview({ episode: ep.number, seed: ep.seed, label: `Épisode ${ep.number} · seed ${ep.seed} · figé` })));
    s.append(block);
  }
  if (!a.episodes.length) s.append(el('p', { class: 'muted' }, 'Aucun épisode pour l’instant.'));
  return s;
}

function voteForm(a: Arc, ep: Episode): HTMLElement {
  const box = el('div', {});
  box.append(el('div', { class: 'muted' }, `Vote en attente pour ${heroName(ep.recipient)} :`));
  const inputs = ep.options.map(() => numberInput(0));
  const row = el('div', { class: 'row' });
  ep.options.forEach((o, i) => row.append(el('label', {}, `${i + 1}. ${eqLabel(o)}`, inputs[i])));
  const comments = el('textarea', { rows: '3', placeholder: 'ou coller un export de commentaires (auteur<TAB>texte, une ligne par commentaire)' });
  comments.style.width = '100%';
  const apply = button(
    'Valider le vote',
    async () => {
      const votes = comments.value.trim() ? countVotes(comments.value, ep.options.length) : inputs.map((i) => Number(i.value) || 0);
      const next = structuredClone(a);
      const target = next.episodes.find((e) => e.number === ep.number)!;
      target.votes = votes;
      target.upgrade = voteWinner(ep.options, votes);
      await saveArc(next, box, `Vote compté (${votes.join(' / ')}) : ${heroName(ep.recipient)} reçoit ${eqLabel(target.upgrade)}.`);
    },
    'ok',
  );
  box.append(row, comments, apply);
  return box;
}

function settingsSection(a: Arc): HTMLElement {
  const s = el('section', {}, el('h2', {}, "RÉGLAGES DE L'ARC"));
  const cur: ArcSettings = a.settings;
  const biome = el('select');
  for (const b of data.biomes) biome.append(el('option', { value: b.id }, b.label));
  biome.value = cur.biome ?? a.biome ?? data.battle.biome;
  s.append(el('label', {}, 'Biome', biome));

  // Effectifs : une valeur par type d'unité et par camp.
  const armyInputs: { team: TeamId; unit: string; input: HTMLInputElement }[] = [];
  for (const team of ['gnomes', 'goblins'] as const) {
    s.append(el('div', { class: team }, team === 'gnomes' ? 'Effectifs gnomes' : 'Effectifs gobelins'));
    const army = cur.armies?.[team] ?? data.battle.armies[team] ?? {};
    for (const unitId of Object.keys(data.battle.armies[team] ?? {})) {
      const input = numberInput(army[unitId] ?? 0, 1, 0, 80);
      armyInputs.push({ team, unit: unitId, input });
      s.append(el('label', {}, data.units.find((u) => u.id === unitId)?.label ?? unitId, input));
    }
  }

  s.append(el('div', {}, 'Incidents'));
  const perMinute = numberInput(cur.eventsPerMinute ?? data.battle.events.perMinute, 0.5);
  s.append(el('label', {}, 'Incidents par minute', perMinute));
  const weightInputs = data.events.map((e) => {
    const input = numberInput(cur.eventWeights?.[e.id] ?? e.weight, 0.5);
    s.append(el('label', {}, `${e.label} (poids)`, input));
    return { id: e.id, input };
  });

  s.append(el('div', {}, 'Gags (probabilités 0 à 1)'));
  const g = data.battle.gags;
  const gagInputs = {
    headClash: numberInput(cur.gagChances?.headClash ?? g.headClash.chance, 0.05, 0, 1),
    victoryDance: numberInput(cur.gagChances?.victoryDance ?? g.victoryDance.chance, 0.01, 0, 1),
    lostWeapon: numberInput(cur.gagChances?.lostWeapon ?? g.lostWeapon.chance, 0.005, 0, 1),
  };
  s.append(el('label', {}, 'Choc de têtes', gagInputs.headClash), el('label', {}, 'Danse de victoire', gagInputs.victoryDance), el('label', {}, 'Arme perdue', gagInputs.lostWeapon));

  readSettings = () => {
    const armies: NonNullable<ArcSettings['armies']> = {};
    for (const { team, unit, input } of armyInputs) (armies[team] ??= {})[unit] = Math.max(0, Math.round(Number(input.value) || 0));
    const clamp = (i: HTMLInputElement) => Math.min(1, Math.max(0, Number(i.value) || 0));
    return {
      biome: biome.value,
      armies,
      eventsPerMinute: Math.max(0, Number(perMinute.value) || 0),
      eventWeights: Object.fromEntries(weightInputs.map(({ id, input }) => [id, Math.max(0, Number(input.value) || 0)])),
      gagChances: { headClash: clamp(gagInputs.headClash), victoryDance: clamp(gagInputs.victoryDance), lostWeapon: clamp(gagInputs.lostWeapon) },
    };
  };
  // Chaque modification relance l'aperçu de droite avec les réglages en brouillon.
  s.addEventListener('input', () => previewNext());
  s.addEventListener('change', () => previewNext());
  s.append(
    el('p', { class: 'muted' }, "L'aperçu de droite suit le formulaire ; « Enregistrer » applique les réglages au prochain épisode."),
    button(
      'Enregistrer les réglages',
      async () => {
        const next = structuredClone(a);
        next.settings = readSettings!();
        await saveArc(next, s, 'Réglages enregistrés : ils s’appliquent au prochain épisode.');
      },
      'ok',
    ),
  );
  return s;
}

function nextSection(a: Arc): HTMLElement {
  const n = a.episodes.length + 1;
  const s = el('section', { class: 'wide' }, el('h2', {}, `PROCHAIN ÉPISODE : ${n}`));
  if (a.status === 'closed') {
    s.append(el('p', { class: 'muted' }, 'Arc clos.'));
    return s;
  }
  const pending = a.episodes.find((e) => !e.upgrade);
  if (pending) {
    s.append(el('p', { class: 'muted' }, `Compter d'abord le vote de l'épisode ${pending.number}.`));
    return s;
  }
  const runs = numberInput(100, 10, 10, 1000);
  const from = numberInput(n * 1000, 1, 0);
  const progress = el('span', { class: 'muted' });
  const scoutBtn = button('Lancer le scout', () => runScout(a, n, Number(from.value), Number(runs.value), progress));
  s.append(el('div', { class: 'row' }, el('label', {}, 'Seeds', runs), el('label', {}, 'à partir de', from), scoutBtn, progress));
  const previous = a.episodes.at(-1)?.endType;
  if (previous) s.append(el('p', { class: 'muted' }, `Fin précédente : ${END_LABEL[previous]} — les seeds qui finissent pareil sont pénalisées.`));

  if (scoutRows.length) {
    const table = el('table', {}, el('thead', {}, el('tr', {}, ...['Seed', 'Vainqueur', 'Durée', 'Fin', 'Avance du perdant', 'Score'].map((h) => el('th', {}, h)))));
    const tbody = el('tbody');
    for (const r of [...scoutRows].sort((x, y) => y.score - x.score).slice(0, 15)) {
      const tr = el(
        'tr',
        { class: `pick${picked?.seed === r.seed ? ' selected' : ''}` },
        el('td', {}, String(r.seed)),
        el('td', { class: r.winner === 'draw' ? '' : r.winner }, WINNER_LABEL[r.winner]),
        el('td', {}, `${r.duration.toFixed(1)} s`),
        el('td', {}, END_LABEL[r.endType]),
        el('td', {}, `+${(r.loserMaxLead * 100).toFixed(0)} %`),
        el('td', {}, r.score.toFixed(2)),
      );
      tr.onclick = () => {
        picked = r;
        render();
        previewNext(0);
      };
      tbody.append(tr);
    }
    table.append(tbody);
    s.append(table);
  }
  if (picked && picked.winner !== 'draw') s.append(planForm(a, n, picked));
  else if (picked) s.append(el('p', { class: 'msg err' }, 'Égalité : choisir une autre seed.'));
  return s;
}

function planForm(a: Arc, n: number, row: ScoutRow): HTMLElement {
  const box = el('div', {});
  const loser = row.winner === 'gnomes' ? 'goblins' : 'gnomes';
  const ups = upgradesBefore(a, n);
  const candidates = a.heroes.filter((h) => heroTeam(h) === loser);
  // Suggestion : le moins équipé, puis le moins de K.O. dans ce combat.
  candidates.sort((x, y) => (ups[x]?.length ?? 0) - (ups[y]?.length ?? 0) || (row.heroKills[x] ?? 0) - (row.heroKills[y] ?? 0));
  const recipient = el('select');
  for (const h of candidates) recipient.append(el('option', { value: h }, `${heroName(h)} (${(ups[h] ?? []).length} upgrade(s), ${row.heroKills[h] ?? 0} K.O.)`));
  const optionSelects = [0, 1, 2].map(() => el('select'));
  const fillOptions = () => {
    const owned = new Set(ups[recipient.value] ?? []);
    const free = data.equipment.filter((e) => !owned.has(e.id));
    optionSelects.forEach((sel, i) => {
      const keep = sel.value;
      sel.replaceChildren(...free.map((e) => el('option', { value: e.id }, e.label)));
      sel.value = free.some((e) => e.id === keep) ? keep : (free[i]?.id ?? '');
    });
  };
  const syncVote = () => {
    draftVote = { recipient: recipient.value, options: optionSelects.map((s) => s.value) };
  };
  recipient.onchange = () => {
    fillOptions();
    syncVote();
    previewNext();
  };
  optionSelects.forEach((sel) => (sel.onchange = () => (syncVote(), previewNext())));
  fillOptions();
  syncVote();

  box.append(
    el('div', { class: 'row' }, el('strong', {}, `Seed ${row.seed}`), el('span', { class: row.winner }, `victoire des ${WINNER_LABEL[row.winner]} en ${row.duration.toFixed(1)} s`)),
    el('label', {}, "Héros qui recevra l'upgrade", recipient),
    ...optionSelects.map((sel, i) => el('label', {}, `Option ${i + 1}`, sel)),
  );
  const actions = el('div', { class: 'row' });
  actions.append(
    button('Aperçu', () => previewNext(0)),
    button(
      "Figer l'épisode",
      async () => {
        const options = optionSelects.map((s) => s.value);
        if (new Set(options).size !== options.length) return message(box, 'Les trois options doivent être différentes.', false);
        const next = structuredClone(a);
        next.episodes.push({
          number: n,
          seed: String(row.seed),
          winner: row.winner,
          duration: Math.round(row.duration * 10) / 10,
          recipient: recipient.value,
          options,
          votes: null,
          upgrade: null,
          heroKills: row.heroKills,
          endType: row.endType,
          settings: { ...a.settings, biome: a.settings.biome ?? a.biome },
        });
        scoutRows = [];
        picked = undefined;
        if (await saveArc(next, box, `Épisode ${n} figé : l'enregistrement s'ouvre dans un nouvel onglet.`)) {
          window.open(`./?arc=${a.id}&ep=${n}&record=1`, '_blank');
        }
      },
      'ok',
    ),
  );
  box.append(actions);
  return box;
}

function runScout(a: Arc, n: number, from: number, runs: number, progress: HTMLElement): void {
  worker?.terminate();
  scoutRows = [];
  picked = undefined;
  worker = new Worker(new URL('./scout.worker.ts', import.meta.url), { type: 'module' });
  const started = performance.now();
  worker.onmessage = (e: MessageEvent<ScoutMessage>) => {
    const m = e.data;
    if (m.type === 'progress') {
      scoutRows.push(m.row);
      progress.textContent = `${m.done}/${runs}`;
      if (m.done % 20 === 0) render();
    } else if (m.type === 'done') {
      progress.textContent = `${runs} seeds en ${((performance.now() - started) / 1000).toFixed(1)} s`;
      render();
    } else {
      progress.textContent = `Erreur : ${m.message}`;
    }
  };
  worker.postMessage({ arc: a, episode: n, from, runs } satisfies ScoutRequest);
}

function endSection(a: Arc): HTMLElement {
  const s = el('section', {}, el('h2', {}, "FIN D'ARC"));
  if (a.status === 'open') {
    s.append(
      el('p', { class: 'muted' }, "L'alerte des 80 % (npm run episode -- status) reste indicative : la décision t'appartient."),
      button(
        "Clore l'arc",
        async () => {
          if (!confirm(`Clore ${a.title} ?`)) return;
          await saveArc({ ...structuredClone(a), status: 'closed' }, s, 'Arc clos.');
        },
        'danger',
      ),
    );
  }
  s.append(el('h2', {}, 'NOUVEL ARC'));
  const id = el('input', { placeholder: 'identifiant (arc2)' });
  const title = el('input', { placeholder: 'titre' });
  const biome = el('select');
  for (const b of data.biomes) biome.append(el('option', { value: b.id }, b.label));
  const boxes = data.heroes.map((h) => {
    const c = el('input', { type: 'checkbox' });
    c.checked = h.active;
    s.append(el('label', {}, h.name, c));
    return { id: h.id, c };
  });
  s.append(el('label', {}, 'Identifiant', id), el('label', {}, 'Titre', title), el('label', {}, 'Biome', biome));
  s.append(
    button("Créer l'arc", async () => {
      if (arcs.some((x) => x.id === id.value)) return message(s, 'Cet identifiant existe déjà.', false);
      const next = { id: id.value, title: title.value || id.value, heroes: boxes.filter((b) => b.c.checked).map((b) => b.id), status: 'open', settings: { biome: biome.value }, episodes: [] };
      if (await saveArc(next as Arc, s, 'Arc créé.')) arcSelect.value = id.value;
    }),
  );
  return s;
}

// ------------------------------------------------------------ rendu

function render(): void {
  arcSelect.replaceChildren(...arcs.map((a) => el('option', { value: a.id }, `${a.title}${a.status === 'closed' ? ' (clos)' : ''}`)));
  if (arc) arcSelect.value = arc.id;
  app.replaceChildren();
  if (!arc) {
    app.append(endSection({ id: 'arc', title: '', heroes: [], status: 'closed', settings: {}, episodes: [] } as Arc));
    return;
  }
  arcInfo.textContent = `${arc.episodes.length} épisode(s) · ${arc.status === 'open' ? 'ouvert' : 'clos'}`;
  app.append(nextSection(arc), arcSection(arc), settingsSection(arc), endSection(arc));
}

arcSelect.onchange = () => {
  arc = arcs.find((a) => a.id === arcSelect.value);
  scoutRows = [];
  picked = undefined;
  draftVote = undefined;
  render();
  previewNext(0);
};

fetchArcs()
  .then(() => {
    arc = arcs.find((a) => a.status === 'open') ?? arcs[0];
    render();
    previewNext(0);
  })
  .catch((e) => {
    app.append(el('section', {}, el('p', { class: 'msg err' }, (e as Error).message)));
  });
