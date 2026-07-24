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

import { BASELINE_COOLDOWN, weightOf, type Action, type BuffableStat, type Gem, type Property, type Rarity, type SkillDef, type SkillTier } from './types';

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
   * Flat TRUE heal: deci per point — 5 flat = 1 PL (no stat add). Heals are
   * reactive and lossy (overheal wastes), so they keep the cheaper rate.
   */
  flatTrueHealPerPoint: 2,

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
   * Bronze exactly.
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
   * cooldown: (BASELINE_COOLDOWN − cooldownTurns) * cooldownPerTurn — a
   * SHORTER cooldown fires more often (stronger, costs MORE PL); a LONGER
   * cooldown fires less often (weaker, REFUNDS PL). Baseline (3, the default
   * when `cooldownTurns` is omitted) is free — deviation 0 → +0 PL, so every
   * existing (baseline) card is unaffected.
   *
   * Priced at 100 deci (10 PL) per turn — user-locked 2026-07-19: a shorter
   * cooldown is a full extra cast over the course of a fight, close to a
   * whole Bronze card's worth of power, so it is priced like one. At this
   * rate NO gem rarity budget (2-8 PL) can afford even −1 turn, so nothing
   * in the current content deviates from the fixed baseline 3; the rate
   * exists to price any future exception honestly.
   */
  cooldownPerTurn: 100,

  /** slow: weight * (slowPerWeightNum/Den) — 1 PL per +4 weight. */
  slowPerWeightNum: 5,
  slowPerWeightDen: 2,

  /** disrupt: amount * (disruptPerPointNum/Den) — 1 PL per 4 drained
   * (user-locked 2026-07-19; doubled from 1 PL per 8). Throughput rationale
   * (docs/throughput-pl-proposal.md §2.E): draining banked readiness is a
   * meaningful tempo swing that was underpriced. */
  disruptPerPointNum: 5,
  disruptPerPointDen: 2,

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

  /** aura (per point, on the projecting card): damageFlat * auraDamageFlat,
   * healFlat * auraHealFlat, |weightDelta| * auraWeightDelta.
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
   * Multi-hit premium: each damage action BEYOND the first on one card pays
   * this flat surcharge (30 deci = 3 PL). Every hit re-delivers the caster's
   * full stat add unpriced (the flat rate only prices the card's own points),
   * so a second hit ships roughly ATK − DEF extra damage for free; 30 deci
   * (≈ 6 flat points at 5/pt) prices that delivery at typical low-level
   * spreads. Each extra hit also eats mitigation again, which is the built-in
   * counterweight vs armor stacks. First-pass rate — re-derive with sim data
   * once more multi-hit cards exist.
   */
  extraHitPremium: 30,

  /**
   * Hero-scope gem stat mods: flat integer points folded into base
   * `CombatantStats` for the whole run (permanent, every card, every turn) —
   * see "Gem pricing" in docs/power-level-reference.md for the anchoring
   * rationale per stat. First-pass rates; re-tune with sim data once
   * content-designer's gem catalog exists.
   */
  heroStatPerPoint: {
    attack: 8,
    magicPower: 8,
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

export function sizeGrantDeci(size: number, tier: SkillTier): number {
  const budget = TIER_BUDGET_DECI[tier];
  const anchor = size === 2 ? PRICE.sizeGrant2Bronze : size === 3 ? PRICE.sizeGrant3Bronze : 0;
  // floored to WHOLE PL (10 deci) — grants never introduce fractional PL
  return Math.floor((anchor * (budget + 100)) / 2000) * 10;
}

/**
 * Pure pricing switch over a bare Action[] against a given `property`. This
 * is the per-unit rate table applied without any card-level context (size,
 * weight, aura, TRUE premium) — `powerLevelDeci` layers those on top for a
 * full `SkillDef`; `gemPowerLevelDeci` uses this directly for effect gems.
 */
export function actionsPriceDeci(actions: readonly Action[], property: Property): number {
  let deci = 0;
  // Multi-hit premium: damage actions beyond the first pay a flat surcharge
  // for re-delivering the unpriced caster stat add (see PRICE.extraHitPremium).
  const damageActions = actions.filter((a) => a.kind === 'damage').length;
  if (damageActions > 1) deci += (damageActions - 1) * PRICE.extraHitPremium;
  for (const action of actions) {
    switch (action.kind) {
      case 'damage':
        // Flat base damage (the caster's stat is added at cast time, unpriced).
        // TRUE damage pays a scaling per-point premium for bypassing defenses.
        deci += action.power * (PRICE.flatPowerPerPoint + (property === 'true' ? PRICE.truePremiumPerPoint : 0));
        break;
      case 'heal':
      case 'shield':
        // TRUE heals/shields are pure flat (no stat add) at their own rates
        // (shields pay double the heal rate — they wall, heals recover);
        // non-TRUE add the caster's stat, priced at the flat-power rate.
        deci +=
          property === 'true'
            ? action.power * (action.kind === 'shield' ? PRICE.flatTrueShieldPerPoint : PRICE.flatTrueHealPerPoint)
            : action.power * PRICE.flatPowerPerPoint;
        break;
      case 'poison':
      case 'bleed':
      case 'burn':
        // LINEAR PER-STACK (user-locked 2026-07-23): priced directly on the
        // authored stack count, not the tick model's total damage — every
        // stack count is legal at a whole-PL price. Tick gameplay (decaying
        // for poison/bleed, halving for burn) is unchanged; see PRICE.dotPerStack.
        deci += action.stacks * PRICE.dotPerStack;
        break;
      case 'stun':
        deci += action.turns * PRICE.stunPerTurn;
        break;
      case 'buffStat':
      case 'debuffStat':
        deci += action.pct * action.turns * PRICE.statPctTurn;
        break;
      case 'expose':
        deci += Math.floor((action.pct * action.turns * PRICE.exposePerPctTurnNum) / PRICE.exposePerPctTurnDen);
        break;
      case 'cleanse':
        deci += action.charges * PRICE.cleansePerCharge;
        break;
      // Special ability riders — every magnitude properly weighted per unit.
      case 'slow':
        deci += Math.floor((action.weight * PRICE.slowPerWeightNum) / PRICE.slowPerWeightDen);
        break;
      case 'disrupt':
        deci += Math.floor((action.amount * PRICE.disruptPerPointNum) / PRICE.disruptPerPointDen);
        break;
      case 'lifesteal':
        deci += Math.floor((action.pct * PRICE.lifestealPerPctNum) / PRICE.lifestealPerPctDen);
        break;
      case 'shieldBreak':
        deci += Math.floor((action.amount * PRICE.shieldBreakPerPointNum) / PRICE.shieldBreakPerPointDen);
        break;
      case 'comboBonus':
        deci += Math.floor((action.amount * PRICE.comboPerPointNum) / PRICE.comboPerPointDen);
        break;
      // ---- Property-generic defensive keywords ----
      case 'guard':
        deci += Math.floor((action.pct * action.turns * PRICE.guardPerPctTurnNum) / PRICE.guardPerPctTurnDen);
        break;
      case 'negate':
        deci += action.charges * PRICE.negatePerCharge;
        break;
    }
  }
  return deci;
}

/** Total deci-PL of a card's kit. */
export function powerLevelDeci(skill: SkillDef): number {
  let deci = actionsPriceDeci(skill.effects, skill.property);

  if (skill.aura) {
    const reach = skill.aura.affects === 'allBoard' ? 2 : 1;
    const mods = skill.aura.mods;
    deci +=
      ((mods.damageFlat ?? 0) * PRICE.auraDamageFlat +
        (mods.healFlat ?? 0) * PRICE.auraHealFlat +
        Math.abs(mods.weightDelta ?? 0) * PRICE.auraWeightDelta) *
      reach;
  }

  // Weight: lighter than baseline costs, heavier refunds (slower attacks).
  const baseline = skill.size * 10;
  deci += (baseline - weightOf(skill)) * PRICE.weightPer;

  // Size grant (scales with the card's own tier budget).
  deci -= sizeGrantDeci(skill.size, skill.tier);

  // Cooldown: shorter than baseline costs, longer than baseline refunds.
  // Baseline cards (cooldownTurns omitted) price at exactly +0.
  const cooldown = skill.cooldownTurns ?? BASELINE_COOLDOWN;
  deci += (BASELINE_COOLDOWN - cooldown) * PRICE.cooldownPerTurn;

  return deci;
}

export interface PlBreakdownPart {
  label: string;
  deci: number;
}

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

  for (const action of skill.effects) {
    push(action.kind, actionsPriceDeci([action], skill.property));
  }
  // Multi-hit premium is count-based, so single-action pricing above misses
  // it — surface it as its own labeled part (keeps parts summing exactly).
  const extraHits = skill.effects.filter((a) => a.kind === 'damage').length - 1;
  if (extraHits > 0) push('multi-hit', extraHits * PRICE.extraHitPremium);

  if (skill.aura) {
    const reach = skill.aura.affects === 'allBoard' ? 2 : 1;
    const mods = skill.aura.mods;
    push('aura',
      ((mods.damageFlat ?? 0) * PRICE.auraDamageFlat +
        (mods.healFlat ?? 0) * PRICE.auraHealFlat +
        Math.abs(mods.weightDelta ?? 0) * PRICE.auraWeightDelta) *
      reach);
  }

  const baseline = skill.size * 10;
  push('weight', (baseline - weightOf(skill)) * PRICE.weightPer);
  push('size', -sizeGrantDeci(skill.size, skill.tier));
  const cooldown = skill.cooldownTurns ?? BASELINE_COOLDOWN;
  push('cooldown', (BASELINE_COOLDOWN - cooldown) * PRICE.cooldownPerTurn);

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
 * DoT stacks via the price ladder), never lockdown. Extra rules: stun is
 * hard-capped at 1 performance per card; auras are exempt (passive board
 * identity, priced per reach). `applyTier` never scales control/empower
 * magnitudes, so rank-ups can't break a compliant base card. Every card in
 * the book is tested against `capViolations` — when designing a card, run
 * `npm test` and the audit names any rule it breaks.
 */
export const EFFECT_CAPS_DECI = {
  /** stun, slow, disrupt, stat-down, expose, shieldBreak — one whole discrete effect */
  control: { 1: 100, 2: 150, 3: 200 } as Record<number, number>,
  /** poison + burn + bleed combined (deci = stacks × 10 at 1 PL/stack) */
  dot: { 1: 200, 2: 300, 3: 400 } as Record<number, number>,
  /** stat-up, guard, negate, cleanse, lifesteal, combo — one whole discrete effect */
  empower: { 1: 100, 2: 150, 3: 200 } as Record<number, number>,
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
 * EVERY family's cap is now FROZEN across tiers (user-locked 2026-07-23): a
 * single stat can never exceed its fixed per-size cap no matter the tier, so
 * ranking a card up buys NEW EFFECTS, not bigger numbers. (Was: damage/shield/
 * heal scaled ×1.5/2/2.5 — removed.) A card that can't absorb its tier budget
 * within the caps diversifies into other lines — the documented authoring
 * pattern, and what the tier scaler enforces.
 */
const TIER_SCALED_FAMILIES: ReadonlySet<keyof typeof EFFECT_CAPS_DECI> = new Set();

export const CONTROL_KINDS: ReadonlySet<Action['kind']> = new Set(['stun', 'slow', 'disrupt', 'debuffStat', 'expose', 'shieldBreak']);
export const DOT_KINDS: ReadonlySet<Action['kind']> = new Set(['poison', 'burn', 'bleed']);
export const EMPOWER_KINDS: ReadonlySet<Action['kind']> = new Set(['buffStat', 'guard', 'negate', 'cleanse', 'lifesteal', 'comboBonus']);
/** damage/heal/shield — the EXACT sink solved to hit budget by the tier scaler. */
export const SCALABLE_KINDS: ReadonlySet<Action['kind']> = new Set(['damage', 'heal', 'shield']);

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
    actionsPriceDeci(skill.effects.filter((a) => kinds.has(a.kind)), skill.property);
  const check = (family: keyof typeof EFFECT_CAPS_DECI, kinds: ReadonlySet<Action['kind']>): void => {
    const deci = spent(kinds);
    const cap = effectCapDeci(family, skill.size, skill.tier);
    if (deci > cap) violations.push(`${family} ${deci / 10} PL exceeds the size-${skill.size} ${skill.tier} cap (${cap / 10} PL)`);
  };
  check('control', CONTROL_KINDS);
  check('dot', DOT_KINDS);
  check('empower', EMPOWER_KINDS);
  check('damage', new Set(['damage']));
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
 * Total deci-PL of a single gem, priced independent of the card it's
 * socketed into (see `GEM_CANONICAL_PROPERTY` for the effect-gem case).
 * This is NOT part of the base-card budget audit — it's the gem's own PL,
 * checked against its rarity band by `isGemOnBudget`.
 */
export function gemPowerLevelDeci(gem: Gem): number {
  if (gem.kind === 'effect') {
    // A cooldown-reduction rider prices at the SAME rate as a card's own
    // cooldownTurns deviation (PRICE.cooldownPerTurn per turn shaved) — a
    // gem that shortens the host's cooldown by N turns is worth exactly what
    // a card baked with that same N-turn-shorter cooldown would cost.
    return actionsPriceDeci(gem.actions, GEM_CANONICAL_PROPERTY) + (gem.cooldownReduction ?? 0) * PRICE.cooldownPerTurn;
  }

  // Stat gem.
  if (gem.scope === 'card') {
    const card = gem.mods.card;
    if (!card) return 0;
    return (
      (card.damageFlat ?? 0) * PRICE.auraDamageFlat +
      (card.healFlat ?? 0) * PRICE.auraHealFlat +
      Math.abs(card.weightDelta ?? 0) * PRICE.auraWeightDelta
    );
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
 * Display/run-power readout for a socketed piece: base card PL (audited,
 * tier-budgeted) plus the gem's own uncapped bonus PL. Never fed back into
 * `isOnBudget` — the base-tier audit must stay gem-blind.
 */
export function instancePowerLevelDeci(def: SkillDef, piece: { gem?: Gem | null }): number {
  return powerLevelDeci(def) + (piece.gem ? gemPowerLevelDeci(piece.gem) : 0);
}
