import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eventCatalog } from '../../src/data/events';
import { eventArtKey, RUN_ART_KEYS } from '../../src/game/ui/runArtKeys';

const ROOT = process.cwd();
const EVENT_SCENES = ['DesktopRunEventScene.ts', 'MobileRunEventScene.ts'];
const MAP_SCENES = ['DesktopRunMapScene.ts', 'MobileRunMapScene.ts'];
const BELL_ART_FILES = ['event-bell-beneath-ice', 'event-second-toll', 'event-bell-unbound'] as const;

function pngHeader(bytes: Buffer): { width: number; height: number; colorType: number } {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25]! };
}

function webpDimensions(bytes: Buffer): { width: number; height: number } {
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    expect(bytes.subarray(23, 26)).toEqual(Buffer.from([0x9d, 0x01, 0x2a]));
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  expect(chunk).toBe('VP8X');
  return {
    width: 1 + bytes.readUIntLE(24, 3),
    height: 1 + bytes.readUIntLE(27, 3),
  };
}

describe('data-driven event art', () => {
  it('the three Bell definitions carry their closed-vocabulary art ids from JSON', () => {
    expect(eventCatalog.bell_beneath_ice!.artId).toBe('bell_beneath_ice');
    expect(eventCatalog.the_second_toll!.artId).toBe('second_toll');
    expect(eventCatalog.the_bell_unbound!.artId).toBe('bell_unbound');
  });

  it('resolves a per-event override and otherwise falls back to theme art', () => {
    expect(eventArtKey('cache', 'bell_beneath_ice')).toBe(RUN_ART_KEYS.eventStory.bell_beneath_ice);
    expect(eventArtKey('omen', 'second_toll')).toBe(RUN_ART_KEYS.eventStory.second_toll);
    expect(eventArtKey('forge', 'bell_unbound')).toBe(RUN_ART_KEYS.eventStory.bell_unbound);
    expect(eventArtKey('cache')).toBe(RUN_ART_KEYS.event.cache);
  });

  for (const scene of EVENT_SCENES) {
    it(`${scene} resolves story art from the committed presentation`, () => {
      const source = readFileSync(join(ROOT, 'src', 'game', 'scenes', scene), 'utf8');
      expect(source).toMatch(
        /eventArtKey\(event\.context\.theme, event\.art\.kind === 'event' \? event\.art\.artId : undefined\)/,
      );
    });
  }

  for (const scene of MAP_SCENES) {
    it(`${scene} keeps unresolved map previews on theme art`, () => {
      const source = readFileSync(join(ROOT, 'src', 'game', 'scenes', scene), 'utf8');
      expect(source).not.toContain('.artId');
    });
  }

  it('ships exact 1774x887 opaque-source PNG masters and matching 2:1 WebP derivatives under budget', () => {
    for (const file of BELL_ART_FILES) {
      const masterPath = join(ROOT, 'art-src', 'placeholders', `${file}.png`);
      const derivativePath = join(ROOT, 'public', 'game-art', 'placeholders', `${file}.webp`);
      const header = pngHeader(readFileSync(masterPath));
      const master = { width: header.width, height: header.height };
      const derivative = webpDimensions(readFileSync(derivativePath));
      expect(header.colorType, `${file}.png must be opaque RGB, not alpha-bearing RGBA`).toBe(2);
      expect(master).toEqual({ width: 1774, height: 887 });
      expect(derivative).toEqual(master);
      expect(master.width / master.height).toBe(2);
      expect(statSync(derivativePath).size).toBeLessThan(400 * 1024);
    }
  });

  it('registers every Bell texture key and served derivative in the boot-time run-art list', () => {
    const source = readFileSync(join(ROOT, 'src', 'game', 'ui', 'runArt.ts'), 'utf8');
    for (const [artId, file] of [
      ['bell_beneath_ice', 'event-bell-beneath-ice.webp'],
      ['second_toll', 'event-second-toll.webp'],
      ['bell_unbound', 'event-bell-unbound.webp'],
    ] as const) {
      expect(source).toContain(`RUN_ART_KEYS.eventStory.${artId}`);
      expect(source).toContain(`/game-art/placeholders/${file}`);
    }
  });
});
