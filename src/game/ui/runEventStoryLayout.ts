/**
 * Pure arithmetic for the "reserve the choice block first" budget that
 * `DesktopRunEventScene`/`MobileRunEventScene`'s `renderStory` both apply to
 * the CHOOSING-phase story column (area caption → art → title → body) — see
 * either scene's `renderStory` doc comment for the bug this fixes (2026-08-19:
 * a 3-choice event's 3rd row rendered its cost/reward label 6-18px off the
 * bottom of a 1440x900 desktop canvas, because the story column above the
 * choice rows was a fixed-size stack with no notion of how much room the
 * rows themselves needed).
 *
 * Exported so `tests/game/runEventStoryLayout.test.ts` can prove the
 * invariant against every event in `eventCatalog` using the EXACT same
 * formula the scenes render with — no hand-typed duplicate to drift out of
 * sync with the real renderer (the same reasoning `runRewardGeometry.ts`'s
 * module doc gives for `layoutFeatureGrid`/`centeredBox`).
 *
 * No Phaser import here — plain numbers in, plain numbers out, so this is
 * usable from a scene, a test, or a future non-Phaser tool alike.
 */

/** The choice block's own footprint: `count` rows of `rowH`, `count - 1`
 * gaps of `rowGap` between them. Both scenes' `renderChoicePanel`/
 * `renderChoices` lay the rows out with this exact formula (their own
 * `rowH`/`rowGap` locals must stay numerically identical to whatever a
 * caller passes in here — same call, same constants, never a second
 * hand-picked number). */
export function eventChoiceBlockHeight(count: number, rowH: number, rowGap: number): number {
  if (count <= 0) return 0;
  return count * rowH + (count - 1) * rowGap;
}

/**
 * The hard Y-ceiling the story column (caption/art/title/body, each with its
 * own trailing gap) must stay above `storyTop` and within, so that
 * `choiceBlockH` — reserved BELOW it — always ends at or before
 * `canvasHeight - safeBottom`.
 *
 * `floorMin` is a defensive floor only: today's event catalog never has
 * enough choices (max 3) to make `canvasHeight - safeBottom - choiceBlockH -
 * bottomGap` dip below a sane minimum, so this branch never actually fires —
 * it exists so a future content change adding many more choices degrades to
 * a merely TIGHT layout instead of a nonsensical negative one.
 */
export function eventStoryLimit(
  canvasHeight: number,
  safeBottom: number,
  choiceBlockH: number,
  bottomGap: number,
  floorMin: number,
): number {
  return Math.max(floorMin, canvasHeight - safeBottom - choiceBlockH - bottomGap);
}

/**
 * The art image's height, clamped DOWN from `idealH` (never up past it) just
 * far enough to hold back `titleReserve` + a `bodyTextFloor` of readable body
 * room within `storyLimit`, floored at `artMin` so it never vanishes outright
 * (a floor the current catalog never needs to touch — see `eventStoryLimit`'s
 * doc comment on `floorMin` for the same defensive reasoning).
 */
export function eventArtHeight(
  storyLimit: number,
  cursorAfterCaption: number,
  titleReserve: number,
  artGap: number,
  bodyPad: number,
  bodyTextFloor: number,
  idealH: number,
  artMin: number,
): number {
  const budget = storyLimit - cursorAfterCaption - titleReserve - artGap - (bodyPad * 2 + bodyTextFloor);
  return Math.min(idealH, Math.max(artMin, budget));
}

/**
 * The body text's `auditTextBlock` `maxHeight` — whatever's left of
 * `storyLimit` once the ACTUAL (not worst-case) caption/art/title heights are
 * known, floored at `floorMin` so `auditTextBlock` is never handed a
 * degenerate zero/negative box.
 */
export function eventBodyMaxHeight(storyLimit: number, bodyBoxTop: number, bodyPad: number, floorMin: number): number {
  return Math.max(floorMin, storyLimit - bodyBoxTop - bodyPad * 2);
}

export interface EventBodyScrollLayout {
  /** Mask height containing only complete wrapped lines. */
  viewportHeight: number;
  /** Positive distance from the initial top to the final line-aligned stop. */
  maxScroll: number;
  visibleLineCount: number;
  /** Glyph-line height plus the configured inter-line spacing. */
  lineAdvance: number;
}

/**
 * Align an overflowing text mask to complete wrapped-line boundaries.
 * Phaser reports the rendered block's total height rather than a public
 * line-height metric, so derive the exact glyph-line height by removing its
 * known inter-line gaps first. The hidden tail is consequently an integral
 * number of `lineAdvance`s as well: both the initial and final scroll stops
 * show complete lines, never a clipped row of glyphs.
 */
export function eventBodyScrollLayout(
  naturalHeight: number,
  maxViewportHeight: number,
  lineCount: number,
  lineSpacing: number,
): EventBodyScrollLayout {
  const safeLineCount = Math.max(1, Math.floor(lineCount));
  const safeSpacing = Math.max(0, lineSpacing);
  const safeNaturalHeight = Math.max(0, naturalHeight);
  const gapHeight = safeSpacing * Math.max(0, safeLineCount - 1);
  const glyphLineHeight = Math.max(0, (safeNaturalHeight - gapHeight) / safeLineCount);
  const lineAdvance = glyphLineHeight + safeSpacing;

  if (safeNaturalHeight <= maxViewportHeight || lineAdvance <= 0) {
    return {
      viewportHeight: safeNaturalHeight,
      maxScroll: 0,
      visibleLineCount: safeLineCount,
      lineAdvance,
    };
  }

  const visibleLineCount = Math.max(
    1,
    Math.min(safeLineCount, Math.floor((Math.max(0, maxViewportHeight) + safeSpacing) / lineAdvance)),
  );
  const viewportHeight = glyphLineHeight * visibleLineCount + safeSpacing * Math.max(0, visibleLineCount - 1);
  const maxScroll = lineAdvance * (safeLineCount - visibleLineCount);
  return { viewportHeight, maxScroll, visibleLineCount, lineAdvance };
}

/** Geometry for the persistent scroll thumb beside an overflowing body. */
export function eventBodyScrollThumb(
  trackHeight: number,
  viewportHeight: number,
  naturalHeight: number,
  scrollOffset: number,
  minThumbHeight = 18,
): { height: number; offset: number } {
  const safeTrackHeight = Math.max(0, trackHeight);
  const safeNaturalHeight = Math.max(viewportHeight, naturalHeight, 1);
  const height = Math.min(
    safeTrackHeight,
    Math.max(Math.min(minThumbHeight, safeTrackHeight), safeTrackHeight * (viewportHeight / safeNaturalHeight)),
  );
  const maxScroll = Math.max(0, naturalHeight - viewportHeight);
  const progress = maxScroll === 0 ? 0 : Math.min(1, Math.max(0, scrollOffset / maxScroll));
  return { height, offset: (safeTrackHeight - height) * progress };
}
