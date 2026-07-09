import { Rng } from '../rng';
import type { CombatConfig, CombatOutcome, Side } from '../types';
import type { CombatEvent, ComparisonSide } from './events';
import { effStat, initCombatState, type CombatState, type CombatantState } from './state';
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

/** null while combat continues. The player wins simultaneous deaths. */
function checkEnd(state: CombatState): CombatOutcome | null {
  if (!state.enemy.alive) return 'win';
  if (!state.player.alive) return 'loss';
  return null;
}

/**
 * DoTs and HoTs act on their owner at the start of every global turn (except
 * the turn they were applied). Poison bypasses shields; burn is consumed by
 * shields; regen restores flat HP. Duration decrements with each tick.
 */
function tickDots(ctx: Ctx, c: CombatantState): void {
  const remaining: typeof c.statuses = [];
  for (const status of c.statuses) {
    if ((status.kind !== 'poison' && status.kind !== 'burn' && status.kind !== 'regen') || status.fresh) {
      remaining.push(status);
      continue;
    }
    if (c.alive) {
      if (status.kind === 'regen') {
        const before = c.stats.hp;
        c.stats.hp = Math.min(c.stats.maxHp, c.stats.hp + (status.amount ?? 0));
        const healed = c.stats.hp - before;
        if (healed > 0) {
          ctx.events.push({ turn: ctx.state.turn, kind: 'heal', side: c.side, amount: healed, flat: true, hpAfter: c.stats.hp });
        }
      } else {
        dealDamage(ctx, c, status.amount ?? 0, status.property ?? 'true', {
          bypassShields: status.kind === 'poison',
          source: status.kind,
        });
      }
    }
    status.turnsLeft -= 1;
    if (status.turnsLeft > 0) {
      remaining.push(status);
    } else {
      ctx.events.push({ turn: ctx.state.turn, kind: 'statusExpired', side: c.side, status: status.kind });
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
    if (status.kind !== 'buff' && status.kind !== 'debuff' && status.kind !== 'thorns') {
      // poison/burn/regen decrement in tickDots; stun decrements when consumed.
      remaining.push(status);
      continue;
    }
    status.turnsLeft -= 1;
    if (status.turnsLeft > 0) {
      remaining.push(status);
    } else {
      ctx.events.push({ turn: ctx.state.turn, kind: 'statusExpired', side: c.side, status: status.kind });
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
 * caster busy for N−1 further turns. Sudden death after both sides have
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

    // 1. DoT phase (player first for determinism).
    tickDots(ctx, state.player);
    tickDots(ctx, state.enemy);
    outcome = checkEnd(state);
    if (outcome !== null) return finish(outcome);

    // 2. Queue cards and compare initiative.
    const pChoice = state.player.busyTurns > 0 ? null : selectCast(state.player, cfg.skillBook);
    const eChoice = state.enemy.busyTurns > 0 ? null : selectCast(state.enemy, cfg.skillBook);
    const pSide = comparisonSide(state.player, pChoice);
    const eSide = comparisonSide(state.enemy, eChoice);

    let performer: Side | null = null;
    if (pSide.state === 'ready' && eSide.state === 'ready') {
      performer = pSide.score! >= eSide.score! ? 'player' : 'enemy';
    } else if (pSide.state === 'ready') {
      performer = 'player';
    } else if (eSide.state === 'ready') {
      performer = 'enemy';
    }
    events.push({ turn: state.turn, kind: 'comparison', player: pSide, enemy: eSide, performer });

    // 3. Perform (or pass) and bank the waiters.
    for (const c of [state.player, state.enemy]) {
      if (performer === c.side) continue;
      c.bank += effStat(c, 'speed');
      if (c.busyTurns > 0) c.busyTurns -= 1;
    }

    if (performer === null) {
      events.push({ turn: state.turn, kind: 'noPerformer' });
    } else {
      const c = performer === 'player' ? state.player : state.enemy;
      const choice = performer === 'player' ? pChoice! : eChoice!;
      c.performs += 1;
      events.push({ turn: state.turn, kind: 'performStart', side: c.side, performs: c.performs });

      // Sudden death: active once both sides have performed `suddenDeathRound` times.
      if (Math.min(state.player.performs, state.enemy.performs) >= suddenDeathRound) {
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
          events.push({ turn: state.turn, kind: 'statusExpired', side: c.side, status: 'stun' });
        }
        events.push({ turn: state.turn, kind: 'performSkipped', side: c.side, reason: 'stunned' });
        c.bank = 0;
      } else {
        c.bank = 0;
        c.castCursor = (choice.piece.slot + choice.piece.size) % c.boardSize;
        c.busyTurns = choice.piece.size - 1;
        // Slow Next / Quicken were consumed by this action's weight; clear
        // them BEFORE the cast so a Quicken rider on this very card can prime
        // the caster's next action.
        c.nextWeightPenalty = 0;
        c.nextWeightBonus = 0;
        applyCast(ctx, c, choice.skill, choice.piece.slot, choice.mods);
        // Combo remembers this cast.
        c.lastCastArchetypes = choice.skill.archetypes;
      }
      outcome = checkEnd(state);
      if (outcome !== null) return finish(outcome);
    }

    // 4. Fatigue backstop (both sides, player first — ties go to the player).
    if (state.turn >= fatigueTurn) {
      if (!fatigueAnnounced) {
        fatigueAnnounced = true;
        events.push({ turn: state.turn, kind: 'fatigueStart' });
      }
      const amount = FATIGUE_BASE + (state.turn - fatigueTurn);
      dealDamage(ctx, state.player, amount, 'true', { bypassShields: true, source: 'fatigue' });
      dealDamage(ctx, state.enemy, amount, 'true', { bypassShields: true, source: 'fatigue' });
      outcome = checkEnd(state);
      if (outcome !== null) return finish(outcome);
    }

    // 5. Durations decrement at global turn end.
    expireStatuses(ctx, state.player);
    expireStatuses(ctx, state.enemy);
  }

  return finish('draw');
}
