// Thèmes visuels : mêmes règles, autres assets. Un thème (src/render/themes/<id>.json) ne contient
// que ce qui change par rapport au manifeste de base (assets.manifest.json) : il s'y superpose
// clé par clé. On le choisit dans l'URL, ?theme=noel ; sans paramètre, le thème de base.
//
//   name      nom affiché (titre de l'onglet)
//   teams     nom et couleurs des deux camps à l'écran (les identifiants gnomes / goblins ne changent pas)
//   manifest  morceaux du manifeste à remplacer : objets fusionnés, tableaux et valeurs remplacés,
//             null pour retirer une entrée de base (retour au placeholder ou au repli dessiné)
//   heroes    roster du pack quand aucun arc n'est ouvert (?theme=noel&seed=3) ; un arc garde le sien
//   biome     biome par défaut sans arc (décor seulement si ses règles physiques sont neutres)
//   upgrades  pool d'upgrades votables proposé par la régie pour un nouvel arc de ce thème
//   labels    noms affichés à l'écran (upgrades, unités, incidents) : du texte seulement, les règles ne changent pas

export interface TeamLook {
  label?: string;
  /** Couleur des textes du camp. */
  main?: string;
  /** Couleur des barres et jauges du camp. */
  bar?: string;
}

export interface ThemeLabels {
  /** Upgrades : nom long (cartes de vote) et nom court (lancement « LASER ! »). */
  equipment?: Record<string, { label?: string; short?: string }>;
  units?: Record<string, string>;
  /** Incidents d'arène (annonce à l'écran). */
  events?: Record<string, string>;
}

export interface ThemeFile {
  name?: string;
  teams?: Partial<Record<'gnomes' | 'goblins', TeamLook>>;
  heroes?: string[];
  /** Biome par défaut sans arc (?theme=noel&seed=3) ; un arc garde le sien. */
  biome?: string;
  upgrades?: string[];
  labels?: ThemeLabels;
  manifest?: Record<string, unknown>;
}

// Vite remplace l'appel par les fichiers du dossier ; hors Vite (scripts tsx), aucun thème.
let files: Record<string, ThemeFile> = {};
try {
  files = import.meta.glob<ThemeFile>('./themes/*.json', { eager: true, import: 'default' });
} catch {
  files = {};
}

export const THEMES: Record<string, ThemeFile> = Object.fromEntries(Object.entries(files).map(([path, file]) => [path.replace(/^.*\/(.+)\.json$/, '$1'), file]));

function requested(): string | undefined {
  if (typeof location === 'undefined') return undefined;
  return new URLSearchParams(location.search).get('theme') ?? undefined;
}

const asked = requested();
if (asked && !THEMES[asked]) console.warn(`Thème « ${asked} » introuvable (src/render/themes/${asked}.json) : thème de base. Thèmes : ${Object.keys(THEMES).join(', ') || 'aucun'}`);

/** Identifiant du thème actif, undefined pour le thème de base. */
export const themeId: string | undefined = asked && THEMES[asked] ? asked : undefined;
export const theme: ThemeFile = themeId ? THEMES[themeId] : {};

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Superpose over à base : objets fusionnés récursivement, le reste remplacé, null retire la clé.
 * Exception : `animations` est remplacé en bloc, car ses numéros d'image ne valent que pour la sheet qui les accompagne
 * (une animation du manifeste de base qui survivrait viserait des images absentes de la sheet du thème).
 */
export function overlay<T>(base: T, over: unknown): T {
  if (!isObject(base) || !isObject(over)) return (over === undefined ? base : over) as T;
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k === '$comment') continue;
    if (v === null) delete out[k];
    else out[k] = k === 'animations' ? v : overlay(out[k], v);
  }
  return out as T;
}

interface Labelled {
  equipment: { id: string; label: string; short: string }[];
  units: { id: string; label: string }[];
  events: { id: string; label: string }[];
}

/**
 * Noms du thème appliqués aux données (copie modifiée sur place) : seulement les textes affichés,
 * jamais une règle ; une simulation donne donc le même combat avec ou sans thème.
 */
export function applyThemeLabels<T extends Labelled>(data: T, file: ThemeFile = theme): T {
  const l = file.labels;
  if (!l) return data;
  for (const e of data.equipment) Object.assign(e, l.equipment?.[e.id] ?? {});
  for (const u of data.units) if (l.units?.[u.id]) u.label = l.units[u.id];
  for (const ev of data.events) if (l.events?.[ev.id]) ev.label = l.events[ev.id];
  return data;
}
