import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { cfg, tc, MINI_BOOK, NO_ENDGAME } from '../helpers';

type Events = ReturnType<typeof simulate>['events'];

function performers(events: Events): (string | null)[] {
  return events.filter((e) => e.kind === 'comparison').map((e) => (e as { performer: string | null }).performer);
}

function casts(events: Events, side: 'player' | 'enemy'): string[] {
  return events
    .filter((e) => e.kind === 'skillCast' && e.side === side)
    .map((e) => (e as { skillId: string }).skillId);
}

describe('initiative comparison (score = bank + Speed − weight)', () => {
  it('reproduces the worked Slash/Meteor vs Bite walkthrough', () => {
    // Hero Speed 12: [Meteor w30 span3][Slash w10]. Enemy Speed 10: [Bite w10].
    const c = cfg(
      tc('hero', ['meteor', 'slash'], { speed: 12, attack: 1, magicPower: 1, maxHp: 5000 }, { skillBook: MINI_BOOK }),
      tc('foe', ['bite'], { speed: 10, attack: 1, maxHp: 5000 }, { skillBook: MINI_BOOK }),
      { ...NO_ENDGAME, skillBook: MINI_BOOK, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    // T1: hero 12−30=−18 vs 0 → enemy. T2: 24−30 vs 0 → enemy. T3: 36−30=6 → HERO METEOR.
    // T4-5: hero busy (span) → enemy. T6: hero 24+12−10=26 → HERO SLASH.
    expect(performers(events)).toEqual(['enemy', 'enemy', 'player', 'enemy', 'enemy', 'player']);
    expect(casts(events, 'player')).toEqual(['meteor', 'slash']);
  });

  it('player wins exact ties', () => {
    const c = cfg(
      tc('hero', ['slash'], { speed: 10, maxHp: 500 }, { skillBook: MINI_BOOK }),
      tc('foe', ['bite'], { speed: 10, maxHp: 500 }, { skillBook: MINI_BOOK }),
      { ...NO_ENDGAME, skillBook: MINI_BOOK, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(performers(events)).toEqual(['player']);
  });

  it('double Speed yields a 2:1 performance rhythm', () => {
    const c = cfg(
      tc('fast', ['slash'], { speed: 20, attack: 1, maxHp: 5000 }, { skillBook: MINI_BOOK }),
      tc('slow', ['bite'], { speed: 10, attack: 1, maxHp: 5000 }, { skillBook: MINI_BOOK }),
      { ...NO_ENDGAME, skillBook: MINI_BOOK, maxTurns: 30 },
    );
    const { events } = simulate(c, 1);
    const p = performers(events);
    const playerTurns = p.filter((x) => x === 'player').length;
    const enemyTurns = p.filter((x) => x === 'enemy').length;
    expect(playerTurns).toBe(2 * enemyTurns);
  });

  it('a busy (spanning) side sits out and the opponent acts freely', () => {
    const c = cfg(
      tc('hero', ['meteor'], { speed: 10, attack: 1, magicPower: 1, maxHp: 5000 }, { skillBook: MINI_BOOK }),
      tc('foe', ['bite'], { speed: 10, attack: 1, maxHp: 5000 }, { skillBook: MINI_BOOK }),
      { ...NO_ENDGAME, skillBook: MINI_BOOK, maxTurns: 8 },
    );
    const { events } = simulate(c, 1);
    const comparisons = events.filter((e) => e.kind === 'comparison') as Extract<
      Events[number],
      { kind: 'comparison' }
    >[];
    // Find the meteor cast turn; the two comparisons after it must show the
    // player as 'busy' and the enemy performing.
    const castTurn = (events.find((e) => e.kind === 'skillCast' && e.side === 'player') as { turn: number }).turn;
    const after = comparisons.filter((e) => e.turn === castTurn + 1 || e.turn === castTurn + 2);
    expect(after).toHaveLength(2);
    for (const cmp of after) {
      expect(cmp.player.state).toBe('busy');
      expect(cmp.performer).toBe('enemy');
    }
  });

  it('a passive-only board never performs; the opponent always does', () => {
    const c = cfg(
      tc('hero', ['war_banner'], { maxHp: 500 }),
      tc('foe', ['sword_slash'], { attack: 1, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    expect(casts(events, 'player')).toHaveLength(0);
    expect(casts(events, 'enemy').length).toBe(6);
    const cmp = events.find((e) => e.kind === 'comparison') as Extract<Events[number], { kind: 'comparison' }>;
    expect(cmp.player.state).toBe('nothingUsable');
  });

  it('surplus initiative chains extra casts for fast, light builds', () => {
    // Hero Speed 20 with weight-8 cards vs Speed-10 foe: T1 score 0+20−8=12
    // beats foe's 0; the remaining budget 12−8=4 still beats 0, so the hero
    // chains a second cast in the same stage. 4−8 < 0 ends the chain.
    const book: typeof MINI_BOOK = {
      ...MINI_BOOK,
      jab: { ...MINI_BOOK.slash!, id: 'jab', name: 'Jab', speedWeight: 8 },
      jab2: { ...MINI_BOOK.slash!, id: 'jab2', name: 'Jab II', speedWeight: 8 },
    };
    const c = cfg(
      tc('fast', ['jab', 'jab2'], { speed: 20, attack: 1, maxHp: 5000 }, { skillBook: book }),
      tc('slow', ['bite'], { speed: 10, attack: 1, maxHp: 5000 }, { skillBook: book }),
      { ...NO_ENDGAME, skillBook: book, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(casts(events, 'player')).toEqual(['jab', 'jab2']);
  });

  it('chains cap at 2 extra casts even with a huge surplus', () => {
    const book: typeof MINI_BOOK = {
      ...MINI_BOOK,
      jab: { ...MINI_BOOK.slash!, id: 'jab', name: 'Jab', speedWeight: 8 },
    };
    const c = cfg(
      tc('blur', ['jab', 'slash'], { speed: 100, attack: 1, maxHp: 5000 }, { skillBook: book }),
      tc('slow', ['bite'], { speed: 10, attack: 1, maxHp: 5000 }, { skillBook: book }),
      { ...NO_ENDGAME, skillBook: book, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(casts(events, 'player')).toHaveLength(3);
  });

  it('equal-weight parity never chains: the tie hands the stage over', () => {
    // Speed 20 vs 10, both weight 10: budget after the cast exactly ties the
    // foe's score — strict comparison means no chain, keeping the classic
    // 2:1 rhythm instead of a runaway.
    const c = cfg(
      tc('fast', ['slash'], { speed: 20, attack: 1, maxHp: 5000 }, { skillBook: MINI_BOOK }),
      tc('slow', ['bite'], { speed: 10, attack: 1, maxHp: 5000 }, { skillBook: MINI_BOOK }),
      { ...NO_ENDGAME, skillBook: MINI_BOOK, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(casts(events, 'player')).toHaveLength(1);
  });

  it('never chains without a ready opponent (free stage time)', () => {
    // The foe's board is passive-only, so there is no runner-up score to
    // beat; a blindingly fast hero still plays exactly one card per turn.
    const c = cfg(
      tc('blur', ['sword_slash', 'arcane_bolt'], { speed: 100, attack: 1, magicPower: 1, maxHp: 5000 }),
      tc('idol', ['war_banner'], { maxHp: 5000 }),
      { ...NO_ENDGAME, maxTurns: 4 },
    );
    const { events } = simulate(c, 1);
    expect(casts(events, 'player')).toHaveLength(4);
  });

  it('strict left→right rotation wraps and skips useless heals', () => {
    const book: typeof MINI_BOOK = {
      ...MINI_BOOK,
      heal_flat: {
        id: 'heal_flat',
        name: 'Heal',
        archetypes: ['healing'],
        property: 'true',
        size: 1,
        speedWeight: 10,
        rarity: 'common',
        tier: 'bronze',
        effects: [{ kind: 'heal', power: 25 }],
        text: '',
      },
    };
    const c = cfg(
      tc('hero', ['heal_flat', 'slash'], { speed: 20, attack: 1, maxHp: 500 }, { skillBook: book }),
      tc('dummy', [], { maxHp: 500, speed: 10 }, { skillBook: book }),
      { ...NO_ENDGAME, skillBook: book, maxTurns: 4 },
    );
    const { events } = simulate(c, 1);
    // Full HP -> heal skipped every rotation; only slashes fire.
    expect(casts(events, 'player')).toEqual(['slash', 'slash', 'slash', 'slash']);
  });
});
