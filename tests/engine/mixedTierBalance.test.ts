import { describe, expect, it } from 'vitest';
import { capViolations, powerLevelDeci, TIER_BUDGET_DECI } from '../../src/engine/balance';
import { applyTier } from '../../src/engine/cards';
import { skillBook } from '../../src/data/skills';
import type { Action, SkillDef, SkillTier } from '../../src/engine/types';

const TIERS = ['bronze', 'silver', 'gold', 'diamond'] as const satisfies readonly SkillTier[];

type Magnitudes = Record<string, number>;

interface LadderCase {
  id: string;
  expected: readonly Magnitudes[];
  project: (skill: SkillDef) => Magnitudes;
}

function actionOf<K extends Action['kind']>(skill: SkillDef, kind: K): Extract<Action, { kind: K }> | undefined {
  return skill.effects.find((action): action is Extract<Action, { kind: K }> => action.kind === kind);
}

const CASES: readonly LadderCase[] = [
  {
    id: 'poison_ritual',
    expected: [
      { poison: 5, cleanse: 2 },
      { poison: 10, cleanse: 2 },
      { poison: 10, cleanse: 4 },
      { poison: 15, cleanse: 4 },
    ],
    project: (skill) => ({
      poison: actionOf(skill, 'poison')?.stacks ?? 0,
      cleanse: actionOf(skill, 'cleanse')?.charges ?? 0,
    }),
  },
  {
    id: 'braced_pike',
    expected: [
      { guard: 20, damage: 12 },
      { guard: 30, damage: 18 },
      { guard: 40, damage: 24 },
      { guard: 50, damage: 30 },
    ],
    project: (skill) => ({
      guard: actionOf(skill, 'guard')?.pct ?? 0,
      damage: actionOf(skill, 'damage')?.power ?? 0,
    }),
  },
  {
    id: 'warded_reprisal',
    expected: [
      { ward: 1, heal: 10 },
      { ward: 1, heal: 20 },
      { ward: 2, heal: 20 },
      { ward: 2, heal: 30 },
    ],
    project: (skill) => ({
      ward: actionOf(skill, 'ward')?.charges ?? 0,
      heal: actionOf(skill, 'heal')?.power ?? 0,
    }),
  },
  {
    id: 'barbed_rampart',
    expected: [
      { guard: 20, bleed: 3, damage: 6 },
      { guard: 25, bleed: 5, damage: 10 },
      { guard: 30, bleed: 7, damage: 14 },
      { guard: 40, bleed: 8, damage: 18 },
    ],
    project: (skill) => ({
      guard: actionOf(skill, 'guard')?.pct ?? 0,
      bleed: actionOf(skill, 'bleed')?.stacks ?? 0,
      damage: actionOf(skill, 'damage')?.power ?? 0,
    }),
  },
  {
    id: 'sanctum_thorn',
    expected: [
      { ward: 2, thorns: 5, shield: 0, heal: 18 },
      { ward: 2, thorns: 5, shield: 10, heal: 24 },
      { ward: 2, thorns: 5, shield: 20, heal: 32 },
      { ward: 2, thorns: 5, shield: 30, heal: 38 },
    ],
    project: (skill) => ({
      ward: actionOf(skill, 'ward')?.charges ?? 0,
      thorns: actionOf(skill, 'thorns')?.stacks ?? 0,
      shield: actionOf(skill, 'shield')?.power ?? 0,
      heal: actionOf(skill, 'heal')?.power ?? 0,
    }),
  },
];

describe('approved mixed-role tier ladders', () => {
  it.each(CASES)('$id matches the approved Bronze through Diamond ladder', ({ id, expected, project }) => {
    const card = skillBook[id];
    expect(card, `${id} must exist in the skill book`).toBeDefined();

    const actual = TIERS.map((tier) => project(applyTier(card!, tier)));
    expect(actual).toEqual(expected);
  });

  it('every approved rank lands on its exact deci-PL budget with zero cap violations', () => {
    for (const { id } of CASES) {
      const card = skillBook[id]!;
      for (const tier of TIERS) {
        const ranked = applyTier(card, tier);
        expect(powerLevelDeci(ranked), `${id}@${tier} budget`).toBe(TIER_BUDGET_DECI[tier]);
        expect(capViolations(ranked), `${id}@${tier} caps`).toEqual([]);
      }
    }
  });

  it('ranking up never removes an existing effect or lowers one of its numeric magnitudes', () => {
    for (const { id } of CASES) {
      const card = skillBook[id]!;
      const ladder = TIERS.map((tier) => applyTier(card, tier));

      for (let step = 1; step < ladder.length; step += 1) {
        const previous = ladder[step - 1]!;
        const current = ladder[step]!;

        for (const previousAction of previous.effects) {
          const currentAction = current.effects.find((action) => action.kind === previousAction.kind);
          expect(currentAction, `${id}@${current.tier} keeps ${previousAction.kind}`).toBeDefined();

          for (const [field, previousValue] of Object.entries(previousAction)) {
            if (typeof previousValue !== 'number') continue;
            const currentValue = (currentAction as unknown as Record<string, unknown>)[field];
            expect(typeof currentValue, `${id}@${current.tier} keeps numeric ${previousAction.kind}.${field}`).toBe('number');
            expect(currentValue as number, `${id}@${current.tier} ${previousAction.kind}.${field}`).toBeGreaterThanOrEqual(previousValue);
          }
        }
      }
    }
  });
});
