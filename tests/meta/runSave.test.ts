import { describe, expect, it } from 'vitest';
import {
  clearRun,
  loadRun,
  RUN_SAVE_BACKUP_KEY,
  RUN_SAVE_STORAGE_KEY,
  RUN_SAVE_V1_STORAGE_KEY,
  saveRun,
  SCHEMA_VERSION,
  type RunStateV1,
  type StorageDriver,
} from '../../src/meta/runSave';
import {
  applyDraftResult,
  availableChoices,
  chooseNode,
  createRun,
  ensureRunShopShelf,
  leaveEvent,
  leaveShop,
  recordBattleResult,
  rerollRunShop,
  type RunNode,
  type RunState,
} from '../../src/run/runState';
import {
  applyGemChoicePick,
  eventResolutionAt,
  reopenEventChoice,
  resolveEventChoice,
  rollEventForNode,
} from '../../src/run/events';
import { gemBook } from '../../src/data/gems';
import { eventCatalogFromJson } from '../../src/data/eventsContent';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import { fakeQuotaExceededStorage, fakeStorage } from '../fixtures/storage';

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) {
    picks[key] = draft[key][0]!.skillId;
  }
  return picks;
}

function startedRun(seed: number): RunState {
  return applyDraftResult(createRun(seed), draftPicksFor(seed));
}

/** Builds a real, mid-run `RunState` — drafted, has walked into a shop node,
 * rolled its shelf, and rerolled it once (so `rerollCount` is nonzero — the
 * escalating-price field the run-save feature spec calls out by name).
 * Falls back to just walking further node choices if the first available
 * column has no shop (deterministic per seed, but shop placement is
 * map-dependent). */
function midRunState(seed: number): RunState {
  let state = applyDraftResult(createRun(seed), draftPicksFor(seed));
  // Walk up to a few nodes deep looking for a shop node to exercise the
  // shelf/reroll fields; if none appears, the state is still a perfectly
  // valid "mid run" fixture (fight/event nodes round-trip identically).
  for (let i = 0; i < 6; i++) {
    const choices = availableChoices(state);
    const shop = choices.find((n) => n.kind === 'shop');
    const pick = shop ?? choices[0];
    if (!pick) break;
    state = chooseNode(state, pick.id);
    if (pick.kind === 'shop') {
      state = ensureRunShopShelf(state, pick.id);
      state = rerollRunShop(state, pick.id);
      break;
    }
    // Not a combat/shop node this iteration resolved into "current" — bail to
    // keep the fixture simple; the node stays occupied (currentNodeId set),
    // which is itself a legitimate mid-run snapshot to round-trip.
    break;
  }
  return state;
}

/** Walk a fresh run to its first reachable EVENT node (fights won, shops
 * left), returning the state with that node committed/current — same helper
 * idiom as `tests/run/events.test.ts#stateAtFirstEvent`, duplicated here per
 * this suite's convention (each test file carries its own tiny fixtures). */
function stateAtFirstEventNode(seed: number): { state: RunState; node: RunNode } {
  let state = applyDraftResult(createRun(seed), draftPicksFor(seed));
  for (let guard = 0; guard < 200; guard++) {
    const choices = availableChoices(state);
    if (choices.length === 0) throw new Error('no event node reachable for this seed');
    const eventChoice = choices.find((n) => n.kind === 'event');
    if (eventChoice) {
      state = chooseNode(state, eventChoice.id);
      return { state, node: eventChoice };
    }
    const node = choices[0]!;
    state = chooseNode(state, node.id);
    if (node.kind === 'shop') state = leaveShop(state);
    else state = recordBattleResult(state, { won: true, goldEarned: 1 });
  }
  throw new Error('guard exceeded while looking for an event node');
}

// ---------------------------------------------------------------------------
// EVENT GEM GRANTS SURVIVE THE SAVE (2026-09-02 playtest investigation).
//
// A live run reported gems picked at event nodes "gone" later — deck header
// GEMS 0, no gem visible anywhere — on a run that was reloaded ~10 times. The
// suspicion was a persistence hole: a field the grants write that the save
// shape drops. This suite PINS the truth the other way: the whole real chain
// — `resolveEventChoice` on the node's own drawn event, the paid-but-
// unanswered `pending` window, `reopenEventChoice` after a reload,
// `applyGemChoicePick`, `leaveEvent` — round-trips through the REAL
// `saveRun`/`loadRun` at every step, and the gem is still in
// `RunState.gemInventory` (the pouch the Deck/Bag socket panel lists) at the
// end. The "GEMS 0" the playtest saw is the deck header counting SOCKETED
// gems (`pieces[].gem`) — a different field than grants write — which the
// last assertion documents from the pure side: the grant socketed nothing.
// ---------------------------------------------------------------------------

describe('meta/runSave: an event-granted gem survives reload at every step of the real chain', () => {
  /** Save + load through the real runSave layer, asserting the round-trip is
   * byte-exact — one forced "page reload" of the playtest's ~10. */
  function reload(storage: StorageDriver, state: RunState): RunState {
    expect(saveRun(storage, state)).toEqual({ ok: true });
    const loaded = loadRun(storage);
    expect(loaded).toEqual(state);
    return loaded!;
  }

  // Seed 13: the first reachable event node draws an event whose choices
  // include a usable `gemChoice` rung (`fences_offer`'s "take the stone") —
  // the catalog's real gem source (it has no immediate `grantGem` choice any
  // more, so every playtest gem went through this deferred picker). If the
  // catalog/map ever changes this seed's draw, the loud expects below fail
  // rather than silently passing a fixture that stopped exercising gems.
  const SEED = 13;

  it('grant -> reload mid-pending -> reopen -> pick -> reload -> leave -> reload keeps the gem in gemInventory', () => {
    const storage = fakeStorage();
    const at = stateAtFirstEventNode(SEED);
    const { node } = at;

    // The node's OWN drawn event (idempotent memo), reloaded before choosing.
    const drawn = rollEventForNode(at.state, node);
    if (!('choices' in drawn.event)) throw new Error('seed contract must draw legacy gem event');
    let state = reload(storage, drawn.state);
    const rung = drawn.event.choices.find((c) => c.outcome.kind === 'gemChoice');
    expect(rung).toBeDefined(); // seed contract — see SEED above

    // Take the rung for real: cost deducted, resolution recorded PENDING.
    const resolved = resolveEventChoice(state, drawn.event.id, rung!.id);
    expect(resolved.outcome.kind).toBe('gemChoicePick');
    const offeredBefore = resolved.outcome.kind === 'gemChoicePick' ? resolved.outcome.options : [];
    expect(offeredBefore.length).toBeGreaterThan(0);

    // RELOAD inside the paid-but-unanswered window (the playtest's habit).
    state = reload(storage, resolved.state);
    expect(eventResolutionAt(state, node.id)?.pending).toBe(true);

    // The reopened picker offers the IDENTICAL gems (same seeded stream).
    const reopened = reopenEventChoice(state);
    expect(reopened).toBeDefined();
    expect(reopened!.outcome.kind).toBe('gemChoicePick');
    const options = reopened!.outcome.kind === 'gemChoicePick' ? reopened!.outcome.options : [];
    expect(options).toEqual(offeredBefore);

    // Pick one — the finalizer pushes it into the pouch and clears `pending`.
    const gemId = options[0]!;
    expect(gemBook[gemId]).toBeDefined();
    const picked = applyGemChoicePick(reopened!.state, gemId);
    expect(picked.outcome).toEqual({ kind: 'grantGem', gemId });
    expect(picked.state.gemInventory).toEqual([gemId]);

    // RELOAD again: the pouch — the field the Deck/Bag socket panel reads via
    // `currentRunGemInventory()` — still holds the gem, and the pick cannot be
    // re-opened for a second copy.
    state = reload(storage, picked.state);
    expect(state.gemInventory).toEqual([gemId]);
    expect(eventResolutionAt(state, node.id)?.pending).toBeUndefined();
    expect(reopenEventChoice(state)).toBeUndefined();

    // Leave the node and reload once more — still there.
    state = reload(storage, leaveEvent(state));
    expect(state.gemInventory).toEqual([gemId]);

    // THE "GEMS 0" MECHANISM, pinned from the pure side: the grant lands in
    // the POUCH and sockets nothing, so a header that counts `pieces[].gem`
    // (the deck screens' GEMS segment) reads 0 while the run truly owns the
    // gem. The counter reads a DIFFERENT field than grants write — a UI gap,
    // not a persistence hole.
    expect(state.pieces.every((p) => !p.gem)).toBe(true);
  });

  it('an old-shape v1 blob (no optional fields) still loads, and the gem chain works on top of it', () => {
    // Simulate a save written by an OLDER v1 build: every OPTIONAL RunState
    // field stripped (held/draft/eventThemeBags/eventThemeBagRefills/
    // eventResolutions — absent meant exactly "empty" when they shipped, and
    // must forever). `gemInventory` itself is NOT optional and predates the
    // save layer, so every real v1 blob carries it.
    const at = stateAtFirstEventNode(SEED);
    const drawn = rollEventForNode(at.state, at.node);
    if (!('choices' in drawn.event)) throw new Error('seed contract must draw legacy gem event');
    const {
      held: _held,
      draft: _draft,
      eventThemeBags: _bags,
      eventThemeBagRefills: _refills,
      eventResolutions: _resolutions,
      ...oldShape
    } = drawn.state;

    const storage = fakeStorage({
      [RUN_SAVE_STORAGE_KEY]: JSON.stringify({ schemaVersion: SCHEMA_VERSION, run: oldShape }),
    });
    const loaded = loadRun(storage);
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(oldShape);

    // The gem chain still works on the loaded old-shape state: resolve the
    // drawn event's gem rung, answer the picker, and the pouch has the gem.
    const rung = drawn.event.choices.find((c) => c.outcome.kind === 'gemChoice');
    expect(rung).toBeDefined();
    const resolved = resolveEventChoice(loaded!, drawn.event.id, rung!.id);
    expect(resolved.outcome.kind).toBe('gemChoicePick');
    const options = resolved.outcome.kind === 'gemChoicePick' ? resolved.outcome.options : [];
    const picked = applyGemChoicePick(resolved.state, options[0]!);
    expect(picked.state.gemInventory).toEqual([options[0]!]);

    // And the whole thing round-trips forward at the CURRENT shape.
    expect(saveRun(storage, picked.state)).toEqual({ ok: true });
    expect(loadRun(storage)).toEqual(picked.state);
  });
});

describe('meta/runSave: load with nothing stored', () => {
  it('returns null', () => {
    expect(loadRun(fakeStorage())).toBeNull();
  });
});

describe('meta/runSave: save/load round-trip', () => {
  it('loads a pre-migration schema-v1 event ledger whose event and choice IDs resolve in the JSON catalog', () => {
    const {
      eventCallbackQueue: _callbacks,
      completedStoryIds: _completedStories,
      eventCallbackResolutionIds: _callbackResolutions,
      mapIntelByBand: _mapIntel,
      appliedMapInfoSourceIds: _mapInfoSources,
      combatFactLedger: _combatFacts,
      revengeFactLedger: _revengeFacts,
      signatureFactLedger: _signatureFacts,
      journeyFactLedger: _journeyFacts,
      eventBindingReservations: _reservations,
      eventMaterializations: _materializations,
      storyStateV3: _storyState,
      ...v1Base
    } = createRun(42);
    const historicalRun: RunStateV1 = {
      ...v1Base,
      eventInstances: { 'node-1': 'wandering_tutor', 'node-2': 'fences_offer' },
      eventResolutions: {
        'node-1': { eventId: 'wandering_tutor', choiceId: 'pay' },
        'node-2': { eventId: 'fences_offer', choiceId: 'take_stone', pending: true },
      },
    };
    const preMigrationSave = JSON.stringify({ schemaVersion: 1, run: historicalRun });
    const storage = fakeStorage({ [RUN_SAVE_V1_STORAGE_KEY]: preMigrationSave });
    const loaded = loadRun(storage)!;

    expect(SCHEMA_VERSION).toBe(3);
    expect(loaded.eventInstances).toMatchObject({
      'node-1': { eventId: 'wandering_tutor', contentVersion: 1, instanceId: 'legacy:node-1' },
      'node-2': { eventId: 'fences_offer', contentVersion: 1, instanceId: 'legacy:node-2' },
    });

    for (const resolution of Object.values(loaded.eventResolutions ?? {})) {
      const event = eventCatalogFromJson[resolution.eventId];
      expect(event, resolution.eventId).toBeDefined();
      expect(event!.choices.some((choice) => choice.id === resolution.choiceId), `${resolution.eventId}/${resolution.choiceId}`).toBe(true);
    }
  });

  it('round-trips a real mid-run state byte-exactly', () => {
    const storage = fakeStorage();
    const run = midRunState(12345);
    const outcome = saveRun(storage, run);
    expect(outcome).toEqual({ ok: true });
    const loaded = loadRun(storage);
    expect(loaded).toEqual(run);
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).not.toBeNull();
  });

  it('round-trips the shop shelf/reroll-count fields specifically — the escalating price must survive', () => {
    const storage = fakeStorage();
    const run = midRunState(777);
    const shopNodeId = Object.keys(run.shopShelves)[0];
    // This seed's walk should have found and rerolled a shop; if map layout
    // ever changes such that it doesn't, fail loudly rather than silently
    // passing a fixture that isn't exercising the field under test.
    expect(shopNodeId).toBeDefined();
    const shelfBefore = run.shopShelves[shopNodeId!]!;
    expect(shelfBefore.rerollCount).toBeGreaterThan(0);

    saveRun(storage, run);
    const loaded = loadRun(storage)!;
    expect(loaded.shopShelves[shopNodeId!]).toEqual(shelfBefore);
    expect(loaded.shopShelves[shopNodeId!]!.rerollCount).toBe(shelfBefore.rerollCount);
  });

  it('round-trips a freshly-created (pre-draft) run too', () => {
    const storage = fakeStorage();
    const run = createRun(42);
    saveRun(storage, run);
    expect(loadRun(storage)).toEqual(run);
  });
});

describe('meta/runSave: Bell chain resolutions survive between stages without a schema change', () => {
  function withResolution(state: RunState, key: string, eventId: string, choiceId: string, pending = false): RunState {
    return {
      ...state,
      eventResolutions: {
        ...(state.eventResolutions ?? {}),
        [key]: {
          eventId,
          contentVersion: 1,
          instanceId: `event:${key}`,
          choiceId,
          ...(pending ? { pending: true } : {}),
        },
      },
    };
  }

  function reload(state: RunState): RunState {
    const storage = fakeStorage();
    expect(saveRun(storage, state)).toEqual({ ok: true });
    expect(SCHEMA_VERSION).toBe(3);
    return loadRun(storage)!;
  }

  function matchingDraw(state: RunState, eventId: string, theme: RunNode['eventTheme'], biomeId: string): number {
    const seed = Array.from({ length: 256 }, (_unused, value) => value).find((eventSeed) => {
      const node: RunNode = { id: `save-probe-${eventId}-${eventSeed}`, depth: 1, wave: 1, kind: 'event', eventSeed, eventTheme: theme, biomeId };
      return rollEventForNode(state, node).event.id === eventId;
    });
    expect(seed, `${eventId} had no deterministic real draw in seeds 0..255`).toBeDefined();
    return seed!;
  }

  function expectDraw(state: RunState, eventId: string, theme: RunNode['eventTheme'], biomeId: string): void {
    const eventSeed = matchingDraw(state, eventId, theme, biomeId);
    const node: RunNode = { id: `save-hit-${eventId}`, depth: 1, wave: 1, kind: 'event', eventSeed, eventTheme: theme, biomeId };
    expect(rollEventForNode(state, node).event.id).toBe(eventId);
  }

  it('a reloaded exact stage-1 resolution opens stage 2, while the sibling choice stays closed', () => {
    const base = startedRun(81);
    const exact = reload(withResolution(base, 'bell-1', 'bell_beneath_ice', 'prise_it_free'));
    expectDraw(exact, 'the_second_toll', 'omen', 'frostmarch');

    const sibling = reload(withResolution(base, 'bell-1', 'bell_beneath_ice', 'ring_it_here'));
    for (let eventSeed = 0; eventSeed <= 255; eventSeed++) {
      const node: RunNode = { id: `save-closed-stage2-${eventSeed}`, depth: 1, wave: 1, kind: 'event', eventSeed, eventTheme: 'omen', biomeId: 'frostmarch' };
      expect(rollEventForNode(sibling, node).event.id).not.toBe('the_second_toll');
    }
  });

  it('reloading after both exact resolutions opens stage 3 and preserves both ledger entries', () => {
    const afterStage1 = reload(withResolution(startedRun(82), 'bell-1', 'bell_beneath_ice', 'prise_it_free'));
    const afterStage2 = reload(withResolution(afterStage1, 'bell-2', 'the_second_toll', 'answer_the_bell'));

    expect(afterStage2.eventResolutions).toMatchObject({
      'bell-1': { eventId: 'bell_beneath_ice', choiceId: 'prise_it_free' },
      'bell-2': { eventId: 'the_second_toll', choiceId: 'answer_the_bell' },
    });
    expectDraw(afterStage2, 'the_bell_unbound', 'forge', 'emberwaste');
  });

  it('a pending reloaded stage-1 cardChoice is already committed and opens stage 2', () => {
    const pending = reload(withResolution(startedRun(83), 'bell-1', 'bell_beneath_ice', 'prise_it_free', true));
    expect(pending.eventResolutions?.['bell-1']).toEqual({
      eventId: 'bell_beneath_ice',
      contentVersion: 1,
      instanceId: 'event:bell-1',
      choiceId: 'prise_it_free',
      pending: true,
    });
    expectDraw(pending, 'the_second_toll', 'omen', 'frostmarch');
  });
});

describe('meta/runSave: tolerant loader — never crashes boot', () => {
  it('corrupt (unparseable) JSON loads as null', () => {
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: '{not json at all' });
    expect(loadRun(storage)).toBeNull();
  });

  it('a JSON value that is not an object (bare number/string/array/boolean) loads as null', () => {
    for (const raw of ['42', '"a string"', '[1,2,3]', 'true']) {
      const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: raw });
      expect(loadRun(storage)).toBeNull();
    }
  });

  it('an envelope missing/malformed schemaVersion loads as null', () => {
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: JSON.stringify({ run: { seed: 1 } }) });
    expect(loadRun(storage)).toBeNull();
  });

  it('an envelope whose run field is missing/wrong-shaped loads as null', () => {
    const storage = fakeStorage({
      [RUN_SAVE_STORAGE_KEY]: JSON.stringify({ schemaVersion: SCHEMA_VERSION, run: 'oops' }),
    });
    expect(loadRun(storage)).toBeNull();
  });

  it('never throws regardless of what garbage is stored', () => {
    for (const raw of ['{not json', '[1,2,3]', 'null', '{}', '{"schemaVersion":"x"}']) {
      const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: raw });
      expect(() => loadRun(storage)).not.toThrow();
    }
  });
});

describe('meta/runSave: a corrupt blob is backed up, not destroyed', () => {
  it('unparseable JSON is copied to the backup key, and the primary key is left untouched', () => {
    const truncated = '{"schemaVersion":1,"run":{"seed":1,"gold":';
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: truncated });
    const loaded = loadRun(storage);
    expect(loaded).toBeNull();
    expect(storage.get(RUN_SAVE_BACKUP_KEY)).toBe(truncated);
    // The corrupt bytes are still there — load did not delete/overwrite them.
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe(truncated);
  });

  it('a non-object JSON value (array) is also backed up before returning null', () => {
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: '[1,2,3]' });
    loadRun(storage);
    expect(storage.get(RUN_SAVE_BACKUP_KEY)).toBe('[1,2,3]');
  });

  it('the explicit "cleared" null marker is NOT treated as corrupt — no backup', () => {
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: JSON.stringify(null) });
    expect(loadRun(storage)).toBeNull();
    expect(storage.get(RUN_SAVE_BACKUP_KEY)).toBeNull(); // never set — this is not corruption
  });
});

describe('meta/runSave: a newer schemaVersion is never downgraded', () => {
  function futureBlob(): Record<string, unknown> {
    return {
      schemaVersion: SCHEMA_VERSION + 1,
      run: { seed: 99, someV2OnlyField: 'kept-as-is' },
      // A v2-only envelope field this v1 build has no idea how to interpret.
      migrationHint: 'v1-to-v2',
    };
  }

  it('loadRun returns null for a newer blob WITHOUT touching the stored bytes', () => {
    const raw = JSON.stringify(futureBlob());
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: raw });
    expect(loadRun(storage)).toBeNull();
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe(raw); // byte-for-byte untouched
    expect(storage.get(RUN_SAVE_BACKUP_KEY)).toBeNull(); // not corruption — no backup
  });

  it('saveRun refuses to overwrite a newer-versioned stored blob', () => {
    const raw = JSON.stringify(futureBlob());
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: raw });
    const outcome = saveRun(storage, createRun(1));
    expect(outcome).toEqual({ ok: false, reason: 'newer-version-on-disk' });
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe(raw); // untouched
  });

  it('clearRun refuses to clobber a newer-versioned stored blob', () => {
    const raw = JSON.stringify(futureBlob());
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: raw });
    clearRun(storage);
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe(raw); // untouched — no downgrade-clear either
  });

  it('a same-version stored blob saves/clears normally — the guard only blocks strictly-newer', () => {
    const storage = fakeStorage();
    expect(saveRun(storage, createRun(1))).toEqual({ ok: true });
    expect(saveRun(storage, createRun(2))).toEqual({ ok: true });
    clearRun(storage);
    expect(loadRun(storage)).toBeNull();
  });
});

describe('meta/runSave: clearRun', () => {
  it('clears a previously-saved run — loadRun returns null afterward', () => {
    const storage = fakeStorage();
    saveRun(storage, midRunState(5));
    expect(loadRun(storage)).not.toBeNull();
    clearRun(storage);
    expect(loadRun(storage)).toBeNull();
  });

  it('is a no-op (never throws) when nothing was ever saved', () => {
    const storage = fakeStorage();
    expect(() => clearRun(storage)).not.toThrow();
    expect(loadRun(storage)).toBeNull();
  });

  it('after clearing, a fresh save works normally again', () => {
    const storage = fakeStorage();
    saveRun(storage, midRunState(6));
    clearRun(storage);
    const run = createRun(9);
    expect(saveRun(storage, run)).toEqual({ ok: true });
    expect(loadRun(storage)).toEqual(run);
  });
});

describe('meta/runSave: a StorageDriver write failure (e.g. quota exceeded) is surfaced, not swallowed', () => {
  it('saveRun reports { ok: false, reason: "write-failed" } and never throws', () => {
    const storage = fakeQuotaExceededStorage();
    expect(() => saveRun(storage, createRun(1))).not.toThrow();
    expect(saveRun(storage, createRun(1))).toEqual({ ok: false, reason: 'write-failed' });
  });

  it('a failed write does not silently look like a successful one on the next load', () => {
    const storage = fakeQuotaExceededStorage();
    saveRun(storage, createRun(1));
    expect(loadRun(storage)).toBeNull();
  });
});

describe('meta/runSave: StorageDriver seam stays DOM-free', () => {
  it('never calls anything beyond the injected get/set contract', () => {
    let gets = 0;
    let sets = 0;
    const spy: StorageDriver = {
      get: () => { gets += 1; return null; },
      set: () => { sets += 1; return true; },
    };
    loadRun(spy);
    saveRun(spy, createRun(1));
    expect(gets).toBeGreaterThan(0);
    expect(sets).toBeGreaterThan(0);
  });
});
