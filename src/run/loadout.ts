import type { BoardPiece, Gem, SkillBook } from '../engine/types';

/** Slots occupied by a piece, honoring its skill's size. */
export function slotsOf(piece: BoardPiece, book: SkillBook): number[] {
  const size = book[piece.skillId]?.size ?? 1;
  const slots: number[] = [];
  for (let s = piece.slot; s < piece.slot + size; s++) slots.push(s);
  return slots;
}

/** Whether `skillId` can be placed with its leftmost slot at `slot`. */
export function canPlace(
  pieces: BoardPiece[],
  book: SkillBook,
  skillId: string,
  slot: number,
  boardSize: number,
  ignore?: BoardPiece,
): boolean {
  const size = book[skillId]?.size ?? 1;
  if (slot < 0 || slot + size > boardSize) return false;
  const wanted = new Set<number>();
  for (let s = slot; s < slot + size; s++) wanted.add(s);
  for (const piece of pieces) {
    if (piece === ignore) continue;
    for (const s of slotsOf(piece, book)) {
      if (wanted.has(s)) return false;
    }
  }
  return true;
}

/** Clamp a raw slot guess into the board for a skill of the given size. */
export function clampSlot(rawSlot: number, skillId: string, book: SkillBook, boardSize: number): number {
  const size = book[skillId]?.size ?? 1;
  return Math.max(0, Math.min(boardSize - size, Math.round(rawSlot)));
}

/**
 * Gem socketing.
 *
 * Design note: a card holds at most ONE gem, in its single `gem` slot on
 * `BoardPiece`. Socket AVAILABILITY — the notion that a card must first
 * *earn* its socket via a tier-up option (one socket per card) — is deferred
 * to the not-yet-built tier-up system. Until that lands, any `BoardPiece` may
 * hold one gem; these helpers just manage attach/detach/swap of that single
 * slot. Gems themselves are reusable assets that move between fights (locked
 * design), hence `swapGem` returns the displaced gem rather than discarding it.
 */

/** Attach `gem` to an empty socket. No-op (returns false) if already occupied. */
export function socketGem(piece: BoardPiece, gem: Gem): boolean {
  if (piece.gem != null) return false;
  piece.gem = gem;
  return true;
}

/** Remove and return the currently socketed gem, or null if none. */
export function unsocketGem(piece: BoardPiece): Gem | null {
  const current = piece.gem ?? null;
  piece.gem = null;
  return current;
}

/** Replace the socketed gem with `gem`, returning the displaced gem (or null). */
export function swapGem(piece: BoardPiece, gem: Gem): Gem | null {
  const displaced = piece.gem ?? null;
  piece.gem = gem;
  return displaced;
}

/** Whether a piece currently holds a socketed gem. */
export function hasGem(piece: BoardPiece): boolean {
  return piece.gem != null;
}
