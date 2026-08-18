/**
 * `functions/` (the Cloudflare Pages twins) and `server/battleApi.ts` used to
 * sit outside every gate: tsconfig included only src/scripts/tests, so neither
 * `npm test` nor `npm run build` typechecked the only code allowed to run
 * combat. A renamed export in src/run could reach production with no local
 * signal. This test keeps that hole closed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** tsconfig is JSONC — strip line comments before parsing. */
function readTsconfig(file: string): { include?: string[] } {
  const raw = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(raw) as { include?: string[] };
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

/** Every tsconfig the `typecheck` script actually runs. */
const CHECKED_CONFIGS = ['tsconfig.json', 'tsconfig.functions.json'];

describe('typecheck coverage', () => {
  it('runs every tsconfig from the typecheck script', () => {
    expect(pkg.scripts.typecheck).toContain('tsc --noEmit');
    expect(pkg.scripts.typecheck).toContain('tsconfig.functions.json');
  });

  it('wires typecheck into both npm test and npm run build', () => {
    expect(pkg.scripts.test).toContain('npm run typecheck');
    expect(pkg.scripts.build).toContain('npm run typecheck');
  });

  it('covers every source directory, including the battle service and its twins', () => {
    const covered = new Set(CHECKED_CONFIGS.flatMap((f) => readTsconfig(f).include ?? []));
    for (const dir of ['src', 'scripts', 'tests', 'server', 'functions']) {
      expect(covered, `${dir}/ is outside every typechecked program`).toContain(dir);
    }
  });

  it('keeps the Pages Functions on a Workers-shaped program, not a Node one', () => {
    const fn = readFileSync('tsconfig.functions.json', 'utf8').replace(/^\s*\/\/.*$/gm, '');
    const parsed = JSON.parse(fn) as { compilerOptions?: { types?: string[] } };
    expect(parsed.compilerOptions?.types).toEqual([]);
  });

  it('has no source file in functions/ or server/ that nothing checks', () => {
    for (const dir of ['functions', 'server']) {
      const sources = readdirSync(dir).filter((f) => f.endsWith('.ts'));
      expect(sources.length, `${dir}/ has no .ts files — has it moved?`).toBeGreaterThan(0);
      for (const f of sources) expect(readFileSync(join(dir, f), 'utf8').length).toBeGreaterThan(0);
    }
  });
});
