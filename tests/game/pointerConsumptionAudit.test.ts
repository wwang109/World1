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
/** The shared structural guard. The shop scenes used to ALSO keep a manual
 * `consumedPointerAt`-downTime check alongside it (a plain-`downTime`
 * comparison — unsound, since two distinct clicks can share a `downTime` on
 * browsers with reduced timer resolution or synthetic input); that legacy
 * idiom was removed 2026-08 once the structural guard alone was confirmed to
 * cover every call site. `consumedPointerAt` stays in this regex as a legal
 * alternate guard shape — harmless, since nothing in the codebase matches it
 * today — rather than narrowing this sweep on the same pass that removed it. */
const GUARD = /wasPointerConsumedByRebuild\(|consumedPointerAt/;

/** Mask comments without moving source offsets, so a comment cannot either
 * invent a registration or satisfy a handler's guard. This stays deliberately
 * small and source-shaped: the audit does not need a new parser dependency. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (comment) => ' '.repeat(comment.length));
}

function escaped(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Return exactly one braced callback body, or null when the source callback
 * cannot be resolved. The latter deliberately FAILS CLOSED. */
function bracedBody(source: string, code: string, openingBrace: number): string | null {
  let depth = 0;
  for (let i = openingBrace; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openingBrace + 1, i);
    }
  }
  return null;
}

function namedHandlerBody(source: string, code: string, name: string): string | null {
  const safeName = escaped(name);
  const declaration = new RegExp(
    `(?:const|let)\\s+${safeName}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*(?::[^=]+)?=>\\s*\\{|` +
    `function\\s+${safeName}\\s*\\([^)]*\\)\\s*(?::[^\\{]+)?\\{`,
  );
  const match = declaration.exec(code);
  if (!match || match.index === undefined) return null;
  const openingBrace = match.index + match[0].lastIndexOf('{');
  return bracedBody(source, code, openingBrace);
}

function handlerBodyAtRegistration(source: string, code: string, registrationAt: number): string | null {
  const tail = code.slice(registrationAt);
  const named = /^\.input\.on\(\s*['"]pointer(?:down|up)['"]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/.exec(tail);
  if (named?.[1]) return namedHandlerBody(source, code, named[1]);

  const inline = /^\.input\.on\(\s*['"]pointer(?:down|up)['"]\s*,\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/.exec(tail);
  if (!inline || inline.index === undefined) return null;
  const openingBrace = registrationAt + inline[0].lastIndexOf('{');
  return bracedBody(source, code, openingBrace);
}

function pointerOffenders(source: string, file = '<fixture>'): string[] {
  const code = withoutComments(source);
  const lines = code.split('\n');
  const offenders: string[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    for (const phase of GENERIC_POINTER_PHASES) {
      const registration = phase.pattern.exec(line);
      if (!registration || registration.index === undefined) continue;
      const body = handlerBodyAtRegistration(source, code, offset + registration.index);
      if (!body || !GUARD.test(withoutComments(body))) {
        offenders.push(`${file}:${i + 1}  [${phase.name}]  ${source.split('\n')[i]!.trim()}`);
      }
    }
    offset += line.length + 1;
  }
  return offenders;
}
/** How many lines past the registration a guard must appear within — every
 * fixed listener in this repo puts it as the first real statement, but several
 * carry a multi-line doc comment ABOVE that statement explaining why; this
 * window is generous on purpose (comment lines, not tuning). */
/** A doc comment that happens to mention `.input.on('pointerdown')` in
 * backticks (e.g. explaining the mechanism) is not a REGISTRATION — only
 * actual code lines count. */

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
      offenders.push(...pointerOffenders(readFileSync(file, 'utf8'), file.replace(process.cwd(), '')));
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

describe('pointer-consumption source detector fixtures', () => {
  it('resolves guarded named pointerdown and pointerup callbacks declared before registration', () => {
    const source = `
      const onPointerDown = (p: Pointer): void => {
        if (wasPointerConsumedByRebuild(scene, p)) return;
        open();
      };
      function onPointerUp(p: Pointer): void {
        if (wasPointerConsumedByRebuild(scene, p)) return;
        close();
      }
      scene.input.on('pointerdown', onPointerDown);
      scene.input.on('pointerup', onPointerUp);
    `;
    expect(pointerOffenders(source)).toEqual([]);
  });

  it('fails an unguarded named callback even when another callback and a comment mention the guard', () => {
    const source = `
      const guarded = (p: Pointer) => { if (wasPointerConsumedByRebuild(scene, p)) return; };
      const unsafe = (p: Pointer) => { open(); }; // wasPointerConsumedByRebuild(scene, p)
      scene.input.on('pointerdown', unsafe);
    `;
    expect(pointerOffenders(source)).toHaveLength(1);
    expect(pointerOffenders(source)[0]).toContain('[pointerdown]');
  });

  it('keeps inline callbacks covered: guarded passes and unguarded fails', () => {
    const source = `
      scene.input.on('pointerdown', (p: Pointer) => { if (wasPointerConsumedByRebuild(scene, p)) return; open(); });
      scene.input.on('pointerup', (p: Pointer) => { close(); });
    `;
    expect(pointerOffenders(source)).toHaveLength(1);
    expect(pointerOffenders(source)[0]).toContain('[pointerup]');
  });

  it('does not let an unguarded inline listener borrow a later named callback guard', () => {
    const source = `
      scene.input.on('pointerdown', (p: Pointer) => { open(); });
      const guarded = (p: Pointer) => { if (wasPointerConsumedByRebuild(scene, p)) return; close(); };
      scene.input.on('pointerup', guarded);
    `;
    expect(pointerOffenders(source)).toHaveLength(1);
    expect(pointerOffenders(source)[0]).toContain('[pointerdown]');
  });

  it('fails closed for a missing named callback and ignores comments that look like registrations', () => {
    const source = `
      // scene.input.on('pointerdown', imaginary);
      /* scene.input.on('pointerup', imaginary); */
      scene.input.on('pointerdown', missingHandler);
    `;
    expect(pointerOffenders(source)).toHaveLength(1);
    expect(pointerOffenders(source)[0]).toContain('missingHandler');
  });

  it('inspects the old cardInfoBox failure shape at the named callback body, not after the registration', () => {
    const source = `
      const onPointerDown = (p: Pointer): void => {
        if (wasPointerConsumedByRebuild(scene, p)) return;
        rebuild();
      };
      const onPointerUp = (p: Pointer): void => {
        if (wasPointerConsumedByRebuild(scene, p)) return;
        finish();
      };

      scene.input.on('pointerdown', onPointerDown);
      scene.input.on('pointerup', onPointerUp);
    `;
    expect(pointerOffenders(source)).toEqual([]);
  });
});

/**
 * The shared confirm dialog (`src/game/ui/RunProgressStrip.ts` —
 * `renderConfirmDialog`, behind BOTH `renderRetireConfirm` and
 * `renderUnspentPlConfirm` since 2026-09-02) is the SHARED component behind
 * CONFIRMED INSTANCE #20 (audit 2026-08): its scrim and both buttons must hand
 * the triggering pointer to the caller's callbacks, not swallow it — see the
 * function's doc comment. The pointer contract now lives on ONE handler type
 * every callback field takes, so this pins that type and that every field —
 * and every wrapper's public option — routes through it.
 * (`tests/game/unspentPlConfirm.test.ts` proves the same thing behaviorally:
 * each drawn control invokes its handler WITH the pointer object.)
 */
describe('src/game/ui/RunProgressStrip: the shared confirm dialog threads the triggering pointer', () => {
  const src = readFileSync(join(GAME_DIR, 'ui', 'RunProgressStrip.ts'), 'utf8');

  it('declares ONE pointer-taking handler type, and every dialog callback field uses it', () => {
    expect(src).toMatch(/type ConfirmHandler\s*=\s*\(pointer:\s*Phaser\.Input\.Pointer\)\s*=>\s*void/);
    expect(src).toMatch(/onConfirm:\s*ConfirmHandler/);
    expect(src).toMatch(/onCancel:\s*ConfirmHandler/);
    expect(src).toMatch(/onScrim\?:\s*ConfirmHandler/);
    // No dialog callback may re-declare itself as a bare `() => void` — that is
    // exactly how a swallow re-enters. (Non-dialog HUD callbacks — action
    // slots, badge/stat-panel openers — are legitimately bare; this scopes to
    // the dialog's own field names plus the unspent-PL wrapper's three.)
    for (const field of ['onConfirm', 'onCancel', 'onScrim', 'onFightAnyway', 'onSpendFirst', 'onDismiss']) {
      expect(src).not.toMatch(new RegExp(`${field}\\??:\\s*\\(\\s*\\)\\s*=>`));
      expect(src.includes(`${field}: ConfirmHandler`) || field === 'onScrim').toBe(true);
    }
  });

  it('every internal pointerdown handler (scrim, cancel slot, confirm slot) forwards the pointer, never calls with zero args', () => {
    // Every dispatch site must pass an argument through — `opts.onCancel()` /
    // `opts.onConfirm()` / `onScrim()` with NO argument is the exact
    // regression this guards.
    const bareCalls = [...src.matchAll(/(?:opts\.on(?:Cancel|Confirm)|onScrim)\(\s*\)/g)];
    expect(bareCalls.map((m) => m[0])).toEqual([]);
    expect(src.match(/onScrim\(pointer\)/g)?.length ?? 0).toBeGreaterThanOrEqual(1); // the scrim
    expect(src.match(/opts\.onCancel\(pointer\)/g)?.length ?? 0).toBeGreaterThanOrEqual(1); // cancel-slot button
    expect(src.match(/opts\.onConfirm\(pointer\)/g)?.length ?? 0).toBeGreaterThanOrEqual(1); // confirm-slot button
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
