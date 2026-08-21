import { footprintGaps } from './auras';
import type { CombatantState, PieceState } from './state';

/**
 * THE CARD-TARGETING GEOMETRY, in one module: which of a victim's board pieces
 * a `burden` / `curse` lands on, with (`splashBand`) or without
 * (`splashAnchor`) a `splash` spreading it.
 *
 * `splash` itself carries no payload (see its docs in types.ts) — it only
 * chooses between the two functions below, via `cardTargetPieces`.
 */

/**
 * THE piece the cast cursor is standing in, and WHICH of its slots (1-based).
 * `null` when the cursor sits on an empty slot.
 *
 * Shared by the turn loop (`simulate.ts` — span progress / `busy` rows) and the
 * card-targeting anchor below, so "the card whose turn it is" has exactly one
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
 * "The target's current turn's card" — THE ANCHOR: the one piece a
 * card-targeting effect (`burden`, `curse`) lands on when nothing spreads it,
 * and the centre of the band when a `splash` does.
 *
 * THE BOARD IS A LINE, NOT A RING (user-locked 2026-08-19). Three cases, in
 * order:
 *   1. the cursor stands INSIDE a piece → that piece;
 *   2. the cursor sits on an EMPTY slot with a card still ahead of it (after a
 *      cast the cursor moves to `piece.slot + 1`, which is empty whenever the
 *      next card is not adjacent) → the NEAREST piece to the RIGHT, i.e. the
 *      next card this pass of the rotation reaches;
 *   3. the cursor is parked PAST THE LAST CARD → the NEAREST piece to the LEFT,
 *      i.e. THE LAST CARD PLAYED. It does NOT wrap round to the leftmost piece.
 *
 * Case 3 is the ruling. Wrapping made the anchor the leftmost card, which by
 * definition has no left neighbour, so every rotation wrap deterministically
 * produced a 2-piece band while the price charged for more; and it made a
 * spread band jump the length of the board for no reason a player can see.
 * Anchoring on the last card played keeps the band where the action just was.
 * Edges genuinely give a smaller band — the spreader's flat price
 * (`PRICE.splashFlatDeci`, balance.ts) deliberately errs cheap for exactly
 * this swing.
 *
 * DELIBERATELY NOT `scanCast` PARITY (corrected 2026-08-19 — this comment used
 * to claim it, and it was never true). `scanCast` additionally skips pieces
 * that are COOLING, pieces already played this turn (`excludedThisTurn`) and
 * pieces whose card has no effect at all. The anchor skips none of them, on
 * purpose:
 *   • Case 3 REQUIRES it. "The last card played" is precisely a piece
 *     `scanCast` would refuse (it is in `excludedThisTurn`, and usually cooling
 *     too), so full parity is incompatible with the ruling above.
 *   • Cooling / already-played are TRANSIENT, but a `burden` is not: it rides
 *     the piece until that piece is next played, however many turns that takes.
 *     So burdening a momentarily-unavailable card is not a whiff — it is simply
 *     paid later. `scanCast`'s skips answer "what can fire RIGHT NOW", which is
 *     a different question from "which card is the cursor parked on". (A
 *     `curse` DOES expire, so a case-3 anchor can outlast one — that is stated
 *     and priced in `PRICE.cursePerAmountNum`, not papered over here.)
 *   • The anchor stays a pure function of (`pieces`, `castCursor`) — no turn
 *     number, no cooldown flag, no turn-loop-local `excludedThisTurn` set. That
 *     is what lets the interpreter, the event log and playback all reproduce
 *     the same band from board state alone.
 *
 * `null` only when the board holds no pieces at all.
 */
export function splashAnchor(c: CombatantState): PieceState | null {
  const at = cursorPiece(c);
  if (at) return at.piece;
  // Indexed walk, no wrap: nearest piece strictly right of the cursor, else
  // (nothing ahead on this line) the nearest piece left of it. Pieces whose
  // footprint covers the cursor were already returned by `cursorPiece`, so
  // every remaining piece is unambiguously on one side or the other.
  let ahead: PieceState | null = null;
  let behind: PieceState | null = null;
  for (let i = 0; i < c.pieces.length; i += 1) {
    const piece = c.pieces[i]!;
    if (piece.slot > c.castCursor) {
      if (ahead === null || piece.slot < ahead.slot) ahead = piece;
    } else if (behind === null || piece.slot > behind.slot) {
      behind = piece;
    }
  }
  return ahead ?? behind;
}

/**
 * The 3-piece BAND a `splash` SPREADS ACROSS on `c`'s board: the anchor, plus
 * the piece immediately before and the piece immediately after it.
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
 * yields a 1-piece band. Neither does the ANCHOR (user-locked 2026-08-19, see
 * `splashAnchor` above) — the whole keyword treats the board as a line.
 *
 * The band is therefore 1..3 pieces wide depending on where on the VICTIM's
 * board the cursor happens to be — something the card's holder does not control
 * at all. So the SPREAD is priced at one flat, holder-independent rate
 * (`PRICE.splashFlatDeci`, balance.ts — user-locked 2026-08-21) that errs
 * cheap; band width beyond it is unpriced upside.
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

/**
 * WHICH OF `c`'s PIECES ONE CARD-TARGETING EFFECT LANDS ON — the single seam
 * `burden` and `curse` both call, and the ONLY place the `splash` spreader
 * changes anything.
 *
 *   spread === false  →  the ANCHOR alone (1 piece)
 *   spread === true   →  the whole BAND   (1..3 pieces, ascending slot order)
 *
 * Why one function rather than two `if`s in the interpreter: the spreader must
 * mean exactly the same thing for every card-targeting keyword, present and
 * future. A new one (say a card-scope stun) is written against this, gets the
 * pairing for free, and cannot accidentally invent its own geometry.
 *
 * `anchor` is returned alongside `pieces` because the event log names it: a
 * replay highlights the anchor differently from the pieces the spread reached,
 * and with a 1-piece result the two coincide.
 *
 * `null` on an empty board (nothing to target). Pure, integer-only, no RNG.
 */
export function cardTargetPieces(
  c: CombatantState,
  spread: boolean,
): { anchor: PieceState; pieces: PieceState[] } | null {
  if (spread) {
    const found = splashBand(c);
    return found ? { anchor: found.anchor, pieces: found.band } : null;
  }
  const anchor = splashAnchor(c);
  return anchor ? { anchor, pieces: [anchor] } : null;
}
