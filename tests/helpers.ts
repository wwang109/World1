import type { BoardPiece, CombatConfig, CombatantSetup, CombatantStats, SkillBook } from '../src/engine/types';
import { skillBook as dataSkillBook } from '../src/data/skills';

export const DEFAULT_STATS: CombatantStats = {
  maxHp: 100,
  hp: 100,
  attack: 10,
  magicPower: 10,
  armor: 0,
  magicResist: 0,
  speed: 10,
  critPct: 0,
};

/**
 * Test combatant. `skills` are laid out left to right with sizes taken from
 * the skill book; pass `pieces` for gaps or custom layouts.
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
  extra: Partial<Omit<CombatConfig, 'player' | 'enemy' | 'playerTeam' | 'enemyTeam'>> = {},
): CombatConfig {
  // Route through the team-shaped config (Wave 2). Behavior is byte-identical
  // to the old legacy `{ player, enemy }` for the same 1v1 input.
  return {
    playerTeam: [player],
    enemyTeam: [enemy],
    skillBook: extra.skillBook ?? dataSkillBook,
    suddenDeathRound: extra.suddenDeathRound ?? 5,
    fatigueTurn: extra.fatigueTurn ?? 40,
    maxTurns: extra.maxTurns ?? 200,
    // Cooldowns default ON in real play; the TEST path defaults them OFF so the
    // existing mechanic tests stay byte-identical to the pre-cooldown engine. A
    // cooldown test opts in explicitly with `{ cooldownsEnabled: true }`.
    cooldownsEnabled: extra.cooldownsEnabled ?? false,
  };
}

/** Endgame disabled — for tests isolating a single mechanic. */
export const NO_ENDGAME = { suddenDeathRound: 999, fatigueTurn: 9999, maxTurns: 60 } as const;

/** A minimal book of neutral cards for precise scheduling tests. */
export const MINI_BOOK: SkillBook = {
  slash: {
    id: 'slash',
    name: 'Slash',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 100 }],
    text: '',
  },
  bite: {
    id: 'bite',
    name: 'Bite',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 100 }],
    text: '',
  },
  meteor: {
    id: 'meteor',
    name: 'Meteor',
    archetypes: ['offense'],
    property: 'magical',
    size: 3,
    speedWeight: 30,
    rarity: 'epic',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 300 }],
    text: '',
  },
};
