// Thèmes visuels : mêmes règles, autres assets. Un thème (src/render/themes/<id>.json) ne contient
// que ce qui change par rapport au manifeste de base (assets.manifest.json) : il s'y superpose
// clé par clé. On le choisit dans l'URL, ?theme=noel ; sans paramètre, le thème de base.
//
//   name      nom affiché (titre de l'onglet)
//   teams     nom et couleurs des deux camps à l'écran (les identifiants gnomes / goblins ne changent pas)
//   manifest  morceaux du manifeste à remplacer : objets fusionnés, tableaux et valeurs remplacés,
//             null pour retirer une entrée de base (retour au placeholder ou au repli dessiné)

export interface TeamLook {
  label?: string;
  /** Couleur des textes du camp. */
  main?: string;
  /** Couleur des barres et jauges du camp. */
  bar?: string;
}

export interface ThemeFile {
  name?: string;
  teams?: Partial<Record<'gnomes' | 'goblins', TeamLook>>;
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

/** Superpose over à base : objets fusionnés récursivement, le reste remplacé, null retire la clé. */
export function overlay<T>(base: T, over: unknown): T {
  if (!isObject(base) || !isObject(over)) return (over === undefined ? base : over) as T;
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k === '$comment') continue;
    if (v === null) delete out[k];
    else out[k] = overlay(out[k], v);
  }
  return out as T;
}
