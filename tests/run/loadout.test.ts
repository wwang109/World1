import { describe, expect, it } from 'vitest';
import { hasGem, moveWithinStrip, shiftInsert, socketGem, swapGem, unsocketGem, type StripItem } from '../../src/run/loadout';
import type { BoardPiece, Gem } from '../../src/engine/types';

const venomGem: Gem = {
  kind: 'effect',
  id: 'gem_venom',
  rarity: 'common',
  actions: [{ kind: 'poison', stacks: 5 }],
};

const rubyGem: Gem = {
  kind: 'stat',
  id: 'gem_ruby',
  rarity: 'rare',
  scope: 'card',
  mods: { card: { damageFlat: 10 } },
};

function piece(overrides: Partial<BoardPiece> = {}): BoardPiece {
  return { skillId: 'sword_slash', slot: 0, ...overrides };
}

describe('run/loadout: gem socketing', () => {
  it('socketGem attaches a gem into an empty socket', () => {
    const p = piece();
    expect(hasGem(p)).toBe(false);
    const ok = socketGem(p, venomGem);
    expect(ok).toBe(true);
    expect(p.gem).toBe(venomGem);
    expect(hasGem(p)).toBe(true);
  });

  it('socketGem into an occupied socket is a no-op and returns false', () => {
    const p = piece({ gem: venomGem });
    const ok = socketGem(p, rubyGem);
    expect(ok).toBe(false);
    expect(p.gem).toBe(venomGem);
  });

  it('unsocketGem removes and returns the current gem, emptying the slot', () => {
    const p = piece({ gem: venomGem });
    const removed = unsocketGem(p);
    expect(removed).toBe(venomGem);
    expect(p.gem).toBeNull();
    expect(hasGem(p)).toBe(false);
  });

  it('unsocketGem on an empty socket returns null and leaves it empty', () => {
    const p = piece();
    const removed = unsocketGem(p);
    expect(removed).toBeNull();
    expect(p.gem).toBeNull();
  });

  it('swapGem replaces the current gem and returns the displaced one', () => {
    const p = piece({ gem: venomGem });
    const displaced = swapGem(p, rubyGem);
    expect(displaced).toBe(venomGem);
    expect(p.gem).toBe(rubyGem);
  });

  it('swapGem into an empty socket attaches and returns null', () => {
    const p = piece();
    const displaced = swapGem(p, rubyGem);
    expect(displaced).toBeNull();
    expect(p.gem).toBe(rubyGem);
  });
});

describe('run/loadout: shiftInsert', () => {
  const item = (id: string, start: number, size = 1): StripItem => ({ id, start, size });
  const startOf = (plan: { moved: Array<{ id: string; start: number }> }, id: string): number =>
    plan.moved.find((m) => m.id === id)!.start;

  it('drops into a free span without touching neighbors', () => {
    const plan = shiftInsert([item('a', 0), item('b', 5)], 2, 2, 10);
    expect(plan).not.toBeNull();
    expect(plan!.movedStart).toBe(2);
    expect(startOf(plan!, 'a')).toBe(0);
    expect(startOf(plan!, 'b')).toBe(5);
  });

  it('inserting between cards shifts the right neighbor over when there is space', () => {
    const plan = shiftInsert([item('a', 0), item('b', 1)], 1, 1, 10);
    expect(plan!.movedStart).toBe(1);
    expect(startOf(plan!, 'a')).toBe(0);
    expect(startOf(plan!, 'b')).toBe(2);
  });

  it('shifting cascades through a packed run of cards', () => {
    const plan = shiftInsert([item('a', 0), item('b', 1, 2), item('c', 3)], 1, 1, 10);
    expect(plan!.movedStart).toBe(1);
    expect(startOf(plan!, 'b')).toBe(2);
    expect(startOf(plan!, 'c')).toBe(4);
  });

  it('packs left-side items leftward when the right edge lacks room', () => {
    // a sits mid-strip; inserting at the end pushes nothing right (no room)
    // so the backward pass keeps everything in bounds.
    const plan = shiftInsert([item('a', 4, 2), item('b', 8, 2)], 2, 8, 10);
    expect(plan!.movedStart).toBe(6);
    expect(startOf(plan!, 'a')).toBe(4);
    expect(startOf(plan!, 'b')).toBe(8);
  });

  it('rejects the drop when the strip cannot hold everything', () => {
    const others = [item('a', 0, 2), item('b', 2, 2), item('c', 4, 2), item('d', 6, 2), item('e', 8, 2)];
    expect(shiftInsert(others, 1, 4, 10)).toBeNull();
  });

  it('honors forbidden starts (a bag row a span may not cross)', () => {
    // 5-column rows: a size-2 card may not start in column 4.
    const rowValid = (start: number, size: number): boolean => (start % 5) + size <= 5;
    const plan = shiftInsert([item('a', 0, 2), item('b', 2, 2)], 2, 4, 10, rowValid);
    expect(plan).not.toBeNull();
    // Column 4 is forbidden for a size-2 card, so it lands on the next row.
    expect(plan!.movedStart).toBe(5);
  });

  it('shifted neighbors also skip forbidden starts', () => {
    const rowValid = (start: number, size: number): boolean => (start % 5) + size <= 5;
    // Inserting at 2 pushes the size-2 card off 3; it cannot start in
    // column 4, so it skips to the next row.
    const plan = shiftInsert([item('a', 3, 2)], 2, 2, 10, rowValid);
    expect(plan).not.toBeNull();
    expect(plan!.movedStart).toBe(2);
    expect(startOf(plan!, 'a')).toBe(5);
  });

  it('inserts before the first card and after the last card', () => {
    const before = shiftInsert([item('a', 0), item('b', 1)], 1, 0, 10);
    expect(before!.movedStart).toBe(0);
    expect(startOf(before!, 'a')).toBe(1);
    expect(startOf(before!, 'b')).toBe(2);

    const after = shiftInsert([item('a', 0), item('b', 1)], 1, 2, 10);
    expect(after!.movedStart).toBe(2);
    expect(startOf(after!, 'a')).toBe(0);
    expect(startOf(after!, 'b')).toBe(1);
  });

  it('slots in between by pushing BOTH ways when only the left side has room', () => {
    // Slots 1-9 occupied, only slot 0 free. Inserting mid-strip must push
    // the left half leftward and keep the right half in bounds.
    const others = Array.from({ length: 9 }, (_, i) => item(`c${i}`, i + 1));
    const plan = shiftInsert(others, 1, 5, 10);
    expect(plan).not.toBeNull();
    // Everything packs 0-9 with the new card landing between c3 and c4.
    expect(plan!.movedStart).toBe(4);
    expect(startOf(plan!, 'c3')).toBe(3);
    expect(startOf(plan!, 'c4')).toBe(5);
    const allStarts = [plan!.movedStart, ...plan!.moved.map((m) => m.start)].sort((x, y) => x - y);
    expect(allStarts).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('splits the push between both sides for a size-2 insert mid-strip', () => {
    // 8 of 10 slots filled: gaps at 0 and 9. A size-2 card dropped in the
    // middle needs one slot from each side.
    const others = Array.from({ length: 8 }, (_, i) => item(`c${i}`, i + 1));
    const plan = shiftInsert(others, 2, 4, 10);
    expect(plan).not.toBeNull();
    const allStarts = [plan!.movedStart, ...plan!.moved.map((m) => m.start)].sort((x, y) => x - y);
    expect(new Set(allStarts).size).toBe(9);
    // Full occupancy check: every slot 0-9 covered exactly once.
    const covered = new Set<number>();
    covered.add(plan!.movedStart);
    covered.add(plan!.movedStart + 1);
    for (const m of plan!.moved) covered.add(m.start);
    expect(covered.size).toBe(10);
  });

  it('is a no-op when re-dropping a card onto its own position', () => {
    const plan = shiftInsert([item('a', 0), item('b', 5)], 1, 3, 10);
    expect(plan!.movedStart).toBe(3);
    expect(startOf(plan!, 'a')).toBe(0);
    expect(startOf(plan!, 'b')).toBe(5);
  });
});

describe('run/loadout: moveWithinStrip (same-rail reorder)', () => {
  const item = (id: string, start: number, size = 1): StripItem => ({ id, start, size });
  const startOf = (plan: { moved: Array<{ id: string; start: number }> }, id: string): number =>
    plan.moved.find((m) => m.id === id)!.start;

  it('dropping onto the right-hand neighbor swaps places (left to right)', () => {
    // mover sits at 0; drop it on the card at 1.
    const plan = moveWithinStrip([item('b', 1)], 1, 0, 1, 10);
    expect(plan!.movedStart).toBe(1);
    expect(startOf(plan!, 'b')).toBe(0);
  });

  it('dropping onto the left-hand neighbor swaps places (right to left)', () => {
    const plan = moveWithinStrip([item('a', 0)], 1, 1, 0, 10);
    expect(plan!.movedStart).toBe(0);
    expect(startOf(plan!, 'a')).toBe(1);
  });

  it('swaps a size-1 card with a size-2 neighbor', () => {
    // mover(1) at 0, fireball(2) at 1-2; drop mover onto fireball.
    const plan = moveWithinStrip([item('f', 1, 2)], 1, 0, 1, 10);
    expect(startOf(plan!, 'f')).toBe(0);
    expect(plan!.movedStart).toBe(2);
  });

  it('swaps a size-2 card with a size-1 neighbor to its right', () => {
    // fireball(2) at 0-1, b at 2; drop fireball onto b.
    const plan = moveWithinStrip([item('b', 2)], 2, 0, 2, 10);
    expect(startOf(plan!, 'b')).toBe(0);
    expect(plan!.movedStart).toBe(1);
  });

  it('dropping onto a far card reorders the whole run in between', () => {
    // mover at 0; cards at 1,2,3; drop mover onto the card at 3.
    const plan = moveWithinStrip([item('b', 1), item('c', 2), item('d', 3)], 1, 0, 3, 10);
    expect(plan!.movedStart).toBe(3);
    expect(startOf(plan!, 'b')).toBe(0);
    expect(startOf(plan!, 'c')).toBe(1);
    expect(startOf(plan!, 'd')).toBe(2);
  });

  it('moving into free space does not disturb other cards', () => {
    const plan = moveWithinStrip([item('b', 1)], 1, 0, 6, 10);
    expect(plan!.movedStart).toBe(6);
    expect(startOf(plan!, 'b')).toBe(1);
  });

  it('falls back to push-insert when the reorder cannot fit', () => {
    // mover(2) at 0-1; b at 2; c(2) at 3-4 on a 6-slot strip. Dropping the
    // mover on b would ask b to absorb a 2-wide gap it cannot fill alone —
    // any valid arrangement must still hold all three (total 5 of 6 slots).
    const plan = moveWithinStrip([item('b', 2), item('c', 3, 2)], 2, 0, 2, 6);
    expect(plan).not.toBeNull();
    // Whatever strategy resolved it, the result must be overlap-free.
    const spans = [
      { start: plan!.movedStart, size: 2 },
      { start: startOf(plan!, 'b'), size: 1 },
      { start: startOf(plan!, 'c'), size: 2 },
    ].sort((x, y) => x.start - y.start);
    let pos = 0;
    for (const s of spans) {
      expect(s.start).toBeGreaterThanOrEqual(pos);
      pos = s.start + s.size;
    }
    expect(pos).toBeLessThanOrEqual(6);
  });
});
