import { describe, expect, it } from 'vitest';
import { cardContributions, damagePerTurn } from '../../src/run/analysis';
import { buildAutoHeroSetup, buildEnemyEncounter } from '../../src/run/encounter';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import type { BoardPiece, CombatantSetup } from '../../src/engine/types';

function heroWith(pieces: BoardPiece[], level = 1): CombatantSetup {
  return buildAutoHeroSetup(level, pieces).setup;
}

describe('run/analysis: damagePerTurn', () => {
  it('is deterministic — same input gives the same band', () => {
    const setup = heroWith([{ skillId: 'sword_slash', slot: 0 }]);
    expect(damagePerTurn(setup, skillBook)).toEqual(damagePerTurn(setup, skillBook));
  });

  it('a damage build reports a positive band with min ≤ avg ≤ max', () => {
    const setup = heroWith([{ skillId: 'sword_slash', slot: 0 }], 5);
    const band = damagePerTurn(setup, skillBook);
    expect(band.avg).toBeGreaterThan(0);
    expect(band.min).toBeLessThanOrEqual(band.avg);
    expect(band.avg).toBeLessThanOrEqual(band.max);
    expect(band.turns).toBe(10);
  });

  it('a purely defensive/heal build dishes out 0 damage per turn', () => {
    const setup = heroWith([
      { skillId: 'iron_bulwark', slot: 0 },
      { skillId: 'second_wind', slot: 2 },
    ]);
    expect(damagePerTurn(setup, skillBook).avg).toBe(0);
  });

  it('counts damage-over-time output (poison ticks), not just direct hits', () => {
    const band = damagePerTurn(heroWith([{ skillId: 'venom_fang', slot: 0 }]), skillBook);
    expect(band.avg).toBeGreaterThan(0);
  });

  it('a higher-RANK enemy out-damages the same enemy at rank 0', () => {
    const base = buildEnemyEncounter('bandit_duelist', 10, 'normal', 0);
    const ranked = buildEnemyEncounter('bandit_duelist', 10, 'normal', 6); // all Diamond
    expect(damagePerTurn(ranked.setup, skillBook).avg).toBeGreaterThan(damagePerTurn(base.setup, skillBook).avg);
  });

  it('a higher-LEVEL enemy out-damages its lower-level self (flat Attack adds up)', () => {
    const low = buildEnemyEncounter('bandit_duelist', 5, 'normal', 0);
    const high = buildEnemyEncounter('bandit_duelist', 40, 'normal', 0);
    expect(damagePerTurn(high.setup, skillBook).avg).toBeGreaterThan(damagePerTurn(low.setup, skillBook).avg);
  });
});

describe('run/analysis: cardContributions (per-card report)', () => {
  it('attributes damage, DoT, shield, and healing to the right source card', () => {
    // Hero deck: an attacker, a poison attacker, a shield, a heal.
    const hero: CombatantSetup = {
      name: 'Hero',
      stats: { maxHp: 400, hp: 200, attack: 12, magicPower: 12, armor: 0, magicResist: 0, speed: 20 },
      boardSize: 10,
      pieces: [
        { skillId: 'sword_slash', slot: 0 },
        { skillId: 'venom_fang', slot: 1 },
        { skillId: 'iron_bulwark', slot: 2 },
        { skillId: 'second_wind', slot: 4 },
      ],
    };
    const dummy: CombatantSetup = {
      name: 'Bag', stats: { maxHp: 5000, hp: 5000, attack: 6, magicPower: 0, armor: 0, magicResist: 0, speed: 8 },
      boardSize: 2, pieces: [{ skillId: 'sword_slash', slot: 0 }],
    };
    const { events } = simulate({ playerTeam: [hero], enemyTeam: [dummy], skillBook, suddenDeathRound: 999, fatigueTurn: 999, maxTurns: 8 }, 1);
    const contrib = cardContributions(events);
    const bySkill = (id: string) => contrib.find((c) => c.side === 'player' && c.skillId === id);

    expect(bySkill('sword_slash')?.damage).toBeGreaterThan(0);
    expect(bySkill('venom_fang')?.dotDamage).toBeGreaterThan(0); // poison ticked and was attributed
    expect(bySkill('iron_bulwark')?.shield).toBeGreaterThan(0);
    expect(bySkill('second_wind')?.healing).toBeGreaterThan(0); // hero started at half HP
    // Shield card dealt no damage; attacker granted no shield.
    expect(bySkill('iron_bulwark')?.damage ?? 0).toBe(0);
    expect(bySkill('sword_slash')?.shield ?? 0).toBe(0);
  });

  it('is deterministic and attributes only cards that actually fired', () => {
    const hero: CombatantSetup = {
      name: 'Hero', stats: { maxHp: 300, hp: 300, attack: 10, magicPower: 10, armor: 0, magicResist: 0, speed: 20 },
      boardSize: 10, pieces: [{ skillId: 'sword_slash', slot: 0 }],
    };
    const dummy: CombatantSetup = {
      name: 'Bag', stats: { maxHp: 9999, hp: 9999, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 0 },
      boardSize: 1, pieces: [],
    };
    const run = () => cardContributions(simulate({ playerTeam: [hero], enemyTeam: [dummy], skillBook, suddenDeathRound: 999, fatigueTurn: 999, maxTurns: 6 }, 3).events);
    expect(run()).toEqual(run());
    const contrib = run();
    expect(contrib).toHaveLength(1);
    expect(contrib[0]).toMatchObject({ side: 'player', slot: 0, skillId: 'sword_slash' });
  });
});
