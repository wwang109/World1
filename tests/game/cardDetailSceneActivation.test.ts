import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => ({ default: {
  Events: { EventEmitter: (await import('node:events')).EventEmitter },
  Scene: class {},
  GameObjects: { Container: class {} },
  Math: { Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)) },
} }));
vi.mock('../../src/game/audio/sfxSynth', () => ({ playSfx: vi.fn() }));
vi.mock('../../src/game/ui/cardDetailsDrawer', () => ({ renderCardDetailsDrawer: vi.fn() }));
import { renderCardDetailsDrawer } from '../../src/game/ui/cardDetailsDrawer';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { instancePowerLevelDeci, powerLevelDeci } from '../../src/engine/balance';
import { resolveDisplaySkill } from '../../src/engine/cards';
import { DesktopDeckBuildScene } from '../../src/game/scenes/DesktopDeckBuildScene';
import { MobileDeckBuildScene } from '../../src/game/scenes/MobileDeckBuildScene';
import { DesktopShopScene } from '../../src/game/scenes/DesktopShopScene';
import { MobileShopScene } from '../../src/game/scenes/MobileShopScene';

function object() {
  const obj = { x: 30, y: 30, setPosition: vi.fn(), setDepth: vi.fn(), setAlpha: vi.fn(), destroy: vi.fn(), setOrigin: vi.fn(), setStrokeStyle: vi.fn(), setVisible: vi.fn(), spawnGhost: vi.fn() };
  for (const key of ['setPosition', 'setDepth', 'setAlpha', 'setOrigin', 'setStrokeStyle', 'setVisible'] as const) obj[key].mockReturnValue(obj);
  obj.spawnGhost.mockImplementation(() => ({ destroy: vi.fn() }));
  return obj;
}

// Invoke the real scene handlers without canvas rendering. This catches the first-tap
// socket/rebuild race which testing only the small activation state machine cannot see.
describe.each([DesktopDeckBuildScene, MobileDeckBuildScene])('%s actual Deck gesture handlers', Scene => {
  function setup(where: 'deck' | 'bag') {
    const scene = new Scene() as any;
    scene.input = new EventEmitter();
    scene.add = { rectangle: () => object() };
    scene.rerender = vi.fn(() => scene.detailActivation.reset());
    scene.resolveDrop = vi.fn();
    const card = { skillId: 'sword_slash', tier: 'bronze', instanceId: 'one' };
    const src = where === 'deck' ? { where, instanceId: 'one', card } : { where, index: 0, card };
    scene.draggables = [{ token: object(), bounds: { contains: () => true }, src }];
    scene.wireDrag();
    const click = (time: number) => {
      scene.input.emit('pointerdown', { worldX: 30, worldY: 30, event: {}, upTime: time });
      scene.input.emit('pointerup', { worldX: 30, worldY: 30, event: {}, upTime: time });
    };
    return { scene, src, click };
  }
  it.each(['deck', 'bag'] as const)('opens %s on second click without opening socket or moving on first', where => {
    const { scene, src, click } = setup(where);
    click(100);
    expect(scene.inspectCard).toBeNull();
    expect(scene.socketFor).toBeNull();
    expect(scene.rerender).not.toHaveBeenCalled();
    expect(scene.resolveDrop).not.toHaveBeenCalled();
    click(200);
    expect(scene.inspectCard).toEqual(src);
    expect(scene.rerender).toHaveBeenCalledOnce();
    expect(scene.socketFor).toBeNull();
  });
  it('does not start an underlying drag while the drawer is open', () => {
    const { scene, click } = setup('deck');
    click(100); click(200); click(250);
    expect(scene.rerender).toHaveBeenCalledOnce();
    expect(scene.resolveDrop).not.toHaveBeenCalled();
  });
});

describe.each([DesktopShopScene, MobileShopScene])('%s actual Shop gesture handlers', Scene => {
  it.each(['board', 'bag', 'shelfCard'] as const)('opens %s only after two completed clicks', kind => {
    const scene = new Scene() as any;
    scene.input = new EventEmitter();
    scene.rerender = vi.fn((preserveActivation = false) => { if (!preserveActivation) scene.detailActivation.reset(); });
    scene.worldBounds = () => ({ contains: () => true });
    scene.activeShopId = () => 'wildworks';
    scene.isRunMode = () => Scene === MobileShopScene && kind === 'shelfCard';
    scene.shelfFor = () => ({ cards: [{ skillId: 'control_opportunist', tier: 'silver', price: 3 }] });
    scene.shelfViewport = { x: 0, y: 0, width: 400, height: 400 };
    scene.inventoryViewport = { x: 0, y: 0, width: 400, height: 400 };
    scene.draggables = [{ obj: object(), src: { kind, index: 0 } }];
    scene.wireDrag();
    const click = (time: number) => {
      scene.input.emit('pointerdown', { worldX: 30, worldY: 30, event: {}, upTime: time });
      scene.input.emit('pointerup', { worldX: 30, worldY: 30, event: {}, upTime: time });
    };
    click(100);
    if (Scene === MobileShopScene && kind === 'shelfCard') {
      expect(scene.selectedCardIndex).toBe(0);
      expect(scene.rerender).toHaveBeenCalledWith(true);
    } else expect(scene.rerender).not.toHaveBeenCalled();
    click(200);
    expect(scene.rerender).toHaveBeenCalledTimes(Scene === MobileShopScene && kind === 'shelfCard' ? 2 : 1);
    if (kind === 'shelfCard') expect(scene.detailCardIndex).toBe(0);
    else expect(scene.inspectOwned).toEqual({ location: kind, index: 0 });
    click(250);
    expect(scene.rerender).toHaveBeenCalledTimes(Scene === MobileShopScene && kind === 'shelfCard' ? 2 : 1);
  });

  if (Scene === MobileShopScene) it('closes offer details without clearing the selected card or shelf scroll', () => {
    const scene = new Scene() as any;
    scene.rerender = vi.fn();
    scene.selectedCardIndex = 0;
    scene.detailCardIndex = 0;
    scene.shelfScrollY = -84;
    scene.activeShopId = () => 'wildworks';
    scene.activeGold = () => 99;
    scene.shelfFor = () => ({ cards: [{ skillId: 'control_opportunist', tier: 'silver', price: 3 }] });
    scene.runShopId = () => 'wildworks';
    scene.renderCardDetail();
    const opts = vi.mocked(renderCardDetailsDrawer).mock.calls.at(-1)![2];
    expect(opts.presentation).toBe('mobile-shop');
    opts.onClose();
    expect(scene.selectedCardIndex).toBe(0);
    expect(scene.shelfScrollY).toBe(-84);
    expect(scene.detailCardIndex).toBeNull();
  });

  if (Scene === MobileShopScene) it('leaves the Sandbox shelf on its existing two-tap detail behavior without adding Run selection state', () => {
    const scene = new Scene() as any;
    scene.input = new EventEmitter();
    scene.rerender = vi.fn((preserveActivation = false) => { if (!preserveActivation) scene.detailActivation.reset(); });
    scene.isRunMode = () => false;
    scene.worldBounds = () => ({ contains: () => true });
    scene.activeShopId = () => 'wildworks';
    scene.shelfFor = () => ({ cards: [{ skillId: 'control_opportunist', tier: 'silver', price: 3 }] });
    scene.shelfViewport = { x: 0, y: 0, width: 400, height: 400 };
    scene.draggables = [{ obj: object(), src: { kind: 'shelfCard', index: 0 } }];
    scene.wireDrag();
    const click = (time: number) => {
      scene.input.emit('pointerdown', { worldX: 30, worldY: 30, event: {}, upTime: time });
      scene.input.emit('pointerup', { worldX: 30, worldY: 30, event: {}, upTime: time });
    };
    click(100);
    expect(scene.selectedCardIndex).toBeNull();
    expect(scene.rerender).not.toHaveBeenCalled();
    click(200);
    expect(scene.detailCardIndex).toBe(0);
    expect(scene.rerender).toHaveBeenCalledOnce();
  });
});

describe.each([DesktopShopScene, MobileShopScene, DesktopDeckBuildScene, MobileDeckBuildScene])('%s owned power pricing', Scene => {
  it('prices a lightweight gem from the authored instance instead of repricing reduced display weight', () => {
    const scene = new Scene() as any;
    const base = skillBook.rapid_volley!;
    const piece = { instanceId: 'gem-card', skillId: base.id, tier: base.tier, slot: 0, gem: gemBook.lightweight_core! };
    Object.defineProperty(scene, 'pieces', { get: () => [piece] });
    if (Scene === DesktopShopScene || Scene === MobileShopScene) {
      scene.inspectOwned = { location: 'board', index: 0 };
      scene.renderOwnedCardDetail();
    } else {
      scene.inspectCard = { where: 'deck', instanceId: piece.instanceId, card: piece };
      scene.renderCardDetails();
    }
    const opts = vi.mocked(renderCardDetailsDrawer).mock.calls.at(-1)![2];
    expect(opts.powerDeci).toBe(instancePowerLevelDeci(base, piece));
    expect(opts.powerDeci).not.toBe(powerLevelDeci(resolveDisplaySkill(base, piece)));
  });
});
