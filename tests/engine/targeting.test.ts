import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { CombatConfig, CombatantSetup } from '../../src/engine/types';
import { enchantBook } from '../../src/data/enchants';
import { skillBook } from '../../src/data/skills';
import { tc, NO_ENDGAME } from '../helpers';

type Events = ReturnType<typeof simulate>['events'];

function enemyHits(events: Events) {
  return events.filter((e) => e.kind === 'damage' && e.side === 'enemy') as Extract<Events[number], { kind: 'damage' }>[];
}

/** Hero with one enchanted sword_slash vs a custom enemy party. */
function heroVs(enchant: string | undefined, enemy: CombatantSetup[], skillId = 'sword_slash'): CombatConfig {
  return {
    player: {
      ...tc('hero', [], { attack: 10, speed: 20, maxHp: 500 }),
      pieces: [{ skillId, slot: 0, enchant }],
      boardSize: 10,
    },
    enemy,
    skillBook,
    enchantBook,
    ...NO_ENDGAME,
    maxTurns: 2,
  };
}

describe('targeting enchantments', () => {
  it("assassin's mark hits the LOWEST-aggro foe instead of the tank", () => {
    const enemy = [{ ...tc('tank', [], { maxHp: 100 }), aggro: 10 }, tc('sneak', [], { maxHp: 100 })];
    // Unenchanted: the high-aggro tank soaks it.
    expect(enemyHits(simulate(heroVs(undefined, enemy), 1).events)[0]!.unit).toBe(0);
    // Assassin's Mark: the low-aggro backliner gets sniped.
    expect(enemyHits(simulate(heroVs('assassin_mark', enemy), 1).events)[0]!.unit).toBe(1);
  });

  it("executioner's mark hits the foe with the least health", () => {
    const enemy = [tc('healthy', [], { maxHp: 100 }), tc('wounded', [], { maxHp: 100, hp: 30 })];
    expect(enemyHits(simulate(heroVs('executioner_mark', enemy), 1).events)[0]!.unit).toBe(1);
  });

  it('storm mark spreads damage to every living foe at the AoE percentage', () => {
    const enemy = [tc('a', [], { maxHp: 100 }), tc('b', [], { maxHp: 100 }), tc('c', [], { maxHp: 100 })];
    const { events } = simulate(heroVs('storm_mark', enemy), 1);
    const hits = enemyHits(events).filter((e) => e.turn === 1);
    // Slash 200% of 10 = 20 -> 60% AoE = 12 to each of the three.
    expect(hits.map((e) => ({ unit: e.unit, amount: e.amount }))).toEqual([
      { unit: 0, amount: 12 },
      { unit: 1, amount: 12 },
      { unit: 2, amount: 12 },
    ]);
  });

  it('AoE spreads damage only — riders keep a single target', () => {
    // Venom Fang under Storm Mark: damage hits both, poison lands on ONE.
    const enemy = [tc('a', [], { maxHp: 100 }), tc('b', [], { maxHp: 100 })];
    const { events } = simulate(heroVs('storm_mark', enemy, 'venom_fang'), 1);
    expect(enemyHits(events).filter((e) => e.turn === 1)).toHaveLength(2);
    const poisons = events.filter((e) => e.kind === 'statusApplied' && e.side === 'enemy' && e.turn === 1);
    expect(poisons).toHaveLength(1);
  });

  it('the skillCast event carries the enchant id for display', () => {
    const { events } = simulate(heroVs('storm_mark', [tc('a', [], { maxHp: 100 })]), 1);
    const cast = events.find((e) => e.kind === 'skillCast');
    expect(cast).toMatchObject({ enchant: 'storm_mark' });
  });

  it('chase mark: the cast flows into the next card at a 40% damage cost', () => {
    // [slash+chase][bite]: turn 1 casts BOTH — chased slash at 60% (12),
    // then bite at full 20 with momentum. Exactly one chase per turn.
    const c: CombatConfig = {
      player: {
        ...tc('hero', [], { attack: 10, speed: 20, maxHp: 500 }),
        pieces: [
          { skillId: 'sword_slash', slot: 0, enchant: 'chase_mark' },
          { skillId: 'savage_bite', slot: 1 },
        ],
        boardSize: 10,
      },
      enemy: [tc('wall', [], { maxHp: 500, speed: 1 })],
      skillBook,
      enchantBook,
      ...NO_ENDGAME,
      maxTurns: 1,
    };
    const { events } = simulate(c, 1);
    const casts = events.filter((e) => e.kind === 'skillCast') as Extract<Events[number], { kind: 'skillCast' }>[];
    expect(casts.map((e) => ({ id: e.skillId, chased: e.chased ?? false }))).toEqual([
      { id: 'sword_slash', chased: false },
      { id: 'savage_bite', chased: true },
    ]);
    expect(enemyHits(events).map((e) => e.amount)).toEqual([12, 20]);
    // Single performStart: the chase happens inside ONE performance.
    expect(events.filter((e) => e.kind === 'performStart')).toHaveLength(1);
  });

  it('a chased cast cannot chase again (no infinite chains)', () => {
    const c: CombatConfig = {
      player: {
        ...tc('hero', [], { attack: 10, speed: 20, maxHp: 500 }),
        pieces: [
          { skillId: 'sword_slash', slot: 0, enchant: 'chase_mark' },
          { skillId: 'savage_bite', slot: 1, enchant: 'chase_mark' },
          { skillId: 'hunter_shot', slot: 2 },
        ],
        boardSize: 10,
      },
      enemy: [tc('wall', [], { maxHp: 500, speed: 1 })],
      skillBook,
      enchantBook,
      ...NO_ENDGAME,
      maxTurns: 1,
    };
    const { events } = simulate(c, 1);
    // Turn 1: slash chases into bite; bite's own mark must NOT trigger.
    expect(events.filter((e) => e.kind === 'skillCast')).toHaveLength(2);
  });

  it('overload mark: 150% damage but only one cast per battle (exhaust)', () => {
    const c: CombatConfig = {
      player: {
        ...tc('hero', [], { attack: 10, speed: 20, maxHp: 500 }),
        pieces: [
          { skillId: 'sword_slash', slot: 0, enchant: 'overload_mark' },
          { skillId: 'savage_bite', slot: 1 },
        ],
        boardSize: 10,
      },
      enemy: [tc('wall', [], { maxHp: 500, speed: 1 })],
      skillBook,
      enchantBook,
      ...NO_ENDGAME,
      maxTurns: 4,
    };
    const { events } = simulate(c, 1);
    const casts = (events.filter((e) => e.kind === 'skillCast') as Extract<Events[number], { kind: 'skillCast' }>[]).map((e) => e.skillId);
    // Overloaded slash once (30 = 200% * 1.5), then the piece is exhausted:
    // only bites remain in the rotation.
    expect(casts).toEqual(['sword_slash', 'savage_bite', 'savage_bite', 'savage_bite']);
    expect(enemyHits(events)[0]!.amount).toBe(30);
  });

  it('curseCard traps the enemy queued card and detonates when it casts', () => {
    // Hero hex-traps first (speed 30); the foe's queued slash is trapped.
    // When the foe casts it, the trap detonates for 125% of MP 10 = 12.
    const c: CombatConfig = {
      player: { ...tc('hero', [], { magicPower: 10, speed: 30, maxHp: 500 }), pieces: [{ skillId: 'hex_trap', slot: 0 }, { skillId: 'mana_ward', slot: 1 }], boardSize: 10 },
      enemy: [tc('foe', ['sword_slash', 'savage_bite'], { attack: 10, speed: 12, maxHp: 500 })],
      skillBook,
      enchantBook,
      ...NO_ENDGAME,
      maxTurns: 4,
    };
    const { events } = simulate(c, 1);
    const cursed = events.find((e) => e.kind === 'skillCursed');
    expect(cursed).toMatchObject({ side: 'enemy', skillId: 'sword_slash', amount: 12 });
    // Detonation lands on the FOE as it activates the trapped card.
    const boom = events.find((e) => e.kind === 'damage' && (e as { source: string }).source === 'curse');
    expect(boom).toMatchObject({ side: 'enemy', amount: 12 });
    const boomTurn = (boom as { turn: number }).turn;
    const trapTurn = (cursed as { turn: number }).turn;
    expect(boomTurn).toBeGreaterThan(trapTurn);
    // One-shot: no second detonation without a re-trap... the hero DOES
    // re-trap on its rotation, so just assert detonations never exceed traps.
    const traps = events.filter((e) => e.kind === 'skillCursed').length;
    const booms = events.filter((e) => e.kind === 'damage' && (e as { source: string }).source === 'curse').length;
    expect(booms).toBeLessThanOrEqual(traps);
  });

  it('lifesteal heals from the total dealt across all AoE targets', () => {
    const enemy = [tc('a', [], { maxHp: 100 }), tc('b', [], { maxHp: 100 })];
    // Leeching Fang 160% of 10 = 16 -> AoE 60% = 9 each, 18 total; 45% -> 8.
    const cfgObj = heroVs('storm_mark', enemy, 'leeching_fang');
    (cfgObj.player as CombatantSetup).stats.hp = 50;
    const { events } = simulate(cfgObj, 1);
    const heal = events.find((e) => e.kind === 'heal' && e.side === 'player');
    expect(heal).toMatchObject({ amount: 8 });
  });
});
