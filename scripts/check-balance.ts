// Power Level catalog audit — the gate that keeps every shipped card and gem
// on its Power Level (PL) budget.
//
// Ported (2026-09-15) from the deleted `tests/engine/balance.test.ts` +
// `tests/engine/gemAudit.test.ts`, after the user's direct ruling that this
// repo carries no `*.test.ts` file at all (`scripts/check-boundaries.mjs` now
// refuses one on sight). Those two vitest files were the ONLY catalog-wide
// check that every shipped card sits exactly on its tier's budget and inside
// its effect caps — `npm run scaffold:card` only checks one card at a time,
// and `npm run content:validate` checks shape/ranges, never price. This
// script is that gate's replacement, run outside vitest.
//
// Same "collect violations into one array, print, exit 1" shape as
// `check-boundaries.mjs` / `check-skill-parity.mjs`, but this gate has to
// EXECUTE the pricing engine (`powerLevelDeci`, `capViolations`, `applyTier`,
// ...) against real catalog data rather than statically parse source text —
// a TypeScript AST walk can answer "does this file import phaser", never
// "what deci-PL does this card actually cost". So it runs under `tsx` (same
// as `npm run fight` / `npm run sim` / `npm run audit:hud`) instead of plain
// Node, and imports the real `src/` modules rather than reading them as text.
//
// Every rate/cap this reads (`TIER_BUDGET_DECI`, `BUDGET_TOLERANCE_DECI`,
// `EFFECT_CAPS_DECI` via `capViolations`, `RARITY_PL_DECI`) and every
// predicate it calls (`isOnBudget`'s own math via `powerLevelDeci`,
// `capViolations`, `isGemOnBudget`) comes from `src/engine/balance.ts` — this
// script never reimplements pricing math, only calls it and reports.
//
// Usage: `npm run audit:pl` (or `node node_modules/tsx/dist/cli.mjs
// scripts/check-balance.ts` directly, same as this project's other tsx-run
// scripts under a live/uninstalled `node_modules/.bin`).
import { applyTier } from '../src/engine/cards';
import { gemBook } from '../src/data/gems';
import { skillBook } from '../src/data/skills';
import {
  actionsPriceDeci,
  BUDGET_TOLERANCE_DECI,
  capViolations,
  gemPowerLevelDeci,
  isGemOnBudget,
  powerLevelBreakdown,
  powerLevelDeci,
  RARITY_PL_DECI,
  TIER_BUDGET_DECI,
} from '../src/engine/balance';
import { cardExistsAtTier, TIER_ORDER, type SkillDef, type SkillTier } from '../src/engine/types';

// Ported from the deleted `tests/engine/fixtures/affinityCapstones.ts` — a
// hand-curated CONTENT list of the five cards allowed to trade guaranteed
// output for a Diamond-only affinity-gated hit, not engine pricing logic.
// Adding an id here is a content-designer decision this script only reads.
const AFFINITY_CAPSTONE_IDS: readonly string[] = [
  'arcane_bolt',
  'hunter_shot',
  'judgment_light',
  'lance_thrust',
  'leeching_fang',
];

function isAllowedAffinityCapstoneRegression(id: string, toTier: SkillTier): boolean {
  return toTier === 'diamond' && AFFINITY_CAPSTONE_IDS.includes(id);
}

/** Every tier this card's floor (`skill.tier`) lets it be sold at. */
const reachableTiers = (card: SkillDef): SkillTier[] => TIER_ORDER.filter((t) => cardExistsAtTier(card, t));

/**
 * What a rank actually delivers, in deci-PL: the price of the card's
 * UNCONDITIONAL effects at that rank. Affinity-gated lines are excluded
 * because not every board can trigger them, so they are not something every
 * buyer of that rank receives — see `tests/engine/balance.test.ts`'s deleted
 * `alwaysOnOutputDeci` (identical derivation, ported verbatim).
 */
const alwaysOnOutputDeci = (skill: SkillDef): number =>
  actionsPriceDeci(skill.effects.filter((a) => a.affinity !== true), skill.property, skill.scope, skill.effects);

const violations: string[] = [];
let ranksChecked = 0;

for (const card of Object.values(skillBook)) {
  let previousOutput: number | undefined;
  for (const tier of reachableTiers(card)) {
    ranksChecked += 1;
    const ranked = applyTier(card, tier);

    const deci = powerLevelDeci(ranked);
    const budget = TIER_BUDGET_DECI[tier];
    if (Math.abs(deci - budget) > BUDGET_TOLERANCE_DECI) {
      violations.push(`BUDGET ${card.id}@${tier}: ${deci} deci-PL (budget ${budget} deci-PL, delta ${deci - budget})`);
    }

    for (const violation of capViolations(ranked)) {
      violations.push(`CAP ${card.id}@${tier}: ${violation}`);
    }

    const parts = powerLevelBreakdown(ranked);
    for (const part of parts) {
      if (part.deci % 10 !== 0) violations.push(`FRACTIONAL ${card.id}@${tier}: ${part.label} = ${part.deci / 10} PL`);
    }
    const summed = parts.reduce((total, part) => total + part.deci, 0);
    if (summed !== deci) {
      violations.push(`BREAKDOWN ${card.id}@${tier}: parts sum to ${summed} deci-PL, powerLevelDeci says ${deci}`);
    }

    const output = alwaysOnOutputDeci(ranked);
    if (previousOutput !== undefined && output < previousOutput && !isAllowedAffinityCapstoneRegression(card.id, tier)) {
      violations.push(`DOWNGRADE ${card.id}@${tier}: always-on output ${previousOutput} -> ${output} deci-PL`);
    }
    previousOutput = output;
  }
}

// NON-VACUITY (mirrors the deleted test): the sweep must really reach every
// rank of every card, or a future filter bug would pass by checking nothing.
const cardCount = Object.keys(skillBook).length;
if (ranksChecked !== cardCount * TIER_ORDER.length) {
  violations.push(
    `SWEEP: checked ${ranksChecked} card-tier ranks, expected ${cardCount * TIER_ORDER.length} ` +
    `(${cardCount} cards x ${TIER_ORDER.length} tiers) — some card is not reachable at every tier`,
  );
}

for (const gem of Object.values(gemBook)) {
  if (isGemOnBudget(gem)) continue;
  const deci = gemPowerLevelDeci(gem);
  const band = RARITY_PL_DECI[gem.rarity];
  violations.push(`GEM ${gem.id} (${gem.name}): ${deci} deci-PL (band ${band} deci-PL for ${gem.rarity}, delta ${deci - band})`);
}

const gemCount = Object.keys(gemBook).length;

if (violations.length > 0) {
  console.error(`Power Level audit violations (${ranksChecked} card-tier ranks across ${cardCount} cards, ${gemCount} gems checked):`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(`PL audit OK (${ranksChecked} card-tier ranks across ${cardCount} cards, ${gemCount} gems)`);
