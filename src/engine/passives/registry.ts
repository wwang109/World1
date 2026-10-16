import { MAX_WARD_CHARGES, type SkillDef, type BoardPiece } from '../types';
import type { CombatantState } from '../combat/state';
import type { CombatEvent } from '../combat/events';
import { KEYWORD_TEXT } from '../keywords/text';
import type { CardPassiveModifier, PassiveEffect, PassiveSourceRef, PassiveChange, PassiveReceipt, PreparedPassives, SetupPassiveEffect } from './types';

export interface PassiveApplication {
  source: PassiveSourceRef;
  targets: readonly { piece: BoardPiece; skill: SkillDef }[];
  prepared: PreparedPassives;
  changes: PassiveChange[];
}
export interface PassiveSetupResult { change: PassiveChange; event?: CombatEvent }
interface EffectHandler<E extends PassiveEffect> {
  fields: readonly string[];
  scope: 'unit' | 'card';
  eligible(skill: SkillDef): boolean;
  ineligibleReason?: PassiveReceipt['reason'];
  describe(effect: E): string;
  apply(effect: E, context: PassiveApplication): void;
  setup?(effect: E, unit: CombatantState, source: PassiveSourceRef): PassiveSetupResult;
}
function addModifier(context: PassiveApplication, kind: CardPassiveModifier['kind'], amount: number): void {
  const map = context.prepared.cardModifiers as Map<number, CardPassiveModifier[]>;
  for (const { piece } of context.targets) {
    const mods = map.get(piece.slot) ?? [];
    const sum = mods.filter(mod => mod.kind === kind).reduce((total, mod) => total + mod.amount, amount);
    if (!Number.isSafeInteger(sum)) throw new Error('Passive modifier overflow');
    map.set(piece.slot, [...mods, { source: context.source, kind, amount }]);
  }
}
function boostActionPower(context: PassiveApplication, actionKind: 'shield' | 'damage', modifier: 'cardShieldPower' | 'cardPower', amount: number): void {
  const map = context.prepared.cardModifiers;
  for (const { piece, skill } of context.targets) {
    const previous = (map.get(piece.slot) ?? []).filter(mod => mod.kind === modifier).reduce((sum, mod) => sum + mod.amount, 0);
    skill.effects.forEach((action, actionIndex) => {
      if (action.kind !== actionKind) return;
      const before = action.power + previous, after = before + amount;
      if (!Number.isSafeInteger(after)) throw new Error('Passive power overflow');
      context.changes.push({ field: actionKind === 'shield' ? 'shieldPower' : 'power', skillId: piece.skillId, slot: piece.slot,
        ...(piece.pieceRef ? { pieceRef: piece.pieceRef } : {}), actionIndex, before, after, amount,
        stage: 'prepared', basis: 'authoredActionPower' });
    });
  }
  addModifier(context, modifier, amount);
}
function queueSetup(effect: SetupPassiveEffect, context: PassiveApplication): void {
  context.prepared.setupEffects.push({ source: context.source, effect });
}
function setupStatus(effect: Extract<PassiveEffect, { kind: 'setupStatus' }>, unit: CombatantState, source: PassiveSourceRef): PassiveSetupResult {
  const base = { turn: 0, kind: 'statusApplied' as const, side: unit.side, unit: unit.index, status: effect.status };
  if (effect.status === 'regen') {
    const pile = unit.statuses.find(status => status.kind === 'regen');
    const before = pile?.stacks ?? 0, after = before + effect.amount;
    if (!Number.isSafeInteger(after)) throw new Error('Passive regen overflow');
    if (pile) { pile.stacks = after; pile.turnsLeft = after; }
    else unit.statuses.push({ kind: 'regen', stacks: after, turnsLeft: after, fresh: false });
    return { change: { field: 'setupStatus', status: 'regen', before, after, amount: effect.amount, stage: 'setup', basis: 'startingStatus' },
      event: { ...base, stacks: after, turns: after, sourcePassive: source } };
  }
  const before = unit.statuses.filter(status => status.kind === 'ward').reduce((sum, status) => sum + (status.charges ?? 0), 0);
  const charges = Math.max(0, Math.min(effect.amount, MAX_WARD_CHARGES - before));
  if (charges > 0) unit.statuses.push({ kind: 'ward', charges, turnsLeft: 0, fresh: true });
  return { change: { field: 'setupStatus', status: 'ward', before, after: before + charges, amount: effect.amount, stage: 'setup', basis: 'startingStatus' },
    ...(charges > 0 ? { event: { ...base, turns: 0, charges, sourcePassive: source } } : {}) };
}
export const PASSIVE_EFFECT_REGISTRY = Object.freeze({
  setupShield: {
    fields: ['kind', 'amount', 'property'], scope: 'unit', eligible: () => true,
    describe: (effect: Extract<PassiveEffect, { kind: 'setupShield' }>) => `Start battle with ${effect.amount} ${effect.property} shield.`,
    apply: queueSetup,
    setup(effect: Extract<PassiveEffect, { kind: 'setupShield' }>, unit: CombatantState, source: PassiveSourceRef): PassiveSetupResult {
      const before = unit.shields.physical + unit.shields.magical + unit.shields.true;
      const poolBefore = unit.shields[effect.property];
      const amount = Math.min(effect.amount, Math.max(0, unit.stats.maxHp - before));
      unit.shields[effect.property] += amount;
      return {
        change: { field: 'setupShield', property: effect.property, before: poolBefore,
          after: unit.shields[effect.property], amount: effect.amount, stage: 'setup', basis: 'startingShieldPool' },
        event: { turn: 0, kind: 'shieldGain', side: unit.side, unit: unit.index,
          property: effect.property, amount, wasted: effect.amount - amount,
          totalAfter: before + amount, poolsAfter: { ...unit.shields },
          calculation: { power: effect.amount, statBonus: 0 }, sourcePassive: source },
      };
    },
  },
  setupStatus: {
    fields: ['kind', 'amount', 'status'], scope: 'unit', eligible: () => true,
    describe: (effect: Extract<PassiveEffect, { kind: 'setupStatus' }>) => `Start battle with ${KEYWORD_TEXT[effect.status].ruleTitle} ${effect.amount}.`,
    apply: queueSetup,
    setup: setupStatus,
  },
  setupReadiness: {
    fields: ['kind', 'amount'], scope: 'unit', eligible: () => true,
    describe: (effect: Extract<PassiveEffect, { kind: 'setupReadiness' }>) => `Start battle with ${KEYWORD_TEXT.haste.ruleTitle} ${effect.amount}.`,
    apply: queueSetup,
    setup(effect: Extract<PassiveEffect, { kind: 'setupReadiness' }>, unit: CombatantState, source: PassiveSourceRef): PassiveSetupResult {
      const before = unit.readiness, after = before + effect.amount;
      if (!Number.isSafeInteger(after)) throw new Error('Passive readiness overflow');
      unit.readiness = after;
      return { change: { field: 'setupReadiness', before, after, amount: effect.amount, stage: 'setup', basis: 'startingReadiness' },
        event: { turn: 0, kind: 'hastened', side: unit.side, unit: unit.index, amount: effect.amount, readinessAfter: after, sourcePassive: source } };
    },
  },
  cardShieldPower: {
    fields: ['kind', 'amount'], scope: 'card', eligible: (skill: SkillDef) => skill.effects.some(action => action.kind === 'shield'),
    ineligibleReason: 'no-shield-action',
    describe: (effect: Extract<PassiveEffect, { kind: 'cardShieldPower' }>) => `Shield power +${effect.amount}.`,
    apply(effect: Extract<PassiveEffect, { kind: 'cardShieldPower' }>, context: PassiveApplication) {
      boostActionPower(context, 'shield', 'cardShieldPower', effect.amount);
    },
  },
  cardPower: {
    fields: ['kind', 'amount'], scope: 'card', eligible: (skill: SkillDef) => skill.effects.some(action => action.kind === 'damage'),
    ineligibleReason: 'no-hit-action',
    describe: (effect: Extract<PassiveEffect, { kind: 'cardPower' }>) => `Damage +${effect.amount}.`,
    apply(effect: Extract<PassiveEffect, { kind: 'cardPower' }>, context: PassiveApplication) {
      boostActionPower(context, 'damage', 'cardPower', effect.amount);
    },
  },
  cardWeightReduction: {
    fields: ['kind', 'amount'], scope: 'card', eligible: () => true,
    describe: (effect: Extract<PassiveEffect, { kind: 'cardWeightReduction' }>) => `WT −${effect.amount}.`,
    apply(effect: Extract<PassiveEffect, { kind: 'cardWeightReduction' }>, context: PassiveApplication) {
      addModifier(context, 'cardWeightReduction', effect.amount);
      for (const { piece } of context.targets) context.changes.push({ field: 'weight', skillId: piece.skillId, slot: piece.slot,
        ...(piece.pieceRef ? { pieceRef: piece.pieceRef } : {}), before: 0, after: 0, amount: -effect.amount,
        stage: 'prepared', basis: 'castWeightWithoutTransientTaxes' });
    },
  },
} satisfies { [K in PassiveEffect['kind']]: EffectHandler<Extract<PassiveEffect, { kind: K }>> });

export function passiveEffectHandler(effect: PassiveEffect): EffectHandler<PassiveEffect> {
  return PASSIVE_EFFECT_REGISTRY[effect.kind] as EffectHandler<PassiveEffect>;
}
