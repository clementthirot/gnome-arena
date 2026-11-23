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

/** Tirage pur (sans état) dans [0, 1) pour une clé entière et un sel : même entrée, même sortie. */
export function randAt(key: number, salt = 0): number {
  let t = (Math.imul(base ^ Math.imul(key | 0, 0x9e3779b1), 0x85ebca6b) ^ Math.imul(salt | 0, 0xc2b2ae35)) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x7feb352d);
  t = Math.imul(t ^ (t >>> 15), 0x846ca68b);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/** Petit générateur local, amorcé par un tirage : pour un effet joué plus tard (fin d'interpolation, tween) sans toucher au flux du tick. */
export function streamFrom(seed: number): () => number {
  let s = Math.floor(seed * 4294967296) >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Flux à part pour le pur décor dessiné à chaque image (traînée d'un météore) : il ne perturbe pas
 * le flux des ticks. Réamorcé à chaque tick lui aussi.
 */
let noiseState = 1;
export function seedNoise(tick: number): void {
  noiseState = (Math.imul(base ^ (tick * 0x27d4eb2f), 0x165667b1) ^ 0x3c6ef372) >>> 0;
}
export function noise(): number {
  noiseState = (noiseState + 0x6d2b79f5) >>> 0;
  let t = noiseState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
