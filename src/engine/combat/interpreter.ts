import type { Rng } from '../rng';
import type { Action, Property, SkillDef } from '../types';
import type { CombatEvent } from './events';
import type { AuraMods } from './auras';
import { elementMatchup, matchupPct, weaponMatchup, type Matchup } from '../elements';
import { effStat, opponentOf, totalShield, type CombatState, type CombatantState, type StatusInstance } from './state';
import { getSpecial } from './specials';

export interface Ctx {
  state: CombatState;
  rng: Rng;
  events: CombatEvent[];
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
      ctx.events.push({ turn: ctx.state.turn, kind: 'negated', side: victim.side, property });
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
    ctx.events.push({ turn: ctx.state.turn, kind: 'died', side: victim.side });
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
    status: status.kind,
    property: status.property,
    turns: status.turnsLeft,
    charges: status.charges,
  });
}

function applyAction(
  ctx: Ctx,
  caster: CombatantState,
  skill: SkillDef,
  action: Action,
  mods: AuraMods,
  cast: CastCtx,
): void {
  const enemy = opponentOf(ctx.state, caster);
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
        ctx.events.push({ turn: ctx.state.turn, kind: 'heal', side: caster.side, amount: healed, flat, hpAfter: caster.stats.hp });
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
        ctx.events.push({ turn: ctx.state.turn, kind: 'cleansed', side: caster.side, removed });
      }
      break;
    }
    case 'slowNext':
      // Slows don't stack (that would permanently lock out slow enemies):
      // the strongest pending slow applies until the enemy next performs.
      if (!enemy.alive) break;
      enemy.nextWeightPenalty = Math.max(enemy.nextWeightPenalty, action.weight);
      ctx.events.push({ turn: ctx.state.turn, kind: 'slowedNext', side: enemy.side, weight: action.weight });
      break;
    case 'stagger': {
      if (!enemy.alive) break;
      const drained = Math.min(enemy.bank, action.amount);
      enemy.bank -= drained;
      ctx.events.push({ turn: ctx.state.turn, kind: 'staggered', side: enemy.side, amount: drained, bankAfter: enemy.bank });
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
        ctx.events.push({ turn: ctx.state.turn, kind: 'heal', side: caster.side, amount: healed, flat: false, hpAfter: caster.stats.hp });
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
        ctx.events.push({ turn: ctx.state.turn, kind: 'shieldBroken', side: enemy.side, amount: broken, totalAfter: totalShield(enemy) });
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
    slot,
    skillId: skill.id,
    span: skill.size,
  });
  const cast: CastCtx = { damageDealt: 0, bonusPct: 0 };
  for (const action of skill.effects) {
    applyAction(ctx, caster, skill, action, mods, cast);
  }
  if (skill.special !== undefined) {
    getSpecial(skill.special)(ctx, caster, skill, slot, mods);
  }
}
