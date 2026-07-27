// Per-card contribution report — what each board card actually did in a fight.
//
// Reads a resolved event log and attributes every damage / heal / shield /
// DoT-tick to its source card. NO re-simulation: this is a pure fold over the
// log, which is why it lives here and not in `analysis.ts`. That separation
// matters — `analysis.ts` imports `simulate()`, so anything importing it drags
// the combat engine along; the client is allowed to read a log, never to
// produce one.

import type { CombatEvent } from '../engine/combat/events';
import type { Side } from '../engine/types';

export interface CardContribution {
  side: Side;
  unit: number;
  slot: number;
  skillId: string;
  /** Direct skill-hit damage dealt (gross output, pre-shield). */
  damage: number;
  /** Poison/burn/bleed damage dealt over time. */
  dotDamage: number;
  /** HP restored to allies. */
  healing: number;
  /** Shield (defense) granted, excluding overflow waste. */
  shield: number;
}

function contribKey(c: { side: Side; unit: number; slot: number; skillId: string }): string {
  return `${c.side}:${c.unit}:${c.slot}:${c.skillId}`;
}

/**
 * Aggregate each source card's totals from a resolved event log. Only cards
 * that produced at least one attributed effect appear; the result is sorted by
 * side then slot for stable display.
 */
export function cardContributions(events: readonly CombatEvent[]): CardContribution[] {
  const byCard = new Map<string, CardContribution>();
  const bump = (
    ref: { side: Side; unit: number; slot: number; skillId: string },
    field: 'damage' | 'dotDamage' | 'healing' | 'shield',
    value: number,
  ): void => {
    if (value <= 0) return;
    const key = contribKey(ref);
    let entry = byCard.get(key);
    if (!entry) {
      entry = { side: ref.side, unit: ref.unit, slot: ref.slot, skillId: ref.skillId, damage: 0, dotDamage: 0, healing: 0, shield: 0 };
      byCard.set(key, entry);
    }
    entry[field] += value;
  };

  for (const e of events) {
    if (e.kind === 'damage' && e.sourceCard) {
      bump(e.sourceCard, e.source === 'poison' || e.source === 'burn' || e.source === 'bleed' ? 'dotDamage' : 'damage', e.amount);
    } else if (e.kind === 'heal' && e.sourceCard) {
      // Gross healing the card produced (effective + overheal), so a heal card
      // always shows its output even when it topped a near-full ally.
      bump(e.sourceCard, 'healing', e.amount + e.overheal);
    } else if (e.kind === 'shieldGain' && e.sourceCard) {
      bump(e.sourceCard, 'shield', e.amount);
    }
  }

  return [...byCard.values()].sort((a, b) =>
    a.side === b.side ? a.slot - b.slot : a.side === 'player' ? -1 : 1,
  );
}
