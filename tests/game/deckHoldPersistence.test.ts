import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRun, saveRun, type StorageDriver } from '../../src/meta/runSave';
import { applyDraftResult, createRun, type RunState } from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';

/**
 * THE INVARIANT: A CARD THE PLAYER OWNS SURVIVES A RELOAD.
 *
 * TEMP HOLDING was a hole in it. Dropping a board card on the strip removed
 * the card from `RunState` (through the run setter, so straight to
 * localStorage) and put it in the deck-build scene's own `hold` field —
 * which is not run state and is never saved. The board removal persisted;
 * the card did not. Refresh the page and the card was gone, with no confirm
 * and no undo, off the ONE mechanic whose whole purpose is "hold this safely
 * while I rearrange". TRASH at least asks.
 *
 * The fix persists the strip as `RunState.held` (an OPTIONAL field — absent
 * means "nothing held", so no schema bump and every in-progress v1 save
 * still loads), and commits the removal + the held card in ONE write.
 *
 * These tests are positioned at the three places the card can be dropped:
 *   1. the pure save round-trip (`saveRun` -> `loadRun`) — serialize, reload,
 *      still owned;
 *   2. the `runStore` seam, driven through the SAME module-load hydration a
 *      real page refresh uses (`vi.resetModules()` + re-import);
 *   3. a SOURCE sweep over BOTH deck-build scenes — there is no canvas in
 *      this repo's `node` vitest env (same reasoning as
 *      `pointerConsumptionAudit.test.ts` / `runEventSeams.test.ts`), so the
 *      guard that neither scene goes back to a scene-local `hold` field, and
 *      that the two platforms stay identical, is held textually.
 */

const SCENES = ['MobileDeckBuildScene.ts', 'DesktopDeckBuildScene.ts'] as const;

function sceneSource(file: string): string {
  return readFileSync(join(process.cwd(), 'src/game/scenes', file), 'utf8');
}

function fakeStorage(): StorageDriver & { cells: Map<string, string> } {
  const cells = new Map<string, string>();
  return {
    cells,
    get: (key) => cells.get(key) ?? null,
    set: (key, value) => { cells.set(key, value); return true; },
  };
}

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
  return picks;
}

/** EVERY card instance the run owns, wherever it is sitting: the board, the
 * bag, or the holding strip. The holding strip is the third place — that is
 * the whole point. */
function ownedCardIds(run: RunState): string[] {
  return [
    ...run.pieces.map((p) => p.instanceId),
    ...run.bagSlots.flatMap((c) => (c ? [c.instanceId] : [])),
    ...(run.held ? [run.held.instanceId] : []),
  ];
}

// ---------------------------------------------------------------------------
// 1 — the pure round-trip: hold, serialize, deserialize, still owned.
// ---------------------------------------------------------------------------

describe('run save: a card on TEMP HOLDING survives serialization', () => {
  it('is still owned after saveRun -> loadRun', () => {
    // The strip is one of the three places a run card can be, so a fresh run
    // declares it. Without this field the card on the strip is not run state
    // at all, and nothing below can save it.
    expect('held' in createRun(1),
      'RunState has no `held` field — the holding strip is not run state').toBe(true);

    const drafted = applyDraftResult(createRun(7), draftPicksFor(7));
    const parked = drafted.pieces[0]!;
    const beforeIds = ownedCardIds(drafted);

    // What dropping board[0] on the strip does to run state: off the board,
    // onto `held` — one state, one write.
    const holding: RunState = {
      ...drafted,
      pieces: drafted.pieces.filter((p) => p.instanceId !== parked.instanceId),
      held: { instanceId: parked.instanceId, skillId: parked.skillId, tier: parked.tier },
    };

    const storage = fakeStorage();
    expect(saveRun(storage, holding).ok).toBe(true);
    const reloaded = loadRun(storage);

    expect(reloaded, 'the run itself did not come back').not.toBeNull();
    expect(reloaded!.held?.instanceId).toBe(parked.instanceId);
    expect(reloaded!.held?.skillId).toBe(parked.skillId);
    // THE INVARIANT: nothing the player owned went missing across the reload.
    expect(ownedCardIds(reloaded!).sort()).toEqual(beforeIds.sort());
  });

  it('a save written BEFORE this field existed still loads (no schema bump)', () => {
    // A v1 blob has no `held` key at all. Absent must mean "nothing held",
    // not "unreadable run" — the reason this is an optional field rather
    // than a SCHEMA_VERSION bump: bumping would have stranded every
    // in-progress run.
    const drafted = applyDraftResult(createRun(11), draftPicksFor(11));
    const legacy: Record<string, unknown> = { ...drafted };
    delete legacy.held;
    const storage = fakeStorage();
    saveRun(storage, legacy as unknown as RunState);

    const reloaded = loadRun(storage);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.held ?? null).toBeNull();
    expect(ownedCardIds(reloaded!)).toEqual(ownedCardIds(drafted));
  });
});

// ---------------------------------------------------------------------------
// 2 — the store seam, through a real page-refresh (module re-load).
// ---------------------------------------------------------------------------

describe('runStore: TEMP HOLDING survives a page reload', () => {
  let cells: Map<string, string>;

  beforeEach(() => {
    cells = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => cells.get(k) ?? null,
        setItem: (k: string, v: string) => void cells.set(k, v),
        removeItem: (k: string) => void cells.delete(k),
      },
    });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** A REFRESH: drop the module (and its in-memory `activeRun`) and import it
   * again against the SAME localStorage — exactly what the browser does, and
   * `runStore` hydrates `activeRun` from `loadRun` at import time. */
  async function reloadStore(): Promise<typeof import('../../src/game/runStore')> {
    vi.resetModules();
    return import('../../src/game/runStore');
  }

  it('the held card is still owned after the page reloads', async () => {
    const store = await import('../../src/game/runStore');
    const seed = 31;
    store.startRun(seed);
    store.applyRunDraft(draftPicksFor(seed));

    const before = store.getActiveRun()!;
    const beforeIds = ownedCardIds(before);
    expect(before.pieces.length).toBeGreaterThan(0);
    const parked = before.pieces[0]!;

    // The move the deck-build scenes make when a board card is dropped on
    // TEMP HOLDING: removal + held card, ONE write.
    store.commitRunDeckEdit({
      pieces: before.pieces.filter((p) => p.instanceId !== parked.instanceId),
      held: { instanceId: parked.instanceId, skillId: parked.skillId, tier: parked.tier },
    });

    const held = store.getActiveRun()!;
    expect(held.pieces.some((p) => p.instanceId === parked.instanceId)).toBe(false);
    expect(held.held?.instanceId).toBe(parked.instanceId);

    // ---- reload ----
    const reloaded = await reloadStore();
    const resumed = reloaded.getActiveRun();

    expect(resumed, 'no run resumed at all after the reload').not.toBeNull();
    expect(reloaded.currentRunHeld()?.instanceId,
      'the held card was destroyed by the reload').toBe(parked.instanceId);
    expect(ownedCardIds(resumed!).sort(),
      'a card the player owned did not survive the reload').toEqual(beforeIds.sort());
  });

  it('every persisted snapshot of the move owns the card SOMEWHERE', async () => {
    const store = await import('../../src/game/runStore');
    const seed = 31;
    store.startRun(seed);
    store.applyRunDraft(draftPicksFor(seed));
    const before = store.getActiveRun()!;
    const parked = before.pieces[0]!;

    // Watch what actually reaches storage: the board removal and the held
    // card must never be two separate writes, or the snapshot between them
    // owns the card in neither place — which is the bug's exact shape.
    const snapshots: RunState[] = [];
    const realSet = cells.set.bind(cells);
    cells.set = (k: string, v: string) => {
      const parsed: unknown = JSON.parse(v);
      if (parsed && typeof parsed === 'object' && 'run' in (parsed as object)) {
        snapshots.push((parsed as { run: RunState }).run);
      }
      return realSet(k, v);
    };

    store.commitRunDeckEdit({
      pieces: before.pieces.filter((p) => p.instanceId !== parked.instanceId),
      held: { instanceId: parked.instanceId, skillId: parked.skillId, tier: parked.tier },
    });

    expect(snapshots.length).toBeGreaterThan(0);
    for (const snap of snapshots) {
      expect(ownedCardIds(snap), 'a saved snapshot owned the card nowhere').toContain(parked.instanceId);
    }
  });

  it('taking the card back OFF the strip empties it, persistently', async () => {
    const store = await import('../../src/game/runStore');
    const seed = 31;
    store.startRun(seed);
    store.applyRunDraft(draftPicksFor(seed));
    const before = store.getActiveRun()!;
    const parked = before.pieces[0]!;
    store.commitRunDeckEdit({
      pieces: before.pieces.filter((p) => p.instanceId !== parked.instanceId),
      held: { instanceId: parked.instanceId, skillId: parked.skillId, tier: parked.tier },
    });

    // Back onto the board (what `toDeck` commits for a `hold` source).
    const nowPieces = store.getActiveRun()!.pieces;
    store.commitRunDeckEdit({ pieces: [...nowPieces, { ...parked }], held: null });

    const reloaded = await reloadStore();
    expect(reloaded.currentRunHeld()).toBeNull();
    expect(reloaded.getActiveRun()!.pieces.some((p) => p.instanceId === parked.instanceId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3 — SOURCE sweep: both scenes, no canvas needed.
// ---------------------------------------------------------------------------

describe('deck build scenes: the holding strip is not scene-local state', () => {
  for (const file of SCENES) {
    it(`${file} keeps the held card in run state, not in a scene field`, () => {
      const src = sceneSource(file);
      // The pre-fix declaration. A scene field is where the card went to die.
      expect(src, 'the held card is back in a scene-local field')
        .not.toMatch(/private hold: OwnedCard \| null = null;/);
      expect(src).toContain('currentRunHeld');
      expect(src).toContain('setCurrentRunHeld');
      expect(src).toContain('commitRunDeckEdit');
    });

    it(`${file} commits the hold move in one write`, () => {
      const src = sceneSource(file);
      const toHold = src.slice(src.indexOf('private toHold(src: Source)'));
      const body = toHold.slice(0, toHold.indexOf('\n  }'));
      // The bug: remove the card from the board, then stash it somewhere the
      // save does not know about.
      expect(body).toContain('this.commitTransfer(');
      expect(body).not.toContain('this.removeSource(');
    });
  }

  it('both platforms carry the SAME move-commit code', () => {
    // A one-sided fix is a failed fix: the bug was identical in both scenes.
    const block = (file: string): string => {
      const src = sceneSource(file);
      const start = src.indexOf('  /** The deck + bag arrays with `src` taken OUT');
      const end = src.indexOf('  // ---------- render ----------');
      expect(start, `${file}: move-commit block not found`).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return src.slice(start, end);
    };
    expect(block('MobileDeckBuildScene.ts')).toBe(block('DesktopDeckBuildScene.ts'));
  });
});
