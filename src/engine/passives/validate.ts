import type { PassiveRecipe, PassiveRequest, PassiveSourceRef } from './types';
import { PASSIVE_EFFECT_REGISTRY } from './registry';

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`Invalid ${label}`);
  const obj = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(obj)) {
    if (typeof key !== 'string' || !keys.includes(key)) throw new Error(`Unknown ${label} field`);
    const descriptor = Object.getOwnPropertyDescriptor(obj, key)!;
    if (!('value' in descriptor) || descriptor.value === undefined) throw new Error(`Non-JSON ${label} field`);
  }
  return obj;
}
function text(value: unknown): void { if (typeof value !== 'string' || !value.trim()) throw new Error('Expected nonempty identifier'); }
function integer(value: unknown, min = 0): void { if (!Number.isSafeInteger(value) || (value as number) < min) throw new Error('Expected safe integer'); }
function property(value: unknown): void { if (!['physical', 'magical', 'true'].includes(value as string)) throw new Error('Invalid property'); }
function selector(value: unknown): void {
  const obj = object(value, ['property', 'archetype'], 'selector');
  if (obj.property !== undefined) property(obj.property);
  if (obj.archetype !== undefined && !['offense', 'defensive', 'healing', 'support', 'debuff'].includes(obj.archetype as string)) throw new Error('Invalid archetype');
}
export function validatePassiveRecipe(value: unknown): PassiveRecipe {
  const recipe = object(value, ['schemaVersion', 'sources'], 'recipe');
  if (recipe.schemaVersion !== 1 || !Array.isArray(recipe.sources)) throw new Error('Invalid passive recipe version/sources');
  const sources = new Set<string>();
  for (const raw of recipe.sources) {
    const entry = object(raw, ['source', 'effects'], 'source entry');
    const source = object(entry.source, ['kind', 'id', 'version', 'displayName'], 'source');
    if (!['talent', 'relic', 'equipment'].includes(source.kind as string)) throw new Error('Invalid source kind');
    text(source.id); integer(source.version, 1);
    if (source.displayName !== undefined) text(source.displayName);
    const key = `${source.kind}:${source.id}`;
    if (sources.has(key)) throw new Error('Duplicate passive source');
    sources.add(key);
    if (!Array.isArray(entry.effects)) throw new Error('Invalid effects');
    const ids = new Set<string>();
    for (const rawEffect of entry.effects) {
      const def = object(rawEffect, ['id', 'targetBinding', 'binding', 'selector', 'conditions', 'effect'], 'effect definition');
      text(def.id);
      if (ids.has(def.id as string)) throw new Error('Duplicate effect id');
      ids.add(def.id as string);
      if (!['automatic', 'playerCard', 'playerSlot'].includes(def.targetBinding as string)) throw new Error('Invalid target binding');
      if (def.binding !== undefined) {
        if (def.targetBinding === 'automatic') throw new Error('Automatic effect cannot bind a target');
        const binding = object(def.binding, def.targetBinding === 'playerCard' ? ['pieceRef'] : ['slot', 'match'], 'binding');
        if (def.targetBinding === 'playerCard') text(binding.pieceRef); else integer(binding.slot);
        if (binding.match !== undefined && !['anchor', 'occupies'].includes(binding.match as string)) throw new Error('Invalid slot match');
      }
      if (def.selector !== undefined) selector(def.selector);
      if (def.conditions !== undefined) {
        const conditions = object(def.conditions, ['anchorSlot', 'occupiesSlot', 'slotRange', 'adjacent', 'boardCount'], 'conditions');
        if (conditions.anchorSlot !== undefined) integer(conditions.anchorSlot);
        if (conditions.occupiesSlot !== undefined) integer(conditions.occupiesSlot);
        if (conditions.adjacent !== undefined) selector(conditions.adjacent);
        if (conditions.slotRange !== undefined) {
          const range = object(conditions.slotRange, ['min', 'max', 'match'], 'slot range');
          integer(range.min); integer(range.max);
          if ((range.min as number) > (range.max as number)) throw new Error('Reversed passive slot range');
          if (range.match !== undefined && !['anchor', 'occupies'].includes(range.match as string)) throw new Error('Invalid slot range match');
        }
        if (conditions.boardCount !== undefined) {
          const count = object(conditions.boardCount, ['selector', 'min', 'max'], 'board count');
          integer(count.min);
          if (count.max !== undefined) { integer(count.max); if ((count.max as number) < (count.min as number)) throw new Error('Reversed board count'); }
          if (count.selector !== undefined) selector(count.selector);
        }
      }
      const raw = object(def.effect, ['kind', 'amount', 'property'], 'effect');
      if (typeof raw.kind !== 'string' || !Object.hasOwn(PASSIVE_EFFECT_REGISTRY, raw.kind)) throw new Error('Unsupported passive effect');
      const handler = PASSIVE_EFFECT_REGISTRY[raw.kind as keyof typeof PASSIVE_EFFECT_REGISTRY];
      const effect = object(def.effect, handler.fields, 'effect');
      integer(effect.amount, 1);
      if (effect.kind === 'setupShield') property(effect.property);
    }
  }
  return structuredClone(value) as PassiveRecipe;
}

function sourceRef(value: unknown): Omit<PassiveSourceRef, 'effectId'> {
  const source = object(value, ['kind', 'id', 'version'], 'source reference');
  if (!['talent', 'relic', 'equipment'].includes(source.kind as string)) throw new Error('Invalid source kind');
  text(source.id); integer(source.version, 1);
  return { ...source } as Omit<PassiveSourceRef, 'effectId'>;
}
function sourceKey(source: Omit<PassiveSourceRef, 'effectId'>): string {
  return JSON.stringify([source.kind, source.id, source.version]);
}
/** Resolve references through an authoritative catalog, never client-authored effects. */
export function resolvePassiveRequest(value: unknown, catalog: PassiveRecipe['sources'] = []): PassiveRecipe {
  const request = object(value, ['schemaVersion', 'sources', 'bindings'], 'passive request');
  if (request.schemaVersion !== 1 || !Array.isArray(request.sources) || !Array.isArray(request.bindings)) throw new Error('Invalid passive request version/sources/bindings');
  const entries = new Map<string, PassiveRecipe['sources'][number]>();
  for (const entry of catalog) {
    const validated = validatePassiveRecipe({ schemaVersion: 1, sources: [entry] }).sources[0]!;
    const key = sourceKey(validated.source);
    if (entries.has(key)) throw new Error('Duplicate catalog passive source/version');
    entries.set(key, validated);
  }
  const selected = new Map<string, PassiveRecipe['sources'][number]>();
  for (const raw of request.sources) {
    const source = sourceRef(raw), key = sourceKey(source);
    if (selected.has(key)) throw new Error('Duplicate requested passive source');
    const entry = entries.get(key);
    if (!entry) throw new Error('Unknown passive source/version');
    selected.set(key, { source: { ...entry.source }, effects: entry.effects.map(def => {
      const { binding: _binding, ...unbound } = def;
      return unbound;
    }) });
  }
  const bound = new Set<string>();
  for (const raw of request.bindings) {
    const selection = object(raw, ['source', 'effectId', 'binding'], 'target selection');
    const source = sourceRef(selection.source), key = sourceKey(source);
    text(selection.effectId);
    const entry = selected.get(key), effect = entry?.effects.find(def => def.id === selection.effectId);
    if (!effect) throw new Error('Unknown selected source/effect');
    const bindingKey = JSON.stringify([key, selection.effectId]);
    if (bound.has(bindingKey)) throw new Error('Duplicate selected binding');
    bound.add(bindingKey);
    effect.binding = structuredClone(selection.binding) as NonNullable<typeof effect.binding>;
  }
  return validatePassiveRecipe({ schemaVersion: 1, sources: [...selected.values()] });
}
