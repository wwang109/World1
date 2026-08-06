import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { powerLevelDeci } from '../../src/engine/balance';
import { skillBook } from '../../src/data/skills';
import { cfg, tc, NO_ENDGAME } from '../helpers';

type Events = ReturnType<typeof simulate>['events'];

describe('special ability riders', () => {
  it('slow makes the enemy next action heavier, once', () => {
    // Hamstring (+16 weight to enemy's next action). Enemy bite is w10.
    const c = cfg(
      tc('hero', ['hamstring'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('foe', ['sword_slash'], { attack: 1, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events, finalState } = simulate(c, 1);
    const enemyPlays = events.filter(
      (event): event is Extract<Events[number], { kind: 'play' }> => event.kind === 'play' && event.side === 'enemy',
    );
    const slowed = enemyPlays.find((event) => event.weight === 26);
    expect(slowed).toBeDefined();
    expect(finalState.enemy.nextWeightPenalty).toBe(0);
  });

  it('disrupt drains the enemy banked readiness', () => {
    // Enemy runs a heavy meteor-ish card, banking readiness; hero disrupts it away.
    const c = cfg(
      tc('hero', ['concussive_shot'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('foe', ['crushing_blow'], { attack: 1, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    const disrupt = events.find((e) => e.kind === 'disrupted');
    expect(disrupt).toBeDefined();
    expect((disrupt as { amount: number }).amount).toBeGreaterThan(0);
  });

  it('lifesteal heals for a percentage of the damage dealt', () => {
    // Leeching Fang: 16 flat + 10 Attack = 26 dealt, 45% lifesteal -> floor(26*0.45)=11.
    const c = cfg(
      tc('hero', ['leeching_fang'], { attack: 10, speed: 20, maxHp: 100, hp: 50 }),
      tc('wall', [], { maxHp: 500, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'heal')).toMatchObject({ side: 'player', amount: 11, hpAfter: 61 });
  });

  it('a lifesteal heal carries NO calculation block — it has no card base to split', () => {
    // Deliberate asymmetry with the `heal` action (documented on the event in
    // src/engine/combat/events.ts): a lifesteal request is a percentage of
    // damage dealt, with no card base, no stat term and no aura term, so
    // reporting `power = stolen` would claim a card base that does not exist.
    // Same contract as damage.calculation, which DoT/fatigue damage omits.
    const c = cfg(
      tc('hero', ['leeching_fang'], { attack: 10, speed: 20, maxHp: 100, hp: 50 }),
      tc('wall', [], { maxHp: 500, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const heal = simulate(c, 1).events.find(
      (e): e is Extract<Events[number], { kind: 'heal' }> => e.kind === 'heal',
    )!;
    expect(heal.amount).toBe(11);
    expect('calculation' in heal).toBe(false);
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
    // The turtle's 10 now sits in ARMOR, not Attack: shields are defensive output
    // (2026-08-04), so Armor is what sizes Bulwark's pool. Armor also MITIGATES, so
    // the hero carries Attack 20 rather than 10 to land the same 52 on arrival.
    const c = cfg(
      tc('hero', ['shield_splitter'], { attack: 20, speed: 10, maxHp: 500 }),
      tc('turtle', ['iron_bulwark'], { attack: 0, armor: 10, speed: 30, maxHp: 200 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    // Bulwark: 48 flat + 10 Armor = 58 physical shield. Splitter shatters 24 of it
    // (shieldBreak magnitude unchanged), leaving 34 shield; then hits 42 flat + 20
    // Attack = 62, −10 Armor = 52: 34 of it is blocked by the shield, 18 lands.
    const broken = events.find((e) => e.kind === 'shieldBroken');
    expect(broken).toMatchObject({ amount: 24, totalAfter: 34 });
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'enemy');
    expect(hit).toMatchObject({ amount: 52, blocked: 34 });
  });

  it('comboBonus triggers only when the previous cast shared an archetype', () => {
    // Board: [sword_slash][follow_through] — both Offense.
    // Turn 1 slash (no combo: nothing cast before), turn 2 follow_through with the flat +20 combo.
    const c = cfg(
      tc('hero', ['sword_slash', 'follow_through'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('wall', [], { maxHp: 500, speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    const hits = events.filter((e) => e.kind === 'damage').map((e) => (e as { amount: number }).amount);
    expect(hits[0]).toBe(30); // sword_slash: 20 flat + 10 Attack
    expect(hits[1]).toBe(40); // follow_through: 10 flat + 10 Attack + 20 combo = 40
  });

  it('rider magnitudes are priced per unit (decimal-precise deci-PL)', () => {
    const base = skillBook['hamstring']!;
    const lighter = { ...base, effects: [base.effects[0]!, { kind: 'slow' as const, weight: 8 }] };
    // 16 -> 40 deci; 8 -> 20 deci: exactly proportional.
    expect(powerLevelDeci(base) - powerLevelDeci(lighter)).toBe(20);
  });
});
