/**
 * Regenerates `outcomeBaseline.json` from the CURRENT engine.
 *
 *   npx tsx tests/engine/fixtures/captureOutcomeBaseline.ts
 *
 * The fixture is a REGRESSION LOCK, not a spec: it pins the exact logs of the
 * shared sweep (`tests/engine/helpers/sweepConfigs.ts`) so that a change which
 * is supposed to be scoped to one mechanic cannot silently move anything else.
 * `outcomeRule.test.ts` reads it to guard the ATTRITION THRESHOLD BOUNDARY —
 * fights decided before turn `ATTRITION_START_TURN` must be untouched by
 * attrition work.
 *
 * Regenerate ONLY for a deliberate, reviewed rule change (and say so in the
 * `note` below), never to make a red test go green. Prints a per-case diff
 * against the existing fixture so the blast radius is visible.
 *
 * Not a `*.test.ts` file, so vitest never collects it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { simulate, ATTRITION_START_TURN } from '../../../src/engine/combat/simulate';
import { sweepCases } from '../helpers/sweepConfigs';
import { outcomeHash as hash } from '../helpers/outcomeHash';
import type { CombatConfig } from '../../../src/engine/types';

const OFF = 1_000_000;
const OUT = new URL('./outcomeBaseline.json', import.meta.url);

interface Entry {
  result: string;
  turns: number;
  hash: string;
}

function capture(extra: Partial<CombatConfig>): Entry[] {
  return sweepCases(0xba5e11, 200, { maxTurns: 200, ...extra }).map(({ config, seed }) => {
    const r = simulate(structuredClone(config), seed);
    return { result: r.result, turns: r.turns, hash: hash({ events: r.events, finalState: r.finalState, result: r.result }) };
  });
}

const next = {
  normalization:
    'Hashes are taken through tests/engine/helpers/outcomeHash.ts (shared with outcomeRule.test.ts), ' +
    'which strips PRESENTATION/AUTHORING-ONLY card fields before hashing: `text` anywhere, `name` ' +
    'on SkillDef-shaped objects, and (2026-08-17) `tierUpgrades` on SkillDef-shaped objects. The ' +
    'sim reads none of them at resolved-skill time, so a content copy-edit or a tier-authoring ' +
    'change no longer forces a fixture regeneration. Everything the engine consumes — the full ' +
    'event log, all combatant state (incl. each combatant `name`), and every behavioural SkillDef ' +
    'field (effects, property, size, speedWeight, cooldownTurns, tier, rarity, element, weapon, ' +
    'scope, aura, special) — is still hashed byte-for-byte. OBJECT KEYS ARE SORTED before ' +
    'stringify (2026-08-09), so the hash is a function of VALUES ONLY and no ' +
    'rebuild-in-a-different-field-order can churn it. ARRAY order is untouched and ' +
    'still fully load-bearing.',
  note:
    'Regression lock recaptured (2026-08-21) for the `chainBonus` KEYWORD — a purely ADDITIVE ' +
    'STATE CHANGE, not a rule change: no existing behaviour moved, and the containment proof ' +
    'below is exhaustive rather than a sample. `chainBonus` is the type-axis twin of `comboBonus` ' +
    '(bonus damage when the caster\'s PREVIOUS resolved cast was of a named card type — a weapon ' +
    'on a physical card, an element on a magical one; `cardType` = `element ?? weapon`). Reading ' +
    'that gate requires remembering the previous cast\'s type, so `CombatantState` gained ONE new ' +
    'lazily-written field, `lastCastType`, stamped in `simulate.ts` beside the ' +
    '`lastCastArchetypes` it is the twin of. THAT FIELD IS THE ENTIRE REASON EVERY HASH IN THIS ' +
    'FIXTURE MOVED: `outcomeHash` hashes all combatant state, so a new key on a combatant that ' +
    'has cast changes the hash even when nothing it does changes. THE PROOF, taken from ' +
    'read-only RAW dumps (full event log + finalState + result + turns, NOT normalized and NOT ' +
    'hashed) of both 200-fight sweeps immediately before and immediately after the change, ' +
    'compared leaf-by-leaf across all 400 cases: (1) 0/400 EVENT LOGS moved — byte-identical ' +
    'under key-sorted serialisation; (2) 0/400 `result` or `turns` values moved; (3) 2546 ' +
    'finalState leaf differences in total, and EVERY SINGLE ONE is the same kind — an ADDED ' +
    '`lastCastType` key. Zero VALUE changes, zero REMOVED keys, zero type changes, and no other ' +
    'field name appears anywhere in the diff. So the sim decides every one of these 400 fights ' +
    'exactly as it did before; only the recorded shape of a combatant grew. No card in the ' +
    'frozen sweep pool (`fixtures/frozenSweepSkillIds.ts`) carries the new keyword — the two ' +
    'showcase cards (`finishing_cleave`, an axe gated after a sword, and `thermal_shock`, frost ' +
    'gated after fire) are new content outside that literal snapshot — so none of these fights ' +
    'exercises the keyword at all; they only carry the field it reads. The keyword\'s own ' +
    'behaviour is pinned separately by tests/engine/chainBonus.test.ts.',
  attritionOff: capture({ attritionTurn: OFF }),
  attritionOn: capture({}),
};

const prev = JSON.parse(readFileSync(OUT, 'utf8')) as { attritionOff: Entry[]; attritionOn: Entry[] };
for (const key of ['attritionOff', 'attritionOn'] as const) {
  let changed = 0;
  let changedBeforeThreshold = 0;
  next[key].forEach((entry, i) => {
    const before = prev[key][i]!;
    if (before.hash === entry.hash) return;
    changed += 1;
    if (before.turns < ATTRITION_START_TURN) changedBeforeThreshold += 1;
  });
  console.log(`${key}: ${changed}/${next[key].length} logs changed (${changedBeforeThreshold} of them decided before turn ${ATTRITION_START_TURN})`);
}

writeFileSync(OUT, `${JSON.stringify(next, null, 1)}\n`);
console.log(`wrote ${OUT.pathname}`);
