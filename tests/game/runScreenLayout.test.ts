import { afterEach, describe, expect, it } from 'vitest';
import {
  projectRunScreenTemplate,
  runScreenLayout,
} from '../../src/game/ui/runScreenLayout';
import {
  runScreenTemplate,
  type Rect,
  type RunActionRole,
  type RunScreenRegion,
  type RunTemplateChrome,
  type RunTemplatePlatform,
} from '../../src/game/ui/runScreenTemplate';
import { DESIGN_SIZE, resetViewport, setViewport } from '../../src/game/viewport';

const PLATFORMS: RunTemplatePlatform[] = ['desktop', 'mobile'];
const CHROMES: RunTemplateChrome[] = ['full', 'statsOnly'];
const REGIONS: RunScreenRegion[] = ['kicker', 'title', 'stats', 'badge', 'actions', 'content', 'footer'];
const ROLES: RunActionRole[] = ['back', 'secondary', 'tertiary', 'primary'];

/** The real shapes this has to survive, per platform: the user's ultrawide
 * 2326x1199 window (design viewport 1746x900), a 16:9 1920x1080 one
 * (1600x900), and portrait windows where the HEIGHT is the axis with slack
 * instead of the width. A viewport is ALWAYS >= its profile's canvas on both
 * axes (that is the contract `viewport.ts` guarantees), so these all are. */
const VIEWS: Record<RunTemplatePlatform, { width: number; height: number }[]> = {
  desktop: [
    { width: 1746, height: 900 },
    { width: 1600, height: 900 },
    { width: 1440, height: 1969 },
    { width: 2100, height: 1100 },
  ],
  mobile: [
    { width: 412, height: 915 },
    { width: 412, height: 1080 },
    { width: 640, height: 892 },
  ],
};

function within(inner: Rect, outer: Rect): boolean {
  return inner.x >= outer.x - 0.001
    && inner.y >= outer.y - 0.001
    && inner.x + inner.width <= outer.x + outer.width + 0.001
    && inner.y + inner.height <= outer.y + outer.height + 0.001;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x + 0.001 < b.x + b.width && b.x + 0.001 < a.x + a.width
    && a.y + 0.001 < b.y + b.height && b.y + 0.001 < a.y + a.height;
}

afterEach(() => resetViewport());

describe('runScreenLayout: projection onto the live viewport', () => {
  it('is the IDENTICAL object at the design viewport -- the fill-the-window change must be a no-op there', () => {
    for (const platform of PLATFORMS) {
      for (const chrome of CHROMES) {
        const base = runScreenTemplate(platform, chrome);
        expect(projectRunScreenTemplate(base, base.canvas)).toBe(base);
      }
    }
  });

  it('never SHRINKS below the authored canvas: a viewport smaller than design is clamped, not honoured', () => {
    const base = runScreenTemplate('desktop');
    const projected = projectRunScreenTemplate(base, { width: 800, height: 400 });
    expect(projected).toBe(base);
  });

  for (const platform of PLATFORMS) {
    for (const chrome of CHROMES) {
      for (const view of VIEWS[platform]) {
        const base = runScreenTemplate(platform, chrome);
        const t = projectRunScreenTemplate(base, view);
        const label = `${platform}/${chrome} @ ${view.width}x${view.height}`;

        it(`${label}: every region stays inside the viewport`, () => {
          const screen: Rect = { x: 0, y: 0, width: view.width, height: view.height };
          for (const region of REGIONS) expect(within(t.regions[region], screen), region).toBe(true);
        });

        it(`${label}: regions stay mutually exclusive`, () => {
          for (let i = 0; i < REGIONS.length; i++) {
            for (let j = i + 1; j < REGIONS.length; j++) {
              const a = t.regions[REGIONS[i]!]!;
              const b = t.regions[REGIONS[j]!]!;
              if (a.width === 0 || a.height === 0 || b.width === 0 || b.height === 0) continue;
              expect(overlaps(a, b), `${REGIONS[i]} vs ${REGIONS[j]}`).toBe(false);
            }
          }
        });

        it(`${label}: kicker/title and the content ORIGIN are left-anchored and unmoved`, () => {
          expect(t.regions.kicker).toEqual(base.regions.kicker);
          expect(t.regions.title).toEqual(base.regions.title);
          expect(t.regions.content.x).toBe(base.regions.content.x);
          expect(t.regions.content.y).toBe(base.regions.content.y);
        });

        it(`${label}: the stats strip keeps its gap to the RIGHT edge`, () => {
          const baseGap = base.canvas.width - (base.regions.stats.x + base.regions.stats.width);
          const gap = view.width - (t.regions.stats.x + t.regions.stats.width);
          expect(gap).toBeCloseTo(baseGap, 6);
        });

        it(`${label}: the footer keeps its gap to the BOTTOM edge`, () => {
          const baseGap = base.canvas.height - (base.regions.footer.y + base.regions.footer.height);
          const gap = view.height - (t.regions.footer.y + t.regions.footer.height);
          expect(gap).toBeCloseTo(baseGap, 6);
        });

        it(`${label}: every action slot still sits inside the region it belongs to`, () => {
          for (const role of ROLES) {
            const slot = t.actionSlots[role];
            if (slot.width === 0 || slot.height === 0) continue;
            expect(within(slot, t.regions[t.actionRegionOf[role]]), role).toBe(true);
          }
        });

        it(`${label}: action slots never overlap each other`, () => {
          for (let i = 0; i < ROLES.length; i++) {
            for (let j = i + 1; j < ROLES.length; j++) {
              const a = t.actionSlots[ROLES[i]!]!;
              const b = t.actionSlots[ROLES[j]!]!;
              if (a.width === 0 || b.width === 0) continue;
              expect(overlaps(a, b), `${ROLES[i]} vs ${ROLES[j]}`).toBe(false);
            }
          }
        });
      }
    }
  }
});

describe('runScreenLayout: the reward stack survives projection', () => {
  for (const platform of PLATFORMS) {
    for (const view of VIEWS[platform]) {
      const base = runScreenTemplate(platform);
      const t = projectRunScreenTemplate(base, view);
      const r = t.contentSlots.reward;
      const content = t.regions.content;
      const label = `${platform} @ ${view.width}x${view.height}`;

      it(`${label}: the confirm-button row stays BOTTOM-anchored in content`, () => {
        expect(r.buttons.x).toBe(content.x);
        expect(r.buttons.width).toBe(content.width);
        expect(r.buttons.y + r.buttons.height).toBe(content.y + content.height);
      });

      it(`${label}: panel + gap + buttons never exceeds content -- nothing can be pushed off the bottom`, () => {
        // CHANGED 2026-08-06 (reward redesign, runScreenTemplate.ts's
        // `REWARD_PANEL_MAX_W`/`_H`): the panel used to fill content EXACTLY
        // (a plain "panel = whatever's left" split) — this projection now
        // delegates straight to `buildRewardSlot` (see `projectReward`
        // above), which caps the panel on desktop instead of stretching it
        // across a wide/tall viewport, so "exactly fills" is no longer the
        // right invariant to project. What still MUST hold, on both
        // platforms and any viewport, is the safety property this test
        // exists for: the stack can never overflow past content's bottom
        // edge, and buttons stay exactly `gap` below the panel regardless of
        // whether the cap is binding.
        expect(r.panel.height + r.gap + r.buttons.height).toBeLessThanOrEqual(content.height + 1e-6);
        expect(r.panel.y + r.panel.height + r.gap).toBeCloseTo(r.buttons.y, 6);
        expect(within(r.panel, content)).toBe(true);
        expect(within(r.buttons, content)).toBe(true);
      });

      it(`${label}: icon/headline/detail/feature stack inside the panel, feature taking the remainder`, () => {
        for (const part of [r.icon, r.headline, r.detail, r.feature]) {
          expect(within(part, r.panel)).toBe(true);
        }
        // CHANGED 2026-08-06: `feature` used to reach the panel's bottom
        // edge EXACTLY (no inset) — the reward redesign frames the whole
        // stack with `REWARD_PANEL_PAD` on every side, so `feature` now
        // stops that same padding short of the border instead. Derived from
        // the icon's OWN top inset (`icon.y - panel.y`) rather than
        // hardcoded, so this can't drift from whatever the padding actually
        // is — same idiom as `runScreenTemplate.test.ts`'s sibling check.
        const pad = r.icon.y - r.panel.y;
        expect(pad).toBeGreaterThan(0);
        expect(r.feature.y + r.feature.height).toBeCloseTo(r.panel.y + r.panel.height - pad, 6);
        // The four fixed rows keep the authored heights; only `feature` flexes.
        expect(r.icon.height).toBe(base.contentSlots.reward.icon.height);
        expect(r.headline.height).toBe(base.contentSlots.reward.headline.height);
        expect(r.detail.height).toBe(base.contentSlots.reward.detail.height);
        expect(r.feature.height).toBeGreaterThanOrEqual(base.contentSlots.reward.feature.height);
      });

      it(`${label}: the choices block stays centred in content`, () => {
        const c = t.contentSlots.choices;
        const left = c.x - content.x;
        const right = (content.x + content.width) - (c.x + c.width);
        expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
      });
    }
  }
});

describe('runScreenLayout: the live viewport hook', () => {
  // The ACTIVE profile is what `DESIGN_SIZE` (and therefore the viewport
  // floor) is derived from, and it is the only platform whose scenes actually
  // run -- a mobile scene never renders under a desktop viewport. Node has no
  // DOM, so `detectProfile` resolves to desktop here.
  it('returns the authored template unchanged when the viewport is the design size', () => {
    resetViewport();
    for (const chrome of CHROMES) {
      expect(runScreenLayout('desktop', chrome)).toBe(runScreenTemplate('desktop', chrome));
    }
  });

  it('follows a viewport change, and is memoised within one viewport', () => {
    setViewport({ width: DESIGN_SIZE.width + 306, height: DESIGN_SIZE.height });
    const a = runScreenLayout('desktop');
    expect(runScreenLayout('desktop')).toBe(a);
    expect(a.canvas.width).toBe(DESIGN_SIZE.width + 306);

    setViewport({ width: DESIGN_SIZE.width + 160, height: DESIGN_SIZE.height });
    const b = runScreenLayout('desktop');
    expect(b).not.toBe(a);
    expect(b.canvas.width).toBe(DESIGN_SIZE.width + 160);
  });
});
