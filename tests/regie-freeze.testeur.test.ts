// Un épisode figé depuis une ligne du scout doit se rejouer à l'identique (bug testeur B3/B5).
// La ligne du scout a été calculée avec les réglages de l'arc au moment du scout ; si l'arc a été
// ré-enregistré entre-temps (« Enregistrer les réglages »), « Figer l'épisode » doit le voir et
// refuser, au lieu d'écrire un combat différent de celui qui a été montré.
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import { episodeSetup, parseArc, type Arc } from '../src/data/arc';
import { freezeEpisode } from '../src/regie/freeze';
import { simulate } from '../src/tools/metrics';

const data = loadGameData();
const base = (): Arc => parseArc({ id: 't', title: 't', heroes: ['bob', 'kevin', 'grok', 'snik'], episodes: [] }, data);
const choiceFor = (winner: string) => ({ recipient: winner === 'gnomes' ? 'grok' : 'bob', options: ['laser_goggles', 'grenades', 'glue_bomb'] });

describe('régie : figer un épisode (bug testeur B5)', () => {
  it('le combat figé est celui que le scout a montré', () => {
    const arc = base();
    const s = episodeSetup(arc, 1, '1234', data);
    const row = simulate(s.data, s.setup);
    const frozen = freezeEpisode(arc, 1, '1234', choiceFor(row.winner), data, row).arc;
    const e = episodeSetup(frozen, 1, '1234', data);
    const replay = simulate(e.data, e.setup);
    expect({ winner: replay.winner, duration: Math.round(replay.duration * 10) / 10 }).toEqual({ winner: row.winner, duration: Math.round(row.duration * 10) / 10 });
    expect(frozen.episodes[0]).toMatchObject({ winner: row.winner, duration: Math.round(row.duration * 10) / 10 });
  });

  it('des réglages enregistrés après le scout font refuser le gel (plus de combat fantôme)', () => {
    let arc = base();
    const s = episodeSetup(arc, 1, '1234', data);
    const row = simulate(s.data, s.setup);
    arc = parseArc({ ...arc, settings: { armies: { gnomes: { gnome_melee: 10 } } } }, data);
    expect(() => freezeEpisode(arc, 1, '1234', choiceFor(row.winner), data, row)).toThrow(/relancer le scout/);
  });
});
