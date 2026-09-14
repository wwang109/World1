import { describe, expect, it, vi } from 'vitest';
import { gemBook } from '../../src/data/gems';
vi.mock('phaser', () => ({ default: { GameObjects: { Container: class {
  list: unknown[] = [];
  add(child: unknown) { this.list.push(child); return this; }
  setSize() { return this; }
} } } }));
import { GemToken } from '../../src/game/ui/GemToken';
it('uses real rarity artwork with contain sizing inside a movable container', () => {
  const art: any = { width: 100, height: 200, setDisplaySize: vi.fn().mockReturnThis() };
  const scene: any = { add: { existing: vi.fn(), image: vi.fn(() => art) } };
  const token = new GemToken(scene, 20, 30, gemBook.swift_charm!, { width: 48, height: 48 });
  expect(scene.add.image).toHaveBeenCalledWith(0, 0, 'gem-rarity-common');
  expect(art.setDisplaySize).toHaveBeenCalledWith(24, 48);
  expect((token as any).list).toEqual([art]);
});
