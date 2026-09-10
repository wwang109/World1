import { describe, expect, it } from 'vitest';
import { runCalendar, regionDayFor } from '../../src/run/runCalendar';
import { createRun, type RunState } from '../../src/run/runState';
import type { RunNode } from '../../src/run/runMap';

const node = (id: string, depth: number, wave: number): RunNode => ({ id, depth, wave, kind: 'event', eventSeed: 1 });

function stateAt(input: {
  status: RunState['status'];
  depth: number;
  currentNodeId: string | null;
  depths: RunNode[][];
}): RunState {
  const state = createRun(71);
  return {
    ...state,
    status: input.status,
    depth: input.depth,
    currentNodeId: input.currentNodeId,
    map: { ...state.map, depths: input.depths },
  };
}

describe('run calendar', () => {
  it.each([
    [1, 1],
    [5, 5],
    [6, 1],
  ])('maps absolute day %i to literal region day %i', (absoluteDay, regionDay) => {
    expect(regionDayFor(absoluteDay)).toBe(regionDay);
  });

  it('starts before the first choice at absolute day 1, region day 1, and stop 0', () => {
    const state = stateAt({ status: 'drafting', depth: 0, currentNodeId: null, depths: [[]] });

    expect(runCalendar(state)).toEqual({ absoluteDay: 1, regionDay: 1, stop: 0 });
  });

  it('uses the occupied current node wave as the active absolute day', () => {
    const state = stateAt({
      status: 'active', depth: 8, currentNodeId: 'd8-0',
      depths: [[], [node('d1-0', 1, 1)], [], [], [], [], [], [], [node('d8-0', 8, 5)]],
    });

    expect(runCalendar(state)).toEqual({ absoluteDay: 5, regionDay: 5, stop: 8 });
  });

  it('uses the next available column without generating or mutating the map', () => {
    const state = stateAt({
      status: 'active', depth: 14, currentNodeId: null,
      depths: [
        [], [node('d1-0', 1, 1)], [], [], [], [], [], [], [], [], [], [], [], [],
        [node('d14-0', 14, 5)], [node('d15-0', 15, 6)],
      ],
    });
    const before = JSON.stringify(state.map);

    expect(runCalendar(state)).toEqual({ absoluteDay: 6, regionDay: 1, stop: 14 });
    expect(JSON.stringify(state.map)).toBe(before);
  });

  it('uses the last resolved wave after the run ends, never depth as a day', () => {
    const state = stateAt({
      status: 'defeat', depth: 14, currentNodeId: null,
      depths: [
        [], [node('d1-0', 1, 1)], [], [], [], [], [], [], [], [], [], [], [], [],
        [node('d14-0', 14, 6)], [node('d15-0', 15, 7)],
      ],
    });

    expect(runCalendar(state)).toEqual({ absoluteDay: 6, regionDay: 1, stop: 14 });
  });

  it('falls back to day 1 when a selected persisted node has a non-finite wave', () => {
    const state = stateAt({
      status: 'active', depth: 1, currentNodeId: 'd1-0',
      depths: [[], [node('d1-0', 1, NaN)]],
    });

    expect(runCalendar(state)).toEqual({ absoluteDay: 1, regionDay: 1, stop: 1 });
  });
});
