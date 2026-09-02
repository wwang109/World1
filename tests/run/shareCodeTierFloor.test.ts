import { describe, expect, it, vi } from 'vitest';
import { decodeCode, encodeLoadout } from '../../src/run/shareCode';
import { buildEnemyEncounter } from '../../src/run/encounter';

/**
 * TIER FLOOR (T11 + the resolver's clamp) — every shipped card is authored
 * Bronze today, so `clampTierToCard` is a live no-op and the round-trip suite
 * cannot exercise it. Mock ONE card up to a Silver floor to prove the clamp
 * MECHANISM fires on both consumers — the codec's decode (mirrors
 * `createOwnedCard`'s stamping floor) and the custom-deck resolver — the day
 * a real above-Bronze card ships. Isolated in its own file so every other
 * suite keeps testing the real book (vitest module registries are per-file).
 */

vi.mock('../../src/data/skills', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/data/skills')>();
  const sword = mod.skillBook['sword_slash']!;
  return {
    skillBook: { ...mod.skillBook, sword_slash: { ...sword, tier: 'silver' as const } },
  };
});

describe('run/shareCode + encounter: tier floored to the card\'s authored tier', () => {
  it('a code carrying bronze for a silver-floored card decodes clamped, with a report line', () => {
    const code = encodeLoadout({
      heroLevel: 1,
      allocation: [0, 0, 0, 0, 0, 0],
      board: [{ skillId: 'sword_slash', tier: 'bronze', slot: 0, gemId: null }],
      bag: [{ skillId: 'sword_slash', tier: 'bronze' }],
      gems: [],
    });
    const { loadout, report } = decodeCode(code);
    expect(loadout.board[0]!.tier).toBe('silver');
    expect(loadout.bag[0]!.tier).toBe('silver');
    expect(report.clamped.filter((line) => line === 'tier floored on sword_slash')).toHaveLength(2);
  });

  it('a tier at or above the floor is untouched and unreported', () => {
    const { loadout, report } = decodeCode(encodeLoadout({
      heroLevel: 1,
      allocation: [0, 0, 0, 0, 0, 0],
      board: [{ skillId: 'sword_slash', tier: 'gold', slot: 0, gemId: null }],
      bag: [],
      gems: [],
    }));
    expect(loadout.board[0]!.tier).toBe('gold');
    expect(report.clamped).toEqual([]);
  });

  it('the custom-deck resolver clamps a below-floor tier instead of throwing (mirrors createOwnedCard)', () => {
    const unit = buildEnemyEncounter('bandit_duelist', 1, 'normal', 0, [], null, undefined, [
      { skillId: 'sword_slash', slot: 0, tier: 'bronze' },
    ]);
    expect(unit.setup.pieces[0]!.tier).toBe('silver');
    // Clamped TO the authored tier = zero tier-steps above it — rank echo 0.
    expect(unit.rank).toBe(0);
  });

  it('an omitted deck tier stays omitted (the card\'s own authored tier applies)', () => {
    const unit = buildEnemyEncounter('bandit_duelist', 1, 'normal', 0, [], null, undefined, [
      { skillId: 'sword_slash', slot: 0 },
    ]);
    expect(unit.setup.pieces[0]!.tier).toBeUndefined();
  });
});
