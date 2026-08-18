import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { enemiesDocumentText } from '../../scripts/exportEnemies';

/**
 * THE REGRESSION TEST FOR ENEMY CONTENT-EXPORT DRIFT — the twin of
 * `tests/data/exportIdempotency.test.ts` (skills/gems), as a SEPARATE file on
 * purpose: skills.v1.json and gems.v1.json are owned by other agents' work in
 * flight, and this document/exporter pair has no shared line with theirs, so
 * a dedicated file avoids any merge collision on the shared one.
 *
 * `npm run content:export` regenerates enemies.v1.json from the live TS book
 * (src/data/enemies.ts) — see scripts/exportEnemies.ts's own doc comment for
 * why a dump FROM the book, not hand transcription, is the trusted path. But
 * a dump is only trustworthy AS A TOOL if running it over unchanged source
 * reproduces the file that is already committed: if it doesn't, every
 * routine content edit drags in unrelated byte churn (or worse, an agent
 * reverts the tool's own output and hand-edits the JSON instead, which is
 * exactly how a TS book and its JSON mirror drift apart silently — the
 * documented failure mode this whole content-JSON scheme exists to close).
 *
 * A semantic parity test (tests/data/enemiesJsonParity.test.ts) proves the
 * two representations agree on VALUE. That is not enough on its own — values
 * can match while bytes differ (skills.v1.json shipped exactly that drift
 * once: non-ASCII escaping written raw instead of `\uXXXX`) — so this test
 * compares bytes, not parsed values.
 *
 * Generation happens IN MEMORY (`enemiesDocumentText`, exported by the
 * exporter itself) rather than by shelling out to `tsx
 * scripts/exportEnemies.ts` — the script gates its `writeFileSync` behind a
 * "this file is the process entry point" check (`process.argv[1]`), so
 * importing it for the computed string does not touch the filesystem.
 */
describe('data: enemies content:export is idempotent against the committed content file', () => {
  it('enemies.v1.json: regenerating from src/data/enemies.ts reproduces the committed file byte-for-byte', () => {
    const committed = readFileSync(new URL('../../src/data/content/enemies.v1.json', import.meta.url), 'utf8');
    expect(enemiesDocumentText).toBe(committed);
  });

  it('enemies.v1.json carries no raw non-ASCII bytes (the ASCII-safe convention this exporter follows, matching skills.v1.json)', () => {
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7f]/.test(enemiesDocumentText)).toBe(false);
  });
});
