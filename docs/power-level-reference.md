# Power Level (PL) Reference

> **Scope:** prose and rationale for the PL pricing system — WHY each rate is
> what it is and how the audit works. Numbers live in code, not here.

Single source of truth: **`PRICE` in `src/engine/balance.ts`**. Every section
below cites the exact constant name it's sourced from — if this doc and the
code ever disagree, the code (and its constant name) wins; fix the doc. Dated
pricing passes live in `docs/history/pl-changelog.md` (append-only).

All math is done in **deci-PL** (PL × 10) integers — never floats.
`powerLevelDeci(skill)` sums the whole kit; `isOnBudget(skill)` checks it
against the tier budget within `BUDGET_TOLERANCE_DECI`, which is **ZERO —
budgets are exact** (user-locked 2026-07-19). Rates are whole-PL per clean
unit; when a card can't land exactly, the CARD's effects change, never the
rates.

## Tier budgets

`TIER_BUDGET_DECI` (`src/engine/balance.ts`): Bronze · Silver · Gold · Diamond,
each tier a fixed deci-PL budget the card's whole kit must sum to exactly.

## Per-unit price table — read `PRICE`, don't copy it

Every rate is a named constant in `PRICE` with its rationale in a doc comment
at the definition. The formula shapes (all division `Math.floor`'d
immediately):

| Action / modifier | Formula (deci-PL) | Constant(s) |
|---|---|---|
| `damage` (any property) | `power * flatPowerPerPoint` | `PRICE.flatPowerPerPoint` — FLAT base; the caster's stat is added at cast time, unpriced |
| `heal` / `shield` (physical/magical) | `power * flatPowerPerPoint` | `PRICE.flatPowerPerPoint` |
| `heal` (TRUE, pure flat, no stat) | `power * flatTrueHealPerPoint` | `PRICE.flatTrueHealPerPoint` — re-priced 2026-08-01, see `docs/history/pl-changelog.md` |
| `shield` (TRUE, pure flat, no stat) | `power * flatTrueShieldPerPoint` | `PRICE.flatTrueShieldPerPoint` — typed parity; the TRUE premium is mechanical (typed damage drains the TRUE pool 2:1) |
| TRUE damage premium | `+truePremiumPerPoint` per point, on top of the flat rate | `PRICE.truePremiumPerPoint` — half-effect rule (user-locked 2026-07-20): TRUE damage costs exactly double typed |
| `poison` / `bleed` / `burn` | `stacks * dotPerStack` | `PRICE.dotPerStack` — LINEAR PER-STACK (user-locked 2026-07-23); tick gameplay unchanged (poison/bleed decay, burn halves — see `burnTotalDamage`) |
| `thorns` | `stacks * dotPerStack` | `PRICE.dotPerStack` — the DoT rate, reused: a reflect pile's total is an upper bound realised only while the holder keeps being hit. Unchanged by the 2026-08-21 PHYSICAL-reflect ruling, and more honest for it: this is a TYPED rate (TRUE damage pays double), and a reflect is now typed/mitigable — armor off every sting, physical guard/shield apply |
| `stun` | `turns * stunPerTurn` | `PRICE.stunPerTurn` — a consumed performance ≈ a whole Bronze card; sim re-tune deferred |
| `buffStat` / `debuffStat` | `pct * turns * statPctTurn` | `PRICE.statPctTurn` |
| `expose` (%amp) | `pct * turns * exposePerPctTurnNum/Den` | `PRICE.exposePerPctTurnNum/Den` — guard parity |
| `cleanse` | `charges * cleansePerCharge` | `PRICE.cleansePerCharge` — priced per effect removed (user-locked 2026-07-19); the one `SCALABLE` keyword outside damage/heal/shield (user-locked 2026-08-17) — see the effect-cap section below |
| `slow` | `weight * slowPerWeightNum/Den` | `PRICE.slowPerWeightNum/Den` — 1 PL per +2 Weight (user-locked 2026-09-12); affected cards were re-solved by reducing damage or effect magnitude rather than exceeding their rank budgets |
| `burden` | `weight * burdenPerWeightNum/Den` | `PRICE.burdenPerWeightNum/Den` — 1 PL per +2 Weight, matching `slow`; `burden` taxes one card until it plays, while `slow` taxes the unit's next play during the current turn |
| `curse` | `amount * cursePerAmountNum/Den` + `amount * turns * cursePerAmountTurnNum/Den` | `PRICE.cursePerAmountNum/Den` (the near-certain FIRST denial, at the flat-damage rate over the conditional-trigger discount — the anchor may be a card that cools out the whole window) + `PRICE.cursePerAmountTurnNum/Den` (the REPEATS: one further firing per `BASELINE_COOLDOWN + 1` turns). Derived, not measured — flagged for an `npm run sim` re-tune, like `stunPerTurn` |
| `splash` (the SPREADER) | standalone price by card tier; tierless base for gems | `CARD_SPLASH_PRICE_DECI` — 80/100/120/140 deci on Bronze/Silver/Gold/Diamond cards (user-locked 2026-09-13). `PRICE.splashFlatDeci` remains the tierless 80-deci price used by the Splash-only Ripple Sliver. Payload magnitude never changes the price, and spread behavior is unchanged. |
| `disrupt` | escalating brackets, marginal per point | `PRICE.disruptBrackets` via `disruptCostDeci` — user-locked 2026-07-25; hard tempo denial must cost disproportionately more at large magnitudes |
| `lifesteal` | `pct * lifestealPerPctNum/Den` | `PRICE.lifestealPerPctNum/Den` |
| `shieldBreak` | `amount * shieldBreakPerPointNum/Den` | `PRICE.shieldBreakPerPointNum/Den` |
| `comboBonus` | `amount * comboPerPointNum/Den` | `PRICE.comboPerPointNum/Den` — CONDITIONAL-TRIGGER DISCOUNT (user-locked 2026-07-23): gated riders price at a fraction of their always-on equivalent |
| `chainBonus` (flat bonus if the caster's PREVIOUS cast was of a named card type) | `amount * strikeRate(property) / conditionalBonusDen` | `PRICE.conditionalBonusDen` — `comboBonus` on the TYPE axis instead of the archetype axis, and it needed NO NEW RATE: the discount is written as a denominator precisely so a new rider can divide the same `strikeRate`. "Type" is the game's one notion of it — `cardType` = `element ?? weapon` — so one keyword gates both `after: 'sword'` on an axe card and `after: 'fire'` on a frost card. A gate naming ONE type of eleven opens less often than an archetype match, so this rate can only OVER-price it (the safe direction). A card naming its OWN type is refused at authoring, not priced |
| `exploit` (flat bonus if the target already carries a named status) | `amount * strikeRate(property) / conditionalBonusDen` | `PRICE.conditionalBonusDen` — see the conditional-rider family section below |
| `stackBonus` (flat bonus scaling with a named resource — a stacking pile, or the holder's Burdened cards — hard-capped) | `cap * strikeRate(property) / conditionalBonusDen` (`per` unpriced) | `PRICE.conditionalBonusDen` — prices the required `cap` ceiling only, so WHAT is counted never enters the price; see below |
| `shieldBurst` (spend the caster's OWN shield as bonus damage) | `cap * strikeRate(property) / conditionalBonusDen` | `PRICE.conditionalBonusDen` — same discount despite also destroying the resource it reads; see below |
| self-synergy premium (on any of the three rows above) | forfeits the discount entirely: charges `magnitude * strikeRate(property)` in place of the discounted term | `selfSynergyPremiumDeci` — added when the SAME AUTHORED KIT also supplies the resource the rider reads (a card judged against its own effects; a gem against its own actions). A card+gem PAIRING is never charged: instance PL is the plain sum of the two standalone prices (user-locked 2026-08-21); see below |
| `guard` (%DR) | `pct * turns * guardPerPctTurnNum/Den` | `PRICE.guardPerPctTurnNum/Den` — parity with `statPctTurn`; see rationale below |
| `negate` (charges) | `charges * negatePerCharge` | `PRICE.negatePerCharge` — flat per-charge; see rationale below |
| `ward` (charges) | `charges * wardPerCharge` | `PRICE.wardPerCharge` — half a negate charge: a charge denies one whole affliction APPLICATION (poison / burn / bleed / debuffStat / expose — not stun) rather than a card's whole damage line, and 50 deci is the median price of an application of a covered kind across the shipped book |
| Additional Stat (cards) | `sum(max(0, kindCount − 1)) * additionalStatPremium` | `PRICE.additionalStatPremium` — repeated `damage`, `statStrike`, `shield`, `heal`, `attunedShield`, `buffStat`, and `debuffStat` entries each cost budget in addition to their magnitude. Count each exact effect kind separately: mixed Damage + Heal has no fee. Affinity-gated and tier-locked-out entries do not count. The fee is flat, added after AoE scaling. Gem pricing keeps `PRICE.extraHitPremium` unchanged. |
| AoE reach (`scope: 'all'`) | `offensiveShare * aoeTargetsNum/Den`, floored once over the whole offensive share | `PRICE.aoeTargetsNum/Den` — flat multiplier on the OFFENSIVE portion of a kit (damage/DoT/control; see `OFFENSIVE_KINDS`), derived from the game's own pack-frequency constants, not `MAX_FOES`; see rationale below |
| aura `damageFlat` / `healFlat` / `weightDelta` | `mod * rate * reachMultiplier` (2 for `allBoard`, else 1) | `PRICE.auraDamageFlat` / `auraHealFlat` / `auraWeightDelta` — flat auras cost 2× a card's own one-shot flat damage: empirically the break-even where the best adjacent placement (2 casting neighbors) is PL-fair (2026-07-23 audit). **`AuraDef.reach` is NOT an input** — the multiplier reads `affects` only, so coverage past 2 pieces is free PL; see the aura-coverage section below |
| weight | `(baseline − weight) * weightPer`, baseline = `size * 10` | `PRICE.weightPer` — lighter costs, heavier refunds |
| size grant | `−sizeGrantDeci(size, tier)` | `PRICE.sizeGrant2Bronze/3Bronze` — grows at HALF the tier-budget growth (user-locked 2026-07-19); big cards get extra kit budget for board space + turn span |
| cooldown (`cooldownTurns`), SHORT side (shorter than baseline, costs PL) | `(BASELINE_COOLDOWN − cooldownTurns) * cooldownPerTurn` | `PRICE.cooldownPerTurn`, `BASELINE_COOLDOWN` (`src/engine/types.ts`) — see rationale below |
| cooldown, LONG side (longer than baseline, refunds PL) | diminishing per-turn walk, clamped at `MAX_COOLDOWN_TURNS` | `PRICE.cooldownRefundStepDeci` (50/30/20 deci for the 1st/2nd/3rd extra turn) — re-priced 2026-08-19, see rationale below |

## Effect investment caps (design contract, user-locked 2026-07-20)

Tier budgets × size grants multiply a card's kit PL; caps stop that budget
from becoming lockdown. Per-size ceilings on the PL a single card may invest
per effect family — constants in `EFFECT_CAPS_DECI` (`src/engine/balance.ts`),
audited for every card by the EFFECT-CAP AUDIT test. **When designing a card,
run `npm test` — the audit names any cap it breaks.**

- Families: `control` (stun, slow, burden, curse, splash's spread, disrupt,
  stat-down, expose, shieldBreak) ·
  `dot` (poison + burn + bleed combined) · `empower` (stat-up, guard, negate,
  ward, lifesteal, combo, thorns, exploit, stackBonus, shieldBurst)
  · `cleanse` (its own family, see below) ·
  `damage` · `shield` · `heal`. Membership sets:
  `CONTROL_KINDS` / `DOT_KINDS` / `EMPOWER_KINDS` / `CLEANSE_KINDS`.
- Most family caps remain frozen across tiers. Two named families scale with
  `TIER_BUDGET_DECI`: `cleanse` (2026-08-17) and `control` (2026-09-13).
  The flat damage/shield/heal caps remain a Diamond-size ceiling — a loose
  guardrail, not a diversify-forcer.
- **`control` TIER-SCALES (user-locked 2026-09-13)**: the size-1 cap is
  100/150/200/250 deci at Bronze/Silver/Gold/Diamond. Splash remains a Control
  effect and contributes its full tier-aware card price to that family spend;
  the cap does not exclude or refund the spreader. This permits deliberately
  authored control growth at higher ranks. Stun remains independently capped
  at one performance by `MAX_STUN_PER_CARD`, even when the Control PL ceiling
  has room for more.
- **`cleanse` TIER-SCALES (user-locked 2026-08-17)**: "PL is calculated and
  the tiers are just based on size and amount of PL a card has" / "if the PL
  amount is increased then you can add more" — a bigger tier budget spent on
  more cleanse charges must be legal, exactly as it already is for a heal.
  `cleanse` was split OUT of `empower` into its own cap family
  (`EFFECT_CAPS_DECI.cleanse`; `TIER_SCALED_FAMILIES` contains `control` and
  `cleanse`) rather
  than tier-scaling `empower` wholesale, so `negate`/`ward`/`buffStat`/
  `guard`/`lifesteal`/`comboBonus`/`thorns` stay frozen. At size 1
  the cap and the rate-solved value coincide at every tier: 4/6/8/10 charges =
  100/150/200/250 deci (`PRICE.cleansePerCharge` unchanged at 25). `autoScaleTier`
  (`src/engine/cards.ts`) now treats `cleanse` as a sink kind alongside
  damage/heal/shield, growing its `charges` field the same way DoTs grow
  `stacks` and sinks grow `power`.
- Extra rules: **stun ≤ `MAX_STUN_PER_CARD` per card**; auras are exempt
  (passive board identity, priced per reach); weight is bounded in native
  units (`WEIGHT_MIN`, `WEIGHT_MAX_BY_SIZE`); size ≤ `MAX_CARD_SIZE`.
- The generic `applyTier` auto-scaler still does not invent Control or empower
  growth; authored `tierUpgrades` may deliberately grow Control within the
  tier-aware cap. Cleanse remains a generic scalable sink.

**Scope (user-locked 2026-07-20): these caps are DECK-BUILDING rules only.**
They bind what a single authored card may invest. Runtime stacking on top is
intentional gameplay, NOT a violation: effect gems appending extra actions,
DoT piles growing through recasts/merges, and multi-card synergies may all
exceed what any one card could buy. Do not add runtime clamps to "fix" this —
build-around stacking is the payoff deck-building rules exist to enable.

## `guard` / `expose` pricing rationale

`guard` grants multiplicative %-damage-reduction for a number of turns against
a matching `property`; `expose` is its offensive mirror (+%-damage taken on all
direct hits). Both are priced at **parity with the plain stat buff/debuff rate**
(`statPctTurn` — `guardPerPctTurnNum/Den = exposePerPctTurnNum/Den = 1/1`).
The old guard 1.25× premium was removed (user-locked 2026-07-19): guard only
pays off on the turns the opponent actually attacks during the window — the
same opponent-cadence dilution as a stat debuff — so the premium was
unjustified.

Showcase: Guard 50% for 2 turns (or Expose 50% for 2 turns), as the sole
effect on a size-1 card with no weight override, prices to Bronze exactly.
(Runtime clamps guard `pct` to ≤60 and expose `pct` to ≤50 at apply time —
separate safety rails, not pricing inputs.)

## `negate` pricing rationale

`negate` grants charges that fully cancel the caster's next direct hits of a
matching `property` — a fully cancelled direct hit is worth roughly a whole
Bronze card's output, so it's priced as a **flat deci-PL per charge**
(`negatePerCharge`, user-locked 2026-07-19: one charge = one Bronze budget
exactly; apply-time clamp caps total charges of a property at 3).

## Conditional-rider family pricing rationale (`exploit` / `stackBonus` / `shieldBurst`)

Three keywords add FLAT bonus damage to the cast's own hit behind a gate — the
target already carries a named affliction (`exploit`), a named resource is
sitting on caster or target (`stackBonus`: a stacking pile, or — with
`status: 'burden'` — how many of that side's board pieces carry a weight tax),
or the caster is holding shield to spend (`shieldBurst`). All three share one
pricing shape, in `keywords/pricing.ts` and
`selfSynergyPremiumDeci`/`riderReadsResource` (`src/engine/balance.ts`):

> **2026-09-14 — `taxBonus` was deleted, not repriced.** It was a fourth row
> here, reading "the victim's tempo backlog" through a resource its own JSON
> never named (`{ per, cap }` only). It is now `stackBonus` with
> `status: 'burden'`. Because both forms priced `cap` at
> `strikeRate / conditionalBonusDen` and nothing else, **every card's PL is
> unchanged at every tier** — `deadweight_toll` is still 10/15/20/25 PL. One
> BEHAVIOUR term was dropped by the same ruling: a pending unit-scope `slow` no
> longer counts. `burden` names PIECES; a slow marks none.

- **The discount denominator.** Each prices at the card's own property-aware
  flat-damage rate (`strikeRate` — `flatPowerPerPoint`, doubled for TRUE via
  `truePremiumPerPoint`) divided by `PRICE.conditionalBonusDen` (2). This is
  written as a DENOMINATOR on `strikeRate` rather than a second hand-copied
  number so it can never drift from the rate it is a fraction of: it
  reproduces `comboBonus`'s locked 2.5 deci/pt on a typed card (`5 / 2`) and,
  because it divides the property-aware rate rather than a property-blind
  one, automatically charges a TRUE card the TRUE premium too (10 deci/pt).
  This is the CONDITIONAL-TRIGGER DISCOUNT principle `comboBonus` established
  (user-locked 2026-07-23): a rider that only fires under a gate prices at a
  fraction of its always-on equivalent, not the full rate.
- **The cap is the priced thing.** `stackBonus` and `shieldBurst` each require
  a `cap` field and price only it — never `per` (or `shieldBurst`'s
  implicit multiplier). The payload each scales (`per × count`, the plating
  spent) is unbounded in a resource the card does not
  control, so only the hard ceiling is honestly priceable — the same
  precedent an uncapped `statStrike` sets by pricing at 0 (so it fails every
  budget loudly), here made unrepresentable by `cap` being a required field
  rather than an absent one. A `per` driven to infinity degenerates the rider
  into "+cap if the gate is open at all," i.e. an `exploit` of the same
  magnitude, and the two price identically — the coherence check that proves
  `per` needs no rate of its own. `exploit` has no such multiplier field; its
  `amount` is priced directly.
- **The self-synergy forfeit.** A card that itself SUPPLIES the resource its
  own rider reads (a poison line feeding its own `exploit`, a `shield` line
  feeding its own `shieldBurst`, a `burden` feeding its own burden-reading
  `stackBonus`)
  guarantees its own gate from the second cast onward, which the discount no
  longer honestly describes. `selfSynergyPremiumDeci` detects this STATICALLY
  from the authored kit — matching the rider's resource name AND side
  (`riderReadsResource` vs. `resourceSuppliedBy`; a caster-side `stackBonus`
  is fed only by a caster-side application, never by the same status put on
  the foe) — and charges the FULL `strikeRate` in place of the discount: the
  premium added is exactly `full − discounted`, so the two terms sum to the
  full always-on rate with no rounding drift. This is deliberately
  CONSERVATIVE: the honest per-cast uptime of a self-fed rider is
  `(casts − 1) / casts` (it misses only the first cast), which is strictly
  between the discounted and full rate and only approaches 1 in long fights —
  charging the full rate can only ever over-price, never under-price, the
  same safe-direction stance `PRICE.aoeTargetsNum/Den` takes with its own
  ceiling. `shieldBurst` pays this same discount rate even without
  self-synergy triggering it, and deliberately over-prices for a second,
  independent reason below.
- **The forfeit prices AUTHORED KITS ONLY — a pairing is the plain sum
  (user-locked 2026-08-21).** The forfeit is judged twice, each side against
  its own authored effect list: `powerLevelDeci` asks it of the card's
  effects, `gemPowerLevelDeci` of the gem's own actions. A socketed PAIRING is
  priced as the plain sum of those two standalone prices —
  `instancePowerLevelDeci` = base card PL + gem PL, with no cross-kit term.
  The ruling, verbatim: "every gem pl is standalone" / "it doesnt make sense
  to increase cost because of splash and host". A union-kit delta that briefly
  charged the forfeit across the card+gem seam (when host and gem together
  supplied a gate neither supplied alone) was deleted by that ruling the same
  day it landed. The one host-aware adjustment left at the instance level only
  ever SUBTRACTS: a gem `splash` THE SPLASH GATE would drop contributes zero
  on the host that suppresses it. Pinned by
  `tests/engine/instancePlainSum.test.ts` (a full catalog sweep asserts
  `instance <= base + gem`, equal except gate suppression).
- **`shieldBurst`'s caster-scoped, no-AoE stance.** Unlike the other three,
  `shieldBurst` resolves on the CASTER (`offensive: false` in
  `keywords/pricing.ts`) — it spends the caster's own shield, not something
  read off a foe — so it runs once per cast, never pays the AoE reach
  multiplier, and an authored `scope: 'all'` + `shieldBurst` card is REFUSED
  outright by `validateSkillContent` rather than priced: one wall spent once
  must not be delivered to five foes at a single-target price (the same
  refuse-rather-than-price call `splash` makes for a payload-less spread).
  Priced identically to `stackBonus` regardless, the rate is
  deliberately OVER- rather than under-priced on two counts spelled out in
  code: the gate ("you are holding plating") is a resource another card has
  to supply, exactly like an `exploit`'s poison; and unlike every other
  conditional rider here, `shieldBurst` also DESTROYS the resource it reads,
  so its true worth sits strictly below a free conditional bonus of the same
  size. Charging the same rate anyway is the safe direction, not an oversight.
- **The never-self-trigger-in-one-cast ordering ruling (user-locked
  2026-08-21).** Every rider in the family reads PRE-EXISTING state only: it
  resolves before the card's own status/shield/tax-applying actions land (the
  catalog convention that such applications go after the hit), so a single
  cast can never satisfy its own gate. A card that both exploits poison and
  applies poison pays off ACROSS casts — cast 1 arms nothing and leaves a
  pile, cast 2 finds the pile and collects — and `validateSkillContent`
  enforces the authoring order (rider before the damage it feeds; the card's
  own resource-supplying action after that damage) so the rule is
  unrepresentable rather than merely conventional. This ordering is what
  makes the self-synergy premium above STATICALLY decidable from the authored
  kit alone, with no simulation or host knowledge needed.

## Aura coverage: the rate is calibrated at TWO pieces, and `reach` is not priced

`PRICE.auraDamageFlat`/`auraHealFlat`/`auraWeightDelta` are derived from ONE
placement: "the best adjacent placement (**2 casting neighbors**) is PL-fair"
(2026-07-23 audit, quoted in the constants themselves). `powerLevelDeci` then
charges `auraModsDeci(mods) * (affects === 'allBoard' ? 2 : 1)` and **never reads
`AuraDef.reach`**.

So the reach dial is unpriced, and exactly one shape can abuse it:

- `adjacent` + `reach: 1` — up to 2 pieces. **Priced at its calibration.**
- `left` / `right` + `reach: 2` — up to 2 pieces, all on one side. **Priced at its
  calibration**, and the only way to author a GAP-crossing aura honestly today.
- `left` / `right` + `reach: 1` — 1 piece. Deliberately OVER-priced (safe side).
- `adjacent` + `reach: 2` — up to **4** pieces at the 2-piece price. **Free PL.**
- `allBoard` — up to 9 pieces at 2× the rate. A documented approximation that
  predates this note (`warlord_banner`), not a new hole.

**THE RULE, and it is a CONTENT rule.** No shipped aura may cover more than 2
pieces at the non-`allBoard` rate. Enforced by `tests/engine/auraCoverage.test.ts`,
which measures coverage by walking the real 10-slot hero board through the real
`auraCovers` (`src/engine/combat/auras.ts`) rather than reasoning about `reach`,
and which also proves the pricer is reach-blind so the rule is guarding a live
hole rather than restating something code already enforces.

Widening the vocabulary — an `adjacent` aura that really does project two slots
each way — needs a **reach term in `PRICE`**, a cap-family decision, and a fold in
`src/engine/cards.ts`. That is balance-designer's call and is split off as
ADOPT LATER in `docs/run-structure-patterns.md` Q2. Until it lands, a card that
wants more reach buys it one-sided.

The 2026-08-26 Q2 positional pass was authored to this rule: six new cards on
`left`/`right` at `reach: 2` (five of them) and one `adjacent`, across
offense/defensive/debuff/healing/support, and **no new `allBoard` card** — an
`allBoard` aura is the one shape for which position does not matter, which is the
opposite of what that pass was for.

## `scope: 'all'` (AoE reach) pricing rationale

CLOSED A VERIFIED SILENT ZERO (2026-08-17): `powerLevelDeci` never read
`skill.scope` before this — an AoE card priced identically to a single-target
one while `combat/interpreter.ts`'s `resolveTargets` hits every living foe.

Priced as ONE flat, HOST-BLIND multiplier (`PRICE.aoeTargetsNum/Den` = 33/25 =
1.32×) on the OFFENSIVE portion of a kit only (`OFFENSIVE_KINDS` —
damage/DoT/control; support riders stay self-targeted regardless of scope).
Host-blind by necessity, the same precedent as `GEM_CANONICAL_PROPERTY`: a
card has one PL, so the rate can't depend on whether it ends up on the hero's
board (facing the enemy pack distribution) or an enemy's (facing the hero,
always exactly 1 — packs are enemy-side only).

**Not `MAX_FOES` (5)** — a sandbox ceiling nothing in real play produces every
fight — **derived instead from the game's own pack-frequency constants**
(`src/run/encounter.ts`, `src/run/runState.ts`): every 5-fight cadence block
is 2 normal + 2 elite + 1 boss, boss nodes never roll a pack, and
`PACK_VARIANT_WEIGHTS` rolls the remaining 4-in-5 at solo/pair/trio 64/32/4.
The steady-state expected foe count: `1/5*1 + 4/5*(0.64*1+0.32*2+0.04*3) = 1.32`.
This is a ceiling on the honest number, not the number itself — pack rolls
fall back to solo below a level threshold — and `firstAffordable` in
`tests/run/packFights.test.ts` owns the verified live floors: normal pair 6,
normal trio 18, elite pair 2, and elite trio 10. Real play therefore
skews more solo than 1.32 implies; quantifying exactly how much more would
require assuming a typical run length, which is the winrate-shaped tuning
input this project's "PL, not winrate" rule (CLAUDE.md) forbids. Full
arithmetic and citations: `PRICE.aoeTargetsNum` in `src/engine/balance.ts`.

Applying the multiplier inside `actionsPriceDeci` (rather than only in
`powerLevelDeci`) means `capViolations`'s per-family checks — which call the
same function — grow in lockstep: an AoE buff or DoT cannot use `scope: 'all'`
to invest more effective PL past its family cap than a single-target card of
the same authored magnitude would.

**Known adjacent gap (not fixed here, out of Task 1's scope):** a gem-appended
offensive action inherits its HOST's `scope` for targeting (an echo of an AoE
host fans out too — see `echoHostPower` in `src/engine/types.ts`), but
`gemPowerLevelDeci` stays host-blind to AoE reach (it never sees the host's
`scope`, matching how it never sees the host's `property` either). No shipped
card sets `scope: 'all'` at BRONZE — but five do from Gold up (the AoE tier
gates: `sword_slash`, `shadow_bolt`, `chain_spark`, `concussive_shot`,
`crushing_blow`), so a gem socketed into a Gold+ copy of one of those DOES
combine with an AoE host today and its appended offensive action fans out
unpriced. The gap is live, not latent; sizing the fix (a host-aware reach term
at the instance level, or a refusal) is balance-designer's call and is
untouched by the 2026-08-26 whole-PL re-solve, which only moved card numbers.

## `cooldown` pricing rationale

Cooldown (`SkillDef.cooldownTurns`, `BASELINE_COOLDOWN` global turns — see
`src/engine/types.ts` and `src/engine/combat/castSelect.ts`) is a SECOND
pacing dial alongside weight: weight orders which eligible card fires,
cooldown decides which cards are even eligible. A card cast on turn T is
unavailable T+1..T+cooldown and eligible again at T+cooldown+1 — a lone card
fires with stride `cooldown + 1` (baseline 3 → every 4th turn).

`cooldownPerTurn = 100` deci (10 PL) per turn of deviation on the SHORT side
(a shorter-than-baseline cooldown, which COSTS PL) — **user-locked
2026-07-19**: a shorter cooldown is a full extra cast over the course of a
fight, close to a whole Bronze card's worth of power, so it is priced like
one. Baseline (cooldownTurns omitted) prices at exactly +0, so every existing
card is unaffected. At this rate NO gem rarity budget (2-8 PL) can afford even
−1 turn, and no card in the shipped catalog BUYS a shorter cooldown — the
rate exists to price any future exception honestly. (The LONG, refunding side
does have shipped users since 2026-08-26 — see below.)

**The LONG side (a longer-than-baseline cooldown, which REFUNDS PL) no longer
shares this flat rate** (balance-designer pass, 2026-08-19, issue #22): a flat
per-turn refund let a Bronze card recoup up to 300 deci (30 PL) by
`cooldownTurns` 6, when cooldown is doctrine'd as a deck-diversity dial, not a
power dial — and the marginal turns are not equally weakening (5→6 buys much
less real weakening than 3→4, since the card is already rarely available by
then). `cooldownDeviationDeci` (`src/engine/balance.ts`) instead walks
`PRICE.cooldownRefundStepDeci` — 50 / 30 / 20 deci for the 1st / 2nd / 3rd
extra turn (cumulative 50 → 80 → 100 deci at `cooldownTurns` 4 / 5 / 6),
DERIVED from the same fight-length data `MAX_COOLDOWN_TURNS` cites (mean
≈7.6 turns): a lone card's expected casts over a fight scale as
`meanLength / (cooldownTurns + 1)`, so the MARGINAL cast reduction per extra
turn is itself diminishing (0.380 : 0.253 : 0.181 ≈ 5 : 3 : 2 across the
3→4/4→5/5→6 steps). The total at the `MAX_COOLDOWN_TURNS` clamp is capped at
exactly `cooldownPerTurn` (100 deci) — the SAME "one whole extra cast" value
the short side charges to BUY a cast, since by `cooldownTurns` 6 the card has
symmetrically LOST one whole cast relative to baseline. No shipped card moved
when the rate landed (0/74 overrode `cooldownTurns`); the first users arrived
2026-08-26, when the four size-1 AoE tier gates (`sword_slash`, `shadow_bolt`,
`chain_spark`, `concussive_shot`) bought their Gold/Diamond reach with this
refund's first step — a whole-PL AoE share costs 250 deci after the reach
multiplier, so a size-1 card at Gold has to refund exactly 50. Full derivation:
`src/engine/balance.ts`'s `PRICE.cooldownRefundStepDeci` doc comment.

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
  priced by `powerLevelDeci`; gem PL (`gemPowerLevelDeci`) is added on top,
  additively, with no ceiling. `instancePowerLevelDeci(def, piece)` returns
  the sum, for display/run-power readouts only.
- The **base-PL tier audit excludes gems**. `powerLevelDeci`/`isOnBudget`
  operate on the authored `SkillDef` only and never read `piece.gem` — the
  balance audit test enforces that the *base* kit sits on its tier budget.
  Gemmed bonus PL is run state, tracked and displayed separately, and must
  never be folded into the audited base-PL number.

### Rarity -> gem PL band

A gem's OWN PL (not the card's) must land exactly on its rarity's band —
`RARITY_PL_DECI` (`src/engine/balance.ts`): Common 2 · Rare 4 · Epic 6 ·
Legendary 8 PL, checked by `isGemOnBudget(gem)` with the same **exact**
(zero) tolerance as the card audit. The audit that iterates the real gem
catalog against these bands is **built**: `tests/engine/gemAudit.test.ts`
covers every gem in `src/data/gems.ts` (53 gems as of 2026-08-21, after the
splash-gem consolidation and the card-targeting/rider gem pass — the
2026-08-09 ruleset v1 §10 migration had cut 46 → 35, later passes grew the
book again).

### `actionsPriceDeci`: the pricing switch, decoupled from `SkillDef`

`powerLevelDeci` sums a card's kit by calling `actionsPriceDeci(skill.effects,
skill.property, skill.scope, skill.effects, skill.tier)` and then layering on card-level things
`actionsPriceDeci` deliberately does NOT know about: aura mods, weight, size
grant, and cooldown deviation. `scope` (third, optional — default `'one'`)
applies the AoE reach multiplier to the OFFENSIVE share of the total when
`'all'` (see the rationale section above); `gemPowerLevelDeci` reuses the same
function at the default `'one'` for effect gems (host-blind on purpose — see
that section's known-gap note), so a single per-unit rate table prices both
authored card effects and gem effects — no duplicated switch. The card tier
selects the card-only Additional Stat fee after AoE scaling; omitting it
preserves the existing tierless gem pricing.

### Effect gems

`gemPowerLevelDeci(gem)` for a `kind: 'effect'` gem is
`actionsPriceDeci(gem.actions, GEM_CANONICAL_PROPERTY)` plus any
`cooldownReduction` priced at `PRICE.cooldownPerTurn` per turn shaved.

**Canonical property choice: `physical`** (`GEM_CANONICAL_PROPERTY`). A gem's
PL must be fixed regardless of which card it's later socketed into — but
`actionsPriceDeci` reads `property` for exactly one case, a raw
`damage`/`heal`/`shield` action. Fixing the property to `physical` means:
- Riders with no property dependence (poison, thorns, stun, buffStat, slow,
  disrupt, lifesteal, shieldBreak, comboBonus, guard, negate, ward, cleanse)
  price identically no matter what property is picked.
- The **TRUE premium never applies to gems** — it's a charge on the CASTING
  card's property, applied outside the gem path; gems never see it.

### Cooldown-reduction rider (effect gems)

The `cooldownReduction?: number` field on an effect gem (turns shaved off the
host card's effective cooldown, folded in by `resolveEffectiveSkill` in
`src/engine/cards.ts`) remains a live, priced mechanic — at
`PRICE.cooldownPerTurn` per turn, the same rate as a card's own
`cooldownTurns` deviation. **No gem in the current catalog carries it**: at
100 deci/turn even −1 turn costs 10 PL, beyond every rarity band (2-8 PL), so
the former "quickening" gems were re-themed to slow gems (`src/data/gems.ts`).
The rate exists to price any future exception honestly.

### Card-scope stat gems

A `kind: 'stat'`, `scope: 'card'` gem's `mods.card` reuses the **same
per-point aura rates already in `PRICE`** — `auraDamageFlat`, `auraHealFlat`,
`auraWeightDelta` — since a card-scope stat gem is structurally identical to a
self-only aura riding on one card. Unlike a card's own `aura` block, a
socketed gem never has an `allBoard`/`adjacent` reach — it always affects
exactly the one host card — so there's **no reach multiplier**.

### Hero-scope stat gems

A `kind: 'stat'`, `scope: 'hero'` gem's `mods.hero` (flat integer adds per
`BuffableStat`, folded into base `CombatantStats` for the whole run — see
`applyHeroGems`/`gemHeroStats` in `src/engine/cards.ts`) is priced by
`PRICE.heroStatPerPoint`:

- `attack` / `magicPower` / `armor` / `magicResist` share one rate — see the
  floor-parity rationale below.
- `speed` has its own anchor, tied 1:1 to `PRICE.weightPer`: turn order reads
  banked readiness (gained from Speed) against card weight, so 1 point of
  `speed` plays the identical mechanical role as 1 unit of lighter weight —
  same rate, no re-derivation needed.

These are a **first-pass, documented approximation** (like `stun`'s deferred
re-tune) — `speed` is an exact anchor; the four combat stats are reasoned
estimates pending sim data.

### Hero-scope vs card-scope stat pricing (balance-designer pass, 2026-07-25)

**Before this pass**, `attack`/`magicPower` priced BELOW a card-scope stat
gem's `auraDamageFlat`/`auraHealFlat` rate, even though a hero-scope point
adds its flat bonus to **every matching-property card's** damage/shield, on
**every cast**, for the **whole fight**, while a card-scope point only ever
touches the one host card it's socketed on. Reach can only ever be *equal to
or greater than* a single card — pricing the broader effect below the
narrower one was backwards, independent of exactly how many matching cards a
given deck runs.

Even a deliberately narrow/mixed deck clears the "at least 1 other qualifying
card" bar that makes hero-scope strictly better than card-scope at equal
price; a deck built around a single scaling property is very achievable from
the full catalog (`skillBook`, loaded from `src/data/content/skills.v1.json` — 72 skills as of
2026-08-03) and pushes the reach multiplier far higher.

**The fix**: `attack`/`magicPower` raised to aura-rate parity — a
FLOOR-PARITY correction (hero-scope can never be honestly priced below the
one-card card-scope rate), not a full reach-multiplier correction (deferred
as too large a swing without sim data). `armor`/`magicResist` were already
there; all four core combat stats now share one rate, with `speed` priced
separately. Gems re-fit to stay on band: `brawlers_core`, `archmages_core`
(`src/data/gems.ts`).

## Dated pricing changelogs

Moved to **`docs/history/pl-changelog.md`** (append-only): the early
TRUE-premium/comboBonus pass, the 2026-07-19 throughput rebalance, the
2026-07-25 disrupt brackets, and the 2026-08-01 TRUE-heal re-price, each with
its card re-fits. That file is historical record only — `PRICE` is current.
