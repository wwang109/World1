/**
 * BUILD GATE for the JSON content documents.
 *
 *   npm run content:validate     (also runs first inside `npm run build`)
 *
 * WHY THIS EXISTS AS A SEPARATE STEP. The loader
 * (`src/data/skillsContent.ts`) already THROWS at import time, which covers the
 * dev server, vitest, the dev battle service and — because
 * `functions/battle.ts` transitively imports it — the deployed Pages Function at
 * module init. But "throws at module init in production" means the first player
 * request of the deploy is what discovers the bad content. This step moves that
 * discovery to BUILD time, so no deployable artifact can be produced from a
 * document that would not load.
 *
 * STRICT: errors AND warnings both fail. Warnings are unknown fields — a typo
 * (`capp` for `cap`) is indistinguishable from a field of a newer schema, so the
 * repo that OWNS the content refuses both, while the runtime loader stays lenient
 * for an older reader in the wild. That asymmetry is the design.
 *
 * Output names the card id, the field and the reason, because the intended
 * author is an agent acting on the message rather than a human reading the code.
 */
import { readFileSync } from 'node:fs';
import type { ContentProblem } from '../src/data/validateSkillContent';
import { validateSkillDocument } from '../src/data/validateSkillContent';
import { validateGemDocument } from '../src/data/validateGemContent';
import { findDuplicateKeys } from './jsonDuplicateKeys';
import skills from '../src/data/content/skills.v1.json';
import gems from '../src/data/content/gems.v1.json';

type Validator = (doc: unknown) => ContentProblem[];
const documents: Array<[string, URL, unknown, Validator]> = [
  ['src/data/content/skills.v1.json', new URL('../src/data/content/skills.v1.json', import.meta.url), skills, validateSkillDocument],
  ['src/data/content/gems.v1.json', new URL('../src/data/content/gems.v1.json', import.meta.url), gems, validateGemDocument],
];

let failures = 0;

for (const [name, file, doc, validate] of documents) {
  // (1) RAW BYTES FIRST. Duplicate keys inside one object are invisible after
  // JSON.parse (it silently keeps the LAST one), so this is the only place that
  // structural lie can be seen at all.
  const dupes = findDuplicateKeys(readFileSync(file, 'utf8'));
  for (const d of dupes) {
    failures += 1;
    console.error(`  ERROR  ${name} line ${String(d.line)} (${d.path}): duplicate key "${d.key}" — first seen line ${String(d.firstLine)}; JSON.parse keeps only the LAST`);
  }

  // (2) PARSED SHAPE: schema + completeness. One outcome — any problem fails.
  const problems = validate(doc);
  for (const p of problems) {
    failures += 1;
    console.error(`  ERROR  ${name} ${p.where}: ${p.message}`);
  }

  if (dupes.length === 0 && problems.length === 0) {
    const d = doc as { cards?: unknown[]; gems?: unknown[] };
    const count = (d.cards ?? d.gems)?.length ?? 0;
    console.log(`ok  ${name} — ${String(count)} documents, no problems`);
  }
}

if (failures > 0) {
  console.error(
    `\ncontent validation FAILED: ${String(failures)} problem(s).`
    + '\nThe schema is a CONTRACT: it rejects anything it does not define, unknown fields included.'
    + '\nSee src/data/content/README.md for the shape, the enum values, and the rules a card must satisfy.',
  );
  process.exit(1);
}
console.log('content validation passed');
