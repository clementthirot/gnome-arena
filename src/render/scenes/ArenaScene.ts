// Scène de combat : fait avancer le moteur à pas fixe et dessine son état.
// Elle ne modifie jamais les règles : elle lit Battle et réagit à ses événements.
import Phaser from 'phaser';
import type { GameData, HeroDef, TeamId } from '../../data/schema';
import { Battle, opposingTeam, TEAMS } from '../../sim/battle';
import type { BattleEvent, Unit } from '../../sim/types';
import { Bricks, type BrickContext, type Particle, type UnitView } from '../animations';
import { drawArenaBackground } from '../arenaArt';
import { Director } from '../director';
import { FxLayer } from '../fx';
import { GasLayer } from '../gas';
import { asPlaceholder, bricksFor, effectVisual, manifest, resolveAsset } from '../manifest';
import { drawAccessory, drawPlaceholder, drawSpectator } from '../placeholders';
import { TEAM_COLORS, textStyle } from '../text';
import type { ResultData } from './ResultScene';

/** Monde 270 x 480 affiché en 1080 x 1920. */
export const SCALE = 4;
/** Titre « gnomes contre gobelins », puis « COMBAT ! » (ms). La présentation des héros s'insère entre les deux. */
const TITLE_MS = 1700;
const GO_MS = 900;
const MAX_STEPS_PER_FRAME = 12;
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
    vote?: { recipient: string; team: TeamId; options: { label: string; visual: string }[] };
  };
  /** Enregistrement : pas d'interaction, la fin de l'écran de vote clôt la vidéo. */
  record?: boolean;
}

interface Accessory {
  img: Phaser.GameObjects.Image;
  ax: number;
  ay: number;
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
}

export class ArenaScene extends Phaser.Scene {
  private params!: ArenaParams;
  private battle!: Battle;
  private views: UnitView[] = [];
  private heroHud = new Map<number, HeroHud>();
  private accessories = new Map<number, Accessory[]>();
  private fxLayer!: FxLayer;
  private prev: { x: number; y: number; z: number }[] = [];
  /** Ombres des unités en l'air. */
  private airGfx!: Phaser.GameObjects.Graphics;
  private gas!: GasLayer;
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

  constructor() {
    super('arena');
  }

  init(params: ArenaParams): void {
    this.params = params;
    this.views = [];
    this.heroHud.clear();
    this.accessories.clear();
    this.particles = [];
    this.spectators = [];
    this.accumulator = 0;
    this.running = false;
    this.paused = false;
    this.ending = false;
    this.timeScale = params.speed;
    this.routed = new WeakSet();
    this.lastStandCheck = 0;
  }

  create(): void {
    const { data, seed } = this.params;
    this.battle = new Battle(data, { seed, upgrades: this.params.upgrades, heroes: this.params.heroes });
    const { width, height } = data.battle.arena;
    const field = this.battle.field;

    const bgKey = 'arena_bg';
    if (!this.textures.exists(bgKey)) this.textures.addCanvas(bgKey, drawArenaBackground(width, height, field));
    this.add.image(0, 0, bgKey).setOrigin(0).setScale(SCALE).setDepth(-1000);
    this.createCrowd();

    this.zoneGfx = this.add.graphics().setDepth(-500);
    const groundFx = this.add.graphics().setDepth(-450);
    this.airGfx = this.add.graphics().setDepth(-440);
    this.gas = new GasLayer(this.add.graphics().setDepth(8500), this.add.graphics().setDepth(-430), field, manifest.staging.gas, SCALE);
    for (const u of this.battle.units) this.createUnitView(u);
    this.prev = this.battle.units.map((u) => ({ x: u.x, y: u.y, z: u.z }));
    this.fx = this.add.graphics().setDepth(9000);
    this.fxLayer = new FxLayer(this.fx, groundFx, this.particles, SCALE, field.y);
    this.createHud();
    // Deux caméras : le jeu (qui peut zoomer sur un héros) et l'interface (fixe).
    const w = width * SCALE;
    const h = height * SCALE;
    this.uiCam = this.cameras.add(0, 0, w, h);
    this.director = new Director(this.cameras.main, manifest.staging.camera, w, h);
    this.bindInput();
    this.playIntro();
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
    if (this.anims.exists(`${key}_idle`)) sprite.play(`${key}_idle`);
    const baseScale = entry.type === 'placeholder' ? SCALE : (entry.size * SCALE) / entry.frameHeight;
    sprite.setScale(baseScale).setOrigin(0.5, 0.75);
    sprite.setFlipX(u.facing < 0);
    this.views.push({ sprite, bricks: bricksFor(entry), baseScale, offX: 0, offY: 0, squash: 1, facing: u.facing, spin: 0, airDeath: false, whirlUntil: 0 });

    if (u.hero) {
      const team = TEAM_COLORS[u.team];
      const name = this.add.text(0, 0, u.hero.name, textStyle(26, team.main)).setOrigin(0.5, 1).setDepth(9800);
      const bar = this.add.graphics().setDepth(9800);
      this.heroHud.set(u.index, { name, bar });
    }
    if (u.equipment.length) this.accessories.set(u.index, u.equipment.map((eq) => this.createAccessory(eq.visual)).filter((a): a is Accessory => !!a));
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
    const place = (x: number, y: number, side: 'gnomes' | 'goblins') => {
      const pal = palettes[side];
      const key = `spect_${side}_${k % 9}`;
      if (!this.textures.exists(key)) {
        this.textures.addCanvas(key, drawSpectator(pal.body[k % 3], pal.hat[Math.floor(k / 3) % 3]));
      }
      k++;
      const sprite = this.add.image(x * SCALE, y * SCALE, key).setScale(SCALE).setOrigin(0.5, 1).setDepth(-900 + y);
      this.spectators.push({ sprite, baseY: y * SCALE, phase: Math.random() * Math.PI * 2, side });
    };
    // Gobelins en haut (derrière leur armée), gnomes en bas, mélange sur les côtés.
    for (let row = 0; row < 3; row++) {
      for (let x = 8 + (row % 2) * 4; x < width - 4; x += 8 + Math.floor(Math.random() * 3)) {
        place(x, field.y - 8 - row * 9, 'goblins');
        place(x, field.y + field.height + 14 + row * 9, 'gnomes');
      }
    }
    for (let y = field.y + 8; y < field.y + field.height; y += 10) {
      const side = y < field.y + field.height / 2 ? 'goblins' : 'gnomes';
      place(7, y, side);
      place(width - 7, y, side);
    }
  }

  private createHud(): void {
    const w = this.scale.width;
    this.add.rectangle(0, 0, w, 96, 0x000000, 0.45).setOrigin(0).setDepth(9900);
    this.hud = {
      left: this.add.text(24, 48, '', textStyle(30, TEAM_COLORS.gnomes.main)).setOrigin(0, 0.5).setDepth(9901),
      right: this.add.text(w - 24, 48, '', textStyle(30, TEAM_COLORS.goblins.main)).setOrigin(1, 0.5).setDepth(9901),
      clock: this.add.text(w / 2, 48, '0:00', textStyle(30)).setOrigin(0.5).setDepth(9901),
    };
    this.add
      .text(w / 2, this.scale.height - 20, `seed ${this.params.seed}`, textStyle(18, '#d8d0e8'))
      .setOrigin(0.5, 1)
      .setDepth(9901)
      .setAlpha(0.8);
  }

  private bindInput(): void {
    const kb = this.input.keyboard;
    // Pendant un enregistrement, aucune touche ne doit dérégler la vidéo.
    if (this.params.record) return;
    kb?.on('keydown-SPACE', () => (this.paused = !this.paused));
    kb?.on('keydown-R', () => this.restart(this.params.seed));
    kb?.on('keydown-N', () => this.scene.restart({ ...this.params, seed: nextSeed(this.params.seed), episode: undefined }));
    kb?.on('keydown-ONE', () => (this.timeScale = 1));
    kb?.on('keydown-TWO', () => (this.timeScale = 2));
    kb?.on('keydown-FOUR', () => (this.timeScale = 4));
    kb?.on('keydown-EIGHT', () => (this.timeScale = 8));
  }

  private restart(seed: string): void {
    this.scene.restart({ ...this.params, seed });
  }

  // ---------------------------------------------------------------- cartons

  private playIntro(): void {
    const { width: w, height: h } = this.scale;
    const veil = this.add.rectangle(0, 0, w, h, 0x000000, 0.55).setOrigin(0).setDepth(9950);
    const gnomes = this.add.text(w / 2, h * 0.4, 'GNOMES', textStyle(84, TEAM_COLORS.gnomes.main)).setOrigin(0.5).setDepth(9951);
    const vs = this.add.text(w / 2, h * 0.47, 'contre', textStyle(40)).setOrigin(0.5).setDepth(9951);
    const goblins = this.add.text(w / 2, h * 0.54, 'GOBELINS', textStyle(84, TEAM_COLORS.goblins.main)).setOrigin(0.5).setDepth(9951);
    const title = [gnomes, vs, goblins];
    if (this.params.episode) {
      title.push(this.add.text(w / 2, h * 0.3, `ÉPISODE ${this.params.episode.number}`, textStyle(44, '#ffe14a')).setOrigin(0.5).setDepth(9951));
    }
    gnomes.x = -w;
    goblins.x = w * 2;
    vs.setScale(0);
    this.tweens.add({ targets: gnomes, x: w / 2, duration: 450, ease: 'Back.easeOut' });
    this.tweens.add({ targets: goblins, x: w / 2, duration: 450, delay: 150, ease: 'Back.easeOut' });
    this.tweens.add({ targets: vs, scale: 1, duration: 300, delay: 500, ease: 'Back.easeOut' });

    const heroesMs = this.battle.units.some((u) => u.hero) && manifest.staging.heroIntro.enabled ? manifest.staging.heroIntro.duration * 1000 : 0;
    const goAt = TITLE_MS + heroesMs;
    if (heroesMs) {
      this.time.delayedCall(TITLE_MS, () => {
        this.tweens.add({ targets: title, alpha: 0, duration: 200 });
        this.heroRoster(heroesMs, veil);
      });
    }
    this.time.delayedCall(goAt, () => {
      this.tweens.add({ targets: title, alpha: 0, duration: 200 });
      const go = this.add.text(w / 2, h / 2, 'COMBAT !', textStyle(110, '#ffe14a')).setOrigin(0.5).setDepth(9951).setScale(2.5).setAlpha(0);
      this.tweens.add({ targets: go, scale: 1, alpha: 1, duration: 260, ease: 'Quad.easeOut' });
      this.tweens.add({ targets: [go, veil], alpha: 0, delay: 650, duration: 250, onComplete: () => go.destroy() });
    });
    this.time.delayedCall(goAt + GO_MS, () => {
      title.forEach((t) => t.destroy());
      veil.destroy();
      this.running = true;
    });
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
        const gear = u.equipment.map((e) => e.short).join(' + ');
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
    const t = this.add.text(w / 2, h * 0.5, text, textStyle(52, color, { wordWrap: { width: w * 0.9 } })).setOrigin(0.5).setDepth(9960);
    this.currentBanner = t;
    t.setScale(0.4).setAlpha(0);
    this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: hold, duration: 300, onComplete: () => t.destroy() });
  }

  /** Annonce discrète en haut de l'écran (incidents d'arène). */
  private toast(text: string): void {
    const t = this.add.text(this.scale.width / 2, 150, text, textStyle(36, '#ffb347')).setOrigin(0.5).setDepth(9955).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: 170, duration: 180 });
    this.tweens.add({ targets: t, alpha: 0, delay: 1400, duration: 300, onComplete: () => t.destroy() });
  }

  /** Petit texte qui jaillit au-dessus d'une unité (attaque spéciale, raté). */
  private popup(u: Unit, text: string, color: string, size: number): void {
    const v = this.views[u.index];
    const t = this.add.text(v.sprite.x, v.sprite.y - v.sprite.displayHeight - 40, text, textStyle(size, color)).setOrigin(0.5, 1).setDepth(9850);
    this.tweens.add({ targets: t, y: t.y - 40, alpha: 0, delay: 350, duration: 650, onComplete: () => t.destroy() });
  }

  // ---------------------------------------------------------------- boucle

  update(_time: number, delta: number): void {
    const dtMs = this.battle.dt * 1000;
    if (this.running && !this.paused) {
      this.accumulator += Math.min(delta, 100) * this.timeScale;
      let steps = 0;
      while (this.accumulator >= dtMs && steps < MAX_STEPS_PER_FRAME && !this.battle.result) {
        for (let i = 0; i < this.battle.units.length; i++) {
          this.prev[i].x = this.battle.units[i].x;
          this.prev[i].y = this.battle.units[i].y;
          this.prev[i].z = this.battle.units[i].z;
        }
        this.battle.step();
        this.handleEvents(this.battle.events);
        this.accumulator -= dtMs;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }
    const alpha = this.battle.result ? 1 : Math.min(1, this.accumulator / dtMs);
    this.drawUnits(alpha, this.running && !this.paused ? (Math.min(delta, 100) / 1000) * this.timeScale : 0);
    this.drawZone();
    this.gas.update(this.running && !this.paused ? (Math.min(delta, 100) / 1000) * this.timeScale : 0, this.battle.zone, this.battle.zoneScale);
    this.drawEffects(delta / 1000);
    this.animateCrowd(this.time.now / 1000);
    this.updateHud();
    this.watchLastStand();
    this.director.update(this.battle.time);
    this.routeCameras();
  }

  /** Un héros seul contre au moins trois ennemis : la caméra ne le lâche plus. */
  private watchLastStand(): void {
    if (this.battle.result || this.battle.time < this.lastStandCheck) return;
    this.lastStandCheck = this.battle.time + 1;
    for (const team of TEAMS) {
      const mine = this.battle.alive(team);
      if (mine.length === 1 && mine[0].hero && this.battle.alive(opposingTeam(team)).length >= 3) {
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
      // Une unité inconnue du rendu (événement arrivé trop tôt) est ignorée plutôt que de planter.
      if ('unit' in e && e.type !== 'spawn' && !this.views[e.unit]) continue;
      switch (e.type) {
        case 'attack': {
          const u = units[e.unit];
          const t = units[e.target];
          const d = Math.hypot(t.x - u.x, t.y - u.y) || 1;
          this.playOnce(this.views[e.unit], 'attack');
          if (e.kind === 'melee') Bricks.attack(ctx, this.views[e.unit], (t.x - u.x) / d, (t.y - u.y) / d);
          else Bricks.shoot(ctx, this.views[e.unit], (t.x - u.x) / d, (t.y - u.y) / d);
          break;
        }
        case 'hit': {
          const u = units[e.unit];
          Bricks.hurt(ctx, this.views[e.unit], u.x, u.y - u.radius, e.knockback > 100);
          break;
        }
        case 'impact':
          Bricks.impact(ctx, this.views[e.unit], e.x, e.y);
          if (units[e.unit].hero) {
            const s = this.views[e.unit].sprite;
            this.director.request('heroCharge', () => s, this.battle.time);
          }
          break;
        case 'miss':
          this.strayShot(e.x, e.y, units[e.source]);
          break;
        case 'panic':
          Bricks.panic(ctx, this.views[e.unit]);
          break;
        case 'death': {
          const u = units[e.unit];
          const view = this.views[e.unit];
          view.sprite.setDepth(-400 + u.y * 0.01);
          view.sprite.anims.stop();
          this.playOnce(view, 'death');
          Bricks.death(ctx, view, u.x, u.y, !!u.hero, u.z > 0);
          if (u.z <= 0) this.bloodPuddle(u, u.x, u.y);
          this.cheer(opposingTeam(u.team), u.hero ? 1 : 0.15);
          if (u.hero) {
            const victim = view.sprite;
            const killer = e.killer >= 0 ? units[e.killer] : undefined;
            if (killer?.hero) {
              // Duel de héros : on cadre les deux.
              const k = this.views[killer.index].sprite;
              this.director.request('heroDuel', () => ({ x: (k.x + victim.x) / 2, y: (k.y + victim.y) / 2 }), this.battle.time);
            } else this.director.request('heroDeath', () => victim, this.battle.time);
            const hud = this.heroHud.get(e.unit);
            hud?.name.setAlpha(0.6);
            this.banner(`${u.hero.name} est K.O. !`, TEAM_COLORS[u.team].main, 1200);
          }
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
          // Vrille en vol : plus rapide pour un K.O.
          this.views[e.unit].spin = (Math.random() < 0.5 ? -1 : 1) * (units[e.unit].state === 'dead' ? 900 : 480);
          break;
        case 'land': {
          const splash = manifest.staging.koSplash;
          // Onomatopée réservée aux vraies grosses chutes, et pas plus d'une à la fois.
          const loud = e.dead && e.impact >= splash.minImpact && this.time.now >= this.nextSplashAt;
          if (loud) this.nextSplashAt = this.time.now + splash.gapMs;
          const word = loud ? { text: splash.words[Math.floor(Math.random() * splash.words.length)], color: splash.color } : undefined;
          Bricks.land(ctx, this.views[e.unit], e.x, e.y, e.impact, word);
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
          const eq = u.equipment.find((x) => x.id === e.equipment);
          if (e.misfire) {
            this.popup(u, 'OUPS !', '#ff8080', 32);
            const s = this.views[e.unit].sprite;
            this.director.request('misfire', () => s, this.battle.time);
          }
          else if (eq) this.popup(u, eq.short.toUpperCase() + ' !', '#ffe14a', 24);
          break;
        }
        case 'effect':
          this.fxLayer.effect(e.visual, e.x, e.y, e.radius);
          if (e.source >= 0 && effectVisual(e.visual).spinSource) this.views[e.source].whirlUntil = this.time.now + effectVisual(e.visual).duration * 1000;
          this.hitStands(e.x, e.y, e.radius + 6);
          if (e.radius >= manifest.staging.camera.bigImpactRadius) {
            this.cameras.main.shake(320, 0.014);
            this.cameras.main.flash(140, 255, 236, 200);
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
    const key = `${view.sprite.texture.key}_${name}`;
    if (this.anims.exists(key)) view.sprite.play(key);
  }

  /** Une flèche ratée près du bord file dans les gradins : un spectateur la prend. Purement visuel. */
  private strayShot(x: number, y: number, shooter: Unit | undefined): void {
    const cfg = manifest.staging.strayShots;
    const f = this.battle.field;
    const edge = Math.min(x - f.x, f.x + f.width - x, y - f.y, f.y + f.height - y);
    if (!shooter || edge > cfg.edgeDistance || Math.random() > cfg.chance) return;
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
    if (!best || bestScore > 40) return;
    const target = best;
    const arrow = this.add.rectangle(x * SCALE, y * SCALE, 5 * SCALE, SCALE, 0xf4f0e0).setRotation(Math.atan2(dy, dx)).setDepth(9000);
    this.tweens.add({
      targets: arrow,
      x: target.sprite.x,
      y: target.baseY - 3 * SCALE,
      duration: 220,
      onComplete: () => {
        arrow.destroy();
        this.hurtSpectator(target, true);
      },
    });
  }

  /** Un spectateur prend un coup : il rougit, sursaute, et râle parfois. */
  private hurtSpectator(s: Spectator, shout: boolean): void {
    if (!s.sprite.visible) return;
    s.sprite.setTint(0xff6060);
    this.time.delayedCall(250, () => s.sprite.clearTint());
    this.tweens.add({ targets: s.sprite, y: s.baseY - 5 * SCALE, duration: 110, yoyo: true });
    if (!shout) return;
    const ouch = this.add.text(s.sprite.x, s.baseY - 9 * SCALE, 'AÏE !', textStyle(22, '#ffffff')).setOrigin(0.5, 1).setDepth(9850);
    this.tweens.add({ targets: ouch, y: ouch.y - 30, alpha: 0, delay: 300, duration: 500, onComplete: () => ouch.destroy() });
  }

  /** Explosions et rayons qui débordent sur les gradins : les spectateurs à portée trinquent. */
  private hitStands(x: number, y: number, radius: number): void {
    const f = this.battle.field;
    const edge = Math.min(x - f.x, f.x + f.width - x, y - f.y, f.y + f.height - y);
    if (edge > radius) return;
    let shouted = false;
    for (const s of this.spectators) {
      if (Math.hypot(s.sprite.x / SCALE - x, s.baseY / SCALE - 3 - y) > radius + 4) continue;
      this.hurtSpectator(s, !shouted);
      shouted = true;
    }
  }

  /** Flaque de sang qui s'étale sous le corps. */
  private bloodPuddle(u: Unit, x: number, y: number): void {
    const gore = manifest.staging.gore;
    if (!gore.enabled) return;
    const r = u.radius * gore.puddle * (0.8 + Math.random() * 0.4);
    const color = parseInt(gore.color.slice(1), 16);
    const dark = parseInt(gore.dark.slice(1), 16);
    const pool = this.add.ellipse(x * SCALE, (y + 1) * SCALE, r * 2 * SCALE, r * 1.1 * SCALE, dark, 0.7).setDepth(-420).setScale(0.1);
    const core = this.add.ellipse(x * SCALE, (y + 1) * SCALE, r * 1.2 * SCALE, r * 0.6 * SCALE, color, 0.75).setDepth(-419).setScale(0.1);
    this.tweens.add({ targets: [pool, core], scale: 1, duration: 900, ease: 'Quad.easeOut' });
    // Quelques éclaboussures autour.
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = r * (1.1 + Math.random() * 0.5);
      this.add.ellipse((x + Math.cos(a) * d) * SCALE, (y + 1 + Math.sin(a) * d * 0.55) * SCALE, 1.2 * SCALE, 0.8 * SCALE, color, 0.75).setDepth(-419);
    }
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
    const label = r.winner === 'draw' ? 'ÉGALITÉ !' : `VICTOIRE DES ${TEAM_COLORS[r.winner].label} !`;
    this.cheer(r.winner === 'draw' ? 'gnomes' : r.winner, 1);
    this.banner(label, r.winner === 'draw' ? '#ffffff' : TEAM_COLORS[r.winner].main, 1700);
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
    this.time.delayedCall(2300, () => this.scene.start('result', result));
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
      const z = Math.max(0, this.prev[i].z + (u.z - this.prev[i].z) * alpha);
      v.sprite.setPosition(Math.round(x), Math.round(y - z * SCALE));
      if (z > 0 || u.z > 0) {
        // En l'air : ombre au sol qui rétrécit avec la hauteur, vrille, légère mise à l'échelle.
        const shrink = Math.max(0.3, 1 - z / 160);
        this.airGfx.fillStyle(0x000000, 0.35 * shrink).fillEllipse(x, y, u.radius * 2.4 * SCALE * shrink, u.radius * 1.1 * SCALE * shrink);
        v.sprite.setAngle(v.sprite.angle + v.spin * dt);
        const grow = 1 + Math.min(0.35, z / 300);
        v.sprite.setScale(v.baseScale * grow);
        v.sprite.setDepth(9500 + y * 0.001);
        const hud = this.heroHud.get(i);
        if (hud && u.state !== 'dead') this.drawHeroHud(u, v, hud);
        continue;
      }
      if (u.state === 'dead') continue;
      v.facing = u.facing;
      v.sprite.setFlipX(u.facing < 0);
      v.sprite.setDepth(y * 0.01);
      // Petit sautillement de marche, plus nerveux en fuite.
      const moving = Math.hypot(u.vx, u.vy) > 4;
      const anim = `${v.sprite.texture.key}_${moving ? 'walk' : 'idle'}`;
      const busy = v.sprite.anims.isPlaying && v.sprite.anims.currentAnim?.key.endsWith('_attack');
      if (!busy && v.sprite.anims.currentAnim?.key !== anim && this.anims.exists(anim)) v.sprite.play(anim);
      const hop = moving ? Math.abs(Math.sin(this.time.now / (u.state === 'flee' ? 50 : 90) + i)) * 0.08 : 0;
      v.sprite.setScale(v.baseScale * (2 - v.squash) * (1 - hop * 0.5), v.baseScale * v.squash * (1 + hop));
      if (v.whirlUntil > this.time.now) v.sprite.setAngle(((v.whirlUntil - this.time.now) * 1.6) % 360);
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
        a.img.setPosition(s.x + a.ax * s.displayWidth * f, s.y - s.displayHeight * 0.25 + a.ay * s.displayHeight);
        a.img.setFlipX(f < 0).setAngle(s.angle).setDepth(s.depth + 0.001);
      }
    }
    for (const [i, hud] of this.heroHud) {
      if (units[i].state === 'dead') {
        hud.bar.clear();
        hud.name.setPosition(this.views[i].sprite.x, this.views[i].sprite.y - 30);
      }
    }
  }

  private drawHeroHud(u: Unit, v: UnitView, hud: HeroHud): void {
    const top = v.sprite.y - v.sprite.displayHeight * 0.8;
    const bw = 84;
    const bh = 12;
    const bx = Math.round(v.sprite.x - bw / 2);
    const by = Math.round(top - 18);
    hud.name.setPosition(v.sprite.x, by - 6);
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
    // Hors zone : voile vert du gaz, sous les bouffées.
    g.fillStyle(parseInt(manifest.staging.gas.color.slice(1), 16), 0.2);
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
      if (s.side !== side || Math.random() > share) continue;
      this.tweens.add({ targets: s.sprite, y: s.baseY - 3 * SCALE, duration: 120, yoyo: true, repeat: 1, delay: Math.random() * 200 });
    }
  }

  private animateCrowd(t: number): void {
    for (const s of this.spectators) {
      if (this.tweens.isTweening(s.sprite)) continue;
      s.sprite.y = s.baseY - Math.round(Math.max(0, Math.sin(t * 3 + s.phase)) * 1) * SCALE;
    }
  }

  private updateHud(): void {
    const count = (team: (typeof TEAMS)[number]) => this.battle.units.filter((u) => u.team === team && u.state !== 'dead').length;
    this.hud.left.setText(`GNOMES ${count('gnomes')}`);
    this.hud.right.setText(`${count('goblins')} GOBELINS`);
    const t = Math.floor(this.battle.time);
    this.hud.clock.setText(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}${this.paused ? ' II' : ''}`);
  }
}

export function nextSeed(seed: string): string {
  const n = Number(seed);
  return Number.isFinite(n) ? String(n + 1) : `${seed}-2`;
}
