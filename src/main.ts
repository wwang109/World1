import Phaser from 'phaser';
import { PrepScene } from './game/scenes/PrepScene';
import { BattleScene } from './game/scenes/BattleScene';
import { CardsScene } from './game/scenes/CardsScene';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  parent: 'app',
  backgroundColor: '#0e0e12',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [PrepScene, CardsScene, BattleScene],
});
