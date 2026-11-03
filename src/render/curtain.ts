// Rideau de transition vers la roulette des upgrades : il se ferme sur l'arène, puis se rouvre
// sur la carte de vote. La même composition est rejouée dans les deux scènes pour que le passage
// soit continu à l'écran.
import type Phaser from 'phaser';
import { manifest } from './manifest';
import { drawAccessory } from './placeholders';
import { textStyle } from './text';

const DEPTH = 9990;

export interface Curtain {
  parts: Phaser.GameObjects.GameObject[];
  top: Phaser.GameObjects.Rectangle;
  bottom: Phaser.GameObjects.Rectangle;
  title: Phaser.GameObjects.Text;
  reels: Phaser.GameObjects.Image[];
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
  const top = scene.add.rectangle(0, closed ? 0 : -h / 2, w, h / 2, 0x3a1a4a).setOrigin(0).setDepth(DEPTH).setStrokeStyle(8, 0xffe14a);
  const bottom = scene.add.rectangle(0, closed ? h / 2 : h, w, h / 2, 0x3a1a4a).setOrigin(0).setDepth(DEPTH).setStrokeStyle(8, 0xffe14a);
  const title = scene.add.text(w / 2, h / 2 - 170, 'ROULETTE\nDES UPGRADES', textStyle(64, '#ffe14a', { align: 'center' })).setOrigin(0.5).setDepth(DEPTH + 1).setAlpha(closed ? 1 : 0);
  const textures = reelTextures(scene);
  const reels = [-1, 0, 1].map((k) =>
    scene.add
      .image(w / 2 + k * 220, h / 2 + 90, textures[(k + 1) % Math.max(1, textures.length)])
      .setScale(12)
      .setDepth(DEPTH + 1)
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
  return { parts: [top, bottom, title, ...reels], top, bottom, title, reels };
}

/** Ferme le rideau (fin du combat), puis appelle done. */
export function closeCurtain(scene: Phaser.Scene, durationMs: number, done: () => void): void {
  const { height: h } = scene.scale;
  const c = build(scene, false);
  scene.tweens.add({ targets: c.top, y: 0, duration: durationMs, ease: 'Bounce.easeOut' });
  scene.tweens.add({ targets: c.bottom, y: h / 2, duration: durationMs, ease: 'Bounce.easeOut' });
  scene.tweens.add({ targets: [c.title, ...c.reels], alpha: 1, delay: durationMs * 0.6, duration: 200 });
  scene.time.delayedCall(durationMs + 450, done);
}

/** Rouvre le rideau sur l'écran de vote. */
export function openCurtain(scene: Phaser.Scene, delayMs: number, durationMs: number): void {
  const { height: h } = scene.scale;
  const c = build(scene, true);
  scene.tweens.add({ targets: [c.title, ...c.reels], alpha: 0, delay: delayMs, duration: 180 });
  scene.tweens.add({ targets: c.top, y: -h / 2, delay: delayMs + 120, duration: durationMs, ease: 'Quad.easeIn' });
  scene.tweens.add({ targets: c.bottom, y: h, delay: delayMs + 120, duration: durationMs, ease: 'Quad.easeIn', onComplete: () => c.parts.forEach((p) => p.destroy()) });
}
