import { describe, expect, it } from 'vitest';
import {
  assignRankTiers,
  buildAutoHeroSetup,
  buildEnemyEncounter,
  defaultTitleFor,
  maxRankFor,
  MAX_TIER_STEPS,
  TITLE_PRESETS,
  TITLE_RAMP,
  TITLE_RAMP_FULL_FIGHT,
  titlePresetFor,
  type EnemyTitle,
} from '../../src/run/encounter';
import { enemies } from '../../src/data/enemies';
import { skillBook } from '../../src/data/skills';
import { applyTier } from '../../src/engine/cards';
import { powerLevelDeci, TIER_BUDGET_DECI } from '../../src/engine/balance';
import { BASE_HERO_STATS } from '../../src/data/heroes';
import {
  allocateMonsterPL,
  applyPlayerLevelAllocation,
  DEFAULT_PROFILE,
  profileFor,
  scaleMonsterToLevel,
  totalLevelPL,
} from '../../src/run/leveling';

describe('run/encounter: buildEnemyEncounter', () => {
  it('level 1 returns the floor stats and echoes back level 1', () => {
    const bandit = enemies.bandit_duelist!;
    const unit = buildEnemyEncounter('bandit_duelist', 1);
    expect(unit.setup.stats).toEqual(bandit.stats);
    expect(unit.level).toBe(1);
    expect(unit.enemyId).toBe('bandit_duelist');
  });

  it('level 5 matches scaleMonsterToLevel output', () => {
    const knight = enemies.knight!;
    const unit = buildEnemyEncounter('knight', 5);
    expect(unit.setup.stats).toEqual(scaleMonsterToLevel(knight, 5).stats);
    expect(unit.level).toBe(5);
  });

  it('clamps sub-1 levels to level 1', () => {
    const unit = buildEnemyEncounter('giant_rat', 0);
    expect(unit.level).toBe(1);
    expect(unit.setup.stats).toEqual(enemies.giant_rat!.stats);
  });

  it('throws on an unknown enemy id', () => {
    expect(() => buildEnemyEncounter('not_a_real_monster', 3)).toThrow();
  });

  it('defaults to the normal title — baseline level, rank 0, no extra cards, no tiers', () => {
    const unit = buildEnemyEncounter('giant_rat', 3);
    expect(unit.title).toBe('normal');
    expect(unit.effectiveLevel).toBe(3);
    expect(unit.rank).toBe(0);
    expect(unit.setup.stats).toEqual(scaleMonsterToLevel(enemies.giant_rat!, 3).stats);
    expect(unit.setup.pieces.length).toBe(enemies.giant_rat!.pieces.length);
    expect(unit.setup.pieces.every((piece) => !piece.tier)).toBe(true);
  });

  it('applies the title level delta to the effective level, keeping requested level for display', () => {
    const elite = buildEnemyEncounter('giant_rat', 5, 'elite');
    expect(elite.level).toBe(5);
    expect(elite.effectiveLevel).toBe(5 + TITLE_PRESETS.elite.levelDelta);
    expect(elite.setup.stats).toEqual(scaleMonsterToLevel(enemies.giant_rat!, elite.effectiveLevel).stats);
  });

  it('Mob applies its full -4 level delta WITHOUT flooring at 1 (feeds a negative PL spend)', () => {
    const mob = buildEnemyEncounter('giant_rat', 1, 'mob');
    expect(mob.effectiveLevel).toBe(1 + TITLE_PRESETS.mob.levelDelta);
    expect(mob.effectiveLevel).toBe(-3);
    expect(mob.setup.stats).toEqual(scaleMonsterToLevel(enemies.giant_rat!, -3).stats);
    // Still resolves to safe, playable stats (clamped floors — see leveling.ts).
    expect(mob.setup.stats.maxHp).toBeGreaterThanOrEqual(1);
    expect(mob.setup.stats.speed).toBeGreaterThanOrEqual(1);
  });

  it('a Mob is weaker than the same enemy at Normal, same requested level', () => {
    const normal = buildEnemyEncounter('knight', 10, 'normal');
    const mob = buildEnemyEncounter('knight', 10, 'mob');
    const totalStats = (s: typeof normal.setup.stats) =>
      s.maxHp + s.attack + s.magicPower + s.armor + s.magicResist + s.speed;
    expect(totalStats(mob.setup.stats)).toBeLessThan(totalStats(normal.setup.stats));
  });

  it('elite/boss titles add extra cards and rank tiers without mutating shared enemy data', () => {
    const baseLen = enemies.giant_rat!.pieces.length; // 2
    const before = JSON.stringify(enemies.giant_rat!.pieces);

    const boss = buildEnemyEncounter('giant_rat', 1, 'boss');
    // Boss adds 2 cards → 4-card deck, and applies its preset rank as tiers.
    expect(boss.setup.pieces.length).toBe(baseLen + TITLE_PRESETS.boss.extraCards);
    expect(boss.rank).toBe(TITLE_PRESETS.boss.rank);
    expect(boss.setup.pieces.some((p) => p.tier && p.tier !== 'bronze')).toBe(true);

    // Shared source data untouched (no extra cards, no stamped tiers).
    expect(JSON.stringify(enemies.giant_rat!.pieces)).toBe(before);
  });

  it('rankOverride replaces the title preset rank and is clamped to the deck ceiling', () => {
    const unit = buildEnemyEncounter('giant_rat', 1, 'normal', 99);
    // 2-card normal deck → ceiling = 2 × 3 = 6.
    expect(unit.rank).toBe(maxRankFor(unit.setup.pieces.length));
    expect(unit.rank).toBe(6);
    // Every card maxed to Diamond.
    expect(unit.setup.pieces.every((p) => p.tier === 'diamond')).toBe(true);
  });

  it('defaultTitleFor reads the authored encounter-role tags', () => {
    expect(defaultTitleFor(enemies.giant_rat!)).toBe('normal');
    expect(defaultTitleFor(enemies.bandit_duelist!)).toBe('elite');
  });
});

/**
 * TITLE DEPTH RAMP (2026-09-02) — the run ladder consumes elite/boss packages
 * through `titlePresetFor(title, fightNumber)`. Pinned because the flat
 * packages made the early curve INVERTED (measured, 40 run seeds x 3 fight
 * seeds per cell, real rollEncounter + real simulate, on-curve boards):
 * wave-5 boss #1 won 0% (bare kit at normal title: 47.5%), waves 3-4 elites
 * 10% — while the SAME packages at waves 13-15 measured 35-50%. The ramp is
 * an early-game fix ONLY: at TITLE_RAMP_FULL_FIGHT (10) and beyond it IS the
 * flat package, byte-for-byte.
 */
describe('run/encounter: titlePresetFor (the title depth ramp)', () => {
  const AXES = ['levelDelta', 'rank', 'extraCards'] as const;
  const ALL_TITLES: EnemyTitle[] = ['mob', 'normal', 'elite', 'boss'];

  it('fights >= TITLE_RAMP_FULL_FIGHT (and an omitted fightNumber) return the flat TITLE_PRESETS package, for every title', () => {
    for (const title of ALL_TITLES) {
      expect(titlePresetFor(title)).toEqual(TITLE_PRESETS[title]);
      for (let f = TITLE_RAMP_FULL_FIGHT; f <= 200; f += 1) {
        expect(titlePresetFor(title, f), `${title} @ fight ${f}`).toEqual(TITLE_PRESETS[title]);
      }
    }
  });

  it('the ramp NEVER exceeds the full package on any axis (this is an early-game fix, not a buff anywhere)', () => {
    for (const title of ['elite', 'boss'] as const) {
      for (let f = 1; f < TITLE_RAMP_FULL_FIGHT; f += 1) {
        const ramped = titlePresetFor(title, f);
        for (const axis of AXES) {
          expect(ramped[axis], `${title} @ fight ${f} ${axis}`).toBeLessThanOrEqual(TITLE_PRESETS[title][axis]);
        }
      }
    }
  });

  it('mob/normal never ramp — their presets are already the floor', () => {
    for (const title of ['mob', 'normal'] as const) {
      for (let f = 1; f <= 12; f += 1) {
        expect(titlePresetFor(title, f)).toEqual(TITLE_PRESETS[title]);
      }
    }
  });

  it('each ramp row covers exactly fights 1..TITLE_RAMP_FULL_FIGHT-1 (a short row would silently pay full packages early)', () => {
    expect(TITLE_RAMP.elite).toHaveLength(TITLE_RAMP_FULL_FIGHT - 1);
    expect(TITLE_RAMP.boss).toHaveLength(TITLE_RAMP_FULL_FIGHT - 1);
  });

  it('the ELITE row keeps extraCards >= 1 at every fight — the affix substitution needs a filler slot to consume wherever an elite can occur', () => {
    for (let f = 1; f <= TITLE_RAMP_FULL_FIGHT; f += 1) {
      expect(titlePresetFor('elite', f).extraCards, `fight ${f}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('the ELITE row is per-axis non-decreasing (one curve, no dips)', () => {
    for (let f = 2; f < TITLE_RAMP_FULL_FIGHT; f += 1) {
      const prev = titlePresetFor('elite', f - 1);
      const cur = titlePresetFor('elite', f);
      for (const axis of AXES) {
        expect(cur[axis], `elite fight ${f} ${axis}`).toBeGreaterThanOrEqual(prev[axis]);
      }
    }
  });

  // The boss row is deliberately NOT one curve: fights 3-4/8-9 are the
  // hard-option rung (an elite pushed up — it keeps the elite's filler card),
  // fight 5 is the MILESTONE boss, which fields its authored signature triad
  // un-padded. Measured (probe, 120 fights/cell): milestone {1,0,0} = 37.5%
  // win (was 0% at the flat {4,4,2}); {1,1,1} at the same node measured 7.5%
  // and {1,1,0} 30% — the extra CARD is the heaviest axis on a boss kit early.
  it("boss #1 (fight 5) is the milestone package {+1 level, rank 0, no extra cards} — measured 37.5% for the on-curve board, was 0% flat", () => {
    expect(titlePresetFor('boss', 5)).toEqual({ levelDelta: 1, rank: 0, extraCards: 0 });
  });

  it('the hard-rung boss cells dominate the elite cells they are bumped from (fights 1-4, 8-9)', () => {
    for (const f of [1, 2, 3, 4, 8, 9]) {
      const elite = titlePresetFor('elite', f);
      const boss = titlePresetFor('boss', f);
      for (const axis of AXES) {
        expect(boss[axis], `fight ${f} ${axis}`).toBeGreaterThanOrEqual(elite[axis]);
      }
    }
  });

  it('buildEnemyEncounter consumes the ramp when given a fightNumber, and the flat package when not', () => {
    const base = enemies.giant_rat!.pieces.length; // 2
    // Milestone boss #1: authored kit only, no tiers, +1 effective level.
    const rampedBoss = buildEnemyEncounter('giant_rat', 5, 'boss', undefined, [], null, 5);
    expect(rampedBoss.effectiveLevel).toBe(6);
    expect(rampedBoss.rank).toBe(0);
    expect(rampedBoss.setup.pieces).toHaveLength(base);
    expect(rampedBoss.setup.pieces.every((p) => !p.tier)).toBe(true);
    // The SAME call without a fightNumber is the flat (pre-ramp) package.
    const flatBoss = buildEnemyEncounter('giant_rat', 5, 'boss');
    expect(flatBoss.effectiveLevel).toBe(5 + TITLE_PRESETS.boss.levelDelta);
    expect(flatBoss.rank).toBe(TITLE_PRESETS.boss.rank);
    expect(flatBoss.setup.pieces).toHaveLength(base + TITLE_PRESETS.boss.extraCards);
    // Early elite: +1 card, +1 level, rank 0.
    const rampedElite = buildEnemyEncounter('giant_rat', 3, 'elite', undefined, [], null, 3);
    expect(rampedElite.effectiveLevel).toBe(4);
    expect(rampedElite.rank).toBe(0);
    expect(rampedElite.setup.pieces).toHaveLength(base + 1);
    // Deep fight: ramp = flat, byte-identical setups.
    const deepRamped = buildEnemyEncounter('giant_rat', 30, 'boss', undefined, [], null, 30);
    const deepFlat = buildEnemyEncounter('giant_rat', 30, 'boss');
    expect(JSON.stringify(deepRamped.setup)).toBe(JSON.stringify(deepFlat.setup));
    expect(deepRamped.rank).toBe(deepFlat.rank);
    expect(deepRamped.effectiveLevel).toBe(deepFlat.effectiveLevel);
  });
});

describe('run/encounter: assignRankTiers (round-robin tier-steps)', () => {
  const deck = [
    { skillId: 'sword_slash', slot: 0 },
    { skillId: 'follow_through', slot: 1 },
  ];

  it('rank 3 on a 2-card deck yields one Gold + one Silver card (user spec)', () => {
    const tiered = assignRankTiers(deck, 3);
    const bySlot = [...tiered].sort((a, b) => a.slot - b.slot);
    expect(bySlot[0]!.tier).toBe('gold'); // first card: 2 steps
    expect(bySlot[1]!.tier).toBe('silver'); // second card: 1 step
  });

  it('rank 0 leaves every card bronze/untiered and clones the input', () => {
    const tiered = assignRankTiers(deck, 0);
    expect(tiered.every((p) => !p.tier)).toBe(true);
    expect(tiered).not.toBe(deck);
  });

  it('clamps to the deck ceiling (deckSize × 3 = Diamond each)', () => {
    const tiered = assignRankTiers(deck, 999);
    expect(tiered.every((p) => p.tier === 'diamond')).toBe(true);
    expect(maxRankFor(deck.length)).toBe(deck.length * MAX_TIER_STEPS);
  });
});

describe('engine/cards: applyTier PL matching', () => {
  it('a Bronze card tier-upped lands on the target tier PL budget', () => {
    const sword = skillBook.sword_slash!; // pure damage, Bronze = 100 deci
    expect(powerLevelDeci(sword)).toBe(TIER_BUDGET_DECI.bronze);
    expect(powerLevelDeci(applyTier(sword, 'silver'))).toBe(TIER_BUDGET_DECI.silver);
    expect(powerLevelDeci(applyTier(sword, 'gold'))).toBe(TIER_BUDGET_DECI.gold);
    expect(powerLevelDeci(applyTier(sword, 'diamond'))).toBe(TIER_BUDGET_DECI.diamond);
  });

  it('a target at or below the base tier is a no-op (same reference)', () => {
    const sword = skillBook.sword_slash!;
    expect(applyTier(sword, 'bronze')).toBe(sword);
  });
});

describe('run/encounter: buildAutoHeroSetup', () => {
  it('auto-spends the level PL via the default profile (no allocation given)', () => {
    const level = 4;
    const pieces = [{ skillId: 'sword_slash', slot: 0 }];
    const { setup, level: resolved } = buildAutoHeroSetup(level, pieces);
    const alloc = allocateMonsterPL(totalLevelPL(level), DEFAULT_PROFILE);
    expect(setup.stats).toEqual(applyPlayerLevelAllocation(BASE_HERO_STATS, level, alloc));
    expect(resolved).toBe(4);
    expect(setup.pieces).toBe(pieces);
  });

  it('level 1 returns the base hero stats (no PL spent)', () => {
    const { setup } = buildAutoHeroSetup(1, []);
    expect(setup.stats).toEqual(BASE_HERO_STATS);
  });

  it('an explicit playerLevelAllocation is applied via the PL-budget economy', () => {
    const level = 4; // totalLevelPL = 9
    const pieces = [{ skillId: 'sword_slash', slot: 0 }];
    const { setup } = buildAutoHeroSetup(level, pieces, { attack: 2, armor: 1 });
    expect(setup.stats).toEqual(applyPlayerLevelAllocation(BASE_HERO_STATS, level, { attack: 2, armor: 1 }));
  });

  it('throws on an over-spend playerLevelAllocation', () => {
    expect(() => buildAutoHeroSetup(2, [], { attack: 100 })).toThrow();
  });

  it('clamps sub-1 levels to level 1', () => {
    const { level } = buildAutoHeroSetup(0, []);
    expect(level).toBe(1);
  });
});

describe('run/encounter: enemy modifiers', () => {
  it('no modifiers (or []) resolves byte-identical to the pre-modifier behavior', () => {
    const bare = buildEnemyEncounter('bandit_duelist', 3, 'elite', 2);
    const empty = buildEnemyEncounter('bandit_duelist', 3, 'elite', 2, []);
    expect(JSON.stringify(empty.setup)).toBe(JSON.stringify(bare.setup));
    expect(empty.modifiers).toEqual([]);
  });

  it('diamond forces every card to diamond tier and reports rank at the ceiling', () => {
    const unit = buildEnemyEncounter('bandit_duelist', 3, 'elite', 2, ['diamond']);
    expect(unit.setup.pieces.length).toBeGreaterThan(0);
    for (const piece of unit.setup.pieces) expect(piece.tier).toBe('diamond');
    expect(unit.rank).toBe(maxRankFor(unit.setup.pieces.length));
    expect(unit.modifiers).toEqual(['diamond']);
  });

  it('diamond does not touch stats', () => {
    const bare = buildEnemyEncounter('bandit_duelist', 3, 'elite', 2);
    const diamond = buildEnemyEncounter('bandit_duelist', 3, 'elite', 2, ['diamond']);
    expect(diamond.setup.stats).toEqual(bare.setup.stats);
  });

  it('swift adds exactly its bonus PL of speed (8 PL / 2 per buy = +4 SPD) and nothing else', () => {
    const bare = buildEnemyEncounter('bandit_duelist', 3, 'elite', 2);
    const swift = buildEnemyEncounter('bandit_duelist', 3, 'elite', 2, ['swift']);
    expect(swift.setup.stats.speed).toBe(bare.setup.stats.speed + 4);
    expect(swift.setup.stats.maxHp).toBe(bare.setup.stats.maxHp);
    expect(swift.setup.stats.attack).toBe(bare.setup.stats.attack);
    expect(swift.setup.stats.magicPower).toBe(bare.setup.stats.magicPower);
    expect(swift.setup.stats.armor).toBe(bare.setup.stats.armor);
    expect(swift.setup.stats.magicResist).toBe(bare.setup.stats.magicResist);
    // tiers untouched by a pure stat modifier
    expect(swift.setup.pieces.map((p) => p.tier)).toEqual(bare.setup.pieces.map((p) => p.tier));
  });

  it('modifiers stack (diamond + swift)', () => {
    const bare = buildEnemyEncounter('giant_rat', 2, 'normal', 0);
    const both = buildEnemyEncounter('giant_rat', 2, 'normal', 0, ['diamond', 'swift']);
    expect(both.setup.stats.speed).toBe(bare.setup.stats.speed + 4);
    for (const piece of both.setup.pieces) expect(piece.tier).toBe('diamond');
  });

  it('throws on an unknown modifier id', () => {
    expect(() => buildEnemyEncounter('bandit_duelist', 1, 'normal', 0, ['nope'])).toThrow(/unknown modifier/);
  });
});
