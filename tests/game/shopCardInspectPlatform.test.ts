import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const desktopSource = readFileSync(new URL('../../src/game/scenes/DesktopShopScene.ts', import.meta.url), 'utf8');
const mobileSource = readFileSync(new URL('../../src/game/scenes/MobileShopScene.ts', import.meta.url), 'utf8');

function methodSlice(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`could not isolate ${start}`);
  return source.slice(from, to);
}

describe('Shop CardToken inspect affordance platform boundary', () => {
  it('keeps dedicated shelf-card onInspect callbacks on Mobile Shop only', () => {
    const desktopShelf = methodSlice(desktopSource, '  private renderShelf(', '  private renderMergeBadge(');
    const mobileShelf = methodSlice(mobileSource, '  private renderShelf(', '  private renderRunBrowse(');
    const mobileRunBrowse = methodSlice(mobileSource, '  private renderRunBrowse(', '  private renderMergeBadge(');

    expect(desktopShelf.match(/onInspect:/g) ?? []).toHaveLength(0);
    expect(mobileShelf.match(/onInspect:/g) ?? []).toHaveLength(1);
    expect(mobileRunBrowse.match(/onInspect:/g) ?? []).toHaveLength(1);
  });

  it('retains Desktop Shop shelf Card Details through its existing completed-click activation', () => {
    const desktopGesture = methodSlice(desktopSource, '  private wireDrag(', '  private renderConfirm(');

    expect(desktopGesture).toContain("this.detailActivation.release(`shelf:${src.index}`, p.upTime)");
    expect(desktopGesture).toContain('this.detailCardIndex = src.index');
  });

  it('keeps owned BOARD/BAG onInspectSlot callbacks on Mobile Shop only', () => {
    const desktopOwned = methodSlice(desktopSource, '  private renderOwnedColumns(', '  private renderOwnedGemInventory(');
    const mobileOwned = methodSlice(mobileSource, '  private renderOwnedColumns(', '  private renderPouchRow(');

    expect(desktopOwned.match(/onInspectSlot:/g) ?? []).toHaveLength(0);
    expect(mobileOwned.match(/onInspectSlot:/g) ?? []).toHaveLength(2);
  });

  it('retains Desktop Shop owned-card details through its completed-click activation', () => {
    const desktopGesture = methodSlice(desktopSource, '  private wireDrag(', '  private renderConfirm(');

    expect(desktopGesture).toContain('this.detailActivation.release(`${src.kind}:${src.index}`, p.upTime)');
    expect(desktopGesture).toContain('this.inspectOwned = { location: src.kind, index: src.index }');
  });
});
