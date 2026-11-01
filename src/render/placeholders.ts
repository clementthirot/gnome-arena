// Génère des placeholders en vrai pixel art (un pixel monde = un pixel de texture),
// agrandis ensuite sans lissage. Ils seront remplacés par les sprite sheets via le manifeste.
import type { PlaceholderAsset } from './manifest';

const DARK_OUTLINE = '#141420';
const HELMET = '#a8b0bc';
const BOW = '#8a5a2b';
/** Marge autour de la silhouette pour les contours. */
export const PLACEHOLDER_PAD = 2;

export function drawPlaceholder(entry: PlaceholderAsset): HTMLCanvasElement {
  const n = entry.size;
  const grid: (string | null)[][] = Array.from({ length: n }, () => Array<string | null>(n).fill(null));
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < n && y < n) grid[y][x] = c;
  };
  const cx = (n - 1) / 2;

  if (entry.body === 'gnome') {
    // Corps rond, bonnet pointu.
    const cy = n * 0.64;
    const r = n * 0.36;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, entry.color);
    const hatBase = Math.round(n * 0.44);
    for (let y = 0; y <= hatBase; y++) {
      const half = ((y + 1) / (hatBase + 1)) * n * 0.36;
      for (let x = 0; x < n; x++) if (Math.abs(x - cx - y * 0.08) <= half) set(x, y, entry.accent);
    }
    // Barbe blanche sous les yeux.
    const beardY = Math.round(cy + r * 0.25);
    for (let y = beardY; y < n; y++)
      for (let x = 0; x < n; x++) if (grid[y][x] && Math.abs(x - cx - n * 0.08) <= (n - y) * 0.6) set(x, y, '#f0ece0');
    const eyeY = Math.round(cy - r * 0.15);
    set(Math.round(cx + n * 0.1), eyeY, DARK_OUTLINE);
    set(Math.round(cx + n * 0.28), eyeY, DARK_OUTLINE);
    if (entry.mark === 'helmet') {
      for (let x = 0; x < n; x++) for (let y = hatBase - 1; y <= hatBase + 1; y++) if (grid[y]?.[x]) set(x, y, HELMET);
    }
  } else {
    // Corps triangulaire, oreilles pointues.
    const top = Math.round(n * 0.16);
    for (let y = top; y < n; y++) {
      const half = ((y - top + 1) / (n - top)) * n * 0.46;
      for (let x = 0; x < n; x++) if (Math.abs(x - cx) <= half) set(x, y, entry.color);
    }
    const earY = Math.round(n * 0.4);
    for (let i = 0; i < Math.max(2, Math.round(n * 0.22)); i++) {
      set(Math.round(cx - n * 0.2) - i, earY - Math.floor(i / 2), entry.color);
      set(Math.round(cx + n * 0.2) + i, earY - Math.floor(i / 2), entry.color);
    }
    // Pagne à la base.
    const beltY = Math.round(n * 0.78);
    for (let x = 0; x < n; x++) for (let y = beltY; y < beltY + Math.max(1, Math.round(n * 0.1)); y++) if (grid[y]?.[x]) set(x, y, entry.accent);
    const eyeY = Math.round(n * 0.46);
    set(Math.round(cx + n * 0.05), eyeY, '#ffe14a');
    set(Math.round(cx + n * 0.22), eyeY, '#ffe14a');
    if (entry.mark === 'helmet') {
      for (let y = top; y < top + Math.max(2, Math.round(n * 0.18)); y++) for (let x = 0; x < n; x++) if (grid[y][x]) set(x, y, HELMET);
    }
  }

  if (entry.mark === 'bow') {
    // Arc tenu à gauche (le personnage regarde à droite par défaut).
    const y0 = Math.round(n * 0.4);
    const y1 = Math.round(n * 0.92);
    for (let y = y0; y <= y1; y++) {
      const t = (y - y0) / Math.max(1, y1 - y0);
      set(Math.round(1 + Math.sin(t * Math.PI) * -1 + 1), y, BOW);
    }
  }

  // Contour sombre, puis contour clair optionnel (héros).
  const pad = PLACEHOLDER_PAD;
  const size = n + pad * 2;
  const out: (string | null)[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => grid[y - pad]?.[x - pad] ?? null),
  );
  const ring = (color: string) => {
    const snapshot = out.map((row) => [...row]);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (snapshot[y][x]) continue;
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => snapshot[y + dy]?.[x + dx]);
        if (near) out[y][x] = color;
      }
  };
  ring(DARK_OUTLINE);
  if (entry.outline) ring(entry.outline);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = out[y][x];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  return canvas;
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

// Accessoires d'upgrade en pixel art ASCII : c = couleur, a = accent, w = blanc, o = contour.
const ACCESSORY_ART: Record<string, string[]> = {
  goggles: ['oooooooooo', 'occaooacco', 'occaooacco', 'oooooooooo'],
  sword: ['.ow.', '.oco', '.oco', '.oco', '.oco', '.oco', '.oco', 'oaaao', '.oao', '.oo.'],
  grenades: ['.oo..oo..oo.', 'occooccoocco', 'occooccoocco', 'aaaaaaaaaaaa'],
  jar: ['.aaa.', 'occco', 'ocwco', 'occco', 'ooooo'],
  chicken: ['..oo...', '.owwoa.', 'owwwwaa', 'owwwwo.', '.oooo..', '..a.a..'],
  pot: ['..oooooo..', '.occccccco.', 'oacccccca.', 'occccccco.', '.oooooooo.'],
};

export function drawAccessory(kind: string, color: string, accent: string): HTMLCanvasElement {
  const art = ACCESSORY_ART[kind] ?? ['oo', 'oo'];
  const width = Math.max(...art.map((row) => row.length));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = art.length;
  const ctx = canvas.getContext('2d')!;
  const palette: Record<string, string> = { c: color, a: accent, w: '#ffffff', o: DARK_OUTLINE };
  art.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const fill = palette[ch];
      if (!fill) return;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, 1, 1);
    });
  });
  return canvas;
}
