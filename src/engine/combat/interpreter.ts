import type { Rng } from '../rng';
import type { Action, EnchantDef, Property, SkillBook, SkillDef, TargetMode } from '../types';
import type { CombatEvent } from './events';
import type { AuraMods } from './auras';
import { elementMatchup, matchupPct, weaponMatchup, type Matchup } from '../elements';
import { effectPotencyPct, effSpeed, effStat, isPositiveStatus, livingFoes, pickTarget, totalShield, type CombatState, type CombatantState, type StatusInstance } from './state';
import { getSpecial } from './specials';
import { selectCast } from './castSelect';

export interface Ctx {
  state: CombatState;
  rng: Rng;
  events: CombatEvent[];
  /** Skill definitions (needed to resolve an enemy's queued card). */
  book: SkillBook;
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
  /** Trample Mark: killing-blow overkill carries into the next living enemy. */
  trample: boolean;
}

/** Resolved targeting for one cast (enchant overrides the card's default). */
interface TargetPlan {
  mode: TargetMode;
  /** For 'all': each target takes this % of the rolled damage. */
  aoePct: number;
  /** Enchant power trade-off (e.g. Chase Mark pays 40% damage for tempo). */
  powerPct: number;
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
    source?: 'skill' | 'poison' | 'burn' | 'fatigue' | 'thorns' | 'curse' | 'blood';
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

/** Element wheel / weapon triangle result for a card vs a defender, dispatched by the card's TAG (not its property). */
export function cardMatchup(skill: SkillDef, defender: CombatantState): Matchup {
  if (skill.element !== undefined) return elementMatchup(skill.element, defender.elementAffinity);
  if (skill.weapon !== undefined) return weaponMatchup(skill.weapon, defender.weaponAffinity);
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
  // Empower (own sword-intent setup): this cast was charged — its damage
  // lands harder. activeEmpowerPct is staged per-cast by doCast, so an
  // Empower rider on this very card primes the NEXT cast, not itself.
  if (caster.activeEmpowerPct > 0) base = Math.floor((base * (100 + caster.activeEmpowerPct)) / 100);
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
  // Guard stance: physical strike damage is cut multiplicatively (after
  // armor, stacking guards capped at 75%). Magic and true damage ignore it.
  if (property === 'physical') {
    let guardPct = 0;
    for (const s of enemy.statuses) {
      if (s.kind === 'guard') guardPct += s.pct ?? 0;
    }
    if (guardPct > 0) amount = Math.floor((amount * (100 - Math.min(75, guardPct))) / 100);
  }
  amount = Math.max(1, amount);
  const hpBefore = enemy.stats.hp;
  dealDamage(ctx, enemy, amount, property, { crit, matchup });
  cast.damageDealt += hpBefore - enemy.stats.hp;
  // Trample: a killing blow's overkill (past the victim's HP) rolls into the
  // next living enemy, once — no cascading tramples.
  if (cast.trample && !enemy.alive) {
    const overkill = amount - hpBefore;
    if (overkill > 0) {
      const next = livingFoes(ctx.state, caster)[0];
      if (next) dealDamage(ctx, next, overkill, property, { crit });
    }
  }
  // Thorns: the defender pays back a flat amount per landed hit as TRUE
  // damage, summed across every active thorns instance. Iterate by index —
  // statuses is an array, order is fixed.
  let reflect = 0;
  for (const s of enemy.statuses) {
    if (s.kind === 'thorns') reflect += s.amount ?? 0;
  }
  if (reflect > 0) dealDamage(ctx, caster, reflect, 'true', { source: 'thorns' });
}

/** Action kinds aimed at the foe — the ones a Dodge evades wholesale. */
const HOSTILE_KINDS = new Set<Action['kind']>([
  'damage', 'multiHit', 'poison', 'burn', 'stun', 'debuffStat', 'slowNext',
  'weakenNext', 'curseCard', 'stagger', 'shieldBreak', 'purge', 'execute',
]);

function applyAction(
  ctx: Ctx,
  caster: CombatantState,
  skill: SkillDef,
  action: Action,
  mods: AuraMods,
  cast: CastCtx,
  plan: TargetPlan,
  dodgedTarget: CombatantState | null,
): void {
  // Non-damage hostile actions always pick ONE target by the plan's mode
  // (an assassin-marked poison lands on the backline); AoE spreads damage
  // strikes only.
  const enemy = pickTarget(ctx.state, caster, singleMode(plan));
  // The target dodged this whole ACTION: every hostile piece of the card
  // whiffs (damage, every multi-hit, riders). Self effects still resolve.
  if (dodgedTarget !== null && enemy === dodgedTarget && HOSTILE_KINDS.has(action.kind)) return;
  // Speed-conditional effects: resolve only when the caster is strictly
  // faster (or slower) than the action's target at cast time.
  if (action.onlyIf === 'faster' && effSpeed(caster) <= effSpeed(enemy)) return;
  if (action.onlyIf === 'slower' && effSpeed(caster) >= effSpeed(enemy)) return;
  const property = skill.property;
  switch (action.kind) {
    case 'damage': {
      const power = Math.floor((action.power * plan.powerPct) / 100);
      if (plan.mode === 'all') {
        const aoePower = Math.floor((power * plan.aoePct) / 100);
        for (const foe of livingFoes(ctx.state, caster)) {
          if (!caster.alive) break;
          strike(ctx, caster, skill, aoePower, mods, cast, foe);
        }
      } else {
        strike(ctx, caster, skill, power, mods, cast, enemy);
      }
      break;
    }
    case 'multiHit': {
      // Each hit is a full independent strike: its own crit roll (fixed RNG
      // order), its own mitigation — armor is strong against many small hits.
      // Target re-resolves per hit, so a kill rolls leftover hits into the
      // next foe in the formation.
      const hitPower = Math.floor((action.power * plan.powerPct) / 100);
      for (let i = 0; i < action.hits && caster.alive; i++) {
        if (plan.mode === 'all') {
          const foes = livingFoes(ctx.state, caster);
          if (foes.length === 0) break;
          const aoePower = Math.floor((hitPower * plan.aoePct) / 100);
          for (const foe of foes) {
            if (!caster.alive || !foe.alive) continue;
            strike(ctx, caster, skill, aoePower, mods, cast, foe);
          }
        } else {
          const target = pickTarget(ctx.state, caster, singleMode(plan));
          if (!target.alive) break;
          strike(ctx, caster, skill, hitPower, mods, cast, target);
        }
      }
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
    case 'curseCard': {
      // Trap the enemy's QUEUED card: bake the damage now (curser's stat,
      // matchup vs this enemy, their resolve check); it detonates when they
      // next cast that piece. Strongest trap wins on re-application.
      if (!enemy.alive) break;
      const queued = selectCast(enemy, ctx.book);
      if (!queued) break;
      let amount = Math.floor((scaleStat(caster, property) * action.power) / 100);
      amount = Math.floor((amount * matchupPct(cardMatchup(skill, enemy))) / 100);
      amount = Math.floor((amount * effectPotencyPct(enemy)) / 100);
      if (amount <= 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'resisted', side: enemy.side, unit: enemy.unit, status: 'curse' });
        break;
      }
      if (!queued.piece.curse || amount > queued.piece.curse.amount) {
        queued.piece.curse = { amount, property };
      }
      ctx.events.push({
        turn: ctx.state.turn,
        kind: 'skillCursed',
        side: enemy.side,
        unit: enemy.unit,
        slot: queued.piece.slot,
        skillId: queued.piece.skillId,
        amount,
      });
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
      // At most ONE stagger lands between the victim's own actions — repeated
      // tempo theft can slow an enemy but never lock it out entirely (the
      // same principle that keeps stun a delay, not a lock).
      if (enemy.staggerGuard) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'resisted', side: enemy.side, unit: enemy.unit, status: 'stagger' });
        break;
      }
      const potent = Math.floor((action.amount * effectPotencyPct(enemy)) / 100);
      if (potent <= 0) {
        ctx.events.push({ turn: ctx.state.turn, kind: 'resisted', side: enemy.side, unit: enemy.unit, status: 'stagger' });
        break;
      }
      enemy.staggerGuard = true;
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
      addStatus(ctx, caster, { kind: 'thorns', amount: action.amount, turnsLeft: action.turns, fresh: true });
      break;
    case 'regen':
      addStatus(ctx, caster, { kind: 'regen', amount: action.amount, turnsLeft: action.turns, fresh: true });
      break;
    case 'dodge':
      // Active immediately (no fresh flag) — the whole point is protecting
      // the window before your next action; simulate clears it when the
      // caster next takes the stage. turnsLeft is unused (charge-based).
      addStatus(ctx, caster, { kind: 'dodge', amount: action.hits, turnsLeft: 999 });
      break;
    case 'guard':
      // Active immediately (fresh only skips the end-of-turn decrement) —
      // a guard stance must cover the window before your next action.
      addStatus(ctx, caster, { kind: 'guard', pct: action.pct, turnsLeft: action.turns, fresh: true });
      break;
    case 'empower':
      if (!caster.alive) break;
      // Non-stacking max, spent by the caster's next cast (weakenNext's
      // self-side mirror). Boosts the NEXT card — never this one.
      caster.nextCastEmpowerPct = Math.max(caster.nextCastEmpowerPct, action.pct);
      ctx.events.push({ turn: ctx.state.turn, kind: 'empowered', side: caster.side, unit: caster.unit, pct: caster.nextCastEmpowerPct });
      break;
    case 'bloodCost':
      // The card's HP price: flat, true, unblockable — a cost, not an attack.
      if (!caster.alive) break;
      dealDamage(ctx, caster, action.amount, 'true', { bypassShields: true, source: 'blood' });
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
  chased?: boolean,
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
    chased,
  });
  const plan: TargetPlan = {
    mode: enchant?.targeting ?? skill.targeting ?? 'aggro',
    aoePct: enchant?.aoeDamagePct ?? 100,
    powerPct: enchant?.powerPct ?? 100,
  };
  const cast: CastCtx = { damageDealt: 0, bonusPct: 0, trample: enchant?.trample ?? false };
  // Dodge: a defender who acted FIRST slips the caster's whole PHYSICAL
  // action — one charge per card, covering its damage, every multi-hit and
  // its riders. You can sidestep a blade, not a storm: AoE ('all') and
  // magic/true cards connect. Cards with no hostile piece consume nothing.
  let dodgedTarget: CombatantState | null = null;
  if (skill.property === 'physical' && plan.mode !== 'all' && skill.effects.some((a) => HOSTILE_KINDS.has(a.kind))) {
    const target = pickTarget(ctx.state, caster, singleMode(plan));
    const dodge = target.statuses.find((s) => s.kind === 'dodge' && (s.amount ?? 0) > 0);
    if (dodge) {
      dodge.amount = (dodge.amount ?? 0) - 1;
      if (dodge.amount <= 0) {
        target.statuses = target.statuses.filter((s) => s !== dodge);
        ctx.events.push({ turn: ctx.state.turn, kind: 'statusExpired', side: target.side, unit: target.unit, status: 'dodge' });
      }
      ctx.events.push({ turn: ctx.state.turn, kind: 'dodged', side: target.side, unit: target.unit, hitsLeft: Math.max(0, dodge.amount ?? 0) });
      dodgedTarget = target;
    }
  }
  for (const action of skill.effects) {
    applyAction(ctx, caster, skill, action, mods, cast, plan, dodgedTarget);
  }
  if (skill.special !== undefined) {
    getSpecial(skill.special)(ctx, caster, skill, slot, mods);
  }
}
