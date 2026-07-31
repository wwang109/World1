import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { CombatEvent } from '../../src/engine/combat/events';
import type { SkillBook } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

/**
 * BLEED TICKS AT MOST ONCE PER GLOBAL TURN (user-locked 2026-07-31).
 *
 * Bleed is perform-gated: it only draws blood on a turn the victim actually
 * RESOLVES a cast — never on a wait (cantAfford / cooling / noCards), never on a
 * stun-skipped performance, never on a mid-span busy turn. That already makes it
 * strictly weaker than poison (which ticks every turn unconditionally). The rule
 * these tests pin down is the extra cap: the resolve loop can give one unit
 * SEVERAL casts inside a single global turn, and bleed fires only on the FIRST of
 * them.
 */

type Events = ReturnType<typeof simulate>['events'];
type DamageEvent = Extract<CombatEvent, { kind: 'damage' }>;

const B: SkillBook = {
  // Applies bleed to the foe. No shield anywhere, so application always lands.
  bleed10: {
    id: 'bleed10',
    name: 'Bleed 10',
    archetypes: ['debuff'],
    property: 'physical',
    size: 1,
    speedWeight: 1,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'bleed', stacks: 10 }],
    text: '',
  },
  // Bleed + a long stun, so the victim is bleeding AND never performs.
  bleed_stun: {
    id: 'bleed_stun',
    name: 'Bleed + Stun',
    archetypes: ['debuff'],
    property: 'physical',
    size: 1,
    speedWeight: 1,
    rarity: 'common',
    tier: 'bronze',
    effects: [
      { kind: 'bleed', stacks: 10 },
      { kind: 'stun', turns: 6 },
    ],
    text: '',
  },
  // Cheap, near-harmless pokes. Two distinct ids so a unit can own two pieces
  // and thus resolve TWO casts inside one global turn.
  poke_a: {
    id: 'poke_a',
    name: 'Poke A',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight: 1,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 0 }],
    text: '',
  },
  poke_b: {
    id: 'poke_b',
    name: 'Poke B',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight: 1,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 0 }],
    text: '',
  },
  // Unaffordable at the speeds used below: its owner waits forever (cantAfford).
  too_heavy: {
    id: 'too_heavy',
    name: 'Too Heavy',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight: 500,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 0 }],
    text: '',
  },
  // Size 3: casting it busies its caster for the next two global turns.
  span3: {
    id: 'span3',
    name: 'Span 3',
    archetypes: ['offense'],
    property: 'physical',
    size: 3,
    speedWeight: 1,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 0 }],
    text: '',
  },
  shield_self: {
    id: 'shield_self',
    name: 'Shield',
    archetypes: ['defensive'],
    property: 'true',
    size: 1,
    speedWeight: 1,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'shield', power: 40 }],
    text: '',
  },
};

const OPT = { ...NO_ENDGAME, skillBook: B } as const;

/** Bleed ticks on the victim (always the enemy side in these fixtures). */
function bleeds(events: Events): DamageEvent[] {
  return events.filter(
    (e): e is DamageEvent => e.kind === 'damage' && e.side === 'enemy' && e.source === 'bleed',
  );
}

function countByTurn(list: { turn: number }[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const e of list) counts.set(e.turn, (counts.get(e.turn) ?? 0) + 1);
  return counts;
}

function enemyPlaysOn(events: Events, turn: number): number {
  return events.filter((e) => e.kind === 'play' && e.side === 'enemy' && e.turn === turn).length;
}

describe('bleed ticks at most once per global turn', () => {
  it('a unit that resolves TWO casts in one turn bleeds exactly ONCE that turn', () => {
    // Hero: Speed 1, one weight-1 bleed card -> exactly one cast per turn.
    // Foe: Speed 10, TWO weight-1 pieces -> it resolves both every turn (each
    // piece may play once per turn), i.e. two casts per global turn.
    const c = cfg(
      tc('hero', ['bleed10'], { attack: 0, speed: 1, maxHp: 100_000 }, { skillBook: B }),
      tc('foe', ['poke_a', 'poke_b'], { attack: 0, speed: 10, maxHp: 100_000 }, { skillBook: B }),
      { ...OPT, maxTurns: 5 },
    );
    const { events } = simulate(c, 1);

    // The setup really is a multi-caster: two plays on every turn.
    for (const turn of [1, 2, 3, 4, 5]) expect(enemyPlaysOn(events, turn)).toBe(2);

    const perTurn = countByTurn(bleeds(events));
    // Turn 1: bleed is `fresh` (applied this turn) -> no tick at all.
    expect(perTurn.get(1) ?? 0).toBe(0);
    // Turns 2..5: exactly ONE tick each, despite TWO casts each.
    // (Before the fix this was 2 per turn — the regression this test exists for.)
    for (const turn of [2, 3, 4, 5]) expect(perTurn.get(turn)).toBe(1);
    expect(bleeds(events).length).toBe(4);
  });

  it('the single tick lands on the FIRST resolved cast of the turn', () => {
    const c = cfg(
      tc('hero', ['bleed10'], { attack: 0, speed: 1, maxHp: 100_000 }, { skillBook: B }),
      tc('foe', ['poke_a', 'poke_b'], { attack: 0, speed: 10, maxHp: 100_000 }, { skillBook: B }),
      { ...OPT, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    const turn2 = events.filter((e) => e.turn === 2 && 'side' in e && e.side === 'enemy');
    const kinds = turn2.map((e) => e.kind);
    const firstPlay = kinds.indexOf('play');
    const secondPlay = kinds.indexOf('play', firstPlay + 1);
    const bleedAt = turn2.findIndex((e) => e.kind === 'damage' && e.source === 'bleed');
    expect(firstPlay).toBeGreaterThanOrEqual(0);
    expect(secondPlay).toBeGreaterThan(firstPlay);
    // The tick belongs to the FIRST cast: after its play, before the second one.
    expect(bleedAt).toBeGreaterThan(firstPlay);
    expect(bleedAt).toBeLessThan(secondPlay);
  });

  it('keeps its position in the sequence: after the cast own effects, before the `cost` event', () => {
    const c = cfg(
      tc('hero', ['bleed10'], { attack: 0, speed: 1, maxHp: 100_000 }, { skillBook: B }),
      tc('foe', ['poke_a'], { attack: 7, speed: 10, maxHp: 100_000 }, { skillBook: B }),
      { ...OPT, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    // Enemy's turn-2 slice: play -> its own skill damage (on the hero) -> bleed
    // tick (on itself) -> cost.
    const slice = events.filter(
      (e) =>
        e.turn === 2 &&
        ((e.kind === 'play' && e.side === 'enemy') ||
          (e.kind === 'damage' && (e.source === 'skill' || e.source === 'bleed')) ||
          (e.kind === 'cost' && e.side === 'enemy')),
    );
    const tags = slice.map((e) => (e.kind === 'damage' ? `damage:${e.source}:${e.side}` : e.kind));
    expect(tags).toEqual(['play', 'damage:skill:player', 'damage:bleed:enemy', 'cost']);
  });

  it('a unit casting ONCE per turn still bleeds once per turn, decaying by one stack', () => {
    // Foe: Speed 10, a single weight-1 piece -> exactly one cast per turn.
    const c = cfg(
      tc('hero', ['bleed10'], { attack: 0, speed: 1, maxHp: 100_000 }, { skillBook: B }),
      tc('foe', ['poke_a'], { attack: 0, speed: 10, maxHp: 100_000 }, { skillBook: B }),
      { ...OPT, maxTurns: 4 },
    );
    const { events } = simulate(c, 1);
    for (const turn of [1, 2, 3, 4]) expect(enemyPlaysOn(events, turn)).toBe(1);
    const perTurn = countByTurn(bleeds(events));
    expect(perTurn.get(1) ?? 0).toBe(0); // fresh on its application turn
    for (const turn of [2, 3, 4]) expect(perTurn.get(turn)).toBe(1);
    // The foe (Speed 10) performs before the hero (Speed 1) every turn, so each
    // turn is: tick, then +10 stacks merge in. Pile 10 -> tick 10, 9 left, +10 =
    // 19 -> tick 19, 18 left, +10 = 28 -> tick 28. Exactly ONE stack falls off per
    // turn, so the amounts are exact integers and prove a single tick each turn.
    expect(bleeds(events).map((e) => e.amount)).toEqual([10, 19, 28]);
  });

  it('a unit that only ever WAITS (cantAfford) never bleeds', () => {
    const c = cfg(
      tc('hero', ['bleed10'], { attack: 0, speed: 1, maxHp: 100_000 }, { skillBook: B }),
      tc('foe', ['too_heavy'], { attack: 0, speed: 1, maxHp: 100_000 }, { skillBook: B }),
      { ...OPT, maxTurns: 8 },
    );
    const { events, finalState } = simulate(c, 1);
    expect(events.some((e) => e.kind === 'wait' && e.side === 'enemy' && e.reason === 'cantAfford')).toBe(true);
    expect(enemyPlaysOn(events, 8)).toBe(0);
    expect(bleeds(events).length).toBe(0);
    // The pile is intact — it never ticked, so no stacks fell off.
    const pile = finalState.enemy.statuses.find((s) => s.kind === 'bleed');
    expect(pile?.stacks).toBe(80); // 8 applications of 10, zero ticks
    expect(finalState.enemy.stats.hp).toBe(finalState.enemy.stats.maxHp);
  });

  it('a STUNNED unit never bleeds (a skipped performance is not a cast)', () => {
    const c = cfg(
      tc('hero', ['bleed_stun'], { attack: 0, speed: 20, maxHp: 100_000 }, { skillBook: B }),
      tc('foe', ['poke_a'], { attack: 0, speed: 5, maxHp: 100_000 }, { skillBook: B }),
      { ...OPT, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    expect(events.some((e) => e.kind === 'performSkipped' && e.side === 'enemy' && e.reason === 'stunned')).toBe(true);
    // Turn 1 the stun is still `fresh` so the foe does cast — but bleed is fresh
    // too, so no tick. From turn 2 on it is stun-locked: still no ticks anywhere.
    for (const turn of [2, 3, 4, 5, 6]) expect(enemyPlaysOn(events, turn)).toBe(0);
    expect(bleeds(events).length).toBe(0);
  });

  it('a unit MID-SPAN on a size-3 card takes no bleed on its busy turns', () => {
    const c = cfg(
      tc('hero', ['bleed10'], { attack: 0, speed: 1, maxHp: 100_000 }, { skillBook: B }),
      tc('foe', ['span3'], { attack: 0, speed: 10, maxHp: 100_000 }, { skillBook: B }),
      { ...OPT, maxTurns: 7 },
    );
    const { events } = simulate(c, 1);
    // Cast on 1, busy on 2 & 3, cast on 4, busy on 5 & 6, cast on 7.
    for (const turn of [1, 4, 7]) expect(enemyPlaysOn(events, turn)).toBe(1);
    for (const turn of [2, 3, 5, 6]) {
      expect(enemyPlaysOn(events, turn)).toBe(0);
      expect(events.some((e) => e.kind === 'busy' && e.side === 'enemy' && e.turn === turn)).toBe(true);
    }
    const perTurn = countByTurn(bleeds(events));
    expect(perTurn.get(1) ?? 0).toBe(0); // fresh
    for (const turn of [2, 3, 5, 6]) expect(perTurn.get(turn) ?? 0).toBe(0); // busy
    expect(perTurn.get(4)).toBe(1);
    expect(perTurn.get(7)).toBe(1);
  });

  it('application is still blocked by an active shield, and ticks still bypass shields', () => {
    // Foe shields on turn 1 (Speed 20, weight 1); the hero's bleed lands later
    // and is refused outright by the standing shield pool.
    const blocked = cfg(
      tc('hero', ['bleed10'], { attack: 0, speed: 5, maxHp: 100_000 }, { skillBook: B }),
      tc('foe', ['shield_self'], { attack: 0, magicPower: 0, speed: 20, maxHp: 100_000 }, { skillBook: B }),
      { ...OPT, maxTurns: 4 },
    );
    const blockedRun = simulate(blocked, 1);
    expect(blockedRun.finalState.enemy.statuses.some((s) => s.kind === 'bleed')).toBe(false);
    expect(bleeds(blockedRun.events).length).toBe(0);
    expect(blockedRun.finalState.enemy.shields.true).toBeGreaterThan(0);

    // Same fixture with the shield card swapped for a poke: bleed lands, and its
    // ticks are unblocked (no shield to bypass here — the bypass itself is
    // covered by bleedExpose.test.ts, which shields AFTER application).
    const landing = cfg(
      tc('hero', ['bleed10'], { attack: 0, speed: 5, maxHp: 100_000 }, { skillBook: B }),
      tc('foe', ['poke_a'], { attack: 0, speed: 20, maxHp: 100_000 }, { skillBook: B }),
      { ...OPT, maxTurns: 4 },
    );
    const landingRun = simulate(landing, 1);
    expect(bleeds(landingRun.events).length).toBeGreaterThan(0);
    expect(bleeds(landingRun.events).every((e) => e.blocked === 0)).toBe(true);
  });

  it('is deterministic: identical logs across seeds for the multi-cast fixture', () => {
    const build = () =>
      cfg(
        tc('hero', ['bleed10'], { attack: 0, speed: 1, maxHp: 100_000 }, { skillBook: B }),
        tc('foe', ['poke_a', 'poke_b'], { attack: 0, speed: 10, maxHp: 100_000 }, { skillBook: B }),
        { ...OPT, maxTurns: 6 },
      );
    const logs = new Set<string>();
    for (let seed = 0; seed < 6; seed += 1) logs.add(JSON.stringify(simulate(build(), seed).events));
    expect(logs.size).toBe(1);
  });
});
