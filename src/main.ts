import Phaser from 'phaser';
import { BootScene } from './game/scenes/BootScene';
import { PrepScene } from './game/scenes/PrepScene';
import { BattleScene } from './game/scenes/BattleScene';
import { UiKitScene } from './game/scenes/UiKitScene';
import { MobilePrepScene } from './game/scenes/MobilePrepScene';
import { MobileDeckBuildScene } from './game/scenes/MobileDeckBuildScene';
import { MobileBattleScene } from './game/scenes/MobileBattleScene';
import { MobileWikiScene } from './game/scenes/MobileWikiScene';
import { DesktopWikiScene } from './game/scenes/DesktopWikiScene';
import { DesktopPrepScene } from './game/scenes/DesktopPrepScene';
import { DesktopDeckBuildScene } from './game/scenes/DesktopDeckBuildScene';
import { DesktopBattleScene } from './game/scenes/DesktopBattleScene';
import { DesktopShopScene } from './game/scenes/DesktopShopScene';
import { MobileShopScene } from './game/scenes/MobileShopScene';
import { DesktopDraftScene } from './game/scenes/DesktopDraftScene';
import { MobileDraftScene } from './game/scenes/MobileDraftScene';
import { ACTIVE_PROFILE } from './game/layoutProfile';
import { SCREEN } from './game/theme';

// Crisp text: the canvas is a fixed-size buffer (per layout profile) scaled
// with FIT, so on a large or high-DPI screen the browser up-scales it and text
// edges soften. Phaser Text renders to its own texture, so bumping every
// Text's `resolution` draws that texture at a higher pixel density — sharp
// through the up-scale — without touching any layout coordinate. Done globally
// by wrapping the `text` factory so all scenes benefit. Capped (3× mobile,
// 4× desktop — its 1440-wide canvas rarely up-scales much) to bound texture
// memory.
const TEXT_RESOLUTION = Math.max(
  2,
  Math.min(ACTIVE_PROFILE.id === 'desktop' ? 4 : 3, Math.ceil((window.devicePixelRatio || 1) * 2)),
);
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
  scene: [
    BootScene, PrepScene, BattleScene, UiKitScene,
    MobilePrepScene, MobileDeckBuildScene, MobileBattleScene, MobileWikiScene, MobileShopScene, MobileDraftScene,
    DesktopWikiScene, DesktopPrepScene, DesktopDeckBuildScene, DesktopBattleScene, DesktopShopScene, DesktopDraftScene,
  ],
});

// Dev aid: lets Playwright smoke scripts hit-test Phaser input directly
// (see docs/screenshot-howto.md).
(window as unknown as Record<string, unknown>).__game = game;
