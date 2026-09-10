import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventArtBorderModel } from '../../src/game/ui/eventArtBorder';
import { BRIGHT_ART_TREATMENT } from '../../src/game/ui/brightArtTreatment';
import { UI } from '../../src/game/theme';

describe('manga event panels', () => {
  it('reserves framing for bespoke story art, not ordinary theme fallback', () => {
    const rect = { x: 18, y: 190, width: 376, height: 188 };
    expect(eventArtBorderModel('theme', rect)).toHaveLength(0);
    expect(eventArtBorderModel('event', rect).length).toBeGreaterThan(0);
  });
  it.each([
    { rect: { x: 40, y: 180, width: 520, height: 260 }, minCoverage: 0.9 },
    { rect: { x: 210, y: 320, width: 180, height: 90 }, minCoverage: 0.86 },
    { rect: { x: 18, y: 190, width: 376, height: 188 }, minCoverage: 0.9 },
  ])('contains every stroke including its thickness inside the current art slot $rect', ({ rect, minCoverage }) => {
    for (const stroke of eventArtBorderModel('event', rect)) {
      expect(stroke.bounds.x - stroke.width / 2).toBeGreaterThanOrEqual(rect.x);
      expect(stroke.bounds.y - stroke.width / 2).toBeGreaterThanOrEqual(rect.y);
      expect(stroke.bounds.x + stroke.bounds.width + stroke.width / 2).toBeLessThanOrEqual(rect.x + rect.width);
      expect(stroke.bounds.y + stroke.bounds.height + stroke.width / 2).toBeLessThanOrEqual(rect.y + rect.height);
      expect(stroke.bounds.width * stroke.bounds.height / (rect.width * rect.height)).toBeGreaterThan(minCoverage);
    }
  });
  it.each(['DesktopRunEventScene.ts', 'MobileRunEventScene.ts'])('%s keeps the shared POI border wired only to bespoke event art', file => {
    const source = readFileSync(join(process.cwd(), 'src', 'game', 'scenes', file), 'utf8');
    expect(source).toMatch(/if \(event\.art\.kind === 'event'\) \{\s*renderEventArtBorder\(this, event\.art\.kind,/);
  });
  it('gives every biome row text color a readable opaque local outline on bright or dark art', () => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1),16);
      const channels = [(n>>16)&255,(n>>8)&255,n&255].map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
      return channels[0]!*.2126+channels[1]!*.7152+channels[2]!*.0722;
    };
    const outline = lum(BRIGHT_ART_TREATMENT.biome.textStroke);
    for (const text of [UI.text, UI.textSoft, UI.textDim, UI.textAccent, UI.textAlarm]) {
      expect((lum(text)+.05)/(outline+.05),text).toBeGreaterThanOrEqual(4.5);
    }
    expect(BRIGHT_ART_TREATMENT.biome.textStrokeThickness).toBeGreaterThanOrEqual(2);
  });
});
