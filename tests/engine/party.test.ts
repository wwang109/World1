import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { CombatantSetup } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';
import { skillBook } from '../../src/data/skills';

type Events = ReturnType<typeof simulate>['events'];

function damageEvents(events: Events, side: 'player' | 'enemy') {
  return events.filter((e) => e.kind === 'damage' && e.side === side) as Extract<Events[number], { kind: 'damage' }>[];
}

/** cfg() but with array sides. */
function partyCfg(player: CombatantSetup | CombatantSetup[], enemy: CombatantSetup | CombatantSetup[], extra = {}) {
  return { player, enemy, skillBook, ...NO_ENDGAME, ...extra };
}

describe('multi-combatant sides', () => {
  it('rejects empty and oversized sides', () => {
    expect(() => simulate(partyCfg(tc('hero', ['sword_slash']), []), 1)).toThrow(/1-5/);
    expect(() =>
      simulate(partyCfg(tc('hero', ['sword_slash']), Array.from({ length: 6 }, (_, i) => tc(`rat${i}`, ['savage_bite']))), 1),
    ).toThrow(/1-5/);
  });

  it('front-line targeting: the first living foe soaks hits, then the next', () => {
    // Hero one-shots each 10-HP foe; wall foes never act (empty boards).
    const c = partyCfg(
      tc('hero', ['sword_slash'], { attack: 10, speed: 20, maxHp: 500 }),
      [tc('front', [], { maxHp: 10 }), tc('back', [], { maxHp: 10 })],
      { maxTurns: 6 },
    );
    const { events, result } = simulate(c, 1);
    const hits = damageEvents(events, 'enemy');
    expect(hits[0]!.unit).toBe(0);
    expect(hits[1]!.unit).toBe(1);
    expect(result).toBe('win');
  });

  it('the fight only ends when the WHOLE side is down', () => {
    const c = partyCfg(
      tc('hero', ['sword_slash'], { attack: 10, speed: 20, maxHp: 500 }),
      [tc('front', [], { maxHp: 10 }), tc('back', [], { maxHp: 100 })],
      { maxTurns: 3 },
    );
    const { events, result } = simulate(c, 1);
    // Front dies turn 1 but the fight continues into turn 2+.
    const death = events.find((e) => e.kind === 'died');
    expect(death).toMatchObject({ side: 'enemy', unit: 0, turn: 1 });
    expect(result).toBe('draw'); // back wall still stands at maxTurns
  });

  it('highest aggro is targeted over formation order; ties go to the front', () => {
    const c = partyCfg(
      tc('hero', ['sword_slash'], { attack: 10, speed: 20, maxHp: 500 }),
      [tc('front', [], { maxHp: 100 }), { ...tc('taunter', [], { maxHp: 100 }), aggro: 5 }],
      { maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    expect(damageEvents(events, 'enemy').every((e) => e.unit === 1)).toBe(true);
  });

  it('multiHit strikes roll into the next foe after a kill (per-strike targeting)', () => {
    // Flurry: 3 hits of 5. Front has 5 HP -> hit 1 kills it, hits 2-3 carry to the back.
    const c = partyCfg(
      tc('hero', ['flurry_of_knives'], { attack: 10, speed: 20, maxHp: 500 }),
      [tc('front', [], { maxHp: 5 }), tc('back', [], { maxHp: 100 })],
      { maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(damageEvents(events, 'enemy').map((e) => e.unit)).toEqual([0, 1, 1]);
  });

  it('every member of a party gets to act, each on its own initiative', () => {
    // 1v2: both enemies carry cards; both should perform within a few turns.
    const c = partyCfg(
      tc('hero', ['iron_bulwark'], { attack: 10, speed: 10, maxHp: 500 }),
      [tc('a', ['sword_slash'], { attack: 1, speed: 12, maxHp: 500 }), tc('b', ['savage_bite'], { attack: 1, speed: 14, maxHp: 500 })],
      { maxTurns: 8 },
    );
    const { events } = simulate(c, 1);
    const performers = new Set(
      events.filter((e) => e.kind === 'performStart' && e.side === 'enemy').map((e) => (e as { unit: number }).unit),
    );
    expect(performers).toEqual(new Set([0, 1]));
  });

  it('a 2-hero side also works (engine is symmetric even if the demo UI is 1vN)', () => {
    const c = partyCfg(
      [tc('h1', ['sword_slash'], { attack: 10, speed: 12, maxHp: 500 }), tc('h2', ['arcane_bolt'], { magicPower: 10, speed: 14, maxHp: 500 })],
      tc('wall', [], { maxHp: 40, speed: 1 }),
      { maxTurns: 8 },
    );
    const { events, result } = simulate(c, 1);
    const performers = new Set(
      events.filter((e) => e.kind === 'performStart' && e.side === 'player').map((e) => (e as { unit: number }).unit),
    );
    expect(performers).toEqual(new Set([0, 1]));
    expect(result).toBe('win');
  });

  it('sudden death arms only when each side totals round x size performances', () => {
    // 1v2 walls that never act: enemy side can never perform, so SD never arms.
    const c = partyCfg(
      tc('hero', ['sword_slash'], { attack: 1, speed: 20, maxHp: 500 }),
      [tc('w1', [], { maxHp: 500 }), tc('w2', [], { maxHp: 500 })],
      { suddenDeathRound: 2, maxTurns: 12 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'suddenDeathStart')).toBeUndefined();
  });

  it('NvM battles are deterministic (double-run equality)', () => {
    const mk = () =>
      partyCfg(
        [tc('h1', ['sword_slash', 'fireball'], { attack: 9, magicPower: 8, speed: 12, critPct: 30 }), tc('h2', ['venom_fang'], { attack: 7, speed: 15 })],
        [
          tc('e1', ['savage_bite'], { attack: 8, speed: 11 }),
          tc('e2', ['arcane_bolt', 'mana_ward'], { magicPower: 9, speed: 13 }),
          tc('e3', ['battle_howl', 'crushing_blow'], { attack: 10, speed: 9 }),
        ],
        { maxTurns: 40 },
      );
    const a = simulate(mk(), 777);
    const b = simulate(mk(), 777);
    expect(a.events).toEqual(b.events);
    expect(a.result).toBe(b.result);
  });
});
