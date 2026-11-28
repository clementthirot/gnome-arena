// Chargement : transforme le manifeste en textures (placeholders générés ou sprite sheets chargées).
import Phaser from 'phaser';
import { asPlaceholder, manifest } from '../manifest';
import { drawPlaceholder } from '../placeholders';
import type { ArenaParams } from './ArenaScene';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  /** Clés dont la sheet n'a pas chargé : elles retombent sur leur silhouette de secours. */
  private failed = new Set<string>();

  preload(): void {
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[manifest] image introuvable : ${file.url}`);
      this.failed.add(file.key.replace(/^unit_/, ''));
    });
    for (const [key, entry] of Object.entries(manifest.assets)) {
      if (entry.type === 'spritesheet') {
        this.load.spritesheet(`unit_${key}`, entry.url, { frameWidth: entry.frameWidth, frameHeight: entry.frameHeight });
      }
    }
    for (const [key, entry] of Object.entries(manifest.accessories)) {
      if (entry.type === 'image') this.load.image(`acc_img_${key}`, entry.url);
    }
    for (const [key, entry] of Object.entries(manifest.overlays)) {
      if (entry.type === 'image') this.load.image(`ovl_img_${key}`, entry.url);
    }
    // Illustrations PixelLab facultatives (titre, sols, effets) : repli sur le dessin par code.
    if (manifest.art.title) this.load.image('art_title', manifest.art.title);
    for (const [biome, url] of Object.entries(manifest.art.grounds)) this.load.image(`art_ground_${biome}`, url);
    if (manifest.art.stands) this.load.image('art_stands', manifest.art.stands);
    if (manifest.art.king) this.load.image('art_king', manifest.art.king);
    if (manifest.art.throne) this.load.image('art_throne', manifest.art.throne);
    for (const k of ['pattern', 'card', 'plaque', 'crown', 'gift'] as const) {
      const url = manifest.art.menu[k];
      if (url) this.load.image(`ui_${k}`, url);
    }
    for (const [key, entry] of Object.entries(manifest.effects)) if (entry.sprite) this.load.image(`fx_img_${key}`, entry.sprite.url);
    manifest.staging.gas.sprites.forEach((url, i) => this.load.image(`gas_puff_${i}`, url));
    // Cadre de la machine à sous : image facultative, sinon dessiné par slotMachine.ts.
    if (manifest.staging.reveal.slot.url) this.load.image('ui_slot_frame', manifest.staging.reveal.slot.url);
  }

  create(params: ArenaParams): void {
    for (const [key, entry] of Object.entries(manifest.assets)) {
      const texture = `unit_${key}`;
      if (entry.type === 'placeholder') {
        this.textures.addCanvas(texture, drawPlaceholder(entry));
        continue;
      }
      // Une sheet absente peut aussi arriver « chargée » mais illisible (le serveur renvoie une page HTML).
      if (!this.textures.exists(texture)) this.failed.add(key);
      if (this.failed.has(key)) {
        const fallback = asPlaceholder(entry);
        if (fallback) this.textures.addCanvas(texture, drawPlaceholder(fallback));
        continue;
      }
      // Sheet en 8 directions : une animation par ligne (clé suffixée par l'indice de direction).
      const columns = this.textures.get(texture).source[0].width / entry.frameWidth;
      const rows = entry.directions ? Array.from({ length: entry.directions }, (_, d) => d) : [undefined];
      for (const [name, anim] of Object.entries(entry.animations)) {
        if (!anim) continue;
        // Une image hors de la sheet donnerait une animation vide, qui plante au premier affichage.
        const total = this.textures.get(texture).frameTotal - 1; // sans l'image __BASE
        const lastRow = rows.length - 1;
        if (anim.frames.some((f) => f < 0 || (entry.directions && f >= columns) || f + lastRow * columns >= total)) {
          console.warn(`Animation ${key}.${name} : images hors de la sheet (${columns} colonnes), ignorée.`);
          continue;
        }
        for (const d of rows) {
          this.anims.create({
            key: d === undefined ? `${texture}_${name}` : `${texture}_${name}_${d}`,
            frames: this.anims.generateFrameNumbers(texture, { frames: anim.frames.map((f) => f + (d ?? 0) * columns) }),
            frameRate: anim.fps,
            repeat: name === 'death' || name === 'attack' ? 0 : -1,
          });
        }
      }
    }
    this.registry.set('fallbackVisuals', this.failed);
    this.scene.start('arena', params);
  }
}
