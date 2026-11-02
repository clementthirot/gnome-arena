import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePng, pngSize } from '../scripts/lib/png';
import manifest from '../src/render/assets.manifest.json';
import { placeholderPixels } from '../src/render/pixels';
import { buildSheet, SHEET_FRAMES, SHEET_LAYOUT, sheetGrid } from '../src/render/spriteFrames';

const PUBLIC = join(import.meta.dirname, '../public');

describe('sprite sheets', () => {
  it('une sheet générée suit la disposition standard', () => {
    const sheet = buildSheet(placeholderPixels({ body: 'gnome', size: 12, color: '#5b8def', accent: '#d83b3b', mark: 'none' }));
    expect(sheet.frames).toHaveLength(SHEET_FRAMES);
    for (const f of sheet.frames) {
      expect(f).toHaveLength(sheet.frameSize);
      expect(f.every((row) => row.length === sheet.frameSize)).toBe(true);
      expect(f.some((row) => row.some(Boolean))).toBe(true);
    }
    const last = Math.max(...Object.values(SHEET_LAYOUT).flatMap((a) => [...a.frames]));
    expect(last).toBe(SHEET_FRAMES - 1);
  });

  it('le PNG écrit se relit avec les bonnes dimensions', () => {
    const grid = sheetGrid(buildSheet(placeholderPixels({ body: 'goblin', size: 20, color: '#7cc243', accent: '#7a4a26', mark: 'bow', outline: '#fff4c2' })));
    expect(pngSize(encodePng(grid))).toEqual({ width: grid[0].length, height: grid.length });
  });

  it('chaque image référencée par le manifeste existe et a le bon découpage', () => {
    for (const [key, entry] of Object.entries<Record<string, any>>(manifest.assets)) {
      if (entry.type !== 'spritesheet') continue;
      const file = join(PUBLIC, entry.url);
      expect(existsSync(file), key).toBe(true);
      const { width, height } = pngSize(readFileSync(file));
      expect(height, key).toBe(entry.frameHeight);
      expect(width % entry.frameWidth, key).toBe(0);
      const frames = width / entry.frameWidth;
      for (const anim of Object.values<Record<string, number[]>>(entry.animations)) expect(Math.max(...anim.frames), key).toBeLessThan(frames);
      // Une silhouette de secours permet de jouer même si l'image disparaît.
      expect(entry.placeholder, key).toBeDefined();
    }
    for (const [key, entry] of Object.entries<Record<string, any>>(manifest.accessories)) {
      if (entry.type === 'image') expect(existsSync(join(PUBLIC, entry.url)), key).toBe(true);
    }
  });
});
