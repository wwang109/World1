import type Phaser from 'phaser';
import { INK, UI } from '../theme';
import { keywordTextColor, parseCardTextMarkup } from './cardTextMarkup';
import { STAT_TOKEN } from './statLabels';

const STAT_COLOR: Record<string, string> = {
  [STAT_TOKEN.maxHp]: INK.vital,
  [STAT_TOKEN.attack]: INK.cost,
  [STAT_TOKEN.magicPower]: INK.capacity,
  [STAT_TOKEN.armor]: INK.combatShield,
  [STAT_TOKEN.magicResist]: INK.combatShield,
  [STAT_TOKEN.speed]: INK.readiness,
};
const STAT_PATTERN = new RegExp(`\\b(${Object.keys(STAT_COLOR).join('|')})\\b`);

export function renderDetailText(scene: Phaser.Scene, opts: {
  x: number; y: number; width: number; text: string; style: Phaser.Types.GameObjects.Text.TextStyle;
}): { container: Phaser.GameObjects.Container; height: number } {
  const container = scene.add.container(opts.x, opts.y);
  let cursorX = 0;
  let cursorY = 0;
  let lineHeight = 0;
  const segments = parseCardTextMarkup(opts.text).flatMap(segment => segment.text.split(STAT_PATTERN)
    .filter(Boolean).map(part => ({ text: part, keyword: segment.keyword, statColor: STAT_COLOR[part] })));
  for (const segment of segments) {
    const color = segment.statColor ?? (segment.keyword ? keywordTextColor(segment.keyword) ?? UI.textAccent : opts.style.color ?? UI.textBright);
    for (const token of segment.text.split(/(\s+)/).filter(Boolean)) {
      const word = scene.add.text(0, 0, token, {
        ...opts.style, color, wordWrap: undefined,
        fontStyle: segment.keyword || segment.statColor ? 'bold' : opts.style.fontStyle,
      }).setOrigin(0);
      const whitespace = /^\s+$/.test(token);
      if ((cursorX > 0 && cursorX + word.width > opts.width) || token.includes('\n')) {
        cursorX = 0; cursorY += lineHeight + (opts.style.lineSpacing ?? 3); lineHeight = 0;
      }
      if (whitespace) {
        if (cursorX > 0) cursorX += word.width;
        word.destroy();
        continue;
      }
      word.setPosition(cursorX, cursorY);
      container.add(word);
      cursorX += word.width;
      lineHeight = Math.max(lineHeight, word.height);
    }
  }
  return { container, height: cursorY + lineHeight };
}
