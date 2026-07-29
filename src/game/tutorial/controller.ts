import { isTutorialSkipped, isTutorialStepSeen, markTutorialSeen, type RunState } from '../../run/runState';
import { TUTORIAL_STEPS } from './steps';
import type { ArmedTutorialCard, TutorialMoment, TutorialStepDef } from './types';

/** Pairs freshly-fired steps with the payload that fired them, so a queued
 * card's `step.body(payload)` always reads the SAME live values the notify()
 * call passed in — never a blank/shared object. */
export function armCards(steps: readonly TutorialStepDef[], payload: Record<string, unknown>): ArmedTutorialCard[] {
  return steps.map((step) => ({ step, payload }));
}

/**
 * Pure tutorial core — operates on a plain `RunState` in, `RunState` out (no
 * Phaser, no module-level singleton; `../runStore.ts` wraps this around the
 * active run for scenes to call). Kept pure and side-effect-free so it's
 * directly unit-testable without booting a scene.
 */
export interface TutorialNotifyResult {
  state: RunState;
  /** Steps that just fired, in registry order — each is ALREADY marked seen
   * on `state` (a step is "fired" the instant it's returned, not on some
   * later dismiss click — see docs/run-tutorial-design.md's "fires at most
   * once" guarantee: this makes that true regardless of whether the player
   * ever taps GOT IT). Empty when nothing new armed (already seen, run
   * skipped, or no step is registered for `moment`). */
  steps: TutorialStepDef[];
}

/**
 * Call once per occurrence of `moment` (a scene may call it every render —
 * it is idempotent beyond the first successful fire, since every returned
 * step is marked seen on the spot). Returns EVERY not-yet-seen step
 * registered for `moment` whose `when` gate (if any) passes `payload`, in
 * registry order — usually 0 or 1, sometimes more (e.g. the PL lesson's
 * grid + card-cost beats both fire off `runmap:statPanelOpen`).
 */
export function notifyTutorial(
  state: RunState,
  moment: TutorialMoment,
  payload: Record<string, unknown> = {},
): TutorialNotifyResult {
  if (isTutorialSkipped(state)) return { state, steps: [] };
  let next = state;
  const fired: TutorialStepDef[] = [];
  for (const step of TUTORIAL_STEPS) {
    if (step.moment !== moment) continue;
    if (isTutorialStepSeen(next, step.id)) continue;
    if (step.when && !step.when(payload)) continue;
    next = markTutorialSeen(next, step.id);
    fired.push(step);
  }
  return { state: next, steps: fired };
}
