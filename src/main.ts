// Point d'entrée navigateur.
//   ?seed=53            rejoue un combat précis
//   ?arc=arc1&ep=3      épisode 3 de l'arc : seed, héros et upgrades de l'arc, carte de vote en fin
//   ?record=1           enregistre la vidéo (1080 x 1920) et la télécharge à la fin de l'écran de vote
//   ?up=bob:magic_sword+grenades,snik:laser_goggles   équipe des héros à la main (essais ; s'ajoute aux upgrades de l'arc)
//   ?prev=kevin:laser_goggles:120,340,95   simule le vote de l'épisode précédent (révélation), avec ou sans arc
//   ?speed=2            accélère l'affichage (touches 1, 2, 4, 8 en cours de combat)
//   ?mode=bench         mode accéléré sans rendu (Web Worker) : durée moyenne, victoires, retournements
//   ?intro=0            passe l'intro (aperçus rapides de la régie)
//   ?draft=<json>       réglages d'arc en brouillon, pour un épisode pas encore figé (aperçu de la régie)
//   ?vote=kevin:laser_goggles,magic_sword,grenades   carte de vote en brouillon (aperçu de la régie)
//   ?prev=kevin:laser_goggles:120,340,95   vote précédent à révéler en ouverture (essais ; voix facultatives)
//   ?theme=noel         thème visuel (src/render/themes/noel.json) : mêmes règles, autres assets
import '@fontsource/press-start-2p';
import Phaser from 'phaser';
import { startRecording } from './capture/recorder';
import { sound } from './render/audio';
import { loadGameData, type GameData } from './data';
import { episodeSetup, killsBefore, normalizeUpgrades, parseArc, previousVote, type PreviousVote } from './data/arc';
import { Battle } from './sim/battle';
import type { ArenaParams } from './render/scenes/ArenaScene';
import { ArenaScene } from './render/scenes/ArenaScene';
import { BootScene } from './render/scenes/BootScene';
import { ResultScene } from './render/scenes/ResultScene';
import { startBenchPage } from './tools/benchPage';
import { applyThemeLabels, theme, themeId } from './render/themes';
import { findArc } from './regie/store';

const params = new URLSearchParams(location.search);
async function main() {
  if (theme.name) document.title = theme.name;
  await document.fonts.load('16px "Press Start 2P"');
  if (params.get('mode') === 'bench') {
    startBenchPage(document.getElementById('game')!, params);
    return;
  }
  // Noms du thème (upgrades, unités, incidents) : du texte seulement, la simulation ne change pas.
  const data = applyThemeLabels(loadGameData());
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
  const manual = parseUpgrades(params.get('up'), data);
  const prev = parsePreviousVote(params.get('prev'), data);
  if (!arcId) {
    // Sans arc, un pack de thème joue avec son propre roster (?theme=noel : les héros de Noël).
    const heroes = theme.heroes?.map((id) => {
      const hero = data.heroes.find((h) => h.id === id);
      if (!hero) throw new Error(`thème ${themeId} : héros inconnu ${id}`);
      return hero;
    });
    return {
      data,
      heroes,
      seed: params.get('seed') ?? String(Math.floor(Math.random() * 100000)),
      speed: record ? 1 : speed,
      record,
      skipIntro: params.get('intro') === '0' && !record,
      // Vote précédent simulé : le héros porte déjà l'upgrade gagnée.
      upgrades: prev ? mergeUpgrades(manual, { [prev.recipient]: [prev.upgrade] }) : manual,
      biome: params.get('biome') ?? theme.biome,
      episode: prev ? { number: Number(params.get('ep')) || 2, previousVote: prev } : undefined,
    };
  }
  // Relais de la régie en développement ; en ligne, version modifiée sur cet appareil ou celle du dépôt.
  const raw = await findArc(arcId);
  if (!raw) throw new Error(`arc introuvable : ${arcId}`);
  let arc = parseArc(raw, data);
  // Un arc de pack s'ouvre dans son thème : on recharge la page avec ?theme=… s'il manque.
  if (arc.theme && arc.theme !== themeId && !params.has('theme')) {
    params.set('theme', arc.theme);
    location.replace(`${location.pathname}?${params}`);
    await new Promise(() => {});
  }
  const number = Number(params.get('ep') ?? arc.episodes.length + 1);
  const ep = arc.episodes.find((e) => e.number === number);
  // Aperçu de la régie : réglages et vote pas encore enregistrés (seulement pour un épisode non figé).
  const draft = params.get('draft');
  if (draft && !ep) arc = parseArc({ ...arc, settings: JSON.parse(draft) }, data);
  const draftVote = !ep ? params.get('vote')?.split(':') : undefined;
  const voteSource = ep ?? (draftVote && draftVote[1] ? { recipient: draftVote[0], options: draftVote[1].split(',').filter(Boolean) } : undefined);
  const hero = voteSource && data.heroes.find((h) => h.id === voteSource.recipient);
  const team = hero && data.units.find((u) => u.id === hero.base)?.team;
  const seed = params.get('seed') ?? ep?.seed ?? String(Math.floor(Math.random() * 100000));
  // Réglages de la régie (copie figée avec l'épisode, sinon réglages courants de l'arc).
  const episode = episodeSetup(arc, number, seed, data);
  return {
    data: episode.data,
    seed,
    speed: record ? 1 : speed,
    record,
    skipIntro: params.get('intro') === '0' && !record,
    heroes: episode.setup.heroes,
    biome: params.get('biome') ?? episode.setup.biome,
    upgrades: manual ? mergeUpgrades(episode.setup.upgrades, manual) : episode.setup.upgrades,
    episode: {
      number,
      previousVote: prev ?? previousVote(arc, number, data),
      arcKills: Object.fromEntries(Object.entries(killsBefore(arc, number)).map(([id, k]) => [data.heroes.find((h) => h.id === id)?.name ?? id, k])),
      expected: ep && params.get('seed') === null && !manual ? { winner: ep.winner, duration: ep.duration } : undefined,
      vote:
        voteSource && hero && team
          ? {
              recipient: hero.name,
              team,
              portrait: `unit_${hero.visual}`,
              options: voteSource.options.flatMap((o) => {
                const eq = data.equipment.find((e) => e.id === o);
                return eq ? [{ label: eq.label, visual: eq.visual }] : [];
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

/** ?up= : héros ou upgrade inconnus refusés avec un message clair, doublons retirés. */
function parseUpgrades(value: string | null, data: GameData): Record<string, string[]> | undefined {
  if (!value) return undefined;
  const raw = Object.fromEntries(
    value.split(',').map((part) => {
      const [hero, items = ''] = part.split(':');
      // Dans une URL, « + » arrive décodé en espace : on accepte les deux.
      return [hero, items.split(/[+ ]/).filter(Boolean)];
    }),
  );
  try {
    return normalizeUpgrades(raw, data);
  } catch (e) {
    throw new Error(`?up= : ${(e as Error).message}`);
  }
}

/** Upgrades réunies sans doublon (celles de l'arc, puis celles ajoutées à la main). */
function mergeUpgrades(a: Record<string, string[]> | undefined, b: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = { ...a };
  for (const [hero, list] of Object.entries(b)) out[hero] = [...new Set([...(out[hero] ?? []), ...list])];
  return out;
}

/**
 * ?prev=kevin:laser_goggles:120,340,95 : vote précédent simulé (essais de la révélation). L'upgrade
 * gagnante occupe la place de la plus grosse voix ; les autres options sont prises dans l'ordre du JSON.
 */
function parsePreviousVote(value: string | null, data: GameData): PreviousVote | undefined {
  if (!value) return undefined;
  const [recipient = '', upgrade = '', counts] = value.split(':');
  const hero = data.heroes.find((h) => h.id === recipient);
  const team = hero && data.units.find((u) => u.id === hero.base)?.team;
  if (!hero || !team) throw new Error(`?prev= : héros inconnu ${recipient} (connus : ${data.heroes.map((h) => h.id).join(', ')})`);
  if (!data.equipment.some((e) => e.id === upgrade)) throw new Error(`?prev= : upgrade inconnue ${upgrade} (connues : ${data.equipment.map((e) => e.id).join(', ')})`);
  const votes = counts ? counts.split(',').map(Number) : null;
  if (votes && (votes.length < 2 || votes.length > 4 || votes.some((v) => !Number.isInteger(v) || v < 0) || !votes.some((v) => v > 0))) {
    throw new Error(`?prev= : voix invalides ${counts} (2 à 4 nombres, au moins une voix)`);
  }
  const others = data.equipment.filter((e) => !e.innate).map((e) => e.id).filter((id) => id !== upgrade);
  const winnerAt = votes ? votes.indexOf(Math.max(...votes)) : 0;
  const options = votes ? votes.map((_, i) => (i === winnerAt ? upgrade : others.shift()!)) : [upgrade];
  return { recipient, team, upgrade, options, votes };
}

main().catch((e) => {
  // Paramètre d'URL invalide, arc introuvable… : le message s'affiche au lieu d'un écran noir.
  console.error(e);
  const box = document.createElement('div');
  box.textContent = `✗ ${(e as Error).message}`;
  box.style.cssText = 'position:fixed;inset:16px;color:#ff6b6b;font:12px/1.6 "Press Start 2P",monospace;white-space:pre-wrap;z-index:30';
  document.body.append(box);
});
