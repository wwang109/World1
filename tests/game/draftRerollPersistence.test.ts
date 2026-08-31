import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRun, saveRun, type StorageDriver } from '../../src/meta/runSave';
import {
  applyDraftResult, createRun, currentStartDraft, pickStartDraftCard, rerollStartDraft,
  startDraftPicks, startDraftProgress, type RunState,
} from '../../src/run/runState';
import { generateRunMap } from '../../src/run/runMap';
import {
  DRAFT_REROLL_STRIDE, DRAFT_SET_KEYS, draftSeedFor, rollStartDraft, rollStartDraftAt,
  type DraftSetKey, type StartDraft,
} from '../../src/run/draft';

/**
 * THE INVARIANT: THE HAND THE PLAYER ROLLED IS THE HAND THEY COME BACK TO.
 *
 * REROLL lived in `MobileDraftScene`/`DesktopDraftScene`'s own `rerolls` field
 * (and the picks in their own `picks` field), and both scenes' `init()` reset
 * both to zero on every `scene.start`. `init()` runs again on a page reload —
 * RESUME RUN › lands on the Run Map, which bounces a `'drafting'` run straight
 * back into the draft — so leaving and returning silently served the seed's
 * canonical roll again and threw away every reroll and every pick. Rerolls are
 * free and unlimited, so nothing was exploitable and no gold moved: it was
 * purely lost work, lost without a word. The third of its class, after `held`
 * (`7dac1f0`) and `eventResolutions` (`d0d448c`) — same cause each time,
 * `init()` rebuilding scene state from nothing.
 *
 * THE FIX PERSISTS A COUNTER, NOT THE 20 CARDS. `rollStartDraft` opens its own
 * `Rng(hashSeed('draft', seed))` and closes it again, drawing from no ambient
 * stream, so re-deriving on rehydrate consumes nothing the map/encounter/shop
 * rolls will later draw and cannot move their call order. `RunState.draft` is
 * OPTIONAL (`{rerolls, picks}`), so `SCHEMA_VERSION` stays 1 and every live v1
 * run still loads.
 *
 * THE TRAP: a pick names a card by SKILL ID and `applyDraftResult` installs
 * whatever id it is handed, without checking it was ever offered. So persisting
 * the picks makes a stale pick — one recorded against the previous roll —
 * strictly worse than the bug being fixed: a card the hand in front of the
 * player never contained, granted silently. Guarded three deep, the shape
 * `d0d448c` used: `pickStartDraftCard` refuses an unoffered id at the source,
 * `rerollStartDraft` clears the picks in the SAME write that changes the roll,
 * and `startDraftPicks` filters against the live roll on every read.
 *
 * Positioned at four layers: the pure round-trip, the pure run-layer
 * transitions, the `runStore` seam driven through the SAME module-load
 * hydration a real refresh uses (`vi.resetModules()` + re-import), and a
 * SOURCE sweep over BOTH draft scenes (there is no canvas in this repo's
 * `node` vitest env — same reasoning as `deckHoldPersistence.test.ts`).
 */

const SCENES = ['MobileDraftScene.ts', 'DesktopDraftScene.ts'] as const;

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

/** The 4x5 offer, as bytes. "Byte-identical" is the whole claim of the
 * persist-a-counter choice, so the tests below compare this rather than
 * eyeballing a card or two. */
function handBytes(hand: StartDraft): string {
  return JSON.stringify(DRAFT_SET_KEYS.map((key) => hand[key].map((c) => `${c.skillId}:${c.tier}`)));
}

function handHash(hand: StartDraft): string {
  return createHash('sha256').update(handBytes(hand)).digest('hex').slice(0, 16);
}

/** Pick the `index`-th card of every set of whatever is currently on offer. */
function pickAcross(state: RunState, index: number): RunState {
  let next = state;
  for (const key of DRAFT_SET_KEYS) {
    next = pickStartDraftCard(next, key, currentStartDraft(next)[key][index]!.skillId);
  }
  return next;
}

// ---------------------------------------------------------------------------
// 1 — the run layer: the roll is derived, and the stride is ITS rule.
// ---------------------------------------------------------------------------

describe('run/draft: the reroll stride belongs to the run layer', () => {
  it('rollStartDraftAt(seed, 0) IS the canonical roll — moving the stride out of the scenes changed no offer', () => {
    for (const seed of [1, 7, 42, 31, 999, 123456]) {
      expect(handBytes(rollStartDraftAt(seed, 0))).toBe(handBytes(rollStartDraft(seed)));
    }
  });

  it('rollStartDraftAt reproduces exactly what the scenes used to compute inline (seed + n * 7919)', () => {
    // The literal both draft scenes carried a copy of. If the run layer's
    // stride ever stops matching it, live saves silently change hands.
    expect(DRAFT_REROLL_STRIDE).toBe(7919);
    for (const seed of [1, 42, 31]) {
      for (let n = 0; n <= 5; n += 1) {
        expect(draftSeedFor(seed, n)).toBe(seed + n * 7919);
        expect(handBytes(rollStartDraftAt(seed, n))).toBe(handBytes(rollStartDraft(seed + n * 7919)));
      }
    }
  });

  it('a corrupt rerolls count degrades to the canonical roll, never to a NaN seed', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -4, 2.7]) {
      const state: RunState = { ...createRun(9), draft: { rerolls: bad, picks: {} } };
      const hand = currentStartDraft(state);
      for (const key of DRAFT_SET_KEYS) expect(hand[key].length).toBe(5);
      if (bad === 2.7) expect(handBytes(hand)).toBe(handBytes(rollStartDraftAt(9, 2)));
      else if (bad !== Number.POSITIVE_INFINITY) expect(handBytes(hand)).toBe(handBytes(rollStartDraft(9)));
    }
  });

  it('REROLL DOES NOT MOVE ANY OTHER SEEDED STREAM — the map is byte-identical after 12 rerolls', () => {
    // The determinism trap this fix had to answer: if a reroll consumed draws
    // from a shared Rng, re-deriving the hand on rehydrate would shift every
    // later roll's call order (and the frozen `biomeDeal` fingerprint with it).
    // It cannot: `rollStartDraft` opens and closes its own Rng.
    const seed = 4242;
    let state = createRun(seed);
    const mapBefore = JSON.stringify(state.map);
    for (let i = 0; i < 12; i += 1) state = rerollStartDraft(state);
    expect(JSON.stringify(state.map)).toBe(mapBefore);
    expect(JSON.stringify(state.map)).toBe(JSON.stringify(generateRunMap(seed)));
  });
});

// ---------------------------------------------------------------------------
// 2 — the pure round-trip: reroll, serialize, deserialize, SAME hand.
// ---------------------------------------------------------------------------

describe('run save: the rerolled hand survives serialization', () => {
  it('is the same 20 cards after saveRun -> loadRun', () => {
    // The reroll is part of the run, or nothing below can save it. This is the
    // pre-fix line: `rerolls` was a scene field and `RunState` knew nothing.
    expect('draft' in createRun(1),
      'RunState has no `draft` field — the start draft roll is not run state').toBe(true);

    const state = pickAcross(rerollStartDraft(rerollStartDraft(rerollStartDraft(createRun(7)))), 2);
    expect(startDraftProgress(state).rerolls).toBe(3);
    const before = currentStartDraft(state);
    const picksBefore = startDraftPicks(state);
    // A rerolled hand is genuinely a different hand — otherwise this proves nothing.
    expect(handBytes(before)).not.toBe(handBytes(rollStartDraft(7)));

    const storage = fakeStorage();
    expect(saveRun(storage, state).ok).toBe(true);
    const reloaded = loadRun(storage);

    expect(reloaded, 'the run itself did not come back').not.toBeNull();
    const after = currentStartDraft(reloaded!);
    expect(handHash(after), 'the rerolled hand did not survive the save round-trip').toBe(handHash(before));
    expect(handBytes(after)).toBe(handBytes(before));
    expect(startDraftPicks(reloaded!)).toEqual(picksBefore);
  });

  it('a save written BEFORE this field existed still loads (no schema bump)', () => {
    // A v1 blob has no `draft` key at all. Absent must mean "no reroll,
    // nothing picked" — the reason this is an optional field rather than a
    // SCHEMA_VERSION bump, which would strand every in-progress run.
    const legacy: Record<string, unknown> = { ...createRun(11) };
    delete legacy.draft;
    const storage = fakeStorage();
    saveRun(storage, legacy as unknown as RunState);

    const reloaded = loadRun(storage);
    expect(reloaded).not.toBeNull();
    expect(startDraftProgress(reloaded!)).toEqual({ rerolls: 0, picks: {} });
    expect(handBytes(currentStartDraft(reloaded!))).toBe(handBytes(rollStartDraft(11)));
  });

  it('the draft progress is dropped once START lands — no stale picks on an active run', () => {
    const drafted = applyDraftResult(pickAcross(rerollStartDraft(createRun(13)), 0), {});
    expect(drafted.status).toBe('active');
    expect(drafted.draft ?? null, 'an active run still carries in-progress draft picks').toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3 — THE TRAP: a pick from the previous roll must never be installable.
// ---------------------------------------------------------------------------

describe('run/runState: a stale pick can never reach the board', () => {
  it('REROLL clears the picks in the SAME state as the new roll', () => {
    const picked = pickAcross(createRun(21), 0);
    expect(Object.keys(startDraftPicks(picked))).toHaveLength(4);
    const rerolled = rerollStartDraft(picked);
    expect(startDraftProgress(rerolled).picks,
      'a pick from the previous roll survived the reroll').toEqual({});
    expect(handBytes(currentStartDraft(rerolled))).not.toBe(handBytes(currentStartDraft(picked)));
  });

  it('every pick a state records is a card that state is actually offering', () => {
    let state = createRun(21);
    for (let n = 0; n < 6; n += 1) {
      state = pickAcross(state, n % 5);
      const offer = currentStartDraft(state);
      for (const key of DRAFT_SET_KEYS) {
        const id = startDraftProgress(state).picks[key];
        expect(offer[key].map((c) => c.skillId), `${key} pick "${id}" is not on offer`).toContain(id);
      }
      state = rerollStartDraft(state);
    }
  });

  it('pickStartDraftCard REFUSES a card the current set does not offer', () => {
    const state = createRun(21);
    const notOffered = currentStartDraft(state).offense.map((c) => c.skillId);
    // A defense-set id is never in the offense set (all 20 are distinct).
    const foreign = currentStartDraft(state).defense[0]!.skillId;
    expect(notOffered).not.toContain(foreign);
    expect(() => pickStartDraftCard(state, 'offense', foreign)).toThrow(/not offered/);
    expect(() => pickStartDraftCard(state, 'offense', 'no_such_skill')).toThrow(/not offered/);
  });

  it('a pick the roll no longer offers is DROPPED on read, not installed', () => {
    // What a content change under a live save looks like: the id was legal
    // when it was written and is not on offer now.
    const base = pickAcross(createRun(21), 0);
    const forged: RunState = {
      ...base,
      draft: { rerolls: startDraftProgress(base).rerolls, picks: { ...startDraftProgress(base).picks, offense: 'no_such_skill' } },
    };
    expect(startDraftPicks(forged).offense,
      'a pick the current hand does not offer leaked through startDraftPicks').toBeUndefined();
    // ...and therefore never reaches an owned instance.
    const installed = applyDraftResult(forged, startDraftPicks(forged));
    const ids = [...installed.pieces.map((p) => p.skillId), ...installed.bagSlots.flatMap((b) => (b ? [b.skillId] : []))];
    expect(ids).not.toContain('no_such_skill');
    expect(ids).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 4 — the store seam: roll -> reroll -> LEAVE -> RETURN, and a page reload.
// ---------------------------------------------------------------------------

describe('runStore: the rerolled hand survives leaving the draft and a reload', () => {
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

  type Store = typeof import('../../src/game/runStore');

  /** A REFRESH: drop the module (and its in-memory `activeRun`) and import it
   * again against the SAME localStorage — exactly what the browser does, and
   * `runStore` hydrates `activeRun` from `loadRun` at import time. */
  async function reloadStore(): Promise<Store> {
    vi.resetModules();
    return import('../../src/game/runStore');
  }

  /**
   * WHAT RE-ENTERING THE DRAFT SCREEN READS. Both scenes' `init()` throws
   * their own fields away and `create()` then asks for the hand and the picks;
   * post-fix that ask goes to the store, which is the only thing that can
   * remember. This is the round trip the bug report describes: leave, come
   * back, look at the hand.
   */
  function reenterDraftScreen(store: Store): { hand: StartDraft; picks: Partial<Record<DraftSetKey, string>> } {
    return { hand: store.currentStartDraftHand()!, picks: store.currentStartDraftPicks() };
  }

  it('leaving the draft and coming back shows the REROLLED hand, not the un-rerolled roll', async () => {
    const store = await import('../../src/game/runStore');
    const seed = 31;
    store.startRun(seed);

    const canonical = reenterDraftScreen(store).hand;
    expect(handBytes(canonical)).toBe(handBytes(rollStartDraft(seed)));

    store.rerollCurrentStartDraft();
    store.rerollCurrentStartDraft();
    const rolled = reenterDraftScreen(store).hand;
    expect(handBytes(rolled), 'REROLL did not change the offer at all').not.toBe(handBytes(canonical));

    // Pick three of the four sets, then walk away.
    for (const key of ['offense', 'defense', 'support'] as const) {
      store.pickCurrentStartDraftCard(key, rolled[key][1]!.skillId);
    }
    const picksBefore = store.currentStartDraftPicks();

    // ---- leave and return (a `scene.start` away and back: init() + create()) ----
    const back = reenterDraftScreen(store);
    expect(handHash(back.hand),
      'the hand reset to the un-rerolled roll — the rerolled hand was silently discarded').toBe(handHash(rolled));
    expect(handBytes(back.hand)).toBe(handBytes(rolled));
    expect(back.picks, 'the picks made against the rerolled hand were discarded').toEqual(picksBefore);
    expect(Object.keys(back.picks)).toHaveLength(3);
  });

  it('the rerolled hand and the picks are byte-identical after a full page RELOAD', async () => {
    const store = await import('../../src/game/runStore');
    const seed = 31;
    store.startRun(seed);
    for (let i = 0; i < 5; i += 1) store.rerollCurrentStartDraft();
    const rolled = store.currentStartDraftHand()!;
    for (const key of DRAFT_SET_KEYS) store.pickCurrentStartDraftCard(key, rolled[key][3]!.skillId);
    const picksBefore = store.currentStartDraftPicks();
    expect(handBytes(rolled)).not.toBe(handBytes(rollStartDraft(seed)));

    // ---- reload ----
    const reloaded = await reloadStore();
    expect(reloaded.getActiveRun(), 'no run resumed at all after the reload').not.toBeNull();
    const back = reenterDraftScreen(reloaded);
    expect(handHash(back.hand), 'the reload served the un-rerolled roll').toBe(handHash(rolled));
    expect(handBytes(back.hand)).toBe(handBytes(rolled));
    expect(back.picks).toEqual(picksBefore);

    // And START installs exactly those four cards, nothing re-derived.
    reloaded.applyRunDraft();
    const run = reloaded.getActiveRun()!;
    expect(run.status).toBe('active');
    const owned = [...run.pieces.map((p) => p.skillId), ...run.bagSlots.flatMap((b) => (b ? [b.skillId] : []))];
    expect(owned.sort()).toEqual(DRAFT_SET_KEYS.map((k) => picksBefore[k]!).sort());
  });

  it('every persisted snapshot offers the picks it records — reroll is ONE write', async () => {
    const store = await import('../../src/game/runStore');
    const seed = 31;
    store.startRun(seed);
    const hand = store.currentStartDraftHand()!;
    for (const key of DRAFT_SET_KEYS) store.pickCurrentStartDraftCard(key, hand[key][0]!.skillId);

    // Watch what actually reaches storage across a REROLL: the new roll and
    // the cleared picks must never be two writes, or the snapshot between them
    // records a pick the hand it describes does not offer — and
    // `applyDraftResult` would install it.
    const snapshots: RunState[] = [];
    const realSet = cells.set.bind(cells);
    cells.set = (k: string, v: string) => {
      const parsed: unknown = JSON.parse(v);
      if (parsed && typeof parsed === 'object' && 'run' in (parsed as object)) {
        snapshots.push((parsed as { run: RunState }).run);
      }
      return realSet(k, v);
    };

    store.rerollCurrentStartDraft();

    expect(snapshots.length).toBeGreaterThan(0);
    for (const snap of snapshots) {
      const offer = currentStartDraft(snap);
      for (const key of DRAFT_SET_KEYS) {
        const id = snap.draft?.picks[key];
        if (id === undefined) continue;
        expect(offer[key].map((c) => c.skillId),
          `a saved snapshot recorded a ${key} pick its own hand does not offer`).toContain(id);
      }
    }
  });

  it('rerolling never touches the run map the seed already generated', async () => {
    const store = await import('../../src/game/runStore');
    const seed = 77;
    store.startRun(seed);
    const mapBefore = JSON.stringify(store.getActiveRun()!.map);
    for (let i = 0; i < 8; i += 1) store.rerollCurrentStartDraft();
    expect(JSON.stringify(store.getActiveRun()!.map)).toBe(mapBefore);
    const reloaded = await reloadStore();
    expect(JSON.stringify(reloaded.getActiveRun()!.map)).toBe(mapBefore);
  });
});

// ---------------------------------------------------------------------------
// 5 — SOURCE sweep: both scenes, no canvas needed.
// ---------------------------------------------------------------------------

describe('draft scenes: the roll and the picks are not scene-local state', () => {
  for (const file of SCENES) {
    it(`${file} keeps the roll in the run layer, not in a scene field`, () => {
      const src = sceneSource(file);
      // The pre-fix declaration — a scene field is where the reroll went to die.
      expect(src, 'the reroll count is back in a scene-local field')
        .not.toMatch(/private rerolls = 0;/);
      expect(src, 'the picks are back in a scene-local field, cleared by init()')
        .not.toMatch(/private picks: Partial<Record<DraftSetKey, string>> = \{\};/);
      expect(src).toContain('currentStartDraftHand');
      expect(src).toContain('currentStartDraftPicks');
      expect(src).toContain('rerollCurrentStartDraft');
      expect(src).toContain('pickCurrentStartDraftCard');
    });

    it(`${file} does not mint the reroll stride itself`, () => {
      // The rule the run layer owns (`DRAFT_REROLL_STRIDE`). Two copies of it
      // is two chances for the platforms to offer different cards for the same
      // run — the same class the `EventOutcome` seam sweep bans.
      const src = sceneSource(file);
      expect(src, 'the reroll stride literal is back in the scene').not.toContain('7919');
      expect(src, 'the scene is rolling the draft off its own seed arithmetic')
        .not.toMatch(/rollStartDraft\(/);
    });

    it(`${file} init() does not clear the draft state`, () => {
      const src = sceneSource(file);
      const init = src.slice(src.indexOf('  init(): void {'));
      const body = init.slice(0, init.indexOf('\n  }'));
      expect(body, 'init() clears the reroll count again — the bug exactly').not.toMatch(/this\.rerolls\s*=/);
      expect(body, 'init() clears the picks again — the bug exactly').not.toMatch(/this\.picks\s*=/);
    });

    it(`${file} routes START through the run's OWN picks`, () => {
      const src = sceneSource(file);
      // Passing the scene's picks is the scene-field bug wearing a hat.
      expect(src, 'START hands the store picks the scene was carrying').not.toMatch(/applyRunDraft\(\s*this\.picks\s*\)/);
      expect(src).toContain('applyRunDraft()');
    });
  }

  it('both platforms carry the SAME draft-state block', () => {
    // A one-sided fix is a failed fix: the bug was identical in both scenes.
    const block = (file: string): string => {
      const src = sceneSource(file);
      const start = src.indexOf('  // ---------- draft state (RUN: persisted · SANDBOX: this scene) ----------');
      const end = src.indexOf('  // ---------- /draft state ----------');
      expect(start, `${file}: draft-state block not found`).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return src.slice(start, end);
    };
    expect(block('MobileDraftScene.ts')).toBe(block('DesktopDraftScene.ts'));
  });
});
