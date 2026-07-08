import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.add
      .text(640, 300, 'WORLD1', {
        fontSize: '72px',
        color: '#e8d5a0',
        fontFamily: 'monospace',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add
      .text(640, 380, 'turn-based roguelite party battler', {
        fontSize: '24px',
        color: '#8a8a9a',
        fontFamily: 'monospace',
      })
      .setOrigin(0.5);
  }
}
