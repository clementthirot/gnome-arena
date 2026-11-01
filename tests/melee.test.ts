import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import { Battle } from '../src/sim';
import { aggregate, simulate, TARGET_WINDOW } from '../src/tools/metrics';

const data = loadGameData();

describe('mêlée vivante', () => {
  it('la mêlée bouge en permanence : la plupart des unités se déplacent chaque seconde', () => {
    for (const seed of [1, 2, 3]) {
      const b = new Battle(data, { seed });
      let last = b.units.map((u) => ({ x: u.x, y: u.y }));
      const ratios: number[] = [];
      while (!b.result) {
        b.step();
        if (b.tick % b.data.battle.tickRate !== 0) continue;
        const alive = b.units.filter((u) => u.state !== 'dead');
        const moving = alive.filter((u) => Math.hypot(u.x - last[u.index].x, u.y - last[u.index].y) > 3);
        if (alive.length > 6) ratios.push(moving.length / alive.length);
        last = b.units.map((u) => ({ x: u.x, y: u.y }));
      }
      const avg = ratios.reduce((s, r) => s + r, 0) / ratios.length;
      expect(avg).toBeGreaterThan(0.7);
      expect(Math.min(...ratios)).toBeGreaterThan(0.4);
    }
  });

  it.each([5, 6, 7, 8, 9, 10])('pas de duel figé (seed %i) : aucune paire ne reste collée sans bouger plus de 6 s', (seed) => {
    const b = new Battle(data, { seed });
    const still = new Map<string, number>();
    let longest = 0;
    let last = b.units.map((u) => ({ x: u.x, y: u.y }));
    while (!b.result) {
      b.step();
      if (b.tick % 15 !== 0) continue;
      for (const u of b.units) {
        if (u.state === 'dead' || u.target < 0) continue;
        const key = `${u.index}>${u.target}`;
        const moved = Math.hypot(u.x - last[u.index].x, u.y - last[u.index].y);
        const t = moved < 1.5 ? (still.get(key) ?? 0) + 0.5 : 0;
        still.set(key, t);
        longest = Math.max(longest, t);
      }
      last = b.units.map((u) => ({ x: u.x, y: u.y }));
    }
    expect(longest).toBeLessThan(6);
  });

  it('les attaquants par cible restent limités la plupart du temps', () => {
    const b = new Battle(data, { seed: 3 });
    const max = data.battle.rules.maxAttackersPerTarget;
    let samples = 0;
    let over = 0;
    while (!b.result) {
      b.step();
      const counts = new Map<number, number>();
      for (const u of b.units) {
        if (u.state === 'attack' && u.role.attacks.some((a) => a.kind === 'melee')) counts.set(u.target, (counts.get(u.target) ?? 0) + 1);
      }
      for (const c of counts.values()) {
        samples++;
        if (c > max) over++;
      }
    }
    expect(over / samples).toBeLessThan(0.1);
  });
});

describe('durée des combats', () => {
  it(`les réglages livrés visent ${TARGET_WINDOW[0]}–${TARGET_WINDOW[1]} s`, () => {
    const report = aggregate(Array.from({ length: 30 }, (_, i) => simulate(data, { seed: 1000 + i })));
    expect(report.avgDuration).toBeGreaterThan(TARGET_WINDOW[0] - 3);
    expect(report.avgDuration).toBeLessThan(TARGET_WINDOW[1]);
    expect(report.maxDuration).toBeLessThanOrEqual(data.battle.ending.hardCap + 0.05);
    expect(report.inTargetWindow).toBeGreaterThan(0.7);
    expect(Math.min(report.winRate.gnomes, report.winRate.goblins)).toBeGreaterThan(0.25);
  });
});
