import Phaser from 'phaser';
import { installUnlock } from '../audio/audioBus';
import { applyDevLaunchConfig } from '../devLaunch';
import { ACTIVE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { applyRenderScale } from '../renderScale';
import { brandMarkCenterY, renderBrandMark, type BrandMark } from '../ui/brandMark';
import { CARD_ART_CATALOG } from '../ui/cardArtCatalog';
import { RUN_ART_ASSETS } from '../ui/runArt';

/** Where the wordmark block sits, as a fraction of viewport height. Boot
 * centres it (there is nothing else on screen); the title screen sits higher
 * to leave room for its two doors. */
const BOOT_TITLE_FRACTION: Record<'mobile' | 'desktop', number> = { mobile: 0.42, desktop: 0.44 };
/** Wordmark centre -> progress bar centre. */
const BAR_GAP: Record<'mobile' | 'desktop', number> = { mobile: 64, desktop: 84 };
const BAR_HEIGHT: Record<'mobile' | 'desktop', number> = { mobile: 8, desktop: 10 };
/** Desktop's bar is a fixed width; mobile's is the screen minus this margin. */
const BAR_WIDTH_DESKTOP = 340;
const BAR_SIDE_MARGIN_MOBILE = 80;
/** Bar bottom edge -> percentage label centre. */
const PCT_GAP: Record<'mobile' | 'desktop', number> = { mobile: 12, desktop: 16 };

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  /** The loading UI's movable parts, kept so `layoutLoadingUi` can re-centre
   * them on a window resize -- the canvas fills the window now, so the
   * viewport can change WHILE the loader is running. This scene cannot use the
   * project's usual resize answer (re-run `create()`): its `create()` starts
   * the next scene. */
  private ui: {
    brand: BrandMark;
    track: Phaser.GameObjects.Rectangle;
    fill: Phaser.GameObjects.Rectangle;
    pct: Phaser.GameObjects.Text;
  } | null = null;

  private progress = 0;

  /** Loading UI, built before any `this.load.*` calls so it paints on the
   * very first frame — a Boot preload with no art loaded yet still shows the
   * wordmark + an empty bar instead of a black canvas. Wired to the real
   * loader ('progress'/'complete'), never a fake timer. */
  private buildLoadingUi(): void {
    const id = ACTIVE_PROFILE.id;
    const F = ACTIVE_PROFILE.font;
    this.cameras.main.setBackgroundColor(UI.bg);

    const brand = renderBrandMark(this, SCREEN.width / 2, brandMarkCenterY(BOOT_TITLE_FRACTION[id]));
    const barH = BAR_HEIGHT[id];
    const track = this.add.rectangle(0, 0, 10, barH, UI.chipDark, 1).setStrokeStyle(1, UI.border, 0.6);
    const fill = this.add.rectangle(0, 0, 0, barH - 2, UI.chip, 1).setOrigin(0, 0.5);
    const pct = this.add.text(0, 0, '0%', {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textMuted,
    }).setOrigin(0.5);
    this.ui = { brand, track, fill, pct };
    this.layoutLoadingUi();

    // The canvas fills the window, so the viewport can change mid-load. Phaser
    // resizes the canvas and the camera by itself; this puts the loading UI
    // back in the middle of the new one.
    const onResize = (): void => {
      applyRenderScale(this);
      this.layoutLoadingUi();
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    // Dropping `ui` here as well as unsubscribing is not belt-and-braces: a
    // RESIZE dispatched in the same tick that the load completes can reach this
    // handler AFTER `create()` has started the next scene and destroyed these
    // objects (Phaser's emitter iterates a snapshot of its listener list), and
    // repositioning a destroyed Rectangle throws.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      this.ui = null;
    });

    this.load.on('progress', (value: number) => {
      this.progress = value;
      pct.setText(`${Math.round(value * 100)}%`);
      this.layoutLoadingUi();
    });
    this.load.on('complete', () => {
      this.progress = 1;
      pct.setText('100%');
      this.layoutLoadingUi();
    });
  }

  /** Positions every part of the loading UI from the CURRENT viewport. Called
   * on build, on every progress tick, and on every resize -- it is the only
   * place loading-screen geometry is computed. */
  private layoutLoadingUi(): void {
    const ui = this.ui;
    // `scene` is nulled by `GameObject.destroy()`, so this also covers the
    // window between the objects dying and SHUTDOWN clearing `ui`.
    if (!ui || !ui.track.scene) return;
    const id = ACTIVE_PROFILE.id;
    const cx = SCREEN.width / 2;
    const titleY = brandMarkCenterY(BOOT_TITLE_FRACTION[id]);
    ui.brand.setCenter(cx, titleY);

    const barY = titleY + BAR_GAP[id];
    const barH = BAR_HEIGHT[id];
    const barW = id === 'mobile' ? SCREEN.width - BAR_SIDE_MARGIN_MOBILE : BAR_WIDTH_DESKTOP;
    ui.track.setPosition(cx, barY).setSize(barW, barH);
    ui.fill.setPosition(cx - barW / 2, barY);
    ui.fill.width = Math.max(0, (barW - 2) * this.progress);
    ui.pct.setPosition(cx, barY + barH / 2 + PCT_GAP[id]);
  }

  preload(): void {
    this.buildLoadingUi();
    this.load.image('card-template-parts', '/game-art/card-template-parts-transparent.png');
    this.load.image('card-badge:template:sword', '/game-art/template/badge-sword.png');
    this.load.image('card-badge:template:lance', '/game-art/template/badge-lance.png');
    this.load.image('card-badge:template:axe', '/game-art/template/badge-axe.png');
    this.load.image('card-badge:template:bow', '/game-art/template/badge-bow.png');
    this.load.image('card-badge:template:fangs', '/game-art/template/badge-fangs.png');
    this.load.image('card-badge:template:fire', '/game-art/template/badge-fire.png');
    this.load.image('card-badge:template:frost', '/game-art/template/badge-frost.png');
    this.load.image('card-badge:template:lightning', '/game-art/template/badge-lightning.png');
    this.load.image('card-badge:template:nature', '/game-art/template/badge-nature.png');
    this.load.image('card-badge:template:holy', '/game-art/template/badge-holy.png');
    this.load.image('card-badge:template:dark', '/game-art/template/badge-dark.png');
    this.load.image('card-badge:template:offense', '/game-art/template/badge-offense.png');
    this.load.image('card-badge:template:defensive', '/game-art/template/badge-defensive.png');
    this.load.image('card-badge:template:healing', '/game-art/template/badge-healing.png');
    this.load.image('card-badge:template:support', '/game-art/template/badge-support.png');
    this.load.image('card-badge:template:debuff', '/game-art/template/badge-debuff.png');
    for (const entry of Object.values(CARD_ART_CATALOG)) {
      this.load.image(entry.textureKey, `/game-art/cards/${entry.fileName}`);
    }
    for (const asset of RUN_ART_ASSETS) {
      this.load.image(asset.key, asset.path);
    }
  }

  create(): void {
    // Autoplay policy: the AudioContext can't start until a user gesture —
    // arm the one-shot unlock here so sound works from the first click on.
    installUnlock();
    const launch = applyDevLaunchConfig();
    // Explicit ?scene/?view wins; otherwise the game opens on the Start
    // screen (START RUN / SANDBOX doors) regardless of profile.
    const defaultScene = 'Start';
    const battleScene = ACTIVE_PROFILE.id === 'mobile' ? 'MobileBattle' : 'DesktopBattle';
    const target = launch.scene === 'battle' ? battleScene
      : launch.scene === 'uikit' ? 'UiKit'
      : launch.scene === 'mprep' ? 'MobilePrep'
      : launch.scene === 'mdeck' ? 'MobileDeckBuild'
      : launch.scene === 'mbattle' ? 'MobileBattle'
      : launch.scene === 'mwiki' ? 'MobileWiki'
      : launch.scene === 'desktop-wiki' ? 'DesktopWiki'
      : launch.scene === 'desktop-prep' ? 'DesktopPrep'
      : launch.scene === 'desktop-deck' ? 'DesktopDeck'
      : launch.scene === 'desktop-battle' ? 'DesktopBattle'
      : launch.scene === 'desktop-shop' ? 'DesktopShop'
      : launch.scene === 'mobile-shop' ? 'MobileShop'
      : launch.scene === 'desktop-draft' ? 'DesktopDraft'
      : launch.scene === 'mobile-draft' ? 'MobileDraft'
      : launch.scene === 'desktop-runmap' ? 'DesktopRunMap'
      : launch.scene === 'mrunmap' ? 'MobileRunMap'
      : launch.scene === 'desktop-runprep' ? 'DesktopRunPrep'
      : launch.scene === 'mrunprep' ? 'MobileRunPrep'
      : launch.scene === 'desktop-runevent' ? 'DesktopRunEvent'
      : launch.scene === 'mrunevent' ? 'MobileRunEvent'
      : ACTIVE_PROFILE.id === 'desktop' && launch.prepView === 'bag' ? 'DesktopDeck'
      : ACTIVE_PROFILE.id === 'desktop' && launch.prepView === 'codex' ? 'DesktopWiki'
      : defaultScene;
    this.scene.start(target);
  }
}
