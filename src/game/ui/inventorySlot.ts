import type Phaser from 'phaser';
import { UI } from '../theme';
import { roundRect } from './roundedRect';

export function renderInventorySlot(scene: Phaser.Scene, x: number, y: number, width: number, height: number, compact: boolean) {
  const slot = scene.add.rectangle(x, y, width, height, compact ? 0x121e30 : UI.slot, 0.45)
    .setOrigin(0).setStrokeStyle(1, compact ? 0x24344a : UI.border, compact ? 0.9 : 0.35);
  return compact ? roundRect(slot, 8) : slot;
}
