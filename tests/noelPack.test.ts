import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import { parseArc, votablePool } from '../src/data/arc';
import { Battle, type BattleEvent } from '../src/sim';
import noel from '../src/render/themes/noel.json';

const data = loadGameData();
const roster = (ids: string[]) => ids.map((id) => data.heroes.find((h) => h.id === id)!);
const NOEL = roster(noel.heroes);

function run(b: Battle): { t: number; e: BattleEvent }[] {
  const out: { t: number; e: BattleEvent }[] = [];
  while (!b.result) {
    b.step();
    for (const e of b.events) out.push({ t: b.time, e });
  }
  return out;
}

describe('pack Noël : héros et capacités', () => {
  it('les six héros du pack existent et restent hors du roster par défaut', () => {
    expect(NOEL.every(Boolean)).toBe(true);
    expect(NOEL.every((h) => !h.active)).toBe(true);
    expect(new Set(NOEL.map((h) => data.units.find((u) => u.id === h.base)!.team))).toEqual(new Set(['gnomes', 'goblins']));
  });

  it('les deux transformations sont strictement symétriques', () => {
    const a = data.equipment.find((e) => e.id === 'gingerbread_cloud')!;
    const b = data.equipment.find((e) => e.id === 'coal_cloud')!;
    const strip = (e: typeof a) => JSON.parse(JSON.stringify(e, (k, v) => (['id', 'label', 'short', 'skin', 'visual', 'description'].includes(k) ? undefined : v)));
    expect(strip(a)).toEqual(strip(b));
  });

  it('les deux invocations sont strictement symétriques', () => {
    const a = data.equipment.find((e) => e.id === 'toy_soldiers')!;
    const b = data.equipment.find((e) => e.id === 'mimic_gifts')!;
    const strip = (e: typeof a) => JSON.parse(JSON.stringify(e, (k, v) => (['id', 'label', 'short', 'units', 'unit', 'visual', 'description', 'gnomes', 'goblins'].includes(k) ? undefined : v)));
    expect(strip(a)).toEqual(strip(b));
  });

  it('la transformation fige des unités ennemies, jamais les héros', () => {
    let transformed = 0;
    for (let s = 1; s <= 6; s++) {
      const b = new Battle(data, { seed: s, heroes: NOEL });
      for (const { e } of run(b)) {
        if (e.type !== 'transform') continue;
        transformed++;
        expect(b.units[e.unit].hero).toBeFalsy();
      }
    }
    expect(transformed).toBeGreaterThan(0);
  });

  it('Papy Boulon et Gobbo Claus invoquent leurs unités à côté d\'eux', () => {
    const seen = new Set<string>();
    for (let s = 1; s <= 6; s++) {
      const b = new Battle(data, { seed: s, heroes: NOEL });
      for (const { e } of run(b)) if (e.type === 'spawn') seen.add(b.units[e.unit].defId);
    }
    expect(seen.has('toy_soldier')).toBe(true);
    expect(seen.has('mimic_gift')).toBe(true);
  });

  it('le combat Noël reste déterministe', () => {
    const sig = () => {
      const b = new Battle(data, { seed: 42, heroes: NOEL });
      run(b);
      return JSON.stringify(b.result);
    };
    expect(sig()).toBe(sig());
  });
});

describe('pack Noël : upgrades votables', () => {
  it('sans pool, un arc ne propose que les upgrades de base', () => {
    const ids = votablePool({}, data).map((e) => e.id);
    expect(ids).not.toContain('giant_snowball');
    expect(ids).not.toContain('sleigh_bells');
    expect(ids).not.toContain('forge_slam');
  });

  it('le pool du thème Noël contient les deux nouveautés et aucune capacité innée', () => {
    const ids = votablePool({ upgrades: noel.upgrades }, data).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['giant_snowball', 'sleigh_bells']));
    expect(ids.every((id) => !data.equipment.find((e) => e.id === id)!.innate)).toBe(true);
  });

  it('un arc refuse une capacité innée dans son pool', () => {
    expect(() => parseArc({ id: 'x', title: 'X', heroes: noel.heroes, upgrades: ['forge_slam', 'grenades'], episodes: [] }, data)).toThrow();
  });
});
