export type ShopShelfGesture = 'pending' | 'scroll' | 'drag';

/**
 * Resolves the intent of a gesture that starts on a shelf card. We wait for a
 * small dead zone so a tap can still open Card Details. Once crossed, a
 * mostly-vertical gesture belongs to the shelf; a lateral gesture remains the
 * deliberate drag-to-buy interaction.
 */
export function classifyShopShelfGesture(
  deltaX: number,
  deltaY: number,
  threshold = 8,
): ShopShelfGesture {
  if (Math.hypot(deltaX, deltaY) < threshold) return 'pending';
  return Math.abs(deltaY) > Math.abs(deltaX) ? 'scroll' : 'drag';
}
