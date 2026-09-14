import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { gemBook } from '../../src/data/gems';
import { gemChipLines } from '../../src/game/ui/gemPresentation';
vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/game/ui/GemToken', () => ({ GemToken: class { setDepth() { return this; } destroy() {} } }));
import { renderGemDetailsDrawer } from '../../src/game/ui/gemDetailsDrawer';
function setup() {
  const objects: any[] = [];
  const masks: any[] = [];
  const make = (x = 0, y = 0, value?: string, style?: any) => {
    const obj: any = new EventEmitter();
    Object.assign(obj, { x, y, text: value, active: true, list: [], width: 44, height: value ? Math.ceil(value.length / Math.max(1, Math.floor((style?.wordWrap?.width ?? 400) / 8))) * 20 : 44 });
    for (const key of ['setOrigin', 'setDepth', 'setStrokeStyle', 'setMask', 'clearMask', 'setVisible', 'fillStyle', 'fillRect']) obj[key] = () => obj;
    obj.setInteractive = (config: any) => { obj.interactive = true; obj.inputConfig = config; return obj; };
    obj.setY = (y: number) => { obj.y = y; return obj; };
    obj.setPosition = (x: number, y: number) => { obj.x = x; obj.y = y; return obj; };
    obj.add = (child: any) => { for (const c of Array.isArray(child) ? child : [child]) { obj.list.push(c); c.parent = obj; } return obj; };
    obj.remove = (child: any) => { obj.list = obj.list.filter((c: any) => c !== child); return obj; };
    obj.destroy = () => { if (!obj.active) return; obj.active = false; for (const c of obj.list) c.destroy(); obj.emit('destroy'); };
    obj.createGeometryMask = () => { const mask = { destroy: vi.fn() }; masks.push(mask); return mask; };
    objects.push(obj); return obj;
  };
  const scene: any = { input: new EventEmitter(), make: { graphics: () => make() }, add: {
    rectangle: (x: number, y: number) => make(x, y), container: (x: number, y: number) => make(x, y),
    text: (x: number, y: number, value: string, style: any) => make(x, y, value, style),
  } };
  const click = (label: string) => {
    const index = objects.findIndex((obj, i) => obj.active && obj.text === label && objects[i - 1]?.interactive);
    expect(index).toBeGreaterThan(-1);
    const event = { stopPropagation: vi.fn() };
    const target = objects[index - 1];
    const pointer = { worldX: target.x + (target.parent?.x ?? 0) + 10, worldY: target.y + (target.parent?.y ?? 0) + 10 };
    target.emit('pointerdown', pointer, 0, 0, event);
    target.emit('pointerup', pointer, 0, 0, event);
    expect(event.stopPropagation).toHaveBeenCalled();
  };
  return { scene, objects, masks, click };
}
describe('shared gem inspector', () => {
  it.each([false, true])('shows canonical concrete copy and fires the explicit action once (compact=%s)', compact => {
    const { scene, objects, click } = setup();
    const onPress = vi.fn();
    renderGemDetailsDrawer(scene, gemBook.swift_charm!, { compact, onClose: vi.fn(), primaryAction: { label: 'BUY · 1 GOLD', enabled: true, onPress } });
    const text = objects.map(o => o.text).filter(Boolean);
    expect(text).toContain('GEM DETAILS');
    expect(text).toContain('Swift Charm');
    expect(text).toContain(gemChipLines(gemBook.swift_charm!).effect);
    expect(text.join(' ')).not.toMatch(/\bX\b|POWER|WHAT IT DOES|BRONZE|DIAMOND/);
    click('BUY · 1 GOLD'); expect(onPress).toHaveBeenCalledOnce();
  });
  it('preserves duplicate inventory slots, selection-specific actions, and listener teardown', () => {
    const { scene, objects, masks, click } = setup();
    const one = vi.fn(), two = vi.fn();
    renderGemDetailsDrawer(scene, gemBook.swift_charm!, { compact: true, onClose: vi.fn(), selectedKey: 'pouch:0',
      slots: [one, two].map((onPress, i) => ({ key: `pouch:${i}`, label: `POUCH ${i + 1}`, gem: gemBook.swift_charm!, action: { label: `SELL ${i + 1}`, enabled: true, onPress } })),
    });
    click('POUCH 2');
    expect(one).not.toHaveBeenCalled(); expect(two).not.toHaveBeenCalled();
    expect(scene.input.listenerCount('wheel')).toBe(1);
    expect(masks[0].destroy).toHaveBeenCalledOnce();
    click('SELL 2'); expect(two).toHaveBeenCalledOnce(); expect(one).not.toHaveBeenCalled();
    for (const obj of objects) obj.destroy();
    expect(scene.input.listenerCount('wheel')).toBe(0);
    expect(scene.input.listenerCount('pointermove')).toBe(0);
  });
  it('retains every long effect in a bounded scroller and never enables disabled purchase', () => {
    const { scene, objects } = setup();
    const gem = { ...gemBook.swift_charm!, name: 'A very long name '.repeat(30) };
    const onPress = vi.fn();
    renderGemDetailsDrawer(scene, gem, { compact: true, view: { x: 0, y: 0, width: 372, height: 436 }, onClose: vi.fn(), primaryAction: { label: 'NEED 9 GOLD', enabled: false, onPress } });
    expect(objects.find(o => o.text === gem.name)).toBeTruthy();
    const list = objects.find(o => o.list.some((c: any) => c.text === gem.name));
    const originalY = list.y;
    scene.input.emit('wheel', { worldX: 100, worldY: 100 }, [], 0, 999);
    expect(list.y).toBeLessThan(originalY);
    const caption = objects.findIndex(o => o.text === 'NEED 9 GOLD');
    expect(objects[caption - 1].interactive).not.toBe(true);
    expect(onPress).not.toHaveBeenCalled();
  });
  it('cancels slot inspection after scrolling or an outside release and gates masked hit areas', () => {
    const { scene, objects } = setup();
    renderGemDetailsDrawer(scene, gemBook.swift_charm!, { compact: true,
      view: { x: 0, y: 0, width: 372, height: 436 }, onClose: vi.fn(), selectedKey: 'pouch:0',
      slots: Array.from({ length: 20 }, (_, i) => ({ key: `pouch:${i}`, label: `POUCH ${i + 1}`, gem: gemBook.swift_charm! })),
    });
    const bgFor = (label: string) => objects[objects.findIndex(o => o.text === label) - 1];
    const first = bgFor('POUCH 1');
    const last = bgFor('POUCH 20');
    expect(last.inputConfig.hitAreaCallback({}, 10, 10)).toBe(false);
    const pointer = { worldX: first.x + first.parent.x + 10, worldY: first.y + first.parent.y + 10, isDown: true };
    const event = { stopPropagation() {} };
    first.emit('pointerdown', pointer); scene.input.emit('pointerdown', pointer);
    scene.input.emit('pointermove', { ...pointer, worldY: pointer.worldY - 30 });
    scene.input.emit('pointermove', pointer);
    first.emit('pointerup', pointer, 0, 0, event);
    expect(first.active).toBe(true);
    first.emit('pointerdown', pointer);
    scene.input.emit('pointerupoutside', pointer);
    first.emit('pointerup', pointer, 0, 0, event);
    expect(first.active).toBe(true);
    scene.input.emit('wheel', { worldX: 100, worldY: 100 }, [], 0, 9999);
    expect(last.inputConfig.hitAreaCallback({}, 10, 10)).toBe(true);
    expect(first.inputConfig.hitAreaCallback({}, 10, 10)).toBe(false);
  });
  it('renders the whole gem catalog without placeholder rules or duplicate face prose', () => {
    for (const gem of Object.values(gemBook)) {
      const { scene, objects } = setup();
      renderGemDetailsDrawer(scene, gem, { compact: false, onClose() {} });
      const strings = objects.map(o => o.text).filter(Boolean);
      expect(strings.filter(s => s === gemChipLines(gem).effect), gem.id).toHaveLength(1);
      expect(strings.join(' '), gem.id).not.toMatch(/\d*X\b|\bPL\b|WHAT IT DOES|FULL CARD TEXT/);
      for (const obj of objects) obj.destroy();
    }
  });
  it('does not expose the unresolved Burn coefficient on the actual Ember Sliver', () => {
    const { scene, objects } = setup();
    const ember = Object.values(gemBook).find(gem => gem.name === 'Ember Sliver')!;
    expect(ember).toBeDefined();
    renderGemDetailsDrawer(scene, ember, { compact: false, onClose() {} });
    const strings = objects.map(o => o.text).filter(Boolean);
    expect(strings).toContain(gemChipLines(ember).effect);
    expect(strings.join(' ')).not.toContain('Deal 2X damage');
  });
  it('keeps Resonant Echo weight concrete without implying a Speed effect, while Swift retains Speed', () => {
    const echo = setup();
    renderGemDetailsDrawer(echo.scene, gemBook.resonant_echo!, { compact: false, onClose() {} });
    const echoText = echo.objects.map(o => o.text).filter(Boolean).join(' ');
    expect(echoText).toContain('+25% weight');
    expect(echoText).not.toContain('SPD —');
    const swift = setup();
    renderGemDetailsDrawer(swift.scene, gemBook.swift_charm!, { compact: false, onClose() {} });
    expect(swift.objects.map(o => o.text).filter(Boolean).join(' ')).toContain('SPD —');
  });
});
