import { Rng } from '../rng';
import type { CombatConfig, CombatantSetup, CombatOutcome, Side } from '../types';
import type { CombatEvent } from './events';
import { effStat, initCombatState, teamOf, type CombatState, type CombatantState } from './state';
import { scanCast, type CastChoice } from './castSelect';
import { applyCast, dealDamage, targetInfoForCast, type Ctx } from './interpreter';

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
 * ATTRITION — the global stalemate breaker (user-locked 2026-07-30).
 *
 * First global turn on which attrition fires. Turns 1..ATTRITION_START_TURN−1
 * are completely unaffected, so any fight that ends before it is byte-identical
 * to the pre-attrition engine.
 */
export const ATTRITION_START_TURN = 15;
/** Per-turn growth: turn 15 → 5, turn 16 → 10, turn 20 → 30. */
export const ATTRITION_STEP = 5;

/**
 * Attrition damage on `turn` (0 before the threshold).
 * `(turn − startTurn + 1) × ATTRITION_STEP` — integer-only, no RNG.
 */
export function attritionDamage(turn: number, startTurn: number = ATTRITION_START_TURN): number {
  if (turn < startTurn) return 0;
  return (turn - startTurn + 1) * ATTRITION_STEP;
}

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
 * Turn-based DoT ticks (user-locked timing 2026-07-20): BURN ticks at the
 * START of every global turn — it can kill before the victim acts and is
 * absorbed by shields before they refresh. POISON ticks at the END of every
 * global turn — the victim always gets to act before it lands, and it
 * bypasses shields. Neither ticks on the turn its pile was created (`fresh`).
 * POISON decays linearly: a tick deals the current stack count, then one
 * stack falls off. BURN is fierce and brief (user-locked 2026-07-20): a tick
 * deals 2 × the current stack count, then stacks HALVE (floored) — burn 8
 * ticks 16, 8, 4, 2. Either pile expires at 0 stacks.
 */
function tickTurnDot(ctx: Ctx, c: CombatantState, kind: 'poison' | 'burn'): void {
  const remaining: typeof c.statuses = [];
  for (const status of c.statuses) {
    if (status.kind !== kind || status.fresh) {
      remaining.push(status);
      continue;
    }
    if (c.alive) {
      // Attribute the tick to the card that applied the DoT (for the per-card report).
      ctx.source = status.source;
      const tick = kind === 'burn' ? 2 * (status.stacks ?? 0) : status.stacks ?? 0;
      dealDamage(ctx, c, tick, status.property ?? 'true', {
        bypassShields: status.kind === 'poison',
        source: status.kind,
      });
      ctx.source = undefined;
    }
    status.stacks = kind === 'burn' ? Math.floor((status.stacks ?? 0) / 2) : (status.stacks ?? 0) - 1;
    status.turnsLeft = status.stacks;
    if (status.stacks > 0) {
      remaining.push(status);
    } else {
      ctx.events.push({ turn: ctx.state.turn, kind: 'statusExpired', side: c.side, unit: c.index, status: status.kind });
    }
  }
  c.statuses = remaining;
}

/**
 * Bleed ticks when its victim PERFORMS a cast — acting costs blood. Called
 * right after a cast's effects resolve (see the perform loop), NOT at the start
 * of a global turn like poison/burn, and NOT on a stun-skipped performance
 * (there is no `play`). DECAYING model: each performance takes the current
 * stack count in damage, then one stack falls off. Bypasses shields once
 * running (internal bleeding) — but application is blocked by active shields
 * (see applyDot's caller). A `fresh` bleed applied this same turn is skipped
 * until end-of-turn clears its freshness, matching DoT semantics.
 */
function tickBleed(ctx: Ctx, c: CombatantState): void {
  const remaining: typeof c.statuses = [];
  for (const status of c.statuses) {
    if (status.kind !== 'bleed' || status.fresh) {
      remaining.push(status);
      continue;
    }
    if (c.alive) {
      ctx.source = status.source;
      dealDamage(ctx, c, status.stacks ?? 0, status.property ?? 'true', { bypassShields: true, source: 'bleed' });
      ctx.source = undefined;
    }
    status.stacks = (status.stacks ?? 0) - 1;
    status.turnsLeft = status.stacks;
    if (status.stacks > 0) {
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

function cursorPiece(c: CombatantState): { piece: CombatantState['pieces'][number]; slotIndex: number } | null {
  for (const piece of c.pieces) {
    if (c.castCursor >= piece.slot && c.castCursor < piece.slot + piece.size) {
      return { piece, slotIndex: c.castCursor - piece.slot + 1 };
    }
  }
  return null;
}

function emitCursor(ctx: Ctx, c: CombatantState, before: number): void {
  const at = cursorPiece(c);
  ctx.events.push({
    turn: ctx.state.turn,
    kind: 'cursor',
    side: c.side,
    unit: c.index,
    slot: c.castCursor,
    ...(at ? { skillId: at.piece.skillId, slotIndex: at.slotIndex, slotCount: at.piece.size } : {}),
    wrapped: c.castCursor < before,
  });
}

function moveCursorToNextCard(c: CombatantState): void {
  if (cursorPiece(c)) return;
  for (let offset = 0; offset < c.boardSize; offset += 1) {
    const slot = (c.castCursor + offset) % c.boardSize;
    if (c.pieces.some((piece) => piece.slot === slot)) {
      c.castCursor = slot;
      return;
    }
  }
}

function candidateWins(a: { unit: CombatantState }, b: { unit: CombatantState }): boolean {
  if (a.unit.readiness !== b.unit.readiness) return a.unit.readiness > b.unit.readiness;
  const aSpeed = effStat(a.unit, 'speed');
  const bSpeed = effStat(b.unit, 'speed');
  return aSpeed > bSpeed;
}

/**
 * Run deterministic readiness combat. Every living combatant gains Speed once
 * per gameplay turn, then the highest-readiness combatant that can afford its
 * current card plays and pays its weight. The resolve loop repeats, allowing
 * multiple plays in one turn. Size advances the cursor through occupied slots;
 * only the first slot casts and later slots make the combatant busy for a turn.
 */
export function simulate(cfg: CombatConfig, seed: number): CombatResult {
  const state = initCombatState(cfg);
  const rng = new Rng(seed);
  const events: CombatEvent[] = [];
  const ctx: Ctx = { state, rng, events };
  const suddenDeathRound = cfg.suddenDeathRound ?? DEFAULT_SUDDEN_DEATH_ROUND;
  const fatigueTurn = cfg.fatigueTurn ?? DEFAULT_FATIGUE_TURN;
  const maxTurns = cfg.maxTurns ?? DEFAULT_MAX_TURNS;
  const attritionTurn = cfg.attritionTurn ?? ATTRITION_START_TURN;
  const cooldownsEnabled = cfg.cooldownsEnabled ?? true;
  let sdAnnounced = false;
  let fatigueAnnounced = false;
  let attritionAnnounced = false;

  const finish = (result: CombatOutcome): CombatResult => {
    events.push({ turn: state.turn, kind: 'combatEnd', result, turns: state.turn });
    return { result, turns: state.turn, events, finalState: state };
  };

  let outcome = checkEnd(state);
  if (outcome !== null) return finish(outcome);

  while (state.turn < maxTurns) {
    state.turn += 1;

    const units = pool(state);

    // Start-of-turn effects resolve before readiness so dead units never gain.
    // Only BURN ticks here; poison ticks at the end of the turn.
    for (const c of units) tickTurnDot(ctx, c, 'burn');
    outcome = checkEnd(state);
    if (outcome !== null) return finish(outcome);

    // Phase 1: every living combatant gains effective Speed exactly once.
    for (const c of units) {
      if (!c.alive) continue;
      const speed = effStat(c, 'speed');
      const baseSpeed = c.stats.speed;
      const readinessBefore = c.readiness;
      c.readiness += speed;
      events.push({
        turn: state.turn,
        kind: 'gain',
        side: c.side,
        unit: c.index,
        baseSpeed,
        speedModifier: speed - baseSpeed,
        speed,
        readinessBefore,
        readinessAfter: c.readiness,
      });
    }

    // A cursor inside a multi-slot card advances one occupied slot and makes
    // that combatant busy for this whole resolve phase.
    const blocked = new Set<CombatantState>();
    for (const c of units) {
      if (!c.alive) continue;
      const at = cursorPiece(c);
      if (!at || at.slotIndex === 1) continue;
      events.push({
        turn: state.turn,
        kind: 'busy',
        side: c.side,
        unit: c.index,
        slot: c.castCursor,
        skillId: at.piece.skillId,
        slotIndex: at.slotIndex,
        slotCount: at.piece.size,
      });
      const before = c.castCursor;
      c.castCursor = (c.castCursor + 1) % c.boardSize;
      moveCursorToNextCard(c);
      emitCursor(ctx, c, before);
      blocked.add(c);
    }

    let playsThisTurn = 0;
    const played = new Set<CombatantState>();
    const playedPieces = new Map<CombatantState, Set<CombatantState['pieces'][number]>>();
    const stunned = new Set<CombatantState>();
    while (true) {
      let performerEntry: { unit: CombatantState; choice: CastChoice } | null = null;
      for (const c of units) {
        if (!c.alive || blocked.has(c) || stunned.has(c)) continue;
        const scan = scanCast(c, cfg.skillBook, {
          currentTurn: state.turn,
          cooldownsEnabled,
          excludedThisTurn: playedPieces.get(c),
        });
        if (scan.kind !== 'choice' || c.readiness < scan.choice.weight) continue;
        const entry = { unit: c, choice: scan.choice };
        if (performerEntry === null || candidateWins(entry, performerEntry)) performerEntry = entry;
      }
      if (performerEntry === null) break;

      const c = performerEntry.unit;
      const choice = performerEntry.choice;
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

      const stunIdx = c.statuses.findIndex((status) => status.kind === 'stun' && !status.fresh);
      if (stunIdx >= 0) {
        const stun = c.statuses[stunIdx]!;
        stun.turnsLeft -= 1;
        if (stun.turnsLeft <= 0) {
          c.statuses.splice(stunIdx, 1);
          events.push({ turn: state.turn, kind: 'statusExpired', side: c.side, unit: c.index, status: 'stun' });
        }
        events.push({ turn: state.turn, kind: 'performSkipped', side: c.side, unit: c.index, reason: 'stunned' });
        events.push({ turn: state.turn, kind: 'wait', side: c.side, unit: c.index, reason: 'stunned' });
        c.readiness = 0;
        stunned.add(c);
      } else {
        const cursorBefore = c.castCursor;
        const cursorAfter = (choice.piece.slot + 1) % c.boardSize;
        const playEvent: Extract<CombatEvent, { kind: 'play' }> = {
          turn: state.turn,
          kind: 'play',
          side: c.side,
          unit: c.index,
          slot: choice.piece.slot,
          skillId: choice.skill.id,
          weight: choice.weight,
          size: choice.piece.size,
          slotIndex: 1,
          slotCount: choice.piece.size,
          ...targetInfoForCast(ctx, c, choice.skill),
          ...(choice.auraSources.length > 0 ? { auras: choice.auraSources } : {}),
        };
        events.push(playEvent);
        const readinessBefore = c.readiness;
        c.readiness -= choice.weight;
        c.castCursor = cursorAfter;
        choice.piece.lastCastTurn = state.turn;
        const effectStart = events.length;
        applyCast(ctx, c, choice.skill, choice.piece.slot, choice.mods, { before: cursorBefore, after: cursorAfter }, choice.auraSources);
        const firstHit = events.slice(effectStart).find(
          (event): event is Extract<CombatEvent, { kind: 'damage' }> => event.kind === 'damage' && event.source === 'skill',
        );
        if (firstHit) {
          playEvent.damage = Math.max(0, firstHit.amount - firstHit.blocked);
          playEvent.hpAfter = firstHit.hpAfter;
        }
        // Bleed: performing (a resolved cast) costs the performer blood. Ticks
        // here, right after this cast's own effects, before the cost event.
        tickBleed(ctx, c);
        events.push({
          turn: state.turn,
          kind: 'cost',
          side: c.side,
          unit: c.index,
          readinessBefore,
          readinessAfter: c.readiness,
          paid: choice.weight,
        });
        emitCursor(ctx, c, cursorBefore);
        c.nextWeightPenalty = 0;
        c.lastCastArchetypes = choice.skill.archetypes;
        playsThisTurn += 1;
        played.add(c);
        const pieces = playedPieces.get(c) ?? new Set<CombatantState['pieces'][number]>();
        pieces.add(choice.piece);
        playedPieces.set(c, pieces);
        if (choice.piece.size > 1) blocked.add(c);
      }
      outcome = checkEnd(state);
      if (outcome !== null) return finish(outcome);
    }

    if (playsThisTurn === 0) events.push({ turn: state.turn, kind: 'noPerformer' });

    // Explain why each available combatant stopped. Busy and stunned units
    // already emitted their authoritative line above.
    for (const c of units) {
      if (!c.alive || blocked.has(c) || stunned.has(c)) continue;
      const scan = scanCast(c, cfg.skillBook, {
        currentTurn: state.turn,
        cooldownsEnabled,
        excludedThisTurn: playedPieces.get(c),
      });
      if (scan.kind === 'choice') {
        events.push({
          turn: state.turn,
          kind: 'wait',
          side: c.side,
          unit: c.index,
          reason: 'cantAfford',
          readiness: c.readiness,
          weight: scan.choice.weight,
          slot: scan.choice.piece.slot,
          skillId: scan.choice.skill.id,
        });
      } else if (scan.kind === 'cooling') {
        if (played.has(c)) continue;
        events.push({
          turn: state.turn,
          kind: 'wait',
          side: c.side,
          unit: c.index,
          reason: 'cooling',
          turnsLeft: scan.turnsLeft,
          slot: scan.piece.slot,
          skillId: scan.piece.skillId,
        });
      } else {
        if (played.has(c)) continue;
        events.push({ turn: state.turn, kind: 'wait', side: c.side, unit: c.index, reason: 'noCards' });
      }
    }

    // End-of-turn POISON ticks: everyone has acted; deaths here deny nothing
    // this turn but start the next one. Fresh poison (applied this turn) is
    // still flagged and skips — expireStatuses below clears the flag.
    for (const c of units) tickTurnDot(ctx, c, 'poison');
    outcome = checkEnd(state);
    if (outcome !== null) return finish(outcome);

    // ATTRITION — global stalemate breaker, one clearly-bounded turn step (the
    // only place in the loop that knows about it). From `attritionTurn` on,
    // EVERY living combatant takes escalating TRUE damage in canonical pool
    // order (player side first, then by unit index).
    //
    // Deliberate properties:
    // - `bypassShields: true`. Attrition must GUARANTEE termination, and typed
    //   shield pools stack, carry over and refresh; a big enough shield engine
    //   would otherwise soak the ramp forever and the stalemate would persist.
    //   True damage already ignores Armor/Magic Resist; here it also ignores
    //   shields, exactly like poison/bleed and the fatigue backstop.
    // - No card owns it: `ctx.source` is untouched (no `sourceCard`), and
    //   because it runs OUTSIDE `applyCast` there is no CastCtx, so it can never
    //   feed lifesteal, comboBonus or any other rider. `source !== 'skill'` also
    //   keeps negate charges and expose out of it.
    // - Symmetric across both sides => PL-neutral, priced nowhere.
    // - Consumes ZERO random numbers: the Rng call order is unchanged.
    // Deaths flow through `dealDamage` -> `died` -> the shared `checkEnd`, so
    // win/loss (player wins simultaneous deaths, as everywhere else) is coherent.
    if (state.turn >= attritionTurn) {
      const amount = attritionDamage(state.turn, attritionTurn);
      if (!attritionAnnounced) {
        attritionAnnounced = true;
        events.push({ turn: state.turn, kind: 'attritionStart', amount });
      }
      for (const c of units) dealDamage(ctx, c, amount, 'true', { bypassShields: true, source: 'attrition' });
      outcome = checkEnd(state);
      if (outcome !== null) return finish(outcome);
    }

    // Fatigue backstop (whole pool, canonical order — ties go to the player).
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

    // Durations decrement once per gameplay turn.
    for (const c of units) expireStatuses(ctx, c);
    events.push({ turn: state.turn, kind: 'end' });
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
