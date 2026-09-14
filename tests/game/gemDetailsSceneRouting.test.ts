import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => ({ default: { Events: { EventEmitter: (await import('node:events')).EventEmitter }, Scene: class {}, GameObjects: { Container: class {} }, Math: { Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)) } } }));
vi.mock('../../src/game/audio/sfxSynth', () => ({ playSfx: vi.fn() }));
vi.mock('../../src/game/ui/gemDetailsDrawer', () => ({ renderGemDetailsDrawer: vi.fn() }));
import { renderGemDetailsDrawer } from '../../src/game/ui/gemDetailsDrawer';
import { gemBook } from '../../src/data/gems';
import { DesktopShopScene } from '../../src/game/scenes/DesktopShopScene';
import { MobileShopScene } from '../../src/game/scenes/MobileShopScene';
import { DesktopDeckBuildScene } from '../../src/game/scenes/DesktopDeckBuildScene';
import { MobileDeckBuildScene } from '../../src/game/scenes/MobileDeckBuildScene';
const last = () => vi.mocked(renderGemDetailsDrawer).mock.calls.at(-1)!;
describe.each([['desktop', DesktopShopScene], ['mobile', MobileShopScene]] as const)('%s gem routing', (_name, Scene) => {
  it('keeps shelf price and confirmation target and disables an unaffordable purchase', () => {
    const scene: any = new Scene(); scene.rerender = vi.fn();
    scene.activeShopId = () => 'wildworks'; scene.activeGold = () => 3;
    scene.shelfFor = () => ({ gems: [{ gemId: 'swift_charm', price: 4 }] });
    scene.detailGemIndex = 0; scene.renderGemDetail();
    expect(last()[1]).toBe(gemBook.swift_charm);
    expect(last()[2].primaryAction).toMatchObject({ label: 'NEED 4 GOLD', enabled: false });
    scene.activeGold = () => 4; scene.renderGemDetail();
    last()[2].primaryAction!.onPress();
    expect(scene.pendingBuy).toEqual({ kind: 'gem', index: 0 });
  });
  it('inspects an owned duplicate without selling until explicit confirmation action', () => {
    const scene: any = new Scene(); scene.rerender = vi.fn();
    Object.defineProperty(scene, 'gemInventory', { get: () => ['swift_charm', 'swift_charm'] });
    scene.inspectGemIndex = 1; scene.renderOwnedGemDetail();
    expect(scene.pendingSell).toBeNull();
    expect(last()[2].slots!.map(s => s.key)).toEqual(['pouch:0', 'pouch:1']);
    last()[2].slots![1]!.action!.onPress();
    expect(scene.pendingSell).toEqual({ location: 'gem', index: 1 });
  });
  it('routes the actual owned-gem tap handler into details instead of sale', () => {
    const scene: any = new Scene(); scene.input = new EventEmitter(); scene.rerender = vi.fn();
    scene.spawnOwnedGemDragProxy = () => null;
    scene.worldBounds = () => ({ contains: () => true }); scene.inventoryViewport = { x: 0, y: 0, width: 400, height: 400 };
    const obj: any = { x: 10, y: 10 }; for (const method of ['setAlpha', 'setDepth', 'setPosition']) obj[method] = () => obj;
    scene.draggables = [{ obj, src: { kind: 'gem', index: 2 } }]; scene.wireDrag();
    const pointer = { worldX: 20, worldY: 20, event: {} };
    scene.input.emit('pointerdown', pointer); scene.input.emit('pointerup', pointer);
    expect(scene.inspectGemIndex).toBe(2); expect(scene.pendingSell).toBeNull();
  });
});
describe.each([['desktop', DesktopDeckBuildScene], ['mobile', MobileDeckBuildScene]] as const)('%s socket chooser', (_name, Scene) => {
  function setup(socketed = false) {
    const scene: any = new Scene(); scene.rerender = vi.fn(); scene.socketFor = 'card';
    let pieces: any[] = [{ instanceId: 'card', skillId: 'sword_slash', tier: 'bronze', slot: 0, ...(socketed ? { gem: gemBook.empowering_core! } : {}) }];
    let inventory = ['swift_charm', 'swift_charm'];
    Object.defineProperty(scene, 'pieces', { get: () => pieces, set: v => { pieces = v; } });
    Object.defineProperty(scene, 'gemInventory', { get: () => inventory, set: v => { inventory = v; } });
    scene.renderSocketPanel(); return scene;
  }
  it.each([false, true])('keeps both duplicates and explicit socket/swap semantics (socketed=%s)', socketed => {
    const scene = setup(socketed);
    expect(last()[2].context).toBe('Sword Slash');
    const slots = last()[2].slots!;
    expect(slots.filter(s => s.key.startsWith('pouch:'))).toHaveLength(2);
    expect(scene.gemInventory).toHaveLength(2);
    slots.find(s => s.key === 'pouch:1')!.action!.onPress();
    expect(scene.pieces[0].gem.id).toBe('swift_charm');
    expect(scene.gemInventory).toEqual(socketed ? ['swift_charm', 'empowering_core'] : ['swift_charm']);
    expect(scene.socketFor).toBeNull();
  });
  it('unsockets the current gem back to the existing pouch', () => {
    const scene = setup(true);
    last()[2].slots!.find(s => s.key === 'socket')!.action!.onPress();
    expect(scene.pieces[0].gem).toBeNull();
    expect(scene.gemInventory).toEqual(['swift_charm', 'swift_charm', 'empowering_core']);
  });
});
