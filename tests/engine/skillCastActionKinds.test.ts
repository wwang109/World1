import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { resolveEffectiveSkill } from '../../src/engine/cards';
import type { CombatEvent } from '../../src/engine/combat/events';
import type { CombatConfig, Gem, SkillBook, SkillDef, SkillTier } from '../../src/engine/types';
import { cfg, NO_ENDGAME, tc } from '../helpers';

const probe: SkillDef = {
  id: 'action_probe',
  name: 'Action Probe',
  archetypes: ['offense'],
  property: 'magical',
  element: 'fire',
  size: 1,
  speedWeight: 1,
  rarity: 'common',
  tier: 'bronze',
  effects: [
    { kind: 'debuffStat', stat: 'magicResist', pct: 10, turns: 1, affinity: true },
    { kind: 'buffStat', stat: 'magicPower', pct: 10, turns: 1, minTier: 'silver' },
    { kind: 'damage', power: 5 },
    { kind: 'heal', power: 7 },
  ],
};

const fanout: SkillDef = {
  ...probe,
  id: 'fanout_probe',
  name: 'Fanout Probe',
  scope: 'all',
  effects: [{ kind: 'damage', power: 1 }, { kind: 'damage', power: 1 }],
};

const gatedOnly: SkillDef = {
  ...probe,
  id: 'gated_only_probe',
  name: 'Gated Only Probe',
  effects: [{ kind: 'damage', power: 1, affinity: true }],
};

const setupGem: Gem = {
  kind: 'effect',
  id: 'setup_gem',
  rarity: 'common',
  actions: [{ kind: 'comboBonus', amount: 3 }],
};

const book: SkillBook = { action_probe: probe, gated_only_probe: gatedOnly, fanout_probe: fanout };

function run(skillId: keyof typeof book, gem?: Gem, tier?: SkillTier): readonly CombatEvent[] {
  const config: CombatConfig = cfg(
    tc('hero', [], { maxHp: 100, magicPower: 0, speed: 20 }, {
      pieces: [{ skillId, slot: 0, ...(gem === undefined ? {} : { gem }), ...(tier === undefined ? {} : { tier }) }],
      skillBook: book,
    }),
    tc('foe', [], { maxHp: 1, magicResist: 0, speed: 1 }, { pieces: [], skillBook: book }),
    { ...NO_ENDGAME, maxTurns: 1, skillBook: book },
  );
  return simulate(config, 1).events;
}

describe('engine/interpreter: skillCast reached resolved action kinds', () => {
  it('includes a gem-added reached action, excludes a closed affinity gate and lethal unreached tail, and differs from the base face', () => {
    const bronze = resolveEffectiveSkill(probe, { skillId: probe.id, slot: 0 });
    const effective = resolveEffectiveSkill(probe, { skillId: probe.id, slot: 0, tier: 'silver', gem: setupGem });
    expect(bronze.effects.map((action) => action.kind)).not.toContain('buffStat');
    expect(effective.effects[0]).toMatchObject({ kind: 'comboBonus', amount: 3, fromGem: true });
    expect(effective.effects.map((action) => action.kind)).toEqual([
      'comboBonus', 'debuffStat', 'buffStat', 'damage', 'heal',
    ]);

    const cast = run('action_probe', setupGem, 'silver').find(
      (event): event is Extract<CombatEvent, { kind: 'skillCast' }> => event.kind === 'skillCast' && event.side === 'player',
    );
    expect(cast?.actionKinds).toEqual(['comboBonus', 'buffStat', 'damage']);
    expect(cast?.actionKinds).not.toEqual(probe.effects.map((action) => action.kind));
  });

  it('omits actionKinds when a resolved cast reaches no open actions', () => {
    const cast = run('gated_only_probe').find(
      (event): event is Extract<CombatEvent, { kind: 'skillCast' }> => event.kind === 'skillCast' && event.side === 'player',
    );
    expect(cast).toBeDefined();
    expect(cast).not.toHaveProperty('actionKinds');
  });

  it('preserves repeated action-list kinds once each without multiplying them per AoE target', () => {
    const config: CombatConfig = {
      playerTeam: [tc('hero', [], { attack: 0, speed: 20 }, {
        pieces: [{ skillId: 'fanout_probe', slot: 0 }], skillBook: book,
      })],
      enemyTeam: [
        tc('foe-a', [], { maxHp: 100, speed: 1 }, { pieces: [], skillBook: book }),
        tc('foe-b', [], { maxHp: 100, speed: 1 }, { pieces: [], skillBook: book }),
      ],
      skillBook: book,
      ...NO_ENDGAME,
      maxTurns: 1,
    };

    const events = simulate(config, 1).events;
    const cast = events.find(
      (event): event is Extract<CombatEvent, { kind: 'skillCast' }> => event.kind === 'skillCast' && event.side === 'player',
    );
    expect(events.filter((event) => event.kind === 'damage' && event.side === 'enemy')).toHaveLength(4);
    expect(cast?.actionKinds).toEqual(['damage', 'damage']);
  });
});
