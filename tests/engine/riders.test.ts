import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { powerLevelDeci } from '../../src/engine/balance';
import { skillBook } from '../../src/data/skills';
import { cfg, tc, NO_ENDGAME } from '../helpers';

type Events = ReturnType<typeof simulate>['events'];

function comparisons(events: Events) {
  return events.filter((e) => e.kind === 'comparison') as Extract<Events[number], { kind: 'comparison' }>[];
}

describe('special ability riders', () => {
  it('slowNext makes the enemy next action heavier, once', () => {
    // Hamstring (+16 weight to enemy's next action). Enemy bite is w10.
    const c = cfg(
      tc('hero', ['hamstring'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('foe', ['sword_slash'], { attack: 1, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    const cmps = comparisons(events);
    // Find the first comparison after the hero's first cast: enemy weight 10+16=26.
    const slowed = cmps.find((e) => e.enemy.state === 'ready' && e.enemy.weight === 26);
    expect(slowed).toBeDefined();
    // The penalty is consumed by the enemy's next performance — later
    // comparisons show base weight again.
    const after = cmps.filter((e) => e.turn > slowed!.turn && e.enemy.state === 'ready');
    expect(after.some((e) => e.enemy.weight === 10)).toBe(true);
  });

  it('stagger drains the enemy banked readiness', () => {
    // Enemy runs a heavy meteor-ish card, banking readiness; hero staggers it away.
    const c = cfg(
      tc('hero', ['concussive_shot'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('foe', ['crushing_blow'], { attack: 1, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    const stagger = events.find((e) => e.kind === 'staggered');
    expect(stagger).toBeDefined();
    expect((stagger as { amount: number }).amount).toBeGreaterThan(0);
  });

  it('lifesteal heals for a percentage of the damage dealt', () => {
    // Leeching Fang: 160% of 10 = 16 dealt, 45% lifesteal -> heal 7.
    const c = cfg(
      tc('hero', ['leeching_fang'], { attack: 10, speed: 20, maxHp: 100, hp: 50 }),
      tc('wall', [], { maxHp: 500, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'heal')).toMatchObject({ side: 'player', amount: 7, hpAfter: 57 });
  });

  it('lifesteal only counts damage that reached HP', () => {
    // Enemy shields first; the blocked portion must not heal the attacker.
    const c = cfg(
      tc('hero', ['leeching_fang'], { attack: 10, speed: 10, maxHp: 100, hp: 50 }),
      tc('turtle', ['iron_bulwark'], { attack: 20, speed: 30, maxHp: 200 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    // Bulwark shields 52 physical; the 16-damage fang is fully blocked -> no heal.
    expect(events.find((e) => e.kind === 'heal' && e.side === 'player')).toBeUndefined();
  });

  it('shieldBreak strips shields before the hit lands', () => {
    const c = cfg(
      tc('hero', ['shield_splitter'], { attack: 10, speed: 10, maxHp: 500 }),
      tc('turtle', ['iron_bulwark'], { attack: 10, speed: 30, maxHp: 200 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    // Bulwark: 260% of 10 = 26 physical shield. Splitter shatters 24 of it,
    // then hits 200% of 10 = 20: only 2 shield left to block.
    const broken = events.find((e) => e.kind === 'shieldBroken');
    expect(broken).toMatchObject({ amount: 24, totalAfter: 2 });
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'enemy');
    expect(hit).toMatchObject({ amount: 20, blocked: 2 });
  });

  it('comboBonus triggers only when the previous cast shared an archetype', () => {
    // Board: [sword_slash][follow_through] — both Offense.
    // Turn 1 slash (no combo: nothing cast before), turn 2 follow_through with +150%.
    const c = cfg(
      tc('hero', ['sword_slash', 'follow_through'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('wall', [], { maxHp: 500, speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    const hits = events.filter((e) => e.kind === 'damage').map((e) => (e as { amount: number }).amount);
    expect(hits[0]).toBe(20); // slash 200%
    expect(hits[1]).toBe(25); // follow_through 100% * 2.50 = 25 (floored)
  });

  it('rider magnitudes are priced per unit (decimal-precise deci-PL)', () => {
    const base = skillBook['hamstring']!;
    const lighter = { ...base, effects: [base.effects[0]!, { kind: 'slowNext' as const, weight: 8 }] };
    // 16 -> 40 deci; 8 -> 20 deci: exactly proportional.
    expect(powerLevelDeci(base) - powerLevelDeci(lighter)).toBe(20);
  });
});
