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
