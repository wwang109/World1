import Phaser from 'phaser';
import { applyDevLaunchConfig } from '../devLaunch';
import { CARD_ART_CATALOG } from '../ui/cardArtCatalog';

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
  }

  create(): void {
    const launch = applyDevLaunchConfig();
    const target = launch.scene === 'battle' ? 'Battle'
      : launch.scene === 'uikit' ? 'UiKit'
      : launch.scene === 'mprep' ? 'MobilePrep'
      : launch.scene === 'mdeck' ? 'MobileDeckBuild'
      : 'Prep';
    this.scene.start(target);
  }
}
