import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import { countVotes, parseArc, upgradesBefore, voteWinner, type Arc } from '../src/data/arc';
import arc1 from '../src/data/arcs/arc1.json';
import { Battle } from '../src/sim';

const data = loadGameData();

const sample = (): Arc =>
  parseArc(
    {
      id: 'test',
      title: 'Test',
      heroes: ['bob', 'kevin', 'grok', 'snik'],
      episodes: [
        { number: 1, seed: '10', winner: 'gnomes', duration: 70, recipient: 'grok', options: ['laser_goggles', 'magic_sword', 'grenades'], votes: [3, 9, 2], upgrade: 'magic_sword' },
        { number: 2, seed: '20', winner: 'goblins', duration: 72, recipient: 'kevin', options: ['grenades', 'glue_bomb', 'iron_pot'], votes: [5, 1, 1], upgrade: 'grenades' },
        { number: 3, seed: '30', winner: 'gnomes', duration: 68, recipient: 'grok', options: ['iron_pot', 'grenades', 'glue_bomb'] },
      ],
    },
    data,
  );

describe('arcs et épisodes', () => {
  it("l'arc livré est valide", () => {
    expect(() => parseArc(arc1, data)).not.toThrow();
  });

  it("l'état des héros se reconstruit à partir des votes précédents", () => {
    const arc = sample();
    expect(upgradesBefore(arc, 1)).toEqual({});
    expect(upgradesBefore(arc, 2)).toEqual({ grok: ['magic_sword'] });
    expect(upgradesBefore(arc, 4)).toEqual({ grok: ['magic_sword'], kevin: ['grenades'] });
  });

  it("un épisode se rejoue à l'identique avec l'état de l'arc", () => {
    const arc = sample();
    const setup = { seed: '20', heroes: data.heroes.filter((h) => arc.heroes.includes(h.id)), upgrades: upgradesBefore(arc, 2) };
    const a = new Battle(data, setup);
    const b = new Battle(data, setup);
    expect(a.units.filter((u) => u.hero).map((u) => u.hero!.id).sort()).toEqual(['bob', 'grok', 'kevin', 'snik']);
    expect(b.runToEnd()).toEqual(a.runToEnd());
  });

  it('un arc incohérent est refusé', () => {
    const raw = structuredClone(sample()) as Record<string, any>;
    raw.episodes[0].upgrade = 'iron_pot';
    expect(() => parseArc(raw, data)).toThrow(/ne faisait pas partie des options/);
  });

  it('comptage des votes : une voix par auteur, la dernière compte', () => {
    const text = ['alice;je vote 2 !', 'bob;1', 'alice;finalement 3', 'carla\t2', 'dan;super vidéo', 'eve;12 fois bravo', '2'].join('\n');
    expect(countVotes(text, 3)).toEqual([1, 2, 1]);
    expect(voteWinner(['a', 'b', 'c'], [4, 4, 1])).toBe('a');
  });
});
