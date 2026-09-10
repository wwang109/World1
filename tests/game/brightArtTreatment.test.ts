import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UI } from '../../src/game/theme';
import { BRIGHT_ART_TREATMENT } from '../../src/game/ui/brightArtTreatment';

const ROOT = process.cwd();
const source = (relativePath: string): string => readFileSync(join(ROOT, relativePath), 'utf8');

function luminance(color: number): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((color >> 16) & 255)
    + 0.7152 * channel((color >> 8) & 255)
    + 0.0722 * channel(color & 255);
}

function numericColor(color: string): number {
  return Number.parseInt(color.replace('#', ''), 16);
}

function blendOverWhite(color: number, alpha: number): number {
  const channel = (shift: number): number => Math.round(((color >> shift) & 255) * alpha + 255 * (1 - alpha));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function contrastRatio(a: number, b: number): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe('bright illustrated run-screen treatment', () => {
  it('shows story and storefront art at full strength with purposeful light washes', () => {
    expect(BRIGHT_ART_TREATMENT.story.imageAlpha).toBe(1);
    expect(BRIGHT_ART_TREATMENT.story.liftAlpha).toBeGreaterThan(0);
    expect(BRIGHT_ART_TREATMENT.story.liftAlpha).toBeLessThanOrEqual(0.08);
    expect(BRIGHT_ART_TREATMENT.storefront.imageAlpha).toBe(1);
    expect(BRIGHT_ART_TREATMENT.storefront.liftAlpha).toBeGreaterThanOrEqual(0.12);
    expect(BRIGHT_ART_TREATMENT.storefront.liftAlpha).toBeLessThanOrEqual(0.2);
    expect(luminance(UI.artLift)).toBeGreaterThan(0.8);
  });

  it('keeps the start and map illustrations visibly dominant under pale washes', () => {
    for (const treatment of [BRIGHT_ART_TREATMENT.start, BRIGHT_ART_TREATMENT.map]) {
      expect(treatment.imageAlpha).toBeGreaterThanOrEqual(0.55);
      expect(treatment.liftAlpha).toBeGreaterThan(0);
      expect(treatment.liftAlpha).toBeLessThanOrEqual(0.12);
      expect(treatment.imageAlpha * (1 - treatment.liftAlpha)).toBeGreaterThanOrEqual(0.5);
    }
    expect(BRIGHT_ART_TREATMENT.map.ambienceAlpha).toBeLessThan(BRIGHT_ART_TREATMENT.map.imageAlpha);
  });

  it('keeps the main route stronger than its quiet wave bands', () => {
    expect(BRIGHT_ART_TREATMENT.chrome.headerScrimAlpha).toBeGreaterThanOrEqual(0.65);
    for (const alpha of [BRIGHT_ART_TREATMENT.chrome.routeScrimAlpha, BRIGHT_ART_TREATMENT.chrome.labelPlateAlpha]) {
      const worstCaseGround = blendOverWhite(UI.bg, alpha);
      expect(contrastRatio(numericColor(UI.textDim), worstCaseGround)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(numericColor(UI.textAccent), worstCaseGround)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(numericColor(UI.textMuted), worstCaseGround)).toBeGreaterThanOrEqual(4.5);
    }
    expect(BRIGHT_ART_TREATMENT.route.waveBandAlpha).toBeLessThanOrEqual(0.1);
    expect(BRIGHT_ART_TREATMENT.route.lineAlpha).toBeGreaterThan(BRIGHT_ART_TREATMENT.route.waveBandAlpha * 4);
  });

  it.each([
    'src/game/scenes/DesktopShopScene.ts',
    'src/game/scenes/MobileShopScene.ts',
  ])('%s uses the shared bright storefront treatment and lifted tile surface', (file) => {
    const text = source(file);
    expect(text).toContain('addBrightRunArt(this, shopArtKey(id)');
    expect(text).toContain('UI.panelAlt, 0.94');
  });

  it.each([
    'src/game/scenes/DesktopRunEventScene.ts',
    'src/game/scenes/MobileRunEventScene.ts',
  ])('%s uses the shared bright story treatment and lifted body surface', (file) => {
    const text = source(file);
    expect(text).toContain('const storyArt = addBrightRunArt(');
    expect(text).toContain('BRIGHT_ART_TREATMENT.story');
    expect(text).toMatch(/bodyBox[^\n]+UI\.panelAlt/);
  });

  it('lifts enabled choice and reward panels without lifting disabled rows', () => {
    const choices = source('src/game/ui/RunChoicePanel.ts');
    const rewards = source('src/game/ui/RunRewardPanel.ts');
    expect(choices).toContain('model.enabled ? UI.panelAlt : UI.panelMuted');
    expect(rewards).toMatch(/renderPanelBackground[\s\S]+UI\.panelAlt, 0\.94/);
  });

  it.each([
    'src/game/scenes/DesktopRunMapScene.ts',
    'src/game/scenes/MobileRunMapScene.ts',
  ])('%s uses broad ambient masses and the quiet map-art treatment', (file) => {
    const text = source(file);
    expect(text).toContain('addBrightRunArt(this, RUN_ART_KEYS.runMap');
    expect(text).toContain('BRIGHT_ART_TREATMENT.map.ambienceAlpha');
    expect(text).toContain('UI.bgBlobA');
    expect(text).toContain('UI.bgBlobB');
    expect(text).not.toContain('UI.bg, BRIGHT_ART_TREATMENT.map');
  });

  it('gives the shared start screen a bright illustrated world backdrop', () => {
    const text = source('src/game/scenes/StartScene.ts');
    expect(text).toContain('addBrightRunArt(this, RUN_ART_KEYS.runMap');
    expect(text).toContain('BRIGHT_ART_TREATMENT.start');
    expect(text).toContain('BRIGHT_ART_TREATMENT.start.vignette');
    const vignette = BRIGHT_ART_TREATMENT.start.vignette;
    expect(vignette.layers).toBeGreaterThanOrEqual(12);
    expect(vignette.layerAlpha).toBeGreaterThan(0);
    expect(vignette.layerAlpha).toBeLessThanOrEqual(0.1);
    const accumulatedAlpha = 1 - (1 - vignette.layerAlpha) ** vignette.layers;
    expect(accumulatedAlpha).toBeGreaterThanOrEqual(0.85);
    expect(accumulatedAlpha).toBeLessThanOrEqual(0.92);
  });

  it('keeps route hierarchy in the shared route renderer', () => {
    const text = source('src/game/ui/RunRouteBoard.ts');
    expect(text).toContain('BRIGHT_ART_TREATMENT.chrome.routeScrimAlpha');
    expect(text).toContain('BRIGHT_ART_TREATMENT.route.waveBandAlpha');
    expect(text).toContain('UI.chip, BRIGHT_ART_TREATMENT.route.lineAlpha');
  });

  it('backs the shared run HUD with a readable calm band over bright scenery', () => {
    const text = source('src/game/ui/RunProgressStrip.ts');
    expect(text).toContain('BRIGHT_ART_TREATMENT.chrome.headerScrimAlpha');
  });
});
