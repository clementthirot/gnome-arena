import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import { Battle } from '../src/sim';

const data = loadGameData();

/** Empreinte complète de l'état : positions, PV et états de toutes les unités. */
function fingerprint(b: Battle): string {
  return b.units.map((u) => `${u.x.toFixed(6)},${u.y.toFixed(6)},${u.hp.toFixed(6)},${u.state},${u.target}`).join('|');
}

describe('déterminisme', () => {
  it('même seed = même combat, tick pour tick', () => {
    const a = new Battle(data, { seed: 42 });
    const b = new Battle(data, { seed: 42 });
    while (!a.result) {
      a.step();
      b.step();
      if (a.tick % 150 === 0) expect(fingerprint(b)).toBe(fingerprint(a));
    }
    expect(b.result).toEqual(a.result);
    expect(fingerprint(b)).toBe(fingerprint(a));
  });

  it('les seeds texte sont acceptées et reproductibles', () => {
    const r1 = new Battle(data, { seed: 'episode-1' }).runToEnd();
    const r2 = new Battle(data, { seed: 'episode-1' }).runToEnd();
    expect(r2).toEqual(r1);
  });

  it('des seeds différentes donnent des combats différents', () => {
    const durations = new Set([1, 2, 3, 4, 5].map((seed) => new Battle(data, { seed }).runToEnd().duration.toFixed(2)));
    expect(durations.size).toBeGreaterThan(3);
  });
});

describe('déterminisme entre moteurs JS', () => {
  // La précision de ces fonctions dépend du moteur (Node, Chrome, Safari...) : une seed
  // mesurée en ligne de commande donnerait un autre combat dans le navigateur.
  it("le moteur n'utilise ni Math.random ni de fonction mathématique à précision libre", () => {
    const dir = join(import.meta.dirname, '../src/sim');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'detmath.ts')) {
      const code = readFileSync(join(dir, file), 'utf8').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/Math\.(random|hypot|sin|cos|tan|pow|exp|log|atan|cbrt|sinh|cosh)\b/);
    }
  });
});
