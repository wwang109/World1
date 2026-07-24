// Core shared types for the deterministic readiness skill-board combat engine.
//
// DETERMINISM RULES (apply to everything under src/engine):
// - Simulation state holds integers only. No floats persist between turns;
//   percentage math is computed transiently and floored immediately.
// - Never iterate Map/Set where order can vary — iterate arrays by index.
// - No Date.now()/Math.random(). All randomness flows through Rng, and RNG
//   calls must happen in a fixed order regardless of rendering.

export type Side = 'player' | 'enemy';

/** Which board card produced an effect (for per-card combat attribution). */
export interface EffectSourceRef {
  side: Side;
  unit: number;
  slot: number;
  skillId: string;
}

export interface CombatantStats {
  maxHp: number;
  hp: number;
  /** Scales Physical skills. */
  attack: number;
  /** Scales Magical skills. */
  magicPower: number;
  /** Reduces incoming Physical damage. */
  armor: number;
  /** Reduces incoming Magical damage. */
  magicResist: number;
  /** Initiative added to readiness at the start of every gameplay turn. */
  speed: number;
}

/** Card type identity — a card carries ONE OR MORE of these. */
export type Archetype = 'offense' | 'defensive' | 'healing' | 'support' | 'debuff';

/**
 * Property shapes how the card works in every archetype:
 * - physical: damage vs Armor, scales off Attack; shields block Physical
 * - magical:  damage vs Magic Resist, scales off Magic Power; shields block Magical
 * - true:     damage ignores defenses (scales off higher stat); shields block
 *             EVERYTHING; heals/buffs are flat, no scaling or reduction math
 */
export type Property = 'physical' | 'magical' | 'true';

/** Board slots occupied; traversing slots after the first makes the caster busy. */
export type SkillSize = 1 | 2 | 3;

/**
 * Default per-card reuse cooldown, in GLOBAL turns, when a card does not set
 * its own `cooldownTurns`. A second pacing dial alongside weight (see
 * `SkillDef.cooldownTurns`). Lives here (rather than `combat/castSelect.ts`,
 * which re-exports it) so both the resolver (`cards.ts`) and the pricing
 * table (`balance.ts`) can read it without creating an import cycle through
 * `combat/state.ts`.
 */
export const BASELINE_COOLDOWN = 3;

/** Elements for Magical cards (wheel + Holy↔Dark pair). */
export type Element = 'fire' | 'frost' | 'lightning' | 'nature' | 'holy' | 'dark';

/**
 * Weapon types for Physical damage cards. Sword/axe/lance form the triangle;
 * beast is the natural-weapon class (fangs, claws, monster attacks); bow sits
 * outside the triangle but beats beast.
 */
export type WeaponType = 'sword' | 'axe' | 'lance' | 'bow' | 'beast';

/** Tier = Power Level budget: bronze 10 · silver 15 · gold 20 · diamond 25. */
export type SkillTier = 'bronze' | 'silver' | 'gold' | 'diamond';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export type BuffableStat = 'attack' | 'magicPower' | 'armor' | 'magicResist' | 'speed';

/**
 * How a unit picks its single offensive target among living foes (deterministic,
 * no RNG, no interactivity):
 * - `aggro`: max current `aggro` (default; tanks pull focus via `taunt`).
 * - `first`: lowest living lineup index (== old 1v1 behavior).
 * - `lowestHp`: min current hp, ties broken to the lowest index.
 * - `highestThreat`: max board Power Level (sum of piece PL), ties → lowest index.
 * All ties break to the lowest living index. `focus` overrides any policy.
 */
export type TargetPolicy = 'aggro' | 'first' | 'lowestHp' | 'highestThreat';

/**
 * Cast actions. Targets are implicit in 1v1: offensive actions hit the enemy,
 * supportive ones apply to the caster.
 *
 * `power` semantics follow the card's property: for physical/magical it is a
 * percentage of the scaling stat (Attack / Magic Power); for TRUE cards it is
 * a FLAT amount (no scaling, no reduction). Durations are GLOBAL turns.
 */
export type Action =
  | { kind: 'damage'; power: number }
  | { kind: 'heal'; power: number }
  | { kind: 'shield'; power: number }
  /**
   * DECAYING DoT (user-locked 2026-07-20): applies `stacks` poison. Each tick
   * deals damage EQUAL to the current stack count, then one stack falls off —
   * N stacks total N×(N+1)/2 damage. Exact printed numbers: no stat scaling,
   * no matchup. New applications MERGE into the existing pile. Poison ticks at
   * the END of each global turn (the victim always acts first) and BYPASSES
   * shields.
   */
  | { kind: 'poison'; stacks: number }
  /**
   * HALVING DoT (user-locked 2026-07-20) — fierce and brief. Ticks at the
   * START of each global turn: deals 2 × current stacks, then stacks HALVE
   * (floored) — burn 8 ticks 16, 8, 4, 2. Can kill before the victim acts;
   * ABSORBED by shields (which is why its PL table is discounted).
   */
  | { kind: 'burn'; stacks: number }
  /**
   * DECAYING DoT, same tick model, but ticks each time the victim PERFORMS a
   * cast — acting costs blood. Bypasses shields once applied, but CANNOT be
   * applied while the target holds any active shield (you can't cut what you
   * can't touch). Fast, multi-cast enemies bleed out faster; turtling stalls it.
   */
  | { kind: 'bleed'; stacks: number }
  /** Consumes the victim's next performance (not a global turn). */
  | { kind: 'stun'; turns: number }
  | { kind: 'buffStat'; stat: BuffableStat; pct: number; turns: number }
  | { kind: 'debuffStat'; stat: BuffableStat; pct: number; turns: number }
  /**
   * The mirror of `guard`: while active, the victim takes +`pct`% damage from
   * ALL direct hits (source `skill`) for `turns` global turns. DoT ticks are
   * unaffected (like guard). Applied on the enemy (offensive). `pct` clamped to
   * <=50 at apply time; amplification is floored.
   */
  | { kind: 'expose'; pct: number; turns: number }
  /**
   * Remove up to `charges` of the caster's own NEGATIVE effects (poisons,
   * burns, bleeds, stuns, stat debuffs, expose) in a fixed deterministic order:
   * expiring-soonest first, ties by application order. Buffs/guards/negate are
   * never removed.
   */
  | { kind: 'cleanse'; charges: number }
  /**
   * Raise the CASTER's own `aggro` by `amount` for the rest of the fight
   * (permanent, not turn-decremented). Under the default `aggro` target policy
   * this makes a tank the main target and shields squishier allies.
   */
  | { kind: 'taunt'; amount: number }
  // ---- Special ability riders (combined-archetype cards) ----
  /** The enemy's NEXT action is this much heavier (their attack comes later). */
  | { kind: 'slow'; weight: number }
  /** Drain the enemy's banked readiness (steal their built-up tempo). */
  | { kind: 'disrupt'; amount: number }
  /** Heal the caster for pct% of the damage this cast dealt (place after damage). */
  | { kind: 'lifesteal'; pct: number }
  /** Shatter enemy shields before the hit (place before damage). */
  | { kind: 'shieldBreak'; amount: number }
  /** +amount FLAT damage this cast if the previous cast shared an archetype (place first). */
  | { kind: 'comboBonus'; amount: number }
  // ---- Property-generic defensive keywords ----
  /**
   * Magical Guard: while active, incoming damage of the matching `property` is
   * reduced multiplicatively by `pct`% (floored, min 1) for `turns` global
   * turns. Applied on the caster (self). `pct` is clamped to <=60 at apply time.
   * True damage bypasses (no cross-property match); matching-property DoTs are
   * covered on purpose.
   */
  | { kind: 'guard'; property: Property; pct: number; turns: number }
  /**
   * Magical Negate: grants `charges` counter-charges on the caster (self) that
   * fully nullify the next direct skill hits of the matching `property`. DoT
   * ticks and fatigue never spend a charge. Persists until charges run out (no
   * turn expiry). Total charges of a property are clamped to <=3 at apply time.
   */
  | { kind: 'negate'; property: Property; charges: number };

/** Positional modifiers a (usually Support/passive) card projects onto board neighbors. */
export interface AuraDef {
  /**
   * DIRECTION selector: adjacent = both sides, left/right = one side,
   * allBoard = whole board (reach ignored). Combined with `reach` to decide
   * which neighbors are covered.
   */
  affects: 'adjacent' | 'left' | 'right' | 'allBoard';
  /**
   * Slots of distance the aura projects, measured as the empty-slot GAP between
   * the source's and target's nearest edges (edge-to-edge). A source touching a
   * target (gap 0) is reached at `reach: 1`; `reach: 2` reaches one empty slot
   * further, etc. DEFAULT when omitted is 1, which reproduces the old
   * touching-only "adjacent/left/right" behavior exactly. Ignored for
   * 'allBoard'. A reach of 0 or negative reaches nothing. See `covers()`.
   */
  reach?: number;
  /** Only cards carrying this archetype receive the aura. */
  archetypeFilter?: Archetype;
  /** Only cards of this property receive the aura. */
  propertyFilter?: Property;
  mods: {
    /** FLAT damage added to each cast the aura reaches (not a percentage). */
    damageFlat?: number;
    /** FLAT healing added to each heal the aura reaches. */
    healFlat?: number;
    /** Reduces (negative) or raises the card's speed weight. */
    weightDelta?: number;
  };
}

/**
 * An AUTHORED tier override for one tier above a card's base. When present for
 * a target tier, `applyTier` uses it verbatim (spread over the base def) instead
 * of the budget-honest auto-scaler — the escape hatch for cards the auto-scaler
 * can't solve (pure control/empower/aura cards) or whose auto-curve a designer
 * wants to hand-shape. Only the listed fields are overridden; everything else
 * (property, size, weapon, element, rarity, archetypes) carries over from base.
 */
export interface TierUpgrade {
  /** Full replacement effect list at this tier. */
  effects?: Action[];
  /** Full replacement aura block at this tier. */
  aura?: AuraDef;
  /** Overrides speedWeight at this tier. */
  speedWeight?: number;
  /** Overrides cooldownTurns at this tier. */
  cooldownTurns?: number;
  /** Overrides the card text at this tier. */
  text?: string;
}

/** Authored per-tier overrides, keyed by the (non-bronze) target tier. */
export type TierUpgrades = Partial<Record<Exclude<SkillTier, 'bronze'>, TierUpgrade>>;

export interface SkillDef {
  id: string;
  name: string;
  archetypes: Archetype[];
  property: Property;
  size: SkillSize;
  /**
   * Initiative weight: heavier = comes out later. Defaults to size * 10.
   * A card CAN be big but quick (low weight, long span) or small but heavy.
   */
  speedWeight?: number;
  /**
   * Reuse lockout in GLOBAL turns — a SECOND pacing dial, orthogonal to
   * `speedWeight`: weight decides firing ORDER among eligible cards, cooldown
   * decides card AVAILABILITY. After this card performs on turn T it is
   * unavailable (skipped by `selectCast`) on turns T+1..T+cooldown and eligible
   * again at T+cooldown+1. Defaults to `BASELINE_COOLDOWN` (3) when omitted.
   * Only consulted when `CombatConfig.cooldownsEnabled` is on.
   */
  cooldownTurns?: number;
  rarity: Rarity;
  /** Power-level tier; the card's kit must sum to the tier's PL budget. */
  tier: SkillTier;
  /** Required on every Magical card (advantage wheel + synergy filters). */
  element?: Element;
  /** Required on Physical cards that deal damage (weapon triangle). */
  weapon?: WeaponType;
  /** Cast effects. Empty for pure passives (skipped by the rotation). */
  effects: Action[];
  /**
   * Offensive target scope. `one` (default) = a single foe chosen by the
   * caster's `targetPolicy`; `all` = every living foe (ascending index). Support
   * actions ignore scope (they hit the caster). Un-flagged cards stay
   * single-target and byte-identical.
   */
  scope?: 'one' | 'all';
  /** Positional effect projected onto neighboring board cards. */
  aura?: AuraDef;
  /** Registry key for hand-coded behavior the DSL can't express. */
  special?: string;
  /**
   * Authored per-tier overrides. When a target tier has an entry here,
   * `applyTier` uses it verbatim (spread over the base def) instead of the
   * budget-honest auto-scaler — the escape hatch for cards the auto-scaler
   * can't solve to budget (pure control/empower/aura cards) or whose curve a
   * designer wants to hand-shape.
   */
  tierUpgrades?: TierUpgrades;
  text: string;
}

export type SkillBook = Record<string, SkillDef>;

export function weightOf(skill: SkillDef): number {
  return skill.speedWeight ?? skill.size * 10;
}

export type EquipmentSlot = 'weapon' | 'armor' | 'trinket';

export interface EquipmentDef {
  id: string;
  name: string;
  slot: EquipmentSlot;
  rarity: Rarity;
  statMods: Partial<Omit<CombatantStats, 'hp'>>;
  tags: string[];
  text: string;
}

/**
 * A gem socketed into a board card.
 * - effect: appends extra cast Actions (post-hit/independent riders) to the card.
 * - stat:   flat modifiers, either card-scoped (ride the card's aura bundle) or
 *           hero-scoped (added to the combatant's base stats at setup).
 */
export type Gem =
  | {
      kind: 'effect';
      id: string;
      rarity: Rarity;
      actions: Action[];
      /**
       * Turns shaved off the host card's effective cooldown (additive,
       * floored at 0 turns — never negative/never lengthens). Priced by
       * `PRICE.cooldownPerTurn` in `balance.ts`, folded into the effective
       * skill by `resolveEffectiveSkill` in `cards.ts`.
       */
      cooldownReduction?: number;
    }
  | { kind: 'stat'; id: string; rarity: Rarity; scope: 'card' | 'hero'; mods: StatGemMods };

export interface StatGemMods {
  /** Hero-scope: flat integer stat adds folded into base stats. */
  hero?: Partial<Record<BuffableStat, number>>;
  /** Card-scope: modifiers applied to the socketed card only (AuraMods-shaped). */
  card?: { damageFlat?: number; healFlat?: number; weightDelta?: number };
}

/** A card placed on a board; `slot` is its leftmost occupied slot. */
export interface BoardPiece {
  skillId: string;
  slot: number;
  /** Optional per-piece skill tier override. */
  tier?: SkillTier;
  /** Optional socketed gem. */
  gem?: Gem | null;
}

/** A fully resolved combatant fed into simulate(). */
export interface CombatantSetup {
  name: string;
  stats: CombatantStats;
  /** Board width in slots (10 for the hero). */
  boardSize: number;
  /** Placed cards; sizes come from the skill book. Must not overlap. */
  pieces: BoardPiece[];
  /** How this unit picks its single offensive target among living foes. Default `aggro`. */
  targetPolicy?: TargetPolicy;
  /** Starting aggro (threat) this unit carries into the fight. Default 0. */
  baseAggro?: number;
  /**
   * Explicit target override: the opposing lineup index this unit focuses.
   * When set and that foe is living, it wins over `targetPolicy`; otherwise the
   * policy applies. Ignored by AoE (`scope: 'all'`) cards.
   */
  focus?: number;
  /** Takes +50% from the element that beats this, −25% from the one it beats. */
  elementAffinity?: Element;
  /** Same rule against the weapon triangle. */
  weaponAffinity?: WeaponType;
}

export interface CombatConfig {
  /** Player-side units, canonical (index-ascending) order. 1-element = 1v1. */
  playerTeam?: CombatantSetup[];
  /** Enemy-side units, canonical order. */
  enemyTeam?: CombatantSetup[];
  /**
   * @deprecated Use `playerTeam` (or the `simulate1v1` adapter). Legacy single
   * setup is still accepted for the pre-team UI (Wave-4 migration) and wraps to
   * a 1-element `playerTeam`. Teams XOR legacy: providing both throws.
   */
  player?: CombatantSetup;
  /**
   * @deprecated Use `enemyTeam` (or `simulate1v1`). Wraps to a 1-element
   * `enemyTeam`. Teams XOR legacy.
   */
  enemy?: CombatantSetup;
  skillBook: SkillBook;
  /**
   * Rounds (both sides have performed N times) before sudden death: damage
   * ramps +10%/turn for the player, +30%/turn for the enemy. Default 5.
   */
  suddenDeathRound?: number;
  /** Global turn after which the flat fatigue backstop starts. Default 40. */
  fatigueTurn?: number;
  /** Hard global-turn guard; sudden death ends fights long before this. */
  maxTurns?: number;
  /**
   * Per-card reuse cooldowns (see `SkillDef.cooldownTurns`). A SECOND pacing
   * dial that coexists with readiness and card weight: weight is the readiness
   * paid to play, while cooldown gates which cards are eligible. Every living
   * combatant still gains Speed while cards cool. DEFAULT true for real play.
   */
  cooldownsEnabled?: boolean;
}

export type CombatOutcome = 'win' | 'loss' | 'draw';

export interface EnemyDef {
  id: string;
  name: string;
  /** Difficulty anchor; stats/boards scale with zone depth at setup time. */
  baseDepth: number;
  isElite?: boolean;
  isBoss?: boolean;
  stats: CombatantStats;
  boardSize: number;
  pieces: BoardPiece[];
  elementAffinity?: Element;
  weaponAffinity?: WeaponType;
  goldReward: number;
  xpReward: number;
}
