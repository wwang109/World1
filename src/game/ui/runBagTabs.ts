import type Phaser from 'phaser';
import { FONT, UI } from '../theme';
import { runScreenLayoutRef } from './runScreenLayout';
import { setDeckBuildContext } from '../deckBuildContext';
import { attachButtonFeel } from './motion';

export function renderRunBagTabs(scene: Phaser.Scene, compact: boolean, active: 'cards' | 'equipment'): void {
  const slot = runScreenLayoutRef(compact ? 'mobile' : 'desktop').actionSlots.secondary;
  const width = (slot.width - 4) / 2;
  (['cards', 'equipment'] as const).forEach((tab, index) => {
    const selected = tab === active, fill = selected ? UI.chip : UI.panelAlt;
    const x = slot.x + index * (width + 4);
    const plate = scene.add.rectangle(x, slot.y, width, slot.height, fill).setOrigin(0)
      .setStrokeStyle(1, UI.chip).setData('bagTab', tab);
    const caption = scene.add.text(x + width / 2, slot.y + slot.height / 2, tab.toUpperCase(), {
      fontFamily: FONT.body, fontSize: '8px', fontStyle: 'bold', color: selected ? UI.textOnChip : UI.textAccent,
    }).setOrigin(0.5);
    if (!selected) {
      plate.setInteractive({ useHandCursor: true });
      attachButtonFeel(scene, plate, { fill, hover: UI.slotHover, follow: [caption], onPress: () => {
        if (tab === 'cards') setDeckBuildContext('run');
        scene.scene.start(tab === 'equipment' ? compact ? 'MobileEquipment' : 'DesktopEquipment' : compact ? 'MobileDeckBuild' : 'DesktopDeck');
      } });
    }
  });
}
