import type { BoardPiece, SkillBook } from '../engine/types';

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
