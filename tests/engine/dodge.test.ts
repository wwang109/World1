import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { enchantBook } from '../../src/data/enchants';
import type { CombatConfig } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

type Events = ReturnType<typeof simulate>['events'];

function dodges(events: Events) {
  return events.filter((e) => e.kind === 'dodged') as Extract<Events[number], { kind: 'dodged' }>[];
}

function playerDamage(events: Events) {
  return events.filter((e) => e.kind === 'damage' && e.side === 'player') as Extract<Events[number], { kind: 'damage' }>[];
}

describe('dodge (Sidestep) — one charge evades one whole physical card', () => {
  it('negates entire physical actions, one charge per card', () => {
    // Hero casts Sidestep first (Speed 20 beats 10); the foe's slashes whiff
    // card by card. Once both charges are spent, Sidestep reads as useful
    // again and the hero re-guards — a wall vs single-target physical ONLY
    // (magic/AoE/DoTs break it, and it has no clock: sudden death wins).
    const c = cfg(
      tc('dancer', ['sidestep'], { speed: 20, maxHp: 500 }),
      tc('bruiser', ['sword_slash'], { attack: 10, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 8 },
    );
    const { events } = simulate(c, 1);
    const d = dodges(events);
    expect(d.length).toBeGreaterThanOrEqual(2);
    expect(d.slice(0, 2).map((e) => e.hitsLeft)).toEqual([1, 0]);
    expect(playerDamage(events).some((e) => e.source === 'skill')).toBe(false);
  });

  it('one charge swallows ALL hits of a multi-hit card', () => {
    // Flurry of Knives (3 strikes) against a dodger: a single charge dodges
    // the whole card — zero strikes land, exactly one dodged event.
    const c = cfg(
      tc('dancer', ['sidestep'], { speed: 20, maxHp: 500 }),
      tc('knifer', ['flurry_of_knives'], { attack: 10, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    expect(dodges(events)).toHaveLength(1);
    expect(playerDamage(events).some((e) => e.source === 'skill')).toBe(false);
  });

  it('a dodged card loses its riders too', () => {
    // Concussive Shot (damage + stagger) is dodged wholesale: no damage AND
    // no stagger drains the dodger's bank.
    const c = cfg(
      tc('dancer', ['sidestep'], { speed: 20, maxHp: 500 }),
      tc('archer', ['concussive_shot'], { attack: 10, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    expect(dodges(events).length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.kind === 'staggered' && e.side === 'player')).toBe(false);
    expect(playerDamage(events).some((e) => e.source === 'skill')).toBe(false);
  });

  it('a physical card with no hostile piece consumes no charge', () => {
    // The foe's Iron Bulwark (physical property, self shield) is not an
    // attack — the dodge guard must ignore it and stay armed for the slash.
    const c = cfg(
      tc('dancer', ['sidestep'], { speed: 20, maxHp: 500 }),
      tc('turtle', ['iron_bulwark', 'sword_slash'], { attack: 10, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    // Bulwark still resolves (their shield appears), then the slash is dodged.
    expect(events.some((e) => e.kind === 'shieldGain' && e.side === 'enemy')).toBe(true);
    expect(dodges(events).length).toBeGreaterThanOrEqual(1);
    expect(playerDamage(events).some((e) => e.source === 'skill')).toBe(false);
  });

  it('magic connects straight through a dodge', () => {
    const c = cfg(
      tc('dancer', ['sidestep'], { speed: 20, maxHp: 500 }),
      tc('mage', ['arcane_bolt'], { magicPower: 10, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 4 },
    );
    const { events } = simulate(c, 1);
    expect(dodges(events)).toHaveLength(0);
    expect(playerDamage(events).some((e) => e.source === 'skill')).toBe(true);
  });

  it('AoE strikes cannot be dodged', () => {
    // The foe's slash carries Storm Mark: even against a lone dodging hero,
    // the AoE action connects (you cannot sidestep a storm).
    const c: CombatConfig = {
      player: tc('dancer', ['sidestep'], { speed: 20, maxHp: 500 }),
      enemy: {
        ...tc('storm', [], { attack: 10, speed: 10, maxHp: 500 }),
        pieces: [{ skillId: 'sword_slash', slot: 0, enchant: 'storm_mark' }],
        boardSize: 10,
      },
      skillBook,
      enchantBook,
      ...NO_ENDGAME,
      maxTurns: 4,
    };
    const { events } = simulate(c, 1);
    expect(dodges(events)).toHaveLength(0);
    expect(playerDamage(events).some((e) => e.source === 'skill')).toBe(true);
  });

  it('unspent charges drop when the dodger next acts — dodge rewards going first', () => {
    // [Sidestep][Sword Slash]: the hero casts Sidestep, then its own slash
    // next turn wipes the guard before the slow foe ever swings.
    const c = cfg(
      tc('dancer', ['sidestep', 'sword_slash'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('bruiser', ['sword_slash'], { attack: 10, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    expect(events.some((e) => e.kind === 'statusExpired' && (e as { status?: string }).status === 'dodge' && e.side === 'player')).toBe(true);
    expect(dodges(events)).toHaveLength(0);
    expect(playerDamage(events).some((e) => e.source === 'skill')).toBe(true);
  });
});
