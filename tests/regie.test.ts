import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import { episodeSetup, parseArc, withSettings } from '../src/data/arc';
import { endType, scoutScore, simulate } from '../src/tools/metrics';

const data = loadGameData();

describe('réglages de la régie', () => {
  it("les réglages s'appliquent sans toucher aux données d'origine", () => {
    const d = withSettings(data, { biome: 'neige', eventsPerMinute: 0, eventWeights: { meteor: 0 }, gagChances: { victoryDance: 0 } });
    expect(d.battle.biome).toBe('neige');
    expect(d.events.some((e) => e.id === 'meteor')).toBe(false);
    expect(d.battle.gags.victoryDance.chance).toBe(0);
    expect(data.battle.biome).toBe('sable');
    expect(data.events.some((e) => e.id === 'meteor')).toBe(true);
  });

  it('un épisode figé garde ses réglages même si ceux de l\'arc changent ensuite', () => {
    const base = { id: 't', title: 'T', heroes: ['bob', 'grok'], settings: { biome: 'neige' } };
    const s1 = episodeSetup(parseArc(base, data), 1, '42', data);
    const before = simulate(s1.data, s1.setup);
    const arc = parseArc(
      { ...base, settings: { biome: 'volcan', eventsPerMinute: 0 }, episodes: [{ number: 1, seed: '42', winner: before.winner, duration: before.duration, recipient: 'bob', options: ['grenades', 'glue_bomb', 'iron_pot'], settings: s1.settings }] },
      data,
    );
    const replay = episodeSetup(arc, 1, '42', data);
    expect(simulate(replay.data, replay.setup)).toEqual(before);
    expect(episodeSetup(arc, 2, '42', data).settings.biome).toBe('volcan');
  });

  it('un réglage invalide est refusé', () => {
    expect(() => parseArc({ id: 't', title: 'T', heroes: ['bob', 'grok'], settings: { eventWeights: { ovni: 2 } } }, data)).toThrow(/incident inconnu ovni/);
  });

  it('le scout pénalise une fin identique à celle de l\'épisode précédent', () => {
    const s = simulate(data, { seed: 1009 });
    expect(scoutScore(s, endType(s))).toBeCloseTo(scoutScore(s) / 2);
  });
});
