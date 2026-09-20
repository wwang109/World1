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
import { DesktopCardDesignScene } from './game/scenes/DesktopCardDesignScene';
import { shouldPreserveDrawingBufferForLayoutAudit } from './game/devLaunch';
import { devicePixels, installFillHost, installRenderScale, manageTextResolution, textResolution } from './game/renderScale';

// The canvas FILLS the browser window (Phaser.Scale.RESIZE) -- no letterbox,
// no crop. `installFillHost` must run BEFORE the game is constructed: it sizes
// the #app parent in PHYSICAL pixels and pins the canvas to 100vw x 100vh, so
// Phaser's RESIZE mode builds a full-density backing store while the canvas
// still displays at exactly the window size. See `game/renderScale.ts` for the
// whole model and `game/viewport.ts` for the design-space contract scenes get.
const sizeFillHost = installFillHost();
window.addEventListener('resize', sizeFillHost);
window.addEventListener('orientationchange', sizeFillHost);
window.visualViewport?.addEventListener('resize', sizeFillHost);
window.visualViewport?.addEventListener('scroll', sizeFillHost);

// Phaser has already registered `text`; register alone refuses an existing
// key. Wrap its original factory so all normal Text behavior is preserved.
// Density follows the current DPR/scale, while explicit styles stay owned by
// their callers. Only automatic Text objects refresh when display scale changes.
const originalTextFactory = Phaser.GameObjects.GameObjectFactory.prototype.text;
Phaser.GameObjects.GameObjectFactory.remove('text');
Phaser.GameObjects.GameObjectFactory.register(
  'text',
  function (this: Phaser.GameObjects.GameObjectFactory, x: number, y: number, text: string | string[], style?: Phaser.Types.GameObjects.Text.TextStyle) {
    const automatic = style?.resolution === undefined;
    const withRes: Phaser.Types.GameObjects.Text.TextStyle = automatic ? { ...style, resolution: textResolution() } : { ...style };
    const result = originalTextFactory.call(this, x, y, text, withRes);
    if (automatic) manageTextResolution(result);
    return result;
  },
);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  // WebGL's default non-preserved buffer can be cleared before a browser
  // capture reads it. Pay the preservation cost only on the explicit
  // development layout-audit route; normal development and production keep
  // Phaser's default false behavior.
  render: {
    preserveDrawingBuffer: shouldPreserveDrawingBufferForLayoutAudit(
      import.meta.env.DEV,
      window.location.search,
    ),
  },
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
    DesktopCardDesignScene,
  ],
});

installRenderScale(game);

// Dev aid: lets Playwright smoke scripts hit-test Phaser input directly
// (see docs/screenshot-howto.md).
(window as unknown as Record<string, unknown>).__game = game;
