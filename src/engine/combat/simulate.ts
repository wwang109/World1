import { Rng } from '../rng';
import { timeCost, type CombatConfig, type CombatOutcome } from '../types';
import type { CombatEvent } from './events';
import { effStat, initCombatState, opponentOf, type CombatState, type CombatantState } from './state';
import { selectCast } from './castSelect';
import { effCooldown } from './auras';
import { applyCast, dealDamage, type Ctx } from './interpreter';

export interface CombatResult {
  result: CombatOutcome;
  /** Timeline position when the fight ended. */
  endedAt: number;
  /** Total turns taken across both sides. */
  turns: number;
  events: CombatEvent[];
  finalState: CombatState;
}

/** Time cost of a skipped turn (stun / nothing castable). */
const BASE_TIME = 100;
const DEFAULT_SUDDEN_DEATH_ROUND = 5;
const DEFAULT_FATIGUE_ROUND = 20;
const DEFAULT_MAX_TURNS = 300;
/** Sudden-death damage ramp per own turn. */
const SD_PLAYER_AMP = 10;
const SD_ENEMY_AMP = 30;
/** Flat backstop damage growth per round past fatigueRound. */
const FATIGUE_STEP = 5;

/** null while combat continues. The player wins simultaneous deaths. */
function checkEnd(state: CombatState): CombatOutcome | null {
  if (!state.enemy.alive) return 'win';
  if (!state.player.alive) return 'loss';
  return null;
}

/** Rounds completed = turns both sides have fully taken. */
function roundsDone(state: CombatState): number {
  return Math.min(state.player.turnCount, state.enemy.turnCount);
}

/**
 * DoTs act on every turn of their victim. Poison ignores shield; burn hits
 * shield first. Durations are counted in the victim's turns.
 */
function tickDots(ctx: Ctx, c: CombatantState): void {
  const remaining: typeof c.statuses = [];
  for (const status of c.statuses) {
    if (status.kind !== 'poison' && status.kind !== 'burn') {
      remaining.push(status);
      continue;
    }
    if (c.alive) {
      const amount = status.amount ?? 0;
      if (status.kind === 'poison') {
        c.stats.hp = Math.max(0, c.stats.hp - amount);
      } else {
        const blocked = Math.min(c.shield, amount);
        c.shield -= blocked;
        c.stats.hp = Math.max(0, c.stats.hp - (amount - blocked));
      }
      ctx.events.push({
        time: ctx.state.now,
        kind: 'statusTick',
        side: c.side,
        status: status.kind,
        amount,
        hpAfter: c.stats.hp,
      });
      if (c.stats.hp === 0 && c.alive) {
        c.alive = false;
        ctx.events.push({ time: ctx.state.now, kind: 'died', side: c.side });
      }
    }
    status.turnsLeft -= 1;
    if (status.turnsLeft > 0) {
      remaining.push(status);
    } else {
      ctx.events.push({ time: ctx.state.now, kind: 'statusExpired', side: c.side, status: status.kind });
    }
  }
  c.statuses = remaining;
}

/** Decrement buff/debuff durations at the owner's turn end. */
function expireBuffs(ctx: Ctx, c: CombatantState): void {
  const remaining: typeof c.statuses = [];
  for (const status of c.statuses) {
    if (status.kind !== 'buff' && status.kind !== 'debuff') {
      remaining.push(status);
      continue;
    }
    if (status.skipFirstExpiry) {
      delete status.skipFirstExpiry;
      remaining.push(status);
      continue;
    }
    status.turnsLeft -= 1;
    if (status.turnsLeft > 0) {
      remaining.push(status);
    } else {
      ctx.events.push({ time: ctx.state.now, kind: 'statusExpired', side: c.side, status: status.kind });
    }
  }
  c.statuses = remaining;
}

interface EndgameFlags {
  suddenDeathAnnounced: boolean;
  fatigueAnnounced: boolean;
}

/**
 * Execute one turn and return the time cost of the action taken (before
 * Speed scaling): the cast skill's timeCost, or BASE_TIME for skipped turns.
 */
function takeTurn(ctx: Ctx, c: CombatantState, cfg: CombatConfig, flags: EndgameFlags): number {
  c.turnCount += 1;
  ctx.events.push({ time: ctx.state.now, kind: 'turnStart', side: c.side, turn: c.turnCount });

  const suddenDeathRound = cfg.suddenDeathRound ?? DEFAULT_SUDDEN_DEATH_ROUND;
  const fatigueRound = cfg.fatigueRound ?? DEFAULT_FATIGUE_ROUND;
  const rounds = roundsDone(ctx.state);

  // Sudden death: once both sides have taken `suddenDeathRound` turns, the
  // acting side's damage ramps every turn — +10%/turn player, +30%/turn enemy.
  if (rounds >= suddenDeathRound) {
    if (!flags.suddenDeathAnnounced) {
      flags.suddenDeathAnnounced = true;
      ctx.events.push({ time: ctx.state.now, kind: 'suddenDeathStart' });
    }
    c.sdStacks += c.side === 'player' ? SD_PLAYER_AMP : SD_ENEMY_AMP;
  }

  tickDots(ctx, c);
  if (!c.alive || !opponentOf(ctx.state, c).alive) return BASE_TIME;

  // Backstop for boards that deal no damage at all (amp can't end those):
  // flat escalating damage to BOTH sides, player first, so simultaneous
  // wipes resolve as a player win.
  if (rounds >= fatigueRound) {
    if (!flags.fatigueAnnounced) {
      flags.fatigueAnnounced = true;
      ctx.events.push({ time: ctx.state.now, kind: 'fatigueStart' });
    }
    const amount = (rounds - fatigueRound + 1) * FATIGUE_STEP;
    dealDamage(ctx, ctx.state.player, amount, { ignoreShield: true, source: 'fatigue' });
    dealDamage(ctx, ctx.state.enemy, amount, { ignoreShield: true, source: 'fatigue' });
    if (!c.alive || !opponentOf(ctx.state, c).alive) return BASE_TIME;
  }

  for (const piece of c.pieces) {
    if (piece.cooldown > 0) piece.cooldown -= 1;
  }

  let cost = BASE_TIME;
  const stunIdx = c.statuses.findIndex((s) => s.kind === 'stun');
  if (stunIdx >= 0) {
    const stun = c.statuses[stunIdx]!;
    stun.turnsLeft -= 1;
    if (stun.turnsLeft <= 0) {
      c.statuses.splice(stunIdx, 1);
      ctx.events.push({ time: ctx.state.now, kind: 'statusExpired', side: c.side, status: 'stun' });
    }
    ctx.events.push({ time: ctx.state.now, kind: 'turnSkipped', side: c.side, reason: 'stunned' });
  } else {
    const choice = selectCast(c, cfg.skillBook);
    if (choice === null) {
      ctx.events.push({ time: ctx.state.now, kind: 'turnSkipped', side: c.side, reason: 'noUsableSkill' });
    } else {
      const cd = effCooldown(choice.skill.cooldownTurns, choice.mods);
      if (cd > 0) choice.piece.cooldown = cd;
      c.castCursor = (choice.piece.slot + choice.piece.size) % c.boardSize;
      applyCast(ctx, c, choice.skill, choice.piece.slot, choice.mods);
      cost = timeCost(choice.skill);
    }
  }

  expireBuffs(ctx, c);
  return cost;
}

/**
 * Run a full deterministic 1v1 combat on an action timeline. Same config +
 * seed always produces an identical event log; rendering is a pure playback
 * of `events`.
 *
 * There is no ticking: the combatant whose next action comes soonest acts
 * (ties go to the player), and the skill they cast schedules their next turn
 * — delay = timeCost(skill) * 100 / Speed. Bigger skills take more turns to
 * cast; higher Speed compresses every delay.
 */
export function simulate(cfg: CombatConfig, seed: number): CombatResult {
  const state = initCombatState(cfg);
  const rng = new Rng(seed);
  const events: CombatEvent[] = [];
  const ctx: Ctx = { state, rng, events };
  const maxTurns = cfg.maxTurns ?? DEFAULT_MAX_TURNS;
  const flags: EndgameFlags = { suddenDeathAnnounced: false, fatigueAnnounced: false };

  const finish = (result: CombatOutcome): CombatResult => {
    events.push({ time: state.now, kind: 'combatEnd', result });
    return {
      result,
      endedAt: state.now,
      turns: state.player.turnCount + state.enemy.turnCount,
      events,
      finalState: state,
    };
  };

  let outcome = checkEnd(state);
  if (outcome !== null) return finish(outcome);

  // Warmup: the first turn arrives after one base action scaled by Speed, so
  // the faster combatant genuinely acts first (speed = turn order).
  for (const c of [state.player, state.enemy]) {
    c.nextActionAt = Math.max(1, Math.floor((BASE_TIME * 100) / Math.max(1, effStat(c, 'speed'))));
  }

  for (let i = 0; i < maxTurns; i++) {
    const actor =
      state.player.nextActionAt <= state.enemy.nextActionAt ? state.player : state.enemy;
    state.now = actor.nextActionAt;

    const cost = takeTurn(ctx, actor, cfg, flags);
    const speed = Math.max(1, effStat(actor, 'speed'));
    actor.nextActionAt += Math.max(1, Math.floor((cost * 100) / speed));

    outcome = checkEnd(state);
    if (outcome !== null) return finish(outcome);
  }

  return finish('draw');
}
