import { describe, expect, it } from 'vitest';
import {
  clearRun,
  getActiveRun,
  notifyTutorialMoment,
  skipTutorial,
  startRun,
  tutorialChipVisible,
} from '../../src/game/runStore';
import { TUTORIAL_STEPS } from '../../src/game/tutorial/steps';

describe('runStore tutorial wrappers', () => {
  it('no-op with no active run: notify/skip/chip all behave inertly', () => {
    clearRun();
    expect(notifyTutorialMoment('battle:hit', {})).toEqual([]);
    expect(tutorialChipVisible()).toBe(false);
    skipTutorial(); // must not throw with no active run.
    expect(getActiveRun()).toBeNull();
  });

  it('fires a step at most once across repeated notifies for the active run', () => {
    startRun(101);
    const first = notifyTutorialMoment('battle:hit', {});
    expect(first.map((s) => s.id)).toEqual(['stats_damage_1']);
    const second = notifyTutorialMoment('battle:hit', {});
    expect(second).toEqual([]);
    clearRun();
  });

  it('the entry chip is visible for a fresh run and disappears once skipped', () => {
    startRun(102);
    expect(tutorialChipVisible()).toBe(true);
    skipTutorial();
    expect(tutorialChipVisible()).toBe(false);
    // Skipping also stops any further step from arming.
    expect(notifyTutorialMoment('battle:hit', {})).toEqual([]);
    clearRun();
  });

  it('the entry chip disappears once every step has been seen', () => {
    startRun(103);
    for (const step of TUTORIAL_STEPS) {
      notifyTutorialMoment(step.moment, { hasMatchup: true, hasSpan: true });
    }
    expect(tutorialChipVisible()).toBe(false);
    clearRun();
  });
});
