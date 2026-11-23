// Écran de fin en deux temps, tout dans la zone sûre des réseaux sociaux :
//   0 - 2,5 s  « VICTOIRE DES GNOMES » (ou « MATCH NUL ») et le MVP ;
//   2,5 s - …  la carte de vote seule : héros bénéficiaire, « VOTE 1, 2 OU 3 », 3 cartes à rouleaux ;
//   fin        fondu vers la première image de la vidéo (même fond, même titre) : elle boucle.
// En mode enregistrement, pas de boutons : la fin du fondu clôt la vidéo.
import Phaser from 'phaser';
import type { TeamId } from '../../data/schema';
import { openCurtain } from '../curtain';
import { manifest } from '../manifest';
import { drawOpeningTitle, fill, lastOpeningTitle, OPENING_FRAME } from '../reveal';
import { SAFE } from '../safeZone';
import { accessoryReel, accessoryTexture, fitIcon, spinReel } from '../slotMachine';
import { TEAM_COLORS, textStyle } from '../text';
import { nextSeed, type ArenaParams } from './ArenaScene';

export interface ResultData {
  params: ArenaParams;
  winner: TeamId | 'draw';
  reason: 'elimination' | 'timeout';
  duration: number;
  survivors: Record<TeamId, number>;
  heroes: { name: string; label: string; team: TeamId; kills: number; alive: boolean; hp: number }[];
  /** Meilleur raté de l'épisode : héros et nombre d'alliés touchés. */
  friendlyFire?: [number, number];
  friendlyFireName?: string;
  /** Arrivée depuis le rideau de la roulette : il se rouvre sur l'écran. */
  curtain?: boolean;
}

/** Durée d'affichage de l'écran de fin avant la fin d'un enregistrement (ms), avec carte de vote. */
export const RESULT_HOLD_MS = 9000;
/** Sans carte de vote (aperçu, seed simple, match nul) : un seul temps, plus court. */
export const RESULT_HOLD_NO_VOTE_MS = 5000;
/** Fin du premier temps (vainqueur + MVP), début de la carte de vote (ms). */
const VERDICT_MS = 2500;
/** Durée du fondu de boucle vers la première image (ms). */
const LOOP_FADE_MS = 700;

const CX = SAFE.text.x + SAFE.text.w / 2;

/** Coupe après le trait d'union un mot trop long pour la carte (« Lance-poulet » → « Lance- / poulet »). */
function breakLong(label: string, maxChars: number): string {
  return label
    .split(' ')
    .map((word) => (word.length > maxChars && word.includes('-') ? word.replace(/-/g, '-\n') : word))
    .join(' ');
}
/** Hachage entier → [0, 1) : confettis identiques d'une lecture à l'autre. */
function hash01(n: number): number {
  let t = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}
type Vote = NonNullable<NonNullable<ArenaParams['episode']>['vote']>;

export class ResultScene extends Phaser.Scene {
  constructor() {
    super('result');
  }

  create(r: ResultData): void {
    const { width: w, height: h } = this.scale;
    // Match nul : pas de camp perdant pour recevoir l'upgrade, le vote est reporté (pas de carte).
    const vote = r.winner === 'draw' ? undefined : r.params.episode?.vote;
    this.add.rectangle(0, 0, w, h, 0x1c1826).setOrigin(0);
    // Bandes de pixels en fond, pour rester dans la DA.
    for (let y = 0; y < h; y += 36) this.add.rectangle(0, y, w, 32, y % 72 ? 0x241f31 : 0x211c2d).setOrigin(0);

    const verdict = this.verdict(r, !vote);
    if (vote) {
      this.time.delayedCall(VERDICT_MS, () => {
        this.tweens.add({ targets: verdict, alpha: 0, duration: 220, onComplete: () => verdict.forEach((o) => o.destroy()) });
        this.voteCard(vote);
      });
    }
    else this.celebrate(r);
    if (r.curtain) openCurtain(this, 250, 450);
    const hold = vote ? RESULT_HOLD_MS : RESULT_HOLD_NO_VOTE_MS;
    this.time.delayedCall(hold - LOOP_FADE_MS, () => this.loopToFirstFrame());

    if (r.params.record) {
      this.time.delayedCall(hold, () => this.game.events.emit('episode-finished'));
      return;
    }
    // Hors vidéo : commandes, masquées pendant le fondu de boucle puis rendues une fois la boucle bouclée.
    const controls: Phaser.GameObjects.GameObject[] = [];
    controls.push(...this.button(w / 2 - 220, h - 200, 'REJOUER', () => this.scene.start('arena', r.params)));
    // Une autre seed n'est plus l'épisode : on retire son numéro et son vote.
    const next = () => this.scene.start('arena', { ...r.params, seed: nextSeed(r.params.seed), episode: undefined });
    controls.push(...this.button(w / 2 + 220, h - 200, 'SUIVANT', next));
    controls.push(this.add.text(w / 2, h - 90, `seed ${r.params.seed} · R rejouer · N suivante`, textStyle(26, '#a098b0')).setOrigin(0.5).setDepth(6000));
    this.time.delayedCall(hold - LOOP_FADE_MS - 150, () => this.tweens.add({ targets: controls, alpha: 0, duration: 150 }));
    // Après la boucle, la 1re image reste nette un moment (capture d'écran possible) : commandes rendues
    // au bout de 3 s, ou tout de suite au premier clic.
    let shown = false;
    const showControls = () => {
      if (shown) return;
      shown = true;
      this.tweens.add({ targets: controls, alpha: 1, duration: 250 });
    };
    this.time.delayedCall(hold + 3000, showControls);
    this.time.delayedCall(hold, () => this.input.once('pointerdown', showControls));
    this.input.keyboard?.on('keydown-R', () => this.scene.start('arena', r.params));
    this.input.keyboard?.on('keydown-N', next);
  }

  /** Premier temps : vainqueur (ou match nul) et MVP. */
  private verdict(r: ResultData, postponed: boolean): Phaser.GameObjects.GameObject[] {
    const cfg = manifest.staging.reveal;
    const items: Phaser.GameObjects.GameObject[] = [];
    const ep = r.params.episode;
    if (ep) items.push(this.add.text(CX, 300, fill(cfg.episode, { n: ep.number }), textStyle(44, '#d8d0e8')).setOrigin(0.5));
    const draw = r.winner === 'draw';
    const title = draw ? cfg.draw : fill(cfg.victory, { team: TEAM_COLORS[r.winner as TeamId].label });
    const color = draw ? '#ffffff' : TEAM_COLORS[r.winner as TeamId].main;
    const big = this.add.text(CX, 525, title, textStyle(draw ? 96 : 80, color, { wordWrap: { width: SAFE.text.w - 20 }, lineSpacing: 24, align: 'center' })).setOrigin(0.5).setScale(0.3);
    // Titre long (« VICTOIRE DES GOBELINS ») : on réduit la police jusqu'à tenir sur deux lignes,
    // au-dessus du MVP (et du « vote reporté » en cas de nul).
    const maxH = draw && postponed && ep ? 180 : 300;
    for (let size = draw ? 96 : 80; big.height > maxH && size > 56; ) {
      size -= 4;
      big.setFontSize(size);
    }
    this.tweens.add({ targets: big, scale: 1, duration: 400, ease: 'Back.easeOut' });
    items.push(big);
    // Égalité d'épisode sans vote : la série continue, le vote est reporté.
    if (draw && postponed && ep) {
      const p = this.add.text(CX, 630, cfg.postponed, textStyle(40, '#ffe14a', { wordWrap: { width: SAFE.text.w - 40 } })).setOrigin(0.5).setAlpha(0);
      this.tweens.add({ targets: p, alpha: 1, duration: 250, delay: 500 });
      items.push(p);
    }

    // MVP : le héros du camp vainqueur (ou de tous en cas d'égalité) qui a fait le plus de K.O.
    const pool = r.heroes.filter((e) => draw || e.team === r.winner);
    const mvp = [...pool].sort((a, b) => b.kills - a.kills || Number(b.alive) - Number(a.alive) || b.hp - a.hp)[0];
    if (!mvp) return items;
    const def = (r.params.heroes ?? r.params.data.heroes).find((e) => e.name === mvp.name);
    const group: Phaser.GameObjects.GameObject[] = [];
    group.push(this.add.text(CX, 730, cfg.mvp, textStyle(48, '#ffe14a')).setOrigin(0.5));
    const portrait = def && `unit_${def.visual}`;
    if (portrait && this.textures.exists(portrait)) {
      const img = this.add.image(CX, 880, portrait, 0);
      fitIcon(img, 240);
      group.push(img);
    }
    group.push(this.add.text(CX, 1040, mvp.name.toUpperCase(), textStyle(64, TEAM_COLORS[mvp.team].main)).setOrigin(0.5));
    group.push(this.add.text(CX, 1130, `${mvp.kills} K.O.`, textStyle(48, '#ffffff')).setOrigin(0.5));
    group.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(0));
    this.tweens.add({ targets: group, alpha: 1, duration: 250, delay: this.tweens.stagger(120, { start: 700 }) });
    return [...items, ...group];
  }

  /** Second temps : « Kevin recevra la prochaine upgrade — vote 1, 2 ou 3 en commentaire ». */
  private voteCard(vote: Vote): void {
    const cfg = manifest.staging.reveal;
    const head: Phaser.GameObjects.GameObject[] = [];
    const name = this.add.text(CX, 330, vote.recipient.toUpperCase(), textStyle(64, TEAM_COLORS[vote.team].main)).setOrigin(0.5);
    head.push(name);
    // Portrait du héros bénéficiaire, à gauche de son nom.
    if (this.textures.exists(vote.portrait)) {
      const portrait = this.add.image(CX - name.width / 2 - 70, 320, vote.portrait, 0);
      fitIcon(portrait, 120);
      head.push(portrait);
    }
    head.push(this.add.text(CX, 420, fill(cfg.voteFor, { hero: vote.recipient.toUpperCase() }), textStyle(30, '#ffffff', { wordWrap: { width: SAFE.text.w - 40 } })).setOrigin(0.5));
    head.push(this.add.text(CX, 525, cfg.voteCall, textStyle(42, '#ffe14a', { wordWrap: { width: SAFE.text.w - 40 }, lineSpacing: 18 })).setOrigin(0.5));
    head.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(0));
    this.tweens.add({ targets: head, alpha: 1, duration: 250, delay: this.tweens.stagger(120, { start: 100 }) });

    // Trois cartes côte à côte entre x 40 et 940, y 640 et 1225 : chiffre, rouleau, libellé.
    const reel = accessoryReel(this);
    const n = vote.options.length;
    const gap = 12;
    const cardW = (SAFE.text.w - gap * (n - 1)) / n;
    const top = 640;
    const cardH = 585;
    vote.options.forEach((o, i) => {
      const x = SAFE.text.x + cardW / 2 + i * (cardW + gap);
      const y = top + cardH / 2;
      const card = this.add.container(x, y).setScale(0);
      card.add(this.add.rectangle(0, 0, cardW, cardH, 0x3d3555).setStrokeStyle(6, 0x000000));
      card.add(this.add.text(0, -200, String(i + 1), textStyle(120, '#ffe14a')).setOrigin(0.5));
      card.add(this.add.text(0, 215, breakLong(o.label, Math.floor((cardW - 12) / 30)), textStyle(30, '#ffffff', { wordWrap: { width: cardW - 12 }, lineSpacing: 10 })).setOrigin(0.5));
      const delay = 200 + i * 150;
      this.tweens.add({ targets: card, scale: 1, duration: 320, delay, ease: 'Back.easeOut' });
      const target = accessoryTexture(this, o.visual);
      if (!target) return;
      // Rouleau : les icônes défilent de plus en plus lentement, puis s'arrêtent sur l'option de la carte.
      // Courts et nets : le dernier s'arrête vers 1,4 s, chacun avec un petit coup de tampon.
      const r = spinReel(this, { x, y: y + 5, size: Math.min(190, cardW - 70), depth: 1, pool: reel, target, delay: delay + 200, spins: 6 + i * 2, firstStep: 35, stepGrowth: 7, offset: i * 2 });
      r.container.setScale(0);
      this.tweens.add({ targets: r.container, scale: 1, duration: 320, delay, ease: 'Back.easeOut' });
      this.time.delayedCall(r.stopsAt, () => this.tweens.add({ targets: card, scale: { from: 1.08, to: 1 }, duration: 180, ease: 'Back.easeOut' }));
    });
  }

  /** Fondu vers la première image (photographiée à l'ouverture, sinon redessinée) : la vidéo boucle. */
  private loopToFirstFrame(): void {
    const { width: w, height: h } = this.scale;
    const items: Phaser.GameObjects.GameObject[] = [];
    if (this.textures.exists(OPENING_FRAME)) {
      items.push(this.add.image(0, 0, OPENING_FRAME).setOrigin(0).setDisplaySize(w, h).setDepth(5000));
    } else {
      const bg = this.textures.getTextureKeys().find((k) => k.startsWith('arena_bg_'));
      if (bg) items.push(this.add.image(0, 0, bg).setOrigin(0).setDisplaySize(w, h).setDepth(5000));
      const title = lastOpeningTitle(this);
      if (title) items.push(...drawOpeningTitle(this, title, 5001));
    }
    items.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(0));
    // Le voile du titre garde son opacité de remplissage : l'alpha de l'objet ne fait que la moduler.
    this.tweens.add({ targets: items, alpha: 1, duration: LOOP_FADE_MS - 100 });
  }

  /** Fin sans carte de vote : la fin reste vivante (confettis du vainqueur, titre qui respire). */
  private celebrate(r: ResultData): void {
    const draw = r.winner === 'draw';
    const colors = draw ? [0xffffff, 0xa098b0, 0xffe14a] : [Number.parseInt(TEAM_COLORS[r.winner as TeamId].main.slice(1), 16), 0xffe14a, 0xffffff];
    for (let i = 0; i < (draw ? 18 : 48); i++) {
      const x = SAFE.text.x + hash01(i * 5 + 1) * SAFE.text.w;
      const size = 12 + Math.round(hash01(i * 5 + 2) * 10);
      const bit = this.add.rectangle(x, SAFE.top - 40, size, size * 0.6, colors[i % colors.length]).setDepth(10).setAngle(hash01(i * 5 + 3) * 180);
      const fall = 2600 + hash01(i * 5 + 4) * 1600;
      this.tweens.add({ targets: bit, y: 1400, x: x + (hash01(i * 5 + 5) - 0.5) * 160, angle: bit.angle + 540, duration: fall, delay: 300 + hash01(i + 77) * 1800, repeat: -1 });
    }
    // Le gros titre respire un peu (hors mode match nul : on reste sobre).
    if (!draw) {
      const big = this.children.list.find((o) => o instanceof Phaser.GameObjects.Text && o.y === 525) as Phaser.GameObjects.Text | undefined;
      if (big) this.tweens.add({ targets: big, scale: { from: 1, to: 1.06 }, duration: 600, yoyo: true, repeat: -1, delay: 500 });
    }
  }

  private button(x: number, y: number, label: string, onClick: () => void): Phaser.GameObjects.GameObject[] {
    const bg = this.add.rectangle(x, y, 380, 110, 0x3d6cc4).setStrokeStyle(6, 0x000000).setInteractive({ useHandCursor: true }).setDepth(6000);
    const text = this.add.text(x, y, label, textStyle(34)).setOrigin(0.5).setDepth(6001);
    bg.on('pointerover', () => bg.setFillStyle(0x5b8def));
    bg.on('pointerout', () => bg.setFillStyle(0x3d6cc4));
    bg.on('pointerup', onClick);
    return [bg, text];
  }
}
