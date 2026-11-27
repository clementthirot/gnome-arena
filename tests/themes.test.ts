import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import base from '../src/render/assets.manifest.json';
import { ManifestSchema } from '../src/render/manifest';
import { overlay, THEMES } from '../src/render/themes';

const PUBLIC = join(import.meta.dirname, '../public');

/** Toutes les chaînes .png d'un morceau de manifeste. */
function pngs(node: unknown): string[] {
  if (typeof node === 'string') return node.endsWith('.png') ? [node] : [];
  if (node && typeof node === 'object') return Object.values(node).flatMap(pngs);
  return [];
}

describe('thèmes', () => {
  it('superpose objets, remplace tableaux et valeurs, null retire la clé', () => {
    const out = overlay({ a: { b: 1, c: 2 }, l: [1, 2], d: 'x' }, { a: { c: 3 }, l: [9], d: null });
    expect(out).toEqual({ a: { b: 1, c: 3 }, l: [9] });
  });

  it('le thème de Noël existe', () => {
    expect(THEMES.noel).toBeDefined();
  });

  for (const [id, theme] of Object.entries(THEMES)) {
    it(`${id} : manifeste valide, clés connues, images présentes`, () => {
      expect(() => ManifestSchema.parse(overlay(base, theme.manifest))).not.toThrow();
      const m = (theme.manifest ?? {}) as { assets?: object; accessories?: object };
      expect(Object.keys(m.assets ?? {}).filter((k) => !(k in base.assets))).toEqual([]);
      expect(Object.keys(m.accessories ?? {}).filter((k) => !(k in base.accessories))).toEqual([]);
      expect(pngs(theme.manifest).filter((p) => !existsSync(join(PUBLIC, p)))).toEqual([]);
    });
  }
});
