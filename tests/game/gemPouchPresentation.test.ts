import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deckMetaStatRun } from '../../src/game/ui/statRunModel';
import { DRAFT_SET_KEYS, rollStartDraft, type DraftSetKey } from '../../src/run/draft';

/**
 * THE POUCH IS VISIBLE — the presentation half of the a66eca4 investigation.
 *
 * A live playtest picked three gems from event rungs and concluded the gem
 * system did not exist. The data layer was flawless (a66eca4's two tests pin
 * that chain across save/load); every failure was presentation, and each one
 * had the same shape — a surface reading a DIFFERENT store than the one the
 * player's gems were in, or saying nothing at all:
 *
 *   1. the deck header's GEMS counted `pieces[].gem` (socketed) only, so a
 *      full pouch rendered "GEMS 0";
 *   2. the DECK/BAG screen — the only place gems are spent — had no pouch
 *      surface at all, and nothing said tapping a board card opens the
 *      socket panel;
 *   3. the socket panel's empty-pouch copy pointed mid-run players at the
 *      WIKI › GEMS tab, a sandbox surface that is unreachable mid-run and
 *      whose gems are not run gems;
 *   4. the wiki's IN POUCH read `demoState.gemInventory` unconditionally, so
 *      it told a player whose run pouch held three gems "0 IN POUCH".
 *
 * Two kinds of pin here, both established idioms:
 *
 *   - the `runStore` seam is driven for real (stubbed localStorage + module
 *     re-import, exactly `deckHoldPersistence.test.ts`'s harness) — the run
 *     pouch written through the store is what `currentRunGemInventory()`
 *     hands the scenes, and `isRunInProgress()` (the wiki's routing signal)
 *     flips at the right run states and no others;
 *   - the SCENES are swept textually on BOTH platforms (no canvas in this
 *     repo's node vitest env — same reasoning as `deckHoldPersistence`
 *     block 3), because the regression to guard is precisely "one platform
 *     got the fix and the other did not", which a one-scene unit test cannot
 *     see.
 */

const SCENE_DIR = join(process.cwd(), 'src/game/scenes');
const DECK_SCENES = ['MobileDeckBuildScene.ts', 'DesktopDeckBuildScene.ts'] as const;
const WIKI_SCENES = ['MobileWikiScene.ts', 'DesktopWikiScene.ts'] as const;

function sceneSource(file: string): string {
  return readFileSync(join(SCENE_DIR, file), 'utf8');
}

// ---------------------------------------------------------------------------
// 1 — the store seam: the run pouch and the wiki's routing signal, for real.
// ---------------------------------------------------------------------------

describe('runStore: the pouch seam the deck header and wiki read', () => {
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

  function draftThroughStore(store: typeof import('../../src/game/runStore'), seed: number): void {
    const draft = rollStartDraft(seed);
    const picks: Partial<Record<DraftSetKey, string>> = {};
    for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
    for (const key of DRAFT_SET_KEYS) store.pickCurrentStartDraftCard(key, picks[key]!);
    store.applyRunDraft();
  }

  it('isRunInProgress: true while drafting/active, false before, after retire, and after clear', async () => {
    const store = await import('../../src/game/runStore');
    expect(store.isRunInProgress(), 'no run yet').toBe(false);

    store.startRun(23);
    expect(store.getActiveRun()!.status).toBe('drafting');
    expect(store.isRunInProgress(), 'drafting is in progress').toBe(true);

    draftThroughStore(store, 23);
    expect(store.getActiveRun()!.status).toBe('active');
    expect(store.isRunInProgress(), 'active is in progress').toBe(true);

    store.retireActiveRun();
    expect(store.getActiveRun()!.status).toBe('retired');
    // A retired run still PARKS (its end banner needs it) — but the Sandbox
    // is the player's context again, so the wiki must go back to demoState.
    expect(store.isRunInProgress(), 'retired is NOT in progress').toBe(false);

    store.clearRun();
    expect(store.isRunInProgress(), 'cleared run').toBe(false);
  });

  it('a pouch gem written through the store is what currentRunGemInventory hands the scenes — and the header formula renders it', async () => {
    const store = await import('../../src/game/runStore');
    store.startRun(23);
    draftThroughStore(store, 23);

    // The store-side write every grant path bottoms out in (events use
    // `applyGemChoicePick`, whose save/load chain a66eca4's own tests pin;
    // this is the read seam the DECK scenes' `gemInventory` accessor uses).
    store.setCurrentRunGemInventory(['swift_charm']);
    expect(store.currentRunGemInventory()).toEqual(['swift_charm']);

    // The scenes' exact GEMS computation (pinned textually below): socketed
    // from pieces, owned = socketed + pouch. Nothing socketed, one pouch gem
    // -> "GEMS 0/1", where the shipped header said "GEMS 0".
    const gemsSocketed = store.getActiveRun()!.pieces.filter((p) => p.gem).length;
    const run = deckMetaStatRun({
      heroLevel: store.currentHeroLevel(),
      stats: { maxHp: 100, attack: 1, magicPower: 1, speed: 10 },
      gemAdds: {},
      used: 0, slots: 10, powerLevel: 0,
      gemsSocketed,
      gemsOwned: gemsSocketed + store.currentRunGemInventory().length,
    });
    expect(run.segments.find((s) => s.label === 'GEMS')!.value).toBe('0/1');
  });
});

// ---------------------------------------------------------------------------
// 2 — the DECK/BAG scenes, both platforms.
// ---------------------------------------------------------------------------

describe('deck build scenes: the pouch is visible where it is spent', () => {
  for (const file of DECK_SCENES) {
    const src = sceneSource(file);

    it(`${file}: the header GEMS stat counts the pouch (socketed/owned), not socketed alone`, () => {
      // The context-routed accessor IS the fix: run context counts the run
      // pouch, the Sandbox counts demoState's, and neither can read "0" while
      // gems wait unsocketed.
      expect(src).toContain('gemsOwned: gemsSocketed + this.gemInventory.length');
    });

    it(`${file}: renders the POUCH row and teaches the socket interaction`, () => {
      expect(src).toContain('pouchStatRun(');
      expect(src, 'the teach line must name the interaction').toContain('deck card to socket');
    });

    it(`${file}: the empty-pouch copy is context-split — the WIKI pointer is Sandbox-only`, () => {
      const at = src.indexOf('if (pouch.length === 0)');
      expect(at, 'empty-pouch branch not found').toBeGreaterThan(-1);
      const block = src.slice(at, at + 900);
      expect(block).toContain('this.runContext');
      expect(block).toContain("? 'No gems in the pouch — events and");
      expect(block).toContain(": 'No gems in the pouch — collect some");
      // The wiki pointer may exist ONLY inside that split (it is unreachable
      // mid-run) — one occurrence in the whole file, and it is the `:` branch.
      expect(src.split('WIKI › GEMS tab').length - 1).toBe(1);
      expect(block).toContain('WIKI › GEMS tab');
    });

    it(`${file}: an empty socket shows the muted ◇ cue only while the pouch has gems`, () => {
      expect(src).toContain("pouchCount > 0 ? [{ label: '◇', textColor: UI.textMuted }] : undefined");
      // ...and the socketed ◆ badge is untouched.
      expect(src).toContain("[{ label: '◆' }]");
    });
  }

  // No separate cross-platform parity test for the cue/formula: the pins
  // above are EXACT substrings asserted in BOTH files, which is already
  // byte-identical parity (the both-platforms rule, held the same way
  // deckHoldPersistence.test.ts holds the move-commit block).
});

// ---------------------------------------------------------------------------
// 3 — the WIKI scenes, both platforms.
// ---------------------------------------------------------------------------

describe('wiki scenes: IN POUCH reads the pouch the player actually has', () => {
  for (const file of WIKI_SCENES) {
    const src = sceneSource(file);

    it(`${file}: every pouch read routes through wikiPouch (run pouch while a run is in progress)`, () => {
      expect(src).toContain('isRunInProgress() ? currentRunGemInventory() : demoState.gemInventory');
      expect(src).toContain('${this.wikiPouch().length} IN POUCH');
      expect(src).toContain('this.wikiPouch().filter((id) => id === gem.id)');
      // The unconditional reads this replaces must be GONE — a second copy is
      // how the two surfaces disagree again.
      expect(src).not.toContain('${demoState.gemInventory.length}');
      expect(src).not.toContain('demoState.gemInventory.filter');
    });

    it(`${file}: ADD TO POUCH (a demoState cheat) is suppressed while a run is in progress`, () => {
      // Routed count + un-routed button would be a NEW lie: pressing it would
      // toast success and move nothing on screen. The gate differs in shape
      // per scene (wrap vs. early-return) but must exist in both.
      const gated = src.includes('if (!isRunInProgress()) {') || src.includes('if (isRunInProgress()) return;');
      expect(gated, 'no isRunInProgress gate ahead of ADD TO POUCH').toBe(true);
      const gateAt = Math.max(src.indexOf('if (!isRunInProgress()) {'), src.indexOf('if (isRunInProgress()) return;'));
      expect(gateAt, 'the gate must come BEFORE the button').toBeLessThan(src.indexOf("'ADD TO POUCH'"));
      // The button still writes ONLY the sandbox pouch — routing must never
      // turn a wiki cheat into a free run-gem grant.
      expect(src).not.toContain('setCurrentRunGemInventory');
    });
  }

  it('both platforms carry the SAME routing helper body', () => {
    const body = (file: string): string => {
      const src = sceneSource(file);
      const at = src.indexOf('private wikiPouch(): readonly string[] {');
      expect(at, `${file}: wikiPouch not found`).toBeGreaterThan(-1);
      return src.slice(at, src.indexOf('}', at) + 1);
    };
    expect(body('MobileWikiScene.ts')).toBe(body('DesktopWikiScene.ts'));
  });
});
