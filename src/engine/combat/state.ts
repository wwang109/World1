import { MAX_SIDE_SIZE } from '../types';
import type { Archetype, BuffableStat, CombatConfig, CombatantSetup, CombatantStats, Element, EnchantBook, Property, Side, SkillBook, WeaponType } from '../types';

export interface StatusInstance {
  kind: 'poison' | 'burn' | 'stun' | 'buff' | 'debuff' | 'thorns' | 'regen';
  /** DoT mitigation/synergy typing (inherited from the card). */
  property?: Property;
  stat?: BuffableStat;
  pct?: number;
  amount?: number;
  /** Remaining GLOBAL turns (stun: remaining performances). */
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
  /** Enchantment id attached to this piece (resolved via cfg.enchantBook). */
  enchant?: string;
  /** Remaining casts this battle (exhaust); undefined = unlimited. */
  castsLeft?: number;
  /** Trap on this card: detonates on its next cast (baked at application). */
  curse?: { amount: number; property: Property };
}

export interface CombatantState {
  side: Side;
  /** Index within its side's formation (0 = front line), fixed at init. */
  unit: number;
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
  /**
   * Deterministic crit meter: each strike banks its crit chance; at 100 the
   * strike crits and spends 100 (50% crit = exactly every 2nd strike).
   */
  critBank: number;
  /** Extra weight on this side's next action (from enemy Slow Next riders). */
  nextWeightPenalty: number;
  /** Weight shaved off this side's next action (from own Quicken riders). */
  nextWeightBonus: number;
  /**
   * Threat: hostile actions target the highest-aggro living foe (ties go to
   * the front of the formation). All-zero aggro = pure front-line targeting.
   * Future taunt/lure cards raise or dump this.
   */
  aggro: number;
  /** Archetypes of the last card this side cast (for Combo riders). */
  lastCastArchetypes: Archetype[];
  /** Skill id of the last card cast (staleness tracking). */
  lastCastSkillId: string | null;
  /**
   * Consecutive re-casts of the same skill. BASE damage never decays; only
   * BONUS effectiveness (auras, combo/execute riders) fades: −25% of the
   * bonus per stale cast, gone by the 4th. Variety resets it.
   */
  staleCasts: number;
  /**
   * Consecutive DIFFERENT casts (the mirror of staleCasts): each chain link
   * AMPLIFIES bonus effectiveness +25%, capped at +75%. Repeating resets it.
   */
  momentumCasts: number;
  /** The caster's next cast deals this % less damage (enemy Weaken cards). */
  nextCastWeakenPct: number;
  elementAffinity?: Element;
  weaponAffinity?: WeaponType;
  statuses: StatusInstance[];
  alive: boolean;
}

export interface CombatState {
  /** Global turn counter (one comparison+performance step per turn). */
  turn: number;
  /** Formations: array order decides front line (index 0) and tie-breaks. */
  player: CombatantState[];
  enemy: CombatantState[];
}

function initCombatant(side: Side, unit: number, setup: CombatantSetup, skillBook: SkillBook, enchantBook?: EnchantBook): CombatantState {
  const occupied = new Array<boolean>(setup.boardSize).fill(false);
  const pieces: PieceState[] = [];
  for (const piece of setup.pieces) {
    const def = skillBook[piece.skillId];
    if (!def) throw new Error(`Unknown skill on board: ${piece.skillId}`);
    if (piece.slot < 0 || piece.slot + def.size > setup.boardSize) {
      throw new Error(`Skill ${piece.skillId} at slot ${piece.slot} exceeds board of ${setup.boardSize}`);
    }
    for (let s = piece.slot; s < piece.slot + def.size; s++) {
      if (occupied[s]) throw new Error(`Board overlap at slot ${s} (${piece.skillId})`);
      occupied[s] = true;
    }
    const enchant = piece.enchant !== undefined ? enchantBook?.[piece.enchant] : undefined;
    const uses = enchant?.uses ?? def.uses;
    pieces.push({ skillId: piece.skillId, slot: piece.slot, size: def.size, enchant: piece.enchant, castsLeft: uses });
  }
  pieces.sort((a, b) => a.slot - b.slot);
  return {
    side,
    unit,
    name: setup.name,
    stats: { ...setup.stats },
    shields: { physical: 0, magical: 0, true: 0 },
    boardSize: setup.boardSize,
    pieces,
    castCursor: 0,
    bank: 0,
    busyTurns: 0,
    performs: 0,
    sdStacks: 0,
    critBank: 0,
    nextWeightPenalty: 0,
    nextWeightBonus: 0,
    aggro: setup.aggro ?? 0,
    lastCastArchetypes: [],
    lastCastSkillId: null,
    staleCasts: 0,
    momentumCasts: 0,
    nextCastWeakenPct: 0,
    elementAffinity: setup.elementAffinity,
    weaponAffinity: setup.weaponAffinity,
    statuses: [],
    alive: setup.stats.hp > 0,
  };
}

function initSide(side: Side, setups: CombatantSetup | CombatantSetup[], skillBook: SkillBook, enchantBook?: EnchantBook): CombatantState[] {
  const list = Array.isArray(setups) ? setups : [setups];
  if (list.length < 1 || list.length > MAX_SIDE_SIZE) {
    throw new Error(`Side '${side}' must field 1-${MAX_SIDE_SIZE} combatants, got ${list.length}`);
  }
  return list.map((setup, unit) => initCombatant(side, unit, setup, skillBook, enchantBook));
}

export function initCombatState(cfg: CombatConfig): CombatState {
  return {
    turn: 0,
    player: initSide('player', cfg.player, cfg.skillBook, cfg.enchantBook),
    enemy: initSide('enemy', cfg.enemy, cfg.skillBook, cfg.enchantBook),
  };
}

export function sideOf(state: CombatState, side: Side): CombatantState[] {
  return side === 'player' ? state.player : state.enemy;
}

export function foesOf(state: CombatState, c: CombatantState): CombatantState[] {
  return sideOf(state, c.side === 'player' ? 'enemy' : 'player');
}

export function livingFoes(state: CombatState, c: CombatantState): CombatantState[] {
  return foesOf(state, c).filter((f) => f.alive);
}

/**
 * Pick a single hostile target among LIVING foes; ties always go to the
 * front of the formation (lowest unit index). Resolved at action time, so
 * kills retarget mid-cast. Falls back to the front unit when the whole side
 * is down so callers can still no-op on `!target.alive`.
 * - aggro:    highest aggro (default — with all-zero aggro = front line)
 * - lowAggro: lowest aggro (assassin)
 * - lowestHp: least current HP (executioner)
 */
export function pickTarget(state: CombatState, c: CombatantState, mode: 'aggro' | 'lowAggro' | 'lowestHp'): CombatantState {
  const foes = foesOf(state, c);
  let target: CombatantState | null = null;
  for (const foe of foes) {
    if (!foe.alive) continue;
    if (target === null) {
      target = foe;
    } else if (mode === 'aggro' && foe.aggro > target.aggro) {
      target = foe;
    } else if (mode === 'lowAggro' && foe.aggro < target.aggro) {
      target = foe;
    } else if (mode === 'lowestHp' && foe.stats.hp < target.stats.hp) {
      target = foe;
    }
  }
  return target ?? foes[0]!;
}

/** Default-mode target (highest aggro, ties to the front). */
export function opponentOf(state: CombatState, c: CombatantState): CombatantState {
  return pickTarget(state, c, 'aggro');
}

export function sideDefeated(units: CombatantState[]): boolean {
  return units.every((u) => !u.alive);
}

/** Effective stat after buff/debuff percentages (and flat amounts), signed. */
export function effStatSigned(c: CombatantState, stat: BuffableStat): number {
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
  return Math.floor(((c.stats[stat] ?? 0) * pct) / 100) + flat;
}

/** Effective stat after buff/debuff percentages (and flat amounts). Never below 0. */
export function effStat(c: CombatantState, stat: BuffableStat): number {
  return Math.max(0, effStatSigned(c, stat));
}

/**
 * The RESOLVE CHECK: how strongly hostile lingering effects land on `c`, as
 * a percentage. 100 = full effect; each point of Resolve shaves 1%; Resolve
 * debuffed below 0 AMPLIFIES effects, capped at 150%.
 */
export function effectPotencyPct(c: CombatantState): number {
  return Math.max(0, Math.min(150, 100 - effStatSigned(c, 'resolve')));
}

export function totalShield(c: CombatantState): number {
  return c.shields.physical + c.shields.magical + c.shields.true;
}

export function hasStatus(c: CombatantState, kind: StatusInstance['kind']): boolean {
  return c.statuses.some((s) => s.kind === kind);
}

/** Statuses the owner wants to keep: cleanse spares them, purge strips them. */
export function isPositiveStatus(s: StatusInstance): boolean {
  return s.kind === 'buff' || s.kind === 'thorns' || s.kind === 'regen';
}
