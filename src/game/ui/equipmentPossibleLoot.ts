import type Phaser from 'phaser';
import { FONT, UI } from '../theme';
import { equipmentArtKey } from './equipmentArt';
import { equipmentChanceText, type EquipmentLootChance } from './equipmentLootTrackingModel';
import { equipmentDetailsModel } from '../../engine/equipment/details';
import { equipmentCatalog } from '../../data/equipmentContent';
import { equipmentLootSourcesFromJson } from '../../data/equipmentLootSources';
import { renderEquipmentLootPanel } from './equipmentLootPanel';
import { getActiveRun } from '../runStore';
import { rebuildScene } from '../sceneRebuild';

export function renderEquipmentChancePanel(scene: Phaser.Scene, compact: boolean, items: readonly EquipmentLootChance[], page = 0): void {
  const w = Math.min(scene.scale.width - 20, 600), h = Math.min(scene.scale.height - 40, 550);
  const x = (scene.scale.width - w) / 2, y = (scene.scale.height - h) / 2, objects: Phaser.GameObjects.GameObject[] = [];
  const keep = <T extends Phaser.GameObjects.GameObject>(object: T): T => { object.setData('equipmentChanceOverlay', true); objects.push(object); return object; };
  const close = () => objects.forEach(object => object.destroy());
  keep(scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, UI.shadow, 0.88).setOrigin(0).setDepth(6100).setInteractive());
  keep(scene.add.rectangle(x, y, w, h, UI.panel).setOrigin(0).setStrokeStyle(1, UI.chip).setDepth(6101));
  const text = (tx: number, ty: number, value: string, width: number, size = 14, color = UI.textBright) =>
    keep(scene.add.text(tx, ty, value, { fontFamily: FONT.body, fontSize: `${size}px`, color, wordWrap: { width }, lineSpacing: 3 }).setDepth(6102));
  const control = (tx: number, ty: number, label: string, key: string, action: () => void) => {
    keep(scene.add.rectangle(tx, ty, 44, 44, UI.chip).setOrigin(0).setDepth(6103).setData('equipmentChanceControl', key)
      .setInteractive({ useHandCursor: true }).on('pointerdown', action));
    text(tx + 22, ty + 22, label, 40, 20, UI.textOnChip).setOrigin(0.5).setDepth(6103);
  };
  text(x + 16, y + 20, 'POSSIBLE EQUIPMENT', w - 84, compact ? 16 : 20, UI.textAccent);
  text(x + 16, y + 57, 'Up to one item per victory. Events: new items first.', w - 32, 12, UI.textMuted);
  control(x + w - 60, y + 12, '\u00d7', 'CLOSE', close);
  const perPage = Math.max(1, Math.floor((h - 158) / 72)), pages = Math.max(1, Math.ceil(items.length / perPage)), current = Math.max(0, Math.min(page, pages - 1));
  items.slice(current * perPage, (current + 1) * perPage).forEach((item, index) => {
    const iy = y + 94 + index * 72;
    const openSources = () => {
      const run = getActiveRun();
      if (!run) return;
      close();
      const show = (sourcePage = 0) => {
        renderEquipmentLootPanel(scene, compact, equipmentDetailsModel(item.ref, equipmentCatalog, equipmentLootSourcesFromJson()), sourcePage,
          next => { clearSources(); show(next); }, () => { clearSources(); rebuildScene(scene as Phaser.Scene & { create: () => void }); },
          { ref: item.ref, run, onChanged: () => { clearSources(); show(sourcePage); } });
      };
      const clearSources = () => scene.children.list.filter(object => object.getData('equipmentLootOverlay')).forEach(object => object.destroy());
      show();
    };
    keep(scene.add.zone(x + 12, iy, w - 24, 64).setOrigin(0).setDepth(6103).setData('equipmentChanceItem', item.ref.itemId)
      .setInteractive({ useHandCursor: true }).on('pointerdown', openSources));
    keep(scene.add.image(x + 42, iy + 25, equipmentArtKey(item.ref.itemId)).setDisplaySize(48, 48).setDepth(6102));
    text(x + 76, iy, item.name, w - 172, compact ? 14 : 17);
    if (!item.condition.startsWith('Tracked goal')) text(x + w - 88, iy, equipmentChanceText(item.percent), 72, 16, UI.textAccent);
    text(x + 76, iy + 26, item.condition, w - 92, 11, UI.textMuted);
  });
  text(x + 16, y + h - 86, 'Tap an item to track its sources.', w - 32, 12, UI.textMuted);
  if (pages > 1) {
    const fy = y + h - 60;
    text(x + w / 2, fy + 22, `${current + 1} / ${pages}`, 60, 14).setOrigin(0.5);
    if (current > 0) control(x + 16, fy, '\u2039', 'PREVIOUS', () => { close(); renderEquipmentChancePanel(scene, compact, items, current - 1); });
    if (current + 1 < pages) control(x + w - 60, fy, '\u203a', 'NEXT', () => { close(); renderEquipmentChancePanel(scene, compact, items, current + 1); });
  }
  scene.registry.set('equipmentChancePanel', { items, page: current, pages });
}

export function renderPossibleEquipmentLoot(scene: Phaser.Scene, compact: boolean, x: number, y: number, width: number, items: readonly EquipmentLootChance[]): number {
  if (!items.length) return 0;
  const h = 44;
  const plate = scene.add.rectangle(x, y, width, h, UI.panelMuted).setOrigin(0).setStrokeStyle(1, UI.border)
    .setData('equipmentPossibleLoot', true).setInteractive({ useHandCursor: true })
    .on('pointerdown', () => renderEquipmentChancePanel(scene, compact, items));
  scene.add.text(x + 10, y + h / 2, 'LOOT', { fontFamily: FONT.body, fontSize: '12px', color: UI.textAccent }).setOrigin(0, 0.5);
  const count = Math.min(compact ? 3 : 5, items.length), size = 32;
  items.slice(0, count).forEach((item, index) => scene.add.image(x + 76 + index * 36, y + h / 2, equipmentArtKey(item.ref.itemId))
    .setDisplaySize(size, size).setData('equipmentLootIcon', item.ref.itemId)
    .setInteractive({ useHandCursor: true }).on('pointerdown', () => renderEquipmentChancePanel(scene, compact, [item])));
  scene.add.text(x + width - 10, y + h / 2, items.length > count ? `+${items.length - count} \u203a` : '\u203a',
    { fontFamily: FONT.body, fontSize: '14px', color: UI.textBright }).setOrigin(1, 0.5);
  plate.setData('equipmentLootEntries', items);
  return h + 8;
}
