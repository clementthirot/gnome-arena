import { describe, expect, it } from 'vitest';
import { loadGameData, parseGameData, rawGameData } from '../src/data';
import manifest from '../src/render/assets.manifest.json';
import { Battle } from '../src/sim';

const raw = () => structuredClone(rawGameData) as unknown as Record<string, any>;

describe('données JSON', () => {
  it('les données livrées sont valides', () => {
    expect(() => loadGameData()).not.toThrow();
  });

  it('une armée par défaut compte 50 unités par camp, héros compris', () => {
    const b = new Battle(loadGameData(), { seed: 1 });
    expect(b.alive('gnomes')).toHaveLength(50);
    expect(b.alive('goblins')).toHaveLength(50);
  });

  it('ajouter une unité = un ajout dans le JSON', () => {
    const d = raw();
    d.units.push({
      id: 'gnome_bombardier', team: 'gnomes', label: 'Gnome bombardier', role: 'archer', visual: 'gnome_bombardier',
      hp: 30, damage: 8, speed: 25, radius: 5, personalities: { coward: 1 },
    });
    d.battle.armies.gnomes.gnome_bombardier = 4;
    const b = new Battle(parseGameData(d), { seed: 1 });
    expect(b.units.filter((u) => u.defId === 'gnome_bombardier')).toHaveLength(4);
    expect(b.runToEnd().winner).toBeDefined();
  });

  it('ajouter un héros = un ajout dans le JSON', () => {
    const d = raw();
    d.heroes.push({ id: 'zizi', name: 'Zizi', label: 'la rapide', base: 'goblin_melee', visual: 'hero_zizi', personality: 'reckless', stats: { speed: 1.4 } });
    const b = new Battle(parseGameData(d), { seed: 1 });
    const zizi = b.units.find((u) => u.hero?.id === 'zizi');
    expect(zizi?.team).toBe('goblins');
    expect(zizi?.personality.id).toBe('reckless');
  });

  it("chaque clé visuelle des JSON existe dans le manifeste d'assets", () => {
    const d = loadGameData();
    const keys = [...d.units.map((u) => u.visual), ...d.heroes.map((h) => h.visual)];
    expect(keys.filter((k) => !(k in manifest.assets))).toEqual([]);
  });

  it('une référence cassée est signalée clairement', () => {
    const d = raw();
    d.units[0].role = 'catapulte';
    expect(() => parseGameData(d)).toThrow(/rôle inconnu : catapulte/);
  });

  it('des réglages incohérents sont refusés', () => {
    const d = raw();
    d.battle.ending.shrinkEnd = d.battle.ending.shrinkStart;
    expect(() => parseGameData(d)).toThrow(/shrinkStart < shrinkEnd/);
  });
});
