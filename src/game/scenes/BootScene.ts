import Phaser from 'phaser';
import { installUnlock } from '../audio/audioBus';
import { applyDevLaunchConfig } from '../devLaunch';
import { ACTIVE_PROFILE } from '../layoutProfile';
import { CARD_ART_CATALOG } from '../ui/cardArtCatalog';
import { RUN_ART_ASSETS } from '../ui/runArt';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
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
