import type Phaser from 'phaser';
import type { GemDef } from '../../data/gems';
import { renderGemText } from '../../engine/keywords/gemText';
import { FONT, textRoleFor } from '../theme';
import { wasPointerConsumedByRebuild } from '../sceneRebuild';
import { GemToken } from './GemToken';
import { gemChipLines, gemStandaloneRuleEntries } from './gemPresentation';
import { renderDetailText } from './detailText';
import { auditTextBlock } from './controlLayoutAudit';
import { eventBodyScrollThumb } from './runEventStoryLayout';
import { layoutRunGemReward } from './runGemRewardLayout';
import type { Rect, RunScreenTemplate } from './runScreenTemplate';

interface RewardInk {
  panelAlt: number; border: number; chip: number; text: string; textDim: string; textAccent: string;
}

export function renderRunGemReward(scene: Phaser.Scene, template: RunScreenTemplate, gem: GemDef,
  opts: { headline: string; detail?: string; colors: RewardInk }): Rect {
  const compact = template.platform === 'mobile';
  const platform = template.platform;
  const layout = layoutRunGemReward(template.contentSlots.reward.panel, compact);
  const { colors } = opts;
  const lines = gemChipLines(gem);
  const centerX = layout.identity.x + layout.identity.width / 2;
  const headline = scene.add.text(centerX, layout.identity.y, opts.headline, {
    ...textRoleFor(platform, 'kicker'), color: colors.textAccent, align: 'center', wordWrap: { width: layout.identity.width },
  }).setOrigin(0.5, 0);
  auditTextBlock(headline, { name: 'Run gem reward receipt', maxWidth: layout.identity.width, maxHeight: 18, minFontSize: 10 });
  const name = scene.add.text(centerX, headline.y + headline.height + 6, lines.name, {
    ...textRoleFor(platform, compact ? 'title' : 'display'), fontFamily: FONT.display, fontStyle: 'bold',
    color: colors.text, align: 'center', wordWrap: { width: layout.identity.width, useAdvancedWrap: true },
  }).setOrigin(0.5, 0).setName('run-gem-reward-name');
  auditTextBlock(name, { name: 'Run gem reward name', maxWidth: layout.identity.width, maxHeight: compact ? 42 : 30, minFontSize: 14 });
  const metaY = name.y + name.height + 6;
  const meta = scene.add.text(centerX, metaY, lines.meta, {
    ...textRoleFor(platform, 'kicker'), color: colors.textDim, align: 'center', wordWrap: { width: layout.identity.width },
  }).setOrigin(0.5, 0);
  auditTextBlock(meta, { name: 'Run gem reward rarity', maxWidth: layout.identity.width,
    maxHeight: Math.max(0, layout.identity.y + layout.identity.height - metaY), minFontSize: 9 });
  new GemToken(scene, layout.art.x + layout.art.width / 2, layout.art.y + layout.art.height / 2, gem, layout.art)
    .setName('run-gem-reward-art');

  const viewport = layout.details;
  const surface = scene.add.rectangle(viewport.x, viewport.y, viewport.width, viewport.height, colors.panelAlt, 0.001)
    .setOrigin(0).setInteractive().setName('run-gem-reward-scroll-surface');
  const maskShape = scene.make.graphics({}, false).fillStyle(0xffffff)
    .fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
  const mask = maskShape.createGeometryMask();
  const list = scene.add.container(viewport.x, viewport.y).setMask(mask).setName('run-gem-reward-descriptions');
  const entries = [{ title: 'Gem effect', body: renderGemText(gem) }, ...gemStandaloneRuleEntries(gem)];
  const width = Math.max(1, viewport.width - 14);
  let cursorY = 0;
  if (opts.detail) {
    const context = renderDetailText(scene, { x: 0, y: cursorY, width, text: opts.detail,
      style: { fontFamily: FONT.body, fontSize: compact ? 12 : 13, color: colors.textDim, lineSpacing: 2 } });
    context.container.setName('run-gem-reward-context');
    list.add(context.container); cursorY += context.height + 8;
  }
  for (const entry of entries) {
    const heading = scene.add.text(0, cursorY, entry.title.toUpperCase(), {
      ...textRoleFor(platform, 'kicker'), fontSize: compact ? 10 : 11, color: colors.textAccent,
      wordWrap: { width, useAdvancedWrap: true },
    }).setOrigin(0);
    list.add(heading); cursorY += heading.height + 3;
    const body = renderDetailText(scene, { x: 0, y: cursorY, width, text: entry.body,
      style: { fontFamily: FONT.body, fontSize: compact ? 12 : 13, color: colors.text, lineSpacing: 2 } });
    list.add(body.container); cursorY += body.height + 8;
  }
  const contentHeight = Math.max(0, cursorY - 8);
  const maxScroll = Math.max(0, contentHeight - viewport.height);
  list.setData({ viewport, contentHeight, maxScroll, entries });
  const trackX = viewport.x + viewport.width - 3;
  const track = scene.add.rectangle(trackX, viewport.y, 3, viewport.height, colors.border, 0.28).setOrigin(0);
  const thumb = scene.add.rectangle(trackX, viewport.y, 3, viewport.height, colors.chip, 1).setOrigin(0)
    .setName('run-gem-reward-scroll-thumb');
  let scroll = 0;
  let drag: { y: number; scroll: number } | null = null;
  const applyScroll = (next: number): void => {
    scroll = Math.max(0, Math.min(maxScroll, next));
    list.setY(viewport.y - scroll).setData('scrollOffset', scroll);
    const geometry = eventBodyScrollThumb(viewport.height, viewport.height, contentHeight, scroll);
    thumb.setSize(3, geometry.height).setY(viewport.y + geometry.offset);
    track.setVisible(maxScroll > 0); thumb.setVisible(maxScroll > 0);
  };
  const inBox = (pointer: Phaser.Input.Pointer): boolean => pointer.worldX >= viewport.x
    && pointer.worldX <= viewport.x + viewport.width && pointer.worldY >= viewport.y && pointer.worldY <= viewport.y + viewport.height;
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
  scene.input.on('pointerdown', down).on('pointermove', move).on('pointerup', up).on('pointerupoutside', up).on('wheel', wheel);
  surface.once('destroy', () => {
    scene.input.off('pointerdown', down).off('pointermove', move).off('pointerup', up).off('pointerupoutside', up).off('wheel', wheel);
    if (list.scene) list.clearMask();
    mask.destroy(); maskShape.destroy();
  });
  applyScroll(0);
  return layout.continue;
}
