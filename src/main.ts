import Phaser from 'phaser';
import { BootScene } from './game/scenes/BootScene';
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
import { DesktopRunMapScene } from './game/scenes/DesktopRunMapScene';
import { MobileRunMapScene } from './game/scenes/MobileRunMapScene';
import { DesktopRunPrepScene } from './game/scenes/DesktopRunPrepScene';
import { MobileRunPrepScene } from './game/scenes/MobileRunPrepScene';
import { DesktopRunEventScene } from './game/scenes/DesktopRunEventScene';
import { MobileRunEventScene } from './game/scenes/MobileRunEventScene';
import { SCREEN } from './game/theme';
import { computeRenderScale, installRenderScale } from './game/renderScale';

// Crisp text: the canvas backing store is sized to PHYSICAL pixels by
// `renderScale` (design size x FIT ratio x devicePixelRatio) and the camera is
// zoomed to match, so design coordinates stay in profile space while glyphs
// rasterize at native density. Text `resolution` is a modest supersample on
// top of that — it CANNOT rescue an upscaled canvas (the glyph texture is
// resampled into the canvas first), so it stays low now that the buffer
// itself carries the density.
const RENDER_SCALE = computeRenderScale();
const TEXT_RESOLUTION = RENDER_SCALE >= 2 ? 1 : 2;
Phaser.GameObjects.GameObjectFactory.register(
  'text',
  function (this: Phaser.GameObjects.GameObjectFactory, x: number, y: number, text: string | string[], style?: Phaser.Types.GameObjects.Text.TextStyle) {
    const withRes: Phaser.Types.GameObjects.Text.TextStyle = { resolution: TEXT_RESOLUTION, ...style };
    return this.displayList.add(new Phaser.GameObjects.Text(this.scene, x, y, text, withRes)) as Phaser.GameObjects.Text;
  },
);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: Math.round(SCREEN.width * RENDER_SCALE),
  height: Math.round(SCREEN.height * RENDER_SCALE),
  parent: 'app',
  backgroundColor: '#f6f0e7',
  // Integer device-pixel placement: without this, layout math that lands a
  // label at x=241.33 smears its glyph edges across two pixel columns.
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [
    BootScene, UiKitScene,
    MobilePrepScene, MobileDeckBuildScene, MobileBattleScene, MobileWikiScene, MobileShopScene, MobileDraftScene, MobileRunMapScene, MobileRunPrepScene, MobileRunEventScene,
    DesktopWikiScene, DesktopPrepScene, DesktopDeckBuildScene, DesktopBattleScene, DesktopShopScene, DesktopDraftScene, DesktopRunMapScene, DesktopRunPrepScene, DesktopRunEventScene,
  ],
});

installRenderScale(game, RENDER_SCALE);

// Dev aid: lets Playwright smoke scripts hit-test Phaser input directly
// (see docs/screenshot-howto.md).
(window as unknown as Record<string, unknown>).__game = game;
