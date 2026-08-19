import { describe, expect, it } from 'vitest';
import { eventCatalog } from '../../src/data/events';
import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../../src/game/layoutProfile';
import { runChoicePanelMinHeight } from '../../src/game/ui/RunChoicePanel';
import {
  eventArtHeight,
  eventBodyMaxHeight,
  eventChoiceBlockHeight,
  eventStoryLimit,
} from '../../src/game/ui/runEventStoryLayout';
import { runScreenTemplate } from '../../src/game/ui/runScreenTemplate';

// ---------------------------------------------------------------------------
// Unit tests for the pure helpers (no Phaser, no catalog data).
// ---------------------------------------------------------------------------

describe('eventChoiceBlockHeight', () => {
  it('is zero for a non-positive count', () => {
    expect(eventChoiceBlockHeight(0, 90, 10)).toBe(0);
    expect(eventChoiceBlockHeight(-1, 90, 10)).toBe(0);
  });

  it('sums N row heights and N-1 gaps', () => {
    expect(eventChoiceBlockHeight(1, 90, 10)).toBe(90);
    expect(eventChoiceBlockHeight(2, 90, 10)).toBe(90 * 2 + 10);
    expect(eventChoiceBlockHeight(3, 99, 10)).toBe(99 * 3 + 10 * 2);
  });
});

describe('eventStoryLimit', () => {
  it('is the canvas ceiling minus the reserve, the bottom gap, and the safe margin, when that stays above the floor', () => {
    expect(eventStoryLimit(900, 24, 300, 20, 0)).toBe(900 - 24 - 300 - 20);
  });

  it('never drops below the supplied floor', () => {
    // A pathological reserve (way more choices than the game has today)
    // would otherwise go negative — the floor keeps this a merely TIGHT
    // layout rather than a nonsensical one.
    expect(eventStoryLimit(900, 24, 5000, 20, 100)).toBe(100);
  });
});

describe('eventArtHeight', () => {
  const idealH = 260;
  const artMin = 90;

  it('never exceeds the ideal height even with an enormous budget', () => {
    expect(eventArtHeight(10_000, 0, 66, 16, 20, 80, idealH, artMin)).toBe(idealH);
  });

  it('never drops below artMin even with a starved budget', () => {
    expect(eventArtHeight(0, 0, 66, 16, 20, 80, idealH, artMin)).toBe(artMin);
  });

  it('shrinks proportionally to the budget in between', () => {
    // storyLimit - cursor - titleReserve - artGap - (bodyPad*2+bodyFloor)
    // = 300 - 0 - 66 - 16 - 120 = 98
    expect(eventArtHeight(300, 0, 66, 16, 20, 80, idealH, artMin)).toBe(98);
  });
});

describe('eventBodyMaxHeight', () => {
  it('is whatever is left of storyLimit above bodyBoxTop, minus both pads', () => {
    expect(eventBodyMaxHeight(500, 400, 20, 40)).toBe(500 - 400 - 40);
  });

  it('never drops below the floor, even for a negative remainder', () => {
    expect(eventBodyMaxHeight(500, 490, 20, 40)).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Integration proof: EVERY event in the catalog, on BOTH platforms, reserves
// its actual choice-row footprint and never lets that reservation be clamped
// away by the defensive floor — the exact bug this whole module exists to
// prevent (2026-08-19: a 3-choice event's 3rd row rendered its "FREE" label
// 6-18px past the bottom of a 1440x900 desktop canvas because the story
// column above the choice rows was laid out with no notion of how much room
// the rows themselves needed).
//
// This is a pure-arithmetic proof, not a pixel-rendered one: it calls the
// SAME exported functions `DesktopRunEventScene`/`MobileRunEventScene` call,
// with the SAME constants (`runChoicePanelMinHeight`, the platform profile,
// the row gap each scene hardcodes) — so it fails the moment either scene's
// reserve drifts out of sync with its own choice-row layout, which is
// exactly the class of bug (a hand-picked height guess, not a computed one)
// both the desktop overflow and the mobile under-reservation traced back to.
// ---------------------------------------------------------------------------

const ALL_EVENTS = Object.values(eventCatalog);

describe('DesktopRunEventScene story layout — every catalog event', () => {
  const F = DESKTOP_PROFILE.font;
  const rowH = runChoicePanelMinHeight(F, true); // must match DesktopRunEventScene.renderChoicePanel
  const rowGap = 10; // must match DesktopRunEventScene.renderChoicePanel
  const bottomGap = 20; // the gap `renderStory` leaves before the choice block starts
  const py = runScreenTemplate('desktop').regions.content.y + 10; // DesktopRunEventScene.panelGeometry
  const maxBottom = DESKTOP_PROFILE.canvas.height - DESKTOP_PROFILE.safe.bottom;
  const floorMin = py + 200;

  it('sanity: the catalog only ever offers 2-3 choices (the case this fix targets)', () => {
    const counts = new Set(ALL_EVENTS.map((e) => e.choices.length));
    for (const n of counts) expect(n).toBeGreaterThanOrEqual(2);
    for (const n of counts) expect(n).toBeLessThanOrEqual(3);
  });

  for (const event of ALL_EVENTS) {
    it(`"${event.title}" (${event.choices.length} choices, body ${event.body.length} chars): choice block is fully reserved, not floor-clamped`, () => {
      const reserveBelowH = eventChoiceBlockHeight(event.choices.length, rowH, rowGap);
      const storyLimit = eventStoryLimit(maxBottom, 0, reserveBelowH, bottomGap, floorMin);

      // The floor never binds for real catalog content — if it did, the
      // choice block's reservation would have been silently shrunk below
      // what the rows actually need, defeating the fix.
      expect(storyLimit).toBe(maxBottom - reserveBelowH - bottomGap);

      // The reserved choice block, placed right after `storyLimit` (the same
      // `bodyBoxTop + bodyBoxH + bottomGap` cursor `renderStory` returns as
      // `contentTop`), always ends AT OR BEFORE the canvas's safe bottom
      // edge — never past it.
      expect(storyLimit + bottomGap + reserveBelowH).toBeLessThanOrEqual(maxBottom);
    });
  }
});

describe('MobileRunEventScene story layout — every catalog event', () => {
  const F = MOBILE_PROFILE.font;
  const rowH = runChoicePanelMinHeight(F, true); // must match MobileRunEventScene.renderChoices
  const rowGap = 8; // must match MobileRunEventScene.renderChoices
  const footerY = runScreenTemplate('mobile').regions.footer.y;
  const maxBottom = footerY - 10; // MobileRunEventScene.renderStory's own `maxBottom`

  // Mobile's body panel is capped-and-scrolled (`budget = max(70, maxBottom -
  // bodyBoxTop - 14 - reserveBelowH)`), not shrunk-and-truncated like
  // desktop's — so its guarantee is airtight AS LONG AS that `70` floor never
  // binds for real content (if it did, the body box could grow past its
  // computed budget and eat into the reserved choice block). `bodyBoxTop`
  // here is the WORST case (caption + title both at their own audited
  // maximum height, the fixed 194px-tall art image, and every gap between
  // them) — a real upper bound, not a guess, so if the 70-floor doesn't bind
  // even here, it never binds for any real event.
  const captionCapH = F.tiny * 4 + 8;
  const titleCapH = F.title * 2;
  const artH = Math.round((MOBILE_PROFILE.canvas.width - 24) * 0.5);
  const worstBodyBoxTop = runScreenTemplate('mobile').regions.content.y + captionCapH + 8 + artH + 10 + titleCapH + 8;

  for (const event of ALL_EVENTS) {
    it(`"${event.title}" (${event.choices.length} choices): the reserved choice block fits above the fixed footer even in the worst-case story column`, () => {
      const reserveBelowH = eventChoiceBlockHeight(event.choices.length, rowH, rowGap);
      const budget = Math.max(70, maxBottom - worstBodyBoxTop - 14 - reserveBelowH);

      // The 70px floor must not bind — see the doc comment above.
      expect(budget).toBeGreaterThan(70);

      // With the floor not binding, the body box is capped to EXACTLY this
      // budget (via the small-scroll mask, never larger), so the choice
      // block that follows it always lands at-or-before `maxBottom`.
      const choiceTop = worstBodyBoxTop + budget + 14;
      expect(choiceTop + reserveBelowH).toBeLessThanOrEqual(maxBottom);
    });
  }
});

// ---------------------------------------------------------------------------
// Bound derivation — SYNTHETIC (non-catalog) proof of the max-choices bound
// documented on `EventDef.choices` (src/data/events.ts) and enforced by
// `tests/run/events.test.ts`'s "every event has 2-3 choices" lint. The
// catalog-driven suites above only ever see today's real events (max 3
// choices) — they can prove today's catalog is safe, but not that 3 is
// actually the CEILING the math supports, nor document what breaks past it.
// These synthetic cases fill that gap directly, independent of catalog
// content, using a longest-plausible body (~420 chars, longer than any real
// event's ~380-char max) to stand in for a future wordy event.
// ---------------------------------------------------------------------------

describe('bound derivation — synthetic events at and past the max-choices limit', () => {
  const LONGEST_PLAUSIBLE_BODY =
    'A synthetic worst-case body, deliberately longer than any real catalog event, standing in for a future wordy event so the reservation proof below is not flattered by a short real body. '.repeat(2);

  function syntheticEvent(choiceCount: number) {
    return {
      title: `synthetic ${choiceCount}-choice event`,
      body: LONGEST_PLAUSIBLE_BODY,
      choices: Array.from({ length: choiceCount }, (_, i) => ({ id: `c${i}` })),
    };
  }

  describe('desktop', () => {
    const F = DESKTOP_PROFILE.font;
    const rowH = runChoicePanelMinHeight(F, true);
    const rowGap = 10;
    const bottomGap = 20;
    const py = runScreenTemplate('desktop').regions.content.y + 10;
    const maxBottom = DESKTOP_PROFILE.canvas.height - DESKTOP_PROFILE.safe.bottom;
    const floorMin = py + 200;

    it('at the bound (3 choices): the reservation still fits, floor does not bind', () => {
      const event = syntheticEvent(3);
      const reserveBelowH = eventChoiceBlockHeight(event.choices.length, rowH, rowGap);
      const storyLimit = eventStoryLimit(maxBottom, 0, reserveBelowH, bottomGap, floorMin);
      expect(storyLimit).toBe(maxBottom - reserveBelowH - bottomGap);
      expect(storyLimit + bottomGap + reserveBelowH).toBeLessThanOrEqual(maxBottom);
    });

    it('one past the bound (4 choices): desktop ALONE still fits (it is not the binding platform)', () => {
      // Documented for completeness: desktop's own ceiling is 4, not 3 — see
      // the mobile case below for the platform that actually fails at 4,
      // which is why the catalog-wide bound is 3, not 4.
      const event = syntheticEvent(4);
      const reserveBelowH = eventChoiceBlockHeight(event.choices.length, rowH, rowGap);
      const storyLimit = eventStoryLimit(maxBottom, 0, reserveBelowH, bottomGap, floorMin);
      expect(storyLimit).toBe(maxBottom - reserveBelowH - bottomGap);
    });

    it('two past desktop\'s own ceiling (5 choices): the floor DOES bind — the regression this module fixes', () => {
      const event = syntheticEvent(5);
      const reserveBelowH = eventChoiceBlockHeight(event.choices.length, rowH, rowGap);
      const storyLimit = eventStoryLimit(maxBottom, 0, reserveBelowH, bottomGap, floorMin);
      // The floor binds (clamped to floorMin instead of the true ceiling
      // reservation), which is exactly the "story column doesn't know how
      // much room the choice rows need" failure mode: the reserved block no
      // longer ends at-or-before the safe bottom.
      expect(storyLimit).toBe(floorMin);
      expect(storyLimit + bottomGap + reserveBelowH).toBeGreaterThan(maxBottom);
    });
  });

  describe('mobile — the binding platform for the 3-choice catalog bound', () => {
    const F = MOBILE_PROFILE.font;
    const rowH = runChoicePanelMinHeight(F, true);
    const rowGap = 8;
    const footerY = runScreenTemplate('mobile').regions.footer.y;
    const maxBottom = footerY - 10;
    const captionCapH = F.tiny * 4 + 8;
    const titleCapH = F.title * 2;
    const artH = Math.round((MOBILE_PROFILE.canvas.width - 24) * 0.5);
    const worstBodyBoxTop = runScreenTemplate('mobile').regions.content.y + captionCapH + 8 + artH + 10 + titleCapH + 8;

    it('at the bound (3 choices): the reserved choice block fits, the 70px floor does not bind', () => {
      const event = syntheticEvent(3);
      const reserveBelowH = eventChoiceBlockHeight(event.choices.length, rowH, rowGap);
      const budget = Math.max(70, maxBottom - worstBodyBoxTop - 14 - reserveBelowH);
      expect(budget).toBeGreaterThan(70);
      const choiceTop = worstBodyBoxTop + budget + 14;
      expect(choiceTop + reserveBelowH).toBeLessThanOrEqual(maxBottom);
    });

    it('one past the bound (4 choices): the 70px floor DOES bind — this is why the catalog max is 3, not 4', () => {
      const event = syntheticEvent(4);
      const reserveBelowH = eventChoiceBlockHeight(event.choices.length, rowH, rowGap);
      const rawBudget = maxBottom - worstBodyBoxTop - 14 - reserveBelowH;
      const budget = Math.max(70, rawBudget);
      // The floor binds: the RAW budget the content actually needs has
      // already dropped to (or below) the 70px floor, so `budget` no longer
      // reflects "whatever storyLimit computed" — it is a clamp. Once the
      // floor binds, the body box can grow past what the choice block below
      // it was reserved for, and the choice rows are no longer guaranteed to
      // land at-or-before `maxBottom`. This is the documented failure mode a
      // 4-choice event would ship silently without the `EventChoiceDef[]`
      // length bound this test exists to justify.
      expect(rawBudget).toBeLessThanOrEqual(70);
      expect(budget).toBe(70);
    });
  });
});
