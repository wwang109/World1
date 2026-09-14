import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const previews = vi.hoisted(() => [] as any[]);
vi.mock('phaser', () => ({ default: { Events: { EventEmitter }, Scene: class {}, GameObjects: { Container: class {} }, Math: { Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)) } } }));
vi.mock('../../src/game/audio/sfxSynth', () => ({ playSfx: vi.fn() }));
vi.mock('../../src/game/ui/runArt', () => ({ addRunArt: vi.fn(), RUN_ART_KEYS: { icon: { coin: 'coin' } } }));
vi.mock('../../src/game/ui/CardToken', () => ({ CardToken: class { constructor(_s: unknown, public x: number, public y: number, public skill: any, public opts: any) { previews.push(this); } } }));
vi.mock('../../src/game/ui/FantasyCardTemplateV2', () => ({ FantasyCardTemplateV2: class { constructor(_s: unknown, public x: number, public y: number, public skill: any, public opts: any) { previews.push(this); } setDepth() { return this; } } }));
import { DesktopShopScene } from '../../src/game/scenes/DesktopShopScene';
import { MobileShopScene } from '../../src/game/scenes/MobileShopScene';
import { demoState } from '../../src/game/demoState';
import { tierUpgradePreview } from '../../src/game/ui/tierUpgradePreview';
import { renderSkillText } from '../../src/engine/keywords/compose';
import { stripCardTextMarkup } from '../../src/game/ui/cardTextMarkup';

describe.each([['desktop', DesktopShopScene], ['mobile', MobileShopScene]] as const)('%s inline merge confirmation', (_name, Scene) => {
  beforeEach(() => {
    previews.length = 0;
    demoState.pieces = [{ instanceId: 'owned', skillId: 'control_opportunist', tier: 'silver', slot: 0 }];
    demoState.bagSlots = Array(10).fill(null);
    demoState.shopShelves = { wildworks: { cards: [{ skillId: 'control_opportunist', tier: 'bronze', price: 3 }], gems: [], rerollCount: 0 } };
  });
  function setup(upgradeTextHeight = 32) {
    const objects: any[] = [];
    const make = (props: any) => { const obj: any = new EventEmitter(); Object.assign(obj, props);
      for (const method of ['setOrigin', 'setStrokeStyle', 'setInteractive', 'setDepth']) obj[method] = () => obj;
      obj.setPosition = (x: number, y: number) => { Object.assign(obj, { x, y }); return obj; };
      obj.setSize = (width: number, height: number) => { Object.assign(obj, { width, height }); return obj; };
      objects.push(obj); return obj; };
    const scene: any = new Scene(); scene.W = 412; scene.H = 892;
    Object.defineProperty(scene, 'viewWidth', { value: 1440 });
    Object.defineProperty(scene, 'viewHeight', { value: 900 });
    scene.activeShopId = () => 'wildworks'; scene.isRunMode = () => false;
    scene.shelfFor = () => demoState.shopShelves.wildworks;
    scene.pendingBuy = { kind: 'card', index: 0 }; scene.detailTier = 'diamond';
    scene.rerender = vi.fn(); scene.showToast = vi.fn();
    scene.add = { rectangle: (x: number, y: number, width: number, height: number) => make({ x, y, width, height }),
      text: (x: number, y: number, text: string, style: any) => make({ x, y, text, width: Math.min(text.length * 7, style.wordWrap?.width ?? Infinity), height: text.includes(' UPGRADE\n') ? upgradeTextHeight : text.length > 65 ? 32 : 18 }) };
    scene.renderConfirm();
    const button = (label: string) => objects[objects.findIndex(obj => obj.text === label) - 1];
    return { scene, objects, button };
  }
  it('shows actual owned next-tier numeric effects inline without an extra VIEW action', () => {
    const { objects, button } = setup();
    expect(previews).toHaveLength(0);
    const preview = tierUpgradePreview('control_opportunist', 'silver', 'gold');
    if (!preview.available) throw new Error('Expected upgrade');
    const effectText = stripCardTextMarkup(renderSkillText(preview.toSkill));
    const stats = objects.find(obj => obj.text === `GOLD UPGRADE\n${effectText}`);
    expect(stats).toBeDefined();
    expect(stats.listenerCount('pointerdown')).toBe(0);
    expect(stats.text).toMatch(/\d/);
    expect(objects.some(obj => /^VIEW /.test(obj.text ?? ''))).toBe(false);
    const summary = objects.find(obj => obj.text?.includes('SILVER → GOLD'));
    expect(summary).toBeDefined();
    expect(stats.y).toBeGreaterThanOrEqual(summary.y + summary.height);
    expect(stats.y + stats.height).toBeLessThan(button('CANCEL').y);
    for (const label of ['CANCEL', 'BUY', 'MERGE']) expect(button(label).listenerCount('pointerdown')).toBe(1);
  });
  it('sizes the confirmation to fully measured effect text and keeps actions below it', () => {
    const { objects, button } = setup(180);
    const stats = objects.find(obj => obj.text?.includes(' UPGRADE\n'));
    const panel = objects[1];
    expect(stats.y + stats.height + 16).toBeLessThanOrEqual(button('CANCEL').y);
    expect(button('CANCEL').y + button('CANCEL').height).toBeLessThan(panel.y + panel.height);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.y + panel.height).toBeLessThanOrEqual(Scene === DesktopShopScene ? 900 : 892);
  });
  it('retains the conditional upgrade warning with measured separation before stats', () => {
    demoState.pieces = [{ instanceId: 'owned', skillId: 'arcane_bolt', tier: 'gold', slot: 0 }];
    demoState.shopShelves.wildworks!.cards = [{ skillId: 'arcane_bolt', tier: 'bronze', price: 3 }];
    const { objects } = setup();
    const summary = objects.find(obj => obj.text?.includes('GOLD → DIAMOND'));
    const warning = objects.find(obj => obj.text?.startsWith('CONDITIONAL UPGRADE'));
    const stats = objects.find(obj => obj.text?.startsWith('DIAMOND UPGRADE\n'));
    expect(warning).toBeDefined();
    expect(warning.y).toBeGreaterThanOrEqual(summary.y + summary.height);
    expect(stats.y).toBeGreaterThanOrEqual(warning.y + warning.height);
  });
  it.each(['CANCEL', 'BUY', 'MERGE'])('retains original %s action semantics', action => {
    const { scene, button } = setup(); button(action).emit('pointerdown');
    expect(scene.pendingBuy).toBeNull();
    expect(demoState.pieces[0]!.tier).toBe(action === 'MERGE' ? 'gold' : 'silver');
    expect(demoState.shopShelves.wildworks!.cards).toHaveLength(action === 'CANCEL' ? 1 : 0);
    expect(demoState.bagSlots.filter(Boolean)).toHaveLength(action === 'BUY' ? 1 : 0);
  });
  it('keeps ordinary purchase compact with no upgrade preview or merge action', () => {
    demoState.pieces = [];
    const { objects } = setup();
    expect(previews).toHaveLength(0);
    expect(objects.some(obj => obj.text === 'MERGE')).toBe(false);
    expect(objects[1].height).toBe(Scene === DesktopShopScene ? 180 : 140);
  });
});
