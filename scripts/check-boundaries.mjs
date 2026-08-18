// Layer boundary checker — the gate every layering rule in this project trusts.
//
// Rule 1 (pure layers): src/engine, src/data, src/run, src/meta must never
//   import Phaser or anything from src/game. This keeps the simulation
//   headless and deterministic (testable via vitest, runnable in the harness).
// Rule 2 (thin client): src/game must never be able to RUN combat. Battles
//   come from the battle service (server/battleApi.ts) as an event log, so a
//   value-import of simulate()/resolveBattle() — direct OR transitive — would
//   put the rules back in the shipped bundle. Type-only imports are fine;
//   they are erased at build time.
//
// Both rules read from ONE module-specifier extractor (`moduleSpecifiers`), so
// every import shape a bundler follows is covered by both: `import from`,
// bare side-effect `import 'x'`, `export … from` / `export * from` re-export
// chains, dynamic `import('x')` and `require('x')`. A shape the extractor
// misses is a hole in every rule at once, which is why they share it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

const PURE_DIRS = ['src/engine', 'src/data', 'src/run', 'src/meta'];
const GAME_DIR = 'src/game';
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** Extensions/index files an import specifier may resolve to, in order. */
const RESOLVE_SUFFIXES = [
  '', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '/index.ts', '/index.tsx', '/index.mts', '/index.js', '/index.jsx', '/index.mjs',
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      // A symlink's Dirent says nothing about its target, and a BROKEN symlink
      // must not crash the gate — resolve it defensively.
      try {
        isDir = statSync(path).isDirectory();
      } catch {
        continue;
      }
    }
    if (isDir) walk(path, out);
    else if (SOURCE_EXT.test(entry.name)) out.push(path);
  }
  return out;
}

const read = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

// An import/export clause never contains a `;` or a quote, so [^;'"] keeps a
// match from spanning statements — which is what makes the type-only guard
// trustworthy.
const FROM_CLAUSE = /\b(?:import|export)\b\s*(type\b)?([^;'"]*?)\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT = /\bimport\s*['"]([^'"]+)['"]/g;
const DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;
const REQUIRE = /\brequire\s*\(\s*['"]([^'"]+)['"]/g;

/**
 * Every module specifier `text` pulls in, in any shape.
 *
 * `includeTypeOnly` splits the two rules. The thin-client rule cares about what
 * SHIPS, so `import type … from` / `export type … from` are excluded — erased
 * at build. The pure-layer rule is stricter on purpose (and was before this
 * checker was rewritten): src/engine may not so much as name a Phaser type.
 */
function moduleSpecifiers(text, { includeTypeOnly = false } = {}) {
  const specs = new Set();
  for (const [, typeKeyword, , spec] of text.matchAll(FROM_CLAUSE)) {
    if (!typeKeyword || includeTypeOnly) specs.add(spec);
  }
  for (const re of [SIDE_EFFECT, DYNAMIC, REQUIRE]) {
    for (const [, spec] of text.matchAll(re)) specs.add(spec);
  }
  return [...specs];
}

/** Phaser, including deep subpaths like `phaser/dist/phaser.esm.js`. */
const isPhaser = (spec) => spec === 'phaser' || spec.startsWith('phaser/');

/** Lexically resolve a relative specifier against `fromFile`, repo-relative. */
function normalizeSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  return posix.normalize(posix.join(posix.dirname(fromFile.split('\\').join('/')), spec));
}

/** Does `spec`, read from `fromFile`, point into src/game? */
function pointsAtGame(fromFile, spec) {
  const resolved = normalizeSpec(fromFile, spec);
  if (resolved !== null) return resolved === GAME_DIR || resolved.startsWith(`${GAME_DIR}/`);
  return /(^|\/)src\/game(\/|$)/.test(spec);
}

const violations = [];
for (const dir of PURE_DIRS) {
  for (const file of walk(dir)) {
    const text = read(file);
    if (text === null) continue;
    for (const spec of moduleSpecifiers(text, { includeTypeOnly: true })) {
      if (isPhaser(spec)) violations.push(`${file}: imports phaser ('${spec}') — pure layers must stay headless`);
      else if (pointsAtGame(file, spec)) violations.push(`${file}: imports src/game ('${spec}') — pure layers must not depend on the Phaser layer`);
    }
  }
}

const GAME_BANNED = [
  { needle: 'resolveBattle', why: 'resolveBattle() — battles must come from the battle service' },
  { needle: 'combat/simulate', why: 'simulate() — battles must come from the battle service' },
];

/** Resolve a relative import specifier to a real file path, or null. */
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = join(fromFile, '..', spec);
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* keep trying */ }
  }
  return null;
}

/** Combat reached by a specifier OR by the file it resolves to. */
function bannedHit(spec, resolved) {
  const hay = `${spec}\u0000${(resolved ?? '').split('\\').join('/')}`;
  return GAME_BANNED.find(({ needle }) => hay.includes(needle)) ?? null;
}

/**
 * Walk the value-import graph from a src/game file. A TRANSITIVE reach into
 * simulate() is just as bad as a direct one — it still ships the rules in the
 * client bundle, which is exactly how `run/analysis` leaked the engine before.
 * Matching on the RESOLVED path as well as the specifier is what keeps a
 * barrel (`export * from './simulate'`) from laundering the name away.
 */
function pathToCombat(entry) {
  const seen = new Set();
  const stack = [[entry, [entry]]];
  while (stack.length > 0) {
    const [file, trail] = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = read(file);
    if (text === null) continue;
    for (const spec of moduleSpecifiers(text)) {
      const next = resolveImport(file, spec);
      const hit = bannedHit(spec, next);
      if (hit) return { trail: [...trail, next ?? spec], why: hit.why };
      if (next) stack.push([next, [...trail, next]]);
    }
  }
  return null;
}

for (const file of walk(GAME_DIR)) {
  const hit = pathToCombat(file);
  if (hit) {
    violations.push(`${file}: reaches combat via ${hit.trail.slice(1).join(' → ')} (${hit.why})`);
  }
}

if (violations.length > 0) {
  console.error('Layer boundary violations (pure layers must not import phaser/src/game; src/game must not run combat):');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('boundaries OK');
