import Phaser from 'phaser';
import { roundRect } from './roundedRect';
import { TIER_ORDER, type SkillDef, type SkillTier } from '../../engine/types';
import type { GemDef } from '../../data/gems';
import { FONT, SCREEN, UI, textRoleFor, type TextRole } from '../theme';
import { FantasyCardTemplateV2 } from './FantasyCardTemplateV2';
import { cardDetailsLayout, type CardDetailsPresentation, type DetailsRect } from './cardDetailsLayout';
import { buildCardDetailsContent, cardDetailsPreviewTiers, resolveCardDetailsPreview, type CardDetailsEntry } from './cardDetailsContent';
import { wasPointerConsumedByRebuild } from '../sceneRebuild';
import { renderDetailText } from './detailText';

export interface CardDetailsAction { label: string; enabled: boolean; onPress(): void }

/** Shared inspector. Real card art stays fixed; long information scrolls independently. */
export function renderCardDetailsDrawer(scene: Phaser.Scene, skill: SkillDef, opts: {
  compact: boolean;
  onClose(): void;
  view?: DetailsRect;
  gem?: GemDef | null;
  /** Kept for existing callers; balance metadata is not shown in the inspector. */
  powerDeci?: number;
  presentation?: CardDetailsPresentation;
  primaryAction?: CardDetailsAction;
  secondaryAction?: CardDetailsAction;
}): void {
  const view = opts.view ?? { x: 0, y: 0, width: SCREEN.width, height: SCREEN.height };
  const presentation = opts.presentation ?? 'default';
  const { pane, card, identity, info, preview, rankButtons, footer } = cardDetailsLayout(view, opts.compact, presentation);
  let shown = skill;
  let content = buildCardDetailsContent(shown, { gem: opts.gem });
  const depth = 2400;
  const text = (x: number, y: number, value: string, role: TextRole, color = UI.textBright, display = false, width?: number) => scene.add.text(x, y, value, {
    ...textRoleFor(opts.compact ? 'mobile' : 'desktop', role),
    fontFamily: display ? FONT.display : FONT.body, color,
    fontStyle: display ? 'bold' : 'normal', wordWrap: width ? { width, useAdvancedWrap: true } : undefined, lineSpacing: 3,
  }).setOrigin(0, 0).setDepth(depth + 2);
  const veil = scene.add.rectangle(view.x, view.y, view.width, view.height, UI.shadow, 0.58).setOrigin(0).setDepth(depth).setInteractive();
  veil.on('pointerdown', opts.onClose);
  const panel = scene.add.rectangle(pane.x, pane.y, pane.width, pane.height, UI.panel, 1).setOrigin(0).setDepth(depth + 1)
    .setStrokeStyle(2, UI.chip, 1).setInteractive();
  if (opts.compact) roundRect(panel, 12);
  const innerFrame = scene.add.rectangle(pane.x + 5, pane.y + 5, pane.width - 10, pane.height - 10).setOrigin(0).setFillStyle(UI.panel, 0).setStrokeStyle(1, UI.border, 0.65).setDepth(depth + 1);
  if (opts.compact) roundRect(innerFrame, 8);
  text(pane.x + 24, pane.y + 16, 'CARD DETAILS', 'title', UI.textAccent, true);
  const button = (r: DetailsRect, label: string, onPress: () => void, enabled = true, filled = false) => {
    const box = scene.add.rectangle(r.x, r.y, r.width, r.height, filled ? UI.chip : UI.panelMuted, enabled ? 1 : 0.55)
      .setOrigin(0).setDepth(depth + 3).setStrokeStyle(1, UI.chip, enabled ? 1 : 0.3);
    if (opts.compact) roundRect(box, label === '×' ? 6 : 10);
    text(r.x + r.width / 2, r.y + r.height / 2, label, label === '×' ? (opts.compact ? 'display' : 'title') : 'body', filled ? UI.textOnChip : UI.textAccent, true)
      .setOrigin(0.5).setDepth(depth + 4);
    if (enabled) box.setInteractive({ useHandCursor: true }).on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => { event.stopPropagation(); onPress(); });
    return box;
  };
  button({ x: pane.x + pane.width - 54, y: pane.y + 10, width: 44, height: 40 }, '×', opts.onClose);
  const makeCard = () => new FantasyCardTemplateV2(scene, card.x + card.width / 2, card.y + card.height / 2, { ...shown, speedWeight: content.weight },
    { width: card.width, height: card.height, tier: shown.tier, glossary: false }).setDepth(depth + 2);
  let cardView = makeCard();
  panel.once('destroy', () => cardView.destroy());

  const region = (viewport: DetailsRect, draw: (add: (value: string, role: TextRole, color?: string, display?: boolean) => void, list: Phaser.GameObjects.Container, width: number, y: () => number, advance: (height: number) => void) => void) => {
    scene.add.rectangle(viewport.x, viewport.y, viewport.width, viewport.height, UI.panel, 0.001).setOrigin(0).setDepth(depth + 2).setInteractive();
    const maskShape = scene.make.graphics({}, false).fillStyle(0xffffff).fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
    const mask = maskShape.createGeometryMask();
    const list = scene.add.container(viewport.x, viewport.y).setDepth(depth + 2).setMask(mask);
    const track = scene.add.rectangle(viewport.x + viewport.width - 3, viewport.y, 3, viewport.height, UI.border, 0.35).setOrigin(0).setDepth(depth + 3);
    const thumb = scene.add.rectangle(track.x, track.y, 3, 30, UI.chip, 1).setOrigin(0).setDepth(depth + 3);
    let cy = 0;
    const width = viewport.width - 14;
    const add = (value: string, role: TextRole, color = UI.textBright, display = false) => {
      if (role === 'body' && !display) {
        const line = renderDetailText(scene, { x: 0, y: cy, width, text: value, style: {
          ...textRoleFor(opts.compact ? 'mobile' : 'desktop', role),
          fontFamily: FONT.body, color, lineSpacing: 3,
        } });
        list.add(line.container); cy += line.height + 8;
        return;
      }
      const line = text(0, cy, value, role, color, display, width);
      list.add(line); cy += line.height + (role === 'title' ? 6 : 8);
    };
    let scroll = 0;
    let max = 0;
    let drag: { y: number; scroll: number } | null = null;
    const applyScroll = (next: number) => {
      scroll = Phaser.Math.Clamp(next, 0, max);
      list.setY(viewport.y - scroll);
      track.setVisible(max > 0); thumb.setVisible(max > 0);
      const height = Math.max(20, viewport.height * Math.min(1, viewport.height / Math.max(1, cy)));
      thumb.setSize(3, height).setY(viewport.y + (max > 0 ? scroll / max * (viewport.height - height) : 0));
    };
    const redraw = () => {
      list.removeAll(true); cy = 0; drag = null;
      draw(add, list, width, () => cy, height => { cy += height; });
      max = Math.max(0, cy - viewport.height);
      applyScroll(0);
    };
    redraw();
    const inBox = (p: Phaser.Input.Pointer) => p.worldX >= viewport.x && p.worldX <= viewport.x + viewport.width && p.worldY >= viewport.y && p.worldY <= viewport.y + viewport.height;
    const down = (p: Phaser.Input.Pointer) => { if (!wasPointerConsumedByRebuild(scene, p) && inBox(p)) drag = { y: p.worldY, scroll }; };
    const move = (p: Phaser.Input.Pointer) => { if (drag && p.isDown) applyScroll(drag.scroll + drag.y - p.worldY); };
    const up = () => { drag = null; };
    const wheel = (p: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => { if (inBox(p)) applyScroll(scroll + dy); };
    scene.input.on('pointerdown', down).on('pointermove', move).on('pointerup', up).on('pointerupoutside', up).on('wheel', wheel);
    panel.once('destroy', () => {
      scene.input.off('pointerdown', down).off('pointermove', move).off('pointerup', up).off('pointerupoutside', up).off('wheel', wheel);
      list.clearMask(); mask.destroy(); maskShape.destroy();
    });
    return redraw;
  };
  const entries = (add: (value: string, role: TextRole, color?: string, display?: boolean) => void, rows: CardDetailsEntry[]) => {
    for (const entry of rows) { add(entry.title.toUpperCase(), 'body', UI.textAccent, true); add(entry.body, 'body'); }
  };
  if (presentation === 'mobile-shop') {
    const name = text(identity.x, identity.y, shown.name, 'title', UI.textBright, true, identity.width);
    const power = opts.powerDeci === undefined ? '' : String(opts.powerDeci / 10).replace(/\.0$/, '');
    text(identity.x, identity.y + name.height + 5, `POWER ${power} - ${shown.tier.toUpperCase()}`, 'body', UI.textAccent, true, identity.width);
    const statY = identity.y + Math.min(identity.height - 45, name.height + 54);
    const stats = [['TYPE', (shown.weapon ?? shown.element ?? shown.property).toUpperCase()], ['WEIGHT', String(content.weight)], ['SIZE', String(shown.size)]];
    stats.forEach(([label, value], index) => {
      const x = identity.x + index * identity.width / 3;
      text(x, statY, label!, 'statLabelTight', UI.textMuted, false, identity.width / 3 - 4);
      text(x, statY + 17, value!, 'body', UI.textBright, true, identity.width / 3 - 4);
    });
  }
  const redrawInfo = region(info, (add, list, width, y, advance) => {
    if (presentation === 'mobile-shop') {
      const [ability, ...keywords] = content.entries;
      add('WHAT IT DOES', 'body', UI.textAccent, true);
      if (ability) add(ability.body, 'body');
      add('KEYWORDS', 'body', UI.textAccent, true);
      entries(add, keywords);
      if (content.gem) entries(add, [content.gem]);
      return;
    }
    add(shown.name, 'title', UI.textBright, true);
    add(content.roles.join(' · '), 'body', UI.textSoft, true);
    const stats = [['TYPE', (shown.weapon ?? shown.element ?? shown.property).toUpperCase()], ['WEIGHT', String(content.weight)], ['SIZE', String(shown.size)]];
    const statY = y();
    const statWidth = Math.min(width, 360);
    stats.forEach(([label, value], index) => {
      list.add(text(index * statWidth / 3, statY, label!, 'statLabelTight', UI.textMuted));
      list.add(text(index * statWidth / 3, statY + 18, value!, 'body', UI.textBright, true, statWidth / 3 - 8));
    });
    advance(54);
    entries(add, content.entries);
    if (content.gem) entries(add, [content.gem]);
  });
  const renderActions = () => {
    const actions = [opts.primaryAction, opts.secondaryAction].filter((action): action is CardDetailsAction => Boolean(action));
    if (actions.length === 1) {
      const action = actions[0]!;
      button(footer, action.label, action.onPress, action.enabled, true);
    } else if (actions.length === 2) {
      const gap = 8;
      const width = (footer.width - gap) / 2;
      actions.forEach((action, index) => button({ x: footer.x + index * (width + gap), y: footer.y, width, height: footer.height }, action.label, action.onPress, action.enabled, index === 0));
    }
  };
  if (presentation === 'mobile-shop') { renderActions(); return; }
  const previewPanel = scene.add.rectangle(preview.x, preview.y, preview.width, preview.height, UI.panelMuted, 1)
    .setOrigin(0).setDepth(depth + 2).setStrokeStyle(1, UI.chip, 1);
  if (opts.compact) roundRect(previewPanel, 12);
  const status = text(preview.x + 8, preview.y + 5, '', 'label', UI.textSoft);
  const available = cardDetailsPreviewTiers(skill);
  const tabs: Phaser.GameObjects.Rectangle[] = [];
  const refreshTabs = () => {
    status.setText(`VIEWING ${shown.tier.toUpperCase()} · CURRENT ${skill.tier.toUpperCase()}`);
    tabs.forEach((tab, index) => tab.setFillStyle(UI.chip, TIER_ORDER[index] === shown.tier ? 0.28 : 0.04)
      .setStrokeStyle(TIER_ORDER[index] === shown.tier ? 2 : 1, TIER_ORDER[index] === shown.tier ? UI.chip : UI.border));
  };
  const select = (tier: SkillTier) => {
    if (tier === shown.tier) return;
    shown = resolveCardDetailsPreview(skill, tier, opts.gem);
    content = buildCardDetailsContent(shown, { gem: opts.gem });
    cardView.destroy(); cardView = makeCard();
    redrawInfo(); refreshTabs();
  };
  TIER_ORDER.forEach((tier, index) => tabs.push(button(rankButtons[index]!, tier.toUpperCase(), () => select(tier), available.includes(tier))));
  refreshTabs();
  renderActions();
}
