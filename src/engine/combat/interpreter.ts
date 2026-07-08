import type { Rng } from '../rng';
import type { Action, SkillDef } from '../types';
import type { CombatEvent } from './events';
import type { AuraMods } from './auras';
import { effStat, opponentOf, type CombatState, type CombatantState, type StatusInstance } from './state';
import { getSpecial } from './specials';

export interface Ctx {
  state: CombatState;
  rng: Rng;
  events: CombatEvent[];
}

/** Apply raw damage through the victim's shield; emits events, marks death. */
export function dealDamage(
  ctx: Ctx,
  victim: CombatantState,
  amount: number,
  opts: { crit?: boolean; ignoreShield?: boolean; source?: 'skill' | 'fatigue' } = {},
): void {
  if (!victim.alive || amount <= 0) return;
  let blocked = 0;
  let remaining = amount;
  if (!opts.ignoreShield && victim.shield > 0) {
    blocked = Math.min(victim.shield, remaining);
    victim.shield -= blocked;
    remaining -= blocked;
  }
  victim.stats.hp = Math.max(0, victim.stats.hp - remaining);
  ctx.events.push({
    time: ctx.state.now,
    kind: 'damage',
    side: victim.side,
    amount,
    blocked,
    crit: opts.crit ?? false,
    hpAfter: victim.stats.hp,
    source: opts.source ?? 'skill',
  });
  if (victim.stats.hp === 0) {
    victim.alive = false;
    ctx.events.push({ time: ctx.state.now, kind: 'died', side: victim.side });
  }
}

function healSelf(ctx: Ctx, c: CombatantState, amount: number): void {
  if (!c.alive || amount <= 0) return;
  const before = c.stats.hp;
  c.stats.hp = Math.min(c.stats.maxHp, c.stats.hp + amount);
  const healed = c.stats.hp - before;
  if (healed > 0) {
    ctx.events.push({ time: ctx.state.now, kind: 'heal', side: c.side, amount: healed, hpAfter: c.stats.hp });
  }
}

function addStatus(ctx: Ctx, target: CombatantState, status: StatusInstance): void {
  if (!target.alive) return;
  target.statuses.push(status);
  ctx.events.push({
    time: ctx.state.now,
    kind: 'statusApplied',
    side: target.side,
    status: status.kind,
    turns: status.turnsLeft,
  });
}

function applyAction(ctx: Ctx, caster: CombatantState, action: Action, mods: AuraMods): void {
  const enemy = opponentOf(ctx.state, caster);
  switch (action.kind) {
    case 'damage': {
      let base = Math.floor((effStat(caster, 'atk') * action.power) / 100);
      base = Math.floor((base * (100 + mods.damagePct)) / 100);
      const critChance = Math.max(0, effStat(caster, 'critPct') + mods.critPctDelta);
      const crit = ctx.rng.pct(Math.min(100, critChance));
      let amount = Math.max(1, base - effStat(enemy, 'def'));
      if (crit) amount = Math.floor((amount * 150) / 100);
      if (caster.sdStacks > 0) amount = Math.floor((amount * (100 + caster.sdStacks)) / 100);
      dealDamage(ctx, enemy, amount, { crit });
      break;
    }
    case 'heal': {
      let amount = Math.floor((effStat(caster, 'atk') * action.power) / 100);
      amount = Math.floor((amount * (100 + mods.healPct)) / 100);
      healSelf(ctx, caster, amount);
      break;
    }
    case 'shield': {
      const amount = Math.floor((effStat(caster, 'atk') * action.power) / 100);
      if (amount > 0) {
        caster.shield += amount;
        ctx.events.push({
          time: ctx.state.now,
          kind: 'shieldGain',
          side: caster.side,
          amount,
          shieldAfter: caster.shield,
        });
      }
      break;
    }
    case 'poison':
      addStatus(ctx, enemy, { kind: 'poison', amount: action.amount, turnsLeft: action.turns });
      break;
    case 'burn':
      addStatus(ctx, enemy, { kind: 'burn', amount: action.amount, turnsLeft: action.turns });
      break;
    case 'stun':
      addStatus(ctx, enemy, { kind: 'stun', turnsLeft: action.turns });
      break;
    case 'buffStat':
      addStatus(ctx, caster, {
        kind: 'buff',
        stat: action.stat,
        pct: action.pct,
        turnsLeft: action.turns,
        skipFirstExpiry: true,
      });
      break;
    case 'debuffStat':
      addStatus(ctx, enemy, { kind: 'debuff', stat: action.stat, pct: action.pct, turnsLeft: action.turns });
      break;
    case 'cleanse': {
      const before = caster.statuses.length;
      caster.statuses = caster.statuses.filter((s) => s.kind === 'buff');
      const removed = before - caster.statuses.length;
      if (removed > 0) {
        ctx.events.push({ time: ctx.state.now, kind: 'cleansed', side: caster.side, removed });
      }
      break;
    }
  }
}

/** Resolve one skill cast from a board piece, with its aura modifiers. */
export function applyCast(
  ctx: Ctx,
  caster: CombatantState,
  skill: SkillDef,
  slot: number,
  mods: AuraMods,
): void {
  ctx.events.push({ time: ctx.state.now, kind: 'skillCast', side: caster.side, slot, skillId: skill.id });
  for (const action of skill.effects) {
    applyAction(ctx, caster, action, mods);
  }
  if (skill.special !== undefined) {
    getSpecial(skill.special)(ctx, caster, skill, slot, mods);
  }
}
