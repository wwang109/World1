import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const tokens = vi.hoisted(() => ({ options: [] as any[] }));
vi.mock('../../src/game/ui/CardToken', () => ({ CardToken: class {
  constructor(_scene: unknown, _x: number, _y: number, _skill: unknown, options: unknown) { tokens.options.push(options); }
} }));
vi.mock('phaser', async () => ({ default: { Scene: class {}, GameObjects: { Container: class {} }, Events: { EventEmitter: (await import('node:events')).EventEmitter } } }));
vi.mock('../../src/game/sceneRebuild', () => ({ rebuildScene: vi.fn() }));
vi.mock('../../src/game/ui/cardDetailsDrawer', () => ({ renderCardDetailsDrawer: vi.fn() }));
import { MobileDraftScene } from '../../src/game/scenes/MobileDraftScene';
import { renderCardDetailsDrawer } from '../../src/game/ui/cardDetailsDrawer';

function setup() {
  const scene = new MobileDraftScene() as any;
  scene.pick = vi.fn();
  return scene;
}
describe('Mobile Draft Card Details', () => {
  function renderActualCard(scene: any) {
    const hits: any[] = [];
    const make = () => {
      const obj: any = new EventEmitter();
      for (const method of ['setOrigin', 'setStrokeStyle', 'setBackgroundColor', 'setPadding']) obj[method] = () => obj;
      obj.setInteractive = () => { hits.push(obj); return obj; };
      return obj;
    };
    scene.W = 412; scene.H = 892;
    scene.draft = { offense: [{ skillId: 'sword_slash' }] };
    scene.add = { rectangle: make, text: make };
    scene.renderSet();
    return hits[0];
  }
  it('actual card release handler ignores a cancelled swipe and starts a fresh tap sequence', () => {
    const scene = setup();
    const hit = renderActualCard(scene);
    const tap = (time: number) => {
      hit.emit('pointerdown', { worldX: 30, worldY: 30 });
      hit.emit('pointerup', { worldX: 30, worldY: 30, upTime: time });
    };
    tap(100);
    hit.emit('pointerdown', { worldX: 30, worldY: 30 });
    hit.emit('pointerout');
    hit.emit('pointerup', { worldX: 90, worldY: 90, upTime: 150 });
    tap(200);
    expect(scene.detailSkillId).toBeNull();
    expect(scene.pick).toHaveBeenCalledTimes(2);
    tap(300);
    expect(scene.detailSkillId).toBe('sword_slash');
  });
  it('actual info callback opens immediately without selecting or retaining the first tap', () => {
    const scene = setup();
    renderActualCard(scene);
    scene.selectOrInspect('offense', 'sword_slash', 100);
    tokens.options.at(-1).onInspect();
    expect(scene.detailSkillId).toBe('sword_slash');
    expect(scene.pick).toHaveBeenCalledTimes(1);
    scene.detailSkillId = null;
    scene.selectOrInspect('offense', 'sword_slash', 200);
    expect(scene.detailSkillId).toBeNull();
  });
  it('selects once then opens the same card without another pick write', () => {
    const scene = setup();
    scene.selectOrInspect('offense', 'sword_slash', 100);
    expect(scene.pick).toHaveBeenCalledExactlyOnceWith('offense', 'sword_slash');
    expect(scene.detailSkillId).toBeNull();
    scene.selectOrInspect('offense', 'sword_slash', 240);
    expect(scene.detailSkillId).toBe('sword_slash');
    expect(scene.pick).toHaveBeenCalledTimes(1);
    scene.renderDetail();
    const opts = vi.mocked(renderCardDetailsDrawer).mock.calls.at(-1)![2];
    expect(opts.compact).toBe(true);
    expect(opts.primaryAction).toBeUndefined();
    opts.onClose();
    expect(scene.detailSkillId).toBeNull();
    scene.selectOrInspect('offense', 'sword_slash', 300);
    expect(scene.detailSkillId).toBeNull();
  });
  it('another card or another set begins a new sequence and selects it', () => {
    const scene = setup();
    scene.selectOrInspect('offense', 'sword_slash', 100);
    scene.selectOrInspect('offense', 'fireball', 200);
    expect(scene.detailSkillId).toBeNull();
    expect(scene.pick).toHaveBeenLastCalledWith('offense', 'fireball');
    scene.selectOrInspect('wildcard', 'fireball', 300);
    expect(scene.detailSkillId).toBeNull();
    expect(scene.pick).toHaveBeenLastCalledWith('wildcard', 'fireball');
  });
  it('navigation/reroll/info rebuild cancels the armed body tap', () => {
    const scene = setup();
    scene.selectOrInspect('offense', 'sword_slash', 100);
    scene.rerender();
    scene.selectOrInspect('offense', 'sword_slash', 200);
    expect(scene.detailSkillId).toBeNull();
    expect(scene.pick).toHaveBeenCalledTimes(2);
  });
  it('fresh scene init resets transient details without clearing persisted picks', () => {
    const scene = setup();
    scene.sandboxPicks = { offense: 'sword_slash' };
    scene.selectOrInspect('offense', 'sword_slash', 100);
    scene.init();
    scene.selectOrInspect('offense', 'sword_slash', 200);
    expect(scene.detailSkillId).toBeNull();
    expect(scene.sandboxPicks).toEqual({ offense: 'sword_slash' });
  });
});
