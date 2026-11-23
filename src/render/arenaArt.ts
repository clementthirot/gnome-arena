// Décor de l'arène dessiné en pixel art à la résolution monde (270 x 480), aux couleurs du biome.
import type { BiomeDef } from '../data/schema';
import type { FieldRect } from '../sim/types';

/** Petit aléa déterministe propre au décor, pour que l'arène ne change pas d'un combat à l'autre. */
function decorRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** groundTile : tuile PixelLab facultative (manifeste art.grounds) répétée sur le terrain à la place des mouchetures. */
export function drawArenaBackground(width: number, height: number, field: FieldRect, biome: BiomeDef, groundTile?: CanvasImageSource): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const rnd = decorRandom(7);
  const p = biome.palette;

  // Gradins : rangées de pierre.
  ctx.fillStyle = p.backdrop;
  ctx.fillRect(0, 0, width, height);
  for (let y = 0; y < height; y += 9) {
    ctx.fillStyle = (y / 9) % 2 ? p.stands[0] : p.stands[1];
    ctx.fillRect(0, y, width, 8);
    ctx.fillStyle = p.standsLine;
    ctx.fillRect(0, y + 8, width, 1);
  }

  // Muret autour du terrain.
  const wall = 4;
  ctx.fillStyle = p.wall;
  ctx.fillRect(field.x - wall, field.y - wall, field.width + wall * 2, field.height + wall * 2);
  ctx.fillStyle = p.wallDark;
  for (let x = field.x - wall; x < field.x + field.width + wall; x += 6) {
    ctx.fillRect(x, field.y - wall, 1, wall);
    ctx.fillRect(x + 3, field.y + field.height, 1, wall);
  }

  // Sol du terrain : tuile répétée si fournie, sinon mouchetures et quelques cailloux.
  ctx.fillStyle = p.ground;
  ctx.fillRect(field.x, field.y, field.width, field.height);
  const pattern = groundTile && ctx.createPattern(groundTile, 'repeat');
  if (pattern) {
    pattern.setTransform?.(new DOMMatrix().translate(field.x, field.y));
    ctx.fillStyle = pattern;
    ctx.fillRect(field.x, field.y, field.width, field.height);
  } else {
    for (let i = 0; i < field.width * field.height * 0.08; i++) {
      ctx.fillStyle = p.speckles[Math.floor(rnd() * p.speckles.length)];
      ctx.fillRect(field.x + Math.floor(rnd() * field.width), field.y + Math.floor(rnd() * field.height), 1, 1);
    }
    for (let i = 0; i < 40; i++) {
      const x = field.x + Math.floor(rnd() * (field.width - 2));
      const y = field.y + Math.floor(rnd() * (field.height - 2));
      ctx.fillStyle = p.pebble;
      ctx.fillRect(x, y, 2, 1);
      ctx.fillStyle = p.pebbleLight;
      ctx.fillRect(x, y - 1, 1, 1);
    }
    // Volcan : fissures de lave ; neige : plaques de glace.
    if (biome.ambient === 'embers' || biome.ambient === 'snow') {
      ctx.fillStyle = biome.ambient === 'embers' ? '#ff6a2a' : '#c8e0f8';
      for (let i = 0; i < 14; i++) {
        let x = field.x + Math.floor(rnd() * field.width);
        let y = field.y + Math.floor(rnd() * field.height);
        for (let k = 0; k < 8; k++) {
          ctx.fillRect(x, y, biome.ambient === 'snow' ? 3 : 1, 1);
          x += Math.floor(rnd() * 3) - 1;
          y += 1;
        }
      }
    }
  }
  // Ligne médiane discrète.
  ctx.fillStyle = p.line;
  const mid = Math.round(field.y + field.height / 2);
  for (let x = field.x + 2; x < field.x + field.width - 2; x += 4) ctx.fillRect(x, mid, 2, 1);
  return canvas;
}
