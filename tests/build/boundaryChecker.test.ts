/**
 * The boundary checker is the gate every layering rule in this project trusts,
 * so it needs a gate of its own. Each case builds a synthetic repo and runs the
 * REAL `scripts/check-boundaries.mjs` against it.
 *
 * Cases 1-6 and 11-12 were all silently PASSING before the checker was
 * rewritten: re-export chains, `export *` barrels, dynamic imports, bare
 * side-effect imports, deep Phaser subpaths, `.tsx` hops, `require()`, and a
 * broken symlink that crashed the walk outright.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const CHECKER = resolve('scripts/check-boundaries.mjs');

interface Verdict { code: number; out: string }

function check(files: Record<string, string>, extra?: (root: string) => void): Verdict {
  const root = mkdtempSync(join(tmpdir(), 'world1-boundary-'));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
    extra?.(root);
    try {
      return { code: 0, out: execFileSync('node', [CHECKER], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const SIMULATE = 'export const simulate = () => 1;\n';
const RESOLVE_BATTLE = 'export const resolveBattle = () => 1;\n';

describe('check-boundaries: shapes that must be REJECTED', () => {
  it('rejects a re-export chain out of src/game', () => {
    const v = check({
      'src/run/resolveBattle.ts': RESOLVE_BATTLE,
      'src/game/barrel.ts': "export { resolveBattle } from '../run/resolveBattle';\n",
    });
    expect(v.code).toBe(1);
    expect(v.out).toContain('src/game/barrel.ts');
  });

  it('rejects combat reached through an `export *` barrel that launders the name', () => {
    const v = check({
      'src/engine/combat/simulate.ts': SIMULATE,
      'src/engine/combat/index.ts': "export * from './simulate';\n",
      'src/game/scene.ts': "import { simulate } from '../engine/combat';\nsimulate();\n",
    });
    expect(v.code).toBe(1);
    expect(v.out).toContain('src/engine/combat/simulate.ts');
  });

  it('rejects a dynamic import of combat from src/game', () => {
    const v = check({
      'src/run/resolveBattle.ts': RESOLVE_BATTLE,
      'src/game/scene.ts': "export const go = async () => (await import('../run/resolveBattle')).resolveBattle();\n",
    });
    expect(v.code).toBe(1);
  });

  it('rejects a bare side-effect import of src/game from a pure layer', () => {
    const v = check({
      'src/game/foo.ts': 'export const foo = 1;\n',
      'src/run/c.ts': "import '../game/foo';\nexport const c = 1;\n",
    });
    expect(v.code).toBe(1);
    expect(v.out).toContain('src/run/c.ts');
  });

  it('rejects a deep Phaser subpath import in a pure layer', () => {
    const v = check({ 'src/engine/x.ts': "import Phaser from 'phaser/dist/phaser.esm.js';\nexport const x = Phaser;\n" });
    expect(v.code).toBe(1);
    expect(v.out).toContain('phaser/dist/phaser.esm.js');
  });

  it('follows a .tsx hop instead of ending the walk there', () => {
    const v = check({
      'src/run/resolveBattle.ts': RESOLVE_BATTLE,
      'src/game/b.tsx': "import { resolveBattle } from '../run/resolveBattle';\nexport const b = resolveBattle;\n",
      'src/game/scene.ts': "import { b } from './b';\nexport const s = b;\n",
    });
    expect(v.code).toBe(1);
    expect(v.out).toContain('src/game/scene.ts');
  });

  it('rejects a require() of combat from src/game', () => {
    const v = check({
      'src/run/resolveBattle.ts': RESOLVE_BATTLE,
      'src/game/legacy.js': "const { resolveBattle } = require('../run/resolveBattle');\nmodule.exports = resolveBattle;\n",
    });
    expect(v.code).toBe(1);
  });

  it('still rejects the plain shapes it always caught', () => {
    expect(check({ 'src/engine/x.ts': "import Phaser from 'phaser';\nexport const x = Phaser;\n" }).code).toBe(1);
    expect(check({
      'src/engine/combat/simulate.ts': SIMULATE,
      'src/game/scene.ts': "import { simulate } from '../engine/combat/simulate';\nsimulate();\n",
    }).code).toBe(1);
  });

  it('keeps pure layers off src/game even for type-only imports', () => {
    const v = check({
      'src/game/foo.ts': 'export type Foo = 1;\n',
      'src/run/c.ts': "import type { Foo } from '../game/foo';\nexport const c: Foo = 1;\n",
    });
    expect(v.code).toBe(1);
  });
});

describe('check-boundaries: shapes that must be ACCEPTED', () => {
  it('accepts a legal tree', () => {
    const v = check({
      'src/engine/combat/simulate.ts': SIMULATE,
      'src/run/resolveBattle.ts': "import { simulate } from '../engine/combat/simulate';\nexport const resolveBattle = () => simulate();\n",
      'src/game/scene.ts': "import type { resolveBattle } from '../run/resolveBattle';\nexport const s = 1;\n",
    });
    expect(v.code).toBe(0);
    expect(v.out).toContain('boundaries OK');
  });

  it('lets src/game keep type-only imports of combat (erased at build)', () => {
    const v = check({
      'src/engine/combat/simulate.ts': SIMULATE,
      'src/game/scene.ts': "import type { simulate } from '../engine/combat/simulate';\nexport const s = 1;\n",
    });
    expect(v.code).toBe(0);
  });

  it('survives a broken symlink under src/ instead of crashing', () => {
    const v = check(
      { 'src/engine/ok.ts': 'export const ok = 1;\n' },
      (root) => symlinkSync(join(root, 'does-not-exist.ts'), join(root, 'src/engine/dangling.ts')),
    );
    expect(v.code).toBe(0);
    expect(v.out).toContain('boundaries OK');
  });
});
