// Fabrique une sprite sheet animée (une ligne d'images) à partir d'une silhouette fixe.
// Sert à générer des sheets de remplacement qui suivent exactement le format attendu des
// vraies sheets PixelLab : idle, walk, attack, death, dans cet ordre.
import { DARK_OUTLINE, emptyGrid, type PixelGrid } from './pixels';

/** Disposition standard d'une sheet : indices d'images par animation. Voir docs/sprites.md. */
export const SHEET_LAYOUT = {
  idle: { frames: [0, 1], fps: 4 },
  walk: { frames: [2, 3, 4, 5], fps: 10 },
  attack: { frames: [6, 7, 8], fps: 14 },
  death: { frames: [9, 10, 11, 12], fps: 10 },
} as const;
export const SHEET_FRAMES = 13;

export interface Sheet {
  frames: PixelGrid[];
  frameSize: number;
}

/** Copie une grille dans une autre, décalée ; les pixels hors cadre sont perdus. */
function blit(target: PixelGrid, source: PixelGrid, dx: number, dy: number, tint = 1): void {
  source.forEach((row, y) =>
    row.forEach((c, x) => {
      if (!c) return;
      const ty = y + dy;
      const tx = x + dx;
      if (ty < 0 || tx < 0 || ty >= target.length || tx >= target[0].length) return;
      target[ty][tx] = tint === 1 ? c : darken(c, tint);
    }),
  );
}

function darken(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** Rotation au plus proche voisin autour du centre (angle en degrés, sens horaire). */
function rotate(grid: PixelGrid, degrees: number): PixelGrid {
  const h = grid.length;
  const w = grid[0].length;
  const out = emptyGrid(w, h);
  const a = (-degrees * Math.PI) / 180;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Pixel source qui atterrit en (x, y).
      const sx = Math.round(cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a));
      const sy = Math.round(cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a));
      out[y][x] = grid[sy]?.[sx] ?? null;
    }
  return out;
}

/** Ligne la plus basse occupée (pour poser un corps au sol). */
function bottom(grid: PixelGrid): number {
  for (let y = grid.length - 1; y >= 0; y--) if (grid[y].some(Boolean)) return y;
  return grid.length - 1;
}

export function buildSheet(base: PixelGrid): Sheet {
  const s = base.length;
  const f = s + 4;
  const frame = () => emptyGrid(f, f);
  const groundY = (g: PixelGrid) => f - 2 - bottom(g);
  const frames: PixelGrid[] = [];
  const y0 = groundY(base);

  // idle : respiration d'un pixel.
  for (const dy of [0, 1]) {
    const g = frame();
    blit(g, base, 2, y0 + dy);
    frames.push(g);
  }
  // walk : petits sauts et pieds qui alternent.
  const feet = [
    [-2, 1],
    [0, 0],
    [1, -2],
    [0, 0],
  ];
  for (let i = 0; i < 4; i++) {
    const g = frame();
    const hop = i % 2 === 1 ? -1 : 0;
    blit(g, base, 2, y0 + hop);
    const fy = f - 1;
    const mid = Math.round(f / 2);
    for (const off of feet[i]) g[fy][mid + off] = DARK_OUTLINE;
    frames.push(g);
  }
  // attack : armé en arrière, fente en avant avec un trait de coup, retour.
  for (const [dx, slash] of [
    [1, false],
    [4, true],
    [3, false],
  ] as const) {
    const g = frame();
    blit(g, base, dx, y0);
    if (slash) {
      const x = Math.min(f - 1, dx + s);
      for (let k = 0; k < 4; k++) {
        const y = Math.round(f * 0.35) + k;
        if (g[y]) g[y][Math.min(f - 1, x - (k === 0 || k === 3 ? 1 : 0))] = '#ffffff';
      }
    }
    frames.push(g);
  }
  // death : bascule en arrière jusqu'au sol, en s'assombrissant.
  const square = frame();
  blit(square, base, 2, 2);
  [20, 45, 70, 90].forEach((deg, i) => {
    const turned = rotate(square, -deg);
    const g = frame();
    blit(g, turned, 0, f - 1 - bottom(turned), 1 - 0.12 * (i + 1));
    frames.push(g);
  });
  return { frames, frameSize: f };
}

/** Assemble les images côte à côte. */
export function sheetGrid(sheet: Sheet): PixelGrid {
  const out = emptyGrid(sheet.frameSize * sheet.frames.length, sheet.frameSize);
  sheet.frames.forEach((g, i) => blit(out, g, i * sheet.frameSize, 0));
  return out;
}
