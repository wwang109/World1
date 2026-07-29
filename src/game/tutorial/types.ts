/**
 * Run-mode tutorial — shared shapes. See `steps.ts` for the registry and
 * `controller.ts` for the tiny stateful piece that decides what fires when.
 * Nothing here touches Phaser or combat: a step is pure data, and the
 * controller only reads `RunState.tutorialSeen`/`tutorialSkipped` (via
 * `src/run/runState`'s pure helpers) plus whatever payload the calling scene
 * hands it — it NEVER recomputes combat math.
 */

/** The game moment a step is offered at. Scenes call `notifyAll(moment, …)`
 * at most once per relevant occurrence; the controller decides (from
 * `RunState`) which, if any, not-yet-seen steps for that moment fire. */
export type TutorialMoment =
  | 'battle:hit'
  | 'battle:hitMatchup'
  | 'battle:turnline'
  | 'battle:levelUp'
  | 'runmap:plBadge'
  | 'runmap:statPanelOpen';

/** Which UI element a step's pointer card anchors to — resolved by the
 * HOST scene into a screen-space rect (`TutorialAnchorRect`) every render;
 * a step whose anchor the current scene doesn't expose simply doesn't
 * render (no-op, never throws — see `renderTutorialCard` in `overlay.ts`). */
export type TutorialAnchorId =
  | 'hitRow'
  | 'turnline'
  | 'levelUpLine'
  | 'plBadge'
  | 'statGrid'
  | 'plSpentLine';

export interface TutorialStepDef {
  id: string;
  moment: TutorialMoment;
  anchor: TutorialAnchorId;
  title: string;
  /** Copy is a function of the notify() payload so it can quote the SAME
   * live values the caller already read off the event log/timeline — never
   * a recomputation, just a read. Payload shape is per-moment; see steps.ts. */
  body: (payload: Record<string, unknown>) => string;
  /** Extra gate beyond "not yet seen" — e.g. the matchup beat only fires when
   * THIS particular hit's payload says a matchup bonus applied. Absent = no
   * extra gate (fires the first time its moment notifies at all). */
  when?: (payload: Record<string, unknown>) => boolean;
}

/** Screen-space rect a scene resolves an anchor id to, for the overlay to
 * point at. Anchor-relative (not fixed pixels), so the identical step reads
 * fine at both 1440×900 and 412×892. */
export interface TutorialAnchorRect { x: number; y: number; w: number; h: number; }

/** A step that just armed, paired with the payload it fired with — scenes
 * queue these (one shown at a time) so `step.body(payload)` always reads the
 * SAME live values the notify() call was given, never a shared/blank one. */
export interface ArmedTutorialCard { step: TutorialStepDef; payload: Record<string, unknown>; }
