import type { Archetype, Property } from '../types';

export interface PassiveSourceRef {
  kind: 'talent' | 'relic' | 'equipment';
  id: string;
  version: number;
  effectId: string;
  displayName?: string;
}
export type PassiveSourceIdentity = Pick<PassiveSourceRef, 'kind' | 'id' | 'version'>;
export interface CardSelector { property?: Property; archetype?: Archetype }
export interface PassiveSlotRange { min: number; max: number; match?: 'anchor' | 'occupies' }
export type PassiveEffect = { kind: 'setupShield'; property: Property; amount: number }
  | { kind: 'cardShieldPower'; amount: number } | { kind: 'cardWeightReduction'; amount: number };
export interface PassiveEffectDefinition {
  id: string;
  targetBinding: 'automatic' | 'playerCard' | 'playerSlot';
  binding?: { pieceRef: string } | { slot: number; match?: 'anchor' | 'occupies' };
  selector?: CardSelector;
  conditions?: { anchorSlot?: number; occupiesSlot?: number; slotRange?: PassiveSlotRange; adjacent?: CardSelector; boardCount?: { selector?: CardSelector; min: number; max?: number } };
  effect: PassiveEffect;
}
export interface PassiveRecipe {
  schemaVersion: 1;
  sources: readonly {
    source: Omit<PassiveSourceRef, 'effectId'>;
    effects: readonly PassiveEffectDefinition[];
  }[];
}
export interface CardPassiveModifier { amount: number; source: PassiveSourceRef; kind: 'cardShieldPower' | 'cardWeightReduction' }
export interface PassiveChange {
  skillId?: string; slot?: number; pieceRef?: string; actionIndex?: number; property?: Property;
  field: 'weight' | 'shieldPower' | 'setupShield'; before: number; after: number; amount: number;
  rawBefore?: number; rawAfter?: number;
  stage: 'prepared' | 'setup'; basis: 'castWeightWithoutTransientTaxes' | 'authoredActionPower' | 'startingShieldPool';
}
export interface PassiveReceipt {
  source: PassiveSourceRef;
  active: boolean;
  reason: 'active' | 'missing-binding' | 'target-unavailable' | 'conditions-unmet' | 'no-shield-action';
  targetSlots: number[];
  targets: { skillId: string; name?: string; slot: number; size: number; pieceRef?: string }[];
  binding?: PassiveEffectDefinition['binding'];
  conditions?: PassiveEffectDefinition['conditions'];
  selector?: CardSelector;
  effect: PassiveEffectDefinition['effect'];
  slotRange?: PassiveSlotRange;
  conditionsText: string;
  effectText: string;
  displayText: string;
  changes: PassiveChange[];
}
export interface PreparedPassives {
  tieredSkills: ReadonlyMap<number, import('../types').SkillDef>;
  effectiveSkills: ReadonlyMap<number, import('../types').SkillDef>;
  receipts: PassiveReceipt[];
  cardModifiers: ReadonlyMap<number, readonly CardPassiveModifier[]>;
  setupEffects: { source: PassiveSourceRef; property: Property; amount: number }[];
}
export interface PassiveRequest {
  schemaVersion: 1;
  sources: readonly PassiveSourceIdentity[];
  bindings: readonly { source: PassiveSourceIdentity; effectId: string; binding: NonNullable<PassiveEffectDefinition['binding']> }[];
}
