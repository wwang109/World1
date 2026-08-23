> **HISTORICAL** — accurate as of its date; superseded by x. Never cite as current. x

# PL pricing changelog (dated passes)

> **HISTORICAL** — each section below is accurate as of its own date only;
> superseded by `docs/power-level-reference.md` and `PRICE` in
> `src/engine/balance.ts`. Never cite as current. Append new dated passes at
> the bottom; never edit old ones.

These sections were extracted verbatim from `docs/power-level-reference.md`
(2026-08-03 docs restructure) so the living reference stays prose/rationale
only. Within this file, LATER sections supersede EARLIER ones — several
"after" values in the first table were themselves re-priced by later passes.

## Approved pricing changes (early pass — SUPERSEDED)

> **SUPERSEDED**: the "After" column below reflects the state at the time of
> this pass only. Later passes changed: stun → 100 deci/turn, guard → 1/1
> parity, negate → 100/charge, cleanse → 25/charge. Read `PRICE` for current
> values.

| Change | Before | After | Why |
|---|---|---|---|
| TRUE premium | 20 deci | **10 deci** | TRUE's defense-bypass edge was overpriced relative to its in-practice swing |
| `comboBonus` rate | 1 PL / 15% | **1 PL / 30%** | Conditional (previous-cast-archetype-gated) bonus damage was overpriced for its unreliable uptime |
| `cleanse` | 80 deci | **90 deci** | Keeps `purify` (the only cleanse-using card) on budget under the lower TRUE premium: `90 + 10 = 100` = Bronze |
| `stun` | 40 deci/turn | unchanged | Re-tune deferred — no sim data yet |
| `guard` (new) | — | `pct * turns * 5/4` | Priced in |
| `negate` (new) | — | `charges * 50` | Priced in |

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

## Throughput rebalance pass (2026-07-19, user-locked)

Rate changes derived from `docs/history/throughput-pl-proposal.md` (denial/tempo
riders were underpriced; the guard premium was unjustified) plus two new
effects and a per-charge cleanse. The affected cards were re-fit **mechanically**
(magnitudes only, never tier/archetypes) so each lands back on its tier budget.

| Change | Before | After | Why |
|---|---|---|---|
| `stunPerTurn` | 40 | **100** | A consumed enemy performance ≈ a whole Bronze card (throughput §2.C). Moderated step toward the proposal's 160; sim re-tune deferred |
| `negatePerCharge` | 50 | **100** | A fully cancelled direct hit ≈ a Bronze card (§2.C) |
| `disrupt` Den | 4 | **2** | 1 PL per 4 drained (was per 8) — draining banked readiness is a real tempo swing (§2.E). [Superseded 2026-07-25 by the escalating brackets] |
| `guardPerPctTurn` | 5/4 | **1/1** | Parity with `statPctTurn`; the 1.25× premium was unjustified (§2.D) |
| `cleanse` | flat 90 | **25/charge** | Priced per effect removed ("x per PL spent"); `purify` = 4 charges = 100 |
| `expose` (NEW) | — | `pct * turns * 1/1` | Guard-parity amplifier (mirror of guard) |
| `bleed` (NEW) | — | `amount * turns * 2` (dotPerPoint) | Per-performance DoT; per-perf timing stronger vs fast enemies, deferred to sim. NOTE: bleed's price formula was superseded 2026-07-23 (see `dotPerStack`); this row is a historical record only |

Card re-fits (all land exactly on Bronze = 100 deci):

- `stunning_smash` → pure stun (damage removed), size 2→1: stun 1 = 100.
- `ward_of_silence` → negate charges 2→1: 100.
- `frost_ward` → guard pct 40→50 (×2 turns ×1 = 100).
- `concussive_shot` → disrupt 32→16 (40) + damage 12 (60) = 100. **[Superseded 2026-07-25: disrupt re-priced to the escalating bracket schedule; `concussive_shot` is now disrupt 6 (40 deci) + damage 12 (60) = 100 — see the 2026-07-25 section.]**
- `purify` → cleanse charges 4 = 100.
- NEW `rupturing_strike` (bleed showcase): damage 10 (50) + bleed 5×5 (50) = 100.
- NEW `ruinous_hex` (expose showcase): expose 50%×2 = 100.

Forced gem re-fits (rate consequence; content-designer to review — the stun
gems could no longer fit any rarity band at 100 deci/turn):

- `concussive_shot_echo` disrupt 16→8 (Common 20). **[Superseded 2026-07-25: now disrupt 4 (Common 20) — see the 2026-07-25 section.]**
- `frost_ward_echo` guard 16%→20%, `ward_of_silence_echo` guard 32%→40% (Rare 40).
- `stunning_shard`, `stunning_smash_echo`, `concussive_shard` re-themed
  stun→slow (16/16/32 weight → Rare 40 / Rare 40 / Legendary 80).

## 2026-07-25 changelog: disrupt re-priced to an escalating bracket schedule

**User-locked directive:** disrupt was underpriced at its old flat rate — a
Bronze card (`concussive_shot`) could carry disrupt 16 alongside a real damage
hit, an unfair tempo swing with no counterplay window. Fix: disrupt magnitudes
should live in the 5-10 range, and every point ABOVE the cheap entry band must
cost progressively more (escalating, not linear).

`PRICE.disruptPerPointNum/Den` (flat 5/2, i.e. 1 PL per 4 drained) is REPLACED
by `PRICE.disruptBrackets`, a marginal (tax-bracket-style) schedule read by
`disruptCostDeci(amount)`:

| Points in bracket | Rate (deci/point) |
|---|---|
| 1-5 | 5 |
| 6-10 | 15 |
| 11-15 | 30 |
| 16+ | 60 |

Cumulative checkpoints (only the points inside each bracket pay that bracket's
rate):

| Amount | Cost | As PL |
|---|---|---|
| 5 | 25 deci | 2.5 PL |
| 6 | 40 deci | 4 PL |
| 8 | 70 deci | 7 PL |
| 10 | 100 deci | 10 PL (all of Bronze) |
| 15 | 250 deci | 25 PL (all of Diamond) |
| 16 | 310 deci | 31 PL (unaffordable at any tier) |

Card and gem re-fits to land exactly back on budget:

- `concussive_shot` (Bronze, size 1): disrupt 16→**6** (40 deci, was also 40
  deci at the old rate — a coincidental match that let damage stay at 12
  unchanged) + damage 12 (60 deci) = 100 = Bronze exactly.
- `concussive_shot_echo` (Common gem): disrupt 8→**4** (20 deci = Common
  exactly; 4 sits below the 5-10 card-magnitude band, but a Common gem's tiny
  20-deci budget can't afford 5 at the new entry rate — this is a deliberate
  gem-scale exception, not a violation of the card-design directive).

## 2026-08-01 changelog: TRUE heal re-price (2 → 4 deci/pt)

**User-locked directive:** empirical early-game play showed flat TRUE heals
(`second_wind`, `renewing_wave`, `purify`'s heal component) strictly
dominating non-TRUE, stat-scaling heals for far too long — at the old
`flatTrueHealPerPoint` rate of 2, the crossover point where a %-of-MATK heal
out-heals the flat TRUE amount only arrived around MATK 30-40, well past
where most runs are by the time they'd naturally pick up a MATK stack.
`PRICE.flatTrueHealPerPoint` raised 2 → 4 (`src/engine/balance.ts`) pulls that
crossover down to roughly MATK 5-10, so non-TRUE heals become a live
alternative much sooner.

Every affected card was re-tuned to land exactly back on budget (heal
magnitude down, mechanics/text unchanged); `second_wind` and `renewing_wave`
also needed AUTHORED `tierUpgrades` (the auto-scaler can't move `speedWeight`,
and these ladders sink part of the re-price into weight, not just heal
points):

- `second_wind` (Bronze, size 1, `true` property, weight baseline 10): heal
  50→**25** (`25 × 4 = 100` = Bronze exactly).
  - Silver: heal 40, `speedWeight` 12 → `40×4=160 − 10 (weight, 2 over
    baseline) = 150` = Silver.
  - Gold: heal 50, weight back to baseline 10 → `50×4=200` = Gold.
  - Diamond: heal 65, `speedWeight` 12 → `65×4=260 − 10 = 250` = Diamond.
- `renewing_wave` (Bronze, size 1, `true` property, `speedWeight` 14): heal
  60→**30** (`30×4=120 − 20 (weight, 4 over baseline 10) = 100` = Bronze).
  - Silver: heal 45, `speedWeight` 16 → `45×4=180 − 30 = 150` = Silver.
  - Gold: heal 55, `speedWeight` back to the bronze 14 → `55×4=220 − 20 = 200`
    = Gold.
  - Diamond: heal 70, `speedWeight` 16 → `70×4=280 − 30 = 250` = Diamond.
- `purify` (Bronze, size 1, `true` property; `cleanse` charges 4 = 100 deci,
  frozen and unchanged at every tier):
  - Silver: heal 25→**10**, `speedWeight` 8 (new) → `100 (cleanse) + 10×4=40 +
    10 (weight, 2 under baseline) = 150` = Silver.
  - Gold: heal 50→**25**, weight at baseline → `100 + 25×4=100 + 0 = 200` =
    Gold.
  - Diamond: heal 75→**35**, `speedWeight` 8 (new) → `100 + 35×4=140 + 10 =
    250` = Diamond.

Every ladder lands EXACTLY on budget (no fudged numbers). `PRICE` in
`src/engine/balance.ts` is the source of truth; this section is a changelog
record only.

## 2026-08-19 changelog: cooldown LONG-side refund re-priced to a diminishing walk (issue #22)

**Standing finding actioned:** `cooldownDeviationDeci`'s long (refund) side
priced every turn past `BASELINE_COOLDOWN` at the same flat `cooldownPerTurn`
rate (100 deci), so a Bronze card could recoup up to 300 deci (30 PL) by
`cooldownTurns` 6 — but the game's own doctrine (allocator work) is that
cooldown is a deck-diversity dial, not a power dial, and the marginal turns
are not equally weakening: a further cooldown turn matters much less once the
card is already rarely available (the 5→6 step buys far less real weakening
than 3→4).

`PRICE.cooldownRefundStepDeci` (`[50, 30, 20]`, one entry per turn beyond
baseline) REPLACES the flat rate on this side only — `cooldownPerTurn` is
unchanged and now prices the SHORT (cost) side exclusively.

**Derived, not felt:** reused the SAME fight-length data `MAX_COOLDOWN_TURNS`
already cites (frozen 200-fight regression sweep, mean length ≈7.6 turns). A
lone card's expected casts over a fight of that length is
`≈ meanLength / (cooldownTurns + 1)` (`cooldownRemaining`'s own
"stride cooldown+1" arithmetic), so the MARGINAL casts a further cooldown
turn removes is itself diminishing:

| step | casts removed | ratio |
|---|---|---|
| 3→4 | 0.380 | ~5 |
| 4→5 | 0.253 | ~3 |
| 5→6 | 0.181 | ~2 |

The TOTAL refund at the `MAX_COOLDOWN_TURNS` clamp is anchored, not
re-guessed, at exactly `cooldownPerTurn` itself (100 deci) — the same "one
whole extra cast, ~ a Bronze card's worth of power" value the SHORT side
already charges to BUY a cast. This is not a coincidence: by `cooldownTurns`
6 the earliest possible second cast (turn 1+7=8) no longer fits the
mean-length fight at all, i.e. the card has symmetrically LOST one whole
cast relative to baseline. Splitting 100 deci across the 5:3:2 ratio and
rounding to whole-PL steps: 50 / 30 / 20 deci for the 1st / 2nd / 3rd extra
turn (cumulative 50 → 80 → 100 deci, 5 → 8 → 10 PL, at `cooldownTurns`
4 / 5 / 6 — down from the old flat 100 → 200 → 300).

**Zero cascade:** no shipped card overrides `cooldownTurns` (0/74) and no
shipped gem carries `cooldownReduction` — the balance audit (every card on
budget) is unaffected, and no re-solve was required. `cooldownDeviationDeci`
remains the ONE place this term is computed (shared by `powerLevelDeci` and
`autoScaleTier` in `cards.ts`), so both callers moved together.

**Folded in at the same pass — `instancePowerLevelDeci` splash-suppression
fix:** the one host-aware PL surface (used for a socketed piece's display/
run-power readout) still added a suppressed gem `splash`'s full uncapped
price even when THE SPLASH GATE (`spliceGemActions`, `src/engine/cards.ts`)
drops it entirely at cast-resolution time — on a multi-target host, or a host
that already carries its own splash. A suppressed action never fires, so it
must contribute ZERO instance PL; `instancePowerLevelDeci` now re-derives the
gate's predicate (`hostSuppressesSplash`, mirroring `splashSuppressionOn`
without closing the cards.ts→balance.ts import cycle, same tradeoff
`echoHostShareDeci` already accepts) and filters the gem's actions down to
what the gate would actually keep before pricing. Covered for both
suppression reasons, plus the gate's "keep only the gem's first splash"
rule on an ordinary host, in `tests/engine/splash.test.ts`.

## 2026-08-21 changelog: the conditional-rider family priced in (`exploit` / `stackBonus` / `shieldBurst` / `taxBonus`)

**Recorded here after landing** (combat-engine-programmer's implementation
pass; this pass documents it): four new keywords add flat bonus damage to a
cast's own hit behind a gate — the target already carries a named affliction
(`exploit`), a stacking pile exists on caster or target (`stackBonus`), the
caster is holding shield to spend (`shieldBurst`), or the target's board
carries a weight-tax backlog (`taxBonus`). All four price at the card's own
`strikeRate` (property-aware flat-damage rate, TRUE premium included) over
`PRICE.conditionalBonusDen` (2) — the same CONDITIONAL-TRIGGER DISCOUNT
`comboBonus` established, reproducing its locked 2.5 deci/pt on a typed card.
`stackBonus`/`shieldBurst`/`taxBonus` price their required `cap` only (`per`
free, the `statStrike` precedent); `exploit` prices its flat `amount`
directly. All four sit in the `empower` cap family.

**New rule landing alongside the prices:** `selfSynergyPremiumDeci` forfeits
the discount (charges the full `strikeRate` instead) when the same kit also
supplies the resource its own rider reads, matched by resource name AND side.
This pairs with the **never-self-trigger-in-one-cast ordering ruling**
(user-locked 2026-08-21, verbatim: "it should always activate this effect
first before activating any poison debuff") — every rider reads
PRE-EXISTING state only, so `validateSkillContent` requires the rider before
the damage it feeds and the card's own resource-supplying action after that
damage, making a same-cast self-trigger unrepresentable. `shieldBurst`
additionally pays this same rate as a deliberate OVER-price (it also destroys
the resource it reads, and its gate is caster-scoped — no AoE reach
multiplier, and `scope: 'all'` + `shieldBurst` is refused outright rather
than priced).

Full rationale: the "Conditional-rider family pricing rationale" section of
`docs/power-level-reference.md`. Source of truth for the rates themselves:
`keywords/pricing.ts` and `selfSynergyPremiumDeci`/`riderReadsResource` in
`src/engine/balance.ts`, pinned by `tests/engine/conditionalRiders.test.ts`
and `tests/engine/resourceRiders.test.ts`.

## 2026-08-21 changelog: the splash split (`splashPerWeight` → `burdenPerWeight` × `splashBandFloor`, + `curse`)

**Recorded here as it landed** (combat-engine-programmer pass, on the user's
correction — verbatim: *"splash is an effect that spread other effect. It
doesn't just spread wt."*). `splash` shipped 2026-08-18 as one action,
`{ kind: 'splash', weight }`, that both chose a 3-piece band and taxed weight
on it. That conflated a SPREADER with its first PAYLOAD, and the price
inherited the conflation.

| rate | before | after |
|---|---|---|
| the weight tax on ONE card | — | **`burdenPerWeightNum/Den` = 5/2** (`slow`'s own per-point rate) |
| the spread | `splashPerWeightNum/Den` = 5/1 (per weight point) | **`splashBandFloorNum/Den` = ×2** (a COVERAGE MULTIPLIER on the cast's card-targeting effects, floored once, applied in `actionsPriceDeci` beside the AoE reach multiplier) |
| the damage-axis payload | — | **`cursePerAmountNum/Den` = 5/2** (the near-certain first denial: the flat-damage rate at the conditional-trigger discount) **+ `cursePerAmountTurnNum/Den` = 5/(BASELINE_COOLDOWN+1)** (the repeats: one further firing per cooldown stride) |

**NO SHIPPED PRICE MOVED — the old rate WAS the two new ones multiplied.**
`floor(N × 5/2) × 2 == N × 5` for every even N, so `burden N + splash` costs
exactly what `splash weight N` cost: `shockwave_slam` (burden 6), `arc_cascade`
(burden 8) and `line_breaker` (slow 8 + burden 6) all still land on Bronze 100
exactly, and `tremor_sliver` (burden 4) / `fracture_sliver` (burden 8) still land
on Common 20 / Rare 40 exactly. On an ODD weight the split is 1 deci cheaper
(weight 5: 24 vs 25) because the anchor's own price floors first; no shipped
magnitude is odd, and whole-PL authoring wants even weights anyway.

**Cap-family membership is unchanged and now covers the spread**: `burden`,
`curse` and `splash` are all `control`, and because `capViolations` prices a
family subset through the same `actionsPriceDeci`, the ×2 multiplier grows the
control spend in lockstep with the budget spend — reach cannot be bought past the
lockdown ceiling (a size-1 card affords `burden 40` alone, or `burden 20 + splash`).

**Breakdown reporting**: `powerLevelBreakdown` prices a card-targeting line
TOGETHER with the spreader (`"burden + splash" = 30`) rather than as a half plus a
floating half, because rates are whole-PL per clean unit and half a spread burden
is 1.5 PL. The parts still sum exactly.

**Content**: two `curse` showcase cards landed with the pass — `dulling_hex`
(curse 8 / 2 turns, anchor-only, 40 + damage 60 = Bronze) and `sapping_arc`
(curse 4 / 2 turns + splash, 20 × 2 + damage 60 = Bronze) — both exact at all four
tiers with damage as the sink.

Full rationale: `PRICE.burdenPerWeightNum` / `PRICE.splashBandFloorNum` /
`PRICE.cursePerAmountNum` in `src/engine/balance.ts` and §10 of
`docs/combat-model-spec.md`. Pinned by `tests/engine/splash.test.ts` and the
`PRICE` structure lock in `tests/engine/balance.test.ts`. The 400-case outcome
baseline is byte-identical (no card of the family is in the frozen sweep pool),
and the migration was additionally proven by diffing full event logs of all three
cards and both gems on fixed seeds — 21/21 fights identical with only the
band-application event's NAME normalised (`splashed` → `burdened`).

## 2026-08-21 changelog: splash goes flat + standalone; instance PL goes plain-sum; ONE splash gem

**Two user rulings, recorded verbatim and implemented together the same day
they were made — both REVERSE parts of passes recorded above.**

### Ruling A — splash prices flat and standalone; a pairing is the plain sum

> "every gem pl is standalone" · "it doesnt make sense to increase cost
> because of splash and host" · "why did you make splash different"

| rate / rule | before (this morning's splash-split pass) | after |
|---|---|---|
| the spread | `splashBandFloorNum/Den` = ×2, a COVERAGE MULTIPLIER on the summed price of the cast's card-targeting effects | **`splashFlatDeci` = 20** — one flat, standalone price per cast, a normal keyword row in `keywords/pricing.ts` (new `flat` term form) |
| a socketed pairing's instance PL | base + gem + the UNION-KIT SELF-SYNERGY DELTA (the cross-kit conditional-rider forfeit, added earlier on 2026-08-21) | **base + gem, exactly** — `unionKitSelfSynergyDeltaDeci` deleted; `selfSynergyPremiumDeci` remains a rule about AUTHORED kits only (a card judged against its own effects, a gem against its own actions) |

The multiplier had made `splash` the ONE keyword whose price depended on its
siblings' magnitudes, and the union delta had made a pairing cost more than the
sum of its two audited prices — both are exactly what the ruling refuses. The
one host-aware instance adjustment kept is THE SPLASH GATE's suppression,
which only ever SUBTRACTS (a gem spreader the resolver drops contributes zero
on that host). Pinned by `tests/engine/instancePlainSum.test.ts` (full catalog
sweep: `instance <= base + gem`, equal except gate suppression);
`tests/engine/instanceSelfSynergy.test.ts` deleted with the rule it pinned.

**WHY 20 (candidates 10/15/20):** THE splash gem prices at exactly this rate
and must land exactly on a rarity band — 20 = Common; 10 and 15 land on none
(and 15 is not a whole PL, which every rate obeys). 20 also minimizes re-solve
movement (below). 40, the next band, would price the spreader above both
payloads it spreads.

**Card re-solves (all four splash carriers, exact at all four tiers via
`powerLevelDeci`/`capViolations`/`autoScaleTier`, zero tolerance):**

| card | before | after |
|---|---|---|
| `shockwave_slam` | damage 14 + burden 6 + splash (15×2=30) | damage 14 + **burden 4** + splash 20 (70+10+20) — damage line and tier ladder (24/34/44) unchanged |
| `arc_cascade` | damage 12 + burden 8 + splash (20×2=40) | **unchanged** — the multiplier happened to charge its spread exactly 20 |
| `line_breaker` | damage 10 + slow 8 + burden 6 + splash (15×2=30) | damage 10 + slow 8 + **burden 4** + splash 20 — damage line and tier ladder (20/30/40) unchanged |
| `sapping_arc` | damage 12 + curse 4/2t + splash (20×2=40) | **unchanged** |

The burden moves (6 → 4) fall out of the whole-PL-parts invariant:
`powerLevelBreakdown` now reports `splash` as its OWN whole-PL part (the
combined "burden + splash" part died with the multiplier), so a burden part
must itself land on a whole PL — pinning burden weights to multiples of 4.

### Ruling B — exactly ONE splash gem

> "there should only be 1 gem to give splash why is there 2 splash gem"

`tremor_sliver` (burden 4 + splash, Common) and `fracture_sliver` (burden 8 +
splash, Rare) RETIRED — the two-rung ladder was a fossil of the retired
splash-as-weight-tax model: it laddered the BURDEN's magnitude, and splash has
no magnitude to ladder. Replaced by **`ripple_sliver`** (Common, 20 deci
exactly), whose ONLY action is `{ kind: 'splash' }` — it grants the spreader
and nothing else. On a host with no card-targeting payload THE SPLASH GATE's
`nothingToSpread` arm drops it (spreading nothing) and the suppression
subtracts its contribution from that piece's instance PL. Alchemist's curated
list carries it in the ladder's place; Gemcutter's `all` clause covers it as
before. Deliberately NOT authored: standalone `burden` gems at the retired
rungs' magnitudes — whether the bare weight tax deserves its own gem ladder is
an open design question.

The 400-case outcome baseline is untouched and byte-identical — no splash
carrier or retired gem is in the frozen sweep pool (verified: the ids appear
only in the baseline's prose note).

Source of truth: `PRICE.splashFlatDeci` in `src/engine/balance.ts` and the
`splash` row of `src/engine/keywords/pricing.ts`; instance rule at
`instancePowerLevelDeci`. Pinned by `tests/engine/splash.test.ts`,
`tests/engine/instancePlainSum.test.ts` and the `PRICE` structure lock in
`tests/engine/balance.test.ts`.

## 2026-08-21 content pass: the card-targeting gem gap, and the rider family's first gem

**No rate moved** — every price below is an existing rate applied to new
content. Recorded here because it ANSWERS the open design question the
splash-consolidation entry above deliberately left standing, and because it
fixes a defect that consolidation created.

### The defect: THE splash gem had almost no host

`ripple_sliver` is a BARE spreader, so THE SPLASH GATE drops it on any host
with no card-targeting payload (`nothingToSpread`) and on any host that
already splashes (`hostAlreadySplashes`). Measured against the shipped book
that left **exactly one legal host in 125 cards** (`dulling_hex`) — 120
suppressed for nothing to spread, 4 for already splashing. A gem that can
only ever be socketed into one card is not a gem.

### New gems (4) — all band-exact, all minimal for their band

| gem | payload | price | band |
|---|---|---|---|
| `ballast_sliver` | `burden 8` | 20 deci | Common |
| `millstone_sliver` | `burden 16` | 40 deci | Rare |
| `blunting_sliver` | `curse 4 / 2 turns` | 20 deci | Common |
| `festering_sliver` | `exploit poison 8` | 20 deci | Common |

**The burden ladder ANSWERS the open question** (the consolidation entry asked
whether the bare weight tax deserved its own gem ladder — it does, and unlike
splash it is a ladder on a MAGNITUDE). `burden` and `curse` had no gem at all
after the consolidation: the catalog carried a gem for the SPREADER and none
for either PAYLOAD it spreads. Note `ballast_sliver` is NOT a twin of
`quickening_sliver` (`slow 8`, also Common 20) — burden and slow share one
rate for one currency so the numbers coincide, but a slow taxes the UNIT and
is dropped at end of turn paid or not, while a burden taxes a CARD and rides
it until played. Epic/Legendary burden rungs (24 → 60, 32 → 80) are priced
and deliberately unshipped.

`festering_sliver` opens the **conditional-rider family**, which had zero gem
representation across all eight keywords. Its discount is honest by
construction: the gem supplies no poison itself, so `selfSynergyPremiumDeci`
is 0 — and a gem cannot forfeit the discount on its own anyway, since it is
priced host-blind and a pairing is the plain sum (user-locked 2026-08-21).

### New card (1)

`leaden_bite` — beast/physical, `damage 16 + burden 8` = Bronze 100 exactly
(exact at all four tiers, damage as the sink). It closes both halves of the
defect above: `curse` shipped in anchor-only (`dulling_hex`) AND spread
(`sapping_arc`) form while `burden` existed ONLY spread, so a player could
never meet the weight tax alone — and it doubles `ripple_sliver`'s host pool
(1 → 2) with the first host on the burden axis.

### Text fix

`deadweight_toll` read "each card carrying a **{{Splash}}** tax counts" — true
only under the retired splash-as-weight-tax model. `splash` carries no
payload; the tax `taxedCardCount` (combat/state.ts) counts is `burden`'s
`nextWeightPenalty`. Now reads `{{Burden}}`, in the base text and all three
tier blocks. Display only — no price or behaviour moved.

### Verified by combat log, not by assertion alone

The spreader is CAST-SCOPED, so a burden/curse GEM on a spreader HOST is
widened by the host's own splash — logged: `shockwave_slam + ballast_sliver`
emits `BURDENED weight 8 slots [0,1]`. `leaden_bite + ripple_sliver` goes from
`slots [0]` to `slots [0,1]`. `festering_sliver` reads pre-existing poison
only: `effectBonusDamage 0` with no poison, `8` once a poison line lands, back
to `0` when the pile decays out. Every new pairing's instance PL is the plain
sum of its two standalone prices.

## 2026-08-21: the `chainBonus` keyword, and the debuff-affinity gaps closed

**NO EXISTING RATE MOVED.** One new keyword, priced entirely through the
denominator the conditional-rider family already shares.

### `chainBonus` — `comboBonus` on the TYPE axis

User request, verbatim: *"we should make other combo type card like if previous
card is sword card and this card is an axe card deal even more damage for
combos"*, generalised by the same user a moment later: *"it doesnt have to just
be weapon it could be magic too like if previous was fire magic or water etc"*.

`{ kind: 'chainBonus'; after: Element | WeaponType; amount: number }` — flat
bonus damage on this cast's hit when the caster's PREVIOUS resolved cast was of
the named type. **One keyword covers both axes** because the game already has
exactly one notion of a card's type: `cardType` = `element ?? weapon`
(`combat/typeIdentity.ts`, the same derivation deck affinity uses). So
`after: 'sword'` on an axe card and `after: 'fire'` on a frost card are the same
rule reading the same field.

| decision | choice | why |
|---|---|---|
| rate | `amount × strikeRate(property) / conditionalBonusDen` | **No new number.** The discount is written as a denominator so a new rider can divide the same `strikeRate`; on a typed card it reproduces comboBonus's own locked 2.5 deci/pt |
| honesty direction | over-priced, deliberately | comboBonus's rate assumes ~50% archetype-match uptime; a gate naming ONE type of eleven opens *less* often, so this rate can only over-charge — the safe direction every derived rate here takes |
| family / offensive | `empower`, `offensive: false` | Mirrors comboBonus exactly: the gate is a fact about the caster's own history, not any victim, so it resolves once and arms the scalar `cast.bonusFlat` (never the per-victim `bonusByTarget`). It inherits comboBonus's known AoE gap verbatim rather than inventing a divergence from its own sibling |
| self-gate | **refused at authoring** | A sword card gated `after: 'sword'` satisfies its own gate from cast 2, which the conditional discount does not describe. `rejectSelfChain` refuses it at every tier — the same refuse-rather-than-price call `splash`-with-nothing-to-spread gets. (A mono-type BOARD still raises real uptime; that is a deck choice, exactly as it is for comboBonus, and is not refusable.) |
| self-synergy premium | 0 by construction | `lastCastType` joins `'lowHp'`/`'overheal'`/`'cleansed'` — resources no keyword can manufacture — so no action can ever supply it |

**Engine cost: one new lazily-written `CombatantState` field**, `lastCastType`,
stamped in `simulate.ts` beside the `lastCastArchetypes` it is the twin of. That
moved all 400 outcome-baseline hashes, so the fixture was regenerated with an
exhaustive containment proof (recorded in its `note`): across 400 raw
before/after dumps, **0 event logs moved, 0 result/turns moved**, and all 2546
`finalState` leaf differences are the same thing — an ADDED `lastCastType` key.
Zero value changes, zero removed keys, no other field name anywhere in the diff.

**Content (2 cards, both Bronze 100 exactly at all four tiers):**
`finishing_cleave` (axe, `after: 'sword'`, chain 8 + damage 16 — the reliable
half) and `thermal_shock` (frost, `after: 'fire'`, chain 16 + damage 12 — the
swingy half, 40 of its 100 deci spent on the rider). Sequenced right the frost
card out-damages the axe; led cold it is the weakest Bronze hit in its lane.
Behaviour pinned by `tests/engine/chainBonus.test.ts`; verified by combat log on
both axes, including that a lance or a fire never opens the sword gate.

### Debuff-affinity gaps (existing rates, no pricing change)

The "extra damage if they are already afflicted" family (`exploit` flat,
`stackBonus` scaling) covered poison/stun/debuff as cards and bleed/burn as
scaling cards — but **`expose` had no payoff content at all**, despite four
gems/cards that APPLY it, and only poison had a socketable reader.

- `breach_strike` (card, lance) — `exploit expose 8` + damage 16 = Bronze 100.
  The expose ladder's first finisher. It collects twice on a prepared target
  (the standing expose amplifies the hit, this rider adds to it), which is why
  the rider is 8 and not larger.
- `bloodscent_sliver` (gem, Common 20) — `exploit bleed 8`. The flat form of
  what `bleed_executioner` does by scaling, socketable onto any hitter.
- `opening_sliver` (gem, Common 20) — `exploit expose 8`, curated into Armory
  beside the expose ladder it finishes.

All three are band/budget exact and minimal for their band. Distinct payloads
from `festering_sliver` by the `status` field, so the R8.1 twin rule is
satisfied on the field that actually decides behaviour.
