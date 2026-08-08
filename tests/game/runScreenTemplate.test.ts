import { describe, expect, it } from 'vitest';
import {
  buildRewardSlot,
  runScreenTemplate,
  type Rect,
  type RunActionRole,
  type RunScreenRegion,
  type RunTemplatePlatform,
} from '../../src/game/ui/runScreenTemplate';

const PLATFORMS: RunTemplatePlatform[] = ['desktop', 'mobile'];
const REGIONS: RunScreenRegion[] = ['kicker', 'title', 'stats', 'badge', 'actions', 'content', 'footer'];
const ROLES: RunActionRole[] = ['back', 'secondary', 'tertiary', 'primary'];

function within(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('runScreenTemplate', () => {
  for (const platform of PLATFORMS) {
    const template = runScreenTemplate(platform);

    it(`${platform}: every region sits inside the canvas`, () => {
      const canvasRect: Rect = { x: 0, y: 0, width: template.canvas.width, height: template.canvas.height };
      for (const region of REGIONS) {
        expect(within(template.regions[region], canvasRect)).toBe(true);
      }
    });

    it(`${platform}: no two regions overlap`, () => {
      for (let i = 0; i < REGIONS.length; i++) {
        for (let j = i + 1; j < REGIONS.length; j++) {
          const a = template.regions[REGIONS[i]!];
          const b = template.regions[REGIONS[j]!];
          expect(overlaps(a, b)).toBe(false);
        }
      }
    });

    it(`${platform}: every action slot sits inside its declared region`, () => {
      for (const role of ROLES) {
        const region = template.actionRegionOf[role];
        expect(within(template.actionSlots[role], template.regions[region])).toBe(true);
      }
    });

    it(`${platform}: action slots for the same region never overlap each other`, () => {
      const byRegion = new Map<RunScreenRegion, RunActionRole[]>();
      for (const role of ROLES) {
        const region = template.actionRegionOf[role];
        byRegion.set(region, [...(byRegion.get(region) ?? []), role]);
      }
      for (const roles of byRegion.values()) {
        for (let i = 0; i < roles.length; i++) {
          for (let j = i + 1; j < roles.length; j++) {
            expect(overlaps(template.actionSlots[roles[i]!], template.actionSlots[roles[j]!])).toBe(false);
          }
        }
      }
    });
  }

  for (const platform of PLATFORMS) {
    // The stop/fight choices used to be positioned from the player's current
    // depth, so they slid across the screen as a run advanced. They are now a
    // fixed template slot; these two assertions are what keep them that way.
    it(`${platform}: the choices slot sits wholly inside content`, () => {
      const t = runScreenTemplate(platform);
      const c = t.contentSlots.choices;
      const content = t.regions.content;
      expect(c.x).toBeGreaterThanOrEqual(content.x);
      expect(c.y).toBeGreaterThanOrEqual(content.y);
      expect(c.x + c.width).toBeLessThanOrEqual(content.x + content.width);
      expect(c.y + c.height).toBeLessThanOrEqual(content.y + content.height);
      expect(c.width).toBeGreaterThan(0);
      expect(c.height).toBeGreaterThan(0);
    });

    it(`${platform}: the choices slot is depth-independent (a constant rect)`, () => {
      // A regression guard with teeth: the template takes no run state at all,
      // so the slot cannot vary with depth/wave. If someone reintroduces a
      // depth-derived position they must change this contract to do it.
      const a = runScreenTemplate(platform).contentSlots.choices;
      const b = runScreenTemplate(platform).contentSlots.choices;
      expect(a).toEqual(b);
      expect(runScreenTemplate.length).toBe(1); // (platform) only — no run arg
    });
  }

  it('is deterministic (same reference each call)', () => {
    expect(runScreenTemplate('desktop')).toBe(runScreenTemplate('desktop'));
  });

  // ---- statsOnly chrome (battle's HUD, 2026-08-04 decision) — kicker/title/
  // stats only, no badge/actions band, a higher content top. ----
  const CORE_REGIONS: RunScreenRegion[] = ['kicker', 'title', 'stats', 'content'];

  for (const platform of PLATFORMS) {
    const full = runScreenTemplate(platform);
    const statsOnly = runScreenTemplate(platform, 'statsOnly');

    it(`${platform} statsOnly: kicker/title/stats are IDENTICAL to full chrome`, () => {
      // The stat string can never diverge from other run screens, so the
      // rects it's drawn at must be byte-identical between chrome variants.
      expect(statsOnly.regions.kicker).toEqual(full.regions.kicker);
      expect(statsOnly.regions.title).toEqual(full.regions.title);
      expect(statsOnly.regions.stats).toEqual(full.regions.stats);
    });

    it(`${platform} statsOnly: core regions sit inside the canvas`, () => {
      const canvasRect: Rect = { x: 0, y: 0, width: statsOnly.canvas.width, height: statsOnly.canvas.height };
      for (const region of CORE_REGIONS) {
        expect(within(statsOnly.regions[region], canvasRect)).toBe(true);
      }
    });

    it(`${platform} statsOnly: no two core regions overlap`, () => {
      for (let i = 0; i < CORE_REGIONS.length; i++) {
        for (let j = i + 1; j < CORE_REGIONS.length; j++) {
          const a = statsOnly.regions[CORE_REGIONS[i]!];
          const b = statsOnly.regions[CORE_REGIONS[j]!];
          expect(overlaps(a, b)).toBe(false);
        }
      }
    });

    it(`${platform} statsOnly: content starts below stats (no badge/actions band to clear)`, () => {
      const statsBottom = statsOnly.regions.stats.y + statsOnly.regions.stats.height;
      expect(statsOnly.regions.content.y).toBeGreaterThanOrEqual(statsBottom);
      // And HIGHER than full chrome's content top — the whole point of the
      // variant is reclaiming the badge/actions band's vertical space.
      expect(statsOnly.regions.content.y).toBeLessThan(full.regions.content.y);
    });

    it(`${platform} statsOnly: badge/actions are zero-area (never rendered)`, () => {
      expect(statsOnly.regions.badge.width * statsOnly.regions.badge.height).toBe(0);
      expect(statsOnly.regions.actions.width * statsOnly.regions.actions.height).toBe(0);
    });

    it(`${platform} statsOnly: is deterministic and chrome-tagged`, () => {
      expect(runScreenTemplate(platform, 'statsOnly')).toBe(runScreenTemplate(platform, 'statsOnly'));
      expect(statsOnly.chrome).toBe('statsOnly');
      expect(full.chrome).toBe('full');
    });
  }

  it(`desktop statsOnly: contentTop is ~84`, () => {
    expect(runScreenTemplate('desktop', 'statsOnly').regions.content.y).toBe(84);
  });

  it(`mobile statsOnly: content.y is ~62`, () => {
    expect(runScreenTemplate('mobile', 'statsOnly').regions.content.y).toBe(62);
  });

  // The REWARD slot is the fix for a reward block that ran off the bottom of a
  // 900-tall canvas. These assertions are the guard: the button row must be
  // reserved INSIDE content (its position, on both platforms) and the panel
  // must stop a declared gap short of it, on both platforms and for any
  // future tweak to the region math.
  for (const platform of ['desktop', 'mobile'] as const) {
    it(`${platform}: reward buttons sit at the bottom of content`, () => {
      const t = runScreenTemplate(platform);
      const { content } = t.regions;
      const { buttons } = t.contentSlots.reward;
      expect(buttons.x).toBe(content.x);
      expect(buttons.width).toBe(content.width);
      // Pinned to the BOTTOM of content — never pushed past it by a tall reward.
      expect(buttons.y + buttons.height).toBe(content.y + content.height);
      expect(buttons.y).toBeGreaterThanOrEqual(content.y);
    });

    // DESKTOP ONLY: `buttons` reserves real height there because
    // `RunRewardPanel.ts` draws its own in-panel CONTINUE into it (the
    // primary go-forward action lives in the HEADER on desktop, far from
    // this panel). MOBILE reserves none (task #33, 2026-08-07): its primary
    // action already lives in the HUD's footer, and a second CONTINUE drawn
    // into this row duplicated it a thumb's-width away — see
    // `runScreenTemplate.ts`'s `REWARD_BUTTON_H` doc comment.
    if (platform === 'desktop') {
      it(`${platform}: reward buttons reserve real height inside content`, () => {
        const t = runScreenTemplate(platform);
        const { buttons } = t.contentSlots.reward;
        expect(buttons.height).toBeGreaterThan(0);
      });
    } else {
      it(`${platform}: reward buttons reserve NO height — the row is a zero-height placeholder`, () => {
        const t = runScreenTemplate(platform);
        const { buttons } = t.contentSlots.reward;
        expect(buttons.height).toBe(0);
      });
    }

    it(`${platform}: reward panel stops a declared gap short of the buttons`, () => {
      const t = runScreenTemplate(platform);
      const { panel, gap, buttons } = t.contentSlots.reward;
      // DESKTOP ONLY: a real gap separates the panel from its own in-panel
      // CONTINUE. Mobile draws no button there, so both `gap` and the
      // reserved `buttons` row collapse to 0 (see the sibling test above) —
      // the panel simply extends to fill the space that reservation would
      // have cost, which is what the arithmetic identity below still proves.
      if (platform === 'desktop') expect(gap).toBeGreaterThan(0);
      else expect(gap).toBe(0);
      expect(panel.height).toBeGreaterThan(0);
      // Panel bottom + gap lands exactly on the button row: no overlap, no drift.
      expect(panel.y + panel.height + gap).toBe(buttons.y);
    });

    it(`${platform}: reward panel never escapes content`, () => {
      const t = runScreenTemplate(platform);
      const { content } = t.regions;
      const { panel } = t.contentSlots.reward;
      expect(panel.x).toBeGreaterThanOrEqual(content.x);
      expect(panel.y).toBeGreaterThanOrEqual(content.y);
      expect(panel.x + panel.width).toBeLessThanOrEqual(content.x + content.width);
      expect(panel.y + panel.height).toBeLessThanOrEqual(content.y + content.height);
    });
  }

  // The reward panel's INNER sub-rects (icon/headline/detail/feature) — the
  // "single reusable reward format" every outcome kind (card/gem/gold/level/
  // nothing) renders into via `RunRewardPanel.ts`, never a per-kind cursor.
  // `feature` (the actual card/gem visual) is the one that shrinks: it gets
  // whatever the panel has left after the three fixed rows above it, so it
  // can never push past the panel's own bottom edge (already proven not to
  // escape `content` by the tests above).
  const REWARD_INNER_KEYS = ['icon', 'headline', 'detail', 'feature'] as const;

  for (const platform of ['desktop', 'mobile'] as const) {
    it(`${platform}: every reward inner sub-rect sits wholly inside the panel`, () => {
      const t = runScreenTemplate(platform);
      const { panel } = t.contentSlots.reward;
      for (const key of REWARD_INNER_KEYS) {
        const r = t.contentSlots.reward[key];
        expect(within(r, panel)).toBe(true);
        expect(r.width).toBeGreaterThan(0);
        expect(r.height).toBeGreaterThan(0);
      }
    });

    it(`${platform}: reward inner sub-rects never overlap each other`, () => {
      const t = runScreenTemplate(platform);
      for (let i = 0; i < REWARD_INNER_KEYS.length; i++) {
        for (let j = i + 1; j < REWARD_INNER_KEYS.length; j++) {
          const a = t.contentSlots.reward[REWARD_INNER_KEYS[i]!];
          const b = t.contentSlots.reward[REWARD_INNER_KEYS[j]!];
          expect(overlaps(a, b)).toBe(false);
        }
      }
    });

    it(`${platform}: reward inner sub-rects stack top-to-bottom in icon/headline/detail/feature order`, () => {
      const t = runScreenTemplate(platform);
      const { icon, headline, detail, feature } = t.contentSlots.reward;
      expect(icon.y).toBeLessThan(headline.y);
      expect(headline.y).toBeLessThan(detail.y);
      expect(detail.y).toBeLessThan(feature.y);
    });

    it(`${platform}: a real, POSITIVE, CONSISTENT gap separates every consecutive reward inner sub-rect`, () => {
      // `overlaps()` alone would NOT catch two rects left touching edge-to-
      // edge with a zero gap (touching isn't overlapping) — this is the
      // sharper check: measure each gap directly and require it be the same
      // positive value between every pair, so a gap silently dropped to 0
      // (or made inconsistent) fails here even though nothing "overlaps".
      const t = runScreenTemplate(platform);
      const { icon, headline, detail, feature } = t.contentSlots.reward;
      const gapIconHeadline = headline.y - (icon.y + icon.height);
      const gapHeadlineDetail = detail.y - (headline.y + headline.height);
      const gapDetailFeature = feature.y - (detail.y + detail.height);
      expect(gapIconHeadline).toBeGreaterThan(0);
      expect(gapHeadlineDetail).toBe(gapIconHeadline);
      expect(gapDetailFeature).toBe(gapIconHeadline);
    });

    it(`${platform}: feature's bottom edge sits the panel's own padding short of the panel's bottom edge`, () => {
      // CHANGED 2026-08-06 (redesign): this used to assert `feature` reached
      // the panel's bottom edge EXACTLY — correct when the panel was a
      // borderless fill with no inset. The panel is now a padded FRAME
      // (`REWARD_PANEL_PAD`, `runScreenTemplate.ts`), so `feature` stops one
      // padding-width short of the border, matching the SAME padding applied
      // at the icon's top (`icon.y - panel.y`) — derived here, not
      // hardcoded, so this can't drift from whatever the constant actually
      // is. `feature` is still the ONE part that shrinks (never the panel
      // itself), which is what this test's original name was guarding.
      const t = runScreenTemplate(platform);
      const { panel, icon, feature } = t.contentSlots.reward;
      const pad = icon.y - panel.y;
      expect(pad).toBeGreaterThan(0);
      expect(feature.y + feature.height).toBe(panel.y + panel.height - pad);
    });

    it(`${platform}: the declared gap (plus the panel's own padding) still separates feature from buttons`, () => {
      // Same shape as "reward panel stops a declared gap short of the
      // buttons" above, restated against `feature` — updated for the
      // redesign's panel padding (see the sibling test above) the same way.
      const t = runScreenTemplate(platform);
      const { gap, buttons, feature, panel, icon } = t.contentSlots.reward;
      const pad = icon.y - panel.y;
      expect(feature.y + feature.height + pad + gap).toBe(buttons.y);
    });

    it(`${platform}: reward inner sub-rects are deterministic (no run/content dependency)`, () => {
      const a = runScreenTemplate(platform).contentSlots.reward;
      const b = runScreenTemplate(platform).contentSlots.reward;
      expect(a).toEqual(b);
    });
  }

  // The resolved-outcome screen's OWN `outcome` sub-shape (task #41 density
  // pass, 2026-08-08) — ADDITIVE alongside `icon`/`headline`/`detail`/
  // `feature` above, which stay exactly as they were (the bonus-draft/
  // upgrade-card PICKERS still read those, untouched by this pass). See
  // `runScreenTemplate.ts`'s `reward.outcome` doc comment for what each part
  // is for and why desktop/mobile deliberately differ here.
  const OUTCOME_KEYS = ['identity', 'text', 'feature'] as const;

  for (const platform of PLATFORMS) {
    it(`${platform}: every outcome sub-rect sits wholly inside the panel`, () => {
      const t = runScreenTemplate(platform);
      const { panel, outcome } = t.contentSlots.reward;
      for (const key of OUTCOME_KEYS) {
        const r = outcome[key];
        expect(within(r, panel)).toBe(true);
        expect(r.width).toBeGreaterThan(0);
        expect(r.height).toBeGreaterThan(0);
      }
    });

    it(`${platform}: outcome sub-rects never overlap each other`, () => {
      const t = runScreenTemplate(platform);
      const { outcome } = t.contentSlots.reward;
      for (let i = 0; i < OUTCOME_KEYS.length; i++) {
        for (let j = i + 1; j < OUTCOME_KEYS.length; j++) {
          expect(overlaps(outcome[OUTCOME_KEYS[i]!], outcome[OUTCOME_KEYS[j]!])).toBe(false);
        }
      }
    });

    it(`${platform}: identity sits above the text/feature body`, () => {
      const t = runScreenTemplate(platform);
      const { identity, text, feature } = t.contentSlots.reward.outcome;
      expect(identity.y + identity.height).toBeLessThanOrEqual(text.y);
      expect(identity.y + identity.height).toBeLessThanOrEqual(feature.y);
    });

    it(`${platform}: outcome sub-rects are deterministic (no run/content dependency)`, () => {
      const a = runScreenTemplate(platform).contentSlots.reward.outcome;
      const b = runScreenTemplate(platform).contentSlots.reward.outcome;
      expect(a).toEqual(b);
    });
  }

  it("desktop: text and feature sit SIDE BY SIDE (the 'wide band' answer) — same top, same height, feature to text's right", () => {
    const { text, feature } = runScreenTemplate('desktop').contentSlots.reward.outcome;
    expect(text.y).toBe(feature.y);
    expect(text.height).toBe(feature.height);
    expect(feature.x).toBeGreaterThanOrEqual(text.x + text.width);
  });

  it("mobile: text and feature are STACKED (the 'narrow column' answer) — feature starts below text, both full width", () => {
    const { identity, text, feature } = runScreenTemplate('mobile').contentSlots.reward.outcome;
    expect(text.y + text.height).toBeLessThanOrEqual(feature.y);
    expect(text.width).toBe(identity.width);
    expect(feature.width).toBe(identity.width);
  });

  it('mobile: feature gets the LARGE remaining height below the fixed text band, not a modest fixed size', () => {
    // Pins the actual density-pass motivation: before this pass, everything
    // below the headline/detail on mobile's already content-filling panel
    // sat empty. `feature` must now claim that room.
    const { feature } = runScreenTemplate('mobile').contentSlots.reward.outcome;
    expect(feature.height).toBeGreaterThan(300);
  });

  // 2026-08-06 redesign: a reward panel that filled its ENTIRE region read as
  // "a token lost in a stadium" on a wide desktop window (Phaser.Scale.EXPAND
  // lets `content.width` exceed 1900px there) — these pin the fix, driving
  // `buildRewardSlot` directly against SYNTHETIC content rects (a wide/tall
  // window the real, fixed-per-platform template can't otherwise exercise).
  describe('reward panel is capped and content-centered (2026-08-06 redesign)', () => {
    it('desktop: panel is capped well short of a wide content region, and centered horizontally within it', () => {
      const wide: Rect = { x: 32, y: 130, width: 1900, height: 900 };
      const capped = buildRewardSlot(wide, 'desktop');
      expect(capped.panel.width).toBeLessThan(wide.width / 2);
      const leftMargin = capped.panel.x - wide.x;
      const rightMargin = wide.x + wide.width - (capped.panel.x + capped.panel.width);
      expect(leftMargin).toBeCloseTo(rightMargin);
    });

    it('desktop: panel is capped well short of a tall content region, and bottom-anchored (slack collects ABOVE it, not below)', () => {
      const tall: Rect = { x: 32, y: 130, width: 1376, height: 2000 };
      const capped = buildRewardSlot(tall, 'desktop');
      expect(capped.panel.height).toBeLessThan(tall.height / 2);
      // Bottom-anchored: the panel's bottom sits exactly `gap` above the
      // buttons row regardless of how much slack the height cap leaves.
      expect(capped.panel.y + capped.panel.height + capped.gap).toBe(capped.buttons.y);
      // All the slack from the cap is ABOVE the panel, not split around it —
      // "CONTINUE sits near the content" by construction.
      expect(capped.panel.y).toBeGreaterThan(tall.y + 100);
    });

    it("mobile: panel is NOT capped — still fills the available height (bonus-draft's wrapped grid needs the room)", () => {
      const t = runScreenTemplate('mobile');
      const { content } = t.regions;
      const { panel, gap, buttons } = t.contentSlots.reward;
      expect(panel.width).toBe(content.width);
      expect(panel.y).toBe(content.y);
      expect(panel.y + panel.height + gap).toBe(buttons.y);
    });

    it('never lets the panel exceed content on either axis, even far past the cap', () => {
      const huge: Rect = { x: 0, y: 0, width: 4000, height: 4000 };
      for (const platform of PLATFORMS) {
        const capped = buildRewardSlot(huge, platform);
        expect(capped.panel.width).toBeLessThanOrEqual(huge.width);
        expect(capped.panel.height).toBeLessThanOrEqual(huge.height);
      }
    });
  });
});
