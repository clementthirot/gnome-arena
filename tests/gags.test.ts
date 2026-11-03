import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import { Battle, type BattleEvent } from '../src/sim';

const data = loadGameData();

function collect(seeds: number[]): { b: Battle; e: BattleEvent }[] {
  const out: { b: Battle; e: BattleEvent }[] = [];
  for (const seed of seeds) {
    const b = new Battle(data, { seed });
    while (!b.result) {
      b.step();
      for (const e of b.events) out.push({ b, e });
    }
  }
  return out;
}

const seeds = Array.from({ length: 12 }, (_, i) => 90000 + i);
const all = collect(seeds);
const gags = (kind: string) => all.filter(({ e }) => e.type === 'gag' && e.kind === kind);

describe('gags slapstick', () => {
  it('chaque gag respecte son plafond par combat', () => {
    const g = data.battle.gags;
    for (const [kind, cap] of [['dance', g.victoryDance.cap], ['weaponLost', g.lostWeapon.cap], ['headClash', g.headClash.cap]] as const) {
      const perBattle = new Map<Battle, number>();
      for (const { b } of gags(kind)) perBattle.set(b, (perBattle.get(b) ?? 0) + 1);
      for (const n of perBattle.values()) expect(n).toBeLessThanOrEqual(cap);
    }
  });

  it("l'effet bowling étourdit ceux sur qui une unité retombe", () => {
    expect(gags('bowled').length).toBeGreaterThan(0);
  });

  it('une arme perdue est toujours ramassée (ou abandonnée) : pas de recherche infinie', () => {
    expect(gags('weaponFound').length).toBe(gags('weaponLost').length);
  });

  it('les objets lancés par le public étourdissent leur cible', () => {
    const throws = all.filter(({ e }) => e.type === 'incident' && (e.event === 'tomato' || e.event === 'shoe'));
    expect(throws.length).toBeGreaterThan(0);
    expect(all.some(({ e }) => e.type === 'stun' && e.duration >= 1.2)).toBe(true);
  });
});
