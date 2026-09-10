import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { isEventDefV3 } from '../../src/data/eventContentV3';
import { loadEventContent, type LoadedEventContent } from '../../src/data/eventsContent';
import { hashSeed } from '../../src/engine/rng';
import {
  rollEventForNode,
  type EventSelectionContent,
} from '../../src/run/events';
import { recordEventInstance } from '../../src/run/eventInstances';
import type { RunNode, RunState } from '../../src/run/runState';
import {
  clearRun,
  finalizeCurrentRunEventOffer,
  getActiveRun,
  installDevRunFixture,
  reopenCurrentRunEventOffer,
  resolveCurrentRunEventChoice,
} from '../../src/game/runStore';
import {
  activeRun,
  eventNode,
  installCurrentNode,
  roundTrip,
  withBowAffinityBoard,
} from '../fixtures/eventV2';

const aggregatePath = new URL('../../src/data/content/events.v3.json', import.meta.url);
const aggregate = JSON.parse(readFileSync(aggregatePath, 'utf8')) as unknown;
const loaded = loadEventContent(aggregate);
const ARROWFELL_IDS = ['feathered_cairn', 'feathered_cairn_far_sight'] as const;

const lookup: LoadedEventContent['eventDefAtVersion'] = (eventId, version) => (
  loaded.eventDefAtVersion(eventId, version)
);

const content: EventSelectionContent = {
  catalog: Object.fromEntries(ARROWFELL_IDS.map((id) => [id, loaded.catalog[id]!])),
  orderedIds: ARROWFELL_IDS,
  currentVersionOf: (eventId) => {
    const version = loaded.meta[eventId]?.version;
    if (version === undefined) throw new Error(`missing ${eventId}`);
    return version;
  },
};

function cairnNode(overrides: Partial<RunNode> = {}): RunNode {
  let eventSeed = 0;
  while (hashSeed('eventRarity', eventSeed, 'feathered_cairn') % 2 !== 0) eventSeed += 1;
  return eventNode({ id: 'cairn-v3-source', eventSeed, ...overrides });
}

function eligibleState(seed = 1103, node = cairnNode()): RunState {
  return installCurrentNode(withBowAffinityBoard(activeRun(seed)), node);
}

function committedV1Source(seed = 1103): { state: RunState; node: RunNode } {
  const node = cairnNode({ id: 'cairn-v1-source' });
  return {
    node,
    state: recordEventInstance(eligibleState(seed, node), node.id, {
      eventId: 'feathered_cairn',
      contentVersion: 1,
      instanceId: `event:${node.id}`,
      drawnDepth: node.depth,
    }),
  };
}

afterEach(() => clearRun());

describe('Feathered Cairn schema-v3 runtime migration', () => {
  it('draws the current version only at the reached node and persists its exact visible choices and offer', () => {
    const node = cairnNode();
    const initial = eligibleState(1103, node);
    const first = rollEventForNode(initial, node, lookup, content);
    const sameInput = rollEventForNode(eligibleState(1103, node), node, lookup, content);
    const replay = rollEventForNode(roundTrip(first.state), node, lookup, content);

    expect(isEventDefV3(first.event)).toBe(true);
    expect(first.event.id).toBe('feathered_cairn');
    expect(first.state.eventInstances[node.id]).toMatchObject({
      eventId: 'feathered_cairn', contentVersion: 2, instanceId: `event:${node.id}`,
    });
    expect(first.state.eventMaterializations[`event:${node.id}`]).toMatchObject({
      eventInstanceId: `event:${node.id}`,
      choiceIds: ['read_feathers', 'take_fletchers_gift', 'leave'],
      deferredOffersByChoiceId: {
        take_fletchers_gift: {
          kind: 'cardChoice', status: 'pending',
          options: [
            { tier: 'bronze' },
            { tier: 'bronze' },
            { tier: 'bronze' },
          ],
        },
      },
    });
    const giftOffer = first.state.eventMaterializations[`event:${node.id}`]!
      .deferredOffersByChoiceId.take_fletchers_gift;
    expect(giftOffer?.kind).toBe('cardChoice');
    expect(new Set(giftOffer?.kind === 'cardChoice'
      ? giftOffer.options.map((option) => option.skillId)
      : []).size).toBe(3);
    expect(sameInput.event.id).toBe(first.event.id);
    expect(sameInput.state.eventMaterializations).toStrictEqual(first.state.eventMaterializations);
    expect(JSON.stringify(replay.state)).toBe(JSON.stringify(first.state));
  });

  it('keeps a pinned version-1 card picker stable across canonical store reopen and finalization', () => {
    const pinned = committedV1Source();
    installDevRunFixture(pinned.state);

    const offered = resolveCurrentRunEventChoice('take_fletchers_gift', lookup);
    expect(offered).toMatchObject({
      kind: 'bonusDraft',
      cards: [{ tier: 'bronze' }, { tier: 'bronze' }, { tier: 'bronze' }],
    });
    if (offered?.kind !== 'bonusDraft' || !('cards' in offered)) {
      throw new Error('expected historical card picker');
    }
    const pendingBytes = JSON.stringify(getActiveRun());

    expect(reopenCurrentRunEventOffer(lookup)).toStrictEqual(offered);
    expect(JSON.stringify(getActiveRun())).toBe(pendingBytes);
    const selected = offered.cards[0]!;
    expect(finalizeCurrentRunEventOffer({ kind: 'card', skillId: selected.skillId }, lookup)).toMatchObject({
      kind: 'grantCard', skillId: selected.skillId, tier: 'bronze',
    });
    const settledBytes = JSON.stringify(getActiveRun());
    expect(finalizeCurrentRunEventOffer({ kind: 'card', skillId: selected.skillId }, lookup)).toBeUndefined();
    expect(JSON.stringify(getActiveRun())).toBe(settledBytes);
    expect(getActiveRun()!.eventResolutions?.[pinned.node.id]).toMatchObject({
      eventId: 'feathered_cairn', contentVersion: 1, choiceId: 'take_fletchers_gift',
    });
  });

  it('delivers and resolves an already-queued version-1 Far Sight through its historical definition', () => {
    const pinned = committedV1Source();
    installDevRunFixture(pinned.state);
    expect(resolveCurrentRunEventChoice('read_feathers', lookup)).toMatchObject({
      kind: 'grantMapInfo', bandsAhead: 2,
    });
    const scheduled = getActiveRun()!;
    expect(scheduled.eventCallbackQueue).toEqual([expect.objectContaining({
      callbackId: 'feathered_cairn_far_sight', contentVersion: 1,
    })]);

    const dueNode = eventNode({
      id: 'far-sight-v1-due', depth: pinned.node.depth + 2,
      eventTheme: 'omen', biomeId: 'arrowfell',
    });
    const atDue = installCurrentNode(roundTrip(scheduled), dueNode);
    const delivered = rollEventForNode(atDue, dueNode, lookup, content);
    expect(delivered.event.id).toBe('feathered_cairn_far_sight');
    expect(isEventDefV3(delivered.event)).toBe(false);
    expect(delivered.state.eventInstances[dueNode.id]).toMatchObject({
      eventId: 'feathered_cairn_far_sight', contentVersion: 1,
    });
    expect(delivered.state.eventMaterializations[`event:${dueNode.id}`]).toBeUndefined();

    installDevRunFixture(delivered.state);
    expect(resolveCurrentRunEventChoice('ignore_mark', lookup)).toEqual({ kind: 'nothing' });
    expect(getActiveRun()!.completedStoryIds).toContain('feathered_cairn');
  });

  it('schedules, delivers, reloads, and finalizes exact version-2 Far Sight without rerolling', () => {
    const node = cairnNode({ id: 'cairn-v3-callback-source' });
    const selected = rollEventForNode(eligibleState(2207, node), node, lookup, content);
    installDevRunFixture(selected.state);
    expect(resolveCurrentRunEventChoice('read_feathers', lookup)).toMatchObject({
      kind: 'grantMapInfo', bandsAhead: 2,
    });
    const scheduled = getActiveRun()!;
    expect(scheduled.eventCallbackQueue).toEqual([expect.objectContaining({
      callbackId: 'feathered_cairn_far_sight',
      eventId: 'feathered_cairn_far_sight',
      contentVersion: 2,
      earliestDepth: node.depth + 2,
      destinationThemes: ['omen'],
      destinationBiomeIds: ['arrowfell'],
      priority: 700,
      boundSubjects: {},
      expiry: { expiresAfterNodes: 20, fallback: 'discard' },
    })]);

    const dueNode = eventNode({
      id: 'far-sight-v2-due', depth: node.depth + 2,
      eventTheme: 'omen', biomeId: 'arrowfell',
    });
    const delivered = rollEventForNode(
      installCurrentNode(roundTrip(scheduled), dueNode), dueNode, lookup, content,
    );
    expect(isEventDefV3(delivered.event)).toBe(true);
    expect(delivered.state.eventInstances[dueNode.id]).toMatchObject({
      eventId: 'feathered_cairn_far_sight', contentVersion: 2,
    });
    expect(delivered.state.eventCallbackQueue).toEqual([]);
    expect(delivered.state.eventMaterializations[`event:${dueNode.id}`]).toMatchObject({
      choiceIds: ['follow_mark', 'take_cache', 'ignore_mark'],
      deferredOffersByChoiceId: {
        take_cache: {
          kind: 'gemChoice', status: 'pending',
        },
      },
    });
    const persistedCache = delivered.state.eventMaterializations[`event:${dueNode.id}`]!
      .deferredOffersByChoiceId.take_cache;
    expect(persistedCache?.kind).toBe('gemChoice');
    if (persistedCache?.kind !== 'gemChoice') throw new Error('expected materialized cache picker');
    expect([...persistedCache.optionGemIds].sort()).toEqual([
      'concussive_shot_echo', 'rending_sliver', 'weak_point_sliver',
    ]);

    installDevRunFixture(roundTrip(delivered.state));
    const offered = resolveCurrentRunEventChoice('take_cache', lookup);
    expect(offered).toMatchObject({
      kind: 'gemChoice',
      offer: {
        status: 'pending',
      },
    });
    if (offered?.kind !== 'gemChoice') throw new Error('expected current Far Sight gem picker');
    expect(offered.offer.optionGemIds).toEqual(persistedCache.optionGemIds);
    const pendingBytes = JSON.stringify(getActiveRun());
    const reopened = reopenCurrentRunEventOffer(lookup);
    expect(reopened).toStrictEqual(offered);
    expect(JSON.stringify(getActiveRun())).toBe(pendingBytes);

    const gemId = offered.offer.optionGemIds[0];
    expect(finalizeCurrentRunEventOffer({ kind: 'gem', gemId }, lookup)).toEqual({
      kind: 'grantGem', gemId,
    });
    const settledBytes = JSON.stringify(getActiveRun());
    expect(finalizeCurrentRunEventOffer({ kind: 'gem', gemId }, lookup)).toEqual({ kind: 'alreadySettled' });
    expect(JSON.stringify(getActiveRun())).toBe(settledBytes);
    expect(getActiveRun()!.completedStoryIds).toContain('feathered_cairn');
  });

  it('varies the persisted Bow offer across bounded run seeds while each seed stays exact', () => {
    const node = cairnNode({ id: 'cairn-v3-bounded' });
    const offers = new Set<string>();
    for (let seed = 1; seed <= 32; seed += 1) {
      const rolled = rollEventForNode(eligibleState(seed, node), node, lookup, content);
      const offer = rolled.state.eventMaterializations[`event:${node.id}`]!
        .deferredOffersByChoiceId.take_fletchers_gift;
      expect(offer?.kind).toBe('cardChoice');
      if (offer?.kind === 'cardChoice') offers.add(offer.options.map((option) => option.skillId).join(','));
    }
    expect(offers.size).toBeGreaterThan(1);
  });
});
