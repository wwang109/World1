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
   * poison/bleed (DECAYING model, user-locked 2026-07-20): a DoT is one
   * number, N stacks. Each tick deals the current stack count then removes a
   * stack, so N stacks = N×(N+1)/2 total damage over N ticks. Priced on that
   * TOTAL: dotPerTotalDamage deci per point (2 deci = 5 total damage per PL —
   * cheaper than direct damage's 5 deci/pt because DoTs are delayed, get no
   * stat add, no crit, no matchup, and are cleansable). Cost formula:
   * N×(N+1)/2 × 2 = N×(N+1) deci. WHOLE-PL requirement: N×(N+1) must end in
   * 0, so legal stack counts are N ≡ 0 or 4 (mod 5): 4, 5, 9, 10, 14, 15…
   * Poison is end-of-turn and unstoppable; bleed is per-performance,
   * unstoppable once running but BLOCKED AT APPLICATION by active shields —
   * costs and upsides judged a wash, so both share the rate.
   */
  dotPerTotalDamage: 2,

  /**
   * burn (HALVING model, user-locked 2026-07-20): fierce and brief. Each
   * START-of-turn tick deals 2 × current stacks, then stacks HALVE (floored):
   * burn 8 → 16, 8, 4, 2 = 30 total over 4 turns. Priced by this authored
   * size table (deci) rather than a formula — the ~15-30% discount per point
   * of total damage vs poison's 2.0 rate pays for burn being absorbed by
   * shields (a counter poison/bleed ticks never meet):
   *   4 → 14 total = 2 PL (1.43/pt) · 5 → 16 = 3 PL (1.88/pt)
   *   8 → 30 = 5 PL (1.67/pt) · 10 → 36 = 6 PL (1.67/pt)
   * Sizes not in the table price conservatively at the poison rate
   * (2 deci × total) — author new sizes into the table deliberately.
   */
  burnPlDeciBySize: { 4: 20, 5: 30, 8: 50, 10: 60 } as Record<number, number>,

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
   * comboBonus: FLAT bonus damage points × comboPerPoint. Priced at the same
   * rate as a card's own flat damage (flatPowerPerPoint = 5) — the conditional
   * (previous-cast-archetype-gated) trigger is the balancing cost, so no extra
   * discount is baked in.
   */
  comboPerPoint: 5,

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
   * healFlat * auraHealFlat, critPctDelta * auraCritPct,
   * |weightDelta| * auraWeightDelta. allBoard reach doubles the total.
   * FLAT damage/heal auras are priced steeper than a card's own one-shot flat
   * damage (5/pt) because the bonus applies to every cast the aura reaches,
   * every fight — 20 deci/pt (War Banner +5 = 100 = Bronze). */
  auraDamageFlat: 20,
  auraHealFlat: 20,
  auraCritPct: 5,
  auraWeightDelta: 20,

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
    critPct: 5,
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
        // DECAYING: N stacks deal N×(N+1)/2 total damage, priced per total
        // point. = N×(N+1) deci at the 2-deci rate; whole PL ⇔ N ≡ 0 or 4 (mod 5).
        deci += ((action.stacks * (action.stacks + 1)) / 2) * PRICE.dotPerTotalDamage;
        break;
      case 'burn':
        // HALVING: authored size table (discounted for shield-absorbability);
        // unlisted sizes fall back to the poison rate on burn's halving total.
        deci += PRICE.burnPlDeciBySize[action.stacks] ?? burnTotalDamage(action.stacks) * PRICE.dotPerTotalDamage;
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
        deci += action.amount * PRICE.comboPerPoint;
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
        (mods.critPctDelta ?? 0) * PRICE.auraCritPct +
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

  if (skill.aura) {
    const reach = skill.aura.affects === 'allBoard' ? 2 : 1;
    const mods = skill.aura.mods;
    push('aura',
      ((mods.damageFlat ?? 0) * PRICE.auraDamageFlat +
        (mods.healFlat ?? 0) * PRICE.auraHealFlat +
        (mods.critPctDelta ?? 0) * PRICE.auraCritPct +
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
  /** stun, slow, disrupt, stat-down, expose, shieldBreak */
  control: { 1: 100, 2: 150, 3: 200 } as Record<number, number>,
  /** poison + burn + bleed combined */
  dot: { 1: 200, 2: 300, 3: 400 } as Record<number, number>,
  /** stat-up, guard, negate, cleanse, lifesteal, combo */
  empower: { 1: 100, 2: 150, 3: 200 } as Record<number, number>,
  /** flat damage (incl. TRUE) — Bronze anchor, ×tierBudget/100 at higher tiers */
  damage: { 1: 120, 2: 280, 3: 500 } as Record<number, number>,
  /** flat shield (incl. TRUE) — Bronze anchor, tier-scaled like damage */
  shield: { 1: 120, 2: 280, 3: 500 } as Record<number, number>,
  /** flat heal (incl. TRUE) — Bronze anchor, tier-scaled like damage */
  heal: { 1: 120, 2: 280, 3: 500 } as Record<number, number>,
} as const;
export const MAX_STUN_PER_CARD = 1;

/**
 * The flat families are the intended sink for tier scaling (`applyTier`
 * multiplies their magnitudes ×1.5/×2/×2.5), so their caps scale with the
 * tier budget; control/dot/empower caps are tier-independent — lockdown and
 * utility never grow with tier. A capped control card spends its surplus
 * budget on LIGHTER WEIGHT (2 below baseline = 1 PL → casts sooner) or on
 * effects from OTHER families (splash damage, a small shield) — that is the
 * documented authoring pattern, not a rule exception.
 */
const TIER_SCALED_FAMILIES: ReadonlySet<keyof typeof EFFECT_CAPS_DECI> = new Set(['damage', 'shield', 'heal']);

const CONTROL_KINDS: ReadonlySet<Action['kind']> = new Set(['stun', 'slow', 'disrupt', 'debuffStat', 'expose', 'shieldBreak']);
const DOT_KINDS: ReadonlySet<Action['kind']> = new Set(['poison', 'burn', 'bleed']);
const EMPOWER_KINDS: ReadonlySet<Action['kind']> = new Set(['buffStat', 'guard', 'negate', 'cleanse', 'lifesteal', 'comboBonus']);

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
      (card.critPctDelta ?? 0) * PRICE.auraCritPct +
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
