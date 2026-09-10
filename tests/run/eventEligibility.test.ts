import { describe, expect, it } from 'vitest';
import type { EventDefV2, EventRequirementV2 } from '../../src/data/eventContentV2';
import { skillBook } from '../../src/data/skills';
import { eventEligible, eventRequirementMet } from '../../src/run/eventEligibility';
import { slotsOf } from '../../src/run/loadout';
import type { EventCallbackQueueEntry, RunState } from '../../src/run/runState';
import {
  activeRun,
  eventNode,
  featheredCairnDef,
  rarityHitNode,
  runBoardIsValid,
  withBowAffinityBoard,
  withMixedLocationBowCards,
  withOffBoardBowCards,
} from '../fixtures/eventV2';

function context(state: RunState, event: EventDefV2 = featheredCairnDef) {
  return { state, node: eventNode(), event };
}

function queueEntry(callbackId: string): EventCallbackQueueEntry {
  return {
    callbackInstanceId: `callback:${callbackId}`,
    callbackId,
    eventId: `${callbackId}_event`,
    contentVersion: 1,
    scheduledDepth: 1,
    earliestDepth: 3,
    minDepthDelay: 2,
    destinationThemes: ['omen'],
    priority: 700,
    boundSubjects: {},
    expiry: { expiresAfterNodes: 20, fallback: 'discard' },
  };
}

function requirementEvent(eligibility: EventRequirementV2): EventDefV2 {
  return { ...featheredCairnDef, rarity: 'common', eligibility };
}

describe('run/eventEligibility: schema-v2 facts use typed run facts', () => {
  it('recognizes board.affinity on a valid, non-overlapping Bow board', () => {
    const state = withBowAffinityBoard(activeRun());
    const boardLeaf: EventRequirementV2 = { fact: 'board.affinity', args: { affinityId: 'bow' } };

    expect(runBoardIsValid(state)).toBe(true);
    expect(state.pieces).toHaveLength(3);
    expect(state.pieces.every((piece) => skillBook[piece.skillId]?.weapon === 'bow')).toBe(true);
    const occupied = state.pieces.flatMap((piece) => slotsOf(piece, skillBook));
    expect(new Set(occupied).size).toBe(occupied.length);
    expect(eventRequirementMet(context(state), boardLeaf)).toBe(true);
  });

  it('board.affinity honours BOTH axes on a dual-affinity board (3 fire + 3 sword) — the same fix as the v3 fact', () => {
    const swords = Object.values(skillBook).filter((s) => s.weapon === 'sword' && s.element === undefined).slice(0, 3);
    const fires = Object.values(skillBook).filter((s) => s.element === 'fire').slice(0, 3);
    expect(swords.length).toBe(3);
    expect(fires.length).toBe(3);
    const base = activeRun();
    const dual: RunState = {
      ...base,
      pieces: [
        ...swords.map((s, i) => ({ instanceId: `sw:${i}`, skillId: s.id, tier: 'bronze' as const, slot: i })),
        ...fires.map((s, i) => ({ instanceId: `fi:${i}`, skillId: s.id, tier: 'bronze' as const, slot: swords.length + i })),
      ],
    };
    const swordLeaf: EventRequirementV2 = { fact: 'board.affinity', args: { affinityId: 'sword' } };
    const fireLeaf: EventRequirementV2 = { fact: 'board.affinity', args: { affinityId: 'fire' } };
    const frostLeaf: EventRequirementV2 = { fact: 'board.affinity', args: { affinityId: 'frost' } };

    // The old element-first collapse would only ever agree with 'fire' here
    // and refuse a player who has genuinely earned sword too.
    expect(eventRequirementMet(context(dual), swordLeaf)).toBe(true);
    expect(eventRequirementMet(context(dual), fireLeaf)).toBe(true);
    expect(eventRequirementMet(context(dual), frostLeaf)).toBe(false);
  });

  it('counts Bow cards in bag slots from an empty neutral board', () => {
    const fresh = activeRun();
    const state = withOffBoardBowCards({ ...fresh, bagSlots: fresh.bagSlots.map(() => null) });
    const countLeaf: EventRequirementV2 = {
      fact: 'owned.card.count', args: { where: 'bag', count: 3, match: { weapons: ['bow'] } },
    };

    expect(state.pieces).toEqual([]);
    expect(state.bagSlots.filter((card) => card != null)).toHaveLength(3);
    expect(eventRequirementMet(context(state), countLeaf)).toBe(true);
  });

  it('counts one card in held and two in bag as owned anywhere without cloning identities', () => {
    const state = withMixedLocationBowCards(activeRun());
    const countLeaf: EventRequirementV2 = {
      fact: 'owned.card.count', args: { where: 'any', count: 3, match: { weapons: ['bow'] } },
    };
    const instances = [...state.bagSlots.filter((card) => card != null), state.held].filter((card) => card != null);

    expect(state.pieces).toEqual([]);
    expect(state.bagSlots.filter((card) => card != null)).toHaveLength(2);
    expect(state.held).not.toBeNull();
    expect(new Set(instances.map((card) => card.instanceId)).size).toBe(3);
    expect(eventRequirementMet(context(state), countLeaf)).toBe(true);
  });

  it('does not count one Bow instance twice when it appears in bag and held', () => {
    const original = withMixedLocationBowCards(activeRun());
    const duplicate = original.bagSlots.find((card) => card != null)!;
    const remaining = original.bagSlots.filter(
      (card): card is Exclude<typeof card, null> => card != null && card.instanceId !== duplicate.instanceId,
    );
    const state = { ...original, bagSlots: [duplicate, ...remaining], held: duplicate };
    const countLeaf: EventRequirementV2 = {
      fact: 'owned.card.count', args: { where: 'any', count: 3, match: { weapons: ['bow'] } },
    };

    expect(new Set([duplicate, ...remaining].map((card) => card.instanceId)).size).toBe(2);
    expect(eventRequirementMet(context(state), countLeaf)).toBe(false);
  });

  it('evaluates Feathered Cairn’s authored OR through either typed fact', () => {
    const affinityState = withBowAffinityBoard(activeRun());
    const countState = withOffBoardBowCards(activeRun());
    const neither = activeRun();

    expect(eventRequirementMet(context(affinityState), featheredCairnDef.eligibility)).toBe(true);
    expect(eventRequirementMet(context(countState), featheredCairnDef.eligibility)).toBe(true);
    expect(eventRequirementMet(context(neither), featheredCairnDef.eligibility)).toBe(false);
  });

  it('requires the current node biome, independent of presentation copy', () => {
    const biomeEvent = requirementEvent({ fact: 'biome.current', args: { ids: ['arrowfell'] } });

    expect(eventEligible({ ...context(activeRun(), biomeEvent), node: eventNode({ biomeId: 'arrowfell' }) })).toBe(true);
    expect(eventEligible({ ...context(activeRun(), biomeEvent), node: eventNode({ biomeId: 'emberwaste' }) })).toBe(false);
  });

  it('uses the isolated deterministic rarity roll without consuming run state', () => {
    const event = { ...requirementEvent({ fact: 'biome.current', args: { ids: ['arrowfell'] } }), rarity: 'uncommon' as const };
    const state = activeRun();
    const miss = eventNode({ eventSeed: 0 });
    const hit = rarityHitNode(state, event, eventNode());

    expect(eventEligible({ state, node: miss, event })).toBe(false);
    expect(eventEligible({ state, node: hit, event })).toBe(true);
    expect(state).toStrictEqual(activeRun());
  });

  it('blocks once-per-run definitions after a matching immutable event record', () => {
    const state = {
      ...withOffBoardBowCards(activeRun()),
      eventInstances: {
        previous: { eventId: featheredCairnDef.id, contentVersion: 1, instanceId: 'event:previous', drawnDepth: 1 },
      },
    };

    expect(eventEligible(context(state))).toBe(false);
  });

  it('blocks cooldown definitions until enough node depths have elapsed', () => {
    const event = { ...featheredCairnDef, rarity: 'common' as const, once: 'node' as const, cooldownNodes: 3 };
    const state = {
      ...withOffBoardBowCards(activeRun()),
      eventInstances: {
        previous: { eventId: event.id, contentVersion: 1, instanceId: 'event:previous', drawnDepth: 2 },
      },
    };

    expect(eventEligible({ ...context(state, event), node: eventNode({ depth: 5 }) })).toBe(false);
    expect(eventEligible({ ...context(state, event), node: eventNode({ depth: 6 }) })).toBe(true);
  });

  it('reads callback.queued as an explicit fact outside due-callback delivery', () => {
    const callbackId = 'feathered_cairn_far_sight';
    const queuedEvent = requirementEvent({ fact: 'callback.queued', args: { callbackId } });
    const queued = { ...activeRun(), eventCallbackQueue: [queueEntry(callbackId)] };

    expect(eventRequirementMet(context(queued, queuedEvent), queuedEvent.eligibility)).toBe(true);
    expect(eventRequirementMet(context(activeRun(), queuedEvent), queuedEvent.eligibility)).toBe(false);
  });
});
