// Gem/socket resolution: pure, integer-only, no RNG.
//
// A gem is either an EFFECT gem (extra cast Actions appended to a card) or a
// STAT gem (flat modifiers, card- or hero-scoped). Resolution here produces the
// effective skill and modifier bundles the combat engine consumes; an un-gemmed
// piece resolves to the exact same reference/values it had before gems existed,
// so behavior and the event log are byte-identical.

import type { AuraMods } from './combat/auras';
import {
  actionsPriceDeci,
  CARD_TARGETING_KINDS,
  DOT_KINDS,
  effectCapDeci,
  KEYWORD_PRICING,
  powerLevelDeci,
  PRICE,
  SCALABLE_KINDS,
  TIER_BUDGET_DECI,
} from './balance';
import { scalableRateDeci as tableScalableRateDeci } from './keywords/pricing';
import {
  BASELINE_COOLDOWN,
  isMultiTargetSkill,
  weightOf,
  type Action,
  type BoardPiece,
  type BuffableStat,
  type CombatantStats,
  type Gem,
  type Property,
  type SkillDef,
  type SkillTier,
} from './types';

/** Fixed order for deterministic hero-stat folding (sums are commutative regardless). */
const HERO_STATS: readonly BuffableStat[] = ['attack', 'magicPower', 'armor', 'magicResist', 'speed'];

/** Low → high tier order (index = tier-steps above bronze). */
const TIER_ORDER: readonly SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];

// `cleanse` joined the sink kinds (user-locked 2026-08-17): it is the one
// `perUnit` (not `perUnitByProperty`) scalable, growing its own `charges`
// field rather than `power` — see `sinkField` and `scalableRateDeci` below.
type ScalableKind = 'damage' | 'heal' | 'shield' | 'cleanse';

/** The field a sink kind's magnitude lives on — `power` for damage/heal/shield,
 * `charges` for cleanse. Read once here rather than special-cased per call site. */
function sinkField(kind: ScalableKind): 'power' | 'charges' {
  return kind === 'cleanse' ? 'charges' : 'power';
}

/** Rate per point for a sink action — read from the keyword table, never copied. */
function scalableRateDeci(kind: ScalableKind, property: Property): number {
  return tableScalableRateDeci(kind, property, KEYWORD_PRICING);
}

/**
 * BUDGET-HONEST tier scaler (resolver-seam only — never touches the combat
 * loop). Rank a card from its base tier up to `targetTier` so its kit lands
 * EXACTLY on the target tier's PL budget, splitting its cost into three buckets:
 *
 *  • FROZEN — held at the card's Bronze value at every tier: control
 *    (stun/slow/disrupt/debuffStat/expose/shieldBreak), empower (buffStat/
 *    guard/negate/ward/lifesteal/comboBonus/thorns), the aura block, the
 *    multi-hit premium, weight deviation and cooldown deviation. Only the size
 *    grant (a refund) moves with the tier. Weight and size never change, so
 *    the audited weight/size bounds carry over unchanged. NOTHING here is
 *    re-derived any more — the frozen bucket is simply whatever
 *    `powerLevelDeci` charges for the kit once the two movable buckets below
 *    are pinned (see `priceOf`, and THE FOURTH MIRROR note beside it).
 *  • DoT (poison/burn/bleed) — GROWS toward its cap: the largest stack count
 *    whose scoped family spend still fits `effectCapDeci('dot', …)` AND whose
 *    whole kit (sink at zero) still fits the budget.
 *  • SINK (damage/heal/shield/cleanse) — solved to consume whatever budget the
 *    frozen + DoT buckets leave, split evenly across same-kind actions.
 *    `cleanse` joined this bucket (user-locked 2026-08-17, its own `charges`
 *    field via `sinkField`) rather than staying frozen — see
 *    `TIER_SCALED_FAMILIES` in balance.ts for why it alone is exempted from
 *    the "control/empower never grows" rule.
 *
 * A card with NO sink and NO DoT to absorb the budget (pure control/empower/
 * aura — the CAP-HIT cases) is returned with only its `tier` bumped; the audit
 * exempts those until an authored `tierUpgrades` path lands. A single-target
 * kit whose sink cannot land on the budget EXACTLY (non-integer / negative /
 * mixed-rate sinks) is likewise left unchanged so the audit surfaces the gap
 * rather than shipping an off-budget card. `scope: 'all'` is the one case that
 * settles for the largest magnitude UNDER budget, because the AoE reach
 * multiplier floors the offensive share and exactness is usually unreachable —
 * see the SINK SOLVE comment below.
 */
export function autoScaleTier(def: SkillDef, targetTier: SkillTier): SkillDef {
  const budget = TIER_BUDGET_DECI[targetTier];
  const property = def.property;
  const effects = def.effects;

  const dotIndices = effects.map((a, i) => (DOT_KINDS.has(a.kind) ? i : -1)).filter((i) => i >= 0);
  const sinkIndices = effects.map((a, i) => (SCALABLE_KINDS.has(a.kind) ? i : -1)).filter((i) => i >= 0);

  /** The candidate kit for a given DoT stack count and per-sink-action magnitude. */
  const applyEffects = (stacks: number, perActionPower: number | null): Action[] =>
    effects.map((a, i) => {
      if (dotIndices.includes(i)) return { ...a, stacks };
      if (perActionPower !== null && sinkIndices.includes(i)) {
        return { ...a, [sinkField(a.kind as ScalableKind)]: perActionPower };
      }
      return a;
    });
  const withEffects = (next: Action[]): SkillDef =>
    ({ ...def, tier: targetTier, effects: next, text: retextScaledNumbers(def.text, effects, next) });

  // THE ONE PRICER — every candidate kit below is priced by `powerLevelDeci`
  // itself, at the TARGET tier, never by a re-derived sum of parts.
  //
  // THE FOURTH MIRROR, closed (2026-08-18): this function used to add up its
  // own frozen bucket (control + empower + statStrike + aura + multi-hit +
  // weight + cooldown − size grant) and solve the sink against that. Every
  // term in that sum was a copy of a term in `powerLevelDeci`, and two of them
  // had already drifted: the `actionsPriceDeci` calls passed no `scope` (so an
  // AoE card was solved at SINGLE-TARGET prices and then priced by
  // `powerLevelDeci` at the `PRICE.aoeTargetsNum/Den` reach multiplier — 32%
  // OVER budget at every tier), and the multi-hit premium was hand-rolled at
  // the raw rate instead of being charged through the same function. Pricing
  // the whole candidate card in ONE call makes both classes of drift
  // impossible: whatever `powerLevelDeci` charges is exactly what the solver
  // spends, including any term added to it in the future.
  const priceOf = (next: Action[]): number => powerLevelDeci({ ...def, tier: targetTier, effects: next });

  // --- DoT: grow toward min(cap, remaining budget), one stack at a time. The
  //     family-cap test is the SAME per-family spend `capViolations` audits
  //     (scoped price of the DoT actions vs `effectCapDeci`), and the budget
  //     test prices the whole kit with the sink at zero — its cheapest form —
  //     so the stacks chosen can never crowd the sink below zero. Content
  //     carries one DoT action per DoT card, so the chosen N is the whole line.
  let chosenN = 0;
  if (dotIndices.length > 0) {
    const dotCap = effectCapDeci('dot', def.size, targetTier);
    // A single DoT line can never hold more stacks than its own family cap
    // affords, which bounds this walk at ~40 iterations.
    const maxStacks = Math.floor(dotCap / PRICE.dotPerStack);
    for (let n = 1; n <= maxStacks; n += 1) {
      const kit = applyEffects(n, 0);
      const dotSpend = actionsPriceDeci(kit.filter((a) => DOT_KINDS.has(a.kind)), property, def.scope);
      if (dotSpend > dotCap) break;
      if (priceOf(kit) > budget) break;
      chosenN = n;
    }
  }

  // CAP-HIT: no scalable sink to hit the budget with (pure control/empower/aura).
  // Leave the base kit unchanged — under budget, audit-exempt until authored.
  if (sinkIndices.length === 0) {
    return withEffects(applyEffects(chosenN, null));
  }

  // Same-kind, same-rate sinks only: the budget is split EVENLY across them, so
  // a mixed-rate kit has no single `perActionPower` to solve for and is left at
  // its base numbers for the audit to surface.
  const rate = scalableRateDeci(effects[sinkIndices[0]!]!.kind as ScalableKind, property);
  const homogeneous = sinkIndices.every((i) => scalableRateDeci(effects[i]!.kind as ScalableKind, property) === rate);
  if (!homogeneous || rate <= 0) {
    return withEffects(applyEffects(chosenN, null));
  }

  // --- SINK SOLVE: the largest per-action magnitude the budget affords, found
  //     by bisection on `priceOf` (monotone non-decreasing in the magnitude:
  //     every sink action is priced `rate × magnitude`, rate > 0). Pure integer
  //     arithmetic, no RNG, no floats — and no closed form is possible under
  //     `scope: 'all'`, where the reach multiplier FLOORS the offensive share.
  const priceAt = (p: number): number => priceOf(applyEffects(chosenN, p));
  if (priceAt(0) > budget) {
    // The frozen + DoT buckets already overspend: nothing left for the sink.
    return withEffects(applyEffects(chosenN, null));
  }
  let lo = 0;
  let hi = 1;
  // Terminates: the price grows without bound in `p` (rate > 0), so the
  // doubling walk always overshoots — ~6 probes for a Diamond budget.
  while (priceAt(hi) <= budget) hi *= 2;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (priceAt(mid) <= budget) lo = mid;
    else hi = mid;
  }

  // EXACT is still the rule for single-target cards, where pricing is LINEAR in
  // the sink magnitude: a kit that cannot land on the budget exactly is left at
  // its base numbers so the audit surfaces the gap (unchanged behaviour).
  //
  // Under `scope: 'all'` exactness is usually ARITHMETICALLY UNREACHABLE: the
  // AoE reach multiplier floors the offensive share, so consecutive magnitudes
  // step the price by `floor` jumps of 6 and 7 deci (a size-1 physical damage
  // sink) and most budgets simply fall between two of them. Rejecting those
  // would leave every AoE card stuck at Bronze numbers, so the AoE solve takes
  // the largest magnitude that stays UNDER budget instead. Never over — the one
  // direction that must never ship (see `cooldownDeviationDeci`'s fail-open
  // note in balance.ts) — and the shortfall is bounded by one magnitude step.
  if (priceAt(lo) !== budget && def.scope !== 'all') {
    return withEffects(applyEffects(chosenN, null));
  }
  return withEffects(applyEffects(chosenN, lo));
}

/**
 * Keep the display `text` honest when auto-scaling changes effect numbers
 * (authored `tierUpgrades` carry their own text; this covers the generic
 * path). For each effect whose `power`/`stacks`/`charges` changed, rewrite the
 * FIRST standalone occurrence of the old number in the text (not part of a
 * longer number and not a percentage). Effects are display-only — the engine
 * never reads `text` — so a rare miss degrades display, never simulation.
 */
function retextScaledNumbers(text: string, before: readonly Action[], after: readonly Action[]): string {
  let out = text;
  before.forEach((oldAction, i) => {
    const newAction = after[i];
    if (!newAction) return;
    const numericPairs: Array<[number | undefined, number | undefined]> = [
      [(oldAction as { power?: number }).power, (newAction as { power?: number }).power],
      [(oldAction as { stacks?: number }).stacks, (newAction as { stacks?: number }).stacks],
      // `cleanse` (user-locked 2026-08-17) is the one scalable keyword whose
      // magnitude lives on `charges`, not `power`/`stacks` — see `sinkField`.
      [(oldAction as { charges?: number }).charges, (newAction as { charges?: number }).charges],
    ];
    for (const [oldValue, newValue] of numericPairs) {
      if (oldValue === undefined || newValue === undefined || oldValue === newValue) continue;
      out = out.replace(new RegExp(`(?<!\\d)${oldValue}(?!\\d|%)`), String(newValue));
    }
  });
  return out;
}

/**
 * Rank/tier-up dispatch (resolver-seam). A target at or below the base tier is
 * a no-op (same reference). An authored `tierUpgrades` entry for the target
 * tier wins verbatim (spread over the base); otherwise the budget-honest
 * `autoScaleTier` runs.
 */
export function applyTier(def: SkillDef, targetTier: SkillTier): SkillDef {
  if (TIER_ORDER.indexOf(targetTier) <= TIER_ORDER.indexOf(def.tier)) return def;
  const override = def.tierUpgrades?.[targetTier as Exclude<SkillTier, 'bronze'>];
  if (override) return { ...def, tier: targetTier, ...override };
  return autoScaleTier(def, targetTier);
}

/**
 * The host card's effective weight after a gem's `weightIncreasePct` tempo cost:
 * `base + floor(base × pct / 100)`, never adding 0 for a positive pct (see
 * `Gem.weightIncreasePct`). Integer-only; no percentage survives the call.
 */
function weightWithGemIncrease(base: number, pct: number): number {
  if (pct <= 0) return base;
  return base + Math.max(1, Math.floor((base * pct) / 100));
}

/**
 * WHERE a gem's action splices into its host card — BEFORE the host's own
 * effects (`pre`) or after them (`post`).
 *
 * A PROPERTY OF THE ACTION KIND, NOT OF THE GEM (the defect this table exists
 * to close, 2026-08-17). Gem actions used to be appended unconditionally, which
 * is only correct for the kinds that READ what the cast already did. The two
 * kinds that must be in place BEFORE the host's damage resolves were therefore
 * dead or degraded on every host that shipped them:
 *   • `comboBonus` writes `cast.bonusFlat`, which only the `damage` arm reads —
 *     appended last there is no damage action left to read it, so the whole
 *     keyword was a no-op on a gem (`follow_through_echo` did literally
 *     nothing);
 *   • `shieldBreak` opens the victim's plating for the hit that follows it —
 *     appended last it could only ever help some LATER cast
 *     (`shield_splitter_echo` watched the host's own hit get absorbed first).
 * `lifesteal` reads `cast.damageDealt` and so genuinely wants `post`, which is
 * why the old unconditional append was accidentally right for it.
 *
 * EXHAUSTIVE BY TYPE (`Record<Action['kind'], ...>`): a new `Action` kind does
 * not compile until its author states where a gem carrying it belongs, so the
 * next "must precede damage" keyword cannot repeat the same silent failure.
 * This mirrors the ordering convention content already follows by hand — the
 * two authored cards carrying these kinds (`shield_splitter`, `follow_through`)
 * both put them first, ahead of their damage line.
 *
 * SCOPE: this decides only where GEM actions splice in. A card's OWN authored
 * effect order is never reordered — `spliceGemActions` keeps `base` intact and
 * contiguous between the two gem blocks.
 */
type GemPhase = 'pre' | 'post';

const GEM_ACTION_PHASE: Record<Action['kind'], GemPhase> = {
  // --- Runs BEFORE the host's effects: it PREPARES the ground for them. ---
  /** Arms `cast.bonusFlat` so the host's damage arm can read it. */
  comboBonus: 'pre',
  /**
   * Arms `cast.bonusByTarget` — same seam as `comboBonus`, same failure mode if
   * appended last (no damage action left to read the bonus, so the whole gem
   * would be a no-op). ALSO the ordering the user locked for these two keywords
   * on 2026-08-21: a rider reads PRE-EXISTING status, so it must resolve ahead
   * of the host's own hit AND ahead of any status the host applies. `pre` gives
   * both for free — the host's own poison/thorns line stays where the card
   * authored it, behind its damage.
   */
  exploit: 'pre',
  stackBonus: 'pre',
  taxBonus: 'pre',
  /**
   * Same seam, same reason, one extra wrinkle: `shieldBurst` arms the SCALAR
   * `cast.bonusFlat` (it spends the caster's own wall, so it resolves once on the
   * caster) and would be a pure no-op appended last — it would drain the shield
   * with no damage action left to spend it on, i.e. strictly WORSE than doing
   * nothing. `pre` also keeps the ordering ruling: it reads the plating that was
   * already there, ahead of any `shield` line the host card grants itself.
   *
   * NO SHIPPED GEM CARRIES IT (pinned by test): a gem `shieldBurst` on an AoE
   * host would deliver one spent wall to every foe at a host-blind single-target
   * price, which is the same hole THE SPLASH GATE (`spliceGemActions` below)
   * exists to close — so authoring one means extending that gate, not just
   * adding a row here.
   */
  shieldBurst: 'pre',
  /**
   * `shieldBurst`'s twin one currency over, and it inherits the row verbatim:
   * `wardRelease` arms the SCALAR `cast.bonusFlat`, so appended last it would spend
   * the caster's ward charges with no damage action left to spend them ON — strictly
   * worse than doing nothing. `pre` also keeps the ordering ruling (it reads the
   * charges that were already there, ahead of any `ward` line the host grants
   * itself).
   *
   * NO SHIPPED GEM CARRIES IT (pinned by test), for the burst's reason exactly: on
   * an AoE host it would deliver one spent pile of charges to every foe at a
   * host-blind single-target price — the hole THE SPLASH GATE (`spliceGemActions`
   * below) exists to close. Extend that gate before authoring one.
   */
  wardRelease: 'pre',
  /**
   * Arms `cast.bonusByTarget` off the CASTER's own HP bar. `pre` for the
   * `exploit`/`stackBonus` reason (a bonus appended after the host's damage is a
   * no-op), and `desperation` is the one member of the third rider pass that is
   * genuinely GEM-SAFE: it is armed per victim, so an AoE host judges every foe on
   * the same caster-side condition and pays the reach multiplier for it. Nothing
   * host-blind about it, and nothing for the splash gate to close.
   */
  desperation: 'pre',
  /**
   * THE TWO HEAL-SIDE RIDERS. Both must be in place before the host's `heal`
   * resolves — `overhealShield` grants the allowance the heal arm converts against,
   * `cleanseConvert` arms `cast.healBonusFlat` for the heal to spend — so appended
   * last they are pure no-ops, the same silent failure this table exists to close.
   *
   * `overhealShield` at `pre` is CORRECT on any host with a heal: prepended, it
   * arms, then the host's own heal overflows into it.
   *
   * `cleanseConvert` at `pre` is the honest best-available, not a working
   * placement, and NO SHIPPED GEM CARRIES IT (pinned by test). It is the one rider
   * whose read must sit BETWEEN two of the host's own actions — after the host's
   * `cleanse`, before the host's `heal` — and a two-phase append/prepend model
   * cannot express that: prepended it reads 0 stacks, appended it arms a bonus the
   * heal has already gone past. `pre` is recorded here because it is the phase a
   * gem one would need if the splicer ever learns a third position; until then the
   * test is the gate.
   */
  overhealShield: 'pre',
  cleanseConvert: 'pre',
  /** Strips plating so the host's hit lands on HP, not on a shield. */
  shieldBreak: 'pre',
  // --- Runs AFTER, because it READS what the cast already did. ---
  /** Reads `cast.damageDealt` — must trail every hit of the cast. */
  lifesteal: 'post',
  // --- Runs AFTER, matching the convention every authored card follows. ---
  // Extra hits: additive to the host's kit, never ahead of it (a gem hit takes
  // no attacker-side bonus and no stat split — see `GemAppended`).
  damage: 'post',
  statStrike: 'post',
  // Offensive statuses the CARD catalog also places after its own hit
  // (debuffStat 6/6, expose 1/1, bleed 1/1). They would amplify the host's own
  // hit if hoisted — that is a balance change, not an ordering defect, so a gem
  // sits exactly where a card would put it. `bleed` additionally cannot be
  // applied while the victim holds a shield, so trailing the hit (which may
  // have spent that shield) is also its STRONGER placement.
  debuffStat: 'post',
  expose: 'post',
  bleed: 'post',
  // --- Runs AFTER, matching the convention (see the re-check below). ---
  // `guard`/`negate`/`ward`/`shield` only meet an INCOMING hit, and the only
  // damage a caster can take mid-cast is a `thorns` reflect. That reflect used
  // to be TRUE, which made this block a proven no-op: TRUE matched no typed
  // guard/negate and only drained the `true` pool. IT IS PHYSICAL SINCE
  // 2026-08-21 (`reflectThorns`, combat/interpreter.ts), so that reasoning is
  // DEAD: a gem `guard`/`shield` hoisted to `pre` WOULD now mitigate the host
  // cast's own incoming reflects.
  //
  // THE PLACEMENT STILL STANDS, on the same ground as `buffStat`/`expose` below:
  // changing WHEN a defensive gem comes up changes WHAT IT IS WORTH, which is a
  // balance decision (balance-designer), not the ordering defect this table was
  // built to close — and a gem should sit where a CARD would put the same line.
  // Two notes for whoever prices that: (a) the authored guard+damage cards
  // (`braced_pike`, `impaling_charge`, `barbed_rampart`) all guard FIRST, so the
  // card convention actually argues for `pre` here and the case is real; (b)
  // `negate` and `ward` are unaffected either way — `dealDamage`'s negate arm is
  // `source === 'skill'`-only, so it can never answer a reflect, and `ward`
  // answers afflictions, not damage.
  heal: 'post',
  shield: 'post',
  poison: 'post',
  burn: 'post',
  stun: 'post',
  cleanse: 'post',
  thorns: 'post',
  taunt: 'post',
  slow: 'post',
  // `burden`/`curse` tax the VICTIM's future casts; nothing inside this cast can
  // read either back, and (unlike `shieldBreak`) neither opens anything up for
  // the host's own hit. Same placement as their unit-scope sibling `slow`.
  burden: 'post',
  curse: 'post',
  /**
   * `splash` APPLIES NOTHING, so its phase decides nothing: the spreader is read
   * once per cast from the whole effect list (`castSpreadsBand`,
   * combat/interpreter.ts), never as the loop walks past it. `post` is recorded
   * because this table is exhaustive over `Action['kind']` and a row is required
   * — NOT because the position matters. That independence is load-bearing: gem
   * actions splice AFTER the host's, so a positional reading would make a splash
   * gem spread nothing on a burden host, i.e. break the exact socket the gem
   * exists for.
   *
   * (WHERE it splices is this table's business; WHETHER it splices at all is THE
   * SPLASH GATE's — see `spliceGemActions` below.)
   */
  splash: 'post',
  disrupt: 'post',
  guard: 'post',
  negate: 'post',
  ward: 'post',
  // --- Runs AFTER, but knowingly UNLIKE the card convention. ---
  // The two authored cards pairing a self-buff with a hit (`storm_surge`,
  // `thunder_step`) buff FIRST, so their own hit swings with the buff. A gem
  // `buffStat` kept at `post` therefore only pays off on the caster's LATER
  // casts inside the buff's window — real, readable, but weaker than the same
  // line on a card. Left as-is deliberately: it is the shipped behavior and
  // moving it would raise what the gem is worth, which is a pricing decision
  // (balance-designer), not part of closing this ordering defect.
  buffStat: 'post',
};

/**
 * WHY a gem's `splash` was dropped from the effective card — `null` when it
 * applies normally. See `SPLASH GATE` below for the rule; this is the reason
 * code, exported so a socket UI can say "this gem does nothing on this card"
 * without re-deriving (or drifting from) the engine's rule.
 *
 * Ask it of the card BEFORE its gem is folded in (the authored/tiered def, i.e.
 * what `applyTier` returns). Handing it an already-resolved skill still answers
 * correctly: the host-splash arm ignores `fromGem` actions, so a gem's own
 * splash never counts as the host's.
 *
 * `gemActions` is the GEM'S OWN action list, and it matters for exactly one arm:
 * `nothingToSpread`. A spreader needs a card-targeting effect to spread, and the
 * gem may be the thing supplying it (a `burden + splash` gem is a legal shape,
 * though the one shipped splash gem, `ripple_sliver`, carries the spreader alone).
 * It defaults to empty, which answers the narrower question "would this HOST
 * alone give a splash anything to spread" — correct for a bare splash gem, and
 * the reason the parameter is explicit rather than inferred.
 */
export type SplashSuppression = 'multiTarget' | 'hostAlreadySplashes' | 'nothingToSpread';

export function splashSuppressionOn(host: SkillDef, gemActions: readonly Action[] = []): SplashSuppression | null {
  // (a) The host already resolves against more than one unit. Asked as a
  // CONCEPT (`isMultiTargetSkill`, types.ts), not as `scope === 'all'` — that
  // is merely the only mechanism that exists today, and a future one must
  // inherit this rule rather than need a second special case.
  if (isMultiTargetSkill(host)) return 'multiTarget';
  // (b) The host already carries a splash of its own.
  for (let i = 0; i < host.effects.length; i += 1) {
    const action = host.effects[i]!;
    if (action.kind === 'splash' && !action.fromGem) return 'hostAlreadySplashes';
  }
  // (c) NOTHING TO SPREAD (2026-08-21, with the spreader model). `splash` has no
  // payload of its own: it only widens the reach of the cast's CARD-TARGETING
  // effects. On a cast that has none, it is inert — so it is dropped at the
  // resolver seam rather than left on the effective card, where it would print a
  // keyword on the face, appear in the socket UI and imply an effect that cannot
  // happen. Either side may supply the payload: the host's own kit, or the gem's
  // own actions (the shipped `burden + splash` gems supply their own).
  if (!hasCardTargeting(host.effects) && !hasCardTargeting(gemActions)) return 'nothingToSpread';
  return null;
}

/** Does this action list carry a CARD-TARGETING effect for a `splash` to spread? */
function hasCardTargeting(actions: readonly Action[]): boolean {
  for (let i = 0; i < actions.length; i += 1) {
    if (CARD_TARGETING_KINDS.has(actions[i]!.kind)) return true;
  }
  return false;
}

/**
 * Fold a gem's actions into the host's, each at its declared phase
 * (`GEM_ACTION_PHASE`). The host's own effects are copied through UNTOUCHED and
 * contiguous — a card's authored order is never rewritten — with the gem's
 * `pre` actions ahead of them and its `post` actions behind, each block keeping
 * the gem's own authored order. Plain index walks: no Map/Set iteration, no
 * RNG, no float.
 *
 * THE SPLASH GATE (user-locked 2026-08-18; third arm added 2026-08-21 with the
 * spreader model) — the ONE kind this function can refuse to splice. `splash`
 * spreads a cast's CARD-TARGETING effects across a 3-piece band on ONE victim's
 * board, and is single-target AT THE UNIT LEVEL by design (see the `splash` docs
 * in types.ts). A gem is the only way that identity can be violated after
 * authoring, so the rule is enforced HERE, at the resolver seam, where the
 * effective card is built — NOT in the combat loop, which stays keyword-blind,
 * and not only in `validateSkillContent`, which inspects the AUTHORED def and
 * structurally cannot see a gem-appended action. A gem `splash` is dropped when
 * any arm of `splashSuppressionOn` fires:
 *
 *  (a) THE HOST ALREADY HITS MORE THAN ONE TARGET. Otherwise `resolveTargets`
 *      fans the cast across every living foe and the spread applies on each
 *      one's whole board band — team-wide board disruption bought at a
 *      single-target price, since `gemPowerLevelDeci` prices a gem host-blind
 *      at `scope: 'one'`. NOTE WHAT IS AND IS NOT DROPPED: only the SPREADER.
 *      A `burden`/`curse` the same gem carries still lands (on each foe's
 *      anchor), exactly as a gem `poison` or `slow` does on an AoE host — one
 *      piece per foe is the linear reach every other offensive gem action
 *      already has, where band × foes is the quadratic one this arm exists to
 *      refuse.
 *
 *  (b) THE HOST ALREADY CARRIES A SPLASH. THE HOST'S OWN SPLASH WINS, always —
 *      precedence is decided by PROVENANCE, never by list position. Rationale:
 *      the authored card is the priced, audited artifact and the gem is the
 *      addition, so the addition yields. Under the spreader model this arm is
 *      close to a formality (the spreader has no magnitude to disagree about, so
 *      the second one would be a plain duplicate), and that is exactly why it
 *      stays: the effective card must carry AT MOST ONE splash, or a replay
 *      would have to explain a keyword that changed nothing.
 *
 *  (c) NOTHING TO SPREAD — neither the host's kit nor the gem's own actions
 *      carries a card-targeting effect. A payload-less spreader with no payload
 *      in reach is dead weight: it would print a keyword on the face and offer a
 *      socket that cannot do anything. Dropped rather than kept-and-ignored, the
 *      same call arm (a) makes for the same reason — a statically-known no-op
 *      should not survive into the effective card.
 *
 * A gem carrying MORE THAN ONE splash keeps only the FIRST (its own authored
 * order): the effective card carries at most one splash, so the same
 * one-spread-per-cast guarantee holds for the pathological case too.
 *
 * SILENT, BY DESIGN — the drop emits nothing to the event log. It is resolved
 * once at board setup (`initCombatant`), before turn 1: there is no turn, no
 * caster and no target to attribute an event to, and re-logging it per cast
 * would put an identical noise line in every fight the socket appears in. The
 * event log is the record of what HAPPENED in combat; a statically-known
 * no-op did not happen in combat. The place to warn a player is the socket UI,
 * which can ask `splashSuppressionOn` directly.
 */
function spliceGemActions(host: SkillDef, gemActions: readonly Action[]): Action[] {
  const pre: Action[] = [];
  const post: Action[] = [];
  // Asked WITH the gem's own actions, so arm (c) sees a `burden + splash` gem as
  // carrying its own payload and only refuses a spreader that truly has nothing
  // in reach. (The shipped splash gem, `ripple_sliver`, is a BARE spreader — it
  // relies on the HOST's payload and is exactly what this arm suppresses on a
  // host with none.)
  const splashBlocked = splashSuppressionOn(host, gemActions) !== null;
  let splashTaken = false;
  for (let i = 0; i < gemActions.length; i += 1) {
    const action = gemActions[i]!;
    if (action.kind === 'splash') {
      if (splashBlocked || splashTaken) continue;
      splashTaken = true;
    }
    const marked = markFromGem(action);
    if (GEM_ACTION_PHASE[action.kind] === 'pre') pre.push(marked);
    else post.push(marked);
  }
  return [...pre, ...host.effects, ...post];
}

/**
 * The skill actually cast from this piece. An effect gem splices its actions
 * into the base effects at the phase its KIND declares (`GEM_ACTION_PHASE`:
 * `comboBonus`/`shieldBreak` ahead of the card, everything else after it —
 * with ONE refusal, THE SPLASH GATE on `spliceGemActions`: a gem `splash` is
 * dropped on a host that already hits more than one target, already splashes of
 * its own, or gives the spreader nothing to spread), and
 * — if it carries `cooldownReduction` / `weightIncreasePct` — shortens the
 * card's effective cooldown by that many turns (floored at 0) / raises its
 * effective initiative weight by that percentage. Any other case (no gem / stat
 * gem / an effect gem with none of the three) returns the original def
 * unchanged (same reference).
 *
 * THE PROVENANCE SEAM (user-locked 2026-08-07): every appended action is
 * stamped `fromGem: true` HERE — not inferred later. That single mark is what
 * lets the core loop treat a gem's hit as its own self-contained hit (outside
 * the multi-hit stat-split divisor, and taking no attacker-side bonus) without
 * the loop ever learning what a gem is; see `GemAppended` in types.ts for the
 * exact rules and `interpreter.ts` for where they are read. Adding a gem
 * capability = extend this stamp + the data, never a branch in `applyCast`.
 */
export function resolveEffectiveSkill(def: SkillDef, piece: BoardPiece): SkillDef {
  // Rank/tier-up first (scales the base card), THEN fold the gem on top — a
  // gem's own actions are never tier-scaled.
  const tiered = piece.tier ? applyTier(def, piece.tier) : def;
  const gem = piece.gem;
  if (!gem || gem.kind !== 'effect') return tiered;
  const cooldownReduction = gem.cooldownReduction ?? 0;
  const weightIncreasePct = gem.weightIncreasePct ?? 0;
  if (gem.actions.length === 0 && cooldownReduction === 0 && weightIncreasePct <= 0) return tiered;

  const effects = gem.actions.length > 0
    ? spliceGemActions(tiered, gem.actions)
    : tiered.effects;
  if (cooldownReduction === 0 && weightIncreasePct <= 0) return { ...tiered, effects };

  const baseCooldown = tiered.cooldownTurns ?? BASELINE_COOLDOWN;
  return {
    ...tiered,
    effects,
    ...(cooldownReduction !== 0 ? { cooldownTurns: Math.max(0, baseCooldown - cooldownReduction) } : {}),
    // The tempo cost of a scaling payload (see `Gem.weightIncreasePct`). Written
    // as an explicit `speedWeight` so `weightOf` — and therefore `scanCast`, the
    // card face and the PL readout — all see ONE number with no branch.
    //
    // KNOWN, ACCEPTED CONSEQUENCE: `powerLevelDeci` charges weight deviation, so
    // a heavier effective card prices LOWER, and `boardPowerLevel` (the
    // `highestThreat` targeting policy, the only in-combat reader) therefore sees
    // a gemmed piece as slightly less threatening — 30 → 45 weight on
    // `crushing_blow` reads as −7.5 PL. That is the same seam `cooldownReduction`
    // already goes through in the other direction, it is deterministic, and it is
    // arguably correct (a slower card IS less of a threat). Suppressing it would
    // mean teaching the loop to tell authored weight from gem weight — a branch
    // the resolver seam exists to avoid.
    ...(weightIncreasePct > 0 ? { speedWeight: weightWithGemIncrease(weightOf(tiered), weightIncreasePct) } : {}),
  };
}

/**
 * Card-FACE display fold — DISPLAY ONLY; never feed this to the core loop.
 * Extends `resolveEffectiveSkill`'s tier + effect-gem fold with this piece's
 * OWN card-scope stat-gem flat mods (`gemCardMods`), baked directly into the
 * matching EXISTING actions' `power` — the same way `autoScaleTier` bakes a
 * tier bump into `power` and keeps `text` honest via `retextScaledNumbers`.
 * A card-scope gem's `damageFlat` bumps every existing `damage` action
 * regardless of property; `healFlat` bumps every existing `heal` action
 * EXCEPT on a TRUE-property card — mirroring the engine's OWN per-property
 * split exactly: `interpreter.ts`'s heal case skips `mods` entirely for TRUE
 * ("flat by identity: no stat term, no aura term"), while its `shield` case
 * never reads `mods` for ANY property, so a card-scope gem's `healFlat`
 * never touches a shield line here either.
 *
 * WHY a separate function from `resolveEffectiveSkill`: that function's
 * output IS what the core loop casts (`state.ts`'s `initCombatant`) — card-
 * scope stat-gem mods are applied there SEPARATELY, at cast time, folded
 * together with board auras so both can react to a changing board (see
 * `resolveAuras`/`aurasOn`). Baking them into `effects` a second time here
 * would double them if this output were ever fed back into the loop, so it
 * must not be. A card only ever displays its OWN socket on its face (board
 * auras are a separate, already-existing highlight feature, out of scope
 * here) — folding just the piece's own mods is safe and keeps the face's
 * "effective number at a glance" convention (CardToken's summed mode already
 * folds live ATK/DEF the same way) honest for sockets too.
 *
 * NEVER feed this into `powerLevelDeci`/`instancePowerLevelDeci` — those
 * price a card's AUTHORED sink actions against its tier budget, and the
 * gem's own PL is accounted separately (`gemPowerLevelDeci`, added on top,
 * never re-derived from inflated `power`); pricing the gem-bumped `effects`
 * here would double-count the gem's Power Level.
 */
export function resolveDisplaySkill(def: SkillDef, piece: BoardPiece): SkillDef {
  const effective = resolveEffectiveSkill(def, piece);
  const cardMods = gemCardMods(piece.gem);
  const dmgAdd = cardMods.damageFlat ?? 0;
  // TRUE heals are flat by identity (interpreter.ts skips `mods` entirely
  // for them) — a card-scope healFlat gem cannot touch one, so never fold it
  // in here either.
  const healAdd = effective.property === 'true' ? 0 : (cardMods.healFlat ?? 0);
  if (!dmgAdd && !healAdd) return effective;
  const before = effective.effects;
  const after = before.map((a) => {
    if (dmgAdd && a.kind === 'damage') return { ...a, power: a.power + dmgAdd };
    if (healAdd && a.kind === 'heal') return { ...a, power: a.power + healAdd };
    return a;
  });
  return { ...effective, effects: after, text: retextScaledNumbers(effective.text, before, after) };
}

/**
 * Stamp one gem action with its origin (see `GemAppended`). Copies rather than
 * mutating: the gem in `src/data` is shared content and must stay pristine, and
 * a fresh object per resolve keeps the effective skill free of aliasing.
 */
function markFromGem(action: Action): Action {
  return { ...action, fromGem: true };
}

/** A card-scope stat gem's card mods as an AuraMods-shaped bundle; `{}` otherwise. */
export function gemCardMods(gem: Gem | null | undefined): Partial<AuraMods> {
  if (!gem || gem.kind !== 'stat' || gem.scope !== 'card' || !gem.mods.card) return {};
  const card = gem.mods.card;
  const out: Partial<AuraMods> = {};
  if (card.damageFlat !== undefined) out.damageFlat = card.damageFlat;
  if (card.healFlat !== undefined) out.healFlat = card.healFlat;
  if (card.weightDelta !== undefined) out.weightDelta = card.weightDelta;
  return out;
}

/** Sum every hero-scope stat gem's `mods.hero` across the board. */
export function gemHeroStats(pieces: BoardPiece[]): Partial<CombatantStats> {
  const out: Partial<CombatantStats> = {};
  for (const piece of pieces) {
    const gem = piece.gem;
    if (!gem || gem.kind !== 'stat' || gem.scope !== 'hero' || !gem.mods.hero) continue;
    const hero = gem.mods.hero;
    for (const key of HERO_STATS) {
      const v = hero[key];
      if (v === undefined) continue;
      out[key] = (out[key] ?? 0) + v;
    }
  }
  return out;
}

/** Integer-add hero-scope contributions into a copy of `stats`. */
export function applyHeroGems(stats: CombatantStats, heroAdds: Partial<CombatantStats>): CombatantStats {
  const out = { ...stats };
  for (const key of HERO_STATS) {
    const v = heroAdds[key];
    if (v === undefined) continue;
    out[key] = out[key] + v;
  }
  return out;
}

/**
 * DISPLAY-ONLY hero-stat fold — `src/game`'s counterpart to
 * `resolveDisplaySkill`, for the OTHER axis of gem display (hero-scope stat
 * gems rather than a card's own face). Wraps `applyHeroGems(stats,
 * gemHeroStats(pieces))`, the EXACT fold `initCombatant` (combat/state.ts)
 * applies at cast time, so a hero-scope stat gem's bonus shows up BOTH on the
 * hero's own stat readout and on every card's live-stat term (the "+ATK"/
 * "+MDEF" folded into a HEAL/DMG number) — without re-simulating combat.
 * `pieces` must be the hero's FULL board (every socketed piece contributes
 * its OWN hero-scope gem, not just whichever card's face is being drawn).
 *
 * NEVER feed the result back into a `CombatantSetup` handed to `simulate()` —
 * the engine folds the SAME gems from `setup.pieces` itself at cast time, so
 * doing it here too would double the bonus. Display-only, exactly like
 * `resolveDisplaySkill`; never touches `powerLevelDeci`/`instancePowerLevelDeci`.
 */
export function resolveDisplayHeroStats(stats: CombatantStats, pieces: BoardPiece[]): CombatantStats {
  return applyHeroGems(stats, gemHeroStats(pieces));
}
