import { skillBook } from '../data/skills';
import { DRAFT_SET_KEYS, type DraftSetKey } from '../run/draft';
import { bagAsBoardPieces, canPlace } from '../run/loadout';
import { createOwnedCard, demoState, type InventorySlot, type OwnedBoardPiece } from './demoState';

/**
 * Start-of-game draft actions — pure state transitions over `demoState` (no
 * Phaser). `applyDraftPicks` is the START button's handler: it REPLACES the
 * board/bag/wallet with a fresh 4-card deck, one pick per `DRAFT_SET_KEYS`
 * set (offense/defense/support/wildcard), all bronze tier.
 */

const SLOTS = 10;

/** Nearest-fit open bag slot (leftmost occupancy check, ties broken toward
 * `prefer`) for a card of `skillId` against the CURRENT `bagSlots`, reusing
 * `canPlace`/`bagAsBoardPieces` (`src/run/loadout.ts`) for the overlap check —
 * the same idiom `applyDraftResult`'s private `runNearestFit` uses in
 * `src/run/runState.ts`, just expressed via the shared board/bag helpers
 * instead of a hand-rolled occupancy array, since this module already needs
 * `skillBook`-aware sizing that `canPlace` provides for free. Returns -1 if
 * no slot fits (bag full / card too big for any remaining span). */
function nearestBagFit(bagSlots: readonly InventorySlot[], skillId: string, prefer: number): number {
  const pieces = bagAsBoardPieces(bagSlots);
  const fits: number[] = [];
  for (let s = 0; s < SLOTS; s++) {
    if (canPlace(pieces, skillBook, skillId, s, SLOTS)) fits.push(s);
  }
  if (fits.length === 0) return -1;
  return fits.reduce((best, s) => (Math.abs(s - prefer) < Math.abs(best - prefer) ? s : best), fits[0]!);
}

/**
 * Places the four picked skills onto the board starting at slot 0, in
 * `DRAFT_SET_KEYS` order, packing by card size; clears the bag and zeroes
 * gold. The board is only guaranteed to fit the SMALLEST four picks — the
 * catalog has size-3 bronze skills in offense/defense/wildcard, so a pick set
 * can sum past `SLOTS` (e.g. 3+3+2+3 = 11 > 10) and no packing order fits all
 * four on the board. The player never loses a picked card for that: a pick
 * that would overflow the board is instead placed in the bag (nearest fit
 * from slot 0, via `nearestBagFit` above) — still owned, just not
 * pre-equipped. This mirrors `applyDraftResult` in `src/run/runState.ts`
 * (the run-mode twin of this START handler, over `RunState` instead of
 * `demoState`) — kept as a separate implementation rather than a shared one
 * because the two operate on distinct state shapes/persistence models
 * (`demoState`'s mutable sandbox session vs. `RunState`'s pure
 * state-in/state-out run), but both now resolve overflow the SAME way and
 * both throw (rather than silently drop) if a pick genuinely has nowhere to
 * go — unreachable for the current catalog (4 picks, largest bronze size 3,
 * bag width == board width == SLOTS, bag starts empty), but guarded anyway. */
export function applyDraftPicks(picks: Partial<Record<DraftSetKey, string>>): void {
  const pieces: OwnedBoardPiece[] = [];
  const bagSlots: InventorySlot[] = Array<null>(SLOTS).fill(null);
  let cursor = 0;
  for (const key of DRAFT_SET_KEYS) {
    const skillId = picks[key];
    if (!skillId) continue;
    const size = Math.max(1, skillBook[skillId]?.size ?? 1);
    const owned = createOwnedCard(skillId, 'bronze');
    if (cursor + size <= SLOTS) {
      pieces.push({ instanceId: owned.instanceId, skillId: owned.skillId, tier: owned.tier, slot: cursor });
      cursor += size;
      continue;
    }
    const fit = nearestBagFit(bagSlots, skillId, 0);
    if (fit < 0) {
      throw new Error(`applyDraftPicks: no room on board or in bag for drafted pick "${skillId}"`);
    }
    bagSlots[fit] = { instanceId: owned.instanceId, skillId: owned.skillId, tier: owned.tier };
  }
  demoState.pieces = pieces;
  demoState.bagSlots = bagSlots;
  demoState.gold = 0;
}
