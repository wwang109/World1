import type { BuffableStat, CombatConfig, CombatantStats, Property, Side, SkillBook } from '../types';

export interface StatusInstance {
  kind: 'poison' | 'burn' | 'stun' | 'buff' | 'debuff';
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
}

export interface CombatantState {
  side: Side;
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
  statuses: StatusInstance[];
  alive: boolean;
}

export interface CombatState {
  /** Global turn counter (one comparison+performance step per turn). */
  turn: number;
  player: CombatantState;
  enemy: CombatantState;
}

function initCombatant(side: Side, cfg: CombatConfig, skillBook: SkillBook): CombatantState {
  const setup = side === 'player' ? cfg.player : cfg.enemy;
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
    pieces.push({ skillId: piece.skillId, slot: piece.slot, size: def.size });
  }
  pieces.sort((a, b) => a.slot - b.slot);
  return {
    side,
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
    statuses: [],
    alive: setup.stats.hp > 0,
  };
}

export function initCombatState(cfg: CombatConfig): CombatState {
  return {
    turn: 0,
    player: initCombatant('player', cfg, cfg.skillBook),
    enemy: initCombatant('enemy', cfg, cfg.skillBook),
  };
}

export function opponentOf(state: CombatState, c: CombatantState): CombatantState {
  return c.side === 'player' ? state.enemy : state.player;
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
