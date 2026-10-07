import Phaser from 'phaser';
import type { SkillDef } from '../../engine/types';
import { FONT, TIER_COLOR, textRoleFor } from '../theme';
import { wasPointerConsumedByRebuild } from '../sceneRebuild';
import { FantasyCardTemplateV2 } from './FantasyCardTemplateV2';
import { buildCardDetailsContent } from './cardDetailsContent';
import { renderDetailText } from './detailText';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { eventBodyScrollThumb } from './runEventStoryLayout';
import { layoutRunCardReward } from './runCardRewardLayout';
import type { Rect, RunScreenTemplate } from './runScreenTemplate';
import { attachButtonFeel } from './motion';

interface RewardInk {
  chip: number; border: number; panelAlt: number; chipDark: number;
  text: string; textDim: string; textAccent: string;
}

function renderDescriptions(scene: Phaser.Scene, bounds: Rect, skill: SkillDef, compact: boolean, colors: RewardInk, interactive: boolean, contextText?: string): void {
  const content = buildCardDetailsContent(skill);
  const platform = compact ? 'mobile' : 'desktop';
  const bodyFontSize = compact ? 12 : 13;
  const headingFontSize = compact ? 10 : 11;
  const lineSpacing = 2;
  const headingGap = 3;
  const entryGap = 6;
  const statsHeight = compact ? 58 : 54;
  const viewport = { ...bounds, height: Math.max(1, bounds.height - statsHeight - 8) };
  const surface = scene.add.rectangle(viewport.x, viewport.y, viewport.width, viewport.height, colors.panelAlt, 0.001)
    .setOrigin(0).setInteractive().setName('run-card-reward-scroll-surface');
  const maskShape = scene.make.graphics({}, false).fillStyle(0xffffff)
    .fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
  const mask = maskShape.createGeometryMask();
  const list = scene.add.container(viewport.x, viewport.y).setMask(mask).setName('run-card-reward-descriptions');
  const width = Math.max(1, viewport.width - 16);
  let cursorY = 0;
  if (contextText) {
    const context = scene.add.text(0, 0, contextText, {
      ...textRoleFor(platform, 'body'), fontSize: bodyFontSize, fontFamily: FONT.body, color: colors.textDim,
      wordWrap: { width, useAdvancedWrap: true }, lineSpacing,
    }).setOrigin(0).setName('run-card-reward-context');
    list.add(context);
    cursorY = context.height + entryGap;
  }
  for (const entry of content.entries) {
    const heading = scene.add.text(0, cursorY, entry.title.toUpperCase(), {
      ...textRoleFor(platform, 'kicker'), fontSize: headingFontSize, fontFamily: FONT.body, color: colors.textAccent,
      wordWrap: { width, useAdvancedWrap: true }, lineSpacing,
    }).setOrigin(0);
    list.add(heading);
    cursorY += heading.height + headingGap;
    const body = renderDetailText(scene, { x: 0, y: cursorY, width, text: entry.body, style: {
      ...textRoleFor(platform, 'body'), fontSize: bodyFontSize, fontFamily: FONT.body, color: colors.text, lineSpacing,
    } });
    list.add(body.container);
    cursorY += body.height + entryGap;
  }
  const contentHeight = Math.max(0, cursorY - entryGap);
  const maxScroll = Math.max(0, contentHeight - viewport.height);
  const trackX = viewport.x + viewport.width - 4;
  const track = scene.add.rectangle(trackX, viewport.y, 3, viewport.height, colors.border, 0.28).setOrigin(0);
  const thumb = scene.add.rectangle(trackX, viewport.y, 3, viewport.height, colors.chip, 1)
    .setOrigin(0).setName('run-card-reward-scroll-thumb');
  let scroll = 0;
  let drag: { y: number; scroll: number } | null = null;
  const applyScroll = (next: number): void => {
    scroll = Phaser.Math.Clamp(next, 0, maxScroll);
    list.setY(viewport.y - scroll).setData('scrollOffset', scroll);
    const geometry = eventBodyScrollThumb(viewport.height, viewport.height, contentHeight, scroll);
    thumb.setSize(3, geometry.height).setY(viewport.y + geometry.offset);
    track.setVisible(maxScroll > 0); thumb.setVisible(maxScroll > 0);
  };
  list.setData({ viewport, contentHeight, maxScroll, entries: content.entries,
    typography: { bodyFontSize, headingFontSize, lineSpacing, headingGap, entryGap } });
  const inBox = (pointer: Phaser.Input.Pointer): boolean =>
    pointer.worldX >= viewport.x && pointer.worldX <= viewport.x + viewport.width
    && pointer.worldY >= viewport.y && pointer.worldY <= viewport.y + viewport.height;
  const down = (pointer: Phaser.Input.Pointer): void => {
    if (!wasPointerConsumedByRebuild(scene, pointer) && inBox(pointer)) drag = { y: pointer.worldY, scroll };
  };
  const move = (pointer: Phaser.Input.Pointer): void => {
    if (drag && pointer.isDown) applyScroll(drag.scroll + drag.y - pointer.worldY);
  };
  const up = (): void => { drag = null; };
  const wheel = (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number): void => {
    if (inBox(pointer)) applyScroll(scroll + dy);
  };
  if (interactive) {
    scene.input.on('pointerdown', down).on('pointermove', move).on('pointerup', up).on('pointerupoutside', up).on('wheel', wheel);
  } else {
    surface.disableInteractive();
  }
  surface.once('destroy', () => {
    scene.input.off('pointerdown', down).off('pointermove', move).off('pointerup', up).off('pointerupoutside', up).off('wheel', wheel);
    if (list.scene) list.clearMask();
    mask.destroy(); maskShape.destroy();
  });
  applyScroll(0);

  const statsY = bounds.y + bounds.height - statsHeight;
  scene.add.rectangle(bounds.x, statsY, bounds.width, 1, colors.border, 0.6).setOrigin(0);
  const stats = [['TYPE', (skill.weapon ?? skill.element ?? skill.property).toUpperCase()],
    ['WEIGHT', String(content.weight)], ['SLOTS', String(skill.size)]];
  stats.forEach(([label, value], index) => {
    const x = bounds.x + index * bounds.width / 3;
    const statWidth = bounds.width / 3 - 8;
    scene.add.text(x, statsY + 10, label!, { ...textRoleFor(platform, 'kicker'), color: colors.textDim }).setOrigin(0);
    const text = scene.add.text(x, statsY + 28, value!, {
      ...textRoleFor(platform, 'body'), fontFamily: FONT.body, fontStyle: 'bold', color: colors.text,
    }).setOrigin(0);
    auditTextBlock(text, { name: `Run card reward ${label}`, maxWidth: statWidth, maxHeight: statsHeight - 28, minFontSize: 10 });
  });
}

export function renderRunCardReward(scene: Phaser.Scene, template: RunScreenTemplate, skill: SkillDef, opts: {
  headline: string; detail?: string; eventTitle: string; colors: RewardInk; onInspect?: () => void; inspected?: boolean;
}): Rect {
  const compact = template.platform === 'mobile';
  const platform = template.platform;
  const layout = layoutRunCardReward(template.contentSlots.reward.panel, template.eventOutcomePane!.header, compact);
  const { colors } = opts;
  const header = template.eventOutcomePane!.header;
  const eventTitle = scene.add.text(header.x + header.width, header.y, opts.eventTitle.toUpperCase(), {
    ...textRoleFor(platform, 'kicker'), color: colors.textDim,
  }).setOrigin(1, 0).setName('run-card-reward-event-title');
  auditTextBlock(eventTitle, { name: 'Run card reward event title', maxWidth: header.width * 0.45, maxHeight: header.height, minFontSize: 9 });

  const kicker = scene.add.text(layout.identity.x, layout.identity.y, opts.headline, {
    ...textRoleFor(platform, 'kicker'), color: colors.textAccent, wordWrap: { width: layout.identity.width },
  }).setOrigin(0);
  auditTextBlock(kicker, { name: 'Run card reward receipt', maxWidth: layout.identity.width, maxHeight: 30, minFontSize: 10 });
  const nameY = layout.identity.y + kicker.height + 6;
  const name = scene.add.text(layout.identity.x, nameY, skill.name, {
    ...textRoleFor(platform, compact ? 'title' : 'display'), fontFamily: FONT.display, fontStyle: 'bold',
    color: colors.text, wordWrap: { width: layout.identity.width, useAdvancedWrap: true },
  }).setOrigin(0).setName('run-card-reward-name');
  auditTextBlock(name, { name: 'Run card reward name', maxWidth: layout.identity.width,
    maxHeight: Math.max(18, layout.identity.y + layout.identity.height - nameY), minFontSize: 14 });
  const card = new FantasyCardTemplateV2(scene, layout.card.x + layout.card.width / 2, layout.card.y + layout.card.height / 2,
    skill, { width: layout.card.width, height: layout.card.height, tier: skill.tier, glossary: false })
    .setName('run-card-reward-card');
  if (opts.onInspect) card.setInteractive({ useHandCursor: true }).on('pointerdown', opts.onInspect);
  renderDescriptions(scene, layout.details, skill, compact, colors, !opts.inspected, opts.detail);
  if (opts.onInspect) {
    const expand = scene.add.rectangle(layout.expand.x, layout.expand.y, layout.expand.width, layout.expand.height, colors.panelAlt, 1)
      .setOrigin(0).setStrokeStyle(1, TIER_COLOR[skill.tier] ?? colors.border, 0.9)
      .setInteractive({ useHandCursor: true }).setName('run-card-reward-expand');
    const label = scene.add.text(expand.x + layout.expand.width / 2, expand.y + layout.expand.height / 2, 'EXPAND CARD', {
      ...textRoleFor(platform, 'label'), color: colors.textAccent, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5);
    auditControlLabel(expand, label, { name: 'Run card reward expand', horizontalPadding: 10, verticalPadding: 8, minFontSize: 10 });
    attachButtonFeel(scene, expand, { fill: colors.panelAlt, hover: colors.chipDark, follow: [label], onPress: opts.onInspect });
  }
  return layout.continue;
}
