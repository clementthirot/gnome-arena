// Écran de fin en deux temps, tout dans la zone sûre des réseaux sociaux :
//   0 - 2,5 s  « VICTOIRE DES GNOMES » (ou « MATCH NUL ») et le MVP ;
//   2,5 s - …  la carte de vote seule : héros bénéficiaire, « VOTE 1, 2 OU 3 », 3 cartes à rouleaux ;
//   fin        fondu vers la première image de la vidéo (même fond, même titre) : elle boucle.
// Pas de boutons : rejouer ou changer de seed se fait depuis la régie. En enregistrement, la fin du fondu clôt la vidéo.
import Phaser from 'phaser';
import type { TeamId } from '../../data/schema';
import { openCurtain } from '../curtain';
import { FRAME_INSET, FRAME_SCALE, goldFrame, hasGoldFrame } from '../frame';
import { manifest } from '../manifest';
import { drawOpeningTitle, fill, lastOpeningTitle, OPENING_FRAME } from '../reveal';
import { SAFE } from '../safeZone';
import { accessoryReel, accessoryTexture, fitIcon, revealOption } from '../slotMachine';
import { TEAM_COLORS, textStyle } from '../text';
import type { ArenaParams } from './ArenaScene';

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

const CX = SAFE.centered.x + SAFE.centered.w / 2;

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
  private pattern?: Phaser.GameObjects.TileSprite;

  constructor() {
    super('result');
  }

  update(): void {
    // Motif du fond qui glisse en diagonale, en boucle, calé sur l'horloge comme le rideau de la roulette.
    if (!this.pattern) return;
    const off = ((performance.now() / 1000) * manifest.art.menu.scroll) / this.pattern.tileScaleX;
    this.pattern.setTilePosition(-off, -off);
  }

  create(r: ResultData): void {
    const { width: w, height: h } = this.scale;
    // Match nul : pas de camp perdant pour recevoir l'upgrade, le vote est reporté (pas de carte).
    const vote = r.winner === 'draw' ? undefined : r.params.episode?.vote;
    this.add.rectangle(0, 0, w, h, 0x1c1826).setOrigin(0).setDepth(-20);
    this.pattern = undefined;
    if (this.textures.exists('ui_pattern')) {
      // Motif PixelLab répété, pixels x4 comme l'arène, qui défile en diagonale.
      this.pattern = this.add.tileSprite(0, 0, w, h, 'ui_pattern').setOrigin(0).setTileScale(4).setAlpha(manifest.art.menu.patternAlpha).setDepth(-19);
    } else {
      // Bandes de pixels en fond, pour rester dans la DA.
      for (let y = 0; y < h; y += 36) this.add.rectangle(0, y, w, 32, y % 72 ? 0x241f31 : 0x211c2d).setOrigin(0).setDepth(-19);
    }

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

    if (r.params.record) this.time.delayedCall(hold, () => this.game.events.emit('episode-finished'));
  }

  /** Premier temps : vainqueur (ou match nul) et MVP. */
  private verdict(r: ResultData, postponed: boolean): Phaser.GameObjects.GameObject[] {
    const cfg = manifest.staging.reveal;
    const items: Phaser.GameObjects.GameObject[] = [];
    const ep = r.params.episode;
    if (ep) {
      const label = this.add.text(CX, 300, fill(cfg.episode, { n: ep.number }), textStyle(44, '#d8d0e8')).setOrigin(0.5);
      // Règle de texte du thème : un aplat uni sous les lettres, jamais le motif.
      if (cfg.textBacking) items.push(this.backing(label.x, label.y, label.width + 48, label.height + 24));
      items.push(label);
    }
    const draw = r.winner === 'draw';
    const title = draw ? cfg.draw : fill(cfg.victory, { team: TEAM_COLORS[r.winner as TeamId].label });
    const color = draw ? '#ffffff' : TEAM_COLORS[r.winner as TeamId].main;
    // Le titre tient dans la plaque (bords dorés compris) quand elle est là.
    const plaqueArt = hasGoldFrame(this);
    const big = this.add.text(CX, 525, title, textStyle(draw ? 96 : 80, color, { wordWrap: { width: SAFE.centered.w - (plaqueArt ? 150 : 20) }, lineSpacing: 24, align: 'center' })).setOrigin(0.5).setScale(0.3);
    // Titre long (« VICTOIRE DES GOBELINS ») : on réduit la police jusqu'à tenir sur deux lignes,
    // au-dessus du MVP (et du « vote reporté » en cas de nul).
    const maxH = draw && postponed && ep ? 180 : 300;
    for (let size = draw ? 96 : 80; big.height > maxH && size > 56; ) {
      size -= 4;
      big.setFontSize(size);
    }
    this.tweens.add({ targets: big, scale: 1, duration: 400, ease: 'Back.easeOut' });
    items.push(...this.plaque(525, big.height + 110), big);
    // Égalité d'épisode sans vote : la série continue, le vote est reporté.
    if (draw && postponed && ep) {
      const p = this.add.text(CX, 630, cfg.postponed, textStyle(40, '#ffe14a', { wordWrap: { width: SAFE.centered.w - 40 } })).setOrigin(0.5).setAlpha(0);
      this.tweens.add({ targets: p, alpha: 1, duration: 250, delay: 500 });
      items.push(p);
    }

    // MVP : le héros du camp vainqueur (ou de tous en cas d'égalité) qui a fait le plus de K.O.
    const pool = r.heroes.filter((e) => draw || e.team === r.winner);
    const mvp = [...pool].sort((a, b) => b.kills - a.kills || Number(b.alive) - Number(a.alive) || b.hp - a.hp)[0];
    if (!mvp) return items;
    const def = (r.params.heroes ?? r.params.data.heroes).find((e) => e.name === mvp.name);
    const group: Phaser.GameObjects.GameObject[] = [];
    if (cfg.textBacking) group.push(goldFrame(this, CX, 935, SAFE.centered.w * 0.8, 500)?.setDepth(-1) ?? this.backing(CX, 935, SAFE.centered.w * 0.8, 500));
    group.push(this.add.text(CX, 730, cfg.mvp, textStyle(48, '#ffe14a')).setOrigin(0.5));
    const portrait = def && `unit_${def.visual}`;
    if (portrait && this.textures.exists(portrait)) {
      const img = this.add.image(CX, 880, portrait, 0);
      fitIcon(img, 240);
      group.push(img);
    }
    group.push(this.fitWidth(this.add.text(CX, 1040, mvp.name.toUpperCase(), textStyle(64, TEAM_COLORS[mvp.team].main)).setOrigin(0.5), SAFE.centered.w * 0.8 - 2 * FRAME_INSET.x - 20));
    group.push(this.add.text(CX, 1130, `${mvp.kills} K.O.`, textStyle(48, '#ffffff')).setOrigin(0.5));
    group.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(0));
    this.tweens.add({ targets: group, alpha: 1, duration: 250, delay: this.tweens.stagger(120, { start: 700 }) });
    return [...items, ...group];
  }

  /** Second temps : « Kevin recevra la prochaine upgrade — vote 1, 2 ou 3 en commentaire ». */
  private voteCard(vote: Vote): void {
    const cfg = manifest.staging.reveal;
    const head: Phaser.GameObjects.GameObject[] = [];
    const name = this.add.text(CX, 348, vote.recipient.toUpperCase(), textStyle(64, TEAM_COLORS[vote.team].main)).setOrigin(0.5);
    head.push(name);
    // Portrait du héros bénéficiaire, à gauche de son nom : le groupe portrait + nom est centré.
    const inside = SAFE.centered.w - 2 * FRAME_INSET.x - 40;
    if (this.textures.exists(vote.portrait)) {
      const size = 110;
      const gap = 20;
      // Nom long (« MARCEL L'ENCLUME ») : réduit pour que portrait + nom tiennent dans le cadre.
      this.fitWidth(name, inside - size - gap);
      const left = CX - (size + gap + name.displayWidth) / 2;
      const portrait = this.add.image(left + size / 2, 342, vote.portrait, 0);
      fitIcon(portrait, size);
      name.setX(left + size + gap + name.displayWidth / 2);
      head.push(portrait);
    } else {
      this.fitWidth(name, inside);
    }
    head.push(this.fitWidth(this.add.text(CX, 428, fill(cfg.voteFor, { hero: vote.recipient.toUpperCase() }), textStyle(24, '#ffffff')).setOrigin(0.5), SAFE.centered.w - 2 * FRAME_INSET.x - 40));
    const call = this.add.text(CX, 530, cfg.voteCall, textStyle(42, '#ffe14a', { wordWrap: { width: SAFE.centered.w - 2 * FRAME_INSET.x - 40 }, lineSpacing: 18, align: 'center' })).setOrigin(0.5);
    // Cadeaux : l'appel au vote arrive une fois le dernier cadeau ouvert.
    const gifts = cfg.style === 'gifts';
    if (!gifts) head.push(call);
    // Cadre 250 → 630 : portrait et nom, invitation, appel au vote, même marge en haut et en bas.
    head.push(...this.plaque(440, 380));
    head.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(0));
    this.tweens.add({ targets: head, alpha: 1, duration: 250, delay: this.tweens.stagger(120, { start: 100 }) });
    if (gifts) {
      call.setAlpha(0).setScale(0.4);
      this.tweens.add({ targets: call, alpha: 1, scale: 1, duration: 300, ease: 'Back.easeOut', delay: 600 + (vote.options.length - 1) * 750 + 800 });
    }

    // Trois cartes côte à côte sur la bande centrée, y 650 à 1170 : chiffre, rouleau, libellé,
    // répartis avec la même marge intérieure en haut et en bas.
    const reel = accessoryReel(this);
    const n = vote.options.length;
    const gap = 12;
    const cardW = (SAFE.centered.w - gap * (n - 1)) / n;
    const top = 650;
    const cardH = 520;
    const inner = cardW - 2 * FRAME_INSET.x;
    const labelSize = 26;
    vote.options.forEach((o, i) => {
      const x = SAFE.centered.x + cardW / 2 + i * (cardW + gap);
      const y = top + cardH / 2;
      const card = this.add.container(x, y).setScale(0);
      card.add(goldFrame(this, 0, 0, cardW, cardH) ?? this.add.rectangle(0, 0, cardW, cardH, 0x3d3555).setStrokeStyle(6, 0x000000));
      card.add(this.add.text(0, -150, String(i + 1), textStyle(100, '#ffe14a')).setOrigin(0.5));
      // Retour à la ligne entre les mots seulement (jamais au milieu d'un mot), puis réduit s'il déborde encore.
      const label = this.add.text(0, 150, o.label, textStyle(labelSize, '#ffffff', { lineSpacing: 8, align: 'center' })).setOrigin(0.5);
      if (label.width > inner - 16) label.setText(breakLong(o.label, Math.floor(inner / labelSize)).replace(/ /g, '\n'));
      card.add(this.fitWidth(label, inner - 16));
      const delay = 200 + i * 150;
      this.tweens.add({ targets: card, scale: 1, duration: 320, delay, ease: 'Back.easeOut' });
      const target = accessoryTexture(this, o.visual);
      if (!target) return;
      // Rouleau : les icônes défilent de plus en plus lentement, puis s'arrêtent sur l'option de la carte.
      // Courts et nets : le dernier s'arrête vers 1,4 s, chacun avec un petit coup de tampon.
      // Cadeaux (thème) : ils s'ouvrent l'un après l'autre, chacun sur l'option de sa carte.
      const gifts = cfg.style === 'gifts';
      const r = revealOption(this, { x, y, size: Math.min(176, inner - 10), depth: 1, pool: reel, target, delay: gifts ? 600 + i * 750 : delay + 200, spins: 6 + i * 2, firstStep: 35, stepGrowth: 7, offset: i * 2 });
      r.container.setScale(0);
      this.tweens.add({ targets: r.container, scale: 1, duration: 320, delay, ease: 'Back.easeOut' });
      this.time.delayedCall(r.stopsAt, () => this.tweens.add({ targets: card, scale: { from: 1.08, to: 1 }, duration: 180, ease: 'Back.easeOut' }));
    });
  }

  /** Aplat uni (manifeste staging.reveal.textBacking) centré en (x, y), bord noir : sous un texte posé sur le motif. */
  private backing(x: number, y: number, w: number, h: number): Phaser.GameObjects.Rectangle {
    const color = Number.parseInt((manifest.staging.reveal.textBacking ?? '#000000').slice(1), 16);
    return this.add.rectangle(x, y, w, h, color).setStrokeStyle(6, 0x000000).setDepth(-1);
  }

  /** Réduit un texte trop large pour tenir dans width px. */
  private fitWidth(text: Phaser.GameObjects.Text, width: number): Phaser.GameObjects.Text {
    if (text.width > width) text.setScale(width / text.width);
    return text;
  }

  /** Même cadre doré que les cartes, sur toute la bande centrée, couronne au sommet ; rien sans l'image. */
  private plaque(y: number, height: number): Phaser.GameObjects.GameObject[] {
    const frame = goldFrame(this, CX, y, SAFE.centered.w, height);
    if (!frame) return [];
    const items: Phaser.GameObjects.GameObject[] = [frame.setDepth(-1)];
    if (this.textures.exists('ui_crown')) items.push(this.add.image(CX, y - height / 2 + 6, 'ui_crown').setOrigin(0.5, 1).setScale(FRAME_SCALE * 1.5).setDepth(-0.5));
    items.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(0));
    this.tweens.add({ targets: items, alpha: 1, duration: 250 });
    return items;
  }

  /** Fondu vers la première image (photographiée à l'ouverture, sinon redessinée) : la vidéo boucle. */
  private loopToFirstFrame(): void {
    const { width: w, height: h } = this.scale;
    const items: Phaser.GameObjects.GameObject[] = [];
    if (this.textures.exists(OPENING_FRAME)) {
      items.push(this.add.image(0, 0, OPENING_FRAME).setOrigin(0).setDisplaySize(w, h).setDepth(5000));
    } else {
      // Sans écran d'ouverture (aperçu sans intro), pas de première image à rejoindre : on reste sur la fin
      // plutôt que de finir sur une arène vide.
      const title = lastOpeningTitle(this);
      if (!title) return;
      const bg = this.textures.getTextureKeys().find((k) => k.startsWith('arena_bg_'));
      if (bg) items.push(this.add.image(0, 0, bg).setOrigin(0).setDisplaySize(w, h).setDepth(5000));
      items.push(...drawOpeningTitle(this, title, 5001));
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

}
