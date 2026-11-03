// Le spectacle autour du combat : l'empereur dans sa loge, les annonces du commentateur, les
// répliques des héros en bulles, les cartons de duel entre rivaux. Uniquement visuel.
import type Phaser from 'phaser';
import type { HeroDef, TeamId } from '../data/schema';
import type { Battle } from '../sim/battle';
import type { BattleEvent, Unit } from '../sim/types';
import type { Staging } from './manifest';
import { DARK_OUTLINE } from './pixels';
import { rand } from './random';
import { TEAM_COLORS, textStyle } from './text';

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

/** Spectateur récurrent : un chapeau haut-de-forme ridicule, reconnaissable d'un épisode à l'autre. */
export function runningGagCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 7;
  canvas.height = 13;
  const ctx = canvas.getContext('2d')!;
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  };
  px(2, 0, 3, 5, '#ffe14a');
  px(2, 3, 3, 1, '#d83b3b');
  px(1, 5, 5, 1, '#ffe14a');
  px(2, 6, 3, 3, '#e8c9a0');
  px(3, 7, 1, 1, DARK_OUTLINE);
  px(1, 9, 5, 4, '#d86ab8');
  return canvas;
}

interface Bubble {
  text: Phaser.GameObjects.Text;
  box: Phaser.GameObjects.Graphics;
  follow: () => { x: number; y: number };
  until: number;
}

export interface ShowHooks {
  banner(text: string, color: string, hold?: number): void;
  toast(text: string): void;
  focus(target: () => { x: number; y: number }): void;
  spriteOf(unit: number): Phaser.GameObjects.Sprite | undefined;
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

  private bubble(text: string, follow: () => { x: number; y: number }, holdMs: number, color = '#141420'): void {
    const t = this.scene.add.text(0, 0, text, textStyle(22, color, { stroke: '#ffffff', strokeThickness: 0, wordWrap: { width: 420 } })).setOrigin(0.5, 1).setDepth(9861);
    const box = this.scene.add.graphics().setDepth(9860);
    const b: Bubble = { text: t, box, follow, until: this.scene.time.now + holdMs };
    this.bubbles.push(b);
    t.setScale(0.3);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 180, ease: 'Back.easeOut' });
  }

  /** L'empereur parle (bulle au-dessus de la loge) et fait un geste. */
  emperorSays(text: string, holdMs = 1800, gesture: 'raise' | 'up' | 'down' | 'none' = 'none'): void {
    const p = this.emperorPos;
    this.bubble(text, () => ({ x: p.x * this.scale, y: (p.y - 16) * this.scale }), holdMs);
    if (gesture === 'raise') this.scene.tweens.add({ targets: this.emperor, y: this.emperor.y - 3 * this.scale, duration: 140, yoyo: true, repeat: 1 });
    if (gesture === 'up' || gesture === 'down') {
      const thumb = this.scene.add.text(p.x * this.scale + 70, (p.y - 8) * this.scale, gesture === 'up' ? '👍' : '👎', { fontSize: '44px' }).setOrigin(0.5).setDepth(9861);
      this.scene.tweens.add({ targets: thumb, scale: { from: 0.2, to: 1.2 }, duration: 220, ease: 'Back.easeOut' });
      this.scene.tweens.add({ targets: thumb, alpha: 0, delay: holdMs, duration: 300, onComplete: () => thumb.destroy() });
    }
  }

  /** Annonce du commentateur : portée par l'empereur, jamais deux à la fois. */
  private announce(text: string, gesture: 'raise' | 'up' | 'down' | 'none' = 'raise'): void {
    const now = this.scene.time.now;
    if (now < this.nextAnnounceAt) return;
    this.nextAnnounceAt = now + this.cfg.announceGapMs;
    this.emperorSays(text, 1600, gesture);
    this.hooks.toast(text);
  }

  private heroLine(u: Unit, kind: 'cry' | 'fear' | 'win', chance = 1): void {
    const def = this.heroes.find((h) => h.id === u.hero?.id);
    const lines = def?.quotes[kind] ?? [];
    const now = this.scene.time.now;
    if (!lines.length || now < this.nextQuoteAt || now < (this.heroQuoteAt.get(u.index) ?? 0) || rand() > chance) return;
    this.nextQuoteAt = now + 1500;
    this.heroQuoteAt.set(u.index, now + 4000);
    const sprite = this.hooks.spriteOf(u.index);
    if (!sprite) return;
    this.bubble(lines[Math.floor(rand() * lines.length)], () => ({ x: sprite.x, y: sprite.y - sprite.displayHeight - 46 }), 1400);
  }

  /** Coup d'envoi : l'empereur lance le combat, deux héros poussent leur cri de guerre. */
  start(): void {
    this.emperorSays(this.cfg.lines.start, 1800, 'raise');
    const heroes = this.battle.units.filter((u) => u.hero);
    for (let i = 0; i < 2 && heroes.length; i++) {
      const u = heroes.splice(Math.floor(rand() * heroes.length), 1)[0];
      this.scene.time.delayedCall(700 + i * 900, () => {
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
    const now = this.scene.time.now;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      if (now > b.until) {
        b.text.destroy();
        b.box.destroy();
        this.bubbles.splice(i, 1);
        continue;
      }
      const p = b.follow();
      b.text.setPosition(p.x, p.y);
      const w = b.text.width * b.text.scaleX + 24;
      const h = b.text.height * b.text.scaleY + 14;
      b.box.clear();
      b.box.fillStyle(0x000000, 1).fillRoundedRect(p.x - w / 2 - 4, p.y - h - 4, w + 8, h + 8, 12);
      b.box.fillStyle(0xffffff, 1).fillRoundedRect(p.x - w / 2, p.y - h, w, h, 10);
      b.box.fillTriangle(p.x - 10, p.y - 2, p.x + 10, p.y - 2, p.x, p.y + 16);
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
    this.scene.time.delayedCall(this.cfg.rouletteCall * 1000, () => {
      this.emperorSays(this.cfg.lines.roulette, 1800, 'raise');
      onRoulette?.();
    });
  }
}
