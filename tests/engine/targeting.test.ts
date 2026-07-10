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
