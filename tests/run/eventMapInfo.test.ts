import { describe, expect, it } from 'vitest';
import { forecastBand } from '../../src/run/biomeForecast';
import { bandIndexOf } from '../../src/run/biome';
import { applyGrantMapInfo, mapInfoRevealsAnything, mapIntelRecords } from '../../src/run/eventMapInfo';
import { recordEventInstance } from '../../src/run/eventInstances';
import { choiceLockReason, isEventChoiceUsable, resolveEventChoice } from '../../src/run/events';
import type { RunNode, RunState } from '../../src/run/runState';
import { activeRun, featheredCairnDef, installCurrentNode, roundTrip } from '../fixtures/eventV2';

function stableRandomState(state: RunState) {
  return JSON.stringify({
    seed: state.seed,
    map: state.map,
    eventBag: state.eventBag,
    eventBagRefills: state.eventBagRefills,
    eventThemeBags: state.eventThemeBags,
    eventThemeBagRefills: state.eventThemeBagRefills,
  });
}

describe('run/eventMapInfo', () => {
  it('uses a drift baseline that cannot share mutable bag state with its source', () => {
    const state = activeRun(1103);
    const baseline = stableRandomState(state);
    state.eventBag.push('mutated-event');
    state.eventThemeBags!.cache = ['mutated-theme'];
    state.eventThemeBagRefills!.cache = 1;

    expect(stableRandomState(state)).not.toEqual(baseline);
    expect(JSON.parse(baseline)).toEqual({
      seed: state.seed,
      map: state.map,
      eventBag: [],
      eventBagRefills: 0,
      eventThemeBags: {},
      eventThemeBagRefills: {},
    });
  });

  it('snapshots exact future forecasts without moving real map or event random state', () => {
    const before = activeRun(1103);
    const randomStateBefore = stableRandomState(before);
    const next = applyGrantMapInfo(before, 'source-d1', 1, 2);

    expect(next.mapIntelByBand).toEqual({
      '2': { band: 2, sourceEventInstanceId: 'source-d1', snapshot: forecastBand(before, 2) },
      '3': { band: 3, sourceEventInstanceId: 'source-d1', snapshot: forecastBand(before, 3) },
    });
    expect(stableRandomState(next)).toEqual(randomStateBefore);
    expect(before.mapIntelByBand).toEqual({});
    expect(before.appliedMapInfoSourceIds).toEqual([]);
  });

  it('keeps existing snapshots, remembers successful sources once, and returns bands in numeric order', () => {
    const before = activeRun(1103);
    const first = applyGrantMapInfo(before, 'source-band-2', 2, 2);
    const overlapping = applyGrantMapInfo(first, 'source-band-1', 1, 3);
    const repeat = applyGrantMapInfo(overlapping, 'source-band-1', 0, 3);
    const fullyCovered = applyGrantMapInfo(overlapping, 'source-covered', 1, 3);

    expect(mapIntelRecords(overlapping).map((record) => record.band)).toEqual([2, 3, 4]);
    expect(overlapping.mapIntelByBand['3']!.sourceEventInstanceId).toBe('source-band-2');
    expect(overlapping.mapIntelByBand['2']!.sourceEventInstanceId).toBe('source-band-1');
    expect(overlapping.appliedMapInfoSourceIds).toEqual(['source-band-2', 'source-band-1']);
    expect(repeat).toBe(overlapping);
    expect(fullyCovered).toBe(overlapping);
  });

  it('reads the persisted snapshot after a JSON reload instead of forecasting it again', () => {
    const stored = applyGrantMapInfo(activeRun(1103), 'source-d1', 1, 2);
    const savedRecords = mapIntelRecords(stored);
    const reloaded = roundTrip(stored);
    const changedMapSeed = { ...reloaded, map: { ...reloaded.map, seed: reloaded.map.seed + 1 } };

    expect(mapIntelRecords(reloaded)).toEqual(savedRecords);
    expect(mapIntelRecords(changedMapSeed)).toEqual(savedRecords);
  });

  it('resolves grantMapInfo from the committed instance and source wave, independent of presentation copy', () => {
    const node: RunNode = {
      id: 'map-info-node', depth: 3, wave: 6, kind: 'event', eventSeed: 99, eventTheme: 'cache', biomeId: 'arrowfell',
    };
    const source = recordEventInstance(installCurrentNode(activeRun(1103), node), node.id, {
      eventId: 'feathered_cairn', contentVersion: 1, instanceId: 'committed-map-source', drawnDepth: node.depth,
    });
    const copy = JSON.parse(JSON.stringify(featheredCairnDef)) as typeof featheredCairnDef;
    copy.title = 'Changed heading';
    copy.body = 'Changed body only.';
    for (const choice of copy.choices) choice.label = `Changed ${choice.id}`;

    const original = resolveEventChoice(source, 'feathered_cairn', 'read_feathers', () => featheredCairnDef);
    const rewritten = resolveEventChoice(source, 'feathered_cairn', 'read_feathers', () => copy);

    expect(original.outcome).toEqual(rewritten.outcome);
    expect(original.state).toEqual(rewritten.state);
    expect(mapIntelRecords(original.state)).toMatchObject([
      { band: 2, sourceEventInstanceId: 'committed-map-source' },
      { band: 3, sourceEventInstanceId: 'committed-map-source' },
    ]);
  });
});

/**
 * REVEAL N BANDS CAN REVEAL NOTHING (2026-09-06) — two overlapping map-info
 * events (`feathered_cairn` 2, `whiteout_guidance` 2, `feathered_cairn_far_sight`
 * 3, `missing_road_destination` 3 in the live catalog) can leave a
 * `grantMapInfo` rung with every one of its target bands already recorded.
 * `mapInfoRevealsAnything` is the pure predicate; `choiceLockReason` is where
 * it gates the rung, mirroring `applyGrantMapInfo`'s own scan exactly so a
 * locked rung and what it would actually do can never disagree.
 */
describe('run/eventMapInfo: mapInfoRevealsAnything', () => {
  it('is true while at least one target band is unrecorded, false once the whole range is already known', () => {
    const before = activeRun(1103);
    expect(mapInfoRevealsAnything(before, 1, 2)).toBe(true); // bands 2,3 — nothing recorded yet
    const covered = applyGrantMapInfo(before, 'source-a', 1, 2); // records bands 2,3
    expect(mapInfoRevealsAnything(covered, 1, 2)).toBe(false); // same range, now fully known
    expect(mapInfoRevealsAnything(covered, 0, 3)).toBe(true); // bands 1,2,3 — band 1 is still new
  });
});

describe('run/events: choiceLockReason gates a grantMapInfo rung with nothing new to reveal', () => {
  it('locks "Read the marks" once its exact target bands are already recorded, and a PARTIAL overlap stays open', () => {
    const node: RunNode = {
      id: 'map-info-lock-node', depth: 3, wave: 6, kind: 'event', eventSeed: 99, eventTheme: 'cache', biomeId: 'arrowfell',
    };
    const state = installCurrentNode(activeRun(1103), node);
    const readFeathers = featheredCairnDef.choices.find((c) => c.id === 'read_feathers')!;
    expect(readFeathers.outcome.kind).toBe('grantMapInfo');
    expect(choiceLockReason(state, readFeathers)).toBeNull();
    expect(isEventChoiceUsable(state, readFeathers)).toBe(true);

    // `bandIndexOf(node.wave)` is the exact source-band read
    // `resolveEventOutcomeSpec`'s own `grantMapInfo` case (`events.ts`) uses;
    // recording BOTH bands the choice's `bandsAhead: 2` targets locks it.
    const sourceBand = bandIndexOf(node.wave);
    const covered = applyGrantMapInfo(state, 'already-covered', sourceBand, 2);
    expect(choiceLockReason(covered, readFeathers)).toBe('nothing new to reveal');
    expect(isEventChoiceUsable(covered, readFeathers)).toBe(false);

    // A PARTIAL overlap — only the FIRST of the two target bands already
    // known — still reads as usable: real new ground remains.
    const firstBandKey = String(sourceBand + 1);
    const firstBandOnly: RunState = {
      ...state,
      mapIntelByBand: { [firstBandKey]: covered.mapIntelByBand[firstBandKey]! },
    };
    expect(choiceLockReason(firstBandOnly, readFeathers)).toBeNull();
    expect(isEventChoiceUsable(firstBandOnly, readFeathers)).toBe(true);
  });
});
