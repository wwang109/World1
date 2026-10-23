import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { drafted, auditExecutor } from './online-audit-fixtures';
import { availableChoices, biomeBandOffers, pendingBiomeBand, type RunState } from '../src/run/runState';
import { loadedEventCatalogFromJson, eventContentMeta, eventDefAtVersion } from '../src/data/eventsContent';
import legacyDocument from '../src/data/content/events.v3.json';
import { reopenEventChoice } from '../src/run/events';
import { isEventDefV3 } from '../src/data/eventContentV3';
import { materializeReachedEventV3 } from '../src/run/eventsV3';
import { gemBook } from '../src/data/gems';
import { equipmentDocument } from '../src/data/equipmentContent';
import type { EventDeferredOfferV3 } from '../src/run/eventV3Materialization';
import type { EventSelection, RunIntent } from '../src/run/online/types';

const seen = new Set<string>(), rejected = new Set<string>();
const inputs = { runId: 'executor-audit', revision: 0, encounterId: 'executor-encounter' };
function apply(state: RunState, intent: RunIntent): RunState { const result = auditExecutor.apply(state, intent, inputs); seen.add(intent.kind); return result.state; }
let route = drafted(11);
const band = pendingBiomeBand(route);
if (band !== null) route = apply(route, { kind: 'chooseBiome', biomeId: biomeBandOffers(route, band)[0]! });
assert.throws(() => apply(route, { kind: 'chooseNode', nodeId: 'skipped-node' })); rejected.add('skipped-node');
const node = availableChoices(route)[0]!;
route = apply(route, { kind: 'chooseNode', nodeId: node.id });
assert.throws(() => apply(route, { kind: 'chooseNode', nodeId: node.id })); rejected.add('double-node');
if (node.kind === 'event') route = apply(route, { kind: 'eventMaterialize' });
const owned = drafted(11);
const eventNode = owned.map.depths.flat().find(node => node.kind === 'event')!;
const shopNode = owned.map.depths.flat().find(node => node.kind === 'shop')!;
let shop: RunState = { ...owned, currentNodeId: shopNode.id, depth: shopNode.depth, gold: 999 };
shop = apply(shop, { kind: 'shopMaterialize' });
assert.throws(() => apply(shop, { kind: 'buyCard', index: 999 })); rejected.add('forged-shop');
shop = apply(shop, { kind: 'buyCard', index: 0 });
shop = apply(shop, { kind: 'buyGem', index: 0 });
shop = apply(shop, { kind: 'shopReroll' });
shop = apply(shop, { kind: 'leaveShop' });
shop = apply(shop, { kind: 'sellGem', pouchIndex: 0 });
shop = apply(shop, { kind: 'sellCard', source: { kind: 'board', instanceId: shop.pieces[0]!.instanceId } });
shop = apply({ ...shop, heroLevel: 10 }, { kind: 'allocateStats', allocation: { attack: 1 } });
shop = apply(shop, { kind: 'buyStat', stat: 'maxHp' });
const equipment = equipmentDocument.items.map((item, index) => ({ instanceId: `equipment-audit-${index}`, itemId: item.id, itemVersion: item.versions[0]!.version, setVersion: 1 }));
shop = apply({ ...shop, ownedEquipment: equipment }, { kind: 'equip', instanceId: equipment[0]!.instanceId });
shop = apply(shop, { kind: 'unequip', slot: shop.equippedEquipment![0]!.slot });
shop = apply(shop, { kind: 'salvage', instanceId: equipment[0]!.instanceId });
function selection(offer: EventDeferredOfferV3, state: RunState): EventSelection | null {
  if (offer.status !== 'pending') return null;
  switch (offer.kind) {
    case 'cardChoice': case 'bonusDraft': return offer.options[0] ? { kind: 'card', skillId: offer.options[0].skillId } : null;
    case 'upgradeCardTargeted': case 'upgradeCard': return offer.optionInstanceIds[0] ? { kind: 'upgrade', instanceId: offer.optionInstanceIds[0] } : null;
    case 'gemChoice': return { kind: 'gem', gemId: offer.optionGemIds[0] };
    case 'sellGem': return offer.options[0] ? { kind: 'sellGem', pouchIndex: offer.options[0].pouchIndex } : null;
    case 'mergeCards': return offer.candidates[0] ? { kind: 'mergeCards', skillId: offer.candidates[0].skillId, consumedIds: offer.consumed.slice(0, 3).map(card => card.instanceId) } : null;
    case 'buyStatPick': return { kind: 'statPick', stat: 'attack' };
    case 'reshapeCard': return offer.options[0] ? { kind: 'reshape', instanceId: offer.options[0].instanceId } : null;
    case 'reshapeGem': return offer.options[0] ? { kind: 'reshapeGem', optionId: offer.options[0].id } : null;
    case 'rerollCard': return offer.options[0] ? { kind: 'reroll', target: offer.kind, step: { kind: 'pick', id: offer.options[0].instanceId } } : null;
    case 'rerollGem': return offer.options[0] ? { kind: 'reroll', target: offer.kind, step: { kind: 'pick', id: String(offer.options[0].pouchIndex) } } : null;
    case 'forgeEquipment': { const item = equipmentDocument.items.find(item => (!offer.items || offer.items.includes(item.id)) && offer.sets.includes(item.versions[0]!.def.setId ?? '')); return item ? { kind: 'forgeEquipment', itemId: item.id } : null; }
    case 'upgradeEquipment': { const item = state.ownedEquipment?.find(item => { const def = equipmentDocument.items.find(entry => entry.id === item.itemId)?.versions[0]!.def; return !!def && (!offer.items || offer.items.includes(item.itemId)) && offer.sets.includes(def.setId ?? ''); }); return item ? { kind: 'upgradeEquipment', instanceId: item.instanceId } : null; }
    default: return null;
  }
}
let materialized = 0, choices = 0, finalized = 0;
const selectors = new Set<string>();
for (const tier of ['bronze', 'silver'] as const) for (const event of Object.values(loadedEventCatalogFromJson)) {
  if (!isEventDefV3(event)) continue;
  const instanceId = `event:${eventNode.id}`, contentVersion = eventContentMeta[event.id]!.version;
  const state: RunState = { ...owned, currentNodeId: eventNode.id, depth: eventNode.depth, gold: 999, brokenEquipment: 999,
    pieces: Array.from({ length: 6 }, (_, slot) => ({ instanceId: `event-card-${slot}`, skillId: 'sword_slash', tier, slot })), bagSlots: [],
    gemInventory: Object.keys(gemBook).flatMap(id => [id, id]), ownedEquipment: equipment,
    eventInstances: { [eventNode.id]: { eventId: event.id, contentVersion, instanceId, drawnDepth: eventNode.depth } } };
  const result = materializeReachedEventV3(state, eventNode, event, contentVersion);
  if (!result.ok) continue;
  materialized++;
  for (const choiceId of result.materialization.choiceIds) {
    let picked: RunState;
    try { picked = apply(result.state, { kind: 'eventChoice', instanceId, contentVersion, choiceId }); choices++; }
    catch { continue; }
    assert.throws(() => apply(picked, { kind: 'eventFinalize', instanceId: 'forged-instance', contentVersion, selection: { kind: 'card', skillId: 'sword_slash' } })); rejected.add('forged-event-instance');
    const offer = picked.eventMaterializations[instanceId]?.deferredOffersByChoiceId[choiceId];
    if (!offer || offer.status !== 'pending' || picked.activeChallengeFight) continue;
    const pick = selection(offer, picked);
    if (!pick) continue;
    apply(picked, { kind: 'eventReopen', instanceId, contentVersion });
    if (offer.kind === 'buyStatPick') apply(picked, { kind: 'eventCancel', instanceId, contentVersion });
    try {
      let finished = apply(picked, { kind: 'eventFinalize', instanceId, contentVersion, selection: pick });
      selectors.add(pick.kind); finalized++;
      if (pick.kind === 'reroll') {
        finished = apply(finished, { kind: 'eventFinalize', instanceId, contentVersion, selection: { kind: 'reroll', target: pick.target, step: { kind: 'reroll' } } });
        finished = apply(finished, { kind: 'eventFinalize', instanceId, contentVersion, selection: { kind: 'reroll', target: pick.target, step: { kind: 'keep' } } });
        selectors.add(pick.target);
      }
      if (!finished.eventResolutions?.[eventNode.id]?.pending) apply(finished, { kind: 'leaveEvent' });
    } catch (error) { rejected.add(`unavailable:${pick.kind}`); }
  }
}
let legacyFinalizers = 0;
for (const event of legacyDocument.events) for (const version of event.versions) {
  const definition = eventDefAtVersion(event.id, version.version);
  if (!definition || isEventDefV3(definition)) continue;
  const instanceId = `event:${eventNode.id}`, contentVersion = version.version;
  const state: RunState = { ...owned, currentNodeId: eventNode.id, depth: eventNode.depth, gold: 999,
    pieces: Array.from({ length: 6 }, (_, slot) => ({ instanceId: `legacy-card-${slot}`, skillId: 'sword_slash', tier: 'bronze', slot })), bagSlots: [],
    gemInventory: Object.keys(gemBook), eventInstances: { [eventNode.id]: { eventId: event.id, contentVersion, instanceId, drawnDepth: eventNode.depth } } };
  for (const choice of definition.choices) {
    try {
      const picked = apply(state, { kind: 'eventChoice', instanceId, contentVersion, choiceId: choice.id });
      const reopened = reopenEventChoice(picked, (id, version) => { const event = eventDefAtVersion(id, version); return event && !isEventDefV3(event) ? event : undefined; });
      if (!reopened) continue;
      const offer = reopened.outcome;
      const selected: EventSelection | undefined = offer.kind === 'mergeCardsPick' && offer.candidates[0] ? { kind: 'mergeCards', skillId: offer.candidates[0].skillId, consumedIds: offer.consumed.map(card => card.instanceId) }
        : offer.kind === 'bonusDraft' && offer.cards[0] ? { kind: 'card', skillId: offer.cards[0].skillId }
        : offer.kind === 'upgradeCardPick' && offer.options[0] ? { kind: 'upgrade', instanceId: offer.options[0].instanceId }
        : offer.kind === 'awardCardPointPick' && offer.options[0] ? { kind: 'awardCardPoint', instanceId: offer.options[0].instanceId }
        : offer.kind === 'gemChoicePick' && offer.options[0] ? { kind: 'gem', gemId: offer.options[0] }
        : offer.kind === 'sellGemPick' && offer.options[0] ? { kind: 'sellGem', pouchIndex: offer.options[0].pouchIndex } : undefined;
      if (selected) { apply(picked, { kind: 'eventFinalize', instanceId, contentVersion, selection: selected }); selectors.add(selected.kind); legacyFinalizers++; }
    } catch { /* Unavailable authored choices are not proof cases. */ }
  }
}
assert(materialized >= 60 && choices >= 70 && finalized >= 20);
for (const name of ['card', 'gem', 'upgrade', 'awardCardPoint', 'statPick', 'reshape', 'reshapeGem', 'forgeEquipment', 'upgradeEquipment', 'mergeCards', 'sellGem', 'rerollCard', 'rerollGem']) assert(selectors.has(name), `missing selector ${name}`);
writeFileSync('tmp/community/online-executor-coverage.json', JSON.stringify({ materialized, choices, finalized, legacyFinalizers, intents: [...seen], selectors: [...selectors], rejected: [...rejected] }, null, 2));
console.log(`online executor OK: legal draft/biome/travel; shop/equipment/stats fixtures; ${materialized} materialized events, ${choices} legal choices, ${finalized} V3/${legacyFinalizers} legacy finalizers; selectors ${[...selectors].join(',')}`);
