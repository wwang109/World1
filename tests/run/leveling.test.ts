import { describe, expect, it } from 'vitest';
import {
  allocateByProfile,
  applyAllocation,
  applyPlayerAllocation,
  availablePoints,
  DEFAULT_PROFILE,
  MONSTER_PROFILES,
  POINTS_PER_LEVEL,
  pointsForLevel,
  profileFor,
  scaleMonsterToLevel,
  STAT_INCREMENT,
  type LevelStat,
} from '../../src/run/leveling';
import { enemies } from '../../src/data/enemies';
import type { CombatantStats } from '../../src/engine/types';

const STATS: LevelStat[] = ['maxHp', 'attack', 'magicPower', 'armor', 'magicResist', 'speed', 'critPct'];

function totalStats(stats: CombatantStats): number {
  return STATS.reduce((sum, stat) => sum + (stat === 'maxHp' ? stats.maxHp : (stats as any)[stat]), 0);
}

describe('run/leveling: points curve', () => {
  it('level 1 has 0 points (floor)', () => {
    expect(pointsForLevel(1)).toBe(0);
  });

  it('grants POINTS_PER_LEVEL per level above 1', () => {
    expect(pointsForLevel(2)).toBe(POINTS_PER_LEVEL);
    expect(pointsForLevel(5)).toBe(4 * POINTS_PER_LEVEL);
  });

  it('never goes negative for level 0', () => {
    expect(pointsForLevel(0)).toBe(0);
  });
});

describe('run/leveling: applyAllocation', () => {
  const base: CombatantStats = { maxHp: 100, hp: 100, attack: 10, magicPower: 0, armor: 2, magicResist: 2, speed: 10, critPct: 5 };

  it('adds points * increment per stat, and raises hp with maxHp', () => {
    const result = applyAllocation(base, { maxHp: 3, attack: 2, armor: 1 });
    expect(result.maxHp).toBe(100 + 3 * STAT_INCREMENT.maxHp);
    expect(result.hp).toBe(100 + 3 * STAT_INCREMENT.maxHp);
    expect(result.attack).toBe(10 + 2 * STAT_INCREMENT.attack);
    expect(result.armor).toBe(2 + 1 * STAT_INCREMENT.armor);
    // untouched stats unchanged
    expect(result.magicPower).toBe(0);
    expect(result.speed).toBe(10);
  });

  it('does not mutate the base object', () => {
    const clone = { ...base };
    applyAllocation(base, { attack: 5 });
    expect(base).toEqual(clone);
  });

  it('zero allocation returns equivalent stats', () => {
    expect(applyAllocation(base, {})).toEqual(base);
  });
});

describe('run/leveling: allocateByProfile', () => {
  it('sums to exactly the input points', () => {
    for (const points of [0, 1, 3, 5, 7, 13, 37, 100]) {
      for (const id of Object.keys(MONSTER_PROFILES)) {
        const alloc = allocateByProfile(points, profileFor(id));
        const sum = Object.values(alloc).reduce((a, b) => a + (b ?? 0), 0);
        expect(sum).toBe(points);
      }
    }
  });

  it('is deterministic (same inputs -> same outputs)', () => {
    const a = allocateByProfile(37, profileFor('knight'));
    const b = allocateByProfile(37, profileFor('knight'));
    expect(a).toEqual(b);
  });

  it('reflects identity: Knight gains more armor/HP than magicPower', () => {
    const alloc = allocateByProfile(100, profileFor('knight'));
    expect((alloc.maxHp ?? 0) + (alloc.armor ?? 0)).toBeGreaterThan(alloc.magicPower ?? 0);
    expect(alloc.magicPower ?? 0).toBe(0);
  });

  it('zero points allocates nothing', () => {
    expect(allocateByProfile(0, profileFor('mage'))).toEqual({});
  });

  it('falls back to DEFAULT_PROFILE for unknown ids', () => {
    expect(profileFor('some_future_monster')).toEqual(DEFAULT_PROFILE);
  });

  it('never allocates to a stat weighted zero in the profile', () => {
    const alloc = allocateByProfile(11, profileFor('mage')); // mage has no armor weight
    expect(alloc.armor ?? 0).toBe(0);
  });
});

describe('run/leveling: scaleMonsterToLevel', () => {
  it('level 1 returns the floor stats unchanged', () => {
    const knight = enemies.knight!;
    const setup = scaleMonsterToLevel(knight, 1);
    expect(setup.stats).toEqual(knight.stats);
    expect(setup.boardSize).toBe(knight.boardSize);
    expect(setup.pieces).toBe(knight.pieces);
  });

  it('conserves total stat points added at level N', () => {
    for (const id of Object.keys(enemies)) {
      const enemy = enemies[id]!;
      for (const level of [2, 3, 6]) {
        const setup = scaleMonsterToLevel(enemy, level);
        const points = pointsForLevel(level);
        const alloc = allocateByProfile(points, profileFor(id));
        const expectedAdded = STATS.reduce((sum, stat) => sum + (alloc[stat] ?? 0) * STAT_INCREMENT[stat], 0);
        const actualAdded = totalStats(setup.stats) - totalStats(enemy.stats) - (alloc.maxHp ?? 0) * STAT_INCREMENT.maxHp;
        // hp is counted alongside maxHp in totalStats via maxHp key only (hp not in STATS), so
        // actualAdded already excludes the extra hp bump; just compare directly.
        expect(totalStats(setup.stats) - totalStats(enemy.stats)).toBe(expectedAdded);
      }
    }
  });

  it('carries over board/affinities unchanged', () => {
    const wolf = enemies.wolf_king!;
    const setup = scaleMonsterToLevel(wolf, 4);
    expect(setup.pieces).toBe(wolf.pieces);
    expect(setup.weaponAffinity).toBe(wolf.weaponAffinity);
    expect(setup.elementAffinity).toBe(wolf.elementAffinity);
    expect(setup.boardSize).toBe(wolf.boardSize);
  });

  it('sample: Knight at level 5', () => {
    const knight = enemies.knight!;
    const setup = scaleMonsterToLevel(knight, 5);
    const points = pointsForLevel(5); // 20
    expect(points).toBe(20);
    const alloc = allocateByProfile(points, profileFor('knight'));
    const expected = applyAllocation(knight.stats, alloc);
    expect(setup.stats).toEqual(expected);
  });
});

describe('run/leveling: player helpers', () => {
  const base: CombatantStats = { maxHp: 150, hp: 150, attack: 12, magicPower: 12, armor: 2, magicResist: 2, speed: 12, critPct: 10 };

  it('availablePoints matches the shared curve', () => {
    expect(availablePoints(1)).toBe(0);
    expect(availablePoints(4)).toBe(3 * POINTS_PER_LEVEL);
  });

  it('accepts an allocation within budget', () => {
    const available = availablePoints(4); // 15
    const result = applyPlayerAllocation(base, { attack: 5, armor: 10 }, available);
    expect(result.attack).toBe(base.attack + 5 * STAT_INCREMENT.attack);
    expect(result.armor).toBe(base.armor + 10 * STAT_INCREMENT.armor);
  });

  it('rejects an over-spend allocation', () => {
    const available = availablePoints(2); // 5
    expect(() => applyPlayerAllocation(base, { attack: 6 }, available)).toThrow();
  });
});
