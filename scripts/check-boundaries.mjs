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

const violations = [];
for (const dir of PURE_DIRS) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN) {
      if (pattern.test(text)) violations.push(`${file}: matches ${pattern}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Layer boundary violations (pure layers must not import phaser/src/game):');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('boundaries OK');
