import Phaser from 'phaser';
import { BootScene } from './game/scenes/BootScene';
import { PrepScene } from './game/scenes/PrepScene';
import { BattleScene } from './game/scenes/BattleScene';
import { UiKitScene } from './game/scenes/UiKitScene';
import { MobilePrepScene } from './game/scenes/MobilePrepScene';
import { MobileDeckBuildScene } from './game/scenes/MobileDeckBuildScene';
import { SCREEN } from './game/theme';

// Crisp text: the canvas is a fixed 720×1280 buffer scaled with FIT, so on a
// large or high-DPI screen the browser up-scales it and text edges soften.
// Phaser Text renders to its own texture, so bumping every Text's `resolution`
// draws that texture at a higher pixel density — sharp through the up-scale —
// without touching any layout coordinate. Done globally by wrapping the `text`
// factory so all scenes benefit. Capped at 3× to bound texture memory.
const TEXT_RESOLUTION = Math.max(2, Math.min(3, Math.ceil((window.devicePixelRatio || 1) * 2)));
Phaser.GameObjects.GameObjectFactory.register(
  'text',
  function (this: Phaser.GameObjects.GameObjectFactory, x: number, y: number, text: string | string[], style?: Phaser.Types.GameObjects.Text.TextStyle) {
    const withRes: Phaser.Types.GameObjects.Text.TextStyle = { resolution: TEXT_RESOLUTION, ...style };
    return this.displayList.add(new Phaser.GameObjects.Text(this.scene, x, y, text, withRes)) as Phaser.GameObjects.Text;
  },
);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: SCREEN.width,
  height: SCREEN.height,
  parent: 'app',
  backgroundColor: '#f6f0e7',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, PrepScene, BattleScene, UiKitScene, MobilePrepScene, MobileDeckBuildScene],
});

// Dev aid: lets Playwright smoke scripts hit-test Phaser input directly
// (see docs/screenshot-howto.md).
(window as unknown as Record<string, unknown>).__game = game;
