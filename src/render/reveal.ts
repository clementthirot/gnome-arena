// Ouverture d'un épisode : titre lisible dès la première image, puis, si le public a voté la fois
// d'avant, la révélation : machine à sous sur les options, arrêt sur la gagnante (avec la part des voix),
// l'accessoire vole jusqu'au héros et s'accroche. Combat lancé en ≤ 4,5 s (≤ 1,5 s sans révélation).
// La première image est aussi photographiée : l'écran de fin s'y refond pour boucler la vidéo.
import Phaser from 'phaser';
import type { GameData, TeamId } from '../data/schema';
import type { Unit } from '../sim/types';
import { sound } from './audio';
import { manifest } from './manifest';
import { SAFE } from './safeZone';
import { accessoryTexture, fitIcon, spinReel } from './slotMachine';
import { TEAM_COLORS, textStyle } from './text';

export type { PreviousVote } from '../data/arc';
import type { PreviousVote } from '../data/arc';

export interface OpeningContext {
  scene: Phaser.Scene;
  data: GameData;
  units: readonly Unit[];
  episode?: { number: number; previousVote?: PreviousVote | null };
  /** Profondeur de l'interface (caméra fixe). */
  uiDepth: number;
  spriteOf(index: number): Phaser.GameObjects.Sprite | undefined;
  /** Image de l'accessoire `visual` porté par l'unité (cachée jusqu'à l'accrochage). */
  accessoryOf(index: number, visual: string): Phaser.GameObjects.Image | undefined;
  /** Plan rapproché sur une cible (s de combat). */
  focus(target: () => { x: number; y: number }, holdSeconds: number): void;
  emperorSays(text: string, holdMs: number): void;
  /** Lance le combat. */
  go(): void;
}

/** Ce qu'affiche la première image ; l'écran de fin le redessine pour boucler. */
export interface OpeningTitle {
  episode?: string;
  hook?: string;
  /** Sans révélation : « 50 GNOMES » / « vs » / « 50 GOBELINS ». */
  stack?: [string, string, string];
}

/** Texture de la première image, photographiée au lancement (fondu de boucle de l'écran de fin). */
export const OPENING_FRAME = 'opening_frame';
const REGISTRY_TITLE = 'openingTitle';

/** Centre horizontal de la zone sûre du texte. */
const CX = SAFE.text.x + SAFE.text.w / 2;
/** Voile sur l'arène pendant le titre. */
const VEIL_ALPHA = 0.6;

/** Repères de l'ouverture avec révélation (ms depuis la première image). */
const T = { chose: 250, reel: 400, gets: 250, fly: 650, flight: 520, go: 3500, start: 3900 } as const;
/** Ouverture courte, sans révélation (ms). */
const QUICK = { go: 800, start: 1250 } as const;

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/** Voile, numéro d'épisode et accroche : identiques à la première et à la dernière image. */
export function drawOpeningTitle(scene: Phaser.Scene, title: OpeningTitle, depth: number): Phaser.GameObjects.GameObject[] {
  const { width: w, height: h } = scene.scale;
  const items: Phaser.GameObjects.GameObject[] = [scene.add.rectangle(0, 0, w, h, 0x000000, VEIL_ALPHA).setOrigin(0).setDepth(depth)];
  if (title.episode) items.push(scene.add.text(CX, 310, title.episode, textStyle(88, '#ffe14a')).setOrigin(0.5).setDepth(depth + 1));
  if (title.hook) {
    items.push(scene.add.text(CX, 450, title.hook, textStyle(40, '#ffffff', { wordWrap: { width: SAFE.text.w - 40 }, lineSpacing: 14 })).setOrigin(0.5).setDepth(depth + 1));
  }
  if (title.stack) {
    const [a, vs, b] = title.stack;
    // Logo PixelLab (manifeste art.title) à la place du texte, effectifs en dessous ; sinon repli texte.
    if (scene.textures.exists('art_title')) {
      const logo = scene.add.image(CX, 680, 'art_title').setDepth(depth + 1);
      logo.setScale(Math.floor((SAFE.text.w * 0.8) / logo.width) || 1);
      const [na, nb] = [a, b].map((s) => /\d+/.exec(s)?.[0]);
      if (na && nb) items.push(scene.add.text(CX, 680 + logo.displayHeight / 2 + 50, `${na}  contre  ${nb}`, textStyle(44)).setOrigin(0.5).setDepth(depth + 1));
      items.push(logo);
      return items;
    }
    items.push(
      scene.add.text(CX, 600, a, textStyle(76, TEAM_COLORS.gnomes.main)).setOrigin(0.5).setDepth(depth + 1),
      scene.add.text(CX, 705, vs, textStyle(44)).setOrigin(0.5).setDepth(depth + 1),
      scene.add.text(CX, 810, b, textStyle(76, TEAM_COLORS.goblins.main)).setOrigin(0.5).setDepth(depth + 1),
    );
  }
  return items;
}

/** Titre de la dernière ouverture jouée (pour le fondu de boucle). */
export function lastOpeningTitle(scene: Phaser.Scene): OpeningTitle | undefined {
  return scene.registry.get(REGISTRY_TITLE) as OpeningTitle | undefined;
}

/** Le vote précédent, résolu en données d'affichage ; undefined s'il est inutilisable. */
function resolveVote(ctx: OpeningContext) {
  const pv = ctx.episode?.previousVote;
  if (!pv) return undefined;
  const eq = ctx.data.equipment.find((e) => e.id === pv.upgrade);
  const id = pv.recipient.toLowerCase();
  const unit = ctx.units.find((u) => u.hero && (u.hero.id === id || u.hero.name.toLowerCase() === id));
  const def = ctx.data.heroes.find((h) => h.id === id || h.name.toLowerCase() === id);
  if (!eq) return undefined;
  const index = pv.options.indexOf(pv.upgrade);
  const total = pv.votes?.reduce((a, b) => a + b, 0) ?? 0;
  const pct = pv.votes && total > 0 && index >= 0 ? Math.round(((pv.votes[index] ?? 0) * 100) / total) : undefined;
  const options = pv.options.flatMap((o) => ctx.data.equipment.find((e) => e.id === o) ?? []);
  return { pv, eq, unit, name: (unit?.hero?.name ?? def?.name ?? pv.recipient).toUpperCase(), pct, options };
}

export function playOpening(ctx: OpeningContext): void {
  const { scene } = ctx;
  const cfg = manifest.staging.reveal;
  const vote = resolveVote(ctx);
  const count = (team: TeamId) => ctx.units.filter((u) => u.team === team).length;
  const title: OpeningTitle = { episode: ctx.episode ? fill(cfg.episode, { n: ctx.episode.number }) : undefined };
  if (vote) title.hook = fill(cfg.hook, { hero: vote.name, upgrade: vote.eq.label.toUpperCase() });
  else {
    const parts = fill(cfg.hookFirst, { gnomes: count('gnomes'), goblins: count('goblins') }).split(/ (vs|contre) /);
    title.stack = parts.length === 3 ? [parts[0], parts[1], parts[2]] : [parts.join(' '), '', ''];
  }
  scene.registry.set(REGISTRY_TITLE, title);
  const titleItems = drawOpeningTitle(scene, title, ctx.uiDepth + 50);
  photographFirstFrame(scene);
  sound.fanfare();

  if (!vote) {
    scene.time.delayedCall(QUICK.go, () => combat(ctx, titleItems));
    scene.time.delayedCall(QUICK.start, () => ctx.go());
    return;
  }

  const d = ctx.uiDepth + 60;
  const hint = scene.add.text(CX, 600, cfg.chose, textStyle(46, '#ffe14a')).setOrigin(0.5).setDepth(d).setAlpha(0);
  scene.tweens.add({ targets: hint, alpha: 1, duration: 200, delay: T.chose });
  if (cfg.emperor) scene.time.delayedCall(T.chose, () => ctx.emperorSays(manifest.staging.show.lines.roulette, 1800));

  // Rouleau : défile sur les options de l'épisode précédent et s'arrête sur la gagnante.
  const pool = vote.options.flatMap((o) => accessoryTexture(scene, o.visual) ?? []);
  const target = accessoryTexture(scene, vote.eq.visual) ?? pool[0];
  const reel = spinReel(scene, { x: CX, y: 830, size: 240, depth: d, pool, target, delay: T.reel + 150, spins: 16, firstStep: 40, stepGrowth: 9 });
  reel.container.setScale(0);
  scene.tweens.add({ targets: reel.container, scale: 1, duration: 260, delay: T.reel, ease: 'Back.easeOut' });
  // Le rouleau apparaît, puis défile 150 ms plus tard ; stopsAt compte depuis la première image.
  const stopAt = reel.stopsAt;
  const after: Phaser.GameObjects.GameObject[] = [];
  scene.time.delayedCall(stopAt, () => {
    flash(scene, d + 5, 0.35);
    const label = scene.add.text(CX, 1030, vote.eq.label.toUpperCase(), textStyle(52, '#ffe14a', { wordWrap: { width: SAFE.text.w - 40 } })).setOrigin(0.5).setDepth(d);
    label.setScale(0.3);
    scene.tweens.add({ targets: label, scale: 1, duration: 220, ease: 'Back.easeOut' });
    after.push(label);
    if (vote.pct !== undefined) {
      const share = scene.add.text(CX, 1110, fill(cfg.share, { pct: vote.pct }), textStyle(34, '#ffffff')).setOrigin(0.5).setDepth(d).setAlpha(0);
      scene.tweens.add({ targets: share, alpha: 1, duration: 200, delay: 120 });
      after.push(share);
    }
  });
  scene.time.delayedCall(stopAt + T.gets, () => {
    hint.setText(fill(cfg.gets, { hero: vote.name, upgrade: vote.eq.label.toUpperCase() }));
    hint.setStyle(textStyle(44, TEAM_COLORS[vote.pv.team].main, { wordWrap: { width: SAFE.text.w - 40 }, lineSpacing: 10 }));
    scene.tweens.add({ targets: hint, scale: { from: 1.25, to: 1 }, duration: 200, ease: 'Back.easeOut' });
  });

  // L'accessoire quitte le rouleau et vole jusqu'au héros dans l'arène.
  const flyAt = stopAt + T.fly;
  const unit = vote.unit;
  const worn = unit ? ctx.accessoryOf(unit.index, vote.eq.visual) : undefined;
  worn?.setAlpha(0);
  scene.time.delayedCall(flyAt, () => {
    const veil = titleItems[0];
    scene.tweens.add({ targets: [veil, ...titleItems.slice(1), ...after, reel.container], alpha: 0, duration: 260 });
    const sprite = unit ? ctx.spriteOf(unit.index) : undefined;
    if (!sprite || !target) {
      worn?.setAlpha(1);
      return;
    }
    const to = worn ? { x: worn.x, y: worn.y } : { x: sprite.x, y: sprite.y - sprite.displayHeight * 0.5 };
    const icon = scene.add.image(CX, 830, target).setDepth(d + 2);
    fitIcon(icon, 170);
    const endScale = worn ? worn.scale : icon.scale * 0.3;
    sound.play('whoosh');
    // Vol en cloche : x linéaire, y avec une bosse.
    const from = { x: CX, y: 830 };
    const peak = Math.min(from.y, to.y) - 220;
    scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: T.flight,
      ease: 'Sine.easeIn',
      onUpdate: (tw) => {
        const k = tw.getValue() ?? 0;
        icon.setPosition(from.x + (to.x - from.x) * k, (1 - k) * (1 - k) * from.y + 2 * (1 - k) * k * peak + k * k * to.y);
        icon.setAngle(k * 720);
      },
      onComplete: () => {
        icon.destroy();
        worn?.setAlpha(1);
        sound.play('ding');
        flash(scene, d + 5, 0.5);
        confetti(scene, to.x, to.y, d + 3);
        scene.tweens.add({ targets: sprite, scaleY: { from: sprite.scaleY * 0.7, to: sprite.scaleY }, duration: 260, ease: 'Back.easeOut' });
        ctx.focus(() => ({ x: sprite.x, y: sprite.y }), 1.1);
        newTag(ctx, unit!, sprite);
      },
    });
    scene.tweens.add({ targets: icon, scale: endScale * 1.6, duration: T.flight });
  });
  scene.time.delayedCall(T.go, () => {
    combat(ctx, [hint]);
    scene.time.delayedCall(T.start - T.go, () => {
      titleItems.forEach((o) => o.destroy());
      after.forEach((o) => o.destroy());
      reel.container.destroy();
      ctx.go();
    });
  });
}

/** « COMBAT ! » : gong, musique, et le titre s'efface. */
function combat(ctx: OpeningContext, fadeOut: Phaser.GameObjects.GameObject[]): void {
  const { scene } = ctx;
  scene.tweens.add({ targets: fadeOut, alpha: 0, duration: 200, onComplete: () => fadeOut.forEach((o) => o.destroy()) });
  sound.play('gong');
  sound.startMusic();
  const go = scene.add.text(CX, 760, 'COMBAT !', textStyle(110, '#ffe14a')).setOrigin(0.5).setDepth(ctx.uiDepth + 70).setScale(2.4).setAlpha(0);
  scene.tweens.add({ targets: go, scale: 1, alpha: 1, duration: 220, ease: 'Quad.easeOut' });
  scene.tweens.add({ targets: go, alpha: 0, delay: 520, duration: 220, onComplete: () => go.destroy() });
}

/** Éclair blanc bref (un seul par moment fort : pas de stroboscope). */
function flash(scene: Phaser.Scene, depth: number, alpha: number): void {
  const { width: w, height: h } = scene.scale;
  const r = scene.add.rectangle(0, 0, w, h, 0xffffff, alpha).setOrigin(0).setDepth(depth);
  scene.tweens.add({ targets: r, alpha: 0, duration: 220, onComplete: () => r.destroy() });
}

/** Hachage entier → [0, 1) : confettis identiques d'une lecture à l'autre, sans toucher au flux rand(). */
function hash01(n: number): number {
  let t = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

function confetti(scene: Phaser.Scene, x: number, y: number, depth: number): void {
  const colors = manifest.staging.reveal.confetti.map((c) => Number.parseInt(c.slice(1), 16));
  for (let i = 0; i < 36; i++) {
    const a = hash01(i * 3 + 1) * Math.PI * 2;
    const v = 120 + hash01(i * 3 + 2) * 260;
    const size = 10 + Math.round(hash01(i * 3 + 3) * 8);
    const bit = scene.add.rectangle(x, y, size, size * 0.6, colors[i % colors.length]).setDepth(depth).setAngle(hash01(i + 99) * 180);
    scene.tweens.add({ targets: bit, x: x + Math.cos(a) * v, y: y + Math.sin(a) * v * 0.7 + 140, angle: bit.angle + 360, duration: 900, ease: 'Quad.easeOut' });
    scene.tweens.add({ targets: bit, alpha: 0, delay: 600, duration: 300, onComplete: () => bit.destroy() });
  }
}

/** Étiquette « NOUVEAU » au-dessus du héros, les premières secondes du combat. */
function newTag(ctx: OpeningContext, unit: Unit, sprite: Phaser.GameObjects.Sprite): void {
  const { scene } = ctx;
  const cfg = manifest.staging.reveal;
  if (!cfg.newTag || cfg.newTagSeconds <= 0) return;
  // Sous l'interface (caméra de jeu) : l'étiquette suit le héros quand la caméra zoome.
  const tag = scene.add.text(sprite.x, sprite.y, cfg.newTag, textStyle(28, '#ffe14a', { backgroundColor: '#d83b3b', padding: { x: 10, y: 6 } })).setOrigin(0.5, 1).setDepth(9805);
  scene.tweens.add({ targets: tag, scale: { from: 0.95, to: 1.12 }, duration: 260, yoyo: true, repeat: -1 });
  // Durée comptée avec le delta des minuteries (cohérente avec le reste de l'ouverture).
  let left = T.start - T.go + T.flight + cfg.newTagSeconds * 1000;
  const follow = (_time?: number, delta = 0) => {
    if (!tag.active) return;
    left -= delta;
    if (left <= 0 || unit.state === 'dead') {
      scene.events.off(Phaser.Scenes.Events.POST_UPDATE, follow);
      scene.tweens.add({ targets: tag, alpha: 0, duration: 250, onComplete: () => tag.destroy() });
      return;
    }
    // Au-dessus du nom et de la barre de vie du héros.
    // Bornée au cadre de la caméra : un héros collé au bord garde son étiquette entière à l'écran.
    const view = scene.cameras.main.worldView;
    const half = tag.displayWidth / 2 + 8;
    tag.setPosition(Phaser.Math.Clamp(sprite.x, view.x + half, view.right - half), sprite.y - sprite.displayHeight * 0.8 - 70);
  };
  follow();
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, follow);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.POST_UPDATE, follow));
}

/** Photographie la première image (titre compris) pour le fondu de boucle de l'écran de fin. */
function photographFirstFrame(scene: Phaser.Scene): void {
  scene.game.renderer.snapshot(
    (img) => {
      if (!(img instanceof HTMLImageElement)) return;
      if (scene.textures.exists(OPENING_FRAME)) scene.textures.remove(OPENING_FRAME);
      scene.textures.addImage(OPENING_FRAME, img);
    },
    'image/jpeg',
    0.85,
  );
}
