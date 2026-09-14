import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sceneSource = (name: string): string =>
  readFileSync(join(process.cwd(), 'src', 'game', 'scenes', name), 'utf8');

describe.each([
  ['desktop', 'DesktopRunMapScene.ts'],
  ['mobile', 'MobileRunMapScene.ts'],
] as const)('%s run-map stat drawer composition', (_profile, file) => {
  it('renders the current route before opening the stat drawer', () => {
    const source = sceneSource(file);
    const trailWhenStatPanelOpen = source.indexOf('else if (this.statPanelOpen) this.renderTrail(run);');
    const drawer = source.indexOf('if (this.statPanelOpen) {\n      renderRunStatPanel(this, {');

    expect(trailWhenStatPanelOpen).toBeGreaterThan(-1);
    expect(drawer).toBeGreaterThan(trailWhenStatPanelOpen);
  });
});

it('keeps the stat drawer scrim above and interactive over the retained route', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'game', 'ui', 'RunStatPanel.ts'), 'utf8');

  expect(source).toMatch(/const scrim = .*\.setInteractive\(\)\.setDepth\(5000\);/);
  expect(source).toContain("scrim.on('pointerdown', cancelAndClose);");
});
