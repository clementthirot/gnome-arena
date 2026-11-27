// Rideau de transition vers la roulette des upgrades : il se ferme sur l'arène, puis se rouvre
// sur la carte de vote. La même composition est rejouée dans les deux scènes pour que le passage
// soit continu à l'écran.
import type Phaser from 'phaser';
import { goldFrame } from './frame';
import { manifest } from './manifest';
import { drawAccessory } from './placeholders';
import { textStyle } from './text';

const DEPTH = 9990;

export interface Curtain {
  parts: Phaser.GameObjects.GameObject[];
  /** Pans du rideau (fond + motif) qui glissent ensemble. */
  top: Phaser.GameObjects.GameObject[];
  bottom: Phaser.GameObjects.GameObject[];
  /** Titre, plaque, cadres et rouleaux qui apparaissent par fondu. */
  title: Phaser.GameObjects.GameObject[];
  reels: Phaser.GameObjects.Image[];
}

/** Un pan du rideau : fond sombre, motif PixelLab qui défile en diagonale, liseré doré. */
function panel(scene: Phaser.Scene, y: number, w: number, h: number): Phaser.GameObjects.GameObject[] {
  const menu = manifest.art.menu;
  const bg = scene.add.rectangle(0, y, w, h, 0x1c1826).setOrigin(0).setDepth(DEPTH).setStrokeStyle(8, 0xffe14a);
  if (!scene.textures.exists('ui_pattern')) return [bg.setFillStyle(0x3a1a4a)];
  const tile = scene.add.tileSprite(0, y, w, h, 'ui_pattern').setOrigin(0).setTileScale(4).setAlpha(menu.patternAlpha).setDepth(DEPTH);
  const ev = scene.time.addEvent({
    delay: 16,
    loop: true,
    callback: () => {
      if (!tile.active) return ev.remove();
      // Même défilement que l'écran de fin, calé sur l'horloge pour enchaîner sans saut entre les scènes.
      const off = (performance.now() / 1000) * menu.scroll / 4;
      tile.setTilePosition(-off, -off);
    },
  });
  const edge = scene.add.rectangle(0, y, w, h).setOrigin(0).setDepth(DEPTH).setStrokeStyle(8, 0xffe14a);
  return [bg, tile, edge];
}

/** Icônes d'accessoires disponibles pour les rouleaux. */
function reelTextures(scene: Phaser.Scene): string[] {
  return Object.entries(manifest.accessories).flatMap(([key, acc]) => {
    const shape = acc.type === 'placeholder' ? acc : acc.placeholder;
    if (!shape) return [];
    const tex = `acc_tex_${key}`;
    if (!scene.textures.exists(tex)) scene.textures.addCanvas(tex, drawAccessory(shape.kind, shape.color, shape.accent));
    return [tex];
  });
}

function build(scene: Phaser.Scene, closed: boolean): Curtain {
  const { width: w, height: h } = scene.scale;
  const top = panel(scene, closed ? 0 : -h / 2, w, h / 2);
  const bottom = panel(scene, closed ? h / 2 : h, w, h / 2);
  const title: Phaser.GameObjects.GameObject[] = [];
  const plaque = goldFrame(scene, w / 2, h / 2 - 170, 640, 250);
  if (plaque) {
    // Même cadre doré que l'écran de fin derrière le titre, couronne au sommet.
    title.push(plaque.setDepth(DEPTH + 1));
    if (scene.textures.exists('ui_crown')) title.push(scene.add.image(w / 2, h / 2 - 170 - 125 + 6, 'ui_crown').setOrigin(0.5, 1).setScale(2.25).setDepth(DEPTH + 1));
  }
  title.push(scene.add.text(w / 2, h / 2 - 170, 'ROULETTE\nDES UPGRADES', textStyle(64, '#ffe14a', { align: 'center' })).setOrigin(0.5).setDepth(DEPTH + 2));
  // Cadres dorés des rouleaux, comme la machine à sous du verdict.
  for (const k of [-1, 0, 1]) {
    const f = goldFrame(scene, w / 2 + k * 220, h / 2 + 90, 190, 190);
    if (f) title.push(f.setDepth(DEPTH + 1));
  }
  title.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(closed ? 1 : 0));
  const textures = reelTextures(scene);
  const reels = [-1, 0, 1].map((k) =>
    scene.add
      .image(w / 2 + k * 220, h / 2 + 90, textures[(k + 1) % Math.max(1, textures.length)])
      .setScale(12)
      .setDepth(DEPTH + 2)
      .setAlpha(closed ? 1 : 0),
  );
  // Les rouleaux défilent tant que le rideau est là.
  let i = 0;
  scene.time.addEvent({
    delay: 70,
    loop: true,
    callback: () => {
      if (!textures.length) return;
      i++;
      reels.forEach((r, k) => r.active && r.setTexture(textures[(i + k * 2) % textures.length]));
    },
  });
  return { parts: [...top, ...bottom, ...title, ...reels], top, bottom, title, reels };
}

/** Ferme le rideau (fin du combat), puis appelle done. */
export function closeCurtain(scene: Phaser.Scene, durationMs: number, done: () => void): void {
  const { height: h } = scene.scale;
  const c = build(scene, false);
  scene.tweens.add({ targets: c.top, y: 0, duration: durationMs, ease: 'Bounce.easeOut' });
  scene.tweens.add({ targets: c.bottom, y: h / 2, duration: durationMs, ease: 'Bounce.easeOut' });
  scene.tweens.add({ targets: [...c.title, ...c.reels], alpha: 1, delay: durationMs * 0.6, duration: 200 });
  scene.time.delayedCall(durationMs + 450, done);
}

/** Rouvre le rideau sur l'écran de vote. */
export function openCurtain(scene: Phaser.Scene, delayMs: number, durationMs: number): void {
  const { height: h } = scene.scale;
  const c = build(scene, true);
  scene.tweens.add({ targets: [...c.title, ...c.reels], alpha: 0, delay: delayMs, duration: 180 });
  scene.tweens.add({ targets: c.top, y: -h / 2, delay: delayMs + 120, duration: durationMs, ease: 'Quad.easeIn' });
  scene.tweens.add({ targets: c.bottom, y: h, delay: delayMs + 120, duration: durationMs, ease: 'Quad.easeIn', onComplete: () => c.parts.forEach((p) => p.destroy()) });
}
