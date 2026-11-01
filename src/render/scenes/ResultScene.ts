// Écran de fin : vainqueur, bilan des héros, puis carte de vote de l'épisode.
// En mode enregistrement, pas de boutons : la carte de vote clôt la vidéo.
import Phaser from 'phaser';
import type { TeamId } from '../../data/schema';
import { manifest } from '../manifest';
import { drawAccessory } from '../placeholders';
import { TEAM_COLORS, textStyle } from '../text';
import { nextSeed, type ArenaParams } from './ArenaScene';

export interface ResultData {
  params: ArenaParams;
  winner: TeamId | 'draw';
  reason: 'elimination' | 'timeout';
  duration: number;
  survivors: Record<TeamId, number>;
  heroes: { name: string; label: string; team: TeamId; kills: number; alive: boolean; hp: number }[];
}

/** Durée d'affichage de l'écran de fin avant la fin d'un enregistrement (ms). */
export const RESULT_HOLD_MS = 7000;

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export class ResultScene extends Phaser.Scene {
  constructor() {
    super('result');
  }

  create(r: ResultData): void {
    const { width: w, height: h } = this.scale;
    const vote = r.params.episode?.vote;
    this.add.rectangle(0, 0, w, h, 0x1c1826).setOrigin(0);
    // Bandes de pixels en fond, pour rester dans la DA.
    for (let y = 0; y < h; y += 36) this.add.rectangle(0, y, w, 32, y % 72 ? 0x241f31 : 0x211c2d).setOrigin(0);

    if (r.params.episode) {
      this.add.text(w / 2, 90, `ÉPISODE ${r.params.episode.number}`, textStyle(30, '#d8d0e8')).setOrigin(0.5);
    }
    const color = r.winner === 'draw' ? '#ffffff' : TEAM_COLORS[r.winner].main;
    const title = r.winner === 'draw' ? 'ÉGALITÉ' : `LES ${TEAM_COLORS[r.winner].label}`;
    this.add.text(w / 2, 190, 'VICTOIRE', textStyle(60, '#ffe14a')).setOrigin(0.5);
    const big = this.add.text(w / 2, 300, title, textStyle(78, color)).setOrigin(0.5).setScale(0.3);
    this.tweens.add({ targets: big, scale: 1, duration: 400, ease: 'Back.easeOut' });

    const secs = r.duration.toFixed(1).replace('.', ',');
    const how = r.reason === 'timeout' ? 'aux points' : 'par élimination';
    this.add.text(w / 2, 410, `${secs} s · ${how}`, textStyle(28, '#d8d0e8')).setOrigin(0.5);
    this.add
      .text(w / 2, 465, `Survivants : ${plural(r.survivors.gnomes, 'gnome')} · ${plural(r.survivors.goblins, 'gobelin')}`, textStyle(22, '#d8d0e8'))
      .setOrigin(0.5);

    // Bilan des héros sur deux colonnes, un camp par colonne.
    (['gnomes', 'goblins'] as const).forEach((team, col) => {
      const x = w * (col === 0 ? 0.27 : 0.73);
      let y = 570;
      this.add.text(x, y, TEAM_COLORS[team].label, textStyle(30, TEAM_COLORS[team].main)).setOrigin(0.5);
      y += 70;
      for (const hero of r.heroes.filter((e) => e.team === team)) {
        const status = hero.alive ? `debout ${Math.round(hero.hp * 100)} %` : 'K.O.';
        this.add.text(x, y, hero.name, textStyle(28, '#ffffff')).setOrigin(0.5);
        this.add.text(x, y + 38, `${hero.kills} K.O. · ${status}`, textStyle(18, hero.alive ? '#ffffff' : '#a098b0')).setOrigin(0.5);
        y += 92;
      }
    });

    if (vote) this.voteCard(vote, 1000);

    if (r.params.record) {
      this.time.delayedCall(RESULT_HOLD_MS, () => this.game.events.emit('episode-finished'));
      return;
    }
    this.button(w / 2 - 220, h - 200, 'REJOUER', () => this.scene.start('arena', r.params));
    // Une autre seed n'est plus l'épisode : on retire son numéro et son vote.
    const next = () => this.scene.start('arena', { ...r.params, seed: nextSeed(r.params.seed), episode: undefined });
    this.button(w / 2 + 220, h - 200, 'SUIVANT', next);
    this.add.text(w / 2, h - 90, `seed ${r.params.seed} · R rejouer · N suivante`, textStyle(18, '#a098b0')).setOrigin(0.5);
    this.input.keyboard?.on('keydown-R', () => this.scene.start('arena', r.params));
    this.input.keyboard?.on('keydown-N', next);
  }

  /** « Kevin recevra la prochaine upgrade — votez : 1 laser, 2 épée, 3 grenades ». */
  private voteCard(vote: NonNullable<NonNullable<ArenaParams['episode']>['vote']>, top: number): void {
    const { width: w } = this.scale;
    const panel = this.add.rectangle(w / 2, top + 300, w - 80, 640, 0x2e2740).setStrokeStyle(8, 0x000000);
    panel.setAlpha(0);
    this.tweens.add({ targets: panel, alpha: 1, duration: 300, delay: 600 });
    const name = this.add
      .text(w / 2, top + 50, vote.recipient.toUpperCase(), textStyle(56, TEAM_COLORS[vote.team].main))
      .setOrigin(0.5)
      .setAlpha(0);
    const line = this.add.text(w / 2, top + 120, 'recevra la prochaine upgrade', textStyle(30)).setOrigin(0.5).setAlpha(0);
    const call = this.add.text(w / 2, top + 185, 'VOTEZ EN COMMENTAIRE', textStyle(34, '#ffe14a')).setOrigin(0.5).setAlpha(0);
    this.tweens.add({ targets: [name, line, call], alpha: 1, duration: 300, delay: this.tweens.stagger(250, { start: 800 }) });

    const n = vote.options.length;
    const cardW = (w - 160) / n - 20;
    vote.options.forEach((o, i) => {
      const x = 80 + (i + 0.5) * ((w - 160) / n);
      const y = top + 430;
      const card = this.add.container(x, y).setScale(0);
      card.add(this.add.rectangle(0, 0, cardW, 330, 0x3d3555).setStrokeStyle(6, 0x000000));
      card.add(this.add.text(0, -110, String(i + 1), textStyle(88, '#ffe14a')).setOrigin(0.5));
      const acc = manifest.accessories[o.visual];
      if (acc?.type === 'placeholder') {
        const key = `acc_tex_${o.visual}`;
        if (!this.textures.exists(key)) this.textures.addCanvas(key, drawAccessory(acc.kind, acc.color, acc.accent));
        card.add(this.add.image(0, 10, key).setScale(10));
      }
      card.add(this.add.text(0, 120, o.label, textStyle(24, '#ffffff', { wordWrap: { width: cardW - 20 } })).setOrigin(0.5));
      this.tweens.add({ targets: card, scale: 1, duration: 350, delay: 1700 + i * 350, ease: 'Back.easeOut' });
    });
  }

  private button(x: number, y: number, label: string, onClick: () => void): void {
    const bg = this.add.rectangle(x, y, 380, 110, 0x3d6cc4).setStrokeStyle(6, 0x000000).setInteractive({ useHandCursor: true });
    this.add.text(x, y, label, textStyle(34)).setOrigin(0.5);
    bg.on('pointerover', () => bg.setFillStyle(0x5b8def));
    bg.on('pointerout', () => bg.setFillStyle(0x3d6cc4));
    bg.on('pointerup', onClick);
  }
}
