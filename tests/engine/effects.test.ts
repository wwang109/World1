import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { SkillBook } from '../../src/engine/types';
import { cfg, tc } from '../helpers';

const PASSIVE_ENDGAME = { suddenDeathRound: 999, fatigueRound: 999 } as const;

describe('damage', () => {
  it('applies atk*power/100 minus def, minimum 1', () => {
    const c = cfg(
      tc('hero', ['strike'], { atk: 10, speed: 20 }),
      tc('wall', [], { maxHp: 100, def: 3, speed: 10 }),
      { ...PASSIVE_ENDGAME, maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'damage')).toMatchObject({
      side: 'enemy',
      amount: 7,
      blocked: 0,
      crit: false,
    });
  });

  it('crits multiply damage by 1.5 (floored) at 100% crit', () => {
    const c = cfg(
      tc('hero', ['strike'], { atk: 10, critPct: 100, speed: 20 }),
      tc('wall', [], { maxHp: 100, def: 3, speed: 10 }),
      { ...PASSIVE_ENDGAME, maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'damage')).toMatchObject({ amount: 10, crit: true });
  });

  it('shield absorbs damage before HP', () => {
    // Enemy (speed 20) guards first; the hero's strike hits the shield.
    const c = cfg(
      tc('hero', ['strike'], { atk: 8, speed: 10 }),
      tc('turtle', ['guard'], { atk: 10, speed: 20, maxHp: 50 }),
      { ...PASSIVE_ENDGAME, maxTurns: 2 },
    );
    const { events, finalState } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'damage' && e.side === 'enemy')).toMatchObject({
      amount: 8,
      blocked: 8,
      hpAfter: 50,
    });
    expect(finalState.enemy.shield).toBe(4); // 12 shield - 8 blocked
  });
});

describe('healing', () => {
  it('caps at maxHp', () => {
    const c = cfg(
      tc('hero', ['mend'], { atk: 10, speed: 10, maxHp: 100, hp: 95 }),
      tc('bystander', [], { speed: 1 }),
      { ...PASSIVE_ENDGAME, maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'heal')).toMatchObject({ side: 'player', amount: 5, hpAfter: 100 });
  });
});

describe('damage over time', () => {
  it('poison acts on every victim turn and ignores shield', () => {
    const c = cfg(
      tc('hero', ['venom_strike'], { atk: 10, speed: 20 }),
      tc('turtle', ['guard'], { atk: 50, speed: 10, maxHp: 60 }),
      { ...PASSIVE_ENDGAME, maxTurns: 8 },
    );
    const { events, finalState } = simulate(c, 1);
    const ticks = events.filter((e) => e.kind === 'statusTick' && e.status === 'poison');
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]).toMatchObject({ side: 'enemy', amount: 5 });
    // HP strictly decreases across ticks even while the shield stays up.
    const hps = ticks.map((t) => (t as { hpAfter: number }).hpAfter);
    for (let i = 1; i < hps.length; i++) expect(hps[i]!).toBeLessThan(hps[i - 1]!);
    expect(finalState.enemy.shield).toBeGreaterThan(0);
  });

  it('burn is absorbed by shield first', () => {
    const c = cfg(
      tc('hero', ['fireball'], { atk: 10, speed: 10 }),
      tc('turtle', ['guard'], { atk: 50, speed: 30, maxHp: 60 }),
      { ...PASSIVE_ENDGAME, maxTurns: 8 },
    );
    const { events } = simulate(c, 1);
    const tick = events.find((e) => e.kind === 'statusTick' && e.status === 'burn');
    expect(tick).toMatchObject({ side: 'enemy', amount: 6, hpAfter: 60 }); // shielded: HP untouched
  });

  it('dots act exactly `turns` times, then expire', () => {
    const book: SkillBook = {
      venom_once: {
        id: 'venom_once',
        name: 'Venom Once',
        size: 1,
        tags: ['venom'],
        rarity: 'common',
        cooldownTurns: 99,
        effects: [{ kind: 'poison', amount: 5, turns: 3 }],
        text: '',
      },
    };
    const c = cfg(
      tc('hero', ['venom_once'], { speed: 10, maxHp: 500 }, { skillBook: book }),
      tc('victim', [], { maxHp: 500, speed: 10 }, { skillBook: book }),
      { ...PASSIVE_ENDGAME, skillBook: book, maxTurns: 14 },
    );
    const { events } = simulate(c, 1);
    expect(events.filter((e) => e.kind === 'statusTick' && e.status === 'poison').length).toBe(3);
    expect(events.some((e) => e.kind === 'statusExpired' && e.status === 'poison')).toBe(true);
  });
});

describe('stun', () => {
  it('makes the victim skip its next turn', () => {
    const c = cfg(
      tc('hero', ['shield_bash'], { atk: 10, speed: 20 }),
      tc('victim', ['strike'], { speed: 10, maxHp: 200 }),
      { ...PASSIVE_ENDGAME, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    expect(events.some((e) => e.kind === 'turnSkipped' && e.side === 'enemy' && e.reason === 'stunned')).toBe(true);
  });
});

describe('buffs and debuffs', () => {
  it('a self-buff lasts its full stated turns, then expires', () => {
    const book: SkillBook = {
      war_once: {
        id: 'war_once',
        name: 'War Once',
        size: 2,
        tags: ['attack'],
        rarity: 'common',
        cooldownTurns: 99,
        effects: [{ kind: 'buffStat', stat: 'atk', pct: 25, turns: 2 }],
        text: '',
      },
      jab: {
        id: 'jab',
        name: 'Jab',
        size: 1,
        tags: ['attack'],
        rarity: 'common',
        effects: [{ kind: 'damage', power: 100 }],
        text: '',
      },
    };
    const c = cfg(
      tc('hero', ['war_once', 'jab'], { atk: 10, speed: 10, maxHp: 1000 }, { skillBook: book }),
      tc('wall', [], { maxHp: 1000, speed: 1 }, { skillBook: book }),
      { ...PASSIVE_ENDGAME, skillBook: book, maxTurns: 8 },
    );
    const { events } = simulate(c, 1);
    const hits = events.filter((e) => e.kind === 'damage' && e.side === 'enemy').map((e) => (e as { amount: number }).amount);
    // Turn 1 buffs; turns 2-3 hit at +25% (12); turn 4 back to base (10).
    expect(hits.slice(0, 3)).toEqual([12, 12, 10]);
  });

  it('debuffs stay in force on every enemy action while active', () => {
    const c = cfg(
      tc('witch', ['weaken'], { speed: 20, maxHp: 1000 }),
      tc('bruiser', ['strike'], { atk: 10, speed: 10, maxHp: 1000 }),
      { ...PASSIVE_ENDGAME, maxTurns: 4 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'damage' && e.side === 'player')).toMatchObject({ amount: 7 }); // 10 * 0.7
  });
});

describe('cleanse', () => {
  it('removes dots and debuffs from the caster', () => {
    const c = cfg(
      tc('hero', ['purify'], { speed: 10, maxHp: 500 }),
      tc('snake', ['venom_strike'], { atk: 10, speed: 20, maxHp: 500 }),
      { ...PASSIVE_ENDGAME, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    const cleansed = events.find((e) => e.kind === 'cleansed' && e.side === 'player');
    expect(cleansed).toBeDefined();
    expect((cleansed as { removed: number }).removed).toBeGreaterThanOrEqual(1);
  });
});
