import Phaser from 'phaser';

export function roundRect<T extends Phaser.GameObjects.Rectangle>(rectangle: T, radius = 12): T {
  const r = Math.max(0, Math.min(radius, rectangle.width / 2, rectangle.height / 2));
  rectangle.setRounded(r);
  if (r === 0) return rectangle;

  const path: number[] = [];
  const segments = Math.max(8, Math.ceil(r / 2));
  const corners = [
    [r, r, Math.PI],
    [rectangle.width - r, r, Math.PI * 1.5],
    [rectangle.width - r, rectangle.height - r, 0],
    [r, rectangle.height - r, Math.PI * 0.5],
  ] as const;
  for (const [cx, cy, start] of corners) {
    for (let step = 0; step <= segments; step += 1) {
      const angle = start + step * Math.PI / (2 * segments);
      path.push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    }
  }
  path.push(path[0]!, path[1]!);
  rectangle.pathData.splice(0, rectangle.pathData.length, ...path);
  const indexes = Phaser.Geom.Polygon.Earcut(path);
  rectangle.pathIndexes.splice(0, rectangle.pathIndexes.length, ...indexes);
  return rectangle;
}
