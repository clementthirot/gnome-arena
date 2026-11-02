// Intégration des sprites : npm run sprites -- <commande>
//
//   generate            fabrique des sheets animées de remplacement dans public/sprites/generated/
//                       à partir des silhouettes du manifeste (même format que les vraies sheets)
//   import              écrit le manifeste à partir des PNG trouvés :
//                         public/sprites/<clé>.png            (tes sprites, prioritaires)
//                         public/sprites/generated/<clé>.png  (remplacement, sauf --no-generated)
//                       une exportation Aseprite <clé>.json à côté du PNG fixe le découpage et les animations
//   check               comme import, sans rien écrire ; code de sortie 1 en cas de problème
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { accessoryPixels, placeholderPixels, type PlaceholderShape } from '../src/render/pixels';
import { buildSheet, SHEET_FRAMES, SHEET_LAYOUT, sheetGrid } from '../src/render/spriteFrames';
import { encodePng, pngSize } from './lib/png';

const ROOT = join(import.meta.dirname, '..');
const MANIFEST = join(ROOT, 'src/render/assets.manifest.json');
const SPRITES = join(ROOT, 'public/sprites');
const GENERATED = join(SPRITES, 'generated');
const [command = 'check', ...args] = process.argv.slice(2);
const useGenerated = !args.includes('--no-generated');

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
  source: 'perso' | 'remplacement';
}

function find(key: string): Found | undefined {
  const own = join(SPRITES, `${key}.png`);
  if (existsSync(own)) return { url: `sprites/${key}.png`, path: own, source: 'perso' };
  const gen = join(GENERATED, `${key}.png`);
  if (useGenerated && existsSync(gen)) return { url: `sprites/generated/${key}.png`, path: gen, source: 'remplacement' };
  return undefined;
}

/** Découpage d'une sheet : export Aseprite si présent, sinon images carrées et disposition standard. */
function readSheet(found: Found, problems: string[], key: string) {
  const { width, height } = pngSize(readFileSync(found.path));
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
  return { frameWidth, frameHeight, animations };
}

function importSprites(write: boolean) {
  const problems: string[] = [];
  const report: string[] = [];
  const known = new Set<string>();

  for (const [key, entry] of Object.entries<Json>(manifest.assets)) {
    known.add(key);
    const found = find(key);
    const shape = shapeOf(entry);
    if (!found) {
      // Plus de PNG : on revient à la silhouette.
      if (entry.type === 'spritesheet' && shape) manifest.assets[key] = { type: 'placeholder', ...shape, ...(entry.bricks?.death === 'stay' ? {} : entry.bricks ? { bricks: entry.bricks } : {}) };
      report.push(`  ${key.padEnd(16)} placeholder`);
      continue;
    }
    const sheet = readSheet(found, problems, key);
    const bricks = { ...(entry.bricks ?? {}), ...(sheet.animations.death ? { death: 'stay' } : {}) };
    if (!sheet.animations.death && bricks.death === 'stay') delete bricks.death;
    manifest.assets[key] = {
      type: 'spritesheet',
      url: found.url,
      frameWidth: sheet.frameWidth,
      frameHeight: sheet.frameHeight,
      size: sheet.frameHeight,
      animations: sheet.animations,
      ...(Object.keys(bricks).length ? { bricks } : {}),
      ...(shape ? { placeholder: shape } : {}),
    };
    report.push(`  ${key.padEnd(16)} ${found.source.padEnd(12)} ${sheet.frameWidth}×${sheet.frameHeight} · ${Object.keys(sheet.animations).join(', ')}`);
  }

  for (const [key, entry] of Object.entries<Json>(manifest.accessories)) {
    known.add(key);
    const found = find(key);
    const shape = accessoryShapeOf(entry);
    if (!found) {
      if (entry.type === 'image' && shape) manifest.accessories[key] = { type: 'placeholder', ...shape, anchor: entry.anchor };
      report.push(`  ${key.padEnd(16)} placeholder`);
      continue;
    }
    const { height } = pngSize(readFileSync(found.path));
    manifest.accessories[key] = { type: 'image', url: found.url, size: height, anchor: entry.anchor, ...(shape ? { placeholder: shape } : {}) };
    report.push(`  ${key.padEnd(16)} ${found.source.padEnd(12)} ${height} px`);
  }

  if (existsSync(SPRITES)) {
    for (const f of readdirSync(SPRITES).filter((f) => f.endsWith('.png'))) {
      if (!known.has(f.slice(0, -4))) problems.push(`${f} : aucune clé du manifeste ne porte ce nom (faute de frappe ?)`);
    }
  }

  console.log(report.join('\n'));
  if (problems.length) console.log(`\n${problems.length} problème(s) :\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  if (write) {
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log('\nManifeste mis à jour.');
  }
  return problems.length;
}

if (command === 'generate') generate();
else if (command === 'import') importSprites(true);
else if (command === 'check') process.exit(importSprites(false) ? 1 : 0);
else {
  console.error(`Commande inconnue : ${command} (generate, import, check)`);
  process.exit(1);
}
