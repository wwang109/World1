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

describe('dodge (Sidestep)', () => {
  it('negates single-target physical strikes, one charge per strike', () => {
    // Hero casts Sidestep first (Speed 20 beats 10); the foe swings every
    // turn and misses while charges last. Once spent, Sidestep reads as
    // useful again and the hero re-guards — a pure dodge-tank loop that
    // walls single-target physical (and ONLY that; magic/AoE/DoTs break it).
    const c = cfg(
      tc('dancer', ['sidestep'], { speed: 20, maxHp: 500 }),
      tc('bruiser', ['sword_slash'], { attack: 10, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 8 },
    );
    const { events } = simulate(c, 1);
    const d = dodges(events);
    expect(d.length).toBeGreaterThanOrEqual(3);
    expect(d.slice(0, 3).map((e) => e.hitsLeft)).toEqual([2, 1, 0]);
    // Charges spent -> the guard was re-cast (visible as a second skillCast).
    const recasts = events.filter((e) => e.kind === 'skillCast' && e.side === 'player');
    expect(recasts.length).toBeGreaterThanOrEqual(2);
    // The wall holds: no skill damage ever reaches the hero here.
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
    // the AoE strike connects (you cannot sidestep a storm).
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
