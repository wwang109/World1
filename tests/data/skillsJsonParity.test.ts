import { describe, expect, it } from 'vitest';
import { skillBookFromDefs as skillBook } from '../../src/data/skills';
import { currentVersionOf, skillBookFromJson, skillContentMeta } from '../../src/data/skillsContent';
import { validateSkillDocument } from '../../src/data/validateSkillContent';
import document from '../../src/data/content/skills.v1.json';
import { MIGRATED_SKILL_IDS } from './migratedSkillIds';

/**
 * THE BACKBONE OF THE CONTENT MIGRATION — and it is TEMPORARY BY DESIGN.
 *
 * It proves the JSON book is BEHAVIOUR-NEUTRAL against the hand-written TS book
 * that is still the live source. Until this is green, src/data/skills.ts must NOT
 * be deleted: every other guarantee in the project (the balance audit, the
 * card-text audit, the 400-case outcome baseline) is stated against the TS book,
 * and this equality is what transfers all of them to the JSON book at once
 * instead of re-proving them one by one.
 *
 * WHEN skills.ts IS DELETED, DELETE THIS FILE WITH IT — at that point there is no
 * second book to compare against and the schema/hash tests take over.
 */
describe('data: skills.v1.json is behaviour-identical to the TS book', () => {
  it('still contains every card that existed before the migration', () => {
    // Scoped to the frozen pre-migration set on purpose — see migratedSkillIds.ts.
    // A card VANISHING is a real regression; a card being ADDED is not — so the
    // frozen list is a SUBSET check, and the id SETS of the two books must agree
    // (a card added to only one book is exactly the drift this file exists to
    // catch). The old assertion pinned the whole book to the frozen list, which
    // contradicted this comment by failing on any legitimately added card.
    for (const id of MIGRATED_SKILL_IDS) expect(skillBookFromJson[id], id).toBeDefined();
    for (const id of MIGRATED_SKILL_IDS) expect(skillBook[id], id).toBeDefined();
    expect(Object.keys(skillBookFromJson).sort()).toEqual(Object.keys(skillBook).sort());
  });

  it('deep-equals the TS book across every card (the migration proof)', () => {
    // WHOLE-BOOK equality — strictly stronger than the old frozen-subset check:
    // cards added after the migration are parity-proven too, so every guarantee
    // stated against the TS book transfers to them as well.
    expect(skillBookFromJson).toStrictEqual(skillBook);
  });

  it('every card round-trips field-for-field, including optional fields', () => {
    for (const id of MIGRATED_SKILL_IDS) {
      const ts = skillBook[id]!;
      const js = skillBookFromJson[id]!;
      expect(Object.keys(js).sort(), id + ' field set').toEqual(Object.keys(ts).sort());
      expect(js, id).toStrictEqual(ts);
    }
  });

  it('carries NO schema meta on the SkillDef itself (version/notes are sidecar only)', () => {
    for (const [id, def] of Object.entries(skillBookFromJson)) {
      const keys = Object.keys(def);
      expect(keys, id).not.toContain('version');
      expect(keys, id).not.toContain('notes');
    }
  });

  it('resolves CURRENT by highest version, independent of array order', () => {
    // The rule must not be "the last element": a document store may hand the
    // list back in any order, and array position is authoring convenience only.
    const ascending = [{ version: 1, tag: 'old' }, { version: 2, tag: 'new' }];
    const descending = [{ version: 2, tag: 'new' }, { version: 1, tag: 'old' }];
    const jumbled = [{ version: 3, tag: 'newest' }, { version: 1, tag: 'old' }, { version: 2, tag: 'mid' }];
    expect(currentVersionOf(ascending).tag).toBe('new');
    expect(currentVersionOf(descending).tag).toBe('new');
    expect(currentVersionOf(jumbled).tag).toBe('newest');
    expect(currentVersionOf([{ version: 7, tag: 'only' }]).tag).toBe('only');
  });

  it('every card document holds exactly one version today, and the book resolves to it', () => {
    for (const id of Object.keys(skillBookFromJson)) {
      const m = skillContentMeta[id]!;
      expect(m.versions, id).toEqual([1]);
      expect(m.version, id).toBe(1);
    }
  });

  it('exposes a version for every card in the sidecar', () => {
    for (const id of Object.keys(skillBookFromJson)) {
      expect(skillContentMeta[id]!.version, id).toBeGreaterThanOrEqual(1);
    }
  });

  it('validates clean — the contract has ONE outcome, so any problem is a failure', () => {
    expect(validateSkillDocument(document)).toEqual([]);
  });

  it('preserves the rescued balance derivations as notes', () => {
    const withNotes = Object.values(skillContentMeta).filter((m) => (m.notes?.length ?? 0) > 0);
    // JSON has no comments; these lines are the reasoning behind every price and
    // would be DESTROYED by a naive conversion. 114 lines across 28 cards at the
    // time of migration — assert the floor, not the exact count, so adding a card
    // does not fail this.
    expect(withNotes.length).toBeGreaterThanOrEqual(28);
    const total = withNotes.reduce((n, m) => n + (m.notes?.length ?? 0), 0);
    expect(total).toBeGreaterThanOrEqual(114);
  });
});
