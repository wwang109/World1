// Core shared types for the 1v1 initiative-comparison skill-board combat engine.
//
// DETERMINISM RULES (apply to everything under src/engine):
// - Simulation state holds integers only. No floats persist between turns;
//   percentage math is computed transiently and floored immediately.
// - Never iterate Map/Set where order can vary — iterate arrays by index.
// - No Date.now()/Math.random(). COMBAT ITSELF IS RNG-FREE: crits use a
//   deterministic bank (chance accrues per strike, crits at 100), so one
//   setup has exactly one outcome. The seeded Rng is reserved for systems
//   outside the fight (drops, map generation, future specials); any such
//   calls must happen in a fixed order regardless of rendering.

export type Side = 'player' | 'enemy';

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
  /** Initiative: turn score = bank + speed − queued card's weight. */
  speed: number;
  critPct: number;
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

/** Board slots occupied AND turn span: a size-3 card busies its caster 2 extra turns. */
export type SkillSize = 1 | 2 | 3;

/**
 * Who a card's hostile actions hit:
 * - aggro:    highest-aggro living foe (ties to the front) — the default
 * - lowAggro: lowest-aggro living foe (assassin: snipe whoever hides)
 * - lowestHp: weakest living foe (executioner: finish wounded targets)
 * - all:      every living foe — damage strikes only, at a reduced %;
 *             non-damage riders stick to the default single target
 */
export type TargetMode = 'aggro' | 'lowAggro' | 'lowestHp' | 'all';

/**
 * An enchantment: a modifier attached to a PLACED card (per board piece, not
 * per card def), overriding how the card targets. Enchants compose with tier
 * variants. Shipped enchants are sidegrades — they trade target QUALITY for
 * raw power (AoE pays a per-target damage cut) — so they carry no PL price;
 * an enchant that adds raw power must price it with the balance table.
 */
export interface EnchantDef {
  id: string;
  name: string;
  /** Small badge shown on enchanted pieces. */
  icon: string;
  targeting: TargetMode;
  /** For 'all': each target takes this % of the rolled damage. */
  aoeDamagePct?: number;
  text: string;
}

export type EnchantBook = Record<string, EnchantDef>;

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

export type BuffableStat = 'attack' | 'magicPower' | 'armor' | 'magicResist' | 'speed' | 'critPct';

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
  /** Ticks on the victim at the start of each global turn. Bypasses shields. */
  | { kind: 'poison'; amount: number; turns: number }
  /** Ticks on the victim at the start of each global turn. Consumed by shields. */
  | { kind: 'burn'; amount: number; turns: number }
  /** Consumes the victim's next performance (not a global turn). */
  | { kind: 'stun'; turns: number }
  | { kind: 'buffStat'; stat: BuffableStat; pct: number; turns: number }
  | { kind: 'debuffStat'; stat: BuffableStat; pct: number; turns: number }
  /** Remove the caster's poisons, burns, stuns and debuffs. */
  | { kind: 'cleanse' }
  // ---- Special ability riders (combined-archetype cards) ----
  /** The enemy's NEXT action is this much heavier (their attack comes later). */
  | { kind: 'slowNext'; weight: number }
  /** Drain the enemy's banked readiness (steal their built-up tempo). */
  | { kind: 'stagger'; amount: number }
  /** Heal the caster for pct% of the damage this cast dealt (place after damage). */
  | { kind: 'lifesteal'; pct: number }
  /** Shatter enemy shields before the hit (place before damage). */
  | { kind: 'shieldBreak'; amount: number }
  /** +pct% damage this cast if the previous cast shared an archetype (place first). */
  | { kind: 'comboBonus'; pct: number }
  /** +pct% damage this cast while the enemy is below belowPct% HP (place first). */
  | { kind: 'execute'; pct: number; belowPct: number }
  /** The caster's NEXT action is this much lighter (comes out sooner). */
  | { kind: 'quicken'; weight: number }
  /** Reflect pct% of skill hits taken back at the attacker as TRUE damage. */
  | { kind: 'thorns'; pct: number; turns: number }
  /** `hits` separate strikes of power% each; crit and mitigation roll per hit. */
  | { kind: 'multiHit'; power: number; hits: number }
  /** Strip the ENEMY's positive statuses (buffs, thorns, regen). */
  | { kind: 'purge' }
  /** Heal the caster a flat amount at the start of each global turn. */
  | { kind: 'regen'; amount: number; turns: number };

/** Positional modifiers a (usually Support/passive) card projects onto board neighbors. */
export interface AuraDef {
  /** adjacent/left/right = pieces physically touching this card's edges. */
  affects: 'adjacent' | 'left' | 'right' | 'allBoard';
  /** Only cards carrying this archetype receive the aura. */
  archetypeFilter?: Archetype;
  /** Only cards of this property receive the aura. */
  propertyFilter?: Property;
  mods: {
    damagePct?: number;
    healPct?: number;
    /** Reduces (negative) or raises the card's speed weight. */
    weightDelta?: number;
    critPctDelta?: number;
  };
}

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
  rarity: Rarity;
  /** Power-level tier; the card's kit must sum to the tier's PL budget. */
  tier: SkillTier;
  /** Required on every Magical card (advantage wheel + synergy filters). */
  element?: Element;
  /** Required on Physical cards that deal damage (weapon triangle). */
  weapon?: WeaponType;
  /** Hostile-action targeting; default 'aggro'. Enchants override per piece. */
  targeting?: TargetMode;
  /** Cast effects. Empty for pure passives (skipped by the rotation). */
  effects: Action[];
  /** Positional effect projected onto neighboring board cards. */
  aura?: AuraDef;
  /** Registry key for hand-coded behavior the DSL can't express. */
  special?: string;
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

/** A card placed on a board; `slot` is its leftmost occupied slot. */
export interface BoardPiece {
  skillId: string;
  slot: number;
  /** Enchantment attached to this placed card (id into the enchant book). */
  enchant?: string;
}

/** A fully resolved combatant fed into simulate(). */
export interface CombatantSetup {
  name: string;
  stats: CombatantStats;
  /** Board width in slots (10 for the hero). */
  boardSize: number;
  /** Placed cards; sizes come from the skill book. Must not overlap. */
  pieces: BoardPiece[];
  /** Takes +50% from the element that beats this, −25% from the one it beats. */
  elementAffinity?: Element;
  /** Same rule against the weapon triangle. */
  weaponAffinity?: WeaponType;
  /**
   * Starting threat. Enemies hit the highest-aggro living foe (ties to the
   * front of the formation); 0 everywhere = front-line targeting.
   */
  aggro?: number;
}

/** Max combatants on one side of a battle. */
export const MAX_SIDE_SIZE = 5;

export interface CombatConfig {
  /** One combatant or a party of up to MAX_SIDE_SIZE (array order = formation). */
  player: CombatantSetup | CombatantSetup[];
  enemy: CombatantSetup | CombatantSetup[];
  skillBook: SkillBook;
  /** Enchant definitions referenced by pieces' `enchant` ids. */
  enchantBook?: EnchantBook;
  /**
   * Rounds (both sides have performed N times) before sudden death: damage
   * ramps +10%/turn for the player, +30%/turn for the enemy. Default 5.
   */
  suddenDeathRound?: number;
  /** Global turn after which the flat fatigue backstop starts. Default 40. */
  fatigueTurn?: number;
  /** Hard global-turn guard; sudden death ends fights long before this. */
  maxTurns?: number;
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
