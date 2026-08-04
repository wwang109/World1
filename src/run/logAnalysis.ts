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

/** One fight's player-perspective totals — the run stats ledger's input
 * (see `RunStats` in `runState.ts`), folded straight off the resolved log's
 * events. `damageDealt`/`damageTaken` sum EVERY `damage` event's `amount`
 * (direct hits + DoT ticks + attrition/fatigue) by victim side; `healingDone`
 * sums only the effective (post-overheal) `amount` of `heal` events landing
 * on the player side — overheal is waste, not output restored. */
export interface BattleStatsDelta {
  damageDealt: number;
  damageTaken: number;
  healingDone: number;
}

/**
 * Fold a resolved fight's event log into the player-perspective stats delta
 * `recordBattleResult` (`runState.ts`) folds into the run's `stats` ledger.
 * Pure — no re-simulation, no side effects. Team-combat ready: every `enemy`-
 * side damage event counts toward `damageDealt` regardless of which enemy
 * unit it landed on, and every `player`-side damage/heal event counts toward
 * `damageTaken`/`healingDone` regardless of which player unit (today always
 * unit 0 — 1v1).
 */
export function battleStatsFromEvents(events: readonly CombatEvent[]): BattleStatsDelta {
  let damageDealt = 0;
  let damageTaken = 0;
  let healingDone = 0;
  for (const e of events) {
    if (e.kind === 'damage') {
      if (e.side === 'enemy') damageDealt += e.amount;
      else damageTaken += e.amount;
    } else if (e.kind === 'heal' && e.side === 'player') {
      healingDone += e.amount;
    }
  }
  return { damageDealt, damageTaken, healingDone };
}
