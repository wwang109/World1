import Phaser from 'phaser';
import { equipmentCatalog, equipmentDocument } from '../../data/equipmentContent';
import { equipmentDetailsModel } from '../../engine/equipment/details';
import { equipmentItemPinKey, equipmentLootSourcesFromJson, type EquipmentItemPin } from '../../data/equipmentLootSources';
import { EQUIPMENT_SLOTS, type EquipmentSlot } from '../../engine/equipment/types';
import type { OwnedEquipmentItem } from '../../run/equipmentInventory';
import { FONT, UI } from '../theme';
import { rebuildScene } from '../sceneRebuild';
import { renderRunHud, snapshotRunProgress } from './RunProgressStrip';
import { runScreenLayoutRef } from './runScreenLayout';
import { setDeckBuildContext } from '../deckBuildContext';
import { currentBrokenEquipment, currentEquipmentInventory, currentEquippedEquipment, currentEquipmentResolution, equipRunEquipment, salvageRunEquipment, unequipRunEquipment, getActiveRun } from '../runStore';
import { equipmentItemPresentation, equipmentSelectionPreview } from './equipmentPresentation';
import { equipmentArtKey } from './equipmentArt';
import { equipmentModifierClauses } from '../../engine/equipment/text';
import { leveledStatMods } from '../../engine/equipment/upgrade';
import { templateBadgeTextureKey, type CardIconKey } from './cardArtPresentation';
import { attachButtonFeel } from './motion';
import { renderRunBagTabs } from './runBagTabs';
import { renderEquipmentLootPanel } from './equipmentLootPanel';
import { renderRunMapChoiceViewport } from './runMapChoiceViewport';
import { renderItemChrome } from './itemChrome';

export function equipmentIcon(scene:Phaser.Scene,x:number,y:number,slot:EquipmentSlot,color=UI.chip):Phaser.GameObjects.Graphics {
  const g=scene.add.graphics().setPosition(x,y).lineStyle(2,color,1);
  if(slot==='armor')g.beginPath().moveTo(-11,-12).lineTo(-4,-8).lineTo(4,-8).lineTo(11,-12).lineTo(17,-2).lineTo(10,2).lineTo(9,15).lineTo(-9,15).lineTo(-10,2).lineTo(-17,-2).closePath().strokePath();
  else if(slot==='accessory'){g.strokeCircle(0,5,11);g.beginPath().moveTo(-5,-10).lineTo(0,-16).lineTo(5,-10).lineTo(0,-4).closePath().strokePath()}
  else{g.strokeCircle(0,0,14);g.beginPath().moveTo(0,-11).lineTo(3,-3).lineTo(11,0).lineTo(3,3).lineTo(0,11).lineTo(-3,3).lineTo(-11,0).lineTo(-3,-3).closePath().strokePath()}
  return g;
}
export abstract class EquipmentScreen extends Phaser.Scene {
  private selected: string | null = null;
  private page = 0;
  private lootOpen = false;
  private lootPage = 0;
  private lootTarget: EquipmentItemPin | null = null;
  private bodyScroll = 0;
  private salvageArmed: string | null = null;
  constructor(key: string, private readonly compact: boolean) { super(key); }
  private rerender = () => rebuildScene(this);
  private openLoot(ref: EquipmentItemPin): void {
    const run = getActiveRun();
    if (!run) return;
    this.lootTarget = ref; this.lootOpen = true; this.lootPage = 0;
    renderEquipmentLootPanel(this, this.compact, equipmentDetailsModel(ref, equipmentCatalog, equipmentLootSourcesFromJson()), this.lootPage,
      page => { this.lootPage = page; }, () => { this.lootOpen = false; }, { ref, run, onChanged: () => {} });
  }
  create(): void {
    const run = getActiveRun();
    if (!run) { this.scene.start(this.compact ? 'MobileRunMap' : 'DesktopRunMap'); return; }
    const m = this.compact, template = runScreenLayoutRef(m ? 'mobile' : 'desktop'), r = template.regions.content;
    this.cameras.main.setBackgroundColor(UI.bg);
    const openCards = () => { setDeckBuildContext('run'); this.scene.start(m ? 'MobileDeckBuild' : 'DesktopDeck'); };
    renderRunHud(this, { screen: 'BAG', compact: m, snapshot: snapshotRunProgress(run), actions: {
      back: { label: '\u2039 MAP', onPress: () => this.scene.start(m ? 'MobileRunMap' : 'DesktopRunMap') },
      primary: { label: 'DONE', onPress: openCards },
    } });
    renderRunBagTabs(this, m, 'equipment');
    const inventory = currentEquipmentInventory(), equipped = currentEquippedEquipment(), resolution = currentEquipmentResolution();
    const selected = inventory.find(item => item.instanceId === this.selected) ?? inventory.find(item => item.itemId === 'duelist_knot') ?? inventory[0];
    if (selected) this.selected = selected.instanceId;
    const gap = m ? 8 : 16, pad = m ? 0 : 12, tabBand = m ? 0 : 46;
    const x = r.x + pad, y = r.y + pad + tabBand, w = r.width - pad * 2, h = r.height - pad * 2 - tabBand;
    const text = (tx: number, ty: number, value: string, width: number, size = m ? 12 : 17, color = UI.textBright, heading = false) =>
      this.add.text(tx, ty, value, { fontFamily: heading ? FONT.display : FONT.body, fontSize: `${size}px`, color, wordWrap: { width }, lineSpacing: m ? 3 : 7 });
    const modifierLine = (tx: number, ty: number, clause: string, width: number, size: number, color: string) => {
      const space = clause.indexOf(' '), labelWidth = m ? 48 : 80;
      if (space < 0) { text(tx, ty, clause, width, size, color); return; }
      text(tx, ty, clause.slice(0, space), labelWidth - 6, size, color);
      text(tx + labelWidth, ty, clause.slice(space + 1), width - labelWidth, size, color);
    };
    const panel = (px: number, py: number, pw: number, ph: number, edge = UI.border) =>
      this.add.rectangle(px, py, pw, ph, UI.panel, 0.94).setOrigin(0).setStrokeStyle(1, edge, 0.8);
    const button = (px: number, py: number, bw: number, value: string, cb: () => void, enabled = true) => {
      const bh = m ? 44 : 40, box = this.add.rectangle(px, py, bw, bh, enabled ? UI.chip : UI.panelMuted).setOrigin(0).setStrokeStyle(1, UI.chip, 0.7).setData('equipmentButton', value);
      const caption = this.add.text(px + bw / 2, py + bh / 2, value, { fontFamily: FONT.body, fontSize: value === '\u2039' || value === '\u203a' ? '24px' : m ? '10px' : '12px', fontStyle: 'bold', color: enabled ? UI.textOnChip : UI.textMuted }).setOrigin(0.5);
      if (enabled) { box.setInteractive({ useHandCursor: true }); attachButtonFeel(this, box, { fill: UI.chip, hover: UI.slotHover, follow: [caption], onPress: cb }); }
      return box;
    };
    const art = (id: string, ax: number, ay: number, aw: number, ah: number) => {
      const image = this.add.image(ax + aw / 2, ay + ah / 2, equipmentArtKey(id)).setData('equipmentArt', id);
      image.setScale(Math.min(aw / image.width, ah / image.height)); return image;
    };
    const select = (item: OwnedEquipmentItem) => { this.selected = item.instanceId; this.lootOpen = false; this.lootTarget = null; this.lootPage = 0; this.salvageArmed = null; this.rerender(); };
    const slotH = m ? 136 : 148, slotW = (w - gap * 2) / 3;
    EQUIPMENT_SLOTS.forEach((slot, i) => {
      const sx = x + i * (slotW + gap), item = equipped.find(ref => ref.slot === slot);
      panel(sx, y, slotW, slotH, UI.chip);
      if (m) {
        text(sx + 8, y + 9, slot.toUpperCase(), slotW - 16, 10, UI.textAccent);
        if (item) art(item.itemId, sx + 16, y + 29, slotW - 32, 65);
        text(sx + 6, y + 99, item ? `${equipmentCatalog.item(item.itemId, item.itemVersion).name}${item.level ? ` +${item.level}` : ''}` : 'Empty', slotW - 12, 10);
        if (item) text(sx + 6, y + 117, 'EQUIPPED', slotW - 12, 9, '#9adb9e');
      } else {
        if (item) art(item.itemId, sx + 12, y + 10, 150, 128);
        text(sx + 174, y + 24, slot.toUpperCase(), slotW - 186, 12, UI.textAccent);
        text(sx + 174, y + 61, item ? `${equipmentCatalog.item(item.itemId, item.itemVersion).name}${item.level ? ` +${item.level}` : ''}` : 'Empty', slotW - 186, 20, UI.textBright, true);
        text(sx + 174, y + 103, item ? '\u2713 EQUIPPED' : `No ${slot} equipped`, slotW - 186, 13, item ? '#9adb9e' : UI.textMuted);
      }
      if (!item) {
        const cx = sx + (m ? slotW / 2 : 86), cy = y + (m ? 64 : 74);
        this.add.circle(cx, cy, m ? 25 : 42).setStrokeStyle(1, UI.border);
        this.add.graphics().lineStyle(2, Phaser.Display.Color.HexStringToColor(UI.textMuted).color)
          .lineBetween(cx - 9, cy, cx + 9, cy).lineBetween(cx, cy - 9, cx, cy + 9);
      }
      if (item) this.add.zone(sx, y, slotW, slotH).setOrigin(0).setInteractive({ useHandCursor: true }).setData('equipmentSlot', slot).on('pointerdown', () => select(item));
    });
    const bodyY = y + slotH + gap, bodyH = h - slotH - gap, bagW = m ? w : Math.round(w * 0.565), bagH = m ? 268 : bodyH;
    const beforeBody = new Set(this.children.list);
    panel(x, bodyY, bagW, bagH, UI.chip);
    text(x + 12, bodyY + 10, `EQUIPMENT BAG \u00b7 ${inventory.length} \u00b7 BROKEN ${currentBrokenEquipment()}`, bagW - (m && inventory.length > 6 ? 176 : 24), m ? 13 : 23, UI.textAccent, true);
    const columns = m ? 3 : 4, tileGap = m ? 8 : 16, tileW = (bagW - 24 - (columns - 1) * tileGap) / columns, tileH = m ? 96 : 166;
    const rows = 2, imageSize = m ? 48 : 112, perPage = columns * rows, maxPage = Math.max(0, Math.ceil(inventory.length / perPage) - 1);
    this.page = Math.min(this.page, maxPage);
    const gridX = x + 12, gridY = bodyY + (m ? 52 : 54);
    inventory.slice(this.page * perPage, (this.page + 1) * perPage).forEach((item, i) => {
      const tx = gridX + i % columns * (tileW + tileGap), ty = gridY + Math.floor(i / columns) * (tileH + tileGap), def = equipmentCatalog.item(item.itemId, item.itemVersion);
      const active = equipped.some(ref => ref.instanceId === item.instanceId), chosen = item.instanceId === this.selected;
      const box = panel(tx, ty, tileW, tileH).setFillStyle(UI.slot, 0.65).setStrokeStyle(0).setData('equipmentBagTile', true);
      renderItemChrome(this, tx, ty, tileW, tileH, { variant: 'bag', selected: chosen });
      art(item.itemId, tx + (tileW - imageSize) / 2, ty + 6, imageSize, imageSize).setData('equipmentBagImageSize', imageSize);
      text(tx + 6, ty + imageSize + 12, `${def.name}${item.level ? ` +${item.level}` : ''}`, tileW - 12, m ? 9 : 13);
      text(tx + 6, ty + tileH - (m ? 16 : 20), active ? 'EQUIPPED' : def.slot.toUpperCase(), tileW - 12, m ? 7 : 10, active ? '#9adb9e' : UI.textMuted);
      if (active) { this.add.circle(tx + tileW - 13, ty + 13, 9, UI.chip); this.add.text(tx + tileW - 13, ty + 13, '\u2713', { fontSize: '13px', color: UI.textOnChip }).setOrigin(0.5); }
      box.setInteractive({ useHandCursor: true }).setData('equipmentItem', item.instanceId).on('pointerdown', () => select(item));
    });
    this.registry.set('equipmentUiBagGeometry', { x: gridX, y: gridY, width: bagW - 24, height: rows * tileH + (rows - 1) * tileGap, columns, rows, tileGap, tileWidth: tileW, tileHeight: tileH });
    if (maxPage) {
      const py = m ? bodyY + 4 : bodyY + bagH - 52;
      button(x + bagW - 164, py, 44, '\u2039', () => { this.page--; this.rerender(); }, this.page > 0);
      this.add.text(x + bagW - 88, py + (m ? 22 : 20), `${this.page + 1} / ${maxPage + 1}`, { fontFamily: FONT.body, fontSize: '14px', color: UI.textBright }).setOrigin(0.5).setData('equipmentPageCount', true);
      button(x + bagW - 56, py, 44, '\u203a', () => { this.page++; this.rerender(); }, this.page < maxPage);
    }
    if (!inventory.length) text(x + 12, gridY, 'No equipment yet.', bagW - 24);
    const dx = m ? x : x + bagW + gap, dy = m ? bodyY + bagH + gap : bodyY, dw = m ? w : w - bagW - gap, dh = m ? Math.max(364, y + h - dy) : bodyH;
    panel(dx, dy, dw, dh, UI.chip);
    if (selected) {
      const model = equipmentItemPresentation(selected, resolution), preview = equipmentSelectionPreview(run, selected), bw = m ? 72 : 96;
      const titleW = dw - bw * 3 - 56, title = this.add.text(dx + 12, dy + 12, `${model.name}${selected.level ? ` +${selected.level}` : ''}`, { fontFamily: FONT.display, fontSize: `${m ? 18 : 28}px`, color: UI.textBright });
      while (title.width > titleW && Number(title.style.fontSize.toString().replace('px', '')) > (m ? 11 : 16)) title.setFontSize(Number(title.style.fontSize.toString().replace('px', '')) - 1);
      button(dx + dw - bw * 3 - 28, dy + 10, bw, 'LOOT FROM', () => this.openLoot(selected));
      const armed = this.salvageArmed === selected.instanceId;
      button(dx + dw - bw * 2 - 20, dy + 10, bw, armed ? 'CONFIRM?' : 'SALVAGE', () => {
        if (!armed) { this.salvageArmed = selected.instanceId; this.rerender(); return; }
        salvageRunEquipment(selected.instanceId); this.salvageArmed = null; this.selected = null; this.rerender();
      }, !preview.isEquipped);
      button(dx + dw - bw - 12, dy + 10, bw, preview.isEquipped ? 'UNEQUIP' : 'EQUIP', () => { if (preview.isEquipped) unequipRunEquipment(model.slot); else equipRunEquipment(selected.instanceId); this.rerender(); });
      const inset = m ? 12 : 20, innerW = dw - inset * 2;
      const imageSize = m ? 80 : 144, imageY = dy + (m ? 64 : 88);
      panel(dx + inset, imageY, imageSize, imageSize);
      art(selected.itemId, dx + inset + 4, imageY + 4, imageSize - 8, imageSize - 8);
      const itemDef = equipmentCatalog.item(selected.itemId, selected.itemVersion);
      text(dx + inset, dy + (m ? 40 : 56), m ? model.baseText : model.slot.toUpperCase(), innerW, m ? 12 : 13, UI.textAccent);
      if (!m) {
        const statsX = dx + inset + imageSize + 24, statsW = innerW - imageSize - 24;
        text(statsX, imageY + 4, 'ITEM STATS', statsW, 13, UI.textMuted);
        equipmentModifierClauses(leveledStatMods(itemDef, selected.level ?? 0)).forEach((clause, i) => modifierLine(statsX, imageY + 32 + i * 34, clause, statsW, 23, UI.textBright));
      }
      const setX = m ? dx + 112 : dx + inset, setY = dy + (m ? 64 : 250), setW = m ? dw - 124 : innerW;
      if (model.set) {
        const pieces = equipmentDocument.items.flatMap(entry => {
          const version = entry.versions.at(-1)!;
          return version.def.setId === model.set!.id ? [{ itemId: entry.id, itemVersion: version.version, setVersion: model.set!.version }] : [];
        }).sort((a, b) => EQUIPMENT_SLOTS.indexOf(equipmentCatalog.item(a.itemId, a.itemVersion).slot) - EQUIPMENT_SLOTS.indexOf(equipmentCatalog.item(b.itemId, b.itemVersion).slot));
        const pieceX = m ? dx + inset : dx + inset + imageSize + 24, pieceY = dy + (m ? 150 : 188), pieceW = (m ? innerW : innerW - imageSize - 24) / 3;
        pieces.forEach((ref, index) => {
          const px = pieceX + index * pieceW, owned = inventory.some(item => equipmentItemPinKey(item) === equipmentItemPinKey(ref));
          const wearing = equipped.some(item => equipmentItemPinKey(item) === equipmentItemPinKey(ref));
          const plate = panel(px, pieceY, pieceW - 5, m ? 60 : 56, wearing ? UI.chip : UI.border)
            .setData('equipmentSetPiece', ref.itemId).setInteractive({ useHandCursor: true });
          art(ref.itemId, px + 3, pieceY + 1, pieceW - 11, 32);
          text(px + 4, pieceY + 33, equipmentCatalog.item(ref.itemId, ref.itemVersion).slot.toUpperCase(), pieceW - 13, 8, UI.textAccent);
          text(px + 4, pieceY + 44, wearing ? '\u2713 EQUIPPED' : owned ? '\u2713 OWNED' : 'MISSING', pieceW - 13, 8,
            owned ? '#9adb9e' : UI.textMuted);
          plate.on('pointerdown', () => this.openLoot(ref));
        });
        this.registry.set('equipmentUiSetPieces', pieces.map(ref => ({ ...ref, owned: inventory.some(item => equipmentItemPinKey(item) === equipmentItemPinKey(ref)) })));
        text(setX, setY, `${model.set.name} \u00b7 ${model.progress?.equippedPieces ?? 0}/3`, setW, m ? 14 : 22, UI.textAccent, true);
        const definition = equipmentCatalog.set(model.set.id, model.set.version), match = definition.boardRequirement.match;
        const icon = (match.weapon === 'beast' ? 'fangs' : match.weapon ?? match.archetypesIncludes ?? match.property) as CardIconKey;
        const key = templateBadgeTextureKey(icon), needed = definition.boardRequirement.minCount;
        const matching = model.progress?.matchingCards ?? preview.resolution.sets.find(set => set.setId === model.set!.id)?.matchingCards ?? 0;
        const badgeSize = m ? 24 : 32, badgeY = setY + (m ? 24 : 36);
        for (let i = 0; i < needed; i++) {
          const sx = setX + i * (badgeSize + 6); panel(sx, badgeY, badgeSize, badgeSize);
          if (key) this.add.image(sx + badgeSize / 2, badgeY + badgeSize / 2, key).setDisplaySize(badgeSize - 4, badgeSize - 4).setAlpha(i < matching ? 1 : 0.3);
        }
        const reqX = m ? setX : setX + needed * (badgeSize + 6) + 12;
        const reqY = m ? badgeY + badgeSize + 5 : badgeY + 2;
        text(reqX, reqY, `${model.set.requirement} \u00b7 ${matching}/${needed}`, m ? setW : innerW - (reqX - setX), m ? 11 : 14, matching >= needed ? '#9adb9e' : UI.textMuted);
        const bonusY = dy + (m ? 218 : 330), rowH = m ? 30 : 56, rowGap = m ? 6 : 10;
        definition.bonuses.forEach((bonus, i) => {
          const by = bonusY + i * (rowH + rowGap), active = model.progress?.activeThresholds.includes(bonus.pieces) ?? false;
          const frame = panel(dx + inset, by, innerW, rowH, active ? UI.chip : UI.border).setFillStyle(UI.panelAlt, 0.7);
          frame.setData('equipmentBonusRow', bonus.pieces);
          text(dx + inset + 8, by + (m ? 8 : 10), `${active ? '\u2713' : '\u25cb'} ${bonus.pieces} PIECES`, m ? 88 : 106, m ? 11 : 14, active ? '#9adb9e' : UI.textMuted);
          if (!m) text(dx + inset + 8, by + 32, active ? 'ACTIVE' : 'INACTIVE', 106, 10, active ? '#9adb9e' : UI.textMuted);
          const clauses = equipmentModifierClauses(bonus.statMods, bonus.effectMods);
          clauses.forEach((clause, index) => modifierLine(dx + inset + (m ? 102 : 124), by + (clauses.length > 1 ? (m ? 2 : 4) : (m ? 7 : 15)) + index * (m ? 14 : 26), clause, innerW - (m ? 110 : 136), m ? 12 : 20, active ? UI.textBright : UI.textMuted));
        });
      } else {
        text(setX, setY, 'NO SET', setW, m ? 14 : 22, UI.textAccent, true);
        text(setX, setY + 30, 'Base stats apply while equipped.', setW, m ? 12 : 16, UI.textMuted);
      }
      const statsY = dy + (m && model.set ? 294 : m ? 226 : 472);
      this.add.rectangle(dx + inset, statsY - 8, innerW, 1, UI.border, 0.7).setOrigin(0);
      text(dx + inset, statsY, preview.isEquipped ? 'AFTER UNEQUIP' : 'AFTER EQUIP', innerW, m ? 10 : 13, UI.textAccent);
      if (model.set) text(dx + dw - inset - 108, statsY, 'Bonuses stack', 108, m ? 10 : 12, UI.textMuted).setAlign('right');
      const keys = ['attack', 'magicPower', 'armor', 'magicResist', 'maxHp', 'speed'] as const, labels = ['ATK', 'MATK', 'DEF', 'MDEF', 'HP', 'SPD'];
      const changes = keys.map((key, i) => ({ label: labels[i]!, before: preview.currentStats![key], after: preview.nextStats![key] })).filter(value => value.before !== value.after);
      const statW = innerW / 3;
      changes.forEach((value, i) => {
        const tx = dx + inset + i % 3 * statW, ty = statsY + (m ? 19 : 27) + Math.floor(i / 3) * (m ? 20 : 28), labelW = m ? 36 : 58;
        const color = value.after > value.before ? '#9adb9e' : UI.textBright;
        text(tx, ty, value.label, labelW - 4, m ? 11 : 15, color);
        text(tx + labelW, ty, `${value.before} \u2192 ${value.after}`, statW - labelW - 8, m ? 13 : 19, color);
      });
      if (!changes.length) text(dx + inset, statsY + (m ? 19 : 27), 'No stat change', innerW, m ? 13 : 19, UI.textMuted);
      this.registry.set('equipmentUiPreview', { itemId: selected.itemId, ...preview });
      this.registry.set('equipmentUiLootPanel', null);
      if (this.lootOpen) {
        const ref = this.lootTarget ?? selected;
        renderEquipmentLootPanel(this, m, equipmentDetailsModel(ref, equipmentCatalog, equipmentLootSourcesFromJson()), this.lootPage,
          page => { this.lootPage = page; }, () => { this.lootOpen = false; },
          { ref, run, onChanged: () => {} });
      }
    } else text(dx + 12, dy + 12, 'Select an item to view its stats and set bonuses.', dw - 24);
    if (m) {
      const objects = this.children.list.filter(object => !beforeBody.has(object) && !object.getData('equipmentLootOverlay'));
      this.children.remove(objects);
      renderRunMapChoiceViewport(this, { x, y: bodyY, width: w, height: bodyH }, bagH + gap + dh,
        () => objects.forEach(object => this.add.existing(object)),
        { scroll: this.bodyScroll, enabled: !this.lootOpen, onScroll: value => { this.bodyScroll = value; } });
    }
    this.registry.set('equipmentUiResolution', resolution); this.registry.set('equipmentUiTemplate', template); this.data.set('equipmentUiRun', run);
  }
}
