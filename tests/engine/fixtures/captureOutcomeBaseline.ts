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
    'Regression lock recaptured (2026-08-05) for DEFENSIVE-STAT SCALING of shields ' +
    'and heals (user-approved 2026-08-04): a REAL, REVIEWED RULE CHANGE. A card\'s ' +
    '`property` still picks WHICH stat scales its output, but the ROLE of the action ' +
    'now picks WHICH SIDE of the stat sheet that lookup reads — defensive output ' +
    '(shield / heal) scales off Armor (physical) and Magic Resist (magical) via the ' +
    'new `scaleDefStat`, where it previously read Attack / Magic Power via ' +
    '`scaleStat`. TRUE stays flat by identity (0 stat term), exactly as before. ' +
    'PL-NEUTRAL: attack/magicPower/armor/magicResist all cost 1 PL per +1 and all ' +
    'start at 1 (LEVEL_STAT_COST, BASE_HERO_STATS in src/run/leveling.ts), so no ' +
    'price in src/engine/balance.ts moves — only WHICH stat buys the output. ' +
    'Blast radius verified BEFORE regenerating, over both 200-fight sweeps: ' +
    '153/200 logs moved in EACH sweep (142 of them decided before ' +
    'ATTRITION_START_TURN), with 2 winner flips (#9 and #138, the same two in both ' +
    'sweeps) and 13 turn changes — the expected consequence of every shield pool and ' +
    'heal resizing. CONTAINMENT PROVEN BY EXHAUSTION: 0 logs moved WITHOUT containing ' +
    'a shieldGain or heal event, so nothing outside the changed mechanic drifted. The ' +
    '15 logs that DO contain one and did NOT move are each explained: 12 carry only a ' +
    'zero stat term (TRUE shields/heals, flat by identity under both rules) and 3 ' +
    '(#4, #65, #142) carry only a `leeching_fang` LIFESTEAL heal, which is a ' +
    'percentage of damage dealt and never had a stat-scaling term under either rule. ' +
    'See src/engine/combat/interpreter.ts (`scaleDefStat` and its `scaleStat` ' +
    'sibling), src/engine/combat/events.ts (shieldGain.calculation.statBonus docs) ' +
    'and tests/engine/effects.test.ts. It supersedes the prior regen: ' +
    'Regression lock recaptured (2026-08-04) for the FIRST-TO-FALL OUTCOME RULE ' +
    '(user-directed 2026-08-04): a REAL, REVIEWED RULE CHANGE. Combat now ends at ' +
    'the exact APPLICATION that wipes a side, so nothing later in the same step ' +
    'runs — no DoT/attrition/fatigue tick after the killing blow, no bleed tick on ' +
    'a performer whose cast just won, and no lifesteal-back off a killing blow. ' +
    'Mutual wipes therefore cannot occur and the 2026-07-30/31 tempo tiebreak is ' +
    'unreachable (kept in decideOutcome as a documented defensive fallback). ' +
    'Blast radius verified BEFORE regenerating, by diffing this engine against a ' +
    'byte copy of the pre-change simulate.ts + interpreter.ts over all 740 fights ' +
    'the engine suite sweeps: attritionOff 2/200 and attritionOn 3/200 logs moved ' +
    '(#10 and #83 in both, plus #15 with attrition on). For EVERY moved log the ' +
    'diff proved: (a) the events up to AND INCLUDING the death that wiped a side ' +
    'are byte-identical, (b) the new log is a strict SUBSEQUENCE of the old one — ' +
    'nothing was invented, (c) every removed event is a post-wipe application ' +
    '(#10: one lifesteal heal on a killing blow; #83: one bleed tick after a ' +
    'killing cast; #15: two attrition ticks after a side was already wiped), and ' +
    '(d) `turns` did not move. ZERO winner flips in either sweep, and 0 of the 740 ' +
    'fights was a former mutual wipe in the baseline families (1 was in the ' +
    'wider 0x5117e5 sweep, and it kept its result). See ' +
    'src/engine/combat/simulate.ts (`sweep`, `decideOutcome`), ' +
    'src/engine/combat/interpreter.ts (`applyCast`) and ' +
    'tests/engine/outcomeRule.test.ts. It supersedes the prior regen: ' +
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
