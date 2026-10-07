import type Phaser from 'phaser';
import type { EquipmentItemPin } from '../../data/equipmentLootSources';
import { equipmentLootSourcesFromJson } from '../../data/equipmentLootSources';
import { equipmentCatalog } from '../../data/equipmentContent';
import { equipmentDetailsModel } from '../../engine/equipment/details';
import type { RunState } from '../../run/runState';
import { FONT, UI } from '../theme';
import { equipmentArtKey } from './equipmentArt';
import { renderEquipmentLootPanel } from './equipmentLootPanel';
import { openRunModal } from './RunModal';

export function renderEquipmentDetailsDrawer(owner: Phaser.Scene, compact: boolean, ref: EquipmentItemPin, options: {
  run?: RunState;
  onClose?: () => void;
  primaryAction?: { label: string; enabled: boolean; onPress: () => void };
} = {}): void {
  const model = equipmentDetailsModel(ref, equipmentCatalog, equipmentLootSourcesFromJson());
  const previous = owner.registry.get('equipmentDetailsPanel');
  openRunModal(owner, {
    id: 'equipment-details', title: 'EQUIPMENT DETAILS', compact, width: 620, height: 580, footerHeight: 60,
    onClose: () => {
      if (previous === undefined) owner.registry.remove('equipmentDetailsPanel');
      else owner.registry.set('equipmentDetailsPanel', previous);
      options.onClose?.();
    },
    render: (scene, layout, handle) => {
      const { body, footer } = layout;
      const content = scene.add.container(0, 0);
      const text = (x: number, y: number, value: string, width: number, size = 16, color = UI.textBright) =>
        scene.add.text(x, y, value, { fontFamily: FONT.body, fontSize: `${size}px`, color, wordWrap: { width }, lineSpacing: 4 });
      const bodyText = (...args: Parameters<typeof text>) => { const line = text(...args); content.add(line); return line; };
      const artSize = compact ? 88 : 110;
      const image = scene.add.image(body.x + artSize / 2, body.y + artSize / 2, equipmentArtKey(ref.itemId));
      image.setScale(Math.min(artSize / image.width, artSize / image.height));
      content.add(image);
      const infoX = body.x + artSize + 16, infoWidth = body.width - artSize - 16;
      const name = bodyText(infoX, body.y, model.name, infoWidth, compact ? 18 : 22);
      const slot = bodyText(infoX, body.y + name.height + 8, model.slot.toUpperCase(), infoWidth, 12, UI.textAccent);
      const base = bodyText(infoX, slot.y + slot.height + 10, model.baseText, infoWidth, compact ? 14 : 16);
      let y = Math.max(body.y + artSize, base.y + base.height) + 24;
      if (model.set) {
        const set = bodyText(body.x, y, model.set.name, body.width, compact ? 18 : 22, UI.textAccent);
        y += set.height + 10;
        const requirement = bodyText(body.x, y, model.set.requirement, body.width, 14, UI.textMuted);
        y += requirement.height + 16;
        model.set.bonuses.forEach(bonus => {
          const line = bodyText(body.x, y, bonus, body.width, compact ? 14 : 16);
          y += line.height + 12;
        });
      }
      const shape = scene.make.graphics({}, false).fillStyle(0xffffff).fillRect(body.x, body.y, body.width, body.height);
      const mask = shape.createGeometryMask();
      content.setMask(mask);
      const maximum = Math.max(0, y - body.y - body.height);
      let scroll = 0, drag: { y: number; scroll: number } | null = null;
      const inside = (pointer: Phaser.Input.Pointer) => pointer.worldX >= body.x && pointer.worldX <= body.x + body.width
        && pointer.worldY >= body.y && pointer.worldY <= body.y + body.height;
      const apply = (next: number) => { scroll = Math.max(0, Math.min(maximum, next)); content.setY(-scroll); };
      const down = (pointer: Phaser.Input.Pointer) => { if (inside(pointer)) drag = { y: pointer.worldY, scroll }; };
      const move = (pointer: Phaser.Input.Pointer) => { if (drag && pointer.isDown) apply(drag.scroll + drag.y - pointer.worldY); };
      const up = () => { drag = null; };
      const wheel = (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => { if (inside(pointer)) apply(scroll + dy); };
      scene.input.on('pointerdown', down).on('pointermove', move).on('pointerup', up).on('pointerupoutside', up).on('wheel', wheel);
      content.once('destroy', () => {
        scene.input.off('pointerdown', down).off('pointermove', move).off('pointerup', up).off('pointerupoutside', up).off('wheel', wheel);
        content.clearMask(); mask.destroy(); shape.destroy();
      });
      const button = (x: number, width: number, label: string, action: () => void, enabled = true) => {
        const box = scene.add.rectangle(x, footer.y, width, 44, UI.chip, enabled ? 1 : 0.4).setOrigin(0)
          .setData('equipmentDetailsControl', label);
        text(x + width / 2, footer.y + 22, label, width - 12, 14, UI.textOnChip).setOrigin(0.5);
        if (enabled) box.setInteractive({ useHandCursor: true }).on('pointerup', action);
      };
      const primary = options.primaryAction, width = primary ? (footer.width - 8) / 2 : footer.width;
      button(footer.x, width, 'LOOT FROM', () => renderEquipmentLootPanel(scene, compact, model, 0, () => {}, () => {},
        options.run && { ref, run: options.run, onChanged: () => {} }));
      if (primary) button(footer.x + width + 8, width, primary.label, () => { handle.close(); primary.onPress(); }, primary.enabled);
      scene.registry.set('equipmentDetailsPanel', { ref, model });
    },
  });
}
