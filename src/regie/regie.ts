// Régie : préparer un épisode (scout, héros bénéficiaire, options de vote), régler l'arc
// (biome, effectifs, incidents, gags), compter les votes, clore un arc. Les arcs sont lus et
// écrits par le relais du serveur de dev (vite.config.ts), qui les valide avant d'écrire.
import { loadGameData } from '../data';
import {
  cancelVote,
  canCancelVote,
  countVotes,
  killsBefore,
  parseArc,
  proposeOptions,
  recipientCandidates,
  upgradesBefore,
  voteWinner,
  type Arc,
  type ArcSettings,
  type Episode,
} from '../data/arc';
import type { TeamId } from '../data/schema';
import { END_LABEL, WINNER_LABEL } from '../tools/metrics';
import { freezeEpisode } from './freeze';
import type { ScoutMessage, ScoutRequest, ScoutRow } from './scout.worker';

const data = loadGameData();
const app = document.getElementById('app')!;
const arcSelect = document.getElementById('arc') as HTMLSelectElement;
const arcInfo = document.getElementById('arcInfo')!;

let arcs: Arc[] = [];
/** Révision de chaque arc au moment de sa lecture (contrôle des écritures concurrentes par le relais). */
let revisions = new Map<string, string>();
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

interface PreviewTarget {
  episode: number;
  seed: string;
  /** Réglages et vote en brouillon : seulement pour un épisode pas encore figé. */
  draft?: ArcSettings;
  vote?: { recipient: string; options: string[] };
  label: string;
}
let previewTarget: PreviewTarget | undefined;

function previewUrl(t: PreviewTarget): string {
  const q = new URLSearchParams({ arc: arc!.id, ep: String(t.episode), seed: t.seed });
  if (t.draft) q.set('draft', JSON.stringify(t.draft));
  if (t.vote) q.set('vote', `${t.vote.recipient}:${t.vote.options.join(',')}`);
  q.set('intro', '0');
  // La régie ouverte avec ?theme=noel prévisualise dans ce thème.
  const theme = new URLSearchParams(location.search).get('theme');
  if (theme) q.set('theme', theme);
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
// Nouvelle seed au hasard pour le prochain épisode (la sélection du scout est abandonnée).
document.getElementById('randomSeed')!.onclick = () => {
  if (!arc) return;
  const n = arc.episodes.length + 1;
  const seed = String(Math.floor(Math.random() * 1_000_000));
  if (picked) {
    picked = undefined;
    render();
  }
  preview({ episode: n, seed, draft: readSettings?.(), label: `Épisode ${n} · seed ${seed} · brouillon` });
};

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

/** Groupe repliable ; son état ouvert/fermé est mémorisé dans ce navigateur. */
function group(id: string, title: string, open = false): { node: HTMLDetailsElement; body: HTMLElement; summary: HTMLElement } {
  const node = el('details', { class: 'group' });
  const summary = el('span', { class: 'sum' });
  const body = el('div', { class: 'body' });
  node.append(el('summary', {}, title, summary), body);
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(`regie.group.${id}`);
  } catch {
    // stockage indisponible
  }
  node.open = saved === null ? open : saved === '1';
  node.addEventListener('toggle', () => {
    try {
      localStorage.setItem(`regie.group.${id}`, node.open ? '1' : '0');
    } catch {
      // stockage indisponible
    }
  });
  return { node, body, summary };
}

/** Réglage au curseur, avec sa valeur affichée à côté. Une valeur hors bornes élargit le curseur. */
function slider(text: string, value: number, step: number, min: number, max: number, format: (v: number) => string = String): { node: HTMLElement; input: HTMLInputElement } {
  const input = el('input', { type: 'range', step: String(step), min: String(min), max: String(Math.max(max, value)) });
  input.value = String(value);
  const out = el('output', {}, format(value));
  input.addEventListener('input', () => (out.textContent = format(Number(input.value))));
  return { node: el('label', { class: 'slider' }, el('span', {}, text), input, out), input };
}
const percent = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)} %`;

// ------------------------------------------------------------ relais serveur

async function fetchArcs(): Promise<void> {
  const res = await fetch('./__regie/arcs');
  if (!res.ok) throw new Error('relais de la régie indisponible : lancer « npm run dev »');
  const raw = (await res.json()) as { id: string; revision?: string }[];
  revisions = new Map(raw.flatMap((a) => (a.revision ? [[a.id, a.revision] as const] : [])));
  // Tri par identifiant : l'arc ouvert choisi par défaut ne dépend pas de l'ordre des fichiers.
  arcs = raw.map((a) => parseArc(a, data)).sort((x, y) => x.id.localeCompare(y.id));
}

async function saveArc(next: Arc, status: HTMLElement, okText: string): Promise<boolean> {
  const headers = { 'Content-Type': 'application/json', 'X-Arc-Revision': revisions.get(next.id) ?? 'new' };
  const res = await fetch(`./__regie/arcs/${next.id}`, { method: 'PUT', body: JSON.stringify(next), headers });
  const body = await res.json();
  if (res.status === 409) {
    // L'arc a été modifié ailleurs (CLI) : on recharge la version du disque au lieu de l'écraser.
    await fetchArcs();
    arc = arcs.find((a) => a.id === next.id) ?? arc;
    scoutRows = [];
    picked = undefined;
    render();
    message(app.querySelector('section') ?? app, `Refusé : ${body.error}.`, false);
    return false;
  }
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
    if (ep.upgrade) {
      const votes = ep.votes ? ` (${ep.votes.join(' / ')})` : ' (d’office)';
      block.append(el('span', { class: 'muted' }, `→ ${heroName(ep.recipient)} reçoit ${eqLabel(ep.upgrade)}${votes}`));
      // Erreur de saisie : le vote reste annulable tant que l'épisode suivant n'est pas figé.
      if (ep.votes && canCancelVote(a, ep.number)) {
        const undo = button('Annuler le vote', async () => {
          if (!confirm(`Annuler le vote de l'épisode ${ep.number} (${eqLabel(ep.upgrade!)} pour ${heroName(ep.recipient)}) ?`)) return;
          await saveArc(cancelVote(a, ep.number), block, `Vote de l'épisode ${ep.number} annulé : à recompter.`);
        });
        undo.classList.add('small');
        block.append(undo);
      }
    } else block.append(voteForm(a, ep));
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
      const fromComments = !!comments.value.trim();
      const votes = fromComments ? countVotes(comments.value, ep.options.length) : inputs.map((i) => Math.max(0, Math.round(Number(i.value) || 0)));
      if (!votes.some((v) => v > 0)) {
        return message(box, fromComments ? `Aucun numéro de 1 à ${ep.options.length} reconnu dans les commentaires : vote refusé.` : 'Aucune voix saisie : vote refusé.', false);
      }
      const next = structuredClone(a);
      const target = next.episodes.find((e) => e.number === ep.number)!;
      target.votes = votes;
      target.upgrade = voteWinner(ep.options, votes);
      const tie = votes.filter((v) => v === Math.max(...votes)).length > 1 ? ' Égalité de voix : le plus petit numéro l’emporte.' : '';
      await saveArc(next, box, `Vote compté (${votes.join(' / ')}) : ${heroName(ep.recipient)} reçoit ${eqLabel(target.upgrade)}.${tie}`);
    },
    'ok',
  );
  box.append(row, comments, apply);
  return box;
}

function settingsSection(a: Arc): HTMLElement {
  const s = el('section', {}, el('h2', {}, "RÉGLAGES DE L'ARC"));
  const cur: ArcSettings = a.settings;

  const arena = group('arena', 'Arène', true);
  const biome = el('select');
  for (const b of data.biomes) biome.append(el('option', { value: b.id }, b.label));
  biome.value = cur.biome ?? a.biome ?? data.battle.biome;
  arena.body.append(el('label', {}, 'Biome', biome));
  const syncArena = () => (arena.summary.textContent = data.biomes.find((b) => b.id === biome.value)?.label ?? biome.value);
  s.append(arena.node);

  // Effectifs : un groupe par camp, le total en résumé.
  const armyInputs: { team: TeamId; unit: string; input: HTMLInputElement }[] = [];
  const armySyncs: (() => void)[] = [];
  for (const team of ['gnomes', 'goblins'] as const) {
    const g = group(`army.${team}`, team === 'gnomes' ? 'Effectifs gnomes' : 'Effectifs gobelins');
    g.node.querySelector('summary')!.classList.add(team);
    const army = cur.armies?.[team] ?? data.battle.armies[team] ?? {};
    const mine: HTMLInputElement[] = [];
    for (const unitId of Object.keys(data.battle.armies[team] ?? {})) {
      const { node, input } = slider(data.units.find((u) => u.id === unitId)?.label ?? unitId, army[unitId] ?? 0, 1, 0, 60);
      armyInputs.push({ team, unit: unitId, input });
      mine.push(input);
      g.body.append(node);
    }
    armySyncs.push(() => (g.summary.textContent = `${mine.reduce((t, i) => t + Number(i.value), 0)} unités`));
    s.append(g.node);
  }

  const incidents = group('incidents', 'Incidents');
  const perMinuteField = slider('Par minute', cur.eventsPerMinute ?? data.battle.events.perMinute, 0.5, 0, 10);
  const perMinute = perMinuteField.input;
  incidents.body.append(perMinuteField.node, el('div', { class: 'muted' }, 'Poids de chaque incident (0 = jamais)'));
  const weightInputs = data.events.map((e) => {
    const { node, input } = slider(e.label, cur.eventWeights?.[e.id] ?? e.weight, 0.5, 0, 10);
    incidents.body.append(node);
    return { id: e.id, input };
  });
  const allOff = button('Tout à 0', () => {
    for (const { input } of weightInputs) {
      input.value = '0';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  const defaults = button('Valeurs par défaut', () => {
    weightInputs.forEach(({ id, input }) => {
      input.value = String(data.events.find((e) => e.id === id)?.weight ?? 0);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  allOff.classList.add('small');
  defaults.classList.add('small');
  incidents.body.append(el('div', { class: 'actions' }, allOff, defaults));
  const syncIncidents = () => {
    const active = weightInputs.filter(({ input }) => Number(input.value) > 0).length;
    incidents.summary.textContent = `${perMinute.value} / min · ${active} actifs sur ${weightInputs.length}`;
  };
  s.append(incidents.node);

  const gagGroup = group('gags', 'Gags');
  const g = data.battle.gags;
  const gags = {
    headClash: slider('Choc de têtes', cur.gagChances?.headClash ?? g.headClash.chance, 0.05, 0, 1, percent),
    victoryDance: slider('Danse de victoire', cur.gagChances?.victoryDance ?? g.victoryDance.chance, 0.01, 0, 0.5, percent),
    lostWeapon: slider('Arme perdue', cur.gagChances?.lostWeapon ?? g.lostWeapon.chance, 0.005, 0, 0.2, percent),
  };
  const gagInputs = { headClash: gags.headClash.input, victoryDance: gags.victoryDance.input, lostWeapon: gags.lostWeapon.input };
  gagGroup.body.append(gags.headClash.node, gags.victoryDance.node, gags.lostWeapon.node);
  const syncGags = () => (gagGroup.summary.textContent = Object.values(gagInputs).map((i) => percent(Number(i.value))).join(' · '));
  s.append(gagGroup.node);

  // Résumés des groupes repliés, tenus à jour pendant le réglage.
  const syncAll = () => {
    syncArena();
    armySyncs.forEach((f) => f());
    syncIncidents();
    syncGags();
  };
  syncAll();
  s.addEventListener('input', syncAll);
  s.addEventListener('change', syncAll);

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
        // Les lignes du scout dataient des anciens réglages : on les jette (sinon on figerait un combat fantôme).
        const hadScout = scoutRows.length > 0;
        worker?.terminate();
        scoutRows = [];
        picked = undefined;
        await saveArc(next, s, `Réglages enregistrés : ils s’appliquent au prochain épisode.${hadScout ? ' Relancer le scout.' : ''}`);
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
  else if (picked) s.append(el('p', { class: 'msg err' }, 'Match nul : pas de camp perdant, donc pas d’upgrade. Choisir une autre seed.'));
  return s;
}

function planForm(a: Arc, n: number, row: ScoutRow): HTMLElement {
  const box = el('div', {});
  const seed = String(row.seed);
  // Suggestion (arc.ts, commune avec la CLI) : le moins équipé du camp perdant, puis le moins de K.O. ; héros saturés exclus.
  const candidates = recipientCandidates(a, n, row.winner, row.heroKills, data);
  const recipient = el('select');
  for (const c of candidates) {
    const o = el('option', { value: c.hero }, `${heroName(c.hero)} (${c.upgrades} upgrade(s), ${c.kills} K.O.)${c.saturated ? ' — saturé' : ''}`);
    if (c.saturated) o.disabled = true;
    recipient.append(o);
  }
  recipient.value = candidates.find((c) => !c.saturated)?.hero ?? '';
  const optionsBox = el('div', {});
  let optionSelects: HTMLSelectElement[] = [];
  const syncVote = () => {
    draftVote = { recipient: recipient.value, options: optionSelects.map((s) => s.value) };
  };
  /** Menus pré-remplis avec le tirage déterministe ; 2 menus s'il ne reste que 2 upgrades libres. */
  const fillOptions = () => {
    const proposal = proposeOptions(a, n, recipient.value, seed, data);
    optionSelects = proposal.options.map((id) => {
      const sel = el('select');
      sel.replaceChildren(...proposal.free.map((e) => el('option', { value: e }, eqLabel(e))));
      sel.value = id;
      sel.onchange = () => (syncVote(), previewNext());
      return sel;
    });
    optionsBox.replaceChildren(...optionSelects.map((sel, i) => el('label', {}, `Option ${i + 1}`, sel)));
    if (proposal.options.length === 2) optionsBox.append(el('div', { class: 'muted' }, `Plus que 2 upgrades possibles pour ${heroName(recipient.value)} : vote à 2 options.`));
  };
  recipient.onchange = () => {
    fillOptions();
    syncVote();
    previewNext();
  };
  box.append(el('div', { class: 'row' }, el('strong', {}, `Seed ${seed}`), el('span', { class: row.winner }, `victoire des ${WINNER_LABEL[row.winner]} en ${row.duration.toFixed(1)} s`)));
  if (!recipient.value) {
    box.append(el('p', { class: 'msg err' }, 'Tous les héros du camp perdant sont saturés : choisir une seed où l’autre camp perd.'));
    return box;
  }
  fillOptions();
  syncVote();
  box.append(el('label', {}, "Héros qui recevra l'upgrade", recipient), optionsBox);
  const actions = el('div', { class: 'row' });
  actions.append(
    button('Aperçu', () => previewNext(0)),
    button(
      "Figer l'épisode",
      async () => {
        let next: Arc;
        try {
          // Resimulé avec les réglages enregistrés : refusé si le combat diffère de la ligne du scout.
          next = freezeEpisode(a, n, seed, { recipient: recipient.value, options: optionSelects.map((s) => s.value) }, data, row).arc;
        } catch (e) {
          return message(box, `Refusé : ${(e as Error).message}.`, false);
        }
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
      const open = arcs.filter((x) => x.status === 'open');
      if (open.length) return message(s, `Clore d'abord l'arc ouvert (${open.map((x) => x.title).join(', ')}).`, false);
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
