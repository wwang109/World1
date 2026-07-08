import type { BuffableStat, CombatConfig, CombatantStats, Side, SkillBook } from '../types';

export interface StatusInstance {
  kind: 'poison' | 'burn' | 'stun' | 'buff' | 'debuff';
  stat?: BuffableStat;
  pct?: number;
  amount?: number;
  turnsLeft: number;
  /**
   * Set when the owner applied this to itself during its own turn: the cast
   * turn's end must not consume a duration turn, so "2 turns" means two full
   * subsequent turns.
   */
  skipFirstExpiry?: boolean;
}

/** A skill placed on the board with its live combat state. */
export interface PieceState {
  skillId: string;
  /** Leftmost occupied slot. */
  slot: number;
  /** Slots occupied (from the skill def, cached for adjacency math). */
  size: number;
  /** Turns until castable again (0 = ready). */
  cooldown: number;
}

export interface CombatantState {
  side: Side;
  name: string;
  stats: CombatantStats;
  shield: number;
  boardSize: number;
  /** Sorted by slot ascending; cast order = this order. */
  pieces: PieceState[];
  /** Board slot the cast scan starts from (wraps). */
  castCursor: number;
  /** Timeline position of this combatant's next turn. */
  nextActionAt: number;
  /** Number of turns this combatant has taken. */
  turnCount: number;
  /** Accumulated sudden-death damage amp (%). Grows each own turn once active. */
  sdStacks: number;
  statuses: StatusInstance[];
  alive: boolean;
}

export interface CombatState {
  /** Current timeline position (the acting combatant's turn time). */
  now: number;
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
    pieces.push({ skillId: piece.skillId, slot: piece.slot, size: def.size, cooldown: 0 });
  }
  pieces.sort((a, b) => a.slot - b.slot);
  return {
    side,
    name: setup.name,
    stats: { ...setup.stats },
    shield: 0,
    boardSize: setup.boardSize,
    pieces,
    castCursor: 0,
    nextActionAt: 0,
    turnCount: 0,
    sdStacks: 0,
    statuses: [],
    alive: setup.stats.hp > 0,
  };
}

export function initCombatState(cfg: CombatConfig): CombatState {
  return {
    now: 0,
    player: initCombatant('player', cfg, cfg.skillBook),
    enemy: initCombatant('enemy', cfg, cfg.skillBook),
  };
}

export function opponentOf(state: CombatState, c: CombatantState): CombatantState {
  return c.side === 'player' ? state.enemy : state.player;
}

/** Effective stat after buff/debuff percentages. Floored, never below 0. */
export function effStat(c: CombatantState, stat: BuffableStat): number {
  let pct = 100;
  for (const s of c.statuses) {
    if (s.kind === 'buff' && s.stat === stat) pct += s.pct ?? 0;
    if (s.kind === 'debuff' && s.stat === stat) pct -= s.pct ?? 0;
  }
  return Math.max(0, Math.floor((c.stats[stat] * pct) / 100));
}

export function hasStatus(c: CombatantState, kind: StatusInstance['kind']): boolean {
  return c.statuses.some((s) => s.kind === kind);
}
