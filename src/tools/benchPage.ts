// Page du mode accéléré : lance le worker et affiche les mesures au fil de l'eau.
import type { BenchMessage, BenchRequest } from './bench.worker';
import { aggregate, formatReport, spectacleScore, WINNER_LABEL, type BattleSummary } from './metrics';

export function startBenchPage(root: HTMLElement, params: URLSearchParams): void {
  const from = Number(params.get('from') ?? 1);
  const runs = Number(params.get('runs') ?? 100);
  root.innerHTML = '<div id="bench"></div>';
  const out = root.querySelector<HTMLDivElement>('#bench')!;
  const summaries: BattleSummary[] = [];
  const started = performance.now();
  const worker = new Worker(new URL('./bench.worker.ts', import.meta.url), { type: 'module' });

  const render = (finished: boolean) => {
    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    const best = [...summaries].sort((a, b) => spectacleScore(b) - spectacleScore(a)).slice(0, 8);
    out.innerHTML = '';
    const header = document.createElement('div');
    header.textContent = `MODE ACCÉLÉRÉ — seeds ${from} à ${from + runs - 1}\n${summaries.length}/${runs} combats · ${elapsed} s${finished ? ' · terminé' : ''}\n\n`;
    const report = document.createElement('div');
    report.textContent = summaries.length ? formatReport(aggregate(summaries)) + '\n\nMeilleures seeds à rejouer :' : '';
    out.append(header, report);
    for (const s of best) {
      const line = document.createElement('div');
      const link = document.createElement('a');
      link.href = `?seed=${s.seed}`;
      link.textContent = `seed ${s.seed}`;
      const rec = document.createElement('a');
      rec.href = `?seed=${s.seed}&record=1`;
      rec.textContent = '● enregistrer';
      line.append(link, ' ', rec, ` — ${WINNER_LABEL[s.winner]} en ${s.duration.toFixed(1)} s, perdant +${(s.loserMaxLead * 100).toFixed(0)} %${s.lastStand ? ', héros seul contre tous' : ''}`);
      out.append(line);
    }
  };

  worker.onmessage = (e: MessageEvent<BenchMessage>) => {
    if (e.data.type === 'progress') {
      summaries.push(e.data.summary);
      if (e.data.done % 5 === 0) render(false);
    } else {
      render(true);
      worker.terminate();
    }
  };
  worker.postMessage({ from, runs } satisfies BenchRequest);
  render(false);
}
