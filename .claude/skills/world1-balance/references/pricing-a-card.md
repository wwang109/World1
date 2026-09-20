# Pricing a card — the ordered workflow

## 1. Author or adjust `effects`

`src/data/content/skills.v1.json` is the ONLY place a card is authored —
hand-authored, loaded by `src/data/skillsContent.ts` and re-exported by
`src/data/skills.ts` as `skillBook`. Decide the keywords, tier, size,
property and (element or weapon) first; magnitudes come from step 2, not a
guess.

## 2. Solve with `npm run scaffold:card`

`npm run` resolves only where the clone has a `node_modules/.bin`; both forms
below do the same thing, and the direct one runs either way.

```bash
npm run scaffold:card -- --id ember_dart --name "Ember Dart" \
  --tier bronze --size 1 --property magical --element fire \
  --archetypes offense --keywords damage,burn

# equivalent direct invocation (works when npm run does not):
node node_modules/tsx/dist/cli.mjs scripts/scaffoldCard.ts --id ember_dart \
  --name "Ember Dart" --tier bronze --size 1 --property magical \
  --element fire --archetypes offense --keywords damage,burn
```

Real run, this checkout:

```
=== GENERATED FACE (via renderSkillText — the real generator) ===
  bronze   Deal 10 (+MATK) Fire damage · {{Burn}} 5.
  silver   Deal 0 (+MATK) Fire damage · {{Burn}} 15.
  gold     Deal 0 (+MATK) Fire damage · {{Burn}} 20.
  diamond  Deal 10 (+MATK) Fire damage · {{Burn}} 20.
=== AUDIT (via src/engine/balance.ts — the real gates) ===
  bronze   PL  10.0 / 10  caps clean  OK
  silver   PL  15.0 / 15  caps clean  OK
  gold     PL  20.0 / 20  caps clean  OK
  diamond  PL  25.0 / 25  caps clean  OK
  isOnBudget: true
  content validator: clean

=== PASTE INTO src/data/content/skills.v1.json (cards[]) ===
{ "id": "ember_dart", "versions": [ { "version": 1, "def": { ... } } ] }
```

The tool asks `powerLevelDeci`, `capViolations` and `KEYWORD_PRICING` — the
real functions in `src/engine/balance.ts` / `src/engine/keywords/pricing.ts`
— to grow the requested keywords onto each tier's exact budget. It also runs
`validateSkillDocument` (`src/data/validateSkillContent.ts`), the same
content-shape gate the real loader runs, so a card that fails validation
(e.g. missing an `element`/`weapon` on a card that needs one) is refused
before it prints anything to paste. **It writes nothing to disk** — you
paste the printed block into `skills.v1.json` by hand.

A tier omitted from `--tier` upward is still solved and audited — the
printed table always runs from the requested tier through Diamond, because a
card with no scalable sink (`damage`/`heal`/`shield`/`cleanse`) cannot grow
into a higher tier and the tool should say so, not print a lie.

## 3. What the audit checks

Every card in `skillBook`, at every tier it exists at (walked via
`applyTier`), is checked for:

- **`isOnBudget`** — `powerLevelDeci` equals `TIER_BUDGET_DECI[tier]`
  exactly (`BUDGET_TOLERANCE_DECI` — budgets are exact, no numeric
  tolerance).
- **`capViolations`** — empty for every `EFFECT_CAPS_DECI` family plus the
  native-unit bounds (stun turn cap, weight bounds, max size, cooldown
  clamp).
- A **drift-lock** on `PRICE` itself (`tests/engine/balance.test.ts`,
  user-locked 2026-07-23) — the whole rate table is pinned so a rate cannot
  silently move without the test naming exactly which one changed.
- **Gems**: `isGemOnBudget` — every gem in `gemBook` sits exactly on its
  rarity's `RARITY_PL_DECI` value (`BUDGET_TOLERANCE_DECI` — budgets are
  exact, not a band).
- **Cross-tier ladder shape**: a card's guaranteed (non-gated) share and its
  authored magnitudes across Bronze→Diamond follow the documented growth
  invariants, not an ad hoc jump.

## 4. The real test files (verified to exist on this checkout)

| File | Owns |
|---|---|
| `tests/engine/balance.test.ts` | The `PRICE` drift-lock, the whole-book PL/cap audit, `powerLevelBreakdown`'s summing invariant, cooldown/weight/size math |
| `tests/engine/gemAudit.test.ts` | Every gem in `gemBook` inside its rarity band; all 4 rarities represented |
| `tests/engine/mixedTierBalance.test.ts` | Per-card tier-ladder magnitude/shape invariants across a card's authored ranks |

Run them directly (this form needs no `node_modules/.bin`):

```bash
node node_modules/vitest/vitest.mjs run tests/engine/balance.test.ts
node node_modules/vitest/vitest.mjs run tests/engine/gemAudit.test.ts
node node_modules/vitest/vitest.mjs run tests/engine/mixedTierBalance.test.ts
```

(`npx vitest run <file>` is equivalent wherever `node_modules/.bin` exists.)

A card off-budget or over a cap fails these tests by name — that failure is
the audit, not a suggestion; per `CLAUDE.md`, `npm test` must stay green
before any commit.
