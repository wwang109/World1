import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { runTravelChoiceCardCopy } from '../../src/game/ui/RunTravelChoiceCard';
import type { RunTravelChoiceViewModel } from '../../src/game/ui/runTravelChoiceViewModel';

// Read just the audit's declarative patterns: importing its entrypoint would
// launch Chromium and retire a run. Exercise those real patterns on literal
// rendered rows without starting the destructive browser walkthrough.
const source = readFileSync(new URL('../../scripts/run-hud-audit.ts', import.meta.url), 'utf8');
// The arrival action is rendered directly rather than exposed by the travel
// copy model. Read its actual text argument so a local fixture cannot hide a
// stale audit selector (including the action's chevron).
const bossSource = readFileSync(new URL('../../src/game/ui/RunBossArrivalPanel.ts', import.meta.url), 'utf8');
const bossAction = bossSource.match(/const label = scene\.add\.text\(layout\.action\.x[^\n]*\n\s*'([^']+)'/)?.[1];
if (!bossAction) throw new Error('Cannot locate the rendered boss-arrival action');
const declaration = source.match(/const REQUIRED_STATS = desktop\s*\? \[[\s\S]*?\]\s*:\s*\[[\s\S]*?\];/)?.[0];
if (!declaration) throw new Error('Cannot locate the HUD audit required-stat declaration');

describe.each([
  { platform: 'desktop', desktop: true, other: 'GOLD 137 · LV 12 · LIVES 2 · BOSSES 4', legacy: 'DAY 137 · WAVE 22' },
  { platform: 'mobile', desktop: false, other: 'G 137 · LV 12 · ♥ 2 · B 4', legacy: 'D 137 · W 22' },
])('$platform HUD audit vocabulary', ({ desktop, other, legacy }) => {
  const patterns = (runInNewContext(`${declaration}\nREQUIRED_STATS`, { desktop }) as string[])
    .map((pattern) => new RegExp(pattern));
  const missing = (row: string) => patterns.filter((pattern) => !pattern.test(row)).length;

  it('accepts STOP and a bounded region DAY instead of requiring the old wave pair', () => {
    for (const day of [1, 2, 3, 4, 5]) {
      expect(missing(`STOP 137 · DAY ${day}/5 · ${other}`)).toBe(0);
    }
  });

  it('rejects the obsolete absolute-day and wave labels on both profiles', () => {
    expect(missing(`${legacy} · ${other}`)).toBe(2);
  });

  it('still requires the stop independently of region day', () => {
    expect(missing(`DAY 2/5 · ${other}`)).toBe(1);
  });

  it('rejects unbounded or malformed region days', () => {
    for (const day of ['2', '0/5', '6/5', '12/5', '2/50']) {
      expect(missing(`STOP 137 · DAY ${day} · ${other}`)).toBe(1);
    }
  });

  it('retains every other required stat', () => {
    for (const stat of other.split(' · ')) {
      expect(missing(`STOP 137 · DAY 2/5 · ${other.replace(stat, '')}`)).toBe(1);
    }
  });
});

// Evaluate the real audit consumer without its browser-starting main. Only the
// external browser boundary is supplied below; click/retry/selection code runs.
const auditAst = ts.createSourceFile('audit.ts', source, ts.ScriptTarget.Latest, true);
function auditFunction(name: string): string {
  const node = auditAst.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  if (!node) throw new Error(`Missing audit function ${name}`);
  return node.getText(auditAst);
}
function evaluateAudit(code: string, context: Record<string, unknown>): Promise<unknown> {
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(js, context) as Promise<unknown>;
}

describe.each(['desktop', 'mobile'])('%s audit travel integration', (platform) => {
  const desktop = platform === 'desktop';
  const mapScene = desktop ? 'DesktopRunMap' : 'MobileRunMap';

  it.each([
    ['event', false, 'CHOOSE EVENT ›'],
    ['event', true, 'TRAVEL HERE ›'],
    ['shop', false, 'VISIT SHOP ›'],
    ['fight', false, 'INSPECT ENCOUNTER ›'],
    ['boss', false, 'CONTINUE ›'],
  ] as const)('leaves the map through the real %s action (chain %s)', async (kind, chain, action) => {
    const model: RunTravelChoiceViewModel = {
      nodeId: 'node', kind, title: kind.toUpperCase(), detail: 'Wolf · LV 1',
      accent: 1, enabled: true,
      event: kind === 'event' ? { eventId: 'event', chainUnlocked: chain, requirementLines: [] } : undefined,
    };
    const copy = runTravelChoiceCardCopy(model);
    expect(copy.action).toBe(action);
    expect(bossAction).toBe('FACE THE BOSS ›');
    let scene = mapScene;
    let arrival = false;
    const clicks: string[] = [];
    const hardFailures: string[] = [];
    const nodeBlock = source.slice(source.indexOf('  // ---- 4. Pick'), source.indexOf('  const landedOn ='));
    expect(nodeBlock.length).toBeGreaterThan(0);
    await evaluateAudit(`
      ${auditFunction('clickMatchingText')}
      ${auditFunction('clickUntil')}
      (async () => { ${nodeBlock} })()
    `, {
      page: {}, platform, MAP_SCENE_KEY: mapScene, hardFailures,
      collectTexts: async () => (arrival ? [bossAction] : ['BOSSES ', 'FIGHT', 'SHOP', 'EVENT', 'BOSS', copy.eyebrow, copy.title, copy.action])
        .map((text) => ({ text })),
      // Only the action rect is interactive. Clicking an eyebrow leaves the
      // scene unchanged, so the real retry/postcondition reports a hard failure.
      clickExactText: async (_page: unknown, label: string) => {
        clicks.push(label);
        if (label === copy.action) {
          if (kind === 'boss') arrival = true;
          else scene = desktop ? 'DesktopNode' : 'MobileNode';
        }
        if (arrival && label === bossAction) scene = desktop ? 'DesktopRunPrep' : 'MobileRunPrep';
        return true;
      },
      activeSceneKey: async () => scene,
      waitUntil: async (_page: unknown, settled: () => Promise<boolean>) => settled(),
    });
    expect(hardFailures).toEqual([]);
    expect(scene).not.toBe(mapScene);
    expect(clicks).toEqual(kind === 'boss' ? [action, bossAction] : [action]);
  });

  it('calibrates against the map DECK/BAG anchor while preserving node-screen labels', async () => {
    const hardFailures: string[] = [];
    const anchors: unknown[] = [];
    const anchor = { text: 'DECK/BAG', x: 30, y: 70, width: 80, height: 20 };
    await evaluateAudit(`${auditFunction('calibrateCollector')}\ncalibrateCollector(page, platform)`, {
      platform, hardFailures,
      collectTexts: async () => [anchor],
      page: { evaluate: async (_callback: unknown, rect: unknown) => { anchors.push(rect); return null; } },
    });
    // Stop at the external probe-injection boundary: reaching it proves the
    // current map anchor was found; its existing null-scene failure must remain.
    expect(anchors).toEqual([{ x: 30, y: 70, width: 80, height: 20 }]);
    expect(hardFailures).toHaveLength(1);
    expect(hardFailures[0]).toContain('no active scene to inject probes into');
    const nodeLabel = source.match(/const deckLabel = [^;]+;/)?.[0];
    expect(nodeLabel).toBeDefined();
    expect(runInNewContext(`${nodeLabel}\ndeckLabel`, { desktop })).toBe(desktop ? 'DECK / BAG' : 'DECK/BAG');
  });
});
