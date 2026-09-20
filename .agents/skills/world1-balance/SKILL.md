---
name: world1-balance
description: Use before pricing, re-pricing, or auditing any card effect, rider, gem, enemy or tier-upgrade path in World1 - before touching src/engine/balance.ts or a card's effects in src/data/content/skills.v1.json, and before running npm run scaffold:card or npm run sim. Names the exact PRICE/EFFECT_CAPS_DECI/TIER_BUDGET_DECI constants, the deci-PL convention, the solver that grows a card onto its budget, and the audit tests a card must pass, so a magnitude gets SOLVED instead of guessed.
---

# World1 balance — pricing and tuning

## LOCKED: PL is the balance unit — not winrate

Never tune a card, enemy or budget to a fixed board's winrate. Prices are
solved from the rules in `src/engine/balance.ts`; outcomes (who wins, how
long a fight runs) are emergent, never the target. `npm run sim` is a manual
exploration tool for eyeballing a matchup — it is not evidence a price is
right or wrong. Owner: `docs/design-locked.md` ("Balance philosophy: PL is
the balance unit — not winrate").

## Single source of truth: `src/engine/balance.ts`

Every rate is a named, doc-commented constant there — read it, never
hand-copy a number out of it:

- **`PRICE`** — the per-unit deci-PL rate for every keyword (flat damage,
  DoT stacks, stun turns, conditional-rider discounts, aura reach, hero-scope
  stat points, …), each with its derivation in a doc comment at the field.
- **`TIER_BUDGET_DECI`** / **`BUDGET_TOLERANCE_DECI`** — the four tier
  budgets a card's whole kit must sum to, and the tolerance (**zero** —
  budgets are exact, user-locked).
- **`EFFECT_CAPS_DECI`** / **`effectCapDeci`** — per-size, per-family
  investment ceilings (`control`/`dot`/`empower`/`cleanse`/`damage`/
  `shield`/`heal`) so a big tier budget can't become lockdown or a DoT bomb.
- **`RARITY_PL_DECI`** — the deci-PL band each gem rarity must land inside.
- **`CARD_SPLASH_PRICE_DECI`** — the card-tier Splash curve (gems use
  `PRICE.splashFlatDeci` instead — they're tierless).
- The pricers that read all of the above: `powerLevelDeci`, `isOnBudget`,
  `capViolations`, `powerLevelBreakdown`, `guaranteedPowerLevelDeci` (cards);
  `gemPowerLevelDeci`, `gemPowerLevel`, `isGemOnBudget` (gems).

`src/engine/keywords/pricing.ts` (`buildKeywordPricing`) holds the per-keyword
**shape** — which of a card's fields feed which rate — built once from
`PRICE`; it never invents a number of its own. Prose and rationale live ONLY
in `docs/power-level-reference.md`, which cites these exact constant names
and never restates a value — if the doc and the code ever disagree, the code
wins and the doc gets fixed.

## deci-PL: integers, always

Every PL number in code is **PL × 10**, so a Bronze budget is `100`, not
`10.0`. Every division in the pricer floors immediately (`Math.floor`) —
never a float, never a rounded display number fed back into a check. A rate
is "1 PL per 2 units" or "1 PL per stack", never a fraction that only looks
clean at one magnitude.

## Solve, don't guess

`npm run scaffold:card -- --id <id> --name "<Name>" --tier <tier> --size
<1|2|3> --property <physical|magical|true> [--element <e> | --weapon <w>]
--archetypes <a,..> --keywords <k1,k2,..>` asks `powerLevelDeci`,
`KEYWORD_PRICING` and `capViolations` — the real functions, not a copy — to
grow the requested keywords' own magnitudes onto the exact tier budget, then
prints the generated card face (`renderSkillText`) and an audit table at
every tier the card exists at. **It writes nothing** — it prints a
ready-to-paste `skills.v1.json` block, and refuses to print one that fails
its own audit or the content validator.

## References

| File | What it has |
|---|---|
| `references/pricing-tables.md` | Where each `balance.ts` constant lives and its role; the six `PriceTerm` shapes in `keywords/pricing.ts`; how a keyword's rate becomes a card's total PL |
| `references/pricing-a-card.md` | The ordered author → solve → audit workflow, what each audit test checks, and the real test filenames |
| `references/measuring.md` | The tools that produce evidence (`npm run sim`, `npm run output`) — real invocations, not descriptions |
| [`docs/power-level-reference.md`](../../../docs/power-level-reference.md) | Owner doc: rationale and worked examples for every rate |
| [`docs/design-locked.md`](../../../docs/design-locked.md) | Owner of the "PL is the balance unit" ruling and every other locked balance decision |

Load **`world1-handoff`** before your first edit — another agent may already
be mid-pass on `balance.ts` or a content JSON file.
