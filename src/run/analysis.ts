// Balance analysis — REAL simulated combat metrics (no estimates/formulas).
//
// `damagePerTurn` measures a combatant's sustained offensive throughput by
// actually running `simulate()` against an inert training dummy for N turns and
// summing the damage it dealt, then averaging per turn. Crit is the only source
// of variance, so we run several seeds and report the observed low–high band
// plus the average — an honest range, not a fake number.
//
// Why a dummy (not the live opponent): this is an INTRINSIC throughput stat for
// comparing builds/enemies on equal footing (armor, matchups, and the
// opponent's shields/heals are separate axes). The dummy has no board, so it
// never performs — which also means sudden-death (needs BOTH sides to perform)
// never triggers, keeping the number a steady-state output rather than a
// ramp-inflated one. Cooldowns stay ON to match real play.
//
// Pure, deterministic (fixed seed set), no RNG of its own, no Phaser.

import { simulate } from '../engine/combat/simulate';
import type { CombatEvent } from '../engine/combat/events';
import type { CombatantSetup, Side, SkillBook } from '../engine/types';

/** An inert, effectively-immortal target: no board (never attacks), no defenses. */
function trainingDummy(): CombatantSetup {
  return {
    name: 'Training Dummy',
    stats: {
      maxHp: 10_000_000,
      hp: 10_000_000,
      attack: 0,
      magicPower: 0,
      armor: 0,
      magicResist: 0,
      speed: 0,
      critPct: 0,
    },
    boardSize: 1,
    pieces: [],
  };
}

export interface DamageBand {
  /** Mean damage per turn across the seed runs (integer). */
  avg: number;
  /** Lowest per-turn damage seen (all-unlucky-crit end of the band). */
  min: number;
  /** Highest per-turn damage seen (all-lucky-crit end of the band). */
  max: number;
  /** Turns simulated per run. */
  turns: number;
}

export interface DamageProfileOpts {
  /** Turns to simulate per run (default 10 — the "after 5–10 turns" window). */
  turns?: number;
  /** Distinct seeds to average over, smoothing crit variance (default 16). */
  seeds?: number;
}

/**
 * Average (and low–high) damage this combatant DEALS per turn, measured by
 * simulating it against an inert dummy over `turns` turns across `seeds` seeds.
 * Counts every point it removes — direct hits AND poison/burn ticks.
 */
export function damagePerTurn(setup: CombatantSetup, skillBook: SkillBook, opts: DamageProfileOpts = {}): DamageBand {
  const turns = Math.max(1, opts.turns ?? 10);
  const seeds = Math.max(1, opts.seeds ?? 16);

  let total = 0;
  let min = Infinity;
  let max = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const { events } = simulate(
      {
        playerTeam: [setup],
        enemyTeam: [trainingDummy()],
        skillBook,
        // Endgame off so the number is steady-state, not ramp-inflated.
        suddenDeathRound: 1_000_000,
        fatigueTurn: 1_000_000,
        maxTurns: turns,
        cooldownsEnabled: true,
      },
      seed,
    );

    // The dummy is the enemy side; every damage event landing on it is output
    // this combatant produced (direct hits + DoT ticks; no shields to absorb).
    let dealt = 0;
    for (const e of events) {
      if (e.kind === 'damage' && e.side === 'enemy') dealt += e.amount;
    }
    total += dealt;
    const perTurn = dealt / turns;
    if (perTurn < min) min = perTurn;
    if (perTurn > max) max = perTurn;
  }

  return {
    avg: Math.round(total / (seeds * turns)),
    min: Math.round(min === Infinity ? 0 : min),
    max: Math.round(max),
    turns,
  };
}

// ---------------------------------------------------------------------------
// Per-card contribution report — what each board card actually did in a fight.
// Reads the resolved event log (no re-simulation) and attributes every
// damage / heal / shield / DoT-tick to its source card. Used by the battle
// result screen and for balance diagnosis (e.g. "is this 2-slot card pulling
// its weight?").
// ---------------------------------------------------------------------------

export interface CardContribution {
  side: Side;
  unit: number;
  slot: number;
  skillId: string;
  /** Direct skill-hit damage dealt (gross output, pre-shield). */
  damage: number;
  /** Poison/burn damage dealt over time. */
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
      bump(e.sourceCard, e.source === 'poison' || e.source === 'burn' ? 'dotDamage' : 'damage', e.amount);
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
