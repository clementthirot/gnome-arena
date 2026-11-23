// Boucle d'upgrade partagée par la CLI et la régie (src/data/arc.ts).
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import {
  cancelVote,
  canCancelVote,
  freeUpgrades,
  normalizeUpgrades,
  parseArc,
  previousVote,
  proposeOptions,
  recipientCandidates,
  suggestRecipient,
  type Arc,
} from '../src/data/arc';

// Catalogue figé aux 6 upgrades d'origine : les comptes de saturation ne dépendent pas des upgrades ajoutées ensuite.
const ORIGINAL = ['laser_goggles', 'magic_sword', 'grenades', 'glue_bomb', 'chicken_launcher', 'iron_pot'];
const full = loadGameData();
const data = { ...full, equipment: full.equipment.filter((e) => ORIGINAL.includes(e.id)) };
const heroes = ['bob', 'kevin', 'grok', 'snik'];
const empty = (): Arc => parseArc({ id: 'loop', title: 'Boucle', heroes, episodes: [] }, data);

/** Arc où un héros a reçu les upgrades données (un épisode par upgrade, son camp perd à chaque fois). */
function arcWith(hero: string, ups: string[], extra: Record<string, unknown>[] = []): Arc {
  const winner = hero === 'bob' || hero === 'kevin' ? 'goblins' : 'gnomes';
  const episodes = ups.map((up, i) => ({ number: i + 1, seed: String(i), winner, duration: 40, recipient: hero, options: [up], votes: [1], upgrade: up }));
  return parseArc({ id: 'loop', title: 'Boucle', heroes, episodes: [...episodes, ...extra] }, data);
}

describe("boucle d'upgrade", () => {
  it('options : tirage déterministe, varié selon la seed, sans upgrade possédée', () => {
    const arc = arcWith('grok', ['laser_goggles']);
    const a = proposeOptions(arc, 2, 'grok', '77', data);
    expect(proposeOptions(arc, 2, 'grok', '77', data)).toEqual(a);
    expect(a.options).toHaveLength(3);
    expect(a.options).not.toContain('laser_goggles');
    expect(new Set(a.options).size).toBe(3);
    const seen = new Set(Array.from({ length: 30 }, (_, i) => proposeOptions(arc, 2, 'grok', String(i), data).options.join()));
    expect(seen.size).toBeGreaterThan(3);
  });

  it("options : filtre par rôle (pas d'épée magique pour un archer)", () => {
    for (let i = 0; i < 20; i++) expect(proposeOptions(empty(), 1, 'kevin', String(i), data).options).not.toContain('magic_sword');
    expect(freeUpgrades(empty(), 1, 'bob', data)).toContain('magic_sword');
  });

  it("options : 2 s'il n'en reste que 2, héros saturé signalé ensuite", () => {
    const two = proposeOptions(arcWith('bob', ['laser_goggles', 'magic_sword', 'grenades', 'glue_bomb']), 5, 'bob', '1', data);
    expect(two.options.sort()).toEqual(['chicken_launcher', 'iron_pot']);
    expect(two.saturated).toBe(false);
    const one = proposeOptions(arcWith('bob', ['laser_goggles', 'magic_sword', 'grenades', 'glue_bomb', 'iron_pot']), 6, 'bob', '1', data);
    expect(one).toMatchObject({ options: ['chicken_launcher'], saturated: true });
  });

  it('bénéficiaire suggéré : le moins équipé du camp perdant, hors héros saturés', () => {
    const arc = arcWith('bob', ['laser_goggles']);
    expect(suggestRecipient(arc, 2, 'goblins', {}, data)).toBe('kevin');
    expect(suggestRecipient(arc, 2, 'gnomes', { grok: 3, snik: 1 }, data)).toBe('snik');
    // Kevin (archer) n'a que 5 upgrades possibles : saturé à 4, Bob est alors préféré malgré ses upgrades.
    const full = arcWith('kevin', ['laser_goggles', 'grenades', 'glue_bomb', 'iron_pot']);
    expect(recipientCandidates(full, 5, 'goblins', {}, data).map((c) => [c.hero, c.saturated])).toEqual([['bob', false], ['kevin', true]]);
    expect(suggestRecipient(full, 5, 'goblins', {}, data)).toBe('bob');
  });

  it('match nul : pas de camp perdant, pas de bénéficiaire, épisode refusé', () => {
    expect(suggestRecipient(empty(), 1, 'draw', {}, data)).toBeUndefined();
    expect(() =>
      parseArc({ id: 'loop', title: 'B', heroes, episodes: [{ number: 1, seed: '1', winner: 'draw', duration: 40, recipient: 'bob', options: ['grenades', 'glue_bomb'] }] }, data),
    ).toThrow(/match nul/);
  });

  it("annuler un vote : possible tant que l'épisode suivant n'est pas figé", () => {
    const arc = arcWith('grok', ['laser_goggles', 'grenades']);
    expect(canCancelVote(arc, 1)).toBe(false);
    expect(() => cancelVote(arc, 1)).toThrow(/non annulable/);
    const undone = cancelVote(arc, 2);
    expect(undone.episodes[1]).toMatchObject({ votes: null, upgrade: null });
    expect(arc.episodes[1].upgrade).toBe('grenades');
  });

  it("vote précédent : celui de l'épisode n-1, pour la révélation", () => {
    const arc = arcWith('grok', ['laser_goggles']);
    expect(previousVote(arc, 1, data)).toBeNull();
    expect(previousVote(arc, 2, data)).toEqual({ recipient: 'grok', team: 'goblins', upgrade: 'laser_goggles', options: ['laser_goggles'], votes: [1] });
    expect(previousVote(arc, 3, data)).toBeNull();
  });

  it('upgrades saisies à la main : doublons retirés, identifiant inconnu refusé (B9)', () => {
    expect(normalizeUpgrades({ bob: ['grenades', 'grenades'] }, data)).toEqual({ bob: ['grenades'] });
    expect(() => normalizeUpgrades({ bob: ['lazer_goggles'] }, data)).toThrow(/lazer_goggles/);
    expect(() => normalizeUpgrades({ bobo: ['grenades'] }, data)).toThrow(/bobo/);
  });
});
