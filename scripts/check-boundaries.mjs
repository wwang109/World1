// Layering rule: src/engine, src/data, src/run, src/meta must never import
// Phaser or anything from src/game. This keeps the simulation headless and
// deterministic (testable via vitest, runnable in the balance harness).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PURE_DIRS = ['src/engine', 'src/data', 'src/run', 'src/meta'];
const FORBIDDEN = [/from\s+['"]phaser['"]/, /import\s+['"]phaser['"]/, /from\s+['"][^'"]*\/game\//, /from\s+['"][^'"]*src\/game/];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|js|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

// Thin-client rule: src/game must never be able to RUN combat. Battles come
// from the battle service (server/battleApi.ts) as an event log, so importing
// simulate()/resolveBattle() would put the rules back in the shipped bundle.
// Type-only imports are fine — they are erased at build time.
const GAME_BANNED = [
  { needle: 'resolveBattle', why: 'resolveBattle() — battles must come from the battle service' },
  { needle: 'combat/simulate', why: 'simulate() — battles must come from the battle service' },
];

/** Every import statement in `text`, minus the type-only ones. */
function valueImports(text) {
  return (text.match(/import\s+[^;]*?from\s*['"][^'"]+['"]/gs) ?? [])
    .filter((statement) => !/^import\s+type\b/.test(statement.trim()));
}

const violations = [];
for (const dir of PURE_DIRS) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN) {
      if (pattern.test(text)) violations.push(`${file}: matches ${pattern}`);
    }
  }
}
/** Resolve a relative import specifier to a real file path, or null. */
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = join(fromFile, '..', spec);
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* keep trying */ }
  }
  return null;
}

/** The value-import specifiers of a file. */
function importSpecs(text) {
  return valueImports(text)
    .map((statement) => statement.match(/from\s*['"]([^'"]+)['"]/)?.[1])
    .filter(Boolean);
}

/**
 * Walk the value-import graph from every src/game file. A TRANSITIVE reach into
 * simulate() is just as bad as a direct one — it still ships the rules in the
 * client bundle, which is exactly how `run/analysis` leaked the engine before.
 */
function pathToCombat(entry) {
  const seen = new Set();
  const stack = [[entry, [entry]]];
  while (stack.length > 0) {
    const [file, trail] = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const spec of importSpecs(text)) {
      for (const { needle } of GAME_BANNED) {
        if (spec.includes(needle)) return [...trail, spec];
      }
      const next = resolveImport(file, spec);
      if (next) stack.push([next, [...trail, next]]);
    }
  }
  return null;
}

for (const file of walk('src/game')) {
  const trail = pathToCombat(file);
  if (trail) {
    violations.push(`${file}: reaches combat via ${trail.slice(1).join(' → ')} (battles must come from the battle service)`);
  }
}

if (violations.length > 0) {
  console.error('Layer boundary violations (pure layers must not import phaser/src/game; src/game must not run combat):');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('boundaries OK');
