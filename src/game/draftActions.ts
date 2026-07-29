import { skillBook } from '../data/skills';
import { DRAFT_SET_KEYS, type DraftSetKey } from '../run/draft';
import { createOwnedCard, demoState, type OwnedBoardPiece } from './demoState';

/**
 * Start-of-game draft actions — pure state transitions over `demoState` (no
 * Phaser). `applyDraftPicks` is the START button's handler: it REPLACES the
 * board/bag/wallet with a fresh 4-card deck, one pick per `DRAFT_SET_KEYS`
 * set (offense/defense/support/wildcard), all bronze tier.
 */

const SLOTS = 10;

/** Places the four picked skills onto the board starting at slot 0, in
 * `DRAFT_SET_KEYS` order, packing by card size; clears the bag and zeroes
 * gold. A pick that would overflow the 10-slot board (shouldn't happen with
 * four bronze cards) is silently dropped rather than throwing. */
export function applyDraftPicks(picks: Partial<Record<DraftSetKey, string>>): void {
  const pieces: OwnedBoardPiece[] = [];
  let cursor = 0;
  for (const key of DRAFT_SET_KEYS) {
    const skillId = picks[key];
    if (!skillId) continue;
    const size = Math.max(1, skillBook[skillId]?.size ?? 1);
    if (cursor + size > SLOTS) continue;
    const owned = createOwnedCard(skillId, 'bronze');
    pieces.push({ instanceId: owned.instanceId, skillId: owned.skillId, tier: owned.tier, slot: cursor });
    cursor += size;
  }
  demoState.pieces = pieces;
  demoState.bagSlots = Array<null>(SLOTS).fill(null);
  demoState.gold = 0;
}
