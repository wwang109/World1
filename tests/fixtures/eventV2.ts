import type { EventCallbackSpec, EventDefV2 } from '../../src/data/eventContentV2';
import { HERO_BOARD_SLOTS } from '../../src/data/heroes';
import { skillBook } from '../../src/data/skills';
import { canPlace, slotsOf } from '../../src/run/loadout';
import { resolveEventChoice } from '../../src/run/events';
import { eventEligible } from '../../src/run/eventEligibility';
import {
  applyDraftResult,
  createRun,
  currentStartDraft,
  tryInsertRunCard,
  type RunBoardPiece,
  type RunCard,
  type RunNode,
  type RunState,
} from '../../src/run/runState';
import { DRAFT_SET_KEYS } from '../../src/run/draft';

export function activeRun(seed = 1103): RunState {
  const drafted = createRun(seed);
  const hand = currentStartDraft(drafted);
  const picks = Object.fromEntries(DRAFT_SET_KEYS.map((key) => [key, hand[key][0]!.skillId]));
  return applyDraftResult(drafted, picks);
}

export const farSightCallback: EventCallbackSpec = {
  callbackId: 'feathered_cairn_far_sight', eventId: 'feathered_cairn_far_sight', contentVersion: 1,
  minDepthDelay: 2, destinationThemes: ['omen'], destinationBiomeIds: ['arrowfell'], priority: 700,
  bind: [], expiry: { expiresAfterNodes: 20, fallback: 'discard' },
};

export const featheredCairnDef: EventDefV2 = {
  id: 'feathered_cairn', title: 'Feathered Cairn', body: 'Presentation copy.', theme: 'cache', rarity: 'uncommon',
  biomeIds: ['arrowfell'], story: { storyId: 'feathered_cairn', stage: 'setup', role: 'setup' },
  eligibility: { any: [{ fact: 'board.affinity', args: { affinityId: 'bow' } }, { fact: 'owned.card.count', args: { where: 'any', count: 3, match: { weapons: ['bow'] } } }] },
  delivery: { kind: 'ambient' }, visibility: 'visible', priority: 200, once: 'run', cooldownNodes: 0,
  choices: [
    { id: 'read_feathers', label: 'Read the marks', cost: 0, outcome: { kind: 'grantMapInfo', bandsAhead: 2 }, callback: farSightCallback },
    { id: 'take_fletchers_gift', label: 'Take a Bow card', cost: 0, outcome: { kind: 'cardChoice', filter: [{ weapons: ['bow'] }], tier: 'bronze' } },
    { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
  ],
};

export function withOffBoardBowCards(input: RunState): RunState {
  const bows = Object.values(skillBook).filter((skill) => skill.weapon === 'bow').map((skill) => skill.id).sort();
  if (bows.length < 3) throw new Error('fixture requires three Bow skills');
  let state: RunState = { ...input, pieces: [], bagSlots: Array(input.bagSlots.length).fill(null), held: null };
  for (const skillId of bows.slice(0, 3)) {
    const inserted = tryInsertRunCard(state, skillId, 'bronze');
    if (!inserted) throw new Error(`fixture could not insert ${skillId}`);
    state = inserted.state;
  }
  return state;
}

export function withMixedLocationBowCards(input: RunState): RunState {
  const base = withOffBoardBowCards(input);
  const bagSlots = [...base.bagSlots];
  const bagIndex = bagSlots.findIndex((card) => card != null);
  const held = bagSlots[bagIndex];
  if (!held) throw new Error('fixture has no inserted Bow card to hold');
  bagSlots[bagIndex] = null;
  return { ...base, bagSlots, held };
}

export function runBoardIsValid(state: RunState): boolean {
  const occupied = state.pieces.flatMap((piece) => slotsOf(piece, skillBook));
  return occupied.every((slot) => slot >= 0 && slot < HERO_BOARD_SLOTS)
    && new Set(occupied).size === occupied.length;
}

export function withBowAffinityBoard(input: RunState): RunState {
  const bagged = withOffBoardBowCards(input);
  const bowCards = bagged.bagSlots.filter((card): card is RunCard => card != null).slice(0, 3);
  const pieces: RunBoardPiece[] = [];
  for (const card of bowCards) {
    let slot = -1;
    for (let candidate = 0; candidate < HERO_BOARD_SLOTS; candidate += 1) {
      if (canPlace(pieces, skillBook, card.skillId, candidate, HERO_BOARD_SLOTS)) { slot = candidate; break; }
    }
    if (slot < 0) throw new Error(`fixture cannot place ${card.skillId}`);
    pieces.push({ ...card, slot });
  }
  const moved = new Set(pieces.map((piece) => piece.instanceId));
  const bagSlots = bagged.bagSlots.map((card) => card != null && moved.has(card.instanceId) ? null : card);
  const state = { ...bagged, pieces, bagSlots };
  if (!runBoardIsValid(state)) throw new Error('fixture built invalid Bow board');
  return state;
}

export function eventNode(overrides: Partial<RunNode> = {}): RunNode {
  return { id: 'fixture-event', depth: 3, wave: 2, kind: 'event', eventSeed: 99, eventTheme: 'cache', biomeId: 'arrowfell', ...overrides };
}

export function roundTrip(state: RunState): RunState {
  return JSON.parse(JSON.stringify(state)) as RunState;
}

export function installCurrentNode(state: RunState, node: RunNode): RunState {
  const depths = state.map.depths.map((column) => [...column]);
  while (depths.length <= node.depth) depths.push([]);
  depths[node.depth] = [node];
  return { ...state, map: { ...state.map, depths }, depth: node.depth, currentNodeId: node.id };
}

export function resolveAt(state: RunState, node: RunNode, eventId: string, choiceId: string) {
  return resolveEventChoice(installCurrentNode(state, node), eventId, choiceId);
}

export function rarityHitNode(state: RunState, event: EventDefV2, base: RunNode): RunNode {
  for (let seed = 0; seed < 10000; seed += 1) {
    const node = { ...base, eventSeed: seed };
    if (eventEligible({ state, node, event })) return node;
  }
  throw new Error(`no rarity hit for ${event.id}`);
}
