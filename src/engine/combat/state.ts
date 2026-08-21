import type { Archetype, BuffableStat, CombatConfig, CombatantSetup, CombatantStats, EffectSourceRef, Element, Property, Side, SkillBook, SkillDef, TargetPolicy, WeaponType } from '../types';
import type { AuraMods } from './auras';
import { applyHeroGems, gemCardMods, gemHeroStats, resolveEffectiveSkill } from '../cards';
import { powerLevelDeci } from '../balance';
import { boardTypeIdentity, type BoardIdentity } from './typeIdentity';

export interface StatusInstance {
  kind: 'poison' | 'burn' | 'bleed' | 'stun' | 'buff' | 'debuff' | 'guard' | 'negate' | 'expose' | 'thorns' | 'ward';
  /** DoT mitigation/synergy typing (inherited from the card); guard/negate match property. */
  property?: Property;
  stat?: BuffableStat;
  pct?: number;
  amount?: number;
  /**
   * DECAYING DoT (poison/burn/bleed): current stack count. Each tick deals
   * damage equal to `stacks`, then removes one stack; expires at 0. One pile
   * per kind per victim — new applications merge in. Cleanse removes one
   * stack per charge.
   */
  stacks?: number;
  /**
   * Remaining counter-charges; NOT turn-decremented. Two users, both
   * charge-based and both permanent until spent:
   *  - `negate`: charges that cancel a whole DIRECT HIT of a matching property;
   *  - `ward`:   charges that cancel a whole AFFLICTION APPLICATION (any kind
   *              `isCleansable` accepts — one charge per application, whatever
   *              its stack count).
   */
  charges?: number;
  /**
   * Remaining GLOBAL turns (stun: remaining performances; negate/ward: unused/0).
   * For decaying DoTs this mirrors `stacks` (kept in sync) so duration sorts
   * and displays keep working.
   */
  turnsLeft: number;
  /** Newly applied this turn: skip the first end-of-turn decrement. */
  fresh?: boolean;
  /** The card that applied this status (poison/burn) — for per-card DoT attribution. */
  source?: EffectSourceRef;
}

/**
 * WHICH STATUS KINDS ARE TURN-DURATIONED — the single, exhaustive answer, kept
 * here beside `StatusInstance` rather than as an inline `!==` chain at the one
 * call site (`expireStatuses` in simulate.ts).
 *
 * WHY IT IS A NAMED SET: every kind in the union must expire by EXACTLY ONE
 * mechanism, and the four mechanisms live in four different files. Spelling the
 * turn-durationed ones out as a list makes the partition reviewable — and makes
 * a gap testable — instead of relying on a reader noticing which kinds a negated
 * condition happens to exclude. `expose` fell through exactly that crack: it was
 * the only kind the union documents as lasting "for `turns` global turns" that
 * the `!==` chain did not name, so its `turnsLeft` was never decremented and it
 * lasted the whole fight (priced `pct × turns`, delivered `pct × ∞`).
 *
 * THE FULL PARTITION (every `StatusInstance['kind']`, exactly once):
 *  - GLOBAL-TURN DURATION  — this list: `buff`, `debuff`, `guard`, `expose`.
 *    `turnsLeft` decrements once per global turn in `expireStatuses`; the pile is
 *    dropped (with `statusExpired`) at 0.
 *  - STACK-DECAYED         — `poison`, `burn` (`tickTurnDot`), `bleed`
 *    (`tickBleed`), `thorns` (`reflectThorns`): each tick/reflect removes stacks
 *    and the pile expires at 0 stacks. `turnsLeft` merely mirrors `stacks`.
 *  - PERFORMANCE-COUNTED   — `stun`: decremented when a performance is consumed
 *    (the perform loop in simulate.ts), never by a global turn.
 *  - CHARGE-SPENT          — `negate` (`dealDamage`), `ward` (`consumeWard`):
 *    permanent until their charges are spent.
 *
 * Adding a kind to the union means placing it in exactly one of those four
 * groups; `tests/engine/statusExpiry.test.ts` fails if a kind is in none.
 */
export const TURN_DURATIONED_STATUS_KINDS: readonly StatusInstance['kind'][] = [
  'buff',
  'debuff',
  'guard',
  'expose',
];

/** Does this kind's `turnsLeft` count GLOBAL TURNS (see the list above)? */
export function isTurnDurationed(kind: StatusInstance['kind']): boolean {
  // Indexed scan over a frozen-order array — never a Set — so iteration order
  // (and therefore determinism) is fixed by the source literal.
  for (let i = 0; i < TURN_DURATIONED_STATUS_KINDS.length; i += 1) {
    if (TURN_DURATIONED_STATUS_KINDS[i] === kind) return true;
  }
  return false;
}

/** Typed shield pools. A pool only blocks its own property; true blocks all. */
export interface ShieldPools {
  physical: number;
  magical: number;
  true: number;
}

/** A card placed on the board with cached size for adjacency/span math. */
export interface PieceState {
  skillId: string;
  /** Leftmost occupied slot. */
  slot: number;
  size: number;
  /** Effective skill after gem resolution (effect-gem actions appended). */
  skill: SkillDef;
  /** Card-scope stat-gem modifiers, folded into this card's aura bundle. */
  gemMods: Partial<AuraMods>;
  /**
   * Global turn this piece last PERFORMED a cast (undefined = never cast, so
   * always available). Drives the reuse cooldown: `selectCast` skips this piece
   * while `currentTurn - lastCastTurn <= effectiveCooldown(skill)`. Integer,
   * so persisted state stays float-free and deterministic.
   */
  lastCastTurn?: number;
  /**
   * CARD-SCOPE weight tax pending on THIS piece (from an enemy `splash`): the
   * next time this piece is played it costs this much extra weight, and the
   * penalty is then consumed (`simulate.ts`, beside `c.nextWeightPenalty = 0`).
   * The unit-scope sibling is `CombatantState.nextWeightPenalty`; both are
   * summed into the cast weight in `castSelect.ts` and both are `Math.max`ed
   * rather than summed on re-application.
   *
   * LIFETIME DIVERGENCE, deliberate and pending a ruling: splash is still
   * "until that piece is next played", with NO turn limit — it is the one
   * remaining tax that can cross a turn boundary. `slow` was narrowed to a
   * single turn on 2026-08-18; whether splash should follow has not been
   * decided (it is a one-line change here plus a re-price, since a tax that can
   * expire unpaid is worth strictly less than one that is always eventually
   * paid). See `CombatantState.nextWeightPenalty`.
   *
   * LAZILY WRITTEN, NEVER INITIALISED — the same idiom as `lastCastTurn` above,
   * and for a hard reason: `undefined` is dropped by `JSON.stringify` but `0` is
   * not, so eager-initialising this to 0 would re-bake all 400 hashes in
   * `tests/engine/fixtures/outcomeBaseline.json` for zero behaviour change. Read
   * it as `piece.nextWeightPenalty ?? 0`; clear it with `delete` (NOT `= 0`, and
   * NOT `= undefined` — that leaves the key present for `Object.keys` /
   * `toStrictEqual` / structured-clone even though `JSON.stringify` hides it).
   * Integer, so persisted state stays float-free and deterministic.
   */
  nextWeightPenalty?: number;
}

export interface CombatantState {
  side: Side;
  /** 0-based position within its own side (always 0 at 1v1). */
  index: number;
  name: string;
  stats: CombatantStats;
  shields: ShieldPools;
  boardSize: number;
  /** Sorted by slot ascending; rotation order = this order. */
  pieces: PieceState[];
  /** Board slot the rotation scan starts from (wraps). */
  castCursor: number;
  /** Initiative carried between gameplay turns and spent to play cards. */
  readiness: number;
  /** Number of performances taken (casts + stun-consumed performances). */
  performs: number;
  /** Accumulated sudden-death damage amp (%). */
  sdStacks: number;
  /**
   * UNIT-SCOPE weight tax pending on this combatant (from an enemy `slow`).
   *
   * LIFETIME — THE TURN IT LANDED ON, AND NO LONGER (user-locked 2026-08-18).
   * Cleared by whichever comes first: this unit's next resolved cast, which
   * PAYS it (`simulate.ts`, after the `cost` event), or the end of the current
   * global turn, which drops it UNPAID (`simulate.ts`, beside the
   * `expireStatuses` pass). A victim that never gets to act still loses it, so
   * the value can never carry across a turn boundary and successive slows
   * cannot accumulate into a lockout.
   *
   * Eagerly initialised to 0 (unlike the lazily-written `PieceState` sibling
   * below): it is a required field that every combatant has always carried, so
   * a 0 here is already in the outcome-baseline hashes.
   */
  nextWeightPenalty: number;
  /** Archetypes of the last card this side cast (for Combo riders). */
  lastCastArchetypes: Archetype[];
  elementAffinity?: Element;
  weaponAffinity?: WeaponType;
  /**
   * The board's derived type identity (a unique type with the highest count,
   * count >= 3), computed once at setup. `undefined` when the board has none.
   * Drives the +20% same-type damage bonus (folded via AuraMods) and the
   * defensive-affinity fill below. Purely a function of the placed cards.
   */
  boardIdentity?: BoardIdentity;
  /** Single-target offensive targeting rule among living foes. Default `aggro`. */
  targetPolicy: TargetPolicy;
  /** Opposing lineup index this unit focuses (overrides policy when living). */
  focus?: number;
  /** Threat level; the default `aggro` policy targets the highest-aggro foe. */
  aggro: number;
  statuses: StatusInstance[];
  /**
   * Global turn on which this unit last took a BLEED tick (undefined = never).
   * Bleed is capped at ONE tick per global turn (user-locked 2026-07-31): the
   * turn loop can resolve several casts for the same unit, and only the FIRST
   * resolved cast of a turn draws blood. Integer, mirroring `PieceState.lastCastTurn`,
   * so persisted state stays float-free and deterministic.
   */
  lastBleedTurn?: number;
  alive: boolean;
}

export interface CombatState {
  /** Gameplay-turn counter; each turn can resolve zero, one, or many plays. */
  turn: number;
  /**
   * Team-shaped source of truth. WAVE 1 keeps exactly one unit per side, so
   * each team is a 1-element array. The engine loop iterates the flattened,
   * canonically-ordered pool `[...playerTeam, ...enemyTeam]`.
   */
  playerTeam: CombatantState[];
  enemyTeam: CombatantState[];
  /**
   * FROZEN external accessors: `player === playerTeam[0]`, `enemy ===
   * enemyTeam[0]` (same object references). Kept so `finalState.player` /
   * `finalState.enemy` stay object-shaped for existing consumers (tests, UI,
   * scripts) — the external API is unchanged this wave.
   */
  player: CombatantState;
  enemy: CombatantState;
}

function initCombatant(side: Side, index: number, setup: CombatantSetup, skillBook: SkillBook): CombatantState {
  const occupied = new Array<boolean>(setup.boardSize).fill(false);
  const pieces: PieceState[] = [];
  for (const piece of setup.pieces) {
    const def = skillBook[piece.skillId];
    if (!def) throw new Error(`Unknown skill on board: ${piece.skillId}`);
    const skill = resolveEffectiveSkill(def, piece);
    if (piece.slot < 0 || piece.slot + skill.size > setup.boardSize) {
      throw new Error(`Skill ${piece.skillId} at slot ${piece.slot} exceeds board of ${setup.boardSize}`);
    }
    for (let s = piece.slot; s < piece.slot + skill.size; s++) {
      if (occupied[s]) throw new Error(`Board overlap at slot ${s} (${piece.skillId})`);
      occupied[s] = true;
    }
    pieces.push({ skillId: piece.skillId, slot: piece.slot, size: skill.size, skill, gemMods: gemCardMods(piece.gem) });
  }
  pieces.sort((a, b) => a.slot - b.slot);
  // Board Type Identity, computed once from the placed cards (element/weapon is
  // unaffected by tier/gem resolution, so the effective skills are fine to use).
  const boardIdentity = boardTypeIdentity(pieces.map((p) => p.skill));
  // Effect 1 — defensive attunement: an identity fills the matching affinity
  // ONLY where no affinity was authored. Authored (enemy) affinities always win;
  // heroes have none, so this is their first source of affinity.
  let elementAffinity = setup.elementAffinity;
  let weaponAffinity = setup.weaponAffinity;
  if (boardIdentity?.kind === 'element' && elementAffinity === undefined) {
    elementAffinity = boardIdentity.type;
  } else if (boardIdentity?.kind === 'weapon' && weaponAffinity === undefined) {
    weaponAffinity = boardIdentity.type;
  }
  return {
    side,
    index,
    name: setup.name,
    stats: applyHeroGems({ ...setup.stats }, gemHeroStats(setup.pieces)),
    shields: { physical: 0, magical: 0, true: 0 },
    boardSize: setup.boardSize,
    pieces,
    castCursor: 0,
    readiness: 0,
    performs: 0,
    sdStacks: 0,
    nextWeightPenalty: 0,
    lastCastArchetypes: [],
    elementAffinity,
    weaponAffinity,
    boardIdentity,
    targetPolicy: setup.targetPolicy ?? 'aggro',
    focus: setup.focus,
    aggro: setup.baseAggro ?? 0,
    statuses: [],
    alive: setup.stats.hp > 0,
  };
}

/**
 * Board Power Level of a unit: the sum of its pieces' effective-skill PL
 * (deci-PL, integer). Used by the `highestThreat` targeting policy. Purely a
 * function of the placed cards, so it's constant across the fight and
 * deterministic.
 */
export function boardPowerLevel(c: CombatantState): number {
  let total = 0;
  for (const piece of c.pieces) total += powerLevelDeci(piece.skill);
  return total;
}

/**
 * Resolve the two side rosters from a config. Teams XOR legacy: exactly one of
 * (`playerTeam`/`enemyTeam`) or (`player`/`enemy`) must be supplied. Legacy
 * single setups wrap to 1-element teams. Throws with a clear message otherwise.
 */
export function rostersFromConfig(cfg: CombatConfig): { playerSetups: CombatantSetup[]; enemySetups: CombatantSetup[] } {
  const hasTeams = cfg.playerTeam !== undefined || cfg.enemyTeam !== undefined;
  const hasLegacy = cfg.player !== undefined || cfg.enemy !== undefined;
  if (hasTeams && hasLegacy) {
    throw new Error('CombatConfig: provide teams (playerTeam/enemyTeam) XOR legacy (player/enemy), not both.');
  }
  if (!hasTeams && !hasLegacy) {
    throw new Error('CombatConfig: no combatants — supply playerTeam/enemyTeam (or legacy player/enemy).');
  }
  if (hasTeams) {
    const playerSetups = cfg.playerTeam ?? [];
    const enemySetups = cfg.enemyTeam ?? [];
    if (playerSetups.length === 0) throw new Error('CombatConfig: playerTeam must have at least one unit.');
    if (enemySetups.length === 0) throw new Error('CombatConfig: enemyTeam must have at least one unit.');
    return { playerSetups, enemySetups };
  }
  if (!cfg.player || !cfg.enemy) {
    throw new Error('CombatConfig: legacy config requires both player and enemy setups.');
  }
  return { playerSetups: [cfg.player], enemySetups: [cfg.enemy] };
}

export function initCombatState(cfg: CombatConfig): CombatState {
  // Teams are the source of truth; legacy single setups wrap to 1-element
  // teams. Each unit gets a 0-based per-side index. `player` / `enemy` alias
  // index 0 on each side for the frozen external 1v1 API.
  const { playerSetups, enemySetups } = rostersFromConfig(cfg);
  const playerTeam = playerSetups.map((setup, i) => initCombatant('player', i, setup, cfg.skillBook));
  const enemyTeam = enemySetups.map((setup, i) => initCombatant('enemy', i, setup, cfg.skillBook));
  return {
    turn: 0,
    playerTeam,
    enemyTeam,
    player: playerTeam[0]!,
    enemy: enemyTeam[0]!,
  };
}

/** All units on `side`, canonical (index-ascending) order. */
export function teamOf(state: CombatState, side: Side): CombatantState[] {
  return side === 'player' ? state.playerTeam : state.enemyTeam;
}

/**
 * Is EITHER side completely wiped (every unit not alive)?
 *
 * FIRST TO FALL LOSES (user-locked 2026-08-04): the fight ends at the exact
 * application that wipes a side, so this is the "combat is already over" test
 * that lethal-application sites consult before running the NEXT application —
 * `applyCast`'s effect loop uses it to stop a killing cast dead (no lifesteal-back,
 * no self-shield after the last foe falls). Read-only, integer-free, no RNG; the
 * one place that also decides WHO won is `decideOutcome` in simulate.ts.
 */
export function anySideWiped(state: CombatState): boolean {
  return state.playerTeam.every((u) => !u.alive) || state.enemyTeam.every((u) => !u.alive);
}

/** The opposing team of `c`, canonical order. */
export function foesOf(state: CombatState, c: CombatantState): CombatantState[] {
  return c.side === 'player' ? state.enemyTeam : state.playerTeam;
}

/**
 * WAVE 1 targeting: the single opposing unit. Identical to the old 1v1
 * `opponentOf`; kept as a distinct name so team-combat waves can widen it.
 */
export function opponentOf(state: CombatState, c: CombatantState): CombatantState {
  return foesOf(state, c)[0]!;
}

/** Effective stat after buff/debuff percentages (and flat amounts). Never below 0. */
export function effStat(c: CombatantState, stat: BuffableStat): number {
  let pct = 100;
  let flat = 0;
  for (const s of c.statuses) {
    if (s.stat !== stat) continue;
    if (s.kind === 'buff') {
      pct += s.pct ?? 0;
      flat += s.amount ?? 0;
    } else if (s.kind === 'debuff') {
      pct -= s.pct ?? 0;
      flat -= s.amount ?? 0;
    }
  }
  return Math.max(0, Math.floor((c.stats[stat] * pct) / 100) + flat);
}

export function totalShield(c: CombatantState): number {
  return c.shields.physical + c.shields.magical + c.shields.true;
}

export function hasStatus(c: CombatantState, kind: StatusInstance['kind']): boolean {
  return c.statuses.some((s) => s.kind === kind);
}

/**
 * Total CURRENT stacks of one status kind on a unit — the quantity a
 * `stackBonus` rider scales off (`applyAction`, combat/interpreter.ts).
 *
 * SUMMED ACROSS PILES even though every stacking kind (poison/burn/bleed via
 * `applyDot`, thorns via its own arm) keeps exactly ONE pile per holder and
 * merges into it: the sum is correct for one pile and stays correct if a future
 * kind ever opens a second, where a `find`-the-first would silently under-read.
 * Kinds that carry no `stacks` return 0.
 *
 * Indexed walk, integer-only, no RNG — safe to call mid-cast.
 */
export function statusStackCount(c: CombatantState, kind: StatusInstance['kind']): number {
  let stacks = 0;
  for (let i = 0; i < c.statuses.length; i += 1) {
    const s = c.statuses[i]!;
    if (s.kind === kind) stacks += s.stacks ?? 0;
  }
  return stacks;
}
