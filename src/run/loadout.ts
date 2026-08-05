import type { BoardPiece, Gem, SkillBook, SkillTier } from '../engine/types';
import { nextSkillTier, SKILL_TIER_ORDER } from './shop';

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

/** A sized card on a 1-D strip of slots (deck rail or bag), by leftmost slot. */
export interface StripItem {
  id: string;
  start: number;
  size: number;
}

export interface ShiftPlan {
  /** Final leftmost slot of the inserted card. */
  movedStart: number;
  /** Final leftmost slot of every OTHER item (unchanged ones included). */
  moved: Array<{ id: string; start: number }>;
}

/**
 * Insert a card of `size` slots at `desiredStart` on a strip of `stripSize`
 * slots, shifting existing items sideways to make room. Order is preserved:
 * items left of the insertion point may pack left, items at/right of it may
 * push right. Two-pass: a forward pass keeps every item as close to its
 * current slot as possible; if the strip overflows, a backward pass packs
 * from the right edge. `isValidStart` lets callers forbid positions (e.g.
 * bag rows a span may not cross). Returns null when no arrangement exists —
 * the caller must reject the drop.
 */
export function shiftInsert(
  others: StripItem[],
  size: number,
  desiredStart: number,
  stripSize: number,
  isValidStart: (start: number, size: number) => boolean = () => true,
): ShiftPlan | null {
  // Snap the requested slot to the nearest valid start for this size.
  const clamped = Math.max(0, Math.min(stripSize - size, desiredStart));
  let desired = -1;
  for (let s = 0; s + size <= stripSize; s++) {
    if (!isValidStart(s, size)) continue;
    if (desired < 0 || Math.abs(s - clamped) < Math.abs(desired - clamped)) desired = s;
  }
  if (desired < 0) return null;

  const sorted = [...others].sort((a, b) => a.start - b.start);
  const moving = { id: '', start: desired, size };
  const sequence = [
    ...sorted.filter((item) => item.start < desired),
    moving,
    ...sorted.filter((item) => item.start >= desired),
  ];

  // Forward pass: left to right, each item stays at its own slot unless the
  // previous item's span forces it (or an invalid start skips it) rightward.
  const starts: number[] = [];
  let pos = 0;
  let overflow = false;
  for (const item of sequence) {
    let s = Math.max(item.start, pos);
    while (s + item.size <= stripSize && !isValidStart(s, item.size)) s++;
    if (s + item.size > stripSize) {
      overflow = true;
      s = stripSize - item.size;
    }
    starts.push(s);
    pos = s + item.size;
  }

  // Backward pass (only when the forward pass ran off the end): right to
  // left, pack toward the right edge so left-side items absorb the slack.
  if (overflow || pos > stripSize) {
    let limit = stripSize;
    for (let i = sequence.length - 1; i >= 0; i--) {
      const item = sequence[i]!;
      let s = Math.min(starts[i]!, limit - item.size);
      while (s >= 0 && !isValidStart(s, item.size)) s--;
      if (s < 0) return null;
      starts[i] = s;
      limit = s;
    }
  }

  const movingIndex = sequence.indexOf(moving);
  return {
    movedStart: starts[movingIndex]!,
    moved: sequence
      .map((item, i) => ({ id: item.id, start: starts[i]! }))
      .filter((_, i) => i !== movingIndex),
  };
}

/** No overlaps and everything in bounds — sizes looked up from `others` by id. */
function planIsValid(
  others: StripItem[],
  moved: Array<{ id: string; start: number }>,
  movedStart: number,
  size: number,
  stripSize: number,
): boolean {
  const sizes = new Map(others.map((item) => [item.id, item.size]));
  const spans = [
    { start: movedStart, size },
    ...moved.map((m) => ({ start: m.start, size: sizes.get(m.id) ?? 1 })),
  ].sort((a, b) => a.start - b.start);
  let pos = 0;
  for (const span of spans) {
    if (span.start < pos) return false;
    pos = span.start + span.size;
  }
  return pos <= stripSize;
}

/**
 * Move a card WITHIN its own strip (deck rail or bag). Unlike shiftInsert,
 * cards displaced by the drop slide into the space the mover vacated — so
 * dropping onto an adjacent card swaps places, and dropping onto a far card
 * reorders the run in between. Strategy: (1) plain move when the span is
 * free, (2) reorder toward the origin, (3) fall back to push-insert.
 * Returns null when nothing fits.
 */
export function moveWithinStrip(
  others: StripItem[],
  size: number,
  origin: number,
  desiredStart: number,
  stripSize: number,
): ShiftPlan | null {
  const desired = Math.max(0, Math.min(stripSize - size, desiredStart));
  const sorted = [...others].sort((a, b) => a.start - b.start);
  const overlapping = sorted.filter((item) => item.start < desired + size && item.start + item.size > desired);

  // 1. The target span is free — move without disturbing anyone.
  if (overlapping.length === 0) {
    return { movedStart: desired, moved: sorted.map((item) => ({ id: item.id, start: item.start })) };
  }

  // 2. Reorder: everything between the origin and the target slides into the
  //    vacated span; the mover lands tight against the far side, so the run
  //    occupies the same slots it did before. Adjacent drop = swap.
  if (desired > origin) {
    const between = sorted.filter((item) => item.start > origin && item.start < desired + size);
    const last = between[between.length - 1];
    if (last) {
      const movedStart = last.start + last.size - size;
      const moved = sorted.map((item) => ({
        id: item.id,
        start: between.includes(item) ? item.start - size : item.start,
      }));
      if (planIsValid(others, moved, movedStart, size, stripSize)) return { movedStart, moved };
    }
  } else if (desired < origin) {
    const between = sorted.filter((item) => item.start < origin && item.start + item.size > desired);
    const first = between[0];
    if (first) {
      const movedStart = first.start;
      const moved = sorted.map((item) => ({
        id: item.id,
        start: between.includes(item) ? item.start + size : item.start,
      }));
      if (planIsValid(others, moved, movedStart, size, stripSize)) return { movedStart, moved };
    }
  }

  // 3. Reorder impossible — push neighbors like a fresh insert.
  return shiftInsert(others, size, desiredStart, stripSize);
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
 *
 * Pure like every other export in this module: none of these mutate `piece`.
 * Each returns a NEW piece (preserving the caller's concrete subtype, e.g.
 * `OwnedBoardPiece`/`RunBoardPiece`, via the `T extends BoardPiece` generic)
 * for the caller to splice back into its own board-pieces array.
 */

/** Attach `gem` to an empty socket, returning the new piece. Returns null
 * (no-op) if the socket is already occupied — `piece` is untouched either way. */
export function socketGem<T extends BoardPiece>(piece: T, gem: Gem): T | null {
  if (piece.gem != null) return null;
  return { ...piece, gem };
}

/** Remove the socketed gem, returning the new (emptied) piece alongside the
 * gem that was removed (or null if none was socketed). */
export function unsocketGem<T extends BoardPiece>(piece: T): { piece: T; gem: Gem | null } {
  return { piece: { ...piece, gem: null }, gem: piece.gem ?? null };
}

/** Replace the socketed gem with `gem`, returning the new piece alongside the
 * displaced gem (or null if the socket was empty). */
export function swapGem<T extends BoardPiece>(piece: T, gem: Gem): { piece: T; displaced: Gem | null } {
  return { piece: { ...piece, gem }, displaced: piece.gem ?? null };
}

/** Whether a piece currently holds a socketed gem. */
export function hasGem(piece: BoardPiece): boolean {
  return piece.gem != null;
}

/**
 * Stack-merging — USER-LOCKED 2026-08-04: dragging a skill card onto ANOTHER
 * instance of the SAME skill at the SAME tier PROMPTS a fuse into one copy a
 * tier higher (two bronze -> one silver). This is the free, drag-driven twin
 * of the shop's PAID `findMergeTarget`/`nextSkillTier` merge in `shop.ts`
 * (reused here, not duplicated) — that one lifts an owned card by BUYING a
 * shelf offer of it; this one fuses two cards the player ALREADY owns, either
 * of which may live on the board or in the bag. A prompt is REQUIRED before
 * merging — never silent — these helpers only compute the result; the caller
 * (the DeckBuild scenes) owns showing the confirm dialog and applying it
 * through the `pieces`/`bagSlots`/`gemInventory` setters, exactly like every
 * other board edit.
 */

/** The minimal (instanceId/skillId/tier[/gem])-shaped card either merge
 * participant needs — deliberately structural (mirrors `MergeableCard` in
 * `shop.ts`) so it's satisfied by BOTH board pieces (`RunBoardPiece`/
 * `OwnedBoardPiece`, which carry a `gem`) AND bag cards (`RunBagSlot`/
 * `OwnedCard`, which structurally have none — bag cards can't hold a gem in
 * the current model, so `gem` simply reads `undefined` for them, same as an
 * empty board socket). */
export interface StackMergeCard {
  instanceId: string;
  skillId: string;
  tier: SkillTier;
  gem?: Gem | null;
}

/** Whether dropping `dragged` onto `target` should PROMPT a stack merge:
 * different card instances of the same skill at the same tier, with a tier
 * left to climb to (diamond is the ceiling — two diamond copies never merge;
 * the drop must resolve as an ordinary move/swap instead). Pure predicate —
 * scenes call this to decide whether to open the merge-confirm dialog in
 * place of their normal insert/swap path. */
export function canStackMerge(target: StackMergeCard, dragged: StackMergeCard): boolean {
  if (target.instanceId === dragged.instanceId) return false;
  if (target.skillId !== dragged.skillId || target.tier !== dragged.tier) return false;
  return target.tier !== SKILL_TIER_ORDER[SKILL_TIER_ORDER.length - 1];
}

export interface StackMergeResult<T extends StackMergeCard> {
  /** The target, tier bumped one level. Identity (`instanceId`), location
   * (whatever `slot`/index field `T` carries — untouched, this only spreads
   * `tier`), and its OWN socketed gem are all preserved exactly as they were. */
  merged: T;
  /** The DRAGGED copy's gem, displaced back to the pouch — `null` if it held
   * none. NEVER silently discarded: the caller must splice `.id` into
   * `gemInventory`. The target's own gem is untouched (see `merged`) — only
   * the dragged (consumed) copy's gem is ever displaced. */
  displacedGem: Gem | null;
}

/**
 * Fuse `dragged` into `target`: `target` climbs one tier, keeping its own
 * gem (if any) untouched; `dragged` is consumed — the CALLER removes it from
 * wherever it lived (board or bag) — and if it held a gem, that gem comes
 * back as `displacedGem` for the pouch, never destroyed. Pure: neither
 * `target` nor `dragged` is mutated, and the returned `merged` is always a
 * new object. Returns `null` when the pair isn't eligible per
 * `canStackMerge` (already diamond, different skill/tier, or the same
 * instance) — callers should gate on `canStackMerge` before prompting, but
 * this stays safe to call directly too.
 */
export function stackMergePieces<T extends StackMergeCard>(target: T, dragged: StackMergeCard): StackMergeResult<T> | null {
  if (!canStackMerge(target, dragged)) return null;
  const toTier = nextSkillTier(target.tier);
  if (!toTier) return null; // unreachable given canStackMerge's ceiling check; kept for type narrowing
  return { merged: { ...target, tier: toTier }, displacedGem: dragged.gem ?? null };
}
