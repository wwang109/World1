import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventCatalog } from '../../src/data/events';
import { DRAFT_SET_KEYS, rollStartDraft, type DraftSetKey } from '../../src/run/draft';
import type { RunNode } from '../../src/run/runState';

/**
 * THE INVARIANT: AN EVENT NODE OFFERS ITS RUNGS EXACTLY ONCE.
 *
 * `RunState.eventInstances` recorded which event a node DREW and nothing
 * recorded which CHOICE was taken. The event screen's HUD has a DECK/BAG
 * button, and that button is a `scene.start` — so `init()` reset the scene's
 * `phase` to `'choosing'` on the way back and the same rung resolved again.
 * Probed live at seed 16 on `the_lapidary/reject_bin` (`grantGold: 1`):
 *
 *     gold 1 -> 2 -> 3      eventsResolved 2
 *
 * A free-gold loop at wave 1, repeatable as often as the player likes; a PAID
 * rung is the same bug facing the other way — billed twice for one reward.
 *
 * The fix is `RunState.eventResolutions` (an OPTIONAL field, exactly like
 * `held` — absent means "nothing resolved yet", so no `runSave.ts` schema bump
 * and every in-progress v1 run still loads). These tests are positioned at the
 * three places the second resolve could get through:
 *   1. the STORE, driven exactly as the scene drives it — resolve, leave for
 *      DECK/BAG, come back (this is the test that fails on the pre-fix code);
 *   2. the same thing across a real page reload (`vi.resetModules()` +
 *      re-import, the idiom `deckHoldPersistence.test.ts` established);
 *   3. a SOURCE sweep over BOTH event scenes — there is no canvas in this
 *      repo's `node` vitest env (same reasoning as `runEventSeams.test.ts`), so
 *      "the scene asks the run before it offers a rung" is held textually, on
 *      both platforms.
 *
 * Plus the hole the fix must not open: a DEFERRED rung (a picker) taken and
 * then left mid-pick is paid for and undelivered, so coming back must re-open
 * THAT picker free of charge rather than send the player away with nothing.
 */

/** The auditor's own door: free, and it moves gold, so a second resolve is
 * visible as a number rather than as a flag. `resolveEventChoice` takes the
 * event id as an argument, so WHICH event the node drew is irrelevant — the
 * same pinning `runEventSeams.test.ts` / `cardMerge.test.ts` use. */
const GOLD_DOOR = { eventId: 'the_lapidary', choiceId: 'reject_bin' } as const;
/** A FREE deferred rung — the picker case: paid for, not yet delivered. */
const PICKER_DOOR = { eventId: 'recruiter', choiceId: 'pick_sword' } as const;

const GOLD_DOOR_AMOUNT = (() => {
  const outcome = eventCatalog[GOLD_DOOR.eventId]!.choices.find((c) => c.id === GOLD_DOOR.choiceId)!.outcome;
  if (outcome.kind !== 'grantGold') throw new Error('the pinned gold door is no longer a grantGold choice');
  return outcome.amount;
})();

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
  return picks;
}

type Store = typeof import('../../src/game/runStore');

/** Walks the STORE (never a hand-built `RunState`) onto a real wave-1 event
 * node: start → draft → commit to the node → draw its event, which is exactly
 * what `create()` does first on both event scenes. */
function storeOnEventNode(store: Store): RunNode {
  for (let seed = 1; seed <= 60; seed += 1) {
    store.startRun(seed);
    store.applyRunDraft(draftPicksFor(seed));
    const node = store.choices().find((n) => n.kind === 'event');
    if (!node) continue;
    store.pickNode(node.id);
    store.currentEventDef();
    return node;
  }
  throw new Error('no seed in 1..60 offered a wave-1 event node');
}

/** DECK/BAG AND BACK. The HUD's secondary button is `scene.start('…DeckBuild')`
 * and the way back is another `scene.start` onto this screen — the run state is
 * untouched by the trip, and the scene's `create()` re-draws the event. This
 * helper is that round trip: everything the scene re-derives on arrival. */
function reenterEventScreen(store: Store): void {
  store.currentEventDef();
}

describe('runStore: an event node resolves its rungs exactly once', () => {
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
   * again against the SAME localStorage — what the browser does, and what
   * `runStore` hydrates from at import time. */
  async function reloadStore(): Promise<Store> {
    vi.resetModules();
    return import('../../src/game/runStore');
  }

  it('THE EXPLOIT: resolve → DECK/BAG → back does not pay out a second time', async () => {
    const store = await import('../../src/game/runStore');
    storeOnEventNode(store);

    const goldBefore = store.getActiveRun()!.gold;
    const resolvedBefore = store.getActiveRun()!.stats.eventsResolved;

    const first = store.resolveCurrentEventChoice(GOLD_DOOR.eventId, GOLD_DOOR.choiceId);
    expect(first?.kind).toBe('grantGold');
    expect(store.getActiveRun()!.gold).toBe(goldBefore + GOLD_DOOR_AMOUNT);
    expect(store.getActiveRun()!.stats.eventsResolved).toBe(resolvedBefore + 1);

    // ---- DECK / BAG, then back ----
    reenterEventScreen(store);

    const second = store.resolveCurrentEventChoice(GOLD_DOOR.eventId, GOLD_DOOR.choiceId);
    // THE LINE THE BUG FAILS ON: pre-fix this is `goldBefore + 2`.
    expect(store.getActiveRun()!.gold,
      'gold moved on the second visit — the free-gold loop is still open').toBe(goldBefore + GOLD_DOOR_AMOUNT);
    expect(store.getActiveRun()!.stats.eventsResolved,
      'the same node counted as two resolved events').toBe(resolvedBefore + 1);
    expect(second, 'the same rung resolved a SECOND time').toBeUndefined();
    // ...and the run — not the scene — is what remembers, which is what makes
    // it survive a reload too.
    expect(store.currentEventResolution()?.choiceId,
      'the run did not record WHICH choice was taken').toBe(GOLD_DOOR.choiceId);

    // ...and it stays shut however many times the player walks back in.
    for (let i = 0; i < 4; i += 1) {
      reenterEventScreen(store);
      expect(store.resolveCurrentEventChoice(GOLD_DOOR.eventId, GOLD_DOOR.choiceId)).toBeUndefined();
    }
    expect(store.getActiveRun()!.gold).toBe(goldBefore + GOLD_DOOR_AMOUNT);
  });

  it('a RELOAD does not re-open a resolved event either', async () => {
    const store = await import('../../src/game/runStore');
    const node = storeOnEventNode(store);
    const goldBefore = store.getActiveRun()!.gold;
    store.resolveCurrentEventChoice(GOLD_DOOR.eventId, GOLD_DOOR.choiceId);
    const goldAfter = store.getActiveRun()!.gold;
    expect(goldAfter).toBe(goldBefore + GOLD_DOOR_AMOUNT);

    // ---- refresh ----
    const reloaded = await reloadStore();
    expect(reloaded.getActiveRun(), 'no run resumed at all after the reload').not.toBeNull();
    expect(reloaded.getActiveRun()!.currentNodeId, 'the run resumed off the event node').toBe(node.id);
    reenterEventScreen(reloaded);

    expect(reloaded.currentEventResolution()?.choiceId,
      'the resolution did not survive the save round-trip').toBe(GOLD_DOOR.choiceId);
    expect(reloaded.resolveCurrentEventChoice(GOLD_DOOR.eventId, GOLD_DOOR.choiceId),
      'a page refresh re-opened a resolved event').toBeUndefined();
    expect(reloaded.getActiveRun()!.gold).toBe(goldAfter);
  });

  it('the run layer itself refuses a second resolve — the guard is not only in the store', async () => {
    const store = await import('../../src/game/runStore');
    storeOnEventNode(store);
    const { resolveEventChoice } = await import('../../src/run/events');

    const state = store.getActiveRun()!;
    const once = resolveEventChoice(state, GOLD_DOOR.eventId, GOLD_DOOR.choiceId);
    expect(() => resolveEventChoice(once.state, GOLD_DOOR.eventId, GOLD_DOOR.choiceId))
      .toThrow(/already resolved/);
    // A DIFFERENT rung on the same node is refused too — one node, one choice.
    expect(() => resolveEventChoice(once.state, GOLD_DOOR.eventId, 'warding_cut'))
      .toThrow(/already resolved/);
  });

  it('a DEFERRED rung left mid-pick re-opens its picker — free, and only until it is answered', async () => {
    const store = await import('../../src/game/runStore');
    storeOnEventNode(store);

    const goldBefore = store.getActiveRun()!.gold;
    const offer = store.resolveCurrentEventChoice(PICKER_DOOR.eventId, PICKER_DOOR.choiceId);
    expect(offer?.kind, 'the pinned picker door no longer offers a bonusDraft').toBe('bonusDraft');
    const offered = offer!.kind === 'bonusDraft' ? offer.cards.map((c) => c.skillId) : [];
    const resolvedCount = store.getActiveRun()!.stats.eventsResolved;
    expect(store.currentEventResolution()).toEqual({ ...PICKER_DOOR, pending: true });

    // ---- DECK / BAG mid-pick, then back ----
    reenterEventScreen(store);
    // The rungs stay shut...
    expect(store.resolveCurrentEventChoice(PICKER_DOOR.eventId, PICKER_DOOR.choiceId)).toBeUndefined();
    // ...but the question the player already paid for is asked again, unchanged.
    const reopened = store.reopenCurrentEventPick();
    expect(reopened?.kind, 'the paid-for picker vanished on the way back').toBe('bonusDraft');
    expect(reopened!.kind === 'bonusDraft' ? reopened.cards.map((c) => c.skillId) : [])
      .toEqual(offered);
    expect(store.getActiveRun()!.gold, 're-opening a picker charged the player again').toBe(goldBefore);
    expect(store.getActiveRun()!.stats.eventsResolved,
      're-opening a picker counted the event a second time').toBe(resolvedCount);

    // Answering it closes it for good — a picker must not hand out seconds.
    const picked = offer!.kind === 'bonusDraft' ? offer.cards[0]! : null;
    store.applyCurrentBonusDraftPick(picked!);
    expect(store.currentEventResolution()).toEqual({ ...PICKER_DOOR });
    reenterEventScreen(store);
    expect(store.reopenCurrentEventPick(),
      'the picker re-opened after it had already been answered').toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SOURCE SWEEP — the scene half, both platforms (no canvas in this env).
// ---------------------------------------------------------------------------

const SCENES = ['MobileRunEventScene.ts', 'DesktopRunEventScene.ts'] as const;
const sceneSource = (file: string): string =>
  readFileSync(join(process.cwd(), 'src/game/scenes', file), 'utf8');

describe('event scenes: the screen asks the RUN before it offers a rung', () => {
  for (const scene of SCENES) {
    it(`${scene} adopts the recorded resolution on every entry`, () => {
      const src = sceneSource(scene);
      expect(src, 'the scene never asks whether this node already resolved')
        .toContain('currentEventResolution()');
      // `init()` rebuilds `phase` from nothing on every scene.start — the
      // adoption has to run in `create()`, which runs again after it.
      expect(src, 'the resolution is read but never consulted in create()')
        .toMatch(/if \(this\.phase === 'choosing'\) this\.adoptRecordedResolution\(\);/);
      expect(src, "the scene has no 'resolved' phase to show a done node in")
        .toMatch(/'choosing' \| 'resolved'/);
      // A resolved node's rungs are drawn LOCKED, never selectable.
      expect(src, 'a resolved rung is still enabled').toMatch(/enabled: !done && affordable/);
      // ...and the only thing left to do is leave.
      expect(src, "the 'resolved' phase has no way forward")
        .toMatch(/this\.phase === 'resolved'\n?\s*\?\s*\{ label: 'CONTINUE ›'/);
    });

    it(`${scene} re-opens a paid-for picker instead of dropping it`, () => {
      expect(sceneSource(scene), 'a deferred pick left mid-flight is lost on return')
        .toContain('reopenCurrentEventPick()');
    });
  }
});
