import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { cfg, tc, NO_ENDGAME } from '../helpers';

type Events = ReturnType<typeof simulate>['events'];

function damageTo(events: Events, side: 'player' | 'enemy') {
  return events.filter((e) => e.kind === 'damage' && e.side === side && (e as { source?: string }).source === 'skill') as Extract<
    Events[number],
    { kind: 'damage' }
  >[];
}

describe('guard (Brace / Parry) — physical damage reduction stance', () => {
  it('cuts physical strike damage by the guard percentage', () => {
    // Hero braces T1 (score 10 vs 2); the Speed-12 foe strikes T2 while the
    // stance is up. Slash: 200% of 10 = 20, no armor; Brace 25% -> 15.
    const c = cfg(
      tc('wall', ['brace'], { speed: 20, maxHp: 500 }),
      tc('bruiser', ['sword_slash'], { attack: 10, speed: 12, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    const hits = damageTo(events, 'player');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.amount).toBe(15);
  });

  it('parry halves the blow', () => {
    const c = cfg(
      tc('duelist', ['parry'], { speed: 20, maxHp: 500 }),
      tc('bruiser', ['sword_slash'], { attack: 10, speed: 12, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    const hits = damageTo(events, 'player');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.amount).toBe(10);
  });

  it('magic ignores guard entirely', () => {
    // Arcane Bolt: 180% of 10 = 18, no resist -> 18 lands despite Brace.
    const c = cfg(
      tc('wall', ['brace'], { speed: 20, maxHp: 500 }),
      tc('mage', ['arcane_bolt'], { magicPower: 10, speed: 12, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    const hits = damageTo(events, 'player');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.amount).toBe(18);
  });

  it('stacked guards cap at 75% reduction', () => {
    // Brace T1, Parry T2 (both stances active T3 — Brace has a turn left,
    // Parry is fresh); the foe finally outscores the hero on T3 and swings
    // into the full 75% cap: 20 -> 5.
    const c = cfg(
      tc('fortress', ['brace', 'parry'], { speed: 20, maxHp: 500 }),
      tc('bruiser', ['sword_slash'], { attack: 10, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    const hits = damageTo(events, 'player');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.amount).toBe(5);
  });
});

describe('speed-conditional effects (onlyIf faster/slower)', () => {
  it('Swift Strike doubles up only while faster than the target', () => {
    // Faster hero: both damage actions land (two enemy damage events/cast).
    const fast = cfg(
      tc('blade', ['swift_strike'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('slug', ['sword_slash'], { attack: 1, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    expect(damageTo(simulate(fast, 1).events, 'enemy')).toHaveLength(2);

    // Equal speed: 'faster' requires strictly greater — bonus withheld.
    const equal = cfg(
      tc('blade', ['swift_strike'], { attack: 10, speed: 10, maxHp: 500 }),
      tc('peer', ['sword_slash'], { attack: 1, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    expect(damageTo(simulate(equal, 1).events, 'enemy')).toHaveLength(1);
  });

  it('Underdog Crush pays off only while slower than the target', () => {
    const slow = cfg(
      tc('underdog', ['underdog_crush'], { attack: 10, speed: 10, maxHp: 5000 }),
      tc('hare', ['sword_slash'], { attack: 1, speed: 20, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const slowHits = damageTo(simulate(slow, 1).events, 'enemy').filter((e) => e.turn <= 3);
    expect(slowHits.length).toBeGreaterThanOrEqual(2);

    const fast = cfg(
      tc('favorite', ['underdog_crush'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('slug', ['sword_slash'], { attack: 1, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    expect(damageTo(simulate(fast, 1).events, 'enemy')).toHaveLength(1);
  });

  it('the condition reads EFFECTIVE speed — a slow-hexed foe flips the check', () => {
    // Equal base speeds, but the hero debuffs the foe's Speed first; the
    // next Swift Strike sees itself faster and doubles up.
    const c = cfg(
      tc('blade', ['slow_hex', 'swift_strike'], { attack: 10, magicPower: 10, speed: 10, maxHp: 500 }),
      tc('peer', ['iron_bulwark'], { attack: 10, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    const swiftTurn = (events.find((e) => e.kind === 'skillCast' && (e as { skillId?: string }).skillId === 'swift_strike') as { turn: number }).turn;
    expect(damageTo(events, 'enemy').filter((e) => e.turn === swiftTurn)).toHaveLength(2);
  });
});
