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
  damage: number;
  shield: number;
  healing: number;
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
   * (HIT/DEBUFF/BUFF/DOWN/RESULT), plus one fallback entry for any turn that
   * had none. Playback steps event-by-event, not turn-by-turn. */
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
 * already print their stacks/duration in the main log line, so they return
 * `undefined` here and stay a single-line entry.
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

/** The HIT `D:` math detail (locked grammar): base n + (n LABEL) … = total. */
export function formatDmg(c: NonNullable<Extract<CombatEvent, { kind: 'damage' }>['calculation']>): string {
  const stat = c.scalingStat === 'attack' ? STAT_TOKEN.attack : STAT_TOKEN.magicPower;
  const def = c.scalingStat === 'attack' ? STAT_TOKEN.armor : STAT_TOKEN.magicResist;
  const terms = [`base ${c.power}`];
  const add = (label: string, v: number): void => { if (v) terms.push(`${v > 0 ? '+' : '−'} (${Math.abs(v)} ${label})`); };
  add(stat, c.baseStat);
  add('BUFF', c.statBonusDamage);
  add('SKILL', c.effectBonusDamage);
  add(def, -c.defense);
  add('AFFINITY', c.matchupBonusDamage);
  add('RAMP', c.suddenDeathBonusDamage);
  add('GUARD', -c.guardReduction);
  add('BLOCK', -c.shieldBlocked);
  return `D: ${terms.join(' ')} = ${c.hpDamage}`;
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
  const heroStats: ScalingStats = { attack: hero.stats.attack, magicPower: hero.stats.magicPower };

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
      stats: { attack: setup.stats.attack, magicPower: setup.stats.magicPower },
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
  const push = (turn: number, tag: string, text: string, detail?: string): void => {
    const arr = linesByTurn.get(turn) ?? [];
    arr.push({ tag, text, detail });
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
  };
  /** Identity fields threaded onto a fx from its source skill — undefined when
   * there's no skill to attribute (e.g. a DoT tick), in which case callers
   * keep their existing ailment-color fallback keyed off `source` instead. */
  const fxIdentity = (skill: SkillDef | undefined): Pick<TurnFx, 'archetype' | 'property' | 'element' | 'weapon'> =>
    skill ? { archetype: skill.archetypes[0], property: skill.property, element: skill.element, weapon: skill.weapon } : {};
  const pushFx = (side: 'player' | 'enemy', kind: 'damage' | 'heal' | 'shield', amount: number, unit: number, source?: string, skill?: SkillDef): void => {
    if (amount <= 0) return;
    const last = stepRecords[stepRecords.length - 1];
    if (last) last.fx.push({ side, kind, amount, source, unit, ...fxIdentity(skill) });
  };

  // Step 0 — the pre-battle baseline. Without it, playback would open on the
  // first HIT with its damage already applied to the HP snapshot; this line
  // shows both sides at full HP before any event resolves.
  const foesLabel = foes.map((f, i) => `${f.name} ${curEnemies[i]}/${enemyMaxes[i]}`).join(' + ');
  push(battle.events[0]?.turn ?? 1, 'START', `${heroName} ${curPlayer}/${playerMax} vs ${foesLabel}`);

  for (const e of battle.events) {
    const sided = e as { side?: 'player' | 'enemy'; unit?: number };
    if (e.kind === 'play') curActor = { side: e.side, unit: unitOf(e) };
    if (sided.side === 'enemy') curFocus = sided.unit ?? 0;
    else if (sided.side === 'player') curFocus = curActor?.side === 'enemy' ? curActor.unit : undefined;
    const stepCountBeforeEvent = stepRecords.length;
    switch (e.kind) {
      // Readiness gain — mockup turnline: "Hero 18 · SPD +16 · Bandit 25 · SPD +15".
      case 'gain': {
        const line = `${e.readinessAfter} · SPD +${e.speed}`;
        if (e.side === 'player') speed.player = line;
        else { speed.enemyUnits![unitOf(e)] = line; if (unitOf(e) === 0) speed.enemy = line; }
        break;
      }
      case 'play': {
        // Multi-slot cards carry their span progress: the cast turn is 1/N,
        // the busy turns below continue 2/N … N/N.
        const progress = e.slotCount > 1 ? ` · ${e.slotIndex}/${e.slotCount}` : '';
        push(e.turn, 'PLAY', `${label(e)} · ${skillName(e.skillId)}${progress}`);
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
          const cap = e.source.charAt(0).toUpperCase() + e.source.slice(1);
          push(e.turn, 'DEBUFF', `${cap} · ${label(e)} ${dmgText} · ${hp}`);
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
        push(e.turn, 'BUFF', `${label(e)} +${e.amount} HP · ${e.hpAfter}/${max}`);
        pushFx(e.side, 'heal', e.amount, u, undefined, e.sourceCard ? skillBook[e.sourceCard.skillId] : undefined);
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
        // flat by design (statBonus 0) and stay a plain number.
        const token = shieldToken(e.property);
        const calc = e.calculation;
        const text = calc && calc.statBonus > 0
          ? `${label(e)} +${e.amount} ${token} (${calc.power} + ${calc.statBonus} ${e.property === 'magical' ? STAT_TOKEN.magicPower : STAT_TOKEN.attack})`
          : `${label(e)} +${e.amount} ${token}`;
        push(e.turn, 'BUFF', text);
        pushFx(e.side, 'shield', e.amount, u, undefined, e.sourceCard ? skillBook[e.sourceCard.skillId] : undefined);
        break;
      }
      case 'shieldBroken': {
        const u = unitOf(e);
        if (e.side === 'player') shieldPlayer = e.totalAfter; else shieldEnemies[u] = e.totalAfter;
        push(e.turn, 'DEBUFF', `${label(e)} · shield −${e.amount}`);
        break;
      }
      case 'statusApplied': {
        const buff = e.status === 'buff' || e.status === 'guard' || e.status === 'negate';
        const cap = e.status.charAt(0).toUpperCase() + e.status.slice(1);
        // Defensive/support statuses (guard/buff/debuff/expose/negate) carry a
        // plain-language explanation as the row's expandable detail — tap/click
        // to expand, same affordance as a HIT's D: math strip, no hover.
        push(e.turn, buff ? 'BUFF' : 'DEBUFF', `${label(e)} · ${cap}${e.stacks ? ` ${e.stacks}` : ''}`, explainStatus(e));
        if (e.status === 'poison' || e.status === 'burn' || e.status === 'bleed') {
          const dotCard = activeCardByTurn.get(e.turn);
          if (dotCard) dotCard.dots += e.stacks ?? 1;
        }
        const bucket = e.side === 'player' ? dotsPlayer : dotsEnemies[unitOf(e)]!;
        if (e.status === 'poison' || e.status === 'burn' || e.status === 'bleed') bucket.set(e.status, e.stacks ?? 0);
        else if (e.status === 'stun') bucket.set('stun', e.turns);
        else if (e.status === 'expose') bucket.set('expose', e.pct ?? 0);
        break;
      }
      case 'statusExpired': {
        const bucket = e.side === 'player' ? dotsPlayer : dotsEnemies[unitOf(e)]!;
        bucket.delete(e.status);
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
      case 'died': push(e.turn, 'DOWN', `${label(e)} falls`); break;
      case 'combatEnd': push(e.turn, 'RESULT', `${outcome} · ${e.turns} turns`); break;
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
  const lethalStep = hpByStep.findIndex((snapshot) =>
    snapshot.player <= 0 || (snapshot.enemies ?? [snapshot.enemy]).every((v) => v <= 0));
  if (lethalStep >= 0) {
    steps = steps.slice(0, lethalStep + 1);
    hpByStep = hpByStep.slice(0, lethalStep + 1);
    shieldByStep = shieldByStep.slice(0, lethalStep + 1);
    fxByStep = fxByStep.slice(0, lethalStep + 1);
    focusFoeByStep = focusFoeByStep.slice(0, lethalStep + 1);
    summaryByStep = summaryByStep.slice(0, lethalStep + 1);
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
