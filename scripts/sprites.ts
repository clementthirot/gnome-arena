// Intégration des sprites : npm run sprites -- <commande>
//
//   generate            fabrique des sheets animées de remplacement dans public/sprites/generated/
//                       à partir des silhouettes du manifeste (même format que les vraies sheets)
//   import              écrit le manifeste à partir des PNG trouvés :
//                         public/sprites/<clé>.png            (tes sprites, prioritaires)
//                         public/sprites/generated/<clé>.png  (remplacement, sauf --no-generated)
//                       une exportation Aseprite <clé>.json à côté du PNG fixe le découpage et les animations
//   check               comme import, sans rien écrire ; code de sortie 1 en cas de problème
//   pixellab <dossier> <clé> [clés…] [--scale=1.25] [--hit=attack:5,kick:3]
//                       assemble un export PixelLab en 8 directions (metadata.json, rotations/,
//                       animations/<nom>/<direction>/) en public/sprites/<clé>.png, une ligne par
//                       direction, puis lance import ; plusieurs clés partagent le même skin, et
//                       --scale grossit le personnage par rapport à sa silhouette ;
//                       --hit donne, par attaque, l'image où le coup touche (rang dans l'animation)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { accessoryPixels, placeholderPixels, type PlaceholderShape } from '../src/render/pixels';
import { buildSheet, SHEET_FRAMES, SHEET_LAYOUT, sheetGrid } from '../src/render/spriteFrames';
import { DIRECTIONS } from '../src/render/manifest';
import { decodePng, encodePng, encodeRgba, pngSize, type Rgba } from './lib/png';

const ROOT = join(import.meta.dirname, '..');
const MANIFEST = join(ROOT, 'src/render/assets.manifest.json');
const [command = 'check', ...args] = process.argv.slice(2);
/** --theme=noel : sprites dans public/sprites/themes/noel/, entrées écrites dans src/render/themes/noel.json. */
const THEME = args.find((a) => a.startsWith('--theme='))?.slice(8);
const THEME_FILE = THEME && join(ROOT, `src/render/themes/${THEME}.json`);
const SPRITES_URL = THEME ? `sprites/themes/${THEME}` : 'sprites';
const SPRITES = join(ROOT, 'public', SPRITES_URL);
const GENERATED = join(ROOT, 'public/sprites/generated');
const useGenerated = !THEME && !args.includes('--no-generated');

type Json = Record<string, any>;
const manifest: Json = JSON.parse(readFileSync(MANIFEST, 'utf8'));

/** Silhouette d'une entrée, qu'elle soit encore un placeholder ou déjà une sheet. */
function shapeOf(entry: Json): PlaceholderShape | undefined {
  if (entry.type === 'placeholder') {
    const { type: _type, bricks: _bricks, ...shape } = entry;
    return shape as PlaceholderShape;
  }
  return entry.placeholder;
}

function accessoryShapeOf(entry: Json): { kind: string; color: string; accent: string } | undefined {
  if (entry.type === 'placeholder') return { kind: entry.kind, color: entry.color, accent: entry.accent };
  return entry.placeholder;
}

function generate() {
  mkdirSync(GENERATED, { recursive: true });
  let count = 0;
  for (const [key, entry] of Object.entries<Json>(manifest.assets)) {
    const shape = shapeOf(entry);
    if (!shape) continue;
    writeFileSync(join(GENERATED, `${key}.png`), encodePng(sheetGrid(buildSheet(placeholderPixels(shape)))));
    count++;
  }
  for (const [key, entry] of Object.entries<Json>(manifest.accessories)) {
    const shape = accessoryShapeOf(entry);
    if (!shape) continue;
    writeFileSync(join(GENERATED, `${key}.png`), encodePng(accessoryPixels(shape.kind, shape.color, shape.accent)));
    count++;
  }
  console.log(`${count} images générées dans public/sprites/generated/ (${SHEET_FRAMES} images par sheet : idle, walk, attack, death).`);
  console.log('Étape suivante : npm run sprites -- import');
}

interface Found {
  url: string;
  path: string;
  source: string;
}

function find(key: string): Found | undefined {
  const own = join(SPRITES, `${key}.png`);
  if (existsSync(own)) return { url: `${SPRITES_URL}/${key}.png`, path: own, source: THEME ? `thème ${THEME}` : 'perso' };
  const gen = join(GENERATED, `${key}.png`);
  if (useGenerated && existsSync(gen)) return { url: `sprites/generated/${key}.png`, path: gen, source: 'remplacement' };
  return undefined;
}

/** Description d'une sheet en 8 directions, écrite par la commande pixellab à côté du PNG. */
interface DirectionalSidecar {
  frameWidth: number;
  frameHeight: number;
  /** Hauteur du personnage dans l'image (px), pour l'afficher à la taille de sa silhouette. */
  bodyHeight: number;
  /** Facteur appliqué à cette taille (un personnage fin paraît plus petit que sa silhouette). */
  scale?: number;
  animations: Json;
}

type AnimName = 'idle' | 'walk' | 'attack' | 'kick' | 'hurt' | 'getup' | 'death';
/** Cadence par défaut des animations qui n'existent pas dans la disposition standard. */
const EXTRA_FPS: Record<string, number> = { kick: 14, hurt: 16, getup: 10 };

/** Noms d'animations PixelLab reconnus, vers les animations du jeu (l'ordre des tests compte). */
function animationFor(name: string): AnimName | undefined {
  const n = name.toLowerCase();
  if (/death|die|dying/.test(n)) return 'death';
  if (/getting.?up|get.?up|stand.?up|rise/.test(n)) return 'getup';
  if (/taking|hurt|hit.?react|damage|flinch/.test(n)) return 'hurt';
  if (/kick/.test(n)) return 'kick';
  if (/punch|attack|slash|strike|swing|jab/.test(n)) return 'attack';
  if (/walk|run/.test(n)) return 'walk';
  if (/idle|breath/.test(n)) return 'idle';
  return undefined;
}

/** Images d'une direction ; PixelLab nomme parfois les variantes « west-8062cc6e » : on prend la première. */
function framesFor(byDir: Record<string, string[]>, d: string): string[] | undefined {
  return byDir[d] ?? Object.entries(byDir).find(([k]) => k.startsWith(`${d}-`))?.[1];
}

/** Première et dernière lignes non transparentes. */
function opaqueRows(img: Rgba): [number, number] {
  let top = img.height;
  let bottom = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3] > 0) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  return [top, bottom];
}

/** Assemble un export PixelLab : une ligne par direction (ordre DIRECTIONS), rotation fixe puis animations. */
function pixellab(folder: string | undefined, keys: string[], scale: number, hits: Record<string, number>) {
  if (!folder || !keys.length) throw new Error('usage : npm run sprites -- pixellab <dossier> <clé> [clés…] [--scale=1.25]');
  const unknown = keys.filter((k) => !(k in manifest.assets));
  if (unknown.length) throw new Error(`« ${unknown.join(', ')} » : pas dans le manifeste (${Object.keys(manifest.assets).join(', ')})`);
  if (!(scale > 0)) throw new Error('--scale doit être un nombre positif');
  // Un export à plusieurs variantes n'a qu'un metadata.json, dans le dossier parent : on y prend la variante du dossier.
  const variant = !existsSync(join(folder, 'metadata.json'));
  const root = variant ? dirname(resolve(folder)) : folder;
  const meta: Json = JSON.parse(readFileSync(join(root, 'metadata.json'), 'utf8'));
  const state = variant ? meta.states?.find((st: Json) => st.folder === basename(resolve(folder))) : meta.states?.[0];
  if (!state?.frames?.rotations) throw new Error(variant ? `variante « ${basename(resolve(folder))} » absente du metadata.json parent` : 'metadata.json sans rotations');
  // Les chemins du metadata.json sont relatifs à son dossier.
  const load = (p: string) => decodePng(readFileSync(join(root, p)));

  // Colonnes : 0 = rotation fixe (idle), puis les images de chaque animation reconnue.
  const rotations: Record<string, string> = state.frames.rotations;
  const columns: Record<string, string | undefined>[] = [rotations];
  const animations: Json = {};
  const ignored: string[] = [];
  for (const [name, byDir] of Object.entries<Record<string, string[]>>(state.frames.animations ?? {})) {
    const anim = animationFor(name);
    if (!anim || anim === 'idle' || animations[anim]) {
      ignored.push(name);
      continue;
    }
    const count = framesFor(byDir, 'south')?.length ?? 0;
    const fps = anim in SHEET_LAYOUT ? SHEET_LAYOUT[anim as keyof typeof SHEET_LAYOUT].fps : EXTRA_FPS[anim];
    animations[anim] = { frames: Array.from({ length: count }, (_, i) => columns.length + i), fps };
    for (let i = 0; i < count; i++) columns.push(Object.fromEntries(DIRECTIONS.map((d) => [d, framesFor(byDir, d)?.[i]])));
  }
  animations.idle = { frames: [0], fps: 1 };
  for (const [anim, hit] of Object.entries(hits)) {
    if (!animations[anim]) throw new Error(`--hit : pas d'animation ${anim} dans cet export`);
    if (!(hit >= 0 && hit < animations[anim].frames.length)) throw new Error(`--hit : ${anim} n'a que ${animations[anim].frames.length} images`);
    animations[anim].hit = hit;
  }

  const cells = DIRECTIONS.map((d) => columns.map((c) => (c[d] ? load(c[d]!) : undefined)));
  const missing = DIRECTIONS.filter((_, r) => cells[r].some((c) => !c));
  if (missing.length) throw new Error(`directions incomplètes : ${missing.join(', ')}`);
  const size = Math.max(...cells.flat().map((c) => Math.max(c!.width, c!.height)));
  const sheet: Rgba = { width: size * columns.length, height: size * DIRECTIONS.length, data: Buffer.alloc(size * columns.length * size * DIRECTIONS.length * 4) };
  cells.forEach((row, r) =>
    row.forEach((img, c) => {
      // PixelLab agrandit le canevas des animations en gardant le personnage centré.
      const dx = c * size + (size - img!.width) / 2;
      const dy = r * size + (size - img!.height) / 2;
      for (let y = 0; y < img!.height; y++) img!.data.copy(sheet.data, ((dy + y) * sheet.width + dx) * 4, y * img!.width * 4, (y + 1) * img!.width * 4);
    }),
  );
  const [top, bottom] = opaqueRows(load(rotations.south));
  const sidecar: DirectionalSidecar = { frameWidth: size, frameHeight: size, bodyHeight: bottom - top + 1, ...(scale !== 1 ? { scale } : {}), animations };
  mkdirSync(SPRITES, { recursive: true });
  // Une copie par clé : chaque unité garde son fichier, remplaçable seule quand son vrai sprite arrive.
  const png = encodeRgba(sheet);
  for (const key of keys) {
    writeFileSync(join(SPRITES, `${key}.png`), png);
    writeFileSync(join(SPRITES, `${key}.directions.json`), JSON.stringify(sidecar, null, 2) + '\n');
  }
  console.log(`${keys.join(', ')} : ${columns.length} images × 8 directions de ${size} px · ${Object.keys(animations).join(', ')}`);
  if (ignored.length) console.log(`  animations ignorées : ${ignored.join(', ')}`);
  console.log('');
  importSprites(true);
}

/** Découpage d'une sheet : description 8 directions ou export Aseprite si présents, sinon images carrées et disposition standard. */
function readSheet(found: Found, problems: string[], key: string) {
  const { width, height } = pngSize(readFileSync(found.path));
  const directionalPath = found.path.replace(/\.png$/, '.directions.json');
  if (existsSync(directionalPath)) {
    const d: DirectionalSidecar = JSON.parse(readFileSync(directionalPath, 'utf8'));
    if (height !== d.frameHeight * DIRECTIONS.length) problems.push(`${key} : ${height} px de haut au lieu de 8 lignes de ${d.frameHeight} px`);
    return { frameWidth: d.frameWidth, frameHeight: d.frameHeight, animations: d.animations as Json, directions: DIRECTIONS.length, bodyHeight: d.bodyHeight / (d.scale ?? 1) }; // grossir = compter un corps plus petit
  }
  const asepritePath = found.path.replace(/\.png$/, '.json');
  let frameWidth = height;
  let frameHeight = height;
  let animations: Json | undefined;
  if (existsSync(asepritePath)) {
    const ase = JSON.parse(readFileSync(asepritePath, 'utf8'));
    const frames = Array.isArray(ase.frames) ? ase.frames : Object.values(ase.frames ?? {});
    const first = (frames[0] as Json | undefined)?.frame;
    if (!first) problems.push(`${key} : export Aseprite sans images`);
    else {
      frameWidth = first.w;
      frameHeight = first.h;
      if ((frames as Json[]).some((f) => f.frame.y !== 0)) problems.push(`${key} : les images doivent être sur une seule ligne (export Aseprite "Horizontal strip")`);
    }
    const tags: Json[] = ase.meta?.frameTags ?? [];
    if (tags.length) {
      animations = {};
      for (const t of tags) {
        const name = String(t.name).toLowerCase();
        if (!(name in SHEET_LAYOUT)) continue;
        animations[name] = { frames: Array.from({ length: t.to - t.from + 1 }, (_, i) => t.from + i), fps: SHEET_LAYOUT[name as keyof typeof SHEET_LAYOUT].fps };
      }
    }
  }
  if (width % frameWidth !== 0) problems.push(`${key} : largeur ${width} px qui n'est pas un multiple de ${frameWidth} px`);
  const count = Math.floor(width / frameWidth);
  if (!animations) {
    if (count >= SHEET_FRAMES) animations = structuredClone(SHEET_LAYOUT);
    else {
      animations = { idle: { frames: Array.from({ length: count }, (_, i) => i), fps: 6 } };
      problems.push(`${key} : ${count} image(s) au lieu de ${SHEET_FRAMES}, seule l'animation idle est utilisée`);
    }
  }
  if (!animations.idle) problems.push(`${key} : pas d'animation idle`);
  for (const [name, anim] of Object.entries<Json>(animations)) {
    if (anim.frames.some((f: number) => f >= count)) problems.push(`${key} : l'animation ${name} dépasse les ${count} images de la sheet`);
  }
  return { frameWidth, frameHeight, animations, directions: undefined, bodyHeight: undefined as number | undefined };
}

function importSprites(write: boolean) {
  const problems: string[] = [];
  const report: string[] = [];
  const known = new Set<string>();
  // Avec --theme, seules les entrées trouvées dans le dossier du thème sont écrites (le reste vient de la base).
  const themed: Json = { assets: {}, accessories: {} };

  for (const [key, entry] of Object.entries<Json>(manifest.assets)) {
    known.add(key);
    const found = find(key);
    const shape = shapeOf(entry);
    if (!found && THEME) {
      report.push(`  ${key.padEnd(16)} base`);
      continue;
    }
    if (!found) {
      // Plus de PNG : on revient à la silhouette.
      if (entry.type === 'spritesheet' && shape) manifest.assets[key] = { type: 'placeholder', ...shape, ...(entry.bricks?.death === 'stay' ? {} : entry.bricks ? { bricks: entry.bricks } : {}) };
      report.push(`  ${key.padEnd(16)} placeholder`);
      continue;
    }
    const sheet = readSheet(found, problems, key);
    const bricks = { ...(entry.bricks ?? {}), ...(sheet.animations.death ? { death: 'stay' } : {}) };
    if (!sheet.animations.death && bricks.death === 'stay') delete bricks.death;
    // Une sheet en 8 directions s'affiche à la hauteur de la silhouette qu'elle remplace.
    const size = sheet.bodyHeight && shape ? Math.round((sheet.frameHeight * shape.size) / sheet.bodyHeight) : sheet.frameHeight;
    manifest.assets[key] = {
      type: 'spritesheet',
      url: found.url,
      frameWidth: sheet.frameWidth,
      frameHeight: sheet.frameHeight,
      size,
      ...(sheet.directions ? { directions: sheet.directions } : {}),
      animations: sheet.animations,
      ...(Object.keys(bricks).length ? { bricks } : {}),
      ...(shape ? { placeholder: shape } : {}),
    };
    themed.assets[key] = manifest.assets[key];
    report.push(`  ${key.padEnd(16)} ${found.source.padEnd(12)} ${sheet.frameWidth}×${sheet.frameHeight}${sheet.directions ? ' · 8 directions' : ''} · ${Object.keys(sheet.animations).join(', ')}`);
  }

  for (const [key, entry] of Object.entries<Json>(manifest.accessories)) {
    known.add(key);
    const found = find(key);
    const shape = accessoryShapeOf(entry);
    if (!found && THEME) {
      report.push(`  ${key.padEnd(16)} base`);
      continue;
    }
    if (!found) {
      if (entry.type === 'image' && shape) manifest.accessories[key] = { type: 'placeholder', ...shape, anchor: entry.anchor };
      report.push(`  ${key.padEnd(16)} placeholder`);
      continue;
    }
    const { height } = pngSize(readFileSync(found.path));
    manifest.accessories[key] = { type: 'image', url: found.url, size: height, anchor: entry.anchor, ...(shape ? { placeholder: shape } : {}) };
    themed.accessories[key] = manifest.accessories[key];
    report.push(`  ${key.padEnd(16)} ${found.source.padEnd(12)} ${height} px`);
  }

  if (existsSync(SPRITES)) {
    for (const f of readdirSync(SPRITES).filter((f) => f.endsWith('.png'))) {
      if (!known.has(f.slice(0, -4))) problems.push(`${f} : aucune clé du manifeste ne porte ce nom (faute de frappe ?)`);
    }
  }

  console.log(report.join('\n'));
  if (problems.length) console.log(`\n${problems.length} problème(s) :\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  if (write && THEME_FILE) {
    const file: Json = existsSync(THEME_FILE) ? JSON.parse(readFileSync(THEME_FILE, 'utf8')) : { name: THEME };
    file.manifest ??= {};
    for (const part of ['assets', 'accessories'] as const) {
      if (Object.keys(themed[part]).length) file.manifest[part] = { ...(file.manifest[part] ?? {}), ...themed[part] };
    }
    writeFileSync(THEME_FILE, JSON.stringify(file, null, 2) + '\n');
    console.log(`\nThème ${THEME} mis à jour (src/render/themes/${THEME}.json).`);
  } else if (write) {
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log('\nManifeste mis à jour.');
  }
  return problems.length;
}

if (command === 'generate') generate();
else if (command === 'import') importSprites(true);
else if (command === 'check') process.exit(importSprites(false) ? 1 : 0);
else if (command === 'pixellab') {
  const scale = Number(args.find((a) => a.startsWith('--scale='))?.slice(8) ?? 1);
  const [folder, ...keys] = args.filter((a) => !a.startsWith('--'));
  const hit = args.find((a) => a.startsWith('--hit='))?.slice(6);
  const hits = Object.fromEntries((hit ? hit.split(',') : []).map((p) => p.split(':')).map(([a, n]) => [a, Number(n)]));
  pixellab(folder, keys, scale, hits);
}
else {
  console.error(`Commande inconnue : ${command} (generate, import, check, pixellab)`);
  process.exit(1);
}
