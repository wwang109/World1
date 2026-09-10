import { describe, expect, it, vi } from 'vitest';
import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../../src/game/layoutProfile';
import { runChoicePanelMinHeight } from '../../src/game/ui/RunChoicePanel';

vi.mock('phaser', () => ({
  default: {
    Scene: class FakeScene {},
    Math: { Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)) },
  },
}));

vi.mock('../../src/game/ui/RunRewardPanel', () => ({
  renderRunBonusDraftPicker: () => {},
  renderRunGemChoicePicker: () => {},
  renderRunMergeCardsPicker: () => {},
  renderRunRewardPanel: () => {},
  renderRunSellGemPicker: () => {},
  renderRunUpgradeCardPicker: () => {},
}));

type Rect = { x: number; y: number; width: number; height: number };
type Layout = {
  story: Rect;
  outcomes: Rect;
  outcomeHeader: Rect;
  choiceRows: Rect[];
};
type LayoutFn = (content: Rect, choiceCount: number, choiceMinHeight: number) => Layout;

const desktopModule = await import('../../src/game/scenes/DesktopRunEventScene') as unknown as {
  desktopEventChoosingLayout?: LayoutFn;
};
const mobileModule = await import('../../src/game/scenes/MobileRunEventScene') as unknown as {
  mobileEventChoosingLayout?: LayoutFn;
};

function requireLayout(fn: LayoutFn | undefined): LayoutFn {
  expect(fn, 'the choosing-state layout helper is not implemented').toBeTypeOf('function');
  return fn ?? (() => ({ story: { x: 0, y: 0, width: 0, height: 0 }, outcomes: { x: 0, y: 0, width: 0, height: 0 }, outcomeHeader: { x: 0, y: 0, width: 0, height: 0 }, choiceRows: [] }));
}

function bottom(rect: Rect): number { return rect.y + rect.height; }
function right(rect: Rect): number { return rect.x + rect.width; }

describe('desktop selected-event layout at 1440x900', () => {
  const content = { x: 32, y: 130, width: 1376, height: 746 };
  const minChoiceHeight = runChoicePanelMinHeight(DESKTOP_PROFILE.font);

  it.each([2, 3])('keeps all %i outcomes in the right pane and above the content floor', (choiceCount) => {
    const layout = requireLayout(desktopModule.desktopEventChoosingLayout)(content, choiceCount, minChoiceHeight);

    expect(right(layout.story)).toBeLessThan(layout.outcomes.x);
    expect(layout.outcomeHeader.x).toBeGreaterThanOrEqual(layout.outcomes.x);
    expect(layout.choiceRows).toHaveLength(choiceCount);
    for (const row of layout.choiceRows) {
      expect(row.x).toBeGreaterThanOrEqual(layout.outcomes.x);
      expect(right(row)).toBeLessThanOrEqual(right(layout.outcomes));
      expect(row.height).toBeGreaterThanOrEqual(minChoiceHeight);
      expect(bottom(row)).toBeLessThanOrEqual(bottom(content));
    }
  });
});
describe('compact selected-event layout', () => {
  const minChoiceHeight = runChoicePanelMinHeight(MOBILE_PROFILE.font);

  it('uses the shared runtime compact row-height contract', () => {
    expect(minChoiceHeight).toBe(90);
  });

  it.each([
    ['412x892', { x: 10, y: 122, width: 392, height: 706 }, 10],
    ['900x900', { x: 10, y: 122, width: 880, height: 706 }, 120],
  ] as const)('keeps a 3-choice event reachable at %s in one story-to-outcomes flow', (_name, content, expectedX) => {
    const layout = requireLayout(mobileModule.mobileEventChoosingLayout)(content, 3, minChoiceHeight);

    expect(layout.story).toEqual({ x: expectedX, y: 122, width: Math.min(660, content.width), height: 304 });
    expect(bottom(layout.story)).toBeLessThanOrEqual(layout.outcomeHeader.y);
    expect(bottom(layout.outcomeHeader)).toBeLessThanOrEqual(layout.choiceRows[0]!.y);
    expect(layout.choiceRows).toEqual([
      { x: expectedX, y: 468, width: Math.min(660, content.width), height: 90 },
      { x: expectedX, y: 566, width: Math.min(660, content.width), height: 90 },
      { x: expectedX, y: 664, width: Math.min(660, content.width), height: 90 },
    ]);
    expect(layout.outcomes.width).toBeLessThanOrEqual(660);
    for (const row of layout.choiceRows) {
      expect(row.height).toBeGreaterThanOrEqual(minChoiceHeight);
      expect(bottom(row)).toBeLessThanOrEqual(bottom(content));
    }
  });

  it('keeps both outcomes comfortably reachable for a 2-choice event at 412x892', () => {
    const content = { x: 10, y: 122, width: 392, height: 706 };
    const layout = requireLayout(mobileModule.mobileEventChoosingLayout)(content, 2, minChoiceHeight);

    expect(layout.story).toEqual({ x: 10, y: 122, width: 392, height: 304 });
    expect(layout.choiceRows).toEqual([
      { x: 10, y: 468, width: 392, height: 90 },
      { x: 10, y: 566, width: 392, height: 90 },
    ]);
    expect(layout.choiceRows.every((row) => row.height >= minChoiceHeight)).toBe(true);
    expect(bottom(layout.choiceRows[1]!)).toBeLessThanOrEqual(bottom(content));
  });
});
