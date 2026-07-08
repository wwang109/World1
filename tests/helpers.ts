import type { BoardPiece, CombatConfig, CombatantSetup, CombatantStats, SkillBook } from '../src/engine/types';
import { skillBook as dataSkillBook } from '../src/data/skills';

export const DEFAULT_STATS: CombatantStats = {
  maxHp: 100,
  hp: 100,
  atk: 10,
  def: 0,
  speed: 10,
  critPct: 0,
};

/**
 * Test combatant. `skills` are laid out left to right with sizes taken from
 * the data skill book (pass explicit pieces via `piecesOverride` when a test
 * needs gaps or a custom book).
 */
export function tc(
  name: string,
  skills: string[],
  stats: Partial<CombatantStats> = {},
  opts: { boardSize?: number; pieces?: BoardPiece[]; skillBook?: SkillBook } = {},
): CombatantSetup {
  const merged = { ...DEFAULT_STATS, ...stats };
  if (stats.maxHp !== undefined && stats.hp === undefined) merged.hp = stats.maxHp;
  const book = opts.skillBook ?? dataSkillBook;
  let pieces: BoardPiece[];
  if (opts.pieces) {
    pieces = opts.pieces;
  } else {
    pieces = [];
    let slot = 0;
    for (const skillId of skills) {
      const def = book[skillId];
      if (!def) throw new Error(`Unknown test skill: ${skillId}`);
      pieces.push({ skillId, slot });
      slot += def.size;
    }
  }
  const usedSlots = pieces.reduce((max, p) => {
    const def = book[p.skillId];
    return Math.max(max, p.slot + (def?.size ?? 1));
  }, 0);
  return {
    name,
    stats: merged,
    boardSize: opts.boardSize ?? Math.max(10, usedSlots),
    pieces,
  };
}

export function cfg(
  player: CombatantSetup,
  enemy: CombatantSetup,
  extra: Partial<Omit<CombatConfig, 'player' | 'enemy'>> = {},
): CombatConfig {
  return {
    player,
    enemy,
    skillBook: extra.skillBook ?? dataSkillBook,
    suddenDeathRound: extra.suddenDeathRound ?? 5,
    fatigueRound: extra.fatigueRound ?? 20,
    maxTurns: extra.maxTurns ?? 300,
  };
}
