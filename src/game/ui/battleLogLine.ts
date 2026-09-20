import type Phaser from 'phaser';
import { INK } from '../theme';
import { AILMENT_COLOR } from './battleStatusPalette';

export type BattleLogTextRole =
  | 'neutral' | 'player' | 'enemy' | 'damage' | 'heal' | 'shield' | 'readiness'
  | 'poison' | 'burn' | 'bleed' | 'thorns';

export interface BattleLogTextSegment {
  text: string;
  role: BattleLogTextRole;
}

export const BATTLE_LOG_COLOR: Record<Exclude<BattleLogTextRole, 'neutral'>, string> = {
  player: INK.capacity,
  enemy: INK.combatEnemy,
  damage: INK.cost,
  heal: INK.gain,
  shield: INK.combatShield,
  readiness: INK.readiness,
  poison: AILMENT_COLOR.poison!,
  burn: AILMENT_COLOR.burn!,
  // The canonical bleed chip ink is too dark for 12px log prose (3.53:1 on
  // the desktop log ground); the log uses the theme's AA-cleared coral twin.
  bleed: INK.alarm,
  thorns: AILMENT_COLOR.thorns!,
};

function widthOf(segments: readonly BattleLogTextSegment[], measure: (text: string) => number): number {
  return segments.reduce((total, segment) => total + measure(segment.text), 0);
}

function cloneSegments(segments: readonly BattleLogTextSegment[]): BattleLogTextSegment[] {
  return segments.map((segment) => ({ ...segment }));
}

interface LogToken { text: string; role: BattleLogTextRole; isSpace: boolean }

function tokenize(segments: readonly BattleLogTextSegment[]): LogToken[] {
  const tokens: LogToken[] = [];
  const splitter = /\S+|\s+/g;
  for (const segment of segments) {
    splitter.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = splitter.exec(segment.text))) {
      const chunk = match[0];
      tokens.push({ text: chunk, role: segment.role, isSpace: /^\s+$/.test(chunk) });
    }
  }
  return tokens;
}

export function wrapBattleLogSegments(
  segments: readonly BattleLogTextSegment[],
  maxWidth: number,
  measure: (text: string) => number,
): BattleLogTextSegment[][] {
  const clean = segments.filter((segment) => segment.text.length > 0);
  if (clean.length === 0) return [[]];
  if (widthOf(clean, measure) <= maxWidth) return [cloneSegments(clean)];

  const pushToken = (line: BattleLogTextSegment[], token: { text: string; role: BattleLogTextRole }): void => {
    const last = line[line.length - 1];
    if (last && last.role === token.role) last.text += token.text;
    else line.push({ text: token.text, role: token.role });
  };

  const lines: BattleLogTextSegment[][] = [];
  let current: BattleLogTextSegment[] = [];

  for (const token of tokenize(clean)) {
    if (token.isSpace) {
      if (current.length === 0) continue;
      if (widthOf(current, measure) + measure(token.text) > maxWidth) {
        lines.push(current);
        current = [];
        continue;
      }
      pushToken(current, token);
      continue;
    }

    let word: { text: string; role: BattleLogTextRole } = token;
    while (measure(word.text) > maxWidth && word.text.length > 1) {
      let take = word.text.length;
      while (take > 1 && measure(word.text.slice(0, take)) > maxWidth) take -= 1;
      if (current.length > 0) { lines.push(current); current = []; }
      lines.push([{ text: word.text.slice(0, take), role: word.role }]);
      word = { text: word.text.slice(take), role: word.role };
    }

    if (current.length > 0 && widthOf(current, measure) + measure(word.text) > maxWidth) {
      lines.push(current);
      current = [];
    }
    pushToken(current, word);
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [[]];
}

export function layoutVisibleBattleLogRows<T>(
  scene: Phaser.Scene,
  feed: readonly T[],
  getLine: (item: T) => { text: string; segments?: readonly BattleLogTextSegment[] },
  getMaxWidth: (item: T) => number,
  style: Phaser.Types.GameObjects.Text.TextStyle,
  rowHeight: number,
  availableHeight: number,
): Array<{ item: T; wrapped: BattleLogTextSegment[][] }> {
  const probe = scene.add.text(-10_000, -10_000, '', style).setVisible(false);
  const measure = (text: string) => { probe.setText(text); return probe.width; };

  const selected: Array<{ item: T; wrapped: BattleLogTextSegment[][] }> = [];
  let used = 0;
  for (let i = feed.length - 1; i >= 0; i -= 1) {
    const item = feed[i]!;
    const line = getLine(item);
    const source = line.segments ?? [{ text: line.text, role: 'neutral' as const }];
    const wrapped = wrapBattleLogSegments(source, getMaxWidth(item), measure);
    const height = wrapped.length * rowHeight;
    if (selected.length > 0 && used + height > availableHeight) break;
    used += height;
    selected.push({ item, wrapped });
    if (used >= availableHeight) break;
  }
  probe.destroy();
  return selected.reverse();
}

export function drawBattleLogLines(
  scene: Phaser.Scene,
  x: number,
  y: number,
  wrapped: readonly BattleLogTextSegment[][],
  style: Phaser.Types.GameObjects.Text.TextStyle,
  lineHeight: number,
): { objects: Phaser.GameObjects.Text[]; height: number } {
  const objects: Phaser.GameObjects.Text[] = [];
  let ly = y;
  for (const segs of wrapped) {
    let cursor = x;
    for (const segment of segs) {
      const color = segment.role === 'neutral' ? style.color : BATTLE_LOG_COLOR[segment.role];
      const text = scene.add.text(cursor, ly, segment.text, { ...style, color });
      objects.push(text);
      cursor += text.width;
    }
    ly += lineHeight;
  }
  return { objects, height: wrapped.length * lineHeight };
}
