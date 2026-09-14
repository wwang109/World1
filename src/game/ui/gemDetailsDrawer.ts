import type Phaser from 'phaser';
import type { GemDef } from '../../data/gems';
import { STAT_RULE } from '../../engine/keywords/text';
import { FONT, GEM_RARITY_COLOR, SCREEN, UI, textRoleFor, type TextRole } from '../theme';
import { wasPointerConsumedByRebuild } from '../sceneRebuild';
import type { DetailsRect } from './cardDetailsLayout';
import { gemDetailsLayout } from './gemDetailsLayout';
import { GemToken } from './GemToken';
import { gemChipLines, gemHoverEntries } from './gemPresentation';

export interface GemDetailsAction { label: string; enabled: boolean; onPress(): void }
export interface GemDetailsSlot { key: string; label: string; gem: GemDef; action?: GemDetailsAction }
export interface GemDetailsOptions {
  compact: boolean; view?: DetailsRect; onClose(): void;
  primaryAction?: GemDetailsAction; slots?: readonly GemDetailsSlot[]; selectedKey?: string;
  /** Context supplied by the scene (e.g. card receiving this gem), never invented here. */
  context?: string; emptyText?: string;
}

/** One host-less gem inspector. Selection is read-only until an explicit contextual action. */
export function renderGemDetailsDrawer(scene: Phaser.Scene, gem: GemDef | null, opts: GemDetailsOptions): void {
  const view = opts.view ?? { x: 0, y: 0, width: SCREEN.width, height: SCREEN.height };
  const root = scene.add.container(0, 0).setDepth(2600);
  const initial = gemDetailsLayout(view, opts.compact, 140);
  const content = scene.add.container(0, 0);
  root.add(content);
  const text = (x: number, y: number, value: string, width: number, role: TextRole = 'body', color = UI.textBright, display = false) => {
    const line = scene.add.text(x, y, value, { ...textRoleFor(opts.compact ? 'mobile' : 'desktop', role),
      fontFamily: display ? FONT.display : FONT.body, fontStyle: display ? 'bold' : 'normal', color,
      wordWrap: { width, useAdvancedWrap: true }, lineSpacing: 3 }).setOrigin(0);
    return line;
  };
  let cy = 0;
  if (gem) {
    const lines = gemChipLines(gem);
    const art = new GemToken(scene, initial.art.width / 2, initial.art.height / 2, gem, initial.art);
    content.add(art);
    const name = text(initial.info.x, cy, lines.name, initial.info.width, 'title', UI.textBright, true);
    content.add(name); cy += name.height + 6;
    const meta = text(initial.info.x, cy, lines.meta, initial.info.width, 'label', `#${GEM_RARITY_COLOR[gem.rarity].toString(16).padStart(6, '0')}`, true);
    content.add(meta); cy += meta.height + 12;
    const effect = text(initial.info.x, cy, lines.effect, initial.info.width, 'body', UI.textAccent, true);
    content.add(effect); cy = Math.max(cy + effect.height, initial.art.height) + 16;
    // The concrete face is authoritative. Generic parameter templates are not useful
    // standalone; keep only already-resolved registry definitions, without re-authoring.
    for (const entry of gemHoverEntries(gem).slice(1)) {
      if (/\b\d*X\b|\bPL\b|power level|example/i.test(`${entry.title} ${entry.body}`)) continue;
      // The legacy weight helper maps to SPD, whose current definition no longer
      // explains Weight. Keep the concrete weight clause, not an implied speed buff.
      if (gem.kind === 'effect' && gem.weightIncreasePct !== undefined && entry.title === STAT_RULE.speed.title
        && !gem.actions.some(action => 'stat' in action && action.stat === 'speed')) continue;
      const line = text(0, cy, `${entry.title.toUpperCase()} — ${entry.body}`, initial.body.width - 12, 'body', UI.textMuted);
      content.add(line); cy += line.height + 12;
    }
  } else {
    const empty = text(0, cy, opts.emptyText ?? 'No gems in the pouch.', initial.body.width - 12, 'body', UI.textMuted);
    content.add(empty); cy += empty.height + 16;
  }
  if (opts.context) {
    const context = text(0, cy, opts.context, initial.body.width - 12, 'label', UI.textMuted);
    content.add(context); cy += context.height + 12;
  }
  const slots = opts.slots ?? [];
  let slotTop = cy;
  const columns = opts.compact ? 2 : 3;
  const slotWidth = (initial.body.width - 12 - (columns - 1) * 8) / columns;
  const slotNames = slots.map(slot => text(0, 0, slot.gem.name, slotWidth - 58, 'label'));
  const slotHeight = Math.max(108, ...slotNames.map(name => name.height + 44));
  if (slots.length) {
    const heading = text(0, cy, 'GEM SLOTS', initial.body.width, 'label', UI.textAccent, true);
    content.add(heading); cy += heading.height + 8; slotTop = cy;
    cy += Math.ceil(slots.length / columns) * (slotHeight + 8);
  }
  const layout = gemDetailsLayout(view, opts.compact, cy);
  const { pane, body, footer } = layout;
  const stop = (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => event.stopPropagation();
  const veil = scene.add.rectangle(view.x, view.y, view.width, view.height, UI.shadow, 0.65).setOrigin(0).setInteractive();
  veil.on('pointerdown', (...args: Parameters<typeof stop>) => { stop(...args); opts.onClose(); });
  const panel = scene.add.rectangle(pane.x, pane.y, pane.width, pane.height, UI.panel, 1).setOrigin(0).setStrokeStyle(1, UI.chip, 1).setInteractive();
  // Root child order keeps the modal shield below its content and controls.
  root.add([veil, panel]); root.remove(content); root.add(content);
  root.add(text(pane.x + 20, pane.y + 16, 'GEM DETAILS', pane.width - 90, 'title', UI.textAccent, true));
  root.add(scene.add.rectangle(pane.x + 20, pane.y + 52, pane.width - 40, 1, UI.chip, 0.65).setOrigin(0));
  const button = (rect: DetailsRect, label: string, action: () => void, enabled = true, filled = false) => {
    const bg = scene.add.rectangle(rect.x, rect.y, rect.width, rect.height, filled ? UI.chip : UI.panelMuted, enabled ? 1 : 0.5).setOrigin(0).setStrokeStyle(1, UI.chip, 0.7);
    const caption = text(rect.x + rect.width / 2, rect.y + rect.height / 2, label, rect.width - 8, label === '×' ? 'title' : 'body', filled ? UI.textOnChip : UI.textBright, true).setOrigin(0.5);
    root.add([bg, caption]);
    if (enabled) bg.setInteractive({ useHandCursor: true }).on('pointerdown', (...args: Parameters<typeof stop>) => { stop(...args); action(); });
  };
  button({ x: pane.x + pane.width - 56, y: pane.y + 4, width: 50, height: 50 }, '×', opts.onClose);
  const chosen = slots.find(slot => slot.key === opts.selectedKey);
  const action = chosen?.action ?? opts.primaryAction;
  if (action) button(footer, action.label, action.onPress, action.enabled, true);
  else button(footer, 'CLOSE', opts.onClose);

  const maskShape = scene.make.graphics({}, false).fillStyle(0xffffff).fillRect(body.x, body.y, body.width, body.height);
  const mask = maskShape.createGeometryMask();
  content.setPosition(body.x, body.y).setMask(mask);
  const maxScroll = Math.max(0, cy - body.height);
  const track = scene.add.rectangle(body.x + body.width - 3, body.y, 3, body.height, UI.border, 0.35).setOrigin(0).setVisible(maxScroll > 0);
  const thumbHeight = Math.max(24, body.height * Math.min(1, body.height / Math.max(cy, 1)));
  const thumb = scene.add.rectangle(body.x + body.width - 3, body.y, 3, thumbHeight, UI.chip, 0.9).setOrigin(0).setVisible(maxScroll > 0);
  root.add([track, thumb]);
  let scroll = 0;
  let drag: { x: number; y: number; scroll: number } | null = null;
  const cancelPress: (() => void)[] = [];
  const inBody = (p: Phaser.Input.Pointer) => p.worldX >= body.x && p.worldX <= body.x + body.width && p.worldY >= body.y && p.worldY <= body.y + body.height;
  const applyScroll = (value: number) => {
    scroll = Math.max(0, Math.min(maxScroll, value)); content.setY(body.y - scroll);
    thumb.setY(body.y + (maxScroll ? scroll / maxScroll * (body.height - thumbHeight) : 0));
  };
  const down = (p: Phaser.Input.Pointer) => { if (!wasPointerConsumedByRebuild(scene, p) && inBody(p)) drag = { x: p.worldX, y: p.worldY, scroll }; };
  const move = (p: Phaser.Input.Pointer) => {
    if (!drag || !p.isDown) return;
    if (Math.hypot(p.worldX - drag.x, p.worldY - drag.y) > 8) cancelPress.forEach(cancel => cancel());
    applyScroll(drag.scroll + drag.y - p.worldY);
  };
  const up = () => { drag = null; cancelPress.forEach(cancel => cancel()); };
  const wheel = (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => { if (inBody(p)) applyScroll(scroll + dy); };
  scene.input.on('pointerdown', down).on('pointermove', move).on('pointerup', up).on('pointerupoutside', up).on('wheel', wheel);
  root.once('destroy', () => {
    scene.input.off('pointerdown', down).off('pointermove', move).off('pointerup', up).off('pointerupoutside', up).off('wheel', wheel);
    content.clearMask(); mask.destroy(); maskShape.destroy();
  });
  slots.forEach((slot, index) => {
    const x = index % columns * (slotWidth + 8), y = slotTop + Math.floor(index / columns) * (slotHeight + 8);
    const bg = scene.add.rectangle(x, y, slotWidth, slotHeight, UI.panelAlt, 1).setOrigin(0).setStrokeStyle(slot.key === opts.selectedKey ? 2 : 1, GEM_RARITY_COLOR[slot.gem.rarity], 1).setInteractive({
      useHandCursor: true, hitArea: { x: 0, y: 0, width: slotWidth, height: slotHeight },
      hitAreaCallback: (_area: unknown, localX: number, localY: number) => localX >= 0 && localX <= slotWidth && localY >= 0 && localY <= slotHeight
        && y + localY - scroll >= 0 && y + localY - scroll <= body.height,
    });
    const label = text(x + 6, y + 6, slot.label, slotWidth - 12, 'label', UI.textAccent);
    const jewel = new GemToken(scene, x + 26, y + 58, slot.gem, { width: 40, height: 40 });
    const name = slotNames[index]!.setPosition(x + 52, y + 36);
    content.add([bg, label, jewel, name]);
    let press: { x: number; y: number } | null = null;
    cancelPress.push(() => { press = null; });
    bg.on('pointerdown', (p: Phaser.Input.Pointer) => { if (inBody(p)) press = { x: p.worldX, y: p.worldY }; });
    bg.on('pointerout', () => { press = null; });
    bg.on('pointerup', (p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      if (!press || !inBody(p) || Math.hypot(p.worldX - press.x, p.worldY - press.y) > 8) { press = null; return; }
      press = null;
      root.destroy();
      renderGemDetailsDrawer(scene, slot.gem, { ...opts, selectedKey: slot.key });
    });
  });
}
