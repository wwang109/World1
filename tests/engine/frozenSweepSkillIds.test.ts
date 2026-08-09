import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import { FROZEN_SWEEP_SKILL_IDS } from './fixtures/frozenSweepSkillIds';

/**
 * Guards the freeze documented in `fixtures/frozenSweepSkillIds.ts`: the
 * 200-fight outcome-baseline sweep (`helpers/sweepConfigs.ts`) draws its card
 * pool from a literal snapshot, not from the live `skillBook`, so that ADDING
 * a card never invalidates `fixtures/outcomeBaseline.json`. That freeze is
 * silently unsafe in exactly one direction: if a frozen id is ever REMOVED
 * from `skillBook` (renamed or deleted), `skillBook[skillId]!` in
 * `sweepUnit()` would throw — or worse, silently misbehave under a future
 * refactor. This test turns that into a loud, specific failure instead.
 */
describe('frozen sweep skill id list', () => {
  it('every frozen id still exists in skillBook', () => {
    const missing = FROZEN_SWEEP_SKILL_IDS.filter((id) => !skillBook[id]);
    expect(
      missing,
      `skill id(s) removed from skillBook but still referenced by the frozen sweep pool: ` +
        `${missing.join(', ')}. This is NOT a routine change — regenerate deliberately: ` +
        `update tests/engine/fixtures/frozenSweepSkillIds.ts to drop the removed id(s) AND ` +
        `recapture tests/engine/fixtures/outcomeBaseline.json ` +
        `(tests/engine/fixtures/captureOutcomeBaseline.ts), with the standard containment ` +
        `proof in its \`note\` field. Do not do this to make a red test green without reading ` +
        `why it is red.`,
    ).toEqual([]);
  });

  // Sanity companion to the guard above: catches an accidental typo/duplicate
  // in the frozen literal itself, which the "still exists" check alone would not.
  it('the frozen list has no duplicate ids', () => {
    expect(new Set(FROZEN_SWEEP_SKILL_IDS).size).toBe(FROZEN_SWEEP_SKILL_IDS.length);
  });
});
