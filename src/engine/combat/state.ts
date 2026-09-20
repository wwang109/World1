import type { Archetype, BuffableStat, CombatConfig, CombatantSetup, CombatantStats, EffectSourceRef, Element, Property, Side, SkillBook, SkillDef, StackedStatus, TargetPolicy, WeaponType } from '../types';
import type { AuraMods } from './auras';
import { applyHeroGems, gemCardMods, gemHeroStats, resolveEffectiveSkill } from '../cards';
import { powerLevelDeci } from '../balance';
import { boardAffinities, boardEffectAffinities, primaryIdentity, type BoardIdentity } from './typeIdentity';

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
   * CARD-SCOPE weight tax pending on THIS piece (from an enemy `burden`): the
   * next time this piece is played it costs this much extra weight, and the
   * penalty is then consumed (`simulate.ts`, beside `c.nextWeightPenalty = 0`).
   * The unit-scope sibling is `CombatantState.nextWeightPenalty`; both are
   * summed into the cast weight in `castSelect.ts` and both are `Math.max`ed
   * rather than summed on re-application.
   *
   * LIFETIME DIVERGENCE, deliberate: a burden is "until that piece is next
   * played", with NO turn limit — it is the one tax that can cross a turn
   * boundary. `slow` was narrowed to a single turn on 2026-08-18; the card-scope
   * tax deliberately did not follow, and its price says so
   * (`PRICE.burdenPerWeightNum`: slow's full per-point rate, because a burden
   * that lands later but can never expire unpaid is called a wash against a slow
   * that lands now but often expires unpaid). See
   * `CombatantState.nextWeightPenalty`.
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
  /**
   * CARD-SCOPE damage penalty pending on THIS piece (from an enemy `curse`):
   * while it stands, this piece's casts deal `amount` LESS damage.
   *
   * THE SIBLING OF `nextWeightPenalty` ABOVE, one currency over: burden taxes
   * WHEN the card comes out, curse taxes HOW HARD it lands. Both are per-piece,
   * both are written by the same two keywords' shared geometry
   * (`cardTargetPieces`, combat/splash.ts), and both are `Math.max`ed rather
   * than summed on re-application.
   *
   * IT IS APPLIED, NOT STORED, AS DAMAGE: `resolveAuras` (combat/auras.ts) folds
   * `-amount` into the piece's `mods.damageFlat`, the same attacker-side flat
   * channel board auras and card-scope stat gems ride, so the min-1 damage floor
   * and every mitigation rule downstream apply unchanged and no arithmetic is
   * duplicated.
   *
   * TIMED IN GLOBAL TURNS, as an ABSOLUTE `expiresAtTurn` rather than a
   * countdown: `expiresAtTurn = turn + turns` at apply time, and the piece is
   * cleared in the end-of-turn pass of that turn (`expireCurses`, simulate.ts).
   * Absolute because a countdown would need every board's every piece walked
   * every turn just to decrement; this way the pass only has to compare.
   * A re-curse takes `Math.max` on BOTH fields independently — the stronger
   * amount AND the later expiry, the `expose` refresh rule.
   *
   * LAZILY WRITTEN AND `delete`d ON EXPIRY, for exactly the reason spelled out
   * on `nextWeightPenalty` above: an un-cursed piece must carry no key at all,
   * or every hash in the outcome baseline moves for zero behaviour change. Both
   * fields are integers, so persisted state stays float-free.
   */
  curse?: { amount: number; expiresAtTurn: number };
}

export interface CombatantState {
  side: Side;
  /** 0-based position within its own side (always 0 at 1v1). */
  index: number;
  name: string;
  stats: CombatantStats;
  shields: ShieldPools;
  /**
   * ATTUNED plating: pools tuned to one weapon/element that absorb DOUBLE from
   * matching damage (see the `attunedShield` docs in types.ts). A separate list
   * rather than more fields on `ShieldPools` for two reasons: a unit may hold
   * several attuned pools of different types at once, and — critically — a fight
   * with no attuned shield never touches this field, so every existing event log
   * stays byte-identical.
   *
   * Walked BY INDEX wherever it is spent, so the drain is reproducible from the
   * log rather than depending on object key order.
   */
  attunedShields?: Array<{ property: Property; type: Element | WeaponType; points: number }>;
  boardSize: number;
  /** Sorted by slot ascending; rotation order = this order. */
  pieces: PieceState[];
  /** Board slot the rotation scan starts from (wraps). */
  castCursor: number;
  spanEnd: number;
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
  /**
   * THE TYPE of this combatant's PREVIOUS resolved cast — its `element ?? weapon`
   * (`cardType`, ./typeIdentity), the one notion of a card's type the game already
   * uses for deck affinity. Read by the `chainBonus` keyword, which pays a flat
   * bonus when the previous cast was of a named type (an axe card after a sword, a
   * frost card after a fire).
   *
   * LAZILY WRITTEN, like `PieceState.lastCastTurn`/`nextWeightPenalty`: a
   * combatant that has not yet cast, and one whose cards carry no type at all
   * (only reachable through a bespoke test book), holds no key. `undefined` is
   * dropped by `JSON.stringify`, which is what keeps an un-cast combatant's shape
   * identical to what it was before this field existed.
   */
  lastCastType?: Element | WeaponType;
  /**
   * A standing `affinityCharge`: flat bonus damage waiting for the next cast of
   * `type`. Written ONLY by that keyword's arm and cleared the moment it is
   * spent, so a fight with no armer never touches the field and every existing
   * log stays byte-identical. At most ONE charge stands at a time (re-arming
   * keeps the larger amount — see the `affinityCharge` docs in types.ts).
   */
  empowerNext?: { type: Element | WeaponType; amount: number };
  /**
   * THE TWO AFFINITY AXES, both derived from THIS UNIT'S OWN BOARD and nothing
   * else (`boardAffinities`, ./typeIdentity; user ruling 2026-09-06 — "affinity
   * are just passive buffs based on the board … there should be no hardcoded
   * enemy that break the rule"). Independent: a board of 3 nature + 3 bow holds
   * both. `undefined` on an axis its board does not lean into.
   *
   * Read by `cardMatchup` (element for magical cards, weapon for physical) and
   * by `affinityOpen` (whichever axis the CARD's own type sits on).
   */
  elementAffinity?: Element;
  weaponAffinity?: WeaponType;
  /** Independent threshold set for gated effects when singular matchup fields cannot represent it. */
  effectAffinities?: BoardIdentity[];
  /**
   * The single headline label for the two axes above — element first when a
   * board holds both (`primaryIdentity`, ./typeIdentity). Computed once at
   * setup, `undefined` when the board leans into neither axis.
   *
   * A DISPLAY/FILTER HOOK ONLY (docs/board-type-identity.md, "UI hooks"), and
   * lossy on a dual-affinity board by construction. Nothing the sim DOES reads
   * it: both axes reach the interpreter through the two fields above.
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
  let spanEnd = -1;
  for (let i = 0; i < pieces.length; i += 1) {
    const end = pieces[i]!.slot + pieces[i]!.size - 1;
    if (end > spanEnd) spanEnd = end;
  }
  // AFFINITY — derived from the placed cards, and from NOTHING ELSE (user
  // ruling 2026-09-06: "affinity are just passive buffs based on the board … if
  // they meet the requirements they should have the affinity effect … there
  // should be no hardcoded enemy that break the rule"). `setup.elementAffinity`
  // / `setup.weaponAffinity` are deprecated and DELIBERATELY NOT READ here: an
  // authored value used to override the board, which made an enemy's affinity
  // unreadable from its own cards and let content contradict the rule.
  //
  // Both axes are filled independently, so a board with 3+ of an element AND 3+
  // of a weapon carries both. Element/weapon is unaffected by tier/gem
  // resolution, so the effective skills are fine to tally.
  const affinities = boardAffinities(pieces.map((p) => p.skill));
  const boardIdentity = primaryIdentity(affinities);
  const elementAffinity = affinities.element;
  const weaponAffinity = affinities.weapon;
  const allEffectAffinities = boardEffectAffinities(pieces.map((p) => p.skill));
  const representedEffectCount = (elementAffinity === undefined ? 0 : 1) + (weaponAffinity === undefined ? 0 : 1);
  const effectAffinities = allEffectAffinities.length === representedEffectCount ? undefined : allEffectAffinities;
  return {
    side,
    index,
    name: setup.name,
    stats: applyHeroGems({ ...setup.stats }, gemHeroStats(setup.pieces)),
    shields: { physical: 0, magical: 0, true: 0 },
    boardSize: setup.boardSize,
    pieces,
    castCursor: 0,
    spanEnd,
    readiness: 0,
    performs: 0,
    sdStacks: 0,
    nextWeightPenalty: 0,
    lastCastArchetypes: [],
    elementAffinity,
    weaponAffinity,
    ...(effectAffinities === undefined ? {} : { effectAffinities }),
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
  let total = c.shields.physical + c.shields.magical + c.shields.true;
  // ATTUNED pools count at FACE value here, not at their doubled absorption.
  // This total feeds the maxHp room cap and the "how much wall is standing"
  // reads; both are about points held, and the doubling is an exchange rate
  // applied at the moment damage arrives (`consumeShields`), not extra points.
  const attuned = c.attunedShields;
  if (attuned !== undefined) for (let i = 0; i < attuned.length; i += 1) total += attuned[i]!.points;
  return total;
}

export function hasStatus(c: CombatantState, kind: StatusInstance['kind']): boolean {
  return c.statuses.some((s) => s.kind === kind);
}

/**
 * Total CURRENT stacks of one status kind on a unit — the pile half of
 * `stackBonusCount` below, which is the only way in.
 *
 * SUMMED ACROSS PILES even though every stacking kind (poison/burn/bleed via
 * `applyDot`, thorns via its own arm) keeps exactly ONE pile per holder and
 * merges into it: the sum is correct for one pile and stays correct if a future
 * kind ever opens a second, where a `find`-the-first would silently under-read.
 * Kinds that carry no `stacks` return 0.
 *
 * Indexed walk, integer-only, no RNG — safe to call mid-cast.
 */
function statusStackCount(c: CombatantState, kind: StatusInstance['kind']): number {
  let stacks = 0;
  for (let i = 0; i < c.statuses.length; i += 1) {
    const s = c.statuses[i]!;
    if (s.kind === kind) stacks += s.stacks ?? 0;
  }
  return stacks;
}

/**
 * HOW MANY BOARD PIECES THIS UNIT IS CARRYING A `burden` ON — the quantity a
 * `stackBonus` with `status: 'burden'` scales off.
 *
 * IT READS THE FIELD, NOT THE KEYWORD. A piece is burdened when its
 * `PieceState.nextWeightPenalty` is above zero, whatever wrote it — one piece
 * (a bare `burden`) or three (`burden` + `splash`, which only widens the
 * burden's reach and carries no payload of its own). That is the whole combo:
 * a spread burden is three counts for one cast, where a bare one is one.
 *
 * A PENDING UNIT-SCOPE `slow` IS NOT COUNTED: it marks no piece, and
 * `CombatantState.nextWeightPenalty` is a unit field, not a board one. A
 * `curse` is not counted either — it is a damage penalty, not a weight one.
 *
 * `> 0`, not `!== undefined`: the burden arm writes with `Math.max`, so a
 * zero-weight burden is representable and taxes nothing — a piece that is not
 * actually burdened must not be counted. Indexed walk over the slot-sorted
 * `pieces` array; integers only, no RNG.
 */
function burdenedPieceCount(c: CombatantState): number {
  let burdened = 0;
  for (let i = 0; i < c.pieces.length; i += 1) {
    if ((c.pieces[i]!.nextWeightPenalty ?? 0) > 0) burdened += 1;
  }
  return burdened;
}

/**
 * THE ONE SEAM a `stackBonus` reads its count through — `statusStackCount` for
 * the four PILES, `burdenedPieceCount` for `burden`, which is not a pile at all
 * (see `StackedStatus` in types.ts for the split and why `burden` belongs in it).
 *
 * WHY IT IS A FUNCTION HERE AND NOT A BRANCH IN THE INTERPRETER: the core cast
 * loop must consume a RESOLVED count and stay feature-agnostic (CLAUDE.md, the
 * resolver-seam rule). The sixth member of `StackedStatus` — whatever shape it
 * turns out to have — gets a line here and changes nothing in `applyAction`.
 *
 * Integer-only, no RNG, safe to call mid-cast.
 */
export function stackBonusCount(c: CombatantState, status: StackedStatus): number {
  if (status === 'burden') return burdenedPieceCount(c);
  return statusStackCount(c, status);
}

/**
 * THE POOL ORDER A `shieldBurst` DRAINS — physical, then magical, then true.
 *
 * A LITERAL ARRAY, walked by index, never `Object.keys(shields)`: the drain must
 * be reproducible from the event log, so the order is source-fixed rather than
 * object-key-order-fixed. `true` is LAST on purpose — it is the only pool that
 * blocks every property (`consumeShields`), so a burst that cannot pay its whole
 * cap spends the cheapest plating and leaves the best wall standing.
 */
export const SHIELD_BURST_POOL_ORDER: readonly (keyof ShieldPools)[] = ['physical', 'magical', 'true'];

/**
 * Spend up to `cap` points of a unit's OWN shield pools and report what was
 * actually taken — the arithmetic behind the `shieldBurst` rider
 * (`applyAction`, combat/interpreter.ts), kept here beside the pools it mutates
 * and away from the event log.
 *
 * ONE POINT SPENT IS ONE POINT RETURNED, from whichever pool paid it. The 2:1
 * penalty typed damage pays to spill into a `true` shield is a rule about
 * BLOCKING an incoming hit; a burst blocks nothing, and its payload is bounded by
 * `cap` either way (see the action's docs in types.ts).
 *
 * Integer-only, no RNG, no float: `Math.min` over integers in a fixed order.
 * `cap <= 0` (or an empty wall) spends nothing and returns 0, so the caller can
 * treat "no shield" and "no cap" identically.
 */
export function spendShieldsForBurst(c: CombatantState, cap: number): number {
  let remaining = Math.max(0, cap);
  let spent = 0;
  for (let i = 0; i < SHIELD_BURST_POOL_ORDER.length; i += 1) {
    if (remaining <= 0) break;
    const pool = SHIELD_BURST_POOL_ORDER[i]!;
    const take = Math.min(c.shields[pool], remaining);
    c.shields[pool] -= take;
    remaining -= take;
    spent += take;
  }
  // ATTUNED pools are spent LAST and at FACE value — a burst converts plating
  // into damage one point for one point, so the doubling (a defensive exchange
  // rate against matching damage) buys nothing here and the best wall is the one
  // left standing. Same reasoning `true` is last in SHIELD_BURST_POOL_ORDER.
  const attuned = c.attunedShields;
  if (attuned !== undefined) {
    for (let i = 0; i < attuned.length && remaining > 0; i += 1) {
      const pool = attuned[i]!;
      const take = Math.min(pool.points, remaining);
      pool.points -= take;
      remaining -= take;
      spent += take;
    }
  }
  return spent;
}

/**
 * Strip up to `amount` points of ATTUNED plating off a unit and report what was
 * actually taken — the second half of a `shieldBreak` that carries
 * `shattersAttuned` (`applyAction`, combat/interpreter.ts), kept here beside the
 * pools it mutates and away from the event log, exactly like
 * `spendShieldsForBurst` above.
 *
 * FACE VALUE, ONE FOR ONE: a point of Shatter removes a point of plating. The
 * 2:1 rate a matching attuned pool offers is an exchange applied when damage
 * ARRIVES (`consumeShields`); Shatter is not damage arriving, it removes points,
 * and `totalShield` counts attuned points at face value too — so the
 * `shieldBroken` event's `amount` and `totalAfter` stay in one currency. The
 * extra defence a stripped attuned point denies is paid for in the keyword's
 * PRICE instead (`keywords/pricing.ts`).
 *
 * EVERY POOL IS ELIGIBLE, in INDEX order, with no property or type test — the
 * same two choices the untyped half already makes (its pool order decides which
 * pool pays FIRST, never which pool can pay) and the same order
 * `spendShieldsForBurst` drains attuned plating in. Emptied pools are LEFT IN
 * PLACE at 0 points, which is what `spendAttuned` and `spendShieldsForBurst`
 * already leave behind, so no unit's shape changes.
 *
 * Integer-only, no RNG, no float. `amount <= 0` or no attuned plating strips
 * nothing and returns 0.
 */
export function stripAttunedShields(c: CombatantState, amount: number): number {
  const pools = c.attunedShields;
  if (pools === undefined) return 0;
  let remaining = Math.max(0, amount);
  let stripped = 0;
  for (let i = 0; i < pools.length && remaining > 0; i += 1) {
    const pool = pools[i]!;
    const take = Math.min(pool.points, remaining);
    if (take <= 0) continue;
    pool.points -= take;
    remaining -= take;
    stripped += take;
  }
  return stripped;
}

/**
 * HOW MANY `ward` CHARGES this unit is holding, across every pile — the quantity a
 * `wardRelease` rider can cash in, and the same total the `ward` arm clamps against
 * `MAX_WARD_CHARGES`. Index walk over `statuses`, integers only, no RNG.
 */
export function wardChargeCount(c: CombatantState): number {
  let charges = 0;
  for (let i = 0; i < c.statuses.length; i += 1) {
    const s = c.statuses[i]!;
    if (s.kind === 'ward') charges += Math.max(0, s.charges ?? 0);
  }
  return charges;
}

/**
 * Spend up to `maxCharges` of a unit's OWN `ward` charges and report what was
 * actually taken — the arithmetic behind the `wardRelease` rider (`applyAction`,
 * combat/interpreter.ts), kept here beside the state it mutates and away from the
 * event log, exactly like `spendShieldsForBurst` above.
 *
 * PILE ORDER IS LOWEST-INDEX-FIRST, the same order `consumeWard` spends them in
 * (a recast opens a NEW ward pile rather than merging, so "which pile pays" is a
 * real question and gets ONE answer everywhere). Walked by index; no `Map`/`Set`,
 * no RNG, integer-only.
 *
 * Piles drained to zero are REMOVED from `statuses` here, and `pilesEmptied`
 * reports how many — the caller emits one `statusExpired` per emptied pile, which
 * is exactly what `consumeWard` does for the one pile it can drain. `maxCharges <=
 * 0` (or no wards) spends nothing and returns zeros, so the caller can treat "no
 * ward" and "no cap" identically.
 */
export function releaseWardCharges(c: CombatantState, maxCharges: number): { released: number; pilesEmptied: number } {
  let remaining = Math.max(0, maxCharges);
  let released = 0;
  // THE PILES THIS CALL EMPTIED, by IDENTITY — not "every ward pile now at 0".
  // The distinction matters: a filter on the predicate would also sweep away any
  // pre-existing 0-charge pile this call never touched, which would be a silent
  // state change nothing asked for (and no event would report it).
  const emptied: StatusInstance[] = [];
  for (let i = 0; i < c.statuses.length; i += 1) {
    if (remaining <= 0) break;
    const ward = c.statuses[i]!;
    if (ward.kind !== 'ward') continue;
    const have = Math.max(0, ward.charges ?? 0);
    if (have <= 0) continue;
    const take = Math.min(have, remaining);
    ward.charges = have - take;
    remaining -= take;
    released += take;
    if (ward.charges <= 0) emptied.push(ward);
  }
  if (emptied.length > 0) c.statuses = c.statuses.filter((s) => !emptied.includes(s));
  return { released, pilesEmptied: emptied.length };
}
