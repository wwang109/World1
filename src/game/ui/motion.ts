// UI MOTION — the ONE place interaction feel is defined.
//
// Before this module every interactive control in the game hand-rolled its own
// feedback, and all of it was INSTANT: `pointerover` did a bare
// `setFillStyle(hoverColor)`, `pointerout` set it back, and `pointerdown` did
// nothing visual at all — a click produced sound and a state change but no
// acknowledgement from the control itself. That is the "not smooth" complaint
// this module answers (user, 2026-08-21: "make the more animation to hover and
// or option selections or new panel appearing ... it feel more smooth", "like
// changing button colors on clicked").
//
// WHY A MODULE RATHER THAN PER-SCENE TWEENS: interaction feel has to be
// IDENTICAL everywhere or it reads as jank rather than style, and this codebase
// draws most controls from SHARED components (`RunProgressStrip` is on 7 desktop
// and 7 mobile scenes, `RunChoicePanel` on 2 and 2, `CardToken` on 3 and 4). One
// helper attached inside those shared components satisfies the both-platforms
// rule structurally — desktop and mobile cannot drift, because there is only one
// implementation to change.
//
// NO RUNTIME PHASER IMPORT, deliberately: every Phaser touch goes through the
// `scene`/`target` objects the caller already owns, and the colour maths below is
// written out rather than borrowed from `Phaser.Display.Color`. That keeps this
// module (and the token table and colour maths that carry the actual design
// decisions) importable by `tests/game` without standing up a Phaser runtime —
// the same property `skillPresentation.ts` has.
//
// PRESENTATION ONLY. Nothing here is part of the simulation: `src/game` never
// runs combat (CLAUDE.md's thin-client rule), so tween timing cannot affect a
// battle outcome or a seed. Tweens are wall-clock, the engine is not.

// TYPE-ONLY Phaser import: erased at compile time, so this module still needs no
// Phaser RUNTIME (see the header) while getting Phaser's exact signatures rather
// than a hand-written structural approximation of them — which is what a first
// draft of this file used, and it did not actually accept a real `Phaser.Scene`.
import type Phaser from 'phaser';
import type { UI } from '../theme';

/** The scene whose tween manager drives all of this. */
export type MotionScene = Phaser.Scene;

/** A game object whose fill this module animates — a `Rectangle` in practice. */
export type FillTarget = Phaser.GameObjects.Rectangle;

/**
 * A game object this module can nudge or fade. Structural on purpose: it covers
 * every display object with a transform and an alpha (text, rectangles,
 * containers, images) without naming a class, so a caller can pass whatever it
 * already built.
 */
export interface MoveTarget {
  x: number;
  y: number;
  alpha: number;
  scale?: number;
}

/**
 * MOTION TOKENS — durations in ms, offsets in px. Pinned by
 * `tests/game/motion.test.ts` so a change here is a deliberate design decision
 * rather than a drifting magic number, the same drift-lock stance `PRICE` takes
 * on the balance side.
 *
 * THE DURATIONS ARE ASYMMETRIC ON PURPOSE. Hover-IN is faster than hover-OUT
 * (90 vs 140): the response to the cursor arriving should feel immediate, while
 * the decay after it leaves reads as smoothness rather than lag. PRESS is faster
 * still (45) — a press is the one moment the user is certain they acted, so any
 * ramp there feels like input latency; the RELEASE back out is slower (120) so
 * the control settles instead of snapping.
 *
 * `panelIn` (200) is the outlier and the only one a player consciously notices:
 * it is a whole panel arriving, so it gets long enough to read as a transition
 * and short enough to never gate the next click. Everything is well under the
 * ~250ms where UI motion starts being perceived as waiting.
 */
export const MOTION = {
  /** Cursor arrives on a control. */
  hoverIn: 90,
  /** Cursor leaves — slower than in, so the control decays rather than snaps. */
  hoverOut: 140,
  /** Button goes down. Near-instant: a ramp here reads as input lag. */
  press: 45,
  /** Button comes back up. */
  release: 120,
  /** A panel/overlay arriving. */
  panelIn: 200,
  /** A one-shot confirmation flash on the thing that was just chosen. */
  selectPulse: 260,

  /** How far a hovered control rises, in px (negative y). Subtle by design. */
  hoverLift: 2,
  /** How far a pressed control sinks, in px — it overshoots the idle position. */
  pressSink: 1,
  /** How far a panel rises into place from below, in px. */
  panelRise: 12,
  /** Panel's starting alpha — never 0, so it fades in from "faintly there". */
  panelAlphaFrom: 0,

  /**
   * Easings, as Phaser ease strings. `Sine.easeOut` for arrivals (fast start,
   * gentle settle — the shape that reads as "responsive"), `Quad.easeOut` for a
   * panel, whose longer travel wants a slightly firmer deceleration. Named here
   * rather than inline so every control in the game shares one curve.
   */
  easeHover: 'Sine.easeOut',
  easePanel: 'Quad.easeOut',
  easePulse: 'Sine.easeInOut',
} as const;

/**
 * Blend two packed 0xRRGGBB colours. `t` is clamped to 0..1, each channel is
 * rounded, and the result is re-packed — so the output is always a valid colour
 * integer for `setFillStyle`.
 *
 * Written out rather than taken from `Phaser.Display.Color.Interpolate` for the
 * reason in the header (no runtime Phaser import ⇒ unit-testable), and because
 * this is the one piece of maths in the module worth pinning directly: a channel
 * mask or shift typo produces a plausible-but-wrong colour that no layout audit
 * would catch.
 */
export function lerpColor(from: number, to: number, t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const fr = (from >> 16) & 0xff;
  const fg = (from >> 8) & 0xff;
  const fb = from & 0xff;
  const tr = (to >> 16) & 0xff;
  const tg = (to >> 8) & 0xff;
  const tb = to & 0xff;
  const r = Math.round(fr + (tr - fr) * k);
  const g = Math.round(fg + (tg - fg) * k);
  const b = Math.round(fb + (tb - fb) * k);
  return (r << 16) | (g << 8) | b;
}

/**
 * The PRESSED fill for a control, derived from its hover colour rather than
 * authored per site: pressing pushes the fill 38% of the way toward black.
 *
 * DERIVED, NOT PICKED, because a press colour has to work against every fill in
 * `theme.ts`'s palette (a bronze `chip`, a near-black `panelAlt`, a red
 * `badSoft`) and hand-picking one per call site is exactly how eleven slightly
 * different press colours would end up shipped. A proportional darken keeps the
 * control's own identity while reading unambiguously as "down" on all of them.
 *
 * 38% is chosen: enough to be unmistakable on the dark panel fills that dominate
 * this UI, not so much that a bright bronze button turns muddy. Callers that need
 * something else pass `press` explicitly.
 */
export function pressedFill(hover: number): number {
  return lerpColor(hover, 0x000000, 0.38);
}

export interface ButtonFeelOpts {
  /** Idle fill. */
  fill: number;
  /** Hover fill. */
  hover: number;
  /** Pressed fill. Defaults to `pressedFill(hover)`. */
  press?: number;
  /** Fill alpha, preserved across every state. */
  alpha?: number;
  /**
   * Objects that ride the lift/sink ALONGSIDE the plate — normally the button's
   * text label. The plate itself always moves; anything drawn on top of it has to
   * be listed here or it stays behind while the plate slides out from under it.
   */
  follow?: readonly MoveTarget[];
  /** Override the lift distance (0 disables it — for controls whose origin makes translation wrong). */
  lift?: number;
  /** Called on press, after the visual state is applied. */
  onPress?: () => void;
}

/**
 * Attach the standard button feel to an interactive fill target: a tweened
 * colour on hover in/out, an immediate darkened fill plus a 1px sink on press,
 * and a settle back to hover-or-idle on release.
 *
 * THE CALLER STILL OWNS `setInteractive` and the semantics of the press — this
 * only adds feel, so a control keeps whatever hit area, cursor and handler it
 * already had. Existing `pointerover`/`pointerout` handlers should be REMOVED
 * when adopting this (a leftover instant `setFillStyle` fights the tween and the
 * instant one wins, since it runs every frame the tween does not).
 *
 * PRESS IS NOT TWEENED IN, only out. See `MOTION.press`: the down state wants to
 * be there the frame the pointer goes down.
 *
 * POINTER-UP IS HANDLED ON BOTH `pointerup` AND `pointerupoutside`. Without the
 * second, dragging off a pressed button leaves it stuck in its pressed colour
 * forever — the single most common bug in hand-rolled press states.
 */
export function attachButtonFeel(scene: MotionScene, target: FillTarget, opts: ButtonFeelOpts): void {
  const alpha = opts.alpha ?? 1;
  const pressFill = opts.press ?? pressedFill(opts.hover);
  const lift = opts.lift ?? MOTION.hoverLift;
  const follow = opts.follow ?? [];
  // Home positions are captured ONCE, at attach time, so repeated
  // hover/press cycles can never accumulate drift — every restore is absolute,
  // never a relative "move back by N".
  // THE PLATE MOVES TOO, not just its followers. `target` is included first: a
  // first draft translated only `follow`, which would have slid a button's LABEL
  // off its own stationary plate — the lift has to move the whole control or it
  // is a bug rather than a flourish.
  const home = [target as unknown as MoveTarget, ...follow].map((o) => ({ o, y: o.y }));
  let over = false;
  let down = false;

  // The colour the control is actually showing. Tracked so an interrupted tween
  // blends from where it currently is rather than snapping back to the idle fill
  // and starting over — which is what makes a fast hover-in/hover-out wiggle look
  // continuous instead of flickery.
  let current = opts.fill;

  const fillTo = (to: number, duration: number): void => {
    scene.tweens.killTweensOf(target);
    if (duration <= 0) { current = to; target.setFillStyle(to, alpha); return; }
    // Tweened through a COUNTER, not a property tween, because a packed
    // 0xRRGGBB integer does not interpolate linearly as a number: walking
    // 0x142738 -> 0x1d3950 numerically passes through colours neither end
    // contains. The counter drives `lerpColor`, which blends per channel.
    const from = current;
    scene.tweens.addCounter({
      from: 0, to: 1, duration, ease: MOTION.easeHover,
      onUpdate: (tween: Phaser.Tweens.Tween) => {
        target.setFillStyle(lerpColor(from, to, tween.getValue() ?? 1), alpha);
      },
      onComplete: () => { current = to; },
    });
  };

  const moveTo = (dy: number, duration: number): void => {
    for (const { o, y } of home) {
      scene.tweens.killTweensOf(o);
      if (duration <= 0) { o.y = y + dy; continue; }
      scene.tweens.add({ targets: o, y: y + dy, duration, ease: MOTION.easeHover });
    }
  };

  target.on('pointerover', (() => {
    over = true;
    if (down) return;
    fillTo(opts.hover, MOTION.hoverIn);
    if (lift) moveTo(-lift, MOTION.hoverIn);
  }) as never);

  target.on('pointerout', (() => {
    over = false;
    down = false;
    fillTo(opts.fill, MOTION.hoverOut);
    if (lift) moveTo(0, MOTION.hoverOut);
  }) as never);

  target.on('pointerdown', (() => {
    down = true;
    // Immediate, not tweened — see the doc comment.
    current = pressFill;
    target.setFillStyle(pressFill, alpha);
    if (lift) moveTo(MOTION.pressSink, 0);
    opts.onPress?.();
  }) as never);

  const release = (): void => {
    if (!down) return;
    down = false;
    fillTo(over ? opts.hover : opts.fill, MOTION.release);
    if (lift) moveTo(over ? -lift : 0, MOTION.release);
  };
  target.on('pointerup', release as never);
  // Without this the control stays visually pressed if the pointer is released
  // off it.
  target.on('pointerupoutside', release as never);
}

export interface AppearOpts {
  /** Stagger between objects, ms. 0 = all together. */
  stagger?: number;
  /** Rise distance; defaults to `MOTION.panelRise`. 0 = fade only. */
  rise?: number;
  /** Delay before the first object starts, ms. */
  delay?: number;
  /** Duration override. */
  duration?: number;
}

/**
 * Fade-and-rise a freshly built panel (or a list of them) into place.
 *
 * WHY IT TAKES A LIST AND STAGGERS: a run screen builds several panels at once,
 * and fading them in together reads as one flat cross-dissolve. A small stagger
 * makes the screen assemble, which is the "new panel appearing" feel asked for —
 * and it costs nothing, because the objects already exist.
 *
 * SETS THE START STATE SYNCHRONOUSLY, before the first tween frame: alpha and y
 * are written immediately so there is no flash of the final position on the frame
 * the panel is built. The tween then carries it home.
 *
 * SAFE ON REBUILD: every scene here rebuilds its whole display list on state
 * change (the scene-rebuild idiom, docs/architecture.md), so these objects are
 * new each time and there is no stale tween to cancel. It only ever animates
 * FROM the offset TO the authored position, so an interrupted rebuild leaves the
 * next build's objects at their correct coordinates.
 */
export function appearPanel(scene: MotionScene, objects: readonly MoveTarget[], opts: AppearOpts = {}): void {
  const rise = opts.rise ?? MOTION.panelRise;
  const duration = opts.duration ?? MOTION.panelIn;
  const stagger = opts.stagger ?? 0;
  const baseDelay = opts.delay ?? 0;
  objects.forEach((o, i) => {
    const homeY = o.y;
    const homeAlpha = o.alpha;
    o.alpha = MOTION.panelAlphaFrom;
    o.y = homeY + rise;
    scene.tweens.add({
      targets: o,
      y: homeY,
      alpha: homeAlpha,
      duration,
      delay: baseDelay + i * stagger,
      ease: MOTION.easePanel,
    });
  });
}

/**
 * A one-shot confirmation FLASH on the thing that was just chosen — its alpha
 * dips and returns.
 *
 * FOR SELECTION, NOT FOR PRESS: press feedback is `attachButtonFeel`'s job and
 * fires on every click. This marks the moment a choice is COMMITTED (a run event
 * option, a shop purchase), where several options look alike and the extra beat
 * is what tells the player which one the game took.
 *
 * ALPHA, NOT SCALE, and that is the whole reason this is a flash rather than a
 * pulse: nearly every panel and button in this UI is built with
 * `setOrigin(0, 0)`, so scaling grows it down-and-right out of its own slot
 * instead of swelling in place. Alpha is origin-independent, so one helper is
 * correct everywhere. A scale pulse would need a centered origin, which is a
 * per-control layout decision this module has no business making.
 *
 * `yoyo` rather than two chained tweens so the settle returns to EXACTLY the
 * starting alpha — a manual return tween can leave a rounding residue that
 * compounds when a control is flashed repeatedly.
 */
export function flashConfirm(scene: MotionScene, target: MoveTarget, opts: { dipTo?: number } = {}): void {
  scene.tweens.add({
    targets: target,
    alpha: opts.dipTo ?? 0.3,
    duration: MOTION.selectPulse / 2,
    ease: MOTION.easePulse,
    yoyo: true,
  });
}

/**
 * The hover fill a control should use, given its idle fill and the role it plays
 * — so a call site does not have to remember which token pairs with which.
 * Mirrors the pairings the hand-rolled handlers already used
 * (`primary -> chipDark`, everything else -> `slotHover`), kept here so the next
 * control added does not invent a twelfth pairing.
 */
export function hoverFillFor(role: 'primary' | 'default', tokens: typeof UI): number {
  return role === 'primary' ? tokens.chipDark : tokens.slotHover;
}
