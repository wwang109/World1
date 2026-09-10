export interface ScrollableCardContainer {
  list: unknown[];
  setY(y: number): unknown;
}

/**
 * Makes the container's own setY the synchronization seam. Every current or
 * future shop scroll call therefore realigns masks even if it calls setY
 * directly instead of going through a scene wrapper.
 */
export function bindShopShelfMaskSync<T extends ScrollableCardContainer>(container: T): T {
  const setY = container.setY.bind(container);
  container.setY = ((y: number) => {
    const result = setY(y);
    container.list.forEach((child) => {
      if (typeof child === 'object' && child !== null && 'syncWorldArtMask' in child) {
        const sync = (child as { syncWorldArtMask?: unknown }).syncWorldArtMask;
        if (typeof sync === 'function') sync.call(child);
      }
    });
    return result;
  }) as T['setY'];
  return container;
}

/** Move a shop shelf and immediately realign every parented CardToken mask. */
export function setShopShelfScrollPosition(container: ScrollableCardContainer | null, y: number): void {
  if (!container) return;
  container.setY(y);
}
