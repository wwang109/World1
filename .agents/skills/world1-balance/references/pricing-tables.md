# Pricing tables — where each constant lives

Every name below was opened in `src/engine/balance.ts` (or
`src/engine/keywords/pricing.ts`) and confirmed to exist on this checkout.
Numbers are NOT copied here — they move; read the constant, not this page,
for a value.

## `src/engine/balance.ts` — the constants

| Constant | Role |
|---|---|
| `PRICE` | The named per-unit deci-PL rate for every keyword. Each field carries its own derivation as a doc comment — e.g. `flatPowerPerPoint`, `truePremiumPerPoint`, `dotPerStack`, `stunPerTurn`, `conditionalBonusDen`, `auraDamageFlat`, `heroStatPerPoint` (a `Record<BuffableStat, number>`). Structurally required by `PriceRates` in `keywords/pricing.ts` — a rate removed from `PRICE` fails `tsc` at the pricing table, not silently. |
| `TIER_BUDGET_DECI` | The four tier budgets (deci) a card's whole kit must sum to exactly. |
| `BUDGET_TOLERANCE_DECI` | The audit tolerance — budgets are exact, no numeric tolerance (user-locked 2026-07-19). |
| `CARD_SPLASH_PRICE_DECI` | The Splash curve BY CARD TIER (Bronze→Diamond). Gems have no tier and use `PRICE.splashFlatDeci` instead. |
| `MAX_COOLDOWN_TURNS` | Clamp on the cooldown REFUND side, derived from the frozen 200-fight regression sweep's fight-length percentiles. Shared by `cooldownDeviationDeci` (below) and `capViolations`. |
| `cooldownDeviationDeci(cooldownTurns)` | THE ONE PLACE cooldown-deviation deci-PL is computed — shared by `powerLevelDeci`/`powerLevelBreakdown` here and `autoScaleTier` in `cards.ts`, so a future clamp change can't drift between callers. |
| `EFFECT_CAPS_DECI` | Per-size (1/2/3) investment ceiling per cap family: `control`, `dot`, `empower`, `cleanse`, `damage`, `shield`, `heal`. |
| `TIER_SCALED_FAMILIES` (module-private) | The two families whose cap GROWS with tier (`control`, `cleanse`) — every other family is frozen across tiers by design; `effectCapDeci` reads this set. |
| `effectCapDeci(family, size, tier?)` | The per-card cap for a family, tier-scaled only for the families above. |
| `MAX_STUN_PER_CARD`, `WEIGHT_MIN`, `WEIGHT_MAX_BY_SIZE`, `MAX_CARD_SIZE`, `MAX_EXPOSE_PCT`, `MAX_GUARD_PCT` | Native-unit (NOT PL) authoring bounds — checked by `capViolations` alongside the PL caps, because a legal PL total can still author an unplayable turn count or weight. |
| `RARITY_PL_DECI` | The deci-PL band each gem rarity (`common`/`rare`/`epic`/`legendary`) must land inside. |
| `GEM_CANONICAL_PROPERTY` | `'physical'` — the property an effect gem is priced at, independent of whichever card it ends up socketed into, so a gem's own PL never depends on its host. |
| `HIT_KINDS`, `OFFENSIVE_KINDS`, `CARD_TARGETING_KINDS`, `CONTROL_KINDS`, `DOT_KINDS`, `EMPOWER_KINDS`, `CLEANSE_KINDS`, `SCALABLE_KINDS` | Kind-membership sets, every one DERIVED from `KEYWORD_PRICING`'s own facets (`isHit`/`offensive`/`cardTargeting`/`family`/`scalable`) rather than hand-listed — see `kindsWhere`/`kindsInFamily`, module-private helpers just above `KEYWORD_PRICING`. |

### The pricers (the functions that read the table above)

| Function | What it prices |
|---|---|
| `priceActionDeci` / `actionsPriceDeci` (`keywords/pricing.ts` / `balance.ts`) | ONE action's terms, then a whole kit: multi-hit premium (`HIT_KINDS`, gated hits excluded), the self-synergy premium (`selfSynergyPremiumDeci`), the affinity refund (`affinityPayoffNum/Den`), then the AoE reach multiplier (`aoeTargetsNum/Den`) floored ONCE over the whole offensive share. |
| `powerLevelDeci(skill)` | The whole card: `actionsPriceDeci` over `tierResolved(skill).effects`, plus aura reach, weight deviation, size grant (`sizeGrantDeci`), cooldown deviation. |
| `guaranteedPowerLevelDeci(skill)` | The same total with every affinity-gated line stripped — "what this rank is worth on the worst board for it", the check that catches budget quietly moving from an always-on line into a gated one. |
| `powerLevelBreakdown(skill)` | The same math, itemized into labeled parts; a tested invariant is that the parts sum EXACTLY to `powerLevelDeci`. |
| `capViolations(skill)` | Every `EFFECT_CAPS_DECI` family check plus the native-unit bounds above; empty array = compliant. |
| `disruptCostDeci`, `sizeGrantDeci`, `auraModsDeci`, `selfSynergyPremiumDeci`, `echoHostShareDeci`, `burnTotalDamage` | One-off derived-value helpers `powerLevelDeci`/the pricer call into; each has its derivation in its own doc comment. |
| `gemPowerLevelDeci(gem, host?)` / `gemPowerLevel` / `isGemOnBudget` | The gem-side mirror: host-blind by default (a gem's own PL, checked against `RARITY_PL_DECI`); `host` swaps in the measured `echoHostShareDeci` for an uncapped echo, the one host-aware term. |
| `instancePowerLevelDeci(skill, piece)` | A socketed card+gem's combined PL — the plain sum of the two standalone prices (user-locked 2026-08-21: a pairing is never charged extra). |

## `src/engine/keywords/pricing.ts` — the per-keyword SHAPE

`buildKeywordPricing(PRICE)` builds one row per `Action['kind']`
(`KeywordPricingTable`), called once from `balance.ts` as `KEYWORD_PRICING`.
Every row is either **priced** (at least one term) or explicitly
**unpriced** with a stated `unpricedReason` — the union makes a silent
zero-price keyword a type error, not an oversight.

Six term forms cover every keyword (`PriceTerm`):

| Form | Shape | Example keyword |
|---|---|---|
| `perUnit` | `field * num/den` | `poison`/`burn`/`bleed` on `stacks`, `stun` on `turns` |
| `perUnitByProperty` | `field * num[property]/den` — the rate itself varies physical/magical/true | `damage`, `heal`, `shield` (the TRUE premium lives here) |
| `product` | `(fieldA * fieldB) * num/den` | `buffStat`/`debuffStat`/`guard`/`expose` on `pct * turns` |
| `bracketed` | marginal brackets, walked by the shared `walkBrackets` | `disrupt` |
| `flat` | one field-less price per action | `splash` (the spreader — no magnitude of its own) |
| (unpriced) | `price: []` + `unpricedReason` | none currently — every kind is priced |

Each `KeywordPricing` row also carries facets read elsewhere in the audit,
not just by the pricer: `isHit` (feeds `HIT_KINDS`), `scalable` (feeds
`SCALABLE_KINDS` — the tier-scaler's sink), `family` (feeds the cap-family
sets), `offensive` (feeds `OFFENSIVE_KINDS` — who pays the AoE multiplier),
`cardTargeting` (feeds `CARD_TARGETING_KINDS` — what `splash` may spread).

Shared helpers other than `buildKeywordPricing`: `priceActionDeci` (walk one
action's terms), `walkBrackets` (the one bracket-walk implementation, reused
by `disruptCostDeci`), `scalableRateDeci` (the per-property/per-unit rate the
tier-scaler's exact-sink solve reads for `damage`/`heal`/`shield`/`cleanse`).

## How a keyword's rate becomes a card's total PL

1. Author (or the scaffold solver grows) magnitudes on the card's `effects`.
2. `actionsPriceDeci` prices each action via `priceActionDeci` against
   `KEYWORD_PRICING`, then adds the multi-hit premium, the self-synergy
   premium, and the affinity refund per action, then the AoE reach
   multiplier once over the offensive share.
3. `powerLevelDeci` adds the card-level terms on top: aura reach, weight
   deviation, size grant, cooldown deviation.
4. The result must equal `TIER_BUDGET_DECI[tier]` exactly (`isOnBudget`) and
   pass every `capViolations` check — both are what `npm test`'s balance
   audit enforces per card, per tier.

See also: `pricing-a-card.md` for the authoring workflow and the
real audit test names; `measuring.md` for the tools that produce
evidence rather than describe it.
