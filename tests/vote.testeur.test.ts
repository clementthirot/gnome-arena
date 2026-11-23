// Tests du testeur : à copier dans tests/ (imports relatifs à tests/). Ils ÉCHOUENT sur le code actuel.
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import { countVotes, parseArc, voteWinner } from '../src/data/arc';

const data = loadGameData();

describe('vote : cas limites (bugs testeur)', () => {
  it('B1 un vote sans aucune voix est refusé (sinon l’option 1 gagne en silence, sans retour possible)', () => {
    expect(() => voteWinner(['laser_goggles', 'magic_sword', 'grenades'], [0, 0, 0])).toThrow();
  });

  it('B2 des comptes qui ne correspondent pas aux options sont refusés (sinon upgrade undefined)', () => {
    expect(() => voteWinner(['a', 'b'], [0, 0, 5])).toThrow();
  });

  it('B3 export multi-colonnes : le nombre de likes après le texte ne compte pas comme un vote', () => {
    expect(countVotes('alice\ttrop bien la vidéo\t3\n', 3)).toEqual([0, 0, 0]);
  });

  it('B4 un héros qui possède 5 upgrades sur 6 peut encore recevoir la dernière (plan ne doit pas planter)', () => {
    const eqs = ['laser_goggles', 'magic_sword', 'grenades', 'glue_bomb', 'chicken_launcher', 'iron_pot'];
    const episodes = eqs.slice(0, 5).map((up, i) => ({
      number: i + 1, seed: String(i), winner: 'goblins', duration: 40, recipient: 'bob',
      options: [up, ...eqs.filter((e) => !eqs.slice(0, i + 1).includes(e))].slice(0, 2), votes: [1, 0], upgrade: up,
    }));
    episodes.push({ number: 6, seed: '6', winner: 'goblins', duration: 40, recipient: 'bob', options: ['iron_pot'], votes: null as never, upgrade: null as never });
    expect(() => parseArc({ id: 't', title: 't', heroes: ['bob', 'kevin', 'grok', 'snik'], episodes }, data)).not.toThrow();
  });
});
