import type { CombatOutcome, Property, Side } from '../types';


export type StatusName = 'poison' | 'burn' | 'stun' | 'buff' | 'debuff' | 'guard' | 'negate';

/** One side's numbers in a turn's initiative comparison. */
export interface ComparisonSide {
  /** null when the side cannot compete this turn (busy / nothing usable). */
  queuedSkillId: string | null;
  queuedSlot: number | null;
  bank: number;
  speed: number;
  weight: number | null;
  /** bank + speed − weight; null when not competing. */
  score: number | null;
  state: 'ready' | 'busy' | 'nothingUsable';
}

/**
 * All events carry `turn`: the global turn index (1-based). Every event that
 * carries a `side` also carries `unit`: the 0-based index of the acting/target
 * combatant within its side (always 0 at 1v1; the team-combat migration lets it
 * range across a side's units). The `comparison` event keeps its 1v1 shape.
 */
export type CombatEvent =
  | { turn: number; kind: 'comparison'; player: ComparisonSide; enemy: ComparisonSide; performer: Side | null }
  | { turn: number; kind: 'performStart'; side: Side; unit: number; performs: number }
  | { turn: number; kind: 'performSkipped'; side: Side; unit: number; reason: 'stunned' }
  | { turn: number; kind: 'noPerformer' }
  | { turn: number; kind: 'skillCast'; side: Side; unit: number; slot: number; skillId: string; span: number }
  | {
      turn: number;
      kind: 'damage';
      side: Side; // the victim
      unit: number;
      amount: number;
      property: Property;
      blocked: number;
      crit: boolean;
      /** Element wheel / weapon triangle result for this hit. */
      matchup?: 'advantage' | 'disadvantage';
      /** Amount removed by Magical Guard (present only when a guard fired). */
      guarded?: number;
      hpAfter: number;
      source: 'skill' | 'poison' | 'burn' | 'fatigue';
    }
  | { turn: number; kind: 'heal'; side: Side; unit: number; amount: number; flat: boolean; hpAfter: number }
  | { turn: number; kind: 'shieldGain'; side: Side; unit: number; property: Property; amount: number; wasted: number; totalAfter: number }
  | { turn: number; kind: 'statusApplied'; side: Side; unit: number; status: StatusName; property?: Property; turns: number; charges?: number }
  | { turn: number; kind: 'statusExpired'; side: Side; unit: number; status: StatusName }
  | { turn: number; kind: 'cleansed'; side: Side; unit: number; removed: number }
  | { turn: number; kind: 'slowedNext'; side: Side; unit: number; weight: number }
  | { turn: number; kind: 'staggered'; side: Side; unit: number; amount: number; bankAfter: number }
  | { turn: number; kind: 'shieldBroken'; side: Side; unit: number; amount: number; totalAfter: number }
  /** A Magical Negate charge nullified a direct skill hit on `side`. */
  | { turn: number; kind: 'negated'; side: Side; unit: number; property: Property }
  | { turn: number; kind: 'suddenDeathStart' }
  | { turn: number; kind: 'fatigueStart' }
  | { turn: number; kind: 'died'; side: Side; unit: number }
  | { turn: number; kind: 'combatEnd'; result: CombatOutcome; turns: number };
