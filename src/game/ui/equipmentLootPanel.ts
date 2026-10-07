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
import { openRunModal, type RunModalOptions, type RunModalLayout } from './RunModal';

export function renderEquipmentLootPanel(scene: Phaser.Scene, compact: boolean, model: EquipmentDetailsModel,
  page: number, onPage: (page: number) => void, onClose: () => void,
  tracking?: { ref: EquipmentItemPin; run: RunState; onChanged: () => void }): void {
  const previous = scene.registry.get('equipmentUiLootPanel');
  const close = () => {
    if (previous === undefined) scene.registry.remove('equipmentUiLootPanel');
    else scene.registry.set('equipmentUiLootPanel', previous);
    onClose();
  };
  const options = (currentPage: number): RunModalOptions => ({
    id: 'equipment-sources', title: 'LOOT FROM', compact, width: 720, height: 640, footerHeight: 64,
    onClose: close, render: (host, layout, handle) => {
      const refresh = (next: number) => { onPage(next); handle.update(options(next)); };
      renderEquipmentLootBody(host, compact, model, currentPage, refresh, layout,
        tracking && { ...tracking, onChanged: () => handle.update(options(currentPage)) });
    },
  });
  openRunModal(scene, options(page));
}

function renderEquipmentLootBody(scene: Phaser.Scene, compact: boolean, model: EquipmentDetailsModel,
  page: number, onPage: (page: number) => void, layout: RunModalLayout,
  tracking?: { ref: EquipmentItemPin; run: RunState; onChanged: () => void }): void {
  const before = new Set(scene.children.list);
  const { body, footer: footerRect } = layout;
  const width = body.width, height = body.height, x = body.x, y = body.y, inset = 0;
  const text = (tx: number, ty: number, value: string, available: number, size: number, color = UI.textBright) =>
    scene.add.text(tx, ty, value, { fontFamily: FONT.body, fontSize: `${size}px`, color, wordWrap: { width: available }, lineSpacing: 3 }).setDepth(6002);
  const button = (bx: number, by: number, label: string, key: string, action: () => void, enabled = true) => {
    const plate = scene.add.rectangle(bx, by, 44, 44, enabled ? UI.chip : UI.panelMuted).setOrigin(0)
      .setStrokeStyle(1, UI.border).setDepth(6003).setData('equipmentLootControl', key);
    const caption = text(bx + 22, by + 22, label, 44, 22, enabled ? UI.textOnChip : UI.textMuted).setOrigin(0.5).setDepth(6003);
    if (enabled) { plate.setInteractive({ useHandCursor: true }); attachButtonFeel(scene, plate, { fill: UI.chip, hover: UI.slotHover, follow: [caption], onPress: action }); }
  };
  text(x, y, model.name, width, compact ? 16 : 20);
  text(x, y + 30, 'Item chance on victory. Events: new items first.', width, 12, UI.textMuted);
  const goal = tracking ? readEquipmentTracking().find(goal => equipmentItemPinKey(goal) === equipmentItemPinKey(tracking.ref)) : undefined;
  if (tracking) ['enemies', 'events'].forEach((kind, index) => {
    const sourceKind = kind as 'enemies' | 'events', tw = (width - inset * 2 - 8) / 2, tx = x + inset + index * (tw + 8);
    const enabled = !!goal?.[sourceKind];
    const zone = scene.add.rectangle(tx, y + 64, tw, 44, UI.panelMuted).setOrigin(0).setDepth(6003)
      .setStrokeStyle(1, enabled ? UI.chip : UI.border).setData('equipmentTrack', sourceKind).setInteractive({ useHandCursor: true });
    scene.add.rectangle(tx + 10, y + 77, 18, 18, enabled ? UI.chip : UI.panel).setOrigin(0).setStrokeStyle(1, UI.chip).setDepth(6003);
    if (enabled) text(tx + 19, y + 86, '\u2713', 18, 16, UI.textOnChip).setOrigin(0.5).setDepth(6003);
    text(tx + 36, y + 78, `Track ${sourceKind}`, tw - 42, compact ? 12 : 15).setDepth(6003);
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
  const rowStart = tracking ? 124 : 70, availableHeight = height - rowStart, rowWidth = width - inset * 2 - 76;
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
  const footer = footerRect.y;
  scene.children.list.find(object => object.getData('runModalClose'))?.setData('equipmentLootControl', 'CLOSE');
  const goals = readEquipmentTracking();
  if (tracking && goals.length) {
    const manage = text(x + inset, footer + 12, `TRACKED ITEMS (${goals.length})`, width - (pages > 1 ? 148 : 0), 12, UI.textAccent);
    const zone = scene.add.zone(x + inset, footer, 140, 44).setOrigin(0).setDepth(6003).setData('equipmentTrackManager', true)
      .setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        renderEquipmentChancePanel(scene, compact, goals.map(ref => ({ ref, name: equipmentCatalog.item(ref.itemId, ref.itemVersion).name,
          percent: 0, condition: 'Tracked goal \u00b7 Tap to edit sources' })), 0, 'equipment-tracked', tracking.onChanged);
      });
    manage.setData('equipmentTrackManagerCaption', true); zone.setData('equipmentLootOverlay', true);
  } else text(x, footer + 12, model.lootFrom.events.length ? 'Events may require a specific choice.' : 'No event sources.', width - (pages > 1 ? 148 : 0), 12, UI.textMuted);
  if (pages > 1) {
    button(x + width - 140, footer, '\u2039', 'PREVIOUS', () => onPage(current - 1), current > 0);
    text(x + width - 70, footer + 22, `${current + 1} / ${pages}`, 52, 13).setOrigin(0.5);
    button(x + width - 44, footer, '\u203a', 'NEXT', () => onPage(current + 1), current < pages - 1);
  }
  scene.registry.set('equipmentUiLootPanel', { item: model.name, page: current, pages, rows, tracking: goal ?? null, visibleRows: visible.map(entry => entry.row) });
  scene.children.list.filter(object => !before.has(object)).forEach(object => object.setData('equipmentLootOverlay', true));
}
