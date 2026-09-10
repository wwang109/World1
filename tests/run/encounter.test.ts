import { describe, expect, it } from 'vitest';
import {
  assignRankTiers,
  buildAutoHeroSetup,
  buildEnemyEncounter,
  resolveEncounterForEnemy,
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
import { HERO_BOARD_SLOTS } from '../../src/data/heroes';
import type { EnemyDef, EnemyGrowthMilestone } from '../../src/engine/types';

const fireGrowth = (...skillIds: string[]): EnemyGrowthMilestone => ({
  family: { kind: 'element', type: 'fire' }, purpose: 'reinforce-family',
  candidates: skillIds.map((skillId) => ({ skillId })),
});
const growthFixture = (growth: readonly EnemyGrowthMilestone[], pieces = [
  { skillId: 'cinder_dart', slot: 0 }, { skillId: 'scorching_brand', slot: 1 },
]): EnemyDef => ({ ...enemies.cinder_sprite!, id: 'growth_fixture', pieces, boardSize: 10, growth });

describe('ordered growth milestones', () => {
  it('takes the first valid candidate, preserving source order and data', () => {
    const enemy = growthFixture([fireGrowth('fireball', 'ember_lash')]);
    const before = JSON.stringify(enemy);
    const result = resolveEncounterForEnemy(enemy, 2);
    expect(result.setup.pieces.map((p) => [p.skillId, p.slot])).toEqual([
      ['cinder_dart', 0], ['scorching_brand', 1], ['fireball', 2],
    ]);
    expect(JSON.stringify(enemy)).toBe(before);
    expect(resolveEncounterForEnemy(enemy, 2)).toEqual(result);
  });

  it('selects a smaller fallback at the next contiguous free slot', () => {
    const enemy = growthFixture([fireGrowth('inferno_eruption', 'fireball', 'ember_lash')], [
      { skillId: 'cinder_dart', slot: 0 }, { skillId: 'scorching_brand', slot: 8 },
    ]);
    const unit = resolveEncounterForEnemy(enemy, 2);
    expect(unit.setup.pieces.map((p) => [p.skillId, p.slot])).toEqual([
      ['cinder_dart', 0], ['scorching_brand', 8], ['ember_lash', 9],
    ]);
    expect(unit.rank).toBe(0);
  });

  it.each([
    ['ordinary duplicate', 'cinder_dart'], ['wrong family', 'sword_slash'], ['unknown card', 'missing_card'],
  ])('rejects %s and tries the next candidate', (_case, rejected) => {
    const unit = resolveEncounterForEnemy(growthFixture([fireGrowth(rejected, 'ember_lash')]), 2);
    expect(unit.setup.pieces.map((p) => p.skillId)).toEqual(['cinder_dart', 'scorching_brand', 'ember_lash']);
  });

  it('allows an explicitly marked duplicate', () => {
    const milestone = { ...fireGrowth(), candidates: [{ skillId: 'cinder_dart', allowDuplicate: true as const }] };
    const unit = resolveEncounterForEnemy(growthFixture([milestone]), 2);
    expect(unit.setup.pieces.map((p) => p.skillId)).toEqual(['cinder_dart', 'scorching_brand', 'cinder_dart']);
  });

  it('completes a weapon affinity using its declared axis', () => {
    const unit = resolveEncounterForEnemy(growthFixture([{
      family: { kind: 'weapon', type: 'axe' }, purpose: 'complete-affinity',
      candidates: [{ skillId: 'stunning_smash' }],
    }], [{ skillId: 'armor_break', slot: 0 }, { skillId: 'hemorrhage', slot: 1 }]), 2);
    expect(unit.setup.pieces.map((p) => p.skillId)).toEqual(['armor_break', 'hemorrhage', 'stunning_smash']);
  });

  it.each([
    ['already active', ['cinder_dart', 'scorching_brand', 'fireball']],
    ['too few matching cards', ['cinder_dart']],
    ['tied production affinity', ['cinder_dart', 'scorching_brand', 'frost_shackle', 'frost_shackle', 'frost_shackle']],
  ])('rejects a false affinity completion: %s', (_case, ids) => {
    const milestone = { ...fireGrowth('ember_lash'), purpose: 'complete-affinity' as const };
    const enemy = growthFixture([milestone], ids.map((skillId, slot) => ({ skillId, slot })));
    expect(() => resolveEncounterForEnemy(enemy, 2)).toThrow(/does-not-complete-affinity/);
  });

  it('rejects reinforcement of a family absent from the board', () => {
    const enemy = growthFixture([fireGrowth('ember_lash')], [{ skillId: 'sword_slash', slot: 0 }]);
    expect(() => resolveEncounterForEnemy(enemy, 2)).toThrow(/family-not-present/);
  });

  it('throws structured diagnostics for every rejected candidate without granting a rank step', () => {
    const enemy = growthFixture([fireGrowth('missing_card', 'sword_slash', 'cinder_dart', 'inferno_eruption')], [
      { skillId: 'cinder_dart', slot: 0 }, { skillId: 'scorching_brand', slot: 8 },
    ]);
    expect(() => resolveEncounterForEnemy(enemy, 6)).toThrow(/growth_fixture/);
    try { resolveEncounterForEnemy(enemy, 6); } catch (error) {
      expect(error).toMatchObject({
        name: 'EnemyGrowthResolutionError', enemyId: 'growth_fixture', milestoneIndex: 0,
        growthLevel: 6, occupiedSlots: 2,
        rejections: [
          { skillId: 'missing_card', reason: 'unknown' },
          { skillId: 'sword_slash', reason: 'wrong-family' },
          { skillId: 'cinder_dart', reason: 'duplicate' },
          { skillId: 'inferno_eruption', reason: 'does-not-fit' },
        ],
      });
      expect(String(error)).toMatch(/milestone 0.*level 6.*occupied 2/);
    }
  });

  it('rejects an earned empty milestone', () => {
    expect(() => resolveEncounterForEnemy(growthFixture([fireGrowth()]), 2)).toThrow(/milestone 0/);
  });

  it.each([
    [1, 1, 2, 0], [1, 2, 3, 0], [1, 4, 3, 1], [1, 6, 3, 2],
    [2, 1, 2, 0], [2, 2, 3, 0], [2, 4, 4, 0], [2, 6, 4, 1],
  ])('%i milestones at level %i yield %i cards and rank %i', (count, level, cards, rank) => {
    const unit = resolveEncounterForEnemy(growthFixture([fireGrowth('ember_lash'), fireGrowth('fireball')].slice(0, count)), level);
    expect(unit.setup.pieces).toHaveLength(cards);
    expect(unit.rank).toBe(rank);
    expect(unit.setup.pieces.map((p) => p.tier ?? 'bronze')).toEqual(Array.from({ length: cards }, (_, i) => i < rank ? 'silver' : 'bronze'));
  });
});

describe('authored growth intent with transient title and affix cards', () => {
  const swordCompletion = (...skillIds: string[]): EnemyGrowthMilestone => ({
    family: { kind: 'weapon', type: 'sword' }, purpose: 'complete-affinity',
    candidates: skillIds.map((skillId) => ({ skillId })),
  });
  const swords = [{ skillId: 'twin_slash', slot: 0 }, { skillId: 'iron_riposte', slot: 1 }];

  it.each(['elite', 'boss'] as const)('keeps authored completion when %s filler already activates the family', (title) => {
    const enemy = growthFixture([swordCompletion('bastion_stance')], swords);
    const unit = resolveEncounterForEnemy(enemy, 2, title, 0, [], null, 100);
    expect(unit.setup.pieces.map((p) => [p.skillId, p.slot])).toEqual([
      ['twin_slash', 0], ['iron_riposte', 1], ['sword_slash', 2],
      ...(title === 'boss' ? [['venom_fang', 3]] : []),
      ['bastion_stance', title === 'boss' ? 4 : 3],
    ]);
    expect(resolveEncounterForEnemy(enemy, 2, title, 0, [], null, 100)).toEqual(unit);
  });

  it('keeps authored completion when the matching affix already activates the family', () => {
    const enemy = growthFixture([{
      family: { kind: 'weapon', type: 'lance' }, purpose: 'complete-affinity',
      candidates: [{ skillId: 'phalanx_thrust' }],
    }], [{ skillId: 'lance_thrust', slot: 0 }, { skillId: 'piercing_reach', slot: 1 }]);
    const unit = resolveEncounterForEnemy(enemy, 2, 'elite', 0, [], 'braced', 100);
    expect(unit.setup.pieces.map((p) => [p.skillId, p.slot])).toEqual([
      ['lance_thrust', 0], ['piercing_reach', 1], ['braced_pike', 2], ['phalanx_thrust', 3],
    ]);
  });

  it('rejects a filler duplicate and selects the next completion candidate', () => {
    const enemy = growthFixture([swordCompletion('sword_slash', 'bastion_stance')], swords);
    const unit = resolveEncounterForEnemy(enemy, 2, 'elite', 0, [], null, 100);
    expect(unit.setup.pieces.map((p) => p.skillId)).toEqual([
      'twin_slash', 'iron_riposte', 'sword_slash', 'bastion_stance',
    ]);
  });

  it('rejects an affix duplicate and selects the next completion candidate', () => {
    const enemy = growthFixture([{
      family: { kind: 'weapon', type: 'lance' }, purpose: 'complete-affinity',
      candidates: [{ skillId: 'braced_pike' }, { skillId: 'phalanx_thrust' }],
    }], [{ skillId: 'lance_thrust', slot: 0 }, { skillId: 'piercing_reach', slot: 1 }]);
    const unit = resolveEncounterForEnemy(enemy, 2, 'elite', 0, [], 'braced', 100);
    expect(unit.setup.pieces.map((p) => p.skillId)).toEqual([
      'lance_thrust', 'piercing_reach', 'braced_pike', 'phalanx_thrust',
    ]);
  });

  it('honors explicit duplicate permission for a title card', () => {
    const milestone = { ...swordCompletion(), candidates: [{ skillId: 'sword_slash', allowDuplicate: true as const }] };
    const unit = resolveEncounterForEnemy(growthFixture([milestone], swords), 2, 'elite', 0, [], null, 100);
    expect(unit.setup.pieces.map((p) => p.skillId)).toEqual([
      'twin_slash', 'iron_riposte', 'sword_slash', 'sword_slash',
    ]);
  });

  it('uses final-board capacity even when the authored completion would fit', () => {
    const enemy = growthFixture([swordCompletion('bastion_stance')], [
      { skillId: 'twin_slash', slot: 0 }, { skillId: 'iron_riposte', slot: 8 },
    ]);
    expect(resolveEncounterForEnemy(enemy, 2).setup.pieces.at(-1)?.slot).toBe(9);
    expect(() => resolveEncounterForEnemy(enemy, 2, 'elite', 0, [], null, 100)).toThrow(/does-not-fit/);
  });

  it.each([
    ['too few authored cards', ['twin_slash']],
    ['already active authored board', ['twin_slash', 'iron_riposte', 'void_pierce']],
    ['more than three authored cards', ['twin_slash', 'iron_riposte', 'void_pierce', 'follow_through']],
  ])('rejects false completion despite title context: %s', (_case, ids) => {
    const enemy = growthFixture([swordCompletion('bastion_stance')], ids.map((skillId, slot) => ({ skillId, slot })));
    expect(() => resolveEncounterForEnemy(enemy, 2, 'elite', 0, [], null, 100)).toThrow(/does-not-complete-affinity/);
  });

  it('includes earlier growth in later completion intent without including filler', () => {
    const enemy = growthFixture([
      { ...swordCompletion('iron_riposte'), purpose: 'reinforce-family' },
      swordCompletion('bastion_stance'),
    ], [{ skillId: 'twin_slash', slot: 0 }]);
    const unit = resolveEncounterForEnemy(enemy, 4, 'elite', 0, [], null, 100);
    expect(unit.setup.pieces.map((p) => [p.skillId, p.slot])).toEqual([
      ['twin_slash', 0], ['sword_slash', 1], ['iron_riposte', 2], ['bastion_stance', 3],
    ]);
    expect(unit.rank).toBe(0);
  });

  it('rejects a second completion after an earlier growth card activated the authored family', () => {
    const enemy = growthFixture([swordCompletion('bastion_stance'), swordCompletion('void_pierce')], swords);
    expect(() => resolveEncounterForEnemy(enemy, 4, 'elite', 0, [], null, 100))
      .toThrow(/milestone 1.*does-not-complete-affinity/);
  });

  it('rejects reinforcement when only an affix introduces that family', () => {
    const enemy = growthFixture([{
      family: { kind: 'weapon', type: 'lance' }, purpose: 'reinforce-family',
      candidates: [{ skillId: 'lance_thrust' }],
    }]);
    expect(() => resolveEncounterForEnemy(enemy, 2, 'elite', 0, [], 'braced', 100)).toThrow(/family-not-present/);
  });

  it('rejects reinforcement when only title filler introduces that family', () => {
    const enemy = growthFixture([{ ...swordCompletion('bastion_stance'), purpose: 'reinforce-family' }], [
      { skillId: 'armor_break', slot: 0 },
    ]);
    expect(() => resolveEncounterForEnemy(enemy, 2, 'elite', 0, [], null, 100)).toThrow(/family-not-present/);
  });
});

describe('enemy growth repair contracts', () => {
  it('keeps custom-deck and forced-tier echoes separate from base recipe rank', () => {
    const forced = buildEnemyEncounter('cinder_sprite', 4, 'normal', 1, ['diamond']);
    expect(forced.baseRank).toBe(1);
    expect(forced.rank).toBe(6);
    const custom = buildEnemyEncounter('cinder_sprite', 4, 'normal', 4, ['diamond'], null, undefined,
      [{ skillId: 'cinder_dart', slot: 0 }], 100);
    expect(custom.baseRank).toBe(0);
    expect(custom.rank).toBe(3);
    expect(custom.setup.pieces).toHaveLength(1);
    expect(custom.setup.stats).toEqual(scaleMonsterToLevel(enemies.cinder_sprite!, 4).stats);
  });

  it('retains the base rank in a distinguishing level-4 recipe round trip', () => {
    const prep = buildEnemyEncounter('cinder_sprite', 4, 'normal', 0);
    expect(prep.rank).toBe(2);
    expect(prep.setup.pieces.map((p) => p.tier)).toEqual(['silver', 'silver']);
    const wrong = buildEnemyEncounter(prep.enemyId, prep.level, prep.title, prep.rank);
    expect(wrong.rank).toBe(4);
    expect(wrong.setup.pieces.map((p) => p.tier)).toEqual(['gold', 'gold']);
    expect(prep.baseRank).toBe(0);
    expect(prep.growthLevel).toBe(4);
    const rebuilt = buildEnemyEncounter(prep.enemyId, prep.level, prep.title, prep.baseRank, prep.modifiers, prep.affix, undefined, null, prep.growthLevel);
    expect(rebuilt.setup).toEqual(prep.setup);
  });

  it('resolves every milestone after authored, affix and title occupancy, then caps later rank', () => {
    expect(skillBook.inferno_eruption!.size).toBe(3);
    expect(skillBook.cinder_dart!.size).toBe(1);
    expect(skillBook.braced_pike!.size).toBe(1);
    const enemy = { ...enemies.cinder_sprite!, boardSize: 3,
      pieces: [0, 1, 2].map((slot) => ({ skillId: 'cinder_dart', slot })),
      growth: [fireGrowth('inferno_eruption'), fireGrowth('forgeheart_bastion', 'fireball')],
    };
    const baseline = resolveEncounterForEnemy(enemy, 1, 'boss', 0, [], 'braced', 100);
    expect(baseline.setup.pieces).toHaveLength(5);
    const grown = resolveEncounterForEnemy(enemy, 6, 'boss', 0, [], 'braced', 100);
    expect(grown.setup.boardSize).toBeLessThanOrEqual(HERO_BOARD_SLOTS);
    expect(grown.setup.pieces.map((p) => [p.skillId, p.slot])).toEqual([
      ...baseline.setup.pieces.map((p) => [p.skillId, p.slot]), ['inferno_eruption', 5], ['fireball', 8],
    ]);
    expect(grown.setup.boardSize).toBe(10);
    expect(grown.rank).toBe(1);
    for (const piece of grown.setup.pieces) {
      expect(piece.slot).toBeGreaterThanOrEqual(0);
      expect(piece.slot + skillBook[piece.skillId]!.size).toBeLessThanOrEqual(HERO_BOARD_SLOTS);
    }
    const capped = resolveEncounterForEnemy(enemy, 100, 'boss', 0, [], 'braced', 100);
    expect(capped.rank).toBe(21);
    expect(capped.setup.pieces.map((p) => p.tier)).toEqual(Array(7).fill('diamond'));
    expect(capped.setup.stats).toEqual(scaleMonsterToLevel(enemy, 104, 1250).stats);
  });

  it('adds two ordered cards before the next cadence step raises rank', () => {
    const enemy = { ...enemies.cinder_sprite!, growth: [fireGrowth('cinder_dart'), fireGrowth('ember_lash')] };
    const second = resolveEncounterForEnemy(enemy, 4, 'normal', 0);
    expect(second.setup.pieces.map((p) => [p.skillId, p.slot])).toEqual([
      ...enemy.pieces.map((p) => [p.skillId, p.slot]), ['cinder_dart', 2], ['ember_lash', 3],
    ]);
    expect(second.rank).toBe(0);
    const next = resolveEncounterForEnemy(enemy, 6, 'normal', 0);
    expect(next.setup.pieces.map((p) => p.tier)).toEqual(['silver', 'bronze', 'bronze', 'bronze']);
    expect(next.rank).toBe(1);
    expect(next.setup.stats).toEqual(enemy.stats);
  });
});

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
    // Fixture facts: two tier increases cost 100 deci, taken from the stat budget.
    expect(unit.setup.stats).toEqual(scaleMonsterToLevel(knight, 5, 100).stats);
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
    // Fixture facts: giant_rat has no authored additions; one tier increase costs 50 deci.
    expect(unit.rank).toBe(1);
    expect(unit.setup.stats).toEqual(scaleMonsterToLevel(enemies.giant_rat!, 3, 50).stats);
    expect(unit.setup.pieces.length).toBe(enemies.giant_rat!.pieces.length);
    expect(unit.setup.pieces.some((piece) => piece.tier)).toBe(true);
  });

  it('applies the title level delta to the effective level, keeping requested level for display', () => {
    const elite = buildEnemyEncounter('giant_rat', 5, 'elite');
    expect(elite.level).toBe(5);
    expect(elite.effectiveLevel).toBe(5 + TITLE_PRESETS.elite.levelDelta);
    // GROWTH (2026-09-06) is keyed to the REQUESTED level (5, `buildEnemyEncounter`'s
    // `growthLevel` default), not the title-shifted effective level.
    expect(elite.setup.stats).toEqual(scaleMonsterToLevel(enemies.giant_rat!, elite.effectiveLevel, 100).stats);
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
    // Milestone boss #1: authored kit only, +1 effective level. GROWTH
    // (2026-09-06) still spends growthStepsAt(5) = 2 rank steps at this
    // requested level (giant_rat has no growth list) — "no tiers" is no
    // longer true on its own, so this checks the DERIVED rank instead.
    const rampedBoss = buildEnemyEncounter('giant_rat', 5, 'boss', undefined, [], null, 5);
    expect(rampedBoss.effectiveLevel).toBe(6);
    expect(rampedBoss.rank).toBe(2);
    expect(rampedBoss.setup.pieces).toHaveLength(base);
    // The SAME call without a fightNumber is the flat (pre-ramp) package.
    const flatBoss = buildEnemyEncounter('giant_rat', 5, 'boss');
    expect(flatBoss.effectiveLevel).toBe(5 + TITLE_PRESETS.boss.levelDelta);
    expect(flatBoss.rank).toBe(6);
    expect(flatBoss.setup.pieces).toHaveLength(base + TITLE_PRESETS.boss.extraCards);
    // Early elite: +1 card, +1 level, PLUS growth's own rank steps.
    const rampedElite = buildEnemyEncounter('giant_rat', 3, 'elite', undefined, [], null, 3);
    expect(rampedElite.effectiveLevel).toBe(4);
    expect(rampedElite.rank).toBe(1);
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
    // Level 1 (growthStepsAt(1) === 0) — GROWTH (2026-09-06) otherwise makes
    // `diamond` touch stats INDIRECTLY (a `forceTier` override makes growth's
    // own tier-up steps free — see `growthBoardDeltaDeci`'s doc comment — so
    // a level where growth actually spends a step prices `bare` and
    // `diamond` differently). This test is specifically about `diamond`'s
    // OWN, direct effect, so it stays at a level growth cannot touch.
    const bare = buildEnemyEncounter('bandit_duelist', 1, 'elite', 2);
    const diamond = buildEnemyEncounter('bandit_duelist', 1, 'elite', 2, ['diamond']);
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
    // Level 1 (growthStepsAt(1) === 0) — see 'diamond does not touch stats'
    // above for why this test stays off growth's own level dependence.
    const bare = buildEnemyEncounter('giant_rat', 1, 'normal', 0);
    const both = buildEnemyEncounter('giant_rat', 1, 'normal', 0, ['diamond', 'swift']);
    expect(both.setup.stats.speed).toBe(bare.setup.stats.speed + 4);
    for (const piece of both.setup.pieces) expect(piece.tier).toBe('diamond');
  });

  it('throws on an unknown modifier id', () => {
    expect(() => buildEnemyEncounter('bandit_duelist', 1, 'normal', 0, ['nope'])).toThrow(/unknown modifier/);
  });
});
