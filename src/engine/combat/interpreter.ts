import type { Rng } from '../rng';
import type { Action, EnchantDef, Property, SkillDef, TargetMode } from '../types';
import type { CombatEvent } from './events';
import type { AuraMods } from './auras';
import { elementMatchup, matchupPct, weaponMatchup, type Matchup } from '../elements';
import { effectPotencyPct, effStat, isPositiveStatus, livingFoes, pickTarget, totalShield, type CombatState, type CombatantState, type StatusInstance } from './state';
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

/** Resolved targeting for one cast (enchant overrides the card's default). */
interface TargetPlan {
  mode: TargetMode;
  /** For 'all': each target takes this % of the rolled damage. */
  aoePct: number;
}

/** Single-target mode for a plan ('all' riders stick to the default pick). */
function singleMode(plan: TargetPlan): 'aggro' | 'lowAggro' | 'lowestHp' {
  return plan.mode === 'all' ? 'aggro' : plan.mode;
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
    source?: 'skill' | 'poison' | 'burn' | 'fatigue' | 'thorns';
  } = {},
): void {
  if (!victim.alive || amount <= 0) return;
  const blocked = opts.bypassShields ? 0 : consumeShields(victim, property, amount);
  const remaining = amount - blocked;
  victim.stats.hp = Math.max(0, victim.stats.hp - remaining);
  ctx.events.push({
    turn: ctx.state.turn,
    kind: 'damage',
    side: victim.side,
    unit: victim.unit,
    amount,
    property,
    blocked,
    crit: opts.crit ?? false,
    matchup: opts.matchup === 'advantage' || opts.matchup === 'disadvantage' ? opts.matchup : undefined,
    hpAfter: victim.stats.hp,
    source: opts.source ?? 'skill',
  });
  if (victim.stats.hp === 0) {
    victim.alive = false;
    ctx.events.push({ turn: ctx.state.turn, kind: 'died', side: victim.side, unit: victim.unit });
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
    unit: target.unit,
    status: status.kind,
    property: status.property,
    turns: status.turnsLeft,
  });
}

/** One skill strike at a specific target: scaling, crit, mitigation, matchup, thorns payback. */
function strike(ctx: Ctx, caster: CombatantState, skill: SkillDef, power: number, mods: AuraMods, cast: CastCtx, enemy: CombatantState): void {
  const property = skill.property;
  let base = Math.floor((scaleStat(caster, property) * power) / 100);
  // Staleness / momentum — BASE damage is never touched by either; only
  // BONUS effectiveness (aura boosts, combo/execute riders) flexes:
  // - repeating the same skill fades the bonus −25% per re-cast (gone by
  //   the 4th);
  // - chaining DIFFERENT skills amplifies it +25% per link (cap +75%),
  //   so combo rotations ramp UP.
  const stalePct = 25 * Math.min(caster.staleCasts, 4);
  const momentumPct = 25 * Math.min(caster.momentumCasts, 3);
  let bonus = mods.damagePct + cast.bonusPct;
  if (bonus > 0) {
    if (stalePct > 0) bonus = Math.floor((bonus * (100 - stalePct)) / 100);
    else if (momentumPct > 0) bonus = Math.floor((bonus * (100 + momentumPct)) / 100);
  }
  base = Math.floor((base * (100 + bonus)) / 100);
  // Weaken (enemy "reduced effect" cards): this cast was jammed — its
  // damage lands weaker. Consumed after the cast completes.
  if (caster.nextCastWeakenPct > 0) base = Math.floor((base * (100 - caster.nextCastWeakenPct)) / 100);
  // Deterministic crits — combat has NO randomness: each strike banks its
  // crit chance; at 100 the strike crits and spends the bank, so 50% crit
  // means exactly every 2nd strike. Clamped so >100% chance stays "always".
  const critChance = Math.max(0, effStat(caster, 'critPct') + mods.critPctDelta);
  caster.critBank += critChance;
  const crit = caster.critBank >= 100;
  if (crit) caster.critBank = Math.min(caster.critBank - 100, 100);
  let amount = Math.max(1, base - mitigation(enemy, property));
  if (crit) amount = Math.floor((amount * 150) / 100);
  const matchup = cardMatchup(skill, enemy);
  amount = Math.floor((amount * matchupPct(matchup)) / 100);
  if (caster.sdStacks > 0) amount = Math.floor((amount * (100 + caster.sdStacks)) / 100);
  amount = Math.max(1, amount);
  const hpBefore = enemy.stats.hp;
  dealDamage(ctx, enemy, amount, property, { crit, matchup });
  cast.damageDealt += hpBefore - enemy.stats.hp;
  // Thorns: the defender pays back a cut of the incoming hit (pre-shield) as
  // TRUE damage. Iterate by index — statuses is an array, order is fixed.
  let thornsPct = 0;
  for (const s of enemy.statuses) {
    if (s.kind === 'thorns') thornsPct += s.pct ?? 0;
  }
  if (thornsPct > 0) {
    const reflect = Math.floor((amount * thornsPct) / 100);
    if (reflect > 0) dealDamage(ctx, caster, reflect, 'true', { source: 'thorns' });
  }
}

function applyAction(
  ctx: Ctx,
  caster: CombatantState,
  skill: SkillDef,
  action: Action,
  mods: AuraMods,
  cast: CastCtx,
  plan: TargetPlan,
): void {
  // Non-damage hostile actions always pick ONE target by the plan's mode
  // (an assassin-marked poison lands on the backline); AoE spreads damage
  // strikes only.
  const enemy = pickTarget(ctx.state, caster, singleMode(plan));
  const property = skill.property;
  switch (action.kind) {
    case 'damage':
      if (plan.mode === 'all') {
        const aoePower = Math.floor((action.power * plan.aoePct) / 100);
        for (const foe of livingFoes(ctx.state, caster)) {
          if (!caster.alive) break;
          strike(ctx, caster, skill, aoePower, mods, cast, foe);
        }
      } else {
        strike(ctx, caster, skill, action.power, mods, cast, enemy);
      }
      break;
    case 'multiHit':
      // Each hit is a full independent strike: its own crit roll (fixed RNG
      // order), its own mitigation — armor is strong against many small hits.
      // Target re-resolves per hit, so a kill rolls leftover hits into the
      // next foe in the formation.
      for (let i = 0; i < action.hits && caster.alive; i++) {
        if (plan.mode === 'all') {
          const foes = livingFoes(ctx.state, caster);
          if (foes.length === 0) break;
          const aoePower = Math.floor((action.power * plan.aoePct) / 100);
          for (const foe of foes) {
            if (!caster.alive || !foe.alive) continue;
            strike(ctx, caster, skill, aoePower, mods, cast, foe);
          }
        } else {
          const target = pickTarget(ctx.state, caster, singleMode(plan));
          if (!target.alive) break;
          strike(ctx, caster, skill, action.power, mods, cast, target);
        }
      }
      break;
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
        ctx.events.push({ turn: ctx.state.turn, kind: 'heal', side: caster.side, unit: caster.unit, amount: healed, flat, hpAfter: caster.stats.hp });
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
        unit: caster.unit,
        property,
        amount: gain,
        wasted,
        totalAfter: totalShield(caster),
      });
      break;
    }
    case 'poison': {
      // DoTs inherit the card's element/weapon (matchup bakes into the tick),
      // then the victim's RESOLVE CHECK scales the whole effect.
      const base = Math.max(1, Math.floor((action.amount * matchupPct(cardMatchup(skill, enemy))) / 100));
      const amount = Math.floor((base * effectPotencyPct(enemy)) / 100);
      if (amount <= 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'resisted', side: enemy.side, unit: enemy.unit, status: 'poison' });
        break;
      }
      addStatus(ctx, enemy, { kind: 'poison', property, amount, turnsLeft: action.turns, fresh: true });
      break;
    }
    case 'burn': {
      const base = Math.max(1, Math.floor((action.amount * matchupPct(cardMatchup(skill, enemy))) / 100));
      const amount = Math.floor((base * effectPotencyPct(enemy)) / 100);
      if (amount <= 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'resisted', side: enemy.side, unit: enemy.unit, status: 'burn' });
        break;
      }
      addStatus(ctx, enemy, { kind: 'burn', property, amount, turnsLeft: action.turns, fresh: true });
      break;
    }
    case 'stun': {
      // Resolve shortens stun DURATION (rounded): past ~50 Resolve a 1-turn
      // stun is fully resisted.
      const turns = Math.round((action.turns * effectPotencyPct(enemy)) / 100);
      if (turns <= 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'resisted', side: enemy.side, unit: enemy.unit, status: 'stun' });
        break;
      }
      addStatus(ctx, enemy, { kind: 'stun', turnsLeft: turns, fresh: true });
      break;
    }
    case 'buffStat':
      // TRUE buffs are flat amounts; physical/magical buffs are percentages.
      if (property === 'true') {
        addStatus(ctx, caster, { kind: 'buff', stat: action.stat, amount: action.pct, turnsLeft: action.turns, fresh: true });
      } else {
        addStatus(ctx, caster, { kind: 'buff', stat: action.stat, pct: action.pct, turnsLeft: action.turns, fresh: true });
      }
      break;
    case 'debuffStat': {
      const strength = Math.floor((action.pct * effectPotencyPct(enemy)) / 100);
      if (strength <= 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'resisted', side: enemy.side, unit: enemy.unit, status: 'debuff' });
        break;
      }
      if (property === 'true') {
        addStatus(ctx, enemy, { kind: 'debuff', stat: action.stat, amount: strength, turnsLeft: action.turns, fresh: true });
      } else {
        addStatus(ctx, enemy, { kind: 'debuff', stat: action.stat, pct: strength, turnsLeft: action.turns, fresh: true });
      }
      break;
    }
    case 'cleanse': {
      if (!caster.alive) break;
      const before = caster.statuses.length;
      caster.statuses = caster.statuses.filter(isPositiveStatus);
      const removed = before - caster.statuses.length;
      if (removed > 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'cleansed', side: caster.side, unit: caster.unit, removed });
      }
      break;
    }
    case 'purge': {
      if (!enemy.alive) break;
      const before = enemy.statuses.length;
      enemy.statuses = enemy.statuses.filter((s) => !isPositiveStatus(s));
      const removed = before - enemy.statuses.length;
      if (removed > 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'purged', side: enemy.side, unit: enemy.unit, removed });
      }
      break;
    }
    case 'slowNext': {
      // Slows don't stack (that would permanently lock out slow enemies):
      // the strongest pending slow applies until the enemy next performs.
      if (!enemy.alive) break;
      const weight = Math.floor((action.weight * effectPotencyPct(enemy)) / 100);
      if (weight <= 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'resisted', side: enemy.side, unit: enemy.unit, status: 'slow' });
        break;
      }
      enemy.nextWeightPenalty = Math.max(enemy.nextWeightPenalty, weight);
      ctx.events.push({ turn: ctx.state.turn, kind: 'slowedNext', side: enemy.side, unit: enemy.unit, weight });
      break;
    }
    case 'weakenNext': {
      // Like slows, weakens don't stack — the strongest pending jam applies
      // to the enemy's next cast. Subject to the resolve check.
      if (!enemy.alive) break;
      const pct = Math.floor((action.pct * effectPotencyPct(enemy)) / 100);
      if (pct <= 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'resisted', side: enemy.side, unit: enemy.unit, status: 'weaken' });
        break;
      }
      enemy.nextCastWeakenPct = Math.max(enemy.nextCastWeakenPct, pct);
      ctx.events.push({ turn: ctx.state.turn, kind: 'weakenedNext', side: enemy.side, unit: enemy.unit, pct });
      break;
    }
    case 'stagger': {
      if (!enemy.alive) break;
      const potent = Math.floor((action.amount * effectPotencyPct(enemy)) / 100);
      if (potent <= 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'resisted', side: enemy.side, unit: enemy.unit, status: 'stagger' });
        break;
      }
      const drained = Math.min(enemy.bank, potent);
      enemy.bank -= drained;
      ctx.events.push({ turn: ctx.state.turn, kind: 'staggered', side: enemy.side, unit: enemy.unit, amount: drained, bankAfter: enemy.bank });
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
        ctx.events.push({ turn: ctx.state.turn, kind: 'heal', side: caster.side, unit: caster.unit, amount: healed, flat: false, hpAfter: caster.stats.hp });
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
        ctx.events.push({ turn: ctx.state.turn, kind: 'shieldBroken', side: enemy.side, unit: enemy.unit, amount: broken, totalAfter: totalShield(enemy) });
      }
      break;
    }
    case 'comboBonus':
      if (caster.lastCastArchetypes.some((a) => skill.archetypes.includes(a))) {
        cast.bonusPct += action.pct;
      }
      break;
    case 'execute':
      // Window check against the enemy's CURRENT hp (place before damage).
      if (enemy.stats.hp * 100 < enemy.stats.maxHp * action.belowPct) {
        cast.bonusPct += action.pct;
      }
      break;
    case 'quicken':
      // Like slows, quickens don't stack — the strongest pending one applies
      // to the caster's next action.
      if (!caster.alive) break;
      caster.nextWeightBonus = Math.max(caster.nextWeightBonus, action.weight);
      ctx.events.push({ turn: ctx.state.turn, kind: 'quickenedNext', side: caster.side, unit: caster.unit, weight: action.weight });
      break;
    case 'thorns':
      addStatus(ctx, caster, { kind: 'thorns', pct: action.pct, turnsLeft: action.turns, fresh: true });
      break;
    case 'regen':
      addStatus(ctx, caster, { kind: 'regen', amount: action.amount, turnsLeft: action.turns, fresh: true });
      break;
  }
}

/** Resolve one card cast from a board slot, with its aura modifiers and enchant. */
export function applyCast(
  ctx: Ctx,
  caster: CombatantState,
  skill: SkillDef,
  slot: number,
  mods: AuraMods,
  enchant?: EnchantDef,
): void {
  ctx.events.push({
    turn: ctx.state.turn,
    kind: 'skillCast',
    side: caster.side,
    unit: caster.unit,
    slot,
    skillId: skill.id,
    span: skill.size,
    enchant: enchant?.id,
  });
  const plan: TargetPlan = {
    mode: enchant?.targeting ?? skill.targeting ?? 'aggro',
    aoePct: enchant?.aoeDamagePct ?? 100,
  };
  const cast: CastCtx = { damageDealt: 0, bonusPct: 0 };
  for (const action of skill.effects) {
    applyAction(ctx, caster, skill, action, mods, cast, plan);
  }
  if (skill.special !== undefined) {
    getSpecial(skill.special)(ctx, caster, skill, slot, mods);
  }
}
