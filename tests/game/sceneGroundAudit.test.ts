import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/**
 * These scenes paint the full viewport before any panels or art are added.
 * They used to carry a private copy of the pre-lift navy (`0x0b1420`), so the
 * mobile game stayed visibly darker than desktop after `UI.bg` was raised.
 * Keep the two layouts independent, but make their world ground come from the
 * same semantic palette token.
 */
const FULL_VIEWPORT_SCENES = [
  'StartScene.ts',
  'MobileBattleScene.ts',
  'MobileDeckBuildScene.ts',
  'MobileDraftScene.ts',
  'MobilePrepScene.ts',
  'MobileRunEventScene.ts',
  'MobileRunMapScene.ts',
  'MobileRunPrepScene.ts',
  'MobileShopScene.ts',
  'MobileWikiScene.ts',
] as const;

describe('full-screen scene grounds', () => {
  it.each(FULL_VIEWPORT_SCENES)('%s uses the lifted semantic world ground', (file) => {
    const source = readFileSync(join(ROOT, 'src', 'game', 'scenes', file), 'utf8');
    expect(source).toContain('setBackgroundColor(UI.bg)');
    expect(source).not.toContain('setBackgroundColor(0x0b1420)');
  });
});
