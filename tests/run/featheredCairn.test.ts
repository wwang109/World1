import { describe, expect, it } from 'vitest';
import { isEventDefV2, type EventDefV2 } from '../../src/data/eventContentV2';
import { eventDefAtVersion } from '../../src/data/eventsContent';
import { eventCatalog, eventCatalogIds, type EventDef } from '../../src/data/events';
import { eventArtKey, RUN_ART_KEYS } from '../../src/game/ui/runArtKeys';
import { dueEventCallback } from '../../src/run/eventCallbacks';
import { eventEligible, eventRequirementMet } from '../../src/run/eventEligibility';
import { eventInstanceAt } from '../../src/run/eventInstances';
import {
  eventSelectionIdsForCatalog,
  resolveEventChoice,
  rollEventForNode,
  type EventSelectionContent,
} from '../../src/run/events';
import { leaveEvent } from '../../src/run/runState';
import {
  activeRun,
  eventNode,
  installCurrentNode,
  rarityHitNode,
  roundTrip,
  withBowAffinityBoard,
  withOffBoardBowCards,
} from '../fixtures/eventV2';

const frozenLookup = (eventId: string, contentVersion: number): EventDef | undefined => (
  contentVersion === 1 ? eventCatalog[eventId] : undefined
);

const frozenContent: EventSelectionContent<EventDef> = {
  catalog: eventCatalog,
  orderedIds: eventSelectionIdsForCatalog(eventCatalogIds),
  currentVersionOf: () => 1,
};

function rollFrozen(state: Parameters<typeof rollEventForNode>[0], node: Parameters<typeof rollEventForNode>[1]) {
  return rollEventForNode(state, node, frozenLookup, frozenContent);
}

function resolveFrozen(state: Parameters<typeof resolveEventChoice>[0], eventId: string, choiceId: string) {
  return resolveEventChoice(state, eventId, choiceId, frozenLookup);
}

function featheredCairn(): EventDefV2 {
  const definition = eventCatalog.feathered_cairn;
  expect(definition, 'the active catalog must materialize Feathered Cairn').toBeDefined();
  expect(isEventDefV2(definition!)).toBe(true);
  if (!definition || !isEventDefV2(definition)) throw new Error('active Feathered Cairn content is missing');
  return definition;
}

function farSight(): EventDefV2 {
  const definition = eventCatalog.feathered_cairn_far_sight;
  expect(definition, 'the active catalog must materialize Far Sight').toBeDefined();
  expect(isEventDefV2(definition!)).toBe(true);
  if (!definition || !isEventDefV2(definition)) throw new Error('active Far Sight content is missing');
  return definition;
}

function resolveFeathers() {
  const event = featheredCairn();
  const state = withBowAffinityBoard(activeRun());
  const node = rarityHitNode(state, event, eventNode({ id: 'feathered-source', depth: 3, wave: 2 }));
  const rolled = rollFrozen(state, node);
  expect(rolled.event.id).toBe('feathered_cairn');
  const source = installCurrentNode(rolled.state, node);
  return { event, node, resolved: resolveFrozen(source, 'feathered_cairn', 'read_feathers') };
}

function deliverFarSight() {
  const source = resolveFeathers();
  const dueNode = eventNode({
    id: 'far-sight-due', depth: source.node.depth + 2, wave: 3, eventTheme: 'omen', biomeId: 'arrowfell',
  });
  const delivered = rollFrozen(roundTrip(source.resolved.state), dueNode);
  expect(delivered.event.id).toBe('feathered_cairn_far_sight');
  return { ...source, dueNode, state: installCurrentNode(delivered.state, dueNode) };
}

describe('run/Feathered Cairn frozen schema-v2 compatibility', () => {
  it('retains both stable v2 definitions through the legacy facade and active history', () => {
    const cairn = featheredCairn();
    const callback = farSight();

    expect(eventDefAtVersion('feathered_cairn', 1)).toStrictEqual(cairn);
    expect(eventDefAtVersion('feathered_cairn_far_sight', 1)).toStrictEqual(callback);
    expect(cairn).toMatchObject({
      id: 'feathered_cairn', theme: 'cache', rarity: 'uncommon', biomeIds: ['arrowfell'],
      story: { storyId: 'feathered_cairn', stage: 'setup', role: 'setup' },
      eligibility: { any: [
        { fact: 'board.affinity', args: { affinityId: 'bow' } },
        { fact: 'owned.card.count', args: { where: 'any', count: 3, match: { weapons: ['bow'] } } },
      ] },
      delivery: { kind: 'ambient' }, visibility: 'visible', priority: 200, once: 'run', cooldownNodes: 0,
    });
    expect(cairn.choices).toMatchObject([
      { id: 'read_feathers', cost: 0, outcome: { kind: 'grantMapInfo', bandsAhead: 2 }, callback: {
        callbackId: 'feathered_cairn_far_sight', eventId: 'feathered_cairn_far_sight', contentVersion: 1,
        minDepthDelay: 2, destinationThemes: ['omen'], destinationBiomeIds: ['arrowfell'], priority: 700,
        bind: [], expiry: { expiresAfterNodes: 20, fallback: 'discard' },
      } },
      { id: 'take_fletchers_gift', label: 'Take a Bow card', cost: 0, outcome: { kind: 'cardChoice', filter: [{ weapons: ['bow'] }], tier: 'bronze' } },
      { id: 'leave', cost: 0, outcome: { kind: 'nothing' } },
    ]);
    expect(callback).toMatchObject({
      id: 'feathered_cairn_far_sight', theme: 'omen', rarity: 'uncommon', biomeIds: ['arrowfell'],
      story: { storyId: 'feathered_cairn', stage: 'callback', role: 'callback' },
      eligibility: { fact: 'callback.queued', args: { callbackId: 'feathered_cairn_far_sight' } },
      delivery: { kind: 'queued_callback' }, visibility: 'teased_when_due', priority: 700, once: 'run', cooldownNodes: 0,
    });
    expect(callback.choices).toMatchObject([
      { id: 'follow_mark', cost: 0, outcome: { kind: 'grantMapInfo', bandsAhead: 3 }, mutations: [{ op: 'completeStory', storyId: 'feathered_cairn' }] },
      { id: 'take_cache', cost: 0, outcome: { kind: 'gemChoice', filter: [{ ids: ['concussive_shot_echo', 'rending_sliver', 'weak_point_sliver'] }] }, mutations: [{ op: 'completeStory', storyId: 'feathered_cairn' }] },
      { id: 'ignore_mark', cost: 0, outcome: { kind: 'nothing' }, mutations: [{ op: 'completeStory', storyId: 'feathered_cairn' }] },
    ]);
  });

  it('admits either Bow gate arm, rejects neither, and remains biome- and rarity-gated', () => {
    const event = featheredCairn();
    const node = eventNode();
    const affinity = withBowAffinityBoard(activeRun());
    const owned = withOffBoardBowCards(activeRun());

    expect(eventRequirementMet({ state: affinity, node, event }, event.eligibility)).toBe(true);
    expect(eventRequirementMet({ state: owned, node, event }, event.eligibility)).toBe(true);
    expect(eventRequirementMet({ state: activeRun(), node, event }, event.eligibility)).toBe(false);
    const rarityHit = rarityHitNode(affinity, event, node);
    expect(eventEligible({ state: affinity, node: rarityHit, event })).toBe(true);
    expect(eventEligible({ state: affinity, node: { ...rarityHit, biomeId: 'emberwaste' }, event })).toBe(false);
  });

  it('does not select Feathered Cairn on the deterministic uncommon-rarity miss', () => {
    const event = featheredCairn();
    const state = withBowAffinityBoard(activeRun());
    const missNode = eventNode({ id: 'rarity-miss', eventSeed: 0, eventTheme: 'cache', biomeId: 'arrowfell' });
    const hitNode = { ...missNode, id: 'rarity-hit', eventSeed: 1 };

    expect(eventRequirementMet({ state, node: missNode, event }, event.eligibility)).toBe(true);
    expect(eventEligible({ state, node: missNode, event })).toBe(false);
    expect(rollFrozen(state, missNode).event.id).not.toBe('feathered_cairn');
    expect(eventEligible({ state, node: hitNode, event })).toBe(true);
    expect(rollFrozen(state, hitNode).event.id).toBe('feathered_cairn');
  });

  it('selects the eligible setup, grants map intel, and queues exact delayed Far Sight delivery', () => {
    const { node, resolved } = resolveFeathers();

    expect(resolved.outcome).toEqual({
      kind: 'grantMapInfo', bandsAhead: 2, revealedBands: [1, 2],
    });
    expect(resolved.state.mapIntelByBand).toMatchObject({
      '1': { sourceEventInstanceId: `event:${node.id}` },
      '2': { sourceEventInstanceId: `event:${node.id}` },
    });
    expect(resolved.state.eventCallbackQueue).toEqual([expect.objectContaining({
      callbackId: 'feathered_cairn_far_sight', eventId: 'feathered_cairn_far_sight', contentVersion: 1,
      earliestDepth: node.depth + 2, destinationThemes: ['omen'], destinationBiomeIds: ['arrowfell'],
      priority: 700, expiry: { expiresAfterNodes: 20, fallback: 'discard' },
    })]);
  });

  it('keeps Far Sight queued before its delay and through a resolved incompatible event node, then delivers after reload', () => {
    const source = resolveFeathers();
    const early = eventNode({ id: 'early-omen', depth: 4, wave: 2, eventTheme: 'omen', biomeId: 'arrowfell' });
    const beforeDelay = rollFrozen(roundTrip(source.resolved.state), early);
    expect(dueEventCallback(source.resolved.state, early, frozenLookup)).toBeUndefined();
    expect(beforeDelay.event.id).not.toBe('feathered_cairn_far_sight');
    expect(beforeDelay.state.eventCallbackQueue).toEqual(source.resolved.state.eventCallbackQueue);

    const incompatible = eventNode({ id: 'incompatible-forge', depth: 5, wave: 3, eventTheme: 'forge', biomeId: 'arrowfell' });
    const incompatibleRoll = rollFrozen(beforeDelay.state, incompatible);
    expect(incompatibleRoll.event.id).not.toBe('feathered_cairn_far_sight');
    const safeChoice = incompatibleRoll.event.choices.find((choice) => (
      (choice.cost === undefined || choice.cost === 0)
      && choice.requires === undefined
      && choice.requiresTally === undefined
    ));
    expect(safeChoice).toBeDefined();
    if (!safeChoice) throw new Error('every real event must provide a safe choice');
    const incompatibleResolved = resolveFrozen(
      installCurrentNode(incompatibleRoll.state, incompatible), incompatibleRoll.event.id, safeChoice.id,
    );
    const completed = leaveEvent(incompatibleResolved.state);
    expect(completed.currentNodeId).toBeNull();
    expect(completed.eventCallbackQueue).toEqual(source.resolved.state.eventCallbackQueue);

    const due = eventNode({ id: 'reloaded-due', depth: 5, wave: 3, eventTheme: 'omen', biomeId: 'arrowfell' });
    const delivered = rollFrozen(roundTrip(completed), due);
    expect(delivered.event.id).toBe('feathered_cairn_far_sight');
    expect(eventInstanceAt(delivered.state, due.id)).toMatchObject({
      eventId: 'feathered_cairn_far_sight', contentVersion: 1,
    });
    expect(delivered.state.eventCallbackQueue).toEqual([]);
  });

  it('resolves each Far Sight choice through its typed behavior and completes the story', () => {
    const follow = deliverFarSight();
    const followed = resolveFrozen(follow.state, 'feathered_cairn_far_sight', 'follow_mark');
    expect(followed.outcome).toEqual({
      kind: 'grantMapInfo', bandsAhead: 3, revealedBands: [3],
    });
    expect(followed.state.mapIntelByBand).toMatchObject({
      '3': { sourceEventInstanceId: `event:${follow.dueNode.id}` },
    });
    expect(followed.state.completedStoryIds).toEqual(['feathered_cairn']);

    const cache = deliverFarSight();
    const cached = resolveFrozen(cache.state, 'feathered_cairn_far_sight', 'take_cache');
    expect(cached.outcome.kind).toBe('gemChoicePick');
    if (cached.outcome.kind === 'gemChoicePick') {
      expect([...cached.outcome.options].sort()).toEqual([
        'concussive_shot_echo', 'rending_sliver', 'weak_point_sliver',
      ]);
    }
    expect(cached.state.completedStoryIds).toEqual(['feathered_cairn']);

    const ignored = deliverFarSight();
    const ignoredResult = resolveFrozen(ignored.state, 'feathered_cairn_far_sight', 'ignore_mark');
    expect(ignoredResult.outcome).toEqual({ kind: 'nothing' });
    expect(ignoredResult.state.completedStoryIds).toEqual(['feathered_cairn']);
  });

  it('resolves Feathered Cairn leave from its committed node with no callback and a safe completion', () => {
    const event = featheredCairn();
    const state = withBowAffinityBoard(activeRun());
    const node = eventNode({ id: 'feathered-leave', eventSeed: 1, eventTheme: 'cache', biomeId: 'arrowfell' });
    const rolled = rollFrozen(state, node);
    expect(rolled.event.id).toBe(event.id);

    const resolved = resolveFrozen(installCurrentNode(rolled.state, node), event.id, 'leave');
    expect(resolved.outcome).toEqual({ kind: 'nothing' });
    expect(resolved.state.eventCallbackQueue).toEqual([]);
    expect(resolved.state.eventResolutions?.[node.id]).toEqual({
      eventId: 'feathered_cairn', contentVersion: 1, instanceId: `event:${node.id}`, choiceId: 'leave',
    });
    expect(leaveEvent(resolved.state).currentNodeId).toBeNull();
  });

  it('keeps a cost-zero safe exit on both stages and uses theme fallback art', () => {
    const cairn = featheredCairn();
    const callback = farSight();
    const setupExit = cairn.choices.find((choice) => choice.id === 'leave');
    const callbackExit = callback.choices.find((choice) => choice.id === 'ignore_mark');

    expect(setupExit).toMatchObject({ cost: 0, outcome: { kind: 'nothing' } });
    expect(callbackExit).toMatchObject({ cost: 0, outcome: { kind: 'nothing' } });
    expect(cairn.artId).toBeUndefined();
    expect(callback.artId).toBeUndefined();
    expect(eventArtKey(cairn.theme, cairn.artId)).toBe(RUN_ART_KEYS.event.cache);
    expect(eventArtKey(callback.theme, callback.artId)).toBe(RUN_ART_KEYS.event.omen);
  });
});
