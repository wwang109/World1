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
    expect(firstDamage(simulate(c, 1).events)).toMatchObject({ amount: 27, property: 'physical' }); // 20 flat + 10 Attack − 3 armor
  });

  it('magical damage scales off Magic Power and is reduced by Magic Resist', () => {
    const c = cfg(
      tc('hero', ['arcane_bolt'], { attack: 0, magicPower: 10, speed: 20 }),
      tc('wall', [], { armor: 99, magicResist: 4, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    expect(firstDamage(simulate(c, 1).events)).toMatchObject({ amount: 24, property: 'magical' }); // 18 flat + 10 MP − 4 resist
  });

  it('true damage: the flat base bypasses defenses; the stat add is mitigated by the matching defense', () => {
    // Higher stat is Magic Power (20), so the stat add is checked against
    // Magic Resist. MR 99 eats the whole stat add but can never touch the
    // flat 27 — that part only a TRUE shield can stop.
    const c = cfg(
      tc('hero', ['soul_rend'], { attack: 5, magicPower: 20, speed: 30 }),
      tc('wall', [], { armor: 99, magicResist: 99, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    expect(firstDamage(simulate(c, 1).events)).toMatchObject({ amount: 27, property: 'true' }); // 27 flat + max(0, 20 stat − 99 MR)
  });

  it('true damage: partial defense shaves only part of the stat add', () => {
    const c = cfg(
      tc('hero', ['soul_rend'], { attack: 5, magicPower: 20, speed: 30 }),
      tc('wall', [], { armor: 99, magicResist: 8, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    expect(firstDamage(simulate(c, 1).events)).toMatchObject({ amount: 39, property: 'true' }); // 27 flat + (20 stat − 8 MR)
  });

  it('crits multiply by 1.5 (floored)', () => {
    // Crit CHANCE is hard-capped at CRIT_CHANCE_CAP_PCT (50%), so even critPct 100
    // is a coin flip — seed 7 lands the crit here. The math under test is the
    // ×1.5 multiplier: floor(27 * 1.5) = 40.
    const c = cfg(
      tc('hero', ['sword_slash'], { attack: 10, critPct: 100, speed: 20 }),
      tc('wall', [], { armor: 3, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    expect(firstDamage(simulate(c, 7).events)).toMatchObject({ amount: 40, crit: true });
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
      effects: [{ kind: 'shield', power: 20 }],
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
      effects: [{ kind: 'damage', power: 10 }],
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
    true_wall_small: {
      id: 'true_wall_small',
      name: 'Small True Wall',
      archetypes: ['defensive'],
      property: 'true',
      size: 1,
      speedWeight: 1,
      rarity: 'epic',
      tier: 'bronze',
      effects: [{ kind: 'shield', power: 30 }],
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
    expect(hit).toMatchObject({ amount: 20, blocked: 0, hpAfter: 60 }); // magical hit (10 flat + 10 MP) ignores physical shield
  });

  it('a True shield blocks every damage type', () => {
    const c = cfg(
      tc('hero', ['magic_bolt'], { magicPower: 10, speed: 10 }, { skillBook: shieldBook }),
      tc('turtle', ['true_wall', 'bite'], { attack: 10, speed: 11, maxHp: 80 }, { skillBook: shieldBook }),
      { ...NO_ENDGAME, skillBook: shieldBook, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'enemy');
    expect(hit).toMatchObject({ amount: 20, blocked: 20, hpAfter: 80 }); // 20 magical fully absorbed — the 50 TRUE pool drains 40 (2:1 vs typed)
  });

  it('typed damage drains a True shield 2:1 (half effectiveness)', () => {
    // 30 TRUE shield vs a 20 magical hit: the whole 30 pool is spent but only
    // blocks floor(30/2) = 15 — the remaining 5 lands. (TRUE damage would have
    // been blocked point-for-point.)
    const c = cfg(
      tc('hero', ['magic_bolt'], { magicPower: 10, speed: 10 }, { skillBook: shieldBook }),
      tc('turtle', ['true_wall_small', 'bite'], { attack: 10, speed: 11, maxHp: 80 }, { skillBook: shieldBook }),
      { ...NO_ENDGAME, skillBook: shieldBook, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'enemy');
    expect(hit).toMatchObject({ amount: 20, blocked: 15, hpAfter: 75 });
  });

  it('shields stack, carry over, and are capped at max HP', () => {
    const c = cfg(
      tc('turtle', ['phys_wall'], { attack: 30, speed: 20, maxHp: 80 }, { skillBook: shieldBook }),
      tc('dummy', [], { speed: 10 }, { skillBook: shieldBook }),
      { ...NO_ENDGAME, skillBook: shieldBook, maxTurns: 4 },
    );
    const { events, finalState } = simulate(c, 1);
    // Each cast requests 20 flat + 30 Attack = 50; cap is maxHp 80: 50, then 30 (20 wasted), then 0.
    const gains = events.filter((e) => e.kind === 'shieldGain') as Extract<Events[number], { kind: 'shieldGain' }>[];
    expect(gains[0]).toMatchObject({ amount: 50, wasted: 0, totalAfter: 50 });
    expect(gains[1]).toMatchObject({ amount: 30, wasted: 20, totalAfter: 80 });
    expect(finalState.player.shields.physical).toBe(80);
    // Readiness pays for later casts even when the shield is already capped.
    const casts = events.filter((e) => e.kind === 'skillCast' && e.side === 'player');
    expect(casts.length).toBe(4);
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
    expect(events.find((e) => e.kind === 'heal')).toMatchObject({ amount: 50, flat: true, hpAfter: 100 });
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
        effects: [{ kind: 'poison', stacks: 5 }],
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
    // Re-applications merge into one growing pile; whatever the tick size,
    // poison is NEVER blocked by the shield.
    for (const tick of poisonTicks) {
      expect(tick).toMatchObject({ blocked: 0 });
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
        effects: [{ kind: 'burn', stacks: 6 }],
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
    // Halving burn: first tick = 2 × the 6-stack pile = 12, fully absorbed by the shield.
    expect(burnTick).toMatchObject({ amount: 12, blocked: 12, hpAfter: 60 });
  });

  it('a 5-stack poison decays 5,4,3,2,1 then expires', () => {
    const book: SkillBook = {
      poison_once: {
        id: 'poison_once',
        name: 'Poison Once',
        archetypes: ['debuff'],
        property: 'physical',
        size: 1,
        speedWeight: 10,
        cooldownTurns: 50, // apply exactly once
        rarity: 'common',
        tier: 'bronze',
        effects: [{ kind: 'poison', stacks: 5 }],
        text: '',
      },
    };
    const c = cfg(
      tc('hero', ['poison_once'], { speed: 20, maxHp: 500 }, { skillBook: book }),
      tc('victim', [], { maxHp: 500, speed: 10 }, { skillBook: book }),
      { ...NO_ENDGAME, skillBook: book, maxTurns: 8, cooldownsEnabled: true },
    );
    const { events } = simulate(c, 1);
    const ticks = events.filter((e) => e.kind === 'damage' && (e as { source: string }).source === 'poison');
    expect(ticks.map((t) => (t as { amount: number }).amount)).toEqual([5, 4, 3, 2, 1]);
    // Applied turn 1 (fresh, skips), ticks end of turns 2-6, expires with the last stack.
    const expiry = events.find((e) => e.kind === 'statusExpired' && (e as { status: string }).status === 'poison');
    expect(expiry).toBeDefined();
    expect((expiry as { turn: number }).turn).toBe(6);
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
    // Bruiser hits while -25% attack: 20 flat + floor(10*0.75)=7 -> 27 (0 armor).
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'player');
    expect(hit).toMatchObject({ amount: 27 });
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
