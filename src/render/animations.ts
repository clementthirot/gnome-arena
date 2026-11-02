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
  /** Rotation en vol (degrés par seconde) ; 0 au sol. */
  spin: number;
  /** Mort en plein vol : la chute au sol attend l'atterrissage. */
  airDeath: boolean;
  /** Tournoie jusqu'à cet instant (ms, horloge de la scène) : tourbillon. */
  whirlUntil: number;
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
  /** Gouttes de sang (null = désactivé). */
  gore: { color: number; dark: number; drops: number } | null;
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
    if (ctx.gore) burst(ctx, x, y, ctx.gore.drops * (heavy ? 2 : 1), [ctx.gore.color, ctx.gore.dark], heavy ? 55 : 35, 0.4);
  },

  /** Chute au combat : le corps bascule et reste au sol. */
  death(ctx: BrickContext, view: UnitView, x: number, y: number, isHero: boolean, airborne = false) {
    const s = view.sprite;
    s.clearTint();
    burst(ctx, x, y, isHero ? 18 : 8, [0xc8a46c, 0xe0c590, 0x8a7050], isHero ? 60 : 40, 0.6);
    if (ctx.gore) burst(ctx, x, y, isHero ? 16 : 8, [ctx.gore.color, ctx.gore.dark], isHero ? 80 : 55, 0.6);
    if (airborne) {
      view.airDeath = true;
      return;
    }
    Bricks.lieDown(ctx, view);
  },

  /** Pose finale du corps au sol, selon la brique de mort. */
  lieDown(ctx: BrickContext, view: UnitView) {
    const s = view.sprite;
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

  /** Rebond au sol en plein vol : poussière et écrasement, la vrille ralentit. */
  bounce(ctx: BrickContext, view: UnitView, x: number, y: number, impact: number) {
    burst(ctx, x, y, impact > 150 ? 8 : 4, [0xc8a46c, 0xe0c590], 40, 0.35);
    view.spin *= 0.6;
    view.squash = 0.65;
    ctx.scene.tweens.add({ targets: view, squash: 1, duration: 160, ease: 'Back.easeOut' });
  },

  /** Retombée d'une unité projetée : poussière ; si elle est K.O., le corps se pose et une onomatopée éclate. */
  land(ctx: BrickContext, view: UnitView, x: number, y: number, impact: number, word?: { text: string; color: string }) {
    const hard = impact > 150;
    burst(ctx, x, y, hard ? 14 : 6, [0xc8a46c, 0xe0c590, 0x8a7050], hard ? 70 : 40, 0.5);
    view.spin = 0;
    view.squash = 0.6;
    ctx.scene.tweens.add({ targets: view, squash: 1, duration: 220, ease: 'Back.easeOut' });
    if (!view.airDeath) {
      view.sprite.setAngle(0);
      return;
    }
    view.airDeath = false;
    view.sprite.setAngle(0);
    Bricks.lieDown(ctx, view);
    if (hard) ctx.scene.cameras.main.shake(80, 0.003);
    if (!word) return;
    const t = ctx.scene.add
      .text(x * ctx.scale, y * ctx.scale - 20, word.text, { fontFamily: FONT, fontSize: '40px', color: word.color, stroke: '#000000', strokeThickness: 10 })
      .setOrigin(0.5)
      .setDepth(9850)
      .setAngle(Math.random() * 24 - 12)
      .setScale(0.2);
    ctx.scene.tweens.add({ targets: t, scale: 1.15, duration: 160, ease: 'Back.easeOut' });
    ctx.scene.tweens.add({ targets: t, alpha: 0, y: t.y - 30, delay: 650, duration: 350, onComplete: () => t.destroy() });
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
