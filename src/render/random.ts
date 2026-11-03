// Hasard du rendu, tiré de la seed : même seed = même vidéo, débris et gags visuels compris.
// Le flux est réamorcé à chaque tick de simulation, avant le traitement de ses événements :
// ce qui découle d'un événement ne dépend donc pas du nombre d'images affichées entre deux ticks.
let base = 1;
let state = 1;

export function seedRender(seed: number): void {
  base = seed >>> 0 || 1;
  state = base;
}

/** Réamorce le flux pour le tick donné. */
export function seedTick(tick: number): void {
  state = (Math.imul(base ^ (tick * 0x9e3779b1), 0x85ebca6b) ^ 0x5bd1e995) >>> 0;
}

/** Flottant dans [0, 1). Remplace Math.random dans tout le rendu. */
export function rand(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
