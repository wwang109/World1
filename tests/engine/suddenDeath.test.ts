import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { cfg, tc, MINI_BOOK } from '../helpers';

describe('sudden death and termination', () => {
  it('activates once both sides have performed 5 times and ramps the enemy harder', () => {
    // Even 1-damage trades: sudden death must end it.
    const c = cfg(
      tc('hero', ['slash'], { attack: 10, armor: 9, maxHp: 300 }, { skillBook: MINI_BOOK }),
      tc('foe', ['bite'], { attack: 10, armor: 9, maxHp: 300 }, { skillBook: MINI_BOOK }),
      { skillBook: MINI_BOOK, suddenDeathRound: 5, fatigueTurn: 999, maxTurns: 200 },
    );
    const { events, result } = simulate(c, 1);
    const sdIdx = events.findIndex((e) => e.kind === 'suddenDeathStart');
    expect(sdIdx).toBeGreaterThan(0);
    expect(result === 'win' || result === 'loss').toBe(true);

    // Enemy hits (on the player) must grow ~3x faster than player hits.
    const post = events.slice(sdIdx);
    const onPlayer = post.filter(
      (e) => e.kind === 'damage' && e.side === 'player' && (e as { source: string }).source === 'skill',
    ) as { amount: number }[];
    const onEnemy = post.filter(
      (e) => e.kind === 'damage' && e.side === 'enemy' && (e as { source: string }).source === 'skill',
    ) as { amount: number }[];
    if (onPlayer.length >= 2 && onEnemy.length >= 2) {
      const growthOnPlayer = onPlayer[onPlayer.length - 1]!.amount - onPlayer[0]!.amount;
      const growthOnEnemy = onEnemy[onEnemy.length - 1]!.amount - onEnemy[0]!.amount;
      expect(growthOnPlayer).toBeGreaterThanOrEqual(growthOnEnemy);
    }
  });

  // FIRST TO FALL LOSES (user-locked 2026-08-04): a mirrored fight is no longer a
  // tie handed to the player — the fatigue/attrition sweep runs in canonical order
  // (player side first), so the player's unit is the one that falls and the fight
  // ends at that exact tick. Both cases below flipped from `win` for that reason,
  // and for that reason only (the events before the death are unchanged).
  it('two zero-damage boards terminate via the fatigue backstop; the mirrored player falls first', () => {
    const c = cfg(
      tc('turtle1', ['iron_bulwark', 'second_wind'], { attack: 20, maxHp: 200 }),
      tc('turtle2', ['iron_bulwark', 'second_wind'], { attack: 20, maxHp: 200 }),
      { suddenDeathRound: 5, fatigueTurn: 10, maxTurns: 200 },
    );
    const { events, result, finalState } = simulate(c, 7);
    expect(events.some((e) => e.kind === 'fatigueStart')).toBe(true);
    expect(result).toBe('loss'); // identical turtles: the player is hit first
    expect(events.filter((e) => e.kind === 'died')).toHaveLength(1);
    expect(finalState.enemyTeam[0]!.alive).toBe(true);
  });

  it('empty boards still resolve (the first tick of the sweep decides it)', () => {
    const c = cfg(
      tc('a', [], { maxHp: 20 }),
      tc('b', [], { maxHp: 20 }),
      { suddenDeathRound: 1, fatigueTurn: 1, maxTurns: 100 },
    );
    expect(simulate(c, 1).result).toBe('loss');
  });
});
