import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => ({ default: { Events: { EventEmitter: (await import('node:events')).EventEmitter }, Scene: class {}, GameObjects: { Container: class {} }, Math: { Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)) } } }));
vi.mock('../../src/game/audio/sfxSynth', () => ({ playSfx: vi.fn() }));
vi.mock('../../src/game/ui/cardDetailsDrawer', () => ({ renderCardDetailsDrawer: vi.fn() }));
import { renderCardDetailsDrawer } from '../../src/game/ui/cardDetailsDrawer';
import { demoState } from '../../src/game/demoState';
import { DesktopShopScene } from '../../src/game/scenes/DesktopShopScene';
import { MobileShopScene } from '../../src/game/scenes/MobileShopScene';
const last = () => vi.mocked(renderCardDetailsDrawer).mock.calls.at(-1)![2];

describe.each([['desktop', DesktopShopScene], ['mobile', MobileShopScene]] as const)('%s Shop merge affordances', (_name, Scene) => {
  beforeEach(() => { demoState.pieces = []; demoState.bagSlots = Array(10).fill(null); });
  function setup(gold = 3) {
    const scene: any = new Scene(); scene.rerender = vi.fn(); scene.isRunMode = () => false;
    scene.activeShopId = () => 'wildworks'; scene.activeGold = () => gold;
    scene.shelfFor = () => ({ cards: [{ skillId: 'sword_slash', tier: 'bronze', price: 9 }, { skillId: 'control_opportunist', tier: 'bronze', price: 3 }] });
    scene.detailCardIndex = 1; scene.detailTier = 'diamond';
    return scene;
  }
  it.each(['board', 'bag'] as const)('offers MERGE for a real owned %s copy using original offer identity', where => {
    const card = { instanceId: 'owned', skillId: 'control_opportunist', tier: 'silver' as const, slot: 0 };
    if (where === 'board') demoState.pieces = [card]; else demoState.bagSlots[0] = card;
    const scene = setup(); scene.renderCardDetail();
    expect(last().secondaryAction).toMatchObject({ label: 'MERGE', enabled: true });
    expect(scene.pendingBuy).toBeNull();
    scene.detailCardIndex = 0;
    last().secondaryAction!.onPress();
    expect(scene.pendingBuy).toEqual({ kind: 'card', index: 1 });
    expect(demoState.pieces[0]?.tier ?? demoState.bagSlots[0]?.tier).toBe('silver');
  });
  it.each([false, true])('keeps BUY but no MERGE for missing/nonmergeable copy (diamond=%s)', diamond => {
    if (diamond) demoState.pieces = [{ instanceId: 'owned', skillId: 'control_opportunist', tier: 'diamond', slot: 0 }];
    const scene = setup(); scene.renderCardDetail();
    expect(last().secondaryAction).toBeUndefined();
    expect(last().primaryAction).toMatchObject({ label: 'BUY · 3 GOLD', enabled: true });
    last().primaryAction!.onPress(); expect(scene.pendingBuy).toEqual({ kind: 'card', index: 1 });
  });
  it('keeps full-bag merge enabled but unaffordable merge visible and disabled', () => {
    demoState.bagSlots = Array.from({ length: 10 }, (_, slot) => ({ instanceId: `owned${slot}`, skillId: 'control_opportunist', tier: 'bronze' as const }));
    const scene = setup(); scene.renderCardDetail();
    expect(last().secondaryAction).toMatchObject({ label: 'MERGE', enabled: true });
    scene.activeGold = () => 2; scene.renderCardDetail();
    expect(last().secondaryAction).toMatchObject({ label: 'MERGE', enabled: false });
    expect(last().primaryAction?.enabled).toBe(false);
  });
  it('surrounds the whole card and centers an opaque nonfading label at its bottom', () => {
    const scene: any = new Scene(); const objects: any[] = [];
    const make = (props: any) => { const obj: any = { ...props, setOrigin: () => obj, setStrokeStyle: (width: number) => { obj.strokeWidth = width; return obj; } }; objects.push(obj); return obj; };
    scene.add = { text: (x: number, y: number, text: string) => make({ x, y, text, width: text.length * 7, height: 16 }),
      rectangle: (x: number, y: number, width: number, height: number, _fill: number, alpha: number) => make({ x, y, width, height, alpha }),
      container: (x: number, y: number, list: any[]) => make({ x, y, list }) };
    scene.tweens = { add: vi.fn() };
    const overlay = scene.renderMergeBadge(20, 30, { toTier: 'silver' }, 14, 300, 100);
    const outline = overlay.list.find((obj: any) => obj.width === 300 && obj.height === 100);
    expect(outline?.strokeWidth).toBeGreaterThanOrEqual(3);
    const plate = overlay.list.find((obj: any) => obj.width !== 300 && obj.text === undefined);
    expect(plate?.alpha).toBe(1);
    expect(plate.x + plate.width / 2).toBe(150);
    expect(plate.y + plate.height).toBe(96);
    expect(overlay.x).toBe(20); expect(overlay.y).toBe(30);
    expect(scene.tweens.add).not.toHaveBeenCalled();
  });
});
