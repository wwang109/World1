import Phaser from 'phaser';
import { BootScene } from './game/scenes/BootScene';
import { StartScene } from './game/scenes/StartScene';
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
import { devicePixels, installFillHost, installRenderScale, uiScale } from './game/renderScale';

// The canvas FILLS the browser window (Phaser.Scale.RESIZE) -- no letterbox,
// no crop. `installFillHost` must run BEFORE the game is constructed: it sizes
// the #app parent in PHYSICAL pixels and pins the canvas to 100vw x 100vh, so
// Phaser's RESIZE mode builds a full-density backing store while the canvas
// still displays at exactly the window size. See `game/renderScale.ts` for the
// whole model and `game/viewport.ts` for the design-space contract scenes get.
const sizeFillHost = installFillHost();
window.addEventListener('resize', sizeFillHost);
window.addEventListener('orientationchange', sizeFillHost);

// Crisp text: the canvas backing store is sized to PHYSICAL pixels (above) and
// the camera is zoomed to match, so design coordinates stay in profile space
// while glyphs rasterize at native density. Text `resolution` is a modest
// supersample on top of that -- it CANNOT rescue an upscaled canvas (the glyph
// texture is resampled into the canvas first), so it stays low once the buffer
// itself carries the density.
const TEXT_RESOLUTION = uiScale() * devicePixels() >= 2 ? 1 : 2;
Phaser.GameObjects.GameObjectFactory.register(
  'text',
  function (this: Phaser.GameObjects.GameObjectFactory, x: number, y: number, text: string | string[], style?: Phaser.Types.GameObjects.Text.TextStyle) {
    const withRes: Phaser.Types.GameObjects.Text.TextStyle = { resolution: TEXT_RESOLUTION, ...style };
    return this.displayList.add(new Phaser.GameObjects.Text(this.scene, x, y, text, withRes)) as Phaser.GameObjects.Text;
  },
);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  // RESIZE overwrites these from the parent's size on the first refresh -- they
  // only matter for the very first frame, before the Scale Manager runs.
  width: window.innerWidth * devicePixels(),
  height: window.innerHeight * devicePixels(),
  parent: 'app',
  backgroundColor: '#0e0e12',
  // Integer device-pixel placement: without this, layout math that lands a
  // label at x=241.33 smears its glyph edges across two pixel columns.
  roundPixels: true,
  scale: {
    // FILL THE WINDOW. FIT scaled the design canvas uniformly and letterboxed
    // every window whose aspect wasn't the profile's -- 204px of black down
    // each side of a 2326x1199 window. RESIZE makes the canvas exactly the
    // window instead; the UI scale moved into the CAMERA (renderScale.ts) so
    // nothing shrinks and nothing is cropped, and `SCREEN.width`/`SCREEN.height`
    // (theme.ts) became live getters onto the resulting design viewport
    // (viewport.ts).
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.NO_CENTER,
    // We own the parent element's size (installFillHost) -- Phaser must not
    // restyle it out from under us.
    expandParent: false,
  },
  scene: [
    BootScene, StartScene, UiKitScene,
    MobilePrepScene, MobileDeckBuildScene, MobileBattleScene, MobileWikiScene, MobileShopScene, MobileDraftScene, MobileRunMapScene, MobileRunPrepScene, MobileRunEventScene,
    DesktopWikiScene, DesktopPrepScene, DesktopDeckBuildScene, DesktopBattleScene, DesktopShopScene, DesktopDraftScene, DesktopRunMapScene, DesktopRunPrepScene, DesktopRunEventScene,
  ],
});

installRenderScale(game);

// Dev aid: lets Playwright smoke scripts hit-test Phaser input directly
// (see docs/screenshot-howto.md).
(window as unknown as Record<string, unknown>).__game = game;
