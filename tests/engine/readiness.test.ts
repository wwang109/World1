import { describe, expect, it } from 'vitest';
import { simulate1v1 } from '../../src/engine/combat/simulate';
import type { CombatEvent } from '../../src/engine/combat/events';
import type { CombatantSetup, SkillBook, SkillDef } from '../../src/engine/types';

function card(id: string, weight: number, size: 1 | 2 | 3 = 1, extra: Partial<SkillDef> = {}): SkillDef {
  return {
    id,
    name: id,
    archetypes: ['offense'],
    property: 'true',
    size,
    speedWeight: weight,
    cooldownTurns: 3,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 1 }],
    text: '',
    ...extra,
  };
}

const book: SkillBook = {
  jab: card('jab', 8),
  poke: card('poke', 8),
  greatswing: card('greatswing', 20, 3),
  slash: card('slash', 10),
  banner: card('banner', 5, 1, {
    archetypes: ['support'],
    effects: [],
    aura: { affects: 'right', mods: { damageFlat: 5 } },
  }),
  haste: card('haste', 1, 1, {
    archetypes: ['support'],
    property: 'physical',
    effects: [{ kind: 'buffStat', stat: 'speed', pct: 50, turns: 2 }],
  }),
  might: card('might', 1, 1, {
    archetypes: ['support'],
    property: 'physical',
    effects: [{ kind: 'buffStat', stat: 'attack', pct: 50, turns: 2 }],
  }),
  strike: card('strike', 8, 1, {
    property: 'true',
    // power 0 -> deals exactly the scaling stat (flat model equivalent of the old 100%).
    effects: [{ kind: 'damage', power: 0 }],
  }),
};

function fighter(name: string, speed: number, pieces: CombatantSetup['pieces'], boardSize = 10): CombatantSetup {
  return {
    name,
    stats: {
      maxHp: 1_000,
      hp: 1_000,
      attack: 1,
      magicPower: 1,
      armor: 0,
      magicResist: 0,
      speed,
    },
    boardSize,
    pieces,
  };
}

function run(player: CombatantSetup, enemy: CombatantSetup, maxTurns = 4) {
  return simulate1v1(
    player,
    enemy,
    {
      skillBook: book,
      cooldownsEnabled: true,
      suddenDeathRound: 999,
      fatigueTurn: 999,
      maxTurns,
    },
    1,
  );
}

type EventOf<K extends CombatEvent['kind']> = Extract<CombatEvent, { kind: K }>;

describe('readiness combat model', () => {
  it('emits one exact readiness gain per living combatant at turn start', () => {
    const { events } = run(
      fighter('Hero', 20, [{ skillId: 'jab', slot: 0 }]),
      fighter('Enemy', 8, [{ skillId: 'slash', slot: 0 }]),
      1,
    );

    expect(events.filter((event) => event.kind === 'gain')).toEqual([
      { turn: 1, kind: 'gain', side: 'player', unit: 0, baseSpeed: 20, speedModifier: 0, speed: 20, readinessBefore: 0, readinessAfter: 20 },
      { turn: 1, kind: 'gain', side: 'enemy', unit: 0, baseSpeed: 8, speedModifier: 0, speed: 8, readinessBefore: 0, readinessAfter: 8 },
    ]);
  });

  it('reports the authoritative Speed modifier used for readiness gain', () => {
    const { events } = run(
      fighter('Hero', 10, [{ skillId: 'haste', slot: 0 }]),
      fighter('Enemy', 1, [], 1),
      2,
    );

    const gain = events.find(
      (event): event is EventOf<'gain'> => event.kind === 'gain' && event.turn === 2 && event.side === 'player',
    );
    expect(gain).toMatchObject({ baseSpeed: 10, speedModifier: 5, speed: 15 });
  });

  it('records exact stat and effect contributions in direct damage calculations', () => {
    const hero = fighter('Hero', 30, [
      { skillId: 'might', slot: 0 },
      { skillId: 'banner', slot: 1 },
      { skillId: 'strike', slot: 2 },
    ]);
    hero.stats.attack = 10;
    const { events } = run(hero, fighter('Enemy', 1, [], 1), 1);

    const buff = events.find(
      (event): event is EventOf<'statusApplied'> => event.kind === 'statusApplied' && event.status === 'buff',
    );
    expect(buff).toMatchObject({ stat: 'attack', pct: 50 });

    const hit = events.find(
      (event): event is EventOf<'damage'> => event.kind === 'damage' && event.source === 'skill',
    );
    expect(hit?.calculation).toEqual({
      scalingStat: 'attack',
      baseStat: 10,
      effectiveStat: 15,
      power: 0,
      baseDamage: 10,
      statBonusDamage: 5,
      effectBonusDamage: 5,
      defense: 0,
      minimumDamageBonus: 0,
      matchupBonusDamage: 0,
      suddenDeathBonusDamage: 0,
      guardReduction: 0,
      shieldBlocked: 0,
      hpDamage: 20,
    });
  });

  it('plays an aura card instead of treating it as an uncastable passive', () => {
    const { events } = run(
      fighter('Hero', 5, [{ skillId: 'banner', slot: 0 }]),
      fighter('Enemy', 1, [{ skillId: 'slash', slot: 0 }]),
      1,
    );

    expect(events.some((event) => event.kind === 'play' && event.skillId === 'banner')).toBe(true);
  });

  it('matches the multi-cast, leftover readiness, cooldown, and busy traversal model', () => {
    const { events } = run(
      fighter('Hero', 20, [
        { skillId: 'jab', slot: 0 },
        { skillId: 'poke', slot: 1 },
        { skillId: 'greatswing', slot: 2 },
      ]),
      fighter('Enemy', 8, [{ skillId: 'slash', slot: 0 }], 1),
    );

    const plays = events.filter((event): event is EventOf<'play'> => event.kind === 'play');
    expect(plays.map((event) => [event.turn, event.side, event.skillId])).toEqual([
      [1, 'player', 'jab'],
      [1, 'player', 'poke'],
      [2, 'player', 'greatswing'],
      [2, 'enemy', 'slash'],
    ]);
    // jab: true damage, power 1 flat + max(attack 1, magicPower 1) stat = 2.
    expect(plays[0]).toMatchObject({ damage: 2, hpAfter: 998 });

    const costs = events.filter((event): event is EventOf<'cost'> => event.kind === 'cost');
    expect(costs.map((event) => [event.turn, event.side, event.readinessBefore, event.readinessAfter, event.paid])).toEqual([
      [1, 'player', 20, 12, 8],
      [1, 'player', 12, 4, 8],
      [2, 'player', 24, 4, 20],
      [2, 'enemy', 16, 6, 10],
    ]);

    const busy = events.filter((event): event is EventOf<'busy'> => event.kind === 'busy');
    expect(busy.map((event) => [event.turn, event.side, event.skillId, event.slotIndex, event.slotCount])).toEqual([
      [3, 'player', 'greatswing', 2, 3],
      [4, 'player', 'greatswing', 3, 3],
    ]);

    const laterGains = events
      .filter((event): event is EventOf<'gain'> => event.kind === 'gain' && event.turn >= 3)
      .map((event) => [event.turn, event.side, event.readinessBefore, event.readinessAfter]);
    expect(laterGains).toEqual([
      [3, 'player', 4, 24],
      [3, 'enemy', 6, 14],
      [4, 'player', 24, 44],
      [4, 'enemy', 14, 22],
    ]);

    const finalBusyCursor = events.find(
      (event): event is EventOf<'cursor'> => event.kind === 'cursor' && event.turn === 4 && event.side === 'player',
    );
    expect(finalBusyCursor).toMatchObject({ slot: 0, skillId: 'jab', slotIndex: 1, slotCount: 1, wrapped: true });

    const enemyCooling = events.filter(
      (event): event is Extract<CombatEvent, { kind: 'wait'; reason: 'cooling' }> =>
        event.kind === 'wait' && event.side === 'enemy' && event.reason === 'cooling',
    );
    expect(enemyCooling.map((event) => [event.turn, event.turnsLeft])).toEqual([
      [3, 3],
      [4, 2],
    ]);
  });

  it('breaks equal-readiness ties by effective Speed, then canonical identity', () => {
    const { events } = run(
      fighter('Hero', 10, [{ skillId: 'jab', slot: 0 }]),
      fighter('Enemy', 12, [{ skillId: 'slash', slot: 0 }]),
      1,
    );
    const first = events.find((event): event is EventOf<'play'> => event.kind === 'play');
    expect(first?.side).toBe('enemy');
  });

  it('never replays the same board piece twice in one turn when cooldowns are disabled', () => {
    const result = simulate1v1(
      fighter('Hero', 40, [{ skillId: 'jab', slot: 0 }]),
      fighter('Enemy', 1, [], 1),
      { skillBook: book, cooldownsEnabled: false, suddenDeathRound: 999, fatigueTurn: 999, maxTurns: 1 },
      1,
    );
    expect(result.events.filter((event) => event.kind === 'play' && event.side === 'player')).toHaveLength(1);
  });
});
