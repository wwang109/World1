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
// This is an AST-based checker (TypeScript's own compiler API — already a
// project devDependency, no new dependency added), not a regex-based one. A
// regex extractor is blind to anything it isn't spelled out for: an earlier
// regex version of this file closed 8 evasion routes one at a time and was
// STILL structurally blind to `import(someComputedVar)` / `require(x + y)` —
// a dynamic import/require whose specifier isn't a plain string literal has
// no fixed shape to match against. Parsing the real AST means every import,
// export-from, dynamic import(), and require() in a file is found by asking
// "is this an ImportDeclaration / ExportDeclaration / CallExpression to
// import()-or-require()", not by hoping a pattern was anticipated.
//
// Philosophy: FAIL CLOSED. A dynamic import()/require() in either guarded
// layer (src/engine, src/data, src/run, src/meta, src/game) whose specifier
// isn't a literal string is flagged as a violation BY DEFAULT — the checker
// cannot verify where it points, so it does not get the benefit of the
// doubt. The escape hatch is a `// boundary-allow: <reason>` comment on the
// same line or the line directly above the call, which requires a written
// reason to exist in the file (grep-able, reviewable), not a silent pass.
//
// Both rules (and the fail-closed dynamic-import pass) share ONE AST walk
// per file (`parse`), cached, so every import shape a bundler follows is
// covered consistently: `import from`, bare side-effect `import 'x'`,
// `export … from` / `export * from` re-export chains, dynamic `import('x')`
// and `require('x')` — plus, now, the non-literal forms of the last two.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import ts from 'typescript';

const PURE_DIRS = ['src/engine', 'src/data', 'src/run', 'src/meta'];
const GAME_DIR = 'src/game';
const GUARDED_DIRS = [...PURE_DIRS, GAME_DIR];
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

/** Which TS/JS dialect to parse a file as — affects only syntax acceptance
 * (JSX angle-bracket ambiguity, etc.), never type-checking (none is done). */
function pickScriptKind(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.ts') || file.endsWith('.mts') || file.endsWith('.cts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS; // .js, .mjs, .cjs
}

/**
 * A single module reference found anywhere in a file:
 *   - `import ... from 'x'` / bare `import 'x'`        (kind: 'import')
 *   - `export ... from 'x'` / `export * from 'x'`      (kind: 'export')
 *   - `import('x')`                                    (kind: 'dynamic import()', dynamic: true)
 *   - `require('x')`                                   (kind: 'require()', dynamic: true)
 *
 * `spec` is the literal string module specifier, or `null` if the argument /
 * moduleSpecifier isn't a plain string literal (a variable, a template with
 * substitutions, a computed expression — anything the checker cannot
 * statically resolve). `typeOnly` is true only for a WHOLE `import type … from`
 * / `export type … from` declaration (matches this checker's historical
 * granularity — inline `{ type X }` specifiers aren't split out).
 */
function parse(file, cache) {
  if (cache.has(file)) return cache.get(file);
  const text = read(file);
  if (text === null) {
    const empty = { text: null, sourceFile: null, refs: [] };
    cache.set(file, empty);
    return empty;
  }
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, pickScriptKind(file));
  const refs = [];
  const litOrNull = (node) => (node && ts.isStringLiteralLike(node) ? node.text : null);
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      refs.push({
        spec: litOrNull(node.moduleSpecifier),
        typeOnly: node.importClause?.isTypeOnly === true,
        dynamic: false,
        kind: 'import',
        node,
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      refs.push({
        spec: litOrNull(node.moduleSpecifier),
        typeOnly: node.isTypeOnly === true,
        dynamic: false,
        kind: 'export … from',
        node,
      });
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        refs.push({
          spec: litOrNull(node.arguments[0]),
          typeOnly: false,
          dynamic: true,
          kind: isDynamicImport ? 'dynamic import()' : 'require()',
          node,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  const result = { text, sourceFile, refs };
  cache.set(file, result);
  return result;
}

/** The escape hatch: a `// boundary-allow: <reason>` comment on the same
 * line as the call, or the line directly above it. A comment with no text
 * after the colon does not count — the reason has to actually be written. */
const ALLOW_COMMENT = /boundary-allow:\s*(\S.*)/;
function allowReason(sourceFile, text, node) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const lines = text.split('\n');
  for (const idx of [line, line - 1]) {
    const l = idx >= 0 ? lines[idx] : undefined;
    if (!l) continue;
    const m = ALLOW_COMMENT.exec(l);
    if (m) return m[1].trim();
  }
  return null;
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
const cache = new Map();

// ---- Fail-closed pass: dynamic import()/require() with a non-literal
// specifier, in EITHER guarded layer, is a violation by default. This is the
// hole regex extraction structurally cannot see (`await import(someVar)`,
// `require(computed)`) — a specifier the checker cannot read has no text to
// pattern-match, so "cannot resolve" must mean "reject", not "skip".
for (const dir of GUARDED_DIRS) {
  for (const file of walk(dir)) {
    const { text, sourceFile, refs } = parse(file, cache);
    if (text === null) continue;
    for (const ref of refs) {
      if (!ref.dynamic || ref.spec !== null) continue;
      if (allowReason(sourceFile, text, ref.node)) continue;
      violations.push(
        `${file}: ${ref.kind} with a non-literal specifier — cannot statically verify where it points ` +
        `(fail-closed); use a literal specifier or add a "// boundary-allow: <reason>" comment on the ` +
        `line above the call`
      );
    }
  }
}

// ---- Rule 1: pure layers must not import phaser or src/game. Type-only
// imports COUNT here on purpose (stricter than rule 2): src/engine may not
// so much as name a Phaser type.
for (const dir of PURE_DIRS) {
  for (const file of walk(dir)) {
    const { text, refs } = parse(file, cache);
    if (text === null) continue;
    for (const ref of refs) {
      if (ref.spec === null) continue; // non-literal dynamic — handled above
      if (isPhaser(ref.spec)) violations.push(`${file}: imports phaser ('${ref.spec}') — pure layers must stay headless`);
      else if (pointsAtGame(file, ref.spec)) violations.push(`${file}: imports src/game ('${ref.spec}') — pure layers must not depend on the Phaser layer`);
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
 * Only VALUE-carrying refs continue the walk: type-only imports are erased at
 * build and never ship; a non-literal dynamic ref can't be resolved further
 * (it was already flagged by the fail-closed pass above) so the walk simply
 * cannot follow it — it is not silently treated as safe.
 */
function pathToCombat(entry) {
  const seen = new Set();
  const stack = [[entry, [entry]]];
  while (stack.length > 0) {
    const [file, trail] = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const { text, refs } = parse(file, cache);
    if (text === null) continue;
    for (const ref of refs) {
      if (ref.typeOnly) continue;
      if (ref.spec === null) continue; // unresolvable — already flagged above
      const next = resolveImport(file, ref.spec);
      const hit = bannedHit(ref.spec, next);
      if (hit) return { trail: [...trail, next ?? ref.spec], why: hit.why };
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
