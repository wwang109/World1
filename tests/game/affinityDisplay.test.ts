import { describe, expect, it } from 'vitest';
import { boardAffinityHeadline, boardAffinityPipAxes } from '../../src/game/ui/affinityDisplay';
import { skillBook } from '../../src/data/skills';
import type { SkillDef } from '../../src/engine/types';

function makeSkill(overrides: Partial<SkillDef>): SkillDef {
  return {
    id: 'test_skill', name: 'Test Skill', archetypes: ['offense'], property: 'physical',
    size: 1, rarity: 'common', tier: 'bronze', effects: [], ...overrides,
  };
}

/**
 * `affinityDisplay.ts` is the shared derivation behind BOTH the Prep foe
 * panel's `AFFINITY · <TYPE>` line and the Deck Build pip rows — the two
 * teaching surfaces named in the 2026-09-06 audit ("the battle card face
 * contradicts the engine"). Both read straight off `boardAffinities`
 * (`docs/board-type-identity.md`), never an authored override, and both show
 * BOTH axes when a board earns them independently.
 *
 * Uses REAL shipped cards, the exact board from the reported bug (see
 * `tests/game/battleTimeline.test.ts`'s "REGRESSION" test): `kindling_rite`,
 * `cinder_dart`, `ember_lash` (3 Fire) + `sworn_edge`, `sword_slash`,
 * `twin_slash` (3 Sword).
 */
const DUAL_AXIS_BOARD = ['kindling_rite', 'cinder_dart', 'ember_lash', 'sworn_edge', 'sword_slash', 'twin_slash']
  .map((id) => skillBook[id]!);

/** `cinder_sprite`'s exact shape: 2 Fire cards, short of the threshold. */
const TWO_CARD_FIRE_BOARD = ['kindling_rite', 'cinder_dart'].map((id) => skillBook[id]!);

describe('boardAffinityHeadline — the Prep foe panel AFFINITY line', () => {
  it('joins BOTH axes when the board earns both — "AFFINITY · FIRE + SWORD"', () => {
    expect(boardAffinityHeadline(DUAL_AXIS_BOARD)).toBe('AFFINITY · FIRE + SWORD');
  });

  it('names a single axis alone when only one is earned', () => {
    const fireOnly = ['kindling_rite', 'cinder_dart', 'ember_lash'].map((id) => skillBook[id]!);
    expect(boardAffinityHeadline(fireOnly)).toBe('AFFINITY · FIRE');
  });

  it('is undefined (caller falls back to a generic label) when the board earns neither', () => {
    expect(boardAffinityHeadline(TWO_CARD_FIRE_BOARD)).toBeUndefined();
  });
});

describe('boardAffinityPipAxes — the Deck Build pip rows', () => {
  it('returns ONE ROW PER EARNED AXIS on a dual-affinity board, both marked earned', () => {
    const rows = boardAffinityPipAxes(DUAL_AXIS_BOARD);
    expect(rows).toEqual([
      { axis: 'element', label: 'FIRE', count: 3, earned: true },
      { axis: 'weapon', label: 'SWORD', count: 3, earned: true },
    ]);
  });

  it("a 2-card board reports its progress but NOT earned — cinder_sprite's exact shape", () => {
    const rows = boardAffinityPipAxes(TWO_CARD_FIRE_BOARD);
    expect(rows).toEqual([{ axis: 'element', label: 'FIRE', count: 2, earned: false }]);
  });

  it("an empty board reports no rows at all (the caller's 'NO TYPE' fallback)", () => {
    expect(boardAffinityPipAxes([])).toEqual([]);
  });

  it('a tie WITHIN an axis reports that axis as not-earned while the OTHER axis is untouched', () => {
    // 3 fire + 3 frost (tied element axis, earns nothing) + 3 sword (clears
    // its own axis clean) — mirrors `typeIdentity.ts`'s own "a tie kills only
    // its own axis" invariant, at the display layer.
    const fireA = makeSkill({ id: 'fire_a', element: 'fire' });
    const fireB = makeSkill({ id: 'fire_b', element: 'fire' });
    const fireC = makeSkill({ id: 'fire_c', element: 'fire' });
    const frostA = makeSkill({ id: 'frost_a', element: 'frost' });
    const frostB = makeSkill({ id: 'frost_b', element: 'frost' });
    const frostC = makeSkill({ id: 'frost_c', element: 'frost' });
    const swordA = skillBook.sworn_edge!;
    const swordB = skillBook.sword_slash!;
    const swordC = skillBook.twin_slash!;
    const rows = boardAffinityPipAxes([fireA, fireB, fireC, frostA, frostB, frostC, swordA, swordB, swordC]);
    const elementRow = rows.find((r) => r.axis === 'element');
    const weaponRow = rows.find((r) => r.axis === 'weapon');
    expect(elementRow?.earned).toBe(false); // exact 3-3 tie — neither type earns it
    expect(weaponRow).toEqual({ axis: 'weapon', label: 'SWORD', count: 3, earned: true });
  });
});
