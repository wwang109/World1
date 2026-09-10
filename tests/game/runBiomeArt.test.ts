import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { biomeIds } from '../../src/data/biomes';
import { UI } from '../../src/game/theme';
import { RUN_ART_ASSETS } from '../../src/game/ui/runArt';
import { biomeArtKey, RUN_ART_KEYS } from '../../src/game/ui/runArtKeys';
import {
  bandBannerBackdropLayers,
  bandBannerLayout,
  bandBannerViewModel,
} from '../../src/game/ui/bandBannerViewModel';
import { forecastBand } from '../../src/run/biomeForecast';
import { createRun } from '../../src/run/runState';

const ROOT = process.cwd();

const EXPECTED = {
  arrowfell: { key: 'run-art-biome-arrowfell', path: '/game-art/placeholders/biome-arrowfell.webp' },
  duskbarrow: { key: 'run-art-biome-duskbarrow', path: '/game-art/placeholders/biome-duskbarrow.webp' },
  emberwaste: { key: 'run-art-biome-emberwaste', path: '/game-art/placeholders/biome-emberwaste.webp' },
  frostmarch: { key: 'run-art-biome-frostmarch', path: '/game-art/placeholders/biome-frostmarch.webp' },
  hallowfield: { key: 'run-art-biome-hallowfield', path: '/game-art/placeholders/biome-hallowfield.webp' },
  howlmoor: { key: 'run-art-biome-howlmoor', path: '/game-art/placeholders/biome-howlmoor.webp' },
  ironmoot: { key: 'run-art-biome-ironmoot', path: '/game-art/placeholders/biome-ironmoot.webp' },
  pikewold: { key: 'run-art-biome-pikewold', path: '/game-art/placeholders/biome-pikewold.webp' },
  stormreach: { key: 'run-art-biome-stormreach', path: '/game-art/placeholders/biome-stormreach.webp' },
  swornhold: { key: 'run-art-biome-swornhold', path: '/game-art/placeholders/biome-swornhold.webp' },
  thornwild: { key: 'run-art-biome-thornwild', path: '/game-art/placeholders/biome-thornwild.webp' },
} as const;

type BiomeId = keyof typeof EXPECTED;

function pngHeader(bytes: Buffer): { width: number; height: number; colorType: number } {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25]! };
}

function webpHeader(bytes: Buffer): { width: number; height: number; hasAlpha: boolean } {
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    expect(bytes.subarray(23, 26)).toEqual(Buffer.from([0x9d, 0x01, 0x2a]));
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
      hasAlpha: false,
    };
  }
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      hasAlpha: (bits & 0x10000000) !== 0,
    };
  }
  expect(chunk).toBe('VP8X');
  return {
    width: 1 + bytes.readUIntLE(24, 3),
    height: 1 + bytes.readUIntLE(27, 3),
    hasAlpha: (bytes[20]! & 0x10) !== 0,
  };
}

function forecastForEveryBiome(): Map<BiomeId, ReturnType<typeof forecastBand>> {
  const found = new Map<BiomeId, ReturnType<typeof forecastBand>>();
  for (let seed = 1; seed < 400 && found.size < biomeIds.length; seed += 1) {
    const run = createRun(seed);
    for (let band = 0; band < 3; band += 1) {
      const forecast = forecastBand(run, band);
      if (forecast.biomeId in EXPECTED) found.set(forecast.biomeId as BiomeId, forecast);
    }
  }
  return found;
}

describe('biome band art coverage', () => {
  it('gives every live biome one exact key and rejects unknown IDs instead of falling back', () => {
    expect([...biomeIds].sort()).toEqual(Object.keys(EXPECTED).sort());

    for (const [biomeId, expected] of Object.entries(EXPECTED)) {
      expect(RUN_ART_KEYS.biome[biomeId as BiomeId], biomeId).toBe(expected.key);
      expect(biomeArtKey(biomeId), biomeId).toBe(expected.key);
    }
    expect(() => biomeArtKey('not-a-live-biome')).toThrow(/unknown biome/i);
  });

  it('preloads every biome key from its exact served path', () => {
    expect(RUN_ART_ASSETS).toHaveLength(53);
    expect(new Set(RUN_ART_ASSETS.map((asset) => asset.key)).size).toBe(53);
    expect(new Set(RUN_ART_ASSETS.map((asset) => asset.path)).size).toBe(53);
    const loadedPaths = new Map(RUN_ART_ASSETS.map((asset) => [asset.key, asset.path]));
    for (const [biomeId, expected] of Object.entries(EXPECTED)) {
      expect(loadedPaths.get(expected.key), biomeId).toBe(expected.path);
    }
  });

  it('ships unique 512x288 opaque RGB masters and matching WebP derivatives', () => {
    const masterHashes = new Set<string>();
    const derivativeHashes = new Set<string>();
    for (const biomeId of Object.keys(EXPECTED) as BiomeId[]) {
      const masterPath = join(ROOT, 'art-src', 'placeholders', `biome-${biomeId}.png`);
      const derivativePath = join(ROOT, 'public', 'game-art', 'placeholders', `biome-${biomeId}.webp`);
      expect(existsSync(masterPath), `${biomeId} master`).toBe(true);
      expect(existsSync(derivativePath), `${biomeId} derivative`).toBe(true);
      if (!existsSync(masterPath) || !existsSync(derivativePath)) continue;

      const masterBytes = readFileSync(masterPath);
      const derivativeBytes = readFileSync(derivativePath);
      expect(pngHeader(masterBytes), biomeId).toEqual({ width: 512, height: 288, colorType: 2 });
      expect(webpHeader(derivativeBytes), biomeId).toEqual({ width: 512, height: 288, hasAlpha: false });
      masterHashes.add(createHash('sha256').update(masterBytes).digest('hex'));
      derivativeHashes.add(createHash('sha256').update(derivativeBytes).digest('hex'));
    }
    expect(masterHashes.size).toBe(11);
    expect(derivativeHashes.size).toBe(11);
  });

  it('exposes the exact biome identity and art key in every live band view model', () => {
    const forecasts = forecastForEveryBiome();
    expect(forecasts.size).toBe(11);
    for (const [biomeId, forecast] of forecasts) {
      const vm = bandBannerViewModel(forecast);
      expect(vm.biomeId, biomeId).toBe(biomeId);
      expect(vm.artKey, biomeId).toBe(EXPECTED[biomeId].key);
    }
  });

  it('keeps most biome color visible beneath a light veil without changing either platform layout', () => {
    const forecast = forecastForEveryBiome().get('thornwild');
    expect(forecast).toBeDefined();
    if (forecast === undefined) return;
    const vm = bandBannerViewModel(forecast);
    const rect = { x: 7, y: 11, w: 243, h: 219 };
    const layers = bandBannerBackdropLayers(vm, rect);
    expect(layers.map((layer) => layer.kind)).toEqual(['image', 'scrim']);
    expect(layers[0]).toEqual({
      kind: 'image',
      textureKey: 'run-art-biome-thornwild',
      bounds: { x: 7, y: 11, width: 243, height: 219 },
      alpha: 1,
    });
    expect(layers[1]).toMatchObject({
      kind: 'scrim',
      bounds: { x: 7, y: 11, width: 243, height: 219 },
      color: UI.panelMuted,
    });
    expect(layers[1]?.alpha).toEqual(expect.any(Number));
    expect(layers[1]?.alpha as number).toBeGreaterThanOrEqual(0.15);
    expect(layers[1]?.alpha as number).toBeLessThanOrEqual(0.3);

    for (const mode of ['desktop', 'mobile'] as const) {
      const before = bandBannerLayout(vm, mode);
      const differentArtIdentity = {
        ...vm,
        biomeId: 'arrowfell',
        artKey: 'run-art-biome-arrowfell',
      };
      expect(bandBannerLayout(differentArtIdentity, mode)).toEqual(before);
    }
  });
});
