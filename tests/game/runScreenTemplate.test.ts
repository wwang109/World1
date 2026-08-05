import { describe, expect, it } from 'vitest';
import {
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
});
