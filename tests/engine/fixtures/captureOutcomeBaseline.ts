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
    'which strips PRESENTATION-ONLY card fields before hashing: `text` anywhere, and `name` on ' +
    'SkillDef-shaped objects. The sim reads neither, so a content copy-edit no longer forces a ' +
    'fixture regeneration. Everything the engine consumes — the full event log, all combatant ' +
    'state (incl. each combatant `name`), and every behavioural SkillDef field (effects, property, ' +
    'size, speedWeight, cooldownTurns, tier, rarity, element, weapon, scope, aura, special, ' +
    'tierUpgrades) — is still hashed byte-for-byte.',
  note:
    'Regression lock recaptured (2026-08-03) for the ANTI-HEAL WORLD RULE ' +
    '(game-director approved 2026-08-01, built 2026-08-03): a REAL, REVIEWED RULE ' +
    'CHANGE. Regular heals and lifesteal are taxed -20% per affliction category ' +
    'active on the RECEIVER (DoT family / stat debuff / expose, cap -60%); TRUE ' +
    'heals are immune. Blast radius verified BEFORE regenerating: exactly 75/200 ' +
    'logs moved in each sweep, and those 75 are EXACTLY the logs that contain a ' +
    'heal event carrying the new `antiHeal` annotation (0 logs moved without one, ' +
    '0 annotated logs left unmoved). 7 of them end on a different turn and 1 ' +
    '(attritionOn #172) flips its winner — the expected consequence of less ' +
    'healing, not a scope leak. See src/engine/combat/interpreter.ts ' +
    '(applyAntiHeal / antiHealCategories) and tests/engine/antiHeal.test.ts. ' +
    'It supersedes the prior regen (2026-08-01) for the TRUE-heal re-price ' +
    '(PRICE.flatTrueHealPerPoint 2 -> 4, balance-designer pass): a REAL BEHAVIOR ' +
    'CHANGE, unlike the prior representation-only regens noted below. ' +
    'second_wind/renewing_wave/purify heal for smaller flat amounts at every ' +
    'tier (e.g. second_wind Bronze 50 -> 25), which changes sim outcomes for any ' +
    'sweep config that casts one of those three cards. Both supersede two earlier ' +
    'non-rule regenerations that the presentation-field ' +
    'normalizer (see `normalization` above) made unnecessary: (a) the card-text ' +
    'canonical-token sweep (ATK/MATK/DEF/MDEF/SPD), which moved every hash without ' +
    'touching a single mechanic — exactly the churn `text` stripping kills, and ' +
    '(b) the additive shield event metadata (shieldGain.calculation, ' +
    'shieldGain.poolsAfter, damage.shieldDrain), which re-hashed the 140/200 logs ' +
    'containing a shield event and left every other byte identical. ' +
    'Guards the ATTRITION THRESHOLD BOUNDARY in outcomeRule.test.ts: fights ' +
    'decided before ATTRITION_START_TURN must stay byte-identical across RULE changes. Regenerate ' +
    'with tests/engine/fixtures/captureOutcomeBaseline.ts, and only for a deliberate, reviewed change.',
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
