import { Rng } from '../rng';
import type { CombatConfig, CombatantSetup, CombatOutcome, Side } from '../types';
import type { CombatEvent } from './events';
import { effStat, initCombatState, isTurnDurationed, teamOf, type CombatState, type CombatantState } from './state';
import { scanCast, type CastChoice } from './castSelect';
import { applyCast, dealDamage, targetInfoForCast, type Ctx } from './interpreter';
// `cursorPiece` lives beside the `splash` band it also defines the anchor for
// (combat/splash.ts), so "the card whose turn it is" has ONE definition shared
// by the turn loop and the splash keyword. Behaviour is identical to the local
// copy it replaces.
import { cursorPiece } from './splash';
import { cardType } from './typeIdentity';

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
/** Base unit of the ramp. Turn 15 → 5, 16 → 15, 17 → 30, 20 → 105. */
export const ATTRITION_STEP = 5;

/**
 * Attrition damage on `turn` (0 before the threshold) — ACCELERATING ramp
 * (user-locked 2026-07-31): the per-turn INCREASE itself grows, so a stalemate
 * cannot outlast it. With `T = turn − startTurn + 1` the damage is the T-th
 * triangular number times the step:
 *
 *   `ATTRITION_STEP × T × (T + 1) / 2`
 *
 * → 5, 15, 30, 50, 75, 105, 140, 180 at turns 15..22. `T × (T + 1)` is always
 * even so the halving is exact; `Math.floor` is a defensive no-op that keeps
 * the return integral by construction. No RNG, no floats persisted.
 */
export function attritionDamage(turn: number, startTurn: number = ATTRITION_START_TURN): number {
  if (turn < startTurn) return 0;
  const t = turn - startTurn + 1;
  return Math.floor((ATTRITION_STEP * t * (t + 1)) / 2);
}

/**
 * THE INITIATIVE SCORE — the single quantity the engine uses to say who is ahead
 * on tempo. It is exactly what the turn engine's performer comparison reads
 * (`candidateWins` below is implemented on top of this, so the two can never
 * disagree): banked readiness first, effective Speed as the tiebreak.
 *
 * `readiness` already IS "bank + Speed" at every point after the turn's gain
 * phase, and the "− queued card weight" term of the comparison rule is charged
 * to `readiness` when the card is paid for, so a unit's `readiness` at any
 * moment is the live score. `< 0` means `a` is BEHIND (lower initiative).
 */
function compareInitiative(a: CombatantState, b: CombatantState): number {
  if (a.readiness !== b.readiness) return a.readiness - b.readiness;
  return effStat(a, 'speed') - effStat(b, 'speed');
}

/**
 * What each side brought INTO a potentially-lethal step, measured over the units
 * that were still ALIVE when the step began:
 * - `lowest`: the unit with the LOWEST initiative score — the one attrition
 *   reaches first (see the attrition step's ordering).
 * - `hp`: the side's total HP. At 1v1 this is just the surviving unit's HP.
 * Integers only (the units are referenced, never copied as floats), no RNG.
 */
interface StepEntry {
  playerLowest: CombatantState | null;
  enemyLowest: CombatantState | null;
  playerHp: number;
  enemyHp: number;
}

function stepEntryOf(state: CombatState): StepEntry {
  const entry: StepEntry = { playerLowest: null, enemyLowest: null, playerHp: 0, enemyHp: 0 };
  for (const u of state.playerTeam) {
    if (!u.alive) continue;
    entry.playerHp += u.stats.hp;
    if (entry.playerLowest === null || compareInitiative(u, entry.playerLowest) < 0) entry.playerLowest = u;
  }
  for (const u of state.enemyTeam) {
    if (!u.alive) continue;
    entry.enemyHp += u.stats.hp;
    if (entry.enemyLowest === null || compareInitiative(u, entry.enemyLowest) < 0) entry.enemyLowest = u;
  }
  return entry;
}

/**
 * THE ONE PLACE combat outcome is decided (user-locked 2026-07-31: a fight is
 * ALWAYS decided — there is no draw).
 *
 * FIRST TO FALL LOSES (user-locked 2026-08-04). Every damage in this engine can
 * be said to be dealt or taken FIRST: the fight ends at the exact APPLICATION
 * that wipes a side, and nothing later in the same step ever runs (no DoT tick
 * after the killing blow, no further attrition/fatigue applications). This
 * function is therefore called after every single potentially-lethal application
 * — see `checkEnd` and `sweep` in `simulate` — and one application can only ever
 * damage ONE victim (`dealDamage` takes a single victim), so at most one side can
 * be freshly wiped when it runs.
 *
 * `null` while combat continues; a side is dead when every unit is not alive.
 * A single-side wipe is trivially that side's defeat — and that is now the ONLY
 * reachable case.
 *
 * DEFENSIVE FALLBACK (rules 1-3 below): the both-sides-wiped branches are
 * UNREACHABLE from any current code path — mutual wipes ceased to exist with the
 * 2026-08-04 rule (the supersede is recorded in docs/design-locked.md). They are
 * kept, not deleted, so the function stays total and safe if a future mechanic
 * ever applies damage to two victims simultaneously. When BOTH sides' last units
 * die inside the SAME application, the log's event order must NOT decide it —
 * this fixed hierarchy does, evaluated on the state ENTERING the step:
 *
 *  1. LOWER INITIATIVE SCORE LOSES. Attrition is applied in ASCENDING initiative
 *     score (user-locked), so the side holding the lowest-score unit takes the
 *     killing tick FIRST and therefore reached 0 first. Falling behind on tempo
 *     is what kills you.
 *  2. Equal score → LOWER HP LOSES. Same damage on both, so whoever had less
 *     left truly reached 0 sooner.
 *  3. Score and HP both exactly equal → the PLAYER WINS. The single stated tie
 *     convention, matching the "tie → player performs" initiative rule.
 *
 * Note that `before` holds live references, but every field it reads
 * (`readiness`, Speed) is only mutated by the perform loop — never by the damage
 * of the step being adjudicated — so the comparison sees the entering state.
 */
function decideOutcome(state: CombatState, before: StepEntry): CombatOutcome | null {
  const enemyWiped = state.enemyTeam.every((u) => !u.alive);
  const playerWiped = state.playerTeam.every((u) => !u.alive);
  if (!enemyWiped && !playerWiped) return null;
  if (!playerWiped) return 'win';
  if (!enemyWiped) return 'loss';
  /* c8 ignore start — unreachable defensive fallback (see the doc comment). */
  if (before.playerLowest !== null && before.enemyLowest !== null) {
    const byScore = compareInitiative(before.playerLowest, before.enemyLowest);
    if (byScore !== 0) return byScore < 0 ? 'loss' : 'win';
  }
  if (before.playerHp !== before.enemyHp) return before.playerHp < before.enemyHp ? 'loss' : 'win';
  return 'win'; // dead heat — player-wins convention
  /* c8 ignore stop */
}

/**
 * Outcome for the `maxTurns` safety net, where nobody died. Decided by REMAINING
 * HP FRACTION — higher fraction wins, exact tie → player (same convention as
 * `decideOutcome`). Compared by cross-multiplication so the math stays integral
 * (no float ratios in or near state). With the accelerating attrition ramp this
 * is expected to be unreachable; it exists so `simulate` is total.
 */
function decideOnTimeout(state: CombatState): CombatOutcome {
  let pHp = 0;
  let pMax = 0;
  let eHp = 0;
  let eMax = 0;
  for (const u of state.playerTeam) {
    pHp += Math.max(0, u.stats.hp);
    pMax += u.stats.maxHp;
  }
  for (const u of state.enemyTeam) {
    eHp += Math.max(0, u.stats.hp);
    eMax += u.stats.maxHp;
  }
  // pHp/pMax < eHp/eMax  <=>  pHp*eMax < eHp*pMax (all non-negative integers).
  return pHp * eMax < eHp * pMax ? 'loss' : 'win';
}

/** Flattened, canonically-ordered performance pool: player-side first, then by index. */
function pool(state: CombatState): CombatantState[] {
  return [...state.playerTeam, ...state.enemyTeam];
}

/**
 * The pool re-ordered by ASCENDING INITIATIVE SCORE — lowest score first
 * (user-locked 2026-07-31: attrition reaches whoever is furthest behind on tempo
 * first). Uses `compareInitiative`, the SAME comparison the performer scan uses,
 * so ordering here and turn order can never disagree. Deterministic and stable:
 * an exact score tie keeps canonical pool order (player side first, then unit
 * index) via the explicit `order` fallback, and the sort runs on a copy of an
 * array (never a Map/Set).
 */
function lowestInitiativeFirst(units: CombatantState[]): CombatantState[] {
  const keyed = units.map((unit, order) => ({ unit, order }));
  keyed.sort((a, b) => compareInitiative(a.unit, b.unit) || a.order - b.order);
  return keyed.map((k) => k.unit);
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
 * (there is no `play`). DECAYING model: each tick takes the current stack count
 * in damage, then one stack falls off. Bypasses shields once running (internal
 * bleeding) — but application is blocked by active shields (see applyDot's
 * caller). A `fresh` bleed applied this same turn is skipped until end-of-turn
 * clears its freshness, matching DoT semantics.
 *
 * AT MOST ONCE PER GLOBAL TURN (user-locked 2026-07-31). The resolve loop can
 * give one unit SEVERAL casts inside a single global turn; bleed draws blood only
 * on the FIRST resolved cast of a turn, guarded by `lastBleedTurn` (the same
 * integer-stamp idiom as `PieceState.lastCastTurn`). This makes bleed strictly
 * WEAKER than poison, which ticks every turn unconditionally: a waiting, stunned
 * or mid-span unit still takes no bleed at all, and a fast multi-caster no longer
 * takes one tick per cast. No RNG is consumed, so the Rng call order is unchanged.
 * The stamp is only written when a pile actually ticks, so a unit that never
 * bleeds keeps a byte-identical (stamp-free) final state.
 */
function tickBleed(ctx: Ctx, c: CombatantState): void {
  if (c.lastBleedTurn === ctx.state.turn) return; // already bled this global turn
  const remaining: typeof c.statuses = [];
  for (const status of c.statuses) {
    if (status.kind !== 'bleed' || status.fresh) {
      remaining.push(status);
      continue;
    }
    c.lastBleedTurn = ctx.state.turn;
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

/**
 * Decrement every GLOBAL-TURN duration at turn end; clear freshness.
 *
 * The set of kinds this owns is `TURN_DURATIONED_STATUS_KINDS` (state.ts), which
 * also documents the mechanism that expires each of the OTHER kinds — DoTs and
 * thorns decay by stacks, stun by performances, negate/ward by charges. It is a
 * named list rather than an inline `!==` chain because a kind silently belonging
 * to no mechanism is invisible in a chain: `expose` sat in that gap and never
 * expired at all.
 */
function expireStatuses(ctx: Ctx, c: CombatantState): void {
  const remaining: typeof c.statuses = [];
  for (const status of c.statuses) {
    if (status.fresh) {
      delete status.fresh;
      remaining.push(status);
      continue;
    }
    if (!isTurnDurationed(status.kind)) {
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

/**
 * Close every `curse` window that lapses at the end of THIS turn (see
 * `PieceState.curse`, combat/state.ts) — the card-scope counterpart of
 * `expireStatuses` above, and the ONLY place a curse is ever removed.
 *
 * WHY IT LIVES BESIDE `expireStatuses` RATHER THAN IN THE CAST PATH: a curse is
 * a GLOBAL-TURN duration like `expose`/`guard`, so the turn boundary is the
 * only honest place to end it. It is also what keeps `resolveAuras` (which
 * folds a live curse into `mods.damageFlat`) free of any turn argument: if the
 * field exists, the curse is live, because a lapsed one was deleted here.
 *
 * `state.turn >= expiresAtTurn`, with `expiresAtTurn = applyTurn + turns`: a
 * curse applied on turn T with `turns: 1` covers the rest of T and all of T+1
 * and is gone at the start of T+2 — the same window a `fresh` 1-turn status
 * gets from `addStatus` + `expireStatuses`.
 *
 * ONE EVENT PER UNIT, listing every slot that lapsed on this tick in ascending
 * order (`pieces` is slot-sorted, so the index walk yields that for free), and
 * NO event when nothing lapsed — so a board with no curse on it emits exactly
 * what it emitted before this keyword existed. `delete`, never `= undefined`,
 * for the reason `PieceState.curse` documents. Integer compares only, no RNG.
 */
function expireCurses(ctx: Ctx, c: CombatantState): void {
  const lapsed: number[] = [];
  for (let i = 0; i < c.pieces.length; i += 1) {
    const piece = c.pieces[i]!;
    if (piece.curse === undefined) continue;
    if (ctx.state.turn < piece.curse.expiresAtTurn) continue;
    delete piece.curse;
    lapsed.push(piece.slot);
  }
  if (lapsed.length > 0) {
    ctx.events.push({ turn: ctx.state.turn, kind: 'curseExpired', side: c.side, unit: c.index, slots: lapsed });
  }
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

/** Higher initiative score performs (see `compareInitiative`; ties keep the incumbent). */
function candidateWins(a: { unit: CombatantState }, b: { unit: CombatantState }): boolean {
  return compareInitiative(a.unit, b.unit) > 0;
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

  // Every potentially-lethal step is bracketed by `beginStep()` (records the HP
  // each side brings INTO the step) and `checkEnd()` (asks the single
  // `decideOutcome` helper whether the fight is over). Nothing else in the loop
  // knows how a winner is chosen.
  let stepEntry: StepEntry = stepEntryOf(state);
  const beginStep = (): void => {
    stepEntry = stepEntryOf(state);
  };
  const checkEnd = (): CombatOutcome | null => decideOutcome(state, stepEntry);

  /**
   * FIRST TO FALL LOSES (user-locked 2026-08-04) — the sweep primitive.
   *
   * A sweep (burn, poison, attrition, fatigue) is an ORDERED sequence of per-unit
   * applications, and each unit's application is exactly one potentially-lethal
   * event. So the check runs after EVERY application and the sweep STOPS at the
   * one that wipes a side: the remaining units are never reached, so no DoT tick,
   * attrition tick or fatigue tick lands after the killing blow.
   *
   * `order` is computed by the caller BEFORE the sweep starts (canonical pool
   * order, or `lowestInitiativeFirst` for attrition) and is never re-derived
   * mid-sweep, so the application order is exactly the one the rules document.
   * Consumes ZERO random numbers (nothing in the combat loop does — see the
   * determinism test), so truncating a sweep cannot shift the Rng call order:
   * the surviving prefix makes the identical (empty) sequence of draws.
   */
  const sweep = (order: CombatantState[], apply: (c: CombatantState) => void): CombatOutcome | null => {
    for (const c of order) {
      apply(c);
      const decided = checkEnd();
      if (decided !== null) return decided;
    }
    return null;
  };

  let outcome = checkEnd();
  if (outcome !== null) return finish(outcome);

  while (state.turn < maxTurns) {
    state.turn += 1;

    const units = pool(state);

    // Start-of-turn effects resolve before readiness so dead units never gain.
    // Only BURN ticks here; poison ticks at the end of the turn. Swept in
    // canonical order, one unit at a time, stopping at the tick that wipes a side
    // (FIRST TO FALL LOSES — see `sweep`).
    beginStep();
    outcome = sweep(units, (c) => tickTurnDot(ctx, c, 'burn'));
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
      beginStep(); // this performance is one lethal step
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
        // here, right after this cast's own effects, before the cost event — and
        // AT MOST ONCE PER GLOBAL TURN, so a unit that resolves two casts in one
        // turn bleeds only on the first (see tickBleed).
        //
        // FIRST TO FALL LOSES (user-locked 2026-08-04): the cast's own resolution
        // is the earlier application of the two, so if it already wiped a side the
        // fight ended THERE and this bleed never draws blood. The check is
        // read-only (`decideOutcome` emits nothing) and we deliberately do NOT
        // return here: `cost`/`cursor` are bookkeeping, not applications, so they
        // still emit exactly as before and the fight is finished by the
        // `checkEnd()` at the end of this performance — which keeps every log that
        // ends on a killing cast byte-identical.
        if (checkEnd() === null) tickBleed(ctx, c);
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
        // SLOW, half one: the tax hit exactly ONE card — this one — and the
        // `cost` event just above paid it (castSelect folded it into
        // `choice.weight`), so it is spent here. Half two is the end-of-turn
        // clear at the bottom of the turn loop, which drops it whether or not
        // it was ever paid (user-locked 2026-08-18); the two together mean a
        // slow can never outlive the turn it landed on, so nothing accumulates
        // and no clamp is needed.
        c.nextWeightPenalty = 0;
        // CARD-scope sibling of the line above (`burden`): the tax rides ONE
        // piece and is spent by THAT piece's next play — the `cost` event just
        // above paid it (castSelect folded it into `choice.weight`), so it is
        // consumed here, exactly once, at the one site where a cast really
        // resolves. Speculative `scanCast` calls only READ it.
        //
        // DELETED, not set to 0 and not set to `undefined`: the field is lazily
        // written so an un-burdened piece carries no key at all (see
        // `PieceState`). A 0 would survive `JSON.stringify` and move every
        // outcome-baseline hash; assigning `undefined` leaves `hasOwnProperty`
        // true, which `JSON.stringify` hides but `toStrictEqual`, `Object.keys`
        // and structured-clone all see. `delete` restores the piece to the exact
        // shape it had before it was ever burdened.
        delete choice.piece.nextWeightPenalty;
        c.lastCastArchetypes = choice.skill.archetypes;
        // THE PREVIOUS CAST'S TYPE, for `chainBonus` — stamped beside the
        // archetypes it is the type-axis twin of, from the same resolved skill, so
        // the two can never disagree about what "the previous cast" was. Only
        // assigned when the card HAS a type (`cardType` returns undefined for an
        // untyped card, reachable only via a bespoke test book), which keeps the
        // key absent rather than set to undefined in that case.
        const castType = cardType(choice.skill);
        if (castType !== undefined) c.lastCastType = castType.type;
        playsThisTurn += 1;
        played.add(c);
        const pieces = playedPieces.get(c) ?? new Set<CombatantState['pieces'][number]>();
        pieces.add(choice.piece);
        playedPieces.set(c, pieces);
        if (choice.piece.size > 1) blocked.add(c);
      }
      outcome = checkEnd();
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
    // still flagged and skips — expireStatuses below clears the flag. Swept one
    // unit at a time in canonical order, stopping at the tick that wipes a side.
    beginStep();
    outcome = sweep(units, (c) => tickTurnDot(ctx, c, 'poison'));
    if (outcome !== null) return finish(outcome);

    // ATTRITION — global stalemate breaker, one clearly-bounded turn step (the
    // only place in the loop that knows about it). From `attritionTurn` on,
    // EVERY living combatant takes ACCELERATING TRUE damage, applied in
    // ASCENDING INITIATIVE SCORE — lowest first (user-locked 2026-07-31: falling
    // behind on tempo is what kills you). The score is the very same
    // banked-readiness-then-Speed comparison the performer scan uses
    // (`compareInitiative`); exact ties keep canonical pool order (player side
    // first, then unit index) so the sort is stable.
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
    // Deaths flow through `dealDamage` -> `died` -> the shared `checkEnd` after
    // EVERY single tick (FIRST TO FALL LOSES, user-locked 2026-08-04): the sweep
    // stops at the tick that wipes a side, so the units later in the order — the
    // ones further AHEAD on tempo — are never reached that turn. The side holding
    // the lowest-score unit is therefore the side that falls, which is exactly
    // what the old mutual-wipe hierarchy said; it is now a consequence of the
    // application order instead of a separate rule.
    if (state.turn >= attritionTurn) {
      const amount = attritionDamage(state.turn, attritionTurn);
      if (!attritionAnnounced) {
        attritionAnnounced = true;
        events.push({ turn: state.turn, kind: 'attritionStart', amount });
      }
      beginStep();
      outcome = sweep(lowestInitiativeFirst(units), (c) => {
        dealDamage(ctx, c, amount, 'true', { bypassShields: true, source: 'attrition' });
      });
      if (outcome !== null) return finish(outcome);
    }

    // Fatigue backstop, swept in canonical pool order (player side first, then by
    // index) — and, like every other sweep, it STOPS at the tick that wipes a side
    // (FIRST TO FALL LOSES, user-locked 2026-08-04). Consequence worth stating
    // plainly: in a perfectly mirrored fight the player's unit is first in
    // canonical order, so it is the one that falls. Fatigue no longer "kills both
    // and gives the tie to the player" — there is no tie left to give.
    if (state.turn >= fatigueTurn) {
      if (!fatigueAnnounced) {
        fatigueAnnounced = true;
        events.push({ turn: state.turn, kind: 'fatigueStart' });
      }
      const amount = FATIGUE_BASE + (state.turn - fatigueTurn);
      beginStep();
      outcome = sweep(units, (c) => {
        dealDamage(ctx, c, amount, 'true', { bypassShields: true, source: 'fatigue' });
      });
      if (outcome !== null) return finish(outcome);
    }

    // Durations decrement once per gameplay turn.
    for (const c of units) expireStatuses(ctx, c);
    // CARD-SCOPE durations, same tick, same canonical unit order: a `curse`
    // window that ends with this turn is closed here (`expireCurses`), which is
    // the only place a curse is ever removed. It runs AFTER the resolve loop for
    // the same reason the slow clear below does — a curse landed early in the
    // turn still softens a victim that casts later in that same turn — and
    // emits a `curseExpired` event only for units that actually had one lapse.
    for (const c of units) expireCurses(ctx, c);
    // SLOW EXPIRES WITH THE TURN IT LANDED ON (user-locked 2026-08-18): "a slow
    // is only applied to that 1 card and doesn't stay — after the turn it was
    // applied on, the slow effect is removed". A slow applied during turn N can
    // therefore only tax what its victim plays during turn N; at the start of
    // N+1 it is gone, PAID OR NOT. A victim who is stunned, busy mid-span,
    // waiting on cooldown, or simply cannot afford the taxed weight carries
    // NOTHING forward.
    //
    // WHY HERE, and not where the tax is consumed. The old rule cleared the
    // field only in the perform path (`c.nextWeightPenalty = 0` after `cost`),
    // which is a "until you next act" lifetime, not a turn lifetime: a victim
    // too slow to pay kept the tax indefinitely and every fresh slow `Math.max`ed
    // on top of a debt it had never discharged — an observed lockout of 5
    // performances in 40 turns. An end-of-turn rule belongs in the turn loop.
    //
    // ORDERING, deliberately: AFTER the resolve loop (so a slow landed early in
    // the turn still taxes a victim that performs later in that same turn, and
    // the `cost` event still pays the inflated weight), AFTER the `wait`
    // explanation pass (so a `cantAfford` line still reports the taxed weight
    // that actually stopped the unit this turn), and beside `expireStatuses`
    // because this IS a global-turn duration — the same tick that decrements
    // every other turn-durationed effect. It reads and writes one integer per
    // unit, consumes no RNG, emits no event (the `end` event immediately below
    // already marks the boundary — playback that shadow-tracks the pending tax
    // must drop it there too) and iterates `units` by index order.
    for (const c of units) c.nextWeightPenalty = 0;
    events.push({ turn: state.turn, kind: 'end' });
  }

  // The `maxTurns` safety net. Nobody died, so there is no "who hit 0 first" to
  // read: decide on remaining HP fraction (see `decideOnTimeout`). With the
  // accelerating attrition ramp this is unreachable for any plausible HP pool —
  // it exists only so `simulate` is total and never returns a draw.
  return finish(decideOnTimeout(state));
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
