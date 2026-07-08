import type { CombatOutcome, Property, Side } from '../types';


export type StatusName = 'poison' | 'burn' | 'stun' | 'buff' | 'debuff';

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

/** All events carry `turn`: the global turn index (1-based). */
export type CombatEvent =
  | { turn: number; kind: 'comparison'; player: ComparisonSide; enemy: ComparisonSide; performer: Side | null }
  | { turn: number; kind: 'performStart'; side: Side; performs: number }
  | { turn: number; kind: 'performSkipped'; side: Side; reason: 'stunned' }
  | { turn: number; kind: 'noPerformer' }
  | { turn: number; kind: 'skillCast'; side: Side; slot: number; skillId: string; span: number }
  | {
      turn: number;
      kind: 'damage';
      side: Side; // the victim
      amount: number;
      property: Property;
      blocked: number;
      crit: boolean;
      /** Element wheel / weapon triangle result for this hit. */
      matchup?: 'advantage' | 'disadvantage';
      hpAfter: number;
      source: 'skill' | 'poison' | 'burn' | 'fatigue';
    }
  | { turn: number; kind: 'heal'; side: Side; amount: number; flat: boolean; hpAfter: number }
  | { turn: number; kind: 'shieldGain'; side: Side; property: Property; amount: number; wasted: number; totalAfter: number }
  | { turn: number; kind: 'statusApplied'; side: Side; status: StatusName; property?: Property; turns: number }
  | { turn: number; kind: 'statusExpired'; side: Side; status: StatusName }
  | { turn: number; kind: 'cleansed'; side: Side; removed: number }
  | { turn: number; kind: 'slowedNext'; side: Side; weight: number }
  | { turn: number; kind: 'staggered'; side: Side; amount: number; bankAfter: number }
  | { turn: number; kind: 'shieldBroken'; side: Side; amount: number; totalAfter: number }
  | { turn: number; kind: 'suddenDeathStart' }
  | { turn: number; kind: 'fatigueStart' }
  | { turn: number; kind: 'died'; side: Side }
  | { turn: number; kind: 'combatEnd'; result: CombatOutcome; turns: number };
