import type { Action, Property } from '../types';

/**
 * KEYWORD PRICING — the price facet of the keyword document, as DATA.
 *
 * Every effect keyword declares its price as a list of terms that are SUMMED.
 * `actionsPriceDeci` in `balance.ts` walks this table instead of a switch, so
 * adding a keyword is a row here, not a new `case` in the pricer.
 *
 * Five term forms cover every keyword in the game:
 *   perUnit           rate per unit of one field           (dot stacks, charges)
 *   perUnitByProperty rate varies with the card's property (the TRUE premium)
 *   product           rate per (fieldA x fieldB)           (pct x turns)
 *   bracketed         marginal brackets                    (disrupt)
 *   none              explicitly unpriced, with a reason   (taunt)
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
  | { form: 'bracketed'; field: FieldOf<K>; brackets: readonly { upTo: number; rateDeci: number }[] };

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
  splashPerWeightNum: number;
  splashPerWeightDen: number;
  lifestealPerPctNum: number;
  lifestealPerPctDen: number;
  shieldBreakPerPointNum: number;
  shieldBreakPerPointDen: number;
  comboPerPointNum: number;
  comboPerPointDen: number;
  guardPerPctTurnNum: number;
  guardPerPctTurnDen: number;
  exposePerPctTurnNum: number;
  exposePerPctTurnDen: number;
  tauntPerPoint: number;
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
    damage: { isHit: true, scalable: true, family: 'damage', offensive: true, price: [{ form: 'perUnitByProperty', field: 'power', num: strikeRate, den: 1 }] },
    // An UNCAPPED statStrike prices at 0 through the `cap` field being absent —
    // deliberate, so it misses every band loudly. The echo's host-proportional
    // price lives in `gemPowerLevelDeci`, not in this card-rate table.
    statStrike: { isHit: true, scalable: false, family: 'damage', offensive: true, price: [{ form: 'perUnitByProperty', field: 'cap', num: strikeRate, den: 1 }] },
    heal: { isHit: false, scalable: true, family: 'heal', offensive: false, price: [{ form: 'perUnitByProperty', field: 'power', num: healRate, den: 1 }] },
    shield: { isHit: false, scalable: true, family: 'shield', offensive: false, price: [{ form: 'perUnitByProperty', field: 'power', num: shieldRate, den: 1 }] },

    // LINEAR PER-STACK (user-locked 2026-07-23): priced on the authored stack
    // count, not the tick model's total. All three DoTs share the rate today.
    poison: { isHit: false, scalable: false, family: 'dot', offensive: true, price: [{ form: 'perUnit', field: 'stacks', num: P.dotPerStack, den: 1 }] },
    burn: { isHit: false, scalable: false, family: 'dot', offensive: true, price: [{ form: 'perUnit', field: 'stacks', num: P.dotPerStack, den: 1 }] },
    bleed: { isHit: false, scalable: false, family: 'dot', offensive: true, price: [{ form: 'perUnit', field: 'stacks', num: P.dotPerStack, den: 1 }] },

    stun: { isHit: false, scalable: false, family: 'control', offensive: true, price: [{ form: 'perUnit', field: 'turns', num: P.stunPerTurn, den: 1 }] },
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
    thorns: { isHit: false, scalable: false, family: 'empower', offensive: false, price: [{ form: 'perUnit', field: 'stacks', num: P.dotPerStack, den: 1 }] },
    buffStat: { isHit: false, scalable: false, family: 'empower', offensive: false, price: [{ form: 'product', fields: ['pct', 'turns'], num: P.statPctTurn, den: 1 }] },
    debuffStat: { isHit: false, scalable: false, family: 'control', offensive: true, price: [{ form: 'product', fields: ['pct', 'turns'], num: P.statPctTurn, den: 1 }] },
    expose: { isHit: false, scalable: false, family: 'control', offensive: true, price: [{ form: 'product', fields: ['pct', 'turns'], num: P.exposePerPctTurnNum, den: P.exposePerPctTurnDen }] },
    guard: { isHit: false, scalable: false, family: 'empower', offensive: false, price: [{ form: 'product', fields: ['pct', 'turns'], num: P.guardPerPctTurnNum, den: P.guardPerPctTurnDen }] },
    negate: { isHit: false, scalable: false, family: 'empower', offensive: false, price: [{ form: 'perUnit', field: 'charges', num: P.negatePerCharge, den: 1 }] },
    // The affliction mirror of negate, at half its rate: a charge denies ONE
    // EFFECT of a card (afflictions are riders) rather than a card's whole damage
    // line. Sits between the two removal keywords by construction —
    // cleanse 25 < ward 50 < negate 100 — and 50 deci makes the whole-PL step
    // exactly one charge. Self buff => empower family; prevents, never hits.
    ward: { isHit: false, scalable: false, family: 'empower', offensive: false, price: [{ form: 'perUnit', field: 'charges', num: P.wardPerCharge, den: 1 }] },
    // SCALABLE (user-locked 2026-08-17) and its OWN cap family ('cleanse', not
    // 'empower') — the one keyword the tier-scaler is allowed to grow, because
    // cleanse is self-repair, the mirror of a heal, and heals already scale
    // freely with tier. Every other empower/control member stays frozen.
    cleanse: { isHit: false, scalable: true, family: 'cleanse', offensive: false, price: [{ form: 'perUnit', field: 'charges', num: P.cleansePerCharge, den: 1 }] },

    slow: { isHit: false, scalable: false, family: 'control', offensive: true, price: [{ form: 'perUnit', field: 'weight', num: P.slowPerWeightNum, den: P.slowPerWeightDen }] },
    // SPLASH — `slow`'s card-scope sibling, priced at exactly 2x its rate:
    // TWO pieces at slow's full rate, 2 being the band's guaranteed FLOOR on any
    // board with more than one piece (the band runs 1..3 wide on the VICTIM's
    // board, which the holder does not control, so the third piece is unpriced
    // upside). Full derivation on `PRICE.splashPerWeightNum` in balance.ts.
    // `control` family so it cannot dodge the control cap; `offensive` because
    // it resolves against a foe (mirrors `isOffensiveAction`) — note that
    // makes `scope: 'all'` + splash pay the AoE reach multiplier rather than
    // price at a silent zero. Nothing can reach that price in practice: splash
    // is single-target at the UNIT level, so `validateSkillContent` refuses an
    // AUTHORED AoE+splash card and the splash gate in `resolveEffectiveSkill`
    // (cards.ts) drops a GEM's splash on a multi-target host.
    splash: { isHit: false, scalable: false, family: 'control', offensive: true, price: [{ form: 'perUnit', field: 'weight', num: P.splashPerWeightNum, den: P.splashPerWeightDen }] },
    disrupt: { isHit: false, scalable: false, family: 'control', offensive: true, price: [{ form: 'bracketed', field: 'amount', brackets: P.disruptBrackets }] },
    lifesteal: { isHit: false, scalable: false, family: 'empower', offensive: false, price: [{ form: 'perUnit', field: 'pct', num: P.lifestealPerPctNum, den: P.lifestealPerPctDen }] },
    shieldBreak: { isHit: false, scalable: false, family: 'control', offensive: true, price: [{ form: 'perUnit', field: 'amount', num: P.shieldBreakPerPointNum, den: P.shieldBreakPerPointDen }] },
    comboBonus: { isHit: false, scalable: false, family: 'empower', offensive: false, price: [{ form: 'perUnit', field: 'amount', num: P.comboPerPointNum, den: P.comboPerPointDen }] },

    // PRICED (balance-designer pass, 2026-08-18) — closes the last KNOWN
    // SILENT ZERO: `taunt` had an interpreter implementation and no rate.
    // Empower family (self-only, no foe target) alongside its nearest
    // structural sibling `thorns` — see `PRICE.tauntPerPoint`'s doc comment
    // in balance.ts for the full "nearest priced comparable" derivation.
    taunt: { isHit: false, scalable: false, family: 'empower', offensive: false, price: [{ form: 'perUnit', field: 'amount', num: P.tauntPerPoint, den: 1 }] },
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
    }
  }
  return deci;
}
