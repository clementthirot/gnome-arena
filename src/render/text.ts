// Police pixel grande et contrastée, toujours contourée, pour rester lisible sur téléphone.
import type Phaser from 'phaser';

export const FONT = '"Press Start 2P", monospace';

export const TEAM_COLORS = {
  gnomes: { main: '#7fb0ff', bar: 0x5b8def, label: 'GNOMES' },
  goblins: { main: '#9be05a', bar: 0x7cc243, label: 'GOBELINS' },
} as const;

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
