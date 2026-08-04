// Balance analysis — REAL simulated combat metrics (no estimates/formulas).
//
// `damagePerTurn` measures a combatant's sustained offensive throughput by
// actually running `simulate()` against an inert training dummy for N turns and
// summing the damage it dealt, then averaging per turn. Combat is now fully
// deterministic (crit was removed 2026-07-23), so the low–high band collapses
// to a single value; the multi-seed sweep is kept as a harmless no-op guard in
// case a future stochastic effect reintroduces variance.
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
    },
    boardSize: 1,
    pieces: [],
  };
}

export interface DamageBand {
  /** Mean damage per turn across the seed runs (integer). */
  avg: number;
  /** Lowest per-turn damage seen across seeds (== avg while combat is deterministic). */
  min: number;
  /** Highest per-turn damage seen across seeds (== avg while combat is deterministic). */
  max: number;
  /** Turns simulated per run. */
  turns: number;
}

export interface DamageProfileOpts {
  /** Turns to simulate per run (default 10 — the "after 5–10 turns" window). */
  turns?: number;
  /** Distinct seeds to average over (default 16); vestigial now that combat is deterministic. */
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
        attritionTurn: 1_000_000,
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

// Per-card contribution report moved to `logAnalysis.ts` — it is a pure fold
// over an event log and must stay importable WITHOUT pulling in simulate().
export { cardContributions, type CardContribution } from './logAnalysis';
// Per-fight stats-ledger delta — same "pure fold, no simulate()" reasoning.
export { battleStatsFromEvents, type BattleStatsDelta } from './logAnalysis';
