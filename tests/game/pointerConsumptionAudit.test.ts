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

const GENERIC_POINTERDOWN = /\.input\.on\(\s*['"]pointerdown['"]/;
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

describe('src/game: every scene-level generic pointerdown listener guards against rebuild-timing re-dispatch', () => {
  it('calls wasPointerConsumedByRebuild() (or the manual consumedPointerAt idiom) within the handler', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(GAME_DIR)) {
      if (file.endsWith('sceneRebuild.ts')) continue; // defines the guard, doesn't need it
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (COMMENT_LINE.test(line)) return; // a doc comment referencing the API, not a real registration
        if (!GENERIC_POINTERDOWN.test(line)) return;
        const windowText = lines.slice(i, i + WINDOW).join('\n');
        if (!GUARD.test(windowText)) {
          offenders.push(`${file.replace(process.cwd(), '')}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      'A scene-level generic pointerdown listener with no consumed-pointer guard can misinterpret a click ' +
        'that a sibling dialog button already handled by rebuilding the scene mid-dispatch (see ' +
        'src/game/sceneRebuild.ts). Add `if (wasPointerConsumedByRebuild(this, p)) return;` as the first line ' +
        `of the handler:\n${offenders.join('\n')}`,
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
