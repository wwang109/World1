import { BAND_WAVES } from './biome';
import type { RunState } from './runState';

export interface RunCalendar {
  absoluteDay: number;
  regionDay: number;
  stop: number;
}

export function regionDayFor(absoluteDay: number): number {
  const day = Number.isFinite(absoluteDay) ? Math.max(1, Math.floor(absoluteDay)) : 1;
  return ((day - 1) % BAND_WAVES) + 1;
}

function currentNodeWave(state: Readonly<RunState>): number | undefined {
  if (state.currentNodeId === null) return undefined;
  for (let depth = 0; depth < state.map.depths.length; depth++) {
    const column = state.map.depths[depth]!;
    for (let index = 0; index < column.length; index++) {
      const node = column[index]!;
      if (node.id === state.currentNodeId) return node.wave;
    }
  }
  return undefined;
}

function columnWave(state: Readonly<RunState>, depth: number): number | undefined {
  return state.map.depths[depth]?.[0]?.wave;
}

/** Reads only the already-materialized map; it never generates or mutates it. */
export function runCalendar(state: Readonly<RunState>): RunCalendar {
  const stop = Math.max(0, Math.floor(state.depth));
  const selectedWave =
    currentNodeWave(state)
      ?? (state.status === 'active' ? columnWave(state, stop + 1) : undefined)
      ?? ((state.status === 'defeat' || state.status === 'retired' || state.status === 'victory')
        ? columnWave(state, stop)
        : undefined)
      ?? 1;
  const absoluteDay = Number.isFinite(selectedWave) ? Math.max(1, Math.floor(selectedWave)) : 1;
  return { absoluteDay, regionDay: regionDayFor(absoluteDay), stop };
}
