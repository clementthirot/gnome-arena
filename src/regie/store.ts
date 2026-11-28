// Où vivent les arcs.
//   Serveur de dev (npm run dev) : le relais de vite.config.ts lit et écrit les fichiers de src/data/arcs.
//   Version en ligne (GitHub Pages, build statique) : pas de relais. Les arcs du dépôt sont embarqués au
//   build et chaque modification faite dans la régie est gardée dans ce navigateur (localStorage),
//   par-dessus la version du dépôt. Export / import JSON pour la ramener dans le dépôt.

type RawArc = { id: string; revision?: string } & Record<string, unknown>;

const KEY = 'gnome-arena.arcs';

// Vite remplace l'appel par les fichiers du dossier ; hors Vite (scripts tsx), aucun arc embarqué.
let bundled: Record<string, RawArc> = {};
try {
  bundled = import.meta.glob<RawArc>('../data/arcs/*.json', { eager: true, import: 'default' });
} catch {
  bundled = {};
}

/** Arcs modifiés sur cet appareil (version en ligne), par identifiant. */
export function localArcs(): Record<string, RawArc> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocal(arcs: Record<string, RawArc>): void {
  localStorage.setItem(KEY, JSON.stringify(arcs));
}

/** Enregistre un arc (déjà validé) sur cet appareil. */
export function saveLocalArc(arc: RawArc): void {
  writeLocal({ ...localArcs(), [arc.id]: arc });
}

/** Oublie les modifications de cet appareil : retour aux arcs du dépôt. */
export function resetLocalArcs(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // stockage indisponible : rien à oublier
  }
}

/** Arcs du dépôt, remplacés par leur version modifiée sur cet appareil quand elle existe. */
export function offlineArcs(): RawArc[] {
  const byId = new Map<string, RawArc>();
  for (const a of Object.values(bundled)) byId.set(a.id, structuredClone(a));
  for (const a of Object.values(localArcs())) byId.set(a.id, a);
  return [...byId.values()];
}

/** Arcs servis par le relais du serveur de dev ; null sans relais (version en ligne). */
export async function relayArcs(): Promise<RawArc[] | null> {
  try {
    const res = await fetch('./__regie/arcs');
    // GitHub Pages répond par une page 404 en HTML : pas de relais.
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return null;
    return (await res.json()) as RawArc[];
  } catch {
    return null;
  }
}

/** Un arc pour l'arène : relais, sinon version de cet appareil, sinon celle du dépôt. */
export async function findArc(id: string): Promise<RawArc | undefined> {
  const list = (await relayArcs()) ?? offlineArcs();
  return list.find((a) => a.id === id);
}
