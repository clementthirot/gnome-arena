// Police pixel grande et contrastée, toujours contourée, pour rester lisible sur téléphone.
import type Phaser from 'phaser';

export const FONT = '"Press Start 2P", monospace';

export const TEAM_COLORS = {
  gnomes: { main: '#7fb0ff', bar: 0x5b8def, label: 'GNOMES' },
  goblins: { main: '#9be05a', bar: 0x7cc243, label: 'GOBELINS' },
} as const;

/**
 * Échelle de texte de la vidéo (px canvas). Sur un téléphone, 1080 px s'affichent sur ~390 pt :
 * sous 26 px, la police pixel devient illisible. Aucun texte de la vidéo en dessous de XS.
 */
export const TEXT = { XL: 84, L: 56, M: 40, S: 30, XS: 26 } as const;

export function textStyle(size: number, color = '#ffffff', extra: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: FONT,
    fontSize: `${size}px`,
    color,
    stroke: '#000000',
    strokeThickness: Math.max(4, Math.round(size / 4)),
    align: 'center',
    ...extra,
  };
}
