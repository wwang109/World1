import type { Rng } from '../rng';
import type { Action, EffectSourceRef, Property, SkillDef } from '../types';
import { isMultiTargetSkill, MAX_NEGATE_CHARGES, MAX_WARD_CHARGES } from '../types';
import type { AntiHealCategory, AntiHealReduction, CombatEvent, DamageCalculation } from './events';
import type { AuraMods, AuraSource } from './auras';
import { elementMatchup, matchupPct, weaponMatchup, type Matchup } from '../elements';
import { anySideWiped, boardPowerLevel, effStat, foesOf, hasStatus, releaseWardCharges, spendShieldsForBurst, statusStackCount, taxedCardCount, teamOf, totalShield, wardChargeCount, type CombatState, type CombatantState, type StatusInstance } from './state';
import { getSpecial } from './specials';
import { cardTargetPieces } from './splash';
import { cardType } from './typeIdentity';

export interface Ctx {
  state: CombatState;
  rng: Rng;
  events: CombatEvent[];
  /** The card currently producing effects — tags damage/heal/shieldGain events for per-card attribution. */
  source?: EffectSourceRef;
}

/**
 * Whether an action resolves against foes (offensive) or the caster (support).
 * Offensive actions fan out over the resolved target list; support actions run
 * once on the caster.
 */
function isOffensiveAction(action: Action): boolean {
  switch (action.kind) {
    case 'damage':
    case 'statStrike':
    // AFFINITY STRIKE lands its own hit on the victim, so it fans out with the
    // rest of the cast and pays the AoE reach multiplier under `scope: 'all'`.
    case 'affinityStrike':
    case 'poison':
    case 'burn':
    case 'bleed':
    case 'stun':
    case 'debuffStat':
    case 'expose':
    case 'slow':
    // The two CARD-TARGETING effects and their SPREADER. All three resolve
    // against a foe: burden/curse land on one of the victim's board pieces, and
    // `splash` — which applies nothing itself — is classified with them so the
    // pricing table's `offensive` mirror (OFFENSIVE_KINDS, engine/balance.ts)
    // stays kind-for-kind identical to this switch.
    case 'burden':
    case 'curse':
    case 'splash':
    case 'disrupt':
    case 'shieldBreak':
    // EXPLOIT / STACK BONUS are offensive even though they only ARM a bonus:
    // they resolve against the VICTIM (exploit reads its afflictions;
    // stackBonus with `of: 'target'` reads its pile) and their bonus is armed
    // PER TARGET, so they must walk the same fan-out — and the same chosen
    // target — as the damage action they feed. `stackBonus` with
    // `of: 'caster'` reads the caster's own pile but is still classified here
    // by KIND, not by field: the bonus it arms lands on the victim's hit, so
    // under `scope: 'all'` it is delivered once per foe and must pay the AoE
    // reach multiplier exactly as the target-side form does (OFFENSIVE_KINDS,
    // engine/balance.ts, mirrors this switch kind-for-kind).
    case 'exploit':
    case 'stackBonus':
    // TAX BONUS is offensive for the same reason: it reads the VICTIM's board
    // (how many of its cards carry a weight tax) and arms its bonus PER VICTIM,
    // so under `scope: 'all'` each foe is judged on its own backlog.
    case 'taxBonus':
    // DESPERATION reads the CASTER's own HP bar, so nothing about its condition
    // needs the victim — and it is STILL offensive, by kind, exactly as
    // `stackBonus` with `of: 'caster'` is. The reason is the same one stated
    // above and it is about the BONUS, not the read: the bonus lands on the
    // victim's hit, so under `scope: 'all'` it is delivered once per foe and has
    // to pay the AoE reach multiplier. Arming it per victim (`bonusByTarget`)
    // rather than as the scalar `bonusFlat` is what makes that price honest, and
    // is why desperation needs no AoE refusal while `shieldBurst`/`wardRelease` do.
    case 'desperation':
      return true;
    default:
      // heal, shield, buffStat, cleanse, taunt, lifesteal, comboBonus, thorns,
      // guard, negate, ward — none of these resolve against a foe. Nor do the
      // four CASTER-SIDE riders:
      //  • `shieldBurst` and `wardRelease` read AND SPEND a resource of the
      //    caster's own (plating / ward charges), so they must resolve on the
      //    caster and run EXACTLY ONCE per cast — a per-foe fan-out would drain
      //    the wall (or the charges) on the first foe and arm nothing for the
      //    rest. They therefore arm the cast's scalar `bonusFlat`, exactly like
      //    `comboBonus`, and an authored AoE + burst/release card is refused by
      //    `validateSkillContent` rather than priced.
      //  • `overhealShield` and `cleanseConvert` feed the cast's own HEAL, which
      //    is itself a support action — it already resolves once, on the support
      //    target, whatever the card's scope. There is no fan-out for them to be
      //    wrong about, hence no refusal needed either.
      return false;
  }
}

/** Pick the single offensive target among living foes per the caster's policy. */
function pickByPolicy(caster: CombatantState, living: CombatantState[]): CombatantState {
  // `living` is in ascending index order (foesOf preserves it), so strict
  // comparisons keep ties on the lowest index for free.
  switch (caster.targetPolicy) {
    case 'aggro': {
      let best = living[0]!;
      for (const f of living) if (f.aggro > best.aggro) best = f;
      return best;
    }
    case 'lowestHp': {
      let best = living[0]!;
      for (const f of living) if (f.stats.hp < best.stats.hp) best = f;
      return best;
    }
    case 'highestThreat': {
      let best = living[0]!;
      let bestPl = boardPowerLevel(best);
      for (const f of living) {
        const pl = boardPowerLevel(f);
        if (pl > bestPl) {
          best = f;
          bestPl = pl;
        }
      }
      return best;
    }
    case 'first':
    default:
      return living[0]!;
  }
}

/**
 * Support actions that auto-pick a recipient on the caster's OWN side (self
 * always a candidate). Everything else non-offensive stays on the caster:
 * shield/guard/negate/ward self-protect, and taunt/lifesteal/comboBonus are self
 * riders. Ally-shield is a future option (see resolveTargets).
 *
 * `ward` is deliberately ABSENT (self-only, exactly like negate): a ward is a
 * pre-emptive charge pile on its own holder, so handing it to an ally would make
 * it a second, differently-targeted keyword rather than negate's mirror.
 */
function isAllyTargetedSupport(action: Action): boolean {
  return action.kind === 'heal' || action.kind === 'cleanse' || action.kind === 'buffStat';
}

/** Negative-status kinds a `cleanse` can strip (never buff/guard/negate). */
function isCleansable(kind: StatusInstance['kind']): boolean {
  return (
    kind === 'poison' ||
    kind === 'burn' ||
    kind === 'bleed' ||
    kind === 'stun' ||
    kind === 'debuff' ||
    kind === 'expose'
  );
}

/**
 * Affliction kinds a `ward` charge can PREVENT: everything `isCleansable`
 * covers EXCEPT `stun`.
 *
 * WARD IS AN AILMENT SHIELD (user-locked 2026-08-17: "ward doesnt affect stun
 * its only meant for the dots debuff"). Its remit is the damage-over-time and
 * stat-debuff family — poison, burn, bleed, stat debuffs, expose: effects that
 * sit on you and grind you down. `stun` is a LOCKDOWN effect, a different class
 * of thing (it takes a performance away rather than afflicting the unit), and is
 * out of ward's scope by design.
 *
 * `isCleansable` is deliberately UNCHANGED — cleanse still strips stuns. The two
 * predicates sit side by side precisely so the one-kind difference reads as a
 * stated design rule rather than a mystery `!==` at a call site.
 *
 * A ward still can never consume ITSELF: 'ward' is not cleansable, so it is not
 * wardable either — this narrowing only removes a kind, never adds one.
 */
function isWardable(kind: StatusInstance['kind']): boolean {
  return isCleansable(kind) && kind !== 'stun';
}

/** Cleansable afflictions on a unit (what a `cleanse` would strip). */
function cleansableCount(c: CombatantState): number {
  let n = 0;
  for (const s of c.statuses) if (isCleansable(s.kind)) n += 1;
  return n;
}

/**
 * Deterministic ALLY-TARGET policy for a support action: pick ONE living unit
 * on the caster's side (self always a candidate). It's an AUTO-battle, so this
 * runs with no interactivity — pure integer math, no RNG. `teamOf` is
 * index-ascending and `.filter` preserves order, so strict comparisons keep
 * ties on the lowest LIVING index for free.
 */
function pickSupportTarget(state: CombatState, caster: CombatantState, action: Action): CombatantState {
  const allies = teamOf(state, caster.side).filter((a) => a.alive);
  if (allies.length === 0) return caster; // caster is living when it casts; defensive guard.
  switch (action.kind) {
    case 'heal': {
      // Lowest HP FRACTION (hp/maxHp) = most hurt. Compared by cross-multiplication
      // to keep it exact integer math (maxHp is always >= 1).
      let best = allies[0]!;
      for (const a of allies) {
        if (a.stats.hp * best.stats.maxHp < best.stats.hp * a.stats.maxHp) best = a;
      }
      return best;
    }
    case 'cleanse': {
      // Most cleansable statuses; if nobody is afflicted, fall back to self (no-op).
      let best = allies[0]!;
      let bestCount = cleansableCount(best);
      for (const a of allies) {
        const n = cleansableCount(a);
        if (n > bestCount) {
          best = a;
          bestCount = n;
        }
      }
      return bestCount === 0 ? caster : best;
    }
    case 'buffStat': {
      const stat = action.stat;
      // Offensive stats amplify the specialist (highest current value); defensive
      // stats reinforce the tank (highest aggro).
      const offensive = stat === 'attack' || stat === 'magicPower' || stat === 'speed';
      const metric = (a: CombatantState): number => (offensive ? effStat(a, stat) : a.aggro);
      const hasSameBuff = (a: CombatantState): boolean => a.statuses.some((s) => s.kind === 'buff' && s.stat === stat);
      // Prefer allies WITHOUT this buff (skip redundant overwrites); if EVERY ally
      // already has it, fall back to the same best-metric pick (refresh the best).
      let pool = allies.filter((a) => !hasSameBuff(a));
      if (pool.length === 0) pool = allies;
      let best = pool[0]!;
      for (const a of pool) if (metric(a) > metric(best)) best = a;
      return best;
    }
    default:
      return caster;
  }
}

/**
 * Resolve the targets of one action.
 *
 * Support actions: ally-targeted ones (heal/cleanse/buffStat) auto-pick the best
 * recipient on the CASTER'S side via `pickSupportTarget` (self is always a
 * candidate); shield/guard/negate/ward and self riders stay on the caster.
 * Ally-shield is a deliberate future option — a unit self-protects for now.
 *
 * Offensive actions hit foes: `scope: 'all'` = every living foe (ascending
 * index); otherwise the ONE foe chosen by `focus` (when that unit is living)
 * else `targetPolicy`. All deterministic — no RNG, computed from current state.
 *
 * 1v1 byte-identical: in SOLO/1v1 the only same-side candidate is the caster, so
 * `pickSupportTarget` returns the caster and support behavior is unchanged. For
 * foes, the sole foe is returned when living, and — matching the old
 * `foesOf(state, caster)[0]` behavior — the (dead) foe is still returned as a
 * no-op fallback when it is the only foe and has died mid-cast, matching the
 * historical fan-out order.
 */
export function resolveTargets(
  ctx: Ctx,
  caster: CombatantState,
  skill: SkillDef,
  action: Action,
): CombatantState[] {
  if (!isOffensiveAction(action)) {
    if (isAllyTargetedSupport(action)) return [pickSupportTarget(ctx.state, caster, action)];
    return [caster];
  }
  const foes = foesOf(ctx.state, caster);
  const living = foes.filter((f) => f.alive);
  // AoE: all living foes, ascending index. Asked through `isMultiTargetSkill`
  // (types.ts) rather than comparing `scope` here, so THIS fan-out and every
  // rule written against "hits more than one target" (the splash gate in
  // cards.ts) read one definition of the concept — see that function.
  if (isMultiTargetSkill(skill)) return living;
  if (living.length === 0) return foes.length > 0 ? [foes[0]!] : [];
  if (caster.focus !== undefined) {
    const focused = living.find((f) => f.index === caster.focus);
    if (focused) return [focused];
  }
  return [pickByPolicy(caster, living)];
}

/**
 * ROLE-BASED STAT SCALING (user-approved 2026-08-04). A card's `property` picks
 * WHICH stat scales its output; the ROLE of the action picks WHICH SIDE of the
 * stat sheet that lookup reads. Two rules, one sibling each, side by side:
 *
 *   `scaleStat`    — OFFENSE (damage).  physical → Attack, magical → Magic
 *                    Power, TRUE → the higher of the two.
 *   `scaleDefStat` — DEFENSE (shield / heal). physical → Armor, magical →
 *                    Magic Resist, TRUE → 0 (flat by identity, see below).
 *
 * WHY defense scales off defensive stats: with one offense-only rule every
 * power-bearing action read Attack/Magic Power, so DEF/MDEF were mitigation-only
 * and a tank's best SHIELD stat was Attack — a card could honestly print
 * "SHIELD 12 +ATK". Defensive stats now buy defensive output. This is
 * PL-NEUTRAL, not a buff: attack / magicPower / armor / magicResist all cost 1
 * PL per +1 and all start at 1 (`LEVEL_STAT_COST`, `BASE_HERO_STATS` in
 * src/run/leveling.ts), so the output bought per PL spent is unchanged — only
 * WHICH stat buys it moves. No prices in src/engine/balance.ts change.
 *
 * A future third role is one more sibling here, never a branch at a call site.
 */

/** OFFENSE scaling stat: Attack / Magic Power / higher of the two. */
function scaleStat(c: CombatantState, property: Property): number {
  switch (property) {
    case 'physical':
      return effStat(c, 'attack');
    case 'magical':
      return effStat(c, 'magicPower');
    case 'true':
      return Math.max(effStat(c, 'attack'), effStat(c, 'magicPower'));
  }
}

/**
 * DEFENSE scaling stat (shield / heal): Armor / Magic Resist.
 *
 * Returns 0 for TRUE — mirroring `mitigation()` below, which returns 0 for the
 * same reason: TRUE defensive output is FLAT BY IDENTITY. A TRUE shield or TRUE
 * heal has no stat term at all, so there is no "higher of the two" case to
 * define (unlike TRUE damage, which has one). Callers may therefore hand this
 * any property without a TRUE branch of their own.
 */
function scaleDefStat(c: CombatantState, property: Property): number {
  switch (property) {
    case 'physical':
      return effStat(c, 'armor');
    case 'magical':
      return effStat(c, 'magicResist');
    case 'true':
      return 0;
  }
}

/**
 * MULTI-HIT STAT SPLIT (user-locked 2026-08-07) — WHICH damage action of a cast
 * this is, and how many the cast carries in total. The caster's scaling stat is
 * a PER-CAST resource, not a per-action one: a cast that hits N times delivers
 * the SAME total stat as a cast that hits once, split across its hits.
 *
 * WHY: before this rule every `damage` action added the caster's FULL Attack /
 * Magic Power, so a 2-hit card delivered 2× the stat of a 1-hit card and a
 * 3-hit card 3×. That made multi-hit scale SUPERLINEARLY with hero stats while
 * `powerLevelDeci` priced only the summed flat base plus a FLAT
 * `PRICE.extraHitPremium` — a fixed price against an effect whose value grew
 * without bound with hero level (at ATK 50 an extra hit shipped ~50 unpriced
 * damage for a 3 PL charge). Splitting the stat makes the stat term
 * HIT-COUNT-INVARIANT, so a flat premium can price the remaining (flat-base and
 * per-hit-mitigation) differences honestly.
 *
 * `count` is the number of the CARD'S OWN `damage` actions. GEM-APPENDED hits
 * are deliberately EXCLUDED from the divisor (user-locked 2026-08-07): a socket
 * must never make the host card's own hit smaller. Were an appended hit counted,
 * it would take a share of the stat away from the base hit AND eat a second
 * round of armor mitigation with it — measured at −4 damage on `sword_slash` at
 * DEF 8 and −9 at DEF 16, i.e. a "+damage" gem that made you deal LESS. A gem's
 * hit is self-contained instead: its own payload, no share of the pool, no
 * attacker-side bonus (see `GemAppended`). The core loop stays feature-agnostic
 * — it reads one provenance flag the resolver stamped; it does not know what a
 * gem is.
 */
export interface HitSplit {
  /** 0-based ordinal among the cast's `damage` actions (effect-list order). */
  index: number;
  /** How many `damage` actions the cast carries (>= 1). */
  count: number;
}

/** The only split a non-damage action (or a single-hit cast) ever needs. */
const SINGLE_HIT: HitSplit = { index: 0, count: 1 };

/**
 * This hit's INTEGER share of a per-cast stat pool.
 *
 * Exact by construction: shares sum to EXACTLY `stat` for any `count >= 1` and
 * any sign of `stat` — `base = floor(stat / count)` and
 * `remainder = stat - base * count` always lands in `[0, count)`, so handing
 * one extra point to the FIRST `remainder` hits distributes the whole pool and
 * never one point more. No floats persist; nothing is re-floored downstream.
 *
 * ROUNDING (locked): the remainder is FRONT-LOADED — earlier hits are the
 * bigger ones. Two reasons: (a) a cast can stop early when its target side is
 * wiped (`applyCast`'s first-to-fall break), so the share most likely to
 * actually land carries the odd point; (b) each hit is mitigated separately and
 * floored at 1 damage, so a front-loaded remainder is the friendlier side of
 * the rounding against armor.
 *
 * At `count === 1` this returns `stat` unchanged, so every single-hit card in
 * the book — the overwhelming majority — is byte-identical to the pre-split
 * engine. A tiny stat CAN leave a late hit with a 0 share (ATK 1 over 2 hits is
 * 1 and 0; one point cannot be split in integers): the cast's TOTAL stat is
 * still exactly 1, the card's flat base still applies, and `dealDamage`'s
 * minimum-1 clamp still guarantees the hit lands for at least 1.
 */
export function statShare(stat: number, hit: HitSplit): number {
  if (hit.count <= 1) return stat;
  const base = Math.floor(stat / hit.count);
  const remainder = stat - base * hit.count;
  return base + (hit.index < remainder ? 1 : 0);
}

/**
 * The split's denominator: how many `damage` actions the CARD ITSELF carries.
 * Gem-appended hits are skipped (see `HitSplit`), so socketing a gem never
 * shrinks the host card's own hit. `statStrike` never enters the divisor
 * either — its payload is derived independently, not carved out of the pool.
 */
function countDamageActions(effects: readonly Action[]): number {
  let n = 0;
  for (const action of effects) if (action.kind === 'damage' && !action.fromGem) n += 1;
  return n;
}

/**
 * The CARD'S OWN flat damage base: the summed `power` of exactly the actions
 * `countDamageActions` counts — its `damage` actions, GEM-APPENDED ones excluded.
 * The two are deliberate siblings: the divisor asks HOW MANY own hits the card
 * has, this asks HOW BIG they are, and both must read the same set or a socket
 * could see itself (an `echoHostPower` strike echoing its own echo).
 *
 * SUMMED, not per-hit, so it is HIT-COUNT-INVARIANT: Twin Slash's 6 + 6 is one
 * base of 12, exactly as its stat term is one pool split two ways. A card with no
 * `damage` action of its own returns 0, so an echo socketed on a heal or a shield
 * card degrades gracefully to a plain stat strike rather than misbehaving.
 *
 * Derived from the RESOLVED effect list at cast time, like the divisor beside it
 * — no state, no RNG, integer-only.
 */
export function ownDamagePower(effects: readonly Action[]): number {
  let total = 0;
  for (const action of effects) if (action.kind === 'damage' && !action.fromGem) total += action.power;
  return total;
}

/**
 * Apply a decaying DoT (user-locked 2026-07-20): one pile per kind per
 * victim — a new application MERGES its stacks into the existing pile
 * (keeping the pile's tick schedule and re-attributing to the newest
 * source); otherwise a fresh pile is created that skips ticking on its
 * application turn. Exact printed stacks: no stat scaling, no matchup.
 */
function applyDot(ctx: Ctx, target: CombatantState, kind: 'poison' | 'burn' | 'bleed', stacks: number, property: Property): void {
  if (!target.alive || stacks <= 0) return;
  const pile = target.statuses.find((s) => s.kind === kind);
  if (pile) {
    // WARD taxes a MERGE exactly as `addStatus` taxes a fresh application, and
    // for the same price: ONE charge cancels ONE whole application. Without this
    // the keyword half-worked depending on application ORDER — a ward denied an
    // affliction the holder did not yet have, and did nothing about a top-up of
    // one they did, i.e. it was weakest precisely when a player would reach for
    // it. Prevention, not removal: the standing pile below is left untouched
    // (same stacks, same schedule, still ticking) — only the INCOMING stacks are
    // denied, and no `statusApplied` is emitted for them.
    if (consumeWard(ctx, target, kind)) return;
    pile.stacks = (pile.stacks ?? 0) + stacks;
    pile.turnsLeft = pile.stacks;
    pile.source = ctx.source;
    ctx.events.push({
      turn: ctx.state.turn,
      kind: 'statusApplied',
      side: target.side,
      unit: target.index,
      status: kind,
      property,
      stacks: pile.stacks,
      turns: pile.turnsLeft,
    });
    return;
  }
  addStatus(ctx, target, { kind, property, stacks, turnsLeft: stacks, fresh: true, source: ctx.source });
}

function scalingStatName(c: CombatantState, property: Property): 'attack' | 'magicPower' {
  if (property === 'magical') return 'magicPower';
  if (property === 'physical') return 'attack';
  return effStat(c, 'attack') >= effStat(c, 'magicPower') ? 'attack' : 'magicPower';
}

/**
 * Flat defense against a property. Returns 0 for TRUE: the direct-damage
 * path applies TRUE's own rule there (defense vs the stat add only).
 */
function mitigation(c: CombatantState, property: Property): number {
  switch (property) {
    case 'physical':
      return effStat(c, 'armor');
    case 'magical':
      return effStat(c, 'magicResist');
    case 'true':
      return 0;
  }
}

/**
 * Consume typed shield pools for incoming damage: the matching pool first,
 * then the true pool. True damage is only ever blocked by true shields,
 * point-for-point. Typed (physical/magical) damage that spills into the
 * true pool is blocked at HALF effectiveness (user-locked 2026-07-20):
 * every point blocked drains 2 points of true shield. The whole pool is
 * spent before damage passes through — a dangling odd point still drains
 * but blocks nothing (floor), keeping the state integer-only.
 *
 * Returns the damage `blocked` PLUS the points actually REMOVED from each pool
 * (`drain`). For the true pool those differ: a typed hit spends 2 true points
 * per point blocked, so `drain.true` is the inflated spend, not the block.
 * Arithmetic (and its Math.min/floor order) is unchanged by this bookkeeping.
 */
function consumeShields(
  c: CombatantState,
  property: Property,
  amount: number,
): { blocked: number; drain: Record<Property, number> } {
  let blocked = 0;
  const drain: Record<Property, number> = { physical: 0, magical: 0, true: 0 };
  if (property !== 'true') {
    const pool = Math.min(c.shields[property], amount);
    c.shields[property] -= pool;
    drain[property] += pool;
    blocked += pool;
    amount -= pool;
    const trueSpent = Math.min(c.shields.true, amount * 2);
    c.shields.true -= trueSpent;
    drain.true += trueSpent;
    blocked += Math.floor(trueSpent / 2);
    return { blocked, drain };
  }
  const truePool = Math.min(c.shields.true, amount);
  c.shields.true -= truePool;
  drain.true += truePool;
  blocked += truePool;
  return { blocked, drain };
}

/** −20% healing per affliction category present on the receiver. */
export const ANTI_HEAL_PCT_PER_CATEGORY = 20;
/** All three categories at once: the hard cap of the world rule. */
export const ANTI_HEAL_MAX_PCT = ANTI_HEAL_PCT_PER_CATEGORY * 3;

/**
 * ANTI-HEAL WORLD RULE (user-locked 2026-08-01). Which affliction FAMILIES are
 * active on a heal RECEIVER, evaluated fresh at the moment healing lands — so a
 * `cleanse` restores heal potency for free (no bookkeeping: the categories are
 * simply gone next time a heal resolves).
 *
 * Exactly three categories, returned in this FIXED order (determinism):
 *  1. `dot`    — ANY active poison/burn/bleed pile; the whole family counts ONCE.
 *  2. `debuff` — ANY active stat debuff.
 *  3. `expose` — ANY active expose.
 * Stun is NOT an affliction here, and shields are not afflictions at all.
 */
export function antiHealCategories(c: CombatantState): AntiHealCategory[] {
  const found: AntiHealCategory[] = [];
  let dot = false;
  let debuff = false;
  let expose = false;
  for (const s of c.statuses) {
    if ((s.kind === 'poison' || s.kind === 'burn' || s.kind === 'bleed') && (s.stacks ?? 0) > 0) dot = true;
    else if (s.kind === 'debuff') debuff = true;
    else if (s.kind === 'expose') expose = true;
  }
  if (dot) found.push('dot');
  if (debuff) found.push('debuff');
  if (expose) found.push('expose');
  return found;
}

/**
 * Tax a REGULAR heal request by the anti-heal world rule.
 *
 * ROUNDING (locked): `reduced = floor(request * pct / 100)`, and the heal that
 * lands is `request - reduced`. The REDUCTION is floored (the mirror of how
 * `expose` floors its amplification and `guard` floors its cut), which rounds
 * the surviving heal UP — so a positive heal can never be zeroed by this rule
 * (pct <= 60 ⇒ reduced < request for every request >= 1). Boundary values:
 * request 1-4 at −20% lose 0, request 5 loses 1; request 1 at −60% loses 0,
 * request 2 loses 1.
 *
 * TRUE heals never reach here — they are flat and irreducible by identity.
 * Shield GAINS are not healing and are untouched.
 */
function applyAntiHeal(target: CombatantState, request: number): { amount: number; antiHeal?: AntiHealReduction } {
  if (request <= 0) return { amount: request };
  const categories = antiHealCategories(target);
  if (categories.length === 0) return { amount: request };
  const pct = Math.min(ANTI_HEAL_MAX_PCT, categories.length * ANTI_HEAL_PCT_PER_CATEGORY);
  const reduced = Math.floor((request * pct) / 100);
  if (reduced <= 0) return { amount: request };
  return { amount: request - reduced, antiHeal: { categories, pct, reduced } };
}

/**
 * THE ONE PLACE HP IS RESTORED — every healing path (`heal`, `lifesteal`, and
 * any future one) goes through it, exactly as every damage path goes through
 * `dealDamage`. That is the point: the safety rules live at the seam, not in
 * each arm.
 *
 * A HEAL IS NEVER A DAMAGE SOURCE. A request that resolves NEGATIVE is CLAMPED
 * TO ZERO and nothing is applied. Negative requests are reachable without anyone
 * authoring a negative `power`: the heal arm computes `power + statBonus +
 * healFlat`, and `healFlat` is an aura modifier that may be negative, while
 * `applyAntiHeal` passes any request <= 0 straight through untouched. Before the
 * clamp that arithmetic ran unfloored into `hp + amount`, which drove HP below
 * ZERO with `alive` still true and emitted NOTHING (the event is gated on
 * `amount > 0`) — breaking the `alive <=> hp > 0` invariant that `stepEntryOf`
 * and `pickSupportTarget` both rely on, and hiding it from the log the UI
 * replays.
 *
 * WHY CLAMP RATHER THAN DEAL THE DIFFERENCE AS DAMAGE: making a heal able to
 * hurt would be a NEW MECHANIC — a damage source with no property, no
 * mitigation, no matchup, no shield interaction, no negate/thorns/expose hook and
 * no price in `PRICE`. "Anti-heal" already exists as a priced, typed concept
 * (`applyAntiHeal`, capped at −60% and never able to zero a positive heal). A
 * clamp is the conservative reading of the same intent: a heal that has been
 * reduced past nothing simply heals nothing.
 *
 * With the clamp, HP can never DECREASE here, so no death check is needed on
 * this path — the invariant holds by construction, mirroring `dealDamage`'s
 * `Math.max(0, ...)` floor on the way down. Integer-only, no RNG.
 *
 * Returns `applied` (the clamped request, i.e. what the card attempted) and
 * `healed` (the HP that actually moved); `applied - healed` is the overheal.
 */
function restoreHp(target: CombatantState, request: number): { applied: number; healed: number } {
  const applied = Math.max(0, request);
  const before = target.stats.hp;
  target.stats.hp = Math.min(target.stats.maxHp, before + applied);
  return { applied, healed: target.stats.hp - before };
}

/** Per-cast scratch state for rider actions (combo bonus, lifesteal). */
interface CastCtx {
  damageDealt: number;
  /**
   * FLAT damage added by a triggered comboBonus this cast — ONE bonus per cast,
   * SPENT by the first `damage` action that reads it (see `readsComboBonus` and
   * its call site in `applyCast`). It used to be accumulated and never cleared
   * while the `damage` arm's `flatBonus` read it unconditionally, so every own
   * damage action of a multi-hit host collected the whole bonus again:
   * Follow-Through Echo's +16 landed +16 ON EACH of Barrage's / Rapid Volley's /
   * Twin Slash's hits (+32 delivered for a 16-priced, "+16"-printed effect), and
   * a base card authoring `comboBonus` alongside two damage actions would have
   * done exactly the same.
   *
   * ALSO ARMED BY `shieldBurst` and `wardRelease` — the two riders whose resource
   * is the CASTER's own (its shield pools / its ward charges), so they resolve once
   * on the caster and have no victim to index by. Same field, same one-per-cast
   * spend rule; they all accumulate if a card ever carries several.
   */
  bonusFlat: number;
  /**
   * FLAT damage armed PER VICTIM by a CONDITIONAL rider this cast (`exploit`,
   * `stackBonus`, `taxBonus`, `desperation`), indexed by the victim's lineup index. Sparse: only
   * foes a rider actually armed appear, and a cast with no such rider never writes
   * it, which is what keeps every existing card byte-identical.
   *
   * PER VICTIM, unlike `bonusFlat`, because the CONDITION is per victim: under
   * `scope: 'all'` one foe may be poisoned and another not, and an exploit that
   * paid out against the whole team because a single foe was afflicted would be
   * team-wide damage bought at a single-target condition. (Offensive actions
   * only ever resolve against foes — one side — so a lineup index identifies the
   * victim uniquely.) Spent on exactly the same schedule as `bonusFlat`: the
   * first non-gem `damage` action of the cast reads it and `applyCast` clears
   * it, so one cast pays one bonus however many hits it splits into.
   */
  bonusByTarget: number[];
  /**
   * THE HEAL-SIDE MIRROR OF `bonusFlat` — flat bonus HEALING armed by a rider this
   * cast (today only `cleanseConvert`), SPENT by the first own `heal` action that
   * reads it (`readsCastHealBonus`, cleared at the same place and on the same
   * schedule `bonusFlat` is).
   *
   * A SEPARATE FIELD, deliberately, rather than routing a heal rider through
   * `bonusFlat`: that field is read by the `damage` arm, and a heal bonus landing
   * there would either be spent as damage by any hit on the same card or be a
   * silent no-op on a card with no hit. The two currencies do not share a pocket.
   * Everything else about it is `bonusFlat`'s contract verbatim — one number per
   * cast, however many heals the card splits into, because the face prints one
   * number.
   *
   * It joins the heal REQUEST (before anti-heal and before the maxHp clamp), so it
   * is taxed and wasted exactly like the card's own base — see the `heal` arm.
   */
  healBonusFlat: number;
  /**
   * How much of this cast's HEAL OVERFLOW may bank as plating — armed by
   * `overhealShield` (accumulating, if a card ever carries two) and spent by the
   * first own `heal` action, cleared beside `healBonusFlat`.
   *
   * A CAP, NOT A PAYLOAD: the rider does not know how much will overflow, so what
   * it arms is permission up to `cap`. The `heal` arm converts
   * `min(applied − healed, this cap, shield room)`.
   */
  overhealShieldCap: number;
  /**
   * STACKS THIS CAST'S OWN `cleanse` ACTUALLY REMOVED — the same number the
   * `cleansed` event reports, summed over every cleanse action of the cast. Read by
   * `cleanseConvert`, which is why the validator requires a `cleanse` to sit ahead
   * of that rider: a rider that runs first reads 0 and pays nothing.
   *
   * NOT CLEARED WHEN READ, unlike the bonus fields. A cleanse result is a FACT
   * about the cast, not a one-shot allowance — two `cleanseConvert` riders on one
   * card are two separately-priced conversions of the same fact, and each is
   * capped on its own. (The bonuses they arm are still spent once each, by the
   * heal, through `healBonusFlat`.)
   */
  cleansedStacks: number;
  /**
   * DOES THIS CAST CARRY A `splash`? Read ONCE from the effective effect list
   * when the cast opens (`castSpreadsBand`), and consulted by every
   * CARD-TARGETING arm (`burden`, `curse`) to choose between the anchor alone
   * and the whole band (`cardTargetPieces`, combat/splash.ts).
   *
   * CAST-SCOPED RATHER THAN POSITIONAL, deliberately. The alternative — letting
   * a `splash` action flip a flag as the loop walks past it — would make the
   * keyword's meaning depend on list order, and a GEM's actions are spliced
   * AFTER the host's (`GEM_ACTION_PHASE`, cards.ts): a splash gem would then
   * spread nothing on a burden host, which is precisely the socket the gem
   * exists for. One flag, computed before anything resolves, makes the rule
   * "this cast spreads" instead of "everything after this line spreads".
   */
  spreadsBand: boolean;
}

/**
 * Does this effect list carry the `splash` SPREADER? Asked once per cast (see
 * `CastCtx.spreadsBand`) against the EFFECTIVE list, so a gem-appended splash
 * counts exactly like an authored one.
 *
 * Indexed walk, no Set: the answer must be a pure function of the array.
 */
function castSpreadsBand(effects: readonly Action[]): boolean {
  for (let i = 0; i < effects.length; i += 1) {
    if (effects[i]!.kind === 'splash') return true;
  }
  return false;
}

/**
 * ARM a conditional rider's flat bonus against ONE victim (see
 * `CastCtx.bonusByTarget`). ACCUMULATES, so a card carrying two riders (exploit
 * poison + exploit bleed, say) delivers both when both conditions hold — which
 * is how they are priced, additively, one term each. (`shieldBurst` does not come
 * through here: its resource is the caster's own, so it arms the scalar
 * `bonusFlat` — see its arm in `applyAction`.)
 */
function armTargetBonus(cast: CastCtx, victim: CombatantState, amount: number): void {
  if (amount <= 0) return;
  cast.bonusByTarget[victim.index] = (cast.bonusByTarget[victim.index] ?? 0) + amount;
}

/**
 * Does this action READ (and therefore SPEND) the cast's armed bonuses — the
 * `comboBonus` scalar AND the per-victim `exploit`/`stackBonus` bonuses? Exactly
 * the `damage` arm's own condition — a GEM-APPENDED hit is self-contained and
 * takes no attacker-side bonus (`GemAppended` in types.ts), and `statStrike`
 * explicitly takes none either — so the arm and the clear-point can never
 * disagree about what a bonus was spent on.
 */
function readsCastBonus(action: Action): boolean {
  return action.kind === 'damage' && action.fromGem !== true;
}

/**
 * The HEAL-side twin: does this action READ (and therefore SPEND) the cast's armed
 * heal bonus and its overheal-shield allowance (`healBonusFlat` /
 * `overhealShieldCap`)? Exactly the `heal` arm's own condition, and the `fromGem`
 * exclusion is the same rule for the same reason — a gem heal delivers exactly its
 * printed `power`, with no stat term, no aura term and so no host-side rider bonus
 * either (`GemAppended` in types.ts).
 */
function readsCastHealBonus(action: Action): boolean {
  return action.kind === 'heal' && action.fromGem !== true;
}

/**
 * Apply damage through typed shields; emits events, marks death.
 *
 * RETURNS WHETHER THE HIT TOOK EFFECT — `true` when a `damage` event was
 * emitted, `false` when the application was skipped (dead victim, non-positive
 * amount) or FULLY NULLIFIED by a `negate` charge. Callers that must not run a
 * consequence of a hit that never landed read this instead of assuming control
 * returning means damage happened; `reflectThorns` is the first such caller (a
 * negated hit used to still spend one of the victim's thorn stacks, contradicting
 * both docstrings: thorns fires when a hit LANDS, negate FULLY nullifies).
 *
 * A hit fully absorbed by SHIELDS still returns `true` — deliberately. It landed
 * on the unit and spent its plating; only negate makes a hit not happen at all.
 * Every existing caller that ignores the return value is unaffected.
 */
export function dealDamage(
  ctx: Ctx,
  victim: CombatantState,
  amount: number,
  property: Property,
  opts: {
    bypassShields?: boolean;
    matchup?: Matchup;
    source?: 'skill' | 'poison' | 'burn' | 'bleed' | 'thorns' | 'fatigue' | 'attrition';
    calculation?: Omit<DamageCalculation, 'guardReduction' | 'exposeBonus' | 'shieldBlocked' | 'hpDamage'>;
  } = {},
): boolean {
  if (!victim.alive || amount <= 0) return false;
  const source = opts.source ?? 'skill';

  // Magical Negate: a direct skill hit whose property matches an available
  // negate charge is fully nullified and spends one charge. DoT ticks and
  // fatigue never consume a charge; negation happens before any guard, shield
  // or HP math and returns immediately.
  if (source === 'skill') {
    const neg = victim.statuses.find((s) => s.kind === 'negate' && s.property === property && (s.charges ?? 0) > 0);
    if (neg) {
      neg.charges = (neg.charges ?? 0) - 1;
      if ((neg.charges ?? 0) <= 0) victim.statuses = victim.statuses.filter((s) => s !== neg);
      ctx.events.push({ turn: ctx.state.turn, kind: 'negated', side: victim.side, unit: victim.index, property });
      return false; // the hit did not happen: no HP math, and no thorns reflect
    }
  }

  // Magical Guard: multiplicative %-reduction per matching-property guard,
  // applied in statuses-array order (deterministic), floored, min 1 each.
  // THIS LOOP IS NOT BOUNDED: nothing caps the number of same-property piles a
  // unit may hold (user-locked 2026-08-20 — see `applyAction`'s `guard` arm),
  // so mitigation approaches, but by the min-1 floor below never reaches, 100%.
  // Deep stacks are a legal build, not a bug; attrition's TRUE damage is what
  // stops a wall from being unkillable.
  // Runs AFTER the caller's flat-MR/matchup/SD math and BEFORE shields, for
  // EVERY source — not just `skill`. True damage never matches a typed guard;
  // matching-property DoTs are covered, and so is a THORNS REFLECT, which is
  // physical since 2026-08-21 (it used to be TRUE and therefore unguardable —
  // see `reflectThorns`). Only `negate` and `expose` below are `skill`-only.
  let reduced = amount;
  let guarded = 0;
  for (const s of victim.statuses) {
    if (s.kind !== 'guard' || s.property !== property) continue;
    const after = Math.max(1, Math.floor((reduced * (100 - (s.pct ?? 0))) / 100));
    guarded += reduced - after;
    reduced = after;
  }

  // Expose: the mirror of guard. Amplifies a DIRECT hit (source `skill`) by
  // +pct% of the STRONGEST standing expose, floored. Runs right after guard
  // reduction and before shields. DoT ticks (poison / burn / bleed) and fatigue
  // never trigger expose — only direct skill hits.
  //
  // MAX, NOT SUM (2026-08-18) — applications no longer merge into one pile (see
  // the `expose` arm of `applyAction` for the whole rule), so several can stand
  // at once, and compounding them would accelerate without bound and break
  // expose's parity pricing against `guard`. A victim carrying exactly one pile
  // — every case that existed before this change — is byte-identical. Indexed
  // scan, no RNG, integer-only.
  let exposed = 0;
  if (source === 'skill') {
    let strongestPct = 0;
    for (let i = 0; i < victim.statuses.length; i += 1) {
      const s = victim.statuses[i]!;
      if (s.kind !== 'expose') continue;
      const p = s.pct ?? 0;
      if (p > strongestPct) strongestPct = p;
    }
    if (strongestPct > 0) {
      exposed = Math.floor((reduced * strongestPct) / 100);
      reduced += exposed;
    }
  }

  const absorb = opts.bypassShields
    ? { blocked: 0, drain: { physical: 0, magical: 0, true: 0 } as Record<Property, number> }
    : consumeShields(victim, property, reduced);
  const blocked = absorb.blocked;
  const remaining = reduced - blocked;
  victim.stats.hp = Math.max(0, victim.stats.hp - remaining);
  ctx.events.push({
    turn: ctx.state.turn,
    kind: 'damage',
    side: victim.side,
    unit: victim.index,
    amount: reduced,
    property,
    blocked,
    // Per-pool bookkeeping: only meaningful when a shield actually absorbed.
    ...(blocked > 0 ? { shieldDrain: { ...absorb.drain } } : {}),
    matchup: opts.matchup === 'advantage' || opts.matchup === 'disadvantage' ? opts.matchup : undefined,
    guarded: guarded > 0 ? guarded : undefined,
    exposed: exposed > 0 ? exposed : undefined,
    hpAfter: victim.stats.hp,
    source,
    ...(ctx.source ? { sourceCard: ctx.source } : {}),
    ...(opts.calculation
      ? {
          calculation: {
            ...opts.calculation,
            guardReduction: guarded,
            ...(exposed > 0 ? { exposeBonus: exposed } : {}),
            shieldBlocked: blocked,
            hpDamage: remaining,
          },
        }
      : {}),
  });
  if (victim.stats.hp === 0) {
    victim.alive = false;
    ctx.events.push({ turn: ctx.state.turn, kind: 'died', side: victim.side, unit: victim.index });
  }
  return true;
}

/**
 * Does the CASTER carry the affinity matching this card's own type?
 *
 * The gate for `affinityStrike`. `cardType` is the one notion of a card's type
 * the rest of the system uses (element if present, else weapon), and a
 * combatant's affinity is either authored (enemies) or derived from Board Type
 * Identity (heroes) — see `initCombatant`. A typeless card can never open the
 * gate; `validateSkillContent` refuses to author one, and returning false here
 * makes the engine safe against a bespoke test book that does.
 */
function affinityOpen(caster: CombatantState, skill: SkillDef): boolean {
  const type = cardType(skill);
  if (type === undefined) return false;
  return type.kind === 'element'
    ? caster.elementAffinity === type.type
    : caster.weaponAffinity === type.type;
}

/** Element wheel (magical) / weapon triangle (physical) result for a card vs a defender. */
export function cardMatchup(skill: SkillDef, defender: CombatantState): Matchup {
  if (skill.property === 'magical') return elementMatchup(skill.element, defender.elementAffinity);
  if (skill.property === 'physical') return weaponMatchup(skill.weapon, defender.weaponAffinity);
  return 'neutral';
}

/**
 * WARD CONSUMPTION — the affliction mirror of the `negate` check in `dealDamage`.
 * THE single implementation, called from BOTH application paths (`addStatus` for
 * a fresh pile, `applyDot` for a merge into a standing one) so a future fix can
 * never land on only one of them.
 *
 * Spend ONE ward charge to cancel one whole affliction APPLICATION, whatever its
 * stack count and WHETHER OR NOT the victim already carries a pile of that kind:
 * a poison-5 costs one charge, not five, and a poison-5 merging into a standing
 * poison-3 also costs exactly one (see the `ward` docs in types.ts — that is the
 * negate parallel, deliberately unlike `cleanse`, which pays per stack). Returns
 * true when the application was prevented, in which case the caller must NOT
 * apply it: no push, no merge, and no `statusApplied`.
 *
 * WARD PREVENTS, IT DOES NOT CLEANSE. A prevented MERGE leaves the standing pile
 * exactly as it was — same stacks, same tick schedule, same attribution. The
 * charge buys "none of the incoming stacks land", never "the old ones go away".
 *
 * Only `isWardable` kinds get here, which is what makes ward unable to block
 * buffs, unable to deny a `stun` (out of an ailment shield's remit — see
 * `isWardable`) AND unable to consume ITSELF: ward is not cleansable, so it is
 * not wardable, and no self-reference check is needed because the gate already
 * excludes it.
 *
 * Deterministic: `statuses` is walked BY INDEX and the FIRST ward with charges
 * wins, so co-existing wards are spent in a fixed, lowest-index-first order. No
 * RNG, integer-only.
 */
function consumeWard(ctx: Ctx, target: CombatantState, kind: StatusInstance['kind']): boolean {
  if (!isWardable(kind)) return false;
  for (let i = 0; i < target.statuses.length; i += 1) {
    const ward = target.statuses[i]!;
    if (ward.kind !== 'ward' || (ward.charges ?? 0) <= 0) continue;
    const left = (ward.charges ?? 0) - 1;
    ward.charges = left;
    ctx.events.push({
      turn: ctx.state.turn,
      kind: 'warded',
      side: target.side,
      unit: target.index,
      status: kind,
      chargesLeft: left,
    });
    if (left <= 0) {
      target.statuses = target.statuses.filter((s) => s !== ward);
      ctx.events.push({ turn: ctx.state.turn, kind: 'statusExpired', side: target.side, unit: target.index, status: 'ward' });
    }
    return true;
  }
  return false;
}

/**
 * The application point for a FRESH status pile — every affliction that lands on
 * a unit for the first time passes through here, which is why the WARD hook
 * lives here rather than in each offensive arm. `applyDot`'s MERGE path is the
 * only other way an affliction reaches a unit, and it calls `consumeWard`
 * itself; between them the hook covers every application, in either order.
 */
function addStatus(ctx: Ctx, target: CombatantState, status: StatusInstance): void {
  if (!target.alive) return;
  if (consumeWard(ctx, target, status.kind)) return;
  target.statuses.push(status);
  ctx.events.push({
    turn: ctx.state.turn,
    kind: 'statusApplied',
    side: target.side,
    unit: target.index,
    status: status.kind,
    property: status.property,
    stat: status.stat,
    pct: status.pct,
    amount: status.amount,
    stacks: status.stacks,
    turns: status.turnsLeft,
    charges: status.charges,
  });
}

/**
 * The ATTACKER-SIDE parts of one hit, before any defender-side or world-rule
 * maths. Every damage-dealing action reduces to these four numbers and then
 * runs the SAME pipeline (`applyStrike`), so the TRUE rule, the mitigation
 * order, the floors and the reported `calculation` exist in exactly one place.
 */
interface StrikeParts {
  /** The card's own FLAT base. 0 for a `statStrike`, which has no base. */
  power: number;
  /** This hit's stat term off the caster's RAW stat sheet (what the card promises). */
  baseStat: number;
  /** The same term off the caster's BUFFED stats (what actually lands). */
  effectiveStat: number;
  /** Flat attacker-side adds: aura / card-scope gem `damageFlat` + a triggered combo. */
  flatBonus: number;
}

/**
 * Resolve one hit from its attacker-side parts: apply the property's defense
 * rule, the weapon/element matchup, the sudden-death ramp and the floors, then
 * hand the result to `dealDamage` with the derivation the log prints.
 *
 * The reported parts telescope by construction —
 * `baseDamage + statBonusDamage + effectBonusDamage = power + effectiveStat +
 * flatBonus` — for any caller, which is what lets a `statStrike` (power 0) and
 * an ordinary `damage` action share one renderer.
 */
function applyStrike(
  ctx: Ctx,
  caster: CombatantState,
  skill: SkillDef,
  cast: CastCtx,
  enemy: CombatantState,
  parts: StrikeParts,
): void {
  const property = skill.property;
  const scalingStat = scalingStatName(caster, property);
  const { power, baseStat, effectiveStat, flatBonus } = parts;
  const baseDamage = power + baseStat;
  const scaledDamage = power + effectiveStat;
  // Scaled base + flat aura/gem/combo bonus. There is no percent same-type
  // bonus: a board's type identity only grants a defensive affinity, which
  // feeds the weapon/element triangle multiplier (advantage/disadvantage)
  // applied below — not a flat damage add here.
  const modifiedDamage = scaledDamage + flatBonus;
  // TRUE damage (user-locked 2026-07-20): only the card's FLAT portion
  // bypasses defenses. The stat add is checked against the enemy's
  // matching defense (Attack vs Armor, Magic Power vs Magic Resist) —
  // defense can eat up to the stat add, never the flat base or bonuses.
  // Under the multi-hit split `effectiveStat` is THIS HIT's share, so the
  // rule reads per hit and the defense a TRUE cast can ever absorb still
  // totals at most the caster's whole stat — never `hits ×` it. A TRUE
  // `statStrike` is therefore fully mitigable (it is ALL stat add), and a
  // gem-appended TRUE flat hit fully bypasses (it is all flat base).
  const defense = property === 'true'
    ? Math.min(effectiveStat, effStat(enemy, scalingStat === 'attack' ? 'armor' : 'magicResist'))
    : mitigation(enemy, property);
  const afterDefenseWithoutFloor = Math.max(0, modifiedDamage - defense);
  const afterDefense = Math.max(1, afterDefenseWithoutFloor);
  const matchup = cardMatchup(skill, enemy);
  const afterMatchup = Math.floor((afterDefense * matchupPct(matchup)) / 100);
  const amountBeforeFinalFloor = caster.sdStacks > 0
    ? Math.floor((afterMatchup * (100 + caster.sdStacks)) / 100)
    : afterMatchup;
  const amount = Math.max(1, amountBeforeFinalFloor);
  const hpBefore = enemy.stats.hp;
  const landed = dealDamage(ctx, enemy, amount, property, {
    matchup,
    calculation: {
      scalingStat,
      baseStat,
      effectiveStat,
      power,
      baseDamage,
      statBonusDamage: scaledDamage - baseDamage,
      effectBonusDamage: modifiedDamage - scaledDamage,
      defense: modifiedDamage - afterDefenseWithoutFloor,
      minimumDamageBonus: (afterDefense - afterDefenseWithoutFloor) + (amount - amountBeforeFinalFloor),
      matchupBonusDamage: afterMatchup - afterDefense,
      suddenDeathBonusDamage: amountBeforeFinalFloor - afterMatchup,
    },
  });
  cast.damageDealt += hpBefore - enemy.stats.hp;
  // A HIT THAT DID NOT TAKE EFFECT DOES NOT REFLECT. `negate` "fully nullifies"
  // a direct hit (types.ts), so there is no hit for the victim's thorns to sting
  // back at — and spending a thorn stack on it would make negate cost its own
  // holder a defensive resource. `reflectThorns` already models this idea for the
  // killing blow; `landed` closes the negate case at the same seam.
  if (landed) reflectThorns(ctx, enemy, caster);
}

/**
 * THORNS REFLECT — fires after a DIRECT skill hit resolves on a thorned victim.
 * The attacker takes the pile's CURRENT stack count as PHYSICAL damage, ARMOR
 * FIRST, then the pile loses one stack (statusExpired at 0). Fires per HIT, so a
 * multi-hit card eats one reflect per instance — thorns are deliberately strong
 * into multi-hit.
 *
 * PHYSICAL, NOT TRUE (user-locked 2026-08-21): "its just a reflect — if either
 * side has the thorn buff and either side has armor it should hit armor first."
 * TRUE-ness was an implementation default from the keyword's first commit
 * (74d8463), never ratified, and inconsistent with the DoT ticks, which all carry
 * a property. A reflect is now an ORDINARY PHYSICAL HIT for every downstream
 * rule: the recipient's ARMOR is subtracted here, then a matching physical
 * `guard` reduces it and a physical shield pool absorbs it inside `dealDamage`,
 * exactly as they would for any physical hit (and the TRUE pool no longer eats
 * reflects point-for-point — as typed damage it drains that pool 2:1 like every
 * other typed hit). Pricing is unchanged and MORE honest for it: thorns still
 * costs `dotPerStack` (10 deci/stack, the typed rate) and now delivers typed,
 * mitigable damage, where TRUE damage elsewhere pays double.
 *
 * ARMOR ARITHMETIC IS MIRRORED, NOT REINVENTED — the two floors below are
 * `applyStrike`'s `afterDefenseWithoutFloor`/`afterDefense` pair verbatim
 * (`mitigation(...,'physical')` IS `effStat(...,'armor')`), so the strike path
 * and the reflect path can never disagree about what armor does or where the
 * min-1 floor sits.
 *
 * NO MATCHUP WHEEL: the element wheel / weapon triangle lives in `applyStrike`
 * as `cardMatchup(skill, enemy)`, which needs a `SkillDef` to read a
 * `weapon`/`element` off. Thorns is a status with neither, this path builds no
 * skill and calls `dealDamage` directly, so the wheel is skipped structurally —
 * there is no multiplier to accidentally apply. The sudden-death ramp (also
 * `applyStrike`-only) is skipped the same way, exactly as before this change.
 *
 * NON-REENTRANT BY CONSTRUCTION — and it is the CALL SITE that guarantees it,
 * not the damage property and not the `source` tag: `reflectThorns` is called
 * from ONE place, `applyStrike` (a card strike), and `dealDamage` never calls it
 * back. So a reflect cannot trigger the attacker's own thorns whatever property
 * it carries, and DoT / fatigue / attrition ticks (which never pass through
 * `applyStrike`) never trigger it either. The `source: 'thorns'` tag is what
 * keeps a reflect out of the `skill`-only arms of `dealDamage` (`negate`,
 * `expose`) and what attributes the sting in the log — it is NOT the loop gate.
 * See `tests/engine/thorns.test.ts`.
 */
function reflectThorns(ctx: Ctx, victim: CombatantState, attacker: CombatantState): void {
  if (!victim.alive) return; // a killing blow is not reflected: first to fall loses
  for (const status of victim.statuses) {
    if (status.kind !== 'thorns' || (status.stacks ?? 0) <= 0) continue;
    const sting = status.stacks ?? 0;
    // ARMOR FIRST, mirroring `applyStrike`'s physical branch exactly.
    const afterArmorWithoutFloor = Math.max(0, sting - mitigation(attacker, 'physical'));
    const afterArmor = Math.max(1, afterArmorWithoutFloor);
    // Attribute the sting to the card that GRANTED the thorns, not to whatever
    // the attacker happens to be casting — same idiom as the DoT ticks. Restore
    // the attacker's source afterwards: we are mid-cast in their attribution.
    const prevSource = ctx.source;
    ctx.source = status.source;
    dealDamage(ctx, attacker, afterArmor, 'physical', { source: 'thorns' });
    ctx.source = prevSource;
    status.stacks = sting - 1;
    status.turnsLeft = status.stacks;
    if (status.stacks <= 0) {
      victim.statuses = victim.statuses.filter((st) => st !== status);
      ctx.events.push({ turn: ctx.state.turn, kind: 'statusExpired', side: victim.side, unit: victim.index, status: 'thorns' });
    }
    return; // one pile stings per hit
  }
}

/**
 * Apply one action to one already-resolved target, passed as `enemy` (the name
 * is historical). Offensive actions treat it as the victim. Ally-targeted
 * support (heal/cleanse/buffStat) treats it as the recipient ally chosen by
 * `resolveTargets` — which is the caster in 1v1, so `enemy === caster` there.
 * Self-only support (shield/guard/negate/ward) and the self riders (taunt/lifesteal/
 * comboBonus) act on the caster directly. The interpreter fan-out (see
 * `applyCast`) calls this once per resolved target, in ascending index order.
 *
 * `hit` is this damage action's slice of the cast's per-cast stat pool (see
 * `HitSplit` / `statShare`); it is the SAME object for every target of one
 * action, so an AoE hit never advances the split. Everything that does NOT take
 * a share — non-damage actions, `statStrike`, and any GEM-APPENDED hit — is
 * handed `SINGLE_HIT` and never reads it.
 */
function applyAction(
  ctx: Ctx,
  caster: CombatantState,
  skill: SkillDef,
  action: Action,
  mods: AuraMods,
  cast: CastCtx,
  enemy: CombatantState,
  hit: HitSplit,
): void {
  const property = skill.property;
  switch (action.kind) {
    case 'damage': {
      // FLAT model: a card's `power` is a flat base; the caster's scaling stat
      // (Attack / Magic Power / higher for TRUE) plus any aura / combo bonus are
      // ADDED flat on top — never multiplied. Damage and HP both scale linearly.
      // Only matchup (±%) and sudden death remain multipliers.
      //
      // MULTI-HIT STAT SPLIT (user-locked 2026-08-07): the stat term is this
      // hit's SHARE of the cast's stat pool, not the whole stat — a cast's
      // total stat contribution is the same whether it hits once or five times.
      // Both the raw `baseStat` and the buffed `effectiveStat` are split by the
      // identical rule so the reported parts still telescope
      // (`baseDamage + statBonusDamage + effectBonusDamage = modifiedDamage`).
      //
      // GEM-APPENDED (user-locked 2026-08-07): a hit the socket added is
      // self-contained — flat `power` and nothing else. No stat share (it was
      // never in the divisor, so the card's own hit keeps the whole pool), no
      // `mods.damageFlat`, no `comboBonus`. See `GemAppended` in types.ts.
      const flat = action.fromGem === true;
      applyStrike(ctx, caster, skill, cast, enemy, {
        power: action.power,
        baseStat: flat ? 0 : statShare(caster.stats[scalingStatName(caster, property)], hit),
        effectiveStat: flat ? 0 : statShare(scaleStat(caster, property), hit),
        // `bonusByTarget` is the CONDITIONAL half of the same idea `bonusFlat`
        // holds unconditionally: an `exploit`/`stackBonus` rider armed earlier in
        // this cast, against THIS victim (see `CastCtx.bonusByTarget`). A
        // gem-appended hit takes neither, exactly as before.
        flatBonus: flat ? 0 : mods.damageFlat + cast.bonusFlat + (cast.bonusByTarget[enemy.index] ?? 0),
      });
      break;
    }
    case 'affinityCharge': {
      // Arms the NEXT matching cast, so nothing lands now. Same gate as
      // `affinityStrike` — the caster must hold this card's own affinity.
      if (!affinityOpen(caster, skill)) break;
      const type = cardType(skill);
      if (type === undefined) break; // unreachable: affinityOpen already required one
      // STRONGEST WINS, never additive (see the docs in types.ts): a board
      // running several armers still only ever holds one card's printed number.
      const standing = caster.empowerNext;
      if (standing !== undefined && standing.type === type.type && standing.amount >= action.amount) break;
      caster.empowerNext = { type: type.type, amount: action.amount };
      break;
    }
    case 'affinityStrike': {
      // THE BOARD'S OWN PAYOFF. Fires only when the caster carries the affinity
      // matching this card's type — for a hero that means Board Type Identity
      // (`IDENTITY_THRESHOLD` cards of one unique top type, this card included),
      // which is fixed for the whole fight because a board cannot change
      // mid-combat. See the `affinityStrike` docs in types.ts.
      //
      // FLAT AND ADDITIVE, exactly like a gem-appended hit: no stat share, no
      // `mods.damageFlat`, no rider bonus. It is not in the multi-hit divisor
      // (`countDamageActions` counts only `kind: 'damage'`), so opening the gate
      // ADDS a hit and never shrinks the card's own — the printed base hit reads
      // the same on an on-type board and an off-type one.
      if (!enemy.alive) break;
      if (!affinityOpen(caster, skill)) break;
      applyStrike(ctx, caster, skill, cast, enemy, {
        power: action.power,
        baseStat: 0,
        effectiveStat: 0,
        flatBonus: 0,
      });
      break;
    }
    case 'statStrike': {
      // A separate hit for ONE SHARE of a `shareOf`-way split of the caster's
      // scaling stat, optionally capped (see the `statStrike` docs in types.ts).
      // It takes NO attacker-side bonus — not `mods.damageFlat`, not a triggered
      // `comboBonus` — and it never enters the multi-hit divisor, so it is
      // strictly ADDITIVE to the host card's own hit rather than carved out of it.
      //
      // The share is `statShare` at index 0 of a `shareOf`-way split: exact
      // integer arithmetic, front-loaded exactly as the multi-hit rule rounds
      // (`shareOf: 2` of Attack 21 is 11, not 10). A `shareOf` below 1 would
      // mean "more than the whole stat", which the effect is defined never to
      // do, so it clamps to 1 = the whole stat.
      //
      // ECHO FORM (`echoHostPower`, user intent 2026-08-08: "echo is suppose to
      // perform a secondary atk at 50% less"). The payload becomes one share of
      // the WHOLE attack — the host card's own flat base PLUS the caster's stat —
      // instead of a share of the stat alone. On Sword Slash (base 20) at Attack
      // 20 the card's own hit is 40 and a `shareOf: 2` echo is 20; on Crushing
      // Blow (base 96) the same socket echoes 58. It repeats whatever it is
      // attached to, which is the entire point of an echo.
      //
      // ONE share of the SUM, then split back into a base term and a stat term —
      // NOT a share of each term taken separately. Sharing each separately would
      // round both up and hand the echo a free point whenever base and stat are
      // both odd (base 9 at Attack 21: 5 + 11 = 16 for a 30-damage attack). The
      // sum is shared once, so the echo is EXACTLY `share(base + stat)`, always.
      //
      // The split is still reported as two terms because `applyStrike`'s TRUE
      // rule mitigates only the stat one: the base half of an echo bypasses
      // defense exactly as the host card's own flat base does, and the stat half
      // is checked against defense exactly as the host's stat add is.
      const shareOf = Math.max(1, Math.floor(action.shareOf));
      const cap = action.cap;
      const share = (n: number): number => statShare(n, { index: 0, count: shareOf });
      const echoBase = action.echoHostPower === true ? ownDamagePower(skill.effects) : 0;
      // `cap` bounds the payload as a WHOLE: the echoed base takes the room first
      // and the STAT term gets what is left, because the stat is the term that
      // grows without bound with hero level while the echoed base is fixed by the
      // host card. With NO echo (`echoBase` 0 → base term 0, room `cap`) every
      // line below reduces to the pre-echo `Math.min(share(stat), cap)`, so every
      // existing `statStrike` is byte-identical.
      const basePart = share(echoBase);
      const power = cap === undefined ? basePart : Math.min(basePart, cap);
      const statTerm = (stat: number): number => {
        const part = share(echoBase + stat) - basePart;
        return cap === undefined ? part : Math.min(part, cap - power);
      };
      applyStrike(ctx, caster, skill, cast, enemy, {
        // The echoed base is stat-INDEPENDENT, so it rides `power` — the same
        // slot the host card's own flat base uses, which is what makes the TRUE
        // rule and the reported `calculation` telescope with no special case.
        power,
        baseStat: statTerm(caster.stats[scalingStatName(caster, property)]),
        effectiveStat: statTerm(scaleStat(caster, property)),
        flatBonus: 0,
      });
      break;
    }
    case 'heal': {
      // Lands on the resolved ally target (lowest HP fraction; self in 1v1) but
      // SCALES off the CASTER's stats — the healer's power, the ally's HP bar.
      const target = enemy;
      if (!target.alive) break;
      // TRUE heals are flat: exact amount, no scaling, no aura math.
      // Non-TRUE heals are the card's flat base + the caster's DEFENSIVE scaling
      // stat (Armor for physical, Magic Resist for magical — healing is
      // defensive output, see `scaleDefStat`) + any FLAT aura/gem heal bonus.
      //
      // GEM-APPENDED (gem ruleset v1 §0.B / §7.6 / §9.4, 2026-08-09): the same
      // rule the `damage` case above has always obeyed — a gem's printed payload
      // is its WHOLE payload. A gem heal delivers exactly its `power`: NO
      // `scaleDefStat` term and NO `mods.healFlat`. Before this, a Common
      // "+4 HP" gem healed 34 on a DEF-30 hero (4x a Legendary Core's +8) and a
      // gem's value became a function of the host it sat on, which is precisely
      // what the host-independence rule behind `GEM_CANONICAL_PROPERTY` forbids.
      // The ANTI-HEAL WORLD RULE still applies: a gem heal is still a REGULAR
      // heal, and afflictions on the receiver are a property of the RECEIVER and
      // the world, not an attacker-side buff (same line the gem-hit rule draws —
      // see `GemAppended` in types.ts).
      const fromGem = action.fromGem === true;
      let amount: number;
      let flat = false;
      let antiHeal: AntiHealReduction | undefined;
      // The requested heal's parts, reported on the event so the UI can explain
      // the number without re-deriving gem/aura/stat resolution (which could
      // silently disagree with this line). Mirrors shieldGain.calculation.
      let statBonus = 0;
      let healFlat = 0;
      // FLAT BONUS HEALING armed by a rider earlier in this cast (`cleanseConvert`
      // — see `CastCtx.healBonusFlat`). It joins the REQUEST, on both branches, so
      // it is taxed by anti-heal and wasted by the maxHp clamp exactly like the
      // card's own base: a bonus heal is healing, not a separate exempt payload.
      // Excluded for a gem heal on the same rule that zeroes `statBonus`/`healFlat`
      // there — a gem's printed payload is its whole payload.
      const bonus = fromGem ? 0 : cast.healBonusFlat;
      if (property === 'true') {
        // Flat by identity: no stat term, no aura term — both stay 0, exactly as
        // a TRUE shield reports statBonus 0. The rider bonus is not a stat or aura
        // term, so it DOES apply here; a TRUE heal is irreducible, not unbuffable.
        amount = action.power + bonus;
        flat = true;
      } else {
        statBonus = fromGem ? 0 : scaleDefStat(caster, property);
        healFlat = fromGem ? 0 : mods.healFlat;
        // ANTI-HEAL WORLD RULE: a regular heal is taxed −20% per affliction
        // category active on the RECEIVER (cap −60%). TRUE heals skip this
        // branch entirely — irreducible by identity.
        const taxed = applyAntiHeal(target, action.power + statBonus + healFlat + bonus);
        amount = taxed.amount;
        antiHeal = taxed.antiHeal;
      }
      // Clamped at the shared seam (see `restoreHp`): a request that resolved
      // negative restores nothing rather than draining HP below zero.
      const { applied, healed } = restoreHp(target, amount);
      // Emit whenever the card ATTEMPTED a heal (even if fully overhealed) so the
      // per-card report credits its full output; `amount` is the effective HP
      // restored, `overheal` the wasted remainder (attempted = amount + overheal).
      // A clamped-away (<= 0) request attempted nothing and stays silent, exactly
      // as a 0 heal always has.
      if (applied > 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'heal', side: target.side, unit: target.index, amount: healed, overheal: applied - healed, flat, hpAfter: target.stats.hp, ...(antiHeal ? { antiHeal } : {}), ...(ctx.source ? { sourceCard: ctx.source } : {}), calculation: { power: action.power, statBonus, healFlat, property, ...(bonus > 0 ? { bonus } : {}) } });
      }
      // OVERHEAL -> PLATING (`overhealShield`, armed earlier in this cast). The
      // overflow is `applied − healed`, i.e. what the heal had left AFTER the
      // anti-heal tax and BEFORE nothing else: the taxed heal is the real heal, so
      // a heal taxed −60% simply has less to overflow with. Nothing here can
      // manufacture overflow that the heal did not actually waste.
      //
      // ORDER: after the `heal` event, so the log reads "healed N (overheal M)"
      // and then "banked M as plating" — the causal order a replay needs.
      //
      // THE maxHp SHIELD CEILING STILL BINDS, through the same room check the
      // `shield` arm uses; the part that will not fit is reported as `wasted`, so a
      // conversion that was capped away is visible rather than silently missing.
      // The plating lands on the unit whose bar overflowed (`target`), which is the
      // caster for every self-heal — see the keyword's docs in types.ts.
      const overflowCap = fromGem ? 0 : cast.overhealShieldCap;
      if (overflowCap > 0 && target.alive) {
        const converted = Math.min(applied - healed, overflowCap);
        if (converted > 0) {
          const room = Math.max(0, target.stats.maxHp - totalShield(target));
          const gain = Math.min(converted, room);
          if (gain > 0) target.shields[property] += gain;
          ctx.events.push({
            turn: ctx.state.turn,
            kind: 'shieldGain',
            side: target.side,
            unit: target.index,
            property,
            amount: gain,
            wasted: converted - gain,
            totalAfter: totalShield(target),
            poolsAfter: { ...target.shields },
            ...(ctx.source ? { sourceCard: ctx.source } : {}),
            // NO `calculation`: a conversion has no card base and no stat term to
            // split. Same contract `lifesteal`'s heal event follows.
            overheal: true,
          });
        }
      }
      break;
    }
    case 'shield': {
      if (!caster.alive) break;
      // Shields stack and carry over, but total shield is hard-capped at maxHp.
      // A typed shield is the card's flat base plus the caster's DEFENSIVE scaling
      // stat (Armor for physical, Magic Resist for magical — plating is defensive
      // output, see `scaleDefStat`). TRUE shields are flat by design: no stat
      // contribution at all, which `scaleDefStat` reports as 0.
      //
      // GEM-APPENDED (gem ruleset v1 §0.B / §7.6 / §9.4, 2026-08-09): a gem
      // shield delivers exactly its printed `power` — no stat term — the twin of
      // the `heal` case above and of the `damage` case's long-standing rule. The
      // shield case never read `mods` for ANY property, so there is no aura term
      // to strip here. The maxHp room cap is a property of the RECEIVER and still
      // applies, exactly as mitigation still applies to a gem hit.
      const statBonus = action.fromGem === true ? 0 : scaleDefStat(caster, property);
      const request = action.power + statBonus;
      const room = Math.max(0, caster.stats.maxHp - totalShield(caster));
      const gain = Math.min(request, room);
      const wasted = request - gain;
      if (gain > 0) caster.shields[property] += gain;
      ctx.events.push({
        turn: ctx.state.turn,
        kind: 'shieldGain',
        side: caster.side,
        unit: caster.index,
        property,
        amount: gain,
        wasted,
        totalAfter: totalShield(caster),
        poolsAfter: { ...caster.shields },
        ...(ctx.source ? { sourceCard: ctx.source } : {}),
        calculation: { power: action.power, statBonus },
      });
      break;
    }
    case 'poison':
      applyDot(ctx, enemy, 'poison', action.stacks, property);
      break;
    case 'burn':
      applyDot(ctx, enemy, 'burn', action.stacks, property);
      break;
    case 'bleed':
      // Bleed cannot be applied through plating: any active shield on the
      // target blocks the application entirely (the stacks are simply lost —
      // once applied, though, ticks bypass shields).
      if (totalShield(enemy) > 0) break;
      applyDot(ctx, enemy, 'bleed', action.stacks, property);
      break;
    case 'stun':
      addStatus(ctx, enemy, { kind: 'stun', turnsLeft: action.turns, fresh: true });
      break;
    case 'buffStat': {
      // Lands on the resolved ally target (see pickSupportTarget; self in 1v1).
      // TRUE buffs are flat amounts; physical/magical buffs are percentages.
      const target = enemy;
      if (property === 'true') {
        addStatus(ctx, target, { kind: 'buff', stat: action.stat, amount: action.pct, turnsLeft: action.turns, fresh: true });
      } else {
        addStatus(ctx, target, { kind: 'buff', stat: action.stat, pct: action.pct, turnsLeft: action.turns, fresh: true });
      }
      break;
    }
    case 'debuffStat':
      if (property === 'true') {
        addStatus(ctx, enemy, { kind: 'debuff', stat: action.stat, amount: action.pct, turnsLeft: action.turns, fresh: true });
      } else {
        addStatus(ctx, enemy, { kind: 'debuff', stat: action.stat, pct: action.pct, turnsLeft: action.turns, fresh: true });
      }
      break;
    case 'expose': {
      // Offensive debuff: applied to the enemy. pct clamped to <=50 at apply time.
      //
      // ONE PILE PER APPLICATION, NEVER COMPOUNDED — the amplification a victim
      // carries is the STRONGEST standing pile's pct (`dealDamage` takes the
      // max, not the sum), and each application keeps its OWN pct for its OWN
      // window.
      //
      // WHY THIS RULE (2026-08-18) — the invariant is: A CARD DELIVERS WHAT IT
      // WAS PRICED FOR, WHATEVER ELSE IS ON THE TARGET. Expose is priced per
      // application at `pct x turns` (`exposePerPctTurnNum` in balance.ts), so
      // neither direction may leak:
      //   • it must not OVER-deliver — the previous rule kept ONE pile and took
      //     `max(pct)` with a refreshed duration, so casting `piercing_arrow`
      //     (30%/2t, priced 30 deci) while `ruinous_hex`'s pile (50%/2t, priced
      //     100 deci) stood applied FIFTY percent and re-armed the window. The
      //     weak card delivered the strong card's amplification for a third of
      //     its price, on two cards that both ship;
      //   • it must not UNDER-deliver either — so a weak application can never
      //     overwrite, shorten or weaken a stronger standing pile.
      // Separate applications are the only rule that satisfies both: the true
      // envelope of "50% for one more turn, then 30% for two" is not
      // representable as a single (pct, turns) pair.
      //
      // MAX, NOT SUM — `guard`, expose's stated mirror, compounds
      // MULTIPLICATIVELY and diminishes toward zero (50% then 50% leaves 25%),
      // whereas compounding exposes ACCELERATES without bound (+50% then +50% is
      // x2.25, not x2). Parity pricing with guard holds only while the marginal
      // application is worth no more than the first, so the offensive mirror
      // reads the strongest pile and ignores the rest — the same line the engine
      // already draws for `slow`, which takes the strongest pending value rather
      // than summing ("that would permanently lock out slow enemies").
      //
      // THE PILE SET IS AN ANTICHAIN, so it can neither grow without bound nor
      // hold a redundant entry:
      //   • an application some standing pile DOMINATES (>= pct AND >= turnsLeft)
      //     is ABSORBED: no new pile, NO REFRESH of the standing one, no ward
      //     spent, no event — nothing observable happened, because the victim is
      //     already taking at least that much for at least that long. This is
      //     what closes the unbounded-duration hole: the old branch set
      //     `fresh = true` on ANY re-application whatever its pct, and
      //     `expireStatuses` skips a fresh pile's decrement, so a card whose
      //     cadence was no longer than its own duration held its pile FOREVER —
      //     and an `expose pct: 0` action, priced at literally nothing, kept a
      //     standing 50% pile alive indefinitely;
      //   • an application that DOMINATES standing piles REPLACES them (they are
      //     no stronger and no longer, so nothing is lost); each is dropped with
      //     its own `statusExpired` BEFORE the new `statusApplied`, so a log
      //     replay's status set never desyncs from the sim's;
      //   • anything else COEXISTS, and the max rule reads whichever pile is
      //     strongest at each hit.
      // Domination compares the RAW `turnsLeft`, so an incoming application loses
      // the one-turn `fresh` grace against an equal standing pile: under-, never
      // over-delivery — the only safe direction to round a priced effect.
      //
      // WARD still taxes a real application exactly as it taxes a DoT merge in
      // `applyDot` (prevention, not removal: a warded application leaves every
      // standing pile exactly as it was). It is consumed HERE, before any pile is
      // dropped; the `addStatus` call below re-checks and can only find no charge
      // left, because a charge that existed was just spent.
      if (!enemy.alive) break;
      const pct = Math.max(0, Math.min(50, action.pct));
      // An application that can amplify nothing (0%) or covers no turn is not a
      // status at all: it would otherwise be a free affliction — anti-heal
      // trigger, cleanse bait, ward drain — bought for 0 deci.
      if (pct <= 0 || action.turns <= 0) break;
      let dominated = false;
      for (let i = 0; i < enemy.statuses.length; i += 1) {
        const st = enemy.statuses[i]!;
        if (st.kind !== 'expose') continue;
        if ((st.pct ?? 0) >= pct && st.turnsLeft >= action.turns) {
          dominated = true;
          break;
        }
      }
      if (dominated) break;
      if (consumeWard(ctx, enemy, 'expose')) break;
      const kept: typeof enemy.statuses = [];
      for (let i = 0; i < enemy.statuses.length; i += 1) {
        const st = enemy.statuses[i]!;
        if (st.kind === 'expose' && (st.pct ?? 0) <= pct && st.turnsLeft <= action.turns) {
          ctx.events.push({ turn: ctx.state.turn, kind: 'statusExpired', side: enemy.side, unit: enemy.index, status: 'expose' });
          continue;
        }
        kept.push(st);
      }
      enemy.statuses = kept;
      addStatus(ctx, enemy, { kind: 'expose', pct, turnsLeft: action.turns, fresh: true });
      break;
    }
    case 'cleanse': {
      // Lands on the resolved ally target (most-afflicted ally; self when nobody
      // is afflicted, or in 1v1). Each charge removes ONE STACK of a negative
      // effect, processing afflictions in a fixed deterministic order:
      // expiring-soonest (lowest turnsLeft) first, ties by application order
      // (original array index). A stacking DoT (poison/burn/bleed) drains one
      // stack per charge from its soonest instance (the instance is removed when
      // it hits 0 stacks before moving on); a stun/debuff/expose is a 1-stack
      // ailment removed whole by one charge. Buffs, guards and negate charges are
      // never removed. `removed` on the event counts STACKS removed.
      const target = enemy;
      if (!target.alive) break;
      const ordered = target.statuses
        .map((status, index) => ({ status, index }))
        .filter((entry) => isCleansable(entry.status.kind))
        .sort((a, b) => a.status.turnsLeft - b.status.turnsLeft || a.index - b.index);
      let chargesLeft = Math.max(0, action.charges);
      let removed = 0;
      const drained = new Set<StatusInstance>();
      for (const { status } of ordered) {
        if (chargesLeft <= 0) break;
        const isStackingDot = status.kind === 'poison' || status.kind === 'burn' || status.kind === 'bleed';
        if (isStackingDot) {
          const take = Math.min(status.stacks ?? 0, chargesLeft);
          status.stacks = (status.stacks ?? 0) - take;
          removed += take;
          chargesLeft -= take;
          if ((status.stacks ?? 0) <= 0) drained.add(status);
        } else {
          drained.add(status);
          removed += 1;
          chargesLeft -= 1;
        }
      }
      if (removed > 0) {
        if (drained.size > 0) target.statuses = target.statuses.filter((s) => !drained.has(s));
        ctx.events.push({ turn: ctx.state.turn, kind: 'cleansed', side: target.side, unit: target.index, removed });
      }
      // RECORDED FOR `cleanseConvert` (see `CastCtx.cleansedStacks`): the STACKS
      // actually removed, the same number the event reports, accumulated across
      // every cleanse action of this cast. Written unconditionally — `removed` is 0
      // when there was nothing to strip, and 0 is exactly what a convert rider must
      // read in that case.
      cast.cleansedStacks += removed;
      break;
    }
    case 'taunt': {
      // Self-targeted threat gain (fight-long, not turn-decremented). Under the
      // default `aggro` policy this pulls foes onto the tank.
      if (!caster.alive || action.amount <= 0) break;
      caster.aggro += action.amount;
      ctx.events.push({ turn: ctx.state.turn, kind: 'aggroChanged', side: caster.side, unit: caster.index, aggro: caster.aggro });
      break;
    }
    case 'slow':
      // ONE TURN, ONE CARD (user-locked 2026-08-18). The strongest pending slow
      // applies to whatever the victim plays for the REST OF THIS TURN, and is
      // dropped at end of turn whether or not it was ever paid (`simulate.ts`,
      // beside `expireStatuses`). Slows don't stack — `Math.max`, never a sum —
      // which now matters only WITHIN a turn, since nothing survives it.
      if (!enemy.alive) break;
      enemy.nextWeightPenalty = Math.max(enemy.nextWeightPenalty, action.weight);
      ctx.events.push({ turn: ctx.state.turn, kind: 'slowed', side: enemy.side, unit: enemy.index, weight: action.weight });
      break;
    case 'burden': {
      // BURDEN — `slow` at CARD scope (see the `burden` docs in types.ts).
      // Single-target at the UNIT level (it lands on the one resolved foe) and,
      // on that foe, on ONE piece: the anchor their cast cursor is on. When the
      // cast also carries `splash` the SAME write is spread over the anchor's
      // edge-to-edge neighbours as well — `cardTargetPieces` is the one place
      // that choice is made (combat/splash.ts), so the spreader means exactly
      // the same thing here as it does for `curse` below.
      //
      // Each targeted piece costs `weight` extra the NEXT time it is played,
      // then the tax is consumed (simulate.ts). SAME NON-STACKING RULE AS
      // `slow`: `Math.max`, never a sum — an unbounded stack would permanently
      // lock a card out, which is exactly the reason the `slow` arm above gives.
      //
      // A dead unit is a no-op (its board never plays again), and so is an
      // empty board — neither emits an event, because nothing observable
      // happened.
      if (!enemy.alive) break;
      const hit = cardTargetPieces(enemy, cast.spreadsBand);
      if (!hit) break;
      const slots: number[] = [];
      for (let i = 0; i < hit.pieces.length; i += 1) {
        const piece = hit.pieces[i]!;
        piece.nextWeightPenalty = Math.max(piece.nextWeightPenalty ?? 0, action.weight);
        slots.push(piece.slot);
      }
      ctx.events.push({
        turn: ctx.state.turn,
        kind: 'burdened',
        side: enemy.side,
        unit: enemy.index,
        weight: action.weight,
        anchorSlot: hit.anchor.slot,
        slots,
      });
      break;
    }
    case 'curse': {
      // CURSE — burden's sibling, one currency over: the targeted card(s) deal
      // `amount` LESS damage until `expiresAtTurn`. Same geometry, same
      // spreader, same `Math.max` non-stacking rule — the difference is WHAT is
      // written (`PieceState.curse`) and that it EXPIRES on a clock
      // (`expireCurses`, simulate.ts) instead of being spent by a play.
      //
      // AN EMPTY CURSE IS DROPPED OUTRIGHT, the `expose` precedent: a 0 amount
      // or 0 turns can never reduce a hit, so applying one would be a free
      // effect that still emitted an event and still occupied the anchor's
      // non-stacking slot (blocking nothing, but claiming to).
      //
      // THE WINDOW: `turn + turns`, cleared at the END of that turn — the same
      // span a `fresh` turn-durationed status gets from `addStatus` +
      // `expireStatuses`, so "for 2 turns" means the same thing on a curse as it
      // does on an expose.
      if (!enemy.alive) break;
      if (action.amount <= 0 || action.turns <= 0) break;
      const hit = cardTargetPieces(enemy, cast.spreadsBand);
      if (!hit) break;
      const expiresAtTurn = ctx.state.turn + action.turns;
      const slots: number[] = [];
      for (let i = 0; i < hit.pieces.length; i += 1) {
        const piece = hit.pieces[i]!;
        const standing = piece.curse;
        // THE STRONGER AMOUNT **AND** THE LATER EXPIRY, taken independently
        // (`expose`'s refresh rule). Independently, because the two fields
        // answer different questions and a weaker-but-longer curse must not be
        // able to shorten a stronger one, nor a shorter-but-stronger one to end
        // a standing window early.
        piece.curse = standing
          ? { amount: Math.max(standing.amount, action.amount), expiresAtTurn: Math.max(standing.expiresAtTurn, expiresAtTurn) }
          : { amount: action.amount, expiresAtTurn };
        slots.push(piece.slot);
      }
      ctx.events.push({
        turn: ctx.state.turn,
        kind: 'cursed',
        side: enemy.side,
        unit: enemy.index,
        amount: action.amount,
        turns: action.turns,
        anchorSlot: hit.anchor.slot,
        slots,
      });
      break;
    }
    case 'splash':
      // THE SPREADER APPLIES NOTHING ITSELF (see the `splash` docs in types.ts).
      // It is read ONCE PER CAST, before any effect resolves
      // (`castSpreadsBand` → `CastCtx.spreadsBand`), and the card-targeting arms
      // above consult that flag. So this arm is deliberately empty, and the
      // keyword's position in the effect list decides nothing: a gem splash
      // spliced behind the host's burden still spreads it.
      //
      // A splash with nothing to spread cannot reach here as authored content
      // (`validateSkillContent` refuses it) nor as a gem (THE SPLASH GATE's
      // `nothingToSpread` arm drops it, engine/cards.ts) — and if one ever did,
      // this arm is the reason it would be an inert no-op rather than a defect.
      break;
    case 'disrupt': {
      if (!enemy.alive) break;
      const drained = Math.min(enemy.readiness, action.amount);
      enemy.readiness -= drained;
      ctx.events.push({
        turn: ctx.state.turn,
        kind: 'disrupted',
        side: enemy.side,
        unit: enemy.index,
        amount: drained,
        readinessAfter: enemy.readiness,
        bankAfter: enemy.readiness,
      });
      break;
    }
    case 'lifesteal': {
      if (!caster.alive || cast.damageDealt <= 0) break;
      const stolen = Math.floor((cast.damageDealt * action.pct) / 100);
      if (stolen <= 0) break;
      // ANTI-HEAL WORLD RULE: lifesteal is regular healing — taxed by the
      // afflictions on its RECEIVER (the caster), same formula as `heal`.
      const taxed = applyAntiHeal(caster, stolen);
      const amount = taxed.amount;
      // Same shared seam as the `heal` arm (`restoreHp`): lifesteal cannot reach
      // a negative request today (`stolen > 0` is checked above and anti-heal
      // never zeroes a positive request), and routing it here is what keeps that
      // true if either of those facts ever changes.
      const { healed } = restoreHp(caster, amount);
      if (healed > 0) {
        // NO `calculation` BLOCK (deliberate): a lifesteal request is
        // `floor(damageDealt * pct / 100)` — there is no card base, no stat term
        // and no aura term to split, so reporting `power = stolen` would claim a
        // card base that does not exist. Same contract as `damage.calculation`,
        // which DoT/fatigue/attrition damage omits for the same reason; the
        // renderer treats a calculation-less heal's printed request as whole.
        ctx.events.push({ turn: ctx.state.turn, kind: 'heal', side: caster.side, unit: caster.index, amount: healed, overheal: amount - healed, flat: false, hpAfter: caster.stats.hp, ...(taxed.antiHeal ? { antiHeal: taxed.antiHeal } : {}), ...(ctx.source ? { sourceCard: ctx.source } : {}) });
      }
      break;
    }
    case 'shieldBreak': {
      if (!enemy.alive) break;
      // Strip the card's own property pool first, then true, then the rest.
      const order: (keyof typeof enemy.shields)[] =
        property === 'true' ? ['true', 'physical', 'magical'] : [property, 'true', property === 'physical' ? 'magical' : 'physical'];
      let remaining = action.amount;
      for (const pool of order) {
        const strip = Math.min(enemy.shields[pool], remaining);
        enemy.shields[pool] -= strip;
        remaining -= strip;
      }
      const broken = action.amount - remaining;
      if (broken > 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'shieldBroken', side: enemy.side, unit: enemy.index, amount: broken, totalAfter: totalShield(enemy) });
      }
      break;
    }
    case 'comboBonus':
      if (caster.lastCastArchetypes.some((a) => skill.archetypes.includes(a))) {
        cast.bonusFlat += action.amount;
      }
      break;
    // CHAIN BONUS — comboBonus's twin, one field different: it compares the
    // caster's PREVIOUS cast TYPE (`lastCastType`, stamped from `cardType` in
    // simulate.ts) against the type this card names, instead of intersecting
    // archetypes. Same scalar (`cast.bonusFlat`), so the same one-bonus-per-cast
    // spend rule applies and a card carrying both keywords accumulates them
    // exactly as two comboBonuses would.
    //
    // A caster that has not cast yet holds no `lastCastType`, so the FIRST cast
    // of a fight never pays out — the same cold start comboBonus has (an empty
    // `lastCastArchetypes` intersects nothing), and what makes the rider's
    // conditional discount honest at the front of a fight.
    case 'chainBonus':
      if (caster.lastCastType === action.after) {
        cast.bonusFlat += action.amount;
      }
      break;
    case 'exploit': {
      // CONDITION READ AT RIDER TIME, ON PRE-EXISTING STATUS (user-locked
      // 2026-08-21: "it should always activate this effect first before
      // activating any poison debuff"). This arm runs BEFORE the card's own
      // damage and — by the catalog convention `validateSkillContent` now
      // enforces — before the card's own status applications, so a card can
      // never satisfy its own condition within one cast. The payoff is
      // cross-cast: leave the pile this cast, collect on the next one.
      if (!enemy.alive) break;
      if (!hasStatus(enemy, action.status)) break;
      armTargetBonus(cast, enemy, action.amount);
      break;
    }
    case 'stackBonus': {
      // `per` per CURRENT stack of the named pile, CLAMPED at the authored
      // `cap` — the whole payload is bounded, which is what makes it priceable
      // (see the action's docs in types.ts). Integer-only: both terms are whole
      // numbers and `Math.min` introduces no rounding.
      //
      // `of` picks WHOSE pile is read — the caster's own (the thorn-wall
      // spender) or the victim's (the DoT executioner) — and, like `exploit`
      // above, it reads the pile AS IT STANDS NOW, before this card's own
      // thorns/DoT line lands later in the same cast.
      if (!enemy.alive) break;
      const holder = action.of === 'caster' ? caster : enemy;
      const stacks = statusStackCount(holder, action.status);
      if (stacks <= 0) break;
      armTargetBonus(cast, enemy, Math.min(action.per * stacks, action.cap));
      break;
    }
    case 'shieldBurst': {
      // SHATTER YOUR OWN WALL AND THROW IT. `min(totalShield(caster), cap)`
      // points leave the caster's pools in the fixed order physical → magical →
      // true (`spendShieldsForBurst`, combat/state.ts) and become flat bonus
      // damage on this cast's hit.
      //
      // SUPPORTIVE (`isOffensiveAction`), so `resolveTargets` hands this arm the
      // CASTER as `enemy` and runs it ONCE — which is exactly what a resource
      // spend needs. The bonus therefore goes to the cast's SCALAR `bonusFlat`,
      // the `comboBonus` seam, not to `bonusByTarget`: there is one wall and one
      // number, and the single foe of a (non-AoE, validator-enforced) burst card
      // is the one that takes it.
      //
      // PRE-EXISTING SHIELD ONLY, like every rider in this family: the card's own
      // `shield` line is required to sit after the damage this feeds
      // (`validateSkillContent`), so a burst can never inflate itself inside one
      // cast.
      if (!caster.alive) break;
      const spent = spendShieldsForBurst(caster, action.cap);
      if (spent <= 0) break;
      cast.bonusFlat += spent;
      // THE DRAIN IS EVENTED, because it is observable state leaving a unit: the
      // shield bar drops before the hit lands. Same event `shieldBreak` emits
      // (same two facts — how much left, what remains), marked `burst` so
      // playback can say "spent" rather than "shattered" and can read the
      // side/unit as the CASTER.
      ctx.events.push({ turn: ctx.state.turn, kind: 'shieldBroken', side: caster.side, unit: caster.index, amount: spent, totalAfter: totalShield(caster), burst: true });
      break;
    }
    case 'taxBonus': {
      // `per` per WEIGHT-TAXED card on the victim (`taxedCardCount`: every board
      // piece carrying a `burden`, plus one for a pending unit-scope slow),
      // CLAMPED at the authored `cap` — the bounded payload is what makes it
      // priceable, exactly as with `stackBonus`.
      //
      // Read AS IT STANDS NOW: taxes this card's own slow/burden lines apply land
      // later in the cast (`validateSkillContent` enforces that order), so the
      // backlog it collects on is one somebody else — or an earlier cast — built.
      if (!enemy.alive) break;
      const taxed = taxedCardCount(enemy);
      if (taxed <= 0) break;
      armTargetBonus(cast, enemy, Math.min(action.per * taxed, action.cap));
      break;
    }
    case 'wardRelease': {
      // CASH IN YOUR OWN WARDS. `shieldBurst`'s twin, one currency over: charges
      // leave the caster's ward piles (lowest index first, `releaseWardCharges` in
      // combat/state.ts) and each one released is worth `per` flat bonus damage on
      // this cast's hit, the whole thing clamped at `cap`.
      //
      // ONLY AS MANY CHARGES AS THE CAP CAN PAY FOR — `ceil(cap / per)` — so a
      // release never throws away a charge it is not being paid for. `ceil` (not
      // `floor`) is what keeps the priced cap REACHABLE; the cost is one
      // partially-paying charge when `cap` is not a multiple of `per`, which is why
      // authored content keeps it a multiple. `per >= 1` is a validator floor, so
      // this division can never be by zero.
      //
      // SUPPORTIVE (`isOffensiveAction`), so `resolveTargets` hands this arm the
      // CASTER as `enemy` and runs it ONCE — what a resource spend needs. The bonus
      // therefore goes to the cast's SCALAR `bonusFlat`, exactly like the burst,
      // and an authored AoE + wardRelease card is refused rather than priced.
      //
      // PRE-EXISTING CHARGES ONLY: the card's own `ward` line is required to sit
      // after the damage this feeds, so a release can never top itself up first.
      if (!caster.alive) break;
      const { released, pilesEmptied } = releaseWardCharges(caster, Math.ceil(action.cap / action.per));
      if (released <= 0) break;
      cast.bonusFlat += Math.min(action.per * released, action.cap);
      // THE SPEND IS EVENTED, because charges leaving a unit is observable state:
      // the ward pips drop before the hit lands. `wardReleased` rather than
      // `warded` — nothing was prevented, so there is no affliction to name.
      ctx.events.push({ turn: ctx.state.turn, kind: 'wardReleased', side: caster.side, unit: caster.index, charges: released, chargesLeft: wardChargeCount(caster) });
      // ...and each pile emptied announces its own end, exactly as `consumeWard`
      // does for the one pile it can drain. A fixed count of identical events, in a
      // fixed order: deterministic, no Map/Set, no RNG.
      for (let i = 0; i < pilesEmptied; i += 1) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'statusExpired', side: caster.side, unit: caster.index, status: 'ward' });
      }
      break;
    }
    case 'desperation': {
      // LAST STAND: flat bonus damage while the CASTER is at or below half its
      // maximum HP. `exploit`'s shape with the gate on the attacker's own bar.
      //
      // INTEGER-EXACT GATE — `hp * 2 <= maxHp`, never a division (see the action's
      // docs in types.ts). `maxHp` is not a `BuffableStat`, so `effStat` has nothing
      // to contribute here and the raw stats are the honest read.
      //
      // ARMED PER VICTIM even though the condition is caster-side, the same call
      // `stackBonus` with `of: 'caster'` makes: the bonus lands on the victim's hit,
      // so under `scope: 'all'` it is delivered once per foe and pays AoE reach.
      if (!enemy.alive) break;
      if (caster.stats.hp * 2 > caster.stats.maxHp) break;
      armTargetBonus(cast, enemy, action.amount);
      break;
    }
    case 'overhealShield': {
      // ARM ONLY — the conversion itself lives in the `heal` arm, which is the one
      // place that knows how much a heal actually wasted. All this does is grant
      // permission for up to `cap` points of THIS cast's heal overflow to bank as
      // plating (see `CastCtx.overhealShieldCap`), which is why the validator
      // requires a `heal` action to follow it: with no heal there is no overflow and
      // the rider is a priced no-op.
      //
      // SUPPORTIVE, so `resolveTargets` runs it once with the CASTER as `enemy`; the
      // recipient of the plating is decided in the heal arm (the unit whose bar
      // overflowed), not here. Nothing is read at rider time — there is nothing to
      // read yet — so unlike its siblings this arm has no condition and no state.
      if (!caster.alive) break;
      cast.overhealShieldCap += Math.max(0, action.cap);
      break;
    }
    case 'cleanseConvert': {
      // CONVERT WHAT THE CLEANSE ACTUALLY STRIPPED into bonus healing: `per` per
      // STACK removed by this cast's own cleanse (`CastCtx.cleansedStacks`, written
      // by the `cleanse` arm), clamped at `cap`, armed onto the heal-side seam
      // `healBonusFlat` for the cast's own `heal` to spend.
      //
      // THE ORDER IS THE INVERSE OF THE DAMAGE RIDERS' and the validator enforces
      // it: the `cleanse` must come BEFORE this arm (a rider that runs first reads 0)
      // and the `heal` AFTER it (a bonus nothing spends is a priced no-op). It is
      // still "read what is already there" — what is already there is this cast's
      // own earlier result rather than a standing pile.
      //
      // SUPPORTIVE and never per-victim: what it arms is healing, so there is no
      // foe involved at any point.
      if (!caster.alive) break;
      if (cast.cleansedStacks <= 0) break;
      cast.healBonusFlat += Math.min(action.per * cast.cleansedStacks, action.cap);
      break;
    }
    case 'thorns': {
      // Self buff: thorn stacks on the caster, consumed by the reflect hook in
      // applyStrike (one stack per direct hit taken; no turn expiry).
      // ONE PILE PER HOLDER, like the DoTs (applyDot): a recast MERGES its
      // stacks into the existing pile and re-attributes to the newest source —
      // never a second concurrent pile.
      if (!caster.alive) break;
      const pile = caster.statuses.find((st) => st.kind === 'thorns');
      if (pile) {
        pile.stacks = (pile.stacks ?? 0) + action.stacks;
        pile.turnsLeft = pile.stacks;
        pile.source = ctx.source;
        ctx.events.push({ turn: ctx.state.turn, kind: 'statusApplied', side: caster.side, unit: caster.index, status: 'thorns', stacks: pile.stacks, turns: pile.turnsLeft });
      } else {
        addStatus(ctx, caster, { kind: 'thorns', stacks: action.stacks, turnsLeft: action.stacks, fresh: true, source: ctx.source });
      }
      break;
    }
    case 'guard': {
      // Defensive: applies to the caster. Single-instance pct clamped to <=60.
      //
      // PILES COEXIST AND COMPOUND, WITHOUT BOUND — a recast opens a SECOND
      // pile rather than merging (`dealDamage`'s "Magical Guard" loop
      // multiplies every matching-property pile in array order), and the COUNT
      // of same-property piles is deliberately UNCAPPED. USER-LOCKED
      // 2026-08-20: "leave guard alone let player build what they want." A
      // count cap (`MAX_GUARD_PILES = 3`, with an at-cap dominance/eviction
      // rule) shipped 2026-08-19 and was rejected the next day; player freedom
      // to build a wall wins over the bound. Attrition (simulate.ts) remains
      // the backstop against a pure turtle — it deals TRUE damage, which no
      // typed guard pile can touch. See docs/combat-model-spec.md §8.
      if (!caster.alive) break;
      const pct = Math.max(0, Math.min(60, action.pct));
      addStatus(ctx, caster, { kind: 'guard', property: action.property, pct, turnsLeft: action.turns, fresh: true });
      break;
    }
    case 'negate': {
      // Defensive: applies to the caster. Total charges of a property clamped
      // to <= MAX_NEGATE_CHARGES.
      if (!caster.alive) break;
      const existing = caster.statuses
        .filter((s) => s.kind === 'negate' && s.property === action.property)
        .reduce((sum, s) => sum + (s.charges ?? 0), 0);
      const charges = Math.max(0, Math.min(action.charges, MAX_NEGATE_CHARGES - existing));
      if (charges <= 0) break;
      addStatus(ctx, caster, { kind: 'negate', property: action.property, charges, turnsLeft: 0, fresh: true });
      break;
    }
    case 'ward': {
      // Defensive: applies to the caster (self-only, exactly like negate — a
      // ward is never handed to an ally). Total charges clamped to
      // MAX_WARD_CHARGES at apply time, the same shape and the same site as
      // negate's per-property clamp; ward has no property axis, so the pile is
      // counted across ALL wards the holder carries.
      //
      // A recast opens a NEW pile (it does not merge), mirroring negate — the
      // clamp, not a merge, is what bounds the total. `consumeWard` therefore
      // walks the piles by index and spends the lowest-index one first.
      //
      // Note this addStatus call can NEVER be warded away by an existing ward:
      // 'ward' is not `isCleansable`, so a ward cannot consume itself.
      if (!caster.alive) break;
      const existing = caster.statuses
        .filter((s) => s.kind === 'ward')
        .reduce((sum, s) => sum + (s.charges ?? 0), 0);
      const charges = Math.max(0, Math.min(action.charges, MAX_WARD_CHARGES - existing));
      if (charges <= 0) break;
      addStatus(ctx, caster, { kind: 'ward', charges, turnsLeft: 0, fresh: true });
      break;
    }
  }
}

/** The additive targeting fields recorded on a `skillCast` event. */
type CastTargetInfo = Pick<
  Extract<CombatEvent, { kind: 'skillCast' }>,
  'targetUnit' | 'targetPolicy' | 'targetValue' | 'aoe' | 'targets'
>;

/**
 * Recorded-fact description of WHO a cast targets and WHY, computed at cast
 * start (before any action resolves). Support/self-only casts get no target
 * fields; AoE gets the `aoe`/`targets` marker; single-target offensive casts
 * get the chosen unit, the deciding policy, and its metric. Deterministic —
 * mirrors `resolveTargets`, no RNG.
 */
export function targetInfoForCast(ctx: Ctx, caster: CombatantState, skill: SkillDef): CastTargetInfo {
  if (!skill.effects.some(isOffensiveAction)) return {};
  const living = foesOf(ctx.state, caster).filter((f) => f.alive);
  if (living.length === 0) return {};
  if (skill.scope === 'all') return { aoe: true, targets: living.map((f) => f.index) };
  if (caster.focus !== undefined) {
    const focused = living.find((f) => f.index === caster.focus);
    if (focused) return { targetUnit: focused.index, targetPolicy: 'focus' };
  }
  const chosen = pickByPolicy(caster, living);
  switch (caster.targetPolicy) {
    case 'aggro':
      return { targetUnit: chosen.index, targetPolicy: 'aggro', targetValue: chosen.aggro };
    case 'lowestHp':
      return { targetUnit: chosen.index, targetPolicy: 'lowestHp', targetValue: chosen.stats.hp };
    case 'highestThreat':
      return { targetUnit: chosen.index, targetPolicy: 'highestThreat', targetValue: boardPowerLevel(chosen) };
    case 'first':
    default:
      return { targetUnit: chosen.index, targetPolicy: 'first' };
  }
}

/** Resolve one card cast from a board slot, with its aura modifiers. */
export function applyCast(
  ctx: Ctx,
  caster: CombatantState,
  skill: SkillDef,
  slot: number,
  mods: AuraMods,
  cursor: { before: number; after: number },
  auraSources: AuraSource[] = [],
): void {
  ctx.events.push({
    turn: ctx.state.turn,
    kind: 'skillCast',
    side: caster.side,
    unit: caster.index,
    slot,
    skillId: skill.id,
    span: skill.size,
    cursorBefore: cursor.before,
    cursorAfter: cursor.after,
    ...targetInfoForCast(ctx, caster, skill),
    // Only surface `auras` when a board aura actually contributed; omit the key
    // entirely otherwise so un-aura'd casts stay byte-identical.
    ...(auraSources.length > 0 ? { auras: auraSources } : {}),
  });
  /**
   * HAS THIS CAST BEEN CUT SHORT? The ONE stop condition of the effect loop, so
   * a future `Action` kind cannot miss it by forgetting its own guard.
   *
   * Two independent reasons, both "nothing later in this step ever runs":
   *
   *  1. `!caster.alive` — A DEAD CASTER STOPS CASTING. Thorns reflect can kill
   *     the caster in the middle of its own cast, and a corpse must not land the
   *     rest of its card: no remaining AoE hits, no poison rider, no stun, no
   *     self-shield. This used to be spelled `anySideWiped`, which is only true
   *     when EVERY unit of a side is dead — accidentally correct at 1v1 (a side
   *     of one IS wiped when its unit dies) and wrong in every pack fight, where
   *     a dying enemy caster leaves its side standing and the loop carried on
   *     applying its remaining effects from beyond the grave. It is checked HERE,
   *     once, rather than in each arm: only `shield`/`guard`/`negate`/`ward`/
   *     `taunt`/`lifesteal` ever checked `caster.alive`, so every damage, DoT and
   *     control arm was — and any new arm would be — unguarded.
   *  2. `anySideWiped` — FIRST TO FALL LOSES (user-locked 2026-08-04): the fight
   *     ends at the exact application that wipes a side, so a cast that lands the
   *     killing blow stops right there (no lifesteal-back off the killing blow,
   *     no self-buff after the last foe falls).
   *
   * Read-only, integer-free, consumes no RNG. At 1v1 it is exactly equivalent to
   * the old `anySideWiped` call, so every 1v1 log stays byte-identical.
   */
  const castCutShort = (): boolean => !caster.alive || anySideWiped(ctx.state);
  /**
   * SPEND A STANDING AFFINITY CHARGE. Done HERE, before the effect list is
   * walked, for two reasons: a card can never arm and spend within one cast (the
   * cross-cast ruling the whole rider family follows), and the charge lands in
   * `bonusFlat` on exactly the schedule every other rider's bonus does — read by
   * the first non-gem `damage` action and cleared with the cast.
   *
   * Matched on the CAST's type, not the armer's: the charge says "your next Fire
   * card", so any Fire card collects it. Cleared whether or not this cast has a
   * damage action to spend it on — a charge offered to a card that cannot use it
   * is spent, exactly as `bonusFlat` is on a hitless card, which is what stops a
   * support card from being a free place to park it.
   */
  let chargeSpent = 0;
  const standingCharge = caster.empowerNext;
  if (standingCharge !== undefined) {
    const castType = cardType(skill);
    if (castType !== undefined && castType.type === standingCharge.type) {
      chargeSpent = standingCharge.amount;
      caster.empowerNext = undefined;
    }
  }
  const cast: CastCtx = { damageDealt: 0, bonusFlat: chargeSpent, bonusByTarget: [], healBonusFlat: 0, overhealShieldCap: 0, cleansedStacks: 0, spreadsBand: castSpreadsBand(skill.effects) };
  // MULTI-HIT STAT SPLIT: the denominator is fixed for the whole cast and counts
  // the CARD'S OWN damage actions only — a gem-appended hit neither joins the
  // split nor advances the ordinal, so socketing a gem cannot shrink the hits
  // the card already had. The ordinal advances once per damage ACTION, never per
  // fan-out target, so an AoE hit and a single-target hit split identically. Both
  // are plain index walks over an array: no Map/Set, no RNG, no float.
  const hitCount = countDamageActions(skill.effects);
  let hitIndex = 0;
  // Tag every effect this cast emits with its source card (for the per-card report).
  ctx.source = { side: caster.side, unit: caster.index, slot, skillId: skill.id };
  for (const action of skill.effects) {
    const splits = action.kind === 'damage' && !action.fromGem;
    const hit: HitSplit = splits ? { index: hitIndex++, count: hitCount } : SINGLE_HIT;
    // Fan out: offensive actions apply to EACH resolved target in ascending
    // index order; support actions resolve to `[caster]` and run once.
    // `cast.damageDealt`
    // accumulates across all victims so lifesteal sums the whole cast.
    for (const target of resolveTargets(ctx, caster, skill, action)) {
      applyAction(ctx, caster, skill, action, mods, cast, target, hit);
      // The stop condition binds INSIDE one action's fan-out too: a caster killed
      // by the FIRST victim's thorns must not land the remaining AoE hits.
      if (castCutShort()) break;
    }
    // ONE COMBO BONUS PER CAST — spent by the first damage ACTION that read it,
    // cleared HERE rather than inside `applyAction` so an AoE hit still delivers
    // it to EVERY foe of that one action (the fan-out above is one action, not
    // several). A later damage action on the same card gets nothing: the card
    // face prints one number ("+20 if previous cast was Offense") and one number
    // is what the cast delivers, however many hits it splits into. The
    // alternative — dividing the bonus across the host's hits — was rejected
    // because the per-hit number would then depend on the host, and the printed
    // face cannot show that.
    // The per-victim conditional bonuses (`exploit`/`stackBonus`) are cleared on
    // exactly the same schedule and for exactly the same reason: the face prints
    // ONE number, so ONE cast delivers it once — to every foe of that one
    // action, and to no later action of the same card.
    if (readsCastBonus(action)) {
      cast.bonusFlat = 0;
      cast.bonusByTarget = [];
    }
    // THE HEAL-SIDE SEAM, cleared on exactly the same schedule and for exactly the
    // same reason: the first own `heal` action spends the cast's armed heal bonus
    // (`cleanseConvert`) and its overheal-shield allowance (`overhealShield`), and a
    // later heal action on the same card gets neither. One face, one number, one
    // conversion — however many heal lines the card splits into.
    if (readsCastHealBonus(action)) {
      cast.healBonusFlat = 0;
      cast.overhealShieldCap = 0;
    }
    // ...and between actions, so a killing blow (or a killed caster) drops every
    // remaining effect of the card. See `castCutShort`.
    if (castCutShort()) break;
  }
  // A special is the card's last effect by another name, so it obeys the same
  // stop condition — a dead caster runs no special either.
  if (skill.special !== undefined && !castCutShort()) {
    getSpecial(skill.special)(ctx, caster, skill, slot, mods);
  }
  ctx.source = undefined;
}
