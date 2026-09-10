import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string =>
  readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

const eventTypeNames = [
  'EventTheme',
  'EventGate',
  'EventTallyGate',
  'EventRarity',
  'EventArtId',
  'EventRequirement',
  'FilterFromSource',
  'EventOutcomeSpec',
  'EventChoiceDef',
  'EventDef',
] as const;

const parse = (source: string, fileName: string): ts.SourceFile =>
  ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);

const isExported = (statement: ts.DeclarationStatement): boolean =>
  ts.canHaveModifiers(statement)
  && (ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);

describe('event type import boundary', () => {
  it('keeps the event declarations in a type-only module', () => {
    const source = readSource('data/eventTypes.ts');

    const file = parse(source, 'eventTypes.ts');

    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement)) {
        expect(statement.importClause?.isTypeOnly).toBe(true);
      } else {
        expect(ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)).toBe(true);
      }
    }

    const declarations = file.statements.filter(
      (statement): statement is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
        (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && isExported(statement),
    );
    expect(declarations.map((declaration) => declaration.name.text).sort()).toEqual([...eventTypeNames].sort());
    expect(source).not.toMatch(/eventCatalog|\.json|validateEvent|from ['"].*\/events['"]|import\s+(?!type\b)/);
    for (const rationale of [
      'EVENT CHAINS',
      'falls back to the spec\'s static',
      "tier is narrowed to `'bronze'`",
      'DIAMOND HAS NOWHERE TO GO',
      'The bound is the MIN across platforms',
    ]) {
      expect(source).toContain(rationale);
    }
    expect(source).toMatch(/`pending`\s*\*?\s*resolution counts/);
  });

  it('keeps the events facade compatible for every event type', () => {
    const file = parse(readSource('data/events.ts'), 'events.ts');
    const facade = file.statements.find(
      (statement): statement is ts.ExportDeclaration =>
        ts.isExportDeclaration(statement)
        && statement.moduleSpecifier !== undefined
        && ts.isStringLiteral(statement.moduleSpecifier)
        && statement.moduleSpecifier.text === './eventTypes',
    );

    expect(facade?.isTypeOnly).toBe(true);
    expect(facade?.exportClause && ts.isNamedExports(facade.exportClause)).toBe(true);
    if (!facade?.exportClause || !ts.isNamedExports(facade.exportClause)) return;
    expect(facade.exportClause.elements.map((element) => element.name.text).sort()).toEqual([...eventTypeNames].sort());
  });

  it('makes biome-facing consumers depend on event types rather than the catalog', () => {
    const consumers = [
      readSource('data/biomes.ts'),
      readSource('run/runMap.ts'),
      readSource('run/runState.ts'),
      readSource('run/biomeForecast.ts'),
    ];

    for (const consumer of consumers) {
      expect(consumer).toMatch(/import type \{ EventTheme \} from .*eventTypes/);
    }

    const runMap = consumers[1]!;
    expect(runMap).toContain('EventTheme` in data/eventTypes.ts');
    expect(runMap).not.toContain('EventTheme` in data/events.ts');
  });
});
