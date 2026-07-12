import { describe, expect, it } from 'vitest';
import { runMatchup, seedsFor, summarize } from '../../scripts/balance';
import { skillBook } from '../../src/data/skills';
import { tc } from '../helpers';

describe('balance sim harness', () => {
  it('runMatchup is deterministic for a fixed seed list', () => {
    const player = tc('Hero', ['sword_slash', 'iron_bulwark']);
    const enemy = tc('Foe', ['savage_bite', 'venom_fang'], { maxHp: 90 });
    const seeds = seedsFor(0xba1a4ce, 'unit-test-matchup', 50);

    const a = runMatchup(player, enemy, skillBook, seeds);
    const b = runMatchup(player, enemy, skillBook, seeds);

    expect(a).toEqual(b);
    expect(a.fights).toBe(50);
    expect(a.wins + a.losses + a.draws).toBe(50);
  });

  it('seedsFor derives stable, distinct per-fight seeds from a base seed', () => {
    const seeds = seedsFor(1, 'tag', 10);
    expect(seeds).toHaveLength(10);
    expect(new Set(seeds).size).toBe(10);
    expect(seedsFor(1, 'tag', 10)).toEqual(seeds);
  });

  it('summarize computes winrate/turn stats from aggregated matchup stats', () => {
    const player = tc('Hero', ['sword_slash', 'iron_bulwark'], { attack: 40 });
    const enemy = tc('Foe', ['savage_bite'], { maxHp: 30, attack: 1 });
    const seeds = seedsFor(0xba1a4ce, 'lopsided-matchup', 30);

    const stats = runMatchup(player, enemy, skillBook, seeds);
    const summary = summarize(stats);

    expect(summary.winrate).toBeGreaterThan(90);
    expect(summary.avgTurns).toBeGreaterThan(0);
  });
});
