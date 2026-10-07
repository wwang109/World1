import Phaser from 'phaser';
import { textRole, UI } from '../theme';
import { attachButtonFeel } from './motion';

export function renderRunLogToggle(scene: Phaser.Scene, x: number, y: number, width: number, height: number,
  copy: string, enabled: boolean, onPress: () => void,
): void {
  const plate = scene.add.rectangle(x, y, width, height, UI.panelAlt, 0.98).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8);
  const label = scene.add.text(x + width / 2, y + height / 2, copy, textRole('micro', { ink: 'accent' })).setOrigin(0.5);
  if (enabled) plate.setInteractive({ useHandCursor: true });
  attachButtonFeel(scene, plate, { fill: UI.panelAlt, hover: UI.chipDark, follow: [label], lift: 0, onPress });
}
