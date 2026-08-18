import { footprintGaps } from './auras';
import type { CombatantState, PieceState } from './state';

/**
 * THE piece the cast cursor is standing in, and WHICH of its slots (1-based).
 * `null` when the cursor sits on an empty slot.
 *
 * Shared by the turn loop (`simulate.ts` — span progress / `busy` rows) and the
 * `splash` anchor below, so "the card whose turn it is" has exactly one
 * definition. Indexed walk over the slot-sorted `pieces` array; no Map/Set, no
 * RNG, integers only.
 */
export function cursorPiece(c: CombatantState): { piece: PieceState; slotIndex: number } | null {
  for (let i = 0; i < c.pieces.length; i += 1) {
    const piece = c.pieces[i]!;
    if (c.castCursor >= piece.slot && c.castCursor < piece.slot + piece.size) {
      return { piece, slotIndex: c.castCursor - piece.slot + 1 };
    }
  }
  return null;
}

/**
 * "The target's current turn's card" — the piece a `splash` anchors on.
 *
 * Normally that is simply the piece the cursor stands in. The cursor can also
 * sit on an EMPTY slot (after a cast it moves to `piece.slot + 1`, which is
 * empty whenever the next card is not immediately adjacent), and in that case
 * the anchor is the next card the ROTATION would reach — the same forward,
 * wrapping, leftmost-slot scan `scanCast`/`moveCursorToNextCard` already use, so
 * the anchor is always the card the victim is about to play. Rotation wraps;
 * the BAND below deliberately does not.
 *
 * `null` only when the board holds no pieces at all.
 */
export function splashAnchor(c: CombatantState): PieceState | null {
  const at = cursorPiece(c);
  if (at) return at.piece;
  for (let offset = 1; offset < c.boardSize; offset += 1) {
    const slot = (c.castCursor + offset) % c.boardSize;
    for (let i = 0; i < c.pieces.length; i += 1) {
      const piece = c.pieces[i]!;
      if (piece.slot === slot) return piece;
    }
  }
  return null;
}

/**
 * The 3-piece SPLASH BAND on `c`'s board: the anchor, plus the piece
 * immediately before and the piece immediately after it.
 *
 * MEASURED EDGE-TO-EDGE, PIECE-TO-PIECE (`footprintGaps`, combat/auras.ts — the
 * same rule aura coverage uses): the left neighbour is the piece with the
 * SMALLEST non-negative `leftGap`, the right neighbour the one with the smallest
 * non-negative `rightGap`. A size-3 card is one piece, not three neighbours, and
 * an empty slot between two cards does not disqualify them from being each
 * other's neighbour — "immediately before/after" is about pieces, not slots.
 *
 * IT DOES NOT WRAP, on purpose (user-locked 2026-08-18): a card at slot 0 has
 * nothing to its left, so an edge anchor yields a 2-piece band and a lone card
 * yields a 1-piece band. Splash is nonetheless PRICED against the canonical
 * maximum of 3 (see `PRICE.splashPerWeightNum`, balance.ts) so a card's PL never
 * depends on where the holder happened to put it.
 *
 * Returns `null` on an empty board. `band` is in ascending slot order and
 * always contains `anchor`.
 */
export function splashBand(c: CombatantState): { anchor: PieceState; band: PieceState[] } | null {
  const anchor = splashAnchor(c);
  if (!anchor) return null;

  let left: PieceState | null = null;
  let leftBest = 0;
  let right: PieceState | null = null;
  let rightBest = 0;
  for (let i = 0; i < c.pieces.length; i += 1) {
    const other = c.pieces[i]!;
    if (other === anchor) continue;
    const { leftGap, rightGap } = footprintGaps(anchor, other);
    if (leftGap >= 0 && (left === null || leftGap < leftBest)) {
      left = other;
      leftBest = leftGap;
    }
    if (rightGap >= 0 && (right === null || rightGap < rightBest)) {
      right = other;
      rightBest = rightGap;
    }
  }

  const band: PieceState[] = [];
  if (left) band.push(left);
  band.push(anchor);
  if (right) band.push(right);
  return { anchor, band };
}
