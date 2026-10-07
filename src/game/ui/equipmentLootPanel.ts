import type Phaser from 'phaser';
import type { EquipmentDetailsModel } from '../../engine/equipment/details';
import { FONT, UI } from '../theme';
import { attachButtonFeel } from './motion';
import type { EquipmentItemPin } from '../../data/equipmentLootSources';
import type { RunState } from '../../run/runState';
import { equipmentItemPinKey } from '../../data/equipmentLootSources';
import { readEquipmentTracking, setEquipmentTracking } from '../equipmentTrackingStore';
import { encounterLootChances, equipmentChanceText, eventItemChances } from './equipmentLootTrackingModel';
import { equipmentCatalog } from '../../data/equipmentContent';
import { renderEquipmentChancePanel } from './equipmentPossibleLoot';

export function renderEquipmentLootPanel(scene: Phaser.Scene, compact: boolean, model: EquipmentDetailsModel,
  page: number, onPage: (page: number) => void, onClose: () => void,
  tracking?: { ref: EquipmentItemPin; run: RunState; onChanged: () => void }): void {
  const before = new Set(scene.children.list);
  const view = scene.scale, width = Math.min(view.width - 20, 720), height = Math.min(view.height - 40, 640);
  const x = (view.width - width) / 2, y = (view.height - height) / 2, inset = compact ? 16 : 24;
  scene.add.rectangle(0, 0, view.width, view.height, UI.shadow, 0.88).setOrigin(0).setDepth(6000).setInteractive();
  scene.add.rectangle(x, y, width, height, UI.panel, 1).setOrigin(0).setStrokeStyle(1, UI.chip).setDepth(6001);
  const text = (tx: number, ty: number, value: string, available: number, size: number, color = UI.textBright) =>
    scene.add.text(tx, ty, value, { fontFamily: FONT.body, fontSize: `${size}px`, color, wordWrap: { width: available }, lineSpacing: 3 }).setDepth(6002);
  const button = (bx: number, by: number, label: string, key: string, action: () => void, enabled = true) => {
    const plate = scene.add.rectangle(bx, by, 44, 44, enabled ? UI.chip : UI.panelMuted).setOrigin(0)
      .setStrokeStyle(1, UI.border).setDepth(6003).setData('equipmentLootControl', key);
    const caption = text(bx + 22, by + 22, label, 44, 22, enabled ? UI.textOnChip : UI.textMuted).setOrigin(0.5).setDepth(6003);
    if (enabled) { plate.setInteractive({ useHandCursor: true }); attachButtonFeel(scene, plate, { fill: UI.chip, hover: UI.slotHover, follow: [caption], onPress: action }); }
  };
  text(x + inset, y + 18, 'LOOT FROM', width - inset * 2 - 52, 20, UI.textAccent);
  text(x + inset, y + 50, model.name, width - inset * 2 - 52, compact ? 16 : 20);
  text(x + inset, y + 82, 'Item chance on victory. Events: new items first.', width - inset * 2, 12, UI.textMuted);
  button(x + width - inset - 44, y + 16, '\u00d7', 'CLOSE', onClose);
  const goal = tracking ? readEquipmentTracking().find(goal => equipmentItemPinKey(goal) === equipmentItemPinKey(tracking.ref)) : undefined;
  if (tracking) ['enemies', 'events'].forEach((kind, index) => {
    const sourceKind = kind as 'enemies' | 'events', tw = (width - inset * 2 - 8) / 2, tx = x + inset + index * (tw + 8);
    const enabled = !!goal?.[sourceKind];
    const zone = scene.add.rectangle(tx, y + 112, tw, 44, UI.panelMuted).setOrigin(0).setDepth(6003)
      .setStrokeStyle(1, enabled ? UI.chip : UI.border).setData('equipmentTrack', sourceKind).setInteractive({ useHandCursor: true });
    scene.add.rectangle(tx + 10, y + 125, 18, 18, enabled ? UI.chip : UI.panel).setOrigin(0).setStrokeStyle(1, UI.chip).setDepth(6003);
    if (enabled) text(tx + 19, y + 134, '\u2713', 18, 16, UI.textOnChip).setOrigin(0.5).setDepth(6003);
    text(tx + 36, y + 126, `Track ${sourceKind}`, tw - 42, compact ? 12 : 15).setDepth(6003);
    zone.on('pointerdown', () => { setEquipmentTracking(tracking.ref, sourceKind, !enabled); tracking.onChanged(); });
  });
  const rows = [
    ...model.lootFrom.locations.map(source => ({ kind: 'Location', name: source.name, note: 'Often found here' })),
    ...model.lootFrom.enemies.map(source => ({ kind: 'Enemy', name: source.name, note: tracking
      ? `${equipmentChanceText(encounterLootChances([source.id]).find(item => equipmentItemPinKey(item.ref) === equipmentItemPinKey(tracking.ref))?.percent ?? 0)} solo \u00b7 On victory` : '' })),
    ...model.lootFrom.events.map(source => {
      const chances = tracking ? eventItemChances(tracking.run, tracking.ref, source.id) : [];
      return { kind: 'Event', name: source.name, note: chances.map(item => `${equipmentChanceText(item.percent)} \u00b7 ${item.condition}`).join(' / ') };
    }),
  ];
  const rowStart = tracking ? 172 : 116, availableHeight = height - rowStart - 70, rowWidth = width - inset * 2 - 76;
  const measure = (value: string, size: number) => {
    const probe = scene.make.text({ x: 0, y: 0, text: value, style: { fontFamily: FONT.body, fontSize: `${size}px`, wordWrap: { width: rowWidth }, lineSpacing: 3 }, add: false });
    const result = probe.height; probe.destroy(); return result;
  };
  const groups: { row: typeof rows[number]; height: number }[][] = [[]];
  let used = 0;
  rows.forEach(row => {
    const height = Math.max(compact ? 64 : 56, measure(row.name, compact ? 14 : 16) + measure(row.note, 11) + 13);
    if (used + height > availableHeight && groups.at(-1)!.length) { groups.push([]); used = 0; }
    groups.at(-1)!.push({ row, height }); used += height;
  });
  const pages = groups.length, current = Math.max(0, Math.min(page, pages - 1)), visible = groups[current]!;
  let ry = y + rowStart;
  visible.forEach(({ row, height }) => {
    text(x + inset, ry + 2, row.kind, 64, 11, UI.textAccent);
    const name = text(x + inset + 76, ry, row.name, width - inset * 2 - 76, compact ? 14 : 16);
    text(x + inset + 76, ry + name.height + 3, row.note, width - inset * 2 - 76, 11, UI.textMuted);
    ry += height;
  });
  if (!rows.length) text(x + inset, y + rowStart, 'No named sources assigned yet.', width - inset * 2, 14, UI.textMuted);
  const footer = y + height - 56;
  const goals = readEquipmentTracking();
  if (tracking && goals.length) {
    const manage = text(x + inset, footer + 12, `TRACKED ITEMS (${goals.length})`, width - inset * 2 - (pages > 1 ? 148 : 0), 12, UI.textAccent);
    const zone = scene.add.zone(x + inset, footer, 140, 44).setOrigin(0).setDepth(6003).setData('equipmentTrackManager', true)
      .setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        scene.children.list.filter(object => object.getData('equipmentLootOverlay')).forEach(object => object.destroy());
        onClose();
        renderEquipmentChancePanel(scene, compact, goals.map(ref => ({ ref, name: equipmentCatalog.item(ref.itemId, ref.itemVersion).name,
          percent: 0, condition: 'Tracked goal \u00b7 Tap to edit sources' })));
      });
    manage.setData('equipmentTrackManagerCaption', true); zone.setData('equipmentLootOverlay', true);
  } else text(x + inset, footer + 12, model.lootFrom.events.length ? 'Events may require a specific choice.' : 'No event sources.', width - inset * 2 - (pages > 1 ? 148 : 0), 12, UI.textMuted);
  if (pages > 1) {
    button(x + width - inset - 140, footer, '\u2039', 'PREVIOUS', () => onPage(current - 1), current > 0);
    text(x + width - inset - 70, footer + 22, `${current + 1} / ${pages}`, 52, 13).setOrigin(0.5);
    button(x + width - inset - 44, footer, '\u203a', 'NEXT', () => onPage(current + 1), current < pages - 1);
  }
  scene.registry.set('equipmentUiLootPanel', { item: model.name, page: current, pages, rows, tracking: goal ?? null, visibleRows: visible.map(entry => entry.row) });
  scene.children.list.filter(object => !before.has(object)).forEach(object => object.setData('equipmentLootOverlay', true));
}
