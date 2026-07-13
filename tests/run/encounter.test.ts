import { describe, expect, it } from 'vitest';
import { buildEnemyEncounter, buildHeroSetup } from '../../src/run/encounter';
import { enemies } from '../../src/data/enemies';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../../src/data/heroes';
import { allocateByProfile, applyAllocation, availablePoints, pointsForLevel, profileFor } from '../../src/run/leveling';

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
    const points = pointsForLevel(5);
    const alloc = allocateByProfile(points, profileFor('knight'));
    const expectedStats = applyAllocation(knight.stats, alloc);
    expect(unit.setup.stats).toEqual(expectedStats);
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
});

describe('run/encounter: buildHeroSetup', () => {
  it('applies the allocation on top of BASE_HERO_STATS and echoes the level', () => {
    const level = 3;
    const available = availablePoints(level); // 10
    const alloc = { attack: 2, armor: 1 };
    const build = { level, allocation: alloc, pieces: [{ skillId: 'sword_slash', slot: 0 }] };
    const { setup, level: resolvedLevel } = buildHeroSetup(build);

    const expectedStats = applyAllocation(BASE_HERO_STATS, alloc);
    expect(setup.stats).toEqual(expectedStats);
    expect(setup.boardSize).toBe(HERO_BOARD_SLOTS);
    expect(setup.pieces).toBe(build.pieces);
    expect(resolvedLevel).toBe(3);
    expect(available).toBe(10);
  });

  it('throws on an over-spend allocation', () => {
    const build = { level: 2, allocation: { attack: 100 }, pieces: [] };
    expect(() => buildHeroSetup(build)).toThrow();
  });

  it('clamps sub-1 levels to level 1', () => {
    const build = { level: 0, allocation: {}, pieces: [] };
    const { level } = buildHeroSetup(build);
    expect(level).toBe(1);
  });
});
