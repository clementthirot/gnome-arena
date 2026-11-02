// Dessin des placeholders en grilles de pixels, sans DOM : utilisable par le jeu (canvas)
// comme par les scripts Node (génération de sprite sheets PNG).

/** Grille de couleurs "#rrggbb", null = transparent. grid[y][x]. */
export type PixelGrid = (string | null)[][];

/** Description d'un placeholder de personnage (sous-ensemble d'une entrée du manifeste). */
export interface PlaceholderShape {
  body: 'gnome' | 'goblin';
  size: number;
  color: string;
  accent: string;
  mark: 'none' | 'bow' | 'helmet';
  outline?: string;
}

export const DARK_OUTLINE = '#141420';
const HELMET = '#a8b0bc';
const BOW = '#8a5a2b';
/** Marge autour de la silhouette pour les contours. */
export const PLACEHOLDER_PAD = 2;

export function emptyGrid(width: number, height: number): PixelGrid {
  return Array.from({ length: height }, () => Array<string | null>(width).fill(null));
}

/** Silhouette d'un personnage, tourné vers la droite, avec ses contours. */
export function placeholderPixels(entry: PlaceholderShape): PixelGrid {
  const n = entry.size;
  const grid = emptyGrid(n, n);
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

  const out = padGrid(grid, PLACEHOLDER_PAD);
  ring(out, DARK_OUTLINE);
  if (entry.outline) ring(out, entry.outline);
  return out;
}

/** Ajoute une marge transparente autour d'une grille. */
export function padGrid(grid: PixelGrid, pad: number): PixelGrid {
  const h = grid.length + pad * 2;
  const w = (grid[0]?.length ?? 0) + pad * 2;
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => grid[y - pad]?.[x - pad] ?? null));
}

/** Contour d'un pixel autour de tout ce qui est opaque. */
export function ring(grid: PixelGrid, color: string): void {
  const snapshot = grid.map((row) => [...row]);
  for (let y = 0; y < grid.length; y++)
    for (let x = 0; x < grid[y].length; x++) {
      if (snapshot[y][x]) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => snapshot[y + dy]?.[x + dx]);
      if (near) grid[y][x] = color;
    }
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

export function accessoryPixels(kind: string, color: string, accent: string): PixelGrid {
  const art = ACCESSORY_ART[kind] ?? ['oo', 'oo'];
  const width = Math.max(...art.map((row) => row.length));
  const palette: Record<string, string> = { c: color, a: accent, w: '#ffffff', o: DARK_OUTLINE };
  return art.map((row) => Array.from({ length: width }, (_, x) => palette[row[x] ?? '.'] ?? null));
}
