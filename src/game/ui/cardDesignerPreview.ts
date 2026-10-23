import Phaser from 'phaser';
import type { SkillDef } from '../../engine/types';
import { renderSkillText } from '../../engine/keywords/compose';
import { FONT, UI } from '../theme';
import { buildCardDetailsContent } from './cardDetailsContent';
import { cardHoverEntries } from './cardHoverEntries';
import { stripCardTextMarkup } from './cardTextMarkup';

export interface CardDesignerPreviewOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceArtId?: string;
}

interface DetailAttempt {
  container: Phaser.GameObjects.Container;
  height: number;
}

function renderDetailAttempt(
  scene: Phaser.Scene,
  skill: SkillDef,
  x: number,
  y: number,
  width: number,
  bodySize: number,
): DetailAttempt {
  const content = buildCardDetailsContent(skill);
  const hover = cardHoverEntries(skill);
  const container = scene.add.container(x, y);
  let cy = 0;
  const add = (value: string, size: number, color: string, bold = false, display = false, gap = 4): void => {
    const line = scene.add.text(0, cy, value, {
      fontFamily: display ? FONT.display : FONT.body,
      fontStyle: bold ? 'bold' : 'normal',
      fontSize: `${size}px`,
      color,
      lineSpacing: 2,
      wordWrap: { width, useAdvancedWrap: true },
    }).setOrigin(0, 0);
    container.add(line);
    cy += line.height + gap;
  };
  const section = (title: string): void => {
    if (cy > 0) cy += 5;
    add(title, bodySize + 2, UI.textAccent, true, true, 5);
  };
  const entries = (rows: readonly { title: string; body: string }[]): void => {
    for (const entry of rows) {
      add(entry.title.toUpperCase(), Math.max(10, bodySize - 1), UI.textAccent, true, true, 1);
      add(entry.body, bodySize, UI.textBright, false, false, 4);
    }
  };

  section('CARD FACE');
  add(stripCardTextMarkup(renderSkillText(skill)), bodySize + 1, UI.textBright, false, false, 4);

  section('HOVER');
  entries(hover);

  section('CARD DETAILS');
  add(skill.name, bodySize + 5, UI.textBright, true, true, 1);
  if (content.roles.length > 0) add(content.roles.join(' · '), bodySize, UI.textSoft, true, false, 4);

  const stats = [
    ['TYPE', (skill.weapon ?? skill.element ?? skill.property).toUpperCase()],
    ['WEIGHT', String(content.weight)],
    ['SIZE', String(skill.size)],
  ] as const;
  const statWidth = width / stats.length;
  const statTop = cy;
  for (let index = 0; index < stats.length; index += 1) {
    const [label, value] = stats[index]!;
    const sx = index * statWidth;
    container.add(scene.add.text(sx, statTop, label, {
      fontFamily: FONT.body, fontSize: `${Math.max(9, bodySize - 2)}px`, color: UI.textMuted,
    }).setOrigin(0, 0));
    container.add(scene.add.text(sx, statTop + bodySize + 3, value, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${bodySize}px`, color: UI.textBright,
      wordWrap: { width: statWidth - 6, useAdvancedWrap: true },
    }).setOrigin(0, 0));
  }
  cy += bodySize * 2 + 9;
  entries(content.gem ? [...content.entries, content.gem] : content.entries);

  return { container, height: cy };
}

export interface CardDesignerPreview {
  content: Phaser.GameObjects.Container;
  viewport: { x: number; y: number; w: number; h: number };
  contentHeight: number;
}

export function renderCardDesignerPreview(
  scene: Phaser.Scene,
  skill: SkillDef,
  options: CardDesignerPreviewOptions,
): CardDesignerPreview {
  const pad = 12;
  const scrollbar = 8;
  scene.add.rectangle(options.x, options.y, options.width, options.height, UI.panelMuted, 0.78)
    .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7);

  const innerHeight = options.height - pad * 2;
  let attempt: DetailAttempt | undefined;
  for (const bodySize of [14, 13, 12]) {
    attempt?.container.destroy(true);
    attempt = renderDetailAttempt(scene, skill, options.x + pad, options.y + pad, options.width - pad * 2 - scrollbar, bodySize);
    if (attempt.height <= innerHeight) break;
  }
  return {
    content: attempt!.container,
    viewport: { x: options.x + 2, y: options.y + 2, w: options.width - 4, h: options.height - 4 },
    contentHeight: attempt!.height + pad * 2 - 4,
  };
}
