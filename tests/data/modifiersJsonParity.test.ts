import { describe, expect, it } from 'vitest';
import { MODIFIER_PRESETS } from '../../src/data/modifiers';
import { modifierBookFromJson, modifierContentMeta } from '../../src/data/modifiersContent';
import { validateModifierDocument } from '../../src/data/validateModifierContent';
import document from '../../src/data/content/modifiers.v1.json';

/**
 * PARITY PROOF for modifiers.v1.json against the live TS book, the twin of
 * tests/data/enemiesJsonParity.test.ts (the closest model — a fresh document
 * with no prior JSON and no runtime consumer switch, unlike the skills/gems
 * migration-in-flight pair).
 *
 * UNLIKE the skills/gems migration proofs this is NOT a migration proof —
 * there is no prior modifiers.v1.json to preserve back-compat with;
 * src/data/modifiers.ts stays the one and only source of truth. This file
 * exists purely to prove the GENERATED document agrees with its source,
 * which is what makes "regenerate" a safe, mechanical answer to a future
 * affix change instead of a hand merge.
 *
 * WHOLE-BOOK comparison, no MIGRATED_*_IDS frozen-list indirection (there is
 * nothing to freeze here — see the doc comment above), so the id-set
 * assertion below is an exact match rather than the subset check
 * skillsJsonParity.test.ts / gemsJsonParity.test.ts use for their frozen
 * pre-migration sets: a modifier vanishing from EITHER side, or one existing
 * on only one side, is a regression this test must catch.
 */
describe('data: modifiers.v1.json is behaviour-identical to the TS book', () => {
  it('carries exactly the same id set as the TS book (a modifier vanishing from either side is a regression)', () => {
    expect(Object.keys(modifierBookFromJson).sort()).toEqual(Object.keys(MODIFIER_PRESETS).sort());
  });

  it('deep-equals the TS book across every modifier', () => {
    expect(modifierBookFromJson).toStrictEqual(MODIFIER_PRESETS);
  });

  it('every modifier round-trips field-for-field, including optional fields', () => {
    for (const id of Object.keys(MODIFIER_PRESETS)) {
      const ts = MODIFIER_PRESETS[id]!;
      const js = modifierBookFromJson[id]!;
      expect(Object.keys(js).sort(), id + ' field set').toEqual(Object.keys(ts).sort());
      expect(js, id).toStrictEqual(ts);
    }
  });

  it('carries NO schema meta on the EnemyModifierPreset itself (version/notes are sidecar only)', () => {
    for (const [id, def] of Object.entries(modifierBookFromJson)) {
      const keys = Object.keys(def);
      expect(keys, id).not.toContain('version');
      expect(keys, id).not.toContain('notes');
    }
  });

  it('resolves every modifier to exactly one version today', () => {
    for (const id of Object.keys(modifierBookFromJson)) {
      expect(modifierContentMeta[id]!.versions, id).toEqual([1]);
      expect(modifierContentMeta[id]!.version, id).toBe(1);
    }
  });

  it('validates clean — the contract has ONE outcome, so any problem is a failure', () => {
    expect(validateModifierDocument(document)).toEqual([]);
  });

  it('every modifier exposes a version in the sidecar', () => {
    for (const id of Object.keys(modifierBookFromJson)) {
      expect(modifierContentMeta[id]!.version, id).toBeGreaterThanOrEqual(1);
    }
  });
});
