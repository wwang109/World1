import * as run from '../runState';
import { chooseNodeWithEventOpportunities } from '../events';
import { equipEquipment, salvageEquipment, unequipEquipment } from '../equipmentInventory';
import { awardCompletedEventEquipment } from '../equipmentLoot';
import { recordRunHistoryTransition } from '../runHistory';
import { shouldRollGhostSubstitute } from '../ghostMatch';
import { validateGhostSubmission } from '../ghostValidate';
import { applyDeckIntent, cardAt } from './deckIntent';
import { applyEventIntent } from './eventIntent';
import { applyGhostIntent, lookupGhost } from './ghostIntent';
import { issueEncounter, resolveEncounter } from './encounterIntent';
import { presentRunContent } from './presentation';
import { validateIntent } from './validateIntent';
import type { RunExecutor, RunIntent, RevisionKey, Transition, TrustedRunInputs } from './types';

function resultState(result: { ok: boolean; state: run.RunState }): run.RunState {
  if (!result.ok) throw new Error('Action is unavailable');
  return result.state;
}
function apply(state: run.RunState, intent: RunIntent, inputs: TrustedRunInputs, key: RevisionKey): Transition {
  validateIntent(intent);
  if (intent.kind === 'retire') return { state: state.status === 'drafting' ? { ...state, status: 'retired', currentNodeId: null } : run.retireRun(state), effects: [] };
  if (state.status !== 'drafting' && state.status !== 'active') throw new Error('Run is finished');
  if (intent.kind.startsWith('draft')) {
    if (state.status !== 'drafting') throw new Error('Draft is finished');
  } else if (state.status !== 'active') throw new Error('Complete the draft first');
  const node = state.currentNodeId ? run.nodeById(state, state.currentNodeId) : undefined;
  const shopId = () => { if (node?.kind !== 'shop') throw new Error('No current shop'); return node.id; };
  let next: run.RunState;
  switch (intent.kind) {
    case 'draftReroll': next = run.rerollStartDraft(state); break;
    case 'draftPick': next = run.pickStartDraftCard(state, intent.set, intent.skillId); break;
    case 'draftApply': next = run.applyStartDraft(state); break;
    case 'chooseBiome': {
      const band = run.pendingBiomeBand(state);
      if (band === null || state.currentNodeId) throw new Error('No biome choice is pending');
      next = run.chooseBiome(state, band, intent.biomeId); break;
    }
    case 'chooseNode': {
      if (state.currentNodeId || state.activeChallengeFight || state.activeGhostFight || state.ghostBossOffer) throw new Error('Finish the current encounter or offer');
      next = chooseNodeWithEventOpportunities(state, intent.nodeId);
      const picked = run.nodeById(next, intent.nodeId);
      if (picked?.kind === 'boss' && shouldRollGhostSubstitute(next, picked.id)) return lookupGhost(next, picked.id, 'substitute', inputs);
      break;
    }
    case 'shopMaterialize': next = run.ensureRunShopShelf(state, shopId()); break;
    case 'shopReroll': next = run.rerollRunShop(state, shopId()); break;
    case 'buyCard': next = resultState(intent.destination ? run.buyRunCardTo(state, shopId(), intent.index, intent.destination) : run.buyRunCard(state, shopId(), intent.index)); break;
    case 'buyGem': next = resultState(run.buyRunGem(state, shopId(), intent.index)); break;
    case 'mergeCard': next = resultState(run.mergeRunCard(state, shopId(), intent.index, intent.targetInstanceId)); break;
    case 'buyMergeSlot': next = resultState(run.buyMergeSlotPoint(state, shopId(), intent.targetInstanceId)); break;
    case 'leaveShop': shopId(); next = run.leaveShop(state); break;
    case 'moveCard': case 'swapCards': case 'attachGem': case 'detachGem': next = applyDeckIntent(state, intent); break;
    case 'sellCard': {
      cardAt(state, intent.source);
      if (intent.source.kind === 'held') throw new Error('Move a held card before selling it');
      const index = intent.source.kind === 'board' ? state.pieces.findIndex(card => card.instanceId === intent.source.instanceId) : state.bagSlots.findIndex(card => card?.instanceId === intent.source.instanceId);
      next = resultState(run.sellRunCard(state, intent.source.kind, index)); break;
    }
    case 'sellGem': next = resultState(run.sellRunGem(state, intent.pouchIndex)); break;
    case 'allocateStats': next = run.setHeroAllocation(state, intent.allocation); break;
    case 'buyStat': next = run.buyHeroStatAllocation(state, intent.stat); break;
    case 'equip': next = equipEquipment(state, intent.instanceId); break;
    case 'salvage': next = salvageEquipment(state, intent.instanceId); break;
    case 'unequip': next = unequipEquipment(state, intent.slot); break;
    case 'eventMaterialize': case 'eventChoice': case 'eventFinalize': case 'eventReopen': case 'eventCancel': case 'leaveEvent': next = applyEventIntent(state, intent); break;
    case 'ghostLookup': case 'ghostAccept': case 'ghostDecline': case 'ghostSave': case 'ghostSkip': return applyGhostIntent(state, intent, inputs);
    case 'issueEncounter': return { state, effects: [{ kind: 'encounter', encounter: issueEncounter(state, key, inputs) }] };
    default: throw new Error('Unsupported intent');
  }
  if (next === state && !['shopMaterialize', 'eventMaterialize', 'eventReopen'].includes(intent.kind)) throw new Error('Action is unavailable');
  return { state: recordRunHistoryTransition(state, awardCompletedEventEquipment(state, next)), effects: [] };
}
export function createRunExecutor(key: RevisionKey): RunExecutor {
  return { key: Object.freeze({ ...key }), create: run.createRun,
    validateGhost: validateGhostSubmission,
    apply: (state, intent, inputs) => apply(state, intent, inputs, key), resolve: resolveEncounter,
    present: state => presentRunContent(key, state) };
}
