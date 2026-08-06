import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectProfile, DESKTOP_PROFILE, MOBILE_PROFILE } from '../../src/game/layoutProfile';
import type { LaunchScene } from '../../src/game/devLaunch';

/**
 * `detectProfile` has never had a test file (2026-08-06 gap-closing pass).
 * Its `?scene=` branches hand-copy a list of `LaunchScene` ids with zero
 * type-level connection to `devLaunch.ts`'s `LaunchScene` union — a NEW scene
 * id can be added there and silently fall through to the device-sniff
 * fallback (the wrong canvas: a 1440x900 layout squashed into a 412px
 * viewport, or vice versa), invisible to CI. This file closes that gap.
 */

// ---- Structural cross-check: the branch's ACTUAL key list vs LaunchScene ----

/**
 * Every LaunchScene member, classified by which canvas its `?scene=` value
 * should resolve to. This is the canonical, compile-time-checked partition —
 * see `_assertCoversLaunchScene` below — that the runtime cross-check
 * compares against what `layoutProfile.ts` ACTUALLY contains.
 *
 * `prep`/`battle`/`uikit` are the pre-mobile/desktop-split legacy scene ids —
 * confirmed via `src/game/scenes/BootScene.ts`, which routes them off
 * `ACTIVE_PROFILE.id` (the device sniff) rather than a forced `?scene=`
 * mapping, unlike every prefixed scene below. They are deliberately absent
 * from BOTH of `layoutProfile.ts`'s branches — carved out into their own
 * bucket here so the exhaustiveness check still accounts for all 21
 * `LaunchScene` members without asserting they appear in either branch.
 */
const MOBILE_LAUNCH_SCENES = [
  'mprep', 'mdeck', 'mbattle', 'mwiki',
  'mobile-shop', 'mobile-draft', 'mrunmap', 'mrunprep', 'mrunevent',
] as const;
const DESKTOP_LAUNCH_SCENES = [
  'desktop-wiki', 'desktop-prep', 'desktop-deck', 'desktop-battle',
  'desktop-shop', 'desktop-draft', 'desktop-runmap', 'desktop-runprep', 'desktop-runevent',
] as const;
const DEVICE_SNIFF_LAUNCH_SCENES = ['prep', 'battle', 'uikit'] as const;

type Listed = (typeof MOBILE_LAUNCH_SCENES)[number] | (typeof DESKTOP_LAUNCH_SCENES)[number] | (typeof DEVICE_SNIFF_LAUNCH_SCENES)[number];

/**
 * Compile-time exhaustiveness, BOTH directions, against the real `LaunchScene`
 * union (`src/game/devLaunch.ts`) — not a hand-copied runtime list a human
 * transcribed once and might forget to update. If `LaunchScene` ever gains a
 * member not classified above (`LaunchScene extends Listed` fails), OR one of
 * the arrays above names something `LaunchScene` doesn't have (`Listed
 * extends LaunchScene` fails), the conditional type below resolves to the
 * tuple-literal branch instead of `true`, and `tsc --noEmit` (part of `npm
 * test`) fails right here — forcing whoever grows `LaunchScene` to also say
 * which canvas the new scene belongs to.
 */
type AssertNoMissing = LaunchScene extends Listed ? true : ['LaunchScene has a member not classified in layoutProfile.test.ts', LaunchScene];
type AssertNoExtra = Listed extends LaunchScene ? true : ['layoutProfile.test.ts classifies a scene LaunchScene does not have', Listed];
const _assertCoversLaunchScene: AssertNoMissing = true;
const _assertNoExtraScenes: AssertNoExtra = true;
void _assertCoversLaunchScene;
void _assertNoExtraScenes;

/**
 * Pulls the literal scene-key arrays straight out of `detectProfile`'s own
 * source text — NOT hand-retyped — so this test breaks the moment
 * `layoutProfile.ts`'s actual branch diverges from the classification above,
 * in EITHER direction (a key added to one list and forgotten in the other).
 */
function extractSceneBranches(): { mobile: string[]; desktop: string[] } {
  const src = readFileSync(join(process.cwd(), 'src', 'game', 'layoutProfile.ts'), 'utf8');
  const re = /\[([^\]]+)\]\.includes\(params\.get\('scene'\)[^)]*\)\)\s*return\s+(MOBILE_PROFILE|DESKTOP_PROFILE);/g;
  const mobile: string[] = [];
  const desktop: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const keys = m[1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    (m[2] === 'MOBILE_PROFILE' ? mobile : desktop).push(...keys);
  }
  return { mobile, desktop };
}

describe('layoutProfile: detectProfile scene-key parity with devLaunch.LaunchScene', () => {
  it("detectProfile's ?scene= mobile branch is EXACTLY the classified mobile LaunchScene set", () => {
    const { mobile } = extractSceneBranches();
    expect(mobile.length, 'the extraction regex found nothing — it likely drifted from the source shape').toBeGreaterThan(0);
    expect(new Set(mobile)).toEqual(new Set(MOBILE_LAUNCH_SCENES));
  });

  it("detectProfile's ?scene= desktop branch is EXACTLY the classified desktop LaunchScene set", () => {
    const { desktop } = extractSceneBranches();
    expect(desktop.length).toBeGreaterThan(0);
    expect(new Set(desktop)).toEqual(new Set(DESKTOP_LAUNCH_SCENES));
  });

  it('the two branches are disjoint, and together with the device-sniff bucket cover every LaunchScene value exactly once', () => {
    const { mobile, desktop } = extractSceneBranches();
    const overlap = mobile.filter((k) => desktop.includes(k));
    expect(overlap, 'a scene key classified as BOTH mobile and desktop').toEqual([]);
    expect(mobile.length + desktop.length).toBe(MOBILE_LAUNCH_SCENES.length + DESKTOP_LAUNCH_SCENES.length);
    expect(mobile.length + desktop.length + DEVICE_SNIFF_LAUNCH_SCENES.length)
      .toBe(MOBILE_LAUNCH_SCENES.length + DESKTOP_LAUNCH_SCENES.length + DEVICE_SNIFF_LAUNCH_SCENES.length);
  });
});

// ---- Behavioral coverage: overrides beat inference; device sniff is last ----

/**
 * Stubs a minimal `window` for the duration of `run` — `detectProfile` short-
 * circuits to desktop when `typeof window === 'undefined'` (true under
 * vitest's `environment: 'node'`), so exercising the ui-override / scene-key
 * / device-sniff branches requires a real (if fake) `window` global. Restores
 * whatever was there before (nothing, in every real test here) afterward.
 */
function withWindow<T>(stub: {
  screen?: { width: number; height: number };
  matchMedia?: (query: string) => { matches: boolean };
}, run: () => T): T {
  const g = globalThis as { window?: unknown };
  const prev = g.window;
  g.window = { location: { search: '' }, ...stub };
  try {
    return run();
  } finally {
    if (prev === undefined) delete g.window;
    else g.window = prev;
  }
}

describe('layoutProfile: detectProfile precedence (?ui= > ?scene= > device sniff)', () => {
  it('a bare ?scene= (no ?ui=) infers the profile from the scene-key branch', () => {
    withWindow({}, () => {
      expect(detectProfile('?scene=mbattle')).toBe(MOBILE_PROFILE);
      expect(detectProfile('?scene=desktop-battle')).toBe(DESKTOP_PROFILE);
    });
  });

  it('an explicit ?ui= override wins even when ?scene= would infer the opposite profile', () => {
    withWindow({}, () => {
      expect(detectProfile('?ui=mobile&scene=desktop-battle')).toBe(MOBILE_PROFILE);
      expect(detectProfile('?ui=desktop&scene=mbattle')).toBe(DESKTOP_PROFILE);
    });
  });

  it('falls back to the coarse-pointer + short-edge device sniff when neither ?ui= nor ?scene= is present', () => {
    // Phone-shaped + coarse (touch) pointer -> mobile.
    withWindow({ screen: { width: 412, height: 892 }, matchMedia: () => ({ matches: true }) }, () => {
      expect(detectProfile('')).toBe(MOBILE_PROFILE);
    });
    // Wide desktop monitor, fine pointer -> desktop.
    withWindow({ screen: { width: 1920, height: 1080 }, matchMedia: () => ({ matches: false }) }, () => {
      expect(detectProfile('')).toBe(DESKTOP_PROFILE);
    });
    // Narrow but FINE pointer (a narrow desktop browser window) -> desktop —
    // the touch guard exists specifically to keep this case off mobile.
    withWindow({ screen: { width: 400, height: 1200 }, matchMedia: () => ({ matches: false }) }, () => {
      expect(detectProfile('')).toBe(DESKTOP_PROFILE);
    });
  });
});
