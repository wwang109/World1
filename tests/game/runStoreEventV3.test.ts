import { afterEach, describe, expect, it } from 'vitest';
import type { EventDirectOutcomeSpecV3 } from '../../src/data/eventContentV3';
import { gemBook } from '../../src/data/gems';
import { HERO_BOARD_SLOTS } from '../../src/data/heroes';
import { installDevRunFixture, getActiveRun } from '../../src/game/runStore';
import * as runStore from '../../src/game/runStore';
import { presentRunEventOutcome } from '../../src/game/ui/runEventScenePresenter';
import type { EventDeferredOfferV3 } from '../../src/run/eventV3Materialization';
import { EVENT_V3_NODE, eventV3Fixture, eventWithOutcome, materializedEventV3 } from '../fixtures/eventV3';

const FOREIGN_CARD_OPTIONS = [
  { skillId: 'sword_slash', tier: 'bronze' },
  { skillId: 'sword_slash', tier: 'silver' },
  { skillId: 'sword_slash', tier: 'gold' },
] as const;
const GEM_ID = Object.keys(gemBook)[0]!;
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
const NO_OFFER_OUTCOMES = [
  ['grantGold', { kind: 'grantGold', amount: 3 }],
  ['loseGold', { kind: 'loseGold', amount: 2 }],
  ['grantLevel', { kind: 'grantLevel' }],
  ['grantMapInfo', { kind: 'grantMapInfo', bandsAhead: 2 }],
  ['nothing', { kind: 'nothing' }],
] as const satisfies readonly (readonly [string, EventDirectOutcomeSpecV3])[];

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

afterEach(() => runStore.clearRun());

describe('game/runStore: committed schema-v3 event dispatch', () => {
  it('resolves, reopens, and finalizes from the current exact committed version without a second charge', () => {
    const event = eventV3Fixture({
      choiceSet: { fixed: [
        { id: 'premium', label: 'Choose a card', cost: 2, outcome: { kind: 'cardChoice', filter: [{}], maxTier: 'gold' } },
        { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
      ] },
    });
    const lookup = (eventId: string, version: number) => eventId === event.id && version === 1 ? event : undefined;
    installDevRunFixture(materializedEventV3(event, 77, { gold: 5 }));

    const view = runStore.currentRunEventViewModel(lookup);
    expect(view?.choices.map((choice) => choice.id)).toEqual(['premium', 'leave']);
    expect(view?.phase).toEqual({ kind: 'open' });

    const offered = runStore.resolveCurrentRunEventChoice('premium', lookup);
    expect(offered?.kind).toBe('cardChoice');
    const afterOffer = structuredClone(getActiveRun()!);
    expect(afterOffer.gold).toBe(3);
    expect(afterOffer.stats.eventsResolved).toBe(1);

    expect(runStore.resolveCurrentRunEventChoice('premium', lookup)).toBeUndefined();
    expect(getActiveRun()).toEqual(afterOffer);
    expect(runStore.reopenCurrentRunEventOffer(lookup)).toEqual(offered);
    expect(getActiveRun()).toEqual(afterOffer);

    if (offered?.kind !== 'cardChoice') throw new Error('expected card offer');
    const selectedSkillId = offered.offer.options[0]!.skillId;
    const alternateSkillId = offered.offer.options[1]!.skillId;
    const finalized = runStore.finalizeCurrentRunEventOffer({ kind: 'card', skillId: selectedSkillId }, lookup);
    expect(finalized?.kind).not.toBe('alreadySettled');
    const settled = structuredClone(getActiveRun()!);
    expect(runStore.currentRunEventViewModel(lookup)?.phase).toEqual({
      kind: 'terminal', choiceId: 'premium', selectedId: selectedSkillId,
    });

    expect(runStore.finalizeCurrentRunEventOffer({ kind: 'card', skillId: selectedSkillId }, lookup)).toEqual({ kind: 'alreadySettled' });
    expect(getActiveRun()).toEqual(settled);
    expect(runStore.finalizeCurrentRunEventOffer({ kind: 'card', skillId: alternateSkillId }, lookup)).toBeUndefined();
    expect(getActiveRun()).toEqual(settled);
  });

  it('makes every legacy event entry point an explicit no-op for a committed v3 transaction', () => {
    const event = eventV3Fixture();
    const lookup = (eventId: string, version: number) => eventId === event.id && version === 1 ? event : undefined;
    installDevRunFixture(materializedEventV3(event, 78, { gold: 5 }));
    expect(runStore.resolveCurrentRunEventChoice('take', lookup)?.kind).toBe('grantGold');
    const before = structuredClone(getActiveRun()!);

    expect(runStore.currentEventDef()).toBeUndefined();
    expect(runStore.currentEventResolution()).toBeUndefined();
    expect(runStore.resolveCurrentEventChoice(event.id, 'take')).toBeUndefined();
    expect(runStore.reopenCurrentEventPick()).toBeUndefined();
    expect(runStore.applyCurrentBonusDraftPick({ skillId: 'sword_slash', tier: 'bronze' })).toBeUndefined();
    expect(runStore.applyCurrentUpgradeCardPick('owned')).toBeUndefined();
    expect(runStore.applyCurrentGemChoicePick('not-a-real-gem')).toBeUndefined();
    expect(runStore.applyCurrentSellGemPick(0)).toBeUndefined();
    expect(runStore.applyCurrentMergeCardsPick('sword_slash')).toBeUndefined();
    expect(getActiveRun()).toEqual(before);
  });

  it('rejects a mismatched lookup without mutating the current committed instance', () => {
    const event = eventV3Fixture();
    installDevRunFixture(materializedEventV3(event, 79, { gold: 5 }));
    const before = structuredClone(getActiveRun()!);

    expect(runStore.resolveCurrentRunEventChoice('take', () => undefined)).toBeUndefined();
    expect(runStore.currentRunEventViewModel(() => undefined)).toBeUndefined();
    expect(getActiveRun()).toEqual(before);
    expect(getActiveRun()!.eventInstances[EVENT_V3_NODE.id]).toEqual(before.eventInstances[EVENT_V3_NODE.id]);
  });

  it('refuses a persisted v3 materialization whose choices no longer validate without mutation', () => {
    const event = eventV3Fixture();
    const lookup = (eventId: string, version: number) => (
      eventId === event.id && version === 1 ? event : undefined
    );
    const state = materializedEventV3(event, 791);
    const instance = state.eventInstances[EVENT_V3_NODE.id]!;
    const materialization = state.eventMaterializations[instance.instanceId]!;
    installDevRunFixture({
      ...state,
      eventMaterializations: {
        ...state.eventMaterializations,
        [instance.instanceId]: {
          ...materialization,
          choiceIds: ['missing-choice', 'leave'],
        },
      },
    });
    const beforeBytes = JSON.stringify(getActiveRun());

    let view: ReturnType<typeof runStore.currentRunEventViewModel>;
    expect(() => {
      view = runStore.currentRunEventViewModel(lookup);
    }).not.toThrow();
    expect(view!).toBeUndefined();
    expect(JSON.stringify(getActiveRun())).toBe(beforeBytes);
  });

  it.each(NO_OFFER_OUTCOMES.flatMap(([name, outcome]) => ([
    { name, outcome, status: 'pending' as const },
    { name, outcome, status: 'settled' as const },
  ])))('refuses initial resolution of authored $name with a $status foreign offer without mutation', ({ outcome, status }) => {
    const event = eventWithOutcome(outcome);
    const lookup = (eventId: string, version: number) => eventId === event.id && version === 1 ? event : undefined;
    const state = materializedEventV3(event, 760 + outcome.kind.length, { gold: 5 });
    const instance = state.eventInstances[EVENT_V3_NODE.id]!;
    const materialization = state.eventMaterializations[instance.instanceId]!;
    installDevRunFixture({
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
    });
    const beforeBytes = JSON.stringify(getActiveRun());

    expect(runStore.resolveCurrentRunEventChoice('act', lookup)).toBeUndefined();
    expect(JSON.stringify(getActiveRun())).toBe(beforeBytes);
  });

  it.each(['pending', 'settled'] as const)('uses the persisted weighted no-offer branch to refuse initial %s foreign resolution without mutation', (status) => {
    const event = eventV3Fixture({ choiceSet: { fixed: [
      {
        id: 'act', label: 'Act', cost: 0,
        outcome: { kind: 'weighted', branches: [
          { id: 'coins', label: 'Coins', weight: 1, outcome: { kind: 'grantGold', amount: 3 } },
          { id: 'picker', label: 'Picker', weight: 1, outcome: { kind: 'cardChoice', filter: [{}], maxTier: 'gold' } },
        ] },
      },
      { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
    ] } });
    const seeded = Array.from({ length: 24 }, (_, index) => materializedEventV3(event, index + 1, { gold: 5 }))
      .find((candidate) => candidate.eventMaterializations[`event:${EVENT_V3_NODE.id}`]!
        .selectedWeightedBranchIds.act === 'picker');
    if (seeded === undefined) throw new Error('expected a bounded picker-branch seed');
    const lookup = (eventId: string, version: number) => eventId === event.id && version === 1 ? event : undefined;
    const instance = seeded.eventInstances[EVENT_V3_NODE.id]!;
    const materialization = seeded.eventMaterializations[instance.instanceId]!;
    installDevRunFixture({
      ...seeded,
      eventMaterializations: {
        ...seeded.eventMaterializations,
        [instance.instanceId]: {
          ...materialization,
          selectedWeightedBranchIds: { ...materialization.selectedWeightedBranchIds, act: 'coins' },
          deferredOffersByChoiceId: {
            ...materialization.deferredOffersByChoiceId,
            act: foreignOfferFor('grantGold', status),
          },
        },
      },
    });
    const beforeBytes = JSON.stringify(getActiveRun());

    expect(runStore.resolveCurrentRunEventChoice('act', lookup)).toBeUndefined();
    expect(JSON.stringify(getActiveRun())).toBe(beforeBytes);
  });

  it('rejects a pending reopen whose resolution version does not match the committed instance', () => {
    const event = eventV3Fixture({ choiceSet: { fixed: [
      { id: 'act', label: 'Act', cost: 0, outcome: { kind: 'cardChoice', filter: [{}], maxTier: 'gold' } },
      { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
    ] } });
    const lookup = (eventId: string, version: number) => eventId === event.id && version === 1 ? event : undefined;
    installDevRunFixture(materializedEventV3(event, 80));
    const offered = runStore.resolveCurrentRunEventChoice('act', lookup);
    if (offered?.kind !== 'cardChoice') throw new Error('expected a pending card offer');
    const run = getActiveRun()!;
    const resolution = run.eventResolutions?.[EVENT_V3_NODE.id];
    if (resolution === undefined) throw new Error('expected a persisted resolution');
    installDevRunFixture({
      ...run,
      eventResolutions: {
        ...run.eventResolutions,
        [EVENT_V3_NODE.id]: { ...resolution, contentVersion: resolution.contentVersion + 1 },
      },
    });
    const before = structuredClone(getActiveRun()!);

    expect(runStore.reopenCurrentRunEventOffer(lookup)).toBeUndefined();
    expect(runStore.finalizeCurrentRunEventOffer({
      kind: 'card', skillId: offered.offer.options[0]!.skillId,
    }, lookup)).toBeUndefined();
    expect(getActiveRun()).toEqual(before);
  });

  it.each([
    ['grantCard', { kind: 'grantCard' }],
    ['grantGem', { kind: 'grantGem' }],
  ] as const)('treats an impossible pending immediate %s commitment as a no-op on reopen', (kind, rawOutcome) => {
    const event = eventV3Fixture({ choiceSet: { fixed: [
      { id: 'act', label: 'Act', cost: 0, outcome: rawOutcome },
      { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
    ] } });
    const lookup = (eventId: string, version: number) => eventId === event.id && version === 1 ? event : undefined;
    const state = materializedEventV3(event, 90 + kind.length);
    const instance = state.eventInstances[EVENT_V3_NODE.id]!;
    const offer = state.eventMaterializations[instance.instanceId]?.deferredOffersByChoiceId.act;
    expect(offer).toMatchObject({ kind, status: 'pending' });
    installDevRunFixture({
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
    });
    const before = structuredClone(getActiveRun()!);

    expect(runStore.reopenCurrentRunEventOffer(lookup)).toBeUndefined();
    expect(getActiveRun()).toEqual(before);
  });

  it.each(ALL_DIRECT_OUTCOMES.flatMap(([name, outcome]) => ([
    { name, outcome, status: 'pending' as const },
    { name, outcome, status: 'settled' as const },
  ])))('refuses a $status foreign transaction on authored $name without mutation', ({ outcome, status }) => {
    const event = eventV3Fixture({ choiceSet: { fixed: [
      { id: 'act', label: 'Act', cost: 0, outcome },
      { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
    ] } });
    const lookup = (eventId: string, version: number) => eventId === event.id && version === 1 ? event : undefined;
    const state = materializedEventV3(event, 700 + outcome.kind.length);
    const instance = state.eventInstances[EVENT_V3_NODE.id]!;
    const materialization = state.eventMaterializations[instance.instanceId]!;
    installDevRunFixture({
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
    });
    const beforeBytes = JSON.stringify(getActiveRun());

    const result = status === 'pending'
      ? runStore.reopenCurrentRunEventOffer(lookup)
      : outcome.kind === 'cardChoice'
        ? runStore.finalizeCurrentRunEventOffer({ kind: 'gem', gemId: GEM_ID }, lookup)
        : runStore.finalizeCurrentRunEventOffer({ kind: 'card', skillId: 'sword_slash' }, lookup);

    expect(result).toBeUndefined();
    expect(JSON.stringify(getActiveRun())).toBe(beforeBytes);
  });

  it.each(['pending', 'settled'] as const)('uses the persisted weighted branch to refuse a %s foreign transaction without mutation', (status) => {
    const event = eventV3Fixture({ choiceSet: { fixed: [
      {
        id: 'act', label: 'Act', cost: 0,
        outcome: { kind: 'weighted', branches: [
          { id: 'coins', label: 'Coins', weight: 1, outcome: { kind: 'grantGold', amount: 3 } },
          { id: 'picker', label: 'Picker', weight: 1, outcome: { kind: 'cardChoice', filter: [{}], maxTier: 'gold' } },
        ] },
      },
      { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
    ] } });
    const state = Array.from({ length: 24 }, (_, index) => materializedEventV3(event, index + 1))
      .find((candidate) => candidate.eventMaterializations[`event:${EVENT_V3_NODE.id}`]!
        .selectedWeightedBranchIds.act === 'picker');
    if (state === undefined) throw new Error('expected a bounded picker-branch seed');
    const lookup = (eventId: string, version: number) => eventId === event.id && version === 1 ? event : undefined;
    const instance = state.eventInstances[EVENT_V3_NODE.id]!;
    const materialization = state.eventMaterializations[instance.instanceId]!;
    installDevRunFixture({
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
    });
    const beforeBytes = JSON.stringify(getActiveRun());

    const result = status === 'pending'
      ? runStore.reopenCurrentRunEventOffer(lookup)
      : runStore.finalizeCurrentRunEventOffer({ kind: 'card', skillId: 'sword_slash' }, lookup);

    expect(result).toBeUndefined();
    expect(JSON.stringify(getActiveRun())).toBe(beforeBytes);
  });

  it('refuses an otherwise correlated pending offer from a mismatched materialization identity', () => {
    const event = eventV3Fixture({ choiceSet: { fixed: [
      { id: 'act', label: 'Act', cost: 0, outcome: { kind: 'cardChoice', filter: [{}], maxTier: 'gold' } },
      { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
    ] } });
    const lookup = (eventId: string, version: number) => eventId === event.id && version === 1 ? event : undefined;
    installDevRunFixture(materializedEventV3(event, 755));
    const offered = runStore.resolveCurrentRunEventChoice('act', lookup);
    if (offered?.kind !== 'cardChoice') throw new Error('expected a pending card offer');
    const state = getActiveRun()!;
    const instance = state.eventInstances[EVENT_V3_NODE.id]!;
    const materialization = state.eventMaterializations[instance.instanceId]!;
    installDevRunFixture({
      ...state,
      eventMaterializations: {
        ...state.eventMaterializations,
        [instance.instanceId]: { ...materialization, eventInstanceId: 'event:foreign' },
      },
    });
    const beforeBytes = JSON.stringify(getActiveRun());

    expect(runStore.reopenCurrentRunEventOffer(lookup)).toBeUndefined();
    expect(JSON.stringify(getActiveRun())).toBe(beforeBytes);
  });

  it.each([
    ['bonusDraft', { kind: 'bonusDraft' }],
    ['gemChoice', { kind: 'gemChoice' }],
    ['upgradeCard', { kind: 'upgradeCard' }],
    ['upgradeCardTargeted', {
      kind: 'upgradeCardTargeted',
      target: { filter: { where: 'any', match: { cardIds: ['sword_slash'] } } },
      fallback: { kind: 'grantGold', amount: 2 },
    }],
    ['sellGem', { kind: 'sellGem' }],
    ['mergeCards', { kind: 'mergeCards' }],
  ] as const)('finalizes the exact persisted %s offer through the current transaction', (kind, rawOutcome) => {
    const event = eventV3Fixture({ choiceSet: { fixed: [
      { id: 'act', label: 'Act', cost: 0, outcome: rawOutcome as EventDirectOutcomeSpecV3 },
      { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
    ] } });
    const lookup = (eventId: string, version: number) => eventId === event.id && version === 1 ? event : undefined;
    const gemId = Object.keys(gemBook)[0]!;
    const pieces = [0, 1, 2].map((slot) => ({
      slot,
      instanceId: `owned-${String(slot)}`,
      skillId: 'sword_slash',
      tier: 'bronze' as const,
    }));
    installDevRunFixture(materializedEventV3(event, 200 + kind.length, { pieces, gemInventory: [gemId] }));
    const offered = runStore.resolveCurrentRunEventChoice('act', lookup);
    if (offered === undefined) throw new Error(`${kind} did not resolve to an offer`);

    const selection = offered.kind === 'bonusDraft' && 'offer' in offered
      ? { kind: 'card' as const, skillId: offered.offer.options[0]!.skillId }
      : offered.kind === 'gemChoice'
        ? { kind: 'gem' as const, gemId: offered.offer.optionGemIds[0] }
        : (offered.kind === 'upgradeCard' || offered.kind === 'upgradeCardTargeted') && 'offer' in offered
          ? { kind: 'upgrade' as const, instanceId: offered.offer.optionInstanceIds[0]! }
          : offered.kind === 'sellGem' && 'offer' in offered
            ? { kind: 'sellGem' as const, pouchIndex: offered.offer.options[0]!.pouchIndex }
            : offered.kind === 'mergeCards'
              ? { kind: 'mergeCards' as const, skillId: offered.offer.candidates[0]!.skillId }
              : undefined;
    if (selection === undefined) throw new Error(`${kind} returned ${offered.kind}`);
    const finalized = runStore.finalizeCurrentRunEventOffer(selection, lookup);

    expect(finalized, kind).toBeDefined();
    expect(getActiveRun()!.eventResolutions?.[EVENT_V3_NODE.id]?.pending).toBeUndefined();
  });

  it('pauses a persisted merge picker after Deck Build moves its exact inputs and refuses silent fallback settlement', () => {
    const event = eventV3Fixture({ choiceSet: { fixed: [
      { id: 'act', label: 'Act', cost: 0, outcome: { kind: 'mergeCards' } },
      { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
    ] } });
    const lookup = (eventId: string, version: number) => eventId === event.id && version === 1 ? event : undefined;
    const pieces = [0, 1, 2].map((slot) => ({
      slot,
      instanceId: `owned-${String(slot)}`,
      skillId: 'sword_slash',
      tier: 'bronze' as const,
    }));
    installDevRunFixture(materializedEventV3(event, 991, { pieces, gold: 7 }));
    const offered = runStore.resolveCurrentRunEventChoice('act', lookup);
    if (offered?.kind !== 'mergeCards') throw new Error('expected a pending merge offer');

    // Exercise the same run-context seam Deck Build uses, after confirmation:
    // all instances still exist, but the persisted input indexes are stale.
    runStore.setCurrentRunPieces([pieces[1]!, pieces[0]!, pieces[2]!]);
    const beforeFinalize = structuredClone(getActiveRun()!);
    const reopened = runStore.reopenCurrentRunEventOffer(lookup);
    if (reopened?.kind !== 'mergeCards') throw new Error('expected the same reopened merge offer');
    const presented = presentRunEventOutcome(reopened, getActiveRun()!);
    if (presented.kind !== 'picker' || presented.picker.kind !== 'mergeCards') {
      throw new Error('expected a merge picker presentation');
    }

    expect(presented.picker.model.status).toEqual({ kind: 'paused', reason: 'inputs_changed' });
    expect(presented.picker.model.title).toContain('PAUSED');
    expect(presented.picker.model.pickCaption).toContain('RESTORE');
    expect(presented.picker.model.candidates).toEqual([]);
    expect(presented.picker.optionCount).toBe(0);
    expect(presented.picker.model.spent.map((entry) => entry.whereLabel)).toEqual([
      'MOVED FROM BOARD', 'MOVED FROM BOARD', 'BOARD 3',
    ]);

    const finalized = runStore.finalizeCurrentRunEventOffer({
      kind: 'mergeCards', skillId: offered.offer.candidates[0]!.skillId,
    }, lookup);
    expect(finalized).toBeUndefined();
    expect(getActiveRun()).toEqual(beforeFinalize);
    expect(getActiveRun()!.gold).toBe(7);
    expect(getActiveRun()!.eventResolutions?.[EVENT_V3_NODE.id]?.pending).toBe(true);

    runStore.setCurrentRunPieces(pieces);
    const restored = runStore.reopenCurrentRunEventOffer(lookup);
    if (restored?.kind !== 'mergeCards') throw new Error('expected the persisted merge after restoration');
    const restoredPresentation = presentRunEventOutcome(restored, getActiveRun()!);
    if (restoredPresentation.kind !== 'picker' || restoredPresentation.picker.kind !== 'mergeCards') {
      throw new Error('expected the restored merge picker presentation');
    }
    expect(restoredPresentation.picker.model.status).toEqual({ kind: 'ready' });
    expect(restoredPresentation.picker.model.spent.map((entry) => entry.whereLabel)).toEqual([
      'BOARD 1', 'BOARD 2', 'BOARD 3',
    ]);
    expect(restoredPresentation.picker.model.candidates.map((entry) => entry.skillId)).toEqual(
      offered.offer.candidates.map((entry) => entry.skillId),
    );

    const selected = offered.offer.candidates[0]!;
    expect(runStore.finalizeCurrentRunEventOffer({ kind: 'mergeCards', skillId: selected.skillId }, lookup)).toEqual({
      kind: 'grantCard', skillId: selected.skillId, tier: selected.tier,
    });
    expect(getActiveRun()!.gold).toBe(7);
    expect(getActiveRun()!.eventResolutions?.[EVENT_V3_NODE.id]?.pending).toBeUndefined();
    expect(getActiveRun()!.pieces).toEqual([]);
    expect(getActiveRun()!.bagSlots.some((card) => card?.skillId === selected.skillId && card.tier === selected.tier)).toBe(true);
  });

  it('pauses a persisted merge when the bag fills after confirmation instead of showing a fallback-prone choice', () => {
    const event = eventWithOutcome({ kind: 'mergeCards' });
    const lookup = (eventId: string, version: number) => eventId === event.id && version === 1 ? event : undefined;
    const pieces = [0, 1, 2].map((slot) => ({
      slot,
      instanceId: `input-${String(slot)}`,
      skillId: 'sword_slash',
      tier: 'bronze' as const,
    }));
    installDevRunFixture(materializedEventV3(event, 992, { pieces, gold: 9 }));
    const offered = runStore.resolveCurrentRunEventChoice('act', lookup);
    if (offered?.kind !== 'mergeCards') throw new Error('expected a pending merge offer');

    const fullBag = Array.from({ length: HERO_BOARD_SLOTS }, (_slot, index) => ({
      instanceId: `blocker-${String(index)}`,
      skillId: 'sword_slash',
      tier: 'bronze' as const,
    }));
    runStore.setCurrentRunBagSlots(fullBag);
    const beforeFinalize = structuredClone(getActiveRun()!);
    const reopened = runStore.reopenCurrentRunEventOffer(lookup);
    if (reopened?.kind !== 'mergeCards') throw new Error('expected the same reopened merge offer');
    const presented = presentRunEventOutcome(reopened, getActiveRun()!);
    if (presented.kind !== 'picker' || presented.picker.kind !== 'mergeCards') {
      throw new Error('expected a merge picker presentation');
    }

    expect(presented.picker.model.status).toEqual({ kind: 'paused', reason: 'output_blocked' });
    expect(presented.picker.model.pickCaption).toContain('RESTORE BAG SPACE');
    expect(presented.picker.model.candidates).toEqual([]);
    expect(runStore.finalizeCurrentRunEventOffer({
      kind: 'mergeCards', skillId: offered.offer.candidates[0]!.skillId,
    }, lookup)).toBeUndefined();
    expect(getActiveRun()).toEqual(beforeFinalize);
    expect(getActiveRun()!.gold).toBe(9);
    expect(getActiveRun()!.eventResolutions?.[EVENT_V3_NODE.id]?.pending).toBe(true);
  });

  it.each([
    ['grantCard', { kind: 'grantCard' }],
    ['grantGem', { kind: 'grantGem' }],
    ['grantGold', { kind: 'grantGold', amount: 3 }],
    ['loseGold', { kind: 'loseGold', amount: 2 }],
    ['grantLevel', { kind: 'grantLevel' }],
    ['grantMapInfo', { kind: 'grantMapInfo', bandsAhead: 2 }],
    ['nothing', { kind: 'nothing' }],
  ] as const)('settles immediate %s through the v3 resolver without opening a picker', (kind, rawOutcome) => {
    const event = eventV3Fixture({ choiceSet: { fixed: [
      { id: 'act', label: 'Act', cost: 0, outcome: rawOutcome as EventDirectOutcomeSpecV3 },
      { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
    ] } });
    const lookup = (eventId: string, version: number) => eventId === event.id && version === 1 ? event : undefined;
    installDevRunFixture(materializedEventV3(event, 300 + kind.length, { gold: 5 }));

    const outcome = runStore.resolveCurrentRunEventChoice('act', lookup);

    expect(outcome?.kind, kind).toBe(kind);
    expect(getActiveRun()!.eventResolutions?.[EVENT_V3_NODE.id]?.pending).toBeUndefined();
    expect(runStore.reopenCurrentRunEventOffer(lookup)).toBeUndefined();
  });
});
