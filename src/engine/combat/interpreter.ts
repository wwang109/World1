import type { Rng } from '../rng';
import type { Action, EffectSourceRef, Property, SkillDef } from '../types';
import type { AntiHealCategory, AntiHealReduction, CombatEvent, DamageCalculation } from './events';
import type { AuraMods, AuraSource } from './auras';
import { elementMatchup, matchupPct, weaponMatchup, type Matchup } from '../elements';
import { anySideWiped, boardPowerLevel, effStat, foesOf, teamOf, totalShield, type CombatState, type CombatantState, type StatusInstance } from './state';
import { getSpecial } from './specials';

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
    case 'poison':
    case 'burn':
    case 'bleed':
    case 'stun':
    case 'debuffStat':
    case 'expose':
    case 'slow':
    case 'disrupt':
    case 'shieldBreak':
      return true;
    default:
      // heal, shield, buffStat, cleanse, taunt, lifesteal, comboBonus, guard, negate
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
 * shield/guard/negate self-protect, and taunt/lifesteal/comboBonus are self
 * riders. Ally-shield is a future option (see resolveTargets).
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
 * candidate); shield/guard/negate and self riders stay on the caster.
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
  if (skill.scope === 'all') return living; // AoE: all living foes, ascending index.
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

/** Per-cast scratch state for rider actions (combo bonus, lifesteal). */
interface CastCtx {
  damageDealt: number;
  /** FLAT damage added by a triggered comboBonus this cast. */
  bonusFlat: number;
}

/** Apply damage through typed shields; emits events, marks death. */
export function dealDamage(
  ctx: Ctx,
  victim: CombatantState,
  amount: number,
  property: Property,
  opts: {
    bypassShields?: boolean;
    matchup?: Matchup;
    source?: 'skill' | 'poison' | 'burn' | 'bleed' | 'fatigue' | 'attrition';
    calculation?: Omit<DamageCalculation, 'guardReduction' | 'exposeBonus' | 'shieldBlocked' | 'hpDamage'>;
  } = {},
): void {
  if (!victim.alive || amount <= 0) return;
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
      return;
    }
  }

  // Magical Guard: multiplicative %-reduction per matching-property guard,
  // applied in statuses-array order (deterministic), floored, min 1 each.
  // Runs AFTER the caller's flat-MR/matchup/SD math and BEFORE shields. True
  // damage never matches a typed guard; matching-property DoTs are covered.
  let reduced = amount;
  let guarded = 0;
  for (const s of victim.statuses) {
    if (s.kind !== 'guard' || s.property !== property) continue;
    const after = Math.max(1, Math.floor((reduced * (100 - (s.pct ?? 0))) / 100));
    guarded += reduced - after;
    reduced = after;
  }

  // Expose: the mirror of guard. Amplifies a DIRECT hit (source `skill`) by
  // +pct% per active expose, in statuses-array order (deterministic), floored.
  // Runs right after guard reduction and before shields. DoT ticks (poison /
  // burn / bleed) and fatigue never trigger expose — only direct skill hits.
  let exposed = 0;
  if (source === 'skill') {
    for (const s of victim.statuses) {
      if (s.kind !== 'expose') continue;
      const amp = Math.floor((reduced * (s.pct ?? 0)) / 100);
      exposed += amp;
      reduced += amp;
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
}

/** Element wheel (magical) / weapon triangle (physical) result for a card vs a defender. */
export function cardMatchup(skill: SkillDef, defender: CombatantState): Matchup {
  if (skill.property === 'magical') return elementMatchup(skill.element, defender.elementAffinity);
  if (skill.property === 'physical') return weaponMatchup(skill.weapon, defender.weaponAffinity);
  return 'neutral';
}

function addStatus(ctx: Ctx, target: CombatantState, status: StatusInstance): void {
  if (!target.alive) return;
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
 * Apply one action to one already-resolved target, passed as `enemy` (the name
 * is historical). Offensive actions treat it as the victim. Ally-targeted
 * support (heal/cleanse/buffStat) treats it as the recipient ally chosen by
 * `resolveTargets` — which is the caster in 1v1, so `enemy === caster` there.
 * Self-only support (shield/guard/negate) and the self riders (taunt/lifesteal/
 * comboBonus) act on the caster directly. The interpreter fan-out (see
 * `applyCast`) calls this once per resolved target, in ascending index order.
 */
function applyAction(
  ctx: Ctx,
  caster: CombatantState,
  skill: SkillDef,
  action: Action,
  mods: AuraMods,
  cast: CastCtx,
  enemy: CombatantState,
): void {
  const property = skill.property;
  switch (action.kind) {
    case 'damage': {
      // FLAT model: a card's `power` is a flat base; the caster's scaling stat
      // (Attack / Magic Power / higher for TRUE) plus any aura / combo bonus are
      // ADDED flat on top — never multiplied. Damage and HP both scale linearly.
      // Only matchup (±%) and sudden death remain multipliers.
      const scalingStat = scalingStatName(caster, property);
      const baseStat = caster.stats[scalingStat];
      const effectiveStat = scaleStat(caster, property);
      const baseDamage = action.power + baseStat;
      const scaledDamage = action.power + effectiveStat;
      const flatBonus = mods.damageFlat + cast.bonusFlat;
      // Scaled base + flat aura/gem/combo bonus. There is no percent same-type
      // bonus: a board's type identity only grants a defensive affinity, which
      // feeds the weapon/element triangle multiplier (advantage/disadvantage)
      // applied below — not a flat damage add here.
      const modifiedDamage = scaledDamage + flatBonus;
      // TRUE damage (user-locked 2026-07-20): only the card's FLAT portion
      // bypasses defenses. The stat add is checked against the enemy's
      // matching defense (Attack vs Armor, Magic Power vs Magic Resist) —
      // defense can eat up to the stat add, never the flat base or bonuses.
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
      dealDamage(ctx, enemy, amount, property, {
        matchup,
        calculation: {
          scalingStat,
          baseStat,
          effectiveStat,
          power: action.power,
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
      let amount: number;
      let flat = false;
      let antiHeal: AntiHealReduction | undefined;
      if (property === 'true') {
        amount = action.power;
        flat = true;
      } else {
        // ANTI-HEAL WORLD RULE: a regular heal is taxed −20% per affliction
        // category active on the RECEIVER (cap −60%). TRUE heals skip this
        // branch entirely — irreducible by identity.
        const taxed = applyAntiHeal(target, action.power + scaleDefStat(caster, property) + mods.healFlat);
        amount = taxed.amount;
        antiHeal = taxed.antiHeal;
      }
      const before = target.stats.hp;
      target.stats.hp = Math.min(target.stats.maxHp, target.stats.hp + amount);
      const healed = target.stats.hp - before;
      // Emit whenever the card ATTEMPTED a heal (even if fully overhealed) so the
      // per-card report credits its full output; `amount` is the effective HP
      // restored, `overheal` the wasted remainder (attempted = amount + overheal).
      if (amount > 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'heal', side: target.side, unit: target.index, amount: healed, overheal: amount - healed, flat, hpAfter: target.stats.hp, ...(antiHeal ? { antiHeal } : {}), ...(ctx.source ? { sourceCard: ctx.source } : {}) });
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
      const statBonus = scaleDefStat(caster, property);
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
      if (!enemy.alive) break;
      const pct = Math.max(0, Math.min(50, action.pct));
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
      // Slows don't stack (that would permanently lock out slow enemies):
      // the strongest pending slow applies until the enemy next performs.
      if (!enemy.alive) break;
      enemy.nextWeightPenalty = Math.max(enemy.nextWeightPenalty, action.weight);
      ctx.events.push({ turn: ctx.state.turn, kind: 'slowed', side: enemy.side, unit: enemy.index, weight: action.weight });
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
      const before = caster.stats.hp;
      caster.stats.hp = Math.min(caster.stats.maxHp, caster.stats.hp + amount);
      const healed = caster.stats.hp - before;
      if (healed > 0) {
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
    case 'guard': {
      // Defensive: applies to the caster. Single-instance pct clamped to <=60.
      if (!caster.alive) break;
      const pct = Math.max(0, Math.min(60, action.pct));
      addStatus(ctx, caster, { kind: 'guard', property: action.property, pct, turnsLeft: action.turns, fresh: true });
      break;
    }
    case 'negate': {
      // Defensive: applies to the caster. Total charges of a property clamped to <=3.
      if (!caster.alive) break;
      const existing = caster.statuses
        .filter((s) => s.kind === 'negate' && s.property === action.property)
        .reduce((sum, s) => sum + (s.charges ?? 0), 0);
      const charges = Math.max(0, Math.min(action.charges, 3 - existing));
      if (charges <= 0) break;
      addStatus(ctx, caster, { kind: 'negate', property: action.property, charges, turnsLeft: 0, fresh: true });
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
  const cast: CastCtx = { damageDealt: 0, bonusFlat: 0 };
  // Tag every effect this cast emits with its source card (for the per-card report).
  ctx.source = { side: caster.side, unit: caster.index, slot, skillId: skill.id };
  for (const action of skill.effects) {
    // Fan out: offensive actions apply to EACH resolved target in ascending
    // index order; support actions resolve to `[caster]` and run once.
    // `cast.damageDealt`
    // accumulates across all victims so lifesteal sums the whole cast.
    for (const target of resolveTargets(ctx, caster, skill, action)) {
      applyAction(ctx, caster, skill, action, mods, cast, target);
    }
    // FIRST TO FALL LOSES (user-locked 2026-08-04): the fight ends at the exact
    // application that wipes a side, so a cast that lands the killing blow STOPS
    // right there — its remaining effects are "later in the same step" and never
    // apply. Concretely: NO LIFESTEAL-BACK off the killing blow, and no self
    // shield/buff/taunt tacked on after the last foe falls. The action loop is the
    // finest order the DSL defines; the remaining FAN-OUT targets of the action
    // that did the wiping need no check because every action is already a no-op on
    // a dead target (see `dealDamage`, `applyDot`, `addStatus`). Consumes no RNG
    // (nothing in the loop does), so the Rng call order is untouched.
    if (anySideWiped(ctx.state)) break;
  }
  if (skill.special !== undefined && !anySideWiped(ctx.state)) {
    getSpecial(skill.special)(ctx, caster, skill, slot, mods);
  }
  ctx.source = undefined;
}
