import type { CombatOutcome, Side } from '../types';

export type StatusName = 'poison' | 'burn' | 'stun' | 'buff' | 'debuff';

/** All events carry `time`: the timeline position of the acting turn. */
export type CombatEvent =
  | { time: number; kind: 'turnStart'; side: Side; turn: number }
  | { time: number; kind: 'turnSkipped'; side: Side; reason: 'stunned' | 'noUsableSkill' }
  | { time: number; kind: 'skillCast'; side: Side; slot: number; skillId: string }
  | {
      time: number;
      kind: 'damage';
      side: Side; // the victim
      amount: number;
      blocked: number;
      crit: boolean;
      hpAfter: number;
      source: 'skill' | 'fatigue';
    }
  | { time: number; kind: 'heal'; side: Side; amount: number; hpAfter: number }
  | { time: number; kind: 'shieldGain'; side: Side; amount: number; shieldAfter: number }
  | { time: number; kind: 'statusApplied'; side: Side; status: StatusName; turns: number }
  | { time: number; kind: 'statusTick'; side: Side; status: 'poison' | 'burn'; amount: number; hpAfter: number }
  | { time: number; kind: 'statusExpired'; side: Side; status: StatusName }
  | { time: number; kind: 'cleansed'; side: Side; removed: number }
  | { time: number; kind: 'suddenDeathStart' }
  | { time: number; kind: 'fatigueStart' }
  | { time: number; kind: 'died'; side: Side }
  | { time: number; kind: 'combatEnd'; result: CombatOutcome };
