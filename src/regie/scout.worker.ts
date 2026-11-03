// Scout de la régie : simule des seeds pour le prochain épisode, hors du fil principal.
import { loadGameData } from '../data';
import { episodeSetup, parseArc } from '../data/arc';
import { endType, scoutScore, simulate, type BattleSummary } from '../tools/metrics';

export interface ScoutRequest {
  arc: unknown;
  episode: number;
  from: number;
  runs: number;
}

export interface ScoutRow extends BattleSummary {
  endType: ReturnType<typeof endType>;
  score: number;
}

export type ScoutMessage = { type: 'progress'; done: number; row: ScoutRow } | { type: 'done' } | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<ScoutRequest>) => {
  try {
    const data = loadGameData();
    const arc = parseArc(e.data.arc, data);
    const previous = arc.episodes.filter((ep) => ep.number < e.data.episode).at(-1)?.endType;
    for (let i = 0; i < e.data.runs; i++) {
      const seed = String(e.data.from + i);
      const s = episodeSetup(arc, e.data.episode, seed, data);
      const summary = simulate(s.data, s.setup);
      const row: ScoutRow = { ...summary, endType: endType(summary), score: scoutScore(summary, previous) };
      self.postMessage({ type: 'progress', done: i + 1, row } satisfies ScoutMessage);
    }
    self.postMessage({ type: 'done' } satisfies ScoutMessage);
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message } satisfies ScoutMessage);
  }
};
