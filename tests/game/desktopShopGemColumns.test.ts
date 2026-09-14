import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
const gems = vi.hoisted(() => [] as any[]);
vi.mock('phaser', () => ({ default: { Events: { EventEmitter }, Scene: class {}, GameObjects: { Container: class {} }, Geom: { Rectangle: class { constructor(public x: number, public y: number, public width: number, public height: number) {} } }, Math: { Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)) } } }));
vi.mock('../../src/game/audio/sfxSynth', () => ({ playSfx: vi.fn() }));
vi.mock('../../src/game/ui/runArt', () => ({ addBrightRunArt: vi.fn(), addRunArt: vi.fn(), RUN_ART_KEYS: {}, shopArtKey: vi.fn() }));
vi.mock('../../src/game/ui/GemToken', () => ({ GemToken: class { constructor(_scene: unknown, public x: number, public y: number, public gem: any, public size: any) { gems.push(this); } } }));
import { DesktopShopScene } from '../../src/game/scenes/DesktopShopScene';
import { gemBook } from '../../src/data/gems';

describe('desktop Shop gem shelf columns', () => {
  it.each([[1350, 600], [1350, 1000], [700, 600]])('aligns name/effect beside centered art and reserves price at %s × %s', (shelfRight, height) => {
    gems.length = 0; const objects: any[] = [];
    const make = (props: any = {}) => {
      const obj: any = new EventEmitter(); Object.assign(obj, { x: 0, y: 0, width: 0, height: 0, list: [], ...props });
      for (const key of ['setOrigin', 'setStrokeStyle', 'setInteractive', 'setMask', 'fillStyle', 'fillRect', 'setVisible']) obj[key] = () => obj;
      obj.setY = (y: number) => { obj.y = y; return obj; };
      obj.setText = (text: string) => { obj.text = text; return obj; };
      obj.add = (list: any[]) => { obj.list.push(...list); return obj; };
      obj.createGeometryMask = () => ({}); objects.push(obj); return obj;
    };
    const scene: any = new DesktopShopScene();
    scene.embedded = { bounds: { width: 1400, height } };
    scene.runShopId = () => 'wildworks'; scene.activeGold = () => 100;
    const gem = Object.values(gemBook).find(g => g.name === 'Time Core')!;
    scene.shelfFor = () => ({ cards: [], gems: [{ gemId: gem.id, price: 12 }], rerollCount: 0 });
    scene.ownedColumnX = () => ({ shelfRight }); scene.renderShelfScrollAffordance = vi.fn();
    scene.add = { rectangle: (x: number, y: number, width: number, height: number) => make({ x, y, width, height }),
      container: (x: number, y: number) => make({ x, y }),
      text: (x: number, y: number, text: string, style: any) => make({ x, y, text, style, width: text.length * 7, height: 18 }) };
    scene.make = { graphics: () => make() };
    scene.renderShelf('wildworks');
    const art = gems[0], row = scene.draggables.find((item: any) => item.src.kind === 'shelfGem').bounds;
    const name = objects.find(obj => obj.text === 'Time Core');
    const body = objects.find(obj => obj.text?.startsWith('Passive (this card):'));
    const price = objects.find(obj => obj.text === '12 GOLD');
    expect(body.text).toBe('Passive (this card): -1 weight.');
    expect(name.x).toBe(body.x);
    expect(body.x).toBeGreaterThan(art.x + art.size.width / 2);
    expect(art.y).toBe(row.y + row.height / 2);
    expect(body.x + body.style.wordWrap.width).toBeLessThanOrEqual(price.x - price.width - 8);
    expect(body.y).toBeGreaterThanOrEqual(name.y + name.height);
    expect(price.y).toBeGreaterThanOrEqual(row.y);
    expect(price.y + price.height).toBeLessThanOrEqual(row.y + row.height);
  });
});
