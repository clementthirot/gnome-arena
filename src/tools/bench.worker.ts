// Simulations en masse hors du fil principal : aucune dépendance au rendu.
import { loadGameData } from '../data';
import { simulate, type BattleSummary } from './metrics';

export interface BenchRequest {
  from: number;
  runs: number;
}

export type BenchMessage = { type: 'progress'; done: number; summary: BattleSummary } | { type: 'done' };

self.onmessage = (e: MessageEvent<BenchRequest>) => {
  const data = loadGameData();
  for (let i = 0; i < e.data.runs; i++) {
    const summary = simulate(data, { seed: e.data.from + i });
    self.postMessage({ type: 'progress', done: i + 1, summary } satisfies BenchMessage);
  }
  self.postMessage({ type: 'done' } satisfies BenchMessage);
};
