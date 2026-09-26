import type { RunState } from './runState';
import type { Allocation } from './leveling';
import type { SkillTier } from '../engine/types';
import { decodeCode, encodeLoadout, allocationToCounts, countsToAllocation, type ShareLoadout } from './shareCode';
import { bandIndexOf } from './biome';
import type { FoeDeckCard } from './encounter';

export const GHOST_NAME_MAX = 10;

export interface GhostBoardPiece {
  skillId: string;
  tier: SkillTier;
  slot: number;
  gemId: string | null;
}

export interface GhostLoadout {
  board: GhostBoardPiece[];
  heroLevel: number;
  heroAllocation: Allocation;
}

export interface GhostRecord {
  id: string;
  code: string;
  displayName: string;
  band: number;
  fightNumber: number;
  createdAt: number;
  ownerLocalId: string;
  defenseWins?: number;
  defenseLosses?: number;
}

export function captureGhostFromRun(run: RunState): GhostLoadout {
  return {
    board: run.pieces.map((piece) => ({
      skillId: piece.skillId,
      tier: piece.tier,
      slot: piece.slot,
      gemId: piece.gem?.id ?? null,
    })),
    heroLevel: run.heroLevel,
    heroAllocation: run.heroAllocation,
  };
}

export function ghostLoadoutToShareLoadout(loadout: GhostLoadout): ShareLoadout {
  return {
    heroLevel: loadout.heroLevel,
    allocation: allocationToCounts(loadout.heroAllocation),
    board: loadout.board,
    bag: [],
    gems: [],
  };
}

export function ghostCodeOf(run: RunState): string {
  return encodeLoadout(ghostLoadoutToShareLoadout(captureGhostFromRun(run)));
}

// fightNumber == wave (runMap.ts) and recordBattleResult credits one win/loss per commit.
export function ghostFightNumberOf(run: RunState): number {
  return run.wins + run.losses;
}

export function ghostBandOf(fightNumber: number): number {
  return bandIndexOf(fightNumber);
}

/** A stored `GhostRecord.code` decoded back into the shape `resolveBattle.ts`'s
 * `BattleGhostConfig` wants — the inverse of `ghostCodeOf`/`captureGhostFromRun`. */
export interface GhostBattlePieces {
  pieces: FoeDeckCard[];
  level: number;
  allocation: Allocation;
  displayName: string;
}

export function ghostToBattlePieces(ghost: GhostRecord): GhostBattlePieces {
  const { loadout } = decodeCode(ghost.code);
  return {
    pieces: loadout.board.map((p) => ({ skillId: p.skillId, tier: p.tier, slot: p.slot, gemId: p.gemId })),
    level: loadout.heroLevel,
    allocation: countsToAllocation(loadout.allocation),
    displayName: ghost.displayName,
  };
}
