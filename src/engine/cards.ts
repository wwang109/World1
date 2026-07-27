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
  CONTROL_KINDS,
  DOT_KINDS,
  effectCapDeci,
  EMPOWER_KINDS,
  PRICE,
  SCALABLE_KINDS,
  sizeGrantDeci,
  TIER_BUDGET_DECI,
} from './balance';
import {
  BASELINE_COOLDOWN,
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

type ScalableKind = 'damage' | 'heal' | 'shield';

/**
 * Deci-PL rate per point for a scalable (damage/heal/shield) sink action, given
 * the card's property. 5/pt for physical/magical damage·heal·shield and TRUE
 * shield; 10/pt for TRUE damage (half-effect premium); 2/pt for TRUE heal.
 */
function scalableRateDeci(kind: ScalableKind, property: Property): number {
  if (kind === 'damage') return PRICE.flatPowerPerPoint + (property === 'true' ? PRICE.truePremiumPerPoint : 0);
  if (kind === 'heal') return property === 'true' ? PRICE.flatTrueHealPerPoint : PRICE.flatPowerPerPoint;
  return property === 'true' ? PRICE.flatTrueShieldPerPoint : PRICE.flatPowerPerPoint;
}

/**
 * BUDGET-HONEST tier scaler (resolver-seam only — never touches the combat
 * loop). Rank a card from its base tier up to `targetTier` so its kit lands
 * EXACTLY on the target tier's PL budget, splitting its cost into three buckets:
 *
 *  • FROZEN — held at the card's Bronze deci value at every tier: control
 *    (stun/slow/disrupt/debuffStat/expose/shieldBreak), empower (buffStat/
 *    guard/negate/cleanse/lifesteal/comboBonus), the aura block, the multi-hit
 *    premium, weight deviation and cooldown deviation. Only the size grant
 *    (a refund) moves with the tier. Weight and size never change, so the
 *    audited weight/size bounds carry over unchanged.
 *  • DoT (poison/burn/bleed) — GROWS toward its cap: pick the largest stack
 *    count N with N × dotPerStack ≤ min(dot cap, remaining budget). Linear
 *    per-stack pricing means every N is a whole PL.
 *  • EXACT SINK (damage/heal/shield) — solved to consume whatever budget the
 *    frozen + DoT buckets leave, split evenly across same-kind actions.
 *
 * A card with NO sink and NO DoT to absorb the budget (pure control/empower/
 * aura — the CAP-HIT cases) is returned with only its `tier` bumped; the audit
 * exempts those until an authored `tierUpgrades` path lands. If the sink can't
 * solve cleanly (non-integer / negative), the base is likewise left unchanged
 * so the audit surfaces the gap rather than shipping an off-budget card.
 */
export function autoScaleTier(def: SkillDef, targetTier: SkillTier): SkillDef {
  const budget = TIER_BUDGET_DECI[targetTier];
  const property = def.property;
  const effects = def.effects;

  // --- FROZEN deci (Bronze values; only the size grant refund moves with tier) ---
  const controlCost = actionsPriceDeci(effects.filter((a) => CONTROL_KINDS.has(a.kind)), property);
  const empowerCost = actionsPriceDeci(effects.filter((a) => EMPOWER_KINDS.has(a.kind)), property);
  const damageActions = effects.filter((a) => a.kind === 'damage').length;
  const extraHit = damageActions > 1 ? (damageActions - 1) * PRICE.extraHitPremium : 0;
  let auraCost = 0;
  if (def.aura) {
    const reach = def.aura.affects === 'allBoard' ? 2 : 1;
    const m = def.aura.mods;
    auraCost =
      ((m.damageFlat ?? 0) * PRICE.auraDamageFlat +
        (m.healFlat ?? 0) * PRICE.auraHealFlat +
        Math.abs(m.weightDelta ?? 0) * PRICE.auraWeightDelta) *
      reach;
  }
  const baseline = def.size * 10;
  const weightCost = (baseline - weightOf(def)) * PRICE.weightPer;
  const cooldown = def.cooldownTurns ?? BASELINE_COOLDOWN;
  const cooldownCost = (BASELINE_COOLDOWN - cooldown) * PRICE.cooldownPerTurn;
  const sizeGrant = sizeGrantDeci(def.size, targetTier);
  const frozenDeci = controlCost + empowerCost + auraCost + extraHit + weightCost + cooldownCost - sizeGrant;

  // --- DoT: grow toward min(cap, remaining budget). Content carries one DoT
  //     action per DoT card, so the chosen N is the whole DoT line. ---
  const dotIndices = effects.map((a, i) => (DOT_KINDS.has(a.kind) ? i : -1)).filter((i) => i >= 0);
  let chosenN = 0;
  if (dotIndices.length > 0) {
    const dotCap = effectCapDeci('dot', def.size, targetTier);
    const room = Math.min(dotCap, budget - frozenDeci);
    chosenN = Math.max(0, Math.floor(room / PRICE.dotPerStack));
  }
  const dotDeci = chosenN * PRICE.dotPerStack;

  // --- EXACT SINK: solve damage/heal/shield to consume the remaining budget ---
  const sinkIndices = effects.map((a, i) => (SCALABLE_KINDS.has(a.kind) ? i : -1)).filter((i) => i >= 0);

  const applyEffects = (perActionPower: number | null): Action[] =>
    effects.map((a, i) => {
      if (dotIndices.includes(i)) return { ...a, stacks: chosenN };
      if (perActionPower !== null && sinkIndices.includes(i)) return { ...a, power: perActionPower };
      return a;
    });
  const withEffects = (next: Action[]): SkillDef =>
    ({ ...def, tier: targetTier, effects: next, text: retextScaledNumbers(def.text, effects, next) });

  // CAP-HIT: no scalable sink to hit the budget with (pure control/empower/aura).
  // Leave the base kit unchanged — under budget, audit-exempt until authored.
  if (sinkIndices.length === 0) {
    return withEffects(applyEffects(null));
  }

  const scalableBudget = budget - frozenDeci - dotDeci;
  const rate = scalableRateDeci(effects[sinkIndices[0]!]!.kind as ScalableKind, property);
  const homogeneous = sinkIndices.every((i) => scalableRateDeci(effects[i]!.kind as ScalableKind, property) === rate);
  const denom = rate * sinkIndices.length;
  // Accept only a clean, non-negative, evenly-split integer solution.
  if (!homogeneous || scalableBudget < 0 || denom <= 0 || scalableBudget % denom !== 0) {
    return withEffects(applyEffects(null));
  }
  const perActionPower = scalableBudget / denom;
  return withEffects(applyEffects(perActionPower));
}

/**
 * Keep the display `text` honest when auto-scaling changes effect numbers
 * (authored `tierUpgrades` carry their own text; this covers the generic
 * path). For each effect whose `power`/`stacks` changed, rewrite the FIRST
 * standalone occurrence of the old number in the text (not part of a longer
 * number and not a percentage). Effects are display-only — the engine never
 * reads `text` — so a rare miss degrades display, never simulation.
 */
function retextScaledNumbers(text: string, before: readonly Action[], after: readonly Action[]): string {
  let out = text;
  before.forEach((oldAction, i) => {
    const newAction = after[i];
    if (!newAction) return;
    const numericPairs: Array<[number | undefined, number | undefined]> = [
      [(oldAction as { power?: number }).power, (newAction as { power?: number }).power],
      [(oldAction as { stacks?: number }).stacks, (newAction as { stacks?: number }).stacks],
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
 * The skill actually cast from this piece. An effect gem appends its actions
 * AFTER the base effects (fixed order: base first, gem after), and — if it
 * carries `cooldownReduction` — shortens the card's effective cooldown by
 * that many turns (floored at 0). Any other case (no gem / stat gem / an
 * effect gem with neither actions nor a cooldown reduction) returns the
 * original def unchanged (same reference).
 */
export function resolveEffectiveSkill(def: SkillDef, piece: BoardPiece): SkillDef {
  // Rank/tier-up first (scales the base card), THEN fold the gem on top — a
  // gem's own actions are never tier-scaled.
  const tiered = piece.tier ? applyTier(def, piece.tier) : def;
  const gem = piece.gem;
  if (!gem || gem.kind !== 'effect') return tiered;
  const cooldownReduction = gem.cooldownReduction ?? 0;
  if (gem.actions.length === 0 && cooldownReduction === 0) return tiered;

  const effects = gem.actions.length > 0 ? [...tiered.effects, ...gem.actions] : tiered.effects;
  if (cooldownReduction === 0) return { ...tiered, effects };

  const baseCooldown = tiered.cooldownTurns ?? BASELINE_COOLDOWN;
  return { ...tiered, effects, cooldownTurns: Math.max(0, baseCooldown - cooldownReduction) };
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
