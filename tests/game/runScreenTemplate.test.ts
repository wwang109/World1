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

  it('is deterministic (same reference each call)', () => {
    expect(runScreenTemplate('desktop')).toBe(runScreenTemplate('desktop'));
  });
});
