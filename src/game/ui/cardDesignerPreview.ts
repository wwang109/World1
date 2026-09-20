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

export function renderCardDesignerPreview(
  scene: Phaser.Scene,
  skill: SkillDef,
  options: CardDesignerPreviewOptions,
): void {
  const pad = 12;
  scene.add.rectangle(options.x, options.y, options.width, options.height, UI.panelMuted, 0.78)
    .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7);

  const innerHeight = options.height - pad * 2;
  const infoX = options.x + pad;
  const infoY = options.y + pad;
  const infoWidth = options.width - pad * 2;
  const infoHeight = innerHeight;
  let attempt: DetailAttempt | undefined;
  for (const bodySize of [14, 13, 12, 11]) {
    attempt?.container.destroy(true);
    attempt = renderDetailAttempt(scene, skill, infoX, infoY, infoWidth, bodySize);
    if (attempt.height <= infoHeight) break;
  }
  if (!attempt || attempt.height <= infoHeight) return;

  const warningHeight = 30;
  const maskShape = scene.make.graphics({}, false)
    .fillStyle(0xffffff)
    .fillRect(infoX, infoY, infoWidth, Math.max(1, infoHeight - warningHeight));
  const mask = maskShape.createGeometryMask();
  attempt.container.setMask(mask);
  attempt.container.once('destroy', () => {
    attempt?.container.clearMask();
    mask.destroy();
    maskShape.destroy();
  });
  scene.add.rectangle(infoX, infoY + infoHeight - warningHeight, infoWidth, warningHeight, UI.panel, 0.96)
    .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7);
  scene.add.text(infoX + 8, infoY + infoHeight - warningHeight + 6, 'Preview limit reached — shorten this draft to inspect every rule.', {
    fontFamily: FONT.body,
    fontStyle: 'bold',
    fontSize: '10px',
    color: '#e8907a',
    wordWrap: { width: infoWidth - 16, useAdvancedWrap: true },
  }).setOrigin(0, 0);
}
