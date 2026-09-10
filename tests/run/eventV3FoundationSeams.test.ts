import { describe, expect, it } from 'vitest';
import type { EventChoiceV3, LoadedEventDefV3 } from '../../src/data/eventContentV3';
import { gemBook } from '../../src/data/gems';
import { hashSeed } from '../../src/engine/rng';
import {
  firstEligibleConditionalEvent,
  ordinaryEventIdsForCatalog,
  resolveEventOutcomeSpec,
  rollEventForNodeFromCandidatesV3,
  rollEventForNode,
} from '../../src/run/events';
import { recordEventInstance } from '../../src/run/eventInstances';
import { applyGrantMapInfo } from '../../src/run/eventMapInfo';
import {
  finalizeEventCardChoiceV3,
  finalizeBonusDraftV3,
  finalizeGemChoiceV3,
  finalizeMergeCardsV3,
  finalizeSellGemV3,
  finalizeTargetedUpgradeV3,
  finalizeUpgradeCardV3,
  materializeReachedEventV3,
  reopenEventChoiceV3,
  resolveEventChoiceV3,
  type EventOutcomeV3,
} from '../../src/run/eventsV3';
import { createRun, type RunNode, type RunState } from '../../src/run/runState';
import { scheduleEventCallbackV3 } from '../../src/run/eventCallbacks';
import { previewEventChoicesV3, type EventDeferredOfferV3 } from '../../src/run/eventV3Materialization';

function assertDeferredOutcomeNarrowing(outcome: EventOutcomeV3): void {
  if (outcome.kind === 'bonusDraft') {
    const offer: Extract<EventDeferredOfferV3, { kind: 'bonusDraft'; status: 'pending' }> = outcome.offer;
    void offer;
  } else if (outcome.kind === 'gemChoice') {
    const offer: Extract<EventDeferredOfferV3, { kind: 'gemChoice'; status: 'pending' }> = outcome.offer;
    void offer;
  } else if (outcome.kind === 'upgradeCard') {
    const offer: Extract<EventDeferredOfferV3, { kind: 'upgradeCard'; status: 'pending' }> = outcome.offer;
    void offer;
  } else if (outcome.kind === 'sellGem') {
    const offer: Extract<EventDeferredOfferV3, { kind: 'sellGem'; status: 'pending' }> = outcome.offer;
    void offer;
  } else if (outcome.kind === 'mergeCards') {
    const offer: Extract<EventDeferredOfferV3, { kind: 'mergeCards'; status: 'pending' }> = outcome.offer;
    void offer;
  }
}
void assertDeferredOutcomeNarrowing;

if (false) {
  // @ts-expect-error deferred outcome kinds must correlate with their exact offer payload
  const impossible: EventOutcomeV3 = { kind: 'bonusDraft', offer: { kind: 'mergeCards', status: 'unavailable' } };
  void impossible;
}

const NODE: RunNode = {
  id: 'event-d4', depth: 4, wave: 2, kind: 'event', eventSeed: 99,
  eventTheme: 'omen', biomeId: 'arrowfell',
};

function runAtNode(seed = 41, overrides: Partial<RunState> = {}): RunState {
  const base = createRun(seed);
  return {
    ...base,
    status: 'active',
    currentNodeId: NODE.id,
    map: { ...base.map, depths: [[], [NODE]] },
    ...overrides,
  };
}

function choice(id: string, outcome: EventChoiceV3['outcome'], cost = 0): EventChoiceV3 {
  return { id, label: id, cost, outcome };
}

function eventV3(overrides: Partial<LoadedEventDefV3> = {}): LoadedEventDefV3 {
  return {
    id: 'v3_probe', title: 'V3 Probe', body: 'Dormant test content.', theme: 'omen', rarity: 'rare',
    story: { storyId: 'v3_probe', stage: 'setup', role: 'setup' },
    eligibility: { fact: 'node.depth', args: { op: 'gte', value: 1 } },
    delivery: { kind: 'ambient' }, visibility: 'hidden_until_eligible', priority: 300,
    once: 'run', cooldownNodes: 0,
    choiceSet: {
      fixed: [choice('leave', { kind: 'nothing' })],
      pool: { draw: 1, entries: [
        choice('coin', { kind: 'weighted', branches: [
          { id: 'gold', label: 'Gold (67%)', weight: 2, outcome: { kind: 'grantGold', amount: 2 } },
          { id: 'dust', label: 'Dust (33%)', weight: 1, outcome: { kind: 'nothing' } },
        ] }),
        choice('premium', { kind: 'cardChoice', filter: [{}], maxTier: 'gold' }),
      ] },
    },
    contentSchemaVersion: 3,
    ...overrides,
  } as LoadedEventDefV3;
}

function committed(seed: number, event: LoadedEventDefV3, overrides: Partial<RunState> = {}): RunState {
  return recordEventInstance(runAtNode(seed, overrides), NODE.id, {
    eventId: event.id, contentVersion: 1, instanceId: `event:${NODE.id}`, drawnDepth: NODE.depth,
  });
}

function withOffer(
  state: RunState,
  choiceId: string,
  offer: EventDeferredOfferV3,
): RunState {
  const instanceId = `event:${NODE.id}`;
  const materialization = state.eventMaterializations[instanceId]!;
  return {
    ...state,
    eventMaterializations: {
      ...state.eventMaterializations,
      [instanceId]: {
        ...materialization,
        deferredOffersByChoiceId: { ...materialization.deferredOffersByChoiceId, [choiceId]: offer },
      },
    },
  };
}

describe('v3 selection and materialization seams', () => {
  it('uses priority and an isolated seeded tie only for eligible v3 conditional events', () => {
    const candidates = [
      eventV3({ id: 'alpha', rarity: 'common' }),
      eventV3({ id: 'beta', rarity: 'common' }),
      eventV3({ id: 'lower', rarity: 'common', priority: 299 }),
    ];
    const selected = new Set<number>();
    for (let seed = 1; seed <= 24; seed += 1) {
      const state = runAtNode(seed);
      const result = firstEligibleConditionalEvent(state, NODE, candidates);
      expect(result?.id).toMatch(/^(alpha|beta)$/);
      selected.add(result?.id === 'alpha' ? 0 : 1);
    }
    expect(selected).toEqual(new Set([0, 1]));
  });

  it('rolls only the reached node through the shared v3 candidate selector and persists replay bytes', () => {
    const candidates = [
      eventV3({ id: 'alpha', rarity: 'common' }),
      eventV3({ id: 'beta', rarity: 'common' }),
    ];
    const first = rollEventForNodeFromCandidatesV3(runAtNode(1), NODE, candidates, () => 1);
    const replay = rollEventForNodeFromCandidatesV3(structuredClone(first.state), NODE, candidates, () => 1);
    expect(replay.event.id).toBe(first.event.id);
    expect(replay.state.eventMaterializations).toEqual(first.state.eventMaterializations);
    expect(Object.keys(first.state.eventInstances)).toEqual([NODE.id]);

    const ids = new Set<string>();
    for (let seed = 1; seed <= 24; seed += 1) {
      ids.add(rollEventForNodeFromCandidatesV3(runAtNode(seed), NODE, candidates, () => 1).event.id);
    }
    expect(ids).toEqual(new Set(['alpha', 'beta']));
  });

  it('evaluates only the exact seeded pool choice that materialization will display', () => {
    const gatedPool = eventV3({
      id: 'pool_gate', rarity: 'common', priority: 900,
      choiceSet: { fixed: [choice('leave', { kind: 'nothing' })], pool: { draw: 1, entries: [
        choice('free', { kind: 'grantGold', amount: 1 }),
        choice('locked', { kind: 'grantGold', amount: 99 }, 99),
      ] } },
    });
    const lower = eventV3({
      id: 'lower', rarity: 'common', priority: 100,
      choiceSet: { fixed: [choice('fallback', { kind: 'grantGold', amount: 1 }), choice('leave', { kind: 'nothing' })] },
    });
    let lockedSeed: number | undefined;
    let freeSeed: number | undefined;
    for (let seed = 1; seed <= 100; seed += 1) {
      const ids = previewEventChoicesV3(seed, `event:${NODE.id}`, gatedPool).map((entry) => entry.id);
      if (ids.includes('locked')) lockedSeed ??= seed;
      if (ids.includes('free')) freeSeed ??= seed;
    }
    expect(lockedSeed).toBeTypeOf('number');
    expect(freeSeed).toBeTypeOf('number');
    if (lockedSeed === undefined || freeSeed === undefined) throw new Error('bounded pool seeds did not vary');

    const lockedRun = runAtNode(lockedSeed);
    expect(firstEligibleConditionalEvent(lockedRun, NODE, [gatedPool, lower])?.id).toBe('lower');
    const lockedRoll = rollEventForNodeFromCandidatesV3(lockedRun, NODE, [gatedPool, lower], () => 1);
    expect(lockedRoll.event.id).toBe('lower');

    const freeRun = runAtNode(freeSeed);
    const previewIds = previewEventChoicesV3(freeRun.map.seed, `event:${NODE.id}`, gatedPool).map((entry) => entry.id);
    expect(firstEligibleConditionalEvent(freeRun, NODE, [gatedPool, lower])?.id).toBe('pool_gate');
    const freeRoll = rollEventForNodeFromCandidatesV3(freeRun, NODE, [gatedPool, lower], () => 1);
    expect(freeRoll.event.id).toBe('pool_gate');
    expect(freeRoll.state.eventMaterializations[`event:${NODE.id}`]?.choiceIds).toEqual(previewIds);
  });

  it('persists exact authored choice order, pool draw, weighted branch, offers, and bindings before replay', () => {
    const event = eventV3();
    let selected: ReturnType<typeof materializeReachedEventV3> | undefined;
    for (let seed = 1; seed <= 100; seed += 1) {
      const next = materializeReachedEventV3(committed(seed, event), NODE, event);
      if (next.ok && next.materialization.choiceIds.includes('premium')) { selected = next; break; }
    }
    expect(selected?.ok).toBe(true);
    if (!selected?.ok) throw new Error('bounded seeds never selected the offer choice');
    expect(selected.materialization.choiceIds).toEqual(['leave', 'premium']);
    expect(selected.materialization.deferredOffersByChoiceId.premium).toEqual(expect.objectContaining({
      kind: 'cardChoice', status: 'pending', options: expect.any(Array),
    }));
    expect(selected.materialization.deferredOffersByChoiceId.premium).not.toHaveProperty('cards');

    const bytes = JSON.stringify(selected.materialization);
    const reloaded = structuredClone(selected.state);
    const replay = materializeReachedEventV3(reloaded, NODE, event);
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error('persisted materialization did not replay');
    expect(JSON.stringify(replay.materialization)).toBe(bytes);
    expect(replay.state).toBe(reloaded);
  });

  it('keeps materialization hash domains from changing map or ordinary event bags', () => {
    const event = eventV3();
    const input = committed(71, event, {
      eventBag: ['wandering_tutor'], eventBagRefills: 3,
      eventThemeBags: { omen: ['fortune_teller'] }, eventThemeBagRefills: { omen: 2 },
    });
    const mapBytes = JSON.stringify(input.map);
    const bagBytes = JSON.stringify([input.eventBag, input.eventThemeBags, input.eventBagRefills, input.eventThemeBagRefills]);
    const result = materializeReachedEventV3(input, NODE, event);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('materialization failed');
    expect(JSON.stringify(result.state.map)).toBe(mapBytes);
    expect(JSON.stringify([result.state.eventBag, result.state.eventThemeBags, result.state.eventBagRefills, result.state.eventThemeBagRefills])).toBe(bagBytes);
  });

  it.each([
    ['grantCard', { kind: 'grantCard' }],
    ['grantGem', { kind: 'grantGem' }],
    ['bonusDraft', { kind: 'bonusDraft' }],
    ['gemChoice', { kind: 'gemChoice' }],
    ['upgradeCard', { kind: 'upgradeCard' }],
    ['sellGem', { kind: 'sellGem' }],
    ['mergeCards', { kind: 'mergeCards' }],
  ] as const)('persists the exact %s legacy-outcome commitment without applying it', (kind, outcome) => {
    const event = eventV3({ choiceSet: { fixed: [choice('act', outcome), choice('leave', { kind: 'nothing' })] } });
    const gemId = Object.keys(gemBook)[0]!;
    const cards = [0, 1, 2].map((slot) => ({
      slot, instanceId: `merge-${String(slot)}`, skillId: 'sword_slash', tier: 'bronze' as const,
    }));
    const input = committed(100 + kind.length, event, {
      pieces: cards,
      gemInventory: [gemId],
    });
    const before = JSON.stringify({ pieces: input.pieces, bagSlots: input.bagSlots, gems: input.gemInventory, gold: input.gold });
    const result = materializeReachedEventV3(input, NODE, event);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`${kind} materialization failed`);
    expect(result.materialization.deferredOffersByChoiceId.act).toEqual(expect.objectContaining({ kind, status: 'pending' }));
    expect(JSON.stringify({ pieces: result.state.pieces, bagSlots: result.state.bagSlots, gems: result.state.gemInventory, gold: result.state.gold })).toBe(before);
    const replay = materializeReachedEventV3(structuredClone(result.state), NODE, event);
    expect(replay.ok && replay.materialization.deferredOffersByChoiceId.act).toEqual(result.materialization.deferredOffersByChoiceId.act);
  });

  it('finalizes every legacy deferred kind from its persisted offer without rebuilding it', () => {
    const [gemId, secondGemId] = Object.keys(gemBook);
    if (gemId === undefined || secondGemId === undefined) throw new Error('expected two known gems');
    const specs = [
      ['bonusDraft', { kind: 'bonusDraft' }],
      ['gemChoice', { kind: 'gemChoice' }],
      ['upgradeCard', { kind: 'upgradeCard' }],
      ['sellGem', { kind: 'sellGem' }],
      ['mergeCards', { kind: 'mergeCards' }],
    ] as const;
    for (const [kind, outcome] of specs) {
      const event = eventV3({ choiceSet: { fixed: [choice('act', outcome), choice('leave', { kind: 'nothing' })] } });
      const materialized = materializeReachedEventV3(committed(400 + kind.length, event, {
        pieces: [0, 1, 2].map((slot) => ({ slot, instanceId: `input-${String(slot)}`, skillId: 'sword_slash', tier: 'bronze' as const })),
        gemInventory: [gemId, secondGemId],
      }), NODE, event);
      if (!materialized.ok) throw new Error(`${kind} materialization failed`);
      const resolved = resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'act', () => event);
      if (!resolved.ok) throw new Error(`${kind} resolution failed`);
      const offer = reopenEventChoiceV3(resolved.state, `event:${NODE.id}`, () => event)?.offer;
      if (offer === undefined) throw new Error(`${kind} offer did not reopen`);
      const selections = offer.kind === 'bonusDraft'
        ? offer.options.map((option) => option.skillId)
        : offer.kind === 'gemChoice'
          ? [...offer.optionGemIds]
          : offer.kind === 'upgradeCard'
            ? [...offer.optionInstanceIds]
            : offer.kind === 'sellGem' && offer.status !== 'unavailable'
              ? offer.options.map((option) => String(option.pouchIndex))
              : offer.kind === 'mergeCards' && offer.status !== 'unavailable'
                ? offer.candidates.map((candidate) => candidate.skillId)
                : [];
      expect(selections.length).toBeGreaterThanOrEqual(2);
      const finalize = (candidate: RunState, candidateInstanceId: string, candidateChoiceId: string, selectedId: string) => (
        kind === 'bonusDraft'
          ? finalizeBonusDraftV3(candidate, candidateInstanceId, candidateChoiceId, selectedId, () => event)
          : kind === 'gemChoice'
            ? finalizeGemChoiceV3(candidate, candidateInstanceId, candidateChoiceId, selectedId, () => event)
            : kind === 'upgradeCard'
              ? finalizeUpgradeCardV3(candidate, candidateInstanceId, candidateChoiceId, selectedId, () => event)
              : kind === 'sellGem'
                ? finalizeSellGemV3(candidate, candidateInstanceId, candidateChoiceId, Number(selectedId), () => event)
                : finalizeMergeCardsV3(candidate, candidateInstanceId, candidateChoiceId, selectedId, () => event)
      );
      const selectedId = selections[0]!;
      expect(finalize(resolved.state, 'missing-instance', 'act', selectedId)).toEqual({
        ok: false, state: resolved.state, reason: 'choice',
      });
      expect(finalize(resolved.state, `event:${NODE.id}`, 'leave', selectedId)).toEqual({
        ok: false, state: resolved.state, reason: 'choice',
      });
      const wrongKindState = withOffer(resolved.state, 'act', {
        kind: 'grantCard', status: 'pending', card: { skillId: 'sword_slash', tier: 'bronze' },
      });
      expect(finalize(wrongKindState, `event:${NODE.id}`, 'act', selectedId)).toEqual({
        ok: false, state: wrongKindState, reason: 'choice',
      });

      const finalized = finalize(resolved.state, `event:${NODE.id}`, 'act', selectedId);
      expect(finalized?.ok).toBe(true);
      if (!finalized?.ok) throw new Error(`${kind} finalization failed`);
      expect(finalized?.state.eventResolutions?.[NODE.id]?.pending).toBeUndefined();
      expect(finalized?.state.eventMaterializations[`event:${NODE.id}`]?.deferredOffersByChoiceId.act?.status).toBe('settled');
      expect(finalize(finalized.state, `event:${NODE.id}`, 'act', selectedId)).toEqual({
        ok: true, state: finalized.state, outcome: { kind: 'alreadySettled' },
      });
      expect(finalize(finalized.state, `event:${NODE.id}`, 'act', selections[1]!)).toEqual({
        ok: false, state: finalized.state, reason: 'offer',
      });
    }
  });

  it('refuses an upgradeCard rung with an empty persisted offer instead of auto-settling a fallback coin (2026-09-06)', () => {
    // UPDATED 2026-09-06: this used to assert the exact bug closed this pass —
    // an empty `optionInstanceIds` (nothing owned is eligible) used to resolve
    // straight through to the `CARD_FALLBACK_GOLD` consolation, charging any
    // authored cost for a rung that was NEVER going to upgrade anything. The
    // live instance is `gilded_detour`'s 8-gold `buy_gold_upgrade`
    // (`src/data/content/events.v3.json`). `resolveEventChoiceV3` now refuses
    // (`reason: 'gate'`) from the offer already persisted at materialization —
    // no re-roll, no new state.
    const event = eventV3({ choiceSet: { fixed: [
      choice('upgrade', { kind: 'upgradeCard' }),
      choice('leave', { kind: 'nothing' }),
    ] } });
    const materialized = materializeReachedEventV3(committed(488, event), NODE, event);
    if (!materialized.ok) throw new Error('empty upgrade materialization failed');
    expect(materialized.materialization.deferredOffersByChoiceId.upgrade).toEqual(
      expect.objectContaining({ kind: 'upgradeCard', status: 'pending', optionInstanceIds: [] }),
    );
    expect(resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'upgrade', () => event)).toEqual({
      ok: false, state: materialized.state, reason: 'gate',
    });
    // The rung being dark does not delete the event: the safe exit resolves fine.
    expect(resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'leave', () => event).ok).toBe(true);
  });

  it('requires the instance commit before binding/materialization and consumes no ready fact on failure', () => {
    const event = eventV3({ bindings: [{ as: 'enemy_id', source: 'revenge.enemyId' }] });
    const input = runAtNode(7, {
      revengeFactLedger: [{ battleId: 'battle:1', enemyId: 'rat', achievedDepth: 2, status: 'ready' }],
    });
    const failed = materializeReachedEventV3(input, NODE, event);
    expect(failed).toEqual({ ok: false, state: input, reason: 'instance' });
    expect(input.revengeFactLedger[0]!.status).toBe('ready');
    const success = materializeReachedEventV3(committed(7, event, {
      revengeFactLedger: input.revengeFactLedger,
    }), NODE, event);
    expect(success.ok).toBe(true);
    if (!success.ok) throw new Error('committed materialization failed');
    expect(success.state.revengeFactLedger[0]!.status).toBe('reserved');
    expect(success.materialization.boundSubjects.enemy_id).toBe('rat');
  });

  it('rejects an event object paired with the wrong committed content version without changing state', () => {
    const event = eventV3();
    const input = committed(8, event);
    expect(materializeReachedEventV3(input, NODE, event, 2)).toEqual({
      ok: false, state: input, reason: 'instance',
    });
  });

  it('forwards one widened lookup through due classification, delivery, and v3 materialization', () => {
    const callbackTarget = eventV3({
      id: 'callback_probe', rarity: 'secret', delivery: { kind: 'queued_callback' },
      acceptsBindings: [], eligibility: { fact: 'callback.queued', args: { callbackId: 'callback_probe' } },
      choiceSet: { fixed: [choice('take', { kind: 'grantGold', amount: 1 }), choice('leave', { kind: 'nothing' })] },
    });
    const sourceState = runAtNode(18);
    const scheduled = scheduleEventCallbackV3(sourceState, {
      callbackId: 'callback_probe', eventId: callbackTarget.id, contentVersion: 1,
      minDepthDelay: 0, destinationThemes: ['omen'], priority: 700, bind: [],
      expiry: { expiresAfterNodes: 4, fallback: 'discard' },
    }, { eventInstanceId: 'event:source', choiceId: 'accept', nodeDepth: 1, ordinal: 0 }, {}, () => callbackTarget);
    expect(scheduled.ok).toBe(true);
    if (!scheduled.ok) throw new Error('schedule failed');
    let lookups = 0;
    const rolled = rollEventForNode(scheduled.state, NODE, (eventId, version) => {
      lookups += 1;
      return eventId === callbackTarget.id && version === 1 ? callbackTarget : undefined;
    });
    expect(lookups).toBeGreaterThanOrEqual(2);
    expect(rolled.event.id).toBe(callbackTarget.id);
    expect(rolled.state.eventMaterializations[`event:${NODE.id}`]?.choiceIds).toEqual(['take', 'leave']);
    expect(rolled.state.eventCallbackQueue).toEqual([]);
  });

  it('honors v3 biome, recursive eligibility, once, cooldown, and isolated rarity before priority ties', () => {
    const eligible = eventV3({ id: 'eligible', rarity: 'common', biomeIds: ['arrowfell'], cooldownNodes: 1,
      eligibility: { all: [
        { fact: 'wallet.current', args: { op: 'gte', value: 2 } },
        { not: { fact: 'story.flag', args: { key: 'oath_mercy', op: 'eq', value: true } } },
      ] },
    });
    const wrongBiome = eventV3({ id: 'wrong-biome', rarity: 'common', priority: 999, biomeIds: ['frostmarch'] });
    expect(firstEligibleConditionalEvent(runAtNode(1, { gold: 2 }), NODE, [wrongBiome, eligible])?.id).toBe('eligible');
    expect(firstEligibleConditionalEvent(runAtNode(1, { gold: 1 }), NODE, [eligible])).toBeUndefined();
    expect(firstEligibleConditionalEvent(runAtNode(1, { gold: 2, eventInstances: {
      old: { eventId: eligible.id, contentVersion: 1, instanceId: 'event:old', drawnDepth: 3 },
    } }), NODE, [eligible])).toBeUndefined();

    const rare = eventV3({ id: 'rare-probe', rarity: 'rare' });
    const fixedNode = { ...NODE, eventSeed: 12345 };
    const first = firstEligibleConditionalEvent(runAtNode(2), fixedNode, [rare])?.id;
    const second = firstEligibleConditionalEvent(runAtNode(999), fixedNode, [rare])?.id;
    expect(second).toBe(first);
  });

  it('keeps conditional and Secret v3 definitions out of ordinary bags', () => {
    const ordinaryLegacy = {
      id: 'legacy', title: 'legacy', body: 'legacy', theme: 'omen' as const,
      choices: [choice('take', { kind: 'grantGold', amount: 1 }) as never],
    };
    const conditional = eventV3({ id: 'conditional', rarity: 'common', visibility: 'visible', once: 'node',
      eligibility: { fact: 'wallet.current', args: { op: 'gte', value: 1 } },
    });
    const secret = eventV3({ id: 'secret', rarity: 'secret' });
    expect(ordinaryEventIdsForCatalog(
      { legacy: ordinaryLegacy, conditional, secret }, ['legacy', 'conditional', 'secret'], 'omen',
    )).toEqual(['legacy']);
  });
});

describe('v3 atomic resolution seams', () => {
  it('fails an unaffordable choice atomically without a resolution or partial mutation', () => {
    const event = eventV3({ rarity: 'common', choiceSet: { fixed: [
      choice('pay', { kind: 'grantGold', amount: 9 }, 2),
      choice('leave', { kind: 'nothing' }),
    ] } });
    const materialized = materializeReachedEventV3(committed(9, event), NODE, event);
    if (!materialized.ok) throw new Error('materialization failed');
    const result = resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'pay', () => event);
    expect(result).toEqual({ ok: false, state: materialized.state, reason: 'cost' });
    expect(result.state).toBe(materialized.state);
  });

  it('resolves only the persisted weighted branch and records one resolution/stats update', () => {
    const event = eventV3({ choiceSet: { fixed: [
      choice('fate', { kind: 'weighted', branches: [
        { id: 'gold', label: 'Gold (50%)', weight: 1, outcome: { kind: 'grantGold', amount: 3 } },
        { id: 'dust', label: 'Dust (50%)', weight: 1, outcome: { kind: 'nothing' } },
      ] }),
      choice('leave', { kind: 'nothing' }),
    ] } });
    const materialized = materializeReachedEventV3(committed(12, event), NODE, event);
    if (!materialized.ok) throw new Error('materialization failed');
    const branch = materialized.materialization.selectedWeightedBranchIds.fate;
    const result = resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'fate', () => event);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('resolution failed');
    expect(result.outcome.kind).toBe(branch === 'gold' ? 'grantGold' : 'nothing');
    expect(result.state.stats.eventsResolved).toBe(materialized.state.stats.eventsResolved + 1);
    expect(result.state.eventResolutions?.[NODE.id]?.choiceId).toBe('fate');
  });

  it('reopens the exact persisted card offer and finalizes it once without DraftCard', () => {
    const event = eventV3({ choiceSet: { fixed: [
      choice('premium', { kind: 'cardChoice', filter: [{}], maxTier: 'gold' }),
      choice('leave', { kind: 'nothing' }),
    ] } });
    const materialized = materializeReachedEventV3(committed(33, event), NODE, event);
    if (!materialized.ok) throw new Error('materialization failed');
    const resolved = resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'premium', () => event);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error('resolution failed');
    const reopened = reopenEventChoiceV3(resolved.state, `event:${NODE.id}`, () => event);
    expect(reopened?.offer).toEqual(materialized.materialization.deferredOffersByChoiceId.premium);
    if (reopened?.offer.kind !== 'cardChoice') throw new Error('card offer not reopened');
    const selectedSkillId = reopened.offer.options[0]!.skillId;
    const alternateSkillId = reopened.offer.options.find((option) => option.skillId !== selectedSkillId)?.skillId;
    if (alternateSkillId === undefined) throw new Error('card offer needs two distinct replay selections');
    expect(finalizeEventCardChoiceV3(resolved.state, 'missing-instance', 'premium', selectedSkillId, () => event)).toEqual({
      ok: false, state: resolved.state, reason: 'choice',
    });
    expect(finalizeEventCardChoiceV3(resolved.state, `event:${NODE.id}`, 'leave', selectedSkillId, () => event)).toEqual({
      ok: false, state: resolved.state, reason: 'choice',
    });
    const wrongKindState = withOffer(resolved.state, 'premium', {
      kind: 'grantCard', status: 'pending', card: { skillId: selectedSkillId, tier: 'bronze' },
    });
    expect(finalizeEventCardChoiceV3(wrongKindState, `event:${NODE.id}`, 'premium', selectedSkillId, () => event)).toEqual({
      ok: false, state: wrongKindState, reason: 'choice',
    });
    const finalized = finalizeEventCardChoiceV3(resolved.state, `event:${NODE.id}`, 'premium', selectedSkillId, () => event);
    expect(finalized.ok).toBe(true);
    if (!finalized.ok) throw new Error('finalization failed');
    expect(finalized.state.eventResolutions?.[NODE.id]?.pending).toBeUndefined();
    expect(finalizeEventCardChoiceV3(finalized.state, `event:${NODE.id}`, 'premium', selectedSkillId, () => event)).toEqual({
      ok: true, state: finalized.state, outcome: { kind: 'alreadySettled' },
    });
    expect(finalizeEventCardChoiceV3(finalized.state, `event:${NODE.id}`, 'premium', alternateSkillId, () => event)).toEqual({
      ok: false, state: finalized.state, reason: 'offer',
    });
  });

  it('keeps the v2 outcome seam on its existing resolver path', () => {
    const input = runAtNode(5);
    const result = resolveEventOutcomeSpec(input, NODE, 'leave', { kind: 'nothing' });
    expect(result).toEqual({ state: input, outcome: { kind: 'nothing' } });
    expect(hashSeed(input.map.seed, 'event-v3-weighted', 'unused', 'leave')).toBeTypeOf('number');
  });

  it('consumes exact reservations even on the safe exit, then schedules copied subjects', () => {
    const target = eventV3({
      id: 'callback_target', delivery: { kind: 'queued_callback' }, rarity: 'secret', acceptsBindings: ['enemy_id'],
      eligibility: { fact: 'callback.queued', args: { callbackId: 'later' } },
    });
    const source = eventV3({
      bindings: [{ as: 'enemy_id', source: 'revenge.enemyId' }],
      choiceSet: { fixed: [
        { ...choice('leave', { kind: 'nothing' }), callback: {
          callbackId: 'later', eventId: target.id, contentVersion: 1, minDepthDelay: 2,
          destinationThemes: ['omen'], priority: 700,
          bind: [{ as: 'enemy_id', source: 'revenge.enemyId' }],
          expiry: { expiresAfterNodes: 10, fallback: 'discard' },
        } },
        choice('other', { kind: 'nothing' }),
      ] },
    });
    const input = committed(14, source, {
      revengeFactLedger: [{ battleId: 'battle:r', enemyId: 'rat', achievedDepth: 2, status: 'ready' }],
    });
    const materialized = materializeReachedEventV3(input, NODE, source);
    if (!materialized.ok) throw new Error('materialization failed');
    const resolved = resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'leave', (id) => (
      id === source.id ? source : id === target.id ? target : undefined
    ));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error('resolution failed');
    expect(resolved.state.revengeFactLedger[0]).toEqual(expect.objectContaining({ status: 'consumed' }));
    expect(resolved.state.eventCallbackQueue[0]?.boundSubjects).toEqual({ enemy_id: 'rat' });
  });

  it('applies choice mutations and only the persisted weighted branch mutations', () => {
    const event = eventV3({ choiceSet: { fixed: [
      {
        ...choice('fate', { kind: 'weighted', branches: [
          { id: 'open', label: 'Open (50%)', weight: 1, outcome: { kind: 'nothing' },
            mutations: [{ op: 'set', key: 'grave_path', value: 'opened' }] },
          { id: 'answer', label: 'Answer (50%)', weight: 1, outcome: { kind: 'nothing' },
            mutations: [{ op: 'set', key: 'grave_path', value: 'answered' }] },
        ] }),
        mutations: [{ op: 'set', key: 'oath_mercy', value: true }],
      },
      choice('leave', { kind: 'nothing' }),
    ] } });
    const materialized = materializeReachedEventV3(committed(19, event), NODE, event);
    if (!materialized.ok) throw new Error('materialization failed');
    const selected = materialized.materialization.selectedWeightedBranchIds.fate;
    const resolved = resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'fate', () => event);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error('resolution failed');
    expect(resolved.state.storyStateV3.oath_mercy).toBe(true);
    expect(resolved.state.storyStateV3.grave_path).toBe(selected === 'open' ? 'opened' : 'answered');
  });

  it('materializes targeted zero, one, and many offers inertly and finalizes only the pending exact offer', () => {
    const targeted = eventV3({ choiceSet: { fixed: [
      choice('upgrade', { kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: { cardIds: ['sword_slash'] } } }, fallback: { kind: 'grantGold', amount: 2 } }),
      choice('leave', { kind: 'nothing' }),
    ] } });
    const noCards = materializeReachedEventV3(committed(20, targeted), NODE, targeted);
    if (!noCards.ok) throw new Error('zero materialization failed');
    expect(noCards.materialization.deferredOffersByChoiceId.upgrade).toEqual(expect.objectContaining({ optionInstanceIds: [] }));
    expect(noCards.state.gold).toBe(0);

    const oneCard = materializeReachedEventV3(committed(21, targeted, {
      pieces: [{ slot: 0, instanceId: 'one', skillId: 'sword_slash', tier: 'bronze' }],
    }), NODE, targeted);
    if (!oneCard.ok) throw new Error('one materialization failed');
    const oneResolved = resolveEventChoiceV3(oneCard.state, `event:${NODE.id}`, 'upgrade', () => targeted);
    expect(oneResolved.ok).toBe(true);
    if (!oneResolved.ok) throw new Error('one resolution failed');
    expect(oneResolved.state.pieces[0]!.tier).toBe('silver');
    expect(oneResolved.state.eventResolutions?.[NODE.id]?.pending).toBeUndefined();

    const many = materializeReachedEventV3(committed(22, targeted, {
      pieces: [
        { slot: 0, instanceId: 'one', skillId: 'sword_slash', tier: 'bronze' },
        { slot: 1, instanceId: 'two', skillId: 'sword_slash', tier: 'bronze' },
      ],
    }), NODE, targeted);
    if (!many.ok) throw new Error('many materialization failed');
    const manyResolved = resolveEventChoiceV3(many.state, `event:${NODE.id}`, 'upgrade', () => targeted);
    expect(manyResolved.ok).toBe(true);
    if (!manyResolved.ok) throw new Error('many resolution failed');
    expect(reopenEventChoiceV3(manyResolved.state, `event:${NODE.id}`, () => targeted)?.offer).toEqual(expect.objectContaining({
      optionInstanceIds: ['one', 'two'], status: 'pending',
    }));
    expect(finalizeTargetedUpgradeV3(manyResolved.state, 'missing-instance', 'upgrade', 'two', () => targeted)).toEqual({
      ok: false, state: manyResolved.state, reason: 'choice',
    });
    expect(finalizeTargetedUpgradeV3(manyResolved.state, `event:${NODE.id}`, 'leave', 'two', () => targeted)).toEqual({
      ok: false, state: manyResolved.state, reason: 'choice',
    });
    const wrongKindState = withOffer(manyResolved.state, 'upgrade', {
      kind: 'grantCard', status: 'pending', card: { skillId: 'sword_slash', tier: 'bronze' },
    });
    expect(finalizeTargetedUpgradeV3(wrongKindState, `event:${NODE.id}`, 'upgrade', 'two', () => targeted)).toEqual({
      ok: false, state: wrongKindState, reason: 'choice',
    });
    const finalized = finalizeTargetedUpgradeV3(manyResolved.state, `event:${NODE.id}`, 'upgrade', 'two', () => targeted);
    expect(finalized.ok).toBe(true);
    expect(finalized.state.pieces[1]!.tier).toBe('silver');
    expect(finalized.state.eventResolutions?.[NODE.id]?.pending).toBeUndefined();
    expect(finalizeTargetedUpgradeV3(finalized.state, `event:${NODE.id}`, 'upgrade', 'two', () => targeted)).toEqual({
      ok: true, state: finalized.state, outcome: { kind: 'alreadySettled' },
    });
    expect(finalizeTargetedUpgradeV3(finalized.state, `event:${NODE.id}`, 'upgrade', 'one', () => targeted)).toEqual({
      ok: false, state: finalized.state, reason: 'offer',
    });

    const noCardsResolved = resolveEventChoiceV3(noCards.state, `event:${NODE.id}`, 'upgrade', () => targeted);
    expect(noCardsResolved.ok).toBe(true);
    if (!noCardsResolved.ok) throw new Error('zero resolution failed');
    expect(finalizeTargetedUpgradeV3(noCardsResolved.state, `event:${NODE.id}`, 'upgrade', undefined, () => targeted)).toEqual({
      ok: true, state: noCardsResolved.state, outcome: { kind: 'alreadySettled' },
    });
    expect(finalizeTargetedUpgradeV3(noCardsResolved.state, `event:${NODE.id}`, 'upgrade', 'not-selected', () => targeted)).toEqual({
      ok: false, state: noCardsResolved.state, reason: 'offer',
    });
  });

  it.each([
    ['grantCard', { kind: 'grantCard' }],
    ['grantGem', { kind: 'grantGem' }],
    ['bonusDraft', { kind: 'bonusDraft' }],
    ['gemChoice', { kind: 'gemChoice' }],
    ['upgradeCard', { kind: 'upgradeCard' }],
    ['sellGem', { kind: 'sellGem' }],
    ['mergeCards', { kind: 'mergeCards' }],
  ] as const)('resolves %s only from its persisted exact commitment', (kind, outcome) => {
    const event = eventV3({ choiceSet: { fixed: [choice('act', outcome), choice('leave', { kind: 'nothing' })] } });
    const gemId = Object.keys(gemBook)[0]!;
    const materialized = materializeReachedEventV3(committed(240 + kind.length, event, {
      pieces: [0, 1, 2].map((slot) => ({ slot, instanceId: `owned-${String(slot)}`, skillId: 'sword_slash', tier: 'bronze' as const })),
      gemInventory: [gemId],
    }), NODE, event);
    if (!materialized.ok) throw new Error(`${kind} materialization failed`);
    const commitment = structuredClone(materialized.materialization.deferredOffersByChoiceId.act);
    const alteredSeed = { ...materialized.state, map: { ...materialized.state.map, seed: materialized.state.map.seed + 9999 } };
    const resolved = resolveEventChoiceV3(alteredSeed, `event:${NODE.id}`, 'act', () => event);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(`${kind} resolution failed`);
    expect(materialized.materialization.deferredOffersByChoiceId.act).toEqual(commitment);
    if (kind === 'grantCard' || kind === 'grantGem') {
      expect(resolved.state.eventResolutions?.[NODE.id]?.pending).toBeUndefined();
    } else {
      expect(resolved.state.eventResolutions?.[NODE.id]?.pending).toBe(true);
      expect(reopenEventChoiceV3(resolved.state, `event:${NODE.id}`, () => event)?.offer.kind).toBe(kind);
    }
  });

  it.each([
    ['sellGem', { kind: 'sellGem' }],
    ['mergeCards', { kind: 'mergeCards' }],
  ] as const)('persists an unavailable %s commitment without blocking the safe exit', (kind, outcome) => {
    const event = eventV3({ rarity: 'common', choiceSet: { fixed: [
      choice('act', outcome), choice('leave', { kind: 'nothing' }),
    ] } });
    const materialized = materializeReachedEventV3(committed(410 + kind.length, event), NODE, event);
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) throw new Error(`${kind} materialization failed`);
    expect(materialized.materialization.deferredOffersByChoiceId.act).toEqual({
      kind, status: 'unavailable',
    });
    const rejected = resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'act', () => event);
    expect(rejected).toEqual({ ok: false, state: materialized.state, reason: 'gate' });
    const safe = resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'leave', () => event);
    expect(safe.ok).toBe(true);
    expect(firstEligibleConditionalEvent(runAtNode(410 + kind.length), NODE, [event])).toBeUndefined();
  });

  it('refuses a grantMapInfo rung when its exact target bands are already recorded, but resolves fine on a partial overlap (2026-09-06)', () => {
    // NODE.wave = 2 -> bandIndexOf(2) = 0 -> bandsAhead:2 targets bands 1, 2
    // (the exact source-band math `resolveEventOutcomeSpec`'s own
    // `grantMapInfo` case uses, mirrored by `mapInfoRevealsAnything`).
    const event = eventV3({ choiceSet: { fixed: [
      choice('reveal', { kind: 'grantMapInfo', bandsAhead: 2 }),
      choice('leave', { kind: 'nothing' }),
    ] } });
    const bothBandsKnown = applyGrantMapInfo(committed(777, event), 'prior-source', 0, 2);
    const materialized = materializeReachedEventV3(bothBandsKnown, NODE, event);
    if (!materialized.ok) throw new Error('grantMapInfo materialization failed');
    expect(resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'reveal', () => event)).toEqual({
      ok: false, state: materialized.state, reason: 'gate',
    });
    // The safe exit is unaffected.
    expect(resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'leave', () => event).ok).toBe(true);

    // A PARTIAL overlap — a DIFFERENT prior source already recorded band 2
    // (but not band 1, this choice's other target) — still resolves fine.
    const oneBandKnown = applyGrantMapInfo(committed(778, event), 'prior-source', 1, 2);
    const materializedPartial = materializeReachedEventV3(oneBandKnown, NODE, event);
    if (!materializedPartial.ok) throw new Error('grantMapInfo partial materialization failed');
    const partialResolved = resolveEventChoiceV3(materializedPartial.state, `event:${NODE.id}`, 'reveal', () => event);
    expect(partialResolved.ok).toBe(true);
  });

  it("refuses a paid upgradeCard rung with nothing eligible instead of auto-settling the fallback coin — the live gilded_detour shape (2026-09-06)", () => {
    const event = eventV3({ choiceSet: { fixed: [
      { ...choice('commission', { kind: 'upgradeCard' }), cost: 8 },
      choice('leave', { kind: 'nothing' }),
    ] } });
    // No owned cards at all: `upgradeCardOptions` (events.ts) is empty.
    const materialized = materializeReachedEventV3(committed(512, event, { gold: 20 }), NODE, event);
    if (!materialized.ok) throw new Error('upgradeCard materialization failed');
    expect(materialized.materialization.deferredOffersByChoiceId.commission).toEqual(
      expect.objectContaining({ kind: 'upgradeCard', status: 'pending', optionInstanceIds: [] }),
    );
    expect(resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'commission', () => event)).toEqual({
      ok: false, state: materialized.state, reason: 'gate',
    });
    // No gold moved — the whole point of gating BEFORE the charge.
    expect(materialized.state.gold).toBe(20);
  });

  it('rejects wrong instance/version/materialization/choice/gate without mutation and never rerolls after display', () => {
    const gated = eventV3({ choiceSet: { fixed: [
      { ...choice('gated', { kind: 'grantGold', amount: 4 }), requiresTally: { stat: 'wins', atLeast: 1 } },
      choice('leave', { kind: 'nothing' }),
    ] } });
    const materialized = materializeReachedEventV3(committed(23, gated), NODE, gated);
    if (!materialized.ok) throw new Error('materialization failed');
    const withoutMaterialization = { ...materialized.state, eventMaterializations: {} };
    const cases: Array<[RunState, ReturnType<typeof resolveEventChoiceV3>]> = [
      [materialized.state, resolveEventChoiceV3(materialized.state, 'event:wrong', 'leave', () => gated)],
      [materialized.state, resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'leave', () => undefined)],
      [withoutMaterialization, resolveEventChoiceV3(withoutMaterialization, `event:${NODE.id}`, 'leave', () => gated)],
      [materialized.state, resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'missing', () => gated)],
      [materialized.state, resolveEventChoiceV3(materialized.state, `event:${NODE.id}`, 'gated', () => gated)],
    ];
    for (const [input, failed] of cases) {
      expect(failed.ok).toBe(false);
      expect(failed.state).toBe(input);
    }

    const weighted = eventV3({ choiceSet: { fixed: [
      choice('fate', { kind: 'weighted', branches: [
        { id: 'gold', label: 'Gold (50%)', weight: 1, outcome: { kind: 'grantGold', amount: 4 } },
        { id: 'dust', label: 'Dust (50%)', weight: 1, outcome: { kind: 'nothing' } },
      ] }), choice('leave', { kind: 'nothing' }),
    ] } });
    const ready = materializeReachedEventV3(committed(24, weighted), NODE, weighted);
    if (!ready.ok) throw new Error('weighted materialization failed');
    const alteredSeed = { ...ready.state, map: { ...ready.state.map, seed: ready.state.map.seed + 1000 } };
    const first = resolveEventChoiceV3(ready.state, `event:${NODE.id}`, 'fate', () => weighted);
    const second = resolveEventChoiceV3(alteredSeed, `event:${NODE.id}`, 'fate', () => weighted);
    expect(first.ok && second.ok ? first.outcome : undefined).toEqual(first.ok && second.ok ? second.outcome : undefined);
  });
});
