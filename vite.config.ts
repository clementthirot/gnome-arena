import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { loadGameData } from './src/data';
import { parseArc } from './src/data/arc';

const ARCS = join(import.meta.dirname, 'src/data/arcs');

/**
 * Relais de la régie (serveur de dev uniquement) : liste les arcs et enregistre un arc modifié,
 * après validation complète. Rien n'est exposé en production.
 */
function regieRelay(): Plugin {
  return {
    name: 'regie-relay',
    configureServer(server) {
      server.middlewares.use('/__regie/arcs', (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        try {
          if (req.method === 'GET') {
            const arcs = readdirSync(ARCS)
              .filter((f) => f.endsWith('.json'))
              .map((f) => JSON.parse(readFileSync(join(ARCS, f), 'utf8')));
            return send(200, arcs);
          }
          if (req.method === 'PUT') {
            const id = (req.url ?? '').replace(/^\//, '');
            if (!/^[a-z0-9_-]+$/.test(id)) return send(400, { error: `identifiant d'arc invalide : ${id}` });
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
              try {
                const arc = parseArc(JSON.parse(body), loadGameData());
                if (arc.id !== id) return send(400, { error: "l'identifiant ne correspond pas" });
                writeFileSync(join(ARCS, `${id}.json`), JSON.stringify(arc, null, 2) + '\n');
                send(200, arc);
              } catch (e) {
                send(400, { error: (e as Error).message });
              }
            });
            return;
          }
          send(405, { error: 'méthode non prise en charge' });
        } catch (e) {
          send(500, { error: (e as Error).message });
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [regieRelay()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: { main: join(import.meta.dirname, 'index.html'), regie: join(import.meta.dirname, 'regie.html') } },
  },
  worker: { format: 'es' },
  // Les fichiers d'arc écrits par la régie ne doivent pas recharger la page de régie.
  server: { watch: { ignored: ['**/src/data/arcs/**'] } },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 },
});
