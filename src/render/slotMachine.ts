// Machine à sous : un rouleau qui fait défiler des icônes d'accessoires, ralentit et s'arrête
// sur une option imposée. Le résultat ne doit rien au hasard : il sort du vote (ou de la carte),
// et le défilement lui-même est réglé d'avance (même seed = même vidéo).
// Partagée par la révélation d'ouverture (reveal.ts) et la carte de vote de fin (ResultScene).
import type Phaser from 'phaser';
import { sound } from './audio';
import { FRAME_INSET, goldFrame } from './frame';
import { manifest } from './manifest';
import { drawAccessory } from './placeholders';

/** Texture d'un accessoire du manifeste : l'image si elle a chargé, sinon son dessin de secours. */
export function accessoryTexture(scene: Phaser.Scene, visual: string): string | undefined {
  const entry = manifest.accessories[visual];
  if (!entry) return undefined;
  if (entry.type === 'image' && scene.textures.exists(`acc_img_${visual}`)) return `acc_img_${visual}`;
  const shape = entry.type === 'placeholder' ? entry : entry.placeholder;
  if (!shape) return undefined;
  const key = `acc_tex_${visual}`;
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, drawAccessory(shape.kind, shape.color, shape.accent));
  return key;
}

/** Toutes les icônes d'accessoires du manifeste, dans l'ordre du fichier (pour faire défiler un rouleau). */
export function accessoryReel(scene: Phaser.Scene): string[] {
  return Object.keys(manifest.accessories).flatMap((k) => accessoryTexture(scene, k) ?? []);
}

/** Met une icône à la taille voulue (px écran), quelle que soit la résolution de sa texture. */
export function fitIcon(img: Phaser.GameObjects.Image, size: number): void {
  const frame = img.frame;
  img.setScale(size / Math.max(frame.width, frame.height, 1));
}

export interface ReelOptions {
  x: number;
  y: number;
  /** Côté de la fenêtre du rouleau (px écran). */
  size: number;
  depth: number;
  /** Icônes qui défilent, dans l'ordre. */
  pool: string[];
  /** Icône finale, imposée. */
  target: string;
  /** Départ du défilement, après l'apparition (ms). */
  delay?: number;
  /** Nombre d'icônes qui défilent avant l'arrêt. */
  spins?: number;
  /** Durée du premier pas (ms) et allongement à chaque pas (ms) : le rouleau ralentit. */
  firstStep?: number;
  stepGrowth?: number;
  /** Décalage du défilement dans pool (deux rouleaux côte à côte ne montrent pas la même icône). */
  offset?: number;
  /** Tic à chaque icône et « ding » à l'arrêt. */
  sound?: boolean;
  onStop?: () => void;
}

/** Durée totale du défilement (ms), du premier pas à l'arrêt. */
export function reelDuration(spins: number, firstStep = 45, stepGrowth = 11): number {
  let total = 0;
  for (let n = 0; n < spins; n++) total += firstStep + n * stepGrowth;
  return total;
}

export interface Reel {
  container: Phaser.GameObjects.Container;
  icon: Phaser.GameObjects.Image;
  /** Instant de l'arrêt, en ms depuis l'appel. */
  stopsAt: number;
}

/** Rouleau dans son cadre (placeholder dessiné, ou image `staging.reveal.slot.frame` du manifeste). */
export function spinReel(scene: Phaser.Scene, o: ReelOptions): Reel {
  const cfg = manifest.staging.reveal.slot;
  const { size } = o;
  const spins = o.spins ?? 14;
  const first = o.firstStep ?? 45;
  const growth = o.stepGrowth ?? 11;
  const delay = o.delay ?? 0;
  const container = scene.add.container(o.x, o.y).setDepth(o.depth);
  // Le cadre doré commun des écrans de fin, de côté size.
  const frame = goldFrame(scene, 0, 0, size, size);
  // L'icône tient dans le fond sombre du cadre, sans toucher le liseré.
  const iconSize = frame ? size - 2 * FRAME_INSET.x - 4 : size * 0.72;
  if (frame) {
    container.add(frame);
  } else {
    const pad = Math.round(size * 0.12);
    const g = scene.add.graphics();
    g.fillStyle(0x000000, 1).fillRect(-size / 2 - pad - 6, -size / 2 - pad - 6, size + 2 * pad + 12, size + 2 * pad + 12);
    g.fillStyle(hex(cfg.frame), 1).fillRect(-size / 2 - pad, -size / 2 - pad, size + 2 * pad, size + 2 * pad);
    g.fillStyle(0x000000, 1).fillRect(-size / 2 - 6, -size / 2 - 6, size + 12, size + 12);
    g.fillStyle(hex(cfg.window), 1).fillRect(-size / 2, -size / 2, size, size);
    // Reflet : bande claire en haut de la fenêtre.
    g.fillStyle(0xffffff, 0.08).fillRect(-size / 2, -size / 2, size, size * 0.18);
    container.add(g);
    // Ampoules aux quatre coins du cadre : elles clignotent à l'arrêt.
    const lights = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => scene.add.rectangle((sx * (size + pad)) / 2, (sy * (size + pad)) / 2, pad * 0.6, pad * 0.6, hex(cfg.light)).setStrokeStyle(3, 0x000000)));
    container.add(lights);
    container.setData('lights', lights);
  }
  const pool = o.pool.length ? o.pool : [o.target];
  const offset = o.offset ?? 0;
  const icon = scene.add.image(0, 0, pool[offset % pool.length]);
  fitIcon(icon, iconSize);
  container.add(icon);

  // Défilement réglé sur l'horloge de la scène (et non une icône par image) : même rythme
  // et même instant d'arrêt quelle que soit la cadence d'affichage.
  const starts: number[] = [];
  let total = 0;
  for (let n = 0; n < spins; n++) {
    starts.push(total);
    total += first + n * growth;
  }
  const show = (n: number) => {
    // L'icône suivante descend dans la fenêtre : impression de défilement sans masque.
    let k = (offset + n + 1) % pool.length;
    // La dernière icône avant l'arrêt n'est jamais la cible (l'arrêt doit se voir).
    if (n === spins - 1 && pool[k] === o.target && pool.length > 1) k = (k + 1) % pool.length;
    const ms = first + n * growth;
    icon.setTexture(pool[k]);
    fitIcon(icon, iconSize);
    icon.setY(-size * 0.28).setAlpha(0.55);
    scene.tweens.add({ targets: icon, y: 0, alpha: 1, duration: Math.max(20, ms * 0.8) });
    if (o.sound !== false) sound.play('tick');
  };
  // Temps écoulé compté avec le même delta que les minuteries de la scène (time.now peut s'en écarter
  // quand l'affichage rame) : l'arrêt programmé tombe toujours après la dernière icône.
  let elapsed = 0;
  let shown = -1;
  // Une fois l'arrêt joué, plus aucun pas de défilement ne doit changer l'icône (les deux horloges peuvent diverger).
  let stopped = false;
  const roll = (_time?: number, delta = 0) => {
    if (stopped || !icon.active) return;
    elapsed += delta;
    let n = shown;
    while (n + 1 < spins && starts[n + 1] <= elapsed) n++;
    if (n !== shown) show((shown = n));
  };
  const off = () => scene.events.off('update', roll);
  scene.events.once('shutdown', off);
  scene.time.delayedCall(delay, () => {
    roll();
    scene.events.on('update', roll);
  });
  scene.time.delayedCall(delay + total, () => {
    stopped = true;
    off();
    if (!icon.active) return;
    scene.tweens.killTweensOf(icon);
    icon.setTexture(o.target).setY(0).setAlpha(1);
    fitIcon(icon, iconSize);
    const s = icon.scale;
    scene.tweens.add({ targets: icon, scale: { from: s * 1.35, to: s }, duration: 220, ease: 'Back.easeOut' });
    const lights = container.getData('lights') as Phaser.GameObjects.Rectangle[] | undefined;
    if (lights) scene.tweens.add({ targets: lights, alpha: { from: 1, to: 0.2 }, duration: 90, yoyo: true, repeat: 4 });
    if (o.sound !== false) sound.play('ding');
    o.onStop?.();
  });
  return { container, icon, stopsAt: delay + total };
}

function hex(color: string): number {
  return Number.parseInt(color.replace('#', ''), 16);
}

/** Cadeau dessiné (rouge, ruban doré) quand art.menu.gift manque : 16 × 16, couvercle sur les 5 premières lignes. */
function drawGift(): HTMLCanvasElement {
  const rows = [
    '....yy..yy......',
    '.....yyyy.......',
    'oooooooyyooooooo',
    'orrrrrryyrrrrrro',
    'orrrrrryyrrrrrro',
    'oooooooyyooooooo',
    '.orrrrryyrrrrro.',
    '.orrrrryyrrrrro.',
    '.oyyyyyyyyyyyyo.',
    '.orrrrryyrrrrro.',
    '.orrrrryyrrrrro.',
    '.orrrrryyrrrrro.',
    '.orrrrryyrrrrro.',
    '.orrrrryyrrrrro.',
    '.oooooooooooooo.',
    '................',
  ];
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  const pal: Record<string, string> = { o: '#1a0e14', r: '#d83b3b', y: '#ffd23a' };
  rows.forEach((row, y) => [...row].forEach((ch, x) => pal[ch] && ((ctx.fillStyle = pal[ch]), ctx.fillRect(x, y, 1, 1))));
  return canvas;
}

/** Texture du cadeau : l'image du thème si elle a chargé, sinon le cadeau dessiné. */
export function giftTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists('ui_gift')) return 'ui_gift';
  if (!scene.textures.exists('ui_gift_drawn')) scene.textures.addCanvas('ui_gift_drawn', drawGift());
  return 'ui_gift_drawn';
}

/**
 * Cadeau qui s'ouvre sur une option imposée : il tremble, le couvercle saute, l'icône sort de la boîte.
 * Même contrat que spinReel (rien au hasard, instant d'arrêt connu d'avance).
 */
export function openGift(scene: Phaser.Scene, o: ReelOptions): Reel {
  const { size } = o;
  const delay = o.delay ?? 0;
  const container = scene.add.container(o.x, o.y).setDepth(o.depth);
  const key = giftTexture(scene);
  const src = scene.textures.get(key).getSourceImage() as HTMLImageElement;
  const w = src.width || 16;
  const h = src.height || 16;
  const scale = size / Math.max(w, h);
  // Le couvercle : le tiers du haut de l'image ; la boîte : le reste (deux copies rognées de la même image).
  const lidH = Math.round(h * 0.34);
  const body = scene.add.image(0, 0, key).setScale(scale).setCrop(0, lidH, w, h - lidH);
  const lid = scene.add.image(0, 0, key).setScale(scale).setCrop(0, 0, w, lidH);
  const icon = scene.add.image(0, size * 0.1, o.target).setAlpha(0);
  fitIcon(icon, size * 0.72);
  const iconScale = icon.scale;
  icon.setScale(iconScale * 0.3);
  container.add([icon, body, lid]);
  // Secousses de plus en plus fortes (anticipation), puis ouverture.
  const shakeMs = 520 + (o.spins ?? 0) * 25;
  scene.time.delayedCall(delay, () => {
    if (o.sound !== false) sound.play('tick');
    scene.tweens.add({ targets: container, angle: { from: -6, to: 6 }, duration: 70, yoyo: true, repeat: Math.max(1, Math.floor(shakeMs / 140) - 1), ease: 'Sine.easeInOut', onComplete: () => container.setAngle(0) });
  });
  const stopsAt = delay + shakeMs;
  scene.time.delayedCall(stopsAt, () => {
    if (!icon.active) return;
    scene.tweens.add({ targets: lid, y: -size * 0.9, angle: -35, alpha: 0, duration: 380, ease: 'Cubic.easeOut' });
    // L'icône jaillit de la boîte puis se pose au-dessus.
    icon.setAlpha(1);
    container.bringToTop(icon);
    scene.tweens.add({ targets: icon, y: -size * 0.5, scale: iconScale, duration: 320, ease: 'Back.easeOut' });
    if (o.sound !== false) sound.play('ding');
    o.onStop?.();
  });
  return { container, icon, stopsAt };
}

/** Dévoilement d'une option selon le style du thème : rouleau de machine à sous ou cadeau qui s'ouvre. */
export function revealOption(scene: Phaser.Scene, o: ReelOptions): Reel {
  return manifest.staging.reveal.style === 'gifts' ? openGift(scene, o) : spinReel(scene, o);
}
