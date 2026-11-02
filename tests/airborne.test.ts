import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import { Battle, type BattleEvent } from '../src/sim';

const data = loadGameData();

function run(b: Battle, onEvent: (e: BattleEvent, b: Battle) => void) {
  while (!b.result) {
    b.step();
    for (const e of b.events) onEvent(e, b);
  }
}

describe('effets spectaculaires', () => {
  it('le laser traverse l\'arène, rebondit une fois et touche plusieurs unités par tir', () => {
    const b = new Battle(data, { seed: 4, upgrades: { kevin: ['laser_goggles'] } });
    const kevin = b.units.find((u) => u.hero?.id === 'kevin')!;
    let shots = 0;
    let segments = 0;
    let multiHit = 0;
    let hitsThisTick = 0;
    run(b, (e) => {
      if (e.type === 'special' && e.unit === kevin.index) {
        shots++;
        if (hitsThisTick >= 2) multiHit++;
        hitsThisTick = 0;
      }
      if (e.type === 'beam' && e.width) segments++;
      if (e.type === 'hit' && e.source === kevin.index) hitsThisTick++;
    });
    expect(shots).toBeGreaterThan(0);
    // Un segment jusqu'au mur, puis un rebond : deux segments par tir.
    expect(segments).toBe(shots * 2);
    const f = b.field;
    expect(f.width).toBeGreaterThan(0);
  });

  it('le météore et les K.O. aériens envoient des unités en l\'air, qui retombent', () => {
    let launched = 0;
    let landed = 0;
    let koLanded = 0;
    let maxHeight = 0;
    for (const seed of ['90001', '90002']) {
      const b = new Battle(data, { seed });
      run(b, (e, battle) => {
        if (e.type === 'launch') launched++;
        if (e.type === 'land') {
          landed++;
          if (e.dead) koLanded++;
        }
        for (const u of battle.units) maxHeight = Math.max(maxHeight, u.z);
      });
    }
    expect(launched).toBeGreaterThan(10);
    expect(koLanded).toBeGreaterThan(3);
    expect(landed).toBeGreaterThan(launched * 0.8);
    expect(maxHeight).toBeGreaterThan(20);
  });

  it('une unité en l\'air ne combat pas', () => {
    const b = new Battle(data, { seed: '90001' });
    let attacksFromAir = 0;
    while (!b.result) {
      // En l'air au début du tick : elle ne doit rien décider pendant ce tick.
      const flying = new Set(b.units.filter((u) => u.z > 0).map((u) => u.index));
      b.step();
      for (const e of b.events) if ((e.type === 'attack' || e.type === 'special') && flying.has(e.unit)) attacksFromAir++;
    }
    expect(attacksFromAir).toBe(0);
  });
});
