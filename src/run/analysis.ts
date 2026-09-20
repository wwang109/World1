// Balance analysis — REAL simulated combat metrics (no estimates/formulas).
//
// `damagePerTurn` and `outputPerTurn` share ONE simulation rig (`runAndBucket`
// below): run `simulate()` against an inert training dummy for `turns` turns,
// across a deterministic seed sweep kept as a harmless no-op guard (combat has
// been fully deterministic since crit was removed 2026-07-23 — a future
// stochastic effect would make the sweep meaningful again), and bucket every
// counted event by the `turn` it landed on. There is exactly ONE `simulate()`
// call per seed; every reported number below comes from summing that SAME
// bucketed array — never from a separate re-simulation per cutoff.
//
// SPEC + RANGE (2026-09-13): a single flat average over the whole window
// hides the difference between a low-cooldown opener (huge on turn 1, nothing
// after) and a slow size-3 card (nothing on turn 1, ramping steadily) — both
// can average the same over ten turns. So `outputPerTurn`'s three axes each
// report:
//   - `spec` — the per-turn average through SPEC_TURN turns:
//     `cumulative output through turn SPEC_TURN / SPEC_TURN`. This is the
//     headline number.
//   - `min`/`max` — the lowest and highest per-turn average taken at EVERY
//     cutoff T from RANGE_MIN_TURN through `turns`
//     (`avgAtT = cumulative output through turn T / T`).
// `spec` is always one of the swept `avgAtT` values (T = SPEC_TURN), so
// `min <= spec <= max` always holds by construction.
//
// `damagePerTurn` PREDATES this model and does NOT use it (2026-09-13 fix): it
// keeps its original HEAD-era band — see its own doc comment below — because
// it feeds the LIVE prep-scene "DMG/turn" readout (`DesktopPrepScene.ts`,
// `DesktopRunPrepScene.ts`, `MobilePrepScene.ts`, all calling
// `{turns:8, seeds:8}`) and `functions/damage-band.ts`'s `/damage-band` route.
// An earlier draft of this file collapsed `damagePerTurn` into the spec/range
// band, which quietly changed the live number for every enemy (58/58 changed
// at L5; 33/58 gained a nonsense `0` lower bound) — it is now decoupled again.
// The two functions still share ONE simulation rig (`runAndBucket`); they
// just read different shapes out of it.
//
// Why a dummy (not the live opponent): this is an INTRINSIC throughput stat for
// comparing builds/enemies on equal footing (armor, matchups, and the
// opponent's shields/heals are separate axes). The dummy has no board, so it
// never performs — which also means sudden-death (needs BOTH sides to perform)
// never triggers, keeping the number a steady-state output rather than a
// ramp-inflated one. Cooldowns stay ON to match real play.
//
// FOUR COUNTING CONVENTIONS (`outputPerTurn`'s healing/shield axes;
// `damagePerTurn`'s damage rule is unchanged from before this file existed):
//   - damage: `e.kind === 'damage' && e.side === 'enemy'` — the dummy sits on
//     enemyTeam, so every hit landing there is output the measured combatant
//     (on playerTeam) produced. Counts direct hits AND poison/burn/bleed ticks.
//   - healing: GROSS — `e.amount + e.overheal` for `e.kind === 'heal' &&
//     e.side === 'player'`. The dummy never damages the measured combatant, so
//     a full-HP unit overheals 100% of every heal cast on it; counting only the
//     effective (post-overheal) amount would read a healer as 0 output. Same
//     convention `cardContributions` uses in `logAnalysis.ts`.
//   - shield: GRANTED — `e.amount + e.wasted` for `e.kind === 'shieldGain' &&
//     e.side === 'player'`. Nothing ever spends the plating (the dummy never
//     attacks), so the shield pool saturates at `maxHp` (`room` in
//     `interpreter.ts`'s `shield`/`attunedShield` arms) and every cast after
//     that reports `amount: 0, wasted: <full request>`. Counting the granted
//     (pre-waste) request keeps the number linear instead of silently capping
//     at maxHp the moment a shield-focused board casts more than once.
//   - shield EXCLUDES overheal conversions (2026-09-13 fix): a `shieldGain`
//     with `overheal: true` (`interpreter.ts`'s heal-overflow-to-plating
//     rider, emitted per `events.ts`'s `overheal?: true` discriminator) is
//     skipped on this axis entirely. Those points were already REQUESTED by a
//     heal card and are already counted in full by the healing bullet above
//     (`amount + overheal` counts the overflow itself, before any
//     conversion); counting the same points again as granted shield
//     double-counts them across two axes and inflates any total that sums
//     both. `FIGHT_HERO_BOARD=sanctuary_overflow` shows this concretely: a
//     15-point heal request that fully overheals converts 12 of those same
//     points to plating — the healing axis already holds all 15, so the
//     shield axis only ever counts plating GRANTED BY A CARD's own
//     `shield`/`attunedShield` action, never a heal's leftover.
//
// Pure, deterministic (fixed seed set + fixed turn window), no RNG of its own,
// no Phaser.
//
// CONFIGURABLE DUMMY (2026-09-14): the inert dummy below has zero armor,
// zero magicResist, and never acts — which makes a whole CLASS of cards read
// as zero output no matter how well they work. A `debuffStat` shred
// (`armor_break` halves Armor, `frostbind_litany` cuts magicPower/
// magicResist) has nothing to reduce against a zero-stat target; a
// `slow`/`stun`/`disrupt` denies an enemy action that was never going to
// happen anyway. `outputPerTurn` (only — see `OutputPerTurnOpts` below)
// accepts a partial stat override for the dummy so a shred/disrupt card can
// be measured against a target that actually HAS the thing it removes, by
// A/B-ing `outputPerTurn`'s damage axis with and without the card against an
// armored dummy. Self-buffs and combo riders (`comboBonus`, `chainBonus`,
// `stackBonus`, `exploit`) already show up as a damage delta against the
// zero-defense default; they don't need this. Omitting the override
// reproduces today's exact numbers — see `damagePerTurn`'s own doc comment
// for why THAT function never takes one.
//
// `expose` AND `shieldBreak` ARE NOT ARMOR/MR SHREDS (2026-09-14, third audit
// correction — this comment previously grouped both here, which was wrong).
// `expose` (`ruinous_hex`) is a damage AMPLIFIER applied AFTER Armor/Magic
// Resist have already been subtracted (`exposeBonus`,
// `src/engine/combat/events.ts` — "the mirror of guardReduction"), so it
// fires at full strength even against `armor: 0`; no dummy override is
// needed. `shieldBreak` (`shield_splitter`, `gutting_cleave`, ...) strips the
// VICTIM's SHIELD pool (`KEYWORD_TEXT.shieldBreak`), not armor or
// magicResist — and this dummy has no `shield` override at all (it is a
// `CombatantStats` partial; shields are combat STATE, not a stat) and never
// casts, so there is currently no way to give it shield for a `shieldBreak`
// card to strip through this rig. See `scripts/enemyOutput.ts`'s own
// "CONFIGURABLE DUMMY" header section for the `npm run fight` logs that
// prove both of these live.

import { simulate } from '../engine/combat/simulate';
import type { CombatantSetup, CombatantStats, SkillBook } from '../engine/types';

/**
 * An inert, effectively-immortal target: no board (never attacks), no
 * defenses by default. `overrides` replaces individual stats (e.g. `{armor:
 * 20}`) — every field not named keeps its inert default, so an absent
 * `overrides` (or `{}`) is byte-identical to the pre-2026-09-14 fixed dummy.
 */
function trainingDummy(overrides?: Partial<CombatantStats>): CombatantSetup {
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
      ...overrides,
    },
    boardSize: 1,
    pieces: [],
  };
}

/**
 * Headline cutoff for `spec` — mid-fight: past a single opening burst, but
 * without handing a slow ramp the whole window to pay off. Clamped to
 * `turns` when the caller's window is shorter than this.
 */
const SPEC_TURN = 5;
/** Sweep floor — turn 1 catches a burst opener at its single-turn peak. */
const RANGE_MIN_TURN = 1;

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
  /** Turns to simulate per run, and the sweep's top cutoff (default 10). */
  turns?: number;
  /** Distinct seeds to average over (default 16); vestigial now that combat is deterministic. */
  seeds?: number;
}

/** One axis's spec/range band — see the file header for what each field means. */
export interface OutputAxisBand {
  spec: number;
  min: number;
  max: number;
}

export interface OutputPerTurn {
  damage: OutputAxisBand;
  healing: OutputAxisBand;
  shield: OutputAxisBand;
  /** Turns simulated per run (also the sweep's top cutoff). */
  turns: number;
}

/**
 * Integer-coerce one `opts` field so it's always safe to use as an array
 * length (`runAndBucket` allocates `new Array<number>(turns/seeds)`, which
 * THROWS `RangeError: Invalid array length` on a non-integer). Non-finite
 * input (`NaN`, `Infinity`) falls back to `fallback` instead of propagating,
 * then the result is clamped to >= 1 same as before.
 *
 * DELIBERATE CONTRACT CHANGE FROM HEAD (2026-09-14, third audit pass, MINOR
 * 8) — `functions/damage-band.ts` and `server/battleApi.ts` feed this
 * function an UNAUTHENTICATED request body's `opts` verbatim (see
 * `DamageProfileOpts`'s own doc comment), so a caller can send literally any
 * JSON value here, not only an integer. Verified against HEAD (byte-identical
 * for every INTEGER opts value, 1770/1770 checked): a NON-integer used to be
 * a different, worse contract — `{turns: 2.5}` echoed the fractional `2.5`
 * straight through unrounded (no array was ever sized by it), and
 * `{turns: null}` produced a response with `avg: null` (an arithmetic
 * division by a non-number, JSON-serialized). Both are INTENTIONALLY
 * different now: `{turns: 2.5}` rounds to `turns: 3` and is genuinely
 * simulated for 3 whole turns, and `{turns: null}` falls back to the
 * DEFAULT (10) and returns a real band, never `null`. This is a hardening of
 * an unauthenticated numeric-ish input, not an accidental behavior drift —
 * every caller that has ever sent an integer opts value (the live prep-scene
 * HUD, `npm run sim`) reads exactly what it read before.
 */
function resolveCount(value: number | undefined, fallback: number): number {
  const raw = value ?? fallback;
  const finite = Number.isFinite(raw) ? raw : fallback;
  return Math.max(1, Math.round(finite));
}

function resolveOpts(opts: DamageProfileOpts): { turns: number; seeds: number } {
  return { turns: resolveCount(opts.turns, 10), seeds: resolveCount(opts.seeds, 16) };
}

/** Per-turn bucketed totals (index 0 = turn 1), summed across every seed in the sweep. */
interface TurnBuckets {
  damage: number[];
  healing: number[];
  shield: number[];
  /**
   * Per-seed TOTAL damage over the whole `turns` window (index 0 = seed 1),
   * kept alongside the per-turn buckets above SOLELY so `damagePerTurn` can
   * reconstruct HEAD's per-seed min/max extremes without a second
   * `simulate()` path. `outputPerTurn`'s axes never read this — they sweep
   * cutoffs over the cross-seed-summed per-turn buckets instead.
   */
  damagePerSeedTotal: number[];
  /**
   * True if the training dummy's own `died` event fired within the `turns`
   * window on ANY seed (2026-09-14 audit fix). The dummy defaults to
   * `maxHp: 10_000_000` and can never die — but a `--dummy hp:10`-class
   * override (`OutputPerTurnOpts.dummy`) CAN kill it mid-window, which
   * silently truncates the simulated window (the engine still returns
   * events, just fewer of them) and UNDERCOUNTS steady-state output with no
   * error. Read off the engine's own `died` event, never inferred from a
   * second HP-tracking implementation.
   */
  dummyDied: boolean;
}

/**
 * Run the shared dummy rig ONCE PER SEED and bucket every counted event by the
 * turn it landed on. This is the ONE simulation path both `damagePerTurn` and
 * `outputPerTurn` read from — every cutoff in the spec/range sweep, and every
 * per-seed total `damagePerTurn` needs, is derived from summing THIS SAME
 * array, never from re-simulating per cutoff or per axis.
 *
 * `dummyOverrides` is threaded straight to `trainingDummy` — `damagePerTurn`
 * never passes one (undefined -> the inert default, unchanged); only
 * `outputPerTurn` exposes it (see `OutputPerTurnOpts`).
 */
function runAndBucket(
  setup: CombatantSetup,
  skillBook: SkillBook,
  turns: number,
  seeds: number,
  dummyOverrides?: Partial<CombatantStats>,
): TurnBuckets {
  const damage = new Array<number>(turns).fill(0);
  const healing = new Array<number>(turns).fill(0);
  const shield = new Array<number>(turns).fill(0);
  const damagePerSeedTotal = new Array<number>(seeds).fill(0);
  let dummyDied = false;

  for (let seed = 1; seed <= seeds; seed++) {
    const { events } = simulate(
      {
        playerTeam: [setup],
        enemyTeam: [trainingDummy(dummyOverrides)],
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

    let dealtThisSeed = 0;
    // Every event carries `turn` (1..maxTurns) — see `CombatEvent` in
    // `combat/events.ts`; the bounds check is defensive only.
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      const idx = e.turn - 1;
      if (idx < 0 || idx >= turns) continue;
      if (e.kind === 'damage' && e.side === 'enemy') {
        damage[idx] = damage[idx]! + e.amount;
        dealtThisSeed += e.amount;
      } else if (e.kind === 'heal' && e.side === 'player') {
        healing[idx] = healing[idx]! + e.amount + e.overheal;
      } else if (e.kind === 'shieldGain' && e.side === 'player' && e.overheal !== true) {
        // `overheal === true` is a heal's overflow converted to plating — see
        // the file header's fourth counting convention. Those points are
        // already counted whole on the healing axis above; skip them here or
        // they land on both axes at once.
        shield[idx] = shield[idx]! + e.amount + e.wasted;
      } else if (e.kind === 'died' && e.side === 'enemy' && e.unit === 0) {
        dummyDied = true;
      }
    }
    damagePerSeedTotal[seed - 1] = dealtThisSeed;
  }
  return { damage, healing, shield, damagePerSeedTotal, dummyDied };
}

/**
 * Cumulative-sweep one axis's bucket array into its spec/range band.
 * `avgAtT = (cumulative bucket sum through turn T) / (seeds * T)`, swept for
 * every T from RANGE_MIN_TURN through `turns`; `spec` is the value at
 * T = min(SPEC_TURN, turns) — a window shorter than SPEC_TURN clamps to its
 * own last turn rather than reading past the window.
 */
function bandOf(buckets: readonly number[], turns: number, seeds: number): OutputAxisBand {
  const specTurn = Math.min(SPEC_TURN, turns);
  let cum = 0;
  let min = Infinity;
  let max = -Infinity;
  let spec = 0;
  // `cum` accumulates from turn 1 UNCONDITIONALLY — RANGE_MIN_TURN gates only
  // which cutoffs are eligible to move `min`/`max` (the sweep floor), never
  // which turns' output get folded into the running total. Sharing one loop
  // bound for both used to mean any RANGE_MIN_TURN > 1 would silently drop
  // turns `1..RANGE_MIN_TURN-1` from `cum` too — including whatever `spec`
  // (T = SPEC_TURN) reads, since specTurn >= RANGE_MIN_TURN was never
  // guaranteed. No live defect (RANGE_MIN_TURN = 1 today), but latent.
  for (let t = 1; t <= turns; t++) {
    cum += buckets[t - 1] ?? 0;
    const avgAtT = cum / (seeds * t);
    if (t >= RANGE_MIN_TURN) {
      if (avgAtT < min) min = avgAtT;
      if (avgAtT > max) max = avgAtT;
    }
    if (t === specTurn) spec = avgAtT;
  }
  return {
    spec: Math.round(spec),
    min: Math.round(min === Infinity ? 0 : min),
    max: Math.round(max === -Infinity ? 0 : max),
  };
}

/**
 * Average (and low–high) damage this combatant DEALS per turn, measured by
 * simulating it against an inert dummy over `turns` turns across `seeds`
 * seeds. HEAD's ORIGINAL semantics, unchanged by the spec/range model added
 * to `outputPerTurn` below (2026-09-13): `avg` is the total damage dealt
 * across the WHOLE `turns` window, averaged over both turns and seeds;
 * `min`/`max` are the lowest/highest PER-SEED per-turn (whole-window)
 * average — this collapses to a single value equal to `avg` while combat
 * stays fully deterministic across seeds (it does today; see the file
 * header). This function feeds the LIVE prep-scene "DMG/turn" readout and
 * `functions/damage-band.ts`'s `/damage-band` route, so its numbers must
 * never move for the sake of `outputPerTurn`'s cutoff-sweep band — it shares
 * `runAndBucket`'s ONE simulation pass but reads the per-seed totals, not the
 * cumulative-cutoff sweep. Counts every point it removes — direct hits AND
 * poison/burn/bleed ticks.
 */
export function damagePerTurn(setup: CombatantSetup, skillBook: SkillBook, opts: DamageProfileOpts = {}): DamageBand {
  const { turns, seeds } = resolveOpts(opts);
  const { damagePerSeedTotal } = runAndBucket(setup, skillBook, turns, seeds);

  let total = 0;
  let min = Infinity;
  let max = 0;
  for (let s = 0; s < seeds; s++) {
    const dealt = damagePerSeedTotal[s] ?? 0;
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

/**
 * `outputPerTurn`'s own opts — `DamageProfileOpts` PLUS the dummy override.
 * Deliberately NOT folded into the shared `DamageProfileOpts` that
 * `damagePerTurn` also takes: `functions/damage-band.ts` and
 * `server/battleApi.ts` cast an UNAUTHENTICATED request body straight into
 * `DamageProfileOpts` with no validation (see their own comments), and only
 * `damagePerTurn` is wired to that route. Widening the shared type would
 * widen that public route's input surface for a knob it never asked for and
 * never validates; `outputPerTurn` is script-only today (`npm run output`),
 * so its own opts type carries the extra field instead.
 */
export interface OutputPerTurnOpts extends DamageProfileOpts {
  /** Override the training dummy's stats — see the file header's "CONFIGURABLE DUMMY" note. */
  dummy?: Partial<CombatantStats>;
}

/**
 * Per-turn damage/healing/shield this combatant produces, each as a
 * spec/range band — see the file header for the four counting conventions
 * and the spec/range mechanism. Same dummy rig as `damagePerTurn`, same one
 * simulation path (`runAndBucket`).
 */
export function outputPerTurn(setup: CombatantSetup, skillBook: SkillBook, opts: OutputPerTurnOpts = {}): OutputPerTurn {
  const { turns, seeds } = resolveOpts(opts);
  const buckets = runAndBucket(setup, skillBook, turns, seeds, opts.dummy);
  return {
    damage: bandOf(buckets.damage, turns, seeds),
    healing: bandOf(buckets.healing, turns, seeds),
    shield: bandOf(buckets.shield, turns, seeds),
    turns,
  };
}

/**
 * `outputPerTurnRawTotals`'s own shape — deliberately a SEPARATE export, not a
 * new field on `OutputPerTurn`/`OutputAxisBand` (2026-09-14 audit fix). Adding
 * a field there would break every `toEqual({ spec, min, max })` exact-shape
 * pin across `tests/run/analysis.test.ts` for a knob those tests never asked
 * for; a new export leaves `OutputPerTurn`'s existing fields, and every
 * pinned call to `outputPerTurn`/`damagePerTurn`, byte-identical.
 */
export interface OutputPerTurnRawTotals {
  /** Raw (un-rounded, un-averaged-per-seed) cumulative total through `specTurn`. */
  damage: number;
  healing: number;
  shield: number;
  /** The cutoff actually summed through (== min(SPEC_TURN, turns), same as `OutputAxisBand.spec`'s own cutoff). */
  specTurn: number;
  /** The full simulated window (`resolveOpts`'s own `turns`), for `dummyDied`'s message. */
  turns: number;
  /**
   * True if a `--dummy`-class override made the training dummy die within
   * `turns` (2026-09-14 audit fix, Minor 5). A dead dummy silently truncates
   * the simulated window and undercounts steady-state output with no error —
   * this flag is what lets a caller (`scripts/enemyOutput.ts`) warn instead of
   * reporting the truncated numbers as if they were the full window's.
   */
  dummyDied: boolean;
}

/**
 * The EXACT cumulative total each axis reaches through the SPEC window,
 * before `bandOf` divides by `seeds * specTurn` and rounds — i.e. `bandOf`'s
 * own `cum` at `t = specTurn`, collapsed back to a single run (divided by
 * `seeds`; exact today because combat is fully deterministic across the seed
 * sweep — see the file header — so every seed's bucket is identical and the
 * division has no remainder).
 *
 * WHY THIS EXISTS: `OutputAxisBand.spec` is `Math.round(rawTotal / specTurn)`
 * — a delta of "+2" on that rounded per-turn figure can hide a much smaller
 * (or larger) real swing in the raw total once SPEC_TURN=5 is factored back
 * in (1 spec point ~= 5 raw points at the default window). Exists so
 * `scripts/enemyOutput.ts`'s DELTA mode can print the underlying totals
 * alongside the coarser per-turn figure. Runs the SAME `runAndBucket` rig
 * `outputPerTurn` does (same inputs -> same buckets) — a second simulation
 * PASS for a different axis of precision, not a reimplementation of
 * `outputPerTurn`'s own math, and it changes nothing about `OutputPerTurn`'s
 * shape or return value.
 */
export function outputPerTurnRawTotals(
  setup: CombatantSetup,
  skillBook: SkillBook,
  opts: OutputPerTurnOpts = {},
): OutputPerTurnRawTotals {
  const { turns, seeds } = resolveOpts(opts);
  const buckets = runAndBucket(setup, skillBook, turns, seeds, opts.dummy);
  const specTurn = Math.min(SPEC_TURN, turns);
  const sumThrough = (arr: readonly number[]): number => {
    let sum = 0;
    for (let t = 0; t < specTurn; t++) sum += arr[t] ?? 0;
    return Math.round(sum / seeds);
  };
  return {
    damage: sumThrough(buckets.damage),
    healing: sumThrough(buckets.healing),
    shield: sumThrough(buckets.shield),
    specTurn,
    turns,
    dummyDied: buckets.dummyDied,
  };
}

// Per-card contribution report moved to `logAnalysis.ts` — it is a pure fold
// over an event log and must stay importable WITHOUT pulling in simulate().
export { cardContributions, type CardContribution } from './logAnalysis';
// Per-fight stats-ledger delta — same "pure fold, no simulate()" reasoning.
export { battleStatsFromEvents, type BattleStatsDelta } from './logAnalysis';
