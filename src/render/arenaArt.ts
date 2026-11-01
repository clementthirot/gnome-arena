// Décor de l'arène dessiné en pixel art à la résolution monde (270 x 480).
import type { FieldRect } from '../sim/types';

/** Petit aléa déterministe propre au décor, pour que l'arène ne change pas d'un combat à l'autre. */
function decorRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function drawArenaBackground(width: number, height: number, field: FieldRect): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const rnd = decorRandom(7);

  // Gradins : rangées de pierre.
  ctx.fillStyle = '#3a3346';
  ctx.fillRect(0, 0, width, height);
  for (let y = 0; y < height; y += 9) {
    ctx.fillStyle = (y / 9) % 2 ? '#463e55' : '#3f384d';
    ctx.fillRect(0, y, width, 8);
    ctx.fillStyle = '#2b2635';
    ctx.fillRect(0, y + 8, width, 1);
  }

  // Muret autour du terrain.
  const wall = 4;
  ctx.fillStyle = '#7b6a58';
  ctx.fillRect(field.x - wall, field.y - wall, field.width + wall * 2, field.height + wall * 2);
  ctx.fillStyle = '#5b4d40';
  for (let x = field.x - wall; x < field.x + field.width + wall; x += 6) {
    ctx.fillRect(x, field.y - wall, 1, wall);
    ctx.fillRect(x + 3, field.y + field.height, 1, wall);
  }

  // Sable du terrain, avec mouchetures et quelques cailloux.
  ctx.fillStyle = '#c8a46c';
  ctx.fillRect(field.x, field.y, field.width, field.height);
  const speckles = ['#bf9a62', '#d2b07a', '#b8925a'];
  for (let i = 0; i < field.width * field.height * 0.08; i++) {
    ctx.fillStyle = speckles[Math.floor(rnd() * speckles.length)];
    ctx.fillRect(field.x + Math.floor(rnd() * field.width), field.y + Math.floor(rnd() * field.height), 1, 1);
  }
  for (let i = 0; i < 40; i++) {
    const x = field.x + Math.floor(rnd() * (field.width - 2));
    const y = field.y + Math.floor(rnd() * (field.height - 2));
    ctx.fillStyle = '#9c8058';
    ctx.fillRect(x, y, 2, 1);
    ctx.fillStyle = '#e0c590';
    ctx.fillRect(x, y - 1, 1, 1);
  }
  // Ligne médiane discrète.
  ctx.fillStyle = '#b89660';
  const mid = Math.round(field.y + field.height / 2);
  for (let x = field.x + 2; x < field.x + field.width - 2; x += 4) ctx.fillRect(x, mid, 2, 1);
  return canvas;
}
