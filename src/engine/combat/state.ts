import type { Archetype, BuffableStat, CombatConfig, CombatantSetup, CombatantStats, Element, Property, Side, SkillBook, SkillDef, TargetPolicy, WeaponType } from '../types';
import type { AuraMods } from './auras';
import { applyHeroGems, gemCardMods, gemHeroStats, resolveEffectiveSkill } from '../cards';
import { powerLevelDeci } from '../balance';

export interface StatusInstance {
  kind: 'poison' | 'burn' | 'stun' | 'buff' | 'debuff' | 'guard' | 'negate';
  /** DoT mitigation/synergy typing (inherited from the card); guard/negate match property. */
  property?: Property;
  stat?: BuffableStat;
  pct?: number;
  amount?: number;
  /** Remaining negate counter-charges (negate only; not turn-decremented). */
  charges?: number;
  /** Remaining GLOBAL turns (stun: remaining performances; negate: unused/0). */
  turnsLeft: number;
  /** Newly applied this turn: skip the first end-of-turn decrement. */
  fresh?: boolean;
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
  /** Banked initiative from turns spent not performing. */
  bank: number;
  /** Remaining turns this side is busy finishing a spanning cast. */
  busyTurns: number;
  /** Number of performances taken (casts + stun-consumed performances). */
  performs: number;
  /** Accumulated sudden-death damage amp (%). */
  sdStacks: number;
  /** Extra weight on this side's next action (from enemy Slow Next riders). */
  nextWeightPenalty: number;
  /** Archetypes of the last card this side cast (for Combo riders). */
  lastCastArchetypes: Archetype[];
  elementAffinity?: Element;
  weaponAffinity?: WeaponType;
  /** Single-target offensive targeting rule among living foes. Default `aggro`. */
  targetPolicy: TargetPolicy;
  /** Opposing lineup index this unit focuses (overrides policy when living). */
  focus?: number;
  /** Threat level; the default `aggro` policy targets the highest-aggro foe. */
  aggro: number;
  statuses: StatusInstance[];
  alive: boolean;
}

export interface CombatState {
  /** Global turn counter (one comparison+performance step per turn). */
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
  return {
    side,
    index,
    name: setup.name,
    stats: applyHeroGems({ ...setup.stats }, gemHeroStats(setup.pieces)),
    shields: { physical: 0, magical: 0, true: 0 },
    boardSize: setup.boardSize,
    pieces,
    castCursor: 0,
    bank: 0,
    busyTurns: 0,
    performs: 0,
    sdStacks: 0,
    nextWeightPenalty: 0,
    lastCastArchetypes: [],
    elementAffinity: setup.elementAffinity,
    weaponAffinity: setup.weaponAffinity,
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
