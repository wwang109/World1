import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const path = 'src/game/runStore.ts';
const text = readFileSync(path, 'utf8');
const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
const functions = source.statements.filter(ts.isFunctionDeclaration).filter(fn => fn.name && fn.body);
const edges = new Map<string, Set<string>>(); const writes = new Set<string>();
const writeRoots = new Set(['setActiveRun', 'noteRunStarted', 'noteRunEnded', 'uploadGhost', 'reportGhostResult', 'fetchGhost']);
for (const fn of functions) {
  const calls = new Set<string>(); const name = fn.name!.text;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) calls.add(node.expression.text);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left) && node.left.text === 'activeRun') writes.add(name);
    ts.forEachChild(node, visit);
  };
  visit(fn.body!); edges.set(name, calls); if ([...calls].some(call => writeRoots.has(call))) writes.add(name);
}
let changed = true;
while (changed) { changed = false; for (const [name, calls] of edges) if (!writes.has(name) && [...calls].some(call => writes.has(call))) { writes.add(name); changed = true; } }
const exports = functions.filter(fn => fn.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
const mutators = exports.filter(fn => writes.has(fn.name!.text));
if (process.argv.includes('--write')) {
  let next = text;
  for (const fn of [...mutators].reverse()) {
    if (fn.body!.statements[0]?.getText(source) === 'assertPracticeRun();') continue;
    const offset = fn.body!.getStart(source) + 1; next = `${next.slice(0, offset)}\n  assertPracticeRun();${next.slice(offset)}`;
  }
  writeFileSync(path, next);
} else {
  for (const fn of mutators) assert.equal(fn.body!.statements[0]?.getText(source), 'assertPracticeRun();', `${fn.name!.text} must refuse local writes while online`);
  assert(text.includes('function setActiveRun(next: RunState | null): void {\n  assertPracticeRun();') || text.includes('function setActiveRun(next: RunState | null): void {\r\n  assertPracticeRun();'));
  const api = readFileSync('src/game/battleApi.ts', 'utf8'); assert.match(api, /fetchBattleLog\([^]*?assertPracticeRun\(\)/);
  const screen = readFileSync('src/game/ui/EligibleRunScreen.ts', 'utf8'); assert(!screen.includes("from '../runStore'")); assert(!screen.includes('resolveRunBattleResult'));
  writeFileSync('tmp/community/practice-mutation-inventory.json', JSON.stringify({ exports: exports.length, mutators: mutators.map(fn => fn.name!.text), readers: exports.filter(fn => !writes.has(fn.name!.text)).map(fn => fn.name!.text), online: 'closed server intents through EligibleRunSession' }, null, 2));
  console.log(`practice boundary OK: ${exports.length} exports classified; ${mutators.length} mutators reject online mode; local battle setup refused; eligible scene uses server session only`);
}
