import type { CombatEvent } from '../combat/events';
import type { PassiveSourceRef } from '../passives/types';
import type { Action, EffectSourceRef, Element, Side, WeaponType } from '../types';
import { KEYWORD_TEXT, typeName } from './text';

export type KeywordKind = Action['kind'];

export type KeywordFamilyId =
  | 'hit'
  | 'hitBonus'
  | 'overTime'
  | 'status'
  | 'charges'
  | 'cardEffect'
  | 'tempo'
  | 'sustain';

export type KeywordMoment = 'applied' | 'armed' | 'added' | 'spent' | 'triggered' | 'expired';

export type KeywordReach = 'foe' | 'self' | 'ally';

export type KeywordLater = 'eachTurn' | 'whenActing' | 'whenTargeted';

export type KeywordGate =
  | 'foeHalfHp'
  | 'selfHalfHp'
  | 'foeFullHp'
  | 'foeAlone'
  | 'fightTurn'
  | 'ownCastCount'
  | 'foeHasStatus'
  | 'foeUnshielded'
  | 'stackCount'
  | 'lastCastArchetype'
  | 'lastCastType'
  | 'damageDealt'
  | 'ownShield'
  | 'ownWard'
  | 'healOverflow'
  | 'cleansedStacks';

export interface UnitRef {
  readonly side: Side;
  readonly unit: number;
}

export type KeywordTarget =
  | (UnitRef & { readonly kind: 'unit' })
  | (UnitRef & { readonly kind: 'cards'; readonly slots: readonly number[]; readonly anchorSlot: number })
  | (UnitRef & { readonly kind: 'hit' })
  | (UnitRef & { readonly kind: 'heal' })
  | (UnitRef & { readonly kind: 'nextCast'; readonly type: Element | WeaponType });

export type KeywordTargetKind = KeywordTarget['kind'];

export type KeywordCause =
  | ({ readonly from: 'card' } & EffectSourceRef)
  | ({ readonly from: 'passive'; readonly passive: PassiveSourceRef } & UnitRef);

export interface KeywordValue {
  readonly amount: number;
  readonly detail?: string;
  readonly turns?: number;
}

export interface KeywordLogLine {
  readonly turn: number;
  readonly keyword: KeywordKind;
  readonly family: KeywordFamilyId;
  readonly moment: KeywordMoment;
  readonly cause: KeywordCause;
  readonly target: KeywordTarget;
  readonly value?: KeywordValue;
  readonly text: string;
}

export interface KeywordSpec {
  readonly reach: KeywordReach;
  readonly later?: KeywordLater;
  readonly gate?: KeywordGate;
  readonly unit?: string;
  readonly events: readonly CombatEvent['kind'][];
}

export type MomentTargets = Readonly<Partial<Record<KeywordMoment, KeywordTargetKind>>>;

const UNTITLED: Partial<Record<KeywordKind, string>> = { damage: 'Damage', heal: 'Heal' };

export abstract class Keyword<K extends KeywordKind = KeywordKind> {
  abstract readonly family: KeywordFamilyId;
  abstract readonly moments: MomentTargets;
  protected readonly signed: boolean = false;

  constructor(
    readonly kind: K,
    readonly spec: KeywordSpec,
  ) {}

  get title(): string {
    return KEYWORD_TEXT[this.kind].ruleTitle || (UNTITLED[this.kind] ?? this.kind);
  }

  targetOf(moment: KeywordMoment): KeywordTargetKind | undefined {
    return this.moments[moment];
  }

  line(turn: number, moment: KeywordMoment, cause: KeywordCause, target: KeywordTarget, value?: KeywordValue): KeywordLogLine {
    const expected = this.moments[moment];
    if (expected !== target.kind) {
      throw new Error(`${this.kind} ${moment} targets ${expected ?? 'nothing'}, got ${target.kind}`);
    }
    return {
      turn,
      keyword: this.kind,
      family: this.family,
      moment,
      cause,
      target,
      ...(value !== undefined ? { value } : {}),
      text: this.text(moment, target, value),
    };
  }

  protected text(moment: KeywordMoment, target: KeywordTarget, value: KeywordValue | undefined): string {
    if (moment === 'expired') return `${this.title} wears off`;
    const words = [this.title];
    if (value !== undefined) words.push(this.amountText(moment, value.amount));
    if (value?.detail !== undefined) words.push(value.detail);
    if (target.kind === 'nextCast') words.push(`on next ${typeName(target.type)} card`);
    if (value?.turns !== undefined) words.push(`(${value.turns} ${value.turns === 1 ? 'turn' : 'turns'})`);
    return words.join(' ');
  }

  protected amountText(moment: KeywordMoment, amount: number): string {
    const number = this.signed || moment === 'added' ? signedNumber(amount) : `${amount}`;
    const unit = this.spec.unit;
    if (unit === undefined || moment === 'added') return number;
    if (unit === '%') return `${number}%`;
    return `${number} ${Math.abs(amount) === 1 && unit.endsWith('s') ? unit.slice(0, -1) : unit}`;
  }
}

function signedNumber(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
