import type { Action, Property } from '../types';

/**
 * KEYWORD PRICING — the price facet of the keyword document, as DATA.
 *
 * Every effect keyword declares its price as a list of terms that are SUMMED.
 * `actionsPriceDeci` in `balance.ts` walks this table instead of a switch, so
 * adding a keyword is a row here, not a new `case` in the pricer.
 *
 * Six term forms cover every keyword in the game:
 *   perUnit           rate per unit of one field           (dot stacks, charges)
 *   perUnitByProperty rate varies with the card's property (the TRUE premium)
 *   product           rate per (fieldA x fieldB)           (pct x turns)
 *   bracketed         marginal brackets                    (disrupt)
 *   flat              one field-less price per action      (splash)
 *   none              explicitly unpriced, with a reason
 *
 * RATES ARE INJECTED, never duplicated here: `buildKeywordPricing(PRICE)` is
 * called once from `balance.ts`. `PRICE` stays the single source of every
 * number and stays pinned by the drift-lock test in
 * `tests/engine/balance.test.ts`.
 */

/**
 * The NUMERIC field names of one Action variant. Non-numeric members
 * (`kind`, `property`, `stat`, `fromGem`, `echoHostPower`) are excluded, so a
 * term can only ever point at something priceable.
 */
type NumericKeys<T> = { [K in keyof T]-?: NonNullable<T[K]> extends number ? K : never }[keyof T];
export type FieldOf<K extends Action['kind']> = NumericKeys<Extract<Action, { kind: K }>> & string;

/**
 * A price term is parameterised by the keyword it belongs to, so `field` is
 * checked against that Action variant's own numeric keys at COMPILE time.
 * Without this a typo (`'trns'` for `'turns'`) compiles clean and silently
 * prices the keyword at 0 — the exact silent-zero failure this table exists to
 * make impossible.
 */
export type PriceTerm<K extends Action['kind'] = Action['kind']> =
  | { form: 'perUnit'; field: FieldOf<K>; num: number; den: number }
  | { form: 'perUnitByProperty'; field: FieldOf<K>; num: Record<Property, number>; den: number }
  | { form: 'product'; fields: readonly [FieldOf<K>, FieldOf<K>]; num: number; den: number }
  | { form: 'bracketed'; field: FieldOf<K>; brackets: readonly { upTo: number; rateDeci: number }[] }
  // A FIELD-LESS flat price — for the one keyword with no numeric field at all
  // (`splash`, whose whole payload is "the spread happens"). Kept rare on
  // purpose: a keyword WITH a magnitude must price per unit of it, or a bigger
  // magnitude would be free past the first.
  | { form: 'flat'; deci: number };

/** Cap family a keyword's spend counts against (`EFFECT_CAPS_DECI`). `cleanse`
 * is its own family (user-locked 2026-08-17), split out of `empower` so it
 * alone can tier-scale — see `TIER_SCALED_FAMILIES` in balance.ts. */
export type CapFamily = 'control' | 'dot' | 'empower' | 'cleanse' | 'damage' | 'shield' | 'heal';

interface KeywordPricingBase {
  /** Counts as a damage INSTANCE for the multi-hit premium. */
  isHit: boolean;
  /**
   * Grows via `autoScaleTier`'s exact-sink solve. Historically only
   * damage/heal/shield (the `perUnitByProperty` sinks); `cleanse` joined
   * (user-locked 2026-08-17) as the one `perUnit` keyword that also scales —
   * see `scalableRateDeci` for how the sink solver reads its rate.
   */
  scalable: boolean;
  family: CapFamily | null;
  /**
   * Whether this keyword resolves against FOES rather than the caster —
   * MIRRORS `isOffensiveAction` in `combat/interpreter.ts` EXACTLY (duplicated
   * here as DATA rather than imported: `balance.ts` sits upstream of the
   * combat loop — `combat/state.ts` imports it — so importing the interpreter
   * back would close a layering cycle; same tradeoff `echoHostShareDeci`
   * already accepts for `ownDamagePower`, with the same fix — a regression
   * test pins the two lists together). Only `true` keywords fan out over
   * EVERY living foe under `scope: 'all'` (`resolveTargets`), so only they pay
   * the AoE reach multiplier (`PRICE.aoeTargetsNum/Den`, applied in
   * `actionsPriceDeci`) — support keywords (heal/shield/buffStat/cleanse/
   * taunt/lifesteal/comboBonus/thorns/guard/negate/ward) always resolve once,
   * on the caster, regardless of scope, and are unaffected by it.
   */
  offensive: boolean;
  /**
   * Does this keyword resolve against ONE OF THE VICTIM'S BOARD CARDS rather
   * than against the victim as a unit? `burden` and `curse` do; everything else
   * (including `slow`, their unit-scope sibling) does not.
   *
   * ONE CONSUMER SIDE: THE ENGINE (and its validators). `splash` — the
   * payload-less SPREADER — widens exactly these keywords from the anchor to
   * the whole band, and `validateSkillContent` refuses a `splash` on a card
   * that carries none of them (a spreader with nothing to spread). The PRICER
   * no longer reads this facet: `splash` prices its own flat standalone rate
   * (`PRICE.splashFlatDeci`, user-locked 2026-08-21), never a multiplier on
   * these keywords' prices.
   *
   * It is a declared FACET rather than an inferred one so that adding a
   * card-targeting keyword is a `true` here — and so that forgetting to decide
   * is a tsc error, not a silently un-spreadable keyword.
   */
  cardTargeting: boolean;
}

/**
 * A keyword is either PRICED (at least one term) or EXPLICITLY unpriced with a
 * stated reason. The union makes the third state — empty price, no reason, a
 * silent zero — unrepresentable rather than merely discouraged.
 */
export type KeywordPricing<K extends Action['kind'] = Action['kind']> =
  | (KeywordPricingBase & { price: readonly [PriceTerm<K>, ...PriceTerm<K>[]]; unpricedReason?: never })
  | (KeywordPricingBase & { price: readonly []; unpricedReason: string });

/** The rate constants this table needs. Structurally satisfied by `PRICE`. */
export interface PriceRates {
  flatPowerPerPoint: number;
  flatTrueHealPerPoint: number;
  flatTrueShieldPerPoint: number;
  truePremiumPerPoint: number;
  dotPerStack: number;
  stunPerTurn: number;
  statPctTurn: number;
  cleansePerCharge: number;
  negatePerCharge: number;
  wardPerCharge: number;
  slowPerWeightNum: number;
  slowPerWeightDen: number;
  burdenPerWeightNum: number;
  burdenPerWeightDen: number;
  cursePerAmountNum: number;
  cursePerAmountDen: number;
  cursePerAmountTurnNum: number;
  cursePerAmountTurnDen: number;
  lifestealPerPctNum: number;
  lifestealPerPctDen: number;
  shieldBreakPerPointNum: number;
  shieldBreakPerPointDen: number;
  comboPerPointNum: number;
  comboPerPointDen: number;
  conditionalBonusDen: number;
  guardPerPctTurnNum: number;
  guardPerPctTurnDen: number;
  exposePerPctTurnNum: number;
  exposePerPctTurnDen: number;
  tauntPerPoint: number;
  splashFlatDeci: number;
  disruptBrackets: readonly { upTo: number; rateDeci: number }[];
}

/** Per-keyword entries, each field-checked against its own Action variant. */
export type KeywordPricingTable = { [K in Action['kind']]: KeywordPricing<K> };

export function buildKeywordPricing(P: PriceRates): KeywordPricingTable {
  /** damage & a capped statStrike: flat rate, doubled for TRUE (bypasses defenses). */
  const strikeRate: Record<Property, number> = {
    physical: P.flatPowerPerPoint,
    magical: P.flatPowerPerPoint,
    true: P.flatPowerPerPoint + P.truePremiumPerPoint,
  };
  /** TRUE heals are pure flat at their own rate; typed heals add the caster's stat. */
  const healRate: Record<Property, number> = {
    physical: P.flatPowerPerPoint,
    magical: P.flatPowerPerPoint,
    true: P.flatTrueHealPerPoint,
  };
  /** TRUE shields wall rather than recover, so they price above TRUE heals. */
  const shieldRate: Record<Property, number> = {
    physical: P.flatPowerPerPoint,
    magical: P.flatPowerPerPoint,
    true: P.flatTrueShieldPerPoint,
  };
  return {
    damage: { isHit: true, scalable: true, family: 'damage', offensive: true, cardTargeting: false, price: [{ form: 'perUnitByProperty', field: 'power', num: strikeRate, den: 1 }] },
    // An UNCAPPED statStrike prices at 0 through the `cap` field being absent —
    // deliberate, so it misses every band loudly. The echo's host-proportional
    // price lives in `gemPowerLevelDeci`, not in this card-rate table.
    statStrike: { isHit: true, scalable: false, family: 'damage', offensive: true, cardTargeting: false, price: [{ form: 'perUnitByProperty', field: 'cap', num: strikeRate, den: 1 }] },
    heal: { isHit: false, scalable: true, family: 'heal', offensive: false, cardTargeting: false, price: [{ form: 'perUnitByProperty', field: 'power', num: healRate, den: 1 }] },
    shield: { isHit: false, scalable: true, family: 'shield', offensive: false, cardTargeting: false, price: [{ form: 'perUnitByProperty', field: 'power', num: shieldRate, den: 1 }] },

    // LINEAR PER-STACK (user-locked 2026-07-23): priced on the authored stack
    // count, not the tick model's total. All three DoTs share the rate today.
    poison: { isHit: false, scalable: false, family: 'dot', offensive: true, cardTargeting: false, price: [{ form: 'perUnit', field: 'stacks', num: P.dotPerStack, den: 1 }] },
    burn: { isHit: false, scalable: false, family: 'dot', offensive: true, cardTargeting: false, price: [{ form: 'perUnit', field: 'stacks', num: P.dotPerStack, den: 1 }] },
    bleed: { isHit: false, scalable: false, family: 'dot', offensive: true, cardTargeting: false, price: [{ form: 'perUnit', field: 'stacks', num: P.dotPerStack, den: 1 }] },

    stun: { isHit: false, scalable: false, family: 'control', offensive: true, cardTargeting: false, price: [{ form: 'perUnit', field: 'turns', num: P.stunPerTurn, den: 1 }] },
    // Conditional-on-being-hit reflect pile: same linear per-stack rate as the
    // DoTs (max total reflected = N(N+1)/2, realised only if the holder keeps
    // getting hit — an upper bound, like bleed). Self buff => empower family.
    // RATE UNCHANGED by the 2026-08-21 ruling that a reflect is PHYSICAL rather
    // than TRUE (`reflectThorns`, combat/interpreter.ts) — and MORE honest for
    // it: `dotPerStack` is a TYPED rate (TRUE `damage` pays double via
    // `truePremiumPerPoint`), so thorns was already priced as if its reflect
    // were mitigable. It now actually is: armor comes off every sting, a
    // physical guard reduces it, a physical shield absorbs it. The upper bound
    // above is therefore softer than the price assumes, never harder.
    thorns: { isHit: false, scalable: false, family: 'empower', offensive: false, cardTargeting: false, price: [{ form: 'perUnit', field: 'stacks', num: P.dotPerStack, den: 1 }] },
    buffStat: { isHit: false, scalable: false, family: 'empower', offensive: false, cardTargeting: false, price: [{ form: 'product', fields: ['pct', 'turns'], num: P.statPctTurn, den: 1 }] },
    debuffStat: { isHit: false, scalable: false, family: 'control', offensive: true, cardTargeting: false, price: [{ form: 'product', fields: ['pct', 'turns'], num: P.statPctTurn, den: 1 }] },
    expose: { isHit: false, scalable: false, family: 'control', offensive: true, cardTargeting: false, price: [{ form: 'product', fields: ['pct', 'turns'], num: P.exposePerPctTurnNum, den: P.exposePerPctTurnDen }] },
    guard: { isHit: false, scalable: false, family: 'empower', offensive: false, cardTargeting: false, price: [{ form: 'product', fields: ['pct', 'turns'], num: P.guardPerPctTurnNum, den: P.guardPerPctTurnDen }] },
    negate: { isHit: false, scalable: false, family: 'empower', offensive: false, cardTargeting: false, price: [{ form: 'perUnit', field: 'charges', num: P.negatePerCharge, den: 1 }] },
    // The affliction mirror of negate, at half its rate: a charge denies ONE
    // EFFECT of a card (afflictions are riders) rather than a card's whole damage
    // line. Sits between the two removal keywords by construction —
    // cleanse 25 < ward 50 < negate 100 — and 50 deci makes the whole-PL step
    // exactly one charge. Self buff => empower family; prevents, never hits.
    ward: { isHit: false, scalable: false, family: 'empower', offensive: false, cardTargeting: false, price: [{ form: 'perUnit', field: 'charges', num: P.wardPerCharge, den: 1 }] },
    // SCALABLE (user-locked 2026-08-17) and its OWN cap family ('cleanse', not
    // 'empower') — the one keyword the tier-scaler is allowed to grow, because
    // cleanse is self-repair, the mirror of a heal, and heals already scale
    // freely with tier. Every other empower/control member stays frozen.
    cleanse: { isHit: false, scalable: true, family: 'cleanse', offensive: false, cardTargeting: false, price: [{ form: 'perUnit', field: 'charges', num: P.cleansePerCharge, den: 1 }] },

    slow: { isHit: false, scalable: false, family: 'control', offensive: true, cardTargeting: false, price: [{ form: 'perUnit', field: 'weight', num: P.slowPerWeightNum, den: P.slowPerWeightDen }] },
    // BURDEN — `slow`'s CARD-scope sibling, priced at slow's OWN per-point rate:
    // one card taxed, one card's worth of tempo. Full derivation on
    // `PRICE.burdenPerWeightNum` in balance.ts (including why the lifetime
    // divergence — a burden always eventually gets paid, a slow often expires
    // unpaid — is called a wash rather than measured).
    // `control` family so it cannot dodge the control cap; `cardTargeting` so
    // `splash` can spread it (the spreader prices its own flat rate — see below).
    burden: { isHit: false, scalable: false, family: 'control', offensive: true, cardTargeting: true, price: [{ form: 'perUnit', field: 'weight', num: P.burdenPerWeightNum, den: P.burdenPerWeightDen }] },
    // CURSE — burden's sibling on the DAMAGE axis: the targeted card deals
    // `amount` less for `turns` turns. TWO TERMS, because the delivery has two
    // parts and one product term can only describe one of them (see
    // `PRICE.cursePerAmountNum` in balance.ts for the full derivation):
    //   • the FIRST denial — the anchor is the card the victim is about to play,
    //     so one denial is near-certain but not certain (a case-3 anchor can cool
    //     out the whole window), priced at the flat-damage rate over the
    //     CONDITIONAL-TRIGGER DISCOUNT, exactly like `comboBonus`;
    //   • the REPEATS — one further firing per cooldown stride, i.e. `amount`
    //     more denied per `BASELINE_COOLDOWN + 1` turns of window.
    // `control` family (a debuff that denies the victim's output, alongside
    // slow/expose/debuffStat), `cardTargeting`, `offensive`.
    curse: {
      isHit: false, scalable: false, family: 'control', offensive: true, cardTargeting: true,
      price: [
        { form: 'perUnit', field: 'amount', num: P.cursePerAmountNum, den: P.cursePerAmountDen },
        { form: 'product', fields: ['amount', 'turns'], num: P.cursePerAmountTurnNum, den: P.cursePerAmountTurnDen },
      ],
    },
    // SPLASH — THE SPREADER, priced FLAT and STANDALONE like every other
    // keyword (user-locked 2026-08-21: "every gem pl is standalone" / "why did
    // you make splash different"): one field-less `flat` term,
    // `PRICE.splashFlatDeci` (20 deci = 2 PL) per cast, whatever the payload it
    // spreads. The coverage-multiplier shape this row replaced (x2 on the
    // summed price of the cast's card-targeting siblings, applied in
    // `actionsPriceDeci`) made splash the one keyword priced off its siblings'
    // magnitudes; that ruling reversed it. Full rate derivation (why 20 and
    // not 10/15) on `PRICE.splashFlatDeci` in balance.ts.
    //
    // A splash with NOTHING to spread still cannot ship on a card
    // (`validateSkillContent` refuses it) and is dropped at the resolver seam
    // on a host with no card-targeting payload (THE SPLASH GATE's
    // `nothingToSpread` arm, src/engine/cards.ts) — and that suppression
    // subtracts the gem's splash contribution at the instance level
    // (`instancePowerLevelDeci`), so a spreader that never fires is never paid
    // for on the piece that suppresses it.
    //
    // `control` family so the spend counts against the control cap;
    // `offensive` to mirror `isOffensiveAction` kind-for-kind.
    splash: {
      isHit: false, scalable: false, family: 'control', offensive: true, cardTargeting: false,
      price: [{ form: 'flat', deci: P.splashFlatDeci }],
    },
    disrupt: { isHit: false, scalable: false, family: 'control', offensive: true, cardTargeting: false, price: [{ form: 'bracketed', field: 'amount', brackets: P.disruptBrackets }] },
    lifesteal: { isHit: false, scalable: false, family: 'empower', offensive: false, cardTargeting: false, price: [{ form: 'perUnit', field: 'pct', num: P.lifestealPerPctNum, den: P.lifestealPerPctDen }] },
    shieldBreak: { isHit: false, scalable: false, family: 'control', offensive: true, cardTargeting: false, price: [{ form: 'perUnit', field: 'amount', num: P.shieldBreakPerPointNum, den: P.shieldBreakPerPointDen }] },
    comboBonus: { isHit: false, scalable: false, family: 'empower', offensive: false, cardTargeting: false, price: [{ form: 'perUnit', field: 'amount', num: P.comboPerPointNum, den: P.comboPerPointDen }] },

    // EXPLOIT / STACK BONUS — conditional FLAT bonus damage on the cast's own
    // hit, priced at the card's own damage rate over the conditional-trigger
    // DISCOUNT denominator (`PRICE.conditionalBonusDen`, which reproduces
    // comboBonus's locked 2.5 deci/pt on a typed card and charges a TRUE card
    // the TRUE premium — a flat bonus bypasses defense on a TRUE card exactly
    // as its flat base does). `stackBonus` prices its `cap`, never `per`: the
    // payload is `min(per × stacks, cap)`, and only the ceiling is bounded —
    // the `statStrike` lesson, made unrepresentable by `cap` being required.
    //
    // `isHit: false` — neither is a damage INSTANCE. They add to the hit the
    // card already has, so no `extraHitPremium`, no second `negate` charge to
    // spend, no second round of mitigation.
    //
    // FAMILY `empower`, deliberately NOT 'damage' — and this is a real trap
    // worth naming: `capViolations` checks the damage family against
    // `HIT_KINDS` (isHit), NOT against `family: 'damage'`, so a non-hit kind
    // labelled 'damage' would count against NO cap at all — a silent
    // cap escape. `empower` is also the honest home on the merits: it is where
    // `comboBonus`, the keyword these two extend, already lives, and the
    // 100/150/200-by-size empower ceiling is what bounds how much conditional
    // bonus damage one card may carry (40 points of typed exploit at size 1).
    //
    // `offensive: true` — they resolve against the VICTIM (mirrors
    // `isOffensiveAction`, which classifies both by KIND, including the
    // caster-side `of: 'caster'` form, because the bonus they arm is delivered
    // once per foe under `scope: 'all'`), so they pay the AoE reach multiplier.
    exploit: { isHit: false, scalable: false, family: 'empower', offensive: true, cardTargeting: false, price: [{ form: 'perUnitByProperty', field: 'amount', num: strikeRate, den: P.conditionalBonusDen }] },
    stackBonus: { isHit: false, scalable: false, family: 'empower', offensive: true, cardTargeting: false, price: [{ form: 'perUnitByProperty', field: 'cap', num: strikeRate, den: P.conditionalBonusDen }] },

    // TAX BONUS — the third reader in the family, and priced identically: its
    // `cap` at the card's own damage rate over the conditional discount. What it
    // reads is the victim's TEMPO BACKLOG (burdened pieces + a pending slow,
    // `taxedCardCount`) rather than an affliction pile, but the shape is the
    // same — a bounded flat add behind a gate the card cannot supply on its own,
    // so `per` is unpriced and the ceiling is the priced thing (`stackBonus`'s
    // rule; a huge `per` merely degenerates the rider into "+cap if taxed at
    // all"). `offensive: true`, `family: 'empower'`, `isHit: false` for exactly
    // the reasons spelled out above.
    taxBonus: { isHit: false, scalable: false, family: 'empower', offensive: true, cardTargeting: false, price: [{ form: 'perUnitByProperty', field: 'cap', num: strikeRate, den: P.conditionalBonusDen }] },

    // SHIELD BURST — the family's SPENDER: it converts up to `cap` points of the
    // caster's OWN shield into flat bonus damage on this cast's hit, and the
    // points are gone. Priced at the same conditional discount on `cap`, which is
    // deliberately CONSERVATIVE (over-, never under-priced) on two counts:
    //  • the gate is "you are holding plating", which — like an exploit's poison
    //    — another card has to supply (and a kit that supplies it itself forfeits
    //    the discount, `selfSynergyPremiumDeci`);
    //  • unlike every other rider here it also COSTS the holder the wall it
    //    reads, so its true worth is strictly below a free conditional bonus of
    //    the same size. Charging the same rate is the safe direction (the stance
    //    `PRICE.aoeTargetsNum/Den` takes with its own ceiling).
    // `offensive: FALSE` — the odd one out in this block, mirroring
    // `isOffensiveAction`: the resource is the caster's own, so it resolves on the
    // caster and runs once. That means no AoE reach multiplier, which is exactly
    // why an authored `scope: 'all'` + `shieldBurst` card is REFUSED by
    // `validateSkillContent` (one wall spent once must not be delivered five
    // times at a single-target price) — the same refuse-rather-than-price call
    // `splash` makes just above (see its `unpricedReason`).
    shieldBurst: { isHit: false, scalable: false, family: 'empower', offensive: false, cardTargeting: false, price: [{ form: 'perUnitByProperty', field: 'cap', num: strikeRate, den: P.conditionalBonusDen }] },

    // WARD RELEASE — `shieldBurst`'s twin one currency over, and priced by exactly
    // the same three decisions for exactly the same reasons: its `cap` at
    // `strikeRate` over the conditional discount (`per` is free, the ceiling is the
    // priced thing), `family: 'empower'` so it shares the conditional-bonus
    // ceiling, and `offensive: FALSE` because the resource is the caster's own
    // ward pile, so it resolves ONCE on the caster and arms the scalar
    // `bonusFlat`. That last one is again why an authored `scope: 'all'` +
    // `wardRelease` card is REFUSED by `validateSkillContent` rather than priced.
    //
    // It is CONSERVATIVE on the same second count as the burst: it destroys the
    // resource it reads (a spent charge is one affliction that will now land), so
    // its true worth is strictly below a free conditional bonus of the same size.
    // Over-, never under-priced.
    wardRelease: { isHit: false, scalable: false, family: 'empower', offensive: false, cardTargeting: false, price: [{ form: 'perUnitByProperty', field: 'cap', num: strikeRate, den: P.conditionalBonusDen }] },

    // DESPERATION — `exploit`'s shape with the gate moved to the caster's own HP
    // bar, so it prices IDENTICALLY: flat `amount` at `strikeRate` over the
    // conditional discount, TRUE premium included (a flat bonus bypasses defense on
    // a TRUE card exactly as its flat base does). `offensive: true` because the
    // bonus is armed PER VICTIM — the same call `stackBonus` with `of: 'caster'`
    // makes, and what makes an AoE desperation card pay the reach multiplier.
    //
    // THE DISCOUNT IS UNCONDITIONALLY SAFE HERE, uniquely in the family: no kit can
    // supply "the caster is at half HP" (maxHp is not buffable and no keyword
    // damages its own caster), so `selfSynergyPremiumDeci` is 0 for it by
    // construction — there is no full-rate variant to escape to.
    desperation: { isHit: false, scalable: false, family: 'empower', offensive: true, cardTargeting: false, price: [{ form: 'perUnitByProperty', field: 'amount', num: strikeRate, den: P.conditionalBonusDen }] },

    // OVERHEAL SHIELD / CLEANSE CONVERT — the family's two HEAL-SIDE members. Same
    // denominator (`conditionalBonusDen`), same "the required cap is the priced
    // thing" rule, same `empower` family — but the NUMERATOR is the rate of what
    // they actually deliver, not `strikeRate`:
    //  • `overhealShield` banks PLATING, so it divides `shieldRate`. A converted
    //    point of shield is worth exactly what a granted point of the same pool is
    //    worth, which is the only reading under which the discount means the same
    //    thing here as it does on the damage side. Note `shieldRate` charges TRUE
    //    at `flatTrueShieldPerPoint` rather than a doubled typed rate: a TRUE
    //    overheal wall costs what a TRUE `shield` line costs, no more.
    //  • `cleanseConvert` delivers HEALING, so it divides `healRate` — including
    //    TRUE heals' own cheaper flat rate. Pricing either at `strikeRate` would
    //    charge a defensive payload at an offensive rate and, on TRUE, invent a
    //    damage premium the payload never earns.
    // BOTH ARE `offensive: false` and neither needs an AoE refusal: they feed a
    // `heal`, which is a support action and resolves ONCE on the support target
    // whatever the card's scope, so there is no fan-out to hand one conversion to
    // five units (the hole `shieldBurst`/`wardRelease` are refused over).
    //
    // ALL FOUR RIDERS OF THIS PASS ARE `cardTargeting: false`: they read and arm
    // quantities on UNITS (a ward pile, an HP bar, a heal's overflow, a cleanse's
    // result), never a piece of the victim's board — so the `splash` spreader has
    // nothing to widen about them and its coverage multiplier never applies.
    overhealShield: { isHit: false, scalable: false, family: 'empower', offensive: false, cardTargeting: false, price: [{ form: 'perUnitByProperty', field: 'cap', num: shieldRate, den: P.conditionalBonusDen }] },
    cleanseConvert: { isHit: false, scalable: false, family: 'empower', offensive: false, cardTargeting: false, price: [{ form: 'perUnitByProperty', field: 'cap', num: healRate, den: P.conditionalBonusDen }] },

    // PRICED (balance-designer pass, 2026-08-18) — closes the last KNOWN
    // SILENT ZERO: `taunt` had an interpreter implementation and no rate.
    // Empower family (self-only, no foe target) alongside its nearest
    // structural sibling `thorns` — see `PRICE.tauntPerPoint`'s doc comment
    // in balance.ts for the full "nearest priced comparable" derivation.
    taunt: { isHit: false, scalable: false, family: 'empower', offensive: false, cardTargeting: false, price: [{ form: 'perUnit', field: 'amount', num: P.tauntPerPoint, den: 1 }] },
  };
}

/**
 * Deci-PL per point of a scalable sink action at a given property — READ FROM
 * THE TABLE's own price term, so the scaler in `cards.ts` and the pricer can
 * never quote different rates. `damage`/`heal`/`shield` price `perUnitByProperty`
 * (the rate depends on physical/magical/true); `cleanse` (user-locked
 * 2026-08-17) prices flat `perUnit` — same charge rate at every property, so
 * `property` is accepted but unused for it.
 */
export function scalableRateDeci(
  kind: 'damage' | 'heal' | 'shield' | 'cleanse',
  property: Property,
  table: KeywordPricingTable,
): number {
  const term = table[kind].price[0];
  if (term === undefined) throw new Error(`${kind} has no price term`);
  if (term.form === 'perUnitByProperty') return Math.floor(term.num[property] / term.den);
  if (term.form === 'perUnit') return Math.floor(term.num / term.den);
  throw new Error(`${kind} is expected to price perUnitByProperty or perUnit`);
}

/**
 * Walk marginal brackets. THE single implementation — `disruptCostDeci` in
 * `balance.ts` delegates here so the card-action path and the gem path can
 * never drift apart on a boundary-condition fix.
 */
export function walkBrackets(amount: number, brackets: readonly { upTo: number; rateDeci: number }[]): number {
  let deci = 0;
  let priced = 0;
  for (const bracket of brackets) {
    if (amount <= priced) break;
    const upTo = Math.min(amount, bracket.upTo);
    deci += (upTo - priced) * bracket.rateDeci;
    priced = upTo;
  }
  return deci;
}

/** Price ONE action's terms. Each term floors independently, matching the engine. */
export function priceActionDeci(
  action: Action,
  property: Property,
  table: KeywordPricingTable,
): number {
  const fields = action as unknown as Record<string, number | undefined>;
  let deci = 0;
  for (const term of table[action.kind].price) {
    switch (term.form) {
      case 'perUnit':
        deci += Math.floor(((fields[term.field] ?? 0) * term.num) / term.den);
        break;
      case 'perUnitByProperty':
        deci += Math.floor(((fields[term.field] ?? 0) * term.num[property]) / term.den);
        break;
      case 'product':
        deci += Math.floor((((fields[term.fields[0]] ?? 0) * (fields[term.fields[1]] ?? 0)) * term.num) / term.den);
        break;
      case 'bracketed':
        deci += walkBrackets(fields[term.field] ?? 0, term.brackets);
        break;
      case 'flat':
        deci += term.deci;
        break;
    }
  }
  return deci;
}
