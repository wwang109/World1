import { describe, expect, it } from 'vitest';
import { eventCatalog, eventRuntimeCatalog, type EventDef, type EventTallyGate } from '../../src/data/events';
import { isEventDefV3 } from '../../src/data/eventContentV3';
import { eventRequirementReceipt } from '../../src/run/eventRequirementReceipt';
import { createRun, type EventResolution, type RunState } from '../../src/run/runState';

function fixtureEvent(overrides: Partial<EventDef> = {}): EventDef {
  return {
    id: 'receipt-fixture', title: 'Receipt fixture', body: '', theme: 'cache',
    choices: [{ id: 'leave', label: 'Leave', outcome: { kind: 'nothing' } }],
    ...overrides,
  };
}

function resolution(eventId: string, choiceId: string): EventResolution {
  return { eventId, choiceId, contentVersion: 1, instanceId: `past:${eventId}:${choiceId}` };
}

function runWithResolutions(...resolutions: EventResolution[]): RunState {
  return {
    ...createRun(404),
    eventResolutions: Object.fromEntries(resolutions.map((entry, index) => [`past-${index}`, entry])),
  };
}

describe('eventRequirementReceipt', () => {
  it('leaves ungated events without receipts', () => {
    expect(eventRequirementReceipt(createRun(404), fixtureEvent())).toEqual([]);
  });

  it('names a completed event without appending an unrestricted choice', () => {
    const state = runWithResolutions(resolution('bell_beneath_ice', 'prise_it_free'));
    expect(eventRequirementReceipt(state, fixtureEvent({ requires: { eventId: 'bell_beneath_ice' } })))
      .toEqual(['Completed: The Bell Beneath the Ice']);
  });

  it('names the accepted resolved choice and strips its trailing price', () => {
    const state = runWithResolutions(
      resolution('abandoned_cache', 'open'),
      resolution('abandoned_cache', 'search_thoroughly'),
    );
    expect(eventRequirementReceipt(state, fixtureEvent({
      requires: { eventId: 'abandoned_cache', choiceIds: ['search_thoroughly', 'leave'] },
    }))).toEqual(['Completed: Abandoned Cache — Search it thoroughly']);
  });

  it('counts a committed choice with its deferred picker still pending', () => {
    const state = runWithResolutions({ ...resolution('bell_beneath_ice', 'prise_it_free'), pending: true });
    expect(eventRequirementReceipt(state, fixtureEvent({
      requires: { eventId: 'bell_beneath_ice', choiceIds: ['prise_it_free'] },
    }))).toEqual(['Completed: The Bell Beneath the Ice — Prise the frost bell free']);
  });

  const tallies: Array<[EventTallyGate['stat'], number, string]> = [
    ['goldSpent', 1, 'Spent 1 gold'], ['goldSpent', 4, 'Spent 4 gold'],
    ['cardsBought', 1, 'Bought 1 card'], ['cardsBought', 4, 'Bought 4 cards'],
    ['gemsBought', 1, 'Bought 1 gem'], ['gemsBought', 4, 'Bought 4 gems'],
    ['livesLost', 1, 'Lost 1 life'], ['livesLost', 4, 'Lost 4 lives'],
    ['wins', 1, 'Won 1 fight'], ['wins', 4, 'Won 4 fights'],
    ['losses', 1, 'Suffered 1 defeat'], ['losses', 4, 'Suffered 4 defeats'],
    ['bossesCleared', 1, 'Defeated 1 boss'], ['bossesCleared', 4, 'Defeated 4 bosses'],
  ];

  it.each(tallies)('formats persisted %s = %i as %s', (stat, value, expected) => {
    const initial = createRun(404);
    const state: RunState = stat === 'wins' || stat === 'losses' || stat === 'bossesCleared'
      ? { ...initial, [stat]: value }
      : { ...initial, stats: { ...initial.stats, [stat]: value } };
    expect(eventRequirementReceipt(state, fixtureEvent({ requiresTally: { stat, atLeast: 1 } })))
      .toEqual([expected]);
  });

  it('preserves mixed requiresAll authored order, independent of resolution insertion order', () => {
    const state = { ...runWithResolutions(
      resolution('abandoned_cache', 'open'),
      resolution('bell_beneath_ice', 'prise_it_free'),
    ), losses: 2 };
    const event = fixtureEvent({ requiresAll: [
      { kind: 'resolution', eventId: 'bell_beneath_ice' },
      { kind: 'tally', stat: 'losses', atLeast: 1 },
      { kind: 'resolution', eventId: 'abandoned_cache', choiceIds: ['open'] },
    ] });
    const before = structuredClone({ state, event });
    expect(eventRequirementReceipt(state, event)).toEqual([
      'Completed: The Bell Beneath the Ice',
      'Suffered 2 defeats',
      'Completed: Abandoned Cache — Pry it open',
    ]);
    expect({ state, event }).toEqual(before);
  });

  it('renders the catalog Bell conjunction using its authored choices', () => {
    const state = runWithResolutions(
      resolution('bell_beneath_ice', 'prise_it_free'),
      resolution('the_second_toll', 'answer_the_bell'),
    );
    expect(eventRequirementReceipt(state, eventCatalog.the_bell_unbound!)).toEqual([
      'Completed: The Bell Beneath the Ice — Prise the frost bell free',
      'Completed: The Second Toll — Answer with your own name',
    ]);
  });

  it('suppresses every line when any conjunct is unmet', () => {
    const state = runWithResolutions(resolution('bell_beneath_ice', 'prise_it_free'));
    expect(eventRequirementReceipt(state, fixtureEvent({ requiresAll: [
      { kind: 'resolution', eventId: 'bell_beneath_ice' },
      { kind: 'tally', stat: 'losses', atLeast: 2 },
    ] }))).toEqual([]);
  });

  it('checks all legacy gate fields before emitting any receipt', () => {
    const state = runWithResolutions(resolution('bell_beneath_ice', 'prise_it_free'));
    expect(eventRequirementReceipt(state, fixtureEvent({
      requires: { eventId: 'bell_beneath_ice' },
      requiresTally: { stat: 'losses', atLeast: 2 },
      requiresAll: [{ kind: 'resolution', eventId: 'bell_beneath_ice' }],
    }))).toEqual([]);
  });

  it('does not accept another choice on the required event', () => {
    const state = runWithResolutions(resolution('bell_beneath_ice', 'leave_it_sleeping'));
    expect(eventRequirementReceipt(state, fixtureEvent({
      requires: { eventId: 'bell_beneath_ice', choiceIds: ['prise_it_free'] },
    }))).toEqual([]);
  });

  it('omits only the unavailable definition or choice line', () => {
    const state = { ...runWithResolutions(
      resolution('missing-event', 'missing-choice'),
      resolution('bell_beneath_ice', 'missing-choice'),
    ), losses: 2 };
    expect(eventRequirementReceipt(state, fixtureEvent({ requiresAll: [
      { kind: 'resolution', eventId: 'missing-event' },
      { kind: 'resolution', eventId: 'bell_beneath_ice', choiceIds: ['missing-choice'] },
      { kind: 'tally', stat: 'losses', atLeast: 1 },
    ] }))).toEqual(['Suffered 2 defeats']);
  });

  it('leaves V3 eligibility ASTs without speculative receipts', () => {
    const event = eventRuntimeCatalog.feathered_cairn!;
    expect(isEventDefV3(event)).toBe(true);
    expect(eventRequirementReceipt(createRun(404), event)).toEqual([]);
  });
});
