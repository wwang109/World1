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

/** Fits one colored body row as a single stream, retaining the role at the cut. */
export function fitBattleLogSegments(
  segments: readonly BattleLogTextSegment[],
  maxWidth: number,
  measure: (text: string) => number,
): BattleLogTextSegment[] {
  const clean = segments.filter((segment) => segment.text.length > 0).map((segment) => ({ ...segment }));
  if (widthOf(clean, measure) <= maxWidth) return clean;

  const ellipsis = '…';
  for (let cut = clean.reduce((n, segment) => n + segment.text.length, 0) - 1; cut >= 0; cut--) {
    let remaining = cut;
    const candidate: BattleLogTextSegment[] = [];
    for (const segment of clean) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, segment.text.length);
      candidate.push({ text: segment.text.slice(0, take), role: segment.role });
      remaining -= take;
    }
    if (candidate.length === 0) continue;
    candidate[candidate.length - 1]!.text += ellipsis;
    if (widthOf(candidate, measure) <= maxWidth) return candidate;
  }
  return measure(ellipsis) <= maxWidth ? [{ text: ellipsis, role: 'neutral' }] : [];
}

/** Draws adjacent Phaser Text objects while sharing one width and ellipsis budget. */
export function renderBattleLogLine(
  scene: Phaser.Scene,
  x: number,
  y: number,
  line: { text: string; segments?: readonly BattleLogTextSegment[] },
  style: Phaser.Types.GameObjects.Text.TextStyle,
  maxWidth: number,
): Phaser.GameObjects.Text[] {
  const source = line.segments ?? [{ text: line.text, role: 'neutral' as const }];
  const probe = scene.add.text(-10_000, -10_000, '', style).setVisible(false);
  const fitted = fitBattleLogSegments(source, maxWidth, (text) => {
    probe.setText(text);
    return probe.width;
  });
  probe.destroy();

  const objects: Phaser.GameObjects.Text[] = [];
  let cursor = x;
  for (const segment of fitted) {
    const color = segment.role === 'neutral' ? style.color : BATTLE_LOG_COLOR[segment.role];
    const text = scene.add.text(cursor, y, segment.text, { ...style, color });
    objects.push(text);
    cursor += text.width;
  }
  return objects;
}
