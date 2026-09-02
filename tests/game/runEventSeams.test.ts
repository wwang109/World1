import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { skillBook } from '../../src/data/skills';
import { cardOfferableAtTier } from '../../src/engine/types';
import type { MergeCardsReceipt } from '../../src/run/events';
import { sellPriceOfGem } from '../../src/run/shop';
import type { RunBagSlot, RunNode } from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import {
  applyCurrentMergeCardsPick, applyCurrentSellGemPick, applyRunDraft, choices, clearRun,
  currentEventDef, getActiveRun, pickCurrentStartDraftCard, pickNode, resolveCurrentEventChoice,
  setCurrentRunBagSlots,
  setCurrentRunGemInventory, setCurrentRunPieces, startRun,
} from '../../src/game/runStore';
import { buildRunRewardViewModel } from '../../src/game/ui/runRewardViewModel';

/**
 * THE SEAMS between the run layer and what the player actually reads.
 *
 * Both bugs this file was written for were of ONE kind: a value crossed a
 * module boundary and nothing asserted it arrived. The run layer was correct,
 * the renderer was correct, the run layer's own tests were green — and the
 * field died in the one-line store wrapper in between.
 *
 *   1. `applyMergeCardsPick` returns a `MergeCardsReceipt` (`merged`) naming
 *      the three cards the merge ATE. `runStore.applyCurrentMergeCardsPick`
 *      destructured `{state, outcome}` and dropped it, so the only destructive
 *      card outcome in the game announced itself as "Gained a SILVER card" —
 *      the same sentence a free card gets. `grep MergeCardsReceipt` found the
 *      declaration, the return type, and no consumers at all.
 *   2. `applySellGemPick` — the run layer's `sellGem` finalizer, covered by
 *      four tests — had ZERO importers in `src/`. Both event scenes called
 *      `sellCurrentRunGem` (the Deck/Bag SELL wrapper) and hand-built the
 *      `{kind:'sellGem', gemId, price}` outcome themselves.
 *
 * So these are deliberately NOT more tests that the run layer produces the
 * value. Each one is positioned so that deleting the field at the seam — in
 * the store wrapper, or in either scene — turns it red. Where the seam is
 * inside a Phaser scene (no canvas in this repo's `node` vitest env, see
 * `pointerConsumptionAudit.test.ts` for the same reasoning) it is held by a
 * SOURCE sweep rather than by a runtime assertion.
 */

const BRONZE_SIZE1 = Object.values(skillBook)
  .filter((s) => s.size === 1 && cardOfferableAtTier(s, 'bronze'))
  .map((s) => s.id);

/** The catalog's merge door. `resolveEventChoice` takes the event id as an
 * argument, so WHICH event the node drew is irrelevant — the same pinning
 * `tests/run/cardMerge.test.ts` uses. */
const MERGE_DOOR = { eventId: 'ruined_anvil', choiceId: 'beat_together' } as const;
const BAG_SLOTS = 10;

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
  return picks;
}

/** The path the draft SCREENS take now that the reroll count and the picks are
 * run state (`RunState.draft`): record each set's pick through the store, then
 * START. Installs exactly the cards `draftPicksFor` names. */
function draftRunThroughStore(seed: number): void {
  const picks = draftPicksFor(seed);
  for (const key of DRAFT_SET_KEYS) pickCurrentStartDraftCard(key, picks[key]!);
  applyRunDraft();
}

/** Walks the STORE (not a hand-built `RunState`) onto a real event node, the
 * same three calls the scenes make: start → draft → pick the node. Searches
 * seeds only because which wave-1 nodes a seed offers is map-gen's business. */
function storeOnEventNode(): RunNode {
  for (let seed = 1; seed <= 60; seed += 1) {
    startRun(seed);
    draftRunThroughStore(seed);
    const node = choices().find((n) => n.kind === 'event');
    if (!node) continue;
    pickNode(node.id);
    // What `DesktopRunEventScene.create` does first — draws the event into the
    // run (and seeds the node) before any choice can resolve.
    currentEventDef();
    return node;
  }
  throw new Error('no seed in 1..60 offered a wave-1 event node');
}

/** Three same-skill BRONZE cards in the bag and nothing on the board: the
 * lowest tier with `MERGE_INPUT_COUNT` owned instances, so the merge plan is
 * unambiguous and its output tier is SILVER. */
function ownThreeBronze(): void {
  const bag: RunBagSlot[] = new Array<RunBagSlot>(BAG_SLOTS).fill(null);
  for (let i = 0; i < 3; i += 1) {
    bag[i] = { instanceId: `card_90${i}`, skillId: BRONZE_SIZE1[i]!, tier: 'bronze' };
  }
  setCurrentRunPieces([]);
  setCurrentRunBagSlots(bag);
}

// ---------------------------------------------------------------------------
// SEAM 1 — run layer → runStore → reward view model, driven through the store.
// ---------------------------------------------------------------------------

describe('game/runStore: the merge RECEIPT survives the store seam', () => {
  // In-memory `window.localStorage`, same stub `tests/run/eliteAffix.test.ts`
  // uses: this is a test OF the store, not of its persistence driver.
  beforeAll(() => {
    const cells = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => cells.get(k) ?? null,
        setItem: (k: string, v: string) => void cells.set(k, v),
        removeItem: (k: string) => void cells.delete(k),
      },
    });
  });
  afterAll(() => { clearRun(); vi.unstubAllGlobals(); });

  /** Resolves the merge door on the store's current event node and takes the
   * first candidate — returning BOTH what the store handed back and what the
   * offer said, so the two can be compared. */
  function takeMerge(): {
    merged: MergeCardsReceipt | undefined;
    outcome: ReturnType<typeof resolveCurrentEventChoice>;
    consumedIds: string[];
    pickedSkillId: string;
  } {
    storeOnEventNode();
    ownThreeBronze();
    const offer = resolveCurrentEventChoice(MERGE_DOOR.eventId, MERGE_DOOR.choiceId);
    if (!offer || offer.kind !== 'mergeCardsPick') throw new Error(`expected a mergeCardsPick offer, got "${offer?.kind}"`);
    const picked = offer.candidates[0]!;
    const result = applyCurrentMergeCardsPick(picked.skillId);
    if (!result) throw new Error('applyCurrentMergeCardsPick returned undefined on an active run');
    return {
      merged: result.merged,
      outcome: result.outcome,
      consumedIds: offer.consumed.map((c) => c.instanceId),
      pickedSkillId: picked.skillId,
    };
  }

  it('applyCurrentMergeCardsPick returns the receipt beside the outcome — NOT the outcome alone', () => {
    const { merged, outcome, consumedIds, pickedSkillId } = takeMerge();
    expect(outcome?.kind).toBe('grantCard');
    // The field that used to die here. Dropping it again fails on this line.
    expect(merged, 'the merge receipt did not survive the runStore seam').toBeDefined();
    expect(merged!.consumed.map((c) => c.instanceId)).toEqual(consumedIds);
    expect(merged!.from).toBe('bronze');
    expect(merged!.to).toBe('silver');
    expect(merged!.taken).toEqual({ skillId: pickedSkillId, tier: 'silver' });
    // And the three named instances really are gone from the run.
    const after = getActiveRun()!;
    const ids = [...after.pieces.map((p) => p.instanceId), ...after.bagSlots.filter((b) => b).map((b) => b!.instanceId)];
    for (const id of consumedIds) expect(ids).not.toContain(id);
  });

  it('what the store returns, rendered, NAMES the three cards the merge ate and the one that arrived', () => {
    const { merged, outcome, consumedIds, pickedSkillId } = takeMerge();
    // Exactly the call both event scenes make on the outcome phase.
    const model = buildRunRewardViewModel(outcome!, merged);
    expect(model.headline).toBe('3 BRONZE → 1 SILVER');
    expect(model.detail, 'the outcome screen said nothing about what was spent').toBeDefined();
    for (const id of consumedIds) {
      const name = skillBook[merged!.consumed.find((c) => c.instanceId === id)!.skillId]!.name;
      expect(model.detail!, `spent card "${name}" is not named on the outcome screen`).toContain(name);
    }
    expect(model.detail!).toContain(skillBook[pickedSkillId]!.name);
    // The card that arrived is still the subject of the screen.
    expect(model.feature.kind).toBe('card');
  });
});

// ---------------------------------------------------------------------------
// SEAM 2 — runStore → the `sellGem` finalizer (which had no production caller).
// ---------------------------------------------------------------------------

describe('game/runStore: the sellGem pick goes through the RUN LAYER finalizer', () => {
  beforeAll(() => {
    const cells = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => cells.get(k) ?? null,
        setItem: (k: string, v: string) => void cells.set(k, v),
        removeItem: (k: string) => void cells.delete(k),
      },
    });
  });
  afterAll(() => { clearRun(); vi.unstubAllGlobals(); });

  it('applyCurrentSellGemPick produces the FINAL sellGem outcome, priced by sellPriceOfGem, and removes exactly that pouch index', () => {
    storeOnEventNode();
    const pouch = ['bramble_sliver', 'archmages_core', 'bramble_sliver'];
    setCurrentRunGemInventory([...pouch]);
    const goldBefore = getActiveRun()!.gold;

    const outcome = applyCurrentSellGemPick(1);
    expect(outcome, 'applyCurrentSellGemPick returned undefined on an active run').toBeDefined();
    expect(outcome!.kind).toBe('sellGem');
    expect(outcome!.kind === 'sellGem' && outcome!.gemId).toBe('archmages_core');
    // The price is the run layer's one sell formula — never a scene-local one.
    expect(outcome!.kind === 'sellGem' && outcome!.price).toBe(sellPriceOfGem('archmages_core'));

    const after = getActiveRun()!;
    expect(after.gemInventory).toEqual(['bramble_sliver', 'bramble_sliver']);
    expect(after.gold).toBe(goldBefore + sellPriceOfGem('archmages_core'));
  });

  it('the outcome it produces is what the reward screen reads — the headline quotes the credited price', () => {
    storeOnEventNode();
    setCurrentRunGemInventory(['bramble_sliver']);
    const outcome = applyCurrentSellGemPick(0)!;
    const model = buildRunRewardViewModel(outcome, undefined);
    expect(model.headline).toBe(`Sold a gem for ${sellPriceOfGem('bramble_sliver')} gold`);
  });
});

// ---------------------------------------------------------------------------
// SEAM 3 — runStore/scene SOURCE sweep. There is no canvas in this vitest env
// (see `pointerConsumptionAudit.test.ts`), so the scene half of each seam is
// held structurally: the wiring must still BE there.
// ---------------------------------------------------------------------------

const SRC = join(process.cwd(), 'src', 'game');
const EVENT_SCENES = ['scenes/DesktopRunEventScene.ts', 'scenes/MobileRunEventScene.ts'];
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

describe('game seam sweep: no run-layer field is produced and then thrown away', () => {
  it('runStore reads BOTH halves of applyMergeCardsPick — the receipt is not destructured away', () => {
    const store = read('runStore.ts');
    expect(store, 'runStore dropped `merged` from applyMergeCardsPick again').toMatch(
      /const\s*\{[^}]*\bmerged\b[^}]*\}\s*=\s*applyMergeCardsPick\(/,
    );
  });

  it('runStore is a REAL importer of applySellGemPick — the finalizer is not dead code with four tests', () => {
    expect(read('runStore.ts')).toContain('applySellGemPick');
  });

  for (const scene of EVENT_SCENES) {
    it(`${scene} carries the merge receipt into the reward view model`, () => {
      const src = read(scene);
      // The pick handler keeps the receipt...
      expect(src, 'the merge pick handler discards `merged`').toMatch(/this\.mergeReceipt\s*=\s*result\.merged/);
      // ...and the outcome phase hands it to the ONE thing that renders text.
      expect(src, 'buildRunRewardViewModel is called without the receipt').toMatch(
        /buildRunRewardViewModel\(\s*this\.outcome\s*,\s*this\.mergeReceipt/,
      );
    });

    it(`${scene} finalizes a sellGem pick through the run layer, not by hand`, () => {
      const src = read(scene);
      expect(src).toContain('applyCurrentSellGemPick(');
      expect(src, 'the event scene is selling through the Deck/Bag wrapper again').not.toContain('sellCurrentRunGem');
    });
  }

  /** No file under `src/game` may MINT an `EventOutcome`. Every one of these
   * kinds is a RESOLVED run-layer verdict (what was gained, spent or lost);
   * a scene that builds one is re-implementing a rule the run layer owns —
   * exactly what the `sellGem` duplicate was. Reading `outcome.kind` is
   * untouched by this sweep; only object literals match. */
  it('no scene mints an EventOutcome literal — resolved outcomes come from src/run only', () => {
    const MINTED = /kind:\s*['"](grantCard|grantGem|grantGold|loseGold|grantLevel|sellGem|upgradeCard|nothing)['"]/;
    const offenders: string[] = [];
    for (const scene of EVENT_SCENES) {
      if (MINTED.test(read(scene))) offenders.push(scene);
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SEAM 4 — the event-chain UI pass (2026-09-02): lock reasons, the recap line,
// derived-door family labels. Same posture as SEAM 3 (no canvas here, so the
// scene half is held structurally): the run layer WORDS these three values
// (`choiceLockReason` / `eventRecapLine` / `derivedChoiceFamily`,
// src/run/events.ts — see tests/run/events.presenters.test.ts for what they
// say); each sweep below is positioned so that unwiring one of them from
// either scene — the exact both-platforms drift the 2026-08-05 audits caught —
// turns it red.
// ---------------------------------------------------------------------------

describe('game seam sweep: the chain UI pass is wired into BOTH event scenes', () => {
  for (const scene of EVENT_SCENES) {
    it(`${scene} dims rungs through choiceLockReason and prints the reason on the locked row`, () => {
      const src = read(scene);
      // ONE call carries both halves: the boolean (`=== null`) and the wording.
      expect(src).toContain('choiceLockReason(');
      expect(src, 'the locked row does not render the run layer\'s reason').toMatch(/LOCKED · \$\{lockReason\}/);
      // Re-importing the bare predicate beside it would let the boolean and
      // the printed reason be computed twice — the drift this seam forbids.
      expect(src, 'the scene re-imports the bare usability predicate').not.toMatch(/import\s*\{[^}]*\bisEventChoiceUsable\b/);
    });

    it(`${scene} names a derived door's family through the run layer's one derivation`, () => {
      const src = read(scene);
      expect(src).toContain('derivedChoiceFamily(');
      expect(src, 'the family suffix is not rendered onto the label').toMatch(/\$\{choice\.label\} — \$\{family\}/);
    });

    it(`${scene} opens a chain payoff with the recap line INSIDE the body box`, () => {
      const src = read(scene);
      expect(src).toContain('eventRecapLine(');
      // Prepended to the body COPY — never a new layout block, so the choice
      // reservation math stays untouched (the mobile 3-choice budget is
      // load-bearing; see EventDef's own doc comment in src/data/events.ts).
      expect(src, 'the recap is not prepended into the body copy').toMatch(/\$\{recap\}\\n\\n\$\{event\.body\}/);
    });
  }
});
