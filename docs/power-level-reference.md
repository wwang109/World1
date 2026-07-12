# Power Level (PL) Reference

Single source of truth: **`PRICE` in `src/engine/balance.ts`**. Every row below
cites the exact constant name it's sourced from — if this doc and the code
ever disagree, the code (and its constant name) wins; fix the doc.

All math is done in **deci-PL** (PL × 10) integers — never floats. `powerLevelDeci(skill)`
sums the whole kit; `isOnBudget(skill)` checks it against the tier budget within
`BUDGET_TOLERANCE_DECI` (±5 deci = ±0.5 PL).

## Tier budgets (`TIER_BUDGET_DECI`)

| Tier | Budget (deci-PL) | Budget (PL) |
|---|---|---|
| Bronze | 100 | 10 |
| Silver | 150 | 15 |
| Gold | 200 | 20 |
| Diamond | 250 | 25 |

## Per-unit price table

Every constant lives in `PRICE`. "Unit" is the quantity the price multiplies;
all division is `Math.floor`'d immediately (integer deci-PL, no floats persist).

| Action / modifier | Formula (deci-PL) | Constant(s) | Note |
|---|---|---|---|
| `damage` (physical/magical %) | `power * damagePerPctNum / damagePerPctDen` | `PRICE.damagePerPctNum` (1), `PRICE.damagePerPctDen` (2) | 20% power = 1 PL |
| `heal` / `shield` (physical/magical %) | same as damage | `PRICE.damagePerPctNum/Den` | 20% power = 1 PL |
| `heal` / `shield` / `damage` (TRUE, flat) | `power * flatTruePerPoint` | `PRICE.flatTruePerPoint` (2) | 5 flat points = 1 PL |
| TRUE property premium (casting cards only) | flat `+truePremium` | `PRICE.truePremium` (**10**, was 20) | Approved cut: +1 PL (was +2 PL) |
| `poison` / `burn` | `amount * turns * dotPerPoint` | `PRICE.dotPerPoint` (2) | 5 total ticks = 1 PL |
| `stun` | `turns * stunPerTurn` | `PRICE.stunPerTurn` (40) | 4 PL/turn — re-tune deferred (no sim data yet) |
| `buffStat` / `debuffStat` | `pct * turns * statPctTurn` | `PRICE.statPctTurn` (1) | 10%-turn = 1 PL |
| `cleanse` | flat `cleanse` | `PRICE.cleanse` (**90**, was 80) | Approved bump keeps `purify` on budget under the lower TRUE premium (90 + 10 = 100 = Bronze) |
| `slowNext` | `weight * slowNextPerWeightNum / Den` | `PRICE.slowNextPerWeightNum` (5), `Den` (2) | 1 PL per +4 weight |
| `stagger` | `amount * staggerPerPointNum / Den` | `PRICE.staggerPerPointNum` (5), `Den` (4) | 1 PL per 8 drained |
| `lifesteal` | `pct * lifestealPerPctNum / Den` | `PRICE.lifestealPerPctNum` (2), `Den` (3) | 1 PL per 15% |
| `shieldBreak` | `amount * shieldBreakPerPointNum / Den` | `PRICE.shieldBreakPerPointNum` (5), `Den` (4) | 1 PL per 8 shattered |
| `comboBonus` | `pct * comboPerPctNum / Den` | `PRICE.comboPerPctNum` (**1**, was 2), `Den` (3) | Approved cut: 1 PL per 30% (was 1 PL per 15%) |
| `guard` (%DR) | `pct * turns * guardPerPctTurnNum / Den` | `PRICE.guardPerPctTurnNum` (5), `Den` (4) | 1.25× premium over `statPctTurn` (1×) — see rationale below |
| `negate` (charges) | `charges * negatePerCharge` | `PRICE.negatePerCharge` (50) | Flat per-charge — see rationale below |
| aura `damagePct` | `damagePct * auraDamagePct * reach` | `PRICE.auraDamagePct` (4) | `reach` = 2 for `allBoard`, else 1 |
| aura `healPct` | `healPct * auraHealPct * reach` | `PRICE.auraHealPct` (4) | |
| aura `critPctDelta` | `critPctDelta * auraCritPct * reach` | `PRICE.auraCritPct` (5) | |
| aura `|weightDelta|` | `abs(weightDelta) * auraWeightDelta * reach` | `PRICE.auraWeightDelta` (20) | |
| weight | `(baseline − weight) * weightPer` | `PRICE.weightPer` (5), baseline = `size * 10` | Every 2 lighter costs 1 PL; every 2 heavier REFUNDS 1 PL |
| size grant | `−sizeGrant2` (size 2), `−sizeGrant3` (size 3) | `PRICE.sizeGrant2` (30), `PRICE.sizeGrant3` (60) | Big cards get extra kit budget for board space + turn span |

## `guard` pricing rationale

`guard` grants unconditional, multiplicative %-damage-reduction for a number
of turns against a matching `property`. That's stronger per nominal
`pct * turns` unit than a plain stat buff/debuff (`statPctTurn` = 1× rate),
because it applies straight to the final incoming hit with no compounding
math in between — so it's priced at a **1.25× premium**:
`guardPerPctTurnNum / guardPerPctTurnDen = 5/4 = 1.25`.

Showcase: **Guard 40% for 2 turns, magical**, as the sole effect on a size-1
card with no weight override — `40 * 2 * 5/4 = 100` deci-PL = **Bronze
exactly**. (Runtime also clamps `pct` to ≤60 at apply time — a separate
safety rail, not a pricing input.)

## `negate` pricing rationale

`negate` grants charges that fully cancel the caster's next direct hits of a
matching `property` — high expected value versus a partial mitigation effect,
so it's priced as a **flat deci-PL per charge** rather than a scaling rate:
`negatePerCharge = 50`.

- 1 charge = 50 deci (half of Bronze — a reasonable chunk to pair with one
  other small effect).
- 2 charges = 100 deci (= Bronze exactly).
- 3 charges (the apply-time clamp max, "total charges of a property ≤3") =
  150 deci (= Silver exactly).

## Socket / Gem PL accounting

Locked rules for the future socket/gem system (tier-up options and run-power
items that plug into a card):

- A card may gain **at most one** special slot (socket) via a tier-up option.
  Tier-ups are the authored **+5 PL upgrade paths**; the socket itself is one
  of the possible +5 PL choices, not extra on top of it.
- A socketed **gem** (an effect, or a stat/aura boost) carries **uncapped**
  bonus PL. Gems are not bound by the tier budget — they're earned run power
  (found/crafted mid-run), not part of the card's baked-in kit.
- **`total PL = base PL + Σ gem PL`.** Base PL is the card's authored kit as
  priced by this table; gem PL is added on top, additively, with no ceiling.
- The **base-PL tier audit excludes gems**. `powerLevelDeci`/`isOnBudget`
  operate on the authored `SkillDef` only — the balance audit test enforces
  that the *base* kit sits on its tier budget. Gemmed bonus PL is run state,
  tracked and displayed separately, and must never be folded into the audited
  base-PL number.

## Approved pricing changes (this pass)

| Change | Before | After | Why |
|---|---|---|---|
| TRUE premium | 20 deci | **10 deci** | TRUE's defense-bypass edge was overpriced relative to its in-practice swing |
| `comboBonus` rate | 1 PL / 15% | **1 PL / 30%** | Conditional (previous-cast-archetype-gated) bonus damage was overpriced for its unreliable uptime |
| `cleanse` | 80 deci | **90 deci** | Keeps `purify` (the only cleanse-using card) on budget under the lower TRUE premium: `90 + 10 = 100` = Bronze |
| `stun` | 40 deci/turn | unchanged | Re-tune deferred — no sim data yet |
| `guard` (new) | — | `pct * turns * 5/4` | Priced in; see rationale above |
| `negate` (new) | — | `charges * 50` | Priced in; see rationale above |

### Known off-budget as of this pass (content-designer to re-fit)

The TRUE-premium cut and `comboBonus` cut push these existing demo cards off
their Bronze budget (flagged by the balance audit test, expected until
re-fit — see `tests/engine/balance.test.ts`):

- `soul_rend` — TRUE-premium cut (property `true`, casts `damage`)
- `second_wind` — TRUE-premium cut (property `true`, casts `heal`)
- `prism_barrier` — TRUE-premium cut (property `true`, casts `shield`)
- `follow_through` — `comboBonus` rate cut

`purify` (the only `cleanse`-using card) stays on budget: the `cleanse` bump
(80→90) exactly offsets the TRUE-premium cut (20→10), netting the same 100
deci total.
