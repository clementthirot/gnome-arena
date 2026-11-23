// Figer un épisode depuis la régie : on resimule avec les réglages qui seront enregistrés, pour que
// le combat écrit dans l'arc soit exactement celui qui sera enregistré en vidéo (bug B3 du testeur :
// la ligne du scout pouvait dater d'anciens réglages).
import { episodeSetup, heroTeam, loserOf, parseArc, type Arc } from '../data/arc';
import type { GameData, TeamId } from '../data/schema';
import { endType, simulate, WINNER_LABEL, type BattleSummary } from '../tools/metrics';

export interface FreezeChoice {
  recipient: string;
  options: string[];
}

/** Résultat montré à l'auteur (ligne du scout) : le combat resimulé doit lui correspondre. */
export interface ExpectedFight {
  winner: TeamId | 'draw';
  duration: number;
}

/** Arc avec l'épisode n figé, et le combat resimulé. Lance une erreur lisible si quelque chose cloche. */
export function freezeEpisode(arc: Arc, n: number, seed: string, choice: FreezeChoice, data: GameData, expected?: ExpectedFight): { arc: Arc; summary: BattleSummary } {
  if (arc.status !== 'open') throw new Error(`l'arc ${arc.id} est clos`);
  if (n !== arc.episodes.length + 1) throw new Error(`le prochain épisode est le ${arc.episodes.length + 1}, pas le ${n}`);
  if (arc.episodes.some((e) => !e.upgrade)) throw new Error('un vote précédent n’est pas encore compté');
  const setup = episodeSetup(arc, n, seed, data);
  const summary = simulate(setup.data, setup.setup);
  const duration = Math.round(summary.duration * 10) / 10;
  if (expected && (expected.winner !== summary.winner || Math.abs(Math.round(expected.duration * 10) / 10 - duration) > 0.05)) {
    throw new Error(
      `le combat ne correspond plus au scout (${WINNER_LABEL[expected.winner]} en ${expected.duration.toFixed(1)} s montré, ${WINNER_LABEL[summary.winner]} en ${duration.toFixed(1)} s avec les réglages enregistrés) : relancer le scout`,
    );
  }
  const loser = loserOf(summary.winner);
  if (!loser) throw new Error('match nul : pas de camp perdant donc pas d’upgrade, choisir une autre seed');
  if (heroTeam(data, choice.recipient) !== loser) throw new Error(`${choice.recipient} n'est pas dans le camp perdant (${WINNER_LABEL[loser]})`);
  if (!choice.options.length || choice.options.some((o) => !o)) throw new Error('options du vote incomplètes');
  if (new Set(choice.options).size !== choice.options.length) throw new Error('les options doivent être différentes');
  const next = structuredClone(arc);
  next.episodes.push({
    number: n,
    seed,
    winner: summary.winner,
    duration,
    recipient: choice.recipient,
    options: [...choice.options],
    votes: null,
    // Une seule option (dernière upgrade du héros) : attribuée d'office, sans vote.
    upgrade: choice.options.length === 1 ? choice.options[0] : null,
    heroKills: summary.heroKills,
    endType: endType(summary),
    settings: setup.settings,
  });
  return { arc: parseArc(next, data), summary };
}
