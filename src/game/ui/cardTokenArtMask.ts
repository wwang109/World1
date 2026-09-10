export interface CardArtMaskRect { x: number; y: number; width: number; height: number }

/** Geometry mask rectangle from the token's current world-space center. */
export function cardArtMaskRectAtWorldCenter(
  worldX: number,
  worldY: number,
  width: number,
  height: number,
): CardArtMaskRect {
  return { x: worldX - width / 2, y: worldY - height / 2, width, height };
}

export function syncCardArtMask(
  mask: { clear(): unknown; fillStyle(color: number): unknown; fillRect(x: number, y: number, width: number, height: number): unknown },
  worldTransform: { transformPoint(x: number, y: number): { x: number; y: number } },
  width: number,
  height: number,
): void {
  const world = worldTransform.transformPoint(0, 0);
  const rect = cardArtMaskRectAtWorldCenter(world.x, world.y, width, height);
  mask.clear();
  mask.fillStyle(0xffffff);
  mask.fillRect(rect.x, rect.y, rect.width, rect.height);
}
