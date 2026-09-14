import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { applyTier } from '../../src/engine/cards';
const cards = vi.hoisted(() => [] as any[]);
vi.mock('phaser', () => ({ default: { Math: { Clamp: (n: number, min: number, max: number) => Math.max(min, Math.min(n, max)) } } }));
vi.mock('../../src/game/ui/FantasyCardTemplateV2', () => ({ FantasyCardTemplateV2: class {
  active = true;
  constructor(_scene: unknown, _x: number, _y: number, public skill: any) { cards.push(this); }
  setDepth() { return this; }
  destroy() { this.active = false; }
} }));
import { renderCardDetailsDrawer } from '../../src/game/ui/cardDetailsDrawer';

function makeScene() {
  const objects: any[] = [];
  const maskRects: number[][] = [];
  const destroyMask = vi.fn();
  function make(x = 0, y = 0, text?: string, size = 14) {
    const obj: any = new EventEmitter();
    Object.assign(obj, { x, y, text, list: [], height: text ? Math.ceil(text.length / 35) * size : 44, active: true });
    for (const name of ['setOrigin', 'setDepth', 'setStrokeStyle', 'setFillStyle', 'setMask', 'clearMask', 'setVisible', 'fillStyle', 'fillRect']) obj[name] = () => obj;
    obj.setInteractive = () => { obj.interactive = true; return obj; };
    obj.setY = (next: number) => { obj.y = next; return obj; };
    obj.setText = (next: string) => { obj.text = next; return obj; };
    obj.setSize = (_w: number, h: number) => { obj.height = h; return obj; };
    obj.add = (child: any) => { obj.list.push(child); return obj; };
    obj.removeAll = () => { for (const child of obj.list) child.active = false; obj.list = []; return obj; };
    obj.destroy = () => { obj.active = false; obj.emit('destroy'); };
    obj.fillRect = (...rect: number[]) => { maskRects.push(rect); return obj; };
    obj.createGeometryMask = () => ({ destroy: destroyMask });
    objects.push(obj);
    return obj;
  }
  const scene: any = {
    input: new EventEmitter(),
    make: { graphics: () => make() },
    add: { rectangle: (x: number, y: number) => make(x, y), container: (x: number, y: number) => make(x, y),
      text: (x: number, y: number, text: string, style: any) => make(x, y, text, parseInt(style.fontSize)) },
  };
  const click = (label: string) => {
    const index = objects.findIndex((obj, index) => obj.text === label && objects[index - 1]?.interactive);
    expect(index).toBeGreaterThan(0);
    objects[index - 1].emit('pointerdown', {}, 0, 0, { stopPropagation() {} });
  };
  return { scene, objects, click, maskRects, destroyMask };
}

describe('rendered Card Details drawer', () => {
  it.each([false, true])('keeps both original offer actions visible across rank previews (compact=%s)', compact => {
    const { scene, objects, click } = makeScene();
    const buy = vi.fn(), merge = vi.fn();
    renderCardDetailsDrawer(scene, skillBook.control_opportunist!, { compact,
      view: { x: 0, y: 0, width: compact ? 372 : 1440, height: compact ? 436 : 900 }, onClose: vi.fn(),
      primaryAction: { label: 'BUY · 3 GOLD', enabled: true, onPress: buy },
      secondaryAction: { label: 'MERGE', enabled: true, onPress: merge } });
    for (const tier of ['SILVER', 'GOLD', 'DIAMOND', 'BRONZE']) click(tier);
    expect(objects.filter(obj => obj.active && obj.text === 'MERGE')).toHaveLength(1);
    click('MERGE'); click('BUY · 3 GOLD');
    expect(merge).toHaveBeenCalledOnce(); expect(buy).toHaveBeenCalledOnce();
  });

  it('shows an unaffordable eligible MERGE without enabling its callback', () => {
    const { scene, objects } = makeScene(); const merge = vi.fn();
    renderCardDetailsDrawer(scene, skillBook.control_opportunist!, { compact: false, onClose: vi.fn(),
      primaryAction: { label: 'NEED 3 GOLD', enabled: false, onPress: vi.fn() },
      secondaryAction: { label: 'MERGE', enabled: false, onPress: merge } });
    const index = objects.findIndex(obj => obj.text === 'MERGE');
    expect(index).toBeGreaterThan(0);
    expect(objects[index - 1].interactive).not.toBe(true);
    objects[index - 1].emit('pointerdown', {}, 0, 0, { stopPropagation() {} });
    expect(merge).not.toHaveBeenCalled();
  });

  it('renders the approved Mobile Shop identity, canonical sections, and contextual actions without rank controls', () => {
    const { scene, objects, click } = makeScene();
    const buy = vi.fn();
    const merge = vi.fn();
    renderCardDetailsDrawer(scene, skillBook.control_opportunist!, {
      compact: true,
      presentation: 'mobile-shop',
      view: { x: 0, y: 0, width: 412, height: 740 },
      powerDeci: 150,
      onClose: vi.fn(),
      primaryAction: { label: 'BUY · 3 GOLD', enabled: true, onPress: buy },
      secondaryAction: { label: 'MERGE', enabled: true, onPress: merge },
    });
    const visible = objects.filter(obj => obj.active && obj.text !== undefined).map(obj => obj.text);
    expect(visible).toContain('POWER 15 - BRONZE');
    expect(visible).toContain('WHAT IT DOES');
    expect(visible).toContain('KEYWORDS');
    expect(visible).not.toContain('VIEWING BRONZE · CURRENT BRONZE');
    expect(visible.join(' ')).not.toMatch(/FULL CARD TEXT|Power Level|\bRank\b/);
    click('BUY · 3 GOLD');
    click('MERGE');
    expect(buy).toHaveBeenCalledOnce();
    expect(merge).toHaveBeenCalledOnce();
  });

  it.each([false, true])('browses all rank previews without changing the original card/action or leaking resources (compact=%s)', compact => {
    const { scene, objects, maskRects, click, destroyMask } = makeScene();
    const original = applyTier(skillBook.control_opportunist!, 'silver');
    const snapshot = JSON.stringify(original);
    const onPress = vi.fn();
    renderCardDetailsDrawer(scene, original, { compact,
      view: { x: 0, y: 0, width: compact ? 372 : 1440, height: compact ? 436 : 900 }, onClose: vi.fn(),
      primaryAction: { label: 'BUY · 3 GOLD', enabled: true, onPress } });
    expect(cards.at(-1).skill.tier).toBe('silver');
    for (const [tier, bonus] of [['BRONZE', 8], ['GOLD', 16], ['DIAMOND', 20], ['SILVER', 12]] as const) {
      const previousCard = cards.at(-1);
      const rect = maskRects[0]!;
      scene.input.emit('wheel', { worldX: rect[0]! + 10, worldY: rect[1]! + 10 }, [], 0, 10000);
      click(tier);
      expect(cards.at(-1).skill.tier).toBe(tier.toLowerCase());
      expect(previousCard.active).toBe(false);
      expect(objects.filter(obj => obj.active).some(obj => obj.text === `Deal ${bonus} additional damage against stunned targets.`)).toBe(true);
      expect(scene.input.listenerCount('wheel')).toBe(1);
      expect(maskRects).toHaveLength(1);
      expect(objects.find(obj => obj.list.length > 0).y).toBe(rect[1]);
      expect(objects.some(obj => obj.text === `VIEWING ${tier} · CURRENT SILVER`)).toBe(true);
      expect(onPress).not.toHaveBeenCalled();
    }
    expect(JSON.stringify(original)).toBe(snapshot);
    const displayedText = objects.filter(obj => obj.active).map(obj => obj.text);
    expect(displayedText).not.toContain('WEIGHT 10');
    expect(displayedText).not.toContain('SIZE 1');
    expect(displayedText.join(' ')).not.toMatch(/NEXT:|readiness to play|board slots/);
    click('BUY · 3 GOLD');
    expect(onPress).toHaveBeenCalledOnce();
    for (const obj of [...objects]) obj.destroy();
    expect(scene.input.listenerCount('wheel')).toBe(0);
    expect(destroyMask).toHaveBeenCalledOnce();
  });
  it('disables unauthored rank previews without fabricating another card', () => {
    const { scene, objects } = makeScene();
    renderCardDetailsDrawer(scene, { ...skillBook.sword_slash!, id: 'unknown-preview-card' }, { compact: true, onClose: vi.fn() });
    for (const tier of ['SILVER', 'GOLD', 'DIAMOND']) {
      const caption = objects.findIndex(obj => obj.text === tier);
      expect(objects[caption - 1].interactive).not.toBe(true);
    }
  });
  it.each([[412, 892], [496, 892], [376, 443]])('keeps full long name, role and three stats in the full-width compact scroller at %ix%i', (width, height) => {
    const { scene, objects, maskRects } = makeScene();
    const skill = { ...skillBook.control_opportunist!, name: 'Control Opportunist of the Silver Moon' };
    renderCardDetailsDrawer(scene, skill, { compact: true, view: { x: 0, y: 0, width, height }, onClose: vi.fn() });
    const name = objects.find(obj => obj.text === skill.name);
    const type = objects.find(obj => obj.text === 'TYPE');
    const weight = objects.find(obj => obj.text === 'WEIGHT');
    const size = objects.find(obj => obj.text === 'SIZE');
    expect(objects.some(obj => obj.text === 'Offense')).toBe(true);
    expect(objects.some(obj => obj.text === 'POWER')).toBe(false);
    expect(name.y).toBe(0);
    expect(type.x).toBeLessThan(size.x);
    expect(type.y).toBe(weight.y);
    expect(size.y).toBe(type.y);
    expect(type.y).toBeGreaterThan(name.y + name.height);
    expect(maskRects[0]![1]).toBeGreaterThan(200);
    expect(maskRects[0]![2]).toBe(width - 40);
  });
  it('keeps the short embedded glossary mask fully above its actual footer', () => {
    const { scene, objects, maskRects } = makeScene();
    renderCardDetailsDrawer(scene, skillBook.control_opportunist!, {
      compact: true, view: { x: 0, y: 0, width: 372, height: 436 }, onClose: vi.fn(),
      primaryAction: { label: 'BUY', enabled: true, onPress: vi.fn() },
    });
    const [x, y, width, height] = maskRects[0]!;
    const caption = objects.findIndex(obj => obj.text === 'BUY');
    const button = objects[caption - 1];
    expect(x).toBe(20);
    expect(width).toBe(332);
    expect(height).toBeGreaterThanOrEqual(120);
    expect(y! + height!).toBeLessThan(button.y);
  });
  it.each([false, true])('renders the title and Bow identity with no duplicate effect paragraph (compact=%s)', compact => {
    const { scene, objects, click } = makeScene();
    const skill = skillBook.control_opportunist!;
    const onPress = vi.fn();
    renderCardDetailsDrawer(scene, skill, { compact, onClose: vi.fn(), primaryAction: { label: 'BUY · 3 GOLD', enabled: true, onPress } });
    const visibleText = () => objects.filter(obj => obj.active && obj.text !== undefined).map(obj => obj.text);
    expect(visibleText()).toContain('CARD DETAILS');
    expect(visibleText()).toContain('BOW');
    expect(visibleText()).not.toContain('What it does');
    expect(visibleText()).toContain('Deal 8 additional damage against stunned targets.');
    expect(visibleText().join(' ')).not.toMatch(/FULL CARD TEXT|WHAT IT DOES|POWER|RANK|\bX\b/);
    click('BUY · 3 GOLD');
    expect(onPress).toHaveBeenCalledOnce();
  });
  it('keeps disabled actions inactive and socketed gems attributed', () => {
    const { scene, objects, click } = makeScene();
    const onPress = vi.fn();
    const gem = Object.values(gemBook)[0]!;
    renderCardDetailsDrawer(scene, skillBook.sword_slash!, { compact: true, gem, onClose: vi.fn(), primaryAction: { label: 'BAG FULL', enabled: false, onPress } });
    const disabledCaption = objects.findIndex(obj => obj.text === 'BAG FULL');
    expect(objects[disabledCaption - 1].interactive).not.toBe(true);
    objects[disabledCaption - 1].emit('pointerdown', {}, 0, 0, { stopPropagation() {} });
    expect(onPress).not.toHaveBeenCalled();
    expect(objects.some(obj => obj.text?.includes(gem.name))).toBe(true);
    expect(objects.some(obj => obj.text === 'GEM EFFECT')).toBe(true);
  });
  it('tears down scroll listeners and mask resources when rebuilt', () => {
    const { scene, objects, destroyMask } = makeScene();
    renderCardDetailsDrawer(scene, skillBook.sword_slash!, { compact: true, onClose: vi.fn() });
    expect(scene.input.listenerCount('wheel')).toBe(1);
    for (const obj of [...objects]) obj.destroy();
    expect(scene.input.listenerCount('wheel')).toBe(0);
    expect(scene.input.listenerCount('pointerdown')).toBe(0);
    expect(destroyMask).toHaveBeenCalledOnce();
  });
  it.each([true, false])('scrolls long content while keeping close/action fixed and cancels outside releases (compact=%s)', compact => {
    const { scene, objects, maskRects, destroyMask } = makeScene();
    const close = vi.fn();
    renderCardDetailsDrawer(scene, skillBook.control_opportunist!, { compact,
      view: { x: 0, y: 0, width: compact ? 372 : 1120, height: compact ? 436 : 500 }, onClose: close,
      primaryAction: { label: 'BUY', enabled: true, onPress: vi.fn() },
    });
    const list = objects.find(obj => obj.list.length > 0);
    const originalY = list.y;
    const captionIndex = objects.findIndex(obj => obj.text === 'BUY');
    const button = objects[captionIndex - 1];
    const buttonY = button.y;
    const rect = maskRects[0]!;
    const pointer = { worldX: rect[0]! + 10, worldY: rect[1]! + 10, isDown: true };
    scene.input.emit('wheel', pointer, [], 0, 10000);
    expect(list.y).toBeLessThan(originalY);
    const bottomY = list.y;
    scene.input.emit('wheel', pointer, [], 0, 10000);
    expect(list.y).toBe(bottomY);
    scene.input.emit('pointerdown', pointer);
    scene.input.emit('pointerupoutside', pointer);
    scene.input.emit('pointermove', { ...pointer, worldY: pointer.worldY + 100 });
    expect(list.y).toBe(bottomY);
    expect(button.y).toBe(buttonY);
    expect(close).not.toHaveBeenCalled();
    for (const obj of [...objects]) obj.destroy();
    expect(scene.input.listenerCount('wheel')).toBe(0);
    expect(destroyMask).toHaveBeenCalledOnce();
  });
});
