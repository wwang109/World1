import type { SkillDef, BoardPiece } from '../types';
import type { CardPassiveModifier, PassiveEffect, PassiveSourceRef, PassiveChange, PreparedPassives } from './types';

export interface PassiveApplication {
  source: PassiveSourceRef;
  targets: readonly { piece: BoardPiece; skill: SkillDef }[];
  prepared: PreparedPassives;
  changes: PassiveChange[];
}
interface EffectHandler<E extends PassiveEffect> {
  fields: readonly string[];
  scope: 'unit' | 'card';
  eligible(skill: SkillDef): boolean;
  describe(effect: E): string;
  apply(effect: E, context: PassiveApplication): void;
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
export const PASSIVE_EFFECT_REGISTRY = Object.freeze({
  setupShield: {
    fields: ['kind', 'amount', 'property'], scope: 'unit', eligible: () => true,
    describe: (effect: Extract<PassiveEffect, { kind: 'setupShield' }>) => `Start battle with ${effect.amount} ${effect.property} shield.`,
    apply(effect: Extract<PassiveEffect, { kind: 'setupShield' }>, context: PassiveApplication) {
      context.prepared.setupEffects.push({ source: context.source, property: effect.property, amount: effect.amount });
    },
  },
  cardShieldPower: {
    fields: ['kind', 'amount'], scope: 'card', eligible: (skill: SkillDef) => skill.effects.some(action => action.kind === 'shield'),
    describe: (effect: Extract<PassiveEffect, { kind: 'cardShieldPower' }>) => `Shield power +${effect.amount}.`,
    apply(effect: Extract<PassiveEffect, { kind: 'cardShieldPower' }>, context: PassiveApplication) {
      const map = context.prepared.cardModifiers;
      for (const { piece, skill } of context.targets) {
        const previous = (map.get(piece.slot) ?? []).filter(mod => mod.kind === 'cardShieldPower').reduce((sum, mod) => sum + mod.amount, 0);
        skill.effects.forEach((action, actionIndex) => {
          if (action.kind !== 'shield') return;
          const before = action.power + previous, after = before + effect.amount;
          if (!Number.isSafeInteger(after)) throw new Error('Passive shield overflow');
          context.changes.push({ field: 'shieldPower', skillId: piece.skillId, slot: piece.slot,
            ...(piece.pieceRef ? { pieceRef: piece.pieceRef } : {}), actionIndex, before, after, amount: effect.amount,
            stage: 'prepared', basis: 'authoredActionPower' });
        });
      }
      addModifier(context, 'cardShieldPower', effect.amount);
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
