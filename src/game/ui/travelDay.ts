import { BAND_WAVES } from '../../run/biome';
import { regionDayFor } from '../../run/runCalendar';

/** Display-only region cadence; run progression keeps its absolute days. */
export const EXPEDITION_DAYS = BAND_WAVES;

export function expeditionDay(absoluteDay: number): number {
  return regionDayFor(absoluteDay);
}

export function daysUntilBoss(absoluteDay: number): number {
  return EXPEDITION_DAYS - expeditionDay(absoluteDay);
}
