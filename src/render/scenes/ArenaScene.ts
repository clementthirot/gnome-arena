// Scène de combat : fait avancer le moteur à pas fixe et dessine son état.
// Elle ne modifie jamais les règles : elle lit Battle et réagit à ses événements.
import Phaser from 'phaser';
import type { PreviousVote } from '../../data/arc';
import type { GameData, HeroDef, TeamId } from '../../data/schema';
import { Battle, opposingTeam, TEAMS } from '../../sim/battle';
import { hashSeed } from '../../sim/rng';
import type { BattleEvent, Unit } from '../../sim/types';
import { animKey, Bricks, directionOf, type BrickContext, type Gait, type Particle, type UnitView } from '../animations';
import { drawArenaBackground } from '../arenaArt';
import { Director } from '../director';
import { FxLayer } from '../fx';
import { GasLayer } from '../gas';
import { BlizzardLayer } from '../storm';
import { Juice } from '../juice';
import { sound } from '../audio';
import { runningGagCanvas, Show } from '../show';
import { closeCurtain } from '../curtain';
import { playOpening } from '../reveal';
import { asPlaceholder, bricksFor, DIRECTIONS, effectVisual, manifest, resolveAsset } from '../manifest';
import { drawAccessory, drawPlaceholder, drawSpectator } from '../placeholders';
import { rand, randAt, seedNoise, seedRender, seedTick, streamFrom } from '../random';
import { overlayRects, SAFE } from '../safeZone';
import { bossScale, Eggs, overlayColors, overlayTexture } from '../eggs';
import { TEAM_COLORS, TEXT, textStyle } from '../text';
import { upgradeFx } from '../upgradeFx';
import { attachScrubber } from '../scrubber';
import type { ResultData } from './ResultScene';

/** Monde 270 x 480 affiché en 1080 x 1920. */
export const SCALE = 4;
/** Titre « gnomes contre gobelins », puis « COMBAT ! » (ms). La présentation des héros s'insère entre les deux. */
const TITLE_MS = 1700;
const GO_MS = 900;
const MAX_STEPS_PER_FRAME = 12;
/** Tête de lecture : temps de calcul accordé au rattrapage à chaque image (ms). */
const SEEK_BUDGET_MS = 40;
/** Durée de chaque combat déjà calculée (seed + réglages), pour ne pas la recalculer à chaque saut. */
const durations = new Map<string, number>();
/** Au-dessus de cette profondeur, un objet appartient à l'interface : la caméra de jeu ne le zoome pas. */
const UI_DEPTH = 9900;

export interface ArenaParams {
  data: GameData;
  seed: string;
  speed: number;
  /** Upgrades gagnées dans l'arc en cours, par héros. */
  upgrades?: Record<string, string[]>;
  /** Héros engagés (ceux de l'arc) ; par défaut tous les héros actifs. */
  heroes?: HeroDef[];
  /** Épisode en cours de tournage : numéro et vote à annoncer en fin de vidéo. */
  episode?: {
    number: number;
    /** Résultat figé à la planification, pour détecter un épisode qui ne se rejoue plus pareil. */
    expected?: { winner: TeamId | 'draw'; duration: number };
    vote?: { recipient: string; team: TeamId; portrait: string; options: { label: string; visual: string }[] };
    /** K.O. cumulés de chaque héros (par nom) avant cet épisode. */
    arcKills?: Record<string, number>;
    /** Vote de l'épisode précédent (identifiants), à révéler en ouverture ; absent ou null pour l'épisode 1. */
    previousVote?: PreviousVote | null;
  };
  /** Passe l'intro (aperçus rapides de la régie). */
  skipIntro?: boolean;
  /** Biome de l'arène (sinon celui de battle.json). */
  biome?: string;
  /** Enregistrement : pas d'interaction, la fin de l'écran de vote clôt la vidéo. */
  record?: boolean;
  /** Tête de lecture : démarre le combat directement à ce moment (s), rattrapé en accéléré et sans son. */
  seek?: number;
}

interface Accessory {
  img: Phaser.GameObjects.Image;
  ax: number;
  ay: number;
}

/** Silhouette visible d'un héros, en fractions de son image (les planches PixelLab ont de grandes marges vides). */
interface Body {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Boîte des pixels opaques d'une image (frame) : les ancres suivent le corps, pas le cadre transparent. */
function opaqueBox(frame: Phaser.Textures.Frame): Body {
  const full = { top: 0, bottom: 1, left: 0, right: 1 };
  const src = frame.source.image as CanvasImageSource | undefined;
  const w = frame.cutWidth;
  const h = frame.cutHeight;
  if (!src || !w || !h) return full;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(src, frame.cutX, frame.cutY, w, h, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (px[(y * w + x) * 4 + 3] > 40) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return full;
    return { top: y0 / h, bottom: (y1 + 1) / h, left: x0 / w, right: (x1 + 1) / w };
  } catch {
    return full;
  }
}

interface HeroHud {
  name: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Graphics;
}

interface Spectator {
  sprite: Phaser.GameObjects.Image;
  baseY: number;
  phase: number;
  side: 'gnomes' | 'goblins';
  /** Animation jouée quand il exulte (coup de poing en l'air), si sa sheet en a une. */
  cheerAnim?: string;
  /** Image de repos à laquelle il revient après avoir exulté. */
  restFrame?: number;
  /** Teinte de base (variété de la foule), rétablie après un coup. */
  tint?: number;
}

/** Rayures diagonales en deux couleurs, raccordées verticalement (tuile de la barre sucre d'orge). */
function stripeCanvas(width: number, period: number, [a, b]: [string, string]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = period;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < period; y++)
    for (let x = 0; x < width; x++) {
      ctx.fillStyle = (x + y) % period < period / 2 ? a : b;
      ctx.fillRect(x, y, 1, 1);
    }
  return canvas;
}

/** Barre de rapport de force verticale, sur le bord gauche (le seul sans overlay). */
const BALANCE = { x: 18, w: 36, top: 304, bottom: 1160 } as const;

/** Thème avec textBacking : aplat uni derrière le texte (règle « fond uni sous tout texte »). */
function backed(extra: Phaser.Types.GameObjects.Text.TextStyle, pad: number): Phaser.Types.GameObjects.Text.TextStyle {
  const color = manifest.staging.reveal.textBacking;
  return color ? { ...extra, backgroundColor: color, padding: { x: pad * 1.5, y: pad } } : extra;
}

export class ArenaScene extends Phaser.Scene {
  private params!: ArenaParams;
  private battle!: Battle;
  private views: UnitView[] = [];
  private heroHud = new Map<number, HeroHud>();
  private accessories = new Map<number, Accessory[]>();
  /** Silhouette visible de chaque héros (ancres du HUD, de la couronne et des accessoires). */
  private bodies = new Map<number, Body>();
  private fxLayer!: FxLayer;
  private prev: { x: number; y: number; z: number }[] = [];
  /** Ombres des unités en l'air. */
  private airGfx!: Phaser.GameObjects.Graphics;
  private gas!: GasLayer | BlizzardLayer;
  private juice!: Juice;
  private show!: Show;
  /** Dernière unité tombée : la caméra la suit au ralenti à la fin. */
  private lastVictim = -1;
  /** Ralenti de fin (facteur appliqué au temps du combat). */
  private slowmo = 1;
  /** Tirs alliés des héros : le « meilleur raté » de l'épisode. */
  private friendlyHits = new Map<number, number>();
  private gagSpectator?: Spectator;
  /** Arrêt sur image en cours (horloge de la scène, ms). */
  private hitStopUntil = 0;
  /** Armes tombées au sol, en attendant que leur propriétaire les ramasse. */
  private lostWeapons = new Map<number, Phaser.GameObjects.Image>();
  /** Barre de rapport de force : part des gnomes affichée (lissée), éclat de la jonction. */
  private balanceBar!: Phaser.GameObjects.Graphics;
  private balanceShown = 0.5;
  private balanceKick = 0;
  private balanceFlash = 0;
  /** Rayures sucre d'orge du thème (staging.balance.stripes) : une bande par camp, et leur défilement. */
  private balanceStripes?: Record<'gnomes' | 'goblins', Phaser.GameObjects.TileSprite>;
  private balanceScroll = 0;
  private particles: Particle[] = [];
  private spectators: Spectator[] = [];
  private fx!: Phaser.GameObjects.Graphics;
  private zoneGfx!: Phaser.GameObjects.Graphics;
  private hud!: { left: Phaser.GameObjects.Text; right: Phaser.GameObjects.Text; clock: Phaser.GameObjects.Text };
  private accumulator = 0;
  private running = false;
  private paused = false;
  private timeScale = 1;
  private ending = false;
  private currentBanner?: Phaser.GameObjects.Text;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private director!: Director;
  private routed = new WeakSet<Phaser.GameObjects.GameObject>();
  private lastStandCheck = 0;
  private nextSplashAt = 0;
  /** Rappels planifiés en temps de simulation (exécutés dans le tick : déterministes). */
  private simTimers: { at: number; fn: () => void }[] = [];
  private eggs!: Eggs;
  /** Bandes cinéma (haut, bas). */
  private letterboxBars: Phaser.GameObjects.Rectangle[] = [];
  /** Jeton du ralenti en cours : un ralenti plus récent annule la fin du précédent. */
  private cinemaToken = 0;
  /** Aura et couronne des mini-boss. */
  private bossFx = new Map<number, { aura?: Phaser.GameObjects.Image; crown?: Phaser.GameObjects.Image; auraScale: number }>();
  private gagHat?: { img: Phaser.GameObjects.Image; dy: number };
  /** Spectateur récurrent : position fixe (monde), dans la tribune de droite, hors des zones d'overlay. */
  private gagSpot = { x: 0, y: 0 };
  private lastStandSeen = new Set<number>();
  /** Confettis de la victoire : émis à chaque tick jusqu'à cette date (s de combat). */
  private confettiUntil = 0;
  private confettiDebt = 0;
  private confettiColors: number[] = [];
  private mvpLabel?: { text: Phaser.GameObjects.Text; index: number };
  /** Blizzard : secondes passées par chaque mort dans la tempête, puis son bloc de glace (null sans image). */
  private frostTime = new Map<number, number>();
  private iceBlocks = new Map<number, Phaser.GameObjects.Image | null>();
  /** Blizzard : unités tombées dans la tempête (seules elles peuvent geler ; un corps rattrapé par la zone, non). */
  private diedInStorm = new Set<number>();
  /** Tête de lecture : moment visé (s de combat) pendant le rattrapage, vitesse et son à rendre ensuite. */
  private seekTo?: number;
  private seekRestore = { speed: 1, muted: false };

  constructor() {
    super('arena');
  }

  init(params: ArenaParams): void {
    this.params = params;
    this.lostWeapons = new Map();
    this.lastVictim = -1;
    this.slowmo = 1;
    this.friendlyHits = new Map();
    this.gagSpectator = undefined;
    this.balanceShown = 0.5;
    this.balanceKick = 0;
    this.balanceFlash = 0;
    this.views = [];
    this.heroHud.clear();
    this.accessories.clear();
    this.bodies.clear();
    this.particles = [];
    this.spectators = [];
    this.accumulator = 0;
    this.running = false;
    this.paused = false;
    this.ending = false;
    this.timeScale = params.speed;
    this.routed = new WeakSet();
    this.lastStandCheck = 0;
    this.nextSplashAt = 0;
    this.simTimers = [];
    this.letterboxBars = [];
    this.cinemaToken = 0;
    this.bossFx = new Map();
    this.gagHat = undefined;
    this.lastStandSeen = new Set();
    this.confettiUntil = 0;
    this.confettiDebt = 0;
    this.mvpLabel = undefined;
    this.frostTime = new Map();
    this.iceBlocks = new Map();
    this.diedInStorm = new Set();
    this.seekTo = undefined;
    this.seekRestore = { speed: params.speed, muted: sound.muted };
  }

  /** Exécute fn après `delay` secondes de combat, dans un tick (le hasard du rendu y est déterministe). */
  private atSim(delay: number, fn: () => void): void {
    this.simTimers.push({ at: this.battle.time + delay, fn });
  }

  private runSimTimers(): void {
    if (!this.simTimers.length) return;
    const now = this.battle.time + 1e-9;
    const due = this.simTimers.filter((t) => t.at <= now);
    if (!due.length) return;
    this.simTimers = this.simTimers.filter((t) => t.at > now);
    for (const t of due) t.fn();
  }

  create(): void {
    const { data, seed } = this.params;
    this.battle = new Battle(data, { seed, upgrades: this.params.upgrades, heroes: this.params.heroes, biome: this.params.biome });
    seedRender(hashSeed(`${seed}:rendu`));
    seedTick(0);
    const { width, height } = data.battle.arena;
    const field = this.battle.field;
    const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : undefined;
    this.eggs = new Eggs(seed, query?.get('eggs') === '1');
    this.gagSpot = { x: width - 7, y: field.y + 38 };
    if (this.eggs.force) {
      // Mode vérification (?eggs=1) : chaque gag se produit au moins une fois, à heure fixe.
      const burst = { x: this.gagSpot.x, y: this.gagSpot.y + 26 };
      this.atSim(4, () => {
        if (this.crowdBurst(burst.x, burst.y, 14, true)) this.director.cutaway(() => ({ x: (burst.x - 30) * SCALE, y: burst.y * SCALE }), this.battle.time, 1.4, 1.4);
      });
      this.atSim(8, () => this.crowdWave());
      this.atSim(12, () => this.emperorFall());
    }

    const bgKey = `arena_bg_${this.battle.biome.id}`;
    const groundKey = `art_ground_${this.battle.biome.id}`;
    const groundTile = this.textures.exists(groundKey) ? (this.textures.get(groundKey).getSourceImage() as HTMLImageElement) : undefined;
    const standsTile = this.textures.exists('art_stands') ? (this.textures.get('art_stands').getSourceImage() as HTMLImageElement) : undefined;
    if (!this.textures.exists(bgKey)) this.textures.addCanvas(bgKey, drawArenaBackground(width, height, field, this.battle.biome, groundTile, standsTile));
    this.add.image(0, 0, bgKey).setOrigin(0).setScale(SCALE).setDepth(-1000);
    this.createCrowd();

    // Limite de la zone : au-dessus du ciel bouché du blizzard (-405), sous les corps (-400) et les unités.
    this.zoneGfx = this.add.graphics().setDepth(-404);
    const groundFx = this.add.graphics().setDepth(-450);
    this.airGfx = this.add.graphics().setDepth(-440);
    this.juice = new Juice(this, this.particles, SCALE, manifest.staging.juice, manifest.staging.gore);
    this.show = new Show(this, this.battle, SCALE, manifest.staging.show, this.params.heroes ?? data.heroes, {
      banner: (text, color, hold) => this.banner(text, color, hold),
      toast: (text) => this.toast(text),
      focus: (target) => this.director.request('heroDuel', target, this.battle.time),
      spriteOf: (unit) => this.views[unit]?.sprite,
      later: (delay, fn) => this.atSim(delay, fn),
      comeback: () => this.crowdWave(),
    });
    if (manifest.staging.show.runningGag) {
      // Toujours au même endroit, épisode après épisode : tribune de droite, en haut (hors légende et hors rail).
      const hatKey = this.eggs.gagAccessory(this.params.episode?.number);
      const hat = hatKey ? overlayTexture(this, hatKey, SCALE) : undefined;
      const texture = hat ? 'running_gag_bare' : 'running_gag';
      if (!this.textures.exists(texture)) this.textures.addCanvas(texture, runningGagCanvas(!!hat));
      const { x: gx, y: gy } = this.gagSpot;
      const sprite = this.add.image(gx * SCALE, gy * SCALE, texture).setScale(SCALE).setOrigin(0.5, 1).setDepth(-900 + gy + 1);
      this.gagSpectator = { sprite, baseY: gy * SCALE, phase: 0, side: 'gnomes' };
      this.spectators.push(this.gagSpectator);
      if (hat) {
        // L'accessoire de l'épisode, posé sur sa tête (bas de l'accessoire au sommet du crâne).
        const img = this.add.image(sprite.x, sprite.y, hat.key).setScale(hat.scale).setOrigin(0.5, 1).setDepth(-900 + gy + 1.5);
        this.gagHat = { img, dy: 7 * SCALE };
      }
    }
    this.gas =
      manifest.staging.gas.style === 'blizzard'
        ? // Ciel bouché sur le sol, le public, les flaques et les débris (-405), sous les corps et les unités
          // (estompés à part, voir dimStorm) ; neige et grêle par-dessus (8500).
          new BlizzardLayer(this.add.graphics().setDepth(8500), this.add.graphics().setDepth(-405), field, { x: 0, y: 0, width, height }, manifest.staging.gas, SCALE)
        : new GasLayer(this.add.graphics().setDepth(8500), this.add.graphics().setDepth(-430), field, manifest.staging.gas, SCALE);
    for (const u of this.battle.units) this.createUnitView(u);
    this.prev = this.battle.units.map((u) => ({ x: u.x, y: u.y, z: u.z }));
    this.fx = this.add.graphics().setDepth(9000);
    this.fxLayer = new FxLayer(this.fx, groundFx, this.particles, SCALE, field.y);
    this.createHud();
    // Deux caméras : le jeu (qui peut zoomer sur un héros) et l'interface (fixe).
    const w = width * SCALE;
    const h = height * SCALE;
    this.uiCam = this.cameras.add(0, 0, w, h);
    this.director = new Director(this.cameras.main, manifest.staging.camera, w, h, manifest.staging.cinema.maxShot);
    this.createLetterbox();
    if (query?.get('safe') === '1') this.drawSafeOverlay();
    this.bindInput();
    this.attachScrubber();
    if (this.params.seek !== undefined) this.startSeek(this.params.seek);
    if (this.params.skipIntro || this.params.seek !== undefined) {
      this.running = true;
      this.show.start();
      sound.startMusic();
    } else if (manifest.staging.intro === 'classic') this.playIntro();
    else this.playOpening();
    this.routeCameras();
  }

  /** Confie chaque nouvel objet à une seule caméra, selon sa profondeur. */
  private routeCameras(): void {
    for (const obj of this.children.list) {
      if (this.routed.has(obj)) continue;
      this.routed.add(obj);
      const ui = ((obj as unknown as { depth?: number }).depth ?? 0) >= UI_DEPTH;
      obj.cameraFilter = ui ? this.cameras.main.id : this.uiCam.id;
    }
  }

  // ---------------------------------------------------------------- création

  private createUnitView(u: Unit): void {
    let entry = resolveAsset(u.visual, u.team);
    const failed = this.registry.get('fallbackVisuals') as Set<string> | undefined;
    if (entry.type === 'spritesheet' && failed?.has(u.visual)) entry = asPlaceholder(entry) ?? entry;
    const key = `unit_${u.visual}`;
    // Clé absente du manifeste : on génère le placeholder de secours à la volée.
    if (!this.textures.exists(key) && entry.type === 'placeholder') this.textures.addCanvas(key, drawPlaceholder(entry));
    const sprite = this.add.sprite(u.x * SCALE, u.y * SCALE, this.textures.exists(key) ? key : '__MISSING');
    // Mini-boss à l'image : un héros grossit avec ses upgrades (la simulation, elle, ne change pas).
    // Les capacités propres d'un héros (innate) ne sont pas des upgrades : ni accessoire, ni taille de mini-boss.
    const gearList = u.equipment.filter((e) => !e.innate);
    const boss = u.hero ? bossScale(gearList.length) : 1;
    const baseScale = (entry.type === 'placeholder' ? SCALE : (entry.size * SCALE) / entry.frameHeight) * boss;
    sprite.setScale(baseScale).setOrigin(0.5, 0.75);
    const directional = entry.type === 'spritesheet' && !!entry.directions && this.anims.exists(`${key}_idle_0`);
    if (!directional) sprite.setFlipX(u.facing < 0);
    const view: UnitView = { sprite, bricks: bricksFor(entry), baseScale, offX: 0, offY: 0, squash: 1, facing: u.facing, spin: 0, airDeath: false, whirlUntil: 0, dir: directional ? directionOf(u.facing, 0) : undefined };
    if (entry.type === 'spritesheet') {
      view.shrinkMin = entry.shrinkWithHp;
      view.rollOnCharge = entry.rollOnCharge;
    }
    if (this.anims.exists(animKey(view, 'idle'))) sprite.play(animKey(view, 'idle'));
    this.views.push(view);

    if (u.hero) {
      this.bodies.set(u.index, opaqueBox(sprite.frame));
      const team = TEAM_COLORS[u.team];
      const name = this.add
        .text(0, 0, u.hero.name, textStyle(26, team.main, backed({}, 2)))
        .setOrigin(0.5, 1)
        .setDepth(9800);
      const bar = this.add.graphics().setDepth(9800);
      this.heroHud.set(u.index, { name, bar });
    }
    if (gearList.length) {
      const list = gearList.map((eq) => this.createAccessory(eq.visual)).filter((a): a is Accessory => !!a);
      list.forEach((a) => a.img.setScale(a.img.scaleX * boss));
      this.accessories.set(u.index, list);
    }
    const mb = manifest.staging.miniBoss;
    if (u.hero && gearList.length >= mb.auraFrom) {
      const aura = overlayTexture(this, mb.aura, SCALE * boss);
      const crown = overlayTexture(this, mb.crown, SCALE);
      this.bossFx.set(u.index, {
        aura: aura && this.add.image(0, 0, aura.key).setScale(aura.scale).setAlpha(0.85),
        crown: crown && this.add.image(0, 0, crown.key).setScale(crown.scale).setOrigin(0.5, 1),
        auraScale: aura?.scale ?? 1,
      });
    }
  }

  /** Accessoire d'upgrade superposé au héros, depuis le manifeste (placeholder ou image). */
  private createAccessory(key: string): Accessory | undefined {
    const entry = manifest.accessories[key];
    if (!entry) {
      console.warn(`[manifest] accessoire inconnu « ${key} »`);
      return undefined;
    }
    const texture = `acc_tex_${key}`;
    const loaded = entry.type === 'image' && this.textures.exists(`acc_img_${key}`);
    // Image absente : on retombe sur le dessin de secours.
    const shape = entry.type === 'placeholder' ? entry : entry.placeholder;
    if (!loaded && shape && !this.textures.exists(texture)) this.textures.addCanvas(texture, drawAccessory(shape.kind, shape.color, shape.accent));
    const img = this.add.image(0, 0, loaded ? `acc_img_${key}` : texture);
    img.setScale(loaded && entry.type === 'image' ? (entry.size * SCALE) / img.height : SCALE);
    return { img, ax: entry.anchor[0], ay: entry.anchor[1] };
  }

  private createCrowd(): void {
    const { width } = this.params.data.battle.arena;
    const field = this.battle.field;
    const palettes = {
      gnomes: { body: ['#4a6fb8', '#5b8def', '#3d5c9a'], hat: ['#d83b3b', '#e86a3a', '#b02a2a'] },
      goblins: { body: ['#5a9a2c', '#7cc243', '#4a7a26'], hat: ['#7a4a26', '#5a3010', '#9a6a36'] },
    };
    let k = 0;
    const cfg = manifest.staging.crowd;
    const failed = this.registry.get('fallbackVisuals') as Set<string> | undefined;
    const fanSheet = (side: 'gnomes' | 'goblins') => {
      const key = side === 'gnomes' ? 'fan_gnome' : 'fan_goblin';
      const entry = manifest.assets[key];
      const texture = `unit_${key}`;
      if (!cfg.useSprites || entry?.type !== 'spritesheet' || failed?.has(key) || !this.textures.exists(texture)) return undefined;
      const columns = this.textures.get(texture).source[0].width / entry.frameWidth;
      return { entry, texture, columns };
    };
    const sheets = { gnomes: fanSheet('gnomes'), goblins: fanSheet('goblins') };
    const place = (x: number, y: number, side: 'gnomes' | 'goblins', facing: 'south' | 'north' | 'east' | 'west') => {
      if (Show.logeContains(field, x, y)) return;
      if (manifest.staging.show.runningGag && Math.abs(x - this.gagSpot.x) < 4 && Math.abs(y - this.gagSpot.y) < 6) return;
      const sheet = sheets[side];
      if (sheet) {
        // Le supporter regarde l'arène ; sans 8 directions, première image retournée vers le centre.
        const row = sheet.entry.directions ? DIRECTIONS.indexOf(facing) : 0;
        const sprite = this.add.sprite(x * SCALE, y * SCALE, sheet.texture, row * sheet.columns);
        sprite.setScale(((sheet.entry.size * SCALE) / sheet.entry.frameHeight) * cfg.scale).setOrigin(0.5, 0.75).setDepth(-900 + y);
        if (!sheet.entry.directions) sprite.setFlipX(facing === 'west');
        // Un peu de variété dans la foule : teintes légèrement différentes.
        const shade = 0xff - Math.floor(rand() * 40);
        const tint = (shade << 16) | (shade << 8) | shade;
        sprite.setTint(tint);
        this.spectators.push({ sprite, baseY: y * SCALE, phase: rand() * Math.PI * 2, side, tint, restFrame: row * sheet.columns, cheerAnim: sheet.entry.animations.attack ? `${sheet.texture}_attack${sheet.entry.directions ? `_${row}` : ''}` : undefined });
        return;
      }
      const pal = palettes[side];
      const key = `spect_${side}_${k % 9}`;
      if (!this.textures.exists(key)) {
        this.textures.addCanvas(key, drawSpectator(pal.body[k % 3], pal.hat[Math.floor(k / 3) % 3]));
      }
      k++;
      const sprite = this.add.image(x * SCALE, y * SCALE, key).setScale(SCALE).setOrigin(0.5, 1).setDepth(-900 + y);
      this.spectators.push({ sprite, baseY: y * SCALE, phase: rand() * Math.PI * 2, side });
    };
    // Gobelins en haut (derrière leur armée), gnomes en bas, mélange sur les côtés.
    for (let row = 0; row < 3; row++) {
      for (let x = 8 + (row % 2) * 4; x < width - 4; x += 8 + Math.floor(rand() * 3)) {
        place(x, field.y - 8 - row * 9, 'goblins', 'south');
        place(x, field.y + field.height + 14 + row * 9, 'gnomes', 'north');
      }
    }
    for (let y = field.y + 8; y < field.y + field.height; y += 10) {
      const side = y < field.y + field.height / 2 ? 'goblins' : 'gnomes';
      place(7, y, side, 'east');
      place(width - 7, y, side, 'west');
    }
  }

  /**
   * Interface permanente sur le bord gauche (seul côté sans overlay des réseaux) : barre de rapport de
   * force verticale, gobelins en haut (ils partent du haut), gnomes en bas, effectifs à chaque bout.
   */
  private createHud(): void {
    this.balanceBar = this.add.graphics().setDepth(9902);
    this.balanceStripes = undefined;
    const stripes = manifest.staging.balance.stripes;
    if (stripes) {
      const make = (team: 'gnomes' | 'goblins') => {
        const key = `balance_stripes_${team}`;
        if (!this.textures.exists(key)) this.textures.addCanvas(key, stripeCanvas(BALANCE.w, manifest.staging.balance.period, stripes[team]));
        return this.add.tileSprite(BALANCE.x, BALANCE.top, BALANCE.w, 1, key).setOrigin(0).setDepth(9901);
      };
      this.balanceStripes = { goblins: make('goblins'), gnomes: make('gnomes') };
    }
    const cx = BALANCE.x + BALANCE.w / 2;
    this.hud = {
      // Gobelins en haut de la barre, gnomes en bas.
      right: this.add.text(cx, BALANCE.top - 10, '', textStyle(TEXT.S + 4, TEAM_COLORS.goblins.main)).setOrigin(0.5, 1).setDepth(9903),
      left: this.add.text(cx, BALANCE.bottom + 10, '', textStyle(TEXT.S + 4, TEAM_COLORS.gnomes.main)).setOrigin(0.5, 0).setDepth(9903),
      // Chrono discret, à côté du haut de la barre ; absent de la vidéo enregistrée (il n'apporte rien).
      clock: this.add.text(BALANCE.x + BALANCE.w + 14, BALANCE.top + 4, '', textStyle(TEXT.XS, '#ffffff')).setOrigin(0, 0).setDepth(9903).setAlpha(0.7).setVisible(!this.params.record),
    };
    // La seed n'a rien à faire dans la vidéo : seulement hors enregistrement, dans la zone basse.
    if (!this.params.record) {
      this.add
        .text(this.scale.width / 2, this.scale.height - 20, `seed ${this.params.seed}`, textStyle(18, '#d8d0e8'))
        .setOrigin(0.5, 1)
        .setDepth(9901)
        .setAlpha(0.8);
    }
  }

  /** Bandes noires de cinéma : elles tombent dans les zones d'overlay (haut, légende), rien d'utile n'est masqué. */
  private createLetterbox(): void {
    const { width: w, height: h } = this.scale;
    const top = manifest.staging.cinema.letterboxTop;
    const bottomH = h - SAFE.action.bottom;
    this.letterboxBars = [
      this.add.rectangle(0, -top, w, top, 0x000000, 1).setOrigin(0).setDepth(9945),
      this.add.rectangle(0, h, w, bottomH, 0x000000, 1).setOrigin(0).setDepth(9945),
    ];
  }

  private letterbox(on: boolean): void {
    const { height: h } = this.scale;
    const [top, bottom] = this.letterboxBars;
    if (!top) return;
    this.tweens.killTweensOf(this.letterboxBars);
    this.tweens.add({ targets: top, y: on ? 0 : -top.height, duration: on ? 180 : 260, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: bottom, y: on ? h - bottom.height : h, duration: on ? 180 : 260, ease: 'Quad.easeOut' });
  }

  /**
   * Ralenti « bullet time » : temps du combat ralenti, zoom sur la cible, bandes cinéma.
   * La fin est en temps réel (la simulation, elle, ne dépend pas du moment où le ralenti s'arrête).
   */
  private bulletTime(target: () => { x: number; y: number }, moment: { enabled: boolean; slowmo: number; ms: number; zoom: number; letterbox: boolean }, force = false): void {
    if (!moment.enabled || (!force && this.slowmo < 1)) return;
    const token = ++this.cinemaToken;
    this.slowmo = moment.slowmo;
    this.director.cinema(target, this.battle.time, (moment.slowmo * moment.ms) / 1000 + 0.45, moment.zoom);
    if (moment.letterbox) this.letterbox(true);
    sound.play('whoosh');
    this.time.delayedCall(moment.ms, () => {
      if (token !== this.cinemaToken) return;
      this.slowmo = 1;
      this.letterbox(false);
    });
  }

  /** `?safe=1` : zones couvertes par l'overlay des réseaux, par-dessus tout. */
  private drawSafeOverlay(): void {
    const g = this.add.graphics().setDepth(99990);
    for (const r of overlayRects(this.scale.width, this.scale.height)) {
      g.fillStyle(0xff0040, 0.28).fillRect(r.x, r.y, r.w, r.h);
      g.lineStyle(4, 0xff0040, 0.9).strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      this.add.text(r.x + 12, r.y + 10, r.name.toUpperCase(), textStyle(TEXT.XS, '#ff8099')).setDepth(99991);
    }
    // Centre visuel de la zone utile.
    g.lineStyle(2, 0x00ffcc, 0.7).lineBetween(0, SAFE.centerY, this.scale.width, SAFE.centerY);
  }

  private bindInput(): void {
    const kb = this.input.keyboard;
    // Pendant un enregistrement, aucune touche ne doit dérégler la vidéo.
    if (this.params.record) return;
    kb?.on('keydown-M', () => sound.toggleMute());
    kb?.on('keydown-SPACE', () => (this.paused = !this.paused));
    kb?.on('keydown-ONE', () => (this.timeScale = 1));
    kb?.on('keydown-TWO', () => (this.timeScale = 2));
    kb?.on('keydown-THREE', () => (this.timeScale = 3));
    kb?.on('keydown-LEFT', () => this.seek(this.battle.time - 5));
    kb?.on('keydown-RIGHT', () => this.seek(this.battle.time + 5));
    kb?.on('keydown-FOUR', () => (this.timeScale = 4));
    kb?.on('keydown-EIGHT', () => (this.timeScale = 8));
  }

  // ---------------------------------------------------------------- cartons

  private playIntro(): void {
    const { width: w, height: h } = this.scale;
    const veil = this.add.rectangle(0, 0, w, h, 0x000000, 0.55).setOrigin(0).setDepth(9950);
    const gnomes = this.add.text(w / 2, h * 0.4, TEAM_COLORS.gnomes.label, textStyle(84, TEAM_COLORS.gnomes.main)).setOrigin(0.5).setDepth(9951);
    const vs = this.add.text(w / 2, h * 0.47, 'contre', textStyle(40)).setOrigin(0.5).setDepth(9951);
    const goblins = this.add.text(w / 2, h * 0.54, TEAM_COLORS.goblins.label, textStyle(84, TEAM_COLORS.goblins.main)).setOrigin(0.5).setDepth(9951);
    const title = [gnomes, vs, goblins];
    if (this.params.episode) {
      title.push(this.add.text(w / 2, h * 0.3, `ÉPISODE ${this.params.episode.number}`, textStyle(44, '#ffe14a')).setOrigin(0.5).setDepth(9951));
    }
    sound.fanfare();
    // Le titre tombe du ciel et rebondit.
    gnomes.y = -200;
    goblins.y = -200;
    vs.setScale(0);
    this.tweens.add({ targets: gnomes, y: h * 0.4, duration: 650, ease: 'Bounce.easeOut' });
    this.tweens.add({ targets: goblins, y: h * 0.54, duration: 650, delay: 180, ease: 'Bounce.easeOut' });
    this.tweens.add({ targets: vs, scale: 1, duration: 300, delay: 650, ease: 'Back.easeOut' });

    const heroesMs = this.battle.units.some((u) => u.hero) && manifest.staging.heroIntro.enabled ? manifest.staging.heroIntro.duration * 1000 : 0;
    const show = manifest.staging.show;
    const pronoMs = show.prono.duration * 1000;
    const countMs = show.countdown ? 3 * 550 : 0;
    const goAt = TITLE_MS + heroesMs + pronoMs + countMs;
    this.time.delayedCall(TITLE_MS + heroesMs, () => {
      this.tweens.add({ targets: title, alpha: 0, duration: 200 });
      this.prono(pronoMs);
    });
    if (countMs) {
      ['3', '2', '1'].forEach((n, i) =>
        this.time.delayedCall(TITLE_MS + heroesMs + pronoMs + i * 550, () => {
          sound.play('beep');
          const t = this.add.text(w / 2, h / 2, n, textStyle(160, '#ffffff')).setOrigin(0.5).setDepth(9952).setScale(2);
          this.tweens.add({ targets: t, scale: 0.9, duration: 260, ease: 'Back.easeOut' });
          this.tweens.add({ targets: t, alpha: 0, delay: 380, duration: 150, onComplete: () => t.destroy() });
        }),
      );
    }
    if (heroesMs) {
      this.time.delayedCall(TITLE_MS, () => {
        this.tweens.add({ targets: title, alpha: 0, duration: 200 });
        this.heroRoster(heroesMs, veil);
      });
    }
    this.time.delayedCall(goAt, () => {
      this.tweens.add({ targets: title, alpha: 0, duration: 200 });
      sound.play('gong');
      sound.startMusic();
      const go = this.add.text(w / 2, h / 2, 'COMBAT !', textStyle(110, '#ffe14a')).setOrigin(0.5).setDepth(9951).setScale(2.5).setAlpha(0);
      this.tweens.add({ targets: go, scale: 1, alpha: 1, duration: 260, ease: 'Quad.easeOut' });
      this.tweens.add({ targets: [go, veil], alpha: 0, delay: 650, duration: 250, onComplete: () => go.destroy() });
    });
    this.time.delayedCall(goAt + GO_MS, () => {
      title.forEach((t) => t.destroy());
      veil.destroy();
      this.running = true;
      this.show.start();
    });
  }

  /** Ouverture rapide et révélation du vote précédent (src/render/reveal.ts). */
  private playOpening(): void {
    playOpening({
      scene: this,
      data: this.params.data,
      units: this.battle.units,
      episode: this.params.episode,
      uiDepth: UI_DEPTH,
      spriteOf: (i) => this.views[i]?.sprite,
      accessoryOf: (i, visual) => this.accessories.get(i)?.find((a) => a.img.texture.key.endsWith(`_${visual}`))?.img,
      focus: (target, hold) => this.director.request('heroDuel', target, this.battle.time, hold),
      frame: (target, zoom) => (target ? this.director.cinema(target, this.battle.time, 60, zoom) : this.director.release(this.battle.time)),
      emperorSays: (text, ms) => this.show.emperorSays(text, ms, 'raise'),
      go: () => {
        this.running = true;
        this.show.start();
      },
    });
  }

  /** « Qui va gagner ? Dis-le en commentaire ! » */
  private prono(durationMs: number): void {
    const { width: w, height: h } = this.scale;
    const p = manifest.staging.show.prono;
    const items = [
      this.add.text(w / 2, h * 0.38, p.title, textStyle(64, '#ffe14a')).setOrigin(0.5).setDepth(9951),
      this.add.text(w * 0.27, h * 0.48, TEAM_COLORS.gnomes.label, textStyle(44, TEAM_COLORS.gnomes.main)).setOrigin(0.5).setDepth(9951),
      this.add.text(w / 2, h * 0.48, 'ou', textStyle(32)).setOrigin(0.5).setDepth(9951),
      this.add.text(w * 0.73, h * 0.48, TEAM_COLORS.goblins.label, textStyle(44, TEAM_COLORS.goblins.main)).setOrigin(0.5).setDepth(9951),
      this.add.text(w / 2, h * 0.57, p.subtitle, textStyle(30)).setOrigin(0.5).setDepth(9951),
    ];
    items.forEach((t, i) => {
      t.setScale(0.3).setAlpha(0);
      this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 240, delay: i * 90, ease: 'Back.easeOut' });
    });
    this.time.delayedCall(durationMs - 200, () => this.tweens.add({ targets: items, alpha: 0, duration: 180, onComplete: () => items.forEach((t) => t.destroy()) }));
  }

  /** Présentation des héros et de leurs upgrades : le public retrouve « ses » personnages. */
  private heroRoster(durationMs: number, veil: Phaser.GameObjects.Rectangle): void {
    const { width: w, height: h } = this.scale;
    // Fond plus sombre le temps du carton : le terrain ne doit pas gêner la lecture.
    this.tweens.add({ targets: veil, fillAlpha: 0.9, duration: 200 });
    const items: Phaser.GameObjects.GameObject[] = [];
    const head = this.add.text(w / 2, h * 0.2, 'LES HÉROS', textStyle(56, '#ffe14a')).setOrigin(0.5).setDepth(9951);
    items.push(head);
    (['gnomes', 'goblins'] as const).forEach((team, col) => {
      const heroes = this.battle.units.filter((u) => u.hero && u.team === team);
      const x = w * (col === 0 ? 0.27 : 0.73);
      items.push(this.add.text(x, h * 0.29, TEAM_COLORS[team].label, textStyle(34, TEAM_COLORS[team].main)).setOrigin(0.5).setDepth(9951));
      heroes.forEach((u, i) => {
        const y = h * 0.36 + i * 230;
        const view = this.views[u.index];
        const portrait = this.add.sprite(x, y + 40, view.sprite.texture.key, 0).setScale(view.baseScale * 1.6).setDepth(9951).setFlipX(team === 'goblins');
        const name = this.add.text(x, y + 110, u.hero!.name.toUpperCase(), textStyle(34, TEAM_COLORS[team].main)).setOrigin(0.5).setDepth(9951);
        const label = this.add.text(x, y + 150, u.hero!.label, textStyle(20)).setOrigin(0.5).setDepth(9951);
        const gear = u.equipment.filter((e) => !e.innate).map((e) => e.short).join(' + ');
        const upgrades = this.add.text(x, y + 182, gear || '—', textStyle(18, gear ? '#ffe14a' : '#a098b0')).setOrigin(0.5).setDepth(9951);
        const group = [portrait, name, label, upgrades];
        group.forEach((o) => o.setAlpha(0));
        this.tweens.add({ targets: group, alpha: 1, duration: 250, delay: 150 + i * 220 + col * 110 });
        items.push(...group);
      });
    });
    this.time.delayedCall(durationMs - 250, () => {
      this.tweens.add({ targets: veil, fillAlpha: 0.55, duration: 220 });
      this.tweens.add({ targets: items, alpha: 0, duration: 220, onComplete: () => items.forEach((o) => o.destroy()) });
    });
  }

  private banner(text: string, color = '#ffffff', hold = 1600): void {
    const { width: w, height: h } = this.scale;
    // Un seul carton à la fois : le plus récent remplace le précédent.
    if (this.currentBanner?.active) {
      this.tweens.killTweensOf(this.currentBanner);
      this.currentBanner.destroy();
    }
    void w;
    void h;
    // Bas de la zone sûre (tiers inférieur, au-dessus de la légende) : le carton ne couvre plus l'action qu'il annonce.
    const t = this.add
      .text(SAFE.centered.x + SAFE.centered.w / 2, SAFE.captionTop - 110, text, textStyle(52, color, backed({ wordWrap: { width: SAFE.centered.w - 40 }, align: 'center' }, 12)))
      .setOrigin(0.5)
      .setDepth(9960);
    this.currentBanner = t;
    t.setScale(0.4).setAlpha(0);
    this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: hold, duration: 300, onComplete: () => t.destroy() });
  }

  /** Annonce discrète en haut de l'écran (incidents d'arène). */
  private toast(text: string): void {
    const t = this.add
      .text(SAFE.centered.x + SAFE.centered.w / 2, SAFE.top + 20, text, textStyle(TEXT.M - 4, '#ffb347', backed({ wordWrap: { width: SAFE.centered.w - 40 }, align: 'center' }, 8)))
      .setOrigin(0.5)
      .setDepth(9955)
      .setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: SAFE.top + 40, duration: 180 });
    this.tweens.add({ targets: t, alpha: 0, delay: 1400, duration: 300, onComplete: () => t.destroy() });
  }

  /** Petit texte qui jaillit au-dessus d'une unité (attaque spéciale, raté). */
  private popup(u: Unit, text: string, color: string, size: number): void {
    const v = this.views[u.index];
    const t = this.add.text(v.sprite.x, v.sprite.y - v.sprite.displayHeight - 40, text, textStyle(Math.max(TEXT.XS + 2, size), color, backed({}, 4))).setOrigin(0.5, 1).setDepth(9850);
    this.tweens.add({ targets: t, y: t.y - 40, alpha: 0, delay: 350, duration: 650, onComplete: () => t.destroy() });
  }

  // ---------------------------------------------------------------- boucle

  update(_time: number, delta: number): void {
    const dtMs = this.battle.dt * 1000;
    if (this.seekTo !== undefined && this.running) this.advanceSeek(delta);
    else if (this.running && !this.paused) {
      if (this.time.now >= this.hitStopUntil) this.accumulator += Math.min(delta, 100) * this.timeScale * this.slowmo;
      let steps = 0;
      while (this.accumulator >= dtMs && steps < MAX_STEPS_PER_FRAME) {
        this.tick();
        this.accumulator -= dtMs;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }
    const alpha = Math.min(1, this.accumulator / dtMs);
    this.drawUnits(alpha, this.running && !this.paused ? (Math.min(delta, 100) / 1000) * this.timeScale : 0);
    this.drawZone();
    this.dimStorm();
    this.placeIce();
    this.gas.update(this.running && !this.paused ? (Math.min(delta, 100) / 1000) * this.timeScale * this.slowmo : 0, this.battle.zone);
    this.drawEffects(delta / 1000);
    this.animateCrowd(this.time.now / 1000);
    this.updateHud();
    this.watchLastStand();
    this.juice.drawStatus(this.battle.units, this.views, this.time.now);
    this.show.update();
    this.drawBalance();
    this.drawStageExtras();
    this.director.update(this.battle.time);
    this.routeCameras();
  }

  /** Un pas de simulation et tout ce qui en découle (événements, effets tirés au tick, rappels). */
  private tick(): void {
    for (let i = 0; i < this.battle.units.length; i++) {
      this.prev[i].x = this.battle.units[i].x;
      this.prev[i].y = this.battle.units[i].y;
      this.prev[i].z = this.battle.units[i].z;
    }
    // Après la fin, l'arène continue de vivre (épilogue) pendant l'annonce.
    if (this.battle.result) this.epilogue();
    else this.battle.step();
    seedTick(this.battle.tick);
    seedNoise(this.battle.tick);
    this.handleEvents(this.battle.events);
    this.tickVisuals(this.battle.dt);
    this.runSimTimers();
  }

  // ---------------------------------------------------------------- tête de lecture

  /** Durée du combat (s), épilogue compris : rejoué une fois sans rendu (la simulation est déterministe). */
  private replayDuration(): number {
    const p = this.params;
    const key = JSON.stringify([p.seed, p.upgrades, p.heroes?.map((h) => h.id), p.biome]);
    let d = durations.get(key) ?? p.episode?.expected?.duration;
    if (d === undefined) {
      const dry = new Battle(p.data, { seed: p.seed, upgrades: p.upgrades, heroes: p.heroes, biome: p.biome });
      while (!dry.result && dry.time < 600) dry.step();
      d = dry.result?.duration ?? dry.time;
    }
    durations.set(key, d);
    return d + manifest.staging.show.finale;
  }

  private attachScrubber(): void {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : undefined;
    if (this.params.record || q?.get('scrub') === '0' || typeof document === 'undefined') return;
    attachScrubber({
      time: () => this.seekTo ?? this.battle.time,
      duration: this.replayDuration(),
      speed: () => (this.seekTo !== undefined ? this.seekRestore.speed : this.timeScale),
      paused: () => this.paused,
      seeking: () => this.seekTo !== undefined,
      seek: (t) => this.seek(t),
      setSpeed: (s) => {
        if (this.seekTo !== undefined) this.seekRestore.speed = s;
        else this.timeScale = s;
      },
      togglePause: () => (this.paused = !this.paused),
    });
  }

  /**
   * Va au moment t du combat. En avant : la scène rattrape t en accéléré. En arrière (ou depuis l'écran de
   * vote) : le combat repart du début, sans intro, et rattrape t. Mêmes images qu'en lecture normale, le
   * hasard du rendu étant tiré au tick.
   */
  private seek(t: number): void {
    if (this.params.record) return;
    t = Math.max(0, t);
    const live = this.scene.isActive();
    if (live && this.running && t >= this.battle.time) {
      this.startSeek(t);
      return;
    }
    const paused = this.paused;
    const speed = this.seekTo !== undefined ? this.seekRestore.speed : this.timeScale;
    this.scene.stop('result');
    this.scene.start('arena', { ...this.params, seek: t, skipIntro: true, speed });
    // La pause survit au saut : on peut se placer image par image.
    this.events.once(Phaser.Scenes.Events.CREATE, () => (this.paused = paused));
  }

  private startSeek(t: number): void {
    if (this.seekTo === undefined) this.seekRestore = { speed: this.timeScale, muted: sound.muted };
    this.seekTo = t;
    sound.muted = true;
  }

  /**
   * Rattrapage : autant de pas que le budget de l'image le permet. Les tweens, minuteries et animations
   * suivent le même facteur d'accélération, pour que l'image d'arrivée soit celle d'une lecture normale.
   */
  private advanceSeek(delta: number): void {
    const target = this.seekTo!;
    const start = performance.now();
    let steps = 0;
    while (this.battle.time + 1e-9 < target && performance.now() - start < SEEK_BUDGET_MS) {
      this.tick();
      steps++;
    }
    const factor = Math.max(1, (steps * this.battle.dt) / Math.max(0.001, Math.min(delta, 100) / 1000));
    this.timeScale = factor;
    this.tweens.timeScale = factor;
    this.time.timeScale = factor;
    this.slowmo = 1;
    if (this.battle.time + 1e-9 < target && this.scene.isActive()) return;
    this.seekTo = undefined;
    this.timeScale = this.seekRestore.speed;
    this.tweens.timeScale = 1;
    this.time.timeScale = 1;
    this.accumulator = 0;
    sound.muted = this.seekRestore.muted;
  }

  /**
   * Épilogue sans dégâts : le gaz ne tue plus personne après la victoire. Pendant ce tick, la zone
   * couvre tout le terrain (plus de dégâts ni d'aspiration), puis on remet la zone affichée. Le
   * résultat et la durée sont déjà figés : ils ne changent pas, et l'image finale ne dépend plus de ?speed.
   */
  private epilogue(): void {
    const zone = this.battle.zone;
    const f = this.battle.field;
    this.battle.zone = { x: f.x - 1e6, y: f.y - 1e6, width: f.width + 2e6, height: f.height + 2e6 };
    try {
      this.battle.epilogue();
    } finally {
      this.battle.zone = zone;
    }
  }

  /** Un héros seul contre au moins trois ennemis : la caméra ne le lâche plus. */
  private watchLastStand(): void {
    if (this.battle.result || this.battle.time < this.lastStandCheck) return;
    this.lastStandCheck = this.battle.time + 1;
    for (const team of TEAMS) {
      const mine = this.battle.alive(team);
      if (mine.length === 1 && mine[0].hero && this.battle.alive(opposingTeam(team)).length >= 3 && !this.lastStandSeen.has(mine[0].index)) {
        // Un seul plan par héros : un gros plan reste court.
        this.lastStandSeen.add(mine[0].index);
        const hero = this.views[mine[0].index].sprite;
        this.director.request('lastStand', () => hero, this.battle.time, 4);
      }
    }
  }

  private handleEvents(events: readonly BattleEvent[]): void {
    const gore = manifest.staging.gore;
    const ctx: BrickContext = {
      scene: this,
      particles: this.particles,
      scale: SCALE,
      gore: gore.enabled ? { color: parseInt(gore.color.slice(1), 16), dark: parseInt(gore.dark.slice(1), 16), drops: gore.dropsPerHit } : null,
    };
    const units = this.battle.units;
    for (const e of events) {
      this.show.onEvent(e);
      this.soundFor(e);
      upgradeFx(this, e, this.battle, SCALE);
      if (e.type === 'death') this.lastVictim = e.unit;
      if (e.type === 'hit' && e.source >= 0 && units[e.source]?.hero && units[e.source].team === units[e.unit]?.team && e.source !== e.unit) {
        this.friendlyHits.set(e.source, (this.friendlyHits.get(e.source) ?? 0) + 1);
      }
      // Une unité inconnue du rendu (événement arrivé trop tôt) est ignorée plutôt que de planter.
      if ('unit' in e && e.type !== 'spawn' && !this.views[e.unit]) continue;
      switch (e.type) {
        case 'attack': {
          const u = units[e.unit];
          const t = units[e.target];
          const d = Math.hypot(t.x - u.x, t.y - u.y) || 1;
          // Le coup part vers la cible, quelle que soit la direction de marche.
          if (this.views[e.unit].dir !== undefined) this.views[e.unit].dir = directionOf(t.x - u.x, t.y - u.y);
          if (e.kind === 'melee') {
            const view = this.views[e.unit];
            const windup = e.windup ?? 0;
            this.playStrike(view, e.move === 'kick' ? 'kick' : 'attack', windup);
            // La fente part avec le coup, au moment où il touche.
            const lunge = () => view.sprite.active && Bricks.attack(ctx, view, (t.x - u.x) / d, (t.y - u.y) / d);
            if (windup > 0) this.time.delayedCall((windup * 1000) / this.simRate(), lunge);
            else lunge();
          } else {
            // Un skin en 8 directions n'a pas d'animation de tir : on ne joue pas un coup de poing à distance.
            if (this.views[e.unit].dir === undefined) this.playOnce(this.views[e.unit], 'attack');
            Bricks.shoot(ctx, this.views[e.unit], (t.x - u.x) / d, (t.y - u.y) / d);
          }
          break;
        }
        case 'hit': {
          const u = units[e.unit];
          if (e.knockback > 100) this.juice.debris(u.x, u.y, 3);
          if (e.damage > 8) this.balanceKick = Math.min(1, this.balanceKick + 0.5);
          Bricks.hurt(ctx, this.views[e.unit], u.x, u.y - u.radius, e.knockback > 100);
          if (u.state !== 'dead' && u.z <= 0) this.playReaction(this.views[e.unit], 'hurt');
          break;
        }
        case 'impact':
          Bricks.impact(ctx, this.views[e.unit], e.x, e.y);
          if (units[e.unit].hero) {
            this.hitStop();
            const s = this.views[e.unit].sprite;
            this.director.request('heroCharge', () => s, this.battle.time);
          }
          break;
        case 'miss': {
          const shooter = units[e.source];
          if (!this.strayShot(e.x, e.y, shooter) && shooter) this.juice.plantArrow(e.x, e.y, e.x - shooter.x, e.y - shooter.y);
          break;
        }
        case 'charge':
          // Anticipation : le chargeur se ramasse avant de bondir.
          this.views[e.unit].squash = 0.7;
          this.tweens.add({ targets: this.views[e.unit], squash: 1, duration: 200, ease: 'Back.easeOut' });
          break;
        case 'panic':
          Bricks.panic(ctx, this.views[e.unit]);
          break;
        case 'death': {
          const u = units[e.unit];
          const view = this.views[e.unit];
          if (this.gas instanceof BlizzardLayer && this.gas.intensity >= 0.3 && this.stormFade(u.x, u.y) > 0) this.diedInStorm.add(u.index);
          view.sprite.setDepth(-400 + u.y * 0.01);
          view.sprite.anims.stop();
          this.playOnce(view, 'death');
          Bricks.death(ctx, view, u.x, u.y, !!u.hero, u.z > 0);
          if (u.z <= 0) this.bloodPuddle(u, u.x, u.y);
          this.juice.debris(u.x, u.y, u.hero ? 8 : 4);
          this.juice.dropItem(u, u.x, u.y);
          this.cheer(opposingTeam(u.team), u.hero ? 1 : 0.15);
          if (u.hero) {
            const victim = view.sprite;
            const killer = e.killer >= 0 ? units[e.killer] : undefined;
            // Chute d'un héros : ralenti, zoom et bandes cinéma ; duel de héros : on cadre les deux.
            const k = killer?.hero ? this.views[killer.index].sprite : undefined;
            const target = k ? () => ({ x: (k.x + victim.x) / 2, y: (k.y + victim.y) / 2 }) : () => victim;
            if (manifest.staging.cinema.heroDeath.enabled && !this.ending) this.bulletTime(target, manifest.staging.cinema.heroDeath);
            else if (k) this.director.request('heroDuel', target, this.battle.time);
            else this.director.request('heroDeath', target, this.battle.time);
            const hud = this.heroHud.get(e.unit);
            hud?.name.setAlpha(0.6);
            this.balanceFlash = 1;
            this.balanceKick = 1;
            this.banner(`${u.hero.name} est K.O. !`, TEAM_COLORS[u.team].main, 1200);
          }
          break;
        }
        case 'gag': {
          const u = units[e.unit];
          if (e.kind === 'headClash') {
            this.comic(e.x, e.y, 'BONK !', '#ffffff', 46);
            this.cameras.main.shake(140, 0.006);
            this.hitStop();
          } else if (e.kind === 'dance') this.popup(u, '♪ ♫', '#ffe14a', 28);
          else if (e.kind === 'danceInterrupted') this.popup(u, '!?', '#ff8080', 32);
          else if (e.kind === 'weaponLost') {
            this.popup(u, '?!', '#ffffff', 28);
            // L'arme s'envole en tournoyant jusqu'à son point de chute.
            if (!this.textures.exists('lost_weapon')) this.textures.addCanvas('lost_weapon', drawAccessory('sword', '#d8dce8', '#8a5a2b'));
            const v = this.views[e.unit].sprite;
            const img = this.add.image(v.x, v.y - 10, 'lost_weapon').setScale(SCALE * 0.8).setDepth(9600);
            this.tweens.add({ targets: img, x: e.x * SCALE, duration: 450 });
            this.tweens.add({ targets: img, y: [v.y - 60, e.y * SCALE], angle: 540, duration: 450, ease: 'Sine.easeIn', onComplete: () => img.setDepth(-413) });
            this.lostWeapons.get(e.unit)?.destroy();
            this.lostWeapons.set(e.unit, img);
          } else if (e.kind === 'weaponFound') {
            this.lostWeapons.get(e.unit)?.destroy();
            this.lostWeapons.delete(e.unit);
            this.popup(u, '!', '#ffffff', 26);
          } else if (e.kind === 'bowled') this.juice.debris(e.x, e.y, 2);
          break;
        }
        case 'beamCharge':
          this.fxLayer.beamCharge(e.visual, e.segments, e.width, e.duration);
          break;
        case 'bounce':
          Bricks.bounce(ctx, this.views[e.unit], e.x, e.y, e.impact);
          break;
        case 'spawn':
          this.addReinforcement(units[e.unit]);
          break;
        case 'launch':
          this.views[e.unit].squash = 1.35;
          this.tweens.add({ targets: this.views[e.unit], squash: 1, duration: 260, ease: 'Quad.easeOut' });
          // Vrille en vol : plus rapide pour un K.O.
          this.views[e.unit].spin = (rand() < 0.5 ? -1 : 1) * (units[e.unit].state === 'dead' ? 900 : 480);
          break;
        case 'land': {
          const splash = manifest.staging.koSplash;
          // Onomatopée réservée aux vraies grosses chutes, et pas plus d'une à la fois.
          // Temps de combat (pas l'horloge de la scène) : le tirage du mot ne dépend pas du framerate.
          const loud = e.dead && e.impact >= splash.minImpact && this.battle.time >= this.nextSplashAt;
          if (loud) this.nextSplashAt = this.battle.time + splash.gapMs / 1000;
          const word = loud ? { text: splash.words[Math.floor(rand() * splash.words.length)], color: splash.color } : undefined;
          Bricks.land(ctx, this.views[e.unit], e.x, e.y, e.impact, word);
          if (!e.dead) this.playReaction(this.views[e.unit], 'getup');
          if (e.dead) {
            this.bloodPuddle(units[e.unit], e.x, e.y);
            // Le corps retourne au sol, sous les vivants.
            this.views[e.unit].sprite.setDepth(-400 + e.y * 0.01);
            this.cheer(opposingTeam(units[e.unit].team), 0.25);
          }
          break;
        }
        case 'zone':
          this.banner(manifest.staging.gas.banner, manifest.staging.gas.accent);
          break;
        case 'special': {
          const u = units[e.unit];
          const eq = u.abilities.find((x) => x.id === e.ability);
          if (e.misfire) {
            this.popup(u, 'OUPS !', '#ff8080', 32);
            const s = this.views[e.unit].sprite;
            this.director.request('misfire', () => s, this.battle.time);
          }
          else if (eq) this.popup(u, eq.short.toUpperCase() + ' !', '#ffe14a', TEXT.XS + 2);
          break;
        }
        case 'effect':
          this.fxLayer.effect(e.visual, e.x, e.y, e.radius);
          if (e.source >= 0 && effectVisual(e.visual).spinSource) this.views[e.source].whirlUntil = this.time.now + effectVisual(e.visual).duration * 1000;
          this.hitStands(e.x, e.y, e.radius + 6, e.radius >= 12);
          if (e.radius >= manifest.staging.easterEggs.emperorFall.minRadius) this.emperorFall();
          if (e.radius >= manifest.staging.camera.bigImpactRadius) {
            this.cameras.main.shake(320, 0.014);
            this.cameras.main.flash(140, 255, 236, 200);
            this.hitStop();
            this.cheer('gnomes', 0.6);
            this.cheer('goblins', 0.6);
            const at = { x: e.x * SCALE, y: e.y * SCALE };
            this.director.request('bigImpact', () => at, this.battle.time);
          } else if (e.radius >= 12) this.cameras.main.shake(90, 0.003);
          break;
        case 'beam':
          this.fxLayer.beam(e.visual, e.fromX, e.fromY, e.toX, e.toY, e.width);
          // Le rayon finit dans le muret : les spectateurs juste derrière trinquent.
          if (e.width) this.hitStands(e.toX, e.toY, 16);
          if (e.width) this.cameras.main.shake(120, 0.004);
          break;
        case 'telegraph':
          this.fxLayer.telegraph(e.visual, e.x, e.y, e.radius, e.duration);
          break;
        case 'incident':
          this.toast(e.label);
          this.cheer('gnomes', 0.3);
          this.cheer('goblins', 0.3);
          break;
        case 'end':
          this.finish();
          break;
        default:
          break;
      }
    }
  }

  /** Joue une animation ponctuelle de la sprite sheet si le manifeste la fournit. */
  private playOnce(view: UnitView, name: 'attack' | 'death'): void {
    const key = animKey(view, name);
    if (!this.anims.exists(key)) return;
    view.sprite.anims.timeScale = 1;
    view.gait = undefined;
    view.strikeHit = undefined;
    view.sprite.play(key);
  }

  /**
   * Allure en boucle d'une unité au sol qui ne frappe pas : course quand elle fonce, marche quand elle avance
   * lentement ou piétine au contact, garde de combat à l'arrêt face à un adversaire, pose fixe sinon.
   * Un léger délai et des seuils décalés évitent de basculer d'une allure à l'autre à chaque image.
   */
  private playGait(u: Unit, v: UnitView, units: readonly Unit[], stunned: boolean): void {
    const has = (name: string) => this.anims.exists(animKey(v, name));
    const speed = stunned ? 0 : Math.hypot(u.vx, u.vy);
    const ratio = speed / Math.max(1, u.speed);
    const t = u.target >= 0 ? units[u.target] : undefined;
    const foe = t && t.state !== 'dead' ? t : undefined;
    const gap = foe ? Math.hypot(foe.x - u.x, foe.y - u.y) - u.radius - foe.radius : Infinity;
    const contact = gap < 6;
    const prev = v.gait;
    let gait: Gait;
    if (speed <= (prev === 'walk' || prev === 'stroll' ? 3 : 5)) gait = foe && gap < 40 && !this.ending ? 'guard' : 'idle';
    // Au contact, on ne court pas : on se replace en marchant. Ailleurs, la course dès que l'unité prend de la vitesse.
    else if (contact || ratio < (prev === 'walk' ? 0.4 : 0.55)) gait = 'stroll';
    else gait = 'walk';
    if (prev && gait !== prev && this.time.now - (v.gaitSince ?? 0) < 140) gait = prev;
    // Animation absente de la sheet : la marche retombe sur la course (ralentie), la garde sur la pose fixe.
    let name: string = gait;
    if (name === 'stroll' && !has('stroll')) name = 'walk';
    if (name === 'walk' && !has('walk')) name = has('stroll') ? 'stroll' : 'idle';
    if (name === 'guard' && !has('guard')) name = 'idle';
    const key = animKey(v, name);
    if (!this.anims.exists(key)) return;
    if (gait !== prev) {
      v.gait = gait;
      v.gaitSince = this.time.now;
    }
    // La cadence suit la vitesse réelle (les pieds ne glissent plus) et l'accéléré/ralenti du combat.
    const pace = name === 'walk' ? Phaser.Math.Clamp(ratio / 0.85, 0.7, 1.4) : name === 'stroll' ? (gait === 'stroll' ? Phaser.Math.Clamp(ratio / 0.4, 0.6, 1.3) : 0.55) : 1;
    v.sprite.anims.timeScale = pace * this.simRate();
    if (v.sprite.anims.currentAnim?.key !== key || !v.sprite.anims.isPlaying) v.sprite.play(key, true);
  }

  /** Vitesse de la simulation par rapport au temps réel (accéléré, ralenti). */
  private simRate(): number {
    return Math.max(0.05, this.timeScale * this.slowmo);
  }

  /**
   * Coup au corps à corps : l'image d'impact de l'animation tombe pile quand le coup touche.
   * Sans animation de coup de pied, on rejoue le coup de poing.
   */
  private playStrike(view: UnitView, name: 'attack' | 'kick', windup: number): void {
    const entry = manifest.assets[view.sprite.texture.key.replace(/^unit_/, '')];
    const anims = entry?.type === 'spritesheet' ? entry.animations : undefined;
    const move = name === 'kick' && anims?.kick && this.anims.exists(animKey(view, 'kick')) ? 'kick' : 'attack';
    const anim = anims?.[move];
    const key = animKey(view, move);
    if (!anim || !this.anims.exists(key)) return;
    const hit = anim.hit ?? Math.floor(anim.frames.length / 2);
    // hit images avant l'impact : la cadence qui les fait tenir dans le temps d'armé.
    const fps = windup > 0 && hit > 0 ? Phaser.Math.Clamp((hit / windup) * this.simRate(), 4, 40) : anim.fps;
    view.sprite.anims.timeScale = 1;
    view.gait = undefined;
    view.strikeHit = hit;
    view.sprite.play({ key, frameRate: fps });
  }

  /** Réaction (coup encaissé, relevé) : n'interrompt pas un coup en train de partir. */
  private playReaction(view: UnitView, name: 'hurt' | 'getup'): void {
    const key = animKey(view, name);
    const current = view.sprite.anims.currentAnim?.key ?? '';
    if (view.sprite.anims.isPlaying && /_(attack|kick)/.test(current)) return;
    const anim = this.anims.get(key);
    if (!anim) return;
    view.sprite.anims.timeScale = 1;
    view.gait = undefined;
    view.sprite.play({ key, frameRate: anim.frameRate * this.simRate() });
  }

  /** En vol : pose figée du coup encaissé (sinon la pose fixe), dans la direction du regard. */
  private holdAirPose(view: UnitView): void {
    const hurt = this.anims.get(animKey(view, 'hurt')) ?? this.anims.get(animKey(view, 'idle'));
    if (!hurt?.frames.length) return;
    const frame = hurt.frames[Math.min(2, hurt.frames.length - 1)].textureFrame;
    if (view.sprite.anims.isPlaying) view.sprite.anims.stop();
    if (view.sprite.frame.name !== String(frame)) view.sprite.setFrame(frame);
  }

  /** Une flèche ratée près du bord file dans les gradins : un spectateur la prend. Purement visuel. */
  private strayShot(x: number, y: number, shooter: Unit | undefined): boolean {
    const cfg = manifest.staging.strayShots;
    const f = this.battle.field;
    const edge = Math.min(x - f.x, f.x + f.width - x, y - f.y, f.y + f.height - y);
    if (!shooter || edge > cfg.edgeDistance || rand() > cfg.chance) return false;
    const dx = x - shooter.x;
    const dy = y - shooter.y;
    const l = Math.hypot(dx, dy) || 1;
    // Le spectateur le plus proche de la trajectoire prolongée.
    let best: Spectator | undefined;
    let bestScore = Infinity;
    for (const s of this.spectators) {
      const sx = s.sprite.x / SCALE - x;
      const sy = s.baseY / SCALE - 3 - y;
      const along = (sx * dx + sy * dy) / l;
      if (along <= 0 || along > 90) continue;
      const across = Math.abs(sx * dy - sy * dx) / l;
      const score = across * 3 + along * 0.2;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (!best || bestScore > 40) return false;
    const target = best;
    // Le spectateur s'envole plus tard (fin du vol de la flèche) : ses tirages sont faits maintenant, dans le tick.
    const rnd = streamFrom(rand());
    const arrow = this.add.rectangle(x * SCALE, y * SCALE, 5 * SCALE, SCALE, 0xf4f0e0).setRotation(Math.atan2(dy, dx)).setDepth(9000);
    this.tweens.add({
      targets: arrow,
      x: target.sprite.x,
      y: target.baseY - 3 * SCALE,
      duration: 220,
      onComplete: () => {
        arrow.destroy();
        this.hurtSpectator(target, true, rnd);
      },
    });
    return true;
  }

  /** Un spectateur prend un coup : il est éjecté hors de l'écran, et les gradins se vident peu à peu. */
  private hurtSpectator(s: Spectator, shout: boolean, rnd: () => number = rand): void {
    if (!s.sprite.visible) return;
    if (s !== this.gagSpectator && manifest.staging.crowd.ejectOnHit) {
      this.ejectSpectator(s, shout, rnd);
      return;
    }
    s.sprite.setTint(0xff6060);
    this.time.delayedCall(250, () => (s.tint === undefined ? s.sprite.clearTint() : s.sprite.setTint(s.tint)));
    this.tweens.add({ targets: s.sprite, y: s.baseY - 5 * SCALE, duration: 110, yoyo: true });
    if (!shout) return;
    const ouch = this.add.text(Math.min(s.sprite.x, 820), s.baseY - 9 * SCALE, 'AÏE !', textStyle(TEXT.XS + 2, '#ffffff')).setOrigin(0.5, 1).setDepth(9850);
    this.tweens.add({ targets: ouch, y: ouch.y - 30, alpha: 0, delay: 300, duration: 500, onComplete: () => ouch.destroy() });
  }

  private ejectSpectator(s: Spectator, shout: boolean, rand: () => number): void {
    this.spectators = this.spectators.filter((o) => o !== s);
    const sprite = s.sprite;
    this.tweens.killTweensOf(sprite);
    if (sprite instanceof Phaser.GameObjects.Sprite) sprite.anims.stop();
    sprite.setTint(0xff6060).setDepth(9400);
    // Loin du centre de l'arène, vers le haut : il sort de l'écran par le bord le plus proche.
    const f = this.battle.field;
    const dx = sprite.x / SCALE - (f.x + f.width / 2);
    const dy = s.baseY / SCALE - (f.y + f.height / 2);
    const side = Math.abs(dx) / f.width > Math.abs(dy) / f.height;
    const vx = (side ? Math.sign(dx) * (420 + rand() * 260) : (rand() - 0.5) * 300) * SCALE / 4;
    const vy = (side ? -260 - rand() * 200 : dy < 0 ? -700 - rand() * 250 : -380 - rand() * 200) * SCALE / 4;
    const spin = (rand() < 0.5 ? -1 : 1) * (540 + rand() * 540);
    const x0 = sprite.x;
    const y0 = sprite.y;
    const gravity = 1400 * SCALE / 4;
    const scale = sprite.scaleX;
    const state = { t: 0 };
    this.tweens.add({
      targets: state,
      t: 1.4,
      duration: 1400,
      onUpdate: () => {
        sprite.setPosition(x0 + vx * state.t, y0 + vy * state.t + 0.5 * gravity * state.t * state.t);
        sprite.setAngle(spin * state.t).setScale(scale * (1 + state.t * 0.6));
      },
      onComplete: () => sprite.destroy(),
    });
    if (shout) {
      const ouch = this.add.text(Math.min(Math.max(x0, 100), 820), s.baseY - 9 * SCALE, 'AÏE !', textStyle(TEXT.XS + 2, '#ffffff')).setOrigin(0.5, 1).setDepth(9850);
      this.tweens.add({ targets: ouch, y: ouch.y - 30, alpha: 0, delay: 300, duration: 500, onComplete: () => ouch.destroy() });
    }
  }

  /** Explosions et rayons qui débordent sur les gradins : les spectateurs à portée trinquent. */
  private hitStands(x: number, y: number, radius: number, explosive = false): void {
    const f = this.battle.field;
    const edge = Math.min(x - f.x, f.x + f.width - x, y - f.y, f.y + f.height - y);
    if (edge > radius) return;
    if (explosive && this.crowdBurst(x, y, radius)) return;
    let shouted = false;
    for (const s of this.spectators) {
      if (Math.hypot(s.sprite.x / SCALE - x, s.baseY / SCALE - 3 - y) > radius + 4) continue;
      this.hurtSpectator(s, !shouted);
      shouted = true;
    }
  }

  /** Flaque de sang qui s'étale sous le corps. */
  private bloodPuddle(u: Unit, x: number, y: number): void {
    this.juice.puddle(x, y, u.radius, !!u.hero);
  }

  /** Bruitage d'un événement du combat. */
  private soundFor(e: BattleEvent): void {
    switch (e.type) {
      case 'hit':
        sound.play(e.knockback > 100 || e.damage > 8 ? 'heavy' : 'hit');
        break;
      case 'attack':
        if (e.kind === 'ranged') sound.play('arrow');
        break;
      case 'effect':
        if (e.radius >= manifest.staging.camera.bigImpactRadius) sound.play('explosion');
        else if (e.radius >= 12) sound.play('heavy');
        else if (e.visual === 'tomato_splat') sound.play('splat');
        break;
      case 'beamCharge':
        sound.play('laserCharge');
        break;
      case 'beam':
        if (e.width) sound.play('laser');
        break;
      case 'launch':
        sound.play('whoosh');
        break;
      case 'land':
      case 'bounce':
        sound.play('land');
        break;
      case 'gag':
        if (e.kind === 'headClash') sound.play('bonk');
        break;
      case 'incident':
        sound.play('ooh');
        break;
      case 'death':
        if (this.battle.units[e.unit].hero) {
          sound.play('ooh');
          sound.play('cheer');
        }
        break;
      default:
        break;
    }
  }

  /** Arrêt sur image bref : la simulation marque une pause, l'image continue de vibrer. */
  private hitStop(): void {
    this.hitStopUntil = Math.max(this.hitStopUntil, this.time.now + manifest.staging.juice.hitStopMs);
  }

  /** Un supporter saute dans l'arène : il apparaît, et sa place dans les gradins se vide. */
  private addReinforcement(u: Unit): void {
    this.createUnitView(u);
    this.prev.push({ x: u.x, y: u.y, z: u.z });
    let best: Spectator | undefined;
    let bestD = Infinity;
    for (const s of this.spectators) {
      if (!s.sprite.visible || s.side !== u.team) continue;
      const d = Math.abs(s.sprite.x / SCALE - u.x) + Math.abs(s.baseY / SCALE - u.y) * 0.5;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    best?.sprite.setVisible(false);
    this.cheer(u.team, 0.3);
  }

  private finish(): void {
    if (this.ending) return;
    this.ending = true;
    this.director.release(this.battle.time);
    const r = this.battle.result!;
    const cfg = manifest.staging.show;
    const cin = manifest.staging.cinema;
    // Dernier K.O. : silence, ralenti, zoom et bandes cinéma, écrit à l'écran (lecture sans le son)… puis la foule explose.
    sound.stopMusic();
    this.time.delayedCall(350, () => sound.play('cheer'));
    const last = this.views[this.lastVictim]?.sprite;
    const center = { x: this.scale.width / 2, y: SAFE.centerY };
    if (cin.lastKO.enabled) {
      this.bulletTime(last ? () => last : () => center, cin.lastKO, true);
      if (r.winner !== 'draw') this.banner(cin.lastKOText, '#ffffff', Math.max(400, cin.lastKO.ms - 300));
    } else {
      this.slowmo = cfg.slowmo;
      if (last) this.director.request('lastStand', () => last, this.battle.time, 1.2);
    }
    const slowMs = cin.lastKO.enabled ? cin.lastKO.ms : 1200;
    this.time.delayedCall(slowMs, () => {
      this.slowmo = 1;
      this.director.release(this.battle.time);
      if (r.winner !== 'draw') this.winnerShot(r.winner);
      const label = r.winner === 'draw' ? 'MATCH NUL !' : `VICTOIRE DES ${TEAM_COLORS[r.winner].label} !`;
      this.banner(label, r.winner === 'draw' ? '#ffffff' : TEAM_COLORS[r.winner].main, 2200);
      this.show.victory(r.winner);
      if (r.winner !== 'draw') this.celebrate(r.winner);
      this.finalGag();
    });
    const result: ResultData = {
      params: this.params,
      winner: r.winner,
      reason: r.reason,
      duration: r.duration,
      survivors: r.survivors,
      heroes: this.battle.units
        .filter((u) => u.hero)
        .map((u) => ({ name: u.hero!.name, label: u.hero!.label, team: u.team, kills: u.kills, alive: u.state !== 'dead', hp: u.hp / u.maxHp })),
    };
    result.friendlyFire = [...this.friendlyHits.entries()].sort((a, b) => b[1] - a[1])[0];
    if (result.friendlyFire) result.friendlyFireName = this.battle.units[result.friendlyFire[0]].hero!.name;
    // Transition vers la roulette : le rideau se ferme, l'écran de vote s'ouvre derrière.
    this.time.delayedCall(cfg.finale * 1000, () => {
      sound.play('gong');
      closeCurtain(this, cfg.curtain * 1000, () => this.scene.start('result', { ...result, curtain: true }));
    });
  }

  /** Bannières aux couleurs du vainqueur, confettis, public qui saute, vainqueurs qui sautillent. */
  private celebrate(winner: TeamId): void {
    const { width: w } = this.scale;
    const f = this.battle.field;
    const colors = [TEAM_COLORS[winner].bar, 0xffe14a, 0xffffff];
    const flags = this.add.graphics().setDepth(-350);
    for (const y of [f.y - 2, f.y + f.height + 2]) {
      for (let x = f.x; x < f.x + f.width; x += 9) {
        flags.fillStyle(colors[(x / 9) % 2 | 0], 1).fillTriangle(x * SCALE, y * SCALE, (x + 7) * SCALE, y * SCALE, (x + 3.5) * SCALE, (y + 6) * SCALE);
      }
    }
    flags.setAlpha(0);
    this.tweens.add({ targets: flags, alpha: 1, duration: 300 });
    void w;
    // Confettis et cris émis dans les ticks (épilogue) : mêmes tirages quel que soit le framerate.
    this.confettiColors = colors;
    this.confettiUntil = this.battle.time + 2.4;
    this.atSim(0, () => this.cheer(winner, 1));
    for (let k = 1; k <= 4; k++) this.atSim(0.6 * k, () => this.cheer(winner, 0.7));
  }

  /** Plan du vainqueur : la caméra se pose sur le meilleur survivant du camp gagnant, « MVP » au-dessus de lui. */
  private winnerShot(winner: TeamId): void {
    const cfg = manifest.staging.cinema.winner;
    if (!cfg.enabled) return;
    const alive = this.battle.units.filter((u) => u.team === winner && u.state !== 'dead');
    if (!alive.length) return;
    const score = (u: Unit) => u.kills + (u.hero ? 1000 : 0);
    const mvp = alive.reduce((a, b) => (score(b) > score(a) ? b : a));
    const sprite = this.views[mvp.index].sprite;
    this.director.cinema(() => sprite, this.battle.time, cfg.hold, cfg.zoom);
    if (!mvp.hero) return;
    const text = this.add.text(sprite.x, sprite.y, cfg.label, textStyle(TEXT.S, '#ffe14a')).setOrigin(0.5, 1).setDepth(9870).setScale(0.2);
    this.tweens.add({ targets: text, scale: 1, duration: 220, ease: 'Back.easeOut' });
    this.mvpLabel = { text, index: mvp.index };
  }

  /** Confettis de la victoire, fond d'ambiance, barre de force : avancés au rythme de la simulation. */
  private tickVisuals(dt: number): void {
    this.ambience(dt);
    this.gas.emit(dt, this.battle.zoneScale, this.battle.zone, !!this.battle.result);
    if (this.gas instanceof BlizzardLayer) this.freezeCorpses(dt, this.gas);
    if (this.battle.time < this.confettiUntil) {
      const f = this.battle.field;
      this.confettiDebt += dt * 75;
      while (this.confettiDebt >= 1) {
        this.confettiDebt -= 1;
        const colors = this.confettiColors;
        this.particles.push({ x: (rand() * this.scale.width) / SCALE, y: f.y - 30 + rand() * 10, vx: (rand() - 0.5) * 40, vy: 10 + rand() * 30, life: 2.2, maxLife: 2.2, color: colors[Math.floor(rand() * colors.length)], size: 2 });
      }
    }
    const sg = this.battle.strength('gnomes');
    const sb = this.battle.strength('goblins');
    const target = sg + sb > 0 ? sg / (sg + sb) : 0.5;
    const step = (target - this.balanceShown) * Math.min(1, dt * 4);
    this.balanceShown += step;
    // Les rayures défilent vers le camp qui gagne du terrain (la jonction monte quand les gnomes gagnent).
    const bal = manifest.staging.balance;
    this.balanceScroll += dt * bal.idle * (target >= 0.5 ? 1 : -1) + step * bal.push;
    this.balanceKick = Math.max(0, this.balanceKick - dt * 3);
    this.balanceFlash = Math.max(0, this.balanceFlash - dt * 2.5);
  }

  /**
   * Blizzard : une unité tombée dans la tempête, si son corps y reste, bleuit peu à peu, puis gèle dans un bloc de glace.
   * Compté en temps de combat, dans le tick : le moment du gel ne dépend ni du framerate ni de ?speed.
   * Rendu seulement : la simulation ne sait rien du gel.
   */
  private freezeCorpses(dt: number, storm: BlizzardLayer): void {
    const cfg = manifest.staging.gas.freeze;
    if (!cfg.enabled || this.battle.result || storm.intensity < 0.3) return;
    const z = this.battle.zone;
    for (const i of this.diedInStorm) {
      const u = this.battle.units[i];
      if (u.state !== 'dead' || u.z > 0 || this.iceBlocks.has(u.index)) continue;
      if (u.x > z.x && u.x < z.x + z.width && u.y > z.y && u.y < z.y + z.height) continue;
      const t = (this.frostTime.get(u.index) ?? 0) + dt;
      this.frostTime.set(u.index, t);
      const sprite = this.views[u.index].sprite;
      if (t < cfg.after) {
        // Le givre gagne : du blanc au bleu glacier.
        const k = Math.min(1, t / cfg.after);
        const ch = (from: number, to: number) => Math.round(from + (to - from) * k);
        sprite.setTint((ch(255, 0xb8) << 16) | (ch(255, 0xdc) << 8) | 255);
      } else this.freezeCorpse(u);
    }
  }

  private freezeCorpse(u: Unit): void {
    const sprite = this.views[u.index].sprite;
    sprite.setTint(0xb8dcff);
    // Petit craquement de glace (discret : on est dans la tempête, l'action est dans la zone).
    for (let k = 0; k < (u.hero ? 5 : 2); k++) {
      const a = rand() * Math.PI * 2;
      const v = 20 + rand() * 30;
      this.particles.push({ x: u.x, y: u.y - 3, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 25, life: 0.45, maxLife: 0.45, color: rand() < 0.5 ? 0xffffff : 0xa8dcff, size: rand() < 0.4 ? 2 : 1 });
    }
    if (u.hero) sound.play('hail');
    if (!this.textures.exists('ice_block')) {
      this.iceBlocks.set(u.index, null);
      return;
    }
    // Bloc à la taille du corps couché, discret comme un cadavre ; estompé avec lui par dimStorm.
    const size = Math.max(sprite.displayWidth * 0.3, u.radius * 2 * SCALE);
    const ice = this.add.image(sprite.x, sprite.y, 'ice_block').setOrigin(0.5, 0.8).setDepth(sprite.depth + 0.002);
    const scale = size / ice.width;
    ice.setScale(scale * 0.3, scale * 0.1);
    this.tweens.add({ targets: ice, scaleX: scale, scaleY: scale, duration: 280, ease: 'Back.easeOut' });
    this.iceBlocks.set(u.index, ice);
  }

  /** Les blocs de glace suivent leur corps (un mort peut encore être projeté) et fondent s'il se relève. */
  private placeIce(): void {
    for (const [i, ice] of this.iceBlocks) {
      if (!ice) continue;
      const sprite = this.views[i].sprite;
      if (this.battle.units[i].state !== 'dead') {
        ice.destroy();
        sprite.clearTint();
        this.iceBlocks.delete(i);
        this.frostTime.delete(i);
        continue;
      }
      ice.setPosition(sprite.x, sprite.y).setDepth(sprite.depth + 0.002).setAlpha(0.6 * sprite.alpha);
    }
  }

  /** Part de tempête au point (x, y) : 0 dans la zone, 1 à 6 px dehors, multipliée par la force du blizzard. */
  private stormFade(x: number, y: number): number {
    if (!(this.gas instanceof BlizzardLayer) || this.battle.zoneScale >= 1) return 0;
    const z = this.battle.zone;
    const d = Math.max(z.x - x, x - z.x - z.width, z.y - y, y - z.y - z.height);
    return Phaser.Math.Clamp(d / 6, 0, 1) * Math.min(1, this.gas.intensity * 1.5);
  }

  /**
   * Tout ce qui est dans le blizzard s'estompe (unités, corps, accessoires, couronnes, HUD des héros) :
   * l'œil reste dans la zone. Le sol, les flaques et le public le sont déjà par le ciel bouché.
   */
  private dimStorm(): void {
    if (!(this.gas instanceof BlizzardLayer)) return;
    const units = this.battle.units;
    for (let i = 0; i < units.length; i++) {
      const v = this.views[i];
      const a = 1 - 0.55 * this.stormFade(units[i].x, units[i].y);
      if (v.sprite.alpha === a) continue;
      v.sprite.setAlpha(a);
      v.skin?.setAlpha(a);
      for (const acc of this.accessories.get(i) ?? []) acc.img.setAlpha(a);
      const fx = this.bossFx.get(i);
      fx?.crown?.setAlpha(a);
      fx?.aura?.setAlpha(0.85 * a);
      const hud = this.heroHud.get(i);
      if (hud) {
        hud.bar.setAlpha(a);
        hud.name.setAlpha((units[i].state === 'dead' ? 0.6 : 1) * a);
      }
    }
  }

  /** Easter egg « le public explose » : un bloc de spectateurs part en confettis, puis revient sonné. */
  private crowdBurst(x: number, y: number, radius: number, forced = false): boolean {
    const cfg = manifest.staging.easterEggs.crowdBurst;
    const block = this.spectators.filter((s) => s !== this.gagSpectator && s.sprite.visible && Math.hypot(s.sprite.x / SCALE - x, s.baseY / SCALE - 3 - y) <= radius * 1.6 + 8);
    if (block.length < (forced ? 1 : 3) || !this.eggs.take('crowdBurst')) return false;
    const [c1, c2] = overlayColors(cfg.visual);
    for (const s of block) {
      this.tweens.killTweensOf(s.sprite);
      s.sprite.setVisible(false);
      const sx = s.sprite.x / SCALE;
      const sy = s.baseY / SCALE - 3;
      const own = s.tint ?? (s.side === 'gnomes' ? TEAM_COLORS.gnomes.bar : TEAM_COLORS.goblins.bar);
      for (let k = 0; k < 8; k++) {
        const life = 1.3 + rand() * 0.7;
        this.particles.push({ x: sx, y: sy - rand() * 5, vx: (rand() - 0.5) * 140, vy: -90 - rand() * 130, life, maxLife: life, color: [c1, c2, own, 0xffffff][k % 4], size: rand() < 0.5 ? 2 : 1 });
      }
    }
    // Visuel remplaçable : une image dans le manifeste remplace le simple nuage de pixels.
    const art = manifest.overlays[cfg.visual]?.type === 'image' ? overlayTexture(this, cfg.visual, SCALE) : undefined;
    if (art) {
      const img = this.add.image(x * SCALE, y * SCALE, art.key).setScale(art.scale * 0.3).setDepth(9010);
      this.tweens.add({ targets: img, scale: art.scale, alpha: 0, duration: 700, onComplete: () => img.destroy() });
    }
    this.comic(x, y - 6, 'BOUM !', '#ffe14a', 56);
    this.cameras.main.shake(260, 0.012);
    sound.play('explosion');
    sound.play('cheer');
    this.show.emperorSays(cfg.line, 1600, 'none');
    this.atSim(cfg.respawnMs / 1000, () => {
      for (const s of block) {
        // Il revient, sonné : gris, il titube.
        s.sprite.setVisible(true).setAlpha(0).setTint(0xb8b8c0);
        s.sprite.y = s.baseY + 4 * SCALE;
        this.tweens.add({ targets: s.sprite, alpha: 1, y: s.baseY, duration: 260, ease: 'Back.easeOut' });
        this.tweens.add({
          targets: s.sprite,
          angle: { from: -14, to: 14 },
          duration: 150,
          yoyo: true,
          repeat: 5,
          delay: 260,
          onComplete: () => {
            s.sprite.setAngle(0);
            if (s.tint === undefined) s.sprite.clearTint();
            else s.sprite.setTint(s.tint);
          },
        });
      }
      const head = block[Math.floor(block.length / 2)];
      this.comic(head.sprite.x / SCALE, head.baseY / SCALE - 12, '@#!?', '#ffffff', 34);
    });
    return true;
  }

  /** Easter egg « l'empereur tombe de son trône » : bref contrechamp sur la loge pour qu'on le voie. */
  private emperorFall(): void {
    if (!this.eggs.take('emperorFall')) return;
    this.show.emperorTumble(manifest.staging.easterEggs.emperorFall.line);
    const emperor = this.children.list.find((o): o is Phaser.GameObjects.Image => o instanceof Phaser.GameObjects.Image && (o.texture.key === 'emperor' || o.texture.key === 'art_king'));
    // Cadré un peu sous lui : la bulle « MON TRÔNE ! » au-dessus reste dans l'image.
    if (emperor) this.director.cutaway(() => ({ x: emperor.x, y: emperor.y - 20 }), this.battle.time, 1.3, 1.5);
  }

  /** Ola des gradins (retournement) : la vague parcourt le public de gauche à droite. */
  private crowdWave(): void {
    if (!this.eggs.take('wave')) return;
    const w = this.scale.width;
    for (const s of this.spectators) {
      if (!s.sprite.visible) continue;
      this.tweens.killTweensOf(s.sprite);
      this.tweens.add({ targets: s.sprite, y: s.baseY - 6 * SCALE, duration: 160, yoyo: true, delay: (s.sprite.x / w) * 900, ease: 'Quad.easeOut' });
    }
    sound.play('cheer');
  }

  /** Silhouette visible d'un héros, en px monde (le cadre entier pour une unité sans silhouette mesurée). */
  private bodyRect(i: number): { top: number; bottom: number; left: number; right: number } {
    const s = this.views[i].sprite;
    const b = this.bodies.get(i) ?? { top: 0, bottom: 1, left: 0, right: 1 };
    const fx = s.flipX ? (k: number) => 1 - k : (k: number) => k;
    const l = fx(b.left);
    const r = fx(b.right);
    return {
      top: s.y + (b.top - s.originY) * s.displayHeight,
      bottom: s.y + (b.bottom - s.originY) * s.displayHeight,
      left: s.x + (Math.min(l, r) - s.originX) * s.displayWidth,
      right: s.x + (Math.max(l, r) - s.originX) * s.displayWidth,
    };
  }

  /** Suivi des décors attachés : aura et couronne des mini-boss, accessoire du spectateur, étiquette MVP. */
  private drawStageExtras(): void {
    const pulse = 1 + 0.08 * Math.sin(this.battle.time * 6);
    for (const [i, fx] of this.bossFx) {
      const s = this.views[i].sprite;
      const dead = this.battle.units[i].state === 'dead';
      fx.aura?.setVisible(!dead);
      fx.crown?.setVisible(!dead);
      if (dead) continue;
      // Halo aux pieds et couronne sur le crâne (silhouette visible) ; drawHeroHud remonte nom et barre d'autant.
      const body = this.bodyRect(i);
      fx.aura?.setPosition((body.left + body.right) / 2, body.bottom - 1 * SCALE).setDepth(s.depth - 0.002).setScale(fx.auraScale * pulse);
      fx.crown?.setPosition((body.left + body.right) / 2, body.top + 3 * SCALE).setAngle(s.angle).setDepth(s.depth + 0.002);
    }
    const g = this.gagSpectator;
    if (g && this.gagHat) this.gagHat.img.setPosition(g.sprite.x, g.sprite.y - this.gagHat.dy).setAngle(g.sprite.angle).setVisible(g.sprite.visible);
    if (this.mvpLabel) {
      const { text, index } = this.mvpLabel;
      const body = this.bodyRect(index);
      // Au-dessus du nom et de la barre de vie du héros.
      text.setPosition((body.left + body.right) / 2, body.top - 46);
    }
  }

  /** Le spectateur récurrent finit toujours touché. */
  private finalGag(): void {
    const s = this.gagSpectator;
    if (!s) return;
    this.time.delayedCall(900, () => {
      const from = { x: this.battle.field.x + this.battle.field.width / 2, y: this.battle.field.y + this.battle.field.height * 0.6 };
      const tomato = this.add.circle(from.x * SCALE, from.y * SCALE, 2 * SCALE, 0xe83a2a).setDepth(9000);
      this.tweens.add({
        targets: tomato,
        x: s.sprite.x,
        y: s.baseY - 9 * SCALE,
        duration: 420,
        ease: 'Quad.easeIn',
        onComplete: () => {
          tomato.destroy();
          // Joué en temps réel (après le ralenti) : tirages pris d'un flux propre à la seed.
          const rnd = streamFrom(randAt(1, 99));
          this.hurtSpectator(s, true, rnd);
          this.comic(s.sprite.x / SCALE, s.baseY / SCALE - 14, 'SPLOTCH !', '#e83a2a', 32, rnd);
        },
      });
    });
  }

  // ---------------------------------------------------------------- dessin

  private drawUnits(alpha: number, dt: number): void {
    const units = this.battle.units;
    this.airGfx.clear();
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const v = this.views[i];
      const x = (this.prev[i].x + (u.x - this.prev[i].x) * alpha + v.offX) * SCALE;
      const y = (this.prev[i].y + (u.y - this.prev[i].y) * alpha + v.offY) * SCALE;
      const flight = manifest.staging.flight;
      // Hauteur affichée exagérée : le corps se détache franchement de son ombre.
      const z = Math.max(0, this.prev[i].z + (u.z - this.prev[i].z) * alpha) * flight.heightScale;
      v.sprite.setPosition(Math.round(x), Math.round(y - z * SCALE));
      if (z > 0 || u.z > 0) {
        // Pose de vol tant que la simulation le dit en l'air (pas sur l'image d'atterrissage interpolée, qui couperait le relevé).
        if (u.state !== 'dead' && u.z > 0) this.holdAirPose(v);
        // En l'air : l'ombre reste au sol et rétrécit avec la hauteur, le corps suit son arc.
        const shrink = Math.max(0.3, 1 - z / 200);
        this.airGfx.fillStyle(0x000000, flight.shadow * shrink).fillEllipse(x, y, u.radius * 2.4 * SCALE * shrink, u.radius * 1.1 * SCALE * shrink);
        if (u.state === 'dead' && flight.koSpin) v.sprite.setAngle(v.sprite.angle + v.spin * dt);
        else {
          // Tête dans le sens du vol : penché en montant, à plat au sommet, plongeant en retombant.
          const sx = u.vx;
          const sy = u.vy - u.vz * flight.heightScale;
          const travel = (Math.atan2(sx, -sy) * 180) / Math.PI;
          // Les petits rebonds restent presque droits : l'inclinaison grandit avec la hauteur.
          const target = Phaser.Math.Angle.WrapDegrees(travel * flight.tilt * Math.min(1, z / 25));
          v.sprite.setAngle(v.sprite.angle + Phaser.Math.Angle.ShortestBetween(v.sprite.angle, target) * Math.min(1, dt * 14));
        }
        if (flight.trailMs > 0 && this.time.now >= (v.trailAt ?? 0)) {
          // Pointillés de la trajectoire, qui s'effacent derrière le personnage.
          v.trailAt = this.time.now + flight.trailMs;
          this.particles.push({ x: x / SCALE, y: (y - z * SCALE) / SCALE - 2, vx: 0, vy: 0, life: 0.35, maxLife: 0.35, color: 0xfff4d6, size: 1 });
        }
        const grow = 1 + Math.min(0.35, z / 300);
        v.sprite.setScale(v.baseScale * grow * (2 - v.squash), v.baseScale * grow * v.squash);
        v.sprite.setDepth(9500 + y * 0.001);
        const hud = this.heroHud.get(i);
        if (hud && u.state !== 'dead') this.drawHeroHud(u, v, hud);
        continue;
      }
      this.syncSkin(u, v);
      if (u.state === 'dead') continue;
      v.facing = u.facing;
      v.sprite.setDepth(y * 0.01);
      // Petit sautillement de marche, plus nerveux en fuite.
      const stunned = u.stunTimer > 0;
      const moving = !stunned && Math.hypot(u.vx, u.vy) > 4;
      // Un coup va jusqu'à l'impact, puis cède si l'unité repart (pas de coup de pied qui glisse sur le sol) ;
      // une réaction (coup encaissé, relevé) cède dès que l'unité repart.
      const current = v.sprite.anims.currentAnim?.key ?? '';
      const rank = (v.sprite.anims.currentFrame?.index ?? 1) - 1;
      const striking = /_(attack|kick)/.test(current) && !(moving && rank > (v.strikeHit ?? Infinity));
      const busy = v.sprite.anims.isPlaying && (striking || (/_(hurt|getup)/.test(current) && !moving));
      if (v.dir === undefined) v.sprite.setFlipX(u.facing < 0);
      else if (!busy) {
        // 8 directions : on regarde où l'on va, sinon sa cible, sinon son camp d'en face.
        const t = u.target >= 0 ? units[u.target] : undefined;
        if (this.ending && !moving) v.dir = this.battle.result?.winner === u.team ? 0 : v.dir;
        else if (moving) v.dir = directionOf(u.vx, u.vy);
        else if (t && t.state !== 'dead') v.dir = directionOf(t.x - u.x, t.y - u.y);
        else v.dir = directionOf(u.facing, 0);
      }
      // Sonné au sol : pas de marche sur place (le relevé, s'il joue, va jusqu'au bout).
      if (!busy) this.playGait(u, v, units, stunned);
      const celebrating = this.ending && this.battle.result?.winner === u.team;
      if (v.dir !== undefined) {
        // 8 directions : l'animation fait la marche ; les vainqueurs sautent sur place, sans se déformer.
        v.sprite.setScale(v.baseScale * (2 - v.squash), v.baseScale * v.squash);
        if (celebrating) v.sprite.y -= Math.round(Math.abs(Math.sin(this.time.now / 160 + i * 0.7)) * 3) * SCALE;
      } else {
        const hop = moving || celebrating ? Math.abs(Math.sin(this.time.now / (u.state === 'flee' || celebrating ? 50 : 90) + i)) * (celebrating ? 0.2 : 0.08) : 0;
        v.sprite.setScale(v.baseScale * (2 - v.squash) * (1 - hop * 0.5), v.baseScale * v.squash * (1 + hop));
      }
      // Bonhomme de neige : il fond à mesure qu'il perd des PV.
      if (v.shrinkMin !== undefined && v.shrinkMin < 1) {
        const k = v.shrinkMin + (1 - v.shrinkMin) * Math.max(0, u.hp / u.maxHp);
        v.sprite.setScale(v.sprite.scaleX * k, v.sprite.scaleY * k);
      }
      if (v.whirlUntil > this.time.now) v.sprite.setAngle(((v.whirlUntil - this.time.now) * 1.6) % 360);
      else if (u.charging && v.rollOnCharge) v.sprite.setAngle((this.battle.time * 900 * u.facing) % 360);
      else if (u.gag === 'dance') v.sprite.setAngle(Math.sin(this.time.now / 90) * 22);
      else if (u.stunTimer > 0) v.sprite.setAngle(Math.sin(this.time.now / 40) * 14);
      else if (u.charging) v.sprite.setAngle(u.facing * 12);
      else if (u.state === 'flee') v.sprite.setAngle(Math.sin(this.time.now / 60) * 10);
      else v.sprite.setAngle(0);

      const hud = this.heroHud.get(i);
      if (hud) this.drawHeroHud(u, v, hud);
    }
    for (const [i, list] of this.accessories) {
      const s = this.views[i].sprite;
      const dead = units[i].state === 'dead';
      for (const a of list) {
        a.img.setVisible(!dead);
        if (dead) continue;
        const f = this.views[i].facing >= 0 ? 1 : -1;
        const at = this.accessoryAt(i, a);
        a.img.setPosition(at.x, at.y);
        a.img.setFlipX(f < 0).setAngle(s.angle).setDepth(s.depth + 0.001);
      }
    }
    for (const [i, hud] of this.heroHud) {
      if (units[i].state === 'dead') {
        hud.bar.clear();
        hud.name.setPosition(this.nameX(hud.name, this.views[i].sprite.x), this.views[i].sprite.y - 30);
      }
    }
  }

  /**
   * Transformation (pain d'épices, charbon) : le sprite laisse la place à l'apparence du thème le temps
   * de l'effet, puis revient dans un petit nuage. Uniquement visuel : la simulation dit qui est transformé.
   */
  private syncSkin(u: Unit, v: UnitView): void {
    const on = u.state !== 'dead' && u.transformUntil > this.battle.time;
    if (on) {
      if (!v.skin) {
        const tex = overlayTexture(this, u.transformSkin, SCALE);
        if (!tex) return;
        v.skin = this.add.image(0, 0, tex.key).setScale(tex.scale).setOrigin(0.5, 0.75);
        this.tweens.add({ targets: v.skin, scale: { from: tex.scale * 1.6, to: tex.scale }, duration: 220, ease: 'Back.easeOut' });
      }
      v.sprite.setVisible(false);
      // Petit tremblement de biscuit, en temps de combat (même vidéo à chaque lecture).
      v.skin.setPosition(v.sprite.x, v.sprite.y).setDepth(v.sprite.depth).setAngle(Math.sin(this.battle.time * 18 + u.index) * 8);
      return;
    }
    if (!v.skin) return;
    // Petit nuage au retour à la normale (flux tiré de l'unité et de l'instant : même vidéo à chaque lecture).
    const rnd = streamFrom(randAt(u.index, Math.round(u.transformUntil * 30)));
    for (let k = 0; k < 6; k++) this.particles.push({ x: v.sprite.x / SCALE, y: v.sprite.y / SCALE - 3, vx: (rnd() - 0.5) * 40, vy: (rnd() - 0.5) * 40 - 10, life: 0.5, maxLife: 0.5, color: 0xffffff, size: 2 });
    v.skin.destroy();
    v.skin = undefined;
    v.sprite.setVisible(true);
  }

  /** Position d'un accessoire : ancres relatives à la silhouette visible, elles suivent l'échelle du héros (mini-boss compris). */
  private accessoryAt(i: number, a: Accessory): { x: number; y: number } {
    const f = this.views[i].facing >= 0 ? 1 : -1;
    const body = this.bodyRect(i);
    return { x: (body.left + body.right) / 2 + a.ax * (body.right - body.left) * f, y: (body.top + body.bottom) / 2 + a.ay * (body.bottom - body.top) };
  }

  /** Étiquette de héros bornée à l'écran (entre la jauge gauche et la tribune droite), même en gros plan. */
  private nameX(name: Phaser.GameObjects.Text, x: number): number {
    const cam = this.cameras.main;
    const z = cam.zoom || 1;
    const half = (name.width * name.scaleX) / 2;
    const minX = cam.worldView.x + 70 / z + half;
    const maxX = cam.worldView.x + 1010 / z - half;
    return minX > maxX ? x : Math.min(maxX, Math.max(minX, x));
  }

  private drawHeroHud(u: Unit, v: UnitView, hud: HeroHud): void {
    // Au-dessus du crâne visible, de la couronne du mini-boss et des accessoires portés sur la tête (casserole…).
    const crown = this.bossFx.get(u.index)?.crown;
    let top = this.bodyRect(u.index).top - (crown ? crown.displayHeight - 2 * SCALE : 0);
    for (const a of this.accessories.get(u.index) ?? []) top = Math.min(top, this.accessoryAt(u.index, a).y - a.img.displayHeight * a.img.originY);
    // Plus grande et contourée : lisible sur téléphone même en plan large.
    const bw = 110;
    const bh = 16;
    const bx = Math.round(v.sprite.x - bw / 2);
    const by = Math.round(top - 18);
    hud.name.setPosition(this.nameX(hud.name, v.sprite.x), by - 6);
    const frac = Math.max(0, u.hp / u.maxHp);
    hud.bar.clear();
    hud.bar.fillStyle(0x000000, 1).fillRect(bx - 4, by - 4, bw + 8, bh + 8);
    hud.bar.fillStyle(0x3a2030, 1).fillRect(bx, by, bw, bh);
    hud.bar.fillStyle(frac < 0.3 ? 0xff5050 : TEAM_COLORS[u.team].bar, 1).fillRect(bx, by, Math.round(bw * frac), bh);
    // Graduations : la barre se lit aussi par sa longueur, pas seulement par sa couleur.
    hud.bar.fillStyle(0x000000, 0.6);
    for (let k = 1; k < 4; k++) hud.bar.fillRect(bx + Math.round((bw * k) / 4) - 1, by, 2, bh);
  }

  private drawZone(): void {
    const g = this.zoneGfx;
    g.clear();
    if (this.battle.zoneScale >= 1) return;
    const f = this.battle.field;
    const z = this.battle.zone;
    // Hors zone : voile vert du gaz, sous les bouffées (le blizzard dessine son propre voile, par-dessus les unités).
    g.fillStyle(parseInt(manifest.staging.gas.color.slice(1), 16), manifest.staging.gas.style === 'blizzard' ? 0.12 : 0.2);
    g.fillRect(f.x * SCALE, f.y * SCALE, f.width * SCALE, (z.y - f.y) * SCALE);
    g.fillRect(f.x * SCALE, (z.y + z.height) * SCALE, f.width * SCALE, (f.y + f.height - z.y - z.height) * SCALE);
    g.fillRect(f.x * SCALE, z.y * SCALE, (z.x - f.x) * SCALE, z.height * SCALE);
    g.fillRect((z.x + z.width) * SCALE, z.y * SCALE, (f.x + f.width - z.x - z.width) * SCALE, z.height * SCALE);
    // Bordure en tirets animés.
    const dash = 6;
    const offset = Math.floor(this.time.now / 80) % (dash * 2);
    g.fillStyle(parseInt(manifest.staging.gas.accent.slice(1), 16), 1);
    const edge = (x0: number, y0: number, len: number, horizontal: boolean) => {
      for (let s = -offset; s < len; s += dash * 2) {
        const a = Math.max(0, s);
        const b = Math.min(len, s + dash);
        if (b <= a) continue;
        if (horizontal) g.fillRect((x0 + a) * SCALE, y0 * SCALE - 2, (b - a) * SCALE, 4);
        else g.fillRect(x0 * SCALE - 2, (y0 + a) * SCALE, 4, (b - a) * SCALE);
      }
    };
    edge(z.x, z.y, z.width, true);
    edge(z.x, z.y + z.height, z.width, true);
    edge(z.x, z.y, z.height, false);
    edge(z.x + z.width, z.y, z.height, false);
  }

  private drawEffects(dt: number): void {
    const g = this.fx;
    g.clear();
    this.fxLayer.draw(this.running && !this.paused ? dt * this.timeScale : 0, this.battle.projectiles);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += 160 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      g.fillStyle(p.color, Math.min(1, (p.life / p.maxLife) * 1.5));
      g.fillRect(Math.round(p.x * SCALE), Math.round(p.y * SCALE), p.size * SCALE, p.size * SCALE);
    }
  }

  private cheer(side: 'gnomes' | 'goblins', share: number): void {
    for (const s of this.spectators) {
      if (s.side !== side || rand() > share) continue;
      this.tweens.add({ targets: s.sprite, y: s.baseY - 3 * SCALE, duration: 120, yoyo: true, repeat: 1, delay: rand() * 200 });
      if (s.cheerAnim && s.sprite instanceof Phaser.GameObjects.Sprite && this.anims.exists(s.cheerAnim)) {
        const sprite = s.sprite;
        sprite.play(s.cheerAnim).once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.setFrame(s.restFrame ?? 0));
      }
    }
  }

  private animateCrowd(t: number): void {
    for (const s of this.spectators) {
      if (this.tweens.isTweening(s.sprite)) continue;
      s.sprite.y = s.baseY - Math.round(Math.max(0, Math.sin(t * 3 + s.phase)) * 1) * SCALE;
    }
  }

  /**
   * Une seule barre partagée entre les deux camps, selon les PV restants (la mesure de la victoire aux
   * points). Verticale, sur le bord gauche : gobelins en haut, gnomes en bas, comme sur le terrain.
   * Lissage, secousse et éclat avancent au rythme des ticks (tickVisuals) : rien ne dépend du framerate.
   */
  private drawBalance(): void {
    const g = this.balanceBar;
    const { x, w: bw, top, bottom } = BALANCE;
    const bh = bottom - top;
    // La jonction tremble sur les gros coups (oscillation en temps de combat, pas de tirage).
    const jitter = Math.sin(this.battle.time * 97) * 14 * this.balanceKick;
    const split = Math.round(Phaser.Math.Clamp(top + bh * (1 - this.balanceShown) + jitter, top, bottom));
    g.clear();
    const stripes = this.balanceStripes;
    if (stripes) {
      // Sucre d'orge : le cadre noir passe derrière les rayures (graphics au-dessus : on ne dessine que le contour).
      g.fillStyle(0x000000, 1).fillRect(x - 5, top - 5, bw + 10, 5).fillRect(x - 5, bottom, bw + 10, 5).fillRect(x - 5, top, 5, bh).fillRect(x + bw, top, 5, bh);
      stripes.goblins.setPosition(x, top).setSize(bw, Math.max(1, split - top)).setVisible(split > top);
      stripes.gnomes.setPosition(x, split).setSize(bw, Math.max(1, bottom - split)).setVisible(bottom > split);
      stripes.goblins.tilePositionY = this.balanceScroll;
      stripes.gnomes.tilePositionY = this.balanceScroll + (split - top);
    } else {
      g.fillStyle(0x000000, 1).fillRect(x - 5, top - 5, bw + 10, bh + 10);
      g.fillStyle(TEAM_COLORS.goblins.bar, 1).fillRect(x, top, bw, split - top);
      g.fillStyle(TEAM_COLORS.gnomes.bar, 1).fillRect(x, split, bw, bottom - split);
    }
    // Reflet sur le côté, jonction qui brille sur les gros coups (et flashe quand un héros tombe).
    g.fillStyle(0xffffff, 0.25).fillRect(x, top, 6, bh);
    const glow = 0.6 + 0.4 * this.balanceKick;
    g.fillStyle(0xffffff, glow).fillRect(x - 8, split - 3, bw + 16, 6);
    if (this.balanceFlash > 0) {
      g.fillStyle(0xffffff, this.balanceFlash * 0.7).fillRect(x, top, bw, bh);
      g.fillStyle(0xffe14a, this.balanceFlash).fillRect(x - 12, split - 6, bw + 24, 12);
    }
  }

  /** Particules d'ambiance du biome : feuilles, neige, braises. */
  private ambience(dt: number): void {
    const kind = this.battle.biome.ambient;
    if (kind === 'none' || dt <= 0 || this.particles.length > manifest.staging.juice.maxParticles - 20) return;
    const f = this.battle.field;
    // Appelé à chaque tick (temps de combat) : le tirage ne dépend ni du framerate ni de ?speed.
    const rate = kind === 'snow' ? 14 : kind === 'embers' ? 8 : 4;
    if (rand() > rate * dt) return;
    const colors = kind === 'snow' ? [0xffffff, 0xe8f0ff] : kind === 'embers' ? [0xff6a2a, 0xffb347] : [0x8ac84a, 0xc8a83a, 0x6a9a2a];
    const x = f.x + rand() * f.width;
    const y = kind === 'embers' ? f.y + f.height - rand() * 20 : f.y - 10;
    // Les braises montent, la neige et les feuilles tombent doucement.
    this.particles.push({ x, y, vx: (rand() - 0.5) * 20, vy: kind === 'embers' ? -60 - rand() * 30 : -150, life: 3.5, maxLife: 3.5, color: colors[Math.floor(rand() * colors.length)], size: kind === 'leaves' ? 2 : 1 });
  }

  /** Onomatopée de bande dessinée, posée dans l'arène. */
  private comic(x: number, y: number, text: string, color = '#ffe14a', size = 40, rnd: () => number = rand): void {
    const t = this.add
      .text(x * SCALE, y * SCALE - 20, text, textStyle(size, color, { strokeThickness: 10 }))
      .setOrigin(0.5)
      .setDepth(9850)
      .setAngle(rnd() * 20 - 10)
      .setScale(0.2);
    // Jamais sous le rail des boutons ni hors de l'écran (plan large).
    t.x = Phaser.Math.Clamp(t.x, 60 + t.width / 2, 880 - t.width / 2);
    this.tweens.add({ targets: t, scale: 1.1, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 30, delay: 650, duration: 350, onComplete: () => t.destroy() });
  }

  private updateHud(): void {
    const count = (team: (typeof TEAMS)[number]) => this.battle.units.filter((u) => u.team === team && u.state !== 'dead').length;
    this.hud.left.setText(`${count('gnomes')}`);
    this.hud.right.setText(`${count('goblins')}`);
    const t = Math.floor(this.battle.time);
    this.hud.clock.setText(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}${this.paused ? ' II' : ''}`);
  }
}
