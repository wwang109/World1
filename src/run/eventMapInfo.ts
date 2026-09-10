import { forecastBand } from './biomeForecast';
import type { MapIntelRecord, RunState } from './runState';

/**
 * Records immutable forecast snapshots for the bands immediately after an
 * event's source band. This only reads the pure forecast seam: map topology
 * and every random-state bag remain untouched.
 */
export function applyGrantMapInfo(
  state: RunState,
  sourceEventInstanceId: string,
  sourceBand: number,
  bandsAhead: 2 | 3,
): RunState {
  if (state.appliedMapInfoSourceIds.includes(sourceEventInstanceId)) return state;

  const mapIntelByBand = { ...state.mapIntelByBand };
  const firstBand = Math.max(0, Math.floor(sourceBand)) + 1;
  let added = false;
  for (let band = firstBand; band < firstBand + bandsAhead; band += 1) {
    const key = String(band);
    if (mapIntelByBand[key]) continue;
    mapIntelByBand[key] = {
      band,
      sourceEventInstanceId,
      snapshot: forecastBand(state, band),
    };
    added = true;
  }

  if (!added) return state;
  return {
    ...state,
    mapIntelByBand,
    appliedMapInfoSourceIds: [...state.appliedMapInfoSourceIds, sourceEventInstanceId],
  };
}

/** Persisted map intel in display-independent numeric band order. */
export function mapIntelRecords(state: RunState): readonly MapIntelRecord[] {
  return Object.values(state.mapIntelByBand).sort((left, right) => left.band - right.band);
}

/**
 * Whether granting `bandsAhead` bands of intel from `sourceBand` would add AT
 * LEAST ONE band this run has not already recorded — the gate a
 * `grantMapInfo` rung needs before it offers "REVEAL N BANDS" when every one
 * of those N is already known (two overlapping map-info events, e.g.
 * `feathered_cairn` then `feathered_cairn_far_sight`, can easily cover the
 * same band twice). Mirrors `applyGrantMapInfo`'s own scan exactly — same
 * `firstBand`, same half-open range — so a locked rung and what the rung
 * would actually do can never disagree. A PARTIAL overlap (some but not all
 * of the range already known) still reads as usable: real new ground is
 * still delivered, just not the full N bands' worth.
 *
 * Pure read, no `Rng`, no state change.
 */
export function mapInfoRevealsAnything(state: RunState, sourceBand: number, bandsAhead: 2 | 3): boolean {
  const firstBand = Math.max(0, Math.floor(sourceBand)) + 1;
  for (let band = firstBand; band < firstBand + bandsAhead; band += 1) {
    if (!state.mapIntelByBand[String(band)]) return true;
  }
  return false;
}
