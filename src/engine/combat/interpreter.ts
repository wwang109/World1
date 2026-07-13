import type { Rng } from '../rng';
import type { Action, Property, SkillDef } from '../types';
import type { CombatEvent } from './events';
import type { AuraMods } from './auras';
import { elementMatchup, matchupPct, weaponMatchup, type Matchup } from '../elements';
import { boardPowerLevel, effStat, foesOf, totalShield, type CombatState, type CombatantState, type StatusInstance } from './state';
import { getSpecial } from './specials';

export interface Ctx {
  state: CombatState;
  rng: Rng;
  events: CombatEvent[];
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
    case 'stun':
    case 'debuffStat':
    case 'slowNext':
    case 'stagger':
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
 * Resolve the targets of one action. Support actions apply to the caster.
 * Offensive actions hit foes: `scope: 'all'` = every living foe (ascending
 * index); otherwise the ONE foe chosen by `focus` (when that unit is living)
 * else `targetPolicy`. All deterministic — no RNG, computed from current state.
 *
 * 1v1 byte-identical: the sole foe is returned when living, and — matching the
 * old `foesOf(state, caster)[0]` behavior — the (dead) foe is still returned as
 * a no-op fallback when it is the only foe and has died mid-cast, so a trailing
 * damage action still consumes its crit roll in the same fixed RNG order.
 */
export function resolveTargets(
  ctx: Ctx,
  caster: CombatantState,
  skill: SkillDef,
  action: Action,
): CombatantState[] {
  if (!isOffensiveAction(action)) return [caster];
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

/** Scaling stat for a property: Attack / Magic Power / higher of the two. */
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

/** Flat defense against a property (true damage has none). */
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
 * then the true pool (true shields block everything). True damage is only
 * ever blocked by true shields.
 */
function consumeShields(c: CombatantState, property: Property, amount: number): number {
  let blocked = 0;
  if (property !== 'true') {
    const pool = Math.min(c.shields[property], amount);
    c.shields[property] -= pool;
    blocked += pool;
    amount -= pool;
  }
  const truePool = Math.min(c.shields.true, amount);
  c.shields.true -= truePool;
  blocked += truePool;
  return blocked;
}

/** Per-cast scratch state for rider actions (combo bonus, lifesteal). */
interface CastCtx {
  damageDealt: number;
  bonusPct: number;
}

/** Apply damage through typed shields; emits events, marks death. */
export function dealDamage(
  ctx: Ctx,
  victim: CombatantState,
  amount: number,
  property: Property,
  opts: {
    crit?: boolean;
    bypassShields?: boolean;
    matchup?: Matchup;
    source?: 'skill' | 'poison' | 'burn' | 'fatigue';
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

  const blocked = opts.bypassShields ? 0 : consumeShields(victim, property, reduced);
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
    crit: opts.crit ?? false,
    matchup: opts.matchup === 'advantage' || opts.matchup === 'disadvantage' ? opts.matchup : undefined,
    guarded: guarded > 0 ? guarded : undefined,
    hpAfter: victim.stats.hp,
    source,
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
    turns: status.turnsLeft,
    charges: status.charges,
  });
}

/**
 * Apply one action to one already-resolved target. Offensive actions receive
 * the victim as `enemy`; support actions ignore it and act on the caster (for a
 * support action `enemy === caster`). The interpreter fan-out (see `applyCast`)
 * calls this once per resolved target, in ascending index order.
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
      let base = Math.floor((scaleStat(caster, property) * action.power) / 100);
      base = Math.floor((base * (100 + mods.damagePct + cast.bonusPct)) / 100);
      const critChance = Math.max(0, effStat(caster, 'critPct') + mods.critPctDelta);
      const crit = ctx.rng.pct(Math.min(100, critChance));
      let amount = Math.max(1, base - mitigation(enemy, property));
      if (crit) amount = Math.floor((amount * 150) / 100);
      const matchup = cardMatchup(skill, enemy);
      amount = Math.floor((amount * matchupPct(matchup)) / 100);
      if (caster.sdStacks > 0) amount = Math.floor((amount * (100 + caster.sdStacks)) / 100);
      const hpBefore = enemy.stats.hp;
      dealDamage(ctx, enemy, Math.max(1, amount), property, { crit, matchup });
      cast.damageDealt += hpBefore - enemy.stats.hp;
      break;
    }
    case 'heal': {
      if (!caster.alive) break;
      // TRUE heals are flat: exact amount, no scaling, no aura math.
      let amount: number;
      let flat = false;
      if (property === 'true') {
        amount = action.power;
        flat = true;
      } else {
        amount = Math.floor((scaleStat(caster, property) * action.power) / 100);
        amount = Math.floor((amount * (100 + mods.healPct)) / 100);
      }
      const before = caster.stats.hp;
      caster.stats.hp = Math.min(caster.stats.maxHp, caster.stats.hp + amount);
      const healed = caster.stats.hp - before;
      if (healed > 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'heal', side: caster.side, unit: caster.index, amount: healed, flat, hpAfter: caster.stats.hp });
      }
      break;
    }
    case 'shield': {
      if (!caster.alive) break;
      // Shields stack and carry over, but total shield is hard-capped at maxHp.
      const request = property === 'true' ? action.power : Math.floor((scaleStat(caster, property) * action.power) / 100);
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
      });
      break;
    }
    case 'poison': {
      // DoTs inherit the card's element/weapon: the matchup bakes into the tick amount.
      const amount = Math.max(1, Math.floor((action.amount * matchupPct(cardMatchup(skill, enemy))) / 100));
      addStatus(ctx, enemy, { kind: 'poison', property, amount, turnsLeft: action.turns, fresh: true });
      break;
    }
    case 'burn': {
      const amount = Math.max(1, Math.floor((action.amount * matchupPct(cardMatchup(skill, enemy))) / 100));
      addStatus(ctx, enemy, { kind: 'burn', property, amount, turnsLeft: action.turns, fresh: true });
      break;
    }
    case 'stun':
      addStatus(ctx, enemy, { kind: 'stun', turnsLeft: action.turns, fresh: true });
      break;
    case 'buffStat':
      // TRUE buffs are flat amounts; physical/magical buffs are percentages.
      if (property === 'true') {
        addStatus(ctx, caster, { kind: 'buff', stat: action.stat, amount: action.pct, turnsLeft: action.turns, fresh: true });
      } else {
        addStatus(ctx, caster, { kind: 'buff', stat: action.stat, pct: action.pct, turnsLeft: action.turns, fresh: true });
      }
      break;
    case 'debuffStat':
      if (property === 'true') {
        addStatus(ctx, enemy, { kind: 'debuff', stat: action.stat, amount: action.pct, turnsLeft: action.turns, fresh: true });
      } else {
        addStatus(ctx, enemy, { kind: 'debuff', stat: action.stat, pct: action.pct, turnsLeft: action.turns, fresh: true });
      }
      break;
    case 'cleanse': {
      if (!caster.alive) break;
      const before = caster.statuses.length;
      caster.statuses = caster.statuses.filter((s) => s.kind === 'buff');
      const removed = before - caster.statuses.length;
      if (removed > 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'cleansed', side: caster.side, unit: caster.index, removed });
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
    case 'slowNext':
      // Slows don't stack (that would permanently lock out slow enemies):
      // the strongest pending slow applies until the enemy next performs.
      if (!enemy.alive) break;
      enemy.nextWeightPenalty = Math.max(enemy.nextWeightPenalty, action.weight);
      ctx.events.push({ turn: ctx.state.turn, kind: 'slowedNext', side: enemy.side, unit: enemy.index, weight: action.weight });
      break;
    case 'stagger': {
      if (!enemy.alive) break;
      const drained = Math.min(enemy.bank, action.amount);
      enemy.bank -= drained;
      ctx.events.push({ turn: ctx.state.turn, kind: 'staggered', side: enemy.side, unit: enemy.index, amount: drained, bankAfter: enemy.bank });
      break;
    }
    case 'lifesteal': {
      if (!caster.alive || cast.damageDealt <= 0) break;
      const amount = Math.floor((cast.damageDealt * action.pct) / 100);
      if (amount <= 0) break;
      const before = caster.stats.hp;
      caster.stats.hp = Math.min(caster.stats.maxHp, caster.stats.hp + amount);
      const healed = caster.stats.hp - before;
      if (healed > 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'heal', side: caster.side, unit: caster.index, amount: healed, flat: false, hpAfter: caster.stats.hp });
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
        cast.bonusPct += action.pct;
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
function targetInfoForCast(ctx: Ctx, caster: CombatantState, skill: SkillDef): CastTargetInfo {
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
): void {
  ctx.events.push({
    turn: ctx.state.turn,
    kind: 'skillCast',
    side: caster.side,
    unit: caster.index,
    slot,
    skillId: skill.id,
    span: skill.size,
    ...targetInfoForCast(ctx, caster, skill),
  });
  const cast: CastCtx = { damageDealt: 0, bonusPct: 0 };
  for (const action of skill.effects) {
    // Fan out: offensive actions apply to EACH resolved target in ascending
    // index order (so crit rolls fire per victim in a fixed RNG order);
    // support actions resolve to `[caster]` and run once. `cast.damageDealt`
    // accumulates across all victims so lifesteal sums the whole cast.
    for (const target of resolveTargets(ctx, caster, skill, action)) {
      applyAction(ctx, caster, skill, action, mods, cast, target);
    }
  }
  if (skill.special !== undefined) {
    getSpecial(skill.special)(ctx, caster, skill, slot, mods);
  }
}
