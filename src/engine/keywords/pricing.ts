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

/** Cap family a keyword's spend counts against (`EFFECT_CAPS_DECI`). */
export type CapFamily = 'control' | 'dot' | 'empower' | 'damage' | 'shield' | 'heal';

export interface KeywordPricing<K extends Action['kind'] = Action['kind']> {
  /** Counts as a damage INSTANCE for the multi-hit premium. */
  isHit: boolean;
  /** Grows via `autoScaleTier`'s exact-sink solve. */
  scalable: boolean;
  family: CapFamily | null;
  price: readonly PriceTerm<K>[];
  /** Required when `price` is empty — why this keyword is deliberately unpriced. */
  unpricedReason?: string;
}

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
  slowPerWeightNum: number;
  slowPerWeightDen: number;
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
    damage: { isHit: true, scalable: true, family: 'damage', price: [{ form: 'perUnitByProperty', field: 'power', num: strikeRate, den: 1 }] },
    // An UNCAPPED statStrike prices at 0 through the `cap` field being absent —
    // deliberate, so it misses every band loudly. The echo's host-proportional
    // price lives in `gemPowerLevelDeci`, not in this card-rate table.
    statStrike: { isHit: true, scalable: false, family: 'damage', price: [{ form: 'perUnitByProperty', field: 'cap', num: strikeRate, den: 1 }] },
    heal: { isHit: false, scalable: true, family: 'heal', price: [{ form: 'perUnitByProperty', field: 'power', num: healRate, den: 1 }] },
    shield: { isHit: false, scalable: true, family: 'shield', price: [{ form: 'perUnitByProperty', field: 'power', num: shieldRate, den: 1 }] },

    // LINEAR PER-STACK (user-locked 2026-07-23): priced on the authored stack
    // count, not the tick model's total. All three DoTs share the rate today.
    poison: { isHit: false, scalable: false, family: 'dot', price: [{ form: 'perUnit', field: 'stacks', num: P.dotPerStack, den: 1 }] },
    burn: { isHit: false, scalable: false, family: 'dot', price: [{ form: 'perUnit', field: 'stacks', num: P.dotPerStack, den: 1 }] },
    bleed: { isHit: false, scalable: false, family: 'dot', price: [{ form: 'perUnit', field: 'stacks', num: P.dotPerStack, den: 1 }] },

    stun: { isHit: false, scalable: false, family: 'control', price: [{ form: 'perUnit', field: 'turns', num: P.stunPerTurn, den: 1 }] },
    buffStat: { isHit: false, scalable: false, family: 'empower', price: [{ form: 'product', fields: ['pct', 'turns'], num: P.statPctTurn, den: 1 }] },
    debuffStat: { isHit: false, scalable: false, family: 'control', price: [{ form: 'product', fields: ['pct', 'turns'], num: P.statPctTurn, den: 1 }] },
    expose: { isHit: false, scalable: false, family: 'control', price: [{ form: 'product', fields: ['pct', 'turns'], num: P.exposePerPctTurnNum, den: P.exposePerPctTurnDen }] },
    guard: { isHit: false, scalable: false, family: 'empower', price: [{ form: 'product', fields: ['pct', 'turns'], num: P.guardPerPctTurnNum, den: P.guardPerPctTurnDen }] },
    negate: { isHit: false, scalable: false, family: 'empower', price: [{ form: 'perUnit', field: 'charges', num: P.negatePerCharge, den: 1 }] },
    cleanse: { isHit: false, scalable: false, family: 'empower', price: [{ form: 'perUnit', field: 'charges', num: P.cleansePerCharge, den: 1 }] },

    slow: { isHit: false, scalable: false, family: 'control', price: [{ form: 'perUnit', field: 'weight', num: P.slowPerWeightNum, den: P.slowPerWeightDen }] },
    disrupt: { isHit: false, scalable: false, family: 'control', price: [{ form: 'bracketed', field: 'amount', brackets: P.disruptBrackets }] },
    lifesteal: { isHit: false, scalable: false, family: 'empower', price: [{ form: 'perUnit', field: 'pct', num: P.lifestealPerPctNum, den: P.lifestealPerPctDen }] },
    shieldBreak: { isHit: false, scalable: false, family: 'control', price: [{ form: 'perUnit', field: 'amount', num: P.shieldBreakPerPointNum, den: P.shieldBreakPerPointDen }] },
    comboBonus: { isHit: false, scalable: false, family: 'empower', price: [{ form: 'perUnit', field: 'amount', num: P.comboPerPointNum, den: P.comboPerPointDen }] },

    // KNOWN SILENT ZERO, now explicit rather than a missing switch arm. `taunt`
    // has an interpreter implementation and no rate; no card ships it. Giving it
    // a rate is a balance decision, not a refactor — until then the omission is
    // visible here instead of invisible in a switch.
    taunt: {
      isHit: false, scalable: false, family: null, price: [],
      unpricedReason: 'no rate set; permanent self-aggro has no duration term to price against',
    },
  };
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
