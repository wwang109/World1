import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { CombatConfig, SkillBook, SkillDef, CombatantStats } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';

function card(id: string, effects: SkillDef['effects'], extra: Partial<SkillDef> = {}): SkillDef {
  return {
    id,
    name: id,
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects,
    text: '',
    ...extra,
  };
}

const BOOK: SkillBook = {
  // Enemies self-buff thorns turn 1 (fast weight so it fires before the hero's AoE).
  self_thorns: card('self_thorns', [{ kind: 'thorns', stacks: 50 }], { speedWeight: 5 }),
  // Hero's AoE hits every living foe. Heavy weight so it fires AFTER thorns is up.
  aoe_strike: card('aoe_strike', [{ kind: 'damage', power: 5 }], { speedWeight: 50, scope: 'all' }),
};

describe('PROBE: thorns reflect mid-AoE-fanout zombie cast', () => {
  it('does the caster keep hitting remaining AoE targets after a thorns reflect kills it mid-fanout?', () => {
    const heroStats: CombatantStats = {
      maxHp: 30, hp: 30, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 10,
    };
    const foeStats: CombatantStats = {
      maxHp: 100, hp: 100, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 1,
    };
    const cfg: CombatConfig = {
      playerTeam: [{ name: 'hero', stats: heroStats, boardSize: 10, pieces: [{ skillId: 'aoe_strike', slot: 0 }] }],
      enemyTeam: [
        { name: 'foeA', stats: foeStats, boardSize: 10, pieces: [{ skillId: 'self_thorns', slot: 0 }] },
        { name: 'foeB', stats: foeStats, boardSize: 10, pieces: [{ skillId: 'self_thorns', slot: 0 }] },
      ],
      skillBook: BOOK,
      suddenDeathRound: 999,
      fatigueTurn: 9999,
      attritionTurn: 9999,
      maxTurns: 10,
    };
    const { events, result, finalState } = simulate(cfg, 1);
    console.log('RESULT:', result);
    console.log(JSON.stringify(events, null, 1));
    console.log('hero alive?', finalState.playerTeam[0]!.alive, 'hp', finalState.playerTeam[0]!.stats.hp);
    console.log('foeB hp', finalState.enemyTeam[1]!.stats.hp);
    // Just observing — no hard assertion yet.
    expect(true).toBe(true);
  });
});
