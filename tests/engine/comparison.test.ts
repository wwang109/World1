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
    // Hero Speed 12: [Meteor w30 span3][Slash w10]. Enemy Speed 10: four
    // distinct w10 bites (freshness-neutral, to keep the walkthrough pure).
    const book: typeof MINI_BOOK = { ...MINI_BOOK };
    for (const n of [1, 2, 3, 4]) book[`b${n}`] = { ...MINI_BOOK.bite!, id: `b${n}`, name: `B${n}` };
    const c = cfg(
      tc('hero', ['meteor', 'slash'], { speed: 12, attack: 1, magicPower: 1, maxHp: 5000 }, { skillBook: book }),
      tc('foe', ['b1', 'b2', 'b3', 'b4'], { speed: 10, attack: 1, maxHp: 5000 }, { skillBook: book }),
      { ...NO_ENDGAME, skillBook: book, maxTurns: 6 },
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
    // Four distinct w10 clones per side keep the freshness tax out of a
    // pure-Speed measurement.
    const book: typeof MINI_BOOK = { ...MINI_BOOK };
    for (const n of [1, 2, 3, 4]) {
      book[`s${n}`] = { ...MINI_BOOK.slash!, id: `s${n}`, name: `S${n}` };
      book[`b${n}`] = { ...MINI_BOOK.bite!, id: `b${n}`, name: `B${n}` };
    }
    const c = cfg(
      tc('fast', ['s1', 's2', 's3', 's4'], { speed: 20, attack: 1, maxHp: 5000 }, { skillBook: book }),
      tc('slow', ['b1', 'b2', 'b3', 'b4'], { speed: 10, attack: 1, maxHp: 5000 }, { skillBook: book }),
      { ...NO_ENDGAME, skillBook: book, maxTurns: 30 },
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

  it('surplus initiative chains an extra cast — at DOUBLE its weight', () => {
    // Hero Speed 30 with weight-8 cards vs Speed-10 foe: T1 score 0+30−8=22
    // beats foe's 0; the first EXTRA play costs DOUBLE the card's weight
    // (8×2=16), and 22−16=6 still beats 0, so the hero chains a second
    // cast. The next doubles again (8×4=32) — priced out. At Speed 20 the
    // budget (12) can't afford even the first extra: no chain.
    const book: typeof MINI_BOOK = {
      ...MINI_BOOK,
      jab: { ...MINI_BOOK.slash!, id: 'jab', name: 'Jab', speedWeight: 8 },
      jab2: { ...MINI_BOOK.slash!, id: 'jab2', name: 'Jab II', speedWeight: 8 },
    };
    const fast = cfg(
      tc('fast', ['jab', 'jab2'], { speed: 30, attack: 1, maxHp: 5000 }, { skillBook: book }),
      tc('slow', ['bite'], { speed: 10, attack: 1, maxHp: 5000 }, { skillBook: book }),
      { ...NO_ENDGAME, skillBook: book, maxTurns: 1 },
    );
    expect(casts(simulate(fast, 1).events, 'player')).toEqual(['jab', 'jab2']);

    const moderate = cfg(
      tc('brisk', ['jab', 'jab2'], { speed: 20, attack: 1, maxHp: 5000 }, { skillBook: book }),
      tc('slow', ['bite'], { speed: 10, attack: 1, maxHp: 5000 }, { skillBook: book }),
      { ...NO_ENDGAME, skillBook: book, maxTurns: 1 },
    );
    expect(casts(simulate(moderate, 1).events, 'player')).toEqual(['jab']);
  });

  it('deeper chains demand exponentially more Speed (no hard cap)', () => {
    // Speed 100 on [jab w8, slash w10]: budget 92 → slash costs 10×2=20
    // (72 left) → jab costs 8×4=32 (40 left) → slash would cost 10×8=80,
    // priced out. Three plays in one stage, bought purely with Speed —
    // beyond the 1-extra reach of moderate builds.
    const book: typeof MINI_BOOK = {
      ...MINI_BOOK,
      jab: { ...MINI_BOOK.slash!, id: 'jab', name: 'Jab', speedWeight: 8 },
    };
    const c = cfg(
      tc('blur', ['jab', 'slash'], { speed: 100, attack: 1, maxHp: 5000 }, { skillBook: book }),
      tc('slow', ['bite'], { speed: 10, attack: 1, maxHp: 5000 }, { skillBook: book }),
      { ...NO_ENDGAME, skillBook: book, maxTurns: 1 },
    );
    expect(casts(simulate(c, 1).events, 'player')).toEqual(['jab', 'slash', 'jab']);
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

  it('effective Speed is floored at 5 — slow-stacking never freezes a side', () => {
    // A speed-7 foe under Slowing Hex (−30% → 4.9) still banks 5 per turn,
    // so it keeps crawling toward its casts instead of being parked at 0.
    const c = cfg(
      tc('hexer', ['slow_hex'], { magicPower: 10, speed: 20, maxHp: 5000 }),
      tc('slug', ['sword_slash'], { attack: 1, speed: 7, maxHp: 5000 }),
      { ...NO_ENDGAME, maxTurns: 8 },
    );
    const { events } = simulate(c, 1);
    const cmps = events.filter((e) => e.kind === 'comparison') as Extract<Events[number], { kind: 'comparison' }>[];
    // After the hex lands, the debuffed foe's effective speed reads 5, not 4.
    expect(cmps.some((e) => e.enemy.speed === 5)).toBe(true);
    expect(cmps.every((e) => e.enemy.speed >= 5)).toBe(true);
    // And the slug still gets to act despite permanent re-hexing.
    expect(events.some((e) => e.kind === 'skillCast' && e.side === 'enemy')).toBe(true);
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
        tier: 'common',
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

describe('freshness — duplicates play by their own rule', () => {
  // The three ways to repeat, measured at steady state (all cards w10,
  // Speed 20 vs a passive wall):
  //   varied pair  [slash][bite] : queued card was 1 of last 3 casts -> 10+4 = 14
  //   duplicates [slash][slash]  : own copy once (+4), other copy twice at
  //                                half rate (+2 each), other copy was last
  //                                cast (+2) -> 10+4+4+2 = 20
  //   mono spam  [slash] alone   : own copy fills the window (+12) and was
  //                                the last cast (+4) -> 10+16 = 26
  function steadyWeight(pieces: { skillId: string; slot: number }[]): number {
    const c = cfg(
      { ...tc('h', [], { speed: 20, attack: 1, maxHp: 5000 }), pieces, boardSize: 10 },
      tc('wall', ['war_banner'], { maxHp: 5000 }),
      { ...NO_ENDGAME, maxTurns: 8 },
    );
    const { events } = simulate(c, 1);
    const cmps = events.filter((e) => e.kind === 'comparison') as Extract<Events[number], { kind: 'comparison' }>[];
    return cmps[cmps.length - 1]!.player.weight!;
  }

  it('same copy spam > duplicate copies > varied rotation', () => {
    const mono = steadyWeight([{ skillId: 'sword_slash', slot: 0 }]);
    const dupes = steadyWeight([
      { skillId: 'sword_slash', slot: 0 },
      { skillId: 'sword_slash', slot: 1 },
    ]);
    const varied = steadyWeight([
      { skillId: 'sword_slash', slot: 0 },
      { skillId: 'savage_bite', slot: 1 },
    ]);
    expect(mono).toBe(26);
    expect(dupes).toBe(20);
    expect(varied).toBe(14);
  });
});
