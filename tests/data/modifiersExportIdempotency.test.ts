import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { modifiersDocumentText } from '../../scripts/exportModifiers';

/**
 * THE REGRESSION TEST FOR MODIFIER CONTENT-EXPORT DRIFT — the twin of
 * `tests/data/enemiesExportIdempotency.test.ts`, as its OWN file for the same
 * reason that one is separate from `tests/data/exportIdempotency.test.ts`
 * (skills/gems): skills.v1.json and gems.v1.json are owned by other agents'
 * work in flight, and this document/exporter pair shares no line with
 * theirs, so a dedicated file avoids any merge collision.
 *
 * `npm run content:export` regenerates modifiers.v1.json from the live TS
 * book (src/data/modifiers.ts) — see scripts/exportModifiers.ts's own doc
 * comment for why a dump FROM the book, not hand transcription, is the
 * trusted path. A dump is only trustworthy AS A TOOL if running it over
 * unchanged source reproduces the file that is already committed — that is
 * exactly what this test proves, and its absence is exactly what let the
 * skills doc drift once (values matched while bytes differed: non-ASCII
 * escaping written raw instead of `\uXXXX`), because a semantic-only parity
 * test cannot see that kind of drift.
 *
 * Generation happens IN MEMORY (`modifiersDocumentText`, exported by the
 * exporter itself) rather than by shelling out to `tsx
 * scripts/exportModifiers.ts` — the script gates its `writeFileSync` behind
 * a "this file is the process entry point" check (`process.argv[1]`), so
 * importing it for the computed string does not touch the filesystem.
 */
describe('data: modifiers content:export is idempotent against the committed content file', () => {
  it('modifiers.v1.json: regenerating from src/data/modifiers.ts reproduces the committed file byte-for-byte', () => {
    const committed = readFileSync(new URL('../../src/data/content/modifiers.v1.json', import.meta.url), 'utf8');
    expect(modifiersDocumentText).toBe(committed);
  });

  it('modifiers.v1.json carries no raw non-ASCII bytes (the ASCII-safe convention this exporter follows, matching skills.v1.json/enemies.v1.json)', () => {
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7f]/.test(modifiersDocumentText)).toBe(false);
  });
});
