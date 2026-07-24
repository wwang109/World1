import { describe, expect, it } from 'vitest';
import {
  allocateMonsterPL,
  applyLevelAllocation,
  applyPlayerLevelAllocation,
  bankedPL,
  canAfford,
  DEFAULT_PROFILE,
  LEVEL_STAT_COST,
  MONSTER_PROFILES,
  monsterLevelPL,
  PL_PER_LEVEL,
  profileFor,
  scaleMonsterToLevel,
  spentPL,
  totalLevelPL,
  type Allocation,
  type LevelStat,
} from '../../src/run/leveling';
import { enemies } from '../../src/data/enemies';
import type { CombatantStats } from '../../src/engine/types';

const STATS: LevelStat[] = ['maxHp', 'attack', 'magicPower', 'armor', 'magicResist', 'speed'];

describe('run/leveling: monster PL spend (allocateMonsterPL)', () => {
  it('spends no more PL than the budget, across every roster profile', () => {
    for (const totalPL of [0, 3, 6, 9, 21, 39, 111]) {
      for (const id of Object.keys(MONSTER_PROFILES)) {
        const alloc = allocateMonsterPL(totalPL, profileFor(id));
        expect(spentPL(alloc)).toBeLessThanOrEqual(totalPL);
      }
    }
  });

  it('is deterministic (same inputs -> same outputs)', () => {
    const a = allocateMonsterPL(37, profileFor('knight'));
    const b = allocateMonsterPL(37, profileFor('knight'));
    expect(a).toEqual(b);
  });

  it('reflects identity: Knight buys more maxHp/armor than magicPower (weight 0 -> untouched)', () => {
    const alloc = allocateMonsterPL(100, profileFor('knight'));
    expect((alloc.maxHp ?? 0) + (alloc.armor ?? 0)).toBeGreaterThan(0);
    expect(alloc.magicPower ?? 0).toBe(0);
  });

  it('zero PL allocates nothing', () => {
    expect(allocateMonsterPL(0, profileFor('mage'))).toEqual({});
  });

  it('falls back to DEFAULT_PROFILE for unknown ids', () => {
    expect(profileFor('some_future_monster')).toEqual(DEFAULT_PROFILE);
  });

  it('never allocates to a stat weighted zero in the profile', () => {
    const alloc = allocateMonsterPL(11, profileFor('mage')); // mage has no armor weight
    expect(alloc.armor ?? 0).toBe(0);
  });

  it('a NEGATIVE budget (Title demotion) produces negative buy counts, still weight-shaped', () => {
    const alloc = allocateMonsterPL(-12, profileFor('mage')); // mage: magicPower only
    expect(alloc.magicPower ?? 0).toBeLessThan(0);
    expect(alloc.attack ?? 0).toBe(0);
    // Magnitude spent never exceeds the requested magnitude.
    expect(Math.abs(spentPL(alloc))).toBeLessThanOrEqual(12);
  });

  it('a negative budget splits proportionally across a multi-stat profile too', () => {
    const alloc = allocateMonsterPL(-12, profileFor('knight')); // maxHp:3 armor:3 attack:1
    expect(alloc.maxHp ?? 0).toBeLessThan(0);
    expect(alloc.armor ?? 0).toBeLessThan(0);
    expect(spentPL(alloc)).toBeGreaterThanOrEqual(-12);
  });
});

describe('run/leveling: scaleMonsterToLevel', () => {
  it('level 1 returns the floor stats unchanged (0 PL spent)', () => {
    const knight = enemies.knight!;
    const setup = scaleMonsterToLevel(knight, 1);
    expect(setup.stats).toEqual(knight.stats);
    expect(setup.boardSize).toBe(knight.boardSize);
    expect(setup.pieces).toBe(knight.pieces);
  });

  it('matches allocateMonsterPL + applyLevelAllocation directly, for every roster id', () => {
    for (const id of Object.keys(enemies)) {
      const enemy = enemies[id]!;
      for (const level of [2, 3, 6]) {
        const setup = scaleMonsterToLevel(enemy, level);
        const alloc = allocateMonsterPL(monsterLevelPL(level), profileFor(id));
        const expected = applyLevelAllocation(enemy.stats, alloc);
        expect(setup.stats).toEqual(expected);
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
    const pl = monsterLevelPL(5);
    expect(pl).toBe(12);
    const alloc = allocateMonsterPL(pl, profileFor('knight'));
    const expected = applyLevelAllocation(knight.stats, alloc);
    expect(setup.stats).toEqual(expected);
  });

  it('a HIGHER level never lowers a stat (monotonic growth, positive spend)', () => {
    for (const id of Object.keys(enemies)) {
      const enemy = enemies[id]!;
      const low = scaleMonsterToLevel(enemy, 3);
      const high = scaleMonsterToLevel(enemy, 10);
      for (const stat of STATS) {
        expect((high.stats as any)[stat]).toBeGreaterThanOrEqual((low.stats as any)[stat]);
      }
    }
  });

  it('NEGATIVE effective levels (Mob demotion) still resolve to safe, positive stats', () => {
    // Mob at level 1: effectiveLevel = 1 + (-4) = -3 -> monsterLevelPL(-3) = -12 PL.
    for (const id of Object.keys(enemies)) {
      const enemy = enemies[id]!;
      const setup = scaleMonsterToLevel(enemy, -3);
      expect(setup.stats.maxHp).toBeGreaterThanOrEqual(1);
      expect(setup.stats.hp).toBe(setup.stats.maxHp);
      expect(setup.stats.speed).toBeGreaterThanOrEqual(1);
      expect(setup.stats.attack).toBeGreaterThanOrEqual(0);
      expect(setup.stats.magicPower).toBeGreaterThanOrEqual(0);
      expect(setup.stats.armor).toBeGreaterThanOrEqual(0);
      expect(setup.stats.magicResist).toBeGreaterThanOrEqual(0);
    }
  });

  it('a Mob-demoted monster is not stronger than its Normal self at the same base level', () => {
    const enemy = enemies.knight!;
    const normal = scaleMonsterToLevel(enemy, 10);
    const mob = scaleMonsterToLevel(enemy, 10 - 4);
    const totalNormal = STATS.reduce((sum, s) => sum + (normal.stats as any)[s], 0);
    const totalMob = STATS.reduce((sum, s) => sum + (mob.stats as any)[s], 0);
    expect(totalMob).toBeLessThan(totalNormal);
  });
});

describe('run/leveling: monsterLevelPL (unclamped, signed)', () => {
  it('matches totalLevelPL for level >= 1', () => {
    for (const level of [1, 2, 5, 20]) {
      expect(monsterLevelPL(level)).toBe(totalLevelPL(level));
    }
  });

  it('goes NEGATIVE below level 1 (unlike the player-side totalLevelPL, which floors at 0)', () => {
    expect(monsterLevelPL(0)).toBe(-PL_PER_LEVEL);
    expect(monsterLevelPL(-3)).toBe(-4 * PL_PER_LEVEL);
    expect(totalLevelPL(-3)).toBe(0); // player-side stays floored — untouched by this feature
  });
});

describe('run/leveling: player PL-budget economy (locked)', () => {
  const base: CombatantStats = { maxHp: 150, hp: 150, attack: 17, magicPower: 17, armor: 2, magicResist: 2, speed: 12 };

  // USER-LOCKED 2026-07-23 — no drift. Changing these is a deliberate design
  // decision, not a refactor.
  it('LEVELING LOCK: cost table + PL/level are user-locked (change = deliberate edit)', () => {
    expect(PL_PER_LEVEL).toBe(3);
    expect(LEVEL_STAT_COST).toEqual({
      attack: { pl: 1, gain: 1 },
      magicPower: { pl: 1, gain: 1 },
      armor: { pl: 1, gain: 1 },
      magicResist: { pl: 1, gain: 1 },
      speed: { pl: 2, gain: 1 },
      maxHp: { pl: 1, gain: 5 },
    });
  });

  it('totalLevelPL: level 1 has 0 PL; grants PL_PER_LEVEL per level above 1', () => {
    expect(totalLevelPL(1)).toBe(0);
    expect(totalLevelPL(0)).toBe(0);
    expect(totalLevelPL(2)).toBe(3);
    expect(totalLevelPL(5)).toBe(12);
  });

  it('spentPL sums buys * pl cost per stat, including speed costing 2', () => {
    const alloc: Allocation = { attack: 2, speed: 1, maxHp: 1 };
    // attack: 2*1 + speed: 1*2 + maxHp: 1*1 = 5
    expect(spentPL(alloc)).toBe(5);
  });

  it('bankedPL reflects partial/saved spend and can carry unspent PL', () => {
    const level = 3; // totalLevelPL = 6
    expect(bankedPL(level, {})).toBe(6);
    expect(bankedPL(level, { attack: 2 })).toBe(4);
    expect(bankedPL(level, { speed: 3 })).toBe(0);
    expect(canAfford(level, { speed: 3 })).toBe(true);
    expect(canAfford(level, { speed: 4 })).toBe(false);
  });

  it('applyLevelAllocation adds gain per buy, maxHp buys give +5 and mirror into hp', () => {
    const result = applyLevelAllocation(base, { maxHp: 2, attack: 3, speed: 1 });
    expect(result.maxHp).toBe(base.maxHp + 2 * 5);
    expect(result.hp).toBe(base.hp + 2 * 5);
    expect(result.attack).toBe(base.attack + 3 * 1);
    expect(result.speed).toBe(base.speed + 1 * 1);
    // untouched stats unchanged
    expect(result.magicPower).toBe(base.magicPower);
    expect(result.armor).toBe(base.armor);
  });

  it('a fully-banked (zero-spend) allocation leaves base stats unchanged', () => {
    expect(applyLevelAllocation(base, {})).toEqual(base);
  });

  it('does not mutate the base object', () => {
    const clone = { ...base };
    applyLevelAllocation(base, { attack: 5 });
    expect(base).toEqual(clone);
  });

  it('applyPlayerLevelAllocation accepts a within-budget allocation', () => {
    const level = 4; // totalLevelPL = 9
    const result = applyPlayerLevelAllocation(base, level, { attack: 2, armor: 1, maxHp: 1 });
    expect(result.attack).toBe(base.attack + 2);
    expect(result.armor).toBe(base.armor + 1);
    expect(result.maxHp).toBe(base.maxHp + 5);
    expect(result.hp).toBe(base.hp + 5);
  });

  it('applyPlayerLevelAllocation rejects an over-spend allocation', () => {
    const level = 2; // totalLevelPL = 3
    expect(() => applyPlayerLevelAllocation(base, level, { speed: 2 })).toThrow(); // costs 4 PL, only 3 banked
  });
});
