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
| `damage` (any property) | `power * flatPowerPerPoint` | `PRICE.flatPowerPerPoint` (5) | FLAT base; 2 power = 1 PL. Caster's stat is added at cast time, unpriced |
| `heal` / `shield` (physical/magical) | `power * flatPowerPerPoint` | `PRICE.flatPowerPerPoint` (5) | FLAT base + caster stat; 2 power = 1 PL |
| `heal` (TRUE, pure flat, no stat) | `power * flatTrueHealPerPoint` | `PRICE.flatTrueHealPerPoint` (2) | 5 flat points = 1 PL |
| `shield` (TRUE, pure flat, no stat) | `power * flatTrueShieldPerPoint` | `PRICE.flatTrueShieldPerPoint` (**5**, was 4) | 2 flat points = 1 PL, typed parity — the premium is mechanical: typed damage drains the TRUE pool 2:1 (half effectiveness), TRUE damage 1:1 |
| TRUE damage premium (scales with amount) | `+truePremiumPerPoint` per point of TRUE damage | `PRICE.truePremiumPerPoint` (**5**, was 1) | Half-effect rule (user-locked 2026-07-20): TRUE damage = 10 deci/pt, exactly double typed — 5 PL buys 10 typed damage but only 5 TRUE. Heals pay via `flatTrueHealPerPoint` instead (kept cheap: healing is never mitigated, TRUE buys no bypass) |
| `poison` / `bleed` | `(stacks × (stacks+1) / 2) * dotPerTotalDamage` | `PRICE.dotPerTotalDamage` (2) | Decaying model (user-locked 2026-07-20): a tick = current stacks, then −1; N stacks = N×(N+1)/2 total damage, 5 total = 1 PL. Whole PL ⇔ N ≡ 0 or 4 (mod 5). Poison: end-of-turn, unstoppable. Bleed: per-performance, unstoppable once running, application blocked by active shields |
| `burn` | authored size table | `PRICE.burnPlDeciBySize` (4→20 · 5→30 · 8→50 · 10→60) | Halving model (user-locked 2026-07-20): start-of-turn tick = 2× stacks, then stacks halve — burn 8 ticks 16,8,4,2 = 30 total over 4 turns. Priced 1.43-1.88 deci per total point (a 15-30% discount vs poison's 2.0) because every tick is absorbed by shields. Unlisted sizes fall back to the poison rate on burn's total |
| `stun` | `turns * stunPerTurn` | `PRICE.stunPerTurn` (**100**, was 40) | 10 PL/turn — a consumed performance ≈ a whole Bronze card (throughput §2.C); moderated step toward 160, sim re-tune deferred |
| `buffStat` / `debuffStat` | `pct * turns * statPctTurn` | `PRICE.statPctTurn` (1) | 10%-turn = 1 PL |
| `expose` (%amp) | `pct * turns * exposePerPctTurnNum / Den` | `PRICE.exposePerPctTurnNum` (1), `Den` (1) | Guard-parity: amplifying and reducing cost the same (1×) |
| `cleanse` | `charges * cleansePerCharge` | `PRICE.cleansePerCharge` (**25**, was flat 90) | 2.5 PL per effect removed; `purify` (4 charges) = 100 = Bronze |
| `slow` | `weight * slowPerWeightNum / Den` | `PRICE.slowPerWeightNum` (5), `Den` (2) | 1 PL per +4 weight |
| `disrupt` | `amount * disruptPerPointNum / Den` | `PRICE.disruptPerPointNum` (5), `Den` (**2**, was 4) | 1 PL per 4 drained (was per 8) — a meaningful tempo swing (throughput §2.E) |
| `lifesteal` | `pct * lifestealPerPctNum / Den` | `PRICE.lifestealPerPctNum` (2), `Den` (3) | 1 PL per 15% |
| `shieldBreak` | `amount * shieldBreakPerPointNum / Den` | `PRICE.shieldBreakPerPointNum` (5), `Den` (4) | 1 PL per 8 shattered |
| `comboBonus` | `amount * comboPerPoint` | `PRICE.comboPerPoint` (5) | Same rate as a card's own flat damage |
| `guard` (%DR) | `pct * turns * guardPerPctTurnNum / Den` | `PRICE.guardPerPctTurnNum` (**1**), `Den` (**1**) | Parity with `statPctTurn` (1×) — the old 1.25× premium was removed; see rationale below |
| `negate` (charges) | `charges * negatePerCharge` | `PRICE.negatePerCharge` (**100**, was 50) | Flat per-charge; a fully cancelled hit ≈ a Bronze card — see rationale below |
| aura `damagePct` | `damagePct * auraDamagePct * reach` | `PRICE.auraDamagePct` (4) | `reach` = 2 for `allBoard`, else 1 |
| aura `healPct` | `healPct * auraHealPct * reach` | `PRICE.auraHealPct` (4) | |
| aura `critPctDelta` | `critPctDelta * auraCritPct * reach` | `PRICE.auraCritPct` (5) | |
| aura `|weightDelta|` | `abs(weightDelta) * auraWeightDelta * reach` | `PRICE.auraWeightDelta` (20) | |
| weight | `(baseline − weight) * weightPer` | `PRICE.weightPer` (5), baseline = `size * 10` | Every 2 lighter costs 1 PL; every 2 heavier REFUNDS 1 PL |
| size grant | `−sizeGrantDeci(size, tier)` — Bronze anchor × (tierBudget + 100) / 200 | `PRICE.sizeGrant2Bronze/3Bronze` | Grows at HALF the tier-budget growth (Bronze +14/+38 … Diamond +24.5/+66.5 PL); big cards get extra kit budget for board space + turn span |
| cooldown (`cooldownTurns`) | `(BASELINE_COOLDOWN − cooldownTurns) * cooldownPerTurn` | `PRICE.cooldownPerTurn` (**20**), `BASELINE_COOLDOWN` (3, `src/engine/types.ts`) | Shorter than baseline COSTS PL, longer REFUNDS — see rationale below |

## Effect investment caps (design contract, user-locked 2026-07-20)

Tier budgets × size grants multiply a card's kit PL (Diamond size-3 ≈ 91 PL);
caps stop that budget from becoming lockdown. Per-size ceilings on the PL a
single card may invest per effect family — constants in
`EFFECT_CAPS_DECI` (`src/engine/balance.ts`), audited for every card by the
EFFECT-CAP AUDIT test, rendered live on the wiki RULES page. **When designing
a card, run `npm test` — the audit names any cap it breaks.**

| Family (max PL per card) | Size 1 | Size 2 | Size 3 | Tier-scaled? |
|---|---|---|---|---|
| Control — stun, slow, disrupt, stat-down, expose, shieldBreak | 10 | 15 | 20 | No; plus **stun ≤ 1 per card** (`MAX_STUN_PER_CARD`) |
| DoTs — poison + burn + bleed combined | 20 | 30 | 40 | No (tiers buy bigger stacks *inside* the cap via the price ladder) |
| Buffs — stat-up, guard, negate, cleanse, lifesteal, combo | 10 | 15 | 20 | No; auras exempt (passive board identity) |
| Damage — flat, incl. TRUE | 12 | 28 | 50 | **Yes** ×1.5/×2/×2.5 (Silver/Gold/Diamond) |
| Shield — flat, incl. TRUE | 12 | 28 | 50 | **Yes** — same multiplier |
| Heal — flat, incl. TRUE | 12 | 28 | 50 | **Yes** — same multiplier |

`applyTier` never scales control/empower magnitudes, so rank-upgraded cards
can't drift over a cap; the flat families are the intended sink for tier
growth, so their caps grow with the tier budget. **A capped control card
spends its surplus budget on LIGHTER WEIGHT (2 below baseline = 1 PL → casts
sooner) or on effects from other families** — that's the documented authoring
pattern, not a rule exception.

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
(`statPctTurn` = 1× — `guardPerPctTurnNum/Den = exposePerPctTurnNum/Den = 1/1`).
The old guard **1.25× premium was removed** (user-locked 2026-07-19): per the
throughput analysis (`docs/throughput-pl-proposal.md` §2.D) guard only pays off
on the turns the opponent actually attacks during the window — the same
opponent-cadence dilution as a stat debuff — so the premium was unjustified.

Showcase: **Guard 50% for 2 turns, magical** (or **Expose 50% for 2 turns**),
as the sole effect on a size-1 card with no weight override — `50 * 2 * 1 = 100`
deci-PL = **Bronze exactly**. (Runtime clamps guard `pct` to ≤60 and expose
`pct` to ≤50 at apply time — separate safety rails, not pricing inputs.)

## `negate` pricing rationale

`negate` grants charges that fully cancel the caster's next direct hits of a
matching `property` — a fully cancelled direct hit is worth roughly a whole
Bronze card's output (throughput §2.C), so it's priced as a **flat deci-PL per
charge**: `negatePerCharge = 100` (user-locked 2026-07-19, raised from 50).

- 1 charge = 100 deci (= Bronze exactly).
- 2 charges = 200 deci · 3 charges (the apply-time clamp max, "total charges of
  a property ≤3") = 300 deci.

## `cooldown` pricing rationale

Cooldown (`SkillDef.cooldownTurns`, `BASELINE_COOLDOWN = 3` global turns, see
`src/engine/types.ts` and `src/engine/combat/castSelect.ts`) is a SECOND
pacing dial alongside weight: weight orders which eligible card fires,
cooldown decides which cards are even eligible. A card cast on turn T is
unavailable T+1..T+cooldown and eligible again at T+cooldown+1 — a lone card
fires with stride `cooldown + 1` (baseline 3 → every 4th turn).

Pricing anchor: the user's own rule is "every 2 [weight] lighter = +1 PL,
every 2 heavier = −1 PL" (`weightPer = 5` deci per 1 weight unit, i.e. 10 deci
per that 2-unit step). Cooldown is priced **steeper** than that step on
purpose — deviating a weight unit only reorders a turn (a tie-break), while
deviating a cooldown turn gates castability outright and can mean a whole
extra cast over a fight. `cooldownPerTurn = 20` deci/turn (2 PL/turn) is 2×
the per-weight-step rate:

`deci += (BASELINE_COOLDOWN − cooldownTurns) * cooldownPerTurn`

- `cooldownTurns` 2 (−1 from baseline 3) → **+20 deci (+2 PL)**: fires every
  3rd turn instead of every 4th.
- `cooldownTurns` 1 (−2) → **+40 deci (+4 PL)**: fires every other turn.
- `cooldownTurns` 5 (+2 longer) → **−40 deci (−4 PL refund)**: fires every 6th
  turn instead of every 4th.
- `cooldownTurns` omitted (baseline 3) → **+0 PL**. No card in the shipped
  catalog currently overrides `cooldownTurns`, so every existing card is
  unaffected by this price (deviation 0).

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
`damage`/`heal`/`shield` action, which prices at the `flatPowerPerPoint` rate
(physical/magical) vs. the cheaper flat-TRUE rate (TRUE heal/shield). Fixing the
property to `physical` for gem pricing means:
- Riders with no property dependence (poison, stun, buffStat, slow,
  disrupt, lifesteal, shieldBreak, comboBonus, guard, negate, cleanse) price
  identically no matter what property is picked — this choice only matters
  for raw damage/heal/shield gem actions.
- The **TRUE premium never applies to gems** — it's a card-level charge for
  *casting cards* (`hasCast && skill.property === 'true'`) applied by
  `powerLevelDeci` outside of `actionsPriceDeci`; gems never see it.

### Cooldown-reduction rider (effect gems)

An effect gem may carry `cooldownReduction?: number` — turns shaved off the
host card's effective cooldown (additive, floored at 0; never lengthens).
It's folded into the effective skill by `resolveEffectiveSkill` (`src/engine/
cards.ts`), so `castSelect`'s `effectiveCooldown()` sees the shortened value
with no change to the core loop's function signatures.

Priced at the **same rate as a card's own `cooldownTurns` deviation**
(`PRICE.cooldownPerTurn` = 20 deci/turn) — a −1-cooldown gem effect must be
worth exactly what a card baked with a −1-shorter cooldown would cost:

`gemPowerLevelDeci = actionsPriceDeci(gem.actions, ...) + cooldownReduction * cooldownPerTurn`

Catalog examples (`src/data/gems.ts`): `quickening_sliver` (Common, −1 turn,
no other actions) = `1 * 20 = 20` deci = Common exactly; `quickening_core`
(Rare, −2 turns) = `2 * 20 = 40` deci = Rare exactly.

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

## Throughput rebalance pass (2026-07-19, user-locked)

Rate changes derived from `docs/throughput-pl-proposal.md` (denial/tempo
riders were underpriced; the guard premium was unjustified) plus two new
effects and a per-charge cleanse. The affected cards were re-fit **mechanically**
(magnitudes only, never tier/archetypes) so each lands back on its tier budget.

| Change | Before | After | Why |
|---|---|---|---|
| `stunPerTurn` | 40 | **100** | A consumed enemy performance ≈ a whole Bronze card (throughput §2.C). Moderated step toward the proposal's 160; sim re-tune deferred |
| `negatePerCharge` | 50 | **100** | A fully cancelled direct hit ≈ a Bronze card (§2.C) |
| `disrupt` Den | 4 | **2** | 1 PL per 4 drained (was per 8) — draining banked readiness is a real tempo swing (§2.E) |
| `guardPerPctTurn` | 5/4 | **1/1** | Parity with `statPctTurn`; the 1.25× premium was unjustified (§2.D) |
| `cleanse` | flat 90 | **25/charge** | Priced per effect removed ("x per PL spent"); `purify` = 4 charges = 100 |
| `expose` (NEW) | — | `pct * turns * 1/1` | Guard-parity amplifier (mirror of guard) |
| `bleed` (NEW) | — | `amount * turns * 2` (dotPerPoint) | Per-performance DoT; per-perf timing stronger vs fast enemies, deferred to sim |

Card re-fits (all land exactly on Bronze = 100 deci):

- `stunning_smash` → pure stun (damage removed), size 2→1: stun 1 = 100.
- `ward_of_silence` → negate charges 2→1: 100.
- `frost_ward` → guard pct 40→50 (×2 turns ×1 = 100).
- `concussive_shot` → disrupt 32→16 (40) + damage 12 (60) = 100.
- `purify` → cleanse charges 4 = 100.
- NEW `rupturing_strike` (bleed showcase): damage 10 (50) + bleed 5×5 (50) = 100.
- NEW `ruinous_hex` (expose showcase): expose 50%×2 = 100.

Forced gem re-fits (rate consequence; content-designer to review — the stun
gems could no longer fit any rarity band at 100 deci/turn):

- `concussive_shot_echo` disrupt 16→8 (Common 20).
- `frost_ward_echo` guard 16%→20%, `ward_of_silence_echo` guard 32%→40% (Rare 40).
- `stunning_shard`, `stunning_smash_echo`, `concussive_shard` re-themed
  stun→slow (16/16/32 weight → Rare 40 / Rare 40 / Legendary 80).
