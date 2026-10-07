import Phaser from 'phaser';
import { FONT } from '../theme';
import { keywordTextColor, parseCardTextMarkup } from './cardTextMarkup';
import { FANTASY_RULES_STYLES, type FantasyCardRulesRow } from './fantasyCardRulesRows';
import type { FantasyCardTemplateModel } from './fantasyCardTemplateModel';
import type { RegionBox } from './fantasyCardTemplateSpec';

type PrintedWordRole = 'keyword' | 'number' | 'aside' | 'plain';
interface PrintedWord { text: string; keyword?: string; glued: boolean; role: PrintedWordRole; joinsPrevious: boolean }

const ASIDE_SCALE = 0.86;
const ASIDE_INK_MIX = 0.45;

function paperKeywordColor(keyword: string): string {
  const rgb = Number.parseInt((keywordTextColor(keyword) ?? '#99814c').slice(1), 16);
  const channels = [rgb >> 16, (rgb >> 8) & 255, rgb & 255].map(channel => Math.round(channel * 0.45));
  return '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('');
}

function mixColor(ink: string, panel: number, amount: number): string {
  const rgb = Number.parseInt(ink.slice(1), 16);
  const channel = (shift: number) => Math.round(((rgb >> shift) & 255) * (1 - amount) + ((panel >> shift) & 255) * amount);
  return '#' + [16, 8, 0].map(shift => channel(shift).toString(16).padStart(2, '0')).join('');
}

function printedWords(text: string): PrintedWord[] {
  const words: PrintedWord[] = [];
  let gap = false;
  let aside = false;
  for (const segment of parseCardTextMarkup(text)) {
    let firstInSegment = true;
    for (const piece of segment.text.split(/(\s+)/)) {
      if (piece === '') continue;
      if (/^\s+$/.test(piece)) { gap = true; continue; }
      const opensAside = segment.keyword === undefined && piece.startsWith('(');
      const insideAside = aside;
      if (opensAside) aside = true;
      const role: PrintedWordRole = segment.keyword !== undefined ? 'keyword'
        : aside || piece === '—' ? 'aside'
          : /^[+\-−]?\d+%?[,;:]?$/.test(piece) ? 'number' : 'plain';
      const previous = words.at(-1);
      const glued = previous !== undefined && !gap;
      const joinsPrevious = previous !== undefined && (glued
        || (role === 'keyword' && !firstInSegment)
        || (role === 'number' && previous.role === 'keyword')
        || (insideAside && !opensAside));
      words.push({ text: piece, ...(segment.keyword !== undefined ? { keyword: segment.keyword } : {}), glued, role, joinsPrevious });
      if (aside && piece.includes(')')) aside = false;
      gap = false;
      firstInSegment = false;
    }
  }
  return words;
}

export interface RulesBodyStyle {
  ink: string;
  asideInk: string;
  keywordColor: (keyword: string) => string;
  stroke?: { color: string; thickness: number };
  maxFontSize: number;
  readingFontSize?: number;
  minFontSize: number;
  lineHeightRatio: number;
  rowGap: number;
  labelWidth: number;
  labelFontSize?: number;
  markerWidth: number;
  center: boolean;
  alignColons?: boolean;
  useLabelDisplay: boolean;
}

const SINGLE_LINE_FLOOR = 0.6;
const HANGING_INDENT_EM = 1.2;
const MAX_PREFIX_WORDS = 4;
const MAX_PREFIX_SHARE = 0.45;
const LABEL_SPREAD = 1.3;
const LABEL_MIN_SCALE = 0.72;

function plainClause(text: string): string {
  return text.trim().replace(/\.$/, '').replace(/^[a-z]/, letter => letter.toUpperCase());
}

export function makeRulesBody(
  scene: Phaser.Scene,
  rulesRows: readonly FantasyCardRulesRow[],
  box: RegionBox,
  name: string,
  style: RulesBodyStyle,
): Phaser.GameObjects.Container {
  const group = scene.add.container(0, 0).setName(name);
  const labelWidth = style.labelWidth;
  const textWidth = box.w - labelWidth;
  const minFont = style.minFontSize;
  const strokeStyle = style.stroke ? { stroke: style.stroke.color, strokeThickness: style.stroke.thickness } : {};
  const glueOverlap = style.stroke?.thickness ?? 0;
  const wordsByRow = rulesRows.map(row => printedWords(style.useLabelDisplay ? row.display : plainClause(row.text)).map(word => ({
    ...word,
    object: scene.add.text(0, 0, word.text, {
      fontFamily: FONT.body,
      fontStyle: word.role === 'keyword' || word.role === 'number' ? 'bold' : 'normal',
      color: word.role === 'keyword' ? style.keywordColor(word.keyword!) : word.role === 'aside' ? style.asideInk : style.ink,
      ...strokeStyle,
    }).setOrigin(0, 0),
  })));

  const flowCapable = style.labelFontSize === undefined && style.markerWidth === 0 && wordsByRow.length > 1;
  const separators = flowCapable
    ? wordsByRow.slice(1).map(() => scene.add.text(0, 0, '·', { fontFamily: FONT.body, color: style.asideInk, ...strokeStyle }).setOrigin(0, 0))
    : [];
  const flowRows = flowCapable
    ? [wordsByRow.flatMap((words, row) => (row === 0 ? words : [
      { text: '·', glued: false, role: 'aside' as const, joinsPrevious: true, object: separators[row - 1]! },
      ...words,
    ]))]
    : [];
  const prefixCounts = wordsByRow.map(words => {
    const colon = words.findIndex(word => word.text.endsWith(':'));
    return colon >= 0 && colon < MAX_PREFIX_WORDS && colon < words.length - 1 ? colon + 1 : 0;
  });

  function layout(fontSize: number, wrap: boolean, rowsWords: typeof wordsByRow = wordsByRow, flow = false) {
    const space = fontSize * 0.32;
    const asideSize = Math.max(minFont, Math.round(fontSize * ASIDE_SCALE));
    rowsWords.forEach(words => words.forEach(word => word.object.setFontSize(word.role === 'aside' ? asideSize : fontSize)));
    const runWidth = (words: typeof wordsByRow[number], from: number, to: number) => {
      let width = 0;
      for (let index = from; index < to; index++) width += (index > from ? (words[index]!.glued ? -glueOverlap : space) : 0) + words[index]!.object.width;
      return width;
    };
    if (style.alignColons && !flow) {
      const natural = wordsByRow.map((words, row) => runWidth(words, 0, prefixCounts[row]!));
      const labelled = natural.filter(width => width > 0);
      const target = labelled.length > 1 ? Math.min(...labelled) * LABEL_SPREAD : Infinity;
      const labelFloor = Math.max(1, Math.round(minFont * 0.85));
      wordsByRow.forEach((words, row) => {
        const width = natural[row]!;
        if (width <= target) return;
        const labelSize = Math.max(labelFloor, Math.round(fontSize * Math.max(LABEL_MIN_SCALE, target / width)));
        for (let index = 0; index < prefixCounts[row]!; index++) words[index]!.object.setFontSize(labelSize);
      });
    }
    const dropOf = (word: typeof wordsByRow[number][number]) => Math.max(0, Math.round((fontSize - Number.parseFloat(String(word.object.style.fontSize))) * 0.7));
    const prefixWidths = flow ? [0] : wordsByRow.map((words, row) => runWidth(words, 0, prefixCounts[row]!));
    const column = style.alignColons && !flow ? Math.max(0, ...prefixWidths) : 0;
    const aligned = column > 0 && column <= textWidth * MAX_PREFIX_SHARE;
    const bodyStart = aligned ? column + space : 0;
    const indent = flow ? 0 : Math.round(fontSize * HANGING_INDENT_EM);
    let cursorY = 0;
    return rowsWords.map((words, row) => {
      const lineHeight = Math.max(fontSize * style.lineHeightRatio, ...words.map(word => word.object.height));
      const prefixCount = flow ? 0 : prefixCounts[row]!;
      const unitWidth = (from: number) => {
        let to = from + 1;
        while (to < words.length && words[to]!.joinsPrevious) to++;
        return runWidth(words, from, to);
      };
      let prefixX = 0;
      const start = aligned && prefixCount > 0 ? bodyStart : 0;
      let continuation = start > 0 ? start : indent;
      let lineStart = start;
      let cursorX = start;
      let line = 0;
      const placed = words.map((word, index) => {
        const drop = dropOf(word);
        if (aligned && index < prefixCount) {
          const x = prefixX + (index > 0 ? (word.glued ? -glueOverlap : space) : 0);
          prefixX = x + word.object.width;
          return { word, x, line: 0, y: cursorY + drop, lineHeight: lineHeight - drop };
        }
        const gap = cursorX > lineStart && !word.glued ? space : 0;
        const needed = word.joinsPrevious ? word.object.width : Math.min(unitWidth(index), textWidth - continuation);
        if (wrap && cursorX > lineStart && cursorX + gap + needed > textWidth) { line++; lineStart = continuation; cursorX = lineStart; }
        const x = cursorX + (cursorX > lineStart ? (word.glued ? -glueOverlap : space) : 0);
        cursorX = x + word.object.width;
        if (!aligned && line === 0 && prefixCount > 0 && index === prefixCount) continuation = Math.min(x, textWidth * MAX_PREFIX_SHARE);
        return { word, x, line, y: cursorY + line * lineHeight + drop, lineHeight: lineHeight - drop };
      });
      const top = cursorY;
      cursorY += (line + 1) * lineHeight + style.rowGap;
      const right = Math.max(0, ...placed.map(item => item.x + item.word.object.width));
      return { placed, top, right, height: (line + 1) * lineHeight, bottom: cursorY - style.rowGap };
    });
  }

  const maxFont = Math.max(minFont, Math.round(style.maxFontSize));
  const singleFloor = Math.min(maxFont, Math.max(minFont, Math.round((style.readingFontSize ?? maxFont) * SINGLE_LINE_FLOOR)));
  let font = maxFont;
  let rows: ReturnType<typeof layout> | undefined;
  for (let size = maxFont; size >= singleFloor && !rows; size--) {
    const candidate = layout(size, false);
    if (candidate.every(row => row.right <= textWidth) && (candidate.at(-1)?.bottom ?? 0) <= box.h) {
      rows = candidate;
      font = size;
    }
  }
  let mode: 'lines' | 'wrapped' | 'flow' = rows ? 'lines' : 'wrapped';
  if (!rows) {
    font = singleFloor;
    rows = layout(font, true);
    while ((rows.at(-1)?.bottom ?? 0) > box.h && font > minFont) rows = layout(--font, true);
  }
  if ((rows.at(-1)?.bottom ?? 0) > box.h && flowCapable) {
    mode = 'flow';
    font = singleFloor;
    rows = layout(font, true, flowRows, true);
    while ((rows.at(-1)?.bottom ?? 0) > box.h && font > minFont) rows = layout(--font, true, flowRows, true);
  }
  if (mode !== 'flow') separators.forEach(separator => separator.destroy());
  const finalRows = rows;
  const contentHeight = finalRows.at(-1)?.bottom ?? 0;
  const contentWidth = labelWidth + Math.max(0, ...finalRows.map(row => row.right));
  const fits = contentHeight <= box.h;
  const contentTop = box.y + (style.center && fits ? Math.floor((box.h - contentHeight) / 2) : 0);
  const contentLeft = box.x + (style.center && fits ? Math.max(0, Math.floor((box.w - contentWidth) / 2)) : 0);

  let clipped = false;
  let last: Phaser.GameObjects.Text | undefined;
  let lastRight = 0;
  const visibleRows: number[] = [];
  finalRows.forEach((row, index) => {
    let visible = false;
    for (const item of row.placed) {
      if (clipped || item.y + item.lineHeight > box.h || item.word.object.width > textWidth) {
        clipped = true;
        item.word.object.destroy();
        continue;
      }
      item.word.object.setPosition(contentLeft + labelWidth + item.x, contentTop + item.y);
      group.add(item.word.object);
      last = item.word.object;
      lastRight = textWidth - item.x;
      visible = true;
    }
    if (!visible) return;
    visibleRows.push(index);
    const rulesRow = rulesRows[index]!;
    const color = FANTASY_RULES_STYLES[rulesRow.category].color;
    if (style.labelFontSize !== undefined && rulesRow.label) {
      const label = scene.add.text(contentLeft, contentTop + row.top, rulesRow.label, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: Math.max(7, Math.round(style.labelFontSize)), color,
      });
      while (label.width > labelWidth - style.labelFontSize * 0.5 && Number(label.style.fontSize) > 5) label.setFontSize(Number(label.style.fontSize) - 1);
      group.add(label);
    } else if (style.markerWidth > 0) {
      const marker = scene.add.rectangle(contentLeft, contentTop + row.top, style.markerWidth, Math.min(row.height, font * 1.25), Phaser.Display.Color.HexStringToColor(color).color).setOrigin(0, 0);
      group.add(marker);
    }
  });
  if (clipped) {
    if (last) {
      let text = last.text;
      last.setText(text + '…');
      while (last.width > lastRight && text.length > 0) { text = text.slice(0, -1); last.setText(text + '…'); }
    } else {
      group.add(scene.add.text(box.x + labelWidth, box.y, '…', { fontFamily: FONT.body, fontSize: minFont, color: style.ink, ...strokeStyle }));
    }
  }
  group.setData({ truncated: clipped, mode, fontSize: font, rows: rulesRows, visibleRows, bodyRegion: box });
  return group;
}

const PRINTED_MAX_BODY_FONT = 13;

export function makePrintedCardBody(
  scene: Phaser.Scene,
  model: FantasyCardTemplateModel,
  box: RegionBox,
  scale: number,
  name: string,
): Phaser.GameObjects.Container {
  const printed = model.spec.printed!;
  const showLabels = scale >= printed.labelMinScale;
  return makeRulesBody(scene, model.rows, box, name, {
    ink: printed.ink,
    asideInk: mixColor(printed.ink, printed.panel, ASIDE_INK_MIX),
    keywordColor: paperKeywordColor,
    maxFontSize: Math.min(printed.bodyFontSize, PRINTED_MAX_BODY_FONT) * scale,
    minFontSize: printed.bodyMinFontSize,
    lineHeightRatio: printed.bodyLineHeightRatio,
    rowGap: Math.max(2, printed.rowGap * scale),
    labelWidth: (showLabels ? printed.labelWidth : printed.compactLabelWidth) * scale,
    ...(showLabels ? { labelFontSize: printed.labelFontSize * scale } : {}),
    markerWidth: Math.max(1, scale * 2),
    center: true,
    useLabelDisplay: true,
  });
}

const CLASSIC_INK = '#f1efe8';
const CLASSIC_ASIDE_INK = '#b9b3a4';
const CLASSIC_STROKE = '#111722';
const CLASSIC_MAX_BODY_FONT = 22;
const CLASSIC_READING_BODY_FONT = 13;
const CLASSIC_MIN_BODY_FONT = 8;
const TOKEN_MAX_BODY_FONT = 12;

export function makeTokenCardBody(
  scene: Phaser.Scene,
  rulesRows: readonly FantasyCardRulesRow[],
  box: RegionBox,
  name: string,
): Phaser.GameObjects.Container {
  return makeRulesBody(scene, rulesRows, box, name, {
    ink: CLASSIC_INK,
    asideInk: CLASSIC_ASIDE_INK,
    keywordColor: keyword => keywordTextColor(keyword) ?? '#ffd98a',
    stroke: { color: CLASSIC_STROKE, thickness: 2 },
    maxFontSize: TOKEN_MAX_BODY_FONT,
    minFontSize: CLASSIC_MIN_BODY_FONT,
    lineHeightRatio: 1.15,
    rowGap: 2,
    labelWidth: 0,
    markerWidth: 0,
    center: false,
    alignColons: true,
    useLabelDisplay: false,
  });
}

export function makeClassicCardBody(
  scene: Phaser.Scene,
  rulesRows: readonly FantasyCardRulesRow[],
  box: RegionBox,
  scale: number,
  name: string,
): Phaser.GameObjects.Container {
  return makeRulesBody(scene, rulesRows, box, name, {
    ink: CLASSIC_INK,
    asideInk: CLASSIC_ASIDE_INK,
    keywordColor: keyword => keywordTextColor(keyword) ?? '#ffd98a',
    stroke: { color: CLASSIC_STROKE, thickness: Math.max(1, Math.round(1.5 * scale)) },
    maxFontSize: CLASSIC_MAX_BODY_FONT * scale,
    readingFontSize: CLASSIC_READING_BODY_FONT * scale,
    minFontSize: CLASSIC_MIN_BODY_FONT,
    lineHeightRatio: 1.2,
    rowGap: Math.max(1, 3 * scale),
    labelWidth: 0,
    markerWidth: 0,
    center: true,
    alignColons: true,
    useLabelDisplay: false,
  });
}
