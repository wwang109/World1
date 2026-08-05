import { describe, expect, it } from 'vitest';
import {
  canStackMerge, hasGem, moveWithinStrip, shiftInsert, socketGem, stackMergePieces, swapGem, unsocketGem,
  type StackMergeCard, type StripItem,
} from '../../src/run/loadout';
import type { BoardPiece, Gem, SkillTier } from '../../src/engine/types';

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

describe('run/loadout: gem socketing (pure — never mutates the input piece)', () => {
  it('socketGem attaches a gem into an empty socket, returning a NEW piece', () => {
    const p = piece();
    expect(hasGem(p)).toBe(false);
    const next = socketGem(p, venomGem);
    expect(next).not.toBeNull();
    expect(next).not.toBe(p);
    expect(next!.gem).toBe(venomGem);
    expect(hasGem(next!)).toBe(true);
    // input untouched
    expect(p.gem).toBeUndefined();
    expect(hasGem(p)).toBe(false);
  });

  it('socketGem into an occupied socket is a no-op and returns null', () => {
    const p = piece({ gem: venomGem });
    const next = socketGem(p, rubyGem);
    expect(next).toBeNull();
    // input untouched
    expect(p.gem).toBe(venomGem);
  });

  it('unsocketGem removes the gem into the returned piece, emptying the slot; input untouched', () => {
    const p = piece({ gem: venomGem });
    const { piece: next, gem: removed } = unsocketGem(p);
    expect(removed).toBe(venomGem);
    expect(next).not.toBe(p);
    expect(next.gem).toBeNull();
    expect(hasGem(next)).toBe(false);
    // input untouched
    expect(p.gem).toBe(venomGem);
    expect(hasGem(p)).toBe(true);
  });

  it('unsocketGem on an empty socket returns null and an equivalent (still empty) piece', () => {
    const p = piece();
    const { piece: next, gem: removed } = unsocketGem(p);
    expect(removed).toBeNull();
    expect(next.gem).toBeNull();
    // input untouched
    expect(p.gem).toBeUndefined();
  });

  it('swapGem replaces the gem in the returned piece and returns the displaced one; input untouched', () => {
    const p = piece({ gem: venomGem });
    const { piece: next, displaced } = swapGem(p, rubyGem);
    expect(displaced).toBe(venomGem);
    expect(next).not.toBe(p);
    expect(next.gem).toBe(rubyGem);
    // input untouched
    expect(p.gem).toBe(venomGem);
  });

  it('swapGem into an empty socket attaches in the returned piece and returns null; input untouched', () => {
    const p = piece();
    const { piece: next, displaced } = swapGem(p, rubyGem);
    expect(displaced).toBeNull();
    expect(next.gem).toBe(rubyGem);
    // input untouched
    expect(p.gem).toBeUndefined();
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

describe('run/loadout: stack-merging (drag-a-copy-onto-a-copy, pure — never mutates either input)', () => {
  // Board-piece-shaped participant (mirrors OwnedBoardPiece/RunBoardPiece: has
  // a `slot` and MAY carry a `gem`).
  interface BoardCard extends StackMergeCard { slot: number }
  const boardCard = (overrides: Partial<BoardCard> = {}): BoardCard => (
    { instanceId: 'target-1', skillId: 'iron_bulwark', tier: 'bronze', slot: 0, ...overrides }
  );
  // Bag-card-shaped participant (mirrors OwnedCard/RunCard: NO `gem` field at
  // all — bag cards can't hold a gem in the current model).
  const bagCard = (overrides: Partial<StackMergeCard> = {}): StackMergeCard => (
    { instanceId: 'dragged-1', skillId: 'iron_bulwark', tier: 'bronze', ...overrides }
  );

  const gemA: Gem = { kind: 'effect', id: 'gem_a', rarity: 'common', actions: [{ kind: 'poison', stacks: 1 }] };
  const gemB: Gem = { kind: 'effect', id: 'gem_b', rarity: 'common', actions: [{ kind: 'poison', stacks: 2 }] };

  describe('canStackMerge', () => {
    it('is true for two different instances of the same skill at the same tier', () => {
      expect(canStackMerge(boardCard(), bagCard())).toBe(true);
    });

    it('is false for the same instance (a card cannot merge with itself)', () => {
      expect(canStackMerge(boardCard({ instanceId: 'same' }), bagCard({ instanceId: 'same' }))).toBe(false);
    });

    it('is false when the skillId differs', () => {
      expect(canStackMerge(boardCard(), bagCard({ skillId: 'other_skill' }))).toBe(false);
    });

    it('is false when the tier differs', () => {
      expect(canStackMerge(boardCard({ tier: 'bronze' }), bagCard({ tier: 'silver' }))).toBe(false);
    });

    it('is false for two diamond copies — diamond is the merge ceiling', () => {
      expect(canStackMerge(boardCard({ tier: 'diamond' }), bagCard({ tier: 'diamond' }))).toBe(false);
    });
  });

  describe('stackMergePieces', () => {
    it('is pure: neither the target nor the dragged input is mutated', () => {
      const target = boardCard({ gem: gemA });
      const targetSnapshot = { ...target };
      const dragged = bagCard();
      const draggedSnapshot = { ...dragged };
      const result = stackMergePieces(target, dragged);
      expect(result).not.toBeNull();
      expect(target).toEqual(targetSnapshot);
      expect(dragged).toEqual(draggedSnapshot);
      expect(result!.merged).not.toBe(target);
    });

    it('bumps the target exactly one tier: bronze -> silver -> gold -> diamond', () => {
      const chain: Array<[SkillTier, SkillTier]> = [['bronze', 'silver'], ['silver', 'gold'], ['gold', 'diamond']];
      for (const [from, to] of chain) {
        const result = stackMergePieces(boardCard({ tier: from }), bagCard({ tier: from }));
        expect(result).not.toBeNull();
        expect(result!.merged.tier).toBe(to);
      }
    });

    it('the DRAGGED copy\'s gem is displaced to the pouch, never destroyed', () => {
      const target = boardCard(); // no gem
      const dragged = boardCard({ instanceId: 'dragged-1', gem: gemA });
      const result = stackMergePieces(target, dragged);
      expect(result).not.toBeNull();
      expect(result!.displacedGem).toBe(gemA);
    });

    it('the TARGET keeps its own gem regardless of what the dragged copy carried', () => {
      const target = boardCard({ gem: gemA });
      const dragged = boardCard({ instanceId: 'dragged-1', gem: gemB });
      const result = stackMergePieces(target, dragged);
      expect(result).not.toBeNull();
      expect(result!.merged.gem).toBe(gemA); // unchanged — target's gem, not dragged's
      expect(result!.displacedGem).toBe(gemB); // dragged's gem still returned to the pouch
    });

    it('the target keeps its own identity/location (instanceId, slot) — only tier changes', () => {
      const target = boardCard({ instanceId: 'keep-me', slot: 7 });
      const result = stackMergePieces(target, bagCard());
      expect(result!.merged.instanceId).toBe('keep-me');
      expect(result!.merged.slot).toBe(7);
    });

    it('a dragged copy with no gem (e.g. a bag card) displaces null, not undefined-as-a-bug', () => {
      const result = stackMergePieces(boardCard(), bagCard());
      expect(result!.displacedGem).toBeNull();
    });

    it('refuses to merge two diamond copies — returns null, no prompt possible', () => {
      const result = stackMergePieces(boardCard({ tier: 'diamond' }), bagCard({ tier: 'diamond' }));
      expect(result).toBeNull();
    });

    it('refuses different-tier same-skill drops — normal move/swap territory, not a merge', () => {
      const result = stackMergePieces(boardCard({ tier: 'silver' }), bagCard({ tier: 'bronze' }));
      expect(result).toBeNull();
    });

    it('refuses different skills at the same tier', () => {
      const result = stackMergePieces(boardCard(), bagCard({ skillId: 'unrelated' }));
      expect(result).toBeNull();
    });

    // The four drag/drop location pairings the DeckBuild scenes must all
    // route through this same helper — deck-onto-deck, bag-onto-bag,
    // bag-onto-deck, deck-onto-bag.
    it('deck-onto-deck: both participants are board pieces (with slots)', () => {
      const target = boardCard({ instanceId: 't', slot: 2, gem: gemA });
      const dragged = boardCard({ instanceId: 'd', slot: 5, gem: gemB });
      const result = stackMergePieces(target, dragged);
      expect(result!.merged.tier).toBe('silver');
      expect(result!.merged.slot).toBe(2); // target's own slot, untouched
      expect(result!.merged.gem).toBe(gemA); // target's own gem, untouched
      expect(result!.displacedGem).toBe(gemB); // dragged's gem, to the pouch
    });

    it('bag-onto-bag: neither participant has a gem field at all', () => {
      const target = bagCard({ instanceId: 't' });
      const dragged = bagCard({ instanceId: 'd' });
      const result = stackMergePieces(target, dragged);
      expect(result!.merged.tier).toBe('silver');
      expect(result!.merged.gem).toBeUndefined();
      expect(result!.displacedGem).toBeNull();
    });

    it('bag-onto-deck: dragging a board piece onto a bag card target', () => {
      const target = bagCard({ instanceId: 't' }); // bag target, no gem field
      const dragged = boardCard({ instanceId: 'd', slot: 3, gem: gemA }); // deck dragged, has a gem
      const result = stackMergePieces(target, dragged);
      expect(result!.merged.tier).toBe('silver');
      expect('slot' in result!.merged).toBe(false); // still the bag card's shape
      expect(result!.displacedGem).toBe(gemA); // the dragged deck piece's gem returns to the pouch
    });

    it('deck-onto-bag: dragging a bag card onto a board piece target', () => {
      const target = boardCard({ instanceId: 't', slot: 4, gem: gemA });
      const dragged = bagCard({ instanceId: 'd' }); // bag dragged, no gem to displace
      const result = stackMergePieces(target, dragged);
      expect(result!.merged.tier).toBe('silver');
      expect(result!.merged.slot).toBe(4);
      expect(result!.merged.gem).toBe(gemA); // target's own gem, untouched
      expect(result!.displacedGem).toBeNull();
    });
  });
});
