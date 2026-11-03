import { describe, expect, it } from 'vitest';
import { loadGameData, parseGameData, rawGameData } from '../src/data';
import { Battle } from '../src/sim';

const data = loadGameData();
const clone = () => structuredClone(rawGameData) as unknown as Record<string, any>;

describe('biomes', () => {
  it('chaque biome se joue et reste déterministe', () => {
    for (const biome of data.biomes) {
      const a = new Battle(data, { seed: 5, biome: biome.id });
      expect(a.biome.id).toBe(biome.id);
      expect(new Battle(data, { seed: 5, biome: biome.id }).runToEnd()).toEqual(a.runToEnd());
    }
  });

  it('la neige est plus glissante : les reculs portent plus loin', () => {
    const slide = (biome: string) => {
      const b = new Battle(data, { seed: 2, biome });
      const u = b.units[0];
      u.kx = 100;
      const x0 = u.x;
      for (let i = 0; i < 15; i++) b.step();
      return Math.abs(u.x - x0);
    };
    expect(slide('neige')).toBeGreaterThan(slide('sable'));
  });

  it('un biome inconnu dans battle.json est refusé', () => {
    const d = clone();
    d.battle.biome = 'lune';
    expect(() => parseGameData(d)).toThrow(/biome inconnu : lune/);
  });
});

describe('unités spéciales et déploiement', () => {
  it('mages gnomes et sorciers gobelins : mêmes stats, même sort', () => {
    const mage = data.units.find((u) => u.id === 'gnome_mage')!;
    const shaman = data.units.find((u) => u.id === 'goblin_shaman')!;
    expect({ ...mage, id: '', team: '', label: '', visual: '' }).toEqual({ ...shaman, id: '', team: '', label: '', visual: '' });
    const d = clone();
    d.battle.armies.gnomes.gnome_mage = 3;
    d.battle.armies.goblins.goblin_shaman = 3;
    const b = new Battle(parseGameData(d), { seed: 3 });
    let spells = 0;
    while (!b.result) {
      b.step();
      for (const e of b.events) if (e.type === 'special' && e.ability === 'caster_sort') spells++;
    }
    expect(spells).toBeGreaterThan(0);
  });

  it('par défaut, aucun mage et aucune réserve', () => {
    expect(data.battle.armies.gnomes.gnome_mage).toBe(0);
    expect(data.battle.deployment.reserveShare).toBe(0);
  });

  it('une réserve entre en seconde vague', () => {
    const d = clone();
    d.battle.deployment.reserveShare = 0.2;
    d.battle.deployment.reserveAt = 10;
    const b = new Battle(parseGameData(d), { seed: 3 });
    const start = b.units.length;
    while (b.time < 11) b.step();
    expect(b.units.length).toBeGreaterThan(start);
  });
});
