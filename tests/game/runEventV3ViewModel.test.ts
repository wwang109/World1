import { describe, expect, it } from 'vitest';
import type { EventDefV2 } from '../../src/data/eventContentV2';
import type { EventDirectOutcomeSpecV3, LoadedEventDefV3 } from '../../src/data/eventContentV3';
import type { LoadedEventDef } from '../../src/data/eventsContent';
import type { EventDef } from '../../src/data/eventTypes';
import { gemBook } from '../../src/data/gems';
import {
  buildRunEventViewModel,
  type RunEventOutcomeHint,
} from '../../src/game/ui/runEventViewModel';
import {
  finalizeEventCardChoiceV3,
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

const GEM_ID = Object.keys(gemBook)[0]!;
const FOREIGN_CARD_OPTIONS = [
  { skillId: 'sword_slash', tier: 'bronze' },
  { skillId: 'sword_slash', tier: 'silver' },
  { skillId: 'sword_slash', tier: 'gold' },
] as const;
const ALL_DIRECT_OUTCOMES = [
  ['grantCard', { kind: 'grantCard' }],
  ['grantGem', { kind: 'grantGem' }],
  ['grantGold', { kind: 'grantGold', amount: 3 }],
  ['loseGold', { kind: 'loseGold', amount: 2 }],
  ['grantLevel', { kind: 'grantLevel' }],
  ['grantMapInfo', { kind: 'grantMapInfo', bandsAhead: 2 }],
  ['nothing', { kind: 'nothing' }],
  ['bonusDraft', { kind: 'bonusDraft' }],
  ['gemChoice', { kind: 'gemChoice' }],
  ['upgradeCard', { kind: 'upgradeCard' }],
  ['sellGem', { kind: 'sellGem' }],
  ['mergeCards', { kind: 'mergeCards' }],
  ['cardChoice', { kind: 'cardChoice', filter: [{}], maxTier: 'gold' }],
  ['upgradeCardTargeted', {
    kind: 'upgradeCardTargeted',
    target: { filter: { where: 'any', match: { cardIds: ['sword_slash'] } } },
    fallback: { kind: 'grantGold', amount: 2 },
  }],
] as const satisfies readonly (readonly [string, EventDirectOutcomeSpecV3])[];
const OWNED: Partial<RunState> = {
  pieces: [0, 1, 2].map((slot) => ({
    slot,
    instanceId: `owned-${String(slot)}`,
    skillId: 'sword_slash',
    tier: 'bronze' as const,
  })),
  gemInventory: [GEM_ID],
};

function viewFor(event: LoadedEventDefV3, state = materializedEventV3(event, 71, OWNED)) {
  const view = buildRunEventViewModel(state, EVENT_V3_NODE, event);
  if (view === undefined) throw new Error('expected a persisted event view');
  return view;
}

function foreignOfferFor(
  authoredKind: EventDirectOutcomeSpecV3['kind'],
  status: 'pending' | 'settled',
): EventDeferredOfferV3 {
  if (authoredKind === 'cardChoice') {
    return {
      kind: 'gemChoice',
      status,
      optionGemIds: [GEM_ID, GEM_ID, GEM_ID],
      ...(status === 'settled' ? { selectedId: GEM_ID } : {}),
    };
  }
  return status === 'pending'
    ? { kind: 'cardChoice', status, options: FOREIGN_CARD_OPTIONS }
    : { kind: 'cardChoice', status, options: FOREIGN_CARD_OPTIONS, selectedSkillId: 'sword_slash' };
}

describe('persisted schema-v3 event view model', () => {
  it.each([
    ['unknown unavailable reason', { act: 'unknown_reason' }],
    ['unavailable reason outside committed choices', { missing: 'no_unvisited_biome' }],
  ])('fails closed for %s', (_name, unavailableReasons) => {
    const event = eventWithOutcome({ kind: 'grantGold', amount: 3 });
    const state = materializedEventV3(event, 70, OWNED);
    const instanceId = `event:${EVENT_V3_NODE.id}`;
    const materialization = state.eventMaterializations[instanceId]!;
    const malformed = {
      ...state,
      eventMaterializations: {
        ...state.eventMaterializations,
        [instanceId]: {
          ...materialization,
          unavailableChoiceReasonsByChoiceId: unavailableReasons,
        },
      },
    } as unknown as RunState;

    expect(buildRunEventViewModel(malformed, EVENT_V3_NODE, event)).toBeUndefined();
  });

  it.each([
    ['reason on a non-consuming choice', 'exhausted' as const, { study: 'no_unvisited_biome' }],
    ['reason while a destination is present', 'available' as const, { mark_road: 'no_unvisited_biome' }],
    ['missing required reason', 'exhausted' as const, {}],
  ])('fails closed for %s even though the reason code is known', (_name, mode, reasons) => {
    const { source } = futureBiomeEventV3();
    const state = materializedEventV3(source, 814, mode === 'exhausted'
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

    expect(buildRunEventViewModel(malformed, EVENT_V3_NODE, source)).toBeUndefined();
  });

  it('projects common metadata and only the exact committed pool choice in authored order', () => {
    const event = eventV3Fixture({
      choiceSet: {
        fixed: [eventV3Choice('leave', { kind: 'nothing' })],
        pool: { draw: 1, entries: [
          eventV3Choice('coins', { kind: 'grantGold', amount: 2 }),
          eventV3Choice('level', { kind: 'grantLevel' }),
        ] },
      },
    });
    const persisted = materializedEventV3(event, 91, OWNED);
    const selectedIds = persisted.eventMaterializations[`event:${EVENT_V3_NODE.id}`]!.choiceIds;
    const alteredSeed = { ...persisted, map: { ...persisted.map, seed: persisted.map.seed + 99_999 } };
    const view = viewFor(event, alteredSeed);

    expect(view).toMatchObject({
      eventId: event.id,
      contentVersion: 1,
      instanceId: `event:${EVENT_V3_NODE.id}`,
      title: 'The Seeded Door',
      body: 'One road opens only when the traveller reaches it.',
      theme: 'omen',
      rarity: 'secret',
      story: { storyId: event.id, stage: 'setup', role: 'setup' },
      visibility: 'hidden_until_eligible',
      isSecret: true,
      isDueCallback: false,
      phase: { kind: 'open' },
    });
    expect(view.choices.map((choice) => choice.id)).toEqual(selectedIds);
    expect(view.choices).toHaveLength(2);
  });

  it.each([
    ['grantGold', { kind: 'grantGold', amount: 3 }],
    ['loseGold', { kind: 'loseGold', amount: 2 }],
    ['grantLevel', { kind: 'grantLevel' }],
    ['grantMapInfo', { kind: 'grantMapInfo', bandsAhead: 3 }],
    ['nothing', { kind: 'nothing' }],
  ] as const)('exposes a typed persisted hint for the immediate %s outcome', (kind, outcome) => {
    const hint = viewFor(eventWithOutcome(outcome)).choices[0]!.outcomeHint;
    expect(hint.kind).toBe(kind);
  });

  it.each([
    ['grantCard', { kind: 'grantCard' }],
    ['grantGem', { kind: 'grantGem' }],
    ['bonusDraft', { kind: 'bonusDraft' }],
    ['gemChoice', { kind: 'gemChoice' }],
    ['upgradeCard', { kind: 'upgradeCard' }],
    ['sellGem', { kind: 'sellGem' }],
    ['mergeCards', { kind: 'mergeCards' }],
    ['cardChoice', { kind: 'cardChoice', filter: [{}], maxTier: 'gold' }],
    ['upgradeCardTargeted', {
      kind: 'upgradeCardTargeted',
      target: { filter: { where: 'any', match: { cardIds: ['sword_slash'] } } },
      fallback: { kind: 'grantGold', amount: 2 },
    }],
  ] as const)('exposes the exact persisted offer as the %s hint', (kind, outcome) => {
    const event = eventWithOutcome(outcome as EventDirectOutcomeSpecV3);
    const state = materializedEventV3(event, 120 + kind.length, OWNED);
    const offer = state.eventMaterializations[`event:${EVENT_V3_NODE.id}`]!.deferredOffersByChoiceId.act;
    const hint = viewFor(event, state).choices[0]!.outcomeHint;

    expect(hint.kind).toBe(kind);
    expect('offer' in hint ? hint.offer : undefined).toEqual(offer);
  });

  it('uses the committed weighted branch for its hint even if the run seed is later altered', () => {
    const event = eventV3Fixture({
      choiceSet: { fixed: [
        eventV3Choice('fate', { kind: 'weighted', branches: [
          { id: 'coin', label: 'Coin', weight: 1, outcome: { kind: 'grantGold', amount: 4 } },
          { id: 'dust', label: 'Dust', weight: 1, outcome: { kind: 'nothing' } },
        ] }),
        eventV3Choice('leave', { kind: 'nothing' }),
      ] },
    });
    const state = materializedEventV3(event, 33, OWNED);
    const record = state.eventMaterializations[`event:${EVENT_V3_NODE.id}`]!;
    const hint = viewFor(event, { ...state, map: { ...state.map, seed: state.map.seed + 1_000 } })
      .choices[0]!.outcomeHint;

    expect(hint.weightedBranchId).toBe(record.selectedWeightedBranchIds.fate);
    expect(hint.kind).toBe(record.selectedWeightedBranchIds.fate === 'coin' ? 'grantGold' : 'nothing');
  });

  it('reports current affordability and persisted unavailable-offer lock reasons', () => {
    const costly = eventV3Fixture({ choiceSet: { fixed: [
      eventV3Choice('costly', { kind: 'grantGold', amount: 8 }, 5),
      eventV3Choice('leave', { kind: 'nothing' }),
    ] } });
    const costlyView = viewFor(costly, materializedEventV3(costly, 42, { ...OWNED, gold: 2 }));
    expect(costlyView.choices[0]).toMatchObject({
      cost: 5, affordable: false, locked: true, lockReason: 'needs 5 gold',
    });

    const unavailable = eventWithOutcome({ kind: 'sellGem' });
    const unavailableView = viewFor(unavailable, materializedEventV3(unavailable, 43, { gemInventory: [] }));
    expect(unavailableView.choices[0]).toMatchObject({
      affordable: true, locked: true, lockReason: 'nothing in your pouch',
      outcomeHint: { kind: 'sellGem', offer: { kind: 'sellGem', status: 'unavailable' } },
    });
  });

  it('words a v3 choice gate through the exact referenced v3 version without reading legacy .choices', () => {
    const prerequisite = eventV3Fixture({
      id: 'v3_prerequisite',
      title: 'The Earlier Door',
      choiceSet: { fixed: [
        { id: 'open_way', label: 'Open the way (2 gold)', cost: 2, outcome: { kind: 'nothing' } },
        eventV3Choice('leave', { kind: 'nothing' }),
      ] },
    });
    const gated = eventV3Fixture({
      id: 'v3_gated',
      choiceSet: { fixed: [
        {
          ...eventV3Choice('answer', { kind: 'grantGold', amount: 2 }),
          requires: { eventId: prerequisite.id, choiceIds: ['open_way'] },
        },
        eventV3Choice('leave', { kind: 'nothing' }),
      ] },
    });
    const state = materializedEventV3(gated, 44, {
      eventInstances: {
        old: {
          eventId: prerequisite.id,
          contentVersion: 1,
          instanceId: 'event:old',
          drawnDepth: 1,
        },
      },
      eventResolutions: {
        old: {
          eventId: prerequisite.id,
          contentVersion: 1,
          instanceId: 'event:old',
          choiceId: 'leave',
        },
      },
    });
    const lookup = (eventId: string, version: number) => version !== 1
      ? undefined
      : eventId === gated.id ? gated
        : eventId === prerequisite.id ? prerequisite
          : undefined;

    expect(buildRunEventViewModel(state, EVENT_V3_NODE, gated, lookup)?.choices[0]?.lockReason)
      .toBe('needs "Open the way"');
  });

  it('finds a required choice in the exact older resolved version across V1, V2, and V3 targets', () => {
    const targetId = 'historical_door';
    const v1: EventDef = {
      id: targetId,
      title: 'Historical Door V1',
      body: 'The first lock.',
      theme: 'omen',
      choices: [
        { id: 'old_key', label: 'Turn the old key (2 gold)', outcome: { kind: 'nothing' } },
        { id: 'leave_v1', label: 'Leave', outcome: { kind: 'nothing' } },
      ],
    };
    const v2: EventDefV2 = {
      id: targetId,
      title: 'Historical Door V2',
      body: 'The lock was replaced.',
      theme: 'omen',
      story: { storyId: targetId, stage: 'setup', role: 'setup' },
      eligibility: { fact: 'biome.current', args: { ids: ['arrowfell'] } },
      delivery: { kind: 'ambient' },
      visibility: 'visible',
      priority: 100,
      once: 'node',
      cooldownNodes: 0,
      choices: [
        { id: 'new_key', label: 'Turn the new key', outcome: { kind: 'nothing' } },
        { id: 'leave_v2', label: 'Leave', outcome: { kind: 'nothing' } },
      ],
    };
    const v3 = eventV3Fixture({
      id: targetId,
      title: 'Historical Door V3',
      choiceSet: { fixed: [
        eventV3Choice('listen', { kind: 'nothing' }),
        eventV3Choice('leave_v3', { kind: 'nothing' }),
      ] },
    });
    const gated = eventV3Fixture({
      id: 'historical_gate',
      choiceSet: { fixed: [
        {
          ...eventV3Choice('answer', { kind: 'grantGold', amount: 2 }),
          requires: { eventId: targetId, choiceIds: ['old_key'] },
        },
        eventV3Choice('leave', { kind: 'nothing' }),
      ] },
    });
    const state = materializedEventV3(gated, 45, {
      eventInstances: {
        older: { eventId: targetId, contentVersion: 1, instanceId: 'event:older', drawnDepth: 1 },
        middle: { eventId: targetId, contentVersion: 2, instanceId: 'event:middle', drawnDepth: 2 },
        newer: { eventId: targetId, contentVersion: 3, instanceId: 'event:newer', drawnDepth: 3 },
      },
      eventResolutions: {
        older: { eventId: targetId, contentVersion: 1, instanceId: 'event:older', choiceId: 'leave_v1' },
        middle: { eventId: targetId, contentVersion: 2, instanceId: 'event:middle', choiceId: 'leave_v2' },
        newer: { eventId: targetId, contentVersion: 3, instanceId: 'event:newer', choiceId: 'leave_v3' },
      },
    });
    const versions: Readonly<Record<number, LoadedEventDef>> = { 1: v1, 2: v2, 3: v3 };
    const lookup = (eventId: string, version: number) => eventId === gated.id && version === 1
      ? gated
      : eventId === targetId ? versions[version] : undefined;

    expect(buildRunEventViewModel(state, EVENT_V3_NODE, gated, lookup)?.choices[0]?.lockReason)
      .toBe('needs "Turn the old key"');
  });

  it('distinguishes the exact persisted open, pending-picker, and terminal selection states', () => {
    const event = eventWithOutcome({ kind: 'cardChoice', filter: [{}], maxTier: 'gold' });
    const open = materializedEventV3(event, 55, OWNED);
    expect(viewFor(event, open).phase).toEqual({ kind: 'open' });

    const resolved = resolveEventChoiceV3(open, `event:${EVENT_V3_NODE.id}`, 'act', () => event);
    if (!resolved.ok || resolved.outcome.kind !== 'cardChoice') throw new Error('expected pending card offer');
    expect(viewFor(event, resolved.state).phase).toEqual({
      kind: 'pending', choiceId: 'act', offer: resolved.outcome.offer,
    });

    const selectedSkillId = resolved.outcome.offer.options[0]!.skillId;
    const settled = finalizeEventCardChoiceV3(
      resolved.state,
      `event:${EVENT_V3_NODE.id}`,
      'act',
      selectedSkillId,
      () => event,
    );
    if (!settled.ok) throw new Error('expected settled card offer');
    expect(viewFor(event, settled.state).phase).toEqual({
      kind: 'terminal', choiceId: 'act', selectedId: selectedSkillId,
    });
  });

  it('rejects a terminal resolution whose exact picker offer is still pending', () => {
    const event = eventWithOutcome({ kind: 'cardChoice', filter: [{}], maxTier: 'gold' });
    const state = materializedEventV3(event, 58, OWNED);
    const instance = state.eventInstances[EVENT_V3_NODE.id]!;

    expect(buildRunEventViewModel({
      ...state,
      eventResolutions: {
        [EVENT_V3_NODE.id]: {
          eventId: event.id,
          contentVersion: instance.contentVersion,
          instanceId: instance.instanceId,
          choiceId: 'act',
        },
      },
    }, EVENT_V3_NODE, event)).toBeUndefined();
  });

  it('rejects a terminal resolution whose exact selected offer is unavailable', () => {
    const event = eventWithOutcome({ kind: 'sellGem' });
    const state = materializedEventV3(event, 59, { gemInventory: [] });
    const instance = state.eventInstances[EVENT_V3_NODE.id]!;

    expect(buildRunEventViewModel({
      ...state,
      eventResolutions: {
        [EVENT_V3_NODE.id]: {
          eventId: event.id,
          contentVersion: instance.contentVersion,
          instanceId: instance.instanceId,
          choiceId: 'act',
        },
      },
    }, EVENT_V3_NODE, event)).toBeUndefined();
  });

  it.each(ALL_DIRECT_OUTCOMES.flatMap(([name, outcome]) => ([
    { name, outcome, status: 'pending' as const },
    { name, outcome, status: 'settled' as const },
  ])))('rejects a $status foreign offer on authored $name', ({ outcome, status }) => {
    const event = eventWithOutcome(outcome);
    const state = materializedEventV3(event, 610 + outcome.kind.length, OWNED);
    const instance = state.eventInstances[EVENT_V3_NODE.id]!;
    const materialization = state.eventMaterializations[instance.instanceId]!;
    const malformed = {
      ...state,
      eventMaterializations: {
        ...state.eventMaterializations,
        [instance.instanceId]: {
          ...materialization,
          deferredOffersByChoiceId: {
            ...materialization.deferredOffersByChoiceId,
            act: foreignOfferFor(outcome.kind, status),
          },
        },
      },
      eventResolutions: {
        [EVENT_V3_NODE.id]: {
          eventId: event.id,
          contentVersion: instance.contentVersion,
          instanceId: instance.instanceId,
          choiceId: 'act',
          ...(status === 'pending' ? { pending: true as const } : {}),
        },
      },
    };

    expect(buildRunEventViewModel(malformed, EVENT_V3_NODE, event)).toBeUndefined();
  });

  it.each(['pending', 'settled'] as const)('uses the persisted weighted branch to reject a %s foreign offer', (status) => {
    const event = eventV3Fixture({ choiceSet: { fixed: [
      eventV3Choice('act', { kind: 'weighted', branches: [
        { id: 'coins', label: 'Coins', weight: 1, outcome: { kind: 'grantGold', amount: 3 } },
        { id: 'picker', label: 'Picker', weight: 1, outcome: { kind: 'cardChoice', filter: [{}], maxTier: 'gold' } },
      ] }),
      eventV3Choice('leave', { kind: 'nothing' }),
    ] } });
    let state: RunState | undefined;
    for (let seed = 1; seed <= 24; seed += 1) {
      const candidate = materializedEventV3(event, seed, OWNED);
      const candidateRecord = candidate.eventMaterializations[`event:${EVENT_V3_NODE.id}`]!;
      if (candidateRecord.selectedWeightedBranchIds.act === 'picker') {
        state = candidate;
        break;
      }
    }
    if (state === undefined) throw new Error('expected a bounded picker-branch seed');
    const instance = state.eventInstances[EVENT_V3_NODE.id]!;
    const materialization = state.eventMaterializations[instance.instanceId]!;

    expect(buildRunEventViewModel({
      ...state,
      eventMaterializations: {
        ...state.eventMaterializations,
        [instance.instanceId]: {
          ...materialization,
          selectedWeightedBranchIds: { ...materialization.selectedWeightedBranchIds, act: 'coins' },
          deferredOffersByChoiceId: {
            ...materialization.deferredOffersByChoiceId,
            act: foreignOfferFor('grantGold', status),
          },
        },
      },
      eventResolutions: {
        [EVENT_V3_NODE.id]: {
          eventId: event.id,
          contentVersion: instance.contentVersion,
          instanceId: instance.instanceId,
          choiceId: 'act',
          ...(status === 'pending' ? { pending: true as const } : {}),
        },
      },
    }, EVENT_V3_NODE, event)).toBeUndefined();
  });

  it.each([
    ['grantCard', { kind: 'grantCard' }],
    ['grantGem', { kind: 'grantGem' }],
  ] as const)('rejects an impossible pending immediate %s offer as a picker phase', (_kind, rawOutcome) => {
    const event = eventWithOutcome(rawOutcome);
    const state = materializedEventV3(event, 61 + rawOutcome.kind.length, OWNED);
    const instance = state.eventInstances[EVENT_V3_NODE.id]!;

    expect(buildRunEventViewModel({
      ...state,
      eventResolutions: {
        [EVENT_V3_NODE.id]: {
          eventId: event.id,
          contentVersion: instance.contentVersion,
          instanceId: instance.instanceId,
          choiceId: 'act',
          pending: true,
        },
      },
    }, EVENT_V3_NODE, event)).toBeUndefined();
  });

  it.each([
    ['grantCard', { kind: 'grantCard' }],
    ['grantGem', { kind: 'grantGem' }],
    ['grantGold', { kind: 'grantGold', amount: 2 }],
    ['loseGold', { kind: 'loseGold', amount: 2 }],
    ['grantLevel', { kind: 'grantLevel' }],
    ['grantMapInfo', { kind: 'grantMapInfo', bandsAhead: 2 }],
    ['nothing', { kind: 'nothing' }],
  ] as const)('keeps an exact terminal immediate %s outcome valid', (_kind, outcome) => {
    const event = eventWithOutcome(outcome);
    const state = materializedEventV3(event, 60 + outcome.kind.length, { ...OWNED, gold: 5 });
    const resolved = resolveEventChoiceV3(state, `event:${EVENT_V3_NODE.id}`, 'act', () => event);
    if (!resolved.ok) throw new Error('expected an immediate terminal resolution');

    expect(buildRunEventViewModel(resolved.state, EVENT_V3_NODE, event)?.phase)
      .toEqual({ kind: 'terminal', choiceId: 'act' });
  });

  it('rejects a resolution whose version is not the committed instance version', () => {
    const event = eventWithOutcome({ kind: 'grantGold', amount: 2 });
    const state = materializedEventV3(event, 56, OWNED);
    const resolved = resolveEventChoiceV3(state, `event:${EVENT_V3_NODE.id}`, 'act', () => event);
    if (!resolved.ok) throw new Error('expected a settled event');
    const resolution = resolved.state.eventResolutions?.[EVENT_V3_NODE.id];
    if (resolution === undefined) throw new Error('expected a persisted resolution');

    expect(buildRunEventViewModel({
      ...resolved.state,
      eventResolutions: {
        ...resolved.state.eventResolutions,
        [EVENT_V3_NODE.id]: { ...resolution, contentVersion: resolution.contentVersion + 1 },
      },
    }, EVENT_V3_NODE, event)).toBeUndefined();
  });

  it('rejects a terminal resolution outside the exact committed choice set', () => {
    const event = eventWithOutcome({ kind: 'grantGold', amount: 2 });
    const state = materializedEventV3(event, 57, OWNED);
    const resolved = resolveEventChoiceV3(state, `event:${EVENT_V3_NODE.id}`, 'act', () => event);
    if (!resolved.ok) throw new Error('expected a settled event');
    const resolution = resolved.state.eventResolutions?.[EVENT_V3_NODE.id];
    if (resolution === undefined) throw new Error('expected a persisted resolution');

    expect(buildRunEventViewModel({
      ...resolved.state,
      eventResolutions: {
        ...resolved.state.eventResolutions,
        [EVENT_V3_NODE.id]: { ...resolution, choiceId: 'not-committed' },
      },
    }, EVENT_V3_NODE, event)).toBeUndefined();
  });

  it('keeps the hint union correlated with every offer kind', () => {
    const use = (hint: RunEventOutcomeHint): string => {
      if (hint.kind === 'gemChoice' && 'offer' in hint) return hint.offer.optionGemIds[0];
      if (hint.kind === 'cardChoice' && 'offer' in hint) return hint.offer.options[0].skillId;
      return hint.kind;
    };
    expect(use(viewFor(eventWithOutcome({ kind: 'gemChoice' })).choices[0]!.outcomeHint)).toBeTypeOf('string');
  });
});
