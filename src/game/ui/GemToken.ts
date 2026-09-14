import Phaser from 'phaser';
import type { GemDef } from '../../data/gems';
import { gemArtKey } from './gemArt';

/** Unmasked, contain-fit jewel: safe inside moving/scrolling inventory containers. */
export class GemToken extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, x: number, y: number, gem: GemDef, size: { width: number; height: number }) {
    super(scene, x, y);
    scene.add.existing(this);
    this.setSize(size.width, size.height);
    const art = scene.add.image(0, 0, gemArtKey(gem.rarity));
    const scale = Math.min(size.width / art.width, size.height / art.height);
    art.setDisplaySize(art.width * scale, art.height * scale);
    this.add(art);
  }
}
