// Cadre doré unique des écrans de fin (manifeste art.menu.card) : cartes de vote, plaques de titre,
// fenêtres des rouleaux. Une seule image agrandie en 9-slice, pour que tous les cadres se ressemblent.
import type Phaser from 'phaser';
import { manifest } from './manifest';

/** Agrandissement : les pixels de l'image source tombent sur 1,5 px écran, partout pareil. */
export const FRAME_SCALE = 1.5;
/** Bords non étirés, en px de l'image source (coins, liseré doré et bande violette) ; un thème peut les changer. */
const [left, right, top, bottom] = manifest.art.menu.slice;
const SLICE = { left, right, top, bottom };
/** Marge intérieure en px écran : du bord extérieur jusqu'au fond sombre du cadre. */
export const FRAME_INSET = { x: Math.ceil(SLICE.left * FRAME_SCALE), y: Math.ceil(SLICE.top * FRAME_SCALE) };

export function hasGoldFrame(scene: Phaser.Scene): boolean {
  return scene.textures.exists('ui_card');
}

/** Cadre doré centré en (x, y), de w × h px écran ; undefined sans l'image. */
export function goldFrame(scene: Phaser.Scene, x: number, y: number, w: number, h: number): Phaser.GameObjects.NineSlice | undefined {
  if (!hasGoldFrame(scene)) return undefined;
  return scene.add.nineslice(x, y, 'ui_card', undefined, w / FRAME_SCALE, h / FRAME_SCALE, SLICE.left, SLICE.right, SLICE.top, SLICE.bottom).setScale(FRAME_SCALE);
}
