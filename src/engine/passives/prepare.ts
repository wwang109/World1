import type { BoardPiece, CombatantSetup, SkillBook, SkillDef } from '../types';
import { applyTier, gemCardMods, resolveTieredSkill } from '../cards';
import { weightOf } from '../types';
import { resolveAuras } from '../combat/auras';
import type { PieceState } from '../combat/state';
import type { CardSelector, CardPassiveModifier, PassiveEffectDefinition, PassiveReceipt, PassiveSourceRef, PreparedPassives } from './types';
import { validatePassiveRecipe } from './validate';
import { describePassiveConditions, describePassivePayload, passiveSummaryText } from './text';
import { passiveEffectHandler } from './registry';

function matches(skill: SkillDef, selector?: CardSelector): boolean {
  return !selector || ((!selector.property || skill.property === selector.property)
    && (!selector.archetype || skill.archetypes.includes(selector.archetype)));
}
export function preparePassives(setup: CombatantSetup, book: SkillBook): PreparedPassives {
  const tieredSkills = new Map<number, SkillDef>();
  const effectiveSkills = new Map<number, SkillDef>();
  const result: PreparedPassives = { tieredSkills, effectiveSkills, receipts: [], cardModifiers: new Map<number, CardPassiveModifier[]>(), setupEffects: [] };
  if (!setup.passives) return result;
  const recipe = validatePassiveRecipe(setup.passives);
  const refs = new Set<string>();
  if (!Number.isSafeInteger(setup.boardSize) || setup.boardSize <= 0) throw new Error('Invalid board size');
  const occupied = new Set<number>();
  const board = setup.pieces.map(piece => {
    if (piece.pieceRef !== undefined) {
      if (typeof piece.pieceRef !== 'string' || !piece.pieceRef.trim() || refs.has(piece.pieceRef)) throw new Error('Invalid/duplicate board pieceRef');
      refs.add(piece.pieceRef);
    }
    const def = book[piece.skillId];
    if (!def) throw new Error(`Unknown skill: ${piece.skillId}`);
    const skill = applyTier(def, piece.tier ?? def.tier);
    if (!Number.isSafeInteger(piece.slot) || piece.slot < 0 || !Number.isSafeInteger(skill.size) || skill.size <= 0 || piece.slot + skill.size > setup.boardSize) throw new Error('Invalid board geometry');
    for (let slot = piece.slot; slot < piece.slot + skill.size; slot++) {
      if (occupied.has(slot)) throw new Error('Board overlap');
      occupied.add(slot);
    }
    tieredSkills.set(piece.slot, skill);
    return { piece, skill };
  }).sort((a, b) => a.piece.slot - b.piece.slot);
  const validSlot = (slot: number): void => { if (slot >= setup.boardSize) throw new Error('Passive slot outside board'); };
  const occupies = (piece: BoardPiece, size: number, slot: number): boolean => slot >= piece.slot && slot < piece.slot + size;
  const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
  const sources = [...recipe.sources].sort((a, b) => compare(`${a.source.kind}:${a.source.id}:${a.source.version}`, `${b.source.kind}:${b.source.id}:${b.source.version}`));
  const receipt = (def: PassiveEffectDefinition, source: PassiveSourceRef, active: boolean, reason: PassiveReceipt['reason'], targets: typeof board): PassiveReceipt => {
    const base = { source, active, reason, targetSlots: targets.map(item => item.piece.slot),
      targets: targets.map(({ piece, skill }) => ({ skillId: piece.skillId, name: skill.name, slot: piece.slot, size: skill.size, ...(piece.pieceRef ? { pieceRef: piece.pieceRef } : {}) })),
      ...(def.binding ? { binding: structuredClone(def.binding) } : {}),
      ...(def.conditions ? { conditions: structuredClone(def.conditions) } : {}),
      ...(def.selector ? { selector: { ...def.selector } } : {}),
      effect: { ...def.effect },
      ...(def.conditions?.slotRange ? { slotRange: { ...def.conditions.slotRange } } : {}),
      conditionsText: describePassiveConditions(def), effectText: describePassivePayload(def) };
    return { ...base, changes: [], displayText: passiveSummaryText({ ...base, changes: [] }) };
  };
  for (const entry of sources) for (const def of [...entry.effects].sort((a, b) => compare(a.id, b.id))) {
    const source = { ...entry.source, effectId: def.id };
    if (def.conditions?.anchorSlot !== undefined) validSlot(def.conditions.anchorSlot);
    if (def.conditions?.occupiesSlot !== undefined) validSlot(def.conditions.occupiesSlot);
    if (def.conditions?.slotRange) { validSlot(def.conditions.slotRange.min); validSlot(def.conditions.slotRange.max); }
    if (def.binding && 'slot' in def.binding) validSlot(def.binding.slot);
    if (def.targetBinding !== 'automatic' && !def.binding) {
      result.receipts.push(receipt(def, source, false, 'missing-binding', [])); continue;
    }
    const binding = def.binding;
    const count = def.conditions?.boardCount;
    const matchingCount = count ? board.filter(item => matches(item.skill, count.selector)).length : 0;
    const countMet = !count || (matchingCount >= count.min && (count.max === undefined || matchingCount <= count.max));
    const targets = board.filter(({ piece, skill }) => (!binding || ('pieceRef' in binding ? piece.pieceRef === binding.pieceRef : binding.match === 'occupies' ? occupies(piece, skill.size, binding.slot) : piece.slot === binding.slot)) && matches(skill, def.selector));
    const eligible = targets.filter(({ piece, skill }) => {
      const conditions = def.conditions;
      return countMet && (!conditions || ((conditions.anchorSlot === undefined || piece.slot === conditions.anchorSlot)
        && (conditions.occupiesSlot === undefined || occupies(piece, skill.size, conditions.occupiesSlot))
        && (!conditions.slotRange || (conditions.slotRange.match === 'occupies'
          ? piece.slot <= conditions.slotRange.max && piece.slot + skill.size > conditions.slotRange.min
          : piece.slot >= conditions.slotRange.min && piece.slot <= conditions.slotRange.max))
        && (!conditions.adjacent || board.some(other => other.piece !== piece
          && (other.piece.slot + other.skill.size === piece.slot || piece.slot + skill.size === other.piece.slot)
          && matches(other.skill, conditions.adjacent)))));
    });
    const handler = passiveEffectHandler(def.effect);
    const globalSetup = handler.scope === 'unit' && def.targetBinding === 'automatic' && !def.selector
      && (!def.conditions || Object.keys(def.conditions).every(key => key === 'boardCount')) && countMet;
    const applicable = eligible.filter(({ skill }) => handler.eligible(skill));
    const active = globalSetup || applicable.length > 0;
    const entryReceipt = receipt(def, source, active, active ? 'active' : !countMet ? 'conditions-unmet' : targets.length === 0 ? 'target-unavailable' : eligible.length === 0 ? 'conditions-unmet' : 'no-shield-action', globalSetup ? [] : applicable);
    result.receipts.push(entryReceipt);
    if (!active) continue;
    handler.apply(def.effect, { source, targets: applicable, prepared: result, changes: entryReceipt.changes });
  }
  const preparedPieces: PieceState[] = board.map(({ piece, skill }) => {
    const modifiers = result.cardModifiers.get(piece.slot) ?? [];
    const effective = resolveTieredSkill(skill, piece, modifiers);
    effectiveSkills.set(piece.slot, effective);
    const reduction = modifiers.filter(mod => mod.kind === 'cardWeightReduction').reduce((sum, mod) => sum + mod.amount, 0);
    return { skillId: piece.skillId, slot: piece.slot, size: effective.size, skill: effective,
      gemMods: gemCardMods(piece.gem), ...(reduction ? { passiveWeightDelta: -reduction } : {}) };
  });
  const costs = new Map<number, number>();
  for (const piece of preparedPieces) {
    const mods = resolveAuras({ pieces: preparedPieces }, piece, book).mods;
    const baseline = weightOf(piece.skill) + mods.weightDelta - (piece.passiveWeightDelta ?? 0);
    if (!Number.isSafeInteger(baseline)) throw new Error('Prepared weight overflow');
    costs.set(piece.slot, baseline);
  }
  for (const entry of result.receipts) {
    for (const change of entry.changes) if (change.field === 'weight') {
      const rawBefore = costs.get(change.slot!)!;
      const rawAfter = rawBefore + change.amount;
      if (!Number.isSafeInteger(rawAfter)) throw new Error('Prepared weight overflow');
      change.before = Math.max(1, rawBefore); change.after = Math.max(1, rawAfter);
      change.rawBefore = rawBefore; change.rawAfter = rawAfter;
      costs.set(change.slot!, rawAfter);
    }
    entry.displayText = passiveSummaryText(entry);
  }
  return result;
}
