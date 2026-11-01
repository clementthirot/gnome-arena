// Mesures d'un combat et d'une série de combats (mode accéléré, sans rendu).
import type { GameData, TeamId } from '../data/schema';
import { Battle, opposingTeam, type BattleSetup } from '../sim/battle';

export interface BattleSummary {
  seed: string | number;
  winner: TeamId | 'draw';
  reason: 'elimination' | 'timeout';
  duration: number;
  survivors: number;
  /** Plus grande avance relative du camp finalement perdant : (perdant - gagnant) / max des deux. */
  loserMaxLead: number;
  comeback: boolean;
  heroKills: Record<string, number>;
  /** Dernier héros debout, seul contre tous à un moment ? */
  lastStand: boolean;
}

export interface BenchReport {
  runs: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  inTargetWindow: number;
  winRate: Record<TeamId | 'draw', number>;
  comebackRate: number;
  timeoutRate: number;
  lastStandRate: number;
  avgSurvivors: number;
}

/** Avance relative du futur perdant à partir de laquelle on parle de retournement (0.2 = 20 % plus fort). */
export const COMEBACK_LEAD = 0.2;
export const TARGET_WINDOW: [number, number] = [65, 80];

export function simulate(data: GameData, setup: BattleSetup): BattleSummary {
  const battle = new Battle(data, setup);
  let lastStand = false;
  while (!battle.result) {
    battle.step();
    if (!lastStand && battle.tick % 15 === 0) {
      for (const team of ['gnomes', 'goblins'] as const) {
        const mine = battle.alive(team);
        const theirs = battle.alive(opposingTeam(team));
        if (mine.length === 1 && mine[0].hero && theirs.length >= 3) lastStand = true;
      }
    }
  }
  const result = battle.result;
  let loserMaxLead = 0;
  if (result.winner !== 'draw') {
    const loser = opposingTeam(result.winner);
    for (const s of battle.history) {
      const top = Math.max(s[loser], s[result.winner]);
      if (s.t < 5 || top < 0.05) continue; // ignorer le bruit du début et les dernières miettes
      loserMaxLead = Math.max(loserMaxLead, (s[loser] - s[result.winner]) / top);
    }
  }
  const heroKills: Record<string, number> = {};
  for (const u of battle.units) if (u.hero) heroKills[u.hero.id] = u.kills;
  return {
    seed: setup.seed,
    winner: result.winner,
    reason: result.reason,
    duration: result.duration,
    survivors: result.survivors.gnomes + result.survivors.goblins,
    loserMaxLead,
    comeback: loserMaxLead >= COMEBACK_LEAD,
    heroKills,
    lastStand,
  };
}

export function aggregate(summaries: readonly BattleSummary[]): BenchReport {
  const n = summaries.length || 1;
  const durations = summaries.map((s) => s.duration);
  const count = (f: (s: BattleSummary) => boolean) => summaries.filter(f).length / n;
  return {
    runs: summaries.length,
    avgDuration: durations.reduce((a, b) => a + b, 0) / n,
    minDuration: Math.min(...durations),
    maxDuration: Math.max(...durations),
    inTargetWindow: count((s) => s.duration >= TARGET_WINDOW[0] && s.duration <= TARGET_WINDOW[1]),
    winRate: {
      gnomes: count((s) => s.winner === 'gnomes'),
      goblins: count((s) => s.winner === 'goblins'),
      draw: count((s) => s.winner === 'draw'),
    },
    comebackRate: count((s) => s.comeback),
    timeoutRate: count((s) => s.reason === 'timeout'),
    lastStandRate: count((s) => s.lastStand),
    avgSurvivors: summaries.reduce((a, s) => a + s.survivors, 0) / n,
  };
}

/** Note de spectacle : sert à repérer les seeds à rejouer (retournement, héros seul contre tous). */
export function spectacleScore(s: BattleSummary): number {
  const inWindow = s.duration >= TARGET_WINDOW[0] && s.duration <= TARGET_WINDOW[1] ? 1 : 0;
  return s.loserMaxLead * 4 + (s.lastStand ? 1.5 : 0) + inWindow + (s.survivors <= 3 ? 0.5 : 0);
}

export const WINNER_LABEL: Record<TeamId | 'draw', string> = { gnomes: 'gnomes', goblins: 'gobelins', draw: 'égalité' };

export function formatReport(r: BenchReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(0)} %`;
  return [
    `Combats simulés     : ${r.runs}`,
    `Durée moyenne       : ${r.avgDuration.toFixed(1)} s (min ${r.minDuration.toFixed(1)}, max ${r.maxDuration.toFixed(1)})`,
    `Dans 65–80 s        : ${pct(r.inTargetWindow)}`,
    `Victoires           : gnomes ${pct(r.winRate.gnomes)} · gobelins ${pct(r.winRate.goblins)} · nuls ${pct(r.winRate.draw)}`,
    `Retournements       : ${pct(r.comebackRate)} (le perdant a été ${COMEBACK_LEAD * 100} % plus fort à un moment)`,
    `Héros seul contre 3+: ${pct(r.lastStandRate)}`,
    `Fins aux points     : ${pct(r.timeoutRate)}`,
    `Survivants moyens   : ${r.avgSurvivors.toFixed(1)}`,
  ].join('\n');
}
