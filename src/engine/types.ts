// Core shared types for the 1v1 action-timeline skill-board combat engine.
//
// DETERMINISM RULES (apply to everything under src/engine):
// - Simulation state holds integers only. No floats persist between turns;
//   percentage math is computed transiently and floored immediately.
// - Never iterate Map/Set where order can vary — iterate arrays by index.
// - No Date.now()/Math.random(). All randomness flows through Rng, and RNG
//   calls must happen in a fixed order regardless of rendering.

export type Side = 'player' | 'enemy';

export interface CombatantStats {
  maxHp: number;
  hp: number;
  atk: number;
  def: number;
  /** Compresses action delays: delay = timeCost * 100 / speed. */
  speed: number;
  critPct: number;
}

/** Small = 1 board slot, Medium = 2, Large = 3. Also scales cast time. */
export type SkillSize = 1 | 2 | 3;

export type SkillTag =
  | 'attack'
  | 'defense'
  | 'magic'
  | 'fire'
  | 'frost'
  | 'venom'
  | 'holy'
  | 'passive';

export type SkillTier = 'bronze' | 'silver' | 'gold';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export type BuffableStat = 'atk' | 'def' | 'speed' | 'critPct';

/**
 * Cast actions. Targets are implicit in 1v1: offensive actions hit the enemy,
 * supportive ones apply to the caster. `power` scales off the caster's ATK.
 */
export type Action =
  /** damage = floor(atk * power / 100) - target def, min 1. Crits x1.5. */
  | { kind: 'damage'; power: number }
  | { kind: 'heal'; power: number }
  | { kind: 'shield'; power: number }
  /** Acts on every turn of the victim until it expires. Ignores shield. */
  | { kind: 'poison'; amount: number; turns: number }
  /** Acts on every turn of the victim until it expires. Hits shield first. */
  | { kind: 'burn'; amount: number; turns: number }
  /** Victim skips its next `turns` turns. */
  | { kind: 'stun'; turns: number }
  | { kind: 'buffStat'; stat: BuffableStat; pct: number; turns: number }
  /** In force on every turn taken while active. */
  | { kind: 'debuffStat'; stat: BuffableStat; pct: number; turns: number }
  /** Remove the caster's poisons, burns, stuns and debuffs. */
  | { kind: 'cleanse' };

/** Positional modifiers a (usually passive) skill projects onto board neighbors. */
export interface AuraDef {
  /** adjacent/left/right = pieces physically touching this skill's edges. */
  affects: 'adjacent' | 'left' | 'right' | 'allBoard';
  /** Only skills carrying this tag receive the aura. */
  tagFilter?: SkillTag;
  mods: {
    damagePct?: number;
    healPct?: number;
    cooldownDelta?: number;
    critPctDelta?: number;
  };
}

export interface SkillDef {
  id: string;
  name: string;
  /** Board slots occupied AND the base cast-time multiplier. */
  size: SkillSize;
  tags: SkillTag[];
  rarity: Rarity;
  /**
   * Cast time = size * 100 + (timeCostMod ?? 0). The delay to the caster's
   * next turn is this scaled by Speed.
   */
  timeCostMod?: number;
  /** Turns (of the owner) before this skill can be cast again. */
  cooldownTurns?: number;
  /** Cast effects. Empty for pure passives (they are skipped by the cursor). */
  effects: Action[];
  /** Positional effect projected onto neighboring board skills. */
  aura?: AuraDef;
  /** Registry key for hand-coded behavior the DSL can't express. */
  special?: string;
  text: string;
}

export type SkillBook = Record<string, SkillDef>;

export function timeCost(skill: SkillDef): number {
  return skill.size * 100 + (skill.timeCostMod ?? 0);
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

/** A skill placed on a board; `slot` is its leftmost occupied slot. */
export interface BoardPiece {
  skillId: string;
  slot: number;
}

/** A fully resolved combatant fed into simulate(). */
export interface CombatantSetup {
  name: string;
  stats: CombatantStats;
  /** Board width in slots (10 for the hero). */
  boardSize: number;
  /** Placed skills; sizes come from the skill book. Must not overlap. */
  pieces: BoardPiece[];
}

export interface CombatConfig {
  player: CombatantSetup;
  enemy: CombatantSetup;
  skillBook: SkillBook;
  /**
   * Rounds (both sides have acted N times) before sudden death: damage ramps
   * +10%/turn for the player, +30%/turn for the enemy. Default 5.
   */
  suddenDeathRound?: number;
  /** Rounds before the flat-fatigue backstop for zero-damage boards. Default 20. */
  fatigueRound?: number;
  /** Hard turn-count guard; sudden death ends fights long before this. */
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
  goldReward: number;
  xpReward: number;
}
