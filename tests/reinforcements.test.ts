import { describe, expect, it } from 'vitest';
import { loadGameData, parseGameData, rawGameData } from '../src/data';
import { Battle, type BattleEvent } from '../src/sim';

const data = loadGameData();

function events(b: Battle): { t: number; e: BattleEvent }[] {
  const out: { t: number; e: BattleEvent }[] = [];
  while (!b.result) {
    b.step();
    for (const e of b.events) out.push({ t: b.time, e });
  }
  return out;
}

describe('renforts du public', () => {
  it('des supporters sautent dans l\'arène et se battent', () => {
    let spawned = 0;
    let fanAttacks = 0;
    for (let s = 90000; s < 90010; s++) {
      const b = new Battle(data, { seed: s });
      for (const { e } of events(b)) {
        if (e.type === 'spawn') spawned++;
        if (e.type === 'attack' && b.units[e.unit].defId.endsWith('_fan')) fanAttacks++;
      }
    }
    expect(spawned).toBeGreaterThan(0);
    expect(fanAttacks).toBeGreaterThan(0);
  });

  it('pas de renforts après la date limite de l\'événement', () => {
    for (let s = 90000; s < 90010; s++) {
      for (const { t, e } of events(new Battle(data, { seed: s }))) {
        if (e.type === 'incident' && e.event.startsWith('fans')) expect(t).toBeLessThan(58);
      }
    }
  });

  it('un renfort vers une unité du mauvais camp est refusé', () => {
    const d = structuredClone(rawGameData) as unknown as Record<string, any>;
    d.events.find((e: any) => e.id === 'fans_both').effects[0].units.gnomes = 'goblin_fan';
    expect(() => parseGameData(d)).toThrow(/goblin_fan appartient au camp goblins/);
  });
});

describe('tourbillon et rebonds', () => {
  it("l'épée frappe en tourbillon autour du héros", () => {
    const b = new Battle(data, { seed: 3, upgrades: { bob: ['magic_sword'] } });
    const bob = b.units.find((u) => u.hero?.id === 'bob')!;
    const whirls = events(b).filter(({ e }) => e.type === 'effect' && e.visual === 'whirlwind' && e.source === bob.index);
    expect(whirls.length).toBeGreaterThan(0);
  });

  it('les gros reculs font rebondir les unités', () => {
    const bounces = events(new Battle(data, { seed: '90001' })).filter(({ e }) => e.type === 'bounce');
    expect(bounces.length).toBeGreaterThan(0);
  });

  it('le laser se charge 0,8 s avant de frapper', () => {
    const b = new Battle(data, { seed: 4, upgrades: { kevin: ['laser_goggles'] } });
    const list = events(b);
    const charge = list.find(({ e }) => e.type === 'beamCharge');
    expect(charge).toBeDefined();
    const fire = list.find(({ t, e }) => e.type === 'beam' && e.width && t > charge!.t);
    expect(fire!.t - charge!.t).toBeCloseTo(0.8, 1);
  });
});
