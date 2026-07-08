import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { SkillBook } from '../../src/engine/types';
import { cfg, tc } from '../helpers';

const PASSIVE_ENDGAME = { suddenDeathRound: 999, fatigueRound: 999 } as const;

function castSlots(events: ReturnType<typeof simulate>['events'], side: 'player' | 'enemy'): number[] {
  return events
    .filter((e) => e.kind === 'skillCast' && e.side === side)
    .map((e) => (e as { slot: number }).slot);
}

describe('board order = cast order (multi-slot pieces)', () => {
  it('cycles left to right by leftmost slot and wraps', () => {
    // strike(1)@0, heavy_blow(2)@1, strike(1)@3 — no cooldowns involved.
    const c = cfg(
      tc('hero', ['strike', 'heavy_blow', 'strike'], { atk: 1, maxHp: 5000 }),
      tc('dummy', [], { maxHp: 5000, speed: 1 }),
      { ...PASSIVE_ENDGAME, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    expect(castSlots(events, 'player').slice(0, 5)).toEqual([0, 1, 3, 0, 1]);
  });

  it('skips skills on cooldown and comes back to them', () => {
    const book: SkillBook = {
      bigshot: {
        id: 'bigshot',
        name: 'Bigshot',
        size: 1,
        tags: ['attack'],
        rarity: 'common',
        cooldownTurns: 3,
        effects: [{ kind: 'damage', power: 100 }],
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
      tc('hero', ['bigshot', 'jab'], { atk: 1, maxHp: 5000 }, { skillBook: book }),
      tc('dummy', [], { maxHp: 5000, speed: 1 }, { skillBook: book }),
      { ...PASSIVE_ENDGAME, skillBook: book, maxTurns: 5 },
    );
    const { events } = simulate(c, 1);
    // Turn 1 bigshot (cd 3). Turns 2-3 jab while it cools. Turn 4 bigshot again.
    expect(castSlots(events, 'player').slice(0, 4)).toEqual([0, 1, 1, 0]);
  });

  it('handles gaps: a lone skill mid-board casts every turn', () => {
    const c = cfg(
      tc('hero', [], { atk: 1, maxHp: 5000 }, { boardSize: 10, pieces: [{ skillId: 'strike', slot: 5 }] }),
      tc('dummy', [], { maxHp: 5000, speed: 1 }),
      { ...PASSIVE_ENDGAME, maxTurns: 4 },
    );
    const { events } = simulate(c, 1);
    expect(castSlots(events, 'player').slice(0, 3)).toEqual([5, 5, 5]);
  });

  it('a board of only passives skips every turn', () => {
    const c = cfg(
      tc('hero', ['whetstone', 'lucky_charm'], { maxHp: 500 }),
      tc('pest', ['strike'], { atk: 1, maxHp: 500 }),
      { ...PASSIVE_ENDGAME, maxTurns: 8 },
    );
    const { events } = simulate(c, 1);
    expect(events.some((e) => e.kind === 'turnSkipped' && e.side === 'player' && e.reason === 'noUsableSkill')).toBe(
      true,
    );
    expect(events.some((e) => e.kind === 'skillCast' && e.side === 'player')).toBe(false);
  });

  it('skips a heal at full HP but uses it when wounded', () => {
    const c = cfg(
      tc('hero', ['mend', 'strike'], { atk: 10, maxHp: 200, speed: 10 }),
      tc('foe', ['strike'], { atk: 10, maxHp: 200, speed: 10 }),
      { ...PASSIVE_ENDGAME, maxTurns: 12 },
    );
    const { events } = simulate(c, 1);
    const casts = events
      .filter((e) => e.kind === 'skillCast' && e.side === 'player')
      .map((e) => (e as { skillId: string }).skillId);
    expect(casts[0]).toBe('strike'); // full HP on turn 1 -> mend skipped
    expect(casts).toContain('mend'); // wounded later -> mend fires
  });
});
