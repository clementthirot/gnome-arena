// Rideau de transition. Il se ferme sur l'arène pour annoncer le MVP, puis se rouvre sur l'écran de fin
// (même composition rejouée dans les deux scènes, pour un passage continu à l'écran). En toute fin, un rideau
// sans titre se ferme sur la carte de vote et se rouvre sur la première image : la vidéo boucle.
import type Phaser from 'phaser';
import { goldFrame } from './frame';
import { manifest } from './manifest';
import { drawAccessory } from './placeholders';
import { fitIcon, giftTexture } from './slotMachine';
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

export interface CurtainOptions {
  /** Titre sur la plaque ; null = rideau nu (boucle de fin). Par défaut staging.reveal.curtainTitle. */
  title?: string | null;
  /** Trois rouleaux (ou cadeaux) sous le titre. */
  icons?: boolean;
}

function build(scene: Phaser.Scene, closed: boolean, opts: CurtainOptions = {}): Curtain {
  const text = opts.title === undefined ? manifest.staging.reveal.curtainTitle : opts.title;
  const { width: w, height: h } = scene.scale;
  const top = panel(scene, closed ? 0 : -h / 2, w, h / 2);
  const bottom = panel(scene, closed ? h / 2 : h, w, h / 2);
  const title: Phaser.GameObjects.GameObject[] = [];
  const plaqueY = opts.icons ? h / 2 - 170 : h / 2;
  const plaque = text === null ? undefined : goldFrame(scene, w / 2, plaqueY, 640, 250);
  if (plaque) {
    // Même cadre doré que l'écran de fin derrière le titre, couronne au sommet.
    title.push(plaque.setDepth(DEPTH + 1));
    if (scene.textures.exists('ui_crown')) title.push(scene.add.image(w / 2, plaqueY - 125 + 6, 'ui_crown').setOrigin(0.5, 1).setScale(2.25).setDepth(DEPTH + 1));
  }
  if (text !== null) {
    const t = scene.add.text(w / 2, plaqueY, text, textStyle(64, '#ffe14a', { align: 'center', lineSpacing: 12 })).setOrigin(0.5).setDepth(DEPTH + 2);
    // Le titre tient dans la plaque, bords compris.
    if (t.width > 540) t.setScale(540 / t.width);
    title.push(t);
  }
  // Cadres dorés des rouleaux, comme la machine à sous du verdict.
  for (const k of opts.icons ? [-1, 0, 1] : []) {
    const f = goldFrame(scene, w / 2 + k * 220, h / 2 + 90, 190, 190);
    if (f) title.push(f.setDepth(DEPTH + 1));
  }
  title.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(closed ? 1 : 0));
  // Thème « cadeaux » : trois paquets qui gigotent au lieu des rouleaux qui défilent.
  const gifts = manifest.staging.reveal.style === 'gifts';
  const textures = gifts ? [] : reelTextures(scene);
  const reels = (opts.icons ? [-1, 0, 1] : []).map((k) => {
    const img = scene.add
      .image(w / 2 + k * 220, h / 2 + 90, gifts ? giftTexture(scene) : textures[(k + 1) % Math.max(1, textures.length)])
      .setDepth(DEPTH + 2)
      .setAlpha(closed ? 1 : 0);
    if (!gifts) return img.setScale(12);
    fitIcon(img, 150);
    scene.tweens.add({ targets: img, angle: { from: -5, to: 5 }, duration: 160, yoyo: true, repeat: -1, delay: (k + 1) * 90 });
    return img;
  });
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
export function closeCurtain(scene: Phaser.Scene, durationMs: number, done: (curtain: Curtain) => void, opts?: CurtainOptions, holdMs = 450): void {
  const { height: h } = scene.scale;
  const c = build(scene, false, opts);
  scene.tweens.add({ targets: c.top, y: 0, duration: durationMs, ease: 'Bounce.easeOut' });
  scene.tweens.add({ targets: c.bottom, y: h / 2, duration: durationMs, ease: 'Bounce.easeOut' });
  scene.tweens.add({ targets: [...c.title, ...c.reels], alpha: 1, delay: durationMs * 0.6, duration: 200 });
  scene.time.delayedCall(durationMs + holdMs, () => done(c));
}

/** Rouvre le rideau (sur l'écran de fin, ou sur la première image pour boucler). */
export function openCurtain(scene: Phaser.Scene, delayMs: number, durationMs: number, opts?: CurtainOptions): void {
  const { height: h } = scene.scale;
  const c = build(scene, true, opts);
  scene.tweens.add({ targets: [...c.title, ...c.reels], alpha: 0, delay: delayMs, duration: 180 });
  scene.tweens.add({ targets: c.top, y: -h / 2, delay: delayMs + 120, duration: durationMs, ease: 'Quad.easeIn' });
  scene.tweens.add({ targets: c.bottom, y: h, delay: delayMs + 120, duration: durationMs, ease: 'Quad.easeIn', onComplete: () => c.parts.forEach((p) => p.destroy()) });
}
