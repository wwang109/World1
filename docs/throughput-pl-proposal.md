# Throughput PL — a proposal (NOT adopted, no code/data changed)

**Status:** design proposal only. Nothing in `src/engine/balance.ts`,
`src/data/skills.ts`, or any test was touched to produce this document. Every
number below is derived from the CURRENT engine (`combat-model-spec.md`,
`castSelect`/`simulate`, and the live `PRICE` table) and validated against
real `npm run fight` output. If adopted, this would replace/extend
`PRICE` and require re-fitting the catalog — that is out of scope here.

---

## 1. Cadence model derived from the real engine

### 1.1 Reference combatant

- **Reference Speed = 12** — `BASE_HERO_STATS.speed` (`src/data/heroes.ts`).
  Enemy Speeds range 7–15 across the roster (`src/data/enemies.ts`); 12 sits
  in the middle and is the only Speed actually authored for the player side,
  so it's the defensible anchor.
- **Reference hit value H = 32 deci-equivalent... no — 32 flat points** — the
  total damage a Bronze single-target physical attack lands before mitigation:
  `Sword Slash` power 20 + reference Attack 12 = 32. This is the same
  hand-picked anchor the current system already implicitly uses (Sword Slash
  is the worked example in `PRICE.flatPowerPerPoint`'s own comment), so reusing
  it keeps this proposal grounded in an already-agreed reference rather than
  inventing a new one.
- **Baseline cooldown = 3** (`BASELINE_COOLDOWN`), so a lone repeating card's
  eligibility stride is **cooldown + 1 = 4 turns** (fires on turn T, next
  eligible T+4).

### 1.2 The cadence formula

Per `combat-model-spec.md` §2–4: readiness accumulates every turn
(`+= Speed`), a card spends its `weight` (keeping leftover), and a size-N card
busies its caster for N−1 further turns after firing, during which readiness
still accumulates but nothing can be spent. Modeling a **single card in
isolation** (the simplifying assumption below), the number of turns between
two casts of the same card is bounded by three independent floors:

```
stride(card) = max( size,                      // can't recast before the busy span ends
                     cooldownTurns + 1,         // can't recast before cooldown clears
                     ceil(weight / Speed) )     // can't afford it before readiness catches up

casts_per_turn(card) = 1 / stride(card)
```

**Modeling assumption (stated explicitly, not hidden):** this treats the card
as if it were the only thing on the board — i.e. a "spam-cap" / idealized
upper-bound cadence, not the literal multi-card cursor-lap frequency (which
also depends on how many OTHER cards sit between it and the cursor, and is
therefore board-composition-dependent and unknowable at authoring time). This
idealization is used **uniformly for every card**, so it stays valid as a
*relative* PL currency even though it isn't the literal observed frequency in
any specific board. It also matches how `PRICE` already treats weight/size:
per-card, context-free rates.

### 1.3 Validation against `npm run fight`

`npm run fight knight 1` (read-only, engine unmodified) shows the Knight
recasting `sword_slash` (weight 10, size 1, baseline cooldown 3) on turn 2,
then again on turn 6 — a stride of exactly **4 turns**, matching
`max(1, 4, ceil(10/9)) = 4` for the Knight's own Speed 9. The same log also
shows the Hero, after being busied by a size-3 `crushing_blow` (turns 5–7),
banking three turns of unspent Speed and then chaining **three casts in one
turn** (`second_wind` → `war_banner` → `sword_slash`, turn 10) — exactly the
"fast build plays several times" multi-cast behavior the spec describes, and
exactly the phenomenon the isolated-card model deliberately does NOT capture
(see §5's caveat on weight/burst).

### 1.4 The headline finding

For every currently-authored Bronze card, `weight ≤ 30` and `size ≤ 3` at
reference Speed 12: `ceil(weight/12) ≤ 3` and `size ≤ 3`, both **less than**
`cooldownTurns + 1 = 4`. **Cooldown is the sole binding constraint** — every
card in the current catalog has an idealized `stride = 4`,
`casts_per_turn = 0.25`, regardless of its own weight or size. This single
fact drives most of the rest of this proposal (see §5).

---

## 2. Throughput translation, per effect kind

Define **k = 20 deci-PL per unit of per-turn value** (derived and calibrated
in §3). Two families of effects:

**A. One-shot delivery, own cadence (damage / heal / shield / DoT-total):**
`per-turn value = (total value delivered by one cast) / stride`. For direct
damage/heal/shield the "total delivered by one cast" IS the power (a single
number); for a DoT the "total delivered by one cast" is `amount × turns`
(the same cast seeds every future tick). Both go through the same
`/ stride(=4)` dilution — this is why DoT's `amount × turns` and direct
`power` can share one price axis.

**B. Flat-no-stat discount:** heal/shield/DoT actions that do NOT add the
caster's scaling stat (TRUE heal/shield today; poison/burn always) are
authored at higher nominal numbers to compensate, so they carry a **0.4×
discount** on the throughput rate. This is already exactly how
`flatTruePerPoint` (2) and `dotPerPoint` (2) relate to `flatPowerPerPoint` (5)
today (2 = 5 × 0.4) — not a new idea, just made explicit as a reusable
multiplier instead of two independently-tuned constants.

**C. Denial / prevented-action effects (stun, negate):** these don't dilute
by the CASTER's cadence — they remove a whole opposing action (worth ≈ H) or
block N future opposing hits (worth ≈ N × H) outright, unconditional on how
often the caster itself recasts. `per-turn value = H` per stun-turn or per
negate-charge, run through the same `× k` (no `/ stride` — the value is
already "one full action," not diluted).

**D. Dilution-by-opponent's-cadence effects (guard, buffStat, debuffStat):**
these modify EITHER incoming hits (guard, defensive debuffs) or outgoing
hits (attack buffs) for a fixed number of TURNS, but only pay off on the
turns the relevant side actually casts — at that side's own idealized
`f = 0.25`. `per-turn value = H × (pct/100) × f`, and since this is a rate
already, no extra `/ stride` is applied on top (that's what makes these
different from stun/negate: their value scales with the DURATION window
actually seeing casts, not with "one guaranteed action").

**E. Delay riders (slowNext, stagger):** these add/drain readiness on the
opponent, delaying their next cast by roughly `(readiness delta / opponent
Speed)` turns, during which they lose `H × f` of expected output per delayed
turn. `per-turn value = (delta / Speed) × H × f`.

**F. Conditional bonus damage (comboBonus):** a flat bonus added to THIS
cast's own damage, gated on the previous cast having matched an archetype.
Its expected per-cast value is `amount × p`, where `p` is the probability the
gate was satisfied — **p = 0.5** is used here as a defensible flat prior (no
per-board data exists to do better); this is explicitly a rough estimate, not
a precise derivation, and should be revisited once real decks/sim data exist.

**G. Same-cast heal-back (lifesteal):** heals a % of the SAME cast's actual
dealt damage (which already includes the caster's stat) — so it is priced
like a stat-scaled heal on the card's own numbers: `pct/100 × (power + refStat)`,
no separate dilution (it rides the same cast as the damage it split off of).

**H. TRUE property premium and cleanse:** left **untouched**, as instructed —
cadence math cannot represent "ignores all defense" (a per-hit interaction
with the OPPONENT's stat sheet, not a frequency effect) or "removes whatever
debuffs currently exist" (entirely board-state-conditional, no meaningful
"per-turn value" exists in the abstract). These stay explicit flat terms.

**I. Auras/passives:** also left **untouched** — see §5/§6 Q3. A passive's
value is realized on *every future cast of every card its aura reaches*,
for the rest of the fight, which depends on board composition (how many
neighbors, what archetype/property they are) that the author cannot know
when writing the aura card. Cadence math forces an assumption about neighbor
count that the current flat-per-magnitude rate deliberately avoids.

---

## 3. Proposed formula and anchor calibration

```
k = 20 deci-PL  per 1 unit of "per-turn value"
stride = 4 turns (BASELINE_COOLDOWN + 1, unchanged, still locked)
H = 32           (Sword Slash 20 power + reference Attack 12)
refSpeed = 12    (BASE_HERO_STATS.speed)
f = 1 / stride = 0.25
```

| Effect | Old rate | New (throughput) rate | Formula |
|---|---|---|---|
| `damage` (any property) | 5 / power point | **5 / power point (unchanged)** | `k × f = 20 × 0.25 = 5` |
| `heal`/`shield` (scaled) | 5 / point | **unchanged** | same as damage |
| `heal`/`shield` (TRUE flat) | 2 / point | **unchanged** | `k × f × 0.4 = 2` |
| `poison`/`burn` | 2 / (amount×turn) | **unchanged** | `k × f × 0.4 = 2` |
| `stun` | 40 / turn | **160 / turn** | `5 × H` — see note¹ |
| `negate` | 50 / charge | **160 / charge** | `5 × H` — see note¹ |
| `buffStat`/`debuffStat` | 1 / (pct×turn) | **0.4 / (pct×turn)** | `k × H × f / 100 = 20×32×0.25/100 = 1.6/100 → 0.4 per (pct·turn) after unit fold` |
| `guard` | 1.25 / (pct×turn) | **0.4 / (pct×turn)** (same rate as debuffStat — premium removed) | same as above |
| `slowNext` | 2.5 / weight | **≈3.33 / weight (10/3)** | `(H×f/refSpeed) = 32×0.25/12 = 0.667`; deci `= 5×0.667 = 3.33` |
| `stagger` | 1.25 / amount | **≈3.33 / amount (10/3)** | same derivation as slowNext |
| `shieldBreak` | 1.25 / point | **2 / point** | `k×f×0.4×... = 5×0.4 = 2` (flat, no-stat, one-shot like a DoT total) |
| `comboBonus` | 5 / point | **2.5 / point** | `5 × p(0.5) = 2.5` |
| `lifesteal` | 2/3 / pct | **card-specific**: `5 × pct/100 × (power+12)` | see §2.G |
| TRUE premium | +10 flat | **unchanged** | explicit, non-cadence term |
| `cleanse` | +90 flat | **unchanged** | explicit, non-cadence term |
| aura mods | 20/point (×2 allBoard) | **unchanged** | explicit, non-cadence term |
| weight/size/cooldown | current formulas | **unchanged** | see §5 |

¹ *Worked simply*: `stun`/`negate` deliver one FULL prevented/blocked action
(worth `H`) per turn/charge, un-diluted by the caster's own cadence — but to
stay on the same integer-deci footing as every other family (all of which
collapse to `k/stride = 20/4 = 5` times a "total value" quantity), the rate
is expressed the same way: `PL_deci = 5 × H × (turns or charges) = 5 × 32 =
160` per stun-turn or per negate-charge. This is the number used in the
table and the worked totals in §4.

**Anchor:** Sword Slash (Bronze, power 20, weight 10, size 1, baseline
cooldown) stays exactly 100 deci = 10 PL under this model by construction —
`k` was solved for exactly that: `100 = k × (20 × 0.25)` → `k = 20`. Every
other stat-scaled damage/heal/shield/DoT card is therefore **byte-identical**
in price to today (see §4) — the anchor and the whole "family A/B" rate
table reduce to the CURRENT constants. The movement is concentrated entirely
in families C/D/E/F (denial, dilution, delay, conditional-bonus riders).

---

## 4. Worked table — all 34 cards at Bronze (current PL vs throughput PL)

All values in **deci-PL** (Bronze budget = 100). "current" = the audited
`powerLevelDeci` today; "proposed" = current formula with only the family
C/D/E/F/G rates swapped per §3 (weight/size/cooldown/TRUE/cleanse/aura terms
identical in both columns).

| Card | current | proposed | Δ | Justified? |
|---|---|---|---|---|
| sword_slash | 100 | 100 | 0 | — (pure damage, unaffected) |
| savage_bite | 100 | 100 | 0 | — |
| rending_claws | 100 | 100 | 0 | — |
| hunter_shot | 100 | 100 | 0 | — |
| arcane_bolt | 100 | 100 | 0 | — |
| crushing_blow | 100 | 100 | 0 | — |
| fireball | 100 | 100 | 0 | DoT rate already matches throughput |
| soul_rend | 100 | 100 | 0 | — |
| **crippling_strike** | 100 | 70 | **−30** | Yes — debuff is diluted by enemy's own cast cadence, current premium-free rate already overpriced it |
| venom_fang | 100 | 100 | 0 | — |
| iron_bulwark | 100 | 100 | 0 | — |
| mana_ward | 100 | 100 | 0 | — |
| prism_barrier | 100 | 100 | 0 | — |
| **frost_ward** | 100 | 32 | **−68** | Yes — `guard`'s current 1.25× "unconditional" premium has it backwards: it's gated on the OPPONENT actually attacking during the window, same dilution as a stat debuff, not stronger |
| **ward_of_silence** | 100 | 320 | **+220** | Yes, biggest structural gap — `negate` deterministically voids full hits regardless of the caster's own cadence; today's flat 50/charge badly underprices that |
| mending_light | 100 | 100 | 0 | — |
| second_wind | 100 | 100 | 0 | — |
| war_banner | 100 | 100 | 0 | aura left out of throughput reframing (§2.I) |
| time_crystal | 100 | 100 | 0 | same |
| lucky_charm | 100 | 100 | 0 | same |
| **battle_howl** | 100 | 40 | **−60** | Yes — same dilution logic as guard; a self-buff only pays off on the caster's own future casts, not "every turn" |
| **hamstring** | 100 | 113 | +13 | Mild — `slowNext` delay value scales with H and opponent Speed, slightly above today's flat weight-based rate |
| **leeching_fang** | 100 | 133 | +33 | Yes — lifesteal heals off the FULL dealt-damage-with-stat, worth more than a flat %-of-power rate suggests |
| **shield_splitter** | 100 | 118 | +18 | Mild — shieldBreak's flat-no-stat "remove a defense point" is closer to a DoT-style total than a discounted rider |
| **follow_through** | 100 | 75 | −25 | Directionally consistent with the *already-approved* comboBonus cut in the current pricing history — conditional bonuses have unreliable uptime |
| **concussive_shot** | 100 | 167 | **+67** | Yes — `stagger` draining 32 readiness (≈2.7 turns of enemy Speed) is a meaningfully large tempo swing, underpriced today |
| **hex_of_frailty** | 95 | 32 | **−63** | Yes — same dilution logic as guard/battle_howl, and it's a 3-turn debuff so the effect compounds |
| **armor_break** | 100 | 40 | **−60** | Yes — same dilution logic |
| **slow_hex** | 100 | 64 | −36 | Yes — small damage + diluted speed debuff |
| **stunning_smash** | 100 | 220 | **+120** | Yes, biggest mover overall — `stun` denies a WHOLE guaranteed enemy action; today's 40/turn (already flagged "re-tune deferred, no sim data") is far below its true expected value |
| **judgment_light** | 100 | 76 | −24 | Yes — dilution logic |
| shadow_bolt | 100 | 100 | 0 | — |
| purging_strike | 100 | 100 | 0 | — |
| purify | 100 | 100 | 0 | — |

**Summary:** 20 of 34 cards are unchanged (pure damage/heal/shield/DoT/TRUE/
aura/cleanse cards — the throughput model reproduces the existing formulas
exactly for those). The 14 cards that move split cleanly into two groups:
**denial/tempo riders move UP** (stun +120, negate +220, stagger +67,
lifesteal +33, shieldBreak +18, slowNext +13) because they deliver
guaranteed or near-guaranteed value independent of the caster's own cast
rate; **conditional/dilution riders move DOWN** (guard −68, all `debuffStat`/
`buffStat` cards −24 to −63, comboBonus −25) because their payoff depends on
either side's cast timing actually lining up with the effect's active
window, which the flat "pct × turns" formula ignored.

---

## 5. What this implies for weight / size / cooldown

**They stay fully emergent — no formula change needed, but the reason why is
important and worth locking down explicitly:**

- At reference Speed 12, `ceil(weight/12) ≤ 3` for every weight in the
  current catalog (max 30), and `size ≤ 3` — both always below the
  `cooldownTurns + 1 = 4` floor. **Cooldown, fixed at 3 for every card by the
  just-locked rule, is therefore the sole determinant of idealized cadence at
  current content ranges** — weight and size currently do NOT change a
  card's per-turn value under this model. That's exactly why `weightPer` and
  `sizeGrantDeci` can stay as separate, cadence-blind "footprint/tempo"
  charges (weight = tie-break ordering + multi-cast burst eligibility within
  a turn; size = board real estate + spell-span opportunity cost) without
  double-counting anything the throughput math already prices.
- **This reconciles with the just-locked rules cleanly**: cooldown fixed at 3
  for all cards, and size grants scaling by tier, are both *compatible* with
  a throughput reading — they're just not currently *doing* cadence work
  (cooldown already dominates), so nothing about this proposal argues to
  change either rule.
- **The one caveat**: if any future card (Silver+, or a heavy socketed gem)
  pushes `weight` above `4 × Speed` (48 at reference Speed 12) or `size`
  above 3, the idealized stride would EXCEED 4 and the card's true per-turn
  value would drop below what the flat per-point damage/heal/DoT rates
  assume — at that point the flat weight-refund/size-grant terms would no
  longer fully compensate (they're additive, not multiplicative on the whole
  kit), and the card could be quietly overpriced relative to its real
  cadence. Recommendation: no change now (nothing in the catalog crosses
  this threshold), but flag the `4 × Speed` line as a "revisit before
  authoring past this" tripwire — see Open Question 4.
- **Known limitation of the whole model**: it explicitly does NOT capture
  multi-cast bursts (§1.3's turn-10 fight-log example — three casts in one
  turn after a busy period banks readiness). Lower weight makes bursts more
  likely/larger; this is a real strategic value of weight that the isolated
  single-card model can't see. Today's flat weight-refund is arguably a
  reasonable stand-in for this (it already prices "lighter = stronger"), so
  this proposal does not recommend touching it — just flags that the
  cadence math and the burst-enabling value of weight are two different
  things that happen to currently be priced by the same knob.

---

## 6. Open questions (max 5)

1. **Should the denial/tempo riders (stun, negate, stagger, slowNext,
   lifesteal, shieldBreak) actually move to their throughput rates?** They
   move UP substantially (stun +12 PL, negate +22 PL on `ward_of_silence`,
   stagger +6.7 PL on `concussive_shot`). `stun` is *already* flagged in the
   code as "re-tune deferred, no sim data" — this analysis independently
   arrives at a ~4× increase from first principles.
   **Recommendation: yes, phase in via `npm run sim`-validated re-tune**,
   starting with `stun` and `negate` (largest, clearest gaps), before
   touching the smaller movers (slowNext/shieldBreak).

2. **Should guard/buffStat/debuffStat move DOWN, and should guard's current
   1.25× "unconditional" premium be removed entirely?** The throughput
   model shows guard's payoff is just as diluted-by-opponent-cadence as a
   plain stat debuff — the premium's stated rationale ("applies straight to
   the final hit with no diminishing-returns math") doesn't survive contact
   with cast-frequency math. **Recommendation: yes, drop the premium and
   align guard to the same rate as buffStat/debuffStat**, but validate the
   resulting cheaper Bronze debuff cards don't feel weightless in
   `npm run sim` before locking.

3. **Should auras/passives be pulled into throughput math at all?** This
   proposal deliberately left them out (§2.I) — a passive's value depends on
   an unknowable number of future neighbor casts, which the author can't
   size at write-time the way they can size a card's own weight/cooldown.
   **Recommendation: no — keep the current flat per-magnitude aura pricing
   as an explicitly separate, non-cadence axis, same footing as TRUE
   premium and cleanse.**

4. **Should the weight-refund/size-grant mechanism become multiplicative
   (a % discount on the WHOLE kit) once weight/size push a card's idealized
   stride past the baseline 4-turn cooldown floor (i.e., weight > 4×Speed or
   size > 3)?** Nothing in the current catalog crosses this line, so there's
   no urgency, but Silver/Gold/Diamond content or a heavy Legendary gem
   plausibly could. **Recommendation: no change now; add a code comment /
   tripwire so `content-designer` and `balance-designer` know to revisit
   pricing (not just re-audit) if a future card's weight or size crosses
   that threshold.**

5. **Should `refSpeed = 12` and `H = 32` be promoted to named, documented
   constants in `PRICE` (e.g. `PRICE.referenceSpeed`, `PRICE.referenceHit`)
   so future rider pricing derivations are reproducible instead of re-derived
   ad hoc each time?** This proposal picked both values by citing existing
   authored content (hero base Speed, Sword Slash's own worked example) —
   they're defensible but currently exist only in this document's prose.
   **Recommendation: yes, if any part of this proposal is adopted — lock
   both constants by name next to `PRICE` with the same citation trail used
   here, so the next rider (or the next tier's version of `stun`) is priced
   against the same anchors rather than a fresh guess.**

---

## Appendix — arithmetic used per family (for auditability)

```
k = 20 deci / (per-turn value unit)
stride = 4 turns
f = 0.25
H = 32 (Sword Slash 20 power + reference Attack 12)
refSpeed = 12

damage/heal/shield (scaled):      deci = power * (k*f)              = power * 5
heal/shield (TRUE, no-stat) / DoT: deci = total * (k*f*0.4)          = total * 2   [total = power, or amount*turns]
stun:                              deci = turns * (k*f*H)            = turns * 160
negate:                            deci = charges * (k*f*H)          = charges * 160
buffStat/debuffStat/guard:         deci = pct*turns * (k*f*H/100)    = pct*turns * 0.4
slowNext/stagger:                  deci = delta * (k*f*H/refSpeed)   = delta * 3.33 (10/3)
shieldBreak:                       deci = amount * (k*f*0.4)         = amount * 2
comboBonus:                        deci = amount * (k*f*p), p=0.5   = amount * 2.5
lifesteal:                         deci = (pct/100 * (power+refStat)) * (k*f) = ... * 5
TRUE premium / cleanse / aura:     unchanged, explicit non-cadence terms
weight / size / cooldown:          unchanged, emergent-compatible (see §5)
```
