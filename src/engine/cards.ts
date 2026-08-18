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
  auraModsDeci,
  cooldownDeviationDeci,
  CONTROL_KINDS,
  DOT_KINDS,
  effectCapDeci,
  EMPOWER_KINDS,
  HIT_KINDS,
  KEYWORD_PRICING,
  PRICE,
  SCALABLE_KINDS,
  sizeGrantDeci,
  TIER_BUDGET_DECI,
} from './balance';
import { scalableRateDeci as tableScalableRateDeci } from './keywords/pricing';
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
 *  • FROZEN — held at the card's Bronze deci value at every tier: control
 *    (stun/slow/disrupt/debuffStat/expose/shieldBreak), empower (buffStat/
 *    guard/negate/ward/lifesteal/comboBonus/thorns), the aura block, the
 *    multi-hit premium, weight deviation and cooldown deviation. Only the size
 *    grant (a refund) moves with the tier. Weight and size never change, so
 *    the audited weight/size bounds carry over unchanged.
 *  • DoT (poison/burn/bleed) — GROWS toward its cap: pick the largest stack
 *    count N with N × dotPerStack ≤ min(dot cap, remaining budget). Linear
 *    per-stack pricing means every N is a whole PL.
 *  • EXACT SINK (damage/heal/shield/cleanse) — solved to consume whatever
 *    budget the frozen + DoT buckets leave, split evenly across same-kind
 *    actions. `cleanse` joined this bucket (user-locked 2026-08-17, its own
 *    `charges` field via `sinkField`) rather than staying frozen — see
 *    `TIER_SCALED_FAMILIES` in balance.ts for why it alone is exempted from
 *    the "control/empower never grows" rule.
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
  // `statStrike` is FROZEN like control/empower: it carries no `power` for the
  // sink solver to move, and its magnitude is a fraction of the caster's stat,
  // which no tier bump should widen. Its capped price is charged here so the
  // remaining budget the sink solves for stays exact.
  const strikeCost = actionsPriceDeci(effects.filter((a) => a.kind === 'statStrike'), property);
  const hitInstances = effects.filter((a) => HIT_KINDS.has(a.kind)).length;
  const extraHit = hitInstances > 1 ? (hitInstances - 1) * PRICE.extraHitPremium : 0;
  let auraCost = 0;
  if (def.aura) {
    const reach = def.aura.affects === 'allBoard' ? 2 : 1;
    auraCost = auraModsDeci(def.aura.mods) * reach;
  }
  const baseline = def.size * 10;
  const weightCost = (baseline - weightOf(def)) * PRICE.weightPer;
  // THE THIRD MIRROR, closed (2026-08-17): this used to hand-roll
  // `(BASELINE_COOLDOWN - cooldown) * PRICE.cooldownPerTurn` again, unclamped
  // — the same fail-open hole `powerLevelDeci` had, spent a second time. Both
  // callers now read the ONE shared, clamped function.
  const cooldownCost = cooldownDeviationDeci(def.cooldownTurns);
  const sizeGrant = sizeGrantDeci(def.size, targetTier);
  const frozenDeci = controlCost + empowerCost + strikeCost + auraCost + extraHit + weightCost + cooldownCost - sizeGrant;

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
      if (perActionPower !== null && sinkIndices.includes(i)) {
        return { ...a, [sinkField(a.kind as ScalableKind)]: perActionPower };
      }
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
  // --- Runs AFTER; nothing inside one cast can read these back. ---
  // (`guard`/`negate`/`ward`/`shield` only meet an INCOMING hit, and the only
  // damage a caster can take mid-cast is a `thorns` reflect, which is TRUE —
  // it never matches a typed guard/negate and only ever drains the `true`
  // shield pool. So hoisting them would change nothing.)
  heal: 'post',
  shield: 'post',
  poison: 'post',
  burn: 'post',
  stun: 'post',
  cleanse: 'post',
  thorns: 'post',
  taunt: 'post',
  slow: 'post',
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
 * Fold a gem's actions into the host's, each at its declared phase
 * (`GEM_ACTION_PHASE`). `base` is copied through UNTOUCHED and contiguous — a
 * card's authored order is never rewritten — with the gem's `pre` actions ahead
 * of it and its `post` actions behind it, each block keeping the gem's own
 * authored order. Plain index walks: no Map/Set iteration, no RNG, no float.
 */
function spliceGemActions(base: readonly Action[], gemActions: readonly Action[]): Action[] {
  const pre: Action[] = [];
  const post: Action[] = [];
  for (const action of gemActions) {
    const marked = markFromGem(action);
    if (GEM_ACTION_PHASE[action.kind] === 'pre') pre.push(marked);
    else post.push(marked);
  }
  return [...pre, ...base, ...post];
}

/**
 * The skill actually cast from this piece. An effect gem splices its actions
 * into the base effects at the phase its KIND declares (`GEM_ACTION_PHASE`:
 * `comboBonus`/`shieldBreak` ahead of the card, everything else after it), and
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
    ? spliceGemActions(tiered.effects, gem.actions)
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
