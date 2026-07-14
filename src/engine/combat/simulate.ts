import { Rng } from '../rng';
import type { CombatConfig, CombatantSetup, CombatOutcome, Side } from '../types';
import type { CombatEvent, ComparisonEntry, ComparisonSide } from './events';
import { effStat, initCombatState, teamOf, type CombatState, type CombatantState } from './state';
import { selectCast, type CastChoice } from './castSelect';
import { applyCast, dealDamage, type Ctx } from './interpreter';

export interface CombatResult {
  result: CombatOutcome;
  /** Global turns elapsed. */
  turns: number;
  events: CombatEvent[];
  finalState: CombatState;
}

const DEFAULT_SUDDEN_DEATH_ROUND = 5;
const DEFAULT_FATIGUE_TURN = 40;
const DEFAULT_MAX_TURNS = 200;
/** Sudden-death damage ramp per own performance. */
const SD_PLAYER_AMP = 10;
const SD_ENEMY_AMP = 30;
const FATIGUE_BASE = 5;

/** null while combat continues. A side is dead when every unit is not alive. The player wins simultaneous deaths. */
function checkEnd(state: CombatState): CombatOutcome | null {
  if (state.enemyTeam.every((u) => !u.alive)) return 'win';
  if (state.playerTeam.every((u) => !u.alive)) return 'loss';
  return null;
}

/** Flattened, canonically-ordered performance pool: player-side first, then by index. */
function pool(state: CombatState): CombatantState[] {
  return [...state.playerTeam, ...state.enemyTeam];
}

/**
 * DoTs act on their victim at the start of every global turn (except the turn
 * they were applied). Poison bypasses shields; burn is consumed by shields.
 * Duration decrements with each tick; expires at 0.
 */
function tickDots(ctx: Ctx, c: CombatantState): void {
  const remaining: typeof c.statuses = [];
  for (const status of c.statuses) {
    if ((status.kind !== 'poison' && status.kind !== 'burn') || status.fresh) {
      remaining.push(status);
      continue;
    }
    if (c.alive) {
      dealDamage(ctx, c, status.amount ?? 0, status.property ?? 'true', {
        bypassShields: status.kind === 'poison',
        source: status.kind,
      });
    }
    status.turnsLeft -= 1;
    if (status.turnsLeft > 0) {
      remaining.push(status);
    } else {
      ctx.events.push({ turn: ctx.state.turn, kind: 'statusExpired', side: c.side, unit: c.index, status: status.kind });
    }
  }
  c.statuses = remaining;
}

/** Decrement buff/debuff durations at global turn end; clear freshness. */
function expireStatuses(ctx: Ctx, c: CombatantState): void {
  const remaining: typeof c.statuses = [];
  for (const status of c.statuses) {
    if (status.fresh) {
      delete status.fresh;
      remaining.push(status);
      continue;
    }
    if (status.kind !== 'buff' && status.kind !== 'debuff' && status.kind !== 'guard') {
      // poison/burn decrement in tickDots; stun decrements when consumed;
      // negate persists until its charges are spent.
      remaining.push(status);
      continue;
    }
    status.turnsLeft -= 1;
    if (status.turnsLeft > 0) {
      remaining.push(status);
    } else {
      ctx.events.push({ turn: ctx.state.turn, kind: 'statusExpired', side: c.side, unit: c.index, status: status.kind });
    }
  }
  c.statuses = remaining;
}

function comparisonSide(c: CombatantState, choice: CastChoice | null): ComparisonSide {
  if (c.busyTurns > 0) {
    return { queuedSkillId: null, queuedSlot: null, bank: c.bank, speed: effStat(c, 'speed'), weight: null, score: null, state: 'busy' };
  }
  if (choice === null) {
    return { queuedSkillId: null, queuedSlot: null, bank: c.bank, speed: effStat(c, 'speed'), weight: null, score: null, state: 'nothingUsable' };
  }
  const speed = effStat(c, 'speed');
  return {
    queuedSkillId: choice.skill.id,
    queuedSlot: choice.piece.slot,
    bank: c.bank,
    speed,
    weight: choice.weight,
    score: c.bank + speed - choice.weight,
    state: 'ready',
  };
}

/**
 * Run a full deterministic 1v1 combat.
 *
 * Each global turn: DoTs tick → both sides queue their next card (strict
 * left→right rotation) → initiative comparison (bank + Speed − weight; higher
 * performs, tie → player) → the performer casts (or a stun consumes the
 * performance); everyone else banks their Speed. A cast of size N keeps its
 * caster busy for N−1 further turns. With `cooldownsEnabled` (default on), a
 * card that recently performed is skipped by the rotation until its reuse
 * cooldown elapses (weight still orders whatever IS eligible); a combatant with
 * nothing eligible wastes the turn and does NOT bank Speed. Sudden death after both sides have
 * performed 5 times ramps damage (+10%/turn player, +30%/turn enemy); a flat
 * fatigue backstop from global turn `fatigueTurn` guarantees termination.
 */
export function simulate(cfg: CombatConfig, seed: number): CombatResult {
  const state = initCombatState(cfg);
  const rng = new Rng(seed);
  const events: CombatEvent[] = [];
  const ctx: Ctx = { state, rng, events };
  const suddenDeathRound = cfg.suddenDeathRound ?? DEFAULT_SUDDEN_DEATH_ROUND;
  const fatigueTurn = cfg.fatigueTurn ?? DEFAULT_FATIGUE_TURN;
  const maxTurns = cfg.maxTurns ?? DEFAULT_MAX_TURNS;
  // Second pacing dial: per-card reuse cooldowns. ON for real play; tests pass
  // false to stay byte-identical to the pre-cooldown engine.
  const cooldownsEnabled = cfg.cooldownsEnabled ?? true;
  let sdAnnounced = false;
  let fatigueAnnounced = false;

  const finish = (result: CombatOutcome): CombatResult => {
    events.push({ turn: state.turn, kind: 'combatEnd', result, turns: state.turn });
    return { result, turns: state.turn, events, finalState: state };
  };

  let outcome = checkEnd(state);
  if (outcome !== null) return finish(outcome);

  while (state.turn < maxTurns) {
    state.turn += 1;

    // Canonical performance pool for this turn: player-side first, then by index.
    const units = pool(state);

    // 1. DoT phase (canonical order for determinism).
    for (const c of units) tickDots(ctx, c);
    outcome = checkEnd(state);
    if (outcome !== null) return finish(outcome);

    // 2. Queue cards and compare initiative across the pool. Performer = highest
    //    ready score; ties break to canonical order (player before enemy, lowest
    //    index) — reproducing the old "player wins ties" rule at 1v1.
    const queued = units.map((c) => {
      // Dead units never queue (in 1v1 death ends the fight, so this is a
      // no-op there); a busy unit is finishing a span and cannot compete.
      const choice =
        c.busyTurns > 0 || !c.alive
          ? null
          : selectCast(c, cfg.skillBook, teamOf(state, c.side).filter((u) => u.alive), {
              currentTurn: state.turn,
              cooldownsEnabled,
            });
      return { unit: c, choice, comp: comparisonSide(c, choice) };
    });

    let performerEntry: (typeof queued)[number] | null = null;
    for (const q of queued) {
      if (q.comp.state !== 'ready') continue;
      if (performerEntry === null || q.comp.score! > performerEntry.comp.score!) {
        performerEntry = q;
      }
    }
    const performer: Side | null = performerEntry ? performerEntry.unit.side : null;
    const performerUnit: number | null = performerEntry ? performerEntry.unit.index : null;

    // Team-shaped source of truth: every living combatant's numbers, canonical
    // order (already the `pool` order). Legacy player/enemy singletons are kept
    // (from each side's index-0 unit) for the pre-team UI until Wave 4.
    const entries: ComparisonEntry[] = queued
      .filter((q) => q.unit.alive)
      .map((q) => ({ side: q.unit.side, unit: q.unit.index, ...q.comp }));
    const pSide = queued.find((q) => q.unit === state.player)!.comp;
    const eSide = queued.find((q) => q.unit === state.enemy)!.comp;
    events.push({ turn: state.turn, kind: 'comparison', player: pSide, enemy: eSide, performer, entries, performerUnit });

    // 3. Perform (or pass) and bank the waiters (canonical order).
    //    A waiter banks its Speed EXCEPT — with cooldowns on — one that has
    //    NOTHING eligible (`nothingUsable`): its turn is a true waste, no bank.
    //    This stops a tiny deck from hoarding readiness while its cards cool and
    //    then unleashing the instant they come off cooldown. A `ready` loser
    //    (has a card, lost the comparison) and a `busy` spanner still bank.
    for (const q of queued) {
      const c = q.unit;
      if (performerEntry !== null && c === performerEntry.unit) continue;
      if (cooldownsEnabled && q.comp.state === 'nothingUsable') continue;
      c.bank += effStat(c, 'speed');
      if (c.busyTurns > 0) c.busyTurns -= 1;
    }

    if (performerEntry === null) {
      events.push({ turn: state.turn, kind: 'noPerformer' });
    } else {
      const c = performerEntry.unit;
      const choice = performerEntry.choice!;
      c.performs += 1;
      events.push({ turn: state.turn, kind: 'performStart', side: c.side, unit: c.index, performs: c.performs });

      // Sudden death: keyed on side-level perform counters — any unit's
      // performance advances its side's counter, so this is the SUM of the
      // side's units' `performs` (== index-0's performs at 1v1). Active once
      // both sides' counters reach `suddenDeathRound`; the amp lands on the
      // performing unit's `sdStacks`, scaled by side.
      const sidePerforms = (side: Side): number => teamOf(state, side).reduce((sum, u) => sum + u.performs, 0);
      if (Math.min(sidePerforms('player'), sidePerforms('enemy')) >= suddenDeathRound) {
        if (!sdAnnounced) {
          sdAnnounced = true;
          events.push({ turn: state.turn, kind: 'suddenDeathStart' });
        }
        c.sdStacks += c.side === 'player' ? SD_PLAYER_AMP : SD_ENEMY_AMP;
      }

      const stunIdx = c.statuses.findIndex((s) => s.kind === 'stun' && !s.fresh);
      if (stunIdx >= 0) {
        const stun = c.statuses[stunIdx]!;
        stun.turnsLeft -= 1;
        if (stun.turnsLeft <= 0) {
          c.statuses.splice(stunIdx, 1);
          events.push({ turn: state.turn, kind: 'statusExpired', side: c.side, unit: c.index, status: 'stun' });
        }
        events.push({ turn: state.turn, kind: 'performSkipped', side: c.side, unit: c.index, reason: 'stunned' });
        c.bank = 0;
      } else {
        c.bank = 0;
        const cursorBefore = c.castCursor;
        const cursorAfter = (choice.piece.slot + choice.piece.size) % c.boardSize;
        c.castCursor = cursorAfter;
        c.busyTurns = choice.piece.size - 1;
        // This piece has now performed: stamp the reuse-cooldown clock.
        choice.piece.lastCastTurn = state.turn;
        applyCast(ctx, c, choice.skill, choice.piece.slot, choice.mods, { before: cursorBefore, after: cursorAfter }, choice.auraSources);
        // Slow Next is consumed by this action; Combo remembers this cast.
        c.nextWeightPenalty = 0;
        c.lastCastArchetypes = choice.skill.archetypes;
      }
      outcome = checkEnd(state);
      if (outcome !== null) return finish(outcome);
    }

    // 4. Fatigue backstop (whole pool, canonical order — ties go to the player).
    if (state.turn >= fatigueTurn) {
      if (!fatigueAnnounced) {
        fatigueAnnounced = true;
        events.push({ turn: state.turn, kind: 'fatigueStart' });
      }
      const amount = FATIGUE_BASE + (state.turn - fatigueTurn);
      for (const c of units) dealDamage(ctx, c, amount, 'true', { bypassShields: true, source: 'fatigue' });
      outcome = checkEnd(state);
      if (outcome !== null) return finish(outcome);
    }

    // 5. Durations decrement at global turn end (canonical order).
    for (const c of units) expireStatuses(ctx, c);
  }

  return finish('draw');
}

/** Config knobs for a 1v1 fight (everything on CombatConfig except the rosters). */
export type Sim1v1Opts = Omit<CombatConfig, 'player' | 'enemy' | 'playerTeam' | 'enemyTeam' | 'skillBook'> & {
  skillBook: CombatConfig['skillBook'];
};

/**
 * PERMANENT first-class 1v1 entry point. Wraps a single player/enemy setup into
 * 1-element teams and runs the shared team-shaped simulate(). Byte-identical to
 * a `{ playerTeam: [player], enemyTeam: [enemy] }` config for the same seed.
 */
export function simulate1v1(
  player: CombatantSetup,
  enemy: CombatantSetup,
  opts: Sim1v1Opts,
  seed: number,
): CombatResult {
  return simulate({ ...opts, playerTeam: [player], enemyTeam: [enemy] }, seed);
}
