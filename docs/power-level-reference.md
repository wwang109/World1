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

Locked rules for the socket/gem system (tier-up options and run-power items
that plug into a card). Engine types: `Gem` (`kind: 'effect' | 'stat'`),
`StatGemMods` (`scope: 'card' | 'hero'`) — see `src/engine/types.ts`. Pricing
lives in `src/engine/balance.ts`: `actionsPriceDeci`, `gemPowerLevelDeci`,
`gemPowerLevel`, `RARITY_PL_DECI`, `isGemOnBudget`, `instancePowerLevelDeci`.

- A card may gain **at most one** special slot (socket) via a tier-up option.
  Tier-ups are the authored **+5 PL upgrade paths**; the socket itself is one
  of the possible +5 PL choices, not extra on top of it.
- A socketed **gem** (an effect, or a stat/aura boost) carries **uncapped**
  bonus PL. Gems are not bound by the tier budget — they're earned run power
  (found/crafted mid-run), not part of the card's baked-in kit.
- **`total PL = base PL + Σ gem PL`.** Base PL is the card's authored kit as
  priced by this table (`powerLevelDeci`); gem PL (`gemPowerLevelDeci`) is
  added on top, additively, with no ceiling. `instancePowerLevelDeci(def,
  piece)` returns the sum, for display/run-power readouts only.
- The **base-PL tier audit excludes gems**. `powerLevelDeci`/`isOnBudget`
  operate on the authored `SkillDef` only and never read `piece.gem` — the
  balance audit test enforces that the *base* kit sits on its tier budget.
  Gemmed bonus PL is run state, tracked and displayed separately, and must
  never be folded into the audited base-PL number.

### Rarity -> gem PL band (`RARITY_PL_DECI`)

A gem's OWN PL (not the card's) is priced to land inside its rarity's band,
±0.5 PL (`BUDGET_TOLERANCE_DECI`, same tolerance as the card audit). This is
the gem analog of a card's tier budget — checked by `isGemOnBudget(gem)`.

| Rarity | PL | deci-PL |
|---|---|---|
| Common | 2 | 20 |
| Rare | 4 | 40 |
| Epic | 6 | 60 |
| Legendary | 8 | 80 |

The actual audit test that iterates a real gem catalog against these bands
belongs to content-designer once that catalog is authored (analogous to the
`skillBook` audit in `tests/engine/balance.test.ts`); `isGemOnBudget` is the
checking primitive it should use.

### `actionsPriceDeci`: the pricing switch, decoupled from `SkillDef`

`powerLevelDeci` sums a card's kit by calling `actionsPriceDeci(skill.effects,
skill.property)` and then layering on card-level things `actionsPriceDeci`
deliberately does NOT know about: the TRUE premium (casting-card only), aura
mods, weight, and size grant. `gemPowerLevelDeci` reuses the same
`actionsPriceDeci` for effect gems, so a single per-unit rate table prices
both authored card effects and gem effects — no duplicated switch.

### Effect gems

`gemPowerLevelDeci(gem)` for a `kind: 'effect'` gem is
`actionsPriceDeci(gem.actions, GEM_CANONICAL_PROPERTY)`.

**Canonical property choice: `physical`.** A gem's PL must be fixed
regardless of which card it's later socketed into (a Common gem is worth the
same 2 PL whether it lands on a physical, magical, or TRUE card) — but
`actionsPriceDeci` reads `property` for exactly one case, a raw
`damage`/`heal`/`shield` action, which prices differently as a % of power
(physical/magical) vs. a flat amount (TRUE). Fixing the property to
`physical` for gem pricing means:
- Riders with no property dependence (poison, stun, buffStat, slowNext,
  stagger, lifesteal, shieldBreak, comboBonus, guard, negate, cleanse) price
  identically no matter what property is picked — this choice only matters
  for raw damage/heal/shield gem actions.
- The **TRUE premium never applies to gems** — it's a card-level charge for
  *casting cards* (`hasCast && skill.property === 'true'`) applied by
  `powerLevelDeci` outside of `actionsPriceDeci`; gems never see it.

### Card-scope stat gems

A `kind: 'stat'`, `scope: 'card'` gem's `mods.card` (an `AuraMods`-shaped
bundle: `damagePct`, `healPct`, `weightDelta`, `critPctDelta`) reuses the
**same per-point aura rates already in `PRICE`** — `auraDamagePct`,
`auraHealPct`, `auraCritPct`, `auraWeightDelta` — since a card-scope stat gem
is structurally identical to a self-only aura riding on one card. Unlike a
card's own `aura` block, a socketed gem never has an `allBoard`/`adjacent`
reach — it always affects exactly the one host card — so there's **no reach
multiplier** (reach = 1 always, the multiplier used for a card's own aura
`affects: 'allBoard'` doesn't apply here).

### Hero-scope stat gems

A `kind: 'stat'`, `scope: 'hero'` gem's `mods.hero` (flat integer adds per
`BuffableStat`, folded into base `CombatantStats` for the whole run — see
`applyHeroGems`/`gemHeroStats` in `src/engine/cards.ts`) is priced by a new
flat per-point rate table, `PRICE.heroStatPerPoint`:

| Stat | deci-PL / point | Anchor |
|---|---|---|
| `attack` | 8 | Scaling stat for Physical damage; permanent, fight-wide leverage across every Physical cast — priced above a single card's %-power rate since one point compounds over every hit, every turn, for the whole run. |
| `magicPower` | 8 | Mirror of `attack` for Magical. |
| `armor` | 10 | Flat, direct 1:1 damage mitigation against every incoming Physical hit for the whole fight (see `mitigation()` in `src/engine/combat/interpreter.ts`) — priced above `attack`/`magicPower` because it blunts ALL incoming hits unconditionally, not gated by the hero's own cast frequency. |
| `magicResist` | 10 | Mirror of `armor` for Magical. |
| `speed` | 5 | Directly anchored to `PRICE.weightPer` (5 deci/unit): turn score is `bank + speed − weight`, so 1 point of `speed` plays the *identical* mechanical role as 1 unit of lighter `speedWeight` — same rate, no re-derivation needed. |
| `critPct` | 5 | Directly anchored to `PRICE.auraCritPct` (5 deci/point): hero `critPct` IS the same stat an aura's `critPctDelta` modifies — same unit, same rate. |

These are a **first-pass, documented approximation** (like `stun`'s
deferred re-tune) — `speed`/`critPct` are exact 1:1 anchors to existing
engine rates; `attack`/`magicPower`/`armor`/`magicResist` are reasoned
estimates pending sim data once content-designer's gem catalog exists.

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
