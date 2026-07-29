import { describe, expect, it } from 'vitest';
import { createRun } from '../../src/run/runState';
import { notifyTutorial } from '../../src/game/tutorial/controller';
import { TUTORIAL_STEPS } from '../../src/game/tutorial/steps';

describe('tutorial controller (notifyTutorial)', () => {
  it('fires the registered step(s) for a moment, in registry order, and marks them seen', () => {
    const run = createRun(1);
    const { state, steps } = notifyTutorial(run, 'battle:hit', {});
    expect(steps.map((s) => s.id)).toEqual(['stats_damage_1']);
    expect(state.tutorialSeen).toContain('stats_damage_1');
  });

  it('a step fires at most once per run: the SAME moment never re-fires the same step', () => {
    let run = createRun(2);
    const first = notifyTutorial(run, 'battle:hit', {});
    run = first.state;
    expect(first.steps).toHaveLength(1);
    const second = notifyTutorial(run, 'battle:hit', {});
    expect(second.steps).toHaveLength(0);
    expect(second.state).toBe(run); // no-op — same reference.
  });

  it('a skipped run never arms any step for any moment', () => {
    const run = createRun(3);
    const skipped = { ...run, tutorialSkipped: true };
    for (const step of TUTORIAL_STEPS) {
      const { steps } = notifyTutorial(skipped, step.moment, { hasMatchup: true, hasSpan: true });
      expect(steps).toHaveLength(0);
    }
  });

  it('a `when` gate holds a step back until its condition is met, without marking it seen', () => {
    let run = createRun(4);
    // hitMatchup requires payload.hasMatchup === true; a non-matchup hit must
    // not arm (or mark seen) the matchup beat.
    const noMatchup = notifyTutorial(run, 'battle:hitMatchup', { hasMatchup: false });
    expect(noMatchup.steps).toHaveLength(0);
    run = noMatchup.state;
    expect(run.tutorialSeen ?? []).not.toContain('stats_damage_2');

    const withMatchup = notifyTutorial(run, 'battle:hitMatchup', { hasMatchup: true });
    expect(withMatchup.steps.map((s) => s.id)).toEqual(['stats_damage_2']);
  });

  it('fires ALL not-yet-seen steps registered for a moment, in order (the PL grid + card-cost beats)', () => {
    const run = createRun(5);
    const { steps } = notifyTutorial(run, 'runmap:statPanelOpen', {});
    expect(steps.map((s) => s.id)).toEqual(['pl_grid', 'pl_cardcost']);
  });

  it('only ever arms steps registered under the notified moment', () => {
    const run = createRun(6);
    const { steps } = notifyTutorial(run, 'runmap:plBadge', {});
    expect(steps.map((s) => s.id)).toEqual(['pl_badge']);
  });

  it('is pure: never mutates the RunState passed in', () => {
    const run = createRun(7);
    const before = JSON.stringify(run);
    notifyTutorial(run, 'battle:turnline', { hasSpan: false });
    expect(JSON.stringify(run)).toBe(before);
  });
});
