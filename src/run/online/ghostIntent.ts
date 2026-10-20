import type { RunState } from '../runState';
import { nodeById } from '../runState';
import { ghostBandOf, ghostCodeOf } from '../ghost';
import * as ghosts from '../ghostMatch';
import type { RunIntent, RunEffect, TrustedRunInputs, Transition } from './types';

export function lookupGhost(state: RunState, nodeId: string, role: 'substitute' | 'extra', inputs: TrustedRunInputs): Transition {
  const node = nodeById(state, nodeId);
  if (!node || node.kind !== 'boss') throw new Error('Ghost lookup requires a canonical boss node');
  const lookup = inputs.ghostLookup;
  if (!lookup) return { state, effects: [{ kind: 'ghostLookup', nodeId, role, band: ghostBandOf(node.fightNumber!) }] };
  if (lookup.nodeId !== nodeId || lookup.role !== role) throw new Error('Ghost lookup does not match current action');
  return { state: role === 'substitute'
    ? lookup.ghost ? ghosts.pinSubstituteGhost(state, nodeId, lookup.ghost) : ghosts.markGhostSubstituteMiss(state, nodeId)
    : lookup.ghost ? ghosts.offerExtraGhostFight(state, nodeId, lookup.ghost) : ghosts.markExtraGhostUnavailable(state, nodeId), effects: [] };
}
export function applyGhostIntent(state: RunState, intent: RunIntent, inputs: TrustedRunInputs): Transition {
  let next = state;
  const effects: RunEffect[] = [];
  if (intent.kind === 'ghostAccept') {
    if (!state.ghostBossOffer || state.currentNodeId || state.activeGhostFight || state.activeChallengeFight) throw new Error('No available extra fight');
    next = ghosts.acceptExtraGhostFight(state);
  } else if (intent.kind === 'ghostDecline') next = ghosts.declineExtraGhostFight(state);
  else if (intent.kind === 'ghostSkip' || intent.kind === 'ghostSave') {
    const prompt = state.pendingGhostSavePrompt;
    if (!prompt) throw new Error('No ghost save offer');
    if (intent.kind === 'ghostSave') effects.push({ kind: 'ghostSave', code: ghostCodeOf(state), name: intent.name, fightNumber: prompt.fightNumber });
    next = ghosts.clearGhostSavePrompt(state);
  } else if (intent.kind === 'ghostLookup') {
    const node = state.currentNodeId ? nodeById(state, state.currentNodeId) : undefined;
    if (node?.kind === 'boss' && ghosts.shouldRollGhostSubstitute(state, node.id)) return lookupGhost(state, node.id, 'substitute', inputs);
    const prompt = state.pendingGhostSavePrompt;
    if (prompt && ghosts.canOfferExtraGhostFight(state, prompt.nodeId)) return lookupGhost(state, prompt.nodeId, 'extra', inputs);
    throw new Error('No ghost lookup is due');
  } else throw new Error('Invalid ghost intent');
  return { state: next, effects };
}
