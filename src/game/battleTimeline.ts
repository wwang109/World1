import { applyTier } from '../engine/cards';
import { skillBook } from '../data/skills';
import type { CombatEvent } from '../engine/combat/events';
import type { ShieldPools } from '../engine/combat/state';
import type { Archetype, Element, Property, SkillDef, WeaponType } from '../engine/types';
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
export interface BattlePiece { skill: SkillDef; slot: number; }

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

export interface BattleTimeline {
  linesByTurn: Map<number, LogLine[]>;
  hpByTurn: Map<number, HpSnap>;
  shieldByTurn: Map<number, ShieldSnap>;
  /** Active ailment keys per side per turn — drives the HP-bar ailment tint. */
  statusByTurn: Map<number, { player: string[]; enemy: string[] }>;
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

function propertyWord(p: Property | undefined): string {
  return p === 'magical' ? 'magical' : p === 'physical' ? 'physical' : p === 'true' ? 'true' : 'all';
}

/**
 * Plain-language explanation for a defensive/support status — surfaced as the
 * timeline row's expandable `detail` (tap/click to expand; no hover anywhere
 * for statuses — the mechanic itself, unlike the HIT `D:` math strip, doesn't
 * need a second hover affordance). DoT statuses (poison/burn/bleed/stun)
 * already print their stacks/duration in the main log line (the `stacksText`
 * building above this function's call site — stun's own turn count included,
 * 2026-08-17 fix: it used to be the one of the four left out, so a stun's
 * main line read as a bare "Stun" with no way to tell a 1-turn lockdown from
 * a 5-turn one), so they return `undefined` here and stay a single-line entry.
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
  add('SKILL', c.effectBonusDamage);
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
  const buildUp = c ? c.statBonus + c.healFlat : 0;
  if (buildUp <= 0 && reduced <= 0 && e.overheal <= 0) return undefined;
  // `amount + overheal + antiHeal.reduced` is the pre-tax request (the identity
  // documented on the event); with a `calculation` we can open with its parts.
  const request = e.amount + e.overheal + reduced;
  const terms = [c && !e.flat ? `base ${c.power}` : `${e.flat ? 'flat' : 'heal'} ${request}`];
  if (c && c.statBonus > 0) terms.push(`+ (${c.statBonus} ${defStatToken(c.property)})`);
  if (c && c.healFlat > 0) terms.push(`+ (${c.healFlat} SKILL)`);
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
    : [{ enemyId: input.enemyId, level: input.enemyLevel, title: input.enemyTitle, rank: input.enemyRank, modifiers: [...(input.enemyModifiers ?? [])] }];
  const encs = teamConfigs.map((cfg) => buildEnemyEncounter(cfg.enemyId, cfg.level, cfg.title, cfg.rank, cfg.modifiers));
  const foeSetups = encs.map((e) => e.setup);
  const heroName = hero.name;
  const heroStats: ScalingStats = { attack: hero.stats.attack, magicPower: hero.stats.magicPower, armor: hero.stats.armor, magicResist: hero.stats.magicResist };

  const heroPieces: BattlePiece[] = [];
  const heroSkills: SkillDef[] = [];
  for (const p of input.pieces) {
    const s = skillBook[p.skillId]; if (!s) continue;
    heroPieces.push({ skill: s, slot: p.slot }); heroSkills.push(s);
  }
  const statLineOf = (s: { attack: number; magicPower: number; armor: number; magicResist: number; speed: number }): string =>
    `${STAT_TOKEN.attack} ${s.attack} · ${STAT_TOKEN.magicPower} ${s.magicPower} · ${STAT_TOKEN.armor} ${s.armor} · ${STAT_TOKEN.magicResist} ${s.magicResist} · ${STAT_TOKEN.speed} ${s.speed}`;
  const foes: FoeModel[] = foeSetups.map((setup) => {
    const pieces: BattlePiece[] = [];
    const skills: SkillDef[] = [];
    for (const p of setup.pieces) {
      const base = skillBook[p.skillId]; if (!base) continue;
      const s = p.tier ? applyTier(base, p.tier) : base;
      pieces.push({ skill: s, slot: p.slot }); skills.push(s);
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
  const speedByTurn = new Map<number, SpeedSnap>();
  const playSlotByTurn = new Map<number, { player?: number; enemy?: number; enemyUnits?: Array<number | undefined> }>();

  // Per-unit live state — enemy-side values are ARRAYS indexed by event `unit`.
  const playerMax = hero.stats.maxHp;
  let curPlayer = playerMax;
  const enemyMaxes = foes.map((f) => f.maxHp);
  const curEnemies = [...enemyMaxes];
  let shieldPlayer = 0;
  const shieldEnemies = foes.map(() => 0);
  // Per-pool breakdown — stays undefined per side until a shieldGain event
  // actually reports `poolsAfter` (optional, land-order-agnostic); once set,
  // this is what lets the UI show "20 P · 30 M" instead of one merged "50".
  let shieldPoolsPlayer: ShieldPools | undefined;
  const shieldPoolsEnemies: Array<ShieldPools | undefined> = foes.map(() => undefined);
  const speed: SpeedSnap = { player: '', enemy: '', enemyUnits: foes.map(() => '') };
  const dotsPlayer = new Map<string, number>();
  const dotsEnemies = foes.map(() => new Map<string, number>());
  // Shadow-count of ACTIVE stat-debuff instances per (side, unit) — fed by
  // statusApplied/statusExpired for `status: 'debuff'` exactly like every
  // other reconstruction in this section. `debuff` never touches an HP-bar
  // badge (no `AILMENT_TINT` entry for it — MobileBattleScene.ts /
  // DesktopBattleScene.ts), so nothing here renders it directly; it exists
  // solely to disambiguate a `cleansed` event below. A `cleanse` action
  // (interpreter.ts) drains whichever `isCleansable` kind expires soonest
  // across poison/burn/bleed/stun/debuff/expose on the target — so a poison
  // badge can only be safely cleared/reduced from a bare `removed` COUNT when
  // NO OTHER cleansable kind, including an invisible debuff, is also active
  // to have absorbed some of those charges.
  const debuffCountByUnit = new Map<string, number>();
  const debuffKey = (side: 'player' | 'enemy', unit: number): string => `${side}:${unit}`;
  // Shadow-tracks the engine's own `nextWeightPenalty` (combat/state.ts) so a
  // `slow` rider's pending bonus weight can be named on the WAIT/PLAY row of
  // the very card it will hit, not just the DEBUFF row announcing it landed.
  // Mirrors the engine's own rule exactly (Math.max per re-application,
  // cleared the instant that side/unit next plays ANY card — see
  // `castSelect.ts`/`simulate.ts` `c.nextWeightPenalty = 0`) — reconstructed
  // bookkeeping over already-emitted events, same idiom as the `dotsPlayer`/
  // `dotsEnemies` pile-delta tracking above, not a combat decision.
  const pendingSlowByUnit = new Map<string, number>();
  const slowKey = (side: 'player' | 'enemy', unit: number): string => `${side}:${unit}`;
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
        // rider that caused it, then clear the shadow tracker: the engine
        // resets `nextWeightPenalty` to 0 the instant this side/unit performs
        // ANY cast, regardless of which piece.
        const sk = slowKey(e.side, unitOf(e));
        const slowedBy = pendingSlowByUnit.get(sk);
        pendingSlowByUnit.delete(sk);
        const slowNote = slowedBy ? ` (includes +${slowedBy} SLOWED)` : '';
        const playLine = push(e.turn, 'PLAY', `${label(e)} · ${skillName(e.skillId)}${progress} · WEIGHT ${e.weight}${slowNote}`);
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
          if (e.side === 'player') {
            shieldPlayer = Math.max(0, shieldPlayer - e.blocked);
            if (shieldPoolsPlayer && drain) {
              shieldPoolsPlayer.physical = Math.max(0, shieldPoolsPlayer.physical - drain.physical);
              shieldPoolsPlayer.magical = Math.max(0, shieldPoolsPlayer.magical - drain.magical);
              shieldPoolsPlayer.true = Math.max(0, shieldPoolsPlayer.true - drain.true);
            }
          } else {
            shieldEnemies[u] = Math.max(0, (shieldEnemies[u] ?? 0) - e.blocked);
            const pools = shieldPoolsEnemies[u];
            if (pools && drain) {
              pools.physical = Math.max(0, pools.physical - drain.physical);
              pools.magical = Math.max(0, pools.magical - drain.magical);
              pools.true = Math.max(0, pools.true - drain.true);
            }
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
        if (e.side === 'player') shieldPlayer = e.totalAfter; else shieldEnemies[u] = e.totalAfter;
        if (e.poolsAfter) {
          if (e.side === 'player') shieldPoolsPlayer = { ...e.poolsAfter };
          else shieldPoolsEnemies[u] = { ...e.poolsAfter };
        }
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
        const text = calc && calc.statBonus > 0
          ? `${label(e)} +${e.amount} ${token} (${calc.power} + ${calc.statBonus} ${defStatToken(e.property)})`
          : `${label(e)} +${e.amount} ${token}`;
        push(e.turn, 'BUFF', text, formatShield(e));
        pushFx(e.side, 'shield', e.amount, u, undefined, e.sourceCard ? skillBook[e.sourceCard.skillId] : undefined);
        break;
      }
      case 'shieldBroken': {
        const u = unitOf(e);
        if (e.side === 'player') shieldPlayer = e.totalAfter; else shieldEnemies[u] = e.totalAfter;
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
        break;
      }
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
        const dk = debuffKey(e.side, unitOf(e));
        const otherCleansableActive = (debuffCountByUnit.get(dk) ?? 0) > 0;
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
          } else {
            // stun/expose are removed WHOLE by one charge, never partially
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
          // Without this, a cleansed-away debuff never decremented
          // `debuffCountByUnit` (only `statusExpired` did, and cleanse never
          // emits it for the statuses it strips) — the shadow count stuck
          // above zero forever, so `otherCleansableActive` stayed true and
          // permanently blocked every later single-kind badge clear on this
          // unit, reinstating the stale-badge bug this file exists to fix.
          const cur = debuffCountByUnit.get(dk) ?? 0;
          debuffCountByUnit.set(dk, Math.max(0, cur - e.removed));
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
          const slowNote = pending ? ` (includes +${pending} SLOWED)` : '';
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
        } else if (e.status === 'stun') {
          // Stun's magnitude lives in `turns`, not `stacks` (it never sets
          // `stacks` at all) — a bare "Stun" made a 1-turn stun and a 5-turn
          // stun read identically, the one gap `explainStatus`'s doc comment
          // (just above `push`, below) wrongly claimed didn't exist.
          const turns = e.turns;
          stacksText = ` ${turns} turn${turns === 1 ? '' : 's'}`;
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
        else if (e.status === 'expose') bucket.set('expose', e.pct ?? 0);
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
        // above.
        else if (e.status === 'ward') bucket.set('ward', e.charges ?? 1);
        // Debuff feeds no badge (see `debuffCountByUnit`'s own doc above) — it
        // is tracked purely to know whether a later `cleansed` event on this
        // unit has more than one candidate kind to have drained.
        else if (e.status === 'debuff') {
          const dk = debuffKey(e.side, unitOf(e));
          debuffCountByUnit.set(dk, (debuffCountByUnit.get(dk) ?? 0) + 1);
        }
        break;
      }
      case 'statusExpired': {
        const bucket = e.side === 'player' ? dotsPlayer : dotsEnemies[unitOf(e)]!;
        bucket.delete(e.status);
        if (e.status === 'debuff') {
          const dk = debuffKey(e.side, unitOf(e));
          const cur = debuffCountByUnit.get(dk) ?? 0;
          if (cur > 0) debuffCountByUnit.set(dk, cur - 1);
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
    speedByTurn.set(e.turn, { ...speed, enemyUnits: [...speed.enemyUnits!] });
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
    speedByTurn,
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
