import { describe, expect, it } from 'vitest';
import { loadGameData, parseGameData, rawGameData } from '../src/data';
import { Battle, type BattleEvent } from '../src/sim';

const data = loadGameData();

function collect(b: Battle, until = Infinity): BattleEvent[] {
  const all: BattleEvent[] = [];
  while (!b.result && b.time < until) {
    b.step();
    all.push(...b.events);
  }
  return all;
}

describe('équipements', () => {
  it('une upgrade modifie les stats et donne une attaque spéciale', () => {
    const plain = new Battle(data, { seed: 3 });
    const armed = new Battle(data, { seed: 3, upgrades: { grok: ['iron_pot', 'grenades'] } });
    const g0 = plain.units.find((u) => u.hero?.id === 'grok')!;
    const g1 = armed.units.find((u) => u.hero?.id === 'grok')!;
    expect(g1.maxHp).toBeCloseTo(g0.maxHp * 1.45);
    expect(g1.equipment.map((e) => e.id)).toEqual(['iron_pot', 'grenades']);
    const events = collect(armed);
    expect(events.some((e) => e.type === 'special' && e.unit === g1.index)).toBe(true);
  });

  it('les upgrades sont déterministes', () => {
    const setup = { seed: 9, upgrades: { kevin: ['laser_goggles'], snik: ['chicken_launcher'] } };
    expect(new Battle(data, setup).runToEnd()).toEqual(new Battle(data, setup).runToEnd());
  });

  it('les ratés existent et peuvent toucher son propre camp', () => {
    let misfires = 0;
    let friendlyHits = 0;
    for (const seed of [1, 2, 3, 4]) {
      const b = new Battle(data, { seed, upgrades: { bob: ['chicken_launcher'], kevin: ['laser_goggles'], gertrude: ['grenades'] } });
      for (const e of collect(b)) {
        if (e.type === 'special' && e.misfire) misfires++;
        if (e.type === 'hit' && e.source >= 0 && b.units[e.source].team === b.units[e.unit].team && e.source !== e.unit) friendlyHits++;
      }
    }
    expect(misfires).toBeGreaterThan(0);
    expect(friendlyHits).toBeGreaterThan(0);
  });

  it('le laser ricoche sur plusieurs cibles', () => {
    const b = new Battle(data, { seed: 4, upgrades: { kevin: ['laser_goggles'] } });
    expect(collect(b).filter((e) => e.type === 'beam').length).toBeGreaterThan(0);
  });

  it('un nouvel équipement = un ajout dans le JSON', () => {
    const d = structuredClone(rawGameData) as unknown as Record<string, any>;
    d.equipment.push({
      id: 'banana_peel', label: 'Peau de banane', short: 'banane', visual: 'acc_banana',
      special: { maxRange: 40, cooldown: 3, effects: [{ type: 'slow', factor: 0.2, duration: 2, radius: 10 }, { type: 'knockback', force: 120, radius: 10 }] },
    });
    const b = new Battle(parseGameData(d), { seed: 2, upgrades: { morva: ['banana_peel'] } });
    const morva = b.units.find((u) => u.hero?.id === 'morva')!;
    let slowed = false;
    while (!b.result && !slowed) {
      b.step();
      slowed = b.units.some((u) => u.team !== morva.team && u.slowUntil > b.time);
    }
    expect(slowed).toBe(true);
  });

  it('un équipement inconnu dans heroes.json est refusé', () => {
    const d = structuredClone(rawGameData) as unknown as Record<string, any>;
    d.heroes[0].upgrades = ['bazooka'];
    expect(() => parseGameData(d)).toThrow(/équipement inconnu : bazooka/);
  });
});

describe("incidents d'arène", () => {
  it('des incidents surviennent, annoncés puis déclenchés', () => {
    const events = collect(new Battle(data, { seed: 6 }));
    const telegraphs = events.filter((e) => e.type === 'telegraph').length;
    const incidents = events.filter((e) => e.type === 'incident');
    expect(incidents.length).toBeGreaterThan(1);
    expect(telegraphs).toBeGreaterThan(0);
  });

  it("les incidents s'intensifient en fin de combat", () => {
    let early = 0;
    let late = 0;
    let lateSeconds = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const b = new Battle(data, { seed });
      while (!b.result) {
        b.step();
        for (const e of b.events) {
          if (e.type !== 'incident') continue;
          if (b.time < 45) early++;
          else late++;
        }
      }
      lateSeconds += Math.max(0, b.time - 45);
    }
    // Fréquence par seconde : avant 45 s (incidents possibles dès 12 s) contre après.
    const firstAt = data.battle.events.firstAt;
    expect(late / lateSeconds).toBeGreaterThan((early / (10 * (45 - firstAt))) * 1.2);
  });

  it('sans incidents configurés, aucun ne survient', () => {
    const d = structuredClone(rawGameData) as unknown as Record<string, any>;
    d.battle.events.perMinute = 0;
    const events = collect(new Battle(parseGameData(d), { seed: 1 }));
    expect(events.some((e) => e.type === 'incident')).toBe(false);
  });
});
