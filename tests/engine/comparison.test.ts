import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { cfg, tc, MINI_BOOK, NO_ENDGAME } from '../helpers';

type Events = ReturnType<typeof simulate>['events'];

function plays(events: Events, side?: 'player' | 'enemy') {
  return events.filter(
    (event): event is Extract<Events[number], { kind: 'play' }> =>
      event.kind === 'play' && (side === undefined || event.side === side),
  );
}

describe('readiness play order', () => {
  it('lets both sides play in one turn and preserves leftover readiness', () => {
    const c = cfg(
      tc('hero', ['meteor', 'slash'], { speed: 12, attack: 1, magicPower: 1, maxHp: 5000 }, { skillBook: MINI_BOOK }),
      tc('foe', ['bite'], { speed: 10, attack: 1, maxHp: 5000 }, { skillBook: MINI_BOOK }),
      { ...NO_ENDGAME, skillBook: MINI_BOOK, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    expect(plays(events).map((event) => [event.turn, event.side, event.skillId])).toEqual([
      [1, 'enemy', 'bite'],
      [2, 'enemy', 'bite'],
      [3, 'player', 'meteor'],
      [3, 'enemy', 'bite'],
      [4, 'enemy', 'bite'],
      [5, 'enemy', 'bite'],
      [6, 'player', 'slash'],
      [6, 'player', 'meteor'],
      [6, 'enemy', 'bite'],
    ]);
  });

  it('player wins the first exact readiness and Speed tie', () => {
    const c = cfg(
      tc('hero', ['slash'], { speed: 10, maxHp: 500 }, { skillBook: MINI_BOOK }),
      tc('foe', ['bite'], { speed: 10, maxHp: 500 }, { skillBook: MINI_BOOK }),
      { ...NO_ENDGAME, skillBook: MINI_BOOK, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(plays(events).map((event) => event.side)).toEqual(['player', 'enemy']);
  });

  it('a fast two-card board can play twice before a slower one-card board', () => {
    const c = cfg(
      tc('fast', ['slash', 'slash'], { speed: 20, attack: 1, maxHp: 5000 }, { skillBook: MINI_BOOK }),
      tc('slow', ['bite'], { speed: 10, attack: 1, maxHp: 5000 }, { skillBook: MINI_BOOK }),
      { ...NO_ENDGAME, skillBook: MINI_BOOK, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(plays(events).map((event) => event.side)).toEqual(['player', 'player', 'enemy']);
  });

  it('a spanning card emits two busy turns while the opponent remains active', () => {
    const c = cfg(
      tc('hero', ['meteor'], { speed: 30, attack: 1, magicPower: 1, maxHp: 5000 }, { skillBook: MINI_BOOK }),
      tc('foe', ['bite'], { speed: 10, attack: 1, maxHp: 5000 }, { skillBook: MINI_BOOK }),
      { ...NO_ENDGAME, skillBook: MINI_BOOK, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    expect(events.filter((event) => event.kind === 'busy').map((event) => [event.turn, event.slotIndex])).toEqual([
      [2, 2],
      [3, 3],
    ]);
    expect(plays(events, 'enemy').map((event) => event.turn)).toEqual([1, 2, 3]);
  });

  it('aura cards are valid plays', () => {
    const c = cfg(
      tc('hero', ['war_banner'], { speed: 20, maxHp: 500 }),
      tc('foe', ['sword_slash'], { attack: 1, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(plays(events, 'player').map((event) => event.skillId)).toEqual(['war_banner']);
  });

  it('plays full-health heals instead of hiding their readiness cost', () => {
    const book: typeof MINI_BOOK = {
      ...MINI_BOOK,
      heal_flat: {
        id: 'heal_flat', name: 'Heal', archetypes: ['healing'], property: 'true', size: 1,
        speedWeight: 10, rarity: 'common', tier: 'bronze', effects: [{ kind: 'heal', power: 25 }], text: '',
      },
    };
    const c = cfg(
      tc('hero', ['heal_flat', 'slash'], { speed: 20, attack: 1, maxHp: 500 }, { skillBook: book }),
      tc('dummy', [], { maxHp: 500, speed: 10 }, { skillBook: book }),
      { ...NO_ENDGAME, skillBook: book, maxTurns: 2 },
    );
    expect(plays(simulate(c, 1).events, 'player').map((event) => event.skillId)).toEqual([
      'heal_flat', 'slash', 'heal_flat', 'slash',
    ]);
  });
});
