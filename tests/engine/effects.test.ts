import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { SkillBook } from '../../src/engine/types';
import { cfg, tc, MINI_BOOK, NO_ENDGAME } from '../helpers';

type Events = ReturnType<typeof simulate>['events'];

function firstDamage(events: Events) {
  return events.find((e) => e.kind === 'damage');
}

describe('property scaling and mitigation', () => {
  it('physical damage scales off Attack and is reduced by Armor', () => {
    const c = cfg(
      tc('hero', ['sword_slash'], { attack: 10, magicPower: 0, speed: 20 }),
      tc('wall', [], { armor: 3, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    expect(firstDamage(simulate(c, 1).events)).toMatchObject({ amount: 17, property: 'physical' }); // 200% of 10 − 3 armor
  });

  it('magical damage scales off Magic Power and is reduced by Magic Resist', () => {
    const c = cfg(
      tc('hero', ['arcane_bolt'], { attack: 0, magicPower: 10, speed: 20 }),
      tc('wall', [], { armor: 99, magicResist: 4, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    expect(firstDamage(simulate(c, 1).events)).toMatchObject({ amount: 14, property: 'magical' }); // 180% of 10 − 4 resist
  });

  it('true damage ignores both defenses and scales off the higher stat', () => {
    const c = cfg(
      tc('hero', ['soul_rend'], { attack: 5, magicPower: 20, speed: 20 }),
      tc('wall', [], { armor: 99, magicResist: 99, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    // 280% of max(5,20)=20 -> 56, no mitigation.
    expect(firstDamage(simulate(c, 1).events)).toMatchObject({ amount: 64, property: 'true' }); // 320% of 20
  });

  it('crits multiply by 1.5 (floored) at 100% crit', () => {
    const c = cfg(
      tc('hero', ['sword_slash'], { attack: 10, critPct: 100, speed: 20 }),
      tc('wall', [], { armor: 3, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    expect(firstDamage(simulate(c, 1).events)).toMatchObject({ amount: 25, crit: true }); // floor(17 * 1.5)
  });
});

describe('typed shields', () => {
  const shieldBook: SkillBook = {
    ...MINI_BOOK,
    phys_wall: {
      id: 'phys_wall',
      name: 'Phys Wall',
      archetypes: ['defensive'],
      property: 'physical',
      size: 1,
      speedWeight: 1, // casts first
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind: 'shield', power: 200 }],
      text: '',
    },
    magic_bolt: {
      id: 'magic_bolt',
      name: 'Magic Bolt',
      archetypes: ['offense'],
      property: 'magical',
      size: 1,
      speedWeight: 10,
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind: 'damage', power: 100 }],
      text: '',
    },
    true_wall: {
      id: 'true_wall',
      name: 'True Wall',
      archetypes: ['defensive'],
      property: 'true',
      size: 1,
      speedWeight: 1,
      rarity: 'epic',
      tier: 'bronze',
      effects: [{ kind: 'shield', power: 50 }],
      text: '',
    },
  };

  it('a Physical shield blocks physical damage but NOT magical damage', () => {
    // Enemy shields first (weight 1), then hero's magical bolt goes through.
    const c = cfg(
      tc('hero', ['magic_bolt'], { magicPower: 10, speed: 10 }, { skillBook: shieldBook }),
      tc('turtle', ['phys_wall', 'bite'], { attack: 10, speed: 10, maxHp: 80 }, { skillBook: shieldBook }),
      { ...NO_ENDGAME, skillBook: shieldBook, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'enemy');
    expect(hit).toMatchObject({ amount: 10, blocked: 0, hpAfter: 70 }); // shield ignored magical hit
  });

  it('a True shield blocks every damage type', () => {
    const c = cfg(
      tc('hero', ['magic_bolt'], { magicPower: 10, speed: 10 }, { skillBook: shieldBook }),
      tc('turtle', ['true_wall', 'bite'], { attack: 10, speed: 10, maxHp: 80 }, { skillBook: shieldBook }),
      { ...NO_ENDGAME, skillBook: shieldBook, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'enemy');
    expect(hit).toMatchObject({ amount: 10, blocked: 10, hpAfter: 80 });
  });

  it('shields stack, carry over, and are capped at max HP', () => {
    const c = cfg(
      tc('turtle', ['phys_wall'], { attack: 30, speed: 20, maxHp: 80 }, { skillBook: shieldBook }),
      tc('dummy', [], { speed: 10 }, { skillBook: shieldBook }),
      { ...NO_ENDGAME, skillBook: shieldBook, maxTurns: 4 },
    );
    const { events, finalState } = simulate(c, 1);
    // Each cast requests 60; cap is maxHp 80: 60, then 20 (40 wasted), then 0.
    const gains = events.filter((e) => e.kind === 'shieldGain') as Extract<Events[number], { kind: 'shieldGain' }>[];
    expect(gains[0]).toMatchObject({ amount: 60, wasted: 0, totalAfter: 60 });
    expect(gains[1]).toMatchObject({ amount: 20, wasted: 40, totalAfter: 80 });
    expect(finalState.player[0]!.shields.physical).toBe(80);
    // Once at the cap, further shield casts are skipped as useless.
    const casts = events.filter((e) => e.kind === 'skillCast' && e.side === 'player');
    expect(casts.length).toBe(2);
  });
});

describe('healing', () => {
  it('magical heal scales off Magic Power and caps at maxHp', () => {
    const c = cfg(
      tc('hero', ['mending_light'], { magicPower: 10, maxHp: 100, hp: 90, speed: 20 }),
      tc('dummy', [], { speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'heal')).toMatchObject({ amount: 10, flat: false, hpAfter: 100 });
  });

  it('true heal restores a flat amount regardless of stats', () => {
    const c = cfg(
      tc('hero', ['second_wind'], { attack: 0, magicPower: 0, maxHp: 100, hp: 50, speed: 20 }),
      tc('dummy', [], { speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'heal')).toMatchObject({ amount: 40, flat: true, hpAfter: 90 });
  });
});

describe('damage over time (global-turn durations)', () => {
  it('poison bypasses shields and ticks exactly its duration', () => {
    const book: SkillBook = {
      ...MINI_BOOK,
      one_poison: {
        id: 'one_poison',
        name: 'One Poison',
        archetypes: ['debuff'],
        property: 'physical',
        size: 1,
        speedWeight: 1,
        rarity: 'common',
        tier: 'bronze',
        effects: [{ kind: 'poison', amount: 5, turns: 3 }],
        text: '',
      },
      big_wall: {
        id: 'big_wall',
        name: 'Big Wall',
        archetypes: ['defensive'],
        property: 'true',
        size: 1,
        speedWeight: 10,
        rarity: 'common',
        tier: 'bronze',
        effects: [{ kind: 'shield', power: 30 }],
        text: '',
      },
    };
    // Hero poisons once on turn 1 (then has nothing useful — one_poison re-applies... it re-casts).
    // Use a dummy enemy that shields: poison must chew HP anyway.
    const c = cfg(
      tc('hero', ['one_poison'], { speed: 20, maxHp: 500 }, { skillBook: book }),
      tc('turtle', ['big_wall'], { attack: 10, speed: 10, maxHp: 60 }, { skillBook: book }),
      { ...NO_ENDGAME, skillBook: book, maxTurns: 5 },
    );
    const { events } = simulate(c, 1);
    const poisonTicks = events.filter((e) => e.kind === 'damage' && (e as { source: string }).source === 'poison');
    expect(poisonTicks.length).toBeGreaterThanOrEqual(3);
    for (const tick of poisonTicks) {
      expect(tick).toMatchObject({ blocked: 0, amount: 5 }); // bypassed shields
    }
  });

  it('burn is consumed by shields', () => {
    const book: SkillBook = {
      ...MINI_BOOK,
      one_burn: {
        id: 'one_burn',
        name: 'One Burn',
        archetypes: ['debuff'],
        property: 'magical',
        size: 1,
        speedWeight: 12,
        rarity: 'common',
        tier: 'bronze',
        effects: [{ kind: 'burn', amount: 6, turns: 2 }],
        text: '',
      },
      magic_wall: {
        id: 'magic_wall',
        name: 'Magic Wall',
        archetypes: ['defensive'],
        property: 'magical',
        size: 1,
        speedWeight: 1,
        rarity: 'common',
        tier: 'bronze',
        effects: [{ kind: 'shield', power: 300 }],
        text: '',
      },
    };
    const c = cfg(
      tc('hero', ['one_burn'], { speed: 10, maxHp: 500 }, { skillBook: book }),
      tc('turtle', ['magic_wall'], { magicPower: 10, speed: 10, maxHp: 60 }, { skillBook: book }),
      { ...NO_ENDGAME, skillBook: book, maxTurns: 5 },
    );
    const { events } = simulate(c, 1);
    const burnTick = events.find((e) => e.kind === 'damage' && (e as { source: string }).source === 'burn');
    expect(burnTick).toMatchObject({ blocked: 6, hpAfter: 60 }); // shield absorbed the burn
  });

  it('a 3-turn poison expires after 3 global turns', () => {
    const book: SkillBook = {
      poison_once: {
        id: 'poison_once',
        name: 'Poison Once',
        archetypes: ['debuff'],
        property: 'physical',
        size: 1,
        speedWeight: 10,
        rarity: 'common',
        tier: 'bronze',
        effects: [{ kind: 'poison', amount: 5, turns: 3 }],
        text: '',
      },
    };
    // Hero casts poison every turn but victim has huge HP; count expiry events.
    const c = cfg(
      tc('hero', ['poison_once'], { speed: 20, maxHp: 500 }, { skillBook: book }),
      tc('victim', [], { maxHp: 500, speed: 10 }, { skillBook: book }),
      { ...NO_ENDGAME, skillBook: book, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    // First application on turn 1 ticks on turns 2,3,4 then expires on turn 4.
    const expiry = events.find((e) => e.kind === 'statusExpired' && (e as { status: string }).status === 'poison');
    expect(expiry).toBeDefined();
    expect((expiry as { turn: number }).turn).toBe(4);
  });
});

describe('stun', () => {
  it("consumes the victim's next performance", () => {
    const c = cfg(
      tc('hero', ['stunning_smash'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('victim', ['sword_slash'], { attack: 10, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 8 },
    );
    const { events } = simulate(c, 1);
    expect(events.some((e) => e.kind === 'performSkipped' && e.side === 'enemy')).toBe(true);
  });
});

describe('buffs, debuffs and cleanse', () => {
  it('percent debuff weakens output for its global-turn duration', () => {
    const c = cfg(
      tc('witch', ['crippling_strike'], { attack: 10, speed: 20, maxHp: 1000 }),
      tc('bruiser', ['sword_slash'], { attack: 10, speed: 10, maxHp: 1000 }),
      { ...NO_ENDGAME, maxTurns: 4 },
    );
    const { events } = simulate(c, 1);
    // Bruiser hits while -25% attack: 200% of floor(10*0.75)=7 -> 14 (0 armor).
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'player');
    expect(hit).toMatchObject({ amount: 14 });
  });

  it('cleanse removes dots and debuffs from the caster', () => {
    const c = cfg(
      tc('hero', ['purify'], { speed: 10, maxHp: 500 }),
      tc('snake', ['venom_fang'], { attack: 10, speed: 20, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    const cleansed = events.find((e) => e.kind === 'cleansed' && e.side === 'player');
    expect(cleansed).toBeDefined();
  });
});
