import { describe, expect, it } from 'vitest';
import { gemBookFromDefs } from '../../src/data/gems';
import { gemBookFromJson, gemContentMeta } from '../../src/data/gemsContent';
import { validateGemDocument } from '../../src/data/validateGemContent';
import document from '../../src/data/content/gems.v1.json';
import { MIGRATED_GEM_IDS } from './migratedGemIds';

/**
 * THE MIGRATION PROOF for gems — TEMPORARY BY DESIGN, exactly like its skills twin.
 *
 * Until this is green, src/data/gems.ts must NOT lose its literals: the gem audit
 * (exact rarity band, zero tolerance), the shop/draft/event pool tests and the
 * fight-log byte-identity are all stated against the TS book, and this equality is
 * what transfers them to the JSON book in one step rather than re-proving each.
 *
 * WHEN gems.ts LOSES ITS LITERALS, DELETE THIS FILE WITH IT.
 */
describe('data: gems.v1.json is behaviour-identical to the TS book', () => {
  it('still contains every gem that existed at migration time', () => {
    // Scoped to the frozen migration-time set on purpose — mirrors the skills
    // twin (tests/data/skillsJsonParity.test.ts): a gem VANISHING is a real
    // regression; a gem being ADDED after migration is not, so this is a
    // SUBSET check plus a same-id-SET-between-books check, not an exact pin
    // to the frozen list. The old assertion (`toEqual([...MIGRATED_GEM_IDS])`)
    // pinned the whole book to the frozen list and failed on any legitimately
    // added gem — the same bug the skills version was fixed for.
    for (const id of MIGRATED_GEM_IDS) expect(gemBookFromJson[id], id).toBeDefined();
    for (const id of MIGRATED_GEM_IDS) expect(gemBookFromDefs[id], id).toBeDefined();
    expect(Object.keys(gemBookFromJson).sort()).toEqual(Object.keys(gemBookFromDefs).sort());
  });

  it('deep-equals the TS book across every gem (the migration proof)', () => {
    // WHOLE-BOOK equality, same upgrade the skills twin took: gems added after
    // migration are parity-proven too, not just the frozen migrated set.
    expect(gemBookFromJson).toStrictEqual(gemBookFromDefs);
  });

  it('every gem round-trips field-for-field, including optional fields', () => {
    for (const id of MIGRATED_GEM_IDS) {
      const ts = gemBookFromDefs[id]!;
      const js = gemBookFromJson[id]!;
      expect(Object.keys(js).sort(), id + ' field set').toEqual(Object.keys(ts).sort());
      expect(js, id).toStrictEqual(ts);
    }
  });

  it('carries NO schema meta on the GemDef itself (version/notes are sidecar only)', () => {
    for (const [id, def] of Object.entries(gemBookFromJson)) {
      const keys = Object.keys(def);
      expect(keys, id).not.toContain('version');
      expect(keys, id).not.toContain('notes');
    }
  });

  it('exposes a version for every gem, and one version per document today', () => {
    for (const id of Object.keys(gemBookFromJson)) {
      expect(gemContentMeta[id]!.versions, id).toEqual([1]);
      expect(gemContentMeta[id]!.version, id).toBe(1);
    }
  });

  it('validates clean — the contract has ONE outcome, so any problem is a failure', () => {
    expect(validateGemDocument(document)).toEqual([]);
  });

  it('preserves the rescued balance derivations as notes', () => {
    const withNotes = Object.values(gemContentMeta).filter((m) => (m.notes?.length ?? 0) > 0);
    // 104 lines across 33 gems at migration time — the reasoning behind every band
    // placement, which JSON has no comments to hold. Assert the floor, not the
    // exact count, so adding a gem does not fail this.
    expect(withNotes.length).toBeGreaterThanOrEqual(33);
    expect(withNotes.reduce((n, m) => n + (m.notes?.length ?? 0), 0)).toBeGreaterThanOrEqual(104);
  });
});
