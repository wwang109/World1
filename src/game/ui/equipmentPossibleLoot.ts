import type Phaser from 'phaser';
import { FONT, UI } from '../theme';
import { equipmentArtKey } from './equipmentArt';
import { equipmentChanceText, type EquipmentLootChance } from './equipmentLootTrackingModel';
import { equipmentDetailsModel } from '../../engine/equipment/details';
import { equipmentCatalog } from '../../data/equipmentContent';
import { equipmentLootSourcesFromJson } from '../../data/equipmentLootSources';
import { renderEquipmentDetailsDrawer } from './equipmentDetailsDrawer';
import { openRunModal, type RunModalOptions } from './RunModal';
import { getActiveRun } from '../runStore';
import { equipmentLootConfig } from '../../data/equipmentLootConfig';
import { auditTextBlock } from './controlLayoutAudit';

export function renderEquipmentChancePanel(scene: Phaser.Scene, compact: boolean, items: readonly EquipmentLootChance[], page = 0, id = 'equipment-drops', onClose?: () => void): void {
  const previous = scene.registry.get('equipmentChancePanel');
  const restore = () => {
    if (previous) scene.registry.set('equipmentChancePanel', previous); else scene.registry.remove('equipmentChancePanel');
    onClose?.();
  };
  const options = (shownPage: number): RunModalOptions => ({
    id, title: 'EQUIPMENT DROPS', compact, width: 600, height: 550, footerHeight: 76,
    onClose: restore,
    render: (host, layout, handle) => renderEquipmentChanceBody(host, compact, items, shownPage, layout,
      next => handle.update(options(next))),
  });
  openRunModal(scene, options(page));
}

function renderEquipmentChanceBody(scene: Phaser.Scene, compact: boolean, items: readonly EquipmentLootChance[], page: number,
  layout: import('./RunModal').RunModalLayout, onPage: (page: number) => void): void {
  const { body, footer } = layout;
  const w = body.width, h = body.height, x = body.x, y = body.y;
  const keep = <T extends Phaser.GameObjects.GameObject>(object: T): T => object.setData('equipmentChanceOverlay', true);
  const text = (tx: number, ty: number, value: string, width: number, size = 14, color = UI.textBright) =>
    keep(scene.add.text(tx, ty, value, { fontFamily: FONT.body, fontSize: `${size}px`, color, wordWrap: { width }, lineSpacing: 3 }).setDepth(6102));
  const control = (tx: number, ty: number, label: string, key: string, action: () => void) => {
    keep(scene.add.rectangle(tx, ty, 44, 44, UI.chip).setOrigin(0).setDepth(6103).setData('equipmentChanceControl', key)
      .setInteractive({ useHandCursor: true }).on('pointerdown', action));
    text(tx + 22, ty + 22, label, 40, 20, UI.textOnChip).setOrigin(0.5).setDepth(6103);
  };
  const victoryPool = items.length > 0 && items.every(item => item.condition === 'On victory');
  text(x, y, victoryPool
    ? equipmentLootConfig.fightChanceBps === 10000 ? 'Victory: one equipment item. Item chances below.' : 'Victory: up to one equipment item. Item chances below.'
    : 'Item chances below. Events: new items first.', w, 12, UI.textMuted);
  scene.children.list.find(object => object.getData('runModalClose'))?.setData('equipmentChanceControl', 'CLOSE');
  const measure = (value: string, width: number, size: number): number => {
    const probe = scene.make.text({ text: value, style: { fontFamily: FONT.body, fontSize: `${size}px`, wordWrap: { width }, lineSpacing: 3 }, add: false });
    const height = probe.height; probe.destroy(); return height;
  };
  const groups: { item: EquipmentLootChance; detail: ReturnType<typeof equipmentDetailsModel>; height: number; nameH: number; conditionH: number; detailH: number }[][] = [[]];
  let used = 0;
  items.forEach(item => {
    const detail = equipmentDetailsModel(item.ref, equipmentCatalog, equipmentLootSourcesFromJson());
    const nameH = measure(item.name, w - 156, compact ? 14 : 17);
    const conditionH = measure(`${detail.slot.toUpperCase()} · ${item.condition}`, w - 76, 11);
    const detailH = measure(detail.baseText, w - 76, 12);
    const height = Math.max(76, nameH + conditionH + detailH + 20);
    if (used + height > h - 56 && groups.at(-1)!.length) { groups.push([]); used = 0; }
    groups.at(-1)!.push({ item, detail, height, nameH, conditionH, detailH }); used += height;
  });
  const pages = groups.length, current = Math.max(0, Math.min(page, pages - 1));
  let iy = y + 56;
  if (!items.length) text(x + 16, iy, 'No equipment drops in this encounter.', w - 32, 14, UI.textMuted);
  groups[current]!.forEach(({ item, detail, height, nameH, conditionH, detailH }) => {
    const openDetails = () => renderEquipmentDetailsDrawer(scene, compact, item.ref, { run: getActiveRun() ?? undefined });
    let press: { x: number; y: number } | null = null;
    keep(scene.add.zone(x, iy, w, height - 8).setOrigin(0).setDepth(6103).setData('equipmentChanceItem', item.ref.itemId)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', (pointer: Phaser.Input.Pointer) => { press = { x: pointer.worldX, y: pointer.worldY }; })
      .on('pointerout', () => { press = null; })
      .on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (press && Math.hypot(pointer.worldX - press.x, pointer.worldY - press.y) <= 8) openDetails();
        press = null;
      }));
    keep(scene.add.image(x + 24, iy + 25, equipmentArtKey(item.ref.itemId)).setDisplaySize(48, 48).setDepth(6102));
    text(x + 60, iy, item.name, w - 156, compact ? 14 : 17);
    if (!item.condition.startsWith('Tracked goal')) text(x + w - 88, iy, equipmentChanceText(item.percent), 72, 16, UI.textAccent);
    text(x + 60, iy + nameH + 4, `${detail.slot.toUpperCase()} · ${item.condition}`, w - 76, 11, UI.textMuted);
    const effect = text(x + 60, iy + nameH + conditionH + 8, detail.baseText, w - 76, 12);
    auditTextBlock(effect, { name: `${item.ref.itemId} drop details`, maxWidth: w - 76, maxHeight: detailH, minFontSize: 12 });
    iy += height;
  });
  text(x, footer.y, 'Tap an item for details and sources.', w, 12, UI.textMuted);
  if (pages > 1) {
    const fy = footer.y + 24;
    text(x + w / 2, fy + 22, `${current + 1} / ${pages}`, 60, 14).setOrigin(0.5);
    if (current > 0) control(x, fy, '\u2039', 'PREVIOUS', () => onPage(current - 1));
    if (current + 1 < pages) control(x + w - 44, fy, '\u203a', 'NEXT', () => onPage(current + 1));
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
