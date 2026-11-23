import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { loadGameData } from './src/data';
import { parseArc } from './src/data/arc';

const ARCS = join(import.meta.dirname, 'src/data/arcs');
/** Révision d'un fichier d'arc : empreinte de son contenu sur le disque. */
const revision = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 16);

/**
 * Relais de la régie (serveur de dev uniquement) : liste les arcs et enregistre un arc modifié,
 * après validation complète. Rien n'est exposé en production.
 * Écritures concurrentes (CLI pendant que la régie est ouverte) : chaque arc lu porte sa révision
 * (`revision`, ignorée par parseArc) ; un PUT envoie celle qu'il a lue dans l'en-tête X-Arc-Revision
 * (« new » pour un nouvel arc) et il est refusé (409) si le fichier a changé entre-temps.
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
              .sort()
              .map((f) => {
                const text = readFileSync(join(ARCS, f), 'utf8');
                return { ...JSON.parse(text), revision: revision(text) };
              });
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
                const file = join(ARCS, `${id}.json`);
                const expected = req.headers['x-arc-revision'];
                if (typeof expected === 'string') {
                  const current = existsSync(file) ? revision(readFileSync(file, 'utf8')) : 'new';
                  if (current !== expected) {
                    const why = expected === 'new' ? `l'arc ${id} existe déjà` : `l'arc ${id} a changé sur le disque depuis son chargement (CLI ?)`;
                    return send(409, { error: `${why} : rien n'a été écrit, la régie recharge l'arc` });
                  }
                }
                writeFileSync(file, JSON.stringify(arc, null, 2) + '\n');
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
