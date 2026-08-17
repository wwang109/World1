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
| `thorns` | `stacks * dotPerStack` | `PRICE.dotPerStack` — the DoT rate, reused: a reflect pile's total is an upper bound realised only while the holder keeps being hit |
| `stun` | `turns * stunPerTurn` | `PRICE.stunPerTurn` — a consumed performance ≈ a whole Bronze card; sim re-tune deferred |
| `buffStat` / `debuffStat` | `pct * turns * statPctTurn` | `PRICE.statPctTurn` |
| `expose` (%amp) | `pct * turns * exposePerPctTurnNum/Den` | `PRICE.exposePerPctTurnNum/Den` — guard parity |
| `cleanse` | `charges * cleansePerCharge` | `PRICE.cleansePerCharge` — priced per effect removed (user-locked 2026-07-19); the one `SCALABLE` keyword outside damage/heal/shield (user-locked 2026-08-17) — see the effect-cap section below |
| `slow` | `weight * slowPerWeightNum/Den` | `PRICE.slowPerWeightNum/Den` |
| `disrupt` | escalating brackets, marginal per point | `PRICE.disruptBrackets` via `disruptCostDeci` — user-locked 2026-07-25; hard tempo denial must cost disproportionately more at large magnitudes |
| `lifesteal` | `pct * lifestealPerPctNum/Den` | `PRICE.lifestealPerPctNum/Den` |
| `shieldBreak` | `amount * shieldBreakPerPointNum/Den` | `PRICE.shieldBreakPerPointNum/Den` |
| `comboBonus` | `amount * comboPerPointNum/Den` | `PRICE.comboPerPointNum/Den` — CONDITIONAL-TRIGGER DISCOUNT (user-locked 2026-07-23): gated riders price at a fraction of their always-on equivalent |
| `guard` (%DR) | `pct * turns * guardPerPctTurnNum/Den` | `PRICE.guardPerPctTurnNum/Den` — parity with `statPctTurn`; see rationale below |
| `negate` (charges) | `charges * negatePerCharge` | `PRICE.negatePerCharge` — flat per-charge; see rationale below |
| `ward` (charges) | `charges * wardPerCharge` | `PRICE.wardPerCharge` — half a negate charge: a charge denies one whole affliction APPLICATION (poison / burn / bleed / debuffStat / expose — not stun) rather than a card's whole damage line, and 50 deci is the median price of an application of a covered kind across the shipped book |
| multi-hit premium | `(damageActions − 1) * extraHitPremium` | `PRICE.extraHitPremium` — every hit beyond the first re-delivers the caster's full (unpriced) stat add, so each extra hit pays a flat surcharge; each extra hit also eats mitigation again, the built-in counterweight vs armor stacks. First-pass rate, re-derive with sim data |
| aura `damageFlat` / `healFlat` / `weightDelta` | `mod * rate * reach` (reach = 2 for `allBoard`, else 1) | `PRICE.auraDamageFlat` / `auraHealFlat` / `auraWeightDelta` — flat auras cost 2× a card's own one-shot flat damage: empirically the break-even where the best adjacent placement (2 casting neighbors) is PL-fair (2026-07-23 audit) |
| weight | `(baseline − weight) * weightPer`, baseline = `size * 10` | `PRICE.weightPer` — lighter costs, heavier refunds |
| size grant | `−sizeGrantDeci(size, tier)` | `PRICE.sizeGrant2Bronze/3Bronze` — grows at HALF the tier-budget growth (user-locked 2026-07-19); big cards get extra kit budget for board space + turn span |
| cooldown (`cooldownTurns`) | `(BASELINE_COOLDOWN − cooldownTurns) * cooldownPerTurn` | `PRICE.cooldownPerTurn`, `BASELINE_COOLDOWN` (`src/engine/types.ts`) — see rationale below |

## Effect investment caps (design contract, user-locked 2026-07-20)

Tier budgets × size grants multiply a card's kit PL; caps stop that budget
from becoming lockdown. Per-size ceilings on the PL a single card may invest
per effect family — constants in `EFFECT_CAPS_DECI` (`src/engine/balance.ts`),
audited for every card by the EFFECT-CAP AUDIT test. **When designing a card,
run `npm test` — the audit names any cap it breaks.**

- Families: `control` (stun, slow, disrupt, stat-down, expose, shieldBreak) ·
  `dot` (poison + burn + bleed combined) · `empower` (stat-up, guard, negate,
  ward, lifesteal, combo, thorns) · `cleanse` (its own family, see below) ·
  `damage` · `shield` · `heal`. Membership sets:
  `CONTROL_KINDS` / `DOT_KINDS` / `EMPOWER_KINDS` / `CLEANSE_KINDS`.
- **Every family's cap is FROZEN across tiers** (user-locked 2026-07-23),
  with ONE NAMED EXCEPTION added 2026-08-17 — ranking a card up buys NEW
  EFFECTS, not bigger numbers in a capped family. The flat families'
  (damage/shield/heal) caps are a Diamond-size ceiling — a loose guardrail,
  not a diversify-forcer.
- **`cleanse` TIER-SCALES (user-locked 2026-08-17)**: "PL is calculated and
  the tiers are just based on size and amount of PL a card has" / "if the PL
  amount is increased then you can add more" — a bigger tier budget spent on
  more cleanse charges must be legal, exactly as it already is for a heal.
  `cleanse` was split OUT of `empower` into its own cap family
  (`EFFECT_CAPS_DECI.cleanse`, `TIER_SCALED_FAMILIES = {'cleanse'}`) rather
  than tier-scaling `empower` wholesale, so `negate`/`ward`/`buffStat`/
  `guard`/`lifesteal`/`comboBonus`/`thorns` — and every `control` keyword,
  `stun`'s 1-turn lock included — stay exactly as frozen as before. At size 1
  the cap and the rate-solved value coincide at every tier: 4/6/8/10 charges =
  100/150/200/250 deci (`PRICE.cleansePerCharge` unchanged at 25). `autoScaleTier`
  (`src/engine/cards.ts`) now treats `cleanse` as a sink kind alongside
  damage/heal/shield, growing its `charges` field the same way DoTs grow
  `stacks` and sinks grow `power`.
- Extra rules: **stun ≤ `MAX_STUN_PER_CARD` per card**; auras are exempt
  (passive board identity, priced per reach); weight is bounded in native
  units (`WEIGHT_MIN`, `WEIGHT_MAX_BY_SIZE`); size ≤ `MAX_CARD_SIZE`.
- `applyTier` never scales control/empower magnitudes (`cleanse` excepted,
  per its own cap family above), so rank-ups can't break a compliant base
  card.

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

## `cooldown` pricing rationale

Cooldown (`SkillDef.cooldownTurns`, `BASELINE_COOLDOWN` global turns — see
`src/engine/types.ts` and `src/engine/combat/castSelect.ts`) is a SECOND
pacing dial alongside weight: weight orders which eligible card fires,
cooldown decides which cards are even eligible. A card cast on turn T is
unavailable T+1..T+cooldown and eligible again at T+cooldown+1 — a lone card
fires with stride `cooldown + 1` (baseline 3 → every 4th turn).

`cooldownPerTurn = 100` deci (10 PL) per turn of deviation — **user-locked
2026-07-19**: a shorter cooldown is a full extra cast over the course of a
fight, close to a whole Bronze card's worth of power, so it is priced like
one. Baseline (cooldownTurns omitted) prices at exactly +0, so every existing
card is unaffected. At this rate NO gem rarity budget (2-8 PL) can afford even
−1 turn, and no card in the shipped catalog overrides `cooldownTurns` — the
rate exists to price any future exception honestly.

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
covers every gem in `src/data/gems.ts` (35 gems as of 2026-08-09, after the
gem ruleset v1 §10 migration — was 46).

### `actionsPriceDeci`: the pricing switch, decoupled from `SkillDef`

`powerLevelDeci` sums a card's kit by calling `actionsPriceDeci(skill.effects,
skill.property)` and then layering on card-level things `actionsPriceDeci`
deliberately does NOT know about: aura mods, weight, size grant, and cooldown
deviation. `gemPowerLevelDeci` reuses the same `actionsPriceDeci` for effect
gems, so a single per-unit rate table prices both authored card effects and
gem effects — no duplicated switch.

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
