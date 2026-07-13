import { describe, expect, it } from 'vitest';
import { hasGem, socketGem, swapGem, unsocketGem } from '../../src/run/loadout';
import type { BoardPiece, Gem } from '../../src/engine/types';

const venomGem: Gem = {
  kind: 'effect',
  id: 'gem_venom',
  rarity: 'common',
  actions: [{ kind: 'poison', amount: 5, turns: 3 }],
};

const rubyGem: Gem = {
  kind: 'stat',
  id: 'gem_ruby',
  rarity: 'rare',
  scope: 'card',
  mods: { card: { damagePct: 10 } },
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
