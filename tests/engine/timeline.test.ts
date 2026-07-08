import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { cfg, tc } from '../helpers';

const PASSIVE_ENDGAME = { suddenDeathRound: 999, fatigueRound: 999 } as const;

function turnsBy(events: ReturnType<typeof simulate>['events'], side: 'player' | 'enemy') {
  return events.filter((e) => e.kind === 'turnStart' && e.side === side).length;
}

describe('action timeline scheduling (no ticks)', () => {
  it('double Speed means exactly twice the turns', () => {
    const c = cfg(
      tc('fast', ['strike'], { speed: 20, maxHp: 5000, atk: 1 }),
      tc('slow', ['strike'], { speed: 10, maxHp: 5000, atk: 1 }),
      { ...PASSIVE_ENDGAME, maxTurns: 30 },
    );
    const { events } = simulate(c, 1);
    expect(turnsBy(events, 'player')).toBe(2 * turnsBy(events, 'enemy'));
  });

  it('a Large (3-slot) skill takes three times the timeline of a Small one', () => {
    // Player only has the size-3 axe; enemy chains size-1 strikes.
    const c = cfg(
      tc('slowcaster', ['executioner_axe'], { speed: 10, maxHp: 9000, atk: 1 }),
      tc('quick', ['strike'], { speed: 10, maxHp: 9000, atk: 1 }),
      { ...PASSIVE_ENDGAME, maxTurns: 40 },
    );
    const { events } = simulate(c, 1);
    expect(turnsBy(events, 'enemy')).toBe(3 * turnsBy(events, 'player'));
  });

  it('the faster combatant acts first; player wins Speed ties', () => {
    const fastEnemy = simulate(
      cfg(
        tc('hero', ['strike'], { speed: 10, maxHp: 500 }),
        tc('foe', ['strike'], { speed: 20, maxHp: 500 }),
        { ...PASSIVE_ENDGAME, maxTurns: 4 },
      ),
      1,
    );
    expect(fastEnemy.events.find((e) => e.kind === 'turnStart')).toMatchObject({ side: 'enemy' });

    const tied = simulate(
      cfg(
        tc('hero', ['strike'], { speed: 10, maxHp: 500 }),
        tc('foe', ['strike'], { speed: 10, maxHp: 500 }),
        { ...PASSIVE_ENDGAME, maxTurns: 4 },
      ),
      1,
    );
    expect(tied.events.find((e) => e.kind === 'turnStart')).toMatchObject({ side: 'player' });
  });

  it('speed debuffs stretch the victim turn cadence', () => {
    const slowed = cfg(
      tc('caster', ['frost_bolt'], { speed: 10, maxHp: 5000, atk: 1 }),
      tc('victim', ['strike'], { speed: 10, maxHp: 5000, atk: 1 }),
      { ...PASSIVE_ENDGAME, maxTurns: 40 },
    );
    const normal = cfg(
      tc('caster', ['strike'], { speed: 10, maxHp: 5000, atk: 1 }),
      tc('victim', ['strike'], { speed: 10, maxHp: 5000, atk: 1 }),
      { ...PASSIVE_ENDGAME, maxTurns: 40 },
    );
    expect(turnsBy(simulate(slowed, 1).events, 'enemy')).toBeLessThan(
      turnsBy(simulate(normal, 1).events, 'enemy'),
    );
  });
});

describe('sudden death and termination', () => {
  it('activates after the configured rounds and ramps enemy damage harder', () => {
    // Both sides trade 1-dmg strikes forever until sudden death ramps them up.
    const c = cfg(
      tc('hero', ['strike'], { speed: 10, maxHp: 400, atk: 10, def: 9 }),
      tc('foe', ['strike'], { speed: 10, maxHp: 400, atk: 10, def: 9 }),
      { suddenDeathRound: 5, fatigueRound: 999, maxTurns: 200 },
    );
    const { events, result } = simulate(c, 1);
    const sdIdx = events.findIndex((e) => e.kind === 'suddenDeathStart');
    expect(sdIdx).toBeGreaterThan(0);
    expect(result === 'win' || result === 'loss').toBe(true);

    // After sudden death, enemy-sourced hits (on the player side) grow faster
    // (+30%/turn) than player-sourced hits (+10%/turn).
    const post = events.slice(sdIdx);
    const playerTaken = post.filter((e) => e.kind === 'damage' && e.side === 'player' && e.source === 'skill');
    const enemyTaken = post.filter((e) => e.kind === 'damage' && e.side === 'enemy' && e.source === 'skill');
    if (playerTaken.length >= 2 && enemyTaken.length >= 2) {
      const growth = (arr: typeof playerTaken) =>
        (arr[arr.length - 1] as { amount: number }).amount - (arr[0] as { amount: number }).amount;
      expect(growth(playerTaken)).toBeGreaterThanOrEqual(growth(enemyTaken));
    }
  });

  it('two zero-damage turtle boards still terminate via the fatigue backstop', () => {
    const c = cfg(
      tc('turtle1', ['guard', 'mend'], { atk: 30, maxHp: 300 }),
      tc('turtle2', ['guard', 'mend'], { atk: 30, maxHp: 300 }),
      { suddenDeathRound: 5, fatigueRound: 8, maxTurns: 300 },
    );
    const { result, events } = simulate(c, 7);
    expect(events.some((e) => e.kind === 'fatigueStart')).toBe(true);
    expect(result === 'win' || result === 'loss').toBe(true);
  });

  it('the player wins a simultaneous fatigue wipe', () => {
    const c = cfg(
      tc('a', [], { maxHp: 10, speed: 10 }),
      tc('b', [], { maxHp: 10, speed: 10 }),
      { suddenDeathRound: 1, fatigueRound: 1, maxTurns: 50 },
    );
    const { result } = simulate(c, 1);
    expect(result).toBe('win');
  });
});
