import type { BuffableStat, CombatOutcome, EffectSourceRef, Property, Side } from '../types';
import type { AuraSource } from './auras';

export type { AuraSource } from './auras';


export type StatusName = 'poison' | 'burn' | 'bleed' | 'stun' | 'buff' | 'debuff' | 'guard' | 'negate' | 'expose';

/** Exact integer stages used to produce one direct skill hit. */
export interface DamageCalculation {
  scalingStat: 'attack' | 'magicPower';
  baseStat: number;
  effectiveStat: number;
  /** The card's FLAT base power (added to the scaling stat; no longer a %). */
  power: number;
  baseDamage: number;
  statBonusDamage: number;
  /** FLAT aura + combo + board-identity bonus damage added (no longer a percentage). */
  effectBonusDamage: number;
  /**
   * Informational subset of effectBonusDamage contributed by the board type
   * identity's same-type +20% (docs/board-type-identity.md). Present only when
   * non-zero; the math strip still sums using effectBonusDamage alone.
   */
  identityBonusDamage?: number;
  /** Actual damage removed by Armor/Magic Resist after the minimum-1 clamp. */
  defense: number;
  /** Damage restored by the engine's minimum-1 clamps. */
  minimumDamageBonus: number;
  critBonusDamage: number;
  /** Signed elemental/weapon matchup contribution. */
  matchupBonusDamage: number;
  suddenDeathBonusDamage: number;
  guardReduction: number;
  /**
   * Extra damage added by an `expose` debuff on the victim (the mirror of
   * guardReduction). Present only when a matching expose amplified the hit;
   * the math strip adds it back so the parts still sum to hpDamage.
   */
  exposeBonus?: number;
  shieldBlocked: number;
  hpDamage: number;
}

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
/** A combatant's comparison numbers tagged with its `(side, unit)` identity. */
export interface ComparisonEntry extends ComparisonSide {
  side: Side;
  unit: number;
}

interface TargetFields {
  targetUnit?: number;
  targetPolicy?: 'aggro' | 'first' | 'lowestHp' | 'highestThreat' | 'focus';
  targetValue?: number;
  aoe?: boolean;
  targets?: number[];
}

export type CombatEvent =
  | {
      turn: number;
      kind: 'gain';
      side: Side;
      unit: number;
      /** Unmodified combat stat, before temporary buffs and debuffs. */
      baseSpeed: number;
      /** Signed temporary contribution included in `speed`. */
      speedModifier: number;
      /** Effective Speed actually added to readiness. */
      speed: number;
      readinessBefore: number;
      readinessAfter: number;
    }
  | ({
      turn: number;
      kind: 'play';
      side: Side;
      unit: number;
      slot: number;
      skillId: string;
      weight: number;
      size: number;
      slotIndex: number;
      slotCount: number;
      /** First direct skill hit, for the compact one-line log summary. */
      damage?: number;
      hpAfter?: number;
      auras?: AuraSource[];
    } & TargetFields)
  | {
      turn: number;
      kind: 'cost';
      side: Side;
      unit: number;
      readinessBefore: number;
      readinessAfter: number;
      paid: number;
    }
  | {
      turn: number;
      kind: 'cursor';
      side: Side;
      unit: number;
      slot: number;
      skillId?: string;
      slotIndex?: number;
      slotCount?: number;
      wrapped: boolean;
    }
  | {
      turn: number;
      kind: 'busy';
      side: Side;
      unit: number;
      slot: number;
      skillId: string;
      slotIndex: number;
      slotCount: number;
    }
  | {
      turn: number;
      kind: 'wait';
      side: Side;
      unit: number;
      reason: 'cantAfford';
      readiness: number;
      weight: number;
      slot: number;
      skillId: string;
    }
  | {
      turn: number;
      kind: 'wait';
      side: Side;
      unit: number;
      reason: 'cooling';
      turnsLeft: number;
      slot: number;
      skillId: string;
    }
  | { turn: number; kind: 'wait'; side: Side; unit: number; reason: 'noCards' | 'stunned' }
  | { turn: number; kind: 'end' }
  | {
      turn: number;
      kind: 'comparison';
      /**
       * @deprecated Legacy 1v1 fields, populated from each side's index-0 unit.
       * Kept so the pre-team UI keeps compiling until the Wave-4 migration;
       * team-aware consumers should read `entries` / `performerUnit` instead.
       */
      player: ComparisonSide;
      /** @deprecated see `player`. */
      enemy: ComparisonSide;
      /** @deprecated performing side; use `performer` + `performerUnit` together. */
      performer: Side | null;
      /**
       * Every living combatant's numbers this turn, in canonical order (player
       * side first, then by unit index). The team-combat source of truth.
       */
      entries: ComparisonEntry[];
      /** Performing unit's index within its `performer` side; null when nobody acts. */
      performerUnit: number | null;
    }
  | { turn: number; kind: 'performStart'; side: Side; unit: number; performs: number }
  | { turn: number; kind: 'performSkipped'; side: Side; unit: number; reason: 'stunned' }
  | { turn: number; kind: 'noPerformer' }
  | {
      turn: number;
      kind: 'skillCast';
      side: Side;
      unit: number;
      slot: number;
      skillId: string;
      span: number;
      /**
       * Performer's cast cursor BEFORE this cast advanced it (the board slot the
       * rotation scan started from). Additive, deterministic.
       */
      cursorBefore: number;
      /**
       * Performer's cast cursor AFTER this cast: `(slot + span) % boardSize`, the
       * slot the next rotation scan starts from. Additive, deterministic.
       */
      cursorAfter: number;
      // ---- Targeting decision (additive; recorded at cast start, no RNG) ----
      /** Chosen opposing unit index for a single-target offensive cast. */
      targetUnit?: number;
      /**
       * What decided the single target: the caster's policy, or `focus` when an
       * explicit override won. Omitted for support/self casts and AoE.
       */
      targetPolicy?: 'aggro' | 'first' | 'lowestHp' | 'highestThreat' | 'focus';
      /**
       * The deciding metric: target `aggro` (aggro), current `hp` (lowestHp), or
       * board PL in deci-PL (highestThreat). Omitted for `first` / `focus`.
       */
      targetValue?: number;
      /** True when this is an AoE cast (`scope: 'all'`); see `targets`. */
      aoe?: boolean;
      /** All struck opposing unit indices for an AoE cast, ascending. */
      targets?: number[];
      /**
       * Board-aura contributors that reached and matched this cast, each with
       * the per-mod magnitudes it added (ascending board-slot order). Additive
       * and deterministic; PRESENT ONLY when at least one board aura contributed
       * (omitted entirely otherwise, so un-aura'd casts stay byte-identical).
       * Card-scope stat gems are excluded (a separate, already-visible feature).
       */
      auras?: AuraSource[];
    }
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
      /** Extra damage added by an `expose` debuff (present only when it fired). */
      exposed?: number;
      hpAfter: number;
      source: 'skill' | 'poison' | 'burn' | 'bleed' | 'fatigue';
      /** The board card that produced this hit (cast card, or the card that applied the DoT). */
      sourceCard?: EffectSourceRef;
      /** Present for direct skill hits; DoT/fatigue damage has no cast formula. */
      calculation?: DamageCalculation;
    }
  | { turn: number; kind: 'heal'; side: Side; unit: number; amount: number; overheal: number; flat: boolean; hpAfter: number; sourceCard?: EffectSourceRef }
  | { turn: number; kind: 'shieldGain'; side: Side; unit: number; property: Property; amount: number; wasted: number; totalAfter: number; sourceCard?: EffectSourceRef }
  | { turn: number; kind: 'statusApplied'; side: Side; unit: number; status: StatusName; property?: Property; stat?: BuffableStat; pct?: number; amount?: number; stacks?: number; turns: number; charges?: number }
  | { turn: number; kind: 'statusExpired'; side: Side; unit: number; status: StatusName }
  | { turn: number; kind: 'cleansed'; side: Side; unit: number; removed: number }
  /** A unit's threat changed (e.g. taunt); `aggro` is the new total. */
  | { turn: number; kind: 'aggroChanged'; side: Side; unit: number; aggro: number }
  | { turn: number; kind: 'slowed'; side: Side; unit: number; weight: number }
  | {
      turn: number;
      kind: 'disrupted';
      side: Side;
      unit: number;
      amount: number;
      readinessAfter: number;
      /** @deprecated compatibility alias for the pre-readiness UI. */
      bankAfter: number;
    }
  | { turn: number; kind: 'shieldBroken'; side: Side; unit: number; amount: number; totalAfter: number }
  /** A Magical Negate charge nullified a direct skill hit on `side`. */
  | { turn: number; kind: 'negated'; side: Side; unit: number; property: Property }
  | { turn: number; kind: 'suddenDeathStart' }
  | { turn: number; kind: 'fatigueStart' }
  | { turn: number; kind: 'died'; side: Side; unit: number }
  | { turn: number; kind: 'combatEnd'; result: CombatOutcome; turns: number };
