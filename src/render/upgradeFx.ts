// Rendus propres à certaines upgrades et incidents : onomatopées et petits gags visuels.
// Branché par une seule ligne dans ArenaScene.handleEvents ; tout le texte et les couleurs
// viennent du manifeste (bloc "upgradeFx"), avec des valeurs par défaut ici.
import type Phaser from 'phaser';
import { z } from 'zod';
import type { Battle } from '../sim/battle';
import type { BattleEvent } from '../sim/types';
import raw from './assets.manifest.json';
import { manifest } from './manifest';
import { drawAccessory } from './placeholders';
import { rand } from './random';
import { textStyle } from './text';

const Word = z.object({ text: z.string(), color: z.string().default('#ffe14a'), size: z.number().min(26).default(40) });

const UpgradeFxSchema = z
  .object({
    /** Casserole en fonte : « BONG ! » quand un coup est encaissé, au plus une fois par intervalle (s de combat). */
    potBong: Word.extend({ minGap: z.number().min(0).default(1.5), equipment: z.string().default('iron_pot') }).default({ text: 'BONG !', color: '#d8dce8', size: 44 }),
    /** Mot affiché au déclenchement d'une spéciale, par id d'équipement. */
    specials: z.record(Word).default({}),
    /** Mot affiché sur un effet visuel donné (clé d'effet : éclaboussure de tarte…). */
    effects: z.record(Word).default({}),
    /** Rayons dessinés par un personnage qui traverse l'arène (clé d'effet -> clé d'accessoire). */
    runners: z.record(z.object({ accessory: z.string(), size: z.number().positive().default(8), word: Word.optional() })).default({}),
  })
  .default({});

const config = UpgradeFxSchema.parse((raw as unknown as Record<string, unknown>).upgradeFx);

/** Dernier « BONG ! » par unité, en temps de combat : la mêlée ne doit pas en faire une rafale. */
const lastBong = new WeakMap<Battle, Map<number, number>>();

export function upgradeFx(scene: Phaser.Scene, e: BattleEvent, battle: Battle, scale: number): void {
  const units = battle.units;
  switch (e.type) {
    case 'hit': {
      const u = units[e.unit];
      const bong = config.potBong;
      if (!u || u.state === 'dead' || e.damage <= 0 || !u.equipment.some((eq) => eq.id === bong.equipment)) return;
      const seen = lastBong.get(battle) ?? new Map<number, number>();
      lastBong.set(battle, seen);
      if (battle.time - (seen.get(u.index) ?? -Infinity) < bong.minGap) return;
      seen.set(u.index, battle.time);
      comic(scene, u.x * scale, (u.y - u.radius * 2) * scale, bong);
      return;
    }
    case 'special': {
      const u = units[e.unit];
      const word = config.specials[e.ability];
      if (u && word) comic(scene, u.x * scale, (u.y - u.radius * 3) * scale, e.misfire ? { ...word, text: 'OUPS…', color: '#ff8080' } : word);
      return;
    }
    case 'effect': {
      const word = config.effects[e.visual];
      if (word) comic(scene, e.x * scale, e.y * scale, word);
      return;
    }
    case 'beam': {
      const runner = config.runners[e.visual];
      if (runner) run(scene, runner, e.fromX * scale, e.fromY * scale, e.toX * scale, e.toY * scale, scale);
      return;
    }
  }
}

/** Onomatopée de bande dessinée qui jaillit puis s'efface. */
function comic(scene: Phaser.Scene, x: number, y: number, word: z.infer<typeof Word>): void {
  const t = scene.add
    .text(x, y, word.text, textStyle(word.size, word.color, { strokeThickness: 10 }))
    .setOrigin(0.5)
    .setDepth(9850)
    .setAngle(rand() * 16 - 8)
    .setScale(0.2);
  scene.tweens.add({ targets: t, scale: 1.1, duration: 160, ease: 'Back.easeOut' });
  scene.tweens.add({ targets: t, alpha: 0, y: y - 30, delay: 650, duration: 350, onComplete: () => t.destroy() });
}

/** Un personnage géant traverse l'arène le long du rayon (poule géante…). */
function run(scene: Phaser.Scene, runner: z.infer<typeof UpgradeFxSchema>['runners'][string], x0: number, y0: number, x1: number, y1: number, scale: number): void {
  const key = runner.accessory;
  const entry = manifest.accessories[key];
  const image = `acc_img_${key}`;
  const texture = `acc_tex_${key}`;
  const loaded = entry?.type === 'image' && scene.textures.exists(image);
  const shape = entry ? (entry.type === 'placeholder' ? entry : entry.placeholder) : undefined;
  if (!loaded && !scene.textures.exists(texture)) scene.textures.addCanvas(texture, drawAccessory(shape?.kind ?? 'chicken', shape?.color ?? '#ffffff', shape?.accent ?? '#ff8a00'));
  const img = scene.add.image(x0, y0, loaded ? image : texture).setDepth(9700);
  img.setScale((runner.size * scale) / img.height);
  img.setFlipX(x1 < x0);
  const distance = Math.hypot(x1 - x0, y1 - y0);
  const duration = Math.max(350, distance * 0.5);
  // Petits bonds pendant la course.
  scene.tweens.add({ targets: img, x: x1, y: y1, duration, ease: 'Linear', onComplete: () => img.destroy() });
  scene.tweens.add({ targets: img, angle: { from: -8, to: 8 }, yoyo: true, repeat: Math.ceil(duration / 240), duration: 120 });
  if (runner.word) comic(scene, (x0 + x1) / 2, (y0 + y1) / 2, runner.word);
}
