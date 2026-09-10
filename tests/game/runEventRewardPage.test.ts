import { afterEach, describe, expect, it, vi } from 'vitest';
import * as geometry from '../../src/game/ui/runRewardGeometry';
import type { RunScreenTemplate } from '../../src/game/ui/runScreenTemplate';
import { runScreenLayoutRef } from '../../src/game/ui/runScreenLayout';
import * as viewport from '../../src/game/viewport';
import { desktopEventChoosingLayout } from '../../src/game/scenes/DesktopRunEventScene';
import { mobileEventChoosingLayout } from '../../src/game/scenes/MobileRunEventScene';
import { layoutMergePicker, mergeChipIdeal } from '../../src/game/ui/runMergeViewModel';

// Wrong full-height panel or returning the choice layout must fail these
// independent bounds: the approved receipt is content-sized, with art on the
// left and reward context on the right (stacked on compact).
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../../src/game/ui/RunRewardPanel', () => ({}));

type PageTemplate = RunScreenTemplate & { eventOutcomePane: {
  header: { x: number; y: number; width: number; height: number };
} };
function page(platform: 'desktop' | 'mobile', kind: 'icon' | 'gem' | 'card' | 'picker', count = 2): PageTemplate {
  const template = runScreenLayoutRef(platform);
  const layout = platform === 'desktop' ? desktopEventChoosingLayout(template.regions.content, count + 1, 100)
    : mobileEventChoosingLayout(template.regions.content, count + 1, 96);
  const build = (geometry as any).eventOutcomePaneTemplate;
  expect(build, 'rewards must fit the existing event outcome pane').toBeTypeOf('function');
  return build(template, kind, layout.outcomes, layout.outcomeHeader);
}

afterEach(() => vi.restoreAllMocks());
describe('persistent event outcome pane geometry', () => {
  for (const [platform, width, height] of [['desktop', 1440, 900], ['mobile', 900, 900], ['mobile', 412, 892]] as const) {
    for (const otherChoiceCount of [1, 2]) {
    it.each(['icon', 'gem', 'card', 'picker'] as const)(`${width}×${height}, ${otherChoiceCount + 1} choices: %s keeps reward controls inside the unchanged event pane`, (kind) => {
      vi.spyOn(viewport, 'viewport').mockReturnValue({ width, height });
      const result = page(platform, kind, otherChoiceCount);
      expect(result.canvas).toEqual({ width, height });
      const template = runScreenLayoutRef(platform);
      const layout = platform === 'desktop' ? desktopEventChoosingLayout(template.regions.content, otherChoiceCount + 1, 100)
        : mobileEventChoosingLayout(template.regions.content, otherChoiceCount + 1, 96);
      const reward = result.contentSlots.reward;
      const content = result.regions.content;
      expect(result).not.toHaveProperty('eventRewardPage');
      expect(reward.panel).toEqual(layout.outcomes);
      expect(result.eventOutcomePane.header).toEqual(layout.outcomeHeader);
      expect(reward.buttons.height).toBe(kind === 'picker' ? 0 : 40);
      for (const rect of [reward.feature, reward.outcome.feature, reward.outcome.text, reward.buttons]) {
        expect(rect.x).toBeGreaterThanOrEqual(reward.panel.x);
        expect(rect.x + rect.width).toBeLessThanOrEqual(reward.panel.x + reward.panel.width);
        expect(rect.y).toBeGreaterThanOrEqual(layout.outcomeHeader.y + layout.outcomeHeader.height);
        expect(rect.y + rect.height).toBeLessThanOrEqual(reward.panel.y + reward.panel.height + 0.001);
      }
      expect(reward.panel.y + reward.panel.height).toBeLessThanOrEqual(content.y + content.height);
      expect(layout.story.height).toBeGreaterThanOrEqual(250);
      if (kind === 'picker') {
        for (const pickerKind of ['bonusDraft', 'upgradeCard', 'gemChoice', 'sellGem'] as const) {
          const rect = reward.feature;
          const window = geometry.layoutRewardPickerWindow(pickerKind, platform, rect, 20, rect.width, 92, 8, 0);
          expect(window.cells.length).toBeGreaterThan(0);
          expect(window.cells.every(cell => cell.h >= 56)).toBe(true);
          expect(window.pageCount).toBeGreaterThan(1);
          expect(window.pager!.next.h).toBeGreaterThanOrEqual(40);
        }
        const bands = layoutMergePicker(reward.detail, reward.feature, platform, 3);
        const captionH = platform === 'desktop' ? 20 : 18;
        const spentRect = { ...bands.spent, y: bands.spent.y + captionH, height: bands.spent.height - captionH };
        const spentIdeal = mergeChipIdeal(spentRect, platform);
        const spent = geometry.layoutRewardPickerWindow('mergeSpent', platform, spentRect, 3, spentIdeal.w, spentIdeal.h, platform === 'desktop' ? 12 : 8, 0);
        expect(spent.cells).toHaveLength(3);
        expect(spent.cells.every(cell => cell.h >= 32)).toBe(true);
        expect(spent.pager).toBeNull();
        const candidatesRect = { ...bands.candidates, y: bands.candidates.y + captionH, height: bands.candidates.height - captionH };
        const ideal = geometry.cardRowIdeal(candidatesRect, platform);
        const firstPage = geometry.layoutRewardPickerWindow('mergeCandidates', platform, candidatesRect, 20, ideal.w, ideal.h, platform === 'desktop' ? 12 : 8, 0);
        expect(firstPage.cells.length).toBeGreaterThan(0);
        expect(firstPage.cells.every(cell => cell.h >= 56 && cell.y >= spentRect.y + spentRect.height)).toBe(true);
        expect(firstPage.pager!.next.h).toBeGreaterThanOrEqual(40);
        const lastPage = geometry.layoutRewardPickerWindow('mergeCandidates', platform, candidatesRect, 20, ideal.w, ideal.h, platform === 'desktop' ? 12 : 8, firstPage.pageCount - 1);
        expect(lastPage.endIndex).toBe(20);
        expect(lastPage.canNext).toBe(false);
      }
    });
    }
  }
});
