import type { CombatantSetup } from '../src/engine/types';
import type { PassiveRecipe } from '../src/engine/passives/types';

export const BATTLE_PASSIVE_FIXTURES = ['off', 'slot_shield', 'slot_moved', 'slot_range', 'selected_card', 'selected_slot', 'missing_target', 'weight', 'weight_off', 'weight_moved', 'weight_talent'] as const;
export type BattlePassiveFixture = typeof BATTLE_PASSIVE_FIXTURES[number];

export function battlePassiveFixture(name: string, setup: CombatantSetup): CombatantSetup {
  if (!BATTLE_PASSIVE_FIXTURES.some((fixture) => fixture === name)) {
    throw new Error(`FIGHT_PASSIVES_FIXTURE: expected ${BATTLE_PASSIVE_FIXTURES.join('|')}, got '${name}'`);
  }
  const pieces = [
    { skillId: 'iron_bulwark', slot: name === 'slot_moved' || name === 'weight_moved' ? 2 : 0, pieceRef: 'fixture-ward' },
    { skillId: 'sword_slash', slot: name === 'slot_moved' || name === 'weight_moved' ? 0 : 2, pieceRef: 'fixture-sword' },
  ];
  if (name === 'off' || name === 'weight_off') return { ...setup, boardSize: 10, pieces };
  if (name.startsWith('weight')) return {
    ...setup, boardSize: 10, pieces,
    passives: { schemaVersion: 1, sources: [{
      source: { kind: name === 'weight_talent' ? 'talent' : 'relic', id: 'fixture_modifiers', version: 1 },
      effects: [{ id: 'prepared_weight', targetBinding: 'automatic', selector: { archetype: 'defensive' },
        conditions: { anchorSlot: 0, boardCount: { selector: { archetype: 'defensive' }, min: 1 } },
        effect: { kind: 'cardWeightReduction', amount: 3 } }],
    }] },
  };
  const targetBinding = name === 'selected_card' || name === 'missing_target' ? 'playerCard'
    : name === 'selected_slot' ? 'playerSlot' : 'automatic';
  const binding = name === 'selected_card' ? { pieceRef: 'fixture-ward' }
    : name === 'selected_slot' ? { slot: 0, match: 'anchor' as const } : undefined;
  const passives: PassiveRecipe = {
    schemaVersion: 1,
    sources: [{
      source: { kind: 'relic', id: 'fixture_ward', version: 1 },
      effects: [
        {
          id: 'opening_shield', targetBinding,
          ...(binding === undefined ? {} : { binding }),
          selector: { archetype: 'defensive' },
          conditions: name === 'slot_range' ? { slotRange: { min: 1, max: 2, match: 'occupies' } } : { anchorSlot: 0 },
          effect: { kind: 'setupShield', property: 'physical', amount: 8 },
        },
        {
          id: 'card_shield', targetBinding,
          ...(binding === undefined ? {} : { binding }),
          selector: { archetype: 'defensive' },
          conditions: name === 'slot_range' ? { slotRange: { min: 1, max: 2, match: 'occupies' } } : { anchorSlot: 0 },
          effect: { kind: 'cardShieldPower', amount: 5 },
        },
      ],
    }],
  };
  return { ...setup, boardSize: 10, pieces, passives };
}
