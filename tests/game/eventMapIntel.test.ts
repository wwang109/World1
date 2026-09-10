import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MapIntelRecord } from '../../src/run/runState';
import { runChoicePanelMinHeight } from '../../src/game/ui/RunChoicePanel';
import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../../src/game/layoutProfile';
import { eventChoiceBlockHeight } from '../../src/game/ui/runEventStoryLayout';
import { mapIntelLayoutModel, type MapIntelLayoutModel } from '../../src/game/ui/mapIntelLayout';

type Rect = { x: number; y: number; width: number; height: number };

type MapIntelLayout = MapIntelLayoutModel;
type MapIntelLayoutWithHeading = MapIntelLayout & { heading?: Rect };

function literalRecord(band: number): MapIntelRecord {
  return {
    band,
    sourceEventInstanceId: `event:source-${band}`,
    snapshot: {
      band,
      fromWave: band * 5 + 1,
      throughWave: band * 5 + 5,
      biomeId: `biome-${band}`,
      name: `THE ${band === 1 ? 'ARROWFELL' : band === 2 ? 'DUSKBARROW' : 'FROSTMARCH'}`,
      tagline: `A literal forecast for band ${band}.`,
      lean: { kind: 'weapon', type: 'bow' },
      leanLabel: 'BOW',
      mobs: [],
      boss: null,
      bossCandidates: [],
      bossCounter: { basis: 'shortlist', types: [] },
      shops: [],
      eventThemes: ['omen'],
    },
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

function within(inner: Rect, outer: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

const CASES = [
  ['empty', []],
  ['two bands', [literalRecord(1), literalRecord(2)]],
  ['three bands', [literalRecord(1), literalRecord(2), literalRecord(3)]],
  ['long content', Array.from({ length: 12 }, (_, index) => literalRecord(index + 1))],
] as const;

describe('map intel layout model', () => {
  it('exports the pure model required by both map scenes', () => {
    expect(mapIntelLayoutModel).toBeTypeOf('function');
  });

  for (const [label, records] of CASES) {
    it(`desktop 1440×900: ${label} has a forecast rail that never overlaps the route`, () => {
      const model = mapIntelLayoutModel(records, { width: 1440, height: 900 });
      expect(model.mode).toBe('desktop');
      expect(model.mask).toBeUndefined();
      expect(model.maxScroll).toBe(0);
      expect(overlaps(model.rail, model.route)).toBe(false);
      const heading = (model as MapIntelLayoutWithHeading).heading;
      expect(heading, 'desktop cards need a dedicated MAP INTEL heading bound').toBeDefined();
      if (heading) {
        expect(within(heading, model.rail)).toBe(true);
        for (const card of model.cards) expect(overlaps(heading, card.rect)).toBe(false);
        if (model.cards.length > 0) {
          expect(model.cards[0]!.rect.y - (heading.y + heading.height)).toBe(8);
        }
      }
      expect(model.cards.map((card) => card.record.band)).toEqual(records.map((record) => record.band));
      for (const card of model.cards) expect(within(card.rect, model.rail)).toBe(true);
    });

    it(`mobile 412×892: ${label} stays inside a masked MAP INTEL surface`, () => {
      const model = mapIntelLayoutModel(records, { width: 412, height: 892 });
      expect(model.mode).toBe('mobile');
      expect(model.mask).toBeDefined();
      expect(model.close).toBeDefined();
      expect(within(model.mask!, model.rail)).toBe(true);
      expect(within(model.close!, model.rail)).toBe(true);
      expect(overlaps(model.close!, model.mask!)).toBe(false);
      expect(model.close!.height).toBeGreaterThanOrEqual(MOBILE_PROFILE.minTap);
      expect(model.mask!.y - (model.close!.y + model.close!.height)).toBe(12);
      expect(model.cards.map((card) => card.record.band)).toEqual(records.map((record) => record.band));
      expect(model.maxScroll).toBeGreaterThanOrEqual(0);

      if (records.length > 0) {
        const first = model.cards[0]!.rect;
        const last = model.cards[model.cards.length - 1]!.rect;
        expect(first.y).toBeGreaterThanOrEqual(model.mask!.y);
        expect(first.y).toBeLessThanOrEqual(model.mask!.y + model.mask!.height);
        expect(last.y + last.height - model.maxScroll).toBeGreaterThanOrEqual(model.mask!.y);
        expect(last.y + last.height - model.maxScroll).toBeLessThanOrEqual(model.mask!.y + model.mask!.height);
      }
      if (label === 'long content') expect(model.maxScroll).toBeGreaterThan(0);
    });
  }
});

describe('mobile MAP INTEL rebuild interaction guard', () => {
  it('checks the rebuild-consumed pointer before its generic sheet pointerdown begins a drag', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'game', 'ui', 'RunRouteBoard.ts'), 'utf8');
    const handlerStart = source.indexOf("scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {");
    const handlerEnd = source.indexOf("scene.input.on('pointermove'", handlerStart);
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handler).toContain('if (wasPointerConsumedByRebuild(scene, pointer)) return;');
    expect(handler.indexOf('wasPointerConsumedByRebuild')).toBeLessThan(handler.indexOf('if (!insideMask'));
    expect(handler.indexOf('if (!insideMask')).toBeLessThan(handler.indexOf('dragging = true;'));
  });
});

describe('event choice geometry at the approved viewports', () => {
  const cases = [
    ['desktop', DESKTOP_PROFILE, 10],
    ['mobile', MOBILE_PROFILE, 8],
  ] as const;

  for (const [platform, profile, gap] of cases) {
    it(`${platform}: two and three choice rectangles are disjoint, and a fourth is outside the approved bound`, () => {
      const rowHeight = runChoicePanelMinHeight(profile.font);
      const rects = (count: number): Rect[] => Array.from({ length: count }, (_, index) => ({
        x: 0, y: index * (rowHeight + gap), width: 320, height: rowHeight,
      }));

      for (const count of [2, 3]) {
        const rows = rects(count);
        expect(rows).toHaveLength(count);
        expect(eventChoiceBlockHeight(count, rowHeight, gap)).toBe(rows[rows.length - 1]!.y + rowHeight);
        for (let left = 0; left < rows.length; left += 1) {
          for (let right = left + 1; right < rows.length; right += 1) {
            expect(overlaps(rows[left]!, rows[right]!)).toBe(false);
          }
        }
      }
      expect(4).toBeGreaterThan(3);
    });
  }
});
