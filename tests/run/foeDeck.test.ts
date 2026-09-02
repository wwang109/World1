import { describe, expect, it } from 'vitest';
import {
  buildEnemyEncounter,
  FOE_DECK_SLOTS,
  maxRankFor,
  type FoeDeckCard,
} from '../../src/run/encounter';
import { enemies } from '../../src/data/enemies';
import { gemBook } from '../../src/data/gems';
import { HERO_BOARD_SLOTS } from '../../src/data/heroes';

/**
 * CUSTOM FOE DECKS (docs/sandbox-features-proposal.md §1.1) — `deck` replaces
 * the board pipeline (affix install, title filler, rank stamping) while the
 * stat pipeline (LEVEL / TITLE / MODIFIER bonusPL) keeps meaning exactly what
 * it means today. Deck-absent calls must stay byte-identical to before.
 */

const DECK: FoeDeckCard[] = [
  { skillId: 'fireball', slot: 0 }, // size 2 — covers slot 1
  { skillId: 'mana_ward', slot: 2 },
  { skillId: 'sword_slash', slot: 3 },
];

describe('run/encounter: buildEnemyEncounter with a custom deck', () => {
  it('maps the deck 1:1 onto pieces — cards, slots, explicit tiers, sockets', () => {
    const deck: FoeDeckCard[] = [
      { skillId: 'sword_slash', slot: 0, tier: 'gold', gemId: 'swift_charm' },
      { skillId: 'fireball', slot: 1, tier: 'silver' },
      { skillId: 'mana_ward', slot: 4 },
    ];
    const unit = buildEnemyEncounter('bandit_duelist', 3, 'normal', 0, [], null, undefined, deck);
    expect(unit.setup.pieces).toHaveLength(3);
    expect(unit.setup.pieces.map((p) => p.skillId)).toEqual(['sword_slash', 'fireball', 'mana_ward']);
    expect(unit.setup.pieces.map((p) => p.slot)).toEqual([0, 1, 4]);
    expect(unit.setup.pieces.map((p) => p.tier)).toEqual(['gold', 'silver', undefined]);
    // The resolver sockets the REAL Gem from the book — the config only ships the id.
    expect(unit.setup.pieces[0]!.gem).toBe(gemBook.swift_charm);
    expect(unit.setup.pieces[1]!.gem).toBeUndefined();
  });

  it('skips affix install, title filler and rank stamping entirely', () => {
    // An elite at rank 4 would normally add filler and stamp tiers; the deck
    // replaces all of it — the player-authored board IS the board.
    const unit = buildEnemyEncounter('bandit_duelist', 3, 'elite', 4, [], null, undefined, DECK);
    expect(unit.setup.pieces.map((p) => p.skillId)).toEqual(DECK.map((c) => c.skillId));
    expect(unit.setup.pieces.every((p) => p.tier === undefined)).toBe(true);
  });

  it('keeps the stat pipeline — LV / TITLE / MODIFIER dials mean what they mean today', () => {
    const dialed = buildEnemyEncounter('bandit_duelist', 7, 'elite', 4, ['swift'], null, undefined, DECK);
    const authored = buildEnemyEncounter('bandit_duelist', 7, 'elite', 4, ['swift'], null);
    expect(dialed.setup.stats).toEqual(authored.setup.stats);
    expect(dialed.level).toBe(authored.level);
    expect(dialed.effectiveLevel).toBe(authored.effectiveLevel);
    expect(dialed.title).toBe('elite');
    expect(dialed.modifiers).toEqual(['swift']);
  });

  it('echoes rank as the deck\'s real tier-steps above each card\'s authored tier', () => {
    const deck: FoeDeckCard[] = [
      { skillId: 'sword_slash', slot: 0, tier: 'gold' },   // +2
      { skillId: 'arcane_bolt', slot: 1, tier: 'silver' }, // +1
      { skillId: 'mana_ward', slot: 2 },                   // authored tier — +0
    ];
    const unit = buildEnemyEncounter('bandit_duelist', 1, 'normal', 6, [], null, undefined, deck);
    // The rankOverride dial (6) is IGNORED on the deck path — the echo is honest.
    expect(unit.rank).toBe(3);
  });

  it('forceTier modifiers still trump explicit deck tiers, echoed honestly', () => {
    const deck: FoeDeckCard[] = [
      { skillId: 'sword_slash', slot: 0, tier: 'silver' },
      { skillId: 'mana_ward', slot: 1 },
    ];
    const unit = buildEnemyEncounter('bandit_duelist', 3, 'normal', 0, ['diamond'], null, undefined, deck);
    expect(unit.setup.pieces.every((p) => p.tier === 'diamond')).toBe(true);
    expect(unit.rank).toBe(maxRankFor(2));
  });

  it('grows boardSize past the chassis for a wide custom deck', () => {
    const rat = enemies.giant_rat!;
    const wide: FoeDeckCard[] = Array.from({ length: 10 }, (_, i) => ({ skillId: 'sword_slash', slot: i }));
    const unit = buildEnemyEncounter('giant_rat', 1, 'normal', 0, [], null, undefined, wide);
    expect(rat.boardSize).toBeLessThan(10);
    expect(unit.setup.boardSize).toBe(10);
    expect(unit.setup.pieces).toHaveLength(10);
  });

  it('never mutates the caller\'s deck or the shared enemy data', () => {
    const deck: FoeDeckCard[] = [{ skillId: 'sword_slash', slot: 0, tier: 'silver' }];
    const before = JSON.stringify(deck);
    const authored = JSON.stringify(enemies.bandit_duelist!.pieces);
    buildEnemyEncounter('bandit_duelist', 1, 'normal', 0, ['diamond'], null, undefined, deck);
    expect(JSON.stringify(deck)).toBe(before);
    expect(JSON.stringify(enemies.bandit_duelist!.pieces)).toBe(authored);
  });

  it('FOE_DECK_SLOTS is HERO_BOARD_SLOTS\' twin (10)', () => {
    expect(FOE_DECK_SLOTS).toBe(HERO_BOARD_SLOTS);
    expect(FOE_DECK_SLOTS).toBe(10);
  });

  describe('validation throws (typos scream — the resolver\'s existing contract)', () => {
    it('unknown skill id', () => {
      expect(() => buildEnemyEncounter('bandit_duelist', 1, 'normal', 0, [], null, undefined, [
        { skillId: 'not_a_card', slot: 0 },
      ])).toThrow(/unknown skill id/);
    });

    it('unknown gem id', () => {
      expect(() => buildEnemyEncounter('bandit_duelist', 1, 'normal', 0, [], null, undefined, [
        { skillId: 'sword_slash', slot: 0, gemId: 'not_a_gem' },
      ])).toThrow(/unknown gem id/);
    });

    it('empty deck', () => {
      expect(() => buildEnemyEncounter('bandit_duelist', 1, 'normal', 0, [], null, undefined, []))
        .toThrow(/at least one card/);
    });

    it('overlapping slots — same slot and size-covered slot', () => {
      expect(() => buildEnemyEncounter('bandit_duelist', 1, 'normal', 0, [], null, undefined, [
        { skillId: 'sword_slash', slot: 0 },
        { skillId: 'mana_ward', slot: 0 },
      ])).toThrow(/overlap/);
      expect(() => buildEnemyEncounter('bandit_duelist', 1, 'normal', 0, [], null, undefined, [
        { skillId: 'fireball', slot: 0 }, // size 2 — covers slot 1
        { skillId: 'sword_slash', slot: 1 },
      ])).toThrow(/overlap/);
    });

    it('slot + size past the 10-slot cap, and negative slots', () => {
      expect(() => buildEnemyEncounter('bandit_duelist', 1, 'normal', 0, [], null, undefined, [
        { skillId: 'fireball', slot: 9 }, // size 2 -> 11
      ])).toThrow(/does not fit/);
      expect(() => buildEnemyEncounter('bandit_duelist', 1, 'normal', 0, [], null, undefined, [
        { skillId: 'sword_slash', slot: -1 },
      ])).toThrow(/does not fit/);
    });

    it('affix and deck are mutually exclusive', () => {
      expect(() => buildEnemyEncounter('bandit_duelist', 1, 'elite', 2, [], 'braced', undefined, DECK))
        .toThrow(/mutually exclusive/);
    });
  });

  it('deck-absent resolution is byte-identical to before (undefined and null alike)', () => {
    const bare = buildEnemyEncounter('bandit_duelist', 3, 'elite', 2, ['swift'], 'braced');
    const explicitUndefined = buildEnemyEncounter('bandit_duelist', 3, 'elite', 2, ['swift'], 'braced', undefined, undefined);
    const explicitNull = buildEnemyEncounter('bandit_duelist', 3, 'elite', 2, ['swift'], 'braced', undefined, null);
    expect(explicitUndefined).toEqual(bare);
    expect(explicitNull).toEqual(bare);
  });
});
