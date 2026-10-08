import type Phaser from 'phaser';
import { UI } from '../theme';
import { renderPaintedChrome } from './paintedChrome';

export type ItemFrameVariant = 'bag';

export function renderItemChrome(
  scene: Phaser.Scene, x: number, y: number, width: number, height: number,
  options: { variant: ItemFrameVariant; selected?: boolean },
): Phaser.GameObjects.Container {
  const frame = scene.add.container(x, y).setName(`item-chrome-${options.variant}`).setSize(width, height);
  const rim = scene.add.graphics();
  const painted = renderPaintedChrome(scene, 0, 0, width, height, {
    borderOnly: true, corner: Math.min(8, height / 4, width / 4), shadow: false,
  });
  if (painted) frame.add(painted);
  else rim.lineStyle(2, 0xa88b54, 0.95).strokeRect(1, 1, width - 2, height - 2);
  if (options.selected) rim.lineStyle(2, UI.chip, 1).strokeRect(1, 1, width - 2, height - 2);
  frame.add(rim);
  return frame;
}
