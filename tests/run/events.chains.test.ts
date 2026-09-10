// Event chains (2026-09-02) — the gate mechanism, its catalog lints, and the
// determinism guarantees. See the EVENT CHAINS block in `src/data/events.ts`
// and the chain scan in `src/run/events.ts#rollEventForNode`.
//
// LINT NUMBERING follows the design spec (scratchpad events-design.md §1.5):
//   L1 gates resolve            — here
//   L2 chains capped at depth 2 — here
//   L3 bag health (>=2 ungated) — tests/run/events.test.ts (upgraded in place)
//   L4 gate-independent eligibility for bag residents — here
//   L5 the safe exit is ungated — here
//   L6 an unlocked chain is deliverable at gold 0     — here (end-to-end,
//      through the REAL rollEventForNode, not a re-derived predicate)
//   L7 census updates           — tests/run/events.test.ts (44 events, 15/13/2)
//   L8 derived-filter width     — here
//
// THE ZERO-PERTURBATION TESTS are the most important ones in this file: the
// gate mechanism and the four GATED events must move NO seeded event sequence
// until a gate opens. The golden literals below were captured from the
// PRE-BATCH catalog (HEAD 74075f8, before the chain batch landed) by driving
// the real `rollEventForNode`; the themes pinned are exactly the ones the
// batch touched ONLY with gated events (training/omen/forge — their bag pools
// must be byte-identical). Cache/market/recruit gained UNGATED events and
// reshuffle like any content batch (the same class of movement as the
// 2026-07-29 +12 batch), so those themes are asserted structurally (in-theme,
// no gated id) rather than byte-for-byte.

import { describe, expect, it } from 'vitest';
import {
  eventCatalog,
  eventCatalogIds,
  type EventChoiceDef,
  type EventDef,
  type EventGate,
  type EventRequirement,
  type EventOutcomeSpec,
  type EventTallyGate,
  type EventTheme,
} from '../../src/data/events';
import { isEventDefV2 } from '../../src/data/eventContentV2';
import {
  BONUS_DRAFT_SIZE,
  EVENT_CHOICE_SIZE,
  eventSelectionIdsForCatalog,
  eventGateMet,
  eventRequirementsMet,
  eventTallyMet,
  isConditionalEvent,
  isEventChoiceUsable,
  resolveEventChoice as resolveCommittedEventChoice,
  resolveFilterFrom,
  rollEventForNode,
  type EventSelectionContent,
} from '../../src/run/events';
import { eventInstanceAt, recordEventInstance } from '../../src/run/eventInstances';
import {
  applyDraftResult,
  availableChoices,
  chooseNode,
  createRun,
  currentEventNode,
  leaveEvent,
  leaveShop,
  recordBattleResult,
  type RunNode,
  type RunState,
} from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import { skillBook } from '../../src/data/skills';
import { biomeCatalog, biomeIds } from '../../src/data/biomes';
import { biomeFor, counterTypeFor } from '../../src/run/biome';
import { cardMatchesFilter } from '../../src/run/shop';
import { cardOfferableAtTier, type SkillDef } from '../../src/engine/types';

// ---------------------------------------------------------------------------
// Shared helpers (same local-helper convention as tests/run/events.test.ts).
// ---------------------------------------------------------------------------

function isGatedEvent(event: EventDef): boolean {
  return isConditionalEvent(event);
}

const frozenLookup = (eventId: string, contentVersion: number): EventDef | undefined => (
  contentVersion === 1 ? eventCatalog[eventId] : undefined
);
const frozenContent: EventSelectionContent<EventDef> = {
  catalog: eventCatalog,
  orderedIds: eventSelectionIdsForCatalog(eventCatalogIds),
  currentVersionOf: () => 1,
};
const rollFrozen = (state: RunState, node: RunNode) => (
  rollEventForNode(state, node, frozenLookup, frozenContent)
);

const GATED_IDS: readonly string[] = eventCatalogIds.filter((id) => isGatedEvent(eventCatalog[id]!));
const UNGATED_IDS: readonly string[] = eventCatalogIds.filter((id) => !isGatedEvent(eventCatalog[id]!));
/** Legacy gates own the L1/L2/L6 graph and delivery harness. Schema-v2
 * eligibility is a separate fact algebra with dedicated Feathered coverage. */
const LEGACY_GATED_IDS: readonly string[] = eventCatalogIds.filter((id) => {
  const event = eventCatalog[id]!;
  return !isEventDefV2(event)
    && (event.requires !== undefined || event.requiresTally !== undefined || event.requiresAll !== undefined);
});

function isGatedChoice(choice: EventChoiceDef): boolean {
  return choice.requires !== undefined || choice.requiresTally !== undefined;
}

/** A deliberately tiny, detached catalog entry for graph-lint fixtures. */
function fixtureEvent(id: string, overrides: Partial<EventDef> = {}): EventDef {
  return {
    id,
    title: id,
    body: id,
    theme: 'cache',
    choices: [{ id: 'leave', label: 'Leave', outcome: { kind: 'nothing' } }],
    ...overrides,
  };
}

function fixtureCatalog(...events: readonly EventDef[]): Record<string, EventDef> {
  return Object.fromEntries(events.map((event) => [event.id, event]));
}

const SUPPORTED_EVENT_RARITIES = new Set(['common', 'uncommon', 'rare', 'secret']);

/** Event-to-event edges only: legacy `requires` plus conjunctive resolution requirements. */
function dependencyIds(event: EventDef): readonly string[] {
  const ids: string[] = [];
  if (event.requires) ids.push(event.requires.eventId);
  for (const requirement of event.requiresAll ?? []) {
    if (requirement.kind === 'resolution') ids.push(requirement.eventId);
  }
  return ids;
}

/**
 * Pure catalog lint authority for the derived runtime definitions. The JSON
 * loader has its own schema-level validator; this proves the frozen runtime
 * catalog and synthetic graph fixtures without mutating either singleton.
 */
function catalogLintProblems(catalog: Readonly<Record<string, EventDef>>, ids: readonly string[]): readonly string[] {
  const problems: string[] = [];
  const knownIds = new Set(ids);
  if (knownIds.size !== ids.length) problems.push('catalog ids must be unique');

  const checkTally = (owner: string, name: string, tally: EventTallyGate | undefined): void => {
    if (tally && (!Number.isInteger(tally.atLeast) || tally.atLeast < 1)) {
      problems.push(`${owner}: ${name}.atLeast must be a positive integer`);
    }
  };
  const checkResolution = (owner: string, name: string, event: EventDef, gate: EventGate | undefined): void => {
    if (!gate) return;
    if (gate.eventId === event.id) problems.push(`${owner}: cannot depend on itself`);
    const target = knownIds.has(gate.eventId) ? catalog[gate.eventId] : undefined;
    if (!target) {
      problems.push(`${owner}: unknown event "${gate.eventId}"`);
      return;
    }
    if (gate.choiceIds === undefined) return;
    if (gate.choiceIds.length === 0) problems.push(`${owner}: ${name}.choiceIds must be non-empty`);
    const seenChoices = new Set<string>();
    for (const choiceId of gate.choiceIds) {
      if (seenChoices.has(choiceId)) problems.push(`${owner}: duplicate choice "${choiceId}" on "${gate.eventId}"`);
      seenChoices.add(choiceId);
      if (!target.choices.some((choice) => choice.id === choiceId)) {
        problems.push(`${owner}: unknown choice "${choiceId}" on "${gate.eventId}"`);
      }
    }
  };

  for (const id of ids) {
    const event = catalog[id];
    if (!event) {
      problems.push(`catalog id "${id}" has no event definition`);
      continue;
    }
    if (event.rarity !== undefined && !SUPPORTED_EVENT_RARITIES.has(event.rarity)) {
      problems.push(`${id}: unsupported rarity "${event.rarity}"`);
    }
    if (event.biomeIds !== undefined) {
      if (event.biomeIds.length === 0) problems.push(`${id}: biomeIds must be non-empty`);
      const seenBiomes = new Set<string>();
      for (const biomeId of event.biomeIds) {
        if (seenBiomes.has(biomeId)) problems.push(`${id}: duplicate biome "${biomeId}"`);
        seenBiomes.add(biomeId);
        if (!biomeIds.includes(biomeId)) problems.push(`${id}: unknown biome "${biomeId}"`);
      }
    }
    checkResolution(id, 'requires', event, event.requires);
    checkTally(id, 'requiresTally', event.requiresTally);
    if (event.requiresAll !== undefined && event.requiresAll.length === 0) {
      problems.push(`${id}: requiresAll must be non-empty`);
    }
    for (const requirement of event.requiresAll ?? []) {
      if (requirement.kind === 'resolution') checkResolution(id, 'requiresAll', event, requirement);
      else checkTally(id, 'requiresAll', requirement);
    }
  }

  const graph = new Map<string, readonly string[]>();
  for (const id of ids) {
    const event = catalog[id];
    if (!event) continue;
    graph.set(id, dependencyIds(event).filter((dependencyId) => knownIds.has(dependencyId) && catalog[dependencyId] !== undefined));
  }

  // Iterative DFS detects cycles without risking a call-stack overflow on a
  // malformed generated catalog.
  const visitState = new Map<string, 'visiting' | 'done'>();
  for (const root of graph.keys()) {
    if (visitState.has(root)) continue;
    const path = [root];
    const pathIndex = new Map<string, number>([[root, 0]]);
    const frames: Array<{ node: string; nextDependency: number }> = [{ node: root, nextDependency: 0 }];
    visitState.set(root, 'visiting');
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const dependencies = graph.get(frame.node) ?? [];
      if (frame.nextDependency >= dependencies.length) {
        visitState.set(frame.node, 'done');
        frames.pop();
        pathIndex.delete(frame.node);
        path.pop();
        continue;
      }
      const target = dependencies[frame.nextDependency++]!;
      if (visitState.get(target) === 'visiting') {
        const start = pathIndex.get(target) ?? 0;
        problems.push(`${root}: dependency cycle ${[...path.slice(start), target].join(' -> ')}`);
      } else if (!visitState.has(target)) {
        visitState.set(target, 'visiting');
        pathIndex.set(target, path.length);
        path.push(target);
        frames.push({ node: target, nextDependency: 0 });
      }
    }
  }

  // The longest permitted path contains two event-to-event edges, yielding a
  // three-stage chain. A bounded iterative walk makes very long bad fixtures
  // report a lint rather than overflow.
  for (const origin of graph.keys()) {
    const pending: Array<{ node: string; depth: number; trail: ReadonlySet<string> }> = [
      { node: origin, depth: 0, trail: new Set([origin]) },
    ];
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const target of graph.get(current.node) ?? []) {
        if (current.trail.has(target)) continue;
        const nextDepth = current.depth + 1;
        if (nextDepth > 2) {
          problems.push(`${origin}: dependency chain is deeper than two edges`);
          continue;
        }
        const nextTrail = new Set(current.trail);
        nextTrail.add(target);
        pending.push({ node: target, depth: nextDepth, trail: nextTrail });
      }
    }
  }

  return problems;
}

/** Outcome kinds whose rung can be dark for STATE reasons even ungated —
 * excluded when a lint needs a rung that is usable unconditionally. */
function hasStatePrecondition(spec: EventOutcomeSpec): boolean {
  if (spec.kind === 'sellGem' || spec.kind === 'mergeCards') return true;
  return (spec.kind === 'cardChoice' || spec.kind === 'bonusDraft') && spec.filterFrom !== undefined;
}

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
  return picks;
}

function startedRun(seed: number): RunState {
  return applyDraftResult(createRun(seed), draftPicksFor(seed));
}

function fakeEventNode(id: string, eventSeed: number, theme?: EventTheme, biomeId?: string): RunNode {
  return { id, depth: 1, wave: 1, kind: 'event', eventSeed, ...(theme ? { eventTheme: theme } : {}), ...(biomeId ? { biomeId } : {}) };
}

/** Inject a synthetic past resolution — the exact record shape
 * `recordEventResolution` writes, keyed by a node id that never has to exist
 * on the map (gates scan the ledger's VALUES, never the map). */
function withResolution(state: RunState, eventId: string, choiceId: string, pending?: boolean): RunState {
  return {
    ...state,
    eventResolutions: {
      ...(state.eventResolutions ?? {}),
      [`synthetic-${eventId}-${choiceId}`]: {
        eventId,
        contentVersion: 1,
        instanceId: `event:synthetic-${eventId}-${choiceId}`,
        choiceId,
        ...(pending ? { pending: true } : {}),
      },
    },
  };
}

function currentEventNodeOrThrow(state: RunState): RunNode {
  const node = currentEventNode(state);
  if (!node) throw new Error('no active event node');
  return node;
}

/** Direct resolver fixtures commit the exact content version first. Real walk
 * coverage retains the record created by rollEventForNode. */
function resolveEventChoice(state: RunState, eventId: string, choiceId: string) {
  const node = currentEventNode(state);
  if (!node) return resolveCommittedEventChoice(state, eventId, choiceId, frozenLookup);
  const version = 1;
  const existing = eventInstanceAt(state, node.id);
  if (existing && (existing.eventId !== eventId || existing.contentVersion !== version)) {
    throw new Error(`direct fixture cannot rebind committed event node "${node.id}"`);
  }
  const committed = existing
    ? state
    : recordEventInstance(state, node.id, {
        eventId,
        contentVersion: version,
        instanceId: `event:${node.id}`,
        drawnDepth: node.depth,
      });
  return resolveCommittedEventChoice(committed, eventId, choiceId, frozenLookup);
}

function replaceNode(map: RunState['map'], replacement: RunNode): RunState['map'] {
  return {
    ...map,
    depths: map.depths.map((column) => column.map((n) => (n.id === replacement.id ? replacement : n))),
  };
}

/** Walk to the first event node reachable from a fresh run (fights won,
 * shops left) — twin of the helper in events.test.ts. */
function stateAtFirstEvent(seed: number): { state: RunState; node: RunNode } {
  let state = startedRun(seed);
  for (let guard = 0; guard < 200; guard++) {
    const choices = availableChoices(state);
    if (choices.length === 0) throw new Error('no event node reachable for this seed');
    const eventChoice = choices.find((n) => n.kind === 'event');
    if (eventChoice) {
      state = chooseNode(state, eventChoice.id);
      return { state, node: eventChoice };
    }
    const node = choices[0]!;
    state = chooseNode(state, node.id);
    if (node.kind === 'shop') state = leaveShop(state);
    else state = recordBattleResult(state, { won: true, goldEarned: 1 });
  }
  throw new Error('guard exceeded while looking for an event node');
}

// ---------------------------------------------------------------------------
// Gate predicates — unit level.
// ---------------------------------------------------------------------------

describe('run/events: gate predicates', () => {
  const base = startedRun(5);

  it('requiresAll is conjunctive while legacy single gates stay compatible', () => {
    const requirements: readonly EventRequirement[] = [
      { kind: 'resolution', eventId: 'bell_beneath_ice', choiceIds: ['prise_it_free'] },
      { kind: 'resolution', eventId: 'the_second_toll', choiceIds: ['answer_the_bell'] },
    ];
    const one = withResolution(base, 'bell_beneath_ice', 'prise_it_free');
    const both = withResolution(one, 'the_second_toll', 'answer_the_bell');

    expect(eventRequirementsMet(one, requirements)).toBe(false);
    expect(eventRequirementsMet(both, requirements)).toBe(true);
    expect(eventGateMet(both, { eventId: 'bell_beneath_ice', choiceIds: ['prise_it_free'] })).toBe(true);
  });

  it('classifies every constrained event as conditional', () => {
    const bare = { id: 'x', title: 'x', body: 'x', theme: 'cache', choices: [] } as unknown as EventDef;
    expect(isConditionalEvent(bare)).toBe(false);
    expect(isConditionalEvent({ ...bare, biomeIds: ['frostmarch'] })).toBe(true);
    expect(isConditionalEvent({ ...bare, requires: { eventId: 'x' } })).toBe(true);
    expect(isConditionalEvent({ ...bare, requiresTally: { stat: 'wins', atLeast: 1 } })).toBe(true);
    expect(isConditionalEvent({ ...bare, requiresAll: [{ kind: 'tally', stat: 'wins', atLeast: 1 }] })).toBe(true);
  });

  it('eventGateMet: absent ledger / wrong event / wrong choice are all closed', () => {
    const gate: EventGate = { eventId: 'wandering_tutor', choiceIds: ['pay'] };
    expect(eventGateMet(base, gate)).toBe(false);
    expect(eventGateMet(withResolution(base, 'sparring_circle', 'lesson'), gate)).toBe(false);
    expect(eventGateMet(withResolution(base, 'wandering_tutor', 'decline'), gate)).toBe(false);
  });

  it('eventGateMet: the named choice opens it; absent choiceIds means ANY choice of the event', () => {
    const gate: EventGate = { eventId: 'wandering_tutor', choiceIds: ['pay'] };
    expect(eventGateMet(withResolution(base, 'wandering_tutor', 'pay'), gate)).toBe(true);
    const anyGate: EventGate = { eventId: 'wandering_tutor' };
    expect(eventGateMet(withResolution(base, 'wandering_tutor', 'decline'), anyGate)).toBe(true);
  });

  it('eventGateMet: a PENDING resolution counts — the cost is paid and the choice committed', () => {
    const gate: EventGate = { eventId: 'wandering_tutor', choiceIds: ['pay'] };
    expect(eventGateMet(withResolution(base, 'wandering_tutor', 'pay', true), gate)).toBe(true);
  });

  it('eventTallyMet reads the stats ledger for stats fields and RunState top-level for wins/losses/bossesCleared', () => {
    const spent: EventTallyGate = { stat: 'goldSpent', atLeast: 12 };
    expect(eventTallyMet(base, spent)).toBe(false);
    expect(eventTallyMet({ ...base, stats: { ...base.stats, goldSpent: 11 } }, spent)).toBe(false);
    expect(eventTallyMet({ ...base, stats: { ...base.stats, goldSpent: 12 } }, spent)).toBe(true);

    const lost: EventTallyGate = { stat: 'livesLost', atLeast: 1 };
    expect(eventTallyMet(base, lost)).toBe(false);
    expect(eventTallyMet({ ...base, stats: { ...base.stats, livesLost: 1 } }, lost)).toBe(true);

    expect(eventTallyMet({ ...base, wins: 3 }, { stat: 'wins', atLeast: 3 })).toBe(true);
    expect(eventTallyMet({ ...base, losses: 1 }, { stat: 'losses', atLeast: 2 })).toBe(false);
    expect(eventTallyMet({ ...base, bossesCleared: 1 }, { stat: 'bossesCleared', atLeast: 1 })).toBe(true);
  });

  it('a gated CHOICE presents as unusable through isEventChoiceUsable — the SAME predicate both event scenes dim buttons with', () => {
    // MobileRunEventScene/DesktopRunEventScene call isEventChoiceUsable per
    // button; this is the whole UI seam, verified here instead of by editing
    // scenes (the lock-reason line is a later, separate UI pass).
    const sunRoad = eventCatalog.the_reckoning!.choices.find((c) => c.id === 'sun_road')!;
    expect(isEventChoiceUsable(base, sunRoad)).toBe(false); // affordable (cost 0) but gate-locked
    const tithed = withResolution(base, 'crossroads_shrine', 'tithe');
    expect(isEventChoiceUsable(tithed, sunRoad)).toBe(true);
    const moonRoad = eventCatalog.the_reckoning!.choices.find((c) => c.id === 'moon_road')!;
    expect(isEventChoiceUsable(tithed, moonRoad)).toBe(false); // the OTHER face stays dark
  });
});

// ---------------------------------------------------------------------------
// Catalog lints.
// ---------------------------------------------------------------------------

describe('data/events: chain catalog lints', () => {
  it('keeps legacy requires gates separate from schema-v2 eligibility delivery', () => {
    expect([...LEGACY_GATED_IDS].sort()).toEqual([
      'factors_ledger',
      'pyre_watch',
      'the_bell_unbound',
      'the_reckoning',
      'the_second_toll',
      'tutors_return',
    ]);
    expect([...GATED_IDS].sort()).toEqual([
      ...LEGACY_GATED_IDS,
      'bell_beneath_ice',
      'feathered_cairn',
      'feathered_cairn_far_sight',
    ].sort());
    expect(UNGATED_IDS.length).toBe(eventCatalogIds.length - 9);
  });

  it('L1 — every gate resolves: real event ids, real choice ids, non-empty choiceIds, a real bar', () => {
    const checkGate = (owner: string, gate: EventGate | undefined, tally: EventTallyGate | undefined): void => {
      if (gate) {
        const target = eventCatalog[gate.eventId];
        expect(target, `${owner}: requires.eventId "${gate.eventId}" is not a catalog event`).toBeDefined();
        if (gate.choiceIds) {
          expect(gate.choiceIds.length, `${owner}: empty choiceIds is a gate that can never open`).toBeGreaterThan(0);
          for (const choiceId of gate.choiceIds) {
            expect(
              target!.choices.some((c) => c.id === choiceId),
              `${owner}: choiceIds member "${choiceId}" is not a choice on "${gate.eventId}"`,
            ).toBe(true);
          }
        }
      }
      if (tally) {
        expect(tally.atLeast, `${owner}: a 0-or-negative tally bar is an ungated gate pretending`).toBeGreaterThanOrEqual(1);
      }
    };
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      checkGate(id, event.requires, event.requiresTally);
      for (const choice of event.choices) checkGate(`${id}/${choice.id}`, choice.requires, choice.requiresTally);
    }
  });

  it('L2 — the production catalog is acyclic with dependency depth at most two edges', () => {
    expect(catalogLintProblems(eventCatalog, eventCatalogIds)).toEqual([]);
  });

  it('L2 fixtures — accepts dependency depths zero, one, and two; rejects depth three', () => {
    const depthZero = fixtureCatalog(fixtureEvent('zero'));
    const depthOne = fixtureCatalog(
      fixtureEvent('one', { requires: { eventId: 'zero' } }),
      fixtureEvent('zero'),
    );
    const depthTwo = fixtureCatalog(
      fixtureEvent('two', { requiresAll: [{ kind: 'resolution', eventId: 'one' }] }),
      fixtureEvent('one', { requires: { eventId: 'zero' } }),
      fixtureEvent('zero'),
    );
    const depthThree = fixtureCatalog(
      fixtureEvent('three', { requires: { eventId: 'two' } }),
      fixtureEvent('two', { requiresAll: [{ kind: 'resolution', eventId: 'one' }] }),
      fixtureEvent('one', { requires: { eventId: 'zero' } }),
      fixtureEvent('zero'),
    );

    expect(catalogLintProblems(depthZero, ['zero'])).toEqual([]);
    expect(catalogLintProblems(depthOne, ['one', 'zero'])).toEqual([]);
    expect(catalogLintProblems(depthTwo, ['two', 'one', 'zero'])).toEqual([]);
    expect(catalogLintProblems(depthThree, ['three', 'two', 'one', 'zero'])).toContain(
      'three: dependency chain is deeper than two edges',
    );
  });

  it('L2 fixtures — rejects self-links, cycles, and dangling legacy or conjunctive resolution references', () => {
    const self = fixtureCatalog(fixtureEvent('self', { requires: { eventId: 'self' } }));
    const cycle = fixtureCatalog(
      fixtureEvent('first', { requires: { eventId: 'second' } }),
      fixtureEvent('second', { requiresAll: [{ kind: 'resolution', eventId: 'first' }] }),
    );
    const dangling = fixtureCatalog(
      fixtureEvent('legacy', { requires: { eventId: 'missing', choiceIds: ['leave'] } }),
      fixtureEvent('conjunctive', {
        requiresAll: [{ kind: 'resolution', eventId: 'source', choiceIds: ['missing_choice'] }],
      }),
      fixtureEvent('source'),
    );

    expect(catalogLintProblems(self, ['self'])).toContain('self: cannot depend on itself');
    expect(catalogLintProblems(cycle, ['first', 'second'])).toContain('first: dependency cycle first -> second -> first');
    expect(catalogLintProblems(dangling, ['legacy', 'conjunctive', 'source'])).toEqual(expect.arrayContaining([
      'legacy: unknown event "missing"',
      'conjunctive: unknown choice "missing_choice" on "source"',
    ]));
  });

  it('L2 fixtures — reports a deep invalid graph without recursive overflow', () => {
    const ids = Array.from({ length: 20_000 }, (_unused, index) => `chain_${index}`);
    const catalog = fixtureCatalog(...ids.map((id, index) => fixtureEvent(id, index < ids.length - 1
      ? { requires: { eventId: ids[index + 1]! } }
      : {},
    )));

    const recursiveWalk = (id: string): void => {
      for (const dependencyId of dependencyIds(catalog[id]!)) recursiveWalk(dependencyId);
    };

    expect(() => recursiveWalk(ids[0]!)).toThrow(RangeError);
    expect(() => catalogLintProblems(catalog, ids)).not.toThrow();
    expect(catalogLintProblems(catalog, ids)).toContain('chain_0: dependency chain is deeper than two edges');
  });

  it('L1 fixtures — validates optional rarity, biome allow-lists, non-empty requirements, and positive tally bars', () => {
    const valid = fixtureCatalog(fixtureEvent('valid', {
      rarity: 'rare',
      biomeIds: ['arrowfell', 'thornwild'],
      requiresAll: [{ kind: 'tally', stat: 'wins', atLeast: 1 }],
    }));
    const invalid = fixtureCatalog(fixtureEvent('invalid', {
      rarity: 'mythic',
      biomeIds: [],
      requires: { eventId: 'invalid', choiceIds: [] },
      requiresTally: { stat: 'wins', atLeast: 0 },
      requiresAll: [],
    } as unknown as Partial<EventDef>));
    const duplicateBiome = fixtureCatalog(fixtureEvent('duplicate_biome', {
      biomeIds: ['arrowfell', 'arrowfell', 'not_a_biome'],
    } as unknown as Partial<EventDef>));
    const fractionalTally = fixtureCatalog(fixtureEvent('fractional_tally', {
      requiresAll: [{ kind: 'tally', stat: 'wins', atLeast: 1.5 }],
    } as unknown as Partial<EventDef>));

    expect(catalogLintProblems(valid, ['valid'])).toEqual([]);
    expect(catalogLintProblems(invalid, ['invalid'])).toEqual(expect.arrayContaining([
      'invalid: unsupported rarity "mythic"',
      'invalid: biomeIds must be non-empty',
      'invalid: requires.choiceIds must be non-empty',
      'invalid: requiresTally.atLeast must be a positive integer',
      'invalid: requiresAll must be non-empty',
      'invalid: cannot depend on itself',
    ]));
    expect(catalogLintProblems(duplicateBiome, ['duplicate_biome'])).toEqual(expect.arrayContaining([
      'duplicate_biome: duplicate biome "arrowfell"',
      'duplicate_biome: unknown biome "not_a_biome"',
    ]));
    expect(catalogLintProblems(fractionalTally, ['fractional_tally'])).toContain(
      'fractional_tally: requiresAll.atLeast must be a positive integer',
    );
  });

  it('L4 — an UNGATED (bag-resident) event never depends on a gated rung for eligibility', () => {
    for (const id of UNGATED_IDS) {
      const event = eventCatalog[id]!;
      // (a) some ungated, precondition-free, non-nothing rung exists at all;
      const unconditional = event.choices.filter(
        (c) => !isGatedChoice(c) && !hasStatePrecondition(c.outcome) && c.outcome.kind !== 'nothing',
      );
      expect(unconditional.length, `${id}: every real rung is gated or state-gated`).toBeGreaterThan(0);
      // (b) no gated rung undercuts them: for every gated choice there is an
      // unconditional sibling at most as expensive, so the gate can never be
      // what decides the event's first-eligibility wallet (the choice-level
      // starvation trap sneaking back in). Vacuous today — no ungated event
      // carries a gated choice — but armed for the next batch.
      const cheapest = Math.min(...unconditional.map((c) => c.cost ?? 0));
      for (const choice of event.choices) {
        if (!isGatedChoice(choice)) continue;
        expect(
          cheapest,
          `${id}/${choice.id}: a gated rung is the event's cheapest real rung`,
        ).toBeLessThanOrEqual(choice.cost ?? 0);
      }
    }
  });

  it('L5 — the safe exit is ungated: every event keeps a cost-0 choice with no requires/requiresTally', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      expect(
        event.choices.some((c) => (c.cost ?? 0) === 0 && !isGatedChoice(c)),
        `${id}: a locked exit is no exit`,
      ).toBe(true);
    }
  });

  it('no spec carries BOTH filter and filterFrom — the derived source substitutes the whole filter', () => {
    for (const id of eventCatalogIds) {
      for (const choice of eventCatalog[id]!.choices) {
        const spec = choice.outcome;
        if (spec.kind !== 'cardChoice' && spec.kind !== 'bonusDraft') continue;
        if (spec.filterFrom !== undefined) {
          expect(spec.filter, `${id}/${choice.id}: static filter would be dead content under filterFrom`).toBeUndefined();
        }
      }
    }
  });

  it('L8 — every filterFrom source clears its width on the WORST-CASE single-type pool, bronze-offerable', () => {
    // The generalization of the pool-width rule at the top of data/events.ts:
    // a derived filter can land on ANY single type (`biomeLean` any biome
    // lean, `biomeCounter` any counter, `boardIdentity` any committed type),
    // so the binding width is the THINNEST single-type pool the resolver
    // could really deal from (bronze-offerable, same narrowing as
    // cardChoiceOutcome/bonusDraftOutcome).
    const offerable = Object.values(skillBook).filter((s) => cardOfferableAtTier(s, 'bronze'));
    const elements = [...new Set(offerable.map((s) => s.element).filter((e): e is NonNullable<typeof e> => e !== undefined))];
    const weapons = [...new Set(offerable.map((s) => s.weapon).filter((w): w is NonNullable<typeof w> => w !== undefined))];
    expect(elements.length + weapons.length, 'the type axes vanished from the book').toBeGreaterThanOrEqual(11);
    let worst = Number.MAX_SAFE_INTEGER;
    let worstName = '';
    const measure = (name: string, pool: SkillDef[]): void => {
      if (pool.length < worst) {
        worst = pool.length;
        worstName = name;
      }
    };
    for (const e of elements) measure(`element:${e}`, offerable.filter((s) => cardMatchesFilter(s, [{ elements: [e] }])));
    for (const w of weapons) measure(`weapon:${w}`, offerable.filter((s) => cardMatchesFilter(s, [{ weapons: [w] }])));

    let sawOne = false;
    for (const id of eventCatalogIds) {
      for (const choice of eventCatalog[id]!.choices) {
        const spec = choice.outcome;
        if (spec.kind !== 'cardChoice' && spec.kind !== 'bonusDraft') continue;
        if (spec.filterFrom === undefined) continue;
        sawOne = true;
        const need = spec.kind === 'bonusDraft' ? BONUS_DRAFT_SIZE : EVENT_CHOICE_SIZE;
        expect(
          worst,
          `${id}/${choice.id} [${spec.kind}]: worst single-type pool (${worstName}) is thinner than the ${need}-wide offer`,
        ).toBeGreaterThanOrEqual(need);
      }
    }
    expect(sawOne, 'no filterFrom choice left in the catalog — retire this lint deliberately, not by accident').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// L6 — an unlocked chain is DELIVERABLE at gold 0, for EVERY way its gate can
// open, proven through the real draw (priority scan + hasAffordableChoice),
// never a re-derived predicate.
// ---------------------------------------------------------------------------

describe('run/events: L6 — every unlock path fires the chain at the next theme node, at gold 0', () => {
  /** Every minimal state that opens `event`'s gate, one per unlock path. */
  function unlockPaths(base: RunState, event: EventDef): { name: string; state: RunState }[] {
    const out: { name: string; state: RunState }[] = [];
    if (event.requires) {
      const choiceIds = event.requires.choiceIds ?? eventCatalog[event.requires.eventId]!.choices.map((c) => c.id);
      for (const choiceId of choiceIds) {
        out.push({ name: `${event.requires.eventId}/${choiceId}`, state: withResolution(base, event.requires.eventId, choiceId) });
      }
    }
    if (event.requiresTally) {
      const { stat, atLeast } = event.requiresTally;
      const state =
        stat === 'wins' ? { ...base, wins: atLeast }
        : stat === 'losses' ? { ...base, losses: atLeast }
        : stat === 'bossesCleared' ? { ...base, bossesCleared: atLeast }
        : { ...base, stats: { ...base.stats, [stat]: atLeast } };
      out.push({ name: `${stat}>=${atLeast}`, state });
    }
    if (event.requiresAll) {
      let state = base;
      const names: string[] = [];
      for (const requirement of event.requiresAll) {
        if (requirement.kind === 'resolution') {
          const choiceId = requirement.choiceIds?.[0] ?? eventCatalog[requirement.eventId]!.choices[0]!.id;
          state = withResolution(state, requirement.eventId, choiceId);
          names.push(`${requirement.eventId}/${choiceId}`);
        } else {
          const { stat, atLeast } = requirement;
          state = stat === 'wins' ? { ...state, wins: atLeast }
            : stat === 'losses' ? { ...state, losses: atLeast }
            : stat === 'bossesCleared' ? { ...state, bossesCleared: atLeast }
            : { ...state, stats: { ...state.stats, [stat]: atLeast } };
          names.push(`${stat}>=${atLeast}`);
        }
      }
      out.push({ name: names.join(' + '), state });
    }
    if (out.length === 0 && event.biomeIds) out.push({ name: `biome:${event.biomeIds[0]}`, state: base });
    return out;
  }

  it('for each gated event and each unlock path: drawn by priority at a gold-0 theme node, with a usable non-nothing rung', () => {
    const base = { ...startedRun(5), gold: 0 };
    let pathsChecked = 0;
    for (const id of LEGACY_GATED_IDS) {
      const event = eventCatalog[id]!;
      for (const path of unlockPaths(base, event)) {
        const biomeId = event.biomeIds?.[0];
        const seed = Array.from({ length: 256 }, (_unused, value) => value).find((eventSeed) => {
          const node = fakeEventNode(`l6-probe-${id}-${eventSeed}`, eventSeed, event.theme, biomeId);
          return rollEventForNode(path.state, node).event.id === id;
        });
        expect(seed, `${id} had no real-draw rarity hit in seeds 0..255 via ${path.name}`).toBeDefined();
        const node = fakeEventNode(`l6-${id}-${pathsChecked}`, seed!, event.theme, biomeId);
        const { state: after, event: drawn } = rollEventForNode(path.state, node);
        expect(drawn.id, `${id} did not fire at a ${event.theme} node via ${path.name}`).toBe(id);
        if (!('choices' in drawn)) throw new Error(`${id} must resolve to its pinned legacy definition`);
        // Deliverable, not merely drawn: a cost-0, non-`nothing` rung is lit
        // RIGHT NOW, at gold 0 — "gate opens => fires at the next theme
        // node", never "fires if the player is also rich".
        const live = drawn.choices.some(
          (c) => isEventChoiceUsable(after, c) && c.outcome.kind !== 'nothing' && (c.cost ?? 0) === 0,
        );
        expect(live, `${id} drew via ${path.name} but every free rung is dark`).toBe(true);
        pathsChecked += 1;
      }
    }
    // 5 legacy unlock paths plus the two gated Bell stages; v2 eligibility
    // has its own Feathered Cairn suite and never enters this legacy harness.
    expect(pathsChecked).toBe(7);
  });

  it('the real draw cannot skip stage 2, and exact choices plus matching biomes/themes advance all three stages', () => {
    const base = { ...startedRun(51), gold: 0 };
    const stage1 = eventCatalog.bell_beneath_ice!;
    const stage2 = eventCatalog.the_second_toll!;
    const stage3 = eventCatalog.the_bell_unbound!;
    const findDrawSeed = (state: RunState, event: EventDef, biomeId: string): number => {
      const seed = Array.from({ length: 256 }, (_unused, value) => value).find((eventSeed) =>
        rollEventForNode(state, fakeEventNode(`bell-probe-${event.id}-${eventSeed}`, eventSeed, event.theme, biomeId)).event.id === event.id,
      );
      expect(seed, `${event.id} had no real draw in seeds 0..255`).toBeDefined();
      return seed!;
    };

    const stage1Seed = findDrawSeed(base, stage1, 'frostmarch');
    expect(rollEventForNode(base, fakeEventNode('stage1-wrong-biome', stage1Seed, 'cache', 'emberwaste')).event.id).not.toBe(stage1.id);
    expect(rollEventForNode(base, fakeEventNode('stage1-wrong-theme', stage1Seed, 'forge', 'frostmarch')).event.id).not.toBe(stage1.id);
    const stage1Draw = rollEventForNode(base, fakeEventNode('stage1-hit', stage1Seed, 'cache', 'frostmarch'));
    expect(stage1Draw.event.id).toBe(stage1.id);

    const wrongStage1 = withResolution(stage1Draw.state, stage1.id, 'ring_it_here');
    expect(rollEventForNode(wrongStage1, fakeEventNode('stage2-wrong-choice', 0, 'omen', 'frostmarch')).event.id).not.toBe(stage2.id);
    expect(rollEventForNode(wrongStage1, fakeEventNode('stage3-skip', 0, 'forge', 'emberwaste')).event.id).not.toBe(stage3.id);

    const afterStage1 = withResolution(stage1Draw.state, stage1.id, 'prise_it_free');
    expect(rollEventForNode(afterStage1, fakeEventNode('stage3-too-soon', 0, 'forge', 'emberwaste')).event.id).not.toBe(stage3.id);
    const stage2Seed = findDrawSeed(afterStage1, stage2, 'frostmarch');
    const afterWrongBiome = rollEventForNode(afterStage1, fakeEventNode('stage2-wrong-biome', stage2Seed, 'omen', 'emberwaste')).state;
    const afterWrongTheme = rollEventForNode(afterWrongBiome, fakeEventNode('stage2-wrong-theme', stage2Seed, 'cache', 'frostmarch')).state;
    const stage2Draw = rollEventForNode(afterWrongTheme, fakeEventNode('stage2-hit', stage2Seed, 'omen', 'frostmarch'));
    expect(stage2Draw.event.id).toBe(stage2.id);

    const wrongStage2 = withResolution(stage2Draw.state, stage2.id, 'bind_the_clapper');
    expect(rollEventForNode(wrongStage2, fakeEventNode('stage3-wrong-choice', 0, 'forge', 'emberwaste')).event.id).not.toBe(stage3.id);

    const afterStage2 = withResolution(stage2Draw.state, stage2.id, 'answer_the_bell');
    const stage3Seed = findDrawSeed(afterStage2, stage3, 'emberwaste');
    const afterFinalWrongBiome = rollEventForNode(afterStage2, fakeEventNode('stage3-wrong-biome', stage3Seed, 'forge', 'frostmarch')).state;
    const afterFinalWrongTheme = rollEventForNode(afterFinalWrongBiome, fakeEventNode('stage3-wrong-theme', stage3Seed, 'omen', 'emberwaste')).state;
    const stage3Draw = rollEventForNode(afterFinalWrongTheme, fakeEventNode('stage3-hit', stage3Seed, 'forge', 'emberwaste'));
    expect(stage3Draw.event.id).toBe(stage3.id);

    expect(rollEventForNode(stage1Draw.state, fakeEventNode('stage1-repeat', stage1Seed, 'cache', 'frostmarch')).event.id).not.toBe(stage1.id);
    expect(rollEventForNode(stage2Draw.state, fakeEventNode('stage2-repeat', stage2Seed, 'omen', 'frostmarch')).event.id).not.toBe(stage2.id);
    expect(rollEventForNode(stage3Draw.state, fakeEventNode('stage3-repeat', stage3Seed, 'forge', 'emberwaste')).event.id).not.toBe(stage3.id);
  });

  it("the_reckoning's tally is rendered as AGENCY: each face lights only its own settlement, both faces light both", () => {
    const base = { ...startedRun(5), gold: 0 };
    const sunRoad = eventCatalog.the_reckoning!.choices.find((c) => c.id === 'sun_road')!;
    const moonRoad = eventCatalog.the_reckoning!.choices.find((c) => c.id === 'moon_road')!;
    const tithed = withResolution(base, 'crossroads_shrine', 'tithe');
    const mooned = withResolution(base, 'crossroads_shrine', 'moon_rite');
    const both = withResolution(tithed, 'crossroads_shrine', 'moon_rite');
    expect(isEventChoiceUsable(tithed, sunRoad)).toBe(true);
    expect(isEventChoiceUsable(tithed, moonRoad)).toBe(false);
    expect(isEventChoiceUsable(mooned, sunRoad)).toBe(false);
    expect(isEventChoiceUsable(mooned, moonRoad)).toBe(true);
    expect(isEventChoiceUsable(both, sunRoad)).toBe(true);
    expect(isEventChoiceUsable(both, moonRoad)).toBe(true);
  });

  it('defacing the shrine does NOT summon the reckoning — scrap is scrap', () => {
    const base = { ...startedRun(5), gold: 0 };
    const defaced = withResolution(base, 'crossroads_shrine', 'deface');
    const { event } = rollEventForNode(defaced, fakeEventNode('l6-deface', 99, 'omen'));
    expect(event.id).not.toBe('the_reckoning');
  });
});

// ---------------------------------------------------------------------------
// Bag exclusion, priority-draw mechanics, once-per-run.
// ---------------------------------------------------------------------------

describe('run/events: chained events never enter a bag; priority draw leaves the bags untouched', () => {
  it('a full walked run with no gate met never draws a gated id and never holds one in any bag', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      let state = startedRun(seed);
      for (let guard = 0; guard < 200; guard++) {
        const choices = availableChoices(state);
        if (choices.length === 0) break;
        const node = choices.find((n) => n.kind === 'event') ?? choices[0]!;
        state = chooseNode(state, node.id);
        if (node.kind === 'event') {
          state = rollEventForNode(state, node).state;
          state = leaveEvent(state);
        } else if (node.kind === 'shop') {
          state = leaveShop(state);
        } else {
          state = recordBattleResult(state, { won: true, goldEarned: 1 });
        }
        if (state.status !== 'active') break;
        if (node.wave > 12) break;
      }
      for (const gatedId of LEGACY_GATED_IDS) {
        expect(Object.values(state.eventInstances).map((instance) => instance.eventId), `seed ${seed} drew ${gatedId} with its gate closed`).not.toContain(gatedId);
      }
      for (const gatedId of GATED_IDS) {
        expect(state.eventBag, `seed ${seed}: ${gatedId} entered the defensive bag`).not.toContain(gatedId);
        for (const [theme, bag] of Object.entries(state.eventThemeBags ?? {})) {
          expect(bag, `seed ${seed}: ${gatedId} entered the ${theme} bag`).not.toContain(gatedId);
        }
      }
    }
  });

  it('a priority draw memoizes the node and touches NOTHING else — bags, refills and Rng streams are exactly as before', () => {
    // Warm the omen bag BEFORE the gate opens (a fresh run has lost no life),
    // so there is a non-trivial bag to not-touch when the chain fires.
    const fresh = { ...startedRun(9), gold: 0 };
    const warm = rollEventForNode(fresh, fakeEventNode('warm-omen', 0, 'omen'));
    const unlocked: RunState = { ...warm.state, stats: { ...warm.state.stats, livesLost: 1 } };
    const node = fakeEventNode('priority-omen', 1, 'omen');
    const { state: after, event } = rollEventForNode(unlocked, node);
    expect(event.id).toBe('pyre_watch');
    expect(after.eventThemeBags).toEqual(warm.state.eventThemeBags);
    expect(after.eventThemeBagRefills).toEqual(warm.state.eventThemeBagRefills);
    expect(after.eventBag).toEqual(warm.state.eventBag);
    expect(after.eventBagRefills).toBe(warm.state.eventBagRefills);
    expect(after.eventInstances[node.id]?.eventId).toBe('pyre_watch');
    // Idempotent like every other draw: a reload never re-draws.
    const repeat = rollEventForNode(after, node);
    expect(repeat.event.id).toBe('pyre_watch');
    expect(repeat.state).toEqual(after);
  });

  it('once per run: after the chain fires, later theme nodes go back to the bag even though the gate stays open', () => {
    const base = { ...startedRun(9), gold: 0, stats: { ...startedRun(9).stats, livesLost: 1 } };
    const first = rollEventForNode(base, fakeEventNode('omen-a', 0, 'omen'));
    expect(first.event.id).toBe('pyre_watch');
    const second = rollEventForNode(first.state, fakeEventNode('omen-b', 1, 'omen'));
    expect(second.event.id).not.toBe('pyre_watch');
    expect(second.event.theme).toBe('omen');
  });

  it('two chains unlocked in one theme: fixed catalog order decides, the second fires at the following node', () => {
    let state = { ...startedRun(9), gold: 0 };
    state = { ...state, stats: { ...state.stats, livesLost: 1 } }; // pyre_watch open
    state = withResolution(state, 'crossroads_shrine', 'tithe'); // the_reckoning open
    // the_reckoning precedes pyre_watch in catalog order.
    const first = rollEventForNode(state, fakeEventNode('omen-1', 0, 'omen'));
    expect(first.event.id).toBe('the_reckoning');
    const second = rollEventForNode(first.state, fakeEventNode('omen-2', 1, 'omen'));
    expect(second.event.id).toBe('pyre_watch');
    const third = rollEventForNode(second.state, fakeEventNode('omen-3', 2, 'omen'));
    expect(GATED_IDS).not.toContain(third.event.id);
    expect(third.event.theme).toBe('omen');
  });
});

// ---------------------------------------------------------------------------
// ZERO PERTURBATION — the determinism guarantee. Golden sequences captured
// from the PRE-BATCH catalog (HEAD 74075f8) through the real rollEventForNode.
// ---------------------------------------------------------------------------

// Two full no-repeat cycles per theme (bag exhaustion + reshuffled refill),
// gold flushed so affordability never widens the draw: pure bag order.
const GOLDEN_THEME_SEQUENCES: Record<'training' | 'omen' | 'forge', Record<number, string[]>> = {
  training: {
    3: ['sweep_drill', 'hermits_riddle', 'sparring_circle', 'veterans_last_lesson', 'wandering_tutor', 'sweep_drill', 'hermits_riddle', 'sparring_circle', 'wandering_tutor', 'veterans_last_lesson'],
    7: ['veterans_last_lesson', 'hermits_riddle', 'wandering_tutor', 'sweep_drill', 'sparring_circle', 'hermits_riddle', 'veterans_last_lesson', 'sparring_circle', 'wandering_tutor', 'sweep_drill'],
    11: ['sparring_circle', 'hermits_riddle', 'veterans_last_lesson', 'sweep_drill', 'wandering_tutor', 'hermits_riddle', 'wandering_tutor', 'veterans_last_lesson', 'sweep_drill', 'sparring_circle'],
  },
  omen: {
    3: ['fortune_teller', 'gambler', 'two_ravens', 'crossroads_shrine', 'weighing_stone', 'crossroads_shrine', 'two_ravens', 'gambler', 'fortune_teller', 'weighing_stone'],
    7: ['two_ravens', 'weighing_stone', 'gambler', 'fortune_teller', 'crossroads_shrine', 'weighing_stone', 'crossroads_shrine', 'gambler', 'two_ravens', 'fortune_teller'],
    11: ['gambler', 'fortune_teller', 'crossroads_shrine', 'two_ravens', 'weighing_stone', 'two_ravens', 'weighing_stone', 'crossroads_shrine', 'gambler', 'fortune_teller'],
  },
  forge: {
    3: ['ruined_anvil', 'the_lapidary', 'wandering_smith', 'cinderworks_regrind', 'ember_pit', 'retiring_smith', 'cinderworks_regrind', 'ruined_anvil', 'wandering_smith', 'the_lapidary', 'retiring_smith', 'ember_pit'],
    7: ['wandering_smith', 'ruined_anvil', 'ember_pit', 'the_lapidary', 'cinderworks_regrind', 'retiring_smith', 'ember_pit', 'ruined_anvil', 'wandering_smith', 'the_lapidary', 'retiring_smith', 'cinderworks_regrind'],
    11: ['the_lapidary', 'wandering_smith', 'ember_pit', 'ruined_anvil', 'cinderworks_regrind', 'retiring_smith', 'wandering_smith', 'cinderworks_regrind', 'ruined_anvil', 'the_lapidary', 'ember_pit', 'retiring_smith'],
  },
};

// The training/omen/forge draws of a real-map walk (prefer event nodes, win
// fights at +1 gold, never resolve a choice, stop past wave 12), as
// [nodeId, eventId] pairs. Theme bags are independent, so these subsequences
// are the walk's exact pre-batch behaviour for the three untouched pools.
const GOLDEN_WALK_ROWS: Record<number, [string, string][]> = {
  3: [['d5-0', 'sweep_drill'], ['d6-0', 'fortune_teller'], ['d9-0', 'ruined_anvil'], ['d15-0', 'hermits_riddle'], ['d18-0', 'gambler'], ['d19-0', 'the_lapidary'], ['d26-0', 'sparring_circle'], ['d28-0', 'wandering_smith'], ['d33-0', 'veterans_last_lesson'], ['d35-0', 'cinderworks_regrind'], ['d36-0', 'two_ravens'], ['d39-0', 'crossroads_shrine'], ['d41-0', 'weighing_stone']],
  7: [['d1-0', 'weighing_stone'], ['d3-0', 'veterans_last_lesson'], ['d6-0', 'hermits_riddle'], ['d9-1', 'two_ravens'], ['d12-0', 'wandering_smith'], ['d16-0', 'gambler'], ['d17-0', 'ruined_anvil'], ['d19-0', 'ember_pit'], ['d21-0', 'the_lapidary'], ['d24-0', 'cinderworks_regrind'], ['d27-1', 'wandering_tutor'], ['d30-1', 'fortune_teller'], ['d31-0', 'sweep_drill'], ['d33-0', 'crossroads_shrine'], ['d34-0', 'sparring_circle'], ['d41-0', 'hermits_riddle'], ['d44-0', 'weighing_stone']],
  11: [['d1-0', 'fortune_teller'], ['d4-0', 'sparring_circle'], ['d7-0', 'hermits_riddle'], ['d14-0', 'gambler'], ['d15-0', 'the_lapidary'], ['d16-0', 'crossroads_shrine'], ['d19-0', 'two_ravens'], ['d21-0', 'veterans_last_lesson'], ['d22-0', 'weighing_stone'], ['d24-0', 'sweep_drill'], ['d25-0', 'two_ravens'], ['d28-0', 'weighing_stone'], ['d29-0', 'wandering_tutor'], ['d32-0', 'hermits_riddle'], ['d35-0', 'crossroads_shrine'], ['d42-1', 'gambler']],
  19: [['d1-0', 'veterans_last_lesson'], ['d3-0', 'the_lapidary'], ['d7-0', 'two_ravens'], ['d13-0', 'wandering_smith'], ['d16-0', 'hermits_riddle'], ['d18-0', 'sweep_drill'], ['d23-0', 'crossroads_shrine'], ['d26-0', 'sparring_circle'], ['d28-0', 'retiring_smith'], ['d31-0', 'cinderworks_regrind'], ['d34-0', 'wandering_tutor'], ['d36-0', 'gambler'], ['d38-0', 'fortune_teller'], ['d39-0', 'sparring_circle'], ['d41-0', 'weighing_stone'], ['d42-0', 'sweep_drill']],
  25: [['d1-0', 'weighing_stone'], ['d6-0', 'sparring_circle'], ['d8-0', 'wandering_smith'], ['d11-0', 'ember_pit'], ['d12-0', 'hermits_riddle'], ['d14-0', 'fortune_teller'], ['d16-0', 'sweep_drill'], ['d18-0', 'wandering_tutor'], ['d22-0', 'two_ravens'], ['d23-0', 'gambler'], ['d30-0', 'crossroads_shrine'], ['d32-0', 'gambler'], ['d41-1', 'weighing_stone']],
};

describe('run/events: ZERO PERTURBATION — with no gate met, the seeded sequences are byte-identical to the pre-batch catalog', () => {
  it('training/omen/forge theme bags (the pools that gained ONLY gated events) reproduce the golden sequences exactly, across refills', () => {
    for (const theme of ['training', 'omen', 'forge'] as const) {
      for (const seed of [3, 7, 11]) {
        let state: RunState = { ...startedRun(seed), gold: 999 };
        const golden = GOLDEN_THEME_SEQUENCES[theme][seed]!;
        const drawn: string[] = [];
        for (let i = 0; i < golden.length; i++) {
          const result = rollEventForNode(state, fakeEventNode(`golden-${theme}-${i}`, i, theme));
          drawn.push(result.event.id);
          state = result.state;
        }
        expect(drawn, `${theme} @seed ${seed} moved`).toEqual(golden);
      }
    }
  });

  it('the frozen V2 compatibility selector reproduces every golden real-map draw and keeps reshuffled themes in-theme', () => {
    for (const seed of [3, 7, 11, 19, 25]) {
      let state = startedRun(seed);
      const rows: [string, string][] = [];
      for (let guard = 0; guard < 200; guard++) {
        const choices = availableChoices(state);
        if (choices.length === 0) break;
        const node = choices.find((n) => n.kind === 'event') ?? choices[0]!;
        state = chooseNode(state, node.id);
        if (node.kind === 'event') {
          const result = rollFrozen(state, node);
          state = result.state;
          if (node.eventTheme === 'training' || node.eventTheme === 'omen' || node.eventTheme === 'forge') {
            rows.push([node.id, result.event.id]);
          } else {
            // cache/market/recruit gained UNGATED events and reshuffle like
            // any content batch — assert structure, not bytes.
            expect(result.event.theme, `seed ${seed} node ${node.id}`).toBe(node.eventTheme);
            expect(GATED_IDS).not.toContain(result.event.id);
          }
          state = leaveEvent(state);
        } else if (node.kind === 'shop') {
          state = leaveShop(state);
        } else {
          state = recordBattleResult(state, { won: true, goldEarned: 1 });
        }
        if (state.status !== 'active') break;
        if (node.wave > 12) break;
      }
      expect(rows, `seed ${seed}: the unperturbed-theme subsequence moved`).toEqual(GOLDEN_WALK_ROWS[seed]!);
    }
  });
});

// ---------------------------------------------------------------------------
// END-TO-END — the chains proven live through the real run layer: createRun,
// real map, real chooseNode/rollEventForNode/resolveEventChoice.
// ---------------------------------------------------------------------------

describe('end-to-end: the recognition chain — wandering_tutor/pay -> tutors_return at a later training node', () => {
  // Seed 2's prefer-event walk draws wandering_tutor at a training node with
  // 2+ gold in hand and reaches another training event node afterwards
  // (verified by scan; seeds 4, 6, 7 also qualify — if content movement ever
  // breaks THIS seed's layout, re-scan and update, the chain logic is
  // seed-independent).
  const SEED = 2;

  interface ChainWalk {
    drawnSequence: string[];
    payoffDraw?: { nodeId: string; eventId: string; state: RunState };
  }

  /** Walk seed 2 resolving `setupChoice` on wandering_tutor when it draws;
   * stops AT the first training event node after the setup (payoff slot). */
  function walkChain(setupChoice: 'pay' | 'decline', past?: (state: RunState) => void): ChainWalk {
    let state = startedRun(SEED);
    let setupDone = false;
    const drawnSequence: string[] = [];
    for (let guard = 0; guard < 200; guard++) {
      const choices = availableChoices(state);
      if (choices.length === 0) break;
      const node = choices.find((n) => n.kind === 'event') ?? choices[0]!;
      state = chooseNode(state, node.id);
      if (node.kind === 'event') {
        const rolled = rollEventForNode(state, node);
        state = rolled.state;
        drawnSequence.push(rolled.event.id);
        if (!setupDone && rolled.event.id === 'wandering_tutor' && state.gold >= 2) {
          state = resolveEventChoice(state, 'wandering_tutor', setupChoice).state;
          setupDone = true;
        } else if (setupDone && node.eventTheme === 'training') {
          return { drawnSequence, payoffDraw: { nodeId: node.id, eventId: rolled.event.id, state } };
        }
        state = leaveEvent(state);
      } else if (node.kind === 'shop') {
        state = leaveShop(state);
      } else {
        state = recordBattleResult(state, { won: true, goldEarned: 1 });
      }
      if (state.status !== 'active') break;
      if (node.wave > 14) break;
    }
    past?.(state);
    return { drawnSequence };
  }

  it('PAY: the tutor comes back — the very next training node draws tutors_return, its free rung resolves at gold 0, once per run', () => {
    const walk = walkChain('pay');
    expect(walk.payoffDraw, 'seed 2 no longer reaches a post-setup training node — re-scan the seed').toBeDefined();
    expect(walk.payoffDraw!.eventId).toBe('tutors_return');

    // The payoff pays with an empty wallet: the free rung is usable and
    // resolves through the real resolver on the real node.
    let state = { ...walk.payoffDraw!.state, gold: 0 };
    const finishLesson = eventCatalog.tutors_return!.choices.find((c) => c.id === 'finish_lesson')!;
    const sparTheYard = eventCatalog.tutors_return!.choices.find((c) => c.id === 'spar_the_yard')!;
    expect(isEventChoiceUsable(state, finishLesson)).toBe(true);
    expect(isEventChoiceUsable(state, sparTheYard)).toBe(false); // 2g rung, broke player
    const before = state.heroLevel;
    const resolved = resolveEventChoice(state, 'tutors_return', 'finish_lesson');
    expect(resolved.outcome).toEqual({ kind: 'grantLevel', level: before + 1 });
    expect(resolved.state.heroLevel).toBe(before + 1);

    // Once per run: another training node never re-draws the chain, even
    // though the gate is still met.
    const again = rollEventForNode(resolved.state, fakeEventNode('post-payoff-training', 77, 'training'));
    expect(again.event.id).not.toBe('tutors_return');
    expect(again.event.theme).toBe('training');
  });

  it('DECLINE (the negative twin): walking away means the tutor never returns — not at the payoff slot, not anywhere', () => {
    let finalState: RunState | undefined;
    const walk = walkChain('decline', (s) => {
      finalState = s;
    });
    // The decline walk never stops at a payoff (tutors_return can never draw),
    // so it runs to the guard/wave bound and we assert over the whole run.
    expect(walk.payoffDraw?.eventId, 'a walked-away tutor still returned').not.toBe('tutors_return');
    expect(walk.drawnSequence).not.toContain('tutors_return');
    if (finalState) {
      expect(Object.values(finalState.eventInstances).map((instance) => instance.eventId)).not.toContain('tutors_return');
    }
  });

  it('seeded reproducibility with a gate in play: the same walk twice is byte-identical', () => {
    const a = walkChain('pay');
    const b = walkChain('pay');
    expect(b.drawnSequence).toEqual(a.drawnSequence);
    expect(b.payoffDraw?.nodeId).toBe(a.payoffDraw?.nodeId);
    expect(b.payoffDraw?.eventId).toBe(a.payoffDraw?.eventId);
  });
});

describe('end-to-end: the tally chain — a lost life -> pyre_watch at the next omen node', () => {
  // Seed 1: lose the FIRST fight, then the walk reaches an omen event node
  // (seeds 2, 3, 4 also qualify — same re-scan note as the tutor chain).
  const SEED = 1;

  function walkToOmen(loseFirstFight: boolean): { eventId?: string; state?: RunState; drawn: string[] } {
    let state = startedRun(SEED);
    let fought = false;
    const drawn: string[] = [];
    for (let guard = 0; guard < 200; guard++) {
      const choices = availableChoices(state);
      if (choices.length === 0) break;
      const node = choices.find((n) => n.kind === 'event') ?? choices[0]!;
      state = chooseNode(state, node.id);
      if (node.kind === 'event') {
        const rolled = rollEventForNode(state, node);
        state = rolled.state;
        drawn.push(rolled.event.id);
        if (fought && node.eventTheme === 'omen') {
          return { eventId: rolled.event.id, state, drawn };
        }
        state = leaveEvent(state);
      } else if (node.kind === 'shop') {
        state = leaveShop(state);
      } else if (!fought && loseFirstFight) {
        state = recordBattleResult(state, { won: false, goldEarned: 0 });
        fought = true;
      } else {
        state = recordBattleResult(state, { won: true, goldEarned: 1 });
        fought = true;
      }
      if (state.status !== 'active') break;
      if (node.wave > 14) break;
    }
    return { drawn };
  }

  it('LOSE: the first omen node after the defeat draws pyre_watch, and the alms resolve at gold 0', () => {
    const walk = walkToOmen(true);
    expect(walk.eventId, 'seed 1 no longer reaches an omen node post-fight — re-scan the seed').toBe('pyre_watch');
    expect(walk.state!.stats.livesLost).toBe(1);
    const broke = { ...walk.state!, gold: 0 };
    const alms = eventCatalog.pyre_watch!.choices.find((c) => c.id === 'alms')!;
    expect(isEventChoiceUsable(broke, alms)).toBe(true);
    const resolved = resolveEventChoice(broke, 'pyre_watch', 'alms');
    expect(resolved.outcome).toEqual({ kind: 'grantGold', amount: 2 });
    expect(resolved.state.gold).toBe(2);
  });

  it('WIN (the negative twin): an unbeaten run never sees the pyre-watch', () => {
    const walk = walkToOmen(false);
    expect(walk.eventId).not.toBe('pyre_watch');
    expect(walk.drawn).not.toContain('pyre_watch');
  });
});

// ---------------------------------------------------------------------------
// filterFrom — the derived doors, through the real resolver.
// ---------------------------------------------------------------------------

describe('run/events: filterFrom doors derive their pool from the run', () => {
  it("the_lands_measure/local_make deals 3 distinct cards of the node's band lean, every time", () => {
    for (const seed of [1, 4, 9, 17]) {
      const { state, node } = stateAtFirstEvent(seed);
      const lean = biomeFor(state.seed, node.wave, node.biomeId).lean;
      const { outcome } = resolveEventChoice({ ...state, gold: 5 }, 'the_lands_measure', 'local_make');
      expect(outcome.kind).toBe('bonusDraft');
      if (outcome.kind !== 'bonusDraft') continue;
      expect(outcome.cards).toHaveLength(EVENT_CHOICE_SIZE);
      expect(new Set(outcome.cards.map((c) => c.skillId)).size).toBe(EVENT_CHOICE_SIZE);
      for (const card of outcome.cards) {
        const skill = skillBook[card.skillId]!;
        const carried = lean.kind === 'element' ? skill.element : skill.weapon;
        expect(carried, `seed ${seed}: ${card.skillId} is not ${lean.type} (${lean.kind})`).toBe(lean.type);
      }
    }
  });

  it("the_lands_measure/hunters_edge deals the lean's counter where one exists", () => {
    let checked = 0;
    for (const seed of [1, 4, 9, 17, 23]) {
      const { state, node } = stateAtFirstEvent(seed);
      const lean = biomeFor(state.seed, node.wave, node.biomeId).lean;
      const counter = counterTypeFor(lean);
      if (counter === undefined) continue; // the bow band — covered below
      const { outcome } = resolveEventChoice({ ...state, gold: 5 }, 'the_lands_measure', 'hunters_edge');
      expect(outcome.kind).toBe('bonusDraft');
      if (outcome.kind !== 'bonusDraft') continue;
      for (const card of outcome.cards) {
        const skill = skillBook[card.skillId]!;
        const carried = lean.kind === 'element' ? skill.element : skill.weapon;
        expect(carried, `seed ${seed}: ${card.skillId} is not the counter ${counter}`).toBe(counter);
      }
      checked += 1;
    }
    expect(checked, 'every probed band was the counterless one — add seeds').toBeGreaterThan(0);
  });

  it("on the counterless (bow-lean) band the hunter's door is DARK — and the known-gap resolve path falls back instead of throwing", () => {
    const bowBiome = biomeIds.find((id) => {
      const lean = biomeCatalog[id]!.lean;
      return counterTypeFor(lean) === undefined;
    });
    expect(bowBiome, 'no counterless biome left — this dark-rung case needs redesign, not deletion').toBeDefined();
    const { state } = stateAtFirstEvent(4);
    const node = currentEventNodeOrThrow(state);
    const rigged: RunState = { ...state, gold: 5, map: replaceNode(state.map, { ...node, biomeId: bowBiome }) };
    const huntersEdge = eventCatalog.the_lands_measure!.choices.find((c) => c.id === 'hunters_edge')!;
    const localMake = eventCatalog.the_lands_measure!.choices.find((c) => c.id === 'local_make')!;
    expect(isEventChoiceUsable(rigged, huntersEdge)).toBe(false); // dark: nothing counters bow
    expect(isEventChoiceUsable(rigged, localMake)).toBe(true); // the lean door still lit
    // Known-gap posture: resolving anyway falls back to the unfiltered book.
    const { outcome } = resolveEventChoice(rigged, 'the_lands_measure', 'hunters_edge');
    expect(outcome.kind).toBe('bonusDraft');
    if (outcome.kind === 'bonusDraft') expect(outcome.cards).toHaveLength(EVENT_CHOICE_SIZE);
  });

  it('banner_scribe/blazon follows the board identity — dark on an uncommitted board, the committed type on every offer once it exists', () => {
    const { state } = stateAtFirstEvent(4);
    const blazon = eventCatalog.banner_scribe!.choices.find((c) => c.id === 'blazon')!;

    // Uncommitted: no 3-of-a-kind anywhere on the board.
    const bare: RunState = { ...state, gold: 5, pieces: [], bagSlots: [] };
    expect(isEventChoiceUsable(bare, blazon)).toBe(false);

    // Committed to sword: three sword cards on the board light the door and
    // fix its pool.
    const swords = Object.values(skillBook).filter((s) => s.weapon === 'sword' && s.element === undefined).slice(0, 3);
    expect(swords.length).toBe(3);
    const committed: RunState = {
      ...bare,
      pieces: swords.map((s, i) => ({ instanceId: `sw_${i}`, skillId: s.id, tier: 'bronze' as const, slot: i })),
    };
    expect(isEventChoiceUsable(committed, blazon)).toBe(true);
    const { outcome } = resolveEventChoice(committed, 'banner_scribe', 'blazon');
    expect(outcome.kind).toBe('bonusDraft');
    if (outcome.kind !== 'bonusDraft') return;
    expect(outcome.cards).toHaveLength(EVENT_CHOICE_SIZE);
    for (const card of outcome.cards) {
      expect(skillBook[card.skillId]!.weapon, `${card.skillId} is off-blazon`).toBe('sword');
    }

    // Element identities resolve through the same seam (element takes
    // priority in cardType, so three fire cards read as a fire board).
    const fires = Object.values(skillBook).filter((s) => s.element === 'fire').slice(0, 3);
    expect(fires.length).toBe(3);
    const fireBoard: RunState = {
      ...bare,
      pieces: fires.map((s, i) => ({ instanceId: `fi_${i}`, skillId: s.id, tier: 'bronze' as const, slot: i })),
    };
    const fireFilter = resolveFilterFrom(fireBoard, null, 'boardIdentity');
    expect(fireFilter).toEqual([{ elements: ['fire'] }]);
  });

  it('banner_scribe/blazon offers BOTH axes on a dual-affinity board (3 fire + 3 sword) — a union, not the element-first collapse', () => {
    const { state } = stateAtFirstEvent(4);
    const blazon = eventCatalog.banner_scribe!.choices.find((c) => c.id === 'blazon')!;
    const bare: RunState = { ...state, gold: 5, pieces: [], bagSlots: [] };

    const swords = Object.values(skillBook).filter((s) => s.weapon === 'sword' && s.element === undefined).slice(0, 3);
    const fires = Object.values(skillBook).filter((s) => s.element === 'fire').slice(0, 3);
    expect(swords.length).toBe(3);
    expect(fires.length).toBe(3);
    const dualBoard: RunState = {
      ...bare,
      pieces: [
        ...swords.map((s, i) => ({ instanceId: `sw_${i}`, skillId: s.id, tier: 'bronze' as const, slot: i })),
        ...fires.map((s, i) => ({ instanceId: `fi_${i}`, skillId: s.id, tier: 'bronze' as const, slot: swords.length + i })),
      ],
    };

    // The board earns BOTH affinities, so the derived pool is the UNION of
    // both clauses — order is element-first (`boardAffinities`' own field
    // order), matching `boardTypeIdentity`'s existing element-first display
    // precedence, but this is a union of the pool, not a choice of one.
    const dualFilter = resolveFilterFrom(dualBoard, null, 'boardIdentity');
    expect(dualFilter).toEqual([{ elements: ['fire'] }, { weapons: ['sword'] }]);

    // Real cards of EITHER earned type satisfy the derived filter — proof the
    // gate is a union, not a single-type door a dual-affinity player can only
    // half-use.
    const pureFireCard = fires[0]!;
    const pureSwordCard = swords[0]!;
    expect(cardMatchesFilter(pureFireCard, dualFilter!)).toBe(true);
    expect(cardMatchesFilter(pureSwordCard, dualFilter!)).toBe(true);
    // A card off both axes (frost, no sword) still fails — the union does
    // not degrade into "anything goes".
    const frostCard = Object.values(skillBook).find((s) => s.element === 'frost')!;
    expect(cardMatchesFilter(frostCard, dualFilter!)).toBe(false);

    // The door itself is usable and end-to-end resolution only ever deals
    // cards that carry one of the two earned types.
    expect(isEventChoiceUsable(dualBoard, blazon)).toBe(true);
    const { outcome } = resolveEventChoice(dualBoard, 'banner_scribe', 'blazon');
    expect(outcome.kind).toBe('bonusDraft');
    if (outcome.kind !== 'bonusDraft') return;
    for (const card of outcome.cards) {
      const skill = skillBook[card.skillId]!;
      const onBlazon = skill.element === 'fire' || skill.weapon === 'sword';
      expect(onBlazon, `${card.skillId} is off both earned axes (fire, sword)`).toBe(true);
    }
  });
});
