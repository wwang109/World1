import { describe, expect, it } from 'vitest';
import type { EventDirectOutcomeSpecV3 } from '../../src/data/eventContentV3';
import {
  correlatedMaterializedChoiceV3,
  finalizeBonusDraftV3,
  finalizeEventCardChoiceV3,
  finalizeGemChoiceV3,
  finalizeMergeCardsV3,
  finalizeSellGemV3,
  finalizeTargetedUpgradeV3,
  finalizeUpgradeCardV3,
  materializeReachedEventV3,
  reopenEventChoiceV3,
  resolveEventChoiceV3,
} from '../../src/run/eventsV3';
import type { EventDeferredOfferV3 } from '../../src/run/eventV3Materialization';
import type { RunState } from '../../src/run/runState';
import {
  EVENT_V3_NODE,
  eventV3Choice,
  eventV3Fixture,
  eventWithOutcome,
  futureBiomeEventV3,
  materializedEventV3,
} from '../fixtures/eventV3';
import { biomeIds } from '../../src/data/biomes';
import { gemBook } from '../../src/data/gems';
import { recordEventInstance } from '../../src/run/eventInstances';

type V3Lookup = (eventId: string, contentVersion: number) => ReturnType<typeof eventV3Fixture> | undefined;

const reopenWithLookup = reopenEventChoiceV3 as unknown as (
  state: RunState,
  instanceId: string,
  lookup: V3Lookup,
) => ReturnType<typeof reopenEventChoiceV3>;

type PickerKind = Extract<EventDeferredOfferV3, { status: 'pending' }>['kind'];

const PICKER_OUTCOMES = [
  ['cardChoice', { kind: 'cardChoice', filter: [{}], maxTier: 'gold' }],
  ['upgradeCardTargeted', {
    kind: 'upgradeCardTargeted',
    target: { filter: { where: 'any', match: { weapons: ['sword'] } } },
    fallback: { kind: 'grantGold', amount: 2 },
  }],
  ['bonusDraft', { kind: 'bonusDraft' }],
  ['gemChoice', { kind: 'gemChoice' }],
  ['upgradeCard', { kind: 'upgradeCard' }],
  ['sellGem', { kind: 'sellGem' }],
  ['mergeCards', { kind: 'mergeCards' }],
] as const satisfies readonly (readonly [PickerKind, EventDirectOutcomeSpecV3])[];

function selectedIdForOffer(offer: Extract<EventDeferredOfferV3, { status: 'pending' }>): string | number {
  switch (offer.kind) {
    case 'cardChoice': return offer.options[0]!.skillId;
    case 'upgradeCardTargeted': return offer.optionInstanceIds[0]!;
    case 'bonusDraft': return offer.options[0]!.skillId;
    case 'gemChoice': return offer.optionGemIds[0]!;
    case 'upgradeCard': return offer.optionInstanceIds[0]!;
    case 'sellGem': return offer.options[0]!.pouchIndex;
    case 'mergeCards': return offer.candidates[0]!.skillId;
    case 'grantCard':
    case 'grantGem':
      throw new Error(`expected deferred picker, received ${offer.kind}`);
  }
}

function finalizeWithLookup(
  kind: PickerKind,
  state: RunState,
  instanceId: string,
  choiceId: string,
  selectedId: string | number,
  lookup: V3Lookup,
) {
  switch (kind) {
    case 'cardChoice':
      return (finalizeEventCardChoiceV3 as unknown as (
        state: RunState, instanceId: string, choiceId: string, selectedId: string, lookup: V3Lookup,
      ) => ReturnType<typeof finalizeEventCardChoiceV3>)(state, instanceId, choiceId, String(selectedId), lookup);
    case 'upgradeCardTargeted':
      return (finalizeTargetedUpgradeV3 as unknown as (
        state: RunState, instanceId: string, choiceId: string, selectedId: string, lookup: V3Lookup,
      ) => ReturnType<typeof finalizeTargetedUpgradeV3>)(state, instanceId, choiceId, String(selectedId), lookup);
    case 'bonusDraft':
      return (finalizeBonusDraftV3 as unknown as (
        state: RunState, instanceId: string, choiceId: string, selectedId: string, lookup: V3Lookup,
      ) => ReturnType<typeof finalizeBonusDraftV3>)(state, instanceId, choiceId, String(selectedId), lookup);
    case 'gemChoice':
      return (finalizeGemChoiceV3 as unknown as (
        state: RunState, instanceId: string, choiceId: string, selectedId: string, lookup: V3Lookup,
      ) => ReturnType<typeof finalizeGemChoiceV3>)(state, instanceId, choiceId, String(selectedId), lookup);
    case 'upgradeCard':
      return (finalizeUpgradeCardV3 as unknown as (
        state: RunState, instanceId: string, choiceId: string, selectedId: string, lookup: V3Lookup,
      ) => ReturnType<typeof finalizeUpgradeCardV3>)(state, instanceId, choiceId, String(selectedId), lookup);
    case 'sellGem':
      return (finalizeSellGemV3 as unknown as (
        state: RunState, instanceId: string, choiceId: string, selectedId: number, lookup: V3Lookup,
      ) => ReturnType<typeof finalizeSellGemV3>)(state, instanceId, choiceId, Number(selectedId), lookup);
    case 'mergeCards':
      return (finalizeMergeCardsV3 as unknown as (
        state: RunState, instanceId: string, choiceId: string, selectedId: string, lookup: V3Lookup,
      ) => ReturnType<typeof finalizeMergeCardsV3>)(state, instanceId, choiceId, String(selectedId), lookup);
    case 'grantCard':
    case 'grantGem':
      throw new Error(`unexpected immediate kind ${kind}`);
  }
}

const FOREIGN_CARD_OPTIONS = [
  { skillId: 'sword_slash', tier: 'bronze' },
  { skillId: 'sword_slash', tier: 'silver' },
  { skillId: 'sword_slash', tier: 'gold' },
] as const;
const NO_OFFER_OUTCOMES = [
  ['grantGold', { kind: 'grantGold', amount: 3 }],
  ['loseGold', { kind: 'loseGold', amount: 2 }],
  ['grantLevel', { kind: 'grantLevel' }],
  ['grantMapInfo', { kind: 'grantMapInfo', bandsAhead: 2 }],
  ['nothing', { kind: 'nothing' }],
] as const satisfies readonly (readonly [string, EventDirectOutcomeSpecV3])[];

function foreignCardOffer(status: 'pending' | 'settled'): EventDeferredOfferV3 {
  return status === 'pending'
    ? { kind: 'cardChoice', status, options: FOREIGN_CARD_OPTIONS }
    : { kind: 'cardChoice', status, options: FOREIGN_CARD_OPTIONS, selectedSkillId: 'sword_slash' };
}

function injectForeignOffer(
  state: RunState,
  status: 'pending' | 'settled',
): RunState {
  const instance = state.eventInstances[EVENT_V3_NODE.id]!;
  const materialization = state.eventMaterializations[instance.instanceId]!;
  return {
    ...state,
    eventMaterializations: {
      ...state.eventMaterializations,
      [instance.instanceId]: {
        ...materialization,
        deferredOffersByChoiceId: {
          ...materialization.deferredOffersByChoiceId,
          act: foreignCardOffer(status),
        },
      },
    },
  };
}

describe('run/eventsV3: initial choice correlation', () => {
  it.each([
    ['unknown reason', { act: 'unknown_reason' }],
    ['reason outside committed choices', { missing: 'no_unvisited_biome' }],
  ])('rejects %s before correlation or resolution', (_name, unavailableReasons) => {
    const event = eventWithOutcome({ kind: 'grantGold', amount: 3 });
    const materialized = materializedEventV3(event, 799, { gold: 5 });
    const instanceId = `event:${EVENT_V3_NODE.id}`;
    const record = materialized.eventMaterializations[instanceId]!;
    const state = {
      ...materialized,
      eventMaterializations: {
        ...materialized.eventMaterializations,
        [instanceId]: {
          ...record,
          unavailableChoiceReasonsByChoiceId: unavailableReasons,
        },
      },
    } as unknown as RunState;
    const before = JSON.stringify(state);

    expect(correlatedMaterializedChoiceV3(event, state.eventMaterializations[instanceId]!, instanceId, 'act'))
      .toBeUndefined();
    expect(resolveEventChoiceV3(state, instanceId, 'act', () => event)).toEqual({
      ok: false, state, reason: 'materialization',
    });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('does not reopen a pending picker through malformed unavailable-choice metadata', () => {
    const event = eventWithOutcome({ kind: 'cardChoice', filter: [{}], maxTier: 'gold' });
    const materialized = materializedEventV3(event, 798);
    const instanceId = `event:${EVENT_V3_NODE.id}`;
    const pending = resolveEventChoiceV3(materialized, instanceId, 'act', () => event);
    if (!pending.ok || pending.outcome.kind !== 'cardChoice') throw new Error('expected pending fixture');
    const record = pending.state.eventMaterializations[instanceId]!;
    const malformed = {
      ...pending.state,
      eventMaterializations: {
        ...pending.state.eventMaterializations,
        [instanceId]: {
          ...record,
          unavailableChoiceReasonsByChoiceId: { act: 'unknown_reason' },
        },
      },
    } as unknown as RunState;

    expect(reopenEventChoiceV3(malformed, instanceId, () => event)).toBeUndefined();
  });

  it.each([
    ['event id', { eventId: 'other_event' }],
    ['content version', { contentVersion: 99 }],
  ])('does not reopen or finalize a picker with mismatched resolution %s', (_name, resolutionPatch) => {
    const event = eventWithOutcome({ kind: 'cardChoice', filter: [{}], maxTier: 'gold' });
    const instanceId = `event:${EVENT_V3_NODE.id}`;
    const materialized = materializedEventV3(event, 797);
    const pending = resolveEventChoiceV3(materialized, instanceId, 'act', () => event);
    if (!pending.ok || pending.outcome.kind !== 'cardChoice') throw new Error('expected pending fixture');
    const resolution = pending.state.eventResolutions?.[EVENT_V3_NODE.id];
    if (resolution === undefined) throw new Error('expected persisted resolution');
    const malformed: RunState = {
      ...pending.state,
      eventResolutions: {
        ...pending.state.eventResolutions,
        [EVENT_V3_NODE.id]: { ...resolution, ...resolutionPatch },
      },
    };
    const selectedSkillId = pending.outcome.offer.options[0]!.skillId;
    const before = JSON.stringify(malformed);

    expect(reopenEventChoiceV3(malformed, instanceId, () => event)).toBeUndefined();
    expect(finalizeEventCardChoiceV3(
      malformed, instanceId, 'act', selectedSkillId, () => event,
    )).toEqual({ ok: false, state: malformed, reason: 'choice' });
    expect(JSON.stringify(malformed)).toBe(before);
  });

  it.each([
    ['reason on a non-consuming choice', 'exhausted' as const, { study: 'no_unvisited_biome' }],
    ['reason while a destination is present', 'available' as const, { mark_road: 'no_unvisited_biome' }],
    ['missing required reason', 'exhausted' as const, {}],
  ])('rejects %s as an exact authored unavailable-reason mismatch', (_name, mode, reasons) => {
    const { source } = futureBiomeEventV3();
    const state = materializedEventV3(source, 812, mode === 'exhausted'
      ? { journeyFactLedger: { visitedBiomeIds: [...biomeIds] } }
      : {});
    const instanceId = `event:${EVENT_V3_NODE.id}`;
    const materialization = state.eventMaterializations[instanceId]!;
    const malformed = {
      ...state,
      eventMaterializations: {
        ...state.eventMaterializations,
        [instanceId]: {
          ...materialization,
          unavailableChoiceReasonsByChoiceId: reasons,
        },
      },
    } as unknown as RunState;
    const before = JSON.stringify(malformed);

    expect(correlatedMaterializedChoiceV3(
      source, malformed.eventMaterializations[instanceId]!, instanceId, 'mark_road',
    )).toBeUndefined();
    expect(resolveEventChoiceV3(malformed, instanceId, 'mark_road', () => source)).toEqual({
      ok: false, state: malformed, reason: 'materialization',
    });
    expect(JSON.stringify(malformed)).toBe(before);
  });

  it.each([
    ['reason on the wrong choice', {}, { study: 'no_unvisited_biome' }],
    ['reason while a destination is present', undefined, { mark_road: 'no_unvisited_biome' }],
    ['missing required reason', {}, {}],
  ] as const)(
    'rejects pending picker re-entry and finalization for %s',
    (_name, replacementSubjects, unavailableReasons) => {
      const { source, target } = futureBiomeEventV3({
        kind: 'cardChoice', filter: [{}], maxTier: 'gold',
      });
      const instanceId = `event:${EVENT_V3_NODE.id}`;
      const lookup: V3Lookup = (eventId) => (
        eventId === source.id ? source : eventId === target.id ? target : undefined
      );
      const materialized = materializedEventV3(source, 814);
      const pending = resolveEventChoiceV3(materialized, instanceId, 'mark_road', lookup);
      if (!pending.ok || pending.outcome.kind !== 'cardChoice') throw new Error('expected pending picker');
      const record = pending.state.eventMaterializations[instanceId]!;
      const malformed: RunState = {
        ...pending.state,
        eventMaterializations: {
          ...pending.state.eventMaterializations,
          [instanceId]: {
            ...record,
            ...(replacementSubjects === undefined ? {} : { boundSubjects: replacementSubjects }),
            unavailableChoiceReasonsByChoiceId: unavailableReasons,
          },
        },
      };
      const selectedSkillId = pending.outcome.offer.options[0]!.skillId;
      const before = JSON.stringify(malformed);

      expect(reopenWithLookup(malformed, instanceId, lookup)).toBeUndefined();
      expect(finalizeWithLookup(
        'cardChoice', malformed, instanceId, 'mark_road', selectedSkillId, lookup,
      )).toEqual({ ok: false, state: malformed, reason: 'choice' });
      expect(JSON.stringify(malformed)).toBe(before);
    },
  );

  it.each(PICKER_OUTCOMES)(
    'rejects exact-map corruption for pending and settled %s finalizer paths',
    (kind, outcome) => {
      const { source, target } = futureBiomeEventV3(outcome);
      const instanceId = `event:${EVENT_V3_NODE.id}`;
      const lookup: V3Lookup = (eventId) => (
        eventId === source.id ? source : eventId === target.id ? target : undefined
      );
      const [gemId, secondGemId] = Object.keys(gemBook);
      if (gemId === undefined || secondGemId === undefined) throw new Error('expected known gems');
      const materialized = materializedEventV3(source, 820 + kind.length, {
        pieces: [0, 1, 2].map((slot) => ({
          slot, instanceId: `picker-${String(slot)}`, skillId: 'sword_slash', tier: 'bronze' as const,
        })),
        gemInventory: [gemId, secondGemId],
      });
      const pending = resolveEventChoiceV3(materialized, instanceId, 'mark_road', lookup);
      if (!pending.ok || !('offer' in pending.outcome)) throw new Error(`expected ${kind} pending picker`);
      const selectedId = selectedIdForOffer(pending.outcome.offer);
      const record = pending.state.eventMaterializations[instanceId]!;
      const malformedPending: RunState = {
        ...pending.state,
        eventMaterializations: {
          ...pending.state.eventMaterializations,
          [instanceId]: {
            ...record,
            unavailableChoiceReasonsByChoiceId: { study: 'no_unvisited_biome' },
          },
        },
      };
      const pendingBytes = JSON.stringify(malformedPending);

      expect(reopenWithLookup(malformedPending, instanceId, lookup)).toBeUndefined();
      expect(finalizeWithLookup(
        kind, malformedPending, instanceId, 'mark_road', selectedId, lookup,
      )).toEqual({ ok: false, state: malformedPending, reason: 'choice' });
      expect(JSON.stringify(malformedPending)).toBe(pendingBytes);

      const settled = finalizeWithLookup(kind, pending.state, instanceId, 'mark_road', selectedId, lookup);
      if (!settled.ok) throw new Error(`expected ${kind} settlement`);
      const settledRecord = settled.state.eventMaterializations[instanceId]!;
      const malformedSettled: RunState = {
        ...settled.state,
        eventMaterializations: {
          ...settled.state.eventMaterializations,
          [instanceId]: {
            ...settledRecord,
            unavailableChoiceReasonsByChoiceId: { study: 'no_unvisited_biome' },
          },
        },
      };
      const settledBytes = JSON.stringify(malformedSettled);

      expect(finalizeWithLookup(
        kind, malformedSettled, instanceId, 'mark_road', selectedId, lookup,
      )).toEqual({ ok: false, state: malformedSettled, reason: 'choice' });
      expect(JSON.stringify(malformedSettled)).toBe(settledBytes);
    },
  );

  it.each(['not_a_biome', ''])(
    'rejects non-catalog dynamic destination %j at correlation and resolution',
    (destinationBiome) => {
      const { source } = futureBiomeEventV3();
      const instanceId = `event:${EVENT_V3_NODE.id}`;
      const state = materializedEventV3(source, 841);
      const materialization = state.eventMaterializations[instanceId]!;
      const malformed: RunState = {
        ...state,
        eventMaterializations: {
          ...state.eventMaterializations,
          [instanceId]: {
            ...materialization,
            boundSubjects: { destination_biome: destinationBiome },
            unavailableChoiceReasonsByChoiceId: {},
          },
        },
      };
      const before = JSON.stringify(malformed);

      expect(correlatedMaterializedChoiceV3(
        source, malformed.eventMaterializations[instanceId]!, instanceId, 'mark_road',
      )).toBeUndefined();
      expect(resolveEventChoiceV3(malformed, instanceId, 'mark_road', () => source)).toEqual({
        ok: false, state: malformed, reason: 'materialization',
      });
      expect(JSON.stringify(malformed)).toBe(before);
    },
  );

  it.each(['not_a_biome', ''])(
    'rejects materialization from a committed non-catalog dynamic destination %j',
    (destinationBiome) => {
      const { source } = futureBiomeEventV3();
      const initial = materializedEventV3(eventWithOutcome({ kind: 'nothing' }), 842);
      const withoutFixtureCommit: RunState = {
        ...initial,
        eventInstances: {},
        eventMaterializations: {},
      };
      const committed = recordEventInstance(withoutFixtureCommit, EVENT_V3_NODE.id, {
        eventId: source.id,
        contentVersion: 1,
        instanceId: `event:${EVENT_V3_NODE.id}`,
        drawnDepth: EVENT_V3_NODE.depth,
        boundSubjects: { destination_biome: destinationBiome },
      });
      const before = JSON.stringify(committed);

      expect(materializeReachedEventV3(committed, EVENT_V3_NODE, source, 1)).toEqual({
        ok: false, state: committed, reason: 'binding',
      });
      expect(JSON.stringify(committed)).toBe(before);
    },
  );

  it('rejects a pending picker whose chosen transaction is now marked unavailable', () => {
    const { source, target } = futureBiomeEventV3({
      kind: 'cardChoice', filter: [{}], maxTier: 'gold',
    });
    const instanceId = `event:${EVENT_V3_NODE.id}`;
    const materialized = materializedEventV3(source, 813);
    const lookup = (eventId: string) => eventId === source.id ? source : eventId === target.id ? target : undefined;
    const pending = resolveEventChoiceV3(materialized, instanceId, 'mark_road', lookup);
    if (!pending.ok || pending.outcome.kind !== 'cardChoice') throw new Error('expected pending fixture');
    const selectedSkillId = pending.outcome.offer.options[0].skillId;
    const record = pending.state.eventMaterializations[instanceId]!;
    const malformed = {
      ...pending.state,
      eventMaterializations: {
        ...pending.state.eventMaterializations,
        [instanceId]: {
          ...record,
          boundSubjects: {},
          unavailableChoiceReasonsByChoiceId: { mark_road: 'no_unvisited_biome' },
        },
      },
    } as RunState;
    const before = JSON.stringify(malformed);

    expect(reopenEventChoiceV3(malformed, instanceId, lookup)).toBeUndefined();
    expect(finalizeEventCardChoiceV3(
      malformed, instanceId, 'mark_road', selectedSkillId, lookup,
    )).toEqual({ ok: false, state: malformed, reason: 'choice' });
    expect(JSON.stringify(malformed)).toBe(before);
  });

  it.each(NO_OFFER_OUTCOMES.flatMap(([name, outcome]) => ([
    { name, outcome, status: 'pending' as const },
    { name, outcome, status: 'settled' as const },
  ])))('rejects a $status foreign offer before resolving authored $name', ({ outcome, status }) => {
    const event = eventWithOutcome(outcome);
    const state = injectForeignOffer(materializedEventV3(event, 800 + outcome.kind.length, { gold: 5 }), status);
    const beforeBytes = JSON.stringify(state);

    const result = resolveEventChoiceV3(state, `event:${EVENT_V3_NODE.id}`, 'act', () => event);

    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(JSON.stringify(result.state)).toBe(beforeBytes);
  });

  it.each(['pending', 'settled'] as const)('reads the persisted no-offer weighted branch before rejecting a %s foreign offer', (status) => {
    const event = eventV3Fixture({ choiceSet: { fixed: [
      eventV3Choice('act', { kind: 'weighted', branches: [
        { id: 'coins', label: 'Coins', weight: 1, outcome: { kind: 'grantGold', amount: 3 } },
        { id: 'picker', label: 'Picker', weight: 1, outcome: { kind: 'cardChoice', filter: [{}], maxTier: 'gold' } },
      ] }),
      eventV3Choice('leave', { kind: 'nothing' }),
    ] } });
    const seeded = Array.from({ length: 24 }, (_, index) => materializedEventV3(event, index + 1, { gold: 5 }))
      .find((candidate) => candidate.eventMaterializations[`event:${EVENT_V3_NODE.id}`]!
        .selectedWeightedBranchIds.act === 'picker');
    if (seeded === undefined) throw new Error('expected a bounded picker-branch seed');
    const instance = seeded.eventInstances[EVENT_V3_NODE.id]!;
    const materialization = seeded.eventMaterializations[instance.instanceId]!;
    const state = injectForeignOffer({
      ...seeded,
      eventMaterializations: {
        ...seeded.eventMaterializations,
        [instance.instanceId]: {
          ...materialization,
          selectedWeightedBranchIds: { ...materialization.selectedWeightedBranchIds, act: 'coins' },
        },
      },
    }, status);
    const beforeBytes = JSON.stringify(state);

    const result = resolveEventChoiceV3(state, instance.instanceId, 'act', () => event);

    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(JSON.stringify(result.state)).toBe(beforeBytes);
  });

  it('rejects correlation before charging, mutating, consuming a reservation, or scheduling a callback', () => {
    const target = eventV3Fixture({
      id: 'correlation_callback_target',
      delivery: { kind: 'queued_callback' },
      rarity: 'secret',
      acceptsBindings: ['enemy_id'],
      eligibility: { fact: 'callback.queued', args: { callbackId: 'correlation_later' } },
    });
    const source = eventV3Fixture({
      bindings: [{ as: 'enemy_id', source: 'revenge.enemyId' }],
      choiceSet: { fixed: [
        {
          id: 'act', label: 'Act', cost: 2, outcome: { kind: 'grantGold', amount: 3 },
          mutations: [{ op: 'set', key: 'oath_mercy', value: true }],
          callback: {
            callbackId: 'correlation_later', eventId: target.id, contentVersion: 1,
            minDepthDelay: 2, destinationThemes: ['omen'], priority: 700,
            bind: [{ as: 'enemy_id', source: 'revenge.enemyId' }],
            expiry: { expiresAfterNodes: 10, fallback: 'discard' },
          },
        },
        eventV3Choice('leave', { kind: 'nothing' }),
      ] },
    });
    const materialized = materializedEventV3(source, 850, {
      gold: 5,
      revengeFactLedger: [{ battleId: 'battle:r', enemyId: 'rat', achievedDepth: 2, status: 'ready' }],
    });
    expect(materialized.eventBindingReservations).toHaveLength(1);
    expect(materialized.revengeFactLedger[0]?.status).toBe('reserved');
    const state = injectForeignOffer(materialized, 'pending');
    const beforeBytes = JSON.stringify(state);

    const result = resolveEventChoiceV3(state, `event:${EVENT_V3_NODE.id}`, 'act', (eventId) => (
      eventId === source.id ? source : eventId === target.id ? target : undefined
    ));

    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(JSON.stringify(result.state)).toBe(beforeBytes);
  });
});
