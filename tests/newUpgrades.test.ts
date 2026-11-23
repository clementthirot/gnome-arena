// Nouvelles upgrades et incident du lot D : elles se déclenchent, et restent déterministes.
import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import { loadGameData, parseGameData, rawGameData } from '../src/data';
import { Battle, type BattleEvent } from '../src/sim';
import { upgradeFx } from '../src/render/upgradeFx';

const data = loadGameData();

function collect(b: Battle): BattleEvent[] {
  const all: BattleEvent[] = [];
  while (!b.result) {
    b.step();
    all.push(...b.events);
  }
  return all;
}

const heroIndex = (b: Battle, id: string) => b.units.find((u) => u.hero?.id === id)!.index;

describe('nouvelles upgrades', () => {
  it('tarte à la crème : la spéciale étourdit, et le combat est reproductible', () => {
    const setup = { seed: 5, upgrades: { grok: ['cream_pie'] } };
    const b = new Battle(data, setup);
    const grok = heroIndex(b, 'grok');
    const events = collect(b);
    expect(events.filter((e) => e.type === 'special' && e.unit === grok && e.ability === 'cream_pie').length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'effect' && e.visual === 'cream_splat')).toBe(true);
    expect(events.some((e) => e.type === 'stun')).toBe(true);
    expect(new Battle(data, setup).runToEnd()).toEqual(b.result);
  });

  it('parapluie à foudre : un éclair en chaîne sur plusieurs cibles, puissance 0,9', () => {
    const eq = data.equipment.find((e) => e.id === 'storm_umbrella')!;
    expect(eq.special!.effects[0]).toMatchObject({ type: 'ricochet', power: 0.9 });
    const setup = { seed: 4, upgrades: { kevin: ['storm_umbrella'] } };
    const b = new Battle(data, setup);
    const events = collect(b);
    expect(events.filter((e) => e.type === 'beam' && e.visual === 'storm_bolt').length).toBeGreaterThan(1);
    expect(new Battle(data, setup).runToEnd()).toEqual(b.result);
  });

  it('sifflet à supporters : des fans du camp du lanceur sautent des gradins ; raté = fans adverses', () => {
    let own = 0;
    let enemy = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const b = new Battle(data, { seed, upgrades: { grok: ['fan_whistle'] } });
      const grok = b.units[heroIndex(b, 'grok')];
      let misfire: boolean | null = null;
      while (!b.result) {
        b.step();
        for (const e of b.events) {
          if (e.type === 'special' && e.unit === grok.index) misfire = e.misfire;
          if (e.type === 'spawn' && misfire !== null && b.units[e.unit].defId.endsWith('_fan')) {
            if (b.units[e.unit].team === grok.team) own++;
            else enemy++;
          }
        }
        misfire = null;
      }
    }
    expect(own).toBeGreaterThan(0);
    expect(enemy).toBeGreaterThan(0);
    const setup = { seed: 2, upgrades: { kevin: ['fan_whistle'] } };
    expect(new Battle(data, setup).runToEnd()).toEqual(new Battle(data, setup).runToEnd());
  });

  it('casserole en fonte : « BONG ! » au rendu quand elle encaisse, sans changer la simulation', () => {
    const texts: string[] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ['setOrigin', 'setDepth', 'setAngle', 'setScale', 'setFlipX', 'destroy']) chain[m] = () => chain;
    const scene = {
      add: { text: (_x: number, _y: number, t: string) => (texts.push(t), chain), image: () => ({ ...chain, height: 8 }) },
      tweens: { add: () => undefined },
      textures: { exists: () => true, addCanvas: () => undefined },
    } as unknown as Phaser.Scene;
    const run = () => {
      texts.length = 0;
      const b = new Battle(data, { seed: 3, upgrades: { bob: ['iron_pot'] } });
      while (!b.result) {
        b.step();
        for (const e of b.events) upgradeFx(scene, e, b, 4);
      }
      return [...texts];
    };
    const first = run();
    expect(first.filter((t) => t === 'BONG !').length).toBeGreaterThan(0);
    expect(run()).toEqual(first);
    // Stats inchangées : PV ×1,45 comme avant.
    expect(data.equipment.find((e) => e.id === 'iron_pot')!.stats).toMatchObject({ hp: 1.45, mass: 1.4, speed: 0.95 });
  });
});

describe('incident « poule géante »', () => {
  it('désactivé par défaut : les seeds existantes ne changent pas', () => {
    const raw = structuredClone(rawGameData) as unknown as { events: { id: string }[] };
    raw.events = raw.events.filter((e) => e.id !== 'giant_chicken');
    const without = parseGameData(raw);
    for (const seed of [1, 7]) expect(new Battle(data, { seed }).runToEnd()).toEqual(new Battle(without, { seed }).runToEnd());
  });

  it('activé : elle traverse l\'arène et bouscule tout le monde, de façon reproductible', () => {
    const raw = structuredClone(rawGameData) as unknown as { events: { id: string; enabled?: boolean; weight: number }[] };
    for (const e of raw.events) if (e.id === 'giant_chicken') Object.assign(e, { enabled: true, weight: 1000 });
    const d = parseGameData(raw);
    const b = new Battle(d, { seed: 2 });
    const events = collect(b);
    expect(events.some((e) => e.type === 'incident' && e.event === 'giant_chicken')).toBe(true);
    expect(events.some((e) => e.type === 'beam' && e.visual === 'giant_chicken')).toBe(true);
    expect(new Battle(d, { seed: 2 }).runToEnd()).toEqual(b.result);
  });
});
