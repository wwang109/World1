import type { PassiveChange, PassiveEffectDefinition, PassiveReceipt } from './types';
import { passiveEffectHandler } from './registry';

export function describePassiveConditions(def: PassiveEffectDefinition): string {
  const clauses: string[] = [];
  const selector = [def.selector?.property, def.selector?.archetype === 'offense' ? 'attack' : def.selector?.archetype].filter(Boolean).join(' ');
  if (def.targetBinding === 'playerCard') clauses.push(`Chosen ${selector ? `${selector} ` : ''}card`);
  else {
    if (def.targetBinding === 'playerSlot') clauses.push(`${selector ? `${selector} ` : ''}card ${def.binding && 'slot' in def.binding && def.binding.match === 'occupies' ? 'in' : 'starting in'} selected Slot ${def.binding && 'slot' in def.binding ? def.binding.slot + 1 : 'unassigned'}`);
    else if (selector) clauses.push(`${selector} card`);
  }
  if (def.conditions?.anchorSlot !== undefined) clauses.push(`Card starts in Slot ${def.conditions.anchorSlot + 1}`);
  if (def.conditions?.occupiesSlot !== undefined) clauses.push(`Card covers Slot ${def.conditions.occupiesSlot + 1}`);
  if (def.conditions?.slotRange) {
    const range = def.conditions.slotRange;
    const label = range.min === range.max ? `Slot ${range.min + 1}` : `Slots ${range.min + 1}–${range.max + 1}`;
    clauses.push(`${range.match === 'occupies' ? 'Cards in' : 'Cards starting in'} ${label}`);
  }
  if (def.conditions?.adjacent) clauses.push(`Adjacent ${def.conditions.adjacent.property ?? ''} ${def.conditions.adjacent.archetype ?? ''} card`.replace(/ +/g, ' '));
  if (def.conditions?.boardCount) {
    const count = def.conditions.boardCount;
    const selector = [count.selector?.property, count.selector?.archetype === 'offense' ? 'attack' : count.selector?.archetype].filter(Boolean).join(' ');
    clauses.push(count.min === 1 && count.max === undefined
      ? `Requires a ${selector ? `${selector} ` : ''}card on board`
      : `Requires ${count.min}${count.max === undefined ? '+' : `–${count.max}`} ${selector ? `${selector} ` : ''}cards on board`);
  }
  return clauses.join('; ');
}
export function describePassivePayload(def: PassiveEffectDefinition): string {
  return passiveEffectHandler(def.effect).describe(def.effect);
}
export function describePassiveEffect(def: PassiveEffectDefinition): string {
  const conditions = describePassiveConditions(def);
  return `${conditions ? `${conditions}: ` : ''}${describePassivePayload(def)}`;
}
export function describePassiveChanges(changes: readonly PassiveChange[]): string {
  return changes.map(change => {
    const field = change.field === 'weight' ? 'WT' : change.field === 'shieldPower' ? 'Shield power' : `${change.property} shield`;
    return `${change.slot === undefined ? '' : `Slot ${change.slot + 1} `}${field} ${change.before}→${change.after}`;
  }).join('; ');
}
export function passiveSummaryText(receipt: Pick<PassiveReceipt, 'source' | 'active' | 'reason' | 'conditions' | 'targetSlots' | 'targets' | 'conditionsText' | 'effectText' | 'changes'>): string {
  const name = receipt.source.displayName ?? receipt.source.id.replace(/[_-]+/g, ' ');
  const targets = receipt.targets.length ? `Target: ${receipt.targets.map(target => `${target.name ?? target.skillId} (Slot ${target.slot + 1})`).join(', ')}.` : '';
  const changes = describePassiveChanges(receipt.changes);
  return [`[${receipt.source.kind}] ${name}: ${describePassiveReceipt(receipt)}.`, receipt.conditionsText ? `${receipt.conditionsText}.` : '', receipt.effectText, targets, changes ? `${changes}.` : ''].filter(Boolean).join(' ');
}
/** Compact log row; the full receipt remains available in API/detail surfaces. */
export function passiveLogSummaryText(receipt: Pick<PassiveReceipt, 'source' | 'active' | 'reason' | 'conditions' | 'changes'>): string {
  const name = receipt.source.displayName ?? receipt.source.id.replace(/[_-]+/g, ' ');
  const changes = describePassiveChanges(receipt.changes);
  return `[${receipt.source.kind}] ${name}: ${describePassiveReceipt(receipt)}.${changes ? ` ${changes}.` : ''}`;
}
export function describePassiveReceipt(receipt: Pick<PassiveReceipt, 'active' | 'reason' | 'conditions'>): string {
  const count = receipt.conditions?.boardCount;
  if (!receipt.active && receipt.reason === 'conditions-unmet' && count?.min === 1 && count.max === undefined && Object.keys(receipt.conditions!).length === 1) {
    const selector = [count.selector?.property, count.selector?.archetype === 'offense' ? 'attack' : count.selector?.archetype].filter(Boolean).join(' ');
    return `No ${selector ? `${selector} ` : ''}card on board`;
  }
  return receipt.active ? 'Active' : {
    active: 'Active', 'missing-binding': 'Choose a target', 'target-unavailable': 'Target unavailable',
    'conditions-unmet': 'Conditions unmet', 'no-shield-action': 'Card has no shield action',
  }[receipt.reason];
}
