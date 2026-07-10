import { Rng } from '../rng';
import type { CombatConfig, CombatOutcome, Side } from '../types';
import type { CombatEvent, ComparisonSide, ComparisonUnit } from './events';
import { effSpeed, initCombatState, sideDefeated, type CombatState, type CombatantState } from './state';
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
/**
 * Chained extra plays cost exponentially more: the Nth extra cast costs
 * (weight + FLAT) × GROWTH^N (2×, 4×, 8×…). No hard cap — pure speed
 * stacking buys deeper chains, but every additional play squares the ask.
 * The flat term keeps the cost strictly growing even for a hypothetical
 * 0-weight card, so a chain can never run forever.
 */
const CHAIN_COST_GROWTH = 2;
const CHAIN_COST_FLAT = 2;

/** null while combat continues. The player wins simultaneous wipes. */
function checkEnd(state: CombatState): CombatOutcome | null {
  if (sideDefeated(state.enemy)) return 'win';
  if (sideDefeated(state.player)) return 'loss';
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
          ctx.events.push({ turn: ctx.state.turn, kind: 'heal', side: c.side, unit: c.unit, amount: healed, flat: true, hpAfter: c.stats.hp });
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
      ctx.events.push({ turn: ctx.state.turn, kind: 'statusExpired', side: c.side, unit: c.unit, status: status.kind });
    }
  }
  c.statuses = remaining;
}

/** Decrement buff/debuff/thorns durations at global turn end; clear freshness. */
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
      ctx.events.push({ turn: ctx.state.turn, kind: 'statusExpired', side: c.side, unit: c.unit, status: status.kind });
    }
  }
  c.statuses = remaining;
}

function comparisonUnit(c: CombatantState, choice: CastChoice | null): ComparisonUnit {
  const base = { side: c.side, unit: c.unit, name: c.name, alive: c.alive };
  const speed = effSpeed(c);
  if (!c.alive || c.busyTurns > 0) {
    return {
      ...base,
      queuedSkillId: null,
      queuedSlot: null,
      bank: c.bank,
      speed,
      weight: null,
      score: null,
      state: c.alive ? 'busy' : 'nothingUsable',
    };
  }
  if (choice === null) {
    return { ...base, queuedSkillId: null, queuedSlot: null, bank: c.bank, speed, weight: null, score: null, state: 'nothingUsable' };
  }
  return {
    ...base,
    queuedSkillId: choice.skill.id,
    queuedSlot: choice.piece.slot,
    bank: c.bank,
    speed,
    weight: choice.weight,
    score: c.bank + speed - choice.weight,
    state: 'ready',
  };
}

/** A side's summary line: its best contender, or busy/nothingUsable. */
function sideSummary(units: ComparisonUnit[]): ComparisonSide {
  let best: ComparisonUnit | null = null;
  for (const u of units) {
    if (u.state !== 'ready') continue;
    if (best === null || u.score! > best.score!) best = u;
  }
  if (best) return best;
  const busy = units.find((u) => u.alive && u.state === 'busy');
  const fallback = busy ?? units.find((u) => u.alive) ?? units[0]!;
  return { ...fallback, state: busy ? 'busy' : 'nothingUsable' };
}

/**
 * Run a full deterministic combat between two sides of 1-5 combatants.
 *
 * Each global turn: DoTs tick (player formation first) → every living,
 * non-busy combatant queues its next card (own board rotation) → ONE
 * initiative comparison across all ready contenders (score = bank + Speed −
 * weight; highest performs; ties: player side, then front of formation) →
 * the performer casts (or a stun consumes the performance); everyone else
 * banks their Speed. The performer's winning score, less each card's weight,
 * is a BUDGET: while it still strictly beats every other ready contender the
 * performer chains extra casts, each costing exponentially more (2×, 4×,
 * 8×… the card's weight) — so multiple plays per stage exist for any build,
 * but deep chains demand pure Speed stacking. Hostile actions hit the opposing side's highest-aggro
 * living unit (ties to the front). A side is defeated when ALL its members
 * are down. Sudden death arms once each side's total performances reach
 * round × side size; a flat fatigue backstop guarantees termination.
 */
export function simulate(cfg: CombatConfig, seed: number): CombatResult {
  const state = initCombatState(cfg);
  const rng = new Rng(seed);
  const events: CombatEvent[] = [];
  const ctx: Ctx = { state, rng, events, book: cfg.skillBook };
  const suddenDeathRound = cfg.suddenDeathRound ?? DEFAULT_SUDDEN_DEATH_ROUND;
  const fatigueTurn = cfg.fatigueTurn ?? DEFAULT_FATIGUE_TURN;
  const maxTurns = cfg.maxTurns ?? DEFAULT_MAX_TURNS;
  let sdAnnounced = false;
  let fatigueAnnounced = false;

  const everyone = (): CombatantState[] => [...state.player, ...state.enemy];

  /**
   * Execute one cast: advance the rotation cursor, occupy the span, run
   * staleness/momentum bookkeeping, detonate any card trap, spend limited
   * uses, then apply the effects. `chased` marks Chase Mark's free follow-up
   * (weaker, keeps weight riders, cannot chase again).
   */
  const doCast = (c: CombatantState, choice: CastChoice, chased: boolean): void => {
    c.castCursor = (choice.piece.slot + choice.piece.size) % c.boardSize;
    c.busyTurns = choice.piece.size - 1;
    if (!chased) {
      // Slow Next / Quicken were consumed by this action's weight; clear them
      // BEFORE the cast so a Quicken rider on this very card can prime the
      // caster's next action. A chased cast is free — it consumes nothing.
      c.nextWeightPenalty = 0;
      c.nextWeightBonus = 0;
    }
    // Staleness / momentum: repeating the SAME skill fades bonus
    // effectiveness; chaining DIFFERENT skills amplifies it.
    if (choice.skill.id === c.lastCastSkillId) {
      c.staleCasts += 1;
      c.momentumCasts = 0;
    } else {
      c.staleCasts = 0;
      c.momentumCasts = c.lastCastSkillId === null ? 0 : c.momentumCasts + 1;
    }
    c.lastCastSkillId = choice.skill.id;
    // A cursed card detonates its trap as it activates; if the trap kills
    // the caster, the cast itself is lost.
    if (choice.piece.curse) {
      const trap = choice.piece.curse;
      delete choice.piece.curse;
      dealDamage(ctx, c, trap.amount, trap.property, { source: 'curse' });
    }
    if (choice.piece.castsLeft !== undefined) choice.piece.castsLeft -= 1;
    if (!c.alive) return;
    const enchant = choice.piece.enchant !== undefined ? cfg.enchantBook?.[choice.piece.enchant] : undefined;
    applyCast(ctx, c, choice.skill, choice.piece.slot, choice.mods, enchant, chased);
    // Weaken jams THIS cast and is spent by it.
    c.nextCastWeakenPct = 0;
    // Combo remembers this cast.
    c.lastCastArchetypes = choice.skill.archetypes;

    // Chase Mark: the cast flows straight into the next card — ONE free
    // follow-up (a chased cast cannot chase), only while the caster is free
    // (a size-2+ chase card is busy finishing its span) and the fight is
    // still live.
    if (!chased && enchant?.chase && c.alive && c.busyTurns === 0 && checkEnd(state) === null) {
      const chasedChoice = selectCast(c, cfg.skillBook);
      if (chasedChoice) doCast(c, chasedChoice, true);
    }
  };

  const finish = (result: CombatOutcome): CombatResult => {
    events.push({ turn: state.turn, kind: 'combatEnd', result, turns: state.turn });
    return { result, turns: state.turn, events, finalState: state };
  };

  let outcome = checkEnd(state);
  if (outcome !== null) return finish(outcome);

  while (state.turn < maxTurns) {
    state.turn += 1;

    // 1. DoT phase (player formation first for determinism).
    for (const c of everyone()) tickDots(ctx, c);
    outcome = checkEnd(state);
    if (outcome !== null) return finish(outcome);

    // 2. Queue cards and run ONE comparison across every ready combatant.
    const choices = new Map<CombatantState, CastChoice | null>();
    const contenders: ComparisonUnit[] = [];
    for (const c of everyone()) {
      const choice = c.alive && c.busyTurns === 0 ? selectCast(c, cfg.skillBook) : null;
      choices.set(c, choice);
      contenders.push(comparisonUnit(c, choice));
    }

    // Highest score performs; strict `>` hands ties to the earliest contender
    // in [player formation, enemy formation] order (player side wins ties,
    // front of formation wins within a side) — the 1v1 rule, generalized.
    let performer: CombatantState | null = null;
    let bestScore = -Infinity;
    const all = everyone();
    for (let i = 0; i < all.length; i++) {
      const unit = contenders[i]!;
      if (unit.state === 'ready' && unit.score! > bestScore) {
        performer = all[i]!;
        bestScore = unit.score!;
      }
    }

    // Highest score among the OTHER ready contenders — the bar a performer
    // must keep beating to chain extra casts. null = nobody else is ready;
    // free stage time never chains (you already act every turn).
    let runnerUp: number | null = null;
    for (let i = 0; i < all.length; i++) {
      const unit = contenders[i]!;
      if (all[i] !== performer && unit.state === 'ready') {
        runnerUp = runnerUp === null ? unit.score! : Math.max(runnerUp, unit.score!);
      }
    }

    const playerUnits = contenders.filter((u) => u.side === 'player');
    const enemyUnits = contenders.filter((u) => u.side === 'enemy');
    events.push({
      turn: state.turn,
      kind: 'comparison',
      player: sideSummary(playerUnits),
      enemy: sideSummary(enemyUnits),
      contenders,
      performer: performer?.side ?? null,
      performerUnit: performer?.unit ?? null,
    });

    // 3. Perform (or pass); every other living combatant banks its Speed.
    for (const c of everyone()) {
      if (performer === c || !c.alive) continue;
      c.bank += effSpeed(c);
      if (c.busyTurns > 0) c.busyTurns -= 1;
    }

    if (performer === null) {
      events.push({ turn: state.turn, kind: 'noPerformer' });
    } else {
      const c = performer;
      const choice = choices.get(c)!;
      c.performs += 1;
      // Taking the stage (even a stun-consumed one) re-arms staggerability.
      c.staggerGuard = false;
      // Dodge only guards the window BEFORE your next action — acting again
      // (even stun-consumed) drops any unspent dodge charges.
      if (c.statuses.some((s) => s.kind === 'dodge')) {
        c.statuses = c.statuses.filter((s) => s.kind !== 'dodge');
        events.push({ turn: state.turn, kind: 'statusExpired', side: c.side, unit: c.unit, status: 'dodge' });
      }
      events.push({ turn: state.turn, kind: 'performStart', side: c.side, unit: c.unit, performs: c.performs });

      // Sudden death: armed once each side's total performances reach
      // round × side size ("everyone has averaged N turns on stage").
      const playerTotal = state.player.reduce((n, u) => n + u.performs, 0);
      const enemyTotal = state.enemy.reduce((n, u) => n + u.performs, 0);
      if (playerTotal >= suddenDeathRound * state.player.length && enemyTotal >= suddenDeathRound * state.enemy.length) {
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
          events.push({ turn: state.turn, kind: 'statusExpired', side: c.side, unit: c.unit, status: 'stun' });
        }
        events.push({ turn: state.turn, kind: 'performSkipped', side: c.side, unit: c.unit, reason: 'stunned' });
        // Pure action denial: the victim KEEPS its banked initiative, so a
        // stun reads as "skip their next action" — usually a one-turn delay.
        // Draining the bank is stagger's job (and priced separately).
      } else {
        // The winning score, less this card's weight, is the performer's
        // remaining initiative BUDGET. While that budget still strictly beats
        // every other ready contender, the performer keeps the stage and
        // casts again — but each extra play costs exponentially more (2×,
        // 4×, 8×… the card's weight), so chains price themselves out unless
        // the build stacks pure Speed. The bank then resets exactly as
        // before.
        let budget = c.bank + effSpeed(c) - choice.weight;
        c.bank = 0;
        doCast(c, choice, false);
        for (let costMult = CHAIN_COST_GROWTH; ; costMult *= CHAIN_COST_GROWTH) {
          if (runnerUp === null || !c.alive || c.busyTurns > 0 || checkEnd(state) !== null) break;
          const next = selectCast(c, cfg.skillBook);
          if (next === null) break;
          const cost = (next.weight + CHAIN_COST_FLAT) * costMult;
          if (budget - cost <= runnerUp) break;
          budget -= cost;
          c.performs += 1;
          events.push({ turn: state.turn, kind: 'performStart', side: c.side, unit: c.unit, performs: c.performs });
          doCast(c, next, false);
        }
      }
      outcome = checkEnd(state);
      if (outcome !== null) return finish(outcome);
    }

    // 4. Fatigue backstop (player formation first — ties go to the player).
    if (state.turn >= fatigueTurn) {
      if (!fatigueAnnounced) {
        fatigueAnnounced = true;
        events.push({ turn: state.turn, kind: 'fatigueStart' });
      }
      const amount = FATIGUE_BASE + (state.turn - fatigueTurn);
      for (const c of everyone()) {
        dealDamage(ctx, c, amount, 'true', { bypassShields: true, source: 'fatigue' });
      }
      outcome = checkEnd(state);
      if (outcome !== null) return finish(outcome);
    }

    // 5. Durations decrement at global turn end.
    for (const c of everyone()) expireStatuses(ctx, c);
  }

  return finish('draw');
}
