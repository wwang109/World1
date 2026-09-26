import type { BoardPiece, CombatantSetup } from '../engine/types';
import { buildAutoHeroSetup, resolveBoardCards, type FoeDeckCard } from './encounter';
import { canAfford, LEVEL_STAT_COST, spentPL, totalLevelPL, type Allocation, type LevelStat } from './leveling';

export function requestLevel(label: string, level: number, max: number): number {
  if (typeof level !== 'number' || !Number.isFinite(level)) {
    throw new Error(`${label}: level must be a finite number, got ${String(level)}`);
  }
  return Math.min(max, Math.max(1, Math.floor(level)));
}

function isLevelStat(stat: string): stat is LevelStat {
  return Object.prototype.hasOwnProperty.call(LEVEL_STAT_COST, stat);
}

export function requestAllocation(label: string, allocation: Allocation, budgetLevel: number | null): Allocation {
  if (typeof allocation !== 'object' || allocation === null || Array.isArray(allocation)) {
    throw new Error(`${label}: allocation must be an object of stat buy counts`);
  }
  const clean: Allocation = {};
  for (const [stat, buys] of Object.entries(allocation)) {
    if (!isLevelStat(stat)) throw new Error(`${label}: unknown allocation stat "${stat}"`);
    if (typeof buys !== 'number' || !Number.isInteger(buys) || buys < 0) {
      throw new Error(`${label}: allocation "${stat}" must be a non-negative integer, got ${String(buys)}`);
    }
    clean[stat] = buys;
  }
  if (budgetLevel !== null && !canAfford(budgetLevel, clean)) {
    throw new Error(
      `${label}: allocation over budget (${spentPL(clean)} PL spent, ${totalLevelPL(budgetLevel)} PL available at level ${budgetLevel})`,
    );
  }
  return clean;
}

export function requestPieces(
  label: string,
  boardName: string,
  cards: readonly FoeDeckCard[],
  resolve: (cards: readonly FoeDeckCard[]) => BoardPiece[],
): BoardPiece[] {
  try {
    return resolve(
      cards.map((p) => ({
        skillId: p.skillId,
        slot: p.slot,
        ...(p.tier === undefined ? {} : { tier: p.tier }),
        ...(p.gemId == null ? {} : { gemId: p.gemId }),
      })),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${label}: ${message.replace(/^buildEnemyEncounter: /, '').replace('custom deck', boardName)}`);
  }
}

export interface HeroRequest {
  pieces: readonly BoardPiece[];
  heroLevel: number;
  heroAllocation: Allocation;
  heroPurchasedStats?: Allocation;
}

function heroCard(piece: BoardPiece): FoeDeckCard {
  if (typeof piece !== 'object' || piece === null) throw new Error('hero: every piece must be an object');
  const gem = piece.gem ?? null;
  if (gem !== null && (typeof gem !== 'object' || typeof gem.id !== 'string')) {
    throw new Error(`hero: gem on "${String(piece.skillId)}" must carry a catalog id`);
  }
  return {
    skillId: piece.skillId,
    slot: piece.slot,
    ...(piece.tier === undefined ? {} : { tier: piece.tier }),
    ...(gem === null ? {} : { gemId: gem.id }),
  };
}

export function buildRequestHeroSetup(request: HeroRequest): CombatantSetup {
  if (!Array.isArray(request.pieces)) throw new Error('hero: pieces must be an array');
  const pieces = requestPieces('hero', 'hero board', request.pieces.map(heroCard), resolveBoardCards);
  const level = requestLevel('hero', request.heroLevel, Number.MAX_SAFE_INTEGER);
  const allocation = requestAllocation('hero', request.heroAllocation, level);
  const purchased = request.heroPurchasedStats === undefined
    ? undefined
    : requestAllocation('hero purchased stats', request.heroPurchasedStats, null);
  return buildAutoHeroSetup(level, pieces, allocation, purchased).setup;
}
