// Fin de vidéo en 4 temps : (1) victoire et célébration dans l'arène (ArenaScene), puis le rideau se ferme
// (« LE MEILLEUR ET LE PIRE... ») et se rouvre sur cet écran, tout dans la zone sûre des réseaux sociaux :
//   0 - 4 s      (2) le MVP à gauche qui fête, le pire à droite qui boude, côte à côte ;
//   4 - 5,5 s    (3) titre de la partie vote (« LES CADEAUX DU PUBLIC ») ;
//   5,5 s - …    la carte de vote : le pire reçoit le prochain cadeau, options dévoilées une à une, appel au vote, temps de lecture ;
//   fin          (4) un rideau nu se ferme puis se rouvre sur la première image de la vidéo : elle boucle.
// Pas de boutons : rejouer ou changer de seed se fait depuis la régie. En enregistrement, la fin du fondu clôt la vidéo.
import Phaser from 'phaser';
import type { TeamId } from '../../data/schema';
import { closeCurtain, openCurtain } from '../curtain';
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
  /** MVP désigné dans l'arène (plan du vainqueur), repris tel quel sur l'écran de fin. */
  mvpName?: string;
  /** Arrivée depuis le rideau de la roulette : il se rouvre sur l'écran. */
  curtain?: boolean;
}

/** Fin du premier temps (vainqueur + MVP), début du titre de la partie vote (ms). */
const VERDICT_MS = 4000;
/** Titre de la partie vote seul à l'écran (ms). */
const GIFTS_TITLE_MS = 1500;
/** Carte de vote : dévoilement des options (≈ 3 s) puis temps pour lire les upgrades (ms). */
const VOTE_MS = 7500;
/** Rideau de boucle : fermeture, pause fermée, réouverture sur la première image (ms). */
const LOOP_CLOSE_MS = 700;
const LOOP_HOLD_MS = 350;
const LOOP_OPEN_MS = 600;
const LOOP_MS = LOOP_CLOSE_MS + LOOP_HOLD_MS + 120 + LOOP_OPEN_MS;
/** Durée de l'écran de fin jusqu'à la dernière image (ms), avec carte de vote. */
export const RESULT_HOLD_MS = VERDICT_MS + GIFTS_TITLE_MS + VOTE_MS + LOOP_MS;
/** Sans carte de vote (aperçu, seed simple, match nul) : vainqueur et MVP seulement. */
export const RESULT_HOLD_NO_VOTE_MS = 5500 + LOOP_MS;

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

    const verdict = this.duel(r, vote, !vote);
    if (vote) {
      this.time.delayedCall(VERDICT_MS, () => {
        this.tweens.add({ targets: verdict, alpha: 0, duration: 220, onComplete: () => verdict.forEach((o) => o.destroy()) });
        const title = this.giftsTitle();
        this.time.delayedCall(GIFTS_TITLE_MS, () => {
          this.tweens.add({ targets: title, alpha: 0, duration: 200, onComplete: () => title.forEach((o) => o.destroy()) });
          this.voteCard(vote);
        });
      });
    }
    else this.celebrate(r);
    if (r.curtain) openCurtain(this, 250, 450);
    const hold = vote ? RESULT_HOLD_MS : RESULT_HOLD_NO_VOTE_MS;
    this.time.delayedCall(hold - LOOP_MS, () => this.loopToFirstFrame());

    // Marge après la réouverture du rideau : l'enregistreur rend ses dernières images avec un peu de retard,
    // et la vidéo doit finir sur la première image, rideau ouvert.
    if (r.params.record) this.time.delayedCall(hold + 1500, () => this.game.events.emit('episode-finished'));
  }

  /**
   * Deuxième temps : deux cartes côte à côte. À gauche le MVP (meilleur héros du camp vainqueur) qui saute de joie
   * sous les confettis ; à droite le pire (le héros qui recevra le cadeau quand il y a un vote, sinon le moins bon
   * du camp perdant) qui boude sous sa petite pluie.
   */
  private duel(r: ResultData, vote: Vote | undefined, postponed: boolean): Phaser.GameObjects.GameObject[] {
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
    const rank = (a: ResultData['heroes'][number], b: ResultData['heroes'][number]) => b.kills - a.kills || Number(b.alive) - Number(a.alive) || b.hp - a.hp;
    const winners = r.heroes.filter((e) => draw || e.team === r.winner);
    const mvp = winners.find((e) => e.name === r.mvpName) ?? [...winners].sort(rank)[0];
    const losers = r.heroes.filter((e) => e !== mvp && (draw || e.team !== r.winner));
    const worst = (vote && r.heroes.find((e) => e.name === vote.recipient)) ?? [...losers].sort(rank).at(-1);
    const gap = 16;
    const cardW = (SAFE.centered.w - gap) / 2;
    const top = 370;
    const cardH = 840;
    const cards: [typeof mvp | undefined, 'best' | 'worst', number][] = [
      [mvp, 'best', SAFE.centered.x + cardW / 2],
      [worst, 'worst', SAFE.centered.x + cardW + gap + cardW / 2],
    ];
    cards.forEach(([hero, kind, x], i) => {
      if (!hero) return;
      const best = kind === 'best';
      const y = top + cardH / 2;
      const card = this.add.container(x, y).setScale(0);
      card.add(goldFrame(this, 0, 0, cardW, cardH) ?? this.add.rectangle(0, 0, cardW, cardH, 0x3d3555).setStrokeStyle(6, 0x000000));
      const inner = cardW - 2 * FRAME_INSET.x - 16;
      card.add(this.fitWidth(this.add.text(0, -cardH / 2 + 80, best ? cfg.mvp : cfg.worst, textStyle(best ? 56 : 44, best ? '#ffe14a' : '#a8b0c8')).setOrigin(0.5), inner));
      const def = (r.params.heroes ?? r.params.data.heroes).find((e) => e.name === hero.name);
      const tex = def && `unit_${def.visual}`;
      let portrait: Phaser.GameObjects.Image | undefined;
      if (tex && this.textures.exists(tex)) {
        portrait = this.add.image(0, -20, tex, 0);
        fitIcon(portrait, Math.min(300, inner));
        if (!best) portrait.setTint(0x9aa0b8);
        card.add(portrait);
      }
      // Un mot par ligne (« MARCEL / L'ENCLUME »), jamais coupé au milieu ; réduit s'il déborde encore.
      card.add(this.fitWidth(this.add.text(0, 220, hero.name.toUpperCase().replace(/ /g, '\n'), textStyle(36, TEAM_COLORS[hero.team].main, { align: 'center', lineSpacing: 10 })).setOrigin(0.5), inner));
      card.add(this.add.text(0, 330, `${hero.kills} K.O.`, textStyle(36, best ? '#ffffff' : '#a8b0c8')).setOrigin(0.5));
      items.push(card);
      const delay = 250 + i * 350;
      this.tweens.add({ targets: card, scale: 1, duration: 360, delay, ease: 'Back.easeOut' });
      if (!portrait) return;
      const p = portrait;
      const y0 = p.y;
      if (best) {
        // Fête : il saute en boucle, un peu plus gros à chaque appui, sous les confettis de son camp.
        this.tweens.add({ targets: p, y: y0 - 46, duration: 260, yoyo: true, repeat: -1, ease: 'Quad.easeOut', delay: delay + 300 });
        this.tweens.add({ targets: p, angle: { from: -6, to: 6 }, duration: 260, yoyo: true, repeat: -1, delay: delay + 300 });
        const colors = [Number.parseInt(TEAM_COLORS[hero.team].main.slice(1), 16), 0xffe14a, 0xffffff];
        for (let k = 0; k < 26; k++) {
          const bx = x + (hash01(k * 7 + 1) - 0.5) * cardW * 0.9;
          const bit = this.add.rectangle(bx, top + 20, 10, 6, colors[k % colors.length]).setDepth(5).setAngle(hash01(k * 7 + 2) * 180).setAlpha(0);
          items.push(bit);
          this.tweens.add({ targets: bit, alpha: 1, duration: 80, delay: delay + 300 + hash01(k * 7 + 3) * 1500 });
          this.tweens.add({ targets: bit, y: top + cardH - 30, angle: bit.angle + 360, duration: 1400 + hash01(k * 7 + 4) * 900, delay: delay + 300 + hash01(k * 7 + 3) * 1500, repeat: -1 });
        }
      } else {
        // Défaite : il s'affaisse, penche la tête et soupire, sous un petit nuage qui pleut.
        this.tweens.add({ targets: p, y: y0 + 18, scaleY: p.scaleY * 0.9, angle: 10, duration: 500, delay: delay + 400, ease: 'Quad.easeOut' });
        this.tweens.add({ targets: p, angle: { from: 10, to: 4 }, duration: 900, yoyo: true, repeat: -1, delay: delay + 900, ease: 'Sine.easeInOut' });
        const cloudY = top + 190;
        const cloud = this.add.ellipse(x, cloudY, 150, 54, 0x6a6f86).setStrokeStyle(4, 0x000000).setDepth(5).setAlpha(0);
        const cloud2 = this.add.ellipse(x - 30, cloudY - 22, 80, 50, 0x6a6f86).setDepth(5).setAlpha(0);
        items.push(cloud2, cloud);
        this.tweens.add({ targets: [cloud, cloud2], alpha: 1, duration: 300, delay: delay + 500 });
        this.tweens.add({ targets: [cloud, cloud2], x: '+=10', duration: 700, yoyo: true, repeat: -1, delay: delay + 500 });
        for (let k = 0; k < 10; k++) {
          const drop = this.add.rectangle(x - 55 + k * 12, cloudY + 30, 4, 14, 0x7fb0ff).setDepth(5).setAlpha(0);
          items.push(drop);
          this.tweens.add({ targets: drop, alpha: { from: 1, to: 0.2 }, y: cloudY + 200, duration: 650, delay: delay + 700 + hash01(k + 31) * 650, repeat: -1 });
        }
      }
    });
    // Égalité d'épisode sans vote : la série continue, le vote est reporté.
    if (draw && postponed && ep) {
      const p = this.add.text(CX, top + cardH + 50, cfg.postponed, textStyle(36, '#ffe14a', { wordWrap: { width: SAFE.centered.w - 40 } })).setOrigin(0.5).setAlpha(0);
      this.tweens.add({ targets: p, alpha: 1, duration: 250, delay: 900 });
      items.push(p);
    }
    return items;
  }

  /** Entre le MVP et la carte de vote : « LES CADEAUX DU PUBLIC » seul, dans son cadre. */
  private giftsTitle(): Phaser.GameObjects.GameObject[] {
    const y = 700;
    const text = this.add.text(CX, y, manifest.staging.reveal.giftsTitle, textStyle(64, '#ffe14a', { align: 'center', lineSpacing: 18 })).setOrigin(0.5).setScale(0.4).setAlpha(0);
    const items = [...this.plaque(y, text.height + 140), text];
    if (!hasGoldFrame(this) && manifest.staging.reveal.textBacking) items.unshift(this.backing(CX, y, SAFE.centered.w, text.height + 100));
    this.tweens.add({ targets: text, alpha: 1, scale: 1, duration: 350, ease: 'Back.easeOut' });
    return items;
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

  /**
   * Boucle : un rideau nu se ferme sur l'écran de fin, la première image (photographiée à l'ouverture, sinon
   * redessinée) se pose derrière, puis le rideau se rouvre dessus. La vidéo finit sur sa première image.
   */
  private loopToFirstFrame(): void {
    const { width: w, height: h } = this.scale;
    closeCurtain(
      this,
      LOOP_CLOSE_MS,
      (closed) => {
        if (this.textures.exists(OPENING_FRAME)) {
          this.add.image(0, 0, OPENING_FRAME).setOrigin(0).setDisplaySize(w, h).setDepth(5000);
        } else {
          // Sans écran d'ouverture (aperçu sans intro), on redessine le titre sur le fond de l'arène s'il existe.
          const title = lastOpeningTitle(this);
          const bg = this.textures.getTextureKeys().find((k) => k.startsWith('arena_bg_'));
          if (bg) this.add.image(0, 0, bg).setOrigin(0).setDisplaySize(w, h).setDepth(5000);
          if (title) drawOpeningTitle(this, title, 5001);
        }
        // Rideau identique qui se rouvre, posé par-dessus le premier : on peut retirer celui qui s'est fermé.
        openCurtain(this, 0, LOOP_OPEN_MS, { title: null });
        closed.parts.forEach((p) => p.destroy());
      },
      { title: null },
      LOOP_HOLD_MS,
    );
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
  }

}
