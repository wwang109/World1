// Power Level (PL) balance system.
//
// Every card belongs to a tier with a fixed PL budget, and every modifier on
// the card has a PL price; a card's whole kit must sum to its tier's budget.
// Prices are computed in deci-PL (PL × 10) so all math stays in integers.
//
//   Bronze 10 · Silver 15 · Gold 20 · Diamond 25
//
// PRICE below is the single source of truth for every per-unit rate; the
// full documented table (with worked examples) lives in
// docs/power-level-reference.md, sourced from these exact constants. Do not
// hand-copy numbers elsewhere — read PRICE.

import { BASELINE_COOLDOWN, isMultiTargetSkill, weightOf, type Action, type BuffableStat, type Gem, type Property, type Rarity, type SkillDef, type SkillTier } from './types';
import { buildKeywordPricing, priceActionDeci, scalableRateDeci, walkBrackets, type CapFamily } from './keywords/pricing';

export const TIER_BUDGET_DECI: Record<SkillTier, number> = {
  bronze: 100,
  silver: 150,
  gold: 200,
  diamond: 250,
};

/**
 * Audit tolerance: ZERO — budgets are exact (user-locked 2026-07-19). Rules
 * are whole-PL per clean unit; when a card can't land exactly, the CARD's
 * effects change, never the rates.
 */
export const BUDGET_TOLERANCE_DECI = 0;

/**
 * Named, documented price table (deci-PL per unit). Every case in
 * `powerLevelDeci` below reads from here — this is the single source of
 * truth for pricing; `docs/power-level-reference.md` cites these constants
 * by name.
 */
export const PRICE = {
  /**
   * Flat card power (damage / non-TRUE heal / non-TRUE shield): deci per flat
   * point — 2 flat = 1 PL. A card's `power` is now a FLAT base amount (the
   * caster's Attack/Magic Power is added on top at cast time, universal and
   * unpriced — the same abstraction the old `%-of-stat` model had). At this
   * rate a plain single-target attack is base 20/30/40/50 at
   * Bronze/Silver/Gold/Diamond — each tier step = +10 base = +5 PL.
   */
  flatPowerPerPoint: 5,

  /**
   * Flat TRUE heal: deci per point — 2.5 flat = 1 PL (no stat add). Re-priced
   * 2 -> 4 (balance-designer pass, 2026-08-01): empirical early-game
   * dominance of flat TRUE heals over MATK-scaling non-TRUE heals — at the
   * old rate the crossover point (where a %-of-MATK heal out-heals the flat
   * TRUE amount) only arrived around MATK 30-40, which most builds don't
   * reach until well past the early game. Doubling the rate pulls that
   * crossover down to MATK 5-10, so non-TRUE heals become competitive much
   * sooner and flat TRUE heals stop being a strict early dominant strategy.
   * Heals still keep a cheaper rate than flat damage (flatPowerPerPoint = 5)
   * — reactive and lossy (overheal wastes) — just a smaller discount than
   * before.
   */
  flatTrueHealPerPoint: 4,

  /**
   * Flat TRUE shield: deci per point — 2 flat = 1 PL, typed-shield parity
   * (user-locked 2026-07-20). The TRUE premium is paid MECHANICALLY, not in
   * PL: typed damage spilling into the true pool drains it 2:1 (half
   * effectiveness), while TRUE damage is blocked 1:1 — so per PL a TRUE
   * shield is half a typed shield against typed hits and the only answer
   * to TRUE hits. (It also never gets the caster-stat add typed shields do.)
   */
  flatTrueShieldPerPoint: 5,

  /**
   * TRUE damage premium — SCALES with the damage amount (user-locked
   * 2026-07-20: TRUE is HALF as effective per PL — 5 PL buys 10 typed
   * damage but only 5 TRUE damage, because it bypasses defenses). Charged
   * per point of TRUE `damage` power ON TOP of flatPowerPerPoint: TRUE
   * damage costs flatPowerPerPoint + truePremiumPerPoint = 10 deci/point,
   * exactly double physical/magical. TRUE heals/shields don't pay it —
   * their rates live in flatTrueHeal/ShieldPerPoint (heals keep a cheap
   * rate: healing is never mitigated, so TRUE buys no bypass there).
   */
  truePremiumPerPoint: 5,

  /**
   * poison/bleed/burn (LINEAR PER-STACK model, user-locked 2026-07-23 —
   * REPLACES the prior quadratic decaying-TOTAL pricing). A DoT card is
   * priced directly on its authored `stacks` number, not on the total damage
   * that model decays to: cost = stacks × dotPerStack = stacks × 10 deci
   * (1 PL per stack, flat). This makes EVERY stack count legal at a whole-PL
   * price — the old total-damage formula (N×(N+1)/2 × 2 deci = N×(N+1) deci)
   * only landed on a whole PL when N ≡ 0 or 4 (mod 5), which made stack
   * counts like 7 or 8 impossible to price cleanly; a linear per-stack rate
   * has no such gap, so authors get fine-grained control at every tier
   * (e.g. a card can go 5 → 7 → 8 stacks tier-to-tier).
   *
   * The TICK GAMEPLAY is UNCHANGED — this is a pricing-only change:
   *   - poison/bleed still DECAY (tick = current stacks, then −1 stack;
   *     N stacks deals N×(N+1)/2 total over N ticks).
   *   - burn still HALVES (tick = 2×stacks at turn start, then stacks
   *     halve floored; see `burnTotalDamage`).
   * All three share ONE rate for simplicity/calculability rather than
   * per-type rates: poison and bleed have the identical decaying-total
   * curve so sharing was already the existing design; burn's halving curve
   * converges to LESS total damage per stack (burn 8 → 30 total vs poison's
   * 8 → 36), so under a shared linear rate burn is now priced somewhat
   * ABOVE its total-damage efficiency (its old size table gave it a ~15-30%
   * discount per point of total damage — that discount is gone under the
   * flat rate). This is an intentional simplification: the EFFECT_CAPS_DECI
   * `dot` family cap (200/300/400 deci by size, unchanged) is the backstop
   * against any DoT card — poison, bleed, or burn — over-investing in raw
   * stack count regardless of how the per-stack rate compares to its total
   * damage curve.
   */
  dotPerStack: 10,

  /**
   * stun: turns * stunPerTurn — 10 PL/turn (user-locked 2026-07-19; raised from
   * 4 PL/turn). Throughput rationale (docs/throughput-pl-proposal.md §2.C): a
   * stun DENIES a whole guaranteed enemy performance (~ a full Bronze card's
   * worth of output), un-diluted by the caster's own cadence, so one consumed
   * performance is priced at roughly one Bronze card. This is a moderated step
   * toward the proposal's 160; a final re-tune waits on `npm run sim` data.
   */
  stunPerTurn: 100,

  /** buff/debuff stat: pct * turns * statPctTurn — 10%-turn = 1 PL. */
  statPctTurn: 1,

  /**
   * cleanse: charges * cleansePerCharge — 2.5 PL per negative effect removed
   * (user-locked 2026-07-19: priced per unit of removal, "x per PL spent",
   * replacing the old flat 100). At this rate `purify` (4 charges) = 100 =
   * Bronze exactly. RATE UNCHANGED by the 2026-08-17 tier-scaling ruling —
   * cleanse is now the one `scalable: true` empower-adjacent keyword (its own
   * `cleanse` cap family, `TIER_SCALED_FAMILIES`), so the SAME 25-deci step
   * also lands 6/8/10 charges exactly on Silver/Gold/Diamond (150/200/250).
   */
  cleansePerCharge: 25,

  /** weight: (baseline − weight) * weightPer — every 2 lighter costs 1 PL,
   * every 2 heavier REFUNDS 1 PL (more weight = slower attacks). Baseline =
   * size * 10. */
  weightPer: 5,

  /**
   * Size grants: Bronze anchors (deci) that grow with tier at only HALF the
   * budget growth (user-locked 2026-07-19: full proportionality over-granted
   * higher tiers). grant = bronzeGrant × (tierBudget + 100) / 200:
   *   size 2: Bronze +14 · Silver +17 · Gold +21 · Diamond +24 PL
   *   size 3: Bronze +38 · Silver +47 · Gold +57 · Diamond +66 PL (whole PL, floored)
   * Rationale unchanged: big cards cost 2-3 board slots AND busy the caster
   * for size-1 extra turns (spell span), so they get more than N× a size-1's
   * effect budget. Use sizeGrantDeci().
   */
  sizeGrant2Bronze: 140,
  sizeGrant3Bronze: 380,

  /**
   * cooldown — a SHORTER cooldown fires more often (stronger, costs MORE
   * PL): `(BASELINE_COOLDOWN − cooldownTurns) * cooldownPerTurn`. A LONGER
   * cooldown fires less often (weaker, REFUNDS PL) at a DIFFERENT, DIMINISHING
   * rate — `cooldownDeviationDeci` walks `cooldownRefundStepDeci` for that
   * side (balance-designer pass, 2026-08-19; see that constant). Baseline (3,
   * the default when `cooldownTurns` is omitted) is free — deviation 0 → +0
   * PL, so every existing (baseline) card is unaffected.
   *
   * Priced at 100 deci (10 PL) per turn on the SHORT side — user-locked 2026-07-19: a shorter
   * cooldown is a full extra cast over the course of a fight, close to a
   * whole Bronze card's worth of power, so it is priced like one. At this
   * rate NO gem rarity budget (2-8 PL) can afford even −1 turn, so nothing
   * in the current content deviates from the fixed baseline 3; the rate
   * exists to price any future exception honestly.
   *
   * THE LONG SIDE IS CLAMPED (2026-08-17, fail-open close): this rate is
   * only honest for a deviation that actually removes/adds a cast. Read
   * unclamped, `(BASELINE_COOLDOWN − cooldownTurns)` grows without bound as
   * `cooldownTurns` grows, so an absurd cooldown (16, 99, ...) bought
   * hundreds of deci of budget for refunding casts a card never had to begin
   * with. See `MAX_COOLDOWN_TURNS` / `cooldownDeviationDeci` below — the ONE
   * place this term is now computed, shared by `powerLevelDeci` here and
   * `autoScaleTier` in cards.ts.
   *
   * THIS RATE NOW PRICES THE SHORT (COST) SIDE ONLY (balance-designer pass,
   * 2026-08-19). The long (refund) side moved off this flat rate onto
   * `cooldownRefundStepDeci` below — see that constant for why a single flat
   * rate over the whole 3->6 range was dishonest, and for the diminishing
   * shape that replaced it. The short side is untouched: cooldown is a
   * deck-diversity dial, and a card BUYING a shorter cooldown is buying a
   * real, guaranteed extra cast every time — a flat per-turn cost is still
   * the honest shape there, and stays this rate.
   */
  cooldownPerTurn: 100,

  /**
   * DIMINISHING REFUND PER EXTRA TURN, one entry per turn beyond
   * `BASELINE_COOLDOWN` (index 0 = the 1st extra turn, 3->4; index 1 = 4->5;
   * index 2 = 5->6, the `MAX_COOLDOWN_TURNS` clamp) — balance-designer pass,
   * 2026-08-19, REPLACES the flat `cooldownPerTurn` rate on the refund side
   * (issue #22: a flat rate let a Bronze card recoup up to 300 deci/30 PL by
   * turn 6, when cooldown is doctrine'd as a deck-diversity dial, not a power
   * dial, and the marginal turns are NOT equally weakening).
   *
   * DERIVED FROM THE SAME FIGHT-LENGTH DATA `MAX_COOLDOWN_TURNS` ALREADY
   * CITES (the frozen 200-fight regression sweep, mean fight length ≈7.6
   * turns), not felt. A lone card's expected casts over a fight of that
   * length is ≈ meanLength / (cooldownTurns + 1) (`cooldownRemaining`'s own
   * "stride cooldown+1" arithmetic) — so the MARGINAL casts a further
   * cooldown turn removes is itself diminishing:
   *   3->4: 7.6/4 − 7.6/5 = 0.380 casts
   *   4->5: 7.6/5 − 7.6/6 = 0.253 casts
   *   5->6: 7.6/6 − 7.6/7 = 0.181 casts
   *   ratio  0.380 : 0.253 : 0.181  ≈  5 : 3 : 2
   *
   * ANCHORED, NOT RE-GUESSED: the TOTAL refund at the clamp (cd 6) is capped
   * at exactly `cooldownPerTurn` (100 deci) — the SAME "one whole extra cast,
   * ~ a Bronze card's worth of power" value the short side already charges
   * to BUY one more cast. That symmetry is not a coincidence: by cd 6, the
   * earliest possible second cast (turn 1+7=8) no longer fits inside the
   * mean-length fight at all (`MAX_COOLDOWN_TURNS`'s own derivation), i.e.
   * the card has lost one WHOLE cast relative to baseline — worth exactly
   * what buying one costs on the other side of the same table, not a
   * multiple of it.
   *
   * Splitting 100 deci across the 5:3:2 ratio and rounding to whole-PL steps
   * (whole-PL per step is a design invariant, same as every other rate in
   * this table): 50 / 30 / 20 deci for the 1st / 2nd / 3rd extra turn —
   * cumulative 50 -> 80 -> 100 deci (5 -> 8 -> 10 PL) at cooldownTurns 4 / 5
   * / 6, down from the old flat 100 -> 200 -> 300.
   */
  cooldownRefundStepDeci: [50, 30, 20] as readonly number[],

  /** slow: weight * (slowPerWeightNum/Den) — 1 PL per +4 weight. */
  slowPerWeightNum: 5,
  slowPerWeightDen: 2,

  /**
   * burden: weight * (burdenPerWeightNum/Den) — `slow`'s OWN per-point rate,
   * 1 PL per +4 weight, charged for ONE card.
   *
   * THE UNIT IS `slow`, NOT AN INVENTED SCALE: burden owes the same currency
   * (extra weight) as slow, to a board PIECE instead of to the unit's next
   * action. One piece, so one card's worth: slow's 5/2 exactly.
   *
   * NO DEFERRAL DISCOUNT, AND NO DEFERRAL PREMIUM. A burden rides its piece
   * until that piece is next played, with no turn limit, whereas a `slow` is
   * dropped at end of turn whether or not it was ever paid (user-locked
   * 2026-08-18). So a burden is not a probabilistic slow — it is a slow that
   * always eventually gets collected. It lands later, which is worth less; it
   * cannot expire unpaid, which is worth more. We call that a wash rather than
   * pretend to measure it.
   *
   * COVERAGE IS PRICED SEPARATELY, and that is the 2026-08-21 split: this rate
   * buys the tax on the ANCHOR, and a `splash` on the same cast multiplies it by
   * the band floor (`splashBandFloorNum` below). The old single
   * `splash weight N` action charged 5 deci/weight — exactly this rate times
   * that multiplier — so every shipped magnitude kept its price to the deci (see
   * `actionsPriceDeci`, and the migration note on the three cards).
   *
   * CONTROL family (see EFFECT_CAPS_DECI) so it cannot dodge the control cap: a
   * size-1 card can carry at most `burden 40` alone (100 deci = the size-1
   * control ceiling, and all of Bronze), or `burden 20 + splash` once the
   * multiplier applies.
   */
  burdenPerWeightNum: 5,
  burdenPerWeightDen: 2,

  /**
   * splash: the COVERAGE MULTIPLIER on a cast's card-targeting effects
   * (`burden`, `curse`) — `x2`, the band's guaranteed FLOOR.
   *
   * IT IS NOT A PER-POINT RATE, because the spreader has no points: it has no
   * fields at all (see the `splash` docs in types.ts). What it sells is REACH,
   * so what it costs is a multiple of the thing whose reach it changes. The
   * multiplier is applied once, to the summed price of the cast's card-targeting
   * effects, in `actionsPriceDeci` — the same place and the same shape as the AoE
   * reach multiplier (`aoeTargetsNum/Den`), for the same reason: only the pricer
   * can see a whole kit at once.
   *
   * WHY TWO — the geometry's FLOOR, not its maximum (unchanged from the rate
   * this replaces, re-derived 2026-08-19 after the anchor stopped wrapping; see
   * `splashAnchor`, combat/splash.ts). The band runs 1..3 pieces wide: 3 when
   * the anchor has a piece on each side, 2 at either end of the line, 1 on a
   * lone card. Two facts pick the number:
   *   • ANY board holding two or more pieces gives at least 2 — every anchor on
   *     such a board has at least one neighbour. 2 is a guarantee, not an
   *     average, and it needs no assumption about board shape.
   *   • The shape in question is the VICTIM's board, which the card's holder
   *     does not control at all. Pricing the 3-piece case would charge every
   *     holder for coverage the opponent decides — strictly worse than the
   *     holder-independence rule `GEM_CANONICAL_PROPERTY` and AoE breadth
   *     already follow. The third piece is deliberately UNPRICED upside.
   *
   * HONEST LABEL: 2 is CHOSEN, not computed. Real delivered coverage swings with
   * the victim's board (1..3 pieces) and no single number is "the" reach of a
   * spread. 2 is a static anchor at the low end of that range — it under-charges
   * a mid-board anchor and over-charges a lone card, and it errs toward
   * under-charging on purpose, because the swing is the opponent's to decide.
   *
   * ROUNDING: the multiplier floors ONCE over the summed card-targeting total
   * (`actionsPriceDeci`), never per action. On even burden weights that is
   * identical to the old 5-deci-per-weight rate to the deci (`floor(N*5/2)*2 ==
   * N*5`); on an ODD weight the split is 1 deci cheaper (weight 5: 12*2 = 24 vs
   * 25), because the anchor's own price floors first. All shipped magnitudes are
   * even, so nothing moved — and whole-PL authoring still wants even weights
   * anyway.
   */
  splashBandFloorNum: 2,
  splashBandFloorDen: 1,

  /**
   * curse: TWO TERMS, summed —
   *   amount * (cursePerAmountNum/Den)                    the FIRST denial
   *   amount * turns * (cursePerAmountTurnNum/Den)         the REPEATS
   *
   * WHAT IS BEING BOUGHT: the targeted card deals `amount` less damage every
   * time it fires inside a `turns`-turn window. So the price is
   * `amount × (deci per point of denied damage) × (firings inside the window)`,
   * and the only honest question is the last factor.
   *
   * THE CURRENCY IS SETTLED ALREADY: one point of damage denied is worth one
   * point of damage dealt — `flatPowerPerPoint` (5 deci). That is the same rate
   * `negate` is derived from ("a fully cancelled direct hit ~ one Bronze card")
   * and the same one an aura's `damageFlat` charges per covered card
   * (`auraDamageFlat` is 10 = 5 × its 2-neighbour coverage). A curse changes the
   * same number on the same channel (`mods.damageFlat`), one card at a time.
   *
   * FIRINGS, HONESTLY, IN TWO PARTS. A board card can fire at most once per
   * `BASELINE_COOLDOWN + 1` turns (`cooldownRemaining`'s own stride — the same
   * arithmetic `cooldownRefundStepDeci` derives its refunds from), so a
   * `turns`-turn window is worth `turns / (BASELINE_COOLDOWN + 1)` further
   * firings. But the ANCHOR is not a random card: it is the one the victim is
   * about to play, so the FIRST firing is near-certain and a pure
   * `turns/4` model would under-charge a 1-turn curse by ~4x. It is not
   * CERTAIN either — a case-3 anchor is the card just played, which can cool out
   * the entire window (`splashAnchor`) — so the first denial is priced at the
   * CONDITIONAL-TRIGGER DISCOUNT (`conditionalBonusDen`, the ½ `comboBonus`
   * established for "fires about half the time"), not at the full rate.
   *   first  = amount × 5/2   = 2.5 deci/point
   *   repeat = amount × turns × 5/4 = 1.25 deci per point-turn
   *
   * SANITY CHECKS at authorable magnitudes: curse 6 for 2 turns = 15 + 15 = 30
   * deci; curse 8 for 3 = 20 + 30 = 50; curse 20 for 2 = 50 + 50 = 100, i.e. all
   * of Bronze for denying one Bronze damage line's worth of output ~once — which
   * lands just BELOW `stunPerTurn` (100 deci for denying a whole performance,
   * guaranteed), where a curse of that size denies at most one card's damage and
   * only if that card fires. Whole-PL steps land on `amount × turns` multiples
   * of 8 with even amounts (curse 4/2t = 20 deci, curse 8/2t = 40).
   *
   * CONTROL family, so a curse cannot dodge the lockdown ceiling: at those rates
   * a size-1 card can carry `curse 20 for 2 turns` and nothing more (100 deci),
   * and `curse + splash` halves that again through the coverage multiplier.
   *
   * DERIVED, NOT MEASURED — flagged for a `npm run sim` re-tune once curse cards
   * have play data, the same standing caveat `stunPerTurn` and `tauntPerPoint`
   * carry. Both terms err toward OVER-charging (the safe direction): the repeat
   * term assumes every stride yields a firing, which needs the victim to be able
   * to afford the card every time.
   */
  cursePerAmountNum: 5,
  cursePerAmountDen: 2,
  cursePerAmountTurnNum: 5,
  cursePerAmountTurnDen: BASELINE_COOLDOWN + 1,

  /**
   * disrupt: ESCALATING BRACKETED rate (user-locked 2026-07-25 — REPLACES the
   * prior flat 1-PL-per-4 rate). Draining banked readiness is a hard tempo
   * denial with no counterplay window (unlike a debuff or DoT the target can
   * out-race), so large amounts must be disproportionately, not linearly,
   * expensive — the design directive is "only 5-10 is a sane card magnitude,
   * and each further point costs more than the last." Each bracket below
   * prices only the points THAT FALL IN IT (marginal, not average) at a
   * deci-PL rate per point:
   *   points  1-5  : 5 deci/point  (cheap  — half the flat-damage rate)
   *   points  6-10 : 15 deci/point (3x the entry rate)
   *   points 11-15 : 30 deci/point (6x the entry rate)
   *   points  16+  : 60 deci/point (12x the entry rate)
   * Cumulative checkpoints fall on clean whole-PL numbers by design:
   *   5 -> 25 deci (2.5 PL) · 10 -> 100 deci (10 PL, all of Bronze)
   *   15 -> 250 deci (25 PL, all of Diamond) · 16 -> 310 deci (31 PL,
   *   unaffordable at any tier). See `disruptCostDeci`.
   */
  disruptBrackets: [
    { upTo: 5, rateDeci: 5 },
    { upTo: 10, rateDeci: 15 },
    { upTo: 15, rateDeci: 30 },
    { upTo: Infinity, rateDeci: 60 },
  ],

  /** lifesteal: pct * (lifestealPerPctNum/Den) — 1 PL per 15%. */
  lifestealPerPctNum: 2,
  lifestealPerPctDen: 3,

  /** shieldBreak: amount * (shieldBreakPerPointNum/Den) — 1 PL per 8 shattered. */
  shieldBreakPerPointNum: 5,
  shieldBreakPerPointDen: 4,

  /**
   * comboBonus: FLAT bonus damage points × (comboPerPointNum/Den) — 1 PL per
   * 4 points (2.5 deci/pt), a discount off the flat-damage rate
   * (flatPowerPerPoint = 5) BECAUSE the bonus is CONDITIONAL: it only lands
   * when the previous cast shares an archetype with this one, which doesn't
   * fire every turn. Rate derived from an assumed ~50% archetype-match uptime
   * in a typically mixed board (docs/throughput-pl-proposal.md §2.F:
   * 5 × p(0.5) = 2.5) — user-locked 2026-07-23, cut from the old no-discount
   * 5/pt. This establishes the CONDITIONAL-TRIGGER DISCOUNT principle: any
   * future rider that only fires under a gate (board-composition checks,
   * HP-threshold checks, etc.) should price at a fraction of its
   * always-on equivalent, not the full rate.
   */
  comboPerPointNum: 5,
  comboPerPointDen: 2,

  /**
   * exploit / stackBonus / shieldBurst / taxBonus: the CONDITIONAL-TRIGGER
   * DISCOUNT as a DENOMINATOR on
   * the card's own flat-damage rate, rather than a second hand-written per-point
   * number. All four keywords add FLAT bonus damage to the cast's own hit behind a
   * gate (the target carries an affliction / a pile of stacks exists / you are
   * holding plating to spend / their board is carrying weight taxes), so their
   * always-on equivalent is exactly `damage`: `strikeRate` (5 deci/pt typed,
   * 10 for TRUE — a flat bonus bypasses defense on a TRUE card exactly as the
   * card's flat base does, so it must pay the same TRUE premium).
   *
   * `2` REPRODUCES `comboBonus`'s locked rate on a typed card — `5/2` = 2.5
   * deci/pt, the same number `comboPerPointNum/Den` spells — which is the point:
   * this is the SAME principle that ruling established ("any future rider that
   * only fires under a gate should price at a fraction of its always-on
   * equivalent"), expressed so the fraction cannot drift away from the rate it
   * is a fraction OF. It is written as a denominator, not copied as a rate, for
   * the one place the two differ: comboBonus's 2.5 is property-blind, while
   * these four divide the property-aware `strikeRate` and so charge a TRUE card
   * 5 deci/pt.
   *
   * WHAT THE MAGNITUDE IS, per keyword: `exploit.amount` (the flat bonus) and the
   * REQUIRED `cap` on the other three (the ceiling on `per × stacks`, on the
   * plating spent, on `per × taxed cards`). Pricing the CAP is the `statStrike`
   * precedent exactly — the payload is unbounded in a resource the card does not
   * control, so only its hard ceiling is priceable; `cap` is a REQUIRED field on
   * all three, so there is no uncapped form to price at 0.
   *
   * SELF-SYNERGY FORFEITS THE DISCOUNT — see `selfSynergyPremiumDeci`. A card
   * that itself supplies the resource it keys off guarantees its own gate from its
   * second cast onward, so it pays the FULL `strikeRate`; the discount is for a
   * rider that depends on something the card cannot supply.
   *
   * `shieldBurst` pays the same rate even though it also DESTROYS the resource it
   * reads, which makes it the one member the discount over-prices rather than
   * under-prices — the safe direction, and the reason it needs no rate of its own
   * (see its row in `keywords/pricing.ts`).
   */
  conditionalBonusDen: 2,

  /**
   * guard: pct * turns * (guardPerPctTurnNum/Den) deci. Priced at PARITY with
   * the plain stat-buff rate (statPctTurn = 1x) — user-locked 2026-07-19, the
   * old 1.25x premium removed. Throughput rationale
   * (docs/throughput-pl-proposal.md §2.D): guard only pays off on the turns the
   * opponent actually attacks during the window, exactly the same dilution as a
   * stat debuff, so the premium was unjustified.
   *   Showcase: Guard 50% for 2 turns, magical, size 1, no weight override ->
   *   50*2*1 = 100 deci = Bronze exactly.
   */
  guardPerPctTurnNum: 1,
  guardPerPctTurnDen: 1,

  /**
   * expose: pct * turns * (exposePerPctTurnNum/Den) deci. The offensive mirror
   * of guard, priced at the SAME guard-parity rate (1x) — amplifying incoming
   * damage and reducing it are worth the same per pct*turn.
   *   Showcase: Expose 50% for 2 turns -> 50*2*1 = 100 deci = Bronze exactly.
   */
  exposePerPctTurnNum: 1,
  exposePerPctTurnDen: 1,

  /**
   * taunt: amount * tauntPerPoint deci (balance-designer pass, 2026-08-18 —
   * closes the last KNOWN SILENT ZERO: `taunt` had an interpreter
   * implementation and no rate at all, `price: []`, so no card or gem could
   * ever be authored with it honestly).
   *
   * NEAREST PRICED COMPARABLE, not a fresh anchor: `taunt` raises the
   * caster's own `aggro` by a flat integer, PERMANENTLY (never turn-
   * decremented, never consumed) — self-only, one numeric field, empower-
   * family. That is EXACTLY the shape `thorns` already prices (self-only,
   * permanent-until-consumed, one numeric field, empower-family;
   * `dotPerStack` = 10 deci/point) — the two closest keywords in the whole
   * table by structure. `taunt` is if anything the STRONGER of the pair (a
   * thorns pile depletes as it is triggered; an aggro point never does), so
   * pricing at PARITY with thorns rather than at a discount is the
   * conservative direction.
   *
   * WHY NOT A PRECISE THROUGHPUT DERIVATION: taunt's actual battlefield
   * value is a THRESHOLD effect, not a linear one — every unit's `baseAggro`
   * defaults to 0 (`combat/state.ts`), so the FIRST point of taunt already
   * wins undivided targeting priority under the default `aggro` policy; every
   * point beyond that only matters as a tie-breaker against a competing
   * taunter, and no shipped content (enemy or hero) casts `taunt` today to
   * measure that against. A precise per-point number would be fictitious
   * precision; the honest move is the nearest-comparable rate stated above,
   * left open for a real `npm run sim` re-tune once a taunting enemy exists —
   * the same "moderated, pending data" stance `stunPerTurn`'s own comment
   * already takes.
   *   Showcase: taunt 2 = 20 deci = Common exactly (2/4/6/8 all land clean).
   */
  tauntPerPoint: 10,

  /**
   * negate: charges * negatePerCharge deci. A charge cancels a FULL direct
   * hit of the matching property (~ a whole Bronze card's worth of prevented
   * output), so it's priced as a flat per-charge chunk. User-locked
   * 2026-07-19: raised from 50 to 100 (throughput rationale
   * docs/throughput-pl-proposal.md §2.C — a fully cancelled direct hit ~ one
   * Bronze card).
   *   1 charge = 100 deci (= Bronze exactly).
   *   2 charges = 200 deci · 3 charges (apply-time clamp max) = 300 deci.
   */
  negatePerCharge: 100,

  /**
   * ward: charges * wardPerCharge deci. DERIVED FROM `negatePerCharge`, not
   * chosen. A ward charge cancels one whole affliction APPLICATION before it
   * lands — the structural mirror of a negate charge, which cancels one whole
   * direct hit ("~ one Bronze card's worth of prevented output", above).
   *
   * The difference is HOW MUCH OF A CARD each denies. A negate charge blanks a
   * card's whole damage line; a ward charge denies ONE EFFECT of a card, because
   * afflictions are overwhelmingly authored as RIDERS — cards routinely carry a
   * hit plus a rider, so half a card = 50 deci.
   *
   * WHAT A CHARGE ACTUALLY COVERS (state it, don't infer it): a charge denies
   * one application of a WARDABLE affliction, and that set is exactly
   *   poison · burn · bleed · debuffStat · expose
   * — `isWardable` in combat/interpreter.ts, which is `isCleansable` minus
   * `stun`. STUN IS OUT OF SCOPE (user-locked 2026-08-17): ward is an ailment
   * shield for the grind-you-down family, not a lockdown answer.
   *
   * PRICED AGAINST THAT SET, not by analogy: every application of a covered kind
   * on the shipped bronze book (n=20), priced through this same table, has a
   * median of EXACTLY 50 deci — so a charge costs what the thing it denies costs.
   * Per kind: poison 50, burn 50, bleed 50 (medians); debuffStat 55 and expose 80
   * sit slightly above, being the two kinds authored at the widest magnitudes.
   * Removing stun did NOT move this: stun is priced at 100 (stunPerTurn), the one
   * affliction above a charge's price, and dropping the single shipped 100 from
   * the pool leaves the median at 50 either way. So the narrowed remit did not
   * make 50 stale — it removed the only kind a charge was UNDERPAYING for.
   *
   * That also lands ward exactly between the two existing removal keywords, which
   * is the second check that the number is honest:
   *   cleanse 25 < ward 50 < negate 100
   * strictly ABOVE cleanse (which strips an affliction only AFTER it has already
   * ticked, so it recovers part of the damage — ward denies every tick), and
   * strictly BELOW negate (a whole card vs one of its effects).
   *
   * GRANULARITY: 50 deci makes the whole-PL step exactly ONE charge (1/2/3
   * charges = 50/100/150 deci), so every charge count is authorable and the
   * scaffold solver can reach any budget — unlike `cleanse`, whose 25 deci/charge
   * step of 2 charges made odd totals unreachable. The apply-time clamp
   * (`MAX_WARD_CHARGES` = 3) caps a holder at 150 deci of ward, which the
   * `empower` family cap (100/150/200 by size) bounds further on a card.
   */
  wardPerCharge: 50,

  /** aura (per point, on the projecting card): |damageFlat| * auraDamageFlat,
   * |healFlat| * auraHealFlat, |weightDelta| * auraWeightDelta — ALL THREE
   * priced by MAGNITUDE (2026-08-17: closes a fail-open hole — damageFlat/
   * healFlat used to price SIGNED while weightDelta alone was `Math.abs`'d in
   * the same expression). An aura never affects its own host
   * (`resolveAuras`'s `if (source === piece) continue`, combat/auras.ts) —
   * only OTHER board cards — so a negative mod authored on a card is NEVER a
   * cost that card's own kit pays; pricing it signed let a card buy down its
   * own budget with a "downside" its own numbers never realize. Both
   * directions of changing a neighbour (buff or debuff) are an equally real
   * board effect, so both cost the same per point — the policy
   * `auraWeightDelta` already used alone. See `auraModsDeci`, the one shared
   * function every aura/card-scope-gem price now reads.
   * allBoard reach doubles the total.
   * FLAT damage/heal auras cost 2× a card's own one-shot flat damage (5/pt):
   * empirically (2026-07-23 audit, 500 seeds × all enemies) an adjacent aura's
   * best case covers 2 casting neighbors, so 10 deci/pt makes that placement
   * exactly PL-fair vs a same-budget damage card (edge placement stays worse —
   * placement remains a real decision). The old 20 deci/pt (4×) overpriced
   * auras 2-4× because the aura card also burns its own cast turn every
   * rotation. War Banner +10 = 100 = Bronze. */
  auraDamageFlat: 10,
  auraHealFlat: 10,
  auraWeightDelta: 20,

  /**
   * Multi-hit premium: each damage INSTANCE beyond the first on one card pays
   * this flat surcharge (30 deci = 3 PL). See `HIT_KINDS` for what counts.
   *
   * RATIONALE CORRECTED 2026-08-07 — the number is unchanged, the reason it
   * exists is not. It USED to read "every hit re-delivers the caster's full
   * stat add unpriced, so a second hit ships roughly ATK − DEF extra damage for
   * free". That is no longer true: the MULTI-HIT STAT SPLIT (same day) makes a
   * cast's stat contribution hit-count-invariant, so a second hit ships NO
   * extra stat at all. What it does ship is a second INSTANCE, and instances
   * are a resource:
   *  • `negate` cancels ONE hit per charge — a 2-instance cast burns two
   *    charges, or burns one and lands the second, where a 1-instance cast of
   *    the same total damage is simply blanked;
   *  • per-instance defenses added later (dodge/evade) inherit that exactly;
   *  • flat `mods.damageFlat` (board auras, card-scope stat gems) applies PER
   *    HIT, so a multi-hit card is the best host for one — conditional upside,
   *    not a strict downside.
   * Against the counterweight — each instance eats mitigation again, so a
   * split cast loses `(hits − 1) × DEF` versus one big hit — multi-hit is now
   * CONDITIONAL rather than weak: worse into armor stacks, better into
   * negate/charge defenses and flat-damage buffs. 30 deci prices that
   * conditionality. Re-derive with sim data once more multi-hit cards exist.
   */
  extraHitPremium: 30,

  /**
   * AoE REACH — `scope: 'all'` fans every OFFENSIVE effect on a card out over
   * EVERY living foe (`combat/interpreter.ts`'s `resolveTargets`: "AoE: all
   * living foes, ascending index"), so it must be priced against how many foes
   * a fight actually has — CLOSES A VERIFIED SILENT ZERO (2026-08-17):
   * `powerLevelDeci` never read `skill.scope` before this, so an AoE card
   * priced identically to a single-target one while delivering up to
   * `MAX_FOES` (5, `src/game/demoState.ts`) times the value.
   *
   * NOT priced at 5x (`MAX_FOES`) — that's a sandbox ceiling nothing in real
   * play produces every fight — and not at 1x (the silent zero this closes).
   * Priced as ONE flat, HOST-BLIND multiplier on the OFFENSIVE portion of a
   * kit, same precedent as `GEM_CANONICAL_PROPERTY`: a card can only have one
   * PL, so the rate cannot depend on whether it ends up on the hero's board
   * (facing the enemy pack distribution below) or an enemy's (facing the
   * hero, always exactly 1 — packs are an enemy-side-only mechanic, see
   * `src/run/encounter.ts`); it must be the SAME assumption either way.
   *
   * DERIVED FROM THE GAME'S OWN PACK-FREQUENCY CONSTANTS
   * (`src/run/encounter.ts`, `src/run/runState.ts`), not a guess. Every
   * 5-fight cadence block is 2 normal + 2 elite + 1 boss (`BOSS_EVERY` = 5,
   * `fightSpecFor`); boss nodes never roll a pack (`rollEncounter`'s
   * `gateOpen` — always exactly 1 foe). Of the remaining 4-in-5 (non-boss)
   * fights, `PACK_VARIANT_WEIGHTS` rolls solo/pair/trio at 70/20/10. The
   * STEADY-STATE (asymptotic — see the caveat below) expected foe count:
   *
   *   boss:      1/5 * 1                          = 0.20
   *   non-boss:  4/5 * (0.70*1 + 0.20*2 + 0.10*3)  = 4/5 * 1.4 = 1.12
   *   total                                          = 1.32  =  33/25
   *
   * 1.32 is a CEILING on the honest number, not the number itself, so pricing
   * exactly here errs on the side of NOT under-pricing (never the direction
   * that re-opens the silent zero this closes): a pack roll that can't afford
   * even level 1 of its taxed budget (`resolvePackMemberLevel`) silently
   * falls back to solo, and that floor is a LEVEL GATE most of a run sits
   * below, not a rare edge case — measured directly against the shipped
   * curve, a pair only becomes affordable at monster level 9 (elite) / 17
   * (normal), and a trio not until level 31 (elite) / 39 (normal); `level`
   * tracks fight number 1:1 (`fightSpecFor`), so real play skews meaningfully
   * more solo than 1.32 implies. Quantifying exactly how much more would mean
   * assuming a typical run's length — precisely the winrate-shaped tuning
   * input CLAUDE.md's "PL is the balance unit, not winrate" rule forbids — so
   * 1.32 stands as the honest, reproducible anchor built only from the game's
   * own already-declared dials, deliberately on the safe side of the true
   * average.
   *
   * Applies to the OFFENSIVE portion of a kit only (`OFFENSIVE_KINDS` below —
   * damage/DoT/control, the kinds `resolveTargets` fans out; support riders
   * stay self-targeted regardless of scope and are unaffected) — see
   * `actionsPriceDeci`. Because `capViolations` prices its per-family spend
   * through that SAME function, the multiplier grows a card's CAP-FAMILY
   * spend in lockstep with its budget spend — an AoE buff or DoT cannot use
   * `scope: 'all'` to sneak more effective PL past its family cap than a
   * single-target card of the same authored magnitude would.
   */
  aoeTargetsNum: 33,
  aoeTargetsDen: 25,

  /**
   * ECHO REPEAT — deci-PL for a FULL repeat of the host card's whole attack
   * (`statStrike` + `echoHostPower`, `shareOf: 1`). An echo's payload is a unit
   * fraction of that, so its rate is `echoRepeatDeci / shareOf`.
   *
   * DERIVED, NOT CHOSEN (gem ruleset v1 §6, 2026-08-09). 100 deci is not a new
   * anchor: it is THE anchor this table already uses twice, both user-locked
   * 2026-07-19, for "one whole cast's worth of output" —
   *   • `negatePerCharge` 100: a charge CANCELS a full direct hit (~one Bronze
   *     card's worth of prevented output);
   *   • `stunPerTurn` 100: a stun DENIES a whole guaranteed performance.
   * A full repeat is the exact mirror of what a negate charge denies — one more
   * whole hit — so it takes the same number, and `shareOf` divides it because
   * the payload is a literal `1/shareOf` of that hit. The resulting ladder
   * (with `extraHitPremium` for the instance itself) is:
   *   shareOf 1 → 100 + 30 = 130 (above every rarity band — unbuyable)
   *   shareOf 2 →  50 + 30 =  80 = Legendary EXACTLY
   *   shareOf 3 →  33 + 30 =  63 · shareOf 4 → 25 + 30 = 55 (no band)
   * Exactly one echo strength is priceable, and it is Legendary.
   *
   * READ THIS BEFORE USING IT AS A NUMBER: this rate is a HOST-BLIND STAND-IN,
   * and it is wrong in both directions on purpose. What an echo actually
   * delivers is proportional to a host the rate cannot see — half of
   * `sword_slash`'s base is 5 PL of damage, half of `crushing_blow`'s is 24 PL —
   * so no fixed number is honest ACCOUNTING. It is honest CLASSIFICATION: it
   * answers "is this a Legendary-shaped effect?" for `isGemOnBudget` and for a
   * shop price, the two surfaces that have no host. Wherever the host IS visible
   * (`instancePowerLevelDeci`) the stand-in is replaced by the measured
   * host-proportional term — see `echoHostShareDeci`.
   *
   * A CAPPED echo never uses this rate: a cap bounds the payload absolutely, so
   * `actionsPriceDeci` prices it exactly, like a flat damage action of that cap.
   */
  echoRepeatDeci: 100,

  /**
   * Hero-scope gem stat mods: flat integer points folded into base
   * `CombatantStats` for the whole run (permanent, every card, every turn) —
   * see "Gem pricing" in docs/power-level-reference.md for the anchoring
   * rationale per stat.
   *
   * `attack`/`magicPower` re-priced 8 -> 10 (balance-designer pass,
   * 2026-07-25 — see docs/power-level-reference.md "Hero-scope vs card-scope
   * stat pricing"): a hero-scope point adds flat damage/shield to EVERY
   * matching-property card on the board, every cast, for the whole fight —
   * strictly MORE reach than a card-scope stat gem's `auraDamageFlat`/
   * `auraHealFlat` rate (10/pt), which is pinned to exactly one host card.
   * Pricing hero-scope BELOW card-scope (the old 8) was backwards: the
   * broader-reaching effect can never be honestly cheaper than the
   * single-card one. 10/pt is the floor-parity fix (hero-scope now costs at
   * least as much per point as a guaranteed one-card buff); it's still a
   * bargain in any deck with 2+ matching-property cards, which is the
   * expected case, so this remains a conservative correction, not a punitive
   * one. `armor`/`magicResist` already priced at 10 (unaffected — this pass
   * brings attack/magicPower up to meet them, so all four core combat stats
   * now share one rate); `speed` is a distinct tempo stat, left at its own
   * anchor.
   */
  heroStatPerPoint: {
    attack: 10,
    magicPower: 10,
    armor: 10,
    magicResist: 10,
    speed: 5,
  } as Record<BuffableStat, number>,
} as const;

/**
 * Extra kit budget (deci) granted for a card's board size at its tier —
 * Bronze anchor scaled by half the tier-budget growth.
 */
/**
 * Total damage of a HALVING burn pile: ticks 2×stacks, then stacks halve
 * (floored) — burn 8 → 16+8+4+2 = 30. Integer loop, no floats.
 */
export function burnTotalDamage(stacks: number): number {
  let total = 0;
  for (let s = Math.max(0, Math.floor(stacks)); s > 0; s = Math.floor(s / 2)) total += 2 * s;
  return total;
}

/**
 * Escalating bracketed disrupt price (deci-PL) for a given amount of drained
 * banked readiness — see PRICE.disruptBrackets for the rate table and
 * rationale. Marginal pricing: only the points that fall inside a bracket pay
 * that bracket's rate, matching the style of a progressive tax bracket.
 * Integer-only (amount is always a whole readiness point).
 */
/**
 * The keyword pricing table, built once from `PRICE`. Every rate still lives in
 * `PRICE` (pinned by the drift-lock test); this is the per-keyword SHAPE of how
 * those rates apply.
 */
export const KEYWORD_PRICING = buildKeywordPricing(PRICE);

/** Kinds whose family membership is derived from the table, never hand-listed. */
function kindsWhere(pred: (k: Action['kind']) => boolean): ReadonlySet<Action['kind']> {
  return new Set((Object.keys(KEYWORD_PRICING) as Action['kind'][]).filter(pred));
}
function kindsInFamily(family: CapFamily): ReadonlySet<Action['kind']> {
  return kindsWhere((k) => KEYWORD_PRICING[k].family === family);
}

export function disruptCostDeci(amount: number): number {
  return walkBrackets(amount, PRICE.disruptBrackets);
}

export function sizeGrantDeci(size: number, tier: SkillTier): number {
  const budget = TIER_BUDGET_DECI[tier];
  const anchor = size === 2 ? PRICE.sizeGrant2Bronze : size === 3 ? PRICE.sizeGrant3Bronze : 0;
  // floored to WHOLE PL (10 deci) — grants never introduce fractional PL
  return Math.floor((anchor * (budget + 100)) / 2000) * 10;
}

/**
 * Ceiling on `cooldownTurns`, for BOTH pricing (`cooldownDeviationDeci`
 * below) and authoring (`capViolations`) — mirrors how `WEIGHT_MAX_BY_SIZE`
 * bounds `speedWeight` in both places. Closes a fail-open hole (2026-08-17):
 * `(BASELINE_COOLDOWN − cooldownTurns) * PRICE.cooldownPerTurn` is UNBOUNDED
 * on the long side, so an absurd cooldown (16, 99, ...) refunded hundreds of
 * deci for casts a card was never going to get anyway.
 *
 * DERIVED, not felt. `cooldownRemaining` (combat/castSelect.ts) states the
 * cadence explicitly: "cast on turn T → eligible at T+cooldown+1", i.e. the
 * minimum gap between two casts of the same card is `cooldownTurns + 1`
 * turns. The MEDIAN fight length across the frozen 200-fight regression
 * sweep (`tests/engine/fixtures/outcomeBaseline.json`, attrition ON — the
 * mode real play always runs under; generator in
 * `tests/engine/helpers/sweepConfigs.ts`) is 7 turns (mean ≈7.6; p75 10, p95
 * 15, p99 17, max 19 — see the balance-designer's verification notes for the
 * full percentile table). A card cast at the earliest possible turn (1) —
 * the BEST case for a second cast — only lands a second cast within a
 * TYPICAL (median-length) fight if `cooldownTurns + 1 <= 6`, i.e.
 * `cooldownTurns <= 5`: at `cooldownTurns = 6` the earliest possible second
 * cast (turn 1+7 = 8) already falls outside a 7-turn fight. Every piece
 * always gets its FIRST cast regardless of cooldown
 * (`cooldownRemaining` returns 0 for a never-cast piece), so a typical
 * fight's realized cast count is already at its floor of exactly 1 once
 * `cooldownTurns` reaches 6 — lengthening the cooldown further cannot remove
 * a cast that was never going to happen in a typical fight anyway, so
 * pricing more refund for it is fictitious.
 *
 * (`ATTRITION_START_TURN` = 15 is the OUTER design ceiling on fight length —
 * the point the game's own stalemate-breaker starts ramping true damage —
 * and is comfortably above this clamp, so the clamp binds well before that
 * backstop would ever need to; it is the corroborating fact, not the anchor,
 * because it bounds the tail of the distribution, not the typical case this
 * rate has to be honest for.)
 */
export const MAX_COOLDOWN_TURNS = 6;

/**
 * THE ONE PLACE cooldown-deviation deci-PL is computed. Shared by
 * `powerLevelDeci`/`powerLevelBreakdown` below and `autoScaleTier` in
 * cards.ts — closes the THIRD MIRROR of this bug: `autoScaleTier` used to
 * hand-roll `(BASELINE_COOLDOWN − cooldown) * PRICE.cooldownPerTurn` a
 * second time, unclamped, so clamping only `powerLevelDeci` would have left
 * the auto-scaler still spending the unbounded refund. A single function
 * both callers read means a future clamp change (or a future caller) can
 * never drift from this one again.
 *
 * Deviation is measured from `BASELINE_COOLDOWN`, clamped at
 * `MAX_COOLDOWN_TURNS` on the long (refund) side — see its doc comment for
 * the full derivation. The short side (a shorter-than-baseline cooldown,
 * which COSTS PL) is left unclamped, at the flat `cooldownPerTurn` rate: it
 * is self-limiting (no gem rarity budget, and no card tier budget, can
 * afford even −1 turn at this rate), so there is no fictitious value to
 * bound there.
 *
 * THE LONG SIDE IS NOW A DIMINISHING WALK, not a flat rate (balance-designer
 * pass, 2026-08-19 — see `PRICE.cooldownRefundStepDeci` for the full
 * derivation): each turn beyond baseline refunds strictly less than the one
 * before it, read off that step table rather than multiplied by a constant.
 */
export function cooldownDeviationDeci(cooldownTurns: number | undefined): number {
  const raw = cooldownTurns ?? BASELINE_COOLDOWN;
  if (raw <= BASELINE_COOLDOWN) return (BASELINE_COOLDOWN - raw) * PRICE.cooldownPerTurn;
  const cooldown = Math.min(raw, MAX_COOLDOWN_TURNS);
  let refund = 0;
  for (let i = 0; i < cooldown - BASELINE_COOLDOWN; i += 1) refund += PRICE.cooldownRefundStepDeci[i] ?? 0;
  return -refund;
}

/**
 * The three aura / card-scope-gem stat mods, priced by MAGNITUDE — `Math.abs`
 * on every term, not just `weightDelta` (closes a fail-open hole, 2026-08-17:
 * this expression used to price `damageFlat`/`healFlat` SIGNED while wrapping
 * only `weightDelta` in `Math.abs`). An aura never affects its own host
 * (`resolveAuras`'s `if (source === piece) continue`, combat/auras.ts) — it
 * only ever lands on OTHER board cards — so a negative mod authored on a card
 * is never a real cost that card's own kit pays; pricing it signed let a card
 * buy down its own budget with a "downside" its own numbers never realize.
 * Both directions of changing a neighbour (buff or debuff) are an equally
 * real, board-shaping effect, so both cost the same per point — the policy
 * `auraWeightDelta` already used alone; this makes all three consistent.
 *
 * ONE SHARED FUNCTION — used by a card's own `aura` block (`powerLevelDeci`/
 * `powerLevelBreakdown` below), a card-scope stat gem (`gemPowerLevelDeci`),
 * and `autoScaleTier`'s `auraCost` in cards.ts, which used to hand-roll this
 * exact expression a THIRD time. `reach` (aura-only; a stat gem has none) is
 * left to the caller, matching how each caller already applies it.
 */
export function auraModsDeci(mods: { damageFlat?: number; healFlat?: number; weightDelta?: number }): number {
  return (
    Math.abs(mods.damageFlat ?? 0) * PRICE.auraDamageFlat +
    Math.abs(mods.healFlat ?? 0) * PRICE.auraHealFlat +
    Math.abs(mods.weightDelta ?? 0) * PRICE.auraWeightDelta
  );
}

/**
 * Pure pricing switch over a bare Action[] against a given `property`. This
 * is the per-unit rate table applied without any card-level context (size,
 * weight, aura, TRUE premium) — `powerLevelDeci` layers those on top for a
 * full `SkillDef`; `gemPowerLevelDeci` uses this directly for effect gems
 * (always at the default `scope: 'one'` — a gem is priced host-blind, and
 * whether its appended action ends up on an AoE host is exactly the kind of
 * host-dependent fact `GEM_CANONICAL_PROPERTY`'s precedent says a gem's own
 * PL must not read; see that constant's doc comment).
 *
 * `scope` (default `'one'`) applies `PRICE.aoeTargetsNum/Den` to the OFFENSIVE
 * share of the total when `'all'` — see that constant for the full derivation.
 * Only kinds marked `offensive` in `keywords/pricing.ts` (`OFFENSIVE_KINDS`)
 * pay it: those are exactly the kinds `combat/interpreter.ts`'s
 * `resolveTargets` fans out over every living foe under `scope: 'all'`;
 * support kinds (heal/shield/buffStat/cleanse/taunt/lifesteal/comboBonus/
 * thorns/guard/negate/ward) always resolve once, on the caster, and are
 * charged at their ordinary rate regardless of `scope`. The multi-hit premium
 * (`PRICE.extraHitPremium`) is itself an offensive cost — an extra damage
 * INSTANCE delivered to every foe an AoE reaches, not just one — so it pays
 * the same multiplier. The whole offensive share is summed FIRST and floored
 * ONCE (matching the aura `reach` pattern, `powerLevelDeci` below): flooring
 * each action's share independently could total a different number than this
 * single floor, which would break `powerLevelBreakdown`'s "parts sum exactly"
 * invariant — see its own `aoe reach` part for how it stays exact.
 */
/**
 * The status one action APPLIES, and to WHOM — the lookup behind
 * `selfSynergyPremiumDeci`. `null` for every action that applies no status.
 *
 * Mirrors the apply-time arms of `applyAction` (combat/interpreter.ts): the DoTs
 * and the control/debuff keywords land on the VICTIM, `thorns` lands on the
 * CASTER (it is a self buff). The names are the STATUS kinds
 * (`StatusInstance['kind']`), which is why `debuffStat` maps to `'debuff'`.
 *
 * EXPORTED because `resourceSuppliedBy` (and through it the RIDER ORDERING RULE
 * in `validateSkillContent.ts`) is built on the same lookup. One definition, so
 * the price and the authoring rule can never disagree about which keyword
 * applies what.
 */
export function statusAppliedBy(action: Action): { status: string; on: 'caster' | 'target' } | null {
  switch (action.kind) {
    case 'poison': return { status: 'poison', on: 'target' };
    case 'burn': return { status: 'burn', on: 'target' };
    case 'bleed': return { status: 'bleed', on: 'target' };
    case 'stun': return { status: 'stun', on: 'target' };
    case 'debuffStat': return { status: 'debuff', on: 'target' };
    case 'expose': return { status: 'expose', on: 'target' };
    case 'thorns': return { status: 'thorns', on: 'caster' };
    default: return null;
  }
}

/**
 * WHAT A CONDITIONAL RIDER READS — the RESOURCE name, WHOSE it is, and the most
 * the rider can ever pay out. `null` for every action that is not a rider.
 *
 * "RESOURCE" is the generalisation of "status" (2026-08-21, second rider pass):
 * the family now reads three different kinds of thing — an affliction pile
 * (`exploit`, `stackBonus`), the caster's own PLATING (`shieldBurst`) and the
 * victim's TEMPO BACKLOG (`taxBonus`) — but every one of them is "some quantity
 * that is ALREADY THERE, gating a bounded flat add". Naming the read as a
 * (resource, side) pair is what lets ONE ordering rule and ONE self-synergy rule
 * cover all four keywords instead of four special cases. The names are the status
 * kinds where a status is what is read, plus two that cannot collide with a
 * status kind: `'shield'` and `'tax'`.
 *
 * `magnitude` is the field the keyword is PRICED on — `exploit.amount`, and the
 * required `cap` for the other three — so a caller can compute the full-rate
 * price without re-deriving which field matters.
 */
export function riderReadsResource(
  action: Action,
): { resource: string; on: 'caster' | 'target'; magnitude: number } | null {
  switch (action.kind) {
    case 'exploit': return { resource: action.status, on: 'target', magnitude: action.amount };
    case 'stackBonus': return { resource: action.status, on: action.of, magnitude: action.cap };
    // The one CASTER-side, RESOURCE-CONSUMING member: it reads (and spends) the
    // caster's own shield pools.
    case 'shieldBurst': return { resource: 'shield', on: 'caster', magnitude: action.cap };
    case 'taxBonus': return { resource: 'tax', on: 'target', magnitude: action.cap };
    default: return null;
  }
}

/**
 * THE SUPPLY SIDE of the same question: what resource does this action PUT THERE,
 * and on whom. `null` when it supplies nothing a rider can read.
 *
 * Statuses come from `statusAppliedBy` (one definition, see above); the two
 * non-status resources are spelled here:
 *  • `shield` on the CASTER — `shield` is the only keyword that adds plating
 *    (`applyAction`'s `shield` arm; a heal is not plating);
 *  • `tax` on the TARGET — BOTH `slow` (unit scope) and `burden` (card scope),
 *    because `taxedCardCount` counts both and a rider cannot tell which keyword
 *    put the weight there. (`splash` supplies nothing: it only widens a
 *    `burden`'s reach, and the burden is what a rider reads.)
 */
export function resourceSuppliedBy(action: Action): { resource: string; on: 'caster' | 'target' } | null {
  const status = statusAppliedBy(action);
  if (status) return { resource: status.status, on: status.on };
  switch (action.kind) {
    case 'shield': return { resource: 'shield', on: 'caster' };
    case 'slow':
    case 'burden':
      return { resource: 'tax', on: 'target' };
    default: return null;
  }
}

/**
 * SELF-SYNERGY PREMIUM — the deci-PL a conditional rider (`exploit`,
 * `stackBonus`, `shieldBurst`, `taxBonus`) owes ON TOP of its table price when the
 * SAME KIT supplies the resource it keys off.
 *
 * WHY IT EXISTS. All four keywords price at the CONDITIONAL-TRIGGER DISCOUNT (half
 * the flat-damage rate, `PRICE.conditionalBonusDen`), and that discount buys one
 * specific thing: the gate depends on something the card CANNOT GUARANTEE (a
 * teammate's poison, another card's bleed, the shield another card of yours
 * granted, the burden somebody else landed). A card that supplies the
 * resource it reads guarantees its own gate from its SECOND cast onward — the
 * ordering ruling (user-locked 2026-08-21) costs it exactly the first cast and
 * nothing after — so the discount is no longer describing it. It pays the full
 * always-on rate instead: `strikeRate`, the same rate the card's own `damage` line
 * pays, TRUE premium included.
 *
 * THE FOUR RESOURCES ARE NOT EQUALLY SELF-SUPPLIABLE, and the rule is
 * deliberately blind to the difference (see CONSERVATIVE below): a `shield` line
 * feeds a `shieldBurst` from the next cast onward as reliably as a poison feeds an
 * exploit (plating persists), a `burden` feeds a `taxBonus` until the taxed piece
 * is played, but a `slow` expires at END OF TURN — so a slow+reaper card only
 * collects when it gets a SECOND cast inside the same turn. Charging all three the
 * same premium over-prices the slow case and never under-prices any of them.
 *
 * CONSERVATIVE ON PURPOSE. The honest uptime of a self-synergy rider is
 * `(casts − 1) / casts`, which on the frozen sweep's median 7-turn fight with a
 * baseline cooldown is ~1/2 and only approaches 1 in long fights — i.e. the
 * TRUE value sits BETWEEN the discounted and the full rate. Charging the full
 * rate can therefore only ever OVER-price the effect, never under-price it,
 * which is the only safe direction for a rate a designer will build content
 * against (same stance `PRICE.aoeTargetsNum/Den` takes with its 1.32 ceiling).
 * A measured rate for the middle ground is balance-designer's to set; this is
 * the two-state form the engine can decide STATICALLY, from the kit alone.
 *
 * STATICALLY DECIDABLE is the whole reason it can be priced at all: whether a
 * kit supplies the resource its own rider reads is a fact about the authored
 * effect list, visible to the pricer with no simulation and no host knowledge.
 * A rider never counts as supplying ITSELF, and the SIDE must match — a
 * `stackBonus` with `of: 'caster'` is only self-supplied by a CASTER-side
 * application (`thorns`), never by the poison it puts on the enemy, and by the
 * same token a `shieldBurst` is fed by the caster's own `shield` line while a
 * `taxBonus` is fed by a `slow`/`burden` aimed at the target.
 *
 * Returns 0 for every other action, so the whole rule is inert on the ~110-card
 * catalog that predates it.
 */
export function selfSynergyPremiumDeci(action: Action, kit: readonly Action[], property: Property): number {
  const reads = riderReadsResource(action);
  if (!reads) return 0;
  let supplied = false;
  for (let i = 0; i < kit.length; i += 1) {
    const other = kit[i]!;
    if (other === action) continue; // a rider can never supply its own gate
    const applied = resourceSuppliedBy(other);
    if (applied && applied.resource === reads.resource && applied.on === reads.on) {
      supplied = true;
      break;
    }
  }
  if (!supplied) return 0;
  // FORFEIT THE DISCOUNT: pay `full − discounted`, where `discounted` is exactly
  // what `priceActionDeci` charged through the table (floored the same way), so
  // the two always add up to the full rate with no rounding drift.
  const rate = scalableRateDeci('damage', property, KEYWORD_PRICING);
  const full = Math.max(0, reads.magnitude) * rate;
  return full - Math.floor(full / PRICE.conditionalBonusDen);
}

export function actionsPriceDeci(
  actions: readonly Action[],
  property: Property,
  scope: 'one' | 'all' = 'one',
  /**
   * The WHOLE kit the priced actions belong to, for the one rule that cannot be
   * decided from a single action: the SELF-SYNERGY premium
   * (`selfSynergyPremiumDeci`), which asks whether the card also SUPPLIES the
   * resource its `exploit`/`stackBonus`/`shieldBurst`/`taxBonus` rider reads.
   *
   * Defaults to `actions`, so every existing call site is unchanged. It is
   * passed explicitly by the two callers that price a SUBSET of a kit and would
   * otherwise silently lose the premium: `capViolations` (which filters to one
   * cap family — the poison that arms the rider is not an empower kind) and
   * `powerLevelBreakdown` (which prices one action at a time, and whose parts
   * must sum EXACTLY to `powerLevelDeci`). A gem is priced host-blind, so its
   * own action list is the correct kit there — a gem cannot see the poison on
   * the card it will be socketed into.
   */
  kit: readonly Action[] = actions,
): number {
  let selfDeci = 0;
  let foeDeci = 0;
  // THE CARD-TARGETING SLICE, kept separate only until the spread multiplier is
  // applied to it (see `spreads` below), then folded into `foeDeci` with the rest
  // of the offensive share. Every card-targeting kind is offensive, so nothing
  // else about the buckets changes.
  let cardTargetDeci = 0;
  // Multi-hit premium: damage INSTANCES beyond the first pay a flat surcharge
  // for being separately-blocked hits (see PRICE.extraHitPremium) — offensive,
  // see the doc comment above.
  const hits = actions.filter((a) => HIT_KINDS.has(a.kind)).length;
  if (hits > 1) foeDeci += (hits - 1) * PRICE.extraHitPremium;
  // THE SPREADER (`splash`, payload-less): it prices as a COVERAGE MULTIPLIER on
  // the card-targeting effects it widens, not per field of its own — see
  // `PRICE.splashBandFloorNum`. Asked of THE LIST BEING PRICED, exactly like
  // `hits` above: `capViolations` and `powerLevelBreakdown` hand this function
  // subsets, and a subset that omits the splash must price un-multiplied (the
  // breakdown then reports the whole multiplier as one telescoping delta part,
  // the same trick it uses for `aoe reach`).
  const spreads = actions.some((a) => a.kind === 'splash');
  // DATA-DRIVEN: every per-keyword rate lives in `keywords/pricing.ts`, so a
  // new keyword is a row there rather than a `case` here.
  for (const action of actions) {
    // The table rate plus the ONE kit-aware term (0 for every kind but the four
    // conditional riders, and 0 for those unless the kit supplies their
    // gate). Added to the SAME action's price rather than summed separately so
    // it lands in the right offensive/self bucket, pays the AoE multiplier with
    // the rest of the offensive share, and telescopes exactly through
    // `powerLevelBreakdown`'s per-action parts.
    const price = priceActionDeci(action, property, KEYWORD_PRICING)
      + selfSynergyPremiumDeci(action, kit, property);
    if (CARD_TARGETING_KINDS.has(action.kind)) cardTargetDeci += price;
    else if (OFFENSIVE_KINDS.has(action.kind)) foeDeci += price;
    else selfDeci += price;
  }
  // FLOORED ONCE, over the whole card-targeting total — never per action, so two
  // burdens on one card cannot round differently from one of twice the weight.
  if (spreads) {
    cardTargetDeci = Math.floor((cardTargetDeci * PRICE.splashBandFloorNum) / PRICE.splashBandFloorDen);
  }
  foeDeci += cardTargetDeci;
  // The AoE multiplier then applies to the spread total as well, which is
  // unreachable in practice and deliberately left that way: an AUTHORED
  // `scope: 'all'` + splash card is refused by `validateSkillContent` and a GEM
  // splash is dropped on a multi-target host (THE SPLASH GATE), so this
  // composition prices a shape no content can have — loudly, rather than at a
  // silent zero.
  if (scope === 'all') foeDeci = Math.floor((foeDeci * PRICE.aoeTargetsNum) / PRICE.aoeTargetsDen);
  return selfDeci + foeDeci;
}

/** Total deci-PL of a card's kit. */
export function powerLevelDeci(skill: SkillDef): number {
  let deci = actionsPriceDeci(skill.effects, skill.property, skill.scope);

  if (skill.aura) {
    const reach = skill.aura.affects === 'allBoard' ? 2 : 1;
    deci += auraModsDeci(skill.aura.mods) * reach;
  }

  // Weight: lighter than baseline costs, heavier refunds (slower attacks).
  const baseline = skill.size * 10;
  deci += (baseline - weightOf(skill)) * PRICE.weightPer;

  // Size grant (scales with the card's own tier budget).
  deci -= sizeGrantDeci(skill.size, skill.tier);

  // Cooldown: shorter than baseline costs, longer than baseline refunds,
  // CLAMPED past MAX_COOLDOWN_TURNS (see `cooldownDeviationDeci`). Baseline
  // cards (cooldownTurns omitted) price at exactly +0.
  deci += cooldownDeviationDeci(skill.cooldownTurns);

  return deci;
}

export interface PlBreakdownPart {
  label: string;
  deci: number;
}

/**
 * THE SPREADER, as a value — used by `powerLevelBreakdown` to price a
 * card-targeting line together with the coverage multiplier it is actually
 * delivered with. Payload-less by definition, so one shared literal is the whole
 * keyword; frozen because it is handed to a pricer that must not mutate it.
 */
const SPREADER: Action = Object.freeze({ kind: 'splash' });

/**
 * Itemized deci-PL breakdown of a card's kit — the same math as
 * powerLevelDeci, split into labeled parts for balance inspection UIs.
 * Invariant (tested): the parts sum exactly to powerLevelDeci(skill).
 */
export function powerLevelBreakdown(skill: SkillDef): PlBreakdownPart[] {
  const parts: PlBreakdownPart[] = [];
  const push = (label: string, deci: number): void => {
    if (deci !== 0) parts.push({ label, deci });
  };

  // Does this card carry the `splash` SPREADER? A card-targeting line's price
  // INCLUDES the coverage multiplier when it does — see the loop below.
  const spreadsBand = skill.effects.some((a) => a.kind === 'splash');
  for (const action of skill.effects) {
    // `skill.effects` as the KIT (not the single-action default): the
    // self-synergy premium is a property of the whole kit, and pricing one
    // action blind to its siblings would report a smaller part than
    // `powerLevelDeci` charges — breaking the "parts sum exactly" invariant.
    //
    // A CARD-TARGETING LINE IS PRICED WITH THE SPREADER, not beside it. `splash`
    // has no price of its own (it multiplies its siblings' coverage), so the
    // honest unit of reporting is "burden 6 across the band = 30", not "burden
    // 15" plus a floating "spread 15". Two reasons it matters beyond taste:
    //  • WHOLE-PL PARTS. Rates are whole-PL per clean unit and every reported
    //    part must land on one (a user-locked authoring invariant, pinned in
    //    tests/engine/balance.test.ts). Half of a spread burden is 1.5 PL; the
    //    delivered line is 3.
    //  • It is what the designer actually chooses. Nobody authors a spread
    //    without its payload — the validator refuses it — so the two are one
    //    decision and one price.
    // The `splash` action itself then prices at 0 and `push` drops it.
    const priced = spreadsBand && CARD_TARGETING_KINDS.has(action.kind)
      ? [action, SPREADER]
      : [action];
    const label = priced.length > 1 ? `${action.kind} + splash` : action.kind;
    push(label, actionsPriceDeci(priced, skill.property, 'one', skill.effects));
  }
  // Multi-hit premium is count-based, so single-action pricing above misses
  // it — surface it as its own labeled part (keeps parts summing exactly).
  const extraHits = skill.effects.filter((a) => HIT_KINDS.has(a.kind)).length - 1;
  if (extraHits > 0) push('multi-hit', extraHits * PRICE.extraHitPremium);

  // AoE REACH delta (see PRICE.aoeTargetsNum/Den and `actionsPriceDeci`'s doc
  // comment): that function floors the multiplier ONCE across the whole
  // offensive total, so flooring each action's/multi-hit's share separately
  // above could sum to a different number — reported here as the exact
  // DELTA the multiplier adds, the same telescoping trick `multi-hit` above
  // already uses (raw parts + this delta = the scoped total, exactly).
  if (skill.scope === 'all') {
    const raw = actionsPriceDeci(skill.effects, skill.property, 'one');
    const scoped = actionsPriceDeci(skill.effects, skill.property, 'all');
    push('aoe reach', scoped - raw);
  }

  if (skill.aura) {
    const reach = skill.aura.affects === 'allBoard' ? 2 : 1;
    push('aura', auraModsDeci(skill.aura.mods) * reach);
  }

  const baseline = skill.size * 10;
  push('weight', (baseline - weightOf(skill)) * PRICE.weightPer);
  push('size', -sizeGrantDeci(skill.size, skill.tier));
  push('cooldown', cooldownDeviationDeci(skill.cooldownTurns));

  return parts;
}

/** Display power level with one-decimal precision (e.g. 10 or 9.5). */
export function powerLevel(skill: SkillDef): number {
  return powerLevelDeci(skill) / 10;
}

/** Whether the card's kit matches its tier budget within tolerance. */
export function isOnBudget(skill: SkillDef): boolean {
  return Math.abs(powerLevelDeci(skill) - TIER_BUDGET_DECI[skill.tier]) <= BUDGET_TOLERANCE_DECI;
}

/**
 * EFFECT INVESTMENT CAPS (user-locked 2026-07-20) — the design contract for
 * authoring cards. Tier budgets and size grants multiply a card's kit PL (a
 * Diamond size-3 kit is ~91 PL); without caps that budget could legally buy
 * chain-stun lockdown or triple-stacked DoT bombs. Each effect FAMILY has a
 * per-size ceiling on the PL a single card may invest in it (deci, by card
 * size 1/2/3). Control/buffs grow +5 PL per extra slot; DoTs double that.
 * Independent of TIER — tiers scale raw power (damage/shield/heal points and
 * DoT stacks via the price ladder), never lockdown — WITH ONE NAMED EXCEPTION:
 * `cleanse` (user-locked 2026-08-17, see `TIER_SCALED_FAMILIES` below) is
 * self-repair, the mirror of a heal, and heals already scale freely with
 * tier; it gets its own `cleanse` family below rather than living inside
 * `empower` so the "lockdown never scales" rule stays intact for every other
 * empower member (negate/ward/buffStat/guard/lifesteal/comboBonus/thorns).
 * Extra rules: stun is hard-capped at 1 performance per card; auras are
 * exempt (passive board identity, priced per reach). `applyTier` never scales
 * control/empower magnitudes, so rank-ups can't break a compliant base card.
 * Every card in the book is tested against `capViolations` — when designing
 * a card, run `npm test` and the audit names any rule it breaks.
 */
export const EFFECT_CAPS_DECI = {
  /** stun, slow, burden, curse, splash's spread, disrupt, stat-down, expose,
   * shieldBreak — one whole discrete effect. `splash` has no price of its own,
   * but the coverage multiplier it puts on a burden/curse IS counted here, so a
   * spread cannot buy reach past the control ceiling either. */
  control: { 1: 100, 2: 150, 3: 200 } as Record<number, number>,
  /** poison + burn + bleed combined (deci = stacks × 10 at 1 PL/stack) */
  dot: { 1: 200, 2: 300, 3: 400 } as Record<number, number>,
  /** stat-up, guard, negate, ward, lifesteal, combo, thorns — one whole discrete
   * effect. NOT cleanse (user-locked 2026-08-17) — see the `cleanse` family. */
  empower: { 1: 100, 2: 150, 3: 200 } as Record<number, number>,
  /**
   * SPLIT OUT of `empower` (user-locked 2026-08-17): "PL is calculated and the
   * tiers are just based on size and amount of PL a card has" / "if the PL
   * amount is increased then you can add more" — a bigger tier budget spent
   * on more cleanse charges must be legal, the same way it already is for a
   * heal. Bronze anchor is identical to empower's own (100/150/200 by size);
   * the tier scaling itself lives in `TIER_SCALED_FAMILIES`. Splitting the
   * family (rather than tier-scaling `empower` wholesale) is what keeps
   * negate/ward/buffStat/guard/lifesteal/comboBonus/thorns FROZEN, per the
   * user's explicit carve-out (stun's 1-turn lock, named alongside this
   * ruling, is untouched).
   */
  cleanse: { 1: 100, 2: 150, 3: 200 } as Record<number, number>,
  /** flat damage (incl. TRUE) — DIAMOND-tier ceiling (30/70/125 PL), one flat cap
   * for every tier (user-locked 2026-07-23): a card just can't exceed what a
   * Diamond card of its size could carry. Loose guardrail, not a diversify-forcer. */
  damage: { 1: 300, 2: 700, 3: 1250 } as Record<number, number>,
  /** flat shield (incl. TRUE) — Diamond-tier ceiling, flat across tiers */
  shield: { 1: 300, 2: 700, 3: 1250 } as Record<number, number>,
  /** flat heal (incl. TRUE) — Diamond-tier ceiling, flat across tiers */
  heal: { 1: 300, 2: 700, 3: 1250 } as Record<number, number>,
} as const;
export const MAX_STUN_PER_CARD = 1;

/** Weight bounds (user-locked 2026-07-23): a card can't be faster than WEIGHT_MIN
 * or slower than the per-size max. Native weight units, not PL. */
export const WEIGHT_MIN = 5;
export const WEIGHT_MAX_BY_SIZE: Record<number, number> = { 1: 20, 2: 30, 3: 40 };
/** A card can occupy at most this many board slots. */
export const MAX_CARD_SIZE = 3;

/**
 * Apply-time clamp ceilings for `expose`/`guard` — the SINGLE source of truth
 * `validateSkillContent.ts` imports, so a shipped card can never be priced for
 * amplification the engine will never deliver (closes the same shape of hole
 * `MAX_WARD_CHARGES`/`MAX_NEGATE_CHARGES` already close for charge counts).
 * MIRRORS combat/interpreter.ts's own clamps exactly — `Math.min(50,
 * action.pct)` in the `expose` arm, `Math.min(60, action.pct)` in the `guard`
 * arm — duplicated here as DATA rather than imported, the same layering
 * tradeoff `OFFENSIVE_KINDS` already accepts (balance.ts sits upstream of the
 * combat loop; importing the interpreter back would close a cycle). If either
 * clamp in interpreter.ts ever moves, this constant must move with it.
 */
export const MAX_EXPOSE_PCT = 50;
export const MAX_GUARD_PCT = 60;

/**
 * Every family's cap was FROZEN across tiers (user-locked 2026-07-23): a
 * single stat can never exceed its fixed per-size cap no matter the tier, so
 * ranking a card up buys NEW EFFECTS, not bigger numbers. (Was: damage/shield/
 * heal scaled ×1.5/2/2.5 — removed.) A card that can't absorb its tier budget
 * within the caps diversifies into other lines — the documented authoring
 * pattern, and what the tier scaler enforces.
 *
 * ONE FAMILY NOW SCALES (user-locked 2026-08-17): `cleanse`. The user's
 * ruling — tier is a PL budget, and spending a bigger budget on more of the
 * same self-repair ability must be legal, exactly as it already is for a
 * heal — is a deliberate, named carve-out, not a reversal of the 2026-07-23
 * rule for anything else. Every OTHER cap family (control, dot, empower,
 * damage, shield, heal) stays frozen; `negate`/`ward`/`stun`/etc. do not move.
 * `effectCapDeci` grows a member of this set with `TIER_BUDGET_DECI[tier]`
 * exactly like a tier budget itself (base × budget / 100), so cleanse's cap
 * lands on 100/150/200/250 deci at Bronze/Silver/Gold/Diamond — the same
 * ladder the tier budgets themselves use.
 */
const TIER_SCALED_FAMILIES: ReadonlySet<keyof typeof EFFECT_CAPS_DECI> = new Set(['cleanse']);

/**
 * DAMAGE INSTANCES — the kinds that produce a separately-resolved hit. Instance
 * COUNT is a resource in its own right, not a damage footnote: each instance is
 * mitigated, shielded and NEGATED on its own, so a 2-instance cast burns two
 * `negate` charges (or burns one and lands the second) where a 1-instance cast
 * is simply blanked. That is what `PRICE.extraHitPremium` charges for; any
 * future per-instance defense (dodge/evade) inherits the same interaction.
 */
export const HIT_KINDS: ReadonlySet<Action['kind']> = kindsWhere((k) => KEYWORD_PRICING[k].isHit);

/**
 * Kinds that resolve against FOES rather than the caster — the kinds
 * `combat/interpreter.ts`'s `resolveTargets` fans out over every living foe
 * under `scope: 'all'` (mirrors `isOffensiveAction` there exactly; see the
 * `offensive` field's doc comment in `keywords/pricing.ts` for why this is
 * duplicated data rather than an import). Only these pay the AoE reach
 * multiplier in `actionsPriceDeci` (`PRICE.aoeTargetsNum/Den`) — support kinds
 * always resolve once, on the caster, regardless of scope.
 */
export const OFFENSIVE_KINDS: ReadonlySet<Action['kind']> = kindsWhere((k) => KEYWORD_PRICING[k].offensive);

/**
 * CARD-TARGETING kinds — the ones that land on one of the VICTIM'S BOARD CARDS
 * (`burden`, `curse`) rather than on the victim as a unit, and therefore the
 * exact set the `splash` SPREADER widens and the exact set its coverage
 * multiplier is applied to (`actionsPriceDeci`, `PRICE.splashBandFloorNum`).
 *
 * Read from the keyword table's own `cardTargeting` facet, so the pricer, the
 * content validator (which refuses a splash with nothing to spread) and the gem
 * gate (`splashSuppressionOn`, cards.ts) all ask ONE source. The engine-side
 * geometry that consumes the same decision is `cardTargetPieces`
 * (combat/splash.ts).
 */
export const CARD_TARGETING_KINDS: ReadonlySet<Action['kind']> = kindsWhere((k) => KEYWORD_PRICING[k].cardTargeting);

export const CONTROL_KINDS: ReadonlySet<Action['kind']> = kindsInFamily('control');
export const DOT_KINDS: ReadonlySet<Action['kind']> = kindsInFamily('dot');
export const EMPOWER_KINDS: ReadonlySet<Action['kind']> = kindsInFamily('empower');
/** Its own cap family (user-locked 2026-08-17) — split out of `empower` so cleanse
 * alone can tier-scale without dragging negate/ward/etc. along. See `TIER_SCALED_FAMILIES`. */
export const CLEANSE_KINDS: ReadonlySet<Action['kind']> = kindsInFamily('cleanse');
/** damage/heal/shield — the EXACT sink solved to hit budget by the tier scaler. */
export const SCALABLE_KINDS: ReadonlySet<Action['kind']> = kindsWhere((k) => KEYWORD_PRICING[k].scalable);

/**
 * A family's per-size cap (sizes outside 1-3 clamp to the nearest row).
 * Flat families (damage/shield/heal) scale with the card's tier; the rest
 * ignore `tier`.
 */
export function effectCapDeci(family: keyof typeof EFFECT_CAPS_DECI, size: number, tier: SkillTier = 'bronze'): number {
  const base = EFFECT_CAPS_DECI[family][Math.min(3, Math.max(1, size))]!;
  return TIER_SCALED_FAMILIES.has(family) ? Math.floor((base * TIER_BUDGET_DECI[tier]) / 100) : base;
}

/** Cap violations for a card's kit; empty = compliant. Audited for every card. */
export function capViolations(skill: SkillDef): string[] {
  const violations: string[] = [];
  const spent = (kinds: ReadonlySet<Action['kind']>): number =>
    // The full kit is passed as the pricing CONTEXT even though only one
    // family's actions are priced: an `exploit`/`stackBonus` rider's
    // self-synergy premium (`selfSynergyPremiumDeci`) depends on an action of a
    // DIFFERENT family (the poison/thorns line that arms it), so a filtered
    // list alone would charge the discounted rate here and the full rate in
    // `powerLevelDeci` — a cap check quietly softer than the budget check.
    actionsPriceDeci(skill.effects.filter((a) => kinds.has(a.kind)), skill.property, skill.scope, skill.effects);
  const check = (family: keyof typeof EFFECT_CAPS_DECI, kinds: ReadonlySet<Action['kind']>): void => {
    const deci = spent(kinds);
    const cap = effectCapDeci(family, skill.size, skill.tier);
    if (deci > cap) violations.push(`${family} ${deci / 10} PL exceeds the size-${skill.size} ${skill.tier} cap (${cap / 10} PL)`);
  };
  check('control', CONTROL_KINDS);
  check('dot', DOT_KINDS);
  check('empower', EMPOWER_KINDS);
  check('cleanse', CLEANSE_KINDS);
  check('damage', HIT_KINDS);
  check('shield', new Set(['shield']));
  check('heal', new Set(['heal']));
  const stunTurns = skill.effects.reduce((sum, a) => sum + (a.kind === 'stun' ? a.turns : 0), 0);
  if (stunTurns > MAX_STUN_PER_CARD) {
    violations.push(`stun ${stunTurns} exceeds the ${MAX_STUN_PER_CARD}-performance cap`);
  }
  // Weight + size bounds (native units, not PL).
  if (skill.size > MAX_CARD_SIZE) {
    violations.push(`size ${skill.size} exceeds the max of ${MAX_CARD_SIZE}`);
  }
  const wt = weightOf(skill);
  const wtMax = WEIGHT_MAX_BY_SIZE[Math.min(MAX_CARD_SIZE, skill.size)]!;
  if (wt < WEIGHT_MIN) violations.push(`weight ${wt} is below the minimum ${WEIGHT_MIN}`);
  if (wt > wtMax) violations.push(`weight ${wt} exceeds the size-${skill.size} max ${wtMax}`);
  // Cooldown bound (native turns, not PL) — named at authoring time rather
  // than showing up only as a mysterious budget/pricing miss. See
  // `MAX_COOLDOWN_TURNS`'s doc comment for the derivation.
  const cooldown = skill.cooldownTurns ?? BASELINE_COOLDOWN;
  if (cooldown > MAX_COOLDOWN_TURNS) {
    violations.push(`cooldownTurns ${cooldown} exceeds the max of ${MAX_COOLDOWN_TURNS}`);
  }
  return violations;
}

/**
 * Rarity -> PL band (deci-PL) a gem's OWN price should land on. Gems add
 * UNCAPPED bonus PL on top of a card's base kit; rarity fixes how much bonus
 * a given gem is worth, not a budget the base-card audit ever sees.
 *   Common 2 PL (20 deci) · Rare 4 PL (40) · Epic 6 PL (60) · Legendary 8 PL (80).
 */
export const RARITY_PL_DECI: Record<Rarity, number> = {
  common: 20,
  rare: 40,
  epic: 60,
  legendary: 80,
};

/**
 * Canonical property used to price EFFECT gems, independent of whichever
 * card they end up socketed into: `physical`. Effect-gem actions in practice
 * are riders (poison/disrupt/lifesteal/buffStat/etc.) whose price doesn't
 * depend on property; the one case that DOES read `property` is a raw
 * `damage`/`heal`/`shield` action, which would otherwise price differently
 * (flat-power vs flat-TRUE) depending on the host's property and break the
 * "gem PL is fixed, not host-dependent" rule. `physical` is picked over `true`
 * for this specifically: it prices those actions at the ordinary
 * `flatPowerPerPoint` rate rather than the cheaper flat-TRUE one, and the TRUE
 * premium (a card-level, casting-property charge) never applies to gems at all
 * — `actionsPriceDeci` doesn't add it.
 */
export const GEM_CANONICAL_PROPERTY: Property = 'physical';

/**
 * The deci-PL an ECHO (`statStrike` + `echoHostPower`) actually contributes on a
 * KNOWN host — the honest, measured counterpart to the host-blind
 * `PRICE.echoRepeatDeci` stand-in (gem ruleset v1 §6, 2026-08-09).
 *
 * An echo re-delivers `share(hostBase + stat)`. Its two terms are priced the way
 * the rest of this table prices those same two things on any card:
 *  • the echoed FLAT BASE is a share of the host's OWN `damage` power, so it is
 *    charged at the host's own flat-damage rate — `flatPowerPerPoint`, plus
 *    `truePremiumPerPoint` on a TRUE host, exactly as the host's own base is;
 *  • the echoed STAT term is charged at NOTHING, for the same reason a card's
 *    own stat add is unpriced everywhere in this file ("the caster's Attack /
 *    Magic Power is added on top at cast time, universal and unpriced" —
 *    `flatPowerPerPoint`). `PRICE.extraHitPremium`, charged separately by
 *    `gemPowerLevelDeci`, is what pays for the extra INSTANCE that carries it.
 * So the rule reads: an echo costs exactly the fraction of the host's damage
 * line it repeats, at the book's own rate. `sword_slash` (base 20, physical) →
 * 10 echoed points × 5 = 50 deci; `crushing_blow` (base 96) → 48 × 5 = 240;
 * `annihilation_strike` (base 48, TRUE) → 24 × 10 = 240; a host with no damage
 * action of its own → 0, because the echo degrades to a plain (unpriceable,
 * 0-priced) stat strike there.
 *
 * `hostBase` mirrors `ownDamagePower` in combat/interpreter.ts EXACTLY — the
 * host's own `damage` actions, `fromGem` ones excluded, so a socket can never
 * price itself. The share mirrors `statShare(points, { index: 0, count })`,
 * whose front-loaded remainder makes index 0 exactly `ceil(points / count)` for
 * any non-negative integer. Both are re-derived here as three lines rather than
 * imported: `balance.ts` is upstream of the combat loop (state.ts imports it),
 * and importing the interpreter back would close an import cycle. A test asserts
 * the two agree.
 */
export function echoHostShareDeci(host: SkillDef, shareOf: number): number {
  const count = Math.max(1, Math.floor(shareOf));
  let points = 0;
  for (const action of host.effects) {
    if (action.kind === 'damage' && !action.fromGem) points += action.power;
  }
  const echoed = Math.ceil(points / count);
  return echoed * (PRICE.flatPowerPerPoint + (host.property === 'true' ? PRICE.truePremiumPerPoint : 0));
}

/** An uncapped ECHO action, i.e. one that must be priced by the echo rules. */
function isUncappedEcho(action: Action): boolean {
  return action.kind === 'statStrike' && action.echoHostPower === true && action.cap === undefined;
}

/**
 * Total deci-PL of a single gem.
 *
 * HOST-BLIND by default (see `GEM_CANONICAL_PROPERTY` for the effect-gem case):
 * this is the gem's OWN PL, the number `isGemOnBudget` checks against its rarity
 * band and `src/run/shop.ts` turns into a gold price. It is NOT part of the
 * base-card budget audit.
 *
 * `host` (optional) is the card the gem is socketed INTO. Passing it changes
 * exactly one thing — an uncapped ECHO's proportional payload, which is
 * unknowable without the host, swaps its host-blind stand-in
 * (`PRICE.echoRepeatDeci / shareOf`) for the measured `echoHostShareDeci`. Every
 * other price in here is host-invariant by construction, so passing a host to a
 * gem without an echo returns the identical number. `instancePowerLevelDeci` is
 * the caller that has a host; the band check and the shop, which have none by
 * necessity, do not.
 */
export function gemPowerLevelDeci(gem: Gem, host?: SkillDef): number {
  if (gem.kind === 'effect') {
    // A cooldown-reduction rider prices at the SAME rate as a card's own
    // cooldownTurns deviation (PRICE.cooldownPerTurn per turn shaved) — a
    // gem that shortens the host's cooldown by N turns is worth exactly what
    // a card baked with that same N-turn-shorter cooldown would cost.
    //
    // `weightIncreasePct` (the tempo COST of a scaling payload) prices at 0 —
    // no refund. `PRICE.weightPer` is per weight POINT, and a percentage of a
    // host this function cannot see is not a number of points; charging the
    // best case (the lightest legal card, `WEIGHT_MIN` 5) would refund almost
    // nothing anyway. Zero can only ever OVER-price the gem, which is the safe
    // direction. A percentage refund rate is balance-designer's to set. (It
    // would be small either way: at +25% the refund is 0.5 PL on the lightest
    // card in the book and 3.5 PL on the heaviest, against payloads of 8 and 29
    // PL respectively — the tempo cost cannot bring a proportional gem onto a
    // rarity band, it can only make it fair BETWEEN hosts.)
    //
    let deci = actionsPriceDeci(gem.actions, GEM_CANONICAL_PROPERTY) + (gem.cooldownReduction ?? 0) * PRICE.cooldownPerTurn;

    // THE FIRST HIT'S PREMIUM (gem ruleset v1 §5, 2026-08-09 — closes the hole
    // this comment used to merely describe). `actionsPriceDeci` charges
    // `extraHitPremium` only from the SECOND hit in the list it is handed,
    // because on a CARD the first hit is that card's one instance and pays
    // nothing extra. A GEM's list is its own, so its first hit slipped through —
    // yet socketed, EVERY hit a gem appends is an ADDITIONAL instance on the
    // host: separately mitigated, separately negated, separately dodged by any
    // future per-instance defense. Adding one premium here makes the total
    // exactly `hits × extraHitPremium`, i.e. "once per hit action,
    // unconditionally".
    //
    // Deliberately HOST-BLIND and therefore only ever OVER-priced (the safe
    // direction): on a host that already hits twice the gem's hit is the third
    // instance and worth no less, and on a host with no hit at all it is the
    // first — but a gem is priced for the socket it could take, not the best one.
    const hits = gem.actions.filter((a) => HIT_KINDS.has(a.kind)).length;
    if (hits > 0) deci += PRICE.extraHitPremium;

    // THE ECHO's PROPORTIONAL PAYLOAD (gem ruleset v1 §6). Uncapped, it prices
    // at 0 through `actionsPriceDeci` — correctly, since that table has no host
    // and no honest fixed rate. Here it gets one of the two: the measured
    // host term when a host was supplied, else the `PRICE.echoRepeatDeci`
    // stand-in that lets the rarity band classify it. See both doc comments.
    for (const action of gem.actions) {
      if (!isUncappedEcho(action) || action.kind !== 'statStrike') continue;
      const shareOf = Math.max(1, Math.floor(action.shareOf));
      deci += host ? echoHostShareDeci(host, shareOf) : Math.floor(PRICE.echoRepeatDeci / shareOf);
    }
    return deci;
  }

  // Stat gem.
  if (gem.scope === 'card') {
    const card = gem.mods.card;
    if (!card) return 0;
    return auraModsDeci(card);
  }

  // Hero scope.
  const hero = gem.mods.hero;
  if (!hero) return 0;
  let deci = 0;
  for (const stat of Object.keys(PRICE.heroStatPerPoint) as BuffableStat[]) {
    const v = hero[stat];
    if (v === undefined) continue;
    deci += v * PRICE.heroStatPerPoint[stat];
  }
  return deci;
}

/** Display power level with one-decimal precision, e.g. 6 or 4.5. */
export function gemPowerLevel(gem: Gem): number {
  return gemPowerLevelDeci(gem) / 10;
}

/**
 * Whether a gem's own PL sits within its rarity's band (±0.5 PL) — the gem
 * analog of `isOnBudget`. NOTE: the audit test that iterates a real gem
 * catalog belongs to content-designer once that catalog exists; this is
 * just the checking primitive.
 */
export function isGemOnBudget(gem: Gem): boolean {
  return Math.abs(gemPowerLevelDeci(gem) - RARITY_PL_DECI[gem.rarity]) <= BUDGET_TOLERANCE_DECI;
}

/**
 * Whether a HOST would suppress an appended gem `splash` action — re-derives
 * `spliceGemActions`'s THE SPLASH GATE (`src/engine/cards.ts`) rather than
 * importing it: cards.ts sits DOWNSTREAM of balance.ts (it imports
 * `powerLevelDeci`/`gemPowerLevelDeci`/`PRICE` from here), so importing the
 * gate back would close the same layering cycle `echoHostShareDeci` already
 * declines to close for `ownDamagePower` — same tradeoff, same fix. A
 * regression test (`tests/engine/splash.test.ts`) pins this copy against
 * `splashSuppressionOn` in cards.ts so the two can never drift.
 *
 * All THREE gate arms, exactly as `splashSuppressionOn` states them: (a) a host
 * that already resolves against more than one unit, (b) a host that already
 * carries its own (non-gem) splash, and (c) NOTHING TO SPREAD — neither the host
 * nor the gem supplies a card-targeting effect for the spreader to widen.
 *
 * Arm (c) is why this takes the gem's actions: a `burden + splash` gem supplies
 * its own payload, so it must NOT be suppressed on a plain damage host (the
 * shipped rungs are exactly that shape).
 */
function hostSuppressesSplash(host: SkillDef, gemActions: readonly Action[]): boolean {
  if (isMultiTargetSkill(host)) return true;
  for (const action of host.effects) {
    if (action.kind === 'splash' && !action.fromGem) return true;
  }
  const hasPayload = (actions: readonly Action[]): boolean => {
    for (let i = 0; i < actions.length; i += 1) {
      if (CARD_TARGETING_KINDS.has(actions[i]!.kind)) return true;
    }
    return false;
  };
  return !hasPayload(host.effects) && !hasPayload(gemActions);
}

/**
 * Display/run-power readout for a socketed piece: base card PL (audited,
 * tier-budgeted) plus the gem's own uncapped bonus PL. Never fed back into
 * `isOnBudget` — the base-tier audit must stay gem-blind.
 *
 * This is the one gem-PL surface that KNOWS the host, so it is the one that gets
 * the honest number for a host-proportional payload: `def` is handed to
 * `gemPowerLevelDeci`, which swaps an uncapped echo's host-blind stand-in for
 * its measured contribution on THIS card (gem ruleset v1 §6, 2026-08-09). Every
 * other gem shape is host-invariant, so nothing else moves.
 *
 * `def` is the card's AUTHORED definition, matching this function's existing
 * contract — callers pass `skillBook[piece.skillId]`, not a tier-resolved or
 * gem-resolved skill. A piece's `tier` therefore does not scale the echo term
 * here, exactly as it does not scale `powerLevelDeci(def)` here.
 *
 * THE SPLASH GATE, PRICED (balance-designer pass, 2026-08-19 — closes a
 * flagged loose end from the splash-gem pass): `spliceGemActions` drops a
 * gem's `splash` action at cast-resolution time when THE SPLASH GATE fires
 * (host already multi-target, host already splashes, or nothing to spread) — it
 * never fires on that host, so it must contribute ZERO instance PL there, not
 * its full uncapped price. Filters `gem.actions` down to what the gate would
 * actually keep (dropping every splash when suppressed, or every splash past the
 * gem's own first when it isn't — the same "keep only the first" rule
 * `spliceGemActions` applies) before pricing the rest of the gem normally;
 * every other gem shape is untouched, so nothing else moves.
 *
 * UNDER THE SPREADER MODEL THIS IS SHARPER, NOT WEAKER: dropping the splash from
 * the priced list also drops the COVERAGE MULTIPLIER it would have put on the
 * gem's own `burden`/`curse` (`actionsPriceDeci`), so a suppressed
 * `burden + splash` gem prices at its bare anchor-only burden — exactly what it
 * still delivers on that host — instead of at the doubled band price.
 */
export function instancePowerLevelDeci(def: SkillDef, piece: { gem?: Gem | null }): number {
  const gem = piece.gem;
  if (!gem) return powerLevelDeci(def);
  if (gem.kind !== 'effect' || !gem.actions.some((a) => a.kind === 'splash')) {
    return powerLevelDeci(def) + gemPowerLevelDeci(gem, def);
  }
  const suppressed = hostSuppressesSplash(def, gem.actions);
  let splashSeen = false;
  const actions = gem.actions.filter((action) => {
    if (action.kind !== 'splash') return true;
    if (suppressed || splashSeen) return false;
    splashSeen = true;
    return true;
  });
  return powerLevelDeci(def) + gemPowerLevelDeci({ ...gem, actions }, def);
}
