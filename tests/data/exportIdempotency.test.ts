import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { skillsDocumentText } from '../../scripts/exportContent';
import { gemsDocumentText } from '../../scripts/exportGems';

/**
 * THE REGRESSION TEST FOR CONTENT-EXPORT DRIFT.
 *
 * `npm run content:export` regenerates skills.v1.json / gems.v1.json from the
 * live TS books (src/data/skills.ts, src/data/gems.ts) — see the exporters'
 * own doc comments for why a dump FROM the book, not hand transcription, is
 * the trusted path. But a dump is only trustworthy AS A TOOL if running it
 * over unchanged source reproduces the file that is already committed: if it
 * doesn't, every routine content edit drags in unrelated byte churn (or worse,
 * an agent reverts the tool's own output and hand-edits the JSON instead,
 * which is exactly how the two representations drift apart silently).
 *
 * tests/data/skillsJsonParity.test.ts and gemsJsonParity.test.ts already prove
 * the SEMANTIC content of the JSON documents agrees with the TS books — that
 * is why a real drift (non-ASCII escaping written raw instead of `\uXXXX`)
 * shipped unnoticed: the values matched while the bytes didn't. This test
 * closes that gap by comparing bytes, not parsed values.
 *
 * Generation happens IN MEMORY (`skillsDocumentText` / `gemsDocumentText`,
 * exported by the scripts themselves) rather than by shelling out to
 * `tsx scripts/exportContent.ts` — both scripts already gate their
 * `writeFileSync` behind a "this file is the process entry point" check
 * (`process.argv[1]`), so importing them for the computed string does not
 * touch the filesystem.
 */
describe('data: content:export is idempotent against the committed content files', () => {
  it('skills.v1.json: regenerating from src/data/skills.ts reproduces the committed file byte-for-byte', () => {
    const committed = readFileSync(new URL('../../src/data/content/skills.v1.json', import.meta.url), 'utf8');
    expect(skillsDocumentText).toBe(committed);
  });

  it('gems.v1.json: regenerating from src/data/gems.ts reproduces the committed file byte-for-byte', () => {
    const committed = readFileSync(new URL('../../src/data/content/gems.v1.json', import.meta.url), 'utf8');
    expect(gemsDocumentText).toBe(committed);
  });

  it('skills.v1.json carries no raw non-ASCII bytes (the committed convention this exporter must preserve)', () => {
    // The exact diagnostic this bug was found with: an un-escaped export
    // rewrites every `\uXXXX` site (em dash, middle dot, ...) as a raw UTF-8
    // character. Pinning the byte-range directly, on top of the byte-for-byte
    // check above, so a future change to the escaping helper that happens to
    // still equal length/content in some edge case cannot silently regress
    // this specific property.
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7f]/.test(skillsDocumentText)).toBe(false);
  });
});
