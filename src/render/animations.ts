// Briques d'animation réutilisables. Le manifeste attribue une brique à chaque moment
// (attaque, tir, blessure, mort, impact, panique) ; n'importe quelle clé visuelle peut les combiner.
import Phaser from 'phaser';
import type { Bricks as BrickSet } from './manifest';
import { FONT } from './text';

/** Ce qu'une brique a le droit de manipuler : des décalages visuels, jamais la position simulée. */
export interface UnitView {
  sprite: Phaser.GameObjects.Sprite;
  bricks: BrickSet;
  baseScale: number;
  offX: number;
  offY: number;
  squash: number;
  facing: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
  size: number;
}

export interface BrickContext {
  scene: Phaser.Scene;
  particles: Particle[];
  /** Échelle monde -> écran. */
  scale: number;
}

function burst(ctx: BrickContext, x: number, y: number, count: number, colors: number[], speed: number, life = 0.45) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.4 + Math.random() * 0.6);
    ctx.particles.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - speed * 0.3,
      life,
      maxLife: life,
      color: colors[i % colors.length],
      size: Math.random() < 0.3 ? 2 : 1,
    });
  }
}

export const Bricks = {
  /** Fente vers la cible. */
  attack(ctx: BrickContext, view: UnitView, dirX: number, dirY: number) {
    if (view.bricks.attack !== 'lunge') return;
    ctx.scene.tweens.add({ targets: view, offX: dirX * 3, offY: dirY * 3, duration: 70, yoyo: true, ease: 'Quad.easeOut' });
  },

  /** Léger recul au tir. */
  shoot(ctx: BrickContext, view: UnitView, dirX: number, dirY: number) {
    if (view.bricks.shoot !== 'recoil') return;
    ctx.scene.tweens.add({ targets: view, offX: -dirX * 1.5, offY: -dirY * 1.5, duration: 60, yoyo: true });
  },

  /** Flash blanc et écrasement. */
  hurt(ctx: BrickContext, view: UnitView, x: number, y: number, heavy: boolean) {
    if (view.bricks.hurt !== 'flash') return;
    view.sprite.setTintFill(0xffffff);
    ctx.scene.time.delayedCall(heavy ? 110 : 70, () => view.sprite.active && view.sprite.clearTint());
    view.squash = heavy ? 0.65 : 0.82;
    ctx.scene.tweens.add({ targets: view, squash: 1, duration: 180, ease: 'Back.easeOut' });
    burst(ctx, x, y, heavy ? 6 : 3, [0xffffff, 0xffe08a], heavy ? 50 : 30, 0.25);
  },

  /** Chute au combat : le corps bascule et reste au sol. */
  death(ctx: BrickContext, view: UnitView, x: number, y: number, isHero: boolean) {
    const s = view.sprite;
    s.clearTint();
    burst(ctx, x, y, isHero ? 18 : 8, [0xc8a46c, 0xe0c590, 0x8a7050], isHero ? 60 : 40, 0.6);
    if (view.bricks.death === 'stay') {
      // La sheet a sa propre animation de chute : on se contente de griser le corps.
      ctx.scene.time.delayedCall(400, () => s.active && s.setTint(0x9a9088));
      ctx.scene.tweens.add({ targets: s, alpha: 0.7, delay: 400, duration: 300 });
      return;
    }
    if (view.bricks.death === 'fade') {
      ctx.scene.tweens.add({ targets: s, alpha: 0, duration: 600 });
      return;
    }
    ctx.scene.tweens.add({
      targets: s,
      angle: 90 * (view.facing >= 0 ? -1 : 1),
      alpha: 0.55,
      duration: 260,
      ease: 'Quad.easeIn',
      onComplete: () => s.setTint(0x7a7068),
    });
    view.offY = -4;
    ctx.scene.tweens.add({ targets: view, offY: 0, duration: 260, ease: 'Bounce.easeOut' });
  },

  /** Explosion d'impact (charge) : onde, débris et secousse. */
  impact(ctx: BrickContext, view: UnitView, x: number, y: number) {
    if (view.bricks.impact !== 'explode') return;
    burst(ctx, x, y, 16, [0xfff2b0, 0xffb347, 0xc8a46c], 80, 0.5);
    const ring = ctx.scene.add.circle(x * ctx.scale, y * ctx.scale, 6 * ctx.scale, 0xffffff, 0).setStrokeStyle(ctx.scale, 0xfff2b0);
    ring.setDepth(9000);
    ctx.scene.tweens.add({ targets: ring, scale: 2.4, alpha: 0, duration: 260, onComplete: () => ring.destroy() });
    ctx.scene.cameras.main.shake(110, 0.004);
  },

  /** Point d'exclamation au-dessus de la tête (panique) : lisible sans la couleur. */
  panic(ctx: BrickContext, view: UnitView) {
    if (view.bricks.panic !== 'exclaim') return;
    const s = view.sprite;
    const t = ctx.scene.add
      .text(s.x, s.y - s.displayHeight * 0.7, '!', { fontFamily: FONT, fontSize: '28px', color: '#ffffff', stroke: '#000000', strokeThickness: 6 })
      .setOrigin(0.5, 1)
      .setDepth(9500);
    ctx.scene.tweens.add({ targets: t, y: t.y - 24, alpha: 0, duration: 900, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  },
};
