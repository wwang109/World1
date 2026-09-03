import { resolveDisplaySkill } from '../engine/cards';
import { skillBook } from '../data/skills';
import type { CombatEvent } from '../engine/combat/events';
import type { ShieldPools } from '../engine/combat/state';
import type { Archetype, BuffableStat, Element, Property, SkillDef, SkillTier, WeaponType } from '../engine/types';
import { buildAutoHeroSetup, buildEnemyEncounter } from '../run/encounter';
import type { EnemyTitle } from '../run/encounter';
import type { BattleLog } from '../run/resolveBattle';
import type { Allocation } from '../run/leveling';
import type { EnemyFightConfig, OwnedBoardPiece } from './demoState';
import type { ScalingStats } from './ui/skillPresentation';
import { STAT_TOKEN } from './ui/statLabels';

/**
 * `buildBattleTimeline` folds a `BattleLog` (see `run/resolveBattle`) into a
 * renderer-agnostic playback model. Every battle scene (mobile, desktop, …) is
 * a dumb playback head over this model — no Phaser import, no combat
 * recomputation here, ever.
 *
 * This file owns PRESENTATION only: log lines, per-step snapshots, FX, and the
 * damage-math grammar. Combat is NOT here and NOT in this bundle — the log
 * arrives from the battle service (`game/battleApi`). There is deliberately no
 * local-simulation fallback: `src/game` cannot import `simulate()` or
 * `resolveBattle()` at all (enforced by `scripts/check-boundaries.mjs`).
 */

export interface LogLine { tag: string; text: string; detail?: string; }
/** HP snapshot. The singular `enemy`/`enemyMax` fields are ALWAYS enemy unit 0
 * (mobile's 1v1 view); multi-foe renderers read the parallel `enemies` arrays. */
export interface HpSnap {
  player: number; enemy: number; playerMax: number; enemyMax: number;
  enemies?: number[]; enemyMaxes?: number[];
}
/** Per-pool shield totals (physical/magical/true, from the engine's own
 * `ShieldPools`) — kept separate so a UI never shows "50 shield" when it's
 * actually 20 physical + 30 magical stacked. */
export type { ShieldPools } from '../engine/combat/state';
export interface ShieldSnap {
  player: number; enemy: number; enemies?: number[];
  /** Per-pool breakdown — undefined until the first shieldGain event for that
   * side/unit (nothing granted yet), then always kept in sync. */
  playerPools?: ShieldPools;
  enemyPools?: ShieldPools;
  enemiesPools?: Array<ShieldPools | undefined>;
}
export interface SpeedSnap { player: string; enemy: string; enemyUnits?: string[]; }

/** One property's EFFECTIVE (compounded) guard mitigation, for the HP-bar
 * guard badge — see `guardPctByTurn` below for the full compounding rule. */
export interface GuardBadgeEntry { property: Property; pct: number; }
/** Per-side (and, for multi-foe, per-enemy-unit) guard badge entries for one
 * turn — parallel shape to `exposePctByTurn`, except guard is PROPERTY-scoped
 * (a physical guard and a magical guard on the same unit are two independent
 * mitigations), so each side's value is an array rather than one number. */
export interface GuardSnap { player: GuardBadgeEntry[]; enemy: GuardBadgeEntry[]; enemyUnits?: GuardBadgeEntry[][]; }
/**
 * One playback-FX event for a step: floating number + (for damage) a bar
 * shake, OR a `cast` trigger (a card was just played — the skill-usage
 * animation moment). `unit` identifies the enemy unit for multi-foe fights
 * (0 default).
 *
 * `archetype`/`property`/`element`/`weapon` are the SOURCE CARD's identity —
 * the archetype × element/weapon layered FX system (`ui/battleFxSpec.ts`)
 * reads these to pick a motion shape (archetype) and a palette
 * (element/weapon, falling back to property). Present whenever the fx traces
 * back to a resolved skill (every `cast` fx; `damage`/`heal`/`shield` fx
 * whose event carried a `sourceCard`); absent for un-attributed damage
 * (poison/burn/bleed/fatigue/attrition ticks), which keep the existing
 * `source`-keyed ailment-color fallback instead.
 */
export interface TurnFx {
  side: 'player' | 'enemy';
  kind: 'damage' | 'heal' | 'shield' | 'cast';
  amount: number;
  source?: string;
  unit?: number;
  archetype?: Archetype;
  property?: Property;
  element?: Element;
  weapon?: WeaponType;
  /** Card display name — set only on `cast` fx. */
  cardName?: string;
  /** Anti-heal world rule tax percent (0-60) — set only on a `heal` fx whose
   * event carried a nonzero `antiHeal` reduction; undefined heals render
   * byte-identically to before this field existed. */
  antiHealPct?: number;
}
/** A single playback position: one IMPORTANT log line (or a turn's fallback
 * anchor line when it has no important lines) — `lineIndex` into that turn's
 * `linesByTurn` array. A scene's playback index indexes `steps`, not turns. */
export interface PlaybackStep { turn: number; lineIndex: number; }
/** A step record captured mid-build, before turns/fallback-steps are known —
 * folded into the final per-step arrays in turn order once the event loop ends. */
interface StepRecord { turn: number; lineIndex: number; hp: HpSnap; shield: ShieldSnap; fx: TurnFx[]; focus?: number; summary: CombatSummary; }
export interface CardSummaryRow {
  side: 'player' | 'enemy';
  name: string;
  /** Direct skill-hit damage only (source === 'skill') — never DoT ticks or
   * thorns reflects, which this card may ALSO deal; see `dots`. */
  damage: number;
  shield: number;
  healing: number;
  /**
   * Cumulative HP damage this card's poison/burn/bleed ticks or thorns
   * reflects have actually dealt — NOT a stack/application count. (Used to be
   * a raw stack count added the moment the ailment was applied, which read as
   * a damage number next to `damage`'s `DMG n` in the battle scenes' summary
   * row and was not one — fixed 2026-08-17 by reading it off the real tick/
   * reflect `damage` events instead, credited via each one's `sourceCard`
   * exactly like `playerDamage`/`enemyDamage` below.) A card that only just
   * applied an ailment (no tick has fired yet) reads 0 here until its first
   * tick actually lands — an accurate "nothing dealt yet", not a placeholder.
   */
  dots: number;
}
export interface CombatSummary {
  playerDamage: number;
  enemyDamage: number;
  playerHealing: number;
  cards: CardSummaryRow[];
}
/** A card placed at a starting slot; a size-N card occupies N slots. Plain
 * data twin of `ui/BoardColumn`'s `ColumnPiece` (minus the render-only
 * `state` cursor field, which scenes add themselves at render time). */
export interface BattlePiece {
  skill: SkillDef;
  slot: number;
  /**
   * This INSTANCE's tier, carried through so the battle board's card frames read
   * `TIER_COLOR[tier]` exactly like every other board that renders the same
   * pieces (`ColumnPiece.tier` -> `CardTokenOptions.tier` -> the token's frame
   * stroke). The shop's owned-board column has always passed it; battle never
   * did, so a rank-tiered elite deck — two silver cards and two bronze — drew
   * all four in one identical generic frame, with the numbers right and the tier
   * signal missing. Undefined for an instance with no tier of its own, which is
   * the same generic frame the shop gives that case.
   */
  tier?: SkillTier;
}

export interface BattleTimelineInput {
  pieces: OwnedBoardPiece[];
  heroLevel: number;
  heroAllocation: Allocation;
  enemyId: string;
  enemyLevel: number;
  enemyTitle: EnemyTitle;
  enemyRank: number;
  /** Modifier ids from MODIFIER_PRESETS (rogue-like affixes); [] = none. */
  enemyModifiers?: readonly string[];
  /** The single-enemy twin of `EnemyFightConfig.affix` — the ELITE AFFIX the
   * 1v1 foe carries, or null/omitted. Overridden by `enemyTeam` when present. */
  enemyAffix?: string | null;
  /**
   * Multi-foe fights: when present (non-empty), OVERRIDES the single-enemy
   * fields above — one encounter per entry, in order. The singular fields
   * remain for 1v1 callers (mobile).
   */
  enemyTeam?: readonly EnemyFightConfig[];
  seed: number;
}

/** One resolved enemy unit's render data (parallel to event `unit` indexes). */
export interface FoeModel {
  name: string;
  stats: ScalingStats;
  maxHp: number;
  boardSize: number;
  pieces: BattlePiece[];
  skills: SkillDef[];
  /** Full display statline, e.g. "ATK 4 · MATK 1 · DEF 1 · MDEF 1 · SPD 11". */
  statLine: string;
}

/**
 * Each side's/unit's LAST RESOLVED cast's archetypes, AS OF a given turn —
 * the playback-derived mirror of the engine's own `lastCastArchetypes`
 * (`CombatantState`, combat/state.ts), which `comboBonus` reads to decide its
 * bonus (`interpreter.ts`'s `comboBonus` arm). `[]` means no qualifying prior
 * cast — either nothing has been cast yet this fight (the engine's own
 * initial `lastCastArchetypes: []`) or (impossible today, but not assumed
 * away) a cast carried no archetypes.
 *
 * DERIVATION: the `play` event names only `skillId` (not the resolved
 * `SkillDef`, and NOT archetypes directly — see `CombatEvent`'s `play` case,
 * combat/events.ts), so this reads `skillBook[e.skillId].archetypes`, the
 * BASE definition's archetypes. That is byte-identical to what the engine
 * actually used (`choice.skill.archetypes` in `simulate.ts`, where
 * `choice.skill` is `resolveEffectiveSkill`'s tier/gem-folded output):
 * `archetypes` is one of the fields `resolveEffectiveSkill`/`applyTier` never
 * touch (types.ts's own note: "archetypes carries over from base" — no tier
 * upgrade or gem action rewrites it), so base and effective always agree.
 */
export interface ComboArchetypeSnap { player: Archetype[]; enemy: Archetype[]; enemyUnits?: Archetype[][]; }

/**
 * Whether a comboBonus card's COMBO face token should render LIT (matches the
 * engine's own `comboBonus` check, interpreter.ts: `caster.lastCastArchetypes
 * .some((a) => skill.archetypes.includes(a))`) given the owner's
 * `ComboArchetypeSnap` entry for the side/unit this card belongs to. Shared
 * by both battle scenes (feeds `CardTokenOptions.comboLive`) and this file's
 * own tests, so the "is it live" rule is defined exactly once.
 */
export function isComboLive(skill: SkillDef, lastCastArchetypes: readonly Archetype[]): boolean {
  return skill.archetypes.some((a) => lastCastArchetypes.includes(a));
}

/**
 * One STATUS CHIP on a combatant's HP block: `kind` keys the shared color map
 * (`STATUS_CHIP_COLOR`, ui/battleStatusPalette.ts) and `text` is the full
 * compact readout (`PSN 8`, `GRD 75%P 40%M`, `ATK +30%`). Text is formatted
 * HERE, once, so both platforms render byte-identical chips — a scene only
 * measures, places and colors them.
 */
export interface StatusChip { kind: string; text: string; }
/** Per-side (and per-enemy-unit) chip rows for one turn — parallel shape to
 * `statusByTurn`. Chips are pre-ordered (see `CHIP_KIND_ORDER`); a renderer
 * caps the row and shows `+N` for what it cannot fit, never reorders. */
export interface StatusChipsSnap { player: StatusChip[]; enemy: StatusChip[]; enemyUnits?: StatusChip[][]; }

/** Standing per-CARD modifiers on one board slot, AS OF a turn: `burden` =
 * extra weight this piece owes on its next play (engine
 * `PieceState.nextWeightPenalty`), `curse` = damage this piece loses per hit
 * while its window stands (`PieceState.curse.amount`). */
export interface SlotMod { burden?: number; curse?: number; }
/** All slot mods for one turn, keyed by `slotModKey(side, unit, slot)` where
 * `slot` is the PIECE'S ANCHOR slot (the leftmost slot it occupies — exactly
 * what the engine's `burdened`/`cursed`/`curseExpired` events name). */
export type SlotModsSnap = Record<string, SlotMod>;
/** The one key format for `SlotModsSnap` — shared with the scenes so a lookup
 * can never drift from the writer's format. */
export function slotModKey(side: 'player' | 'enemy', unit: number, slot: number): string {
  return `${side}:${unit}:${slot}`;
}

export interface BattleTimeline {
  linesByTurn: Map<number, LogLine[]>;
  hpByTurn: Map<number, HpSnap>;
  shieldByTurn: Map<number, ShieldSnap>;
  /** Active ailment keys per side per turn — drives the HP-bar ailment tint. */
  statusByTurn: Map<number, { player: string[]; enemy: string[] }>;
  /**
   * Per-combatant STATUS CHIP rows per turn — the persistent "what is on this
   * unit and how much" readout (`PSN 8 · EXP +40% · GRD 75%P`) both battle
   * scenes draw on every HP block. Derived ENTIRELY from the event log's
   * already-reconstructed piles (the `dots*` buckets, the expose/guard shadow
   * piles, and the negate/ward/stat-mod trackers below) — never re-simulated.
   * Like `statusByTurn`, an entry is the state AS OF THE END of that turn's
   * last event, which is the turn-scrub granularity every other per-turn map
   * here already uses.
   */
  chipsByTurn: Map<number, StatusChipsSnap>;
  /**
   * Standing per-slot card modifiers (burden / curse) per turn — drives the
   * board cards' modified-stat overlay (a burdened card's weight badge shows
   * the EFFECTIVE weight in the burden ink; a cursed card's face carries its
   * `−N DMG` marker). Snapshotted from the same `pendingBurdenBySlot` /
   * `cursedBySlot` shadow maps the PLAY/WAIT log rows already read, so the
   * badge and the log can never disagree. Same end-of-turn granularity as
   * `chipsByTurn`; scrubbing to a turn before an application (or after its
   * spend/expiry) shows the unmodified card again.
   */
  slotModsByTurn: Map<number, SlotModsSnap>;
  /** Per-side/unit last-resolved-cast archetypes, per turn — see
   * `ComboArchetypeSnap`. Feeds the battle board's COMBO token grey/lit state
   * (`isComboLive`); nothing else reads this. */
  comboArchetypesByTurn: Map<number, ComboArchetypeSnap>;
  /** Current EFFECTIVE expose amplification (%) per side per turn — the
   * strongest standing pile's pct, mirroring the engine's own `strongestPct`
   * scan (interpreter.ts `dealDamage`), NOT the most recent application's pct.
   * 0 when no pile is standing. Drives the HP-bar expose badge's number. */
  exposePctByTurn: Map<number, { player: number; enemy: number; enemyUnits?: number[] }>;
  /** Current EFFECTIVE guard mitigation (%) per property, per side, per turn —
   * every matching-property guard pile compounds MULTIPLICATIVELY, in
   * application order, floored, min-1-remaining each step (interpreter.ts
   * `dealDamage`'s real read rule for a matching-property hit) — so two 50%
   * piles read 75%, never a naive 100% (sum) or 50% (last-applied-wins).
   * Drives the HP-bar guard badge. Empty array when nothing is standing. */
  guardPctByTurn: Map<number, GuardSnap>;
  speedByTurn: Map<number, SpeedSnap>;
  /** Which board slot each side cast from, per turn — drives the gold cursor. */
  playSlotByTurn: Map<number, { player?: number; enemy?: number }>;
  turns: number[];
  /** Flat, event-level playback timeline — one entry per IMPORTANT log line
   * (HIT/EFFECT/DEBUFF/BUFF/DOWN/RESULT), plus one fallback entry for any turn
   * that had none. Playback steps event-by-event, not turn-by-turn. */
  steps: PlaybackStep[];
  /** HP/shield snapshots captured at each step's exact position in the event
   * stream (not just per-turn) so the bars animate on the precise event. */
  hpByStep: HpSnap[];
  shieldByStep: ShieldSnap[];
  /** Structured per-step FX (damage/heal/shield deltas) for floating numbers + shakes. */
  fxByStep: TurnFx[][];
  /** Enemy unit each step involves — the struck/buffed foe, or the acting foe
   * when the hero is the victim. Drives the battle scenes' auto-focus tab.
   * `undefined` = no specific foe (fallback steps, RESULT-only turns). */
  focusFoeByStep: Array<number | undefined>;
  outcome: string;
  /** True when BOTH sides ended at 0 HP in the same step — the engine's tempo
   * tiebreak decided `outcome`, and the banner should say both fell. */
  mutualWipe: boolean;
  /** First playback step that contains the defeated unit's DOWN log (or the
   * normal end-of-playback RESULT step for a draw / event-less log). */
  outcomeStep: number;
  combatSummary: CombatSummary;
  /** Cumulative `CombatSummary` AS OF each playback step — same shape as
   * `combatSummary`, but frozen at that step's position in the event stream
   * instead of the fight's final totals. A scrubbing UI reads
   * `summaryByStep[idx]` for a live "ledger so far" instead of the final
   * tally. The last entry always deep-equals `combatSummary` (the two are
   * computed from the identical running totals — the non-regression
   * invariant a test in `battleTimeline.test.ts` pins). Rows are per-step
   * snapshots of the SAME `CardSummaryRow` objects (shallow-cloned per row,
   * not deep-frozen) — cheap for the ~20-60 steps × ~10-20 cards a fight
   * actually has, so a fresh clone every step is simpler than diffing. */
  summaryByStep: CombatSummary[];
  heroName: string;
  foeName: string;
  heroStats: ScalingStats;
  foeStats: ScalingStats;
  heroPieces: BattlePiece[];
  heroSkills: SkillDef[];
  foePieces: BattlePiece[];
  foeSkills: SkillDef[];
  /** ALL enemy units in event `unit` order. `foeName`/`foeStats`/`foePieces`/
   * `foeSkills` above remain unit 0's view for 1v1 renderers (mobile). */
  foes: FoeModel[];
  /** Hero display statline — makes the stat-sheet allocation visible in battle. */
  heroStatLine: string;
}

function skillName(id: string): string { return skillBook[id]?.name ?? id; }

/**
 * Compact per-pool token for a typed shield/blocked-damage line — lets a
 * shielded hit (or a shieldGain) read which pool is in play at a glance
 * (TRUE shields drain 2:1 vs typed damage and are otherwise indistinguishable
 * from a typed shield's plain "+N shield" line).
 */
function shieldToken(property: Property): string {
  return property === 'physical' ? 'P.SHIELD' : property === 'magical' ? 'M.SHIELD' : 'T.SHIELD';
}

/**
 * Which pool(s) actually drained for a blocked hit, e.g. "T.SHIELD -48" when
 * typed damage spilled into (and half-drained) the TRUE pool, or "P.SHIELD
 * -24, T.SHIELD -12" when it drained both. `shieldDrain` is present whenever
 * `blocked > 0`; falls back to the plain pool token (no magnitude) on the
 * rare event that's missing (e.g. an older cached log).
 */
/** The three shield pools in a fixed order — iterated by index, never by key. */
export const SHIELD_PROPERTIES: readonly Property[] = ['physical', 'magical', 'true'];

/** Total points held across the three pools. */
export function poolsSum(pools: ShieldPools): number {
  return pools.physical + pools.magical + pools.true;
}

/**
 * POINTS the wall actually LOST to one blocked hit.
 *
 * NOT `blocked`. `blocked` is the DAMAGE the plating ate; the bar holds PLATING
 * POINTS, and the two agree only where every pool that paid traded 1:1. They do
 * not whenever a pool trades at another rate, and two shipped rules do exactly
 * that:
 *
 *   - an ATTUNED pool eats 2 damage per point from its own type, so 30 blocked
 *     can cost as little as 15 points;
 *   - typed damage spilling into a TRUE pool burns 2 points per point blocked,
 *     so 12 blocked costs 24 points.
 *
 * The engine already reports the answer per pool (`damage.shieldDrain`, "points
 * actually REMOVED"), and `scripts/fight.ts` — the ground-truth log — has always
 * summed exactly this. Subtracting `blocked` here instead made the battle-scene
 * shield bar disagree with the log the moment attuned plating reached shipped
 * content, under-reporting the wall on every attuned block and over-reporting it
 * on every TRUE spill.
 *
 * DERIVED, NOT ASKED FOR: a `shieldAfter` on the damage event would touch every
 * log ever emitted for a number the renderer can compute exactly — the same call
 * `fight.ts` documents at its own `wall` tracker.
 *
 * Falls back to `blocked` only when `shieldDrain` is absent (an older cached
 * log), which is precisely the 1:1 case those logs could ever have carried.
 */
export function shieldPointsDrained(e: { blocked: number; shieldDrain?: ShieldPools }): number {
  const d = e.shieldDrain;
  return d === undefined ? e.blocked : d.physical + d.magical + d.true;
}

function formatBlockedPools(property: Property, drain: ShieldPools | undefined): string {
  if (!drain) return shieldToken(property);
  const parts: string[] = [];
  if (drain.physical > 0) parts.push(`P.SHIELD -${drain.physical}`);
  if (drain.magical > 0) parts.push(`M.SHIELD -${drain.magical}`);
  if (drain.true > 0) parts.push(`T.SHIELD -${drain.true}`);
  return parts.length > 0 ? parts.join(', ') : shieldToken(property);
}

/**
 * A compact per-pool breakdown for a shield total, e.g. "20 P · 30 M" — used
 * anywhere a shield NUMBER is shown (the HP-bar shield strip) so stacked
 * physical+magical+true shields never read as one merged pile. Returns
 * `undefined` when there's nothing to break out (no pool data yet, or only
 * one pool is nonzero — a single-pool total isn't "merged", it's just a
 * number), so callers fall back to their existing plain "+N" display.
 */
export function shieldPoolsLabel(pools: ShieldPools | undefined): string | undefined {
  if (!pools) return undefined;
  const parts: string[] = [];
  if (pools.physical > 0) parts.push(`${pools.physical} P`);
  if (pools.magical > 0) parts.push(`${pools.magical} M`);
  if (pools.true > 0) parts.push(`${pools.true} T`);
  return parts.length > 1 ? parts.join(' · ') : undefined;
}

/** Single-letter property abbreviation — mirrors `shieldPoolsLabel`'s P/M/T. */
function propertyLetter(p: Property): string {
  return p === 'physical' ? 'P' : p === 'magical' ? 'M' : 'T';
}

/**
 * Compact "GUARD 75%P 40%M" badge text for the HP-bar guard badge — one
 * `pct%LETTER` token per currently-mitigated property (see `guardPctByTurn`'s
 * doc comment for the compounding rule each pct already reflects), joined
 * with a single space so a unit carrying both a physical and a magical guard
 * at once reads as two numbers rather than one merged (and wrong) total.
 * `undefined` when nothing is standing, so callers can `&&`-gate the row
 * exactly like the EXPOSE badge's `(exposePct ?? 0) > 0` check.
 */
export function formatGuardBadge(entries: GuardBadgeEntry[]): string | undefined {
  if (entries.length === 0) return undefined;
  return `GUARD ${entries.map((e) => `${e.pct}%${propertyLetter(e.property)}`).join(' ')}`;
}

/**
 * Compact 3-letter chip glyph per status kind (the `<GLYPH> <total>` grammar
 * of the HP-block chip row). Buff/debuff chips lead with their STAT_TOKEN
 * instead (the stat IS the identity there); stun renders the bare glyph with
 * NO count — `MAX_STUN_PER_CARD` caps every stun at one performance, so any
 * number would be dishonest (the same user ruling, 2026-08-20, that made the
 * log row a bare "Stunned").
 */
const CHIP_GLYPH: Record<string, string> = {
  poison: 'PSN', burn: 'BRN', bleed: 'BLD', stun: 'STN', expose: 'EXP',
  guard: 'GRD', negate: 'NGT', ward: 'WRD', thorns: 'THR',
};

/**
 * FIXED chip display order (not application order, not severity-by-magnitude):
 * threats first — the DoT damage clock, then lockdown, then the two incoming-
 * hit amplifiers (expose, stat debuffs) — then the unit's own defenses
 * (guard/negate/ward/thorns), stat buffs last. Fixed so (a) a chip never
 * changes position when a NEIGHBOR expires mid-scrub, and (b) when a narrow
 * row overflows into "+N", what gets cut is always the least
 * survival-relevant tail, deterministically, on every platform.
 */
const STAT_MOD_STAT_ORDER: readonly BuffableStat[] = ['attack', 'magicPower', 'armor', 'magicResist', 'speed'];

function propertyWord(p: Property | undefined): string {
  return p === 'magical' ? 'magical' : p === 'physical' ? 'physical' : p === 'true' ? 'true' : 'all';
}

/**
 * Plain-language explanation for a defensive/support status — surfaced as the
 * timeline row's expandable `detail` (tap/click to expand; no hover anywhere
 * for statuses — the mechanic itself, unlike the HIT `D:` math strip, doesn't
 * need a second hover affordance). DoT statuses (poison/burn/bleed) already
 * print their stacks in the main log line (the `stacksText` building above
 * this function's call site), so they return `undefined` here and stay a
 * single-line entry. Stun is bare "Stunned" on the main line (user ruling
 * 2026-08-20) with no count anywhere — `MAX_STUN_PER_CARD` caps it at one
 * performance, so there is nothing honest to count.
 */
function explainStatus(e: Extract<CombatEvent, { kind: 'statusApplied' }>): string | undefined {
  const turnWord = (n: number): string => `${n} turn${n === 1 ? '' : 's'}`;
  switch (e.status) {
    case 'guard':
      return `-${e.pct ?? 0}% incoming ${propertyWord(e.property)} damage, ${turnWord(e.turns)}.`;
    case 'negate': {
      const charges = e.charges ?? 1;
      return `Fully blocks the next ${charges} ${propertyWord(e.property)} hit${charges === 1 ? '' : 's'}.`;
    }
    case 'ward': {
      const charges = e.charges ?? 1;
      return `Prevents the next ${charges} incoming poison/burn/bleed/debuff/expose application${charges === 1 ? '' : 's'} before it lands — does not stop stuns or buffs.`;
    }
    case 'expose':
      return `+${e.pct ?? 0}% damage taken from direct hits, ${turnWord(e.turns)}.`;
    case 'buff':
    case 'debuff': {
      const stat = e.stat ? STAT_TOKEN[e.stat] : '?';
      const sign = e.status === 'buff' ? '+' : '-';
      const value = e.pct !== undefined ? `${e.pct}%` : `${e.amount ?? 0}`;
      return `${sign}${value} ${stat}, ${turnWord(e.turns)}.`;
    }
    default:
      return undefined;
  }
}

/**
 * Property-qualified GUARD token, mirroring `shieldToken`'s P./M./T. split.
 *
 * A `guard` carries its OWN `property` (engine `Action` union, src/engine/types.ts)
 * and reduces ONLY incoming damage of that property — and it is NOT inferable
 * from the card's property, because a gem can graft a differently-typed guard
 * onto any card (e.g. a TRUE guard). A bare "Guard" therefore tells the player
 * nothing about what it actually covers; the pool tokens on the same log
 * (P.SHIELD / M.SHIELD / T.SHIELD) already set the precedent.
 */
function guardToken(property: Property | undefined): string {
  if (!property) return 'Guard';
  return property === 'physical' ? 'P.GUARD' : property === 'magical' ? 'M.GUARD' : 'T.GUARD';
}

/**
 * Property-qualified NEGATE token, exactly mirroring `guardToken` above.
 *
 * A `negate` carries its OWN `property` (not inferable from the card's) and
 * fully blocks only incoming hits of that property — a bare "Negate" told the
 * player nothing about what it stops, same gap Guard had before P./M./T.GUARD.
 */
function negateToken(property: Property | undefined): string {
  if (!property) return 'Negate';
  return property === 'physical' ? 'P.NEGATE' : property === 'magical' ? 'M.NEGATE' : 'T.NEGATE';
}

/** The defensive scaling stat token for a shield/heal, per the engine's
 * `scaleDefStat` (physical → Armor, magical → Magic Resist, TRUE → none). */
function defStatToken(property: Property): string {
  return property === 'physical' ? STAT_TOKEN.armor : STAT_TOKEN.magicResist;
}

/**
 * The HIT `D:` math detail (locked grammar): base n + (n LABEL) … = total.
 *
 * INVARIANT: every printed term must sum to the printed total (`hpDamage`) —
 * that is the whole point of a math strip a player opens to check the
 * arithmetic. Two terms were missing for a long time (`exposeBonus`,
 * `minimumDamageBonus`, both on `DamageCalculation`, events.ts) and the strip
 * silently violated its own invariant instead: a hit amplified by an active
 * `expose` printed terms that summed to a fraction of the real total, and a
 * hit that only survived because of the engine's minimum-1 floors printed
 * terms that summed to zero. Order follows the engine's own pipeline
 * (`applyStrike`/`dealDamage`, combat/interpreter.ts): the two floor stages
 * `minimumDamageBonus` combines land right after DEF (the floor immediately
 * following the defense subtraction); GUARD (a % reduction) and EXPOSE (a %
 * amplification) both run inside `dealDamage`, guard first, in that order.
 */
export function formatDmg(c: NonNullable<Extract<CombatEvent, { kind: 'damage' }>['calculation']>): string {
  const stat = c.scalingStat === 'attack' ? STAT_TOKEN.attack : STAT_TOKEN.magicPower;
  const def = c.scalingStat === 'attack' ? STAT_TOKEN.armor : STAT_TOKEN.magicResist;
  const terms = [`base ${c.power}`];
  const add = (label: string, v: number): void => { if (v) terms.push(`${v > 0 ? '+' : '−'} (${Math.abs(v)} ${label})`); };
  add(stat, c.baseStat);
  add('BUFF', c.statBonusDamage);
  add('BONUS', c.effectBonusDamage);
  add(def, -c.defense);
  add('MIN', c.minimumDamageBonus);
  add('AFFINITY', c.matchupBonusDamage);
  add('RAMP', c.suddenDeathBonusDamage);
  add('GUARD', -c.guardReduction);
  add('EXPOSE', c.exposeBonus ?? 0);
  add('BLOCK', -c.shieldBlocked);
  return `D: ${terms.join(' ')} = ${c.hpDamage}`;
}

/**
 * The heal `H:` math detail — the same derivation grammar as `formatDmg` and
 * `formatShield`, so a healed number is reconstructable instead of appearing
 * from nowhere: `base + (stat) + (skill) − (anti-heal) − (overheal) = landed`.
 *
 * TWO EMITTERS, TWO SHAPES (see the `heal` event in src/engine/combat/events.ts):
 *
 * - A `heal` ACTION always carries `calculation`, so the strip opens with the
 *   card's flat `base` and adds the caster's DEFENSIVE scaling stat (DEF / MDEF
 *   — healing is defensive output, see `scaleDefStat`) plus any flat aura/gem
 *   heal bonus (`SKILL`, same token the HIT strip uses for that family). A TRUE
 *   heal is flat by identity: zero stat term, zero skill term, and it opens with
 *   `flat` to keep saying so (it is also immune to the anti-heal tax).
 * - The `lifesteal` rider carries NO `calculation` — its request is a percentage
 *   of damage dealt, with no card base and no stat term to split — so the strip
 *   opens with the whole request (`heal N`) instead of inventing a `base 0`.
 *   A pre-migration log without `calculation` degrades to that same reading,
 *   which stays true: the printed request is all the event knows.
 *
 * Returns undefined when there is nothing to derive (no stat/skill term, no tax,
 * no waste) — a strip reading "base 49 = 49" would be pure noise.
 */
export function formatHeal(e: Extract<CombatEvent, { kind: 'heal' }>): string | undefined {
  const c = e.calculation;
  const reduced = e.antiHeal?.reduced ?? 0;
  // `calculation.bonus` is a rider's flat contribution to the REQUEST
  // (`cleanseConvert` today), so it belongs in the build-up beside the stat and
  // aura terms — otherwise a heal that is nothing BUT base + rider bonus would
  // print no strip at all and the number would go unexplained.
  const buildUp = c ? c.statBonus + c.healFlat + (c.bonus ?? 0) : 0;
  if (buildUp <= 0 && reduced <= 0 && e.overheal <= 0) return undefined;
  // `amount + overheal + antiHeal.reduced` is the pre-tax request (the identity
  // documented on the event); with a `calculation` we can open with its parts.
  const request = e.amount + e.overheal + reduced;
  const terms = [c && !e.flat ? `base ${c.power}` : `${e.flat ? 'flat' : 'heal'} ${request}`];
  if (c && c.statBonus > 0) terms.push(`+ (${c.statBonus} ${defStatToken(c.property)})`);
  if (c && c.healFlat > 0) terms.push(`+ (${c.healFlat} BONUS)`);
  // A TRUE heal opens with the whole `flat N` request, which already INCLUDES the
  // bonus, so adding the term again would double-count it in the printed sum.
  if (c && !e.flat && (c.bonus ?? 0) > 0) terms.push(`+ (${c.bonus} RIDER)`);
  if (reduced > 0) terms.push(`− (${reduced} ANTI-HEAL)`);
  if (e.overheal > 0) terms.push(`− (${e.overheal} OVERHEAL)`);
  return `H: ${terms.join(' ')} = ${e.amount}`;
}

/**
 * The shield `S:` math detail, same grammar. The engine DOES report this one:
 * `calculation.power` is the card's flat base and `calculation.statBonus` the
 * caster's DEFENSIVE scaling stat (Armor / Magic Resist — see `scaleDefStat`),
 * and `wasted` is the part the maxHp shield cap refused.
 */
export function formatShield(e: Extract<CombatEvent, { kind: 'shieldGain' }>): string | undefined {
  const c = e.calculation;
  // No breakdown, or nothing to break down (a flat TRUE shield that fit under
  // the cap) — a strip reading "92 = 92" would be noise.
  if (!c || (c.statBonus <= 0 && e.wasted <= 0)) return undefined;
  const terms = [`base ${c.power}`];
  if (c.statBonus > 0) terms.push(`+ (${c.statBonus} ${defStatToken(e.property)})`);
  if (e.wasted > 0) terms.push(`− (${e.wasted} CAPPED)`);
  return `S: ${terms.join(' ')} = ${e.amount}`;
}

/**
 * Folds a battle into a renderer-agnostic playback model (log lines, per-step
 * HP/shield/status/FX snapshots, and a battle-ledger summary). Pure — no
 * Phaser, no scene state; every battle scene calls this and only renders it.
 *
 * `log` is REQUIRED and comes from the battle service — the client has no way
 * to produce one. `input` supplies only what rendering needs: hero/foe setups,
 * names, stats, and boards.
 */
export function buildBattleTimeline(input: BattleTimelineInput, log: BattleLog): BattleTimeline {
  const heroEncounter = buildAutoHeroSetup(input.heroLevel, input.pieces.map((p) => ({ ...p })), input.heroAllocation);
  const hero = heroEncounter.setup;
  const teamConfigs: readonly EnemyFightConfig[] = input.enemyTeam && input.enemyTeam.length > 0
    ? input.enemyTeam
    : [{ enemyId: input.enemyId, level: input.enemyLevel, title: input.enemyTitle, rank: input.enemyRank, modifiers: [...(input.enemyModifiers ?? [])], affix: input.enemyAffix ?? null }];
  // `cfg.affix` is the elite affix (see `EnemyFightConfig`): the board rendered
  // mid-battle must contain the affix card the service actually resolved with,
  // or the enemy's card column would disagree with its own event log. Same
  // rule for `cfg.deck` (sandbox custom foe deck): the rendered board must be
  // the SAME custom board the service re-resolved from this identical config.
  const encs = teamConfigs.map((cfg) => buildEnemyEncounter(cfg.enemyId, cfg.level, cfg.title, cfg.rank, cfg.modifiers, cfg.affix ?? null, undefined, cfg.deck ?? null));
  const foeSetups = encs.map((e) => e.setup);
  const heroName = hero.name;
  const heroStats: ScalingStats = { attack: hero.stats.attack, magicPower: hero.stats.magicPower, armor: hero.stats.armor, magicResist: hero.stats.magicResist };

  const heroPieces: BattlePiece[] = [];
  const heroSkills: SkillDef[] = [];
  for (const p of input.pieces) {
    const base = skillBook[p.skillId]; if (!base) continue;
    // Tier + socketed-gem fold (resolver seam, display-only) — the board
    // rendered mid-battle must show the SAME face (numbers, effects, and
    // therefore targeting scope) as prep/deck-build's owned board, not the
    // bronze base. This card's board was rendering the un-resolved base
    // definition regardless of its owned tier/gem until fixed alongside the
    // AoE-scope face marker (see `isAoeSkill`, ui/skillPresentation.ts) —
    // without this, an owned Gold AoE card would still show its Bronze,
    // single-target face mid-fight.
    const s = resolveDisplaySkill(base, p);
    heroPieces.push({ skill: s, slot: p.slot, ...(p.tier ? { tier: p.tier } : {}) }); heroSkills.push(s);
  }
  const statLineOf = (s: { attack: number; magicPower: number; armor: number; magicResist: number; speed: number }): string =>
    `${STAT_TOKEN.attack} ${s.attack} · ${STAT_TOKEN.magicPower} ${s.magicPower} · ${STAT_TOKEN.armor} ${s.armor} · ${STAT_TOKEN.magicResist} ${s.magicResist} · ${STAT_TOKEN.speed} ${s.speed}`;
  const foes: FoeModel[] = foeSetups.map((setup) => {
    const pieces: BattlePiece[] = [];
    const skills: SkillDef[] = [];
    for (const p of setup.pieces) {
      const base = skillBook[p.skillId]; if (!base) continue;
      // ONE display-resolve for both boards (`resolveDisplaySkill`), not two.
      // The foe path used to run `p.tier ? applyTier(base, p.tier) : base`, which
      // differs from the hero path in two ways that are both live defects rather
      // than latent ones:
      //   - it drops a socketed GEM's face (no enemy carries one today, so this
      //     half was latent — but the foe board would silently show the ungemmed
      //     card the first time one did);
      //   - it SKIPS `applyTier` entirely for an untiered piece. That is not a
      //     no-op: `applyTier` is also where the TIER LOCK resolves (see
      //     `resolveEffectiveSkill`, engine/cards.ts — "an untiered piece plays
      //     the card's own tier, which must still drop any line locked above
      //     it"). An untiered foe piece therefore rendered lines the card does
      //     not actually cast.
      // `setup.pieces` is `BoardPiece[]`, which is exactly what
      // `resolveDisplaySkill` takes, so this is the same call the hero board and
      // the shop's owned board already make.
      const s = resolveDisplaySkill(base, p);
      pieces.push({ skill: s, slot: p.slot, ...(p.tier ? { tier: p.tier } : {}) }); skills.push(s);
    }
    return {
      name: setup.name,
      stats: { attack: setup.stats.attack, magicPower: setup.stats.magicPower, armor: setup.stats.armor, magicResist: setup.stats.magicResist },
      maxHp: setup.stats.maxHp,
      boardSize: setup.boardSize,
      pieces,
      skills,
      statLine: statLineOf(setup.stats),
    };
  });
  const foeName = foes[0]!.name;
  const foeStats = foes[0]!.stats;
  const foePieces = foes[0]!.pieces;
  const foeSkills = foes[0]!.skills;

  // The setups built above are for RENDERING ONLY (names, stats, boards). The
  // authoritative combat result is the served log.
  const battle: BattleLog = log;
  const outcome = battle.result === 'win' ? 'VICTORY' : 'DEFEAT';

  const linesByTurn = new Map<number, LogLine[]>();
  const hpByTurn = new Map<number, HpSnap>();
  const shieldByTurn = new Map<number, ShieldSnap>();
  const statusByTurn = new Map<number, { player: string[]; enemy: string[]; enemyUnits?: string[][] }>();
  const chipsByTurn = new Map<number, StatusChipsSnap>();
  const slotModsByTurn = new Map<number, SlotModsSnap>();
  const exposePctByTurn = new Map<number, { player: number; enemy: number; enemyUnits?: number[] }>();
  const guardPctByTurn = new Map<number, GuardSnap>();
  const speedByTurn = new Map<number, SpeedSnap>();
  const playSlotByTurn = new Map<number, { player?: number; enemy?: number; enemyUnits?: Array<number | undefined> }>();
  const comboArchetypesByTurn = new Map<number, ComboArchetypeSnap>();

  // Per-unit live state — enemy-side values are ARRAYS indexed by event `unit`.
  const playerMax = hero.stats.maxHp;
  let curPlayer = playerMax;
  const enemyMaxes = foes.map((f) => f.maxHp);
  const curEnemies = [...enemyMaxes];
  let shieldPlayer = 0;
  const shieldEnemies = foes.map(() => 0);
  // Per-property breakdown of the SAME points the bar above shows — stays
  // undefined per side/unit until the ledger can be seeded exactly (see
  // `gainPoints`), and is dropped back to undefined the moment the log stops
  // being able to say where the points went (see `breakPoints`). This is what
  // lets the UI show "20 P · 30 M" instead of one merged "50".
  //
  // WHY IT IS A POINTS-PER-PROPERTY LEDGER AND NOT `shieldGain.poolsAfter`.
  // `poolsAfter` is the engine's UNTYPED `CombatantState.shields` only; an
  // ATTUNED pool (`attunedShields`) is deliberately not in it, but IS counted by
  // `totalAfter` — which is the number the bar shows. So seeding the strip from
  // `poolsAfter` made the strip disagree with the bar beside it by exactly the
  // attuned points, and then `shieldDrain` (which buckets an attuned pool's
  // spend into its OWN property, by the engine's own design note) decayed an
  // untyped pool the damage had never come from. Accumulating `amount` per
  // `property` instead is exact for both: every gain adds its points to one
  // property, every drain removes them from one property, and the running sum
  // is `totalAfter` on the nose (asserted at every authoritative event below).
  let shieldPoolsPlayer: ShieldPools | undefined;
  const shieldPoolsEnemies: Array<ShieldPools | undefined> = foes.map(() => undefined);
  const shieldOf = (side: 'player' | 'enemy', u: number): number => (side === 'player' ? shieldPlayer : shieldEnemies[u] ?? 0);
  const setShield = (side: 'player' | 'enemy', u: number, v: number): void => {
    if (side === 'player') shieldPlayer = v; else shieldEnemies[u] = v;
  };
  const poolsOf = (side: 'player' | 'enemy', u: number): ShieldPools | undefined =>
    (side === 'player' ? shieldPoolsPlayer : shieldPoolsEnemies[u]);
  const setPools = (side: 'player' | 'enemy', u: number, v: ShieldPools | undefined): void => {
    if (side === 'player') shieldPoolsPlayer = v; else shieldPoolsEnemies[u] = v;
  };
  /**
   * Fold one `shieldGain` into the ledger, then RECONCILE against the engine's
   * own `totalAfter`. Two guards keep the strip honest rather than plausible:
   * a ledger that is not yet seeded only starts on a gain that lands on an EMPTY
   * wall (`totalAfter === amount`, so the whole wall is this one property), and
   * any ledger whose sum stops matching `totalAfter` is discarded — the bar keeps
   * the exact number and the strip simply stops claiming a split it cannot prove.
   */
  const gainPoints = (side: 'player' | 'enemy', u: number, property: Property, amount: number, totalAfter: number): void => {
    let pools = poolsOf(side, u);
    if (pools === undefined && totalAfter - amount === 0) pools = { physical: 0, magical: 0, true: 0 };
    if (pools === undefined) return;
    pools[property] += amount;
    setPools(side, u, poolsSum(pools) === totalAfter ? pools : undefined);
  };
  /**
   * Fold one `shieldBroken` (a `shieldBreak` shatter or a `shieldBurst` spend)
   * into the ledger. The event carries no property, so the split is knowable only
   * when a single property is standing — then every broken point can only have
   * come from it. Otherwise the breakdown is withheld until the wall empties
   * (`totalAfter === 0`), which re-seeds it exactly at zero.
   */
  const breakPoints = (side: 'player' | 'enemy', u: number, amount: number, totalAfter: number): void => {
    let pools = poolsOf(side, u);
    if (pools) {
      const live = SHIELD_PROPERTIES.filter((q) => pools![q] > 0);
      const only = live.length === 1 ? live[0]! : undefined;
      if (only === undefined) pools = undefined;
      else {
        pools[only] = Math.max(0, pools[only] - amount);
        if (poolsSum(pools) !== totalAfter) pools = undefined;
      }
    }
    setPools(side, u, totalAfter === 0 ? { physical: 0, magical: 0, true: 0 } : pools);
  };
  const speed: SpeedSnap = { player: '', enemy: '', enemyUnits: foes.map(() => '') };
  // Shadow-mirror of the engine's `CombatantState.lastCastArchetypes`
  // (combat/state.ts) — see `ComboArchetypeSnap`'s doc comment for the full
  // derivation. Starts `[]` for every side/unit, exactly matching the
  // engine's own `initCombatant` (nothing cast yet this fight = combo never
  // live on the very first evaluation).
  let lastCastArchetypesPlayer: Archetype[] = [];
  const lastCastArchetypesEnemies: Archetype[][] = foes.map(() => []);
  const dotsPlayer = new Map<string, number>();
  const dotsEnemies = foes.map(() => new Map<string, number>());
  // Shadow-mirror of the engine's expose ANTICHAIN (interpreter.ts, "MAX, NOT
  // SUM (2026-08-18)"): re-applying expose no longer refreshes a single pile —
  // separate applications COEXIST (each keeps its own pct for its own window),
  // and incoming damage amplifies by the STRONGEST currently-standing pile's
  // pct, not the most recently applied one. The old code fed the `dotsPlayer`/
  // `dotsEnemies` 'expose' badge value straight from each `statusApplied`
  // event's `pct` (last-event-wins) and wiped it on ANY `statusExpired`
  // (whichever pile happened to end first), so a weak reapplication landing on
  // a unit already carrying a strong pile made the badge DROP to the weak
  // number while the engine kept amplifying at the strong one — and the
  // strong pile's own natural expiry could blank the badge even while a
  // second, weaker pile was still live.
  //
  // Fix: track every application's (pct, expiresAtTurn) and always report the
  // MAX pct among piles still active "as of" the turn being displayed —
  // exactly the engine's `strongestPct` scan in `dealDamage`. `expiresAtTurn`
  // is computed once, at application time, as `e.turn + e.turns` — the exact
  // turn number the engine's OWN natural-expiry `statusExpired` event reports
  // for that pile (`expireStatuses`/`simulate.ts`: durations decrement once
  // per turn, skipping the turn a pile was freshly applied, so a pile applied
  // turn T for N turns is still active through turn T+N and is removed only at
  // the END of turn T+N). Piles are never spliced out on a later STRONGER
  // application overwriting them (the engine's own domination/replace bookkeeping,
  // interpreter.ts's `expose` arm) because a pile the engine would have dropped
  // as "dominated" (pct <= AND expiresAtTurn <= the new one) can, by
  // definition, never win the max over any turn range the new pile doesn't
  // already cover at least as strongly — so leaving it in the shadow list and
  // just re-taking the max is byte-identical to pruning it, without needing to
  // replicate the engine's replace step at all. `cleanse` is the one exception
  // (an artificial, out-of-band removal `expiresAtTurn` can't express) and is
  // handled at its own call site below by dropping the soonest-expiring
  // pile(s), mirroring the engine's documented "expiring-soonest first" order.
  interface ExposePile { pct: number; expiresAtTurn: number; }
  const exposePilesPlayer: ExposePile[] = [];
  const exposePilesEnemies: ExposePile[][] = foes.map(() => []);
  const exposePilesFor = (side: 'player' | 'enemy', unit: number): ExposePile[] =>
    (side === 'player' ? exposePilesPlayer : exposePilesEnemies[unit]!);
  /** Max pct among piles still active AS OF `turn` — mirrors the engine's
   * `strongestPct` scan over `victim.statuses` exactly (see doc above); 0
   * when nothing is standing. `turn` is inclusive by default (a pile applied
   * turn T for N turns is active through turn T+N, matching a `statusApplied`
   * event query at any turn in that span); pass `strict: true` from a
   * `statusExpired`(expose) handler, where `e.turn` IS a pile's own
   * `expiresAtTurn` and the event means "as of now, that pile no longer
   * counts" — a `>=` query there would count the very pile the event is
   * announcing the end of. */
  const effectiveExposePct = (piles: ExposePile[], turn: number, strict = false): number =>
    piles.reduce((max, p) => {
      const active = strict ? p.expiresAtTurn > turn : p.expiresAtTurn >= turn;
      return active && p.pct > max ? p.pct : max;
    }, 0);
  // Guard's own shadow-pile mirror, the sibling of the expose antichain above
  // (same idiom, different compounding rule). UNLIKE expose, a guard's real
  // read rule (interpreter.ts `dealDamage`, "Magical Guard") is neither
  // MAX-of-standing-piles nor a merge into one pile: every matching-PROPERTY
  // pile applies in turn, multiplicatively, over the array of statuses (which
  // is application order — `addStatus` only ever pushes) — so a badge fed
  // from the last `statusApplied` event's own pct (or a naive sum) would both
  // be wrong the moment a second same-property guard is standing at once.
  // Guard is also PROPERTY-SCOPED (unlike expose, which amplifies ANY direct
  // hit regardless of property) — a physical guard and a magical guard on the
  // same unit are two independent mitigations, so piles are grouped by
  // `property` before compounding, and the badge is an ARRAY, one entry per
  // property currently mitigated, never a single number.
  interface GuardPile { property: Property; pct: number; expiresAtTurn: number; }
  const guardPilesPlayer: GuardPile[] = [];
  const guardPilesEnemies: GuardPile[][] = foes.map(() => []);
  const guardPilesFor = (side: 'player' | 'enemy', unit: number): GuardPile[] =>
    (side === 'player' ? guardPilesPlayer : guardPilesEnemies[unit]!);
  /** Deterministic display order, independent of application order (which pile
   * landed first has no bearing on which property should list first). */
  const GUARD_PROPERTY_ORDER: Property[] = ['physical', 'magical', 'true'];
  /** Every property's EFFECTIVE (compounded) mitigation among piles still
   * active AS OF `turn` — `strict`/inclusive semantics exactly mirror
   * `effectiveExposePct` above (a `statusExpired` handler passes `strict:
   * true`, meaning "as of now, this pile is gone"). For each property, the
   * piles matching it are walked in application order over a normalized
   * 100-unit hit — `remaining = max(1, floor(remaining * (100-pct) / 100))`
   * per pile, EXACTLY the engine's own per-hit loop — and the reported pct is
   * `100 - remaining`: two 50% piles leave `max(1, floor(100*50/100))=50`,
   * then `max(1, floor(50*50/100))=25`, so the badge reads 75%, not 100%
   * (naive sum) or 50% (last-applied-wins). A property with no active pile is
   * simply absent from the returned array (0% is "not mitigated", not "0%
   * guard" — nothing to badge). */
  const effectiveGuardByProperty = (piles: GuardPile[], turn: number, strict = false): GuardBadgeEntry[] => {
    const byProperty = new Map<Property, number[]>();
    for (const p of piles) {
      const active = strict ? p.expiresAtTurn > turn : p.expiresAtTurn >= turn;
      if (!active) continue;
      const pcts = byProperty.get(p.property);
      if (pcts) pcts.push(p.pct); else byProperty.set(p.property, [p.pct]);
    }
    const out: GuardBadgeEntry[] = [];
    for (const [property, pcts] of byProperty) {
      let remaining = 100;
      for (const pct of pcts) remaining = Math.max(1, Math.floor((remaining * (100 - pct)) / 100));
      const effective = 100 - remaining;
      if (effective > 0) out.push({ property, pct: effective });
    }
    out.sort((a, b) => GUARD_PROPERTY_ORDER.indexOf(a.property) - GUARD_PROPERTY_ORDER.indexOf(b.property));
    return out;
  };
  // Last-computed guard badge entries per (side, unit) — the per-event flush
  // below (`guardPctByTurn.set`) reads THIS, not a fresh re-derive off the
  // piles at the flush's own `e.turn`. That distinction matters: the
  // `statusApplied`/`statusExpired` handlers below call `effectiveGuardByProperty`
  // with DIFFERENT `strict` values on purpose (inclusive on application,
  // exclusive-at-expiry on expiry — exactly `effectiveExposePct`'s own
  // strict/non-strict split), and re-deriving generically at flush time with
  // one fixed `strict` would silently override whichever one of those two
  // reads was actually correct for the event that just fired (proven: the
  // flush's own non-strict re-derive at a `statusExpired`'s exact
  // `expiresAtTurn` counted the just-expired pile as still active, because
  // non-strict is `>=`). `exposePctByTurn` sidesteps this the same way — it
  // reads `dotsPlayer.get('expose')`, a value the handlers already computed
  // with the right strictness, rather than recomputing from `exposePilesFor`
  // a second time at a possibly-wrong strictness.
  const guardBadgeCurrent = new Map<string, GuardBadgeEntry[]>();
  const guardBadgeKey = (side: 'player' | 'enemy', unit: number): string => `${side}:${unit}`;
  // Shadow-piles of ACTIVE stat buff/debuff instances per (side, unit) — fed
  // by statusApplied/statusExpired for `status: 'buff' | 'debuff'` exactly
  // like the expose/guard piles above (same `expiresAtTurn = e.turn + e.turns`
  // arithmetic, same natural-expiry contract from `statusExpired`'s doc). Two
  // consumers:
  //  - the STATUS CHIP row (`chipsByTurn`): chips aggregate the active piles
  //    per stat, mirroring the engine's own `effStat` (state.ts) — pct terms
  //    SUM per stat and flat terms SUM per stat, buffs and debuffs kept as
  //    separate chips because they are separate statuses with separate
  //    expiries (never netted into one number);
  //  - the `cleansed` disambiguation below, which used to be a bare COUNT
  //    (`debuffCountByUnit`) — the pile list carries strictly more (the count
  //    is `.length`), so the count map was folded into this.
  // `debuff` still feeds no HP-bar tint (no `AILMENT_TINT` entry —
  // ui/battleStatusPalette.ts); the chip row is where it becomes visible.
  interface StatModPile { stat: BuffableStat; pct: number; amount: number; expiresAtTurn: number; }
  const buffPilesByUnit = new Map<string, StatModPile[]>();
  const debuffPilesByUnit = new Map<string, StatModPile[]>();
  const unitKey = (side: 'player' | 'enemy', unit: number): string => `${side}:${unit}`;
  const statModPilesFor = (map: Map<string, StatModPile[]>, side: 'player' | 'enemy', unit: number): StatModPile[] => {
    const k = unitKey(side, unit);
    const arr = map.get(k);
    if (arr) return arr;
    const fresh: StatModPile[] = [];
    map.set(k, fresh);
    return fresh;
  };
  // Remaining NEGATE charges per (side, unit), per PROPERTY — negate is the
  // one chip whose pile the engine never announces the end of: charges are
  // spent by `negated` events (one charge per nullified hit, `dealDamage`,
  // interpreter.ts) and the emptied status is silently filtered out — NO
  // `statusExpired` ever fires for it (the wear-off row case below documents
  // the same fact). So the chip's count is reconstructed here: `statusApplied`
  // adds the application's charges (already clamped to `MAX_NEGATE_CHARGES`
  // per property by the engine before the event is emitted), each `negated`
  // subtracts one. Keyed per property because a negate only stops hits of its
  // OWN property (same reason `guardToken`/`negateToken` are property-
  // qualified) — one merged count would claim coverage the unit doesn't have.
  const negateChargesByUnit = new Map<string, { physical: number; magical: number; true: number }>();
  const negateChargesFor = (side: 'player' | 'enemy', unit: number): { physical: number; magical: number; true: number } => {
    const k = unitKey(side, unit);
    const cur = negateChargesByUnit.get(k);
    if (cur) return cur;
    const fresh = { physical: 0, magical: 0, true: 0 };
    negateChargesByUnit.set(k, fresh);
    return fresh;
  };
  // Remaining WARD charges per (side, unit) — the HOLDER TOTAL across piles
  // (a recast opens a new pile, interpreter.ts's `ward` arm). Additions come
  // from `statusApplied` (engine-clamped to `MAX_WARD_CHARGES`); every spend
  // re-syncs to the event's own authoritative `chargesLeft` (`warded` /
  // `wardReleased` both report the holder total after the spend), so the chip
  // can never drift from the engine's count. NOTE the pre-existing `bucket`
  // ward VALUE (set at application) is a single PILE's charges and goes stale
  // across spends — the chip deliberately reads THIS tracker instead; the
  // bucket keeps only its presence-for-tint job.
  const wardChargesByUnit = new Map<string, number>();
  /**
   * Aggregate one kind's ACTIVE stat-mod piles into per-stat chips, mirroring
   * the engine's own `effStat` fold (state.ts): pct terms SUM per stat and
   * flat terms SUM per stat — never a "last applied wins". Buff and debuff
   * stay SEPARATE chips (separate statuses, separate expiries — netting them
   * into one signed number would hide that a +30% buff and a −20% debuff are
   * two windows ending at two different turns). Fixed stat order so chips
   * never reshuffle between turns. Remaining duration is deliberately NOT on
   * the chip (mobile width; the application row's expandable detail states it).
   */
  const statModChips = (kind: 'buff' | 'debuff', piles: StatModPile[] | undefined): StatusChip[] => {
    if (!piles || piles.length === 0) return [];
    const out: StatusChip[] = [];
    const sign = kind === 'buff' ? '+' : '−';
    for (const stat of STAT_MOD_STAT_ORDER) {
      let pct = 0;
      let flat = 0;
      for (const p of piles) {
        if (p.stat === stat) { pct += p.pct; flat += p.amount; }
      }
      if (pct <= 0 && flat <= 0) continue;
      const parts = `${pct > 0 ? `${sign}${pct}%` : ''}${flat > 0 ? `${sign}${flat}` : ''}`;
      out.push({ kind, text: `${STAT_TOKEN[stat]} ${parts}` });
    }
    return out;
  };
  /**
   * One (side, unit)'s STATUS CHIP row, in `CHIP_KIND_ORDER`'s fixed order
   * (see that constant's doc for the ordering rationale) — every value read
   * from the reconstructions this file already maintains, never re-derived:
   *
   *  - PSN/BRN/BLD n — the pile's CURRENT stacks (the `dots*` buckets, kept
   *    in tick-lockstep by the `damage` case). Engine stack semantics
   *    (simulate.ts): a poison/bleed tick deals the CURRENT stack count then
   *    sheds one stack; a burn tick deals 2× stacks then HALVES (floored) —
   *    so the chip's n is "what the next tick deals" (×2 for burn), not a
   *    remaining-damage sum.
   *  - STN — bare, no count (see `CHIP_GLYPH`'s stun note).
   *  - EXP +n% — the EFFECTIVE (strongest standing pile) amplification, the
   *    same value `exposePctByTurn` reports.
   *  - stat debuffs / buffs — see `statModChips`.
   *  - GRD … — the EFFECTIVE compounded per-property mitigation from
   *    `guardBadgeCurrent` (already computed at the event's correct
   *    strictness — see that map's doc).
   *  - NGT nP/nM/nT — remaining negate charges per property, one chip per
   *    property still holding charges (fixed P→M→T order).
   *  - WRD n — the holder's TOTAL remaining ward charges.
   *  - THR n — remaining thorn stacks (sting decay mirrored in the `damage`
   *    case).
   */
  const buildChips = (side: 'player' | 'enemy', unit: number): StatusChip[] => {
    const bucket = side === 'player' ? dotsPlayer : dotsEnemies[unit]!;
    const chips: StatusChip[] = [];
    for (const kind of ['poison', 'burn', 'bleed'] as const) {
      const stacks = bucket.get(kind) ?? 0;
      if (stacks > 0) chips.push({ kind, text: `${CHIP_GLYPH[kind]} ${stacks}` });
    }
    if (bucket.has('stun')) chips.push({ kind: 'stun', text: CHIP_GLYPH.stun! });
    const exposePct = bucket.get('expose') ?? 0;
    if (exposePct > 0) chips.push({ kind: 'expose', text: `${CHIP_GLYPH.expose} +${exposePct}%` });
    chips.push(...statModChips('debuff', debuffPilesByUnit.get(unitKey(side, unit))));
    const guardEntries = guardBadgeCurrent.get(guardBadgeKey(side, unit)) ?? [];
    if (guardEntries.length > 0) {
      chips.push({ kind: 'guard', text: `${CHIP_GLYPH.guard} ${guardEntries.map((g) => `${g.pct}%${propertyLetter(g.property)}`).join(' ')}` });
    }
    const neg = negateChargesByUnit.get(unitKey(side, unit));
    if (neg) {
      for (const p of SHIELD_PROPERTIES) {
        if (neg[p] > 0) chips.push({ kind: 'negate', text: `${CHIP_GLYPH.negate} ${neg[p]}${propertyLetter(p)}` });
      }
    }
    const wardCharges = wardChargesByUnit.get(unitKey(side, unit)) ?? 0;
    if (wardCharges > 0) chips.push({ kind: 'ward', text: `${CHIP_GLYPH.ward} ${wardCharges}` });
    const thorns = bucket.get('thorns') ?? 0;
    if (thorns > 0) chips.push({ kind: 'thorns', text: `${CHIP_GLYPH.thorns} ${thorns}` });
    chips.push(...statModChips('buff', buffPilesByUnit.get(unitKey(side, unit))));
    return chips;
  };
  /** The turn's standing burden/curse per slot — read off the SAME shadow maps
   * the PLAY/WAIT rows name their taxes from, so badge and log always agree. */
  const snapSlotMods = (): SlotModsSnap => {
    const out: SlotModsSnap = {};
    for (const [k, weight] of pendingBurdenBySlot) out[k] = { burden: weight };
    for (const [k, amount] of cursedBySlot) out[k] = { ...(out[k] ?? {}), curse: amount };
    return out;
  };
  // Shadow-tracks the engine's own `nextWeightPenalty` (combat/state.ts) so a
  // `slow` rider's pending bonus weight can be named on the WAIT/PLAY row of
  // the very card it will hit, not just the DEBUFF row announcing it landed.
  // Mirrors the engine's own rule exactly (Math.max per re-application) —
  // and, since cb2cc6c, the tax now has TWO exits, whichever comes first: the
  // victim's next resolved cast THIS TURN (`c.nextWeightPenalty = 0` in
  // castSelect.ts/simulate.ts, mirrored in the `play` case below), or the end
  // of the turn, which drops it unpaid regardless of whether the victim ever
  // acted (`for (const c of units) c.nextWeightPenalty = 0` right before the
  // engine's own `end` event — mirrored by clearing this whole map on the
  // `end` case below). Reconstructed bookkeeping over already-emitted events,
  // same idiom as the `dotsPlayer`/`dotsEnemies` pile-delta tracking above,
  // not a combat decision.
  const pendingSlowByUnit = new Map<string, number>();
  const slowKey = (side: 'player' | 'enemy', unit: number): string => `${side}:${unit}`;
  // The CARD-scope twin of `pendingSlowByUnit` above, for `burden`
  // (`PieceState.nextWeightPenalty`, combat/state.ts). Keyed by side+unit+SLOT
  // because a burden taxes individual board pieces, not the unit: the anchor the
  // victim is about to play — plus its neighbours when a `splash` spread it —
  // each of which pays on ITS OWN next play. Same reconstructed-bookkeeping idiom
  // and the same two engine rules mirrored exactly — Math.max per
  // re-application, cleared when THAT piece plays (`simulate.ts`).
  const pendingBurdenBySlot = new Map<string, number>();
  // The CURSE twin, one currency over (`PieceState.curse`): the amount of damage
  // each cursed slot is losing while its window stands. Same per-slot keying and
  // the same `Math.max` rule; the difference is HOW it ends — a burden is spent
  // by a play, a curse EXPIRES, so this map is cleared by the engine's own
  // `curseExpired` event rather than by the `play` row (see both cases below).
  const cursedBySlot = new Map<string, number>();
  // Same key the exported `slotModKey` builds — delegated, not retyped, so the
  // per-turn `slotModsByTurn` snapshots and a scene's lookups can never drift
  // from the format these shadow maps are written with.
  const slotKey = slotModKey;
  const snapHp = (): HpSnap => ({
    player: curPlayer, enemy: curEnemies[0]!, playerMax, enemyMax: enemyMaxes[0]!,
    enemies: [...curEnemies], enemyMaxes: [...enemyMaxes],
  });
  const snapShield = (): ShieldSnap => ({
    player: shieldPlayer, enemy: shieldEnemies[0]!, enemies: [...shieldEnemies],
    playerPools: shieldPoolsPlayer ? { ...shieldPoolsPlayer } : undefined,
    enemyPools: shieldPoolsEnemies[0] ? { ...shieldPoolsEnemies[0] } : undefined,
    enemiesPools: shieldPoolsEnemies.map((p) => (p ? { ...p } : undefined)),
  });
  const activeCardByTurn = new Map<number, CardSummaryRow>();
  const cardSummaries = new Map<string, CardSummaryRow>();
  let playerDamage = 0;
  let enemyDamage = 0;
  let playerHealing = 0;
  // Cumulative-so-far ledger, snapshotted once per event (see the backfill
  // after the switch below) — cheap shallow clone of the running totals, not
  // a diff/delta scheme: fights run ~20-60 steps with ~10-20 cards, so a
  // fresh small array clone per event is simpler than tracking deltas and
  // costs nothing measurable.
  const snapshotSummary = (): CombatSummary => ({
    playerDamage, enemyDamage, playerHealing,
    // Only cards that have actually landed SOMETHING measurable — a played
    // card that hasn't connected yet (or never does) stays invisible rather
    // than appearing as an all-zero row. Both battle scenes used to filter
    // this same predicate themselves right before display; centralizing it
    // here means `summaryByStep`'s "a row only appears once it contributes"
    // guarantee holds for `combatSummary` too, for free.
    cards: [...cardSummaries.values()]
      .filter((c) => c.damage > 0 || c.shield > 0 || c.healing > 0 || c.dots > 0)
      .map((c) => ({ ...c }))
      .sort((a, b) => (a.side === b.side ? b.damage - a.damage : a.side === 'player' ? -1 : 1)),
  });
  let lastSummarySnapshot: CombatSummary = { playerDamage: 0, enemyDamage: 0, playerHealing: 0, cards: [] };
  const summaryByTurn = new Map<number, CombatSummary>();
  const unitOf = (e: { unit?: number }): number => e.unit ?? 0;
  const label = (e: Extract<CombatEvent, { side: 'player' | 'enemy' }>): string =>
    (e.side === 'player' ? heroName : (foes[unitOf(e as { unit?: number })]?.name ?? foeName));
  // STARTING roster size for `side` — fixed once at team-build time from
  // `foes`/the single hero unit, and never re-derived from who's still alive
  // mid-fight. This is exactly `scripts/fight.ts`'s convention (commit
  // 902e178): its `#n` disambiguator comes from `playerTeam.length` /
  // `enemyTeam.length`, values that never change once the fight starts, so a
  // unit's displayed identity is stable across a kill. An earlier version of
  // this file gated the target note on `curEnemies.filter(hp > 0).length`
  // (living count) INSTEAD of this static size — so a pack fight's "· target
  // Foe #2" note would silently vanish the instant an ally died, diverging
  // mid-fight from the ASCII log, which keeps printing it for the rest of the
  // fight (adversarial audit, 2026-08-19). Both the "show a target note at
  // all" gate and the `#n` suffix below now read this SAME static count, so
  // they can never drift apart from each other or from fight.ts again.
  const sideRosterSize = (side: 'player' | 'enemy'): number => (side === 'player' ? 1 : foes.length);
  // `#n` (1-based lineup position) only when the side's STARTING roster
  // actually fields more than one unit — same convention `scripts/fight.ts`
  // uses, so a 1v1 fight's target note never grows a redundant "#1", and a
  // pack fight's suffix never changes once the fight is underway.
  const sideUnitLabel = (side: 'player' | 'enemy', unit: number): string => {
    if (side === 'player') return heroName; // today's single hero unit — never ambiguous.
    const name = foes[unit]?.name ?? foeName;
    return sideRosterSize(side) > 1 ? `${name} #${unit + 1}` : name;
  };
  // Turn-start readiness row: the engine emits one `gain` event PER LIVING
  // COMBATANT at the top of every turn, always consecutively (before any
  // play/busy/wait event for that turn — see simulate.ts Phase 1). Buffer the
  // turn number here while those events land (each just updates `speed`,
  // below); the first non-`gain` event flushes ONE combined 'READY' row
  // naming every combatant's post-gain readiness — the same
  // "Name readiness · SPD +speed" grammar already used by the header
  // turnline, just also kept as a scrollable transcript row per the
  // 2026-08-05 bug report (readiness was visible in the header but had
  // drifted out of the per-turn log rows entirely).
  let pendingGainTurn: number | null = null;
  const flushGainRow = (): void => {
    if (pendingGainTurn === null) return;
    const t = pendingGainTurn;
    pendingGainTurn = null;
    const parts: string[] = [];
    if (speed.player) parts.push(`${heroName} ${speed.player}`);
    foes.forEach((f, u) => {
      const line = speed.enemyUnits?.[u] ?? (u === 0 ? speed.enemy : '');
      if (line) parts.push(`${f.name} ${line}`);
    });
    if (parts.length > 0) push(t, 'READY', parts.join('   ·   '));
  };
  // Every IMPORTANT line (anything but PLAY) becomes its own playback step,
  // captured here in event order; folded into per-turn-ordered final arrays
  // (with fallback steps for import-less turns) once the loop below ends.
  const stepRecords: StepRecord[] = [];
  // The enemy unit the CURRENT event involves (victim/beneficiary on the enemy
  // side, or the acting enemy when the hero is the victim) — captured onto each
  // step record so renderers can auto-focus that foe's tab during playback.
  let curActor: { side: 'player' | 'enemy'; unit: number } | undefined;
  let curFocus: number | undefined;
  // A 'play' event fires BEFORE the effects it triggers (see simulate.ts: the
  // engine pushes `play`, THEN runs `applyCast`, which is what emits the
  // damage/heal/shieldGain/statusApplied events for that very cast) — and
  // `push()` deliberately does NOT create a playback step for the PLAY line
  // itself (see below), so there is no step to attach a 'cast' fx to yet at
  // the moment the 'play' event is processed. Queue it here; the NEXT step
  // `push()` creates (almost always this same cast's own HIT/BUFF/DEBUFF
  // line, moments later in event order) picks it up and clears the queue.
  let pendingCastFx: TurnFx[] = [];
  const push = (turn: number, tag: string, text: string, detail?: string): LogLine => {
    const arr = linesByTurn.get(turn) ?? [];
    const line: LogLine = { tag, text, detail };
    arr.push(line);
    linesByTurn.set(turn, arr);
    if (tag !== 'PLAY') {
      // `summary` here is a placeholder — the running totals for a `damage`/
      // `heal`/`shieldGain` event are only incremented AFTER this call
      // returns (see each case below), so this step's real "as of this step"
      // snapshot (inclusive of the event that produced this very line) is
      // backfilled once the full event has finished processing, below.
      const fx = pendingCastFx;
      pendingCastFx = [];
      stepRecords.push({ turn, lineIndex: arr.length - 1, hp: snapHp(), shield: snapShield(), fx, focus: curFocus, summary: lastSummarySnapshot });
    }
    return line;
  };
  // A cast's `play` line is written before its matching `cost` event arrives
  // (see the `play` comment above — the engine emits `play`, then every
  // effect the cast triggers, and ONLY THEN `cost`), so the post-payment bank
  // it reports isn't known yet at push() time. Hold a reference to the just-
  // written PLAY line's LogLine object (mutable — see `LogLine`) here and fill
  // in its `· BANKED n` suffix the moment the matching `cost` event arrives
  // (the `cost` case below). One combatant performs at a time — its play,
  // every effect that cast triggers, and its own cost are always emitted back
  // to back with no OTHER combatant's `play` interleaved — so a single slot
  // (not a map) is enough; keyed by (side, unit) anyway as a self-check that
  // the `cost` actually matches the play it claims to.
  let pendingPlayLine: { side: 'player' | 'enemy'; unit: number; line: LogLine } | undefined;
  /** Identity fields threaded onto a fx from its source skill — undefined when
   * there's no skill to attribute (e.g. a DoT tick), in which case callers
   * keep their existing ailment-color fallback keyed off `source` instead. */
  const fxIdentity = (skill: SkillDef | undefined): Pick<TurnFx, 'archetype' | 'property' | 'element' | 'weapon'> =>
    skill ? { archetype: skill.archetypes[0], property: skill.property, element: skill.element, weapon: skill.weapon } : {};
  const pushFx = (side: 'player' | 'enemy', kind: 'damage' | 'heal' | 'shield', amount: number, unit: number, source?: string, skill?: SkillDef, antiHealPct?: number): void => {
    if (amount <= 0) return;
    const last = stepRecords[stepRecords.length - 1];
    if (last) last.fx.push({ side, kind, amount, source, unit, antiHealPct, ...fxIdentity(skill) });
  };

  // Step 0 — the pre-battle baseline. Without it, playback would open on the
  // first HIT with its damage already applied to the HP snapshot; this line
  // shows both sides at full HP before any event resolves.
  const foesLabel = foes.map((f, i) => `${f.name} ${curEnemies[i]}/${enemyMaxes[i]}`).join(' + ');
  push(battle.events[0]?.turn ?? 1, 'START', `${heroName} ${curPlayer}/${playerMax} vs ${foesLabel}`);

  for (const e of battle.events) {
    // Flush the buffered turn-start readiness row BEFORE this event's own
    // focus/step bookkeeping runs — every `gain` event for a turn lands
    // consecutively (simulate.ts Phase 1) before anything else that turn, so
    // the first non-`gain` event we see is exactly the flush point. The row
    // itself isn't foe-specific, so it deliberately does not disturb
    // `curFocus` for the event that actually triggers the flush.
    if (e.kind !== 'gain' && pendingGainTurn !== null) {
      const readyStepStart = stepRecords.length;
      flushGainRow();
      for (let i = readyStepStart; i < stepRecords.length; i++) stepRecords[i]!.summary = lastSummarySnapshot;
    }
    const sided = e as { side?: 'player' | 'enemy'; unit?: number };
    if (e.kind === 'play') curActor = { side: e.side, unit: unitOf(e) };
    if (sided.side === 'enemy') curFocus = sided.unit ?? 0;
    else if (sided.side === 'player') curFocus = curActor?.side === 'enemy' ? curActor.unit : undefined;
    const stepCountBeforeEvent = stepRecords.length;
    switch (e.kind) {
      // Readiness gain — mockup turnline: "Hero 18 · SPD +16 · Bandit 25 · SPD +15".
      // Buffered into ONE 'READY' transcript row per turn (see `flushGainRow`
      // above) rather than pushed per-combatant — the turn-start banked
      // readiness the 2026-08-05 bug report asked to see back in the scrolling
      // log, not just the header's current-turn-only turnline.
      case 'gain': {
        const line = `${e.readinessAfter} · SPD +${e.speed}`;
        if (e.side === 'player') speed.player = line;
        else { speed.enemyUnits![unitOf(e)] = line; if (unitOf(e) === 0) speed.enemy = line; }
        pendingGainTurn = e.turn;
        break;
      }
      case 'play': {
        // Multi-slot cards carry their span progress: the cast turn is 1/N,
        // the busy turns below continue 2/N … N/N. `weight` is the readiness
        // this cast just spent (the `cost` event that follows always pays
        // exactly `weight` — see docs/combat-model-spec.md §5.2) — shown here
        // so the deduction the READY row's next banked number reflects is
        // visible at the moment it's paid, not just implied.
        const progress = e.slotCount > 1 ? ` · ${e.slotIndex}/${e.slotCount}` : '';
        // A pending `slow`/nextWeightPenalty bonus is baked into `e.weight`
        // already (castSelect.ts folds it in before the engine ever emits this
        // event) — name it here so the inflated number is traceable to the
        // rider that caused it, then clear the shadow tracker: this is exit #1
        // of the tax's two exits (see the `pendingSlowByUnit` declaration
        // above) — the engine resets `nextWeightPenalty` to 0 the instant this
        // side/unit performs ANY cast, regardless of which piece. Exit #2 (the
        // tax going unpaid past end of turn) is mirrored on the `end` case,
        // below.
        const sk = slowKey(e.side, unitOf(e));
        const slowedBy = pendingSlowByUnit.get(sk);
        pendingSlowByUnit.delete(sk);
        // A `burden` is per PIECE, so it clears when THIS slot plays (unlike
        // the unit-wide slow above) — and both are already baked into
        // `e.weight` by castSelect.ts, so both are named rather than added.
        const bk = slotKey(e.side, unitOf(e), e.slot);
        const burdenedBy = pendingBurdenBySlot.get(bk);
        pendingBurdenBySlot.delete(bk);
        const slowNote = `${slowedBy ? ` (includes +${slowedBy} SLOWED)` : ''}${burdenedBy ? ` (includes +${burdenedBy} BURDENED)` : ''}`;
        // A standing `curse` on THIS slot, named on the row of the very cast it
        // weakens — the damage-axis counterpart of the two weight notes above,
        // and the same reason they exist: the hit that follows will come out
        // smaller than the card's face, with nothing else in the log to say why.
        // NOT deleted here: a burden is spent by this play, a curse is not — it
        // rides its window and is dropped by the engine's own `curseExpired`.
        const cursedBy = cursedBySlot.get(bk);
        const curseNote = cursedBy ? ` · CURSED −${cursedBy} damage` : '';
        // `e.aoe`/`e.targets` (engine/combat/events.ts's `TargetFields`) is
        // the one place the log can tell a cast that hit every living foe
        // from one that hit a single chosen target — surfaced here the same
        // way `slowNote` surfaces a hidden weight modifier, so the PLAY row
        // itself (not just the card face) distinguishes the two.
        const aoeNote = e.aoe ? ` · AOE ×${e.targets?.length ?? 0}` : '';
        // Named victim for a single-target cast — the same defect the ASCII
        // fight log just had fixed (commit 902e178): a pack fight's PLAY line
        // named the caster but never which of several foes its targeting
        // policy actually picked. Silent (no note) for a support/self cast (no
        // `targetUnit`), an AoE cast (already says `AOE ×N` above), or when
        // the target's side only STARTED the fight with one unit — a 1v1
        // fight's log reads byte-identically to before this fix. Gated on the
        // side's STARTING roster size (`sideRosterSize`), not who's still
        // alive right now: a kill mid-fight must not make this note (or its
        // `#n` suffix) disappear or renumber out from under a still-running
        // transcript — see `sideRosterSize` above.
        const targetSide: 'player' | 'enemy' = e.side === 'player' ? 'enemy' : 'player';
        const targetNote = !e.aoe && e.targetUnit !== undefined && sideRosterSize(targetSide) > 1
          ? ` · target ${sideUnitLabel(targetSide, e.targetUnit)}`
          : '';
        const playLine = push(e.turn, 'PLAY', `${label(e)} · ${skillName(e.skillId)}${progress}${aoeNote}${targetNote}${curseNote} · WEIGHT ${e.weight}${slowNote}`);
        // The matching `cost` event (readinessAfter = the bank left once this
        // weight is paid) hasn't been emitted yet — see the `pendingPlayLine`
        // comment above. Held here; filled in by the `cost` case below.
        pendingPlayLine = { side: e.side, unit: unitOf(e), line: playLine };
        const slots = playSlotByTurn.get(e.turn) ?? {};
        if (e.side === 'player') slots.player = e.slot;
        else {
          slots.enemyUnits = slots.enemyUnits ?? foes.map(() => undefined);
          slots.enemyUnits[unitOf(e)] = e.slot;
          if (unitOf(e) === 0) slots.enemy = e.slot;
        }
        playSlotByTurn.set(e.turn, slots);
        const key = `${e.side}:${e.side === 'enemy' ? unitOf(e) : 0}:${e.skillId}`;
        const card = cardSummaries.get(key) ?? {
          side: e.side,
          name: skillName(e.skillId),
          damage: 0,
          shield: 0,
          healing: 0,
          dots: 0,
        };
        cardSummaries.set(key, card);
        activeCardByTurn.set(e.turn, card);
        // The skill-usage animation trigger: queued for the next step this
        // very cast's own effects create (see `pendingCastFx` above) — a
        // scene reads `kind: 'cast'` to flash the caster's board slot and
        // float its card name per the archetype's motion profile.
        const castSkill = skillBook[e.skillId];
        if (castSkill) {
          pendingCastFx.push({ side: e.side, kind: 'cast', amount: 0, unit: unitOf(e), cardName: skillName(e.skillId), ...fxIdentity(castSkill) });
        }
        // Shadow-mirror of the engine's `c.lastCastArchetypes = choice.skill
        // .archetypes` (simulate.ts) — see `ComboArchetypeSnap`'s doc comment
        // for why the BASE definition's archetypes is byte-identical to the
        // engine's resolved value. Every `play` event is one real resolved
        // cast (a size-N card's busy turns emit `busy`/`wait`, never a second
        // `play`), so this fires exactly once per cast, same as the engine.
        const castArchetypes = castSkill?.archetypes ?? [];
        if (e.side === 'player') lastCastArchetypesPlayer = castArchetypes;
        else lastCastArchetypesEnemies[unitOf(e)] = castArchetypes;
        break;
      }
      // The readiness this very cast left banked, once its weight is paid —
      // read straight off the engine's own `readinessAfter` (never re-derived:
      // the burn-halving duplication between simulate.ts and this file is an
      // on-record defect this must not repeat). Appended onto the PLAY line
      // `pendingPlayLine` is still holding a reference to; the READY row above
      // already shows the GAIN, so this closes the loop by showing what
      // survived the SPEND. No step/summary bookkeeping of its own — `cost` is
      // bookkeeping on an already-logged line, not a new event a player reads.
      case 'cost': {
        if (pendingPlayLine && pendingPlayLine.side === e.side && pendingPlayLine.unit === unitOf(e)) {
          pendingPlayLine.line.text += ` · BANKED ${e.readinessAfter}`;
        }
        pendingPlayLine = undefined;
        break;
      }
      case 'damage': {
        const dealt = Math.max(0, e.amount - e.blocked);
        const u = unitOf(e);
        if (e.side === 'player') curPlayer = e.hpAfter; else curEnemies[u] = e.hpAfter;
        const drain = e.shieldDrain;
        if (e.blocked > 0) {
          // POINTS OUT, not damage eaten — see `shieldPointsDrained`. The bar
          // holds plating points; `e.blocked` is the DAMAGE they stopped, and
          // the two only agree when every pool that paid traded 1:1.
          setShield(e.side, u, Math.max(0, shieldOf(e.side, u) - shieldPointsDrained(e)));
          const pools = poolsOf(e.side, u);
          // `shieldDrain` is bucketed BY PROPERTY and already includes whatever
          // an attuned pool of that property paid, so it lines up exactly with
          // the per-property ledger — and with nothing else.
          if (pools && drain) {
            pools.physical = Math.max(0, pools.physical - drain.physical);
            pools.magical = Math.max(0, pools.magical - drain.magical);
            pools.true = Math.max(0, pools.true - drain.true);
          } else if (pools) {
            // Blocked, but the event never said out of WHICH pool (an older
            // cached log). The total above is still exact; the split is not,
            // so withhold it rather than decay an arbitrary pool.
            setPools(e.side, u, undefined);
          }
        }
        const hp = e.side === 'player' ? `${e.hpAfter}/${playerMax}` : `${e.hpAfter}/${enemyMaxes[u]}`;
        // A hit fully or partly absorbed by a typed shield must never read as
        // a bare "0 damage" with no explanation — always spell out how much
        // got BLOCKED and by which pool (physical/magical/true) alongside any
        // HP damage that got through. When the engine reports which pool(s)
        // actually drained (e.g. TRUE draining 2:1 for a typed hit), show the
        // drain magnitude too so the half-effectiveness is visible.
        const poolText = formatBlockedPools(e.property, drain);
        const dmgText = e.blocked > 0
          ? (dealt > 0 ? `${dealt} DMG · ${e.blocked} BLOCKED (${poolText})` : `BLOCKED ${e.blocked} (${poolText})`)
          : `−${dealt}`;
        if (e.source === 'skill') {
          push(e.turn, 'HIT', `${label(e)} ${dmgText} · ${hp}`, e.calculation ? formatDmg(e.calculation) : undefined);
        } else {
          // A DoT/attrition/fatigue tick is a DIFFERENT moment than a HIT (a
          // card striking you) or a DEBUFF (an effect just being APPLIED to
          // you) — its own 'EFFECT' tag says "an ongoing effect is dealing
          // damage right now" without colliding with either of those (2026-08
          // log-clarity pass; user chose a new tag over reusing HIT or DEBUFF
          // specifically so a poison tick can never be misread as a card hit).
          const cap = e.source.charAt(0).toUpperCase() + e.source.slice(1);
          push(e.turn, 'EFFECT', `${cap} · ${label(e)} ${dmgText} · ${hp}`);
        }
        const activeCard = activeCardByTurn.get(e.turn);
        if (e.source === 'skill' && activeCard) {
          activeCard.damage += dealt;
        }
        if (e.source === 'skill' && activeCard?.side === 'player' && e.side === 'enemy') {
          playerDamage += dealt;
        } else if (e.source === 'skill' && activeCard?.side === 'enemy' && e.side === 'player') {
          enemyDamage += dealt;
        }
        // DoT ticks (poison/burn/bleed) and thorns reflects are damage from a
        // STANDING effect, not this turn's active cast — `activeCard` names
        // whatever THIS TURN's PLAY is (often a totally different card, or
        // nobody at all), so crediting through it silently drops the damage
        // from both the side ledger and the per-card row. This was thorns'
        // exact defect until it was fixed by attributing via `sourceCard`
        // instead (`reflectThorns`, combat/interpreter.ts, temporarily swaps
        // `ctx.source` to the THORNS-GRANTING card before calling `dealDamage`
        // for the sting, so the resulting event's `sourceCard` already names
        // the holder's card, not whatever the attacker is casting) — and was
        // still live for the whole poison/burn/bleed family (a DoT-heavy real
        // fight under-reported its dealt damage by 42%, 2026-08-17). Credit
        // both the side total AND that card's own row — `CardSummaryRow.dots`
        // is the cumulative HP damage THIS card's DoT/thorns effect has
        // actually dealt (not a stack count; see the `statusApplied` case's
        // comment on why that used to be there and was removed).
        if ((e.source === 'poison' || e.source === 'burn' || e.source === 'bleed' || e.source === 'thorns') && e.sourceCard) {
          const owner = e.sourceCard;
          if (owner.side === 'player') playerDamage += dealt;
          else enemyDamage += dealt;
          const ownerKey = `${owner.side}:${owner.side === 'enemy' ? owner.unit : 0}:${owner.skillId}`;
          const ownerCard = cardSummaries.get(ownerKey);
          if (ownerCard) ownerCard.dots += dealt;
        }
        // Mirror the engine's own stack-decay rule (tickTurnDot / tickBleed,
        // combat/simulate.ts) onto the running pile total tracked below (the
        // same `dotsPlayer`/`dotsEnemies` map the ailment-badge keys use) — a
        // tick silently shrinks its pile with no event of its own beyond this
        // `damage` line, so without this the tracked total goes stale the
        // moment a pile ticks even once, corrupting the very next
        // re-application's delta (see the `statusApplied` case below).
        // Poison/bleed fall by exactly one stack per tick; burn HALVES
        // (floored) — both locked in simulate.ts. `cur === undefined` (no
        // pile tracked) can't happen for a living victim mid-tick — a tick
        // only ever fires on an already-applied pile — but is guarded anyway
        // so a hand-built/partial event fixture never throws.
        if (e.source === 'poison' || e.source === 'burn' || e.source === 'bleed') {
          const bucket = e.side === 'player' ? dotsPlayer : dotsEnemies[u]!;
          const cur = bucket.get(e.source);
          if (cur !== undefined) bucket.set(e.source, e.source === 'burn' ? Math.floor(cur / 2) : Math.max(0, cur - 1));
        }
        // THORNS' own decay mirror: a sting spends exactly one stack of the
        // HOLDER's pile (`reflectThorns`, interpreter.ts) with no holder-side
        // event beyond this attacker-side `damage` line — without this the
        // THR chip sat at the applied total until the pile's final
        // `statusExpired`. `sourceCard` names the holder (the thorns-granting
        // card's side/unit — the same attribution the DoT credit above relies
        // on). KNOWN CORNER, accepted: a sting the attacker NEGATES spends
        // the stack but emits no damage event at all, so the chip reads one
        // high until the pile's own expiry event lands; the engine's
        // `statusExpired` still zeroes it, and the builder never renders a
        // <= 0 value.
        if (e.source === 'thorns' && e.sourceCard) {
          const holderBucket = e.sourceCard.side === 'player' ? dotsPlayer : dotsEnemies[e.sourceCard.unit];
          const cur = holderBucket?.get('thorns');
          if (cur !== undefined) holderBucket!.set('thorns', Math.max(0, cur - 1));
        }
        pushFx(e.side, 'damage', dealt, u, e.source !== 'skill' ? e.source : undefined,
          e.source === 'skill' && e.sourceCard ? skillBook[e.sourceCard.skillId] : undefined);
        break;
      }
      case 'heal': {
        const u = unitOf(e);
        if (e.side === 'player') curPlayer = e.hpAfter; else curEnemies[u] = e.hpAfter;
        if (e.side === 'player') playerHealing += e.amount;
        const activeCard = activeCardByTurn.get(e.turn);
        if (activeCard) activeCard.healing += e.amount;
        const max = e.side === 'player' ? playerMax : enemyMaxes[u];
        // Anti-heal world rule: a tax the receiver's own afflictions applied to
        // this request — never invisible. Mirrors the blocked-damage idiom
        // above (always spell out the reduction, never a bare number).
        // The expandable `H:` strip carries the derivation (request − tax −
        // overheal = landed), same affordance as a HIT's `D:` math strip, so
        // the printed number is reconstructable rather than asserted.
        const antiHealTax = e.antiHeal ? ` (anti-heal −${e.antiHeal.pct}%: −${e.antiHeal.reduced})` : '';
        push(e.turn, 'BUFF', `${label(e)} +${e.amount} HP${antiHealTax} · ${e.hpAfter}/${max}`, formatHeal(e));
        pushFx(e.side, 'heal', e.amount, u, undefined, e.sourceCard ? skillBook[e.sourceCard.skillId] : undefined, e.antiHeal?.pct);
        break;
      }
      case 'shieldGain': {
        const u = unitOf(e);
        setShield(e.side, u, e.totalAfter);
        gainPoints(e.side, u, e.property, e.amount, e.totalAfter);
        const shieldCard = activeCardByTurn.get(e.turn);
        if (shieldCard) shieldCard.shield += e.amount;
        // The token names which pool this is (TRUE shields drain 2:1 vs typed
        // damage — otherwise indistinguishable from a typed shield's number).
        // A statBonus breakdown (present once the engine reports it) shows the
        // card's flat base + the scaling-stat contribution; TRUE shields are
        // flat by design (statBonus 0) and stay a plain number. That stat is the
        // DEFENSIVE one (Armor / Magic Resist, `scaleDefStat`) — this line used
        // to name ATK/MATK, which has been the wrong stat since shields started
        // scaling off defence (2026-08-04): right number, wrong label.
        const token = shieldToken(e.property);
        const calc = e.calculation;
        // `overheal: true` marks plating that was CONVERTED from a heal's wasted
        // remainder (`overhealShield`) rather than granted by a `shield` line. It
        // carries no `calculation` by contract, so it can never reach the breakdown
        // branch; naming the source is the whole point of the flag, since the same
        // "+N SHLD" row would otherwise look like a shield the card printed.
        const text = calc && calc.statBonus > 0
          ? `${label(e)} +${e.amount} ${token} (${calc.power} + ${calc.statBonus} ${defStatToken(e.property)})`
          : `${label(e)} +${e.amount} ${token}${e.overheal ? ' (from overheal)' : ''}`;
        push(e.turn, 'BUFF', text, formatShield(e));
        pushFx(e.side, 'shield', e.amount, u, undefined, e.sourceCard ? skillBook[e.sourceCard.skillId] : undefined);
        break;
      }
      case 'shieldBroken': {
        const u = unitOf(e);
        setShield(e.side, u, e.totalAfter);
        // A shatter/burst reports ONE total and never which pool paid it (the
        // engine strips in its own order — `shieldBreak`'s property-first walk,
        // `spendShieldsForBurst`'s P→M→T-then-attuned walk). Re-deriving that
        // order here would be a second copy of engine logic in the renderer, so
        // this attributes it only where the log makes it unambiguous and
        // otherwise WITHHOLDS the split — see `breakPoints`. Before this case
        // existed the strip was simply left stale, still summing to a wall that
        // had already been shattered.
        breakPoints(e.side, u, e.amount, e.totalAfter);
        push(e.turn, 'DEBUFF', `${label(e)} · shield −${e.amount}`);
        break;
      }
      // Magical Negate fully nullifying a hit: `dealDamage` (interpreter.ts)
      // returns BEFORE emitting any `damage` event, so without this the
      // attacker's own PLAY line was followed by nothing — a silent no-op that
      // read as a bug. Same shape as `slowed`/`disrupted` below: a defensive
      // event on the VICTIM's side, so it's a BUFF row (matching the `buff`
      // bucket `statusApplied` already puts guard/negate/buff in) naming the
      // property it stopped via the same `negateToken` the application row uses.
      case 'negated': {
        push(e.turn, 'BUFF', `${label(e)} · ${negateToken(e.property)} blocked the hit`);
        // One nullified hit = one charge spent (dealDamage's negate branch) —
        // the ONLY signal negate's count ever gets after application, since
        // the emptied status is dropped without a `statusExpired` (see
        // `negateChargesByUnit`'s doc). Keeps the NGT chip's number honest.
        const neg = negateChargesFor(e.side, unitOf(e));
        neg[e.property] = Math.max(0, neg[e.property] - 1);
        break;
      }
      // Ward spending a charge to prevent an incoming affliction: the affliction
      // mirror of `negated` above, same reason it exists — the interpreter
      // returns before ever emitting the `statusApplied` the affliction would
      // otherwise have produced, so the attacker's own PLAY line was followed
      // by nothing (byte-for-byte the same silent-no-op shape `negated` was
      // given a case for). Same row shape, same BUFF tag (a defensive event on
      // the WARD HOLDER's side), same level of detail: name what was denied
      // (`e.status`, the prevented affliction kind — never `'ward'` itself,
      // see the event's own doc comment) and how many charges remain.
      case 'warded': {
        const denied = e.status.charAt(0).toUpperCase() + e.status.slice(1);
        push(e.turn, 'BUFF', `${label(e)} · Ward prevented ${denied} · ${e.chargesLeft} charge${e.chargesLeft === 1 ? '' : 's'} left`);
        // `chargesLeft` is the holder TOTAL after this spend — authoritative,
        // so the WRD chip re-syncs to it rather than decrementing on its own.
        wardChargesByUnit.set(unitKey(e.side, unitOf(e)), e.chargesLeft);
        break;
      }
      // The VOLUNTEERED mirror of `warded`: the holder cashed its own charges in
      // for damage (`wardRelease`). Tagged EFFECT rather than BUFF — the row is
      // reporting a resource being SPENT on offense, not a defense coming up — and
      // the bonus damage itself arrives folded into the following `damage` row, the
      // same way a `shieldBurst`'s spent plating does.
      case 'wardReleased':
        push(e.turn, 'EFFECT', `${label(e)} · Released ${e.charges} ward charge${e.charges === 1 ? '' : 's'} into the hit · ${e.chargesLeft} left`);
        // Same authoritative re-sync as `warded` — the release names the
        // holder's remaining total itself.
        wardChargesByUnit.set(unitKey(e.side, unitOf(e)), e.chargesLeft);
        break;
      // `cleanse` (interpreter.ts) previously rendered NOTHING: the switch had
      // no case for it at all, so a Purify curing 3 poison stacks left the
      // transcript saying the card did nothing — the exact shape the `warded`/
      // `negated` cases above were added to fix, just never done for this one.
      case 'cleansed': {
        push(e.turn, 'BUFF', `${label(e)} · Cleansed ${e.removed} stack${e.removed === 1 ? '' : 's'}`);
        // THE HP-BAR AILMENT BADGE (`dotsPlayer`/`dotsEnemies`, read by both
        // battle scenes' `statusByTurn`) is fed ONLY by `statusApplied` and
        // cleared ONLY by `statusExpired` — but the engine's cleanse path
        // (interpreter.ts `case 'cleanse'`) strips statuses out of the
        // target's array directly and NEVER emits `statusExpired` for them.
        // Proven: Purify curing poison left the bar poison-green with a pip
        // for the rest of the fight.
        //
        // What this event actually tells us: the (side, unit) cleansed and a
        // single TOTAL stack count — never WHICH `isCleansable` kind(s)
        // absorbed those charges (interpreter.ts drains whichever of
        // poison/burn/bleed/stun/debuff/expose expires soonest, across ALL of
        // them at once, continuing into the next kind if charges remain).
        // That is not enough information to always clear the right badge —
        // guessing which of several active ailments a bare count came from
        // would trade one bug (a stale badge) for a worse one (a confidently
        // WRONG one). It IS enough when there is only ONE cleansable kind
        // active on the unit: then every charge in `removed` can only have
        // come from it, and the update is exact, not a guess — this is the
        // overwhelmingly common real case (a support cleanse reacting to the
        // one DoT/ailment currently on the target). `debuffCountByUnit`
        // (declared above, fed by statusApplied/statusExpired) extends that
        // check to `debuff`, the one cleansable kind with no badge of its own
        // to observe directly.
        //
        // ENGINE ASK, if/when this gap is worth closing for the multi-ailment
        // case too: have `cleansed` report a per-kind breakdown (e.g.
        // `removedByKind: Partial<Record<StatusName, number>>`), the same
        // shape `shieldGain`/`damage` already use (`poolsAfter`/`shieldDrain`)
        // instead of one merged number. Until then, a unit cleansed while
        // carrying two or more ailments at once keeps its stale badge(s) —
        // a known, deliberate gap, not an oversight.
        const bucket = e.side === 'player' ? dotsPlayer : dotsEnemies[unitOf(e)]!;
        const badgeKeys = ['poison', 'burn', 'bleed', 'stun', 'expose'] as const;
        const activeBadgeKeys = badgeKeys.filter((k) => bucket.has(k));
        const cleansedDebuffPiles = statModPilesFor(debuffPilesByUnit, e.side, unitOf(e));
        const otherCleansableActive = cleansedDebuffPiles.length > 0;
        if (activeBadgeKeys.length === 1 && !otherCleansableActive) {
          const key = activeBadgeKeys[0]!;
          if (key === 'poison' || key === 'burn' || key === 'bleed') {
            // A stacking DoT can be PARTIALLY cleansed (charges < stacks) — the
            // engine takes `min(stacks, chargesLeft)`, so subtract rather than
            // assume it hit zero. This also fixes the pile-delta corruption a
            // stale post-cleanse total caused: a fresh application right after
            // a full cleanse used to diff against the never-cleared old total
            // and print a nonsense delta (proven: the literal string
            // "Poison +-2 (3 total)").
            const remaining = Math.max(0, (bucket.get(key) ?? 0) - e.removed);
            if (remaining > 0) bucket.set(key, remaining);
            else bucket.delete(key);
          } else if (key === 'expose') {
            // Expose is no longer a single pile (see the antichain doc
            // comment on `exposePilesPlayer` above), so "sole badge active"
            // no longer means "sole PILE active" — two co-existing expose
            // piles both collapse to the one 'expose' badge key. `cleanse`
            // drains whichever `isCleansable` kind expires SOONEST
            // (interpreter.ts's documented order), so approximate the same
            // choice here: drop the `e.removed` soonest-expiring piles (by our
            // own `expiresAtTurn`) rather than assuming the whole ailment is
            // gone, then recompute the badge from whatever's left.
            const piles = exposePilesFor(e.side, unitOf(e));
            piles.sort((a, b) => a.expiresAtTurn - b.expiresAtTurn);
            piles.splice(0, Math.max(0, e.removed));
            const effective = effectiveExposePct(piles, e.turn);
            if (effective > 0) bucket.set('expose', effective);
            else bucket.delete('expose');
          } else {
            // stun is removed WHOLE by one charge, never partially
            // (interpreter.ts's cleanse loop only takes multiple stacks from
            // the STACKING-DoT branch) — sole active + `removed > 0` means
            // gone entirely.
            bucket.delete(key);
          }
        } else if (activeBadgeKeys.length === 0 && otherCleansableActive) {
          // The mirror case, and the one the badge-only branch above missed:
          // `debuff` is `isCleansable` (interpreter.ts) but carries no badge of
          // its own, so it is invisible to `activeBadgeKeys`. When NO badge
          // kind is active, `debuff` is the only cleansable kind left standing
          // on this unit (badgeKeys is exactly isCleansable minus 'debuff'),
          // so every one of this event's `removed` charges unambiguously came
          // from a debuff instance — each costs exactly one charge, same as
          // stun/expose above (interpreter.ts's non-stacking cleanse branch).
          // Without this, a cleansed-away debuff never left the shadow piles
          // (only `statusExpired` prunes them, and cleanse never emits it for
          // the statuses it strips) — the piles stuck non-empty forever, so
          // `otherCleansableActive` stayed true and permanently blocked every
          // later single-kind badge clear on this unit, reinstating the
          // stale-badge bug this file exists to fix. Which piles left:
          // cleanse drains WHICHEVER expires soonest (interpreter.ts's
          // documented order), so drop the `removed` soonest-expiring piles —
          // the same approximation the expose branch above already makes.
          cleansedDebuffPiles.sort((a, b) => a.expiresAtTurn - b.expiresAtTurn);
          cleansedDebuffPiles.splice(0, Math.max(0, e.removed));
        }
        break;
      }
      // `taunt` — self-targeted, fight-long threat gain. Silently redirects
      // targeting under the default `aggro` policy; without a row here, a
      // multi-foe fight's target suddenly switching reads as arbitrary.
      case 'aggroChanged': {
        push(e.turn, 'BUFF', `${label(e)} · Taunt → ${e.aggro} aggro`);
        break;
      }
      // `slow` rider — a debuff done TO the victim (their NEXT card gets this
      // much heavier), so it reads as a DEBUFF row exactly like poison/burn/
      // bleed/stat-debuff, not folded into the caster's own BUFF line. Also
      // seeds the shadow tracker above so the card it actually lands on can
      // name it (see the `play` case).
      case 'slowed': {
        const sk = slowKey(e.side, unitOf(e));
        pendingSlowByUnit.set(sk, Math.max(pendingSlowByUnit.get(sk) ?? 0, e.weight));
        push(e.turn, 'DEBUFF', `${label(e)} · Slow +${e.weight} weight`);
        break;
      }
      // `burden` rider — `slow` one scope down: it taxes a CARD (the one their
      // cursor is on, plus its neighbours when a `splash` spread it) rather than
      // the unit's next action, so the row names the slots that were hit and
      // the shadow tracker is per-slot. Without a row here a burdened card's
      // weight would silently inflate several turns later with nothing in the
      // log to explain it — the exact confusion the `slow` row above exists to
      // prevent.
      //
      // THE SPREAD IS READ OFF THE SLOT LIST, not off a separate event: one slot
      // means the bare burden, several mean a splash widened it (see the
      // `burdened` event's docs in engine/combat/events.ts). The row says
      // "Splash" only when it actually spread, so the player learns the spreader
      // from the case where it did something.
      case 'burdened': {
        for (let i = 0; i < e.slots.length; i += 1) {
          const slot = e.slots[i]!;
          const key = slotKey(e.side, unitOf(e), slot);
          pendingBurdenBySlot.set(key, Math.max(pendingBurdenBySlot.get(key) ?? 0, e.weight));
        }
        const where = e.slots.map((slot) => (slot === e.anchorSlot ? `[${slot + 1}]` : `${slot + 1}`)).join(' ');
        const spread = e.slots.length > 1 ? ' (Splash)' : '';
        push(e.turn, 'DEBUFF', `${label(e)} · Burden +${e.weight} weight on slot${e.slots.length === 1 ? '' : 's'} ${where}${spread}`);
        break;
      }
      // `curse` rider — burden's twin on the DAMAGE axis, so it reads the same
      // way: named slots, the anchor bracketed, "(Splash)" only when the band was
      // actually widened. The shadow tracker lets the PLAY row of a cursed card
      // say why its hit came out small.
      case 'cursed': {
        for (let i = 0; i < e.slots.length; i += 1) {
          const slot = e.slots[i]!;
          const key = slotKey(e.side, unitOf(e), slot);
          cursedBySlot.set(key, Math.max(cursedBySlot.get(key) ?? 0, e.amount));
        }
        const where = e.slots.map((slot) => (slot === e.anchorSlot ? `[${slot + 1}]` : `${slot + 1}`)).join(' ');
        const spread = e.slots.length > 1 ? ' (Splash)' : '';
        push(e.turn, 'DEBUFF', `${label(e)} · Curse −${e.amount} damage for ${e.turns} turn${e.turns === 1 ? '' : 's'} on slot${e.slots.length === 1 ? '' : 's'} ${where}${spread}`);
        break;
      }
      // A curse WINDOW CLOSED (engine's end-of-turn `expireCurses`). Mirrors the
      // engine's own delete so a later PLAY row stops claiming a penalty that no
      // longer applies — the card-scope counterpart of the `end` case's slow
      // clear below, and the reason `cursedBySlot` needs no timer of its own.
      case 'curseExpired': {
        for (let i = 0; i < e.slots.length; i += 1) {
          cursedBySlot.delete(slotKey(e.side, unitOf(e), e.slots[i]!));
        }
        const where = e.slots.map((slot) => String(slot + 1)).join(' ');
        push(e.turn, 'DEBUFF', `${label(e)} · Curse wears off on slot${e.slots.length === 1 ? '' : 's'} ${where}`);
        break;
      }
      // `disrupt` rider — the sibling of `slow`: drains banked readiness right
      // now instead of taxing the next card's weight, so (unlike slow) there is
      // nothing pending to attach to a later PLAY row — the effect is already
      // fully described the moment it fires.
      case 'disrupted': {
        push(e.turn, 'DEBUFF', `${label(e)} · Disrupt −${e.amount} readiness → ${e.readinessAfter}`);
        break;
      }
      // The `wait` event kind already existed for two reasons that read very
      // differently to a player — WEIGHT-gated (affordable next turn once more
      // readiness banks) vs COOLDOWN-gated (locked out for N more turns) — plus
      // the no-cards/stunned corner cases. None of the four were wired up: a
      // combatant sitting out a turn produced no row at all, which is exactly
      // what left "shouldn't the higher-readiness unit go first?" unanswerable
      // from the log alone.
      case 'wait': {
        if (e.reason === 'cantAfford') {
          const pending = pendingSlowByUnit.get(slowKey(e.side, unitOf(e)));
          const pendingBurden = e.slot === undefined ? undefined : pendingBurdenBySlot.get(slotKey(e.side, unitOf(e), e.slot));
          const slowNote = `${pending ? ` (includes +${pending} SLOWED)` : ''}${pendingBurden ? ` (includes +${pendingBurden} BURDENED)` : ''}`;
          push(e.turn, 'WAIT', `${label(e)} · ${skillName(e.skillId)} needs WEIGHT ${e.weight}${slowNote}, has ${e.readiness}`);
        } else if (e.reason === 'cooling') {
          push(e.turn, 'WAIT', `${label(e)} · ${skillName(e.skillId)} cooling down, ${e.turnsLeft} turn${e.turnsLeft === 1 ? '' : 's'} left`);
        } else if (e.reason === 'stunned') {
          push(e.turn, 'WAIT', `${label(e)} · stunned, skipping this turn`);
        } else {
          push(e.turn, 'WAIT', `${label(e)} · no card ready to play`);
        }
        break;
      }
      case 'statusApplied': {
        const buff = e.status === 'buff' || e.status === 'guard' || e.status === 'negate' || e.status === 'thorns' || e.status === 'ward';
        // Guard and negate each cover ONE property (their own, not the card's),
        // so both are named by a property-qualified token exactly like the
        // shield pools are — a bare "Guard"/"Negate" left the player no way to
        // know what it stops.
        const cap = e.status === 'guard'
          ? guardToken(e.property)
          : e.status === 'negate'
            ? negateToken(e.property)
            // User ruling (2026-08-20): the log used to read "Stun — skips its
            // next action" (or "...next N actions"); bare "Stunned" is enough.
            // No count is shown because none would ever be honest here:
            // `MAX_STUN_PER_CARD` caps every card's stun action at `turns: 1`
            // (enforced by `capViolations`, audited for all content in
            // `tests/data/contentSchema.test.ts`), so a plural phrasing would
            // be dead code. If that cap is ever lifted, revisit this line.
            : e.status === 'stun'
              ? 'Stunned'
              : e.status.charAt(0).toUpperCase() + e.status.slice(1);
        const bucket = e.side === 'player' ? dotsPlayer : dotsEnemies[unitOf(e)]!;
        // Stacking DoTs (poison/burn/bleed) MERGE onto ONE pile per victim —
        // a reapplication's `stacks` field is the pile's NEW TOTAL, never the
        // delta (see `applyDot`, combat/interpreter.ts: "pile.stacks =
        // (pile.stacks ?? 0) + stacks"). Showing only that total ("Poison 8")
        // hides whether this was a small top-up or a fresh heavy application
        // — the delta isn't on the event, so it's reconstructed here from the
        // running pile total this file already tracks (`dotsPlayer`/
        // `dotsEnemies`, kept in lockstep with every intervening tick by the
        // `damage` case above). No prior total tracked — a genuinely fresh
        // pile, or one that fully expired first — means this application's
        // whole amount IS the delta, so it stays the single-number reading
        // that already existed before this feature.
        let stacksText = '';
        if (e.status === 'poison' || e.status === 'burn' || e.status === 'bleed') {
          const total = e.stacks ?? 0;
          const prior = bucket.get(e.status);
          stacksText = prior !== undefined ? ` +${total - prior} (${total} total)` : total ? ` ${total}` : '';
        } else if (e.status === 'ward') {
          // Ward's magnitude lives in `charges`, not `stacks` (unlike negate,
          // which only surfaces its charge count in the expandable detail) —
          // a bare "Ward" made a 1-charge and a 3-charge application
          // indistinguishable at a glance, so this one gets it on the row itself.
          const charges = e.charges ?? 1;
          stacksText = ` ${charges} charge${charges === 1 ? '' : 's'}`;
        } else if (e.stacks) {
          stacksText = ` ${e.stacks}`;
        }
        // Defensive/support statuses (guard/buff/debuff/expose/negate) carry a
        // plain-language explanation as the row's expandable detail — tap/click
        // to expand, same affordance as a HIT's D: math strip, no hover.
        push(e.turn, buff ? 'BUFF' : 'DEBUFF', `${label(e)} · ${cap}${stacksText}`, explainStatus(e));
        // The per-card DOT column (`CardSummaryRow.dots`) is fed from actual
        // TICK/REFLECT damage in the `damage` case below, not from here — see
        // that case's comment. (Used to add a raw STACK count on application,
        // which read as a damage number beside `DMG n` and was not one.)
        if (e.status === 'poison' || e.status === 'burn' || e.status === 'bleed') bucket.set(e.status, e.stacks ?? 0);
        else if (e.status === 'stun') bucket.set('stun', e.turns);
        else if (e.status === 'expose') {
          // Record this application as its OWN pile (see the doc comment on
          // `exposePilesPlayer`/`exposePilesEnemies` above) rather than
          // overwriting the badge with this event's own pct — a weaker
          // reapplication landing on a stronger standing pile must not drop
          // the badge to the weaker number.
          const piles = exposePilesFor(e.side, unitOf(e));
          piles.push({ pct: e.pct ?? 0, expiresAtTurn: e.turn + e.turns });
          const effective = effectiveExposePct(piles, e.turn);
          if (effective > 0) bucket.set('expose', effective);
          else bucket.delete('expose');
        }
        else if (e.status === 'guard' && e.property) {
          // Record this application as its OWN pile, grouped by PROPERTY —
          // see the doc comment on `guardPilesPlayer`/`guardPilesEnemies`
          // above for why a same-property reapplication must compound rather
          // than overwrite the badge. `bucket.set('guard', 1)` is a bare
          // presence flag (the number is never read back — the real
          // magnitude lives in `guardBadgeCurrent`/`guardPctByTurn`) purely so
          // the HP-bar tint/pip picks up an active guard exactly like
          // thorns/ward do.
          const piles = guardPilesFor(e.side, unitOf(e));
          piles.push({ property: e.property, pct: e.pct ?? 0, expiresAtTurn: e.turn + e.turns });
          guardBadgeCurrent.set(guardBadgeKey(e.side, unitOf(e)), effectiveGuardByProperty(piles, e.turn));
          bucket.set('guard', 1);
        }
        // Thorns feeds the same per-unit ailment bucket the HP badge reads —
        // it has had an `AILMENT_TINT` entry since the thorns fix, but this
        // bucket never got fed, so the tint has been dead code (and thorns has
        // never shown on the HP badge) the whole time: no DoT tick, no
        // per-turn line of its own once a held pile just sits there between
        // stings. Magnitude is `stacks` (the pile total), same field the
        // dots-summary line above already reads for thorns.
        else if (e.status === 'thorns') bucket.set('thorns', e.stacks ?? 1);
        // Ward feeds the same bucket for the same reason — a held ward pile is
        // otherwise invisible for its whole lifetime, exactly like thorns
        // above. The chip's COUNT lives in `wardChargesByUnit` (holder total,
        // re-synced by every spend event) — this bucket value is one pile's
        // own charges and only its presence is read.
        else if (e.status === 'ward') {
          bucket.set('ward', e.charges ?? 1);
          const wk = unitKey(e.side, unitOf(e));
          wardChargesByUnit.set(wk, (wardChargesByUnit.get(wk) ?? 0) + (e.charges ?? 1));
        }
        // Negate feeds no bucket (no tint entry, and the engine never emits
        // `statusExpired` for it) — the chip reads the per-property charge
        // tracker, seeded here. `e.charges` is already the engine-clamped
        // grant (`MAX_NEGATE_CHARGES` per property, interpreter.ts).
        else if (e.status === 'negate' && e.property) {
          negateChargesFor(e.side, unitOf(e))[e.property] += e.charges ?? 1;
        }
        // Stat buff/debuff piles (see `buffPilesByUnit`/`debuffPilesByUnit`'s
        // doc above): recorded per application with the same absolute
        // `expiresAtTurn` arithmetic the expose/guard piles use, so natural
        // expiry can prune exactly the pile(s) that ended. A malformed event
        // with no `stat` is skipped rather than guessed at.
        else if ((e.status === 'buff' || e.status === 'debuff') && e.stat) {
          const piles = statModPilesFor(e.status === 'buff' ? buffPilesByUnit : debuffPilesByUnit, e.side, unitOf(e));
          piles.push({ stat: e.stat, pct: e.pct ?? 0, amount: e.amount ?? 0, expiresAtTurn: e.turn + e.turns });
        }
        break;
      }
      case 'statusExpired': {
        const bucket = e.side === 'player' ? dotsPlayer : dotsEnemies[unitOf(e)]!;
        if (e.status === 'expose') {
          // Do NOT blindly clear the badge — this event only says ONE pile
          // (the engine's own antichain member expiring, whether by natural
          // duration or by being domination-replaced at application time; see
          // the doc comment on `exposePilesPlayer` above) is gone; another,
          // separately-applied pile can still be standing. Recompute the
          // effective (strongest-remaining) pct instead of deleting the key.
          const piles = exposePilesFor(e.side, unitOf(e));
          const effective = effectiveExposePct(piles, e.turn, true);
          if (effective > 0) bucket.set('expose', effective);
          else bucket.delete('expose');
        } else if (e.status === 'guard') {
          // Same reasoning as expose above, adapted for guard's per-PROPERTY
          // piles: recompute every property's own effective pct from its own
          // piles at this turn rather than guess which one ended. A property
          // whose only pile just expired drops out; a property still
          // carrying a standing pile (of ITS OWN, unaffected by another
          // property's pile ending) keeps its own compounded number untouched.
          //
          // The recompute is ALL that is needed because every guard expiry is
          // NATURAL: the engine has no early-eviction path (guard stacking is
          // uncapped by design, user-locked 2026-08-20), so `expiresAtTurn`
          // filtering alone always drops exactly the pile(s) that ended and the
          // event needs to name nothing. A 2026-08-19 pile cap DID evict piles
          // early and forced a splice-by-name here; both are gone.
          const piles = guardPilesFor(e.side, unitOf(e));
          const entries = effectiveGuardByProperty(piles, e.turn, true);
          guardBadgeCurrent.set(guardBadgeKey(e.side, unitOf(e)), entries);
          if (entries.length > 0) bucket.set('guard', 1);
          else bucket.delete('guard');
        } else if (e.status === 'ward') {
          // ONE ward pile emptied — the holder may still carry another pile's
          // charges (a recast opens a NEW pile, interpreter.ts). Every spend
          // already re-synced `wardChargesByUnit` to the event's own
          // `chargesLeft`, so drop the tint/presence key only when the holder
          // TOTAL is spent — deleting on the first pile's expiry blanked the
          // badge while a second pile still stood.
          if ((wardChargesByUnit.get(unitKey(e.side, unitOf(e))) ?? 0) <= 0) bucket.delete('ward');
        } else {
          bucket.delete(e.status);
        }
        if (e.status === 'buff' || e.status === 'debuff') {
          // Natural expiry (the only kind this event ever reports — see its
          // doc): prune exactly the pile(s) whose window ends AT this turn,
          // strict `>` for the same reason `effectiveExposePct`'s strict mode
          // exists — `e.turn` IS the expiring pile's own `expiresAtTurn`.
          const map = e.status === 'buff' ? buffPilesByUnit : debuffPilesByUnit;
          const k = unitKey(e.side, unitOf(e));
          const piles = map.get(k);
          if (piles) map.set(k, piles.filter((p) => p.expiresAtTurn > e.turn));
        }
        // A row is worth printing only for the statuses that are otherwise
        // INVISIBLE while wearing off: guard/buff/debuff/expose silently
        // modify every hit/turn they cover, with no per-turn tick line of
        // their own, so their end is the only moment they'd ever say
        // anything again. Left OUT on purpose:
        // - poison/burn/bleed: the pile's own last tick already showed it
        //   hit its final stack (EFFECT row), and the ailment badge on the
        //   HP bar clears the same turn — a "wore off" row would repeat
        //   what the transcript already said.
        // - stun: the unit's very next PLAY row already proves it ended;
        //   there is no silent lingering effect to announce.
        // - negate: the engine never actually emits `statusExpired` for it
        //   (spent charges just drop the status — see interpreter.ts) so
        //   this case is unreachable for it regardless.
        // No `property`/`stat` on this event (unlike `statusApplied`), so
        // the row stays generic on purpose rather than reconstructing one —
        // a terse "it's gone" is the whole point of this row.
        // - thorns: IN on purpose — unlike the DoTs there is no ailment badge
        //   clearing on the HP bar, and the final sting row prints the damage
        //   without saying the pile emptied, so the wear-off would otherwise
        //   be invisible.
        // - ward: IN on purpose, same reasoning as thorns — the pile's last
        //   spend is a `warded` row (see above) that names the denial but
        //   never says the pile itself is now empty, and there is no DoT-style
        //   tick or HP-bar clear of its own to imply it. Without this row the
        //   pile's end is invisible exactly like thorns' would be.
        if (e.status === 'buff' || e.status === 'debuff' || e.status === 'guard' || e.status === 'expose' || e.status === 'thorns' || e.status === 'ward') {
          const buff = e.status === 'buff' || e.status === 'guard' || e.status === 'thorns' || e.status === 'ward';
          const cap = e.status.charAt(0).toUpperCase() + e.status.slice(1);
          push(e.turn, buff ? 'BUFF' : 'DEBUFF', `${label(e)} · ${cap} wore off`);
        }
        break;
      }
      // A size-N card busies its caster N−1 further turns; each one gets a
      // WAIT line ("Meteor · 2/3") so span turns don't vanish from the log,
      // and the gold board cursor tracks the occupied slot being worked off.
      case 'busy': {
        push(e.turn, 'WAIT', `${label(e)} · ${skillName(e.skillId)} · ${e.slotIndex}/${e.slotCount}`);
        const slots = playSlotByTurn.get(e.turn) ?? {};
        if (e.side === 'player') slots.player = e.slot;
        else {
          slots.enemyUnits = slots.enemyUnits ?? foes.map(() => undefined);
          slots.enemyUnits[unitOf(e)] = e.slot;
          if (unitOf(e) === 0) slots.enemy = e.slot;
        }
        playSlotByTurn.set(e.turn, slots);
        break;
      }
      // The stalemate breakers (sudden death / fatigue / attrition) were
      // entirely absent from the log — a long fight started taking damage
      // "from nowhere" with zero announcement, indistinguishable from a bug.
      // Each is a ONE-SHOT boundary in the FIGHT ITSELF (every future turn now
      // behaves differently), not an action any card/unit took, so it must
      // read like one of the log's two existing BOOKENDS (START/RESULT) —
      // not like another combat row. New 'PHASE' tag reuses the exact
      // START/RESULT gold so the player's eye already knows "this color means
      // fight-structure milestone" the first time they see it.
      // Kept terse on purpose (an announcement, not an explanation — the
      // mechanic's rules live in the docs/tooltips, not the transcript) and
      // NEVER invents a number the triggering event doesn't carry:
      // `attritionStart` reports its own `amount` (the very number every
      // following `EFFECT · Attrition · …` row will deal, so the banner and
      // the ticks it's attributing stay linked), but `suddenDeathStart` /
      // `fatigueStart` carry no number at all (the ramp %, and the fatigue
      // base amount, are combat constants — not per-event data) so those two
      // name only the phase, nothing more.
      case 'suddenDeathStart': push(e.turn, 'PHASE', 'SUDDEN DEATH · damage ramps every turn'); break;
      case 'fatigueStart': push(e.turn, 'PHASE', 'FATIGUE · flat damage begins every turn'); break;
      case 'attritionStart': push(e.turn, 'PHASE', `ATTRITION · ${e.amount} to everyone, rising`); break;
      case 'died': push(e.turn, 'DOWN', `${label(e)} falls`); break;
      // Mirrors the engine's own end-of-turn clear (simulate.ts:
      // `for (const c of units) c.nextWeightPenalty = 0` runs right before
      // this very `end` event is pushed) — exit #2 of the two exits described
      // on `pendingSlowByUnit` above. A `slow` tax that landed this turn but
      // whose victim never acted must NOT still be shown as owed on the
      // victim's next turn; the engine drops it unpaid at the turn boundary
      // regardless of whether the whole side's units all cost-cleared it via
      // a play this turn. No row of its own — this is bookkeeping over an
      // already-silent engine event, not something a player reads.
      // Deliberately does NOT touch `pendingBurdenBySlot`: a burden is per PIECE
      // and rides until that piece is actually played, unchanged by this engine
      // update — see the `pendingBurdenBySlot` declaration above. Nor
      // `cursedBySlot`: a curse's window is closed by the engine's own
      // `curseExpired` event (handled above), which is emitted from the same
      // end-of-turn pass but names exactly which slots lapsed — so mirroring it
      // here would guess where the engine states.
      case 'end': pendingSlowByUnit.clear(); break;
      case 'combatEnd': {
        // combatEnd is the log's final event, so HP here is final state — a
        // same-step MUTUAL wipe (both sides at 0) is decided by the engine's
        // tempo tiebreak (decideOutcome) and must SAY so, or the survivor-less
        // "VICTORY" reads like a bug (live playtest report 2026-08-04).
        const hp = snapHp();
        const bothFell = hp.player <= 0 && (hp.enemies ?? [hp.enemy]).every((v) => v <= 0);
        push(e.turn, 'RESULT', `${outcome} · ${e.turns} turns${bothFell ? ' · BOTH FELL — tempo tiebreak' : ''}`);
        break;
      }
      default: break;
    }
    // This event's own contribution (damage/heal/shield/dot increments above)
    // lands AFTER any `push()` call inside its case — so the step(s) this
    // event just created were stamped with the STALE (pre-event) snapshot at
    // push() time. Recompute now and backfill every step this event added,
    // so "as of this step" always includes the event that produced the line.
    lastSummarySnapshot = snapshotSummary();
    for (let i = stepCountBeforeEvent; i < stepRecords.length; i++) {
      stepRecords[i]!.summary = lastSummarySnapshot;
    }
    hpByTurn.set(e.turn, snapHp());
    shieldByTurn.set(e.turn, snapShield());
    summaryByTurn.set(e.turn, lastSummarySnapshot);
    statusByTurn.set(e.turn, {
      player: [...dotsPlayer.keys()],
      enemy: [...dotsEnemies[0]!.keys()],
      enemyUnits: dotsEnemies.map((m) => [...m.keys()]),
    });
    // The chip row's own per-turn snapshot — same end-of-turn granularity as
    // `statusByTurn` above (last event of the turn wins), so a scrub to turn T
    // shows exactly the piles standing when T ended.
    chipsByTurn.set(e.turn, {
      player: buildChips('player', 0),
      enemy: buildChips('enemy', 0),
      enemyUnits: foes.map((_, u) => buildChips('enemy', u)),
    });
    slotModsByTurn.set(e.turn, snapSlotMods());
    // `dotsPlayer`/`dotsEnemies`' 'expose' VALUE is now always the effective
    // (strongest-standing) pct — see the `statusApplied`/`statusExpired`/
    // `cleansed` handling above — so reading it straight through here gives
    // the badge the correct number for free.
    exposePctByTurn.set(e.turn, {
      player: dotsPlayer.get('expose') ?? 0,
      enemy: dotsEnemies[0]!.get('expose') ?? 0,
      enemyUnits: dotsEnemies.map((m) => m.get('expose') ?? 0),
    });
    // Guard's badge, unlike expose's, can't be read straight off the presence
    // flag `dotsPlayer.get('guard')` set above (it's per-PROPERTY, not one
    // number) — read the array the `statusApplied`/`statusExpired` handlers
    // already computed into `guardBadgeCurrent`, at whichever strictness was
    // correct for the event that produced it (see that map's own doc comment
    // for why re-deriving generically here at one fixed strictness is wrong).
    guardPctByTurn.set(e.turn, {
      player: guardBadgeCurrent.get(guardBadgeKey('player', 0)) ?? [],
      enemy: guardBadgeCurrent.get(guardBadgeKey('enemy', 0)) ?? [],
      enemyUnits: guardPilesEnemies.map((_, u) => guardBadgeCurrent.get(guardBadgeKey('enemy', u)) ?? []),
    });
    speedByTurn.set(e.turn, { ...speed, enemyUnits: [...speed.enemyUnits!] });
    comboArchetypesByTurn.set(e.turn, {
      player: [...lastCastArchetypesPlayer],
      enemy: [...(lastCastArchetypesEnemies[0] ?? [])],
      enemyUnits: lastCastArchetypesEnemies.map((a) => [...a]),
    });
  }
  // Defensive: every real log's last event is `combatEnd` (never `gain`), so
  // the in-loop flush above always fires before the loop ends. Flush any
  // leftover batch anyway in case a truncated/synthetic log ends mid-batch.
  if (pendingGainTurn !== null) {
    const readyStepStart = stepRecords.length;
    flushGainRow();
    for (let i = readyStepStart; i < stepRecords.length; i++) stepRecords[i]!.summary = lastSummarySnapshot;
  }
  // The final tally uses the SAME snapshot function as every per-step
  // snapshot — the non-regression guarantee (last `summaryByStep` entry ===
  // `combatSummary`) falls out of that by construction, not a special case.
  const combatSummary: CombatSummary = snapshotSummary();
  let turns = [...linesByTurn.keys()].sort((a, b) => a - b);
  if (turns.length === 0) turns = [1];

  // Fold stepRecords (already in chronological/event order) into the final
  // per-step arrays, walking turns in order and inserting a fallback step
  // (the turn's last known line) for any turn that had no important lines.
  let steps: PlaybackStep[] = [];
  let hpByStep: HpSnap[] = [];
  let shieldByStep: ShieldSnap[] = [];
  let fxByStep: TurnFx[][] = [];
  let focusFoeByStep: Array<number | undefined> = [];
  let summaryByStep: CombatSummary[] = [];
  const recordsByTurn = new Map<number, StepRecord[]>();
  for (const r of stepRecords) {
    const arr = recordsByTurn.get(r.turn) ?? [];
    arr.push(r);
    recordsByTurn.set(r.turn, arr);
  }
  // The last summary carried forward for a fallback step (a turn with no
  // important lines, e.g. only a `gain`) — the most recent per-turn snapshot
  // walking turns in order, so a fallback step never regresses to zero.
  let lastFallbackSummary: CombatSummary = { playerDamage: 0, enemyDamage: 0, playerHealing: 0, cards: [] };
  for (const t of turns) {
    const recs = recordsByTurn.get(t);
    if (recs && recs.length > 0) {
      for (const r of recs) {
        steps.push({ turn: r.turn, lineIndex: r.lineIndex });
        hpByStep.push(r.hp);
        shieldByStep.push(r.shield);
        fxByStep.push(r.fx);
        focusFoeByStep.push(r.focus);
        summaryByStep.push(r.summary);
      }
      lastFallbackSummary = recs[recs.length - 1]!.summary;
    } else {
      const lines = linesByTurn.get(t) ?? [];
      steps.push({ turn: t, lineIndex: Math.max(0, lines.length - 1) });
      hpByStep.push(hpByTurn.get(t) ?? snapHp());
      shieldByStep.push(shieldByTurn.get(t) ?? snapShield());
      fxByStep.push([]);
      focusFoeByStep.push(undefined);
      lastFallbackSummary = summaryByTurn.get(t) ?? lastFallbackSummary;
      summaryByStep.push(lastFallbackSummary);
    }
  }
  if (steps.length === 0) {
    steps = [{ turn: turns[0] ?? 1, lineIndex: 0 }];
    hpByStep = [snapHp()];
    shieldByStep = [snapShield()];
    fxByStep = [[]];
    focusFoeByStep = [undefined];
    summaryByStep = [{ playerDamage: 0, enemyDamage: 0, playerHealing: 0, cards: [] }];
  }
  // A lethal damage event is the meaningful end of playback. Do not force
  // the player through separate DOWN/RESULT ticks after HP has already hit 0.
  // Multi-foe: the fight only ends when the player OR every enemy is down.
  // Same-step MUTUAL wipe (both sides ended at 0): playback still STOPS right
  // here — the victor is already determined (tempo tiebreak) — but the final
  // frame must tell the truth: both HP bars read 0 (backfilled from final
  // state below) and the banner says BOTH FELL. Without that, the other
  // side's bar froze at a stale value and "VICTORY" read like a bug
  // (playtest report 2026-08-04; user chose stop-at-decision over playing
  // the tail out).
  const finalHp = snapHp();
  const mutualWipe = finalHp.player <= 0 && (finalHp.enemies ?? [finalHp.enemy]).every((v) => v <= 0);
  const lethalStep = hpByStep.findIndex((snapshot) =>
    snapshot.player <= 0 || (snapshot.enemies ?? [snapshot.enemy]).every((v) => v <= 0));
  if (lethalStep >= 0) {
    steps = steps.slice(0, lethalStep + 1);
    hpByStep = hpByStep.slice(0, lethalStep + 1);
    shieldByStep = shieldByStep.slice(0, lethalStep + 1);
    fxByStep = fxByStep.slice(0, lethalStep + 1);
    focusFoeByStep = focusFoeByStep.slice(0, lethalStep + 1);
    summaryByStep = summaryByStep.slice(0, lethalStep + 1);
    if (mutualWipe) {
      hpByStep[hpByStep.length - 1] = finalHp;
      shieldByStep[shieldByStep.length - 1] = snapShield();
    }
  }
  const resultStep = steps.findIndex((step) => {
    const line = linesByTurn.get(step.turn)?.[step.lineIndex];
    return line?.tag === 'RESULT';
  });
  // Draws or unusual empty logs have no DOWN event; preserve their normal
  // end-of-playback result banner.
  const outcomeStep = lethalStep >= 0 ? lethalStep : resultStep >= 0 ? resultStep : steps.length - 1;
  // Playback truncation (the lethal-step slice above, or a log whose trailing
  // events genuinely don't touch the ledger — e.g. a post-death `died`/
  // `combatEnd` with no further damage/heal/shield) means the LAST surviving
  // step's own snapshot is expected to already equal the full-log
  // `combatSummary` in every real case. Pin it explicitly anyway: it costs
  // nothing and guarantees the non-regression invariant holds even for an
  // edge case (e.g. a future DoT tick that lands after the lethal HP snap)
  // where a trailing event could otherwise add to the total after playback
  // has stopped animating.
  if (summaryByStep.length > 0) summaryByStep[summaryByStep.length - 1] = combatSummary;

  return {
    linesByTurn,
    hpByTurn,
    shieldByTurn,
    statusByTurn,
    chipsByTurn,
    slotModsByTurn,
    exposePctByTurn,
    guardPctByTurn,
    speedByTurn,
    comboArchetypesByTurn,
    playSlotByTurn,
    turns,
    steps,
    hpByStep,
    shieldByStep,
    fxByStep,
    focusFoeByStep,
    outcome,
    mutualWipe,
    outcomeStep,
    combatSummary,
    summaryByStep,
    heroName,
    foeName,
    heroStats,
    foeStats,
    heroPieces,
    heroSkills,
    foePieces,
    foeSkills,
    foes,
    heroStatLine: statLineOf(hero.stats),
  };
}
