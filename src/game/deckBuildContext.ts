/**
 * Deck Build context — the "source discriminator" the Deck Build scenes read
 * instead of hardcoding `demoState` (same idiom as `battleContext.ts`).
 * `'demo'` (default) is the Sandbox path (unchanged, reads/writes
 * `demoState`); `'run'` is Run Mode, where the scene reads/writes the active
 * run's `pieces`/`bagSlots`/`gemInventory` via `runStore` instead. Set
 * explicitly by whichever screen launches Deck Build — the Run Map/Run Prep
 * headers' DECK / BAG button sets `'run'`; every Sandbox nav entry point
 * (DesktopNav's DECK BUILD tab, each mobile scene's own DECK tab) sets
 * `'demo'` — so a stale value from an earlier visit never leaks into the
 * wrong flow.
 */
export type DeckBuildContextSource = 'demo' | 'run';

let source: DeckBuildContextSource = 'demo';

export function setDeckBuildContext(next: DeckBuildContextSource): void {
  source = next;
}

export function getDeckBuildContext(): DeckBuildContextSource {
  return source;
}
