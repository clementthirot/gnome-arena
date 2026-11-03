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
import { sound } from './render/audio';
import { loadGameData, type GameData } from './data';
import { episodeSetup, killsBefore, parseArc } from './data/arc';
import { Battle } from './sim/battle';
import type { ArenaParams } from './render/scenes/ArenaScene';
import { ArenaScene } from './render/scenes/ArenaScene';
import { BootScene } from './render/scenes/BootScene';
import { ResultScene } from './render/scenes/ResultScene';
import { startBenchPage } from './tools/benchPage';

const params = new URLSearchParams(location.search);
// En production, les arcs sont embarqués ; en développement, la régie les sert à jour (sans recharger la page).
const arcFiles = import.meta.glob('./data/arcs/*.json', { import: 'default' });

async function loadArc(id: string): Promise<unknown> {
  try {
    const res = await fetch('./__regie/arcs');
    if (res.ok) return ((await res.json()) as { id: string }[]).find((a) => a.id === id);
  } catch {
    // pas de régie (build de production)
  }
  const loader = Object.entries(arcFiles).find(([path]) => path.endsWith(`/${id}.json`))?.[1];
  return loader ? loader() : undefined;
}

async function main() {
  await document.fonts.load('16px "Press Start 2P"');
  if (params.get('mode') === 'bench') {
    startBenchPage(document.getElementById('game')!, params);
    return;
  }
  const data = loadGameData();
  const arena = await arenaParams(data);
  if (arena.record) {
    // Le son ne démarre qu'après un geste : on attend un clic pour lancer l'enregistrement.
    await waitForClick('● ENREGISTRER L\'ÉPISODE');
    sound.init();
  } else {
    const unlock = () => sound.init();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }
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
        recording = startRecording(game.canvas, name, sound.track);
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

/** Gros bouton plein écran ; se résout au clic (déverrouille le son du navigateur). */
function waitForClick(label: string): Promise<void> {
  return new Promise((resolve) => {
    const button = document.createElement('button');
    button.textContent = label;
    button.style.cssText =
      'position:fixed;inset:0;margin:auto;width:min(80vw,520px);height:120px;font:18px "Press Start 2P",monospace;color:#fff;background:#d83b3b;border:6px solid #000;cursor:pointer;z-index:20';
    button.onclick = () => {
      button.remove();
      resolve();
    };
    document.body.append(button);
  });
}

async function arenaParams(data: GameData): Promise<ArenaParams> {
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
      biome: params.get('biome') ?? undefined,
    };
  }
  const raw = await loadArc(arcId);
  if (!raw) throw new Error(`arc introuvable : ${arcId}`);
  const arc = parseArc(raw, data);
  const number = Number(params.get('ep') ?? arc.episodes.length + 1);
  const ep = arc.episodes.find((e) => e.number === number);
  const hero = ep && data.heroes.find((h) => h.id === ep.recipient);
  const team = hero && data.units.find((u) => u.id === hero.base)?.team;
  const seed = params.get('seed') ?? ep?.seed ?? String(Math.floor(Math.random() * 100000));
  // Réglages de la régie (copie figée avec l'épisode, sinon réglages courants de l'arc).
  const episode = episodeSetup(arc, number, seed, data);
  return {
    data: episode.data,
    seed,
    speed: record ? 1 : speed,
    record,
    heroes: episode.setup.heroes,
    biome: params.get('biome') ?? episode.setup.biome,
    upgrades: episode.setup.upgrades,
    episode: {
      number,
      arcKills: Object.fromEntries(Object.entries(killsBefore(arc, number)).map(([id, k]) => [data.heroes.find((h) => h.id === id)?.name ?? id, k])),
      expected: ep && params.get('seed') === null ? { winner: ep.winner, duration: ep.duration } : undefined,
      vote:
        ep && hero && team
          ? {
              recipient: hero.name,
              team,
              portrait: `unit_${hero.visual}`,
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
  const result = new Battle(arena.data, { seed: arena.seed, heroes: arena.heroes, upgrades: arena.upgrades, biome: arena.biome }).runToEnd();
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
