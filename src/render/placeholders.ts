// Placeholders en vrai pixel art (un pixel monde = un pixel de texture), agrandis sans lissage.
// Le dessin lui-même est dans pixels.ts ; ici, on le pose sur un canvas pour Phaser.
import type { PlaceholderAsset } from './manifest';
import { accessoryPixels, placeholderPixels, type PixelGrid } from './pixels';

export { PLACEHOLDER_PAD } from './pixels';

export function gridToCanvas(grid: PixelGrid): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.height = grid.length;
  canvas.width = grid[0]?.length ?? 0;
  const ctx = canvas.getContext('2d')!;
  grid.forEach((row, y) =>
    row.forEach((c, x) => {
      if (!c) return;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return canvas;
}

export function drawPlaceholder(entry: PlaceholderAsset): HTMLCanvasElement {
  return gridToCanvas(placeholderPixels(entry));
}

export function drawAccessory(kind: string, color: string, accent: string): HTMLCanvasElement {
  return gridToCanvas(accessoryPixels(kind, color, accent));
}

/** Spectateur minuscule (4 à 6 px) pour les gradins. */
export function drawSpectator(body: string, hat: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 5;
  canvas.height = 7;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = hat;
  ctx.fillRect(2, 0, 1, 1);
  ctx.fillRect(1, 1, 3, 1);
  ctx.fillStyle = '#e8c9a0';
  ctx.fillRect(1, 2, 3, 2);
  ctx.fillStyle = body;
  ctx.fillRect(0, 4, 5, 3);
  return canvas;
}
