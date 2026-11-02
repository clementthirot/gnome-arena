// Point d'entrée navigateur.
//   ?seed=53            rejoue un combat précis
//   ?arc=arc1&ep=3      épisode 3 de l'arc : seed, héros et upgrades de l'arc, carte de vote en fin
//   ?record=1           enregistre la vidéo (1080 x 1920) et la télécharge à la fin de l'écran de vote
//   ?up=bob:magic_sword+grenades,snik:laser_goggles   équipe des héros à la main (essais)
//   ?speed=2            accélère l'affichage (touches 1, 2, 4, 8 en cours de combat)
//   ?mode=bench         mode accéléré sans rendu (Web Worker) : durée moyenne, victoires, retournements
import '@fontsource/press-start-2p';
import Phaser from 'phaser';
import { startRecording } from './capture/recorder';
import { loadGameData, type GameData } from './data';
import { arcHeroes, parseArc, upgradesBefore } from './data/arc';
import { Battle } from './sim/battle';
import type { ArenaParams } from './render/scenes/ArenaScene';
import { ArenaScene } from './render/scenes/ArenaScene';
import { BootScene } from './render/scenes/BootScene';
import { ResultScene } from './render/scenes/ResultScene';
import { startBenchPage } from './tools/benchPage';

const params = new URLSearchParams(location.search);
const arcFiles = import.meta.glob('./data/arcs/*.json', { eager: true, import: 'default' });

async function main() {
  await document.fonts.load('16px "Press Start 2P"');
  if (params.get('mode') === 'bench') {
    startBenchPage(document.getElementById('game')!, params);
    return;
  }
  const data = loadGameData();
  const arena = arenaParams(data);
  const { width, height } = data.battle.arena;
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: width * 4,
    height: height * 4,
    backgroundColor: '#0e0c14',
    pixelArt: true,
    // Le flux vidéo lit le canvas WebGL entre deux images : on garde son contenu pendant un enregistrement.
    render: { preserveDrawingBuffer: !!arena.record },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, ArenaScene, ResultScene],
  });
  warnIfEpisodeDiverged(arena);
  game.scene.start('boot', arena);
  // Exposé pour le débogage.
  (window as unknown as { game: Phaser.Game }).game = game;

  if (arena.record) {
    game.events.once(Phaser.Core.Events.READY, () => {
      const name = [params.get('arc'), arena.episode && `ep${String(arena.episode.number).padStart(2, '0')}`, `seed${arena.seed}`].filter(Boolean).join('-');
      const badge = document.createElement('div');
      badge.style.cssText = 'position:fixed;top:8px;left:8px;color:#ff5050;font:12px "Press Start 2P",monospace;z-index:10';
      document.body.append(badge);
      let recording: ReturnType<typeof startRecording>;
      try {
        recording = startRecording(game.canvas, name);
      } catch (e) {
        badge.textContent = `✗ ${(e as Error).message}`;
        return;
      }
      badge.textContent = `● REC ${recording.mimeType.split(';')[0]}`;
      game.events.once('episode-finished', async () => {
        await recording.stop();
        badge.textContent = '✓ vidéo téléchargée';
      });
    });
  }
}

function arenaParams(data: GameData): ArenaParams {
  const speed = Number(params.get('speed') ?? 1) || 1;
  const record = params.get('record') === '1';
  const arcId = params.get('arc');
  if (!arcId) {
    return {
      data,
      seed: params.get('seed') ?? String(Math.floor(Math.random() * 100000)),
      speed: record ? 1 : speed,
      record,
      upgrades: parseUpgrades(params.get('up')),
    };
  }
  const raw = Object.entries(arcFiles).find(([path]) => path.endsWith(`/${arcId}.json`))?.[1];
  if (!raw) throw new Error(`arc introuvable : ${arcId}`);
  const arc = parseArc(raw, data);
  const number = Number(params.get('ep') ?? arc.episodes.length + 1);
  const ep = arc.episodes.find((e) => e.number === number);
  const hero = ep && data.heroes.find((h) => h.id === ep.recipient);
  const team = hero && data.units.find((u) => u.id === hero.base)?.team;
  return {
    data,
    seed: params.get('seed') ?? ep?.seed ?? String(Math.floor(Math.random() * 100000)),
    speed: record ? 1 : speed,
    record,
    heroes: arcHeroes(arc, data),
    upgrades: upgradesBefore(arc, number),
    episode: {
      number,
      expected: ep && params.get('seed') === null ? { winner: ep.winner, duration: ep.duration } : undefined,
      vote:
        ep && hero && team
          ? {
              recipient: hero.name,
              team,
              options: ep.options.map((o) => {
                const eq = data.equipment.find((e) => e.id === o)!;
                return { label: eq.label, visual: eq.visual };
              }),
            }
          : undefined,
    },
  };
}

/** Un épisode figé doit se rejouer à l'identique ; sinon, un JSON a changé depuis sa planification. */
function warnIfEpisodeDiverged(arena: ArenaParams): void {
  const expected = arena.episode?.expected;
  if (!expected) return;
  const result = new Battle(arena.data, { seed: arena.seed, heroes: arena.heroes, upgrades: arena.upgrades }).runToEnd();
  if (result.winner === expected.winner && Math.abs(result.duration - expected.duration) < 0.2) return;
  const message = `⚠ L'épisode ne se rejoue plus comme prévu (${expected.winner} en ${expected.duration} s attendu, ${result.winner} en ${result.duration.toFixed(1)} s obtenu) : une donnée a changé depuis sa planification.`;
  console.warn(message);
  const badge = document.createElement('div');
  badge.textContent = message;
  badge.style.cssText = 'position:fixed;bottom:8px;left:8px;right:8px;color:#ffb347;font:11px/1.5 "Press Start 2P",monospace;z-index:10';
  document.body.append(badge);
}

function parseUpgrades(value: string | null): Record<string, string[]> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(
    value.split(',').map((part) => {
      const [hero, items = ''] = part.split(':');
      // Dans une URL, « + » arrive décodé en espace : on accepte les deux.
      return [hero, items.split(/[+ ]/).filter(Boolean)];
    }),
  );
}

main();
