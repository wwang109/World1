import { afterEach, describe, expect, it } from 'vitest';
import { isEventDefV3, type LoadedEventDefV3 } from '../../src/data/eventContentV3';
import { eventDefAtVersion } from '../../src/data/eventsContent';
import { eventRuntimeCatalog } from '../../src/data/events';
import { hashSeed } from '../../src/engine/rng';
import {
  clearRun,
  currentRunEventViewModel,
  finalizeCurrentRunEventOffer,
  getActiveRun,
  installDevRunFixture,
  reopenCurrentRunEventOffer,
  resolveCurrentRunEventChoice,
} from '../../src/game/runStore';
import { previewEventChoicesV3 } from '../../src/run/eventV3Materialization';
import { rollEventForNode } from '../../src/run/events';
import { rollStartDraft } from '../../src/run/draft';
import { createRun, type RunNode, type RunState } from '../../src/run/runState';
import {
  activeRun,
  eventNode,
  installCurrentNode,
  roundTrip,
  withBowAffinityBoard,
} from '../fixtures/eventV2';

const PAYOFF_POOLS = {
  cinderheart_crucible: ['temper_fire_card', 'choose_fire_gem'],
  red_standard: ['claim_axe_draft', 'hone_axe'],
  thunder_in_a_bottle: ['socket_thunder', 'teach_the_card'],
  gilded_detour: ['buy_gold_upgrade', 'buy_premium_gem'],
  victors_table: ['toast_growth', 'choose_spoils'],
  bitter_rematch: ['honor_finisher', 'claim_rematch_purse'],
} as const;

function currentV3(id: string): LoadedEventDefV3 {
  const def = eventRuntimeCatalog[id];
  if (def === undefined || !isEventDefV3(def)) throw new Error(`missing active schema-v3 event ${id}`);
  return def;
}

function rarityHitFor(ids: readonly string[], maxSeed = 4096): number {
  for (let eventSeed = 0; eventSeed <= maxSeed; eventSeed += 1) {
    const hits = ids.every((id) => {
      const rarity = currentV3(id).rarity;
      const divisor = rarity === 'uncommon' ? 2 : rarity === 'rare' ? 4 : 1;
      return hashSeed('eventRarity', eventSeed, id) % divisor === 0;
    });
    if (hits) return eventSeed;
  }
  throw new Error(`no bounded rarity hit for ${ids.join(',')}`);
}

function combatFact(overrides: Partial<RunState['combatFactLedger'][number]>): RunState['combatFactLedger'][number] {
  return {
    battleId: 'battle:model', nodeId: 'fight:model', depth: 1, biomeId: 'duskbarrow',
    enemyIds: ['bandit_duelist'], result: 'win', boss: false, turns: 8,
    affinityId: 'dark', usedCardIds: ['shadow_bolt'], statusKinds: [], actionKinds: ['damage'],
    ...overrides,
  };
}

function tieState(seed: number): RunState {
  const base = activeRun(seed);
  const bagSlots = Array(base.bagSlots.length).fill(null) as RunState['bagSlots'];
  bagSlots[0] = { instanceId: 'model:dark', skillId: 'shadow_bolt', tier: 'bronze' };
  return {
    ...base,
    lives: 1,
    pieces: [],
    bagSlots,
    held: null,
    combatFactLedger: [
      combatFact({ battleId: 'battle:dusk-boss', boss: true, result: 'win' }),
      combatFact({ battleId: 'battle:recent-loss', depth: 3, result: 'loss' }),
    ],
  };
}

function featheredSourceNode(): RunNode {
  return eventNode({
    id: 'model:cairn', depth: 3, wave: 2, eventTheme: 'cache', biomeId: 'arrowfell',
    eventSeed: rarityHitFor(['feathered_cairn']),
  });
}

function playFeatheredPath(seed: number): unknown {
  clearRun();
  const sourceNode = featheredSourceNode();
  installDevRunFixture(installCurrentNode(withBowAffinityBoard(activeRun(seed)), sourceNode));

  const sourceView = currentRunEventViewModel();
  const selectedSource = roundTrip(getActiveRun()!);
  const sourceMaterialization = selectedSource.eventMaterializations[`event:${sourceNode.id}`];
  installDevRunFixture(roundTrip(selectedSource));
  expect(currentRunEventViewModel()).toStrictEqual(sourceView);
  expect(getActiveRun()!.eventMaterializations[`event:${sourceNode.id}`]).toStrictEqual(sourceMaterialization);

  const sourceOutcome = resolveCurrentRunEventChoice('read_feathers');
  const scheduled = roundTrip(getActiveRun()!);
  expect(scheduled.eventMaterializations[`event:${sourceNode.id}`]).toStrictEqual(sourceMaterialization);
  expect(scheduled.eventCallbackQueue).toHaveLength(1);

  const dueNode = eventNode({
    id: 'model:far-sight', depth: sourceNode.depth + 2, wave: 3,
    eventTheme: 'omen', biomeId: 'arrowfell', eventSeed: 0,
  });
  installDevRunFixture(installCurrentNode(roundTrip(scheduled), dueNode));
  const callbackView = currentRunEventViewModel();
  const delivered = roundTrip(getActiveRun()!);
  const callbackMaterialization = delivered.eventMaterializations[`event:${dueNode.id}`];
  const pendingOutcome = resolveCurrentRunEventChoice('take_cache');
  const pending = roundTrip(getActiveRun()!);
  installDevRunFixture(roundTrip(pending));
  const reopened = reopenCurrentRunEventOffer();
  expect(reopened).toStrictEqual(pendingOutcome);
  expect(getActiveRun()!.eventMaterializations[`event:${dueNode.id}`]).toStrictEqual(callbackMaterialization);
  if (reopened?.kind !== 'gemChoice') throw new Error('Far Sight cache must reopen its persisted gem choice');
  const gemId = reopened.offer.optionGemIds[0];
  const finalOutcome = finalizeCurrentRunEventOffer({ kind: 'gem', gemId });
  const final = roundTrip(getActiveRun()!);

  return {
    sourceEventId: sourceView?.eventId,
    sourceChoiceIds: sourceView?.choices.map((choice) => choice.id),
    sourceMaterialization,
    sourceOutcome,
    scheduledCallback: scheduled.eventCallbackQueue[0],
    callbackEventId: callbackView?.eventId,
    callbackChoiceIds: callbackView?.choices.map((choice) => choice.id),
    callbackMaterialization,
    pendingOutcome,
    reopened,
    finalOutcome,
    finalResolution: final.eventResolutions?.[dueNode.id],
    finalGemInventory: final.gemInventory,
    completedStoryIds: final.completedStoryIds,
  };
}

afterEach(() => clearRun());

describe('live schema-v3 seeded event model', () => {
  it('does not pre-roll an itinerary and leaves fights and shops as ordinary route nodes', () => {
    const drafted = createRun(7301);
    const allNodes = drafted.map.depths.flat();
    expect(drafted.seed).toBe(7301);
    expect(drafted.eventInstances).toEqual({});
    expect(drafted.eventMaterializations).toEqual({});
    expect(new Set(allNodes.map((node) => node.kind))).toEqual(new Set(['event', 'shop', 'fight']));

    const reached = allNodes.find((node) => node.kind === 'event');
    if (reached === undefined) throw new Error('bounded map fixture has no event node');
    const selected = rollEventForNode(activeRun(7301), reached);
    expect(Object.keys(selected.state.eventInstances)).toEqual([reached.id]);
    expect(Object.keys(selected.state.eventInstances)).not.toContain(
      allNodes.find((node) => node.kind === 'event' && node.id !== reached.id)?.id,
    );
  });

  it('uses the run seed as a deterministic tie break while bounded seeds reach both eligible rare events', () => {
    const ids = ['names_under_stone', 'last_light_at_roads_end'] as const;
    const node = eventNode({
      id: 'model:rare-tie', depth: 4, wave: 3, eventTheme: 'omen', biomeId: 'duskbarrow',
      eventSeed: rarityHitFor(ids),
    });
    const seen = new Set<string>();
    for (let seed = 1; seed <= 64; seed += 1) {
      const selected = rollEventForNode(tieState(seed), node);
      const replay = rollEventForNode(roundTrip(selected.state), node);
      expect(ids).toContain(selected.event.id);
      expect(JSON.stringify(replay.state)).toBe(JSON.stringify(selected.state));
      expect(replay.event.id).toBe(selected.event.id);
      expect(selected.state.eventMaterializations[`event:${node.id}`]?.choiceIds).toHaveLength(3);
      seen.add(selected.event.id);
    }
    expect(seen).toEqual(new Set(ids));
  });

  it('replays the exact event, options, callback, offer, and reward across reload', () => {
    expect(playFeatheredPath(8042)).toStrictEqual(playFeatheredPath(8042));
  });

  it('reaches both authored entries of every payoff pool within seeds 0..63 and keeps the start draft Bronze', () => {
    for (const [eventId, expectedPoolIds] of Object.entries(PAYOFF_POOLS)) {
      const def = currentV3(eventId);
      const seen = new Set<string>();
      for (let seed = 0; seed <= 63; seed += 1) {
        const choiceIds = previewEventChoicesV3(seed, `event:model:pool:${eventId}`, def).map((choice) => choice.id);
        const selectedPoolId = choiceIds.find((id) => (expectedPoolIds as readonly string[]).includes(id));
        expect(selectedPoolId, `${eventId} seed ${String(seed)}`).toBeDefined();
        seen.add(selectedPoolId!);
      }
      expect(seen, eventId).toEqual(new Set(expectedPoolIds));
    }

    for (let seed = 0; seed <= 63; seed += 1) {
      const cards = Object.values(rollStartDraft(seed)).flat();
      expect(cards).toHaveLength(20);
      expect(cards.every((card) => card.tier === 'bronze')).toBe(true);
    }
    expect(eventDefAtVersion('feathered_cairn', 1)).toBeDefined();
    expect(isEventDefV3(eventDefAtVersion('feathered_cairn', 2)!)).toBe(true);
  });
});
