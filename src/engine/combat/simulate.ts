import { Rng } from '../rng';
import type { CombatConfig, CombatOutcome, Side } from '../types';
import type { CombatEvent, ComparisonSide, ComparisonUnit } from './events';
import { effStat, initCombatState, sideDefeated, type CombatState, type CombatantState } from './state';
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
  const speed = effStat(c, 'speed');
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
 * banks their Speed. Hostile actions hit the opposing side's highest-aggro
 * living unit (ties to the front). A side is defeated when ALL its members
 * are down. Sudden death arms once each side's total performances reach
 * round × side size; a flat fatigue backstop guarantees termination.
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

  const everyone = (): CombatantState[] => [...state.player, ...state.enemy];

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
      c.bank += effStat(c, 'speed');
      if (c.busyTurns > 0) c.busyTurns -= 1;
    }

    if (performer === null) {
      events.push({ turn: state.turn, kind: 'noPerformer' });
    } else {
      const c = performer;
      const choice = choices.get(c)!;
      c.performs += 1;
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
        c.bank = 0;
        c.castCursor = (choice.piece.slot + choice.piece.size) % c.boardSize;
        c.busyTurns = choice.piece.size - 1;
        // Slow Next / Quicken were consumed by this action's weight; clear
        // them BEFORE the cast so a Quicken rider on this very card can prime
        // the caster's next action.
        c.nextWeightPenalty = 0;
        c.nextWeightBonus = 0;
        // Staleness: consecutive re-casts of the SAME skill decay in damage;
        // casting anything else resets the counter.
        c.staleCasts = choice.skill.id === c.lastCastSkillId ? c.staleCasts + 1 : 0;
        c.lastCastSkillId = choice.skill.id;
        const enchant = choice.piece.enchant !== undefined ? cfg.enchantBook?.[choice.piece.enchant] : undefined;
        applyCast(ctx, c, choice.skill, choice.piece.slot, choice.mods, enchant);
        // Combo remembers this cast.
        c.lastCastArchetypes = choice.skill.archetypes;
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
