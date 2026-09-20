// Per-turn output summary for a CONFIGURED enemy — damage, healing, shield.
//
//   npm run output -- giant_rat        (enemy at level 1, its default title)
//   npm run output -- cleric 5         (Cleric at level 5)
//
// Resolves the enemy through the REAL production path (`resolveEncounterForEnemy`,
// `src/run/encounter.ts`) at its natural title (`defaultTitleFor` — boss/elite/
// normal), so growth, rank, title, and level stat scaling are all applied
// exactly as they are in a real fight. Then runs it through `outputPerTurn`
// (`src/run/analysis.ts`) — the SAME dummy-rig simulation `damagePerTurn`
// uses — and prints the three output axes plus the resolved board (piece list
// + tiers) and stats that produced them.
//
// THE STATS ARE NOT THE STORY (2026-09-13 audit correction): base enemy stats
// are 1/1/1/1 for nearly every roster entry, and `scaleMonsterToLevel` spends
// a level's PL budget on the BOARD (extra pieces, tier-ups) rather than stats
// until roughly L20 — Cleric L5's 17 heal/turn is `64+1, 4+1, 14+1`, MRES
// contributing 3 of 85 raw points (3.5%). The real differentiator between,
// say, `giant_rat` L2 and `cleric` L5 is the PIECE LIST (3 bronze vs. 1
// silver + 3 bronze) — invisible if this script only prints stats — so the
// piece list below is the primary read; the stat lines are secondary context.
//
// THIS ENTIRE SECTION IS THE ENEMY-ID PATH — its numbers are the real,
// production-resolved encounter and are unaffected by anything below.
//
// ARBITRARY BOARD (2026-09-14) — `--board <spec>` lets ANY multi-card board
// be measured directly instead of a catalog enemy's, so combo/synergy cards
// can be checked at all. The motivating case: some cards produce no direct
// damage/heal/shield — they only buff the caster or debuff the enemy (combo
// riders like `comboBonus`/`chainBonus`/`stackBonus`/`exploit`,
// or a bare stat buff). Those read as 0 on every axis in isolation, so their
// only visible value is the DELTA a card makes to a board's numbers:
//
//   npm run output -- --board sworn_edge,void_pierce,twin_slash
//   npm run output -- --board sworn_edge@silver,cinder_dart#resonant_echo
//
// A/B DELTA (`--vs <spec>`) — compares `--board` (WITH) against a second,
// smaller board (WITHOUT — typically the same board minus the one card being
// measured), same window, same dummy, and prints both plus the signed
// difference per axis:
//
//   npm run output -- --board war_banner,sword_slash --vs sword_slash
//
// SAME SLOT COUNT for a clean read: if `--board` and `--vs` use a different
// number of slots, part of the delta is the added/removed slot itself, not
// just the card(s) that differ — the script WARNS on stderr rather than
// refusing (see "SLOT-COUNT MISMATCH" below). The clean form is a same-slot
// swap, e.g. comparing `war_banner,sword_slash` (2 slots) against
// `sworn_edge,sword_slash` (also 2 slots) rather than against bare
// `sword_slash` (1 slot).
//
// PROBE RIG, NOT `BASE_HERO_STATS` (2026-09-14 audit fix — CRITICAL 1) —
// `--board`/`--vs` mode measures CARDS against each other, not a simulated
// hero, so it does NOT use the hero's floor stats (`BASE_HERO_STATS`: speed
// 10). At speed 10, a solo actor sharing ONE action queue across several
// cards has its cast cadence displaced by whichever OTHER card is also
// queued — the displacement is about a turn, and it SWAMPS the mechanic
// being measured for every ACTING card (i.e. every combo/shred/debuff card
// this feature exists to test). Proven concretely, same aura, same two
// cards, only the comma order differs:
//
//   --board sword_slash,war_banner --vs sword_slash   ->  spec +4
//   --board war_banner,sword_slash --vs sword_slash   ->  spec -2
//
// `war_banner` is `size:1`, `effects:[]`, `aura.affects:"adjacent"` —
// adjacent to `sword_slash` in BOTH orderings, so the aura's real
// contribution is identical either way (+2); the SIGN of the printed delta
// flipping on comma order alone is the queue-contention artifact, not the
// card. A non-acting card is unaffected (a bare aura measured against
// nothing else queued reads the same regardless of order) — the artifact is
// specific to two ACTING cards contending for one queue.
//
// FIX: the probe board casts at `speed: 40` (the same contention-free regime
// `tests/run/analysis.test.ts`'s `fastCaster` rig already used to pin this
// mechanic). MECHANISM CORRECTION (2026-09-14, third audit pass): both cards
// still share the SAME one cursor/action queue at speed 40 — one board is
// one queue, always (`docs/combat-model-spec.md`); nothing gives a card its
// own private cadence, and no version of this rig could. What actually
// changes is which resource GATES how many queued cards fire in a turn. At
// speed 10 the combatant affords only ONE queued card's weight per turn, so
// whichever card sits first in the comma list is the one that lands on turn
// 1 — the second card is pushed to turn 2, which is what put the two
// orderings on opposite sides of the spec window. At speed 40 the combatant
// affords BOTH cards' weight in the SAME turn (multi-cast — "the resolve
// loop repeats", CLAUDE.md's readiness-model description), so both fire on
// turn 1 regardless of listed order, and cooldown (not queue position)
// becomes the pacing constraint instead. Proven live via `npm run fight`,
// same two cards, only the rig's speed differs:
//
//   speed 10: t1 play Hero  sword_slash  slot 1   (war_banner waits for t2)
//             t2 play Hero  war_banner   slot 2
//   speed 40: t1 play Hero  sword_slash  slot 1
//             t1 play Hero  war_banner   slot 2   (SAME turn, same cursor)
//
// `--stats` (below) overrides this rig, including back down to a lower
// speed, if a caller wants to see the artifact on purpose or explore a
// different regime.
//
// ENEMY-ID MODE IS COMPLETELY UNCHANGED BY THIS — it never touches the probe
// rig; it always uses `resolveEncounterForEnemy`'s real resolved stats.
//
//   npm run output -- --board war_banner,sword_slash --stats speed:10
//
// THE PROBE RIG ITSELF IS PRINTED (2026-09-14 audit fix, IMPORTANT 3) —
// `--board`/`--vs` mode's `stats` block includes `spd` (enemy-id mode's own
// block does not — its printed output must stay byte-identical to before
// this feature; see `statLines`, below). `speed` is the whole point of the
// fix above, so a caller reading only atk/mag/arm/mres had no way to tell
// `speed 40` from `speed 10` from the output alone. Live proof: identical
// `--board` call, only `--stats speed:10` added, and the block itself moves:
//
//   npm run output -- --board war_banner,sword_slash
//     ->  stats: atk 0  mag 0  arm 0  mres 0  spd 40
//   npm run output -- --board war_banner,sword_slash --stats speed:10
//     ->  stats: atk 0  mag 0  arm 0  mres 0  spd 10
//
// `--board`/`--vs` NUMBERS ARE NOT COMPARABLE TO ENEMY-ID MODE'S (2026-09-14
// audit fix, IMPORTANT 4) — the two modes read different rigs (the "PROBE
// RIG, NOT `BASE_HERO_STATS`" note above), so their absolute numbers must
// never be read side by side as if one were a tuned/untuned version of the
// other. Concretely, `cleric 5`'s real resolved kit reads heal spec 17
// (range 0-33); the SAME four pieces through `--board` at the default probe
// read spec 29 (range 21-64) — a 12-point gap that looks like the piece list
// alone is worth almost twice what it is. MEASURED, not asserted: the gap is
// overwhelmingly the probe's `speed: 40` versus the Cleric's real `speed: 10`
// (heal cards care about CADENCE, same mechanism as the order-dependence fix
// above), not the `magicResist` difference the two rigs also carry:
//
//   --stats speed:10                -> heal spec 16               (mres 0)
//   --stats speed:10,magicResist:1  -> heal spec 17, range 0-33    (EXACT match)
//
// matching the probe's speed alone (`speed:10`) already overshoots past the
// real figure, 29 down to 16 — a 13-point swing against a 12-point gap to
// close; matching the Cleric's own real `magicResist` (0 -> 1) closes the
// last point exactly. Use `--board`/`--vs` to compare CARDS against each
// other on ONE fixed rig; use enemy-id mode to read a real enemy's real
// output; never diff the two modes' raw numbers against each other. The
// printed board-mode output carries a `note` block saying the same thing
// (see `COMPARABILITY_NOTE`, below).
//
// CONFIGURABLE DUMMY (`--dummy key:value,...`) — gives the TARGET real
// armor/magicResist/hp/etc instead of the inert zero-defense default. Only
// ONE family of debuff genuinely needs it to read as anything but 0: a
// `debuffStat` shred (`armor_break` halves Armor, `frostbind_litany` cuts
// magicPower/magicResist) has nothing to reduce against a zero-stat target —
// halving 0 is still 0.
//
// `expose` and `shieldBreak` are NOT that family (2026-09-14, THIRD audit
// correction — the previous header grouped all three together; that was
// wrong, and both of its own `--dummy` examples printed a flat 0 as proof).
// Verified live via `npm run fight`, never asserted from prose:
//
//   * `expose` (`ruinous_hex`) is a damage AMPLIFIER (`exposeBonus`,
//     `src/engine/combat/events.ts` — "the mirror of guardReduction"),
//     applied to the hit AFTER Armor/Magic Resist already subtracted — it
//     has something to amplify (the post-mitigation damage, floored at a
//     minimum of 1) even against `armor:0`. It needs NO `--dummy` at all:
//
//       npm run output -- --board ruinous_hex,sword_slash --vs sword_slash
//         ->  dmg spec +4, raw delta +20      (default zero-armor dummy)
//
//     `npm run fight` shows the same card firing against an explicit
//     `armor:0` foe, no dummy override anywhere in the invocation:
//       t1 Bandit Duelist gains expose +50% for 2t
//       t2 calc  21 +EXPOSE10 = 31 HP
//
//   * `shieldBreak` (`shield_splitter`, `gutting_cleave`, `piercing_reach`,
//     `sundering_roar`) strips the VICTIM's SHIELD pool
//     (`KEYWORD_TEXT.shieldBreak`: "Remove X Shield before this card deals
//     damage") — Armor and Magic Resist are not involved at all. It IS a
//     genuine no-signal case for THIS script, but not the one the old header
//     named: `DUMMY_STAT_KEYS` (below) has no `shield` entry, and the
//     training dummy never casts (`trainingDummy`'s `pieces: []`,
//     `src/run/analysis.ts`) — there is no `--dummy` override that gives it
//     shield to strip. Proof, the identical card, `npm run fight`, shieldless
//     target:
//       t2 Bandit Duelist takes 43 physical
//       t2 calc  43 = 43 HP                    <- no "shattered", no block
//     versus the same card once the target already carries shield (only
//     reachable via a real `npm run fight` board, never this script's dummy):
//       t2 Bandit Duelist shield shattered -24 -> 40
//       t2 calc  43 -DEF20 -BLOCK23 = 0 HP
//     Measure a `shieldBreak` card's own worth with `npm run fight` against a
//     board that shields itself first; this script cannot construct that
//     target.
//
// A `debuffStat` shred's `--dummy` value is not free to pick arbitrarily —
// IMPORTANT 2 (2026-09-14): the probe rig's `attack: 0` makes `armor_break`'s
// bronze partner hit tiny (`sword_slash`: power 20), so the min-1 damage
// floor can pin BOTH the "with" and "without" case to the identical 1 HP,
// printing a true `+0` for a card that DOES work. Measured, at the default
// rig: `armor_break,sword_slash` vs `sword_slash` shows a real (raw) delta
// for `--dummy armor:1` through `armor:37`, and a floor-pinned `+0` from
// `armor:38` on (`--stats attack:50` widens the live window at least to
// `armor:120`, confirmed zero again by `armor:140`). `spec` itself can round
// a small live delta down to `+0` right at the edge of the window
// (`armor:1` reads `spec +0` but `raw delta +2`) — read the RAW delta, not
// `spec`, when checking whether a card did anything at all near a floor. A
// clean pair, inside the window:
//
//   npm run output -- --board armor_break,sword_slash --vs sword_slash --dummy armor:20
//     ->  dmg spec +4, raw delta +18
//
// the SAME pair at `armor:40` (past the window) reads a genuine `+0` on
// every field, `spec` AND raw — the floor on both sides, not a bug (NOT a
// runnable header example below — this one is DELIBERATELY zero, and the
// header-example test requires non-degenerate output from every example it
// extracts):
//
//   --board armor_break,sword_slash --vs sword_slash --dummy armor:40
//     ->  dmg spec +0, raw delta +0
//
// `--dummy` composes with EVERY mode (enemy-id, `--board`, and `--vs`); only
// the TARGET changes, never the measured board's own pieces/stats. A
// `--dummy` override that gives the dummy so little HP it dies mid-window
// (e.g. `hp:10`) silently truncates the simulated window — the `--board`/
// `--vs` path WARNS on stderr when this happens (see "DUMMY DIED" below).
//
// SAME PIECE SYNTAX AS `npm run fight` — `skill_id`, `skill_id@tier`
// (bronze|silver|gold|diamond), `skill_id#gem_id` — parsed by the SAME
// `parsePieceList` (`./boardSpec`) that `fight.ts`'s `FIGHT_HERO_BOARD` /
// `FIGHT_FOE_BOARD` use, so the two tools cannot disagree about what a board
// spec means (CLAUDE.md's "never hand-write a second log renderer" applies
// identically to a second parser).
//
// `--stats key:value,...` (2026-09-14 audit fix) overrides the `--board`/
// `--vs` probe rig's OWN stats (maxHp/hp/attack/magicPower/armor/
// magicResist/speed) — the SAME `name:integer` syntax and refusal behavior
// `scripts/fight.ts`'s `FIGHT_HERO_STATS`/`FIGHT_FOE_STATS` use, parsed by the
// SAME shared function (`parseStatOverrideSpec`, `./boardSpec`) so the two
// tools cannot disagree about what `attack:5,armor:0` means. Only applies to
// `--board`/`--vs` mode; enemy-id mode's stats come from the real resolver
// and are not affected by `--stats`.
//
// RAW CUMULATIVE TOTALS IN DELTA MODE (2026-09-14 audit fix) — `spec` is a
// ROUNDED per-turn average (`Math.round(cumulative / specTurn)`), so at the
// default 5-turn spec window, 1 spec point can hide up to ~5 raw points of
// real difference. DELTA mode (`--board ... --vs ...`) additionally prints
// each axis's raw (un-rounded, un-divided) cumulative total through the spec
// window, so a coarse "+2" can be read alongside the underlying totals that
// produced it.
//
// SLOT-COUNT MISMATCH — when `--board` and `--vs` resolve to a DIFFERENT
// number of slots, part of the printed delta is simply the extra/missing
// slot, not the card(s) that differ. The script does NOT refuse this (a
// smaller `--vs` board — "the same board minus one card" — is the common,
// intentional case) but WARNS on stderr, naming the clean alternative: a
// same-slot-count swap (e.g. `--board A,B --vs A,C`).
//
// DUMMY DIED — a `--dummy` override that leaves the training dummy with too
// little effective HP (e.g. `hp:10`) can kill it before the simulated window
// ends. The engine still returns whatever events happened before that, so
// the numbers are not wrong, but they are for a SHORTER window than
// requested and read as if they covered the full one. `--board`/`--vs` mode
// warns on stderr when this happens (read off the engine's own `died` event,
// via `src/run/analysis.ts`'s `outputPerTurnRawTotals`).
//
// A STAT SUMMARY, NOT A LOG: this never re-renders combat events (CLAUDE.md,
// user-locked 2026-08-25 — never hand-write a log renderer). Anything about
// what a specific card does belongs in `npm run fight`, not here.
import {
  outputPerTurn,
  outputPerTurnRawTotals,
  type OutputAxisBand,
  type OutputPerTurn,
  type OutputPerTurnOpts,
  type OutputPerTurnRawTotals,
} from '../src/run/analysis';
import { skillBook } from '../src/data/skills';
import { gemBook } from '../src/data/gems';
import { enemies } from '../src/data/enemies';
import { defaultTitleFor, resolveEncounterForEnemy } from '../src/run/encounter';
import { HERO_BOARD_SLOTS } from '../src/data/heroes';
import { parsePieceList, parseStatOverrideSpec, type ParsedPieceList } from './boardSpec';
import type { BoardPiece, CombatantSetup, CombatantStats } from '../src/engine/types';

// NOTE: `BASE_HERO_STATS` (`src/data/heroes.ts`) is deliberately NOT imported
// here. The enemy-id path (below) never needs it — it always uses
// `resolveEncounterForEnemy`'s real resolved stats — and `--board`/`--vs`
// mode uses `BOARD_PROBE_STATS` instead of the hero floor; see the header's
// "PROBE RIG, NOT `BASE_HERO_STATS`" note for why.

// ---------------------------------------------------------------------------
// CLI parsing — `--board`/`--vs`/`--dummy`/`--stats` are flags (value = next
// argv); anything else is positional (the existing `<enemyId> [level]`
// contract).
// ---------------------------------------------------------------------------
interface Cli {
  positional: string[];
  board: string | undefined;
  vs: string | undefined;
  dummy: string | undefined;
  stats: string | undefined;
}

/**
 * A flag with no following argv value is a mistake, not "no value given" —
 * without this guard `--board sword_slash --vs` (nothing after `--vs`) used
 * to silently print a SINGLE board (the `--vs` branch never taken) at exit
 * 0, and `--board sword_slash --dummy` (nothing after `--dummy`) silently
 * dropped the override and printed the DEFAULT dummy's numbers, also at exit
 * 0 (2026-09-14 audit fix, IMPORTANT 4). Refuses instead, same "a typo'd
 * value is not silently ignored" reasoning as `--dummy`'s unknown-stat
 * refusal.
 */
function nextValue(argv: readonly string[], i: number, flag: string): string {
  const value = argv[i];
  if (value === undefined) {
    console.error(`${flag}: missing a value.`);
    process.exit(1);
  }
  return value;
}

function parseArgv(argv: readonly string[]): Cli {
  const positional: string[] = [];
  let board: string | undefined;
  let vs: string | undefined;
  let dummy: string | undefined;
  let stats: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--board') { board = nextValue(argv, ++i, '--board'); continue; }
    if (arg === '--vs') { vs = nextValue(argv, ++i, '--vs'); continue; }
    if (arg === '--dummy') { dummy = nextValue(argv, ++i, '--dummy'); continue; }
    if (arg === '--stats') { stats = nextValue(argv, ++i, '--stats'); continue; }
    if (arg !== undefined) positional.push(arg);
  }
  return { positional, board, vs, dummy, stats };
}

const cli = parseArgv(process.argv.slice(2));

/**
 * `--dummy key:value,key:value` — the same `name:integer` convention
 * `scripts/fight.ts`'s `FIGHT_FOE_STATS`/`FIGHT_HERO_STATS` use, restricted
 * to `CombatantStats`'s own fields. An unknown key or non-integer value
 * refuses rather than silently ignoring — a typo'd stat is a dummy you did
 * not ask for.
 */
const DUMMY_STAT_KEYS = ['maxHp', 'hp', 'attack', 'magicPower', 'armor', 'magicResist', 'speed'] as const;
type DummyStatKey = (typeof DUMMY_STAT_KEYS)[number];
/** Mobile-width labels for the `dummy` print block — mirrors `statLines`'s abbreviations. */
const DUMMY_STAT_LABEL: Record<DummyStatKey, string> = {
  maxHp: 'maxhp', hp: 'hp', attack: 'atk', magicPower: 'mag', armor: 'arm', magicResist: 'mres', speed: 'spd',
};

function parseDummyOverrides(spec: string | undefined): Partial<CombatantStats> | undefined {
  if (spec === undefined) return undefined;
  // MINOR 6 (2026-09-14 third audit pass): `--dummy ""` (or whitespace-only)
  // IS a value — the flag was given — so it must not silently collapse to
  // "no override" the way an OMITTED `--dummy` does. Same "a typo'd value is
  // not silently ignored" reasoning `nextValue`'s missing-value refusal uses.
  if (spec.trim() === '') {
    console.error("--dummy: expected name:integer pairs, got '' — drop the flag entirely to mean no override.");
    process.exit(1);
  }
  const out: Partial<CombatantStats> = {};
  for (const raw of spec.split(',')) {
    const pair = raw.trim();
    if (pair === '') continue;
    const [key, value] = pair.split(':');
    if (key === undefined || value === undefined || !/^-?[0-9]+$/.test(value)) {
      console.error(`--dummy: expected name:integer pairs, got '${pair}'.`);
      process.exit(1);
    }
    if (!(DUMMY_STAT_KEYS as readonly string[]).includes(key)) {
      console.error(`--dummy: unknown stat '${key}' (known: ${DUMMY_STAT_KEYS.join(', ')}).`);
      process.exit(1);
    }
    (out as Record<string, number>)[key] = Number(value);
  }
  return out;
}

const dummyOverrides = parseDummyOverrides(cli.dummy);
const outputOpts: OutputPerTurnOpts = { dummy: dummyOverrides };

if (cli.vs !== undefined && cli.board === undefined) {
  console.error('--vs requires --board.');
  process.exit(1);
}
if (cli.stats !== undefined && cli.board === undefined) {
  console.error('--stats requires --board.');
  process.exit(1);
}
// MINOR 6 (2026-09-14 third audit pass) — same "an explicit empty value is
// not the same as omitting the flag" reasoning as `parseDummyOverrides`,
// above. Checked here (before `parseStatOverrideSpec`, whose shared
// blank-pair-skip behavior is deliberately preserved for `fight.ts`'s own
// env-var form — see `./boardSpec`'s `withStatOverrides`) rather than inside
// the shared parser, so `fight.ts`'s behavior is untouched.
if (cli.stats !== undefined && cli.stats.trim() === '') {
  console.error("--stats: expected name:integer pairs, got '' — drop the flag entirely to mean no override.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// MOBILE-FIRST printing (CLAUDE.md, user-locked 2026-08-25): one fact per
// line, nothing past ~28 characters, no wide tables.
// ---------------------------------------------------------------------------
function axisLines(label: string, band: OutputAxisBand): string[] {
  return [`  ${label}/turn`, `    spec ${band.spec}`, `    range ${band.min}-${band.max}`];
}

function pieceLines(pieces: readonly BoardPiece[]): string[] {
  const lines: string[] = ['  pieces'];
  for (const piece of pieces) {
    // `assignRankTiers` (`src/run/encounter.ts`) only stamps `piece.tier` when
    // rank > 0; an unranked piece keeps its AUTHORED skillBook tier instead of
    // defaulting to bronze.
    const tier = piece.tier ?? skillBook[piece.skillId]?.tier ?? 'bronze';
    lines.push(`    ${tier} ${piece.skillId}`);
  }
  return lines;
}

/**
 * `opts.showSpeed` defaults to false, so enemy-id mode's call (no second arg)
 * stays byte-identical to before this feature — "do not touch that path"
 * (2026-09-14 audit fix constraint). `--board`/`--vs` mode passes
 * `{ showSpeed: true }` (THIRD audit pass, IMPORTANT 3): `speed` is the exact
 * field the probe-rig fix above turns on, so hiding it left a caller with no
 * way to tell `speed 40` from `speed 10` from the printed block alone.
 */
function statLines(stats: CombatantStats, opts: { showSpeed?: boolean } = {}): string[] {
  const lines = [
    '  stats',
    `    atk   ${stats.attack}`,
    `    mag   ${stats.magicPower}`,
    `    arm   ${stats.armor}`,
    `    mres  ${stats.magicResist}`,
  ];
  if (opts.showSpeed) lines.push(`    spd   ${stats.speed}`);
  return lines;
}

/** Only present when `--dummy` was given — purely additive, so its absence is byte-identical to before this feature. */
function dummyLines(overrides: Partial<CombatantStats> | undefined): string[] {
  if (!overrides) return [];
  const lines: string[] = ['  dummy'];
  for (const key of DUMMY_STAT_KEYS) {
    const value = overrides[key];
    if (value !== undefined) lines.push(`    ${DUMMY_STAT_LABEL[key]} ${value}`);
  }
  return lines;
}

/**
 * `opts.showSpeed` threads straight to `statLines` — see that function's own
 * comment. The enemy-id call site below passes no `opts`, so its printed
 * block is byte-identical to before this feature.
 */
function formatBoardBlock(
  heading: string,
  result: OutputPerTurn,
  setup: CombatantSetup,
  dummy: Partial<CombatantStats> | undefined,
  opts: { showSpeed?: boolean } = {},
): string[] {
  return [
    heading,
    ...axisLines('dmg', result.damage),
    ...axisLines('heal', result.healing),
    ...axisLines('shield', result.shield),
    ...pieceLines(setup.pieces),
    ...statLines(setup.stats, opts),
    ...dummyLines(dummy),
  ];
}

/**
 * IMPORTANT 4 (2026-09-14 third audit pass) — `--board`/`--vs` mode's
 * numbers come from a fixed probe rig (`BOARD_PROBE_STATS`, above), never a
 * real enemy build, and must never be read side by side with enemy-id mode's
 * numbers as if one were a tuned/untuned version of the other (see the
 * header's own "NUMBERS ARE NOT COMPARABLE" note for the measured `cleric 5`
 * vs `--board` gap this guards against). Printed ONLY in `--board`/`--vs`
 * mode — enemy-id mode's numbers are the real thing and need no caveat.
 */
const COMPARABILITY_NOTE: readonly string[] = [
  '  note',
  '    probe rig stats, not',
  '    a real enemy build.',
  '    not comparable to',
  '    enemy-id mode output.',
];

function fmtSigned(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function deltaAxisLines(
  label: string,
  withBand: OutputAxisBand,
  withoutBand: OutputAxisBand,
  withRaw: number,
  withoutRaw: number,
): string[] {
  return [
    `  ${label}/turn`,
    `    spec ${fmtSigned(withBand.spec - withoutBand.spec)}`,
    `    range ${fmtSigned(withBand.min - withoutBand.min)}..${fmtSigned(withBand.max - withoutBand.max)}`,
    `    raw with ${withRaw}`,
    `    raw without ${withoutRaw}`,
    `    raw delta ${fmtSigned(withRaw - withoutRaw)}`,
  ];
}

function deltaBlock(
  withResult: OutputPerTurn,
  withoutResult: OutputPerTurn,
  withRaw: OutputPerTurnRawTotals,
  withoutRaw: OutputPerTurnRawTotals,
): string[] {
  return [
    '-- DELTA --',
    ...deltaAxisLines('dmg', withResult.damage, withoutResult.damage, withRaw.damage, withoutRaw.damage),
    ...deltaAxisLines('heal', withResult.healing, withoutResult.healing, withRaw.healing, withoutRaw.healing),
    ...deltaAxisLines('shield', withResult.shield, withoutResult.shield, withRaw.shield, withoutRaw.shield),
  ];
}

/**
 * Minor 5 (2026-09-14 audit fix) — see `OutputPerTurnRawTotals.dummyDied`'s
 * doc comment in `src/run/analysis.ts`. Only wired into `--board`/`--vs`
 * mode (the path this audit covers); enemy-id mode is deliberately untouched
 * — see the header's "Enemy-id mode ... MUST be unchanged" note.
 */
function warnIfDummyDied(label: string, raw: OutputPerTurnRawTotals): void {
  if (!raw.dummyDied) return;
  console.error(
    `warning: ${label}'s training dummy died before turn ${raw.turns} under this --dummy override — `
    + 'the simulated window was truncated, so the numbers below UNDERCOUNT steady-state output. '
    + 'Raise --dummy hp/maxHp (or drop the override) to keep it alive for the full window.',
  );
}

/** Critical 1(c) (2026-09-14 audit fix) — annotate, never refuse, a slot-count mismatch between `--board` and `--vs`. */
function warnIfSlotMismatch(withSlots: number, withoutSlots: number): void {
  if (withSlots === withoutSlots) return;
  console.error(
    `warning: --board uses ${withSlots} slot(s) but --vs uses ${withoutSlots} — part of the DELTA below `
    + 'is the added/removed slot itself, not just the card(s) that differ. For a clean measurement, compare '
    + 'boards with the SAME slot count (e.g. --board A,B --vs A,C).',
  );
}

/**
 * PROBE RIG (2026-09-14 audit fix, CRITICAL 1) — see the header's "PROBE
 * RIG, NOT `BASE_HERO_STATS`" note for the concrete order-dependence proof.
 * `speed: 40` matches the contention-free regime `tests/run/analysis.test.ts`'s
 * `fastCaster` rig uses so every queued card casts on its own cadence instead
 * of fighting another card for one shared action queue.
 */
// Deliberately NOT annotated `: CombatantStats` — a nominal interface has no
// index signature, so an explicitly-typed value cannot satisfy
// `parseStatOverrideSpec`'s `T extends Record<string, number>` constraint (a
// plain object-literal type can, same as `fight.ts`'s own `heroStats()` call
// relies on). The shape below is still exactly `CombatantStats`'s fields, so
// every consumer that expects `CombatantStats` (`boardSetup`) still accepts it.
const BOARD_PROBE_STATS = {
  maxHp: 999_999,
  hp: 999_999,
  attack: 0,
  magicPower: 0,
  armor: 0,
  magicResist: 0,
  speed: 40,
};

/** A hero-shaped combatant carrying the given pieces — the measured board's own stats never change, only the dummy does. */
function boardSetup(pieces: BoardPiece[], stats: CombatantStats): CombatantSetup {
  return { name: 'Board', stats, boardSize: HERO_BOARD_SLOTS, pieces };
}

function parseBoard(spec: string, envName: string): ParsedPieceList {
  const parsed = parsePieceList(spec, envName, skillBook, gemBook);
  if (parsed.pieces.length === 0) {
    console.error(`${envName} is empty.`);
    process.exit(1);
  }
  if (parsed.slotsUsed > HERO_BOARD_SLOTS) {
    console.error(`${envName} needs ${parsed.slotsUsed} slots, board is ${HERO_BOARD_SLOTS}.`);
    process.exit(1);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
if (cli.board !== undefined) {
  if (cli.positional.length > 0) {
    console.error(`--board mode does not take positional args (got '${cli.positional.join(' ')}').`);
    process.exit(1);
  }

  const probeStats = cli.stats === undefined ? BOARD_PROBE_STATS : parseStatOverrideSpec(cli.stats, '--stats', BOARD_PROBE_STATS);

  const withParsed = parseBoard(cli.board, '--board');
  const withSetup = boardSetup(withParsed.pieces, probeStats);
  const withResult = outputPerTurn(withSetup, skillBook, outputOpts);

  if (cli.vs === undefined) {
    if (dummyOverrides) warnIfDummyDied('--board', outputPerTurnRawTotals(withSetup, skillBook, outputOpts));
    const lines: string[] = [
      ...formatBoardBlock('board', withResult, withSetup, dummyOverrides, { showSpeed: true }),
      ...COMPARABILITY_NOTE,
    ];
    console.log(lines.join('\n'));
  } else {
    const withoutParsed = parseBoard(cli.vs, '--vs');
    warnIfSlotMismatch(withParsed.slotsUsed, withoutParsed.slotsUsed);

    const withoutSetup = boardSetup(withoutParsed.pieces, probeStats);
    const withoutResult = outputPerTurn(withoutSetup, skillBook, outputOpts);
    const withRaw = outputPerTurnRawTotals(withSetup, skillBook, outputOpts);
    const withoutRaw = outputPerTurnRawTotals(withoutSetup, skillBook, outputOpts);
    if (dummyOverrides) {
      warnIfDummyDied('--board', withRaw);
      warnIfDummyDied('--vs', withoutRaw);
    }

    const lines: string[] = [
      ...formatBoardBlock('-- WITH --', withResult, withSetup, dummyOverrides, { showSpeed: true }),
      ...formatBoardBlock('-- WITHOUT --', withoutResult, withoutSetup, dummyOverrides, { showSpeed: true }),
      ...deltaBlock(withResult, withoutResult, withRaw, withoutRaw),
      ...COMPARABILITY_NOTE,
    ];
    console.log(lines.join('\n'));
  }
} else {
  const enemyId = cli.positional[0];
  if (enemyId === undefined || enemyId.trim() === '') {
    console.error('Usage: npm run output -- <enemyId> [level]');
    console.error('   or: npm run output -- --board <spec> [--vs <spec>] [--dummy k:v,...] [--stats k:v,...]');
    process.exit(1);
  }

  const levelArg = cli.positional[1];
  if (levelArg !== undefined && !/^[0-9]+$/.test(levelArg)) {
    console.error(`Invalid level '${levelArg}' — expected a positive integer.`);
    process.exit(1);
  }
  const level = levelArg === undefined ? 1 : Number(levelArg);

  const enemy = enemies[enemyId];
  if (!enemy) {
    console.error(`Unknown enemy id '${enemyId}'.`);
    process.exit(1);
  }

  const encounter = resolveEncounterForEnemy(enemy, level, defaultTitleFor(enemy));
  const result = outputPerTurn(encounter.setup, skillBook, outputOpts);
  console.log(
    formatBoardBlock(`${enemy.id}  L${encounter.effectiveLevel}`, result, encounter.setup, dummyOverrides).join('\n'),
  );
}
