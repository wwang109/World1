import { describe, expect, it } from 'vitest';
import { runArtCropGeometry } from '../../src/game/ui/runArt';

describe('run art cover geometry', () => {
  it('fills a portrait mobile frame after cropping a wide illustration', () => {
    const geometry = runArtCropGeometry(
      { width: 1672, height: 941 },
      { width: 412, height: 892 },
    );

    expect(geometry.cropHeight).toBe(941);
    expect(geometry.cropWidth).toBeCloseTo(941 * 412 / 892);
    expect(geometry.cropX).toBeGreaterThan(0);
    expect(geometry.cropWidth * geometry.scaleX).toBeCloseTo(412);
    expect(geometry.cropHeight * geometry.scaleY).toBeCloseTo(892);
  });

  it('fills a wide desktop frame after trimming excess source height', () => {
    const geometry = runArtCropGeometry(
      { width: 1200, height: 1200 },
      { width: 1440, height: 900 },
    );

    expect(geometry.cropWidth).toBe(1200);
    expect(geometry.cropHeight).toBe(750);
    expect(geometry.cropY).toBe(225);
    expect(geometry.cropWidth * geometry.scaleX).toBeCloseTo(1440);
    expect(geometry.cropHeight * geometry.scaleY).toBeCloseTo(900);
  });
});
