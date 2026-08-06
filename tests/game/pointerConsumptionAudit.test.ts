import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression coverage for the "phantom dialog" pointer-timing bug (see
 * `src/game/sceneRebuild.ts`'s `wasPointerConsumedByRebuild` doc comment):
 * shipped, unguarded, at five+ separate call sites before this test existed —
 * each fix was a one-off patch that the next sweep missed. This scans SOURCE,
 * not runtime behavior (this repo's vitest env is plain `node`; there is no
 * canvas to drive a real Phaser click through), so it can't prove a listener
 * behaves correctly — only that it has NOT dropped the one guard every such
 * listener needs. That is deliberately cheap to keep true and expensive to
 * silently regress.
 *
 * Covers BOTH `pointerdown` AND `pointerup`: Phaser's `InputPlugin` dispatches
 * both in the IDENTICAL two-phase shape (`processDownEvents` /
 * `processUpEvents`, `node_modules/phaser/src/input/InputPlugin.js`) — a
 * per-object emit loop first, then a scene-level emit to whatever generic
 * listener is registered AT THAT MOMENT. Every current `pointerup` in this
 * codebase is scene-level, not object-level, so nothing live can trigger the
 * bug via `pointerup` today — but the FIRST object-level `pointerup` handler
 * anyone writes (a button reacting on release instead of press) is exactly as
 * exposed as a `pointerdown` one always was, so this sweep holds the line on
 * both phases rather than just the one that happened to bite first.
 */
const GAME_DIR = join(process.cwd(), 'src', 'game');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** Either phase counts — Phaser re-dispatches the SAME physical event to a
 * fresh scene-level listener after a mid-dispatch rebuild regardless of
 * whether that event is a down or an up. */
const GENERIC_POINTER_PHASES: Array<{ name: 'pointerdown' | 'pointerup'; pattern: RegExp }> = [
  { name: 'pointerdown', pattern: /\.input\.on\(\s*['"]pointerdown['"]/ },
  { name: 'pointerup', pattern: /\.input\.on\(\s*['"]pointerup['"]/ },
];
/** Either mitigation counts: the shared structural guard, or a scene's own
 * manual `consumedPointerAt`-downTime check (the shop scenes' pre-existing
 * idiom, which this repo keeps alongside the structural guard). */
const GUARD = /wasPointerConsumedByRebuild\(|consumedPointerAt/;
/** How many lines past the registration a guard must appear within — every
 * fixed listener in this repo puts it as the first real statement, but several
 * carry a multi-line doc comment ABOVE that statement explaining why; this
 * window is generous on purpose (comment lines, not tuning). */
const WINDOW = 16;
/** A doc comment that happens to mention `.input.on('pointerdown')` in
 * backticks (e.g. explaining the mechanism) is not a REGISTRATION — only
 * actual code lines count. */
const COMMENT_LINE = /^\s*(\*|\/\/)/;

/**
 * KNOWN SWEEP LIMITATION (left as-is; see the task audit that raised it): this
 * only matches the literal `.input.on('pointerdown'|'pointerup', …)` source
 * shape. A destructured `input` variable (`const { input } = this;
 * input.on(...)`) or the `Phaser.Input.Events.POINTER_DOWN`/`POINTER_UP`
 * constant form escapes it. Every registration in this codebase today uses
 * the literal `this.input.on('pointerdown'|'pointerup', …)` / `scene.input.on(
 * …)` form (grep-confirmed), and the brittleness is a deliberate trade for a
 * sweep that stays a plain string/regex scan — cheap to read, cheap to keep
 * green, no AST tooling. If either alternate form shows up, widen this regex
 * then; until it does, this is documentation of the gap, not a fix for it.
 */
describe('src/game: every scene-level generic pointerdown/pointerup listener guards against rebuild-timing re-dispatch', () => {
  it('calls wasPointerConsumedByRebuild() (or the manual consumedPointerAt idiom) within the handler', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(GAME_DIR)) {
      if (file.endsWith('sceneRebuild.ts')) continue; // defines the guard, doesn't need it
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (COMMENT_LINE.test(line)) return; // a doc comment referencing the API, not a real registration
        for (const phase of GENERIC_POINTER_PHASES) {
          if (!phase.pattern.test(line)) continue;
          const windowText = lines.slice(i, i + WINDOW).join('\n');
          if (!GUARD.test(windowText)) {
            offenders.push(`${file.replace(process.cwd(), '')}:${i + 1}  [${phase.name}]  ${line.trim()}`);
          }
        }
      });
    }
    expect(
      offenders,
      'A scene-level generic pointerdown/pointerup listener with no consumed-pointer guard can misinterpret a ' +
        'click/tap that a sibling dialog button already handled by rebuilding the scene mid-dispatch — Phaser\'s ' +
        'processDownEvents AND processUpEvents both dispatch per-object-then-scene-level for the SAME physical ' +
        'event (see src/game/sceneRebuild.ts). Add `if (wasPointerConsumedByRebuild(this, p)) return;` as the ' +
        `first line of the handler:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

/**
 * `renderRetireConfirm` (`src/game/ui/RunProgressStrip.ts`) is the SHARED
 * component behind CONFIRMED INSTANCE #20 (audit 2026-08): its scrim/CANCEL/
 * RETIRE buttons must hand the triggering pointer to the caller's
 * `onCancel`/`onConfirm`, not swallow it — see that function's doc comment.
 */
describe('src/game/ui/RunProgressStrip: renderRetireConfirm threads the triggering pointer', () => {
  const src = readFileSync(join(GAME_DIR, 'ui', 'RunProgressStrip.ts'), 'utf8');

  it('declares onCancel/onConfirm as taking a pointer, not a bare callback', () => {
    expect(src).toMatch(/onConfirm:\s*\(pointer:\s*Phaser\.Input\.Pointer\)\s*=>\s*void/);
    expect(src).toMatch(/onCancel:\s*\(pointer:\s*Phaser\.Input\.Pointer\)\s*=>\s*void/);
  });

  it('every internal pointerdown handler (scrim, CANCEL, RETIRE) forwards the pointer, never calls with zero args', () => {
    // Every dispatch site must pass an argument through — `opts.onCancel()` /
    // `opts.onConfirm()` with NO argument is the exact regression this guards.
    const bareCalls = [...src.matchAll(/opts\.on(?:Cancel|Confirm)\(\s*\)/g)];
    expect(bareCalls.map((m) => m[0])).toEqual([]);
    expect(src.match(/opts\.onCancel\(pointer\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2); // scrim + CANCEL button
    expect(src.match(/opts\.onConfirm\(pointer\)/g)?.length ?? 0).toBeGreaterThanOrEqual(1); // RETIRE button
  });
});

/**
 * GAP 3 (audit 2026-08): six Run*Scene files (RunPrep/RunMap/RunEvent ×
 * desktop/mobile) each render `renderRetireConfirm`, which rebuilds the scene
 * on CANCEL/RETIRE. Whether that rebuild's timing-hazard can manifest depends
 * on whether the scene ALSO has a scene-level generic pointerdown/pointerup
 * listener for it to race against — true for exactly one of the six
 * (MobileRunEventScene, which needs one for its scrollable event body). The
 * commit that first documented this ("REVIEWED AND LEFT: … no scene-level
 * generic listener at all … documented in-code at each site") was correct
 * about five files and wrong about the sixth, and had added no in-code
 * documentation to any of them. This locks BOTH halves of the true claim so
 * neither can silently drift false again:
 *   - the five "clean" scenes stay listener-free (if one gains a scene-level
 *     pointerdown/pointerup, this fails — that's the signal to add a guard
 *     AND update its in-code doc, not silently ignore it), and
 *   - each of the six files says something ACCURATE about its own situation.
 */
describe('src/game: RunPrep/RunMap/RunEvent — truthful in-code documentation of the rebuild-timing hazard', () => {
  const CLEAN_FILES = [
    'DesktopRunPrepScene.ts',
    'MobileRunPrepScene.ts',
    'DesktopRunMapScene.ts',
    'MobileRunMapScene.ts',
    'DesktopRunEventScene.ts',
  ];
  const LISTENER_FILE = 'MobileRunEventScene.ts';
  const GENERIC_LISTENER = /\.input\.on\(\s*['"](pointerdown|pointerup)['"]/;
  const TRUTH_MARKER = /no scene-level generic (pointerdown\/pointerup )?listener/i;

  it.each(CLEAN_FILES)('%s: has no scene-level generic pointerdown/pointerup listener, and says so in-code', (name) => {
    const src = readFileSync(join(GAME_DIR, 'scenes', name), 'utf8');
    expect(GENERIC_LISTENER.test(src)).toBe(false);
    expect(src).toMatch(TRUTH_MARKER);
  });

  it(`${LISTENER_FILE}: DOES register a scene-level generic pointerdown/pointerup listener (conditionally), and says so in-code`, () => {
    const src = readFileSync(join(GAME_DIR, 'scenes', LISTENER_FILE), 'utf8');
    expect(GENERIC_LISTENER.test(src)).toBe(true);
    expect(src).toMatch(/unlike its RunPrep\/RunMap siblings/i);
  });
});
