import type { Rng } from '../rng';
import type { Action, Property, SkillDef } from '../types';
import type { CombatEvent } from './events';
import type { AuraMods } from './auras';
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

/** Apply damage through typed shields; emits events, marks death. */
export function dealDamage(
  ctx: Ctx,
  victim: CombatantState,
  amount: number,
  property: Property,
  opts: { crit?: boolean; bypassShields?: boolean; source?: 'skill' | 'poison' | 'burn' | 'fatigue' } = {},
): void {
  if (!victim.alive || amount <= 0) return;
  const blocked = opts.bypassShields ? 0 : consumeShields(victim, property, amount);
  const remaining = amount - blocked;
  victim.stats.hp = Math.max(0, victim.stats.hp - remaining);
  ctx.events.push({
    turn: ctx.state.turn,
    kind: 'damage',
    side: victim.side,
    amount,
    property,
    blocked,
    crit: opts.crit ?? false,
    hpAfter: victim.stats.hp,
    source: opts.source ?? 'skill',
  });
  if (victim.stats.hp === 0) {
    victim.alive = false;
    ctx.events.push({ turn: ctx.state.turn, kind: 'died', side: victim.side });
  }
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
  });
}

function applyAction(ctx: Ctx, caster: CombatantState, skill: SkillDef, action: Action, mods: AuraMods): void {
  const enemy = opponentOf(ctx.state, caster);
  const property = skill.property;
  switch (action.kind) {
    case 'damage': {
      let base = Math.floor((scaleStat(caster, property) * action.power) / 100);
      base = Math.floor((base * (100 + mods.damagePct)) / 100);
      const critChance = Math.max(0, effStat(caster, 'critPct') + mods.critPctDelta);
      const crit = ctx.rng.pct(Math.min(100, critChance));
      let amount = Math.max(1, base - mitigation(enemy, property));
      if (crit) amount = Math.floor((amount * 150) / 100);
      if (caster.sdStacks > 0) amount = Math.floor((amount * (100 + caster.sdStacks)) / 100);
      dealDamage(ctx, enemy, amount, property, { crit });
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
    case 'poison':
      addStatus(ctx, enemy, { kind: 'poison', property, amount: action.amount, turnsLeft: action.turns, fresh: true });
      break;
    case 'burn':
      addStatus(ctx, enemy, { kind: 'burn', property, amount: action.amount, turnsLeft: action.turns, fresh: true });
      break;
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
  for (const action of skill.effects) {
    applyAction(ctx, caster, skill, action, mods);
  }
  if (skill.special !== undefined) {
    getSpecial(skill.special)(ctx, caster, skill, slot, mods);
  }
}
