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
      for (const [name, anim] of Object.entries(entry.animations)) {
        if (!anim) continue;
        this.anims.create({
          key: `${texture}_${name}`,
          frames: this.anims.generateFrameNumbers(texture, { frames: anim.frames }),
          frameRate: anim.fps,
          repeat: name === 'death' || name === 'attack' ? 0 : -1,
        });
      }
    }
    this.registry.set('fallbackVisuals', this.failed);
    this.scene.start('arena', params);
  }
}
