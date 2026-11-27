// Easter eggs et visuels de mise en scène : public qui explose, ola, empereur qui tombe, accessoire
// du spectateur récurrent, aura du mini-boss. Rares, réglables dans le manifeste
// (staging.easterEggs), et tirés de la seed : même seed = mêmes gags. Uniquement visuel.
import type Phaser from 'phaser';
import { hashSeed } from '../sim/rng';
import { manifest, type OverlayEntry } from './manifest';
import { DARK_OUTLINE } from './pixels';
import { randAt } from './random';

type EggName = 'crowdBurst' | 'wave' | 'emperorFall';

/** Petits dessins de secours (px monde) : c couleur, a accent, o contour, g tige verte, w blanc. */
const ART: Record<string, string[]> = {
  crown: ['c..c..c', 'cc.c.cc', 'ccccccc', 'cacacac', 'ccccccc'],
  tophat: ['.ccc.', '.ccc.', '.aaa.', '.ccc.', 'ccccc'],
  helmet: ['..ccc..', '.ccccc.', 'ccccccc', 'aaaaaaa'],
  umbrella: ['...cac...', '.cacacac.', 'cacacacac', '....o....', '....o....', '....o....', '....o....'],
  flower: ['.c.c.', 'ccacc', '.c.c.', '..g..', '..g..'],
  viking: ['w.......w', 'w..ccc..w', '.wcccccw.', '..ccccc..'],
  propeller: ['aaa.aaa', '...o...', '..ccc..', '.ccccc.'],
  duck: ['..cc..', '.ccoca', 'cccc..', 'ccccc.', '.cccc.'],
  confetti: ['ca', 'ac'],
};

function overlayCanvas(kind: string, color: string, accent: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  if (kind === 'aura') {
    // Anneau au sol, tramé : se lit comme un halo sans masquer le héros.
    const w = 24;
    const h = 9;
    canvas.width = w;
    canvas.height = h;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = Math.hypot((x - (w - 1) / 2) / (w / 2), (y - (h - 1) / 2) / (h / 2));
        if (d > 1 || d < 0.62) continue;
        ctx.fillStyle = d > 0.84 ? accent : (x + y) % 2 ? color : accent;
        ctx.fillRect(x, y, 1, 1);
      }
    return canvas;
  }
  const rows = ART[kind] ?? ART.confetti;
  canvas.width = rows[0].length;
  canvas.height = rows.length;
  const palette: Record<string, string> = { c: color, a: accent, o: DARK_OUTLINE, g: '#3fa84a', w: '#f4f0e0' };
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const c = palette[ch];
      if (!c) return;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return canvas;
}

const warned = new Set<string>();

/** Texture d'un visuel `overlays` du manifeste (image chargée, sinon placeholder dessiné) et son échelle d'affichage. */
export function overlayTexture(scene: Phaser.Scene, key: string, worldScale: number): { key: string; scale: number } | undefined {
  const entry: OverlayEntry | undefined = manifest.overlays[key];
  if (!entry) {
    if (!warned.has(key)) console.warn(`[manifest] visuel « ${key} » absent de overlays`);
    warned.add(key);
    return undefined;
  }
  if (entry.type === 'image' && scene.textures.exists(`ovl_img_${key}`)) {
    const h = scene.textures.get(`ovl_img_${key}`).getSourceImage().height || 1;
    return { key: `ovl_img_${key}`, scale: (entry.size * worldScale) / h };
  }
  const shape = entry.type === 'placeholder' ? entry : entry.placeholder;
  if (!shape) return undefined;
  const tex = `ovl_tex_${key}`;
  if (!scene.textures.exists(tex)) scene.textures.addCanvas(tex, overlayCanvas(shape.kind, shape.color, shape.accent));
  return { key: tex, scale: worldScale };
}

/** Couleurs d'un visuel (confettis) : celles du placeholder, à défaut jaune et rose. */
export function overlayColors(key: string): [number, number] {
  const entry = manifest.overlays[key];
  const shape = entry?.type === 'placeholder' ? entry : entry?.placeholder;
  const hex = (c: string) => parseInt(c.slice(1), 16);
  return shape ? [hex(shape.color), hex(shape.accent)] : [0xffe14a, 0xff5aa8];
}

/** Échelle d'affichage du mini-boss : il grossit avec ses upgrades (rendu seulement, la simulation ne change pas). */
export function bossScale(upgrades: number): number {
  const cfg = manifest.staging.miniBoss;
  return Math.min(cfg.max, 1 + cfg.perUpgrade * upgrades);
}

/** Tirage et plafonds des easter eggs d'un épisode. */
export class Eggs {
  private used = new Map<EggName, number>();
  private readonly eligible: Record<EggName, boolean>;

  /** `force` (`?eggs=1`) : tous les gags sont éligibles, pour les vérifier à l'image. */
  constructor(private readonly seed: string, readonly force = false) {
    const cfg = manifest.staging.easterEggs;
    const roll = (name: EggName, chance: number) => force || randAt(hashSeed(`${seed}:egg:${name}`), 17) < chance;
    this.eligible = { crowdBurst: roll('crowdBurst', cfg.crowdBurst.chance), wave: roll('wave', cfg.wave.chance), emperorFall: roll('emperorFall', cfg.emperorFall.chance) };
  }

  /** Vrai (et compté) si le gag peut se produire maintenant. */
  take(name: EggName): boolean {
    const cap = manifest.staging.easterEggs[name].cap;
    const n = this.used.get(name) ?? 0;
    if (!this.eligible[name] || n >= cap) return false;
    this.used.set(name, n + 1);
    return true;
  }

  /**
   * Accessoire du spectateur récurrent : change d'un épisode au suivant (jamais deux fois de suite
   * le même), tiré de la seed hors épisode.
   */
  gagAccessory(episode?: number): string | undefined {
    const items = manifest.staging.easterEggs.gagAccessories;
    if (!items.length) return undefined;
    const i = episode !== undefined ? (hashSeed('spectateur') + episode) % items.length : hashSeed(`${this.seed}:gag`) % items.length;
    return items[i];
  }
}
