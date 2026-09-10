import { describe, expect, it } from 'vitest';
import {
  startSceneAssetPaths,
  startSceneLayout,
  startSceneLifetimeOffsets,
  startScenePrimaryPresentation,
  startScenePrimaryVisualLayout,
} from '../../src/game/ui/startSceneLayout';

function edges(rect: { x: number; y: number; width: number; height: number }) {
  return {
    left: rect.x - rect.width / 2,
    right: rect.x + rect.width / 2,
    top: rect.y - rect.height / 2,
    bottom: rect.y + rect.height / 2,
  };
}

describe('startSceneLayout', () => {
  it.each(['desktop', 'mobile'] as const)('keeps lifetime icon/text groups clear on %s', (profile) => {
    const offsets = startSceneLifetimeOffsets(profile);
    expect(offsets.separators[0] - offsets.text[0]).toBeGreaterThan(70 * offsets.unit);
    expect(offsets.separators[1] - offsets.text[1]).toBeGreaterThan(80 * offsets.unit);
    expect(offsets.icons[2] - offsets.separators[1]).toBeGreaterThan(25 * offsets.unit);
  });

  it('selects landing-specific painted backgrounds and one ornamental CTA frame', () => {
    expect(startSceneAssetPaths('desktop')).toEqual({
      background: '/game-art/placeholders/start-background-desktop.webp',
      ctaFrame: '/game-art/placeholders/start-cta-frame.webp',
      icons: '/game-art/placeholders/start-icons.webp',
    });
    expect(startSceneAssetPaths('mobile')).toEqual({
      background: '/game-art/placeholders/start-background-mobile.webp',
      ctaFrame: '/game-art/placeholders/start-cta-frame.webp',
      icons: '/game-art/placeholders/start-icons.webp',
    });
  });

  it.each([
    ['desktop', 1440, 900, 0],
    ['desktop', 1600, 900, 0],
    ['desktop', 1920, 1080, 90],
    ['desktop', 1440, 1200, 150],
    ['mobile', 412, 892, 0],
    ['mobile', 430, 932, 20],
    ['mobile', 640, 892, 0],
    ['mobile', 412, 1080, 94],
  ] as const)(
    'keeps one fixed-rhythm centered composition on %s %sx%s',
    (profile, width, height, offsetY) => {
      const layout = startSceneLayout(profile, width, height);
      const baseline = startSceneLayout(profile, profile === 'mobile' ? 412 : 1440, profile === 'mobile' ? 892 : 900);

      expect(layout.eyebrowY - baseline.eyebrowY).toBe(offsetY);
      expect(layout.primary.y - baseline.primary.y).toBe(offsetY);
      expect(layout.seed.y - baseline.seed.y).toBe(offsetY);
      expect(layout.primary.width).toBe(baseline.primary.width);
      expect(layout.primary.height).toBe(baseline.primary.height);
      expect(layout.primary.y - layout.title.y).toBe(baseline.primary.y - baseline.title.y);
      expect(layout.seed.y - layout.primary.y).toBe(baseline.seed.y - baseline.primary.y);
    },
  );

  it('keeps Start and Resume promises distinct and gives mobile Resume safe label inset', () => {
    expect(startScenePrimaryPresentation(false, 'desktop')).toEqual({
      label: 'BEGIN THE JOURNEY ›',
      detail: 'Draft your board · climb the endless ladder',
      labelFontSize: 32,
    });
    expect(startScenePrimaryPresentation(true, 'desktop')).toEqual({
      label: 'RESUME THE JOURNEY ›',
      detail: 'Return to the map · continue your climb',
      labelFontSize: 32,
    });
    expect(startScenePrimaryPresentation(true, 'mobile')).toEqual({
      label: 'RESUME THE JOURNEY ›',
      detail: 'Return to the map · continue your climb',
      labelFontSize: 16,
    });
    expect(startScenePrimaryPresentation(false, 'mobile').labelFontSize).toBe(16);
  });

  it.each([
    [412, 892],
    [430, 932],
    [640, 892],
    [412, 1080],
  ] as const)('keeps both mobile CTA text lines inside the coral inner field at %sx%s', (width, height) => {
    const rect = startSceneLayout('mobile', width, height).primary;
    const visual = startScenePrimaryVisualLayout('mobile', rect);

    expect(visual.frameY).toBe(rect.y);
    expect(visual.labelY - visual.labelHalfHeight).toBeGreaterThan(visual.innerTop);
    expect(visual.labelY + visual.labelHalfHeight).toBeLessThan(visual.detailY - visual.detailHalfHeight);
    expect(visual.detailY + visual.detailHalfHeight).toBeLessThan(visual.innerBottom);
  });

  it('matches the approved centered desktop composition', () => {
    const layout = startSceneLayout('desktop', 1440, 900);

    expect(layout.centerX).toBe(720);
    expect(layout.eyebrowY).toBe(243);
    expect(layout.title).toEqual({ x: 720, y: 318, fontSize: 96 });
    expect(layout.primary).toEqual({ x: 720, y: 463, width: 500, height: 94 });
    expect(layout.sandbox).toEqual({ x: 720, y: 580, width: 260, height: 54 });
    expect(layout.seed).toEqual({ x: 720, y: 755, width: 282, height: 48 });
  });

  it('matches the approved portrait composition with the journey controls in the lower half', () => {
    const layout = startSceneLayout('mobile', 412, 892);

    expect(layout.centerX).toBe(206);
    expect(layout.eyebrowY).toBe(390);
    expect(layout.title).toEqual({ x: 206, y: 435, fontSize: 56 });
    expect(layout.primary).toEqual({ x: 206, y: 520, width: 310, height: 82 });
    expect(layout.sandbox).toEqual({ x: 206, y: 586, width: 210, height: 48 });
    expect(layout.seed).toEqual({ x: 206, y: 682, width: 248, height: 46 });
  });

  it.each([
    ['desktop', 1440, 900],
    ['mobile', 412, 892],
  ] as const)('keeps hierarchy centered and interactive targets at least 44px on %s', (profile, width, height) => {
    const layout = startSceneLayout(profile, width, height);

    expect(layout.title.x).toBe(layout.centerX);
    expect(layout.primary.x).toBe(layout.centerX);
    expect(layout.sandbox.x).toBe(layout.centerX);
    expect(layout.seed.x).toBe(layout.centerX);
    expect(layout.primary.height).toBeGreaterThanOrEqual(44);
    expect(layout.sandbox.height).toBeGreaterThanOrEqual(44);
    expect(layout.seed.height).toBeGreaterThanOrEqual(44);
    expect(layout.primary.width * layout.primary.height)
      .toBeGreaterThan(layout.sandbox.width * layout.sandbox.height * 2.5);
  });

  it.each([
    ['desktop', 1440, 900],
    ['mobile', 412, 892],
  ] as const)('keeps the vertical rhythm ordered and the seed inside the safe canvas on %s', (profile, width, height) => {
    const layout = startSceneLayout(profile, width, height);
    const primary = edges(layout.primary);
    const sandbox = edges(layout.sandbox);
    const seed = edges(layout.seed);

    expect(layout.ruleY).toBeLessThan(primary.top);
    expect(primary.bottom).toBeLessThan(sandbox.top);
    expect(sandbox.bottom).toBeLessThan(layout.lifetimeY);
    expect(layout.lifetimeY).toBeLessThan(layout.lowerRuleY);
    expect(layout.lowerRuleY).toBeLessThan(seed.top);
    expect(seed.left).toBeGreaterThanOrEqual(10);
    expect(seed.right).toBeLessThanOrEqual(width - 10);
    expect(seed.bottom).toBeLessThanOrEqual(height - 10);
  });
});
