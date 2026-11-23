// Le spectacle autour du combat : l'empereur dans sa loge, les annonces du commentateur, les
// répliques des héros en bulles, les cartons de duel entre rivaux. Uniquement visuel.
import type Phaser from 'phaser';
import type { HeroDef, TeamId } from '../data/schema';
import type { Battle } from '../sim/battle';
import type { BattleEvent, Unit } from '../sim/types';
import type { Staging } from './manifest';
import { DARK_OUTLINE } from './pixels';
import { rand, seedTick } from './random';
import { SAFE } from './safeZone';
import { TEAM_COLORS, TEXT, textStyle } from './text';

/** Empereur sur son trône, en pixel art ASCII : o contour, g or, r velours, p toge, s peau, l laurier, w blanc. */
const EMPEROR = [
  '...gggggggg...',
  '..grrrrrrrrg..',
  '..grr.ll.rrg..',
  '..grlsssslrg..',
  '..grsossosrg..',
  '..grsssssrg...',
  '..grrssssrrg..',
  '.ggpppwppppgg.',
  '.gpppwwppppg..',
  '.gppppwppppg..',
  'ggpppppppppgg.',
  'gggpppppppggg.',
  'g.gggggggggg.g',
  'g.g........g.g',
];
const PALETTE: Record<string, string> = { o: DARK_OUTLINE, g: '#e8b830', r: '#a02030', p: '#8a3ad8', s: '#f0c8a0', l: '#3fa84a', w: '#ffffff' };

function emperorCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = EMPEROR[0].length;
  canvas.height = EMPEROR.length;
  const ctx = canvas.getContext('2d')!;
  EMPEROR.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const c = PALETTE[ch];
      if (!c) return;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return canvas;
}

/**
 * Spectateur récurrent : un chapeau haut-de-forme ridicule, reconnaissable d'un épisode à l'autre.
 * `bare` : sans chapeau (il porte alors l'accessoire de l'épisode, voir eggs.ts).
 */
export function runningGagCanvas(bare = false): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 7;
  canvas.height = 13;
  const ctx = canvas.getContext('2d')!;
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  };
  if (!bare) {
    px(2, 0, 3, 5, '#ffe14a');
    px(2, 3, 3, 1, '#d83b3b');
    px(1, 5, 5, 1, '#ffe14a');
  } else px(2, 5, 3, 1, '#7a4a26');
  px(2, 6, 3, 3, '#e8c9a0');
  px(3, 7, 1, 1, DARK_OUTLINE);
  px(1, 9, 5, 4, '#d86ab8');
  return canvas;
}

interface Bubble {
  text: Phaser.GameObjects.Text;
  box: Phaser.GameObjects.Graphics;
  follow: () => { x: number; y: number };
  /** Durée de la bulle (s). */
  hold: number;
  /** Naissance, en s de combat et en ms de scène : le combat est figé pendant l'ouverture, la scène non. */
  bornBattle: number;
  bornScene: number;
  /** Bulle de l'empereur : jamais deux à la fois. */
  emperor: boolean;
  /** Bulle sous son locuteur (pointe vers le haut) : l'empereur est collé à la marge haute. */
  below: boolean;
}

export interface ShowHooks {
  banner(text: string, color: string, hold?: number): void;
  toast(text: string): void;
  focus(target: () => { x: number; y: number }): void;
  spriteOf(unit: number): Phaser.GameObjects.Sprite | undefined;
  /** Exécute fn après `delay` secondes de combat (tick de simulation, pas framerate). */
  later(delay: number, fn: () => void): void;
  /** Retournement de situation (ola des gradins). */
  comeback?(team: TeamId): void;
}

export class Show {
  private readonly emperor: Phaser.GameObjects.Image;
  private readonly emperorPos: { x: number; y: number };
  private bubbles: Bubble[] = [];
  private nextAnnounceAt = 0;
  private nextQuoteAt = 0;
  private heroQuoteAt = new Map<number, number>();
  private recentKills = new Map<number, number[]>();
  private onFire = new Set<number>();
  private duels = new Set<string>();
  private firstBlood = false;
  private leader: TeamId | null = null;
  private trailedBy = 0;
  private nextCheck = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly battle: Battle,
    private readonly scale: number,
    private readonly cfg: Staging['show'],
    private readonly heroes: readonly HeroDef[],
    private readonly hooks: ShowHooks,
  ) {
    if (!scene.textures.exists('emperor')) scene.textures.addCanvas('emperor', emperorCanvas());
    const f = battle.field;
    this.emperorPos = { x: f.x + f.width / 2, y: f.y - 6 };
    this.emperor = scene.add.image(this.emperorPos.x * scale, this.emperorPos.y * scale, 'emperor').setScale(scale).setOrigin(0.5, 1).setDepth(-300);
    // Dais de la loge.
    scene.add.rectangle(this.emperorPos.x * scale, (this.emperorPos.y + 1) * scale, 22 * scale, 3 * scale, 0xa02030).setDepth(-301);
  }

  /** Zone de la loge, que les spectateurs ordinaires laissent libre. */
  static logeContains(field: { x: number; y: number; width: number }, x: number, y: number): boolean {
    const cx = field.x + field.width / 2;
    return Math.abs(x - cx) < 15 && y > field.y - 28 && y < field.y;
  }

  private bubble(text: string, follow: () => { x: number; y: number }, holdMs: number, color = '#141420', below = false, emperor = false): void {
    // Une seule bulle d'empereur : la nouvelle remplace l'ancienne (sinon les textes s'impriment l'un sur l'autre).
    if (emperor) this.dropBubbles((b) => b.emperor);
    const t = this.scene.add.text(0, 0, text, textStyle(TEXT.XS + 2, color, { stroke: '#ffffff', strokeThickness: 0, wordWrap: { width: 460 } })).setOrigin(0.5, below ? 0 : 1).setDepth(9861);
    const box = this.scene.add.graphics().setDepth(9860);
    const b: Bubble = { text: t, box, follow, hold: holdMs / 1000, bornBattle: this.battle.time, bornScene: this.scene.time.now, below, emperor };
    this.bubbles.push(b);
    t.setScale(0.3);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 180, ease: 'Back.easeOut' });
  }

  private dropBubbles(which: (b: Bubble) => boolean): void {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      if (!which(b)) continue;
      b.text.destroy();
      b.box.destroy();
      this.bubbles.splice(i, 1);
    }
  }

  /** Âge d'une bulle (s) : le plus grand du temps de combat et du temps de scène (combat figé avant COMBAT). */
  private age(b: Bubble): number {
    return Math.max(this.battle.time - b.bornBattle, (this.scene.time.now - b.bornScene) / 1000);
  }

  /** L'empereur parle (bulle au-dessus de la loge) et fait un geste. */
  emperorSays(text: string, holdMs = 1800, gesture: 'raise' | 'up' | 'down' | 'none' = 'none'): void {
    const p = this.emperorPos;
    // L'empereur est presque sous la barre du haut des réseaux : sa bulle s'ouvre en dessous de lui.
    this.bubble(text, () => ({ x: p.x * this.scale, y: Math.max((p.y + 4) * this.scale, SAFE.top + 64) }), holdMs, '#141420', true, true);
    if (gesture === 'raise') this.scene.tweens.add({ targets: this.emperor, y: this.emperor.y - 3 * this.scale, duration: 140, yoyo: true, repeat: 1 });
    if (gesture === 'up' || gesture === 'down') {
      const thumb = this.scene.add.text(p.x * this.scale + 70, (p.y - 8) * this.scale, gesture === 'up' ? '👍' : '👎', { fontSize: '44px' }).setOrigin(0.5).setDepth(9861);
      this.scene.tweens.add({ targets: thumb, scale: { from: 0.2, to: 1.2 }, duration: 220, ease: 'Back.easeOut' });
      this.scene.tweens.add({ targets: thumb, alpha: 0, delay: holdMs, duration: 300, onComplete: () => thumb.destroy() });
    }
  }

  /** Annonce du commentateur : portée par l'empereur, jamais deux à la fois. */
  private announce(text: string, gesture: 'raise' | 'up' | 'down' | 'none' = 'raise'): void {
    const now = this.battle.time;
    if (now < this.nextAnnounceAt) return;
    this.nextAnnounceAt = now + this.cfg.announceGapMs / 1000;
    // Le texte passe en bandeau (interface fixe, lisible même en gros plan) ; l'empereur fait le geste.
    this.gesture(gesture);
    this.hooks.toast(text);
  }

  private gesture(gesture: 'raise' | 'up' | 'down' | 'none'): void {
    if (gesture === 'raise' || gesture === 'none') this.scene.tweens.add({ targets: this.emperor, y: this.emperor.y - 3 * this.scale, duration: 140, yoyo: true, repeat: 1 });
    else this.emperorSays(gesture === 'up' ? '!!!' : '...', 900, gesture);
  }

  /** Easter egg : un énorme coup secoue la loge, l'empereur tombe de son trône puis remonte, vexé. */
  emperorTumble(line: string): void {
    const e = this.emperor;
    const x0 = e.x;
    const y0 = e.y;
    this.scene.tweens.killTweensOf(e);
    this.scene.tweens.add({ targets: e, angle: 100, x: x0 + 10 * this.scale, y: y0 + 9 * this.scale, duration: 420, ease: 'Bounce.easeOut' });
    this.scene.tweens.add({ targets: e, angle: 0, x: x0, y: y0, delay: 1900, duration: 380, ease: 'Back.easeOut' });
    this.emperorSays(line, 1800, 'none');
  }

  private heroLine(u: Unit, kind: 'cry' | 'fear' | 'win', chance = 1): void {
    const def = this.heroes.find((h) => h.id === u.hero?.id);
    const lines = def?.quotes[kind] ?? [];
    const now = this.battle.time;
    if (!lines.length || now < this.nextQuoteAt || now < (this.heroQuoteAt.get(u.index) ?? 0) || rand() > chance) return;
    this.nextQuoteAt = now + 1.5;
    this.heroQuoteAt.set(u.index, now + 4);
    const sprite = this.hooks.spriteOf(u.index);
    if (!sprite) return;
    this.bubble(lines[Math.floor(rand() * lines.length)], () => ({ x: sprite.x, y: sprite.y - sprite.displayHeight - 46 }), 1400);
  }

  /** Coup d'envoi : l'empereur lance le combat, deux héros poussent leur cri de guerre. */
  start(): void {
    // Appelé hors d'un tick (fin de l'intro) : on réamorce le flux pour ne dépendre que de la seed.
    seedTick(this.battle.tick);
    this.emperorSays(this.cfg.lines.start, 1800, 'raise');
    const heroes = this.battle.units.filter((u) => u.hero);
    for (let i = 0; i < 2 && heroes.length; i++) {
      const u = heroes.splice(Math.floor(rand() * heroes.length), 1)[0];
      this.hooks.later(0.7 + i * 0.9, () => {
        this.nextQuoteAt = 0;
        this.heroLine(u, 'cry');
      });
    }
  }

  onEvent(e: BattleEvent): void {
    const units = this.battle.units;
    if (e.type === 'death') {
      const victim = units[e.unit];
      const killer = e.killer >= 0 ? units[e.killer] : undefined;
      if (!this.firstBlood) {
        this.firstBlood = true;
        this.announce(this.cfg.lines.firstBlood);
      }
      if (victim.hero) {
        this.announce(this.cfg.lines.heroDown.replace('{hero}', victim.hero.name), 'down');
      }
      if (killer && killer.team !== victim.team) {
        const now = this.battle.time;
        const list = (this.recentKills.get(killer.index) ?? []).filter((t) => now - t < this.cfg.streakWindow);
        list.push(now);
        this.recentKills.set(killer.index, list);
        const name = killer.hero?.name;
        if (list.length === 3) this.announce(name ? this.cfg.lines.tripleHero.replace('{hero}', name) : this.cfg.lines.triple);
        if (killer.hero && killer.kills >= this.cfg.onFireKills && !this.onFire.has(killer.index)) {
          this.onFire.add(killer.index);
          this.announce(this.cfg.lines.onFire.replace('{hero}', killer.hero.name));
        }
        if (killer.hero) this.heroLine(killer, 'win', 0.35);
      }
    } else if (e.type === 'panic') {
      const u = units[e.unit];
      if (u.hero) this.heroLine(u, 'fear');
    } else if (e.type === 'incident' && e.event === 'meteor') {
      this.announce(this.cfg.lines.meteor);
    } else if (e.type === 'gag' && e.kind === 'headClash') {
      this.announce(this.cfg.lines.headClash);
    }
  }

  /** Rivalités et retournements, vérifiés deux fois par seconde. */
  update(): void {
    const cam = this.scene.cameras.main;
    this.dropBubbles((b) => this.age(b) > b.hold);
    for (const b of this.bubbles) {
      const p = b.follow();
      const w = b.text.width * b.text.scaleX + 24;
      const h = b.text.height * b.text.scaleY + 14;
      // Bornée à l'écran (x 60..880, sous la marge haute), quel que soit le zoom de la caméra.
      const z = cam.zoom || 1;
      const view = cam.worldView;
      const minX = view.x + 60 / z + w / 2;
      const maxX = view.x + 880 / z - w / 2;
      const cx = minX > maxX ? (minX + maxX) / 2 : Math.min(maxX, Math.max(minX, p.x));
      const top = view.y + SAFE.top / z;
      const py = b.below ? Math.max(p.y, top - 18) : Math.max(p.y, top + h + 4);
      const tail = Math.max(cx - w / 2 + 16, Math.min(cx + w / 2 - 16, p.x));
      b.text.setPosition(cx, b.below ? py + 18 + 7 : py);
      b.box.clear();
      if (b.below) {
        const y0 = py + 18;
        b.box.fillStyle(0x000000, 1).fillRoundedRect(cx - w / 2 - 4, y0 - 4, w + 8, h + 8, 12);
        b.box.fillStyle(0xffffff, 1).fillRoundedRect(cx - w / 2, y0, w, h, 10);
        b.box.fillTriangle(tail - 10, y0 + 2, tail + 10, y0 + 2, tail, py);
      } else {
        b.box.fillStyle(0x000000, 1).fillRoundedRect(cx - w / 2 - 4, py - h - 4, w + 8, h + 8, 12);
        b.box.fillStyle(0xffffff, 1).fillRoundedRect(cx - w / 2, py - h, w, h, 10);
        b.box.fillTriangle(tail - 10, py - 2, tail + 10, py - 2, tail, py + 16);
      }
    }
    if (this.battle.result || this.battle.time < this.nextCheck) return;
    this.nextCheck = this.battle.time + 0.5;

    const alive = this.battle.units.filter((u) => u.hero && u.state !== 'dead');
    for (const a of alive) {
      const rival = this.heroes.find((h) => h.id === a.hero!.id)?.rival;
      const b = alive.find((u) => u.hero!.id === rival);
      if (!b) continue;
      const key = [a.hero!.id, b.hero!.id].sort().join('-');
      if (this.duels.has(key) || Math.hypot(a.x - b.x, a.y - b.y) > this.cfg.duelDistance) continue;
      this.duels.add(key);
      this.hooks.banner(`DUEL : ${a.hero!.name.toUpperCase()} contre ${b.hero!.name.toUpperCase()}`, '#ffe14a', 1300);
      const sa = this.hooks.spriteOf(a.index);
      const sb = this.hooks.spriteOf(b.index);
      if (sa && sb) this.hooks.focus(() => ({ x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 }));
    }

    // Retournement : le camp qui a été nettement mené repasse devant.
    const sg = this.battle.strength('gnomes');
    const sb = this.battle.strength('goblins');
    const lead: TeamId | null = Math.abs(sg - sb) < 0.04 ? this.leader : sg > sb ? 'gnomes' : 'goblins';
    const gap = Math.abs(sg - sb) / Math.max(sg, sb, 0.01);
    if (lead && this.leader && lead !== this.leader && this.trailedBy > 0.25) {
      this.announce(this.cfg.lines.comeback.replace('{team}', TEAM_COLORS[lead].label));
      this.hooks.comeback?.(lead);
      this.trailedBy = 0;
    }
    if (lead !== this.leader) this.trailedBy = 0;
    this.leader = lead;
    this.trailedBy = Math.max(this.trailedBy, gap);
  }

  /** Fin : pouce levé vers le vainqueur, puis la roulette des upgrades. */
  victory(winner: TeamId | 'draw', onRoulette?: () => void): void {
    if (winner === 'draw') {
      this.emperorSays(this.cfg.lines.draw, 1800, 'down');
      return;
    }
    this.emperorSays(this.cfg.lines.victory.replace('{team}', TEAM_COLORS[winner].label), 1700, 'up');
    this.hooks.later(this.cfg.rouletteCall, () => {
      this.emperorSays(this.cfg.lines.roulette, 1800, 'raise');
      onRoulette?.();
    });
  }
}
