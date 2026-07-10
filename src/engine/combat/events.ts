import type { CombatOutcome, Property, Side } from '../types';


export type StatusName = 'poison' | 'burn' | 'stun' | 'buff' | 'debuff' | 'thorns' | 'regen';

/** One contender's numbers in a turn's initiative comparison. */
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

/** A specific combatant's comparison line (multi-combatant sides). */
export interface ComparisonUnit extends ComparisonSide {
  side: Side;
  unit: number;
  name: string;
  alive: boolean;
}

/**
 * All events carry `turn` (1-based global turn). Events about a specific
 * combatant carry `side` + `unit` (index in that side's formation; always 0
 * in 1v1).
 */
export type CombatEvent =
  | {
      turn: number;
      kind: 'comparison';
      /** Best contender per side (the exact 1v1 shape, kept for UI/tests). */
      player: ComparisonSide;
      enemy: ComparisonSide;
      /** Every combatant's line, formation order, player side first. */
      contenders: ComparisonUnit[];
      performer: Side | null;
      /** Unit index of the performer within its side (null = nobody). */
      performerUnit: number | null;
    }
  | { turn: number; kind: 'performStart'; side: Side; unit: number; performs: number }
  | { turn: number; kind: 'performSkipped'; side: Side; unit: number; reason: 'stunned' }
  | { turn: number; kind: 'noPerformer' }
  | { turn: number; kind: 'skillCast'; side: Side; unit: number; slot: number; skillId: string; span: number; enchant?: string; chased?: boolean }
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
      hpAfter: number;
      source: 'skill' | 'poison' | 'burn' | 'fatigue' | 'thorns';
    }
  | { turn: number; kind: 'heal'; side: Side; unit: number; amount: number; flat: boolean; hpAfter: number }
  | { turn: number; kind: 'shieldGain'; side: Side; unit: number; property: Property; amount: number; wasted: number; totalAfter: number }
  | { turn: number; kind: 'statusApplied'; side: Side; unit: number; status: StatusName; property?: Property; turns: number }
  | { turn: number; kind: 'statusExpired'; side: Side; unit: number; status: StatusName }
  /** A hostile effect was shrugged off entirely by the target's Resolve. */
  | { turn: number; kind: 'resisted'; side: Side; unit: number; status: StatusName | 'slow' | 'stagger' | 'weaken' }
  | { turn: number; kind: 'weakenedNext'; side: Side; unit: number; pct: number }
  | { turn: number; kind: 'cleansed'; side: Side; unit: number; removed: number }
  | { turn: number; kind: 'purged'; side: Side; unit: number; removed: number }
  | { turn: number; kind: 'slowedNext'; side: Side; unit: number; weight: number }
  | { turn: number; kind: 'quickenedNext'; side: Side; unit: number; weight: number }
  | { turn: number; kind: 'staggered'; side: Side; unit: number; amount: number; bankAfter: number }
  | { turn: number; kind: 'shieldBroken'; side: Side; unit: number; amount: number; totalAfter: number }
  | { turn: number; kind: 'suddenDeathStart' }
  | { turn: number; kind: 'fatigueStart' }
  | { turn: number; kind: 'died'; side: Side; unit: number }
  | { turn: number; kind: 'combatEnd'; result: CombatOutcome; turns: number };
