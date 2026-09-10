import { describe, expect, it } from 'vitest';
import { regionDayFor } from '../../src/run/runCalendar';
import { daysUntilBoss, expeditionDay } from '../../src/game/ui/travelDay';

describe('exploration days', () => {
  it.each([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 1], [10, 5], [11, 1], [99, 4]])(
    'shows wave %i as region day %i instead of an absolute wave number', (wave, day) => {
      expect(expeditionDay(wave)).toBe(day);
    },
  );

  it.each([[1, 1], [5, 5], [6, 1]])(
    'uses the shared run-calendar region day for absolute day %i', (absoluteDay, expected) => {
      expect(expeditionDay(absoluteDay)).toBe(expected);
      expect(expeditionDay(absoluteDay)).toBe(regionDayFor(absoluteDay));
    },
  );

  it.each([0, -1, -10, NaN, Infinity, -Infinity, 1.5])(
    'keeps invalid wave %s at day 1 instead of showing an impossible day', (wave) => {
      expect(expeditionDay(wave)).toBe(1);
      expect(daysUntilBoss(wave)).toBe(4);
    },
  );

  it.each([[1, 4], [2, 3], [3, 2], [4, 1], [5, 0], [6, 4], [9, 1], [10, 0], [11, 4]])(
    'shows %i with %i days until the boss, resetting after each boss day', (wave, days) => {
      expect(daysUntilBoss(wave)).toBe(days);
    },
  );
});
