import { describe, expect, it } from 'vitest';
import { gemBook } from '../../src/data/gems';
import { skillBook } from '../../src/data/skills';
import {
  capViolations,
  CONTROL_KINDS,
  effectCapDeci,
  gemPowerLevelDeci,
  MAX_STUN_PER_CARD,
  powerLevelBreakdown,
  powerLevelDeci,
} from '../../src/engine/balance';
import { initCombatState } from '../../src/engine/combat/state';
import { cardTargetPieces } from '../../src/engine/combat/splash';
import { applyTier } from '../../src/engine/cards';
import type { Action, CombatConfig, SkillBook, SkillDef, SkillTier } from '../../src/engine/types';
import { tc } from '../helpers';

const card = (id: string, tier: SkillTier, effects: Action[]): SkillDef => ({
  id,
  name: id,
  archetypes: ['debuff'],
  property: 'physical',
  size: 1,
  speedWeight: 10,
  rarity: 'common',
  tier,
  effects,
});

describe('Splash card-tier pricing', () => {
  it.each([
    ['bronze', 80],
    ['silver', 100],
    ['gold', 120],
    ['diamond', 140],
  ] as const)('prices %s card Splash at %i deci', (tier, expectedDeci) => {
    const payload = card(`payload_${tier}`, tier, [{ kind: 'burden', weight: 4 }]);
    const spread = card(`spread_${tier}`, tier, [{ kind: 'burden', weight: 4 }, { kind: 'splash' }]);
    const splashPart = powerLevelBreakdown(spread).find((part) => part.label === 'splash');

    expect(splashPart?.deci, `${tier} Splash breakdown`).toBe(expectedDeci);
    expect(powerLevelDeci(spread) - powerLevelDeci(payload), `${tier} Splash total contribution`).toBe(expectedDeci);
  });

  it('keeps the tierless ripple_sliver Splash gem at 80 deci', () => {
    const ripple = gemBook.ripple_sliver;
    expect(ripple, 'ripple_sliver must remain in the gem book').toBeDefined();
    expect(gemPowerLevelDeci(ripple!), 'tierless Splash gem price').toBe(80);
  });

  it('leaves the public anchor-versus-band spread geometry unchanged', () => {
    const book: SkillBook = {
      left: card('left', 'bronze', [{ kind: 'damage', power: 0 }]),
      anchor: card('anchor', 'bronze', [{ kind: 'damage', power: 0 }]),
      right: card('right', 'bronze', [{ kind: 'damage', power: 0 }]),
    };
    const config: CombatConfig = {
      playerTeam: [tc('hero', [], {}, { skillBook: book })],
      enemyTeam: [tc('foe', ['left', 'anchor', 'right'], {}, { skillBook: book })],
      skillBook: book,
    };
    const enemy = initCombatState(config).enemy;
    enemy.castCursor = 1;

    expect(cardTargetPieces(enemy, false)?.pieces.map((piece) => piece.slot)).toEqual([1]);
    expect(cardTargetPieces(enemy, true)?.pieces.map((piece) => piece.slot)).toEqual([0, 1, 2]);
  });

  it('scales the size-1 Control cap with the card tier budget', () => {
    expect([
      effectCapDeci('control', 1, 'bronze'),
      effectCapDeci('control', 1, 'silver'),
      effectCapDeci('control', 1, 'gold'),
      effectCapDeci('control', 1, 'diamond'),
    ]).toEqual([100, 150, 200, 250]);
  });

  it('keeps Splash in Control and accounts for its tier price against that cap', () => {
    expect(CONTROL_KINDS.has('splash')).toBe(true);
    const diamond = card('diamond_control_cap', 'diamond', [
      { kind: 'burden', weight: 22 },
      { kind: 'splash' },
    ]);
    expect(capViolations(diamond)).toEqual([]);
  });

  it('keeps Stun at its separate one-performance maximum even when Control scales', () => {
    expect(MAX_STUN_PER_CARD).toBe(1);
    const diamond = card('diamond_double_stun', 'diamond', [{ kind: 'stun', turns: 2 }]);
    expect(capViolations(diamond)).toEqual(['stun 2 exceeds the 1-performance cap']);
  });

  it.each([
    {
      id: 'line_breaker',
      expected: [
        [{ kind: 'damage', power: 2 }, { kind: 'burden', weight: 2 }, { kind: 'splash' }],
        [{ kind: 'damage', power: 6 }, { kind: 'burden', weight: 4 }, { kind: 'splash' }],
        [{ kind: 'damage', power: 10 }, { kind: 'burden', weight: 6 }, { kind: 'splash' }],
        [{ kind: 'damage', power: 14 }, { kind: 'burden', weight: 8 }, { kind: 'splash' }],
      ],
    },
    {
      id: 'arc_cascade',
      expected: [
        [{ kind: 'damage', power: 2 }, { kind: 'burden', weight: 2 }, { kind: 'splash' }],
        [{ kind: 'damage', power: 4 }, { kind: 'burden', weight: 6 }, { kind: 'splash' }],
        [{ kind: 'damage', power: 6 }, { kind: 'burden', weight: 10 }, { kind: 'splash' }],
        [{ kind: 'damage', power: 8 }, { kind: 'burden', weight: 14 }, { kind: 'splash' }],
      ],
    },
    {
      id: 'shockwave_slam',
      expected: [
        [{ kind: 'damage', power: 2 }, { kind: 'burden', weight: 2 }, { kind: 'splash' }],
        [{ kind: 'damage', power: 8 }, { kind: 'burden', weight: 2 }, { kind: 'splash' }],
        [{ kind: 'damage', power: 12 }, { kind: 'burden', weight: 4 }, { kind: 'splash' }],
        [{ kind: 'damage', power: 16 }, { kind: 'burden', weight: 6 }, { kind: 'splash' }],
      ],
    },
    {
      id: 'sapping_arc',
      expected: [
        [{ kind: 'damage', power: 2 }, { kind: 'curse', amount: 2, turns: 2 }, { kind: 'splash' }],
        [{ kind: 'damage', power: 6 }, { kind: 'curse', amount: 4, turns: 2 }, { kind: 'splash' }],
        [{ kind: 'damage', power: 10 }, { kind: 'curse', amount: 6, turns: 2 }, { kind: 'splash' }],
        [{ kind: 'damage', power: 14 }, { kind: 'curse', amount: 8, turns: 2 }, { kind: 'splash' }],
      ],
    },
    {
      id: 'writ_of_sanction',
      expected: [
        [{ kind: 'curse', amount: 2, turns: 2 }, { kind: 'burden', weight: 2 }, { kind: 'splash' }],
        [{ kind: 'curse', amount: 6, turns: 2 }, { kind: 'burden', weight: 4 }, { kind: 'splash' }],
        [{ kind: 'curse', amount: 8, turns: 2 }, { kind: 'burden', weight: 8 }, { kind: 'splash' }],
        [{ kind: 'curse', amount: 12, turns: 2 }, { kind: 'burden', weight: 10 }, { kind: 'splash' }],
      ],
    },
  ])('$id keeps its approved role-focused four-rank ladder', ({ id, expected }) => {
    const base = skillBook[id];
    expect(base, `${id} must exist in the skill book`).toBeDefined();
    expect(['bronze', 'silver', 'gold', 'diamond'].map((tier) => applyTier(base!, tier as SkillTier).effects))
      .toEqual(expected);
  });
});
