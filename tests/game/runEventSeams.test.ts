import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { skillBook } from '../../src/data/skills';
import { cardOfferableAtTier } from '../../src/engine/types';
import { resolveEventChoice, type MergeCardsReceipt } from '../../src/run/events';
import { recordEventInstance } from '../../src/run/eventInstances';
import { sellPriceOfGem } from '../../src/run/shop';
import type { RunBagSlot, RunNode } from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import {
  applyCurrentMergeCardsPick, applyCurrentSellGemPick, applyRunDraft, choices, clearRun,
  currentEventDef, getActiveRun, pickCurrentStartDraftCard, pickNode, resolveCurrentEventChoice,
  setCurrentRunBagSlots,
  setCurrentRunGemInventory, setCurrentRunPieces, startRun, installDevRunFixture,
  type RunEventOfferSelection, type RunEventOutcome,
} from '../../src/game/runStore';
import { buildRunRewardViewModel } from '../../src/game/ui/runRewardViewModel';
import { buildDevEventFixture } from '../../src/game/devLaunch';

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

/** The catalog's merge door. The event layer requires the node's immutable
 * committed identity to agree with this exact catalog version. */
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
    const active = getActiveRun();
    if (!active) throw new Error('store lost the active run while entering an event node');
    // This seam test is about the merge offer and receipt, so it pins the
    // catalog door it means to exercise through the same immutable record API
    // a production draw uses. Do not weaken resolveEventChoice's identity
    // guard just to permit an arbitrary hard-coded event id here.
    installDevRunFixture(recordEventInstance(active, node.id, {
      eventId: MERGE_DOOR.eventId,
      contentVersion: 1,
      instanceId: `event:${node.id}`,
      drawnDepth: node.depth,
    }));
    if (currentEventDef()?.id !== MERGE_DOOR.eventId) {
      throw new Error('the strict merge-door fixture did not resolve ruined_anvil@1');
    }
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

describe('game/runStore: typed map-intel receipts cross the event seam', () => {
  it('uses the resolver\'s revealed-band fields, never a scene-local forecast read', () => {
    const source = buildDevEventFixture('feathered_cairn', 1103);
    const { outcome } = resolveEventChoice(source, 'feathered_cairn', 'read_feathers');

    expect(outcome).toEqual({ kind: 'grantMapInfo', bandsAhead: 2, revealedBands: [1, 2] });
    expect(buildRunRewardViewModel(outcome)).toMatchObject({
      headline: 'Map intel updated',
      detail: 'Revealed bands 2–3.',
    });
  });
});

// ---------------------------------------------------------------------------
// SEAM 3 — runStore/scene SOURCE sweep. There is no canvas in this vitest env
// (see `pointerConsumptionAudit.test.ts`), so the scene half of each seam is
// held structurally: the wiring must still BE there.
// ---------------------------------------------------------------------------

const SRC = join(process.cwd(), 'src', 'game');
const EVENT_SCENES = ['scenes/DesktopRunEventScene.ts', 'scenes/MobileRunEventScene.ts'];
const SHOP_SCENES = ['scenes/DesktopShopScene.ts', 'scenes/MobileShopScene.ts'];
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

const RUN_EVENT_OUTCOME_KINDS = {
  grantCard: true,
  grantGem: true,
  grantGold: true,
  loseGold: true,
  grantLevel: true,
  bonusDraft: true,
  upgradeCardPick: true,
  gemChoicePick: true,
  sellGemPick: true,
  sellGem: true,
  upgradeCard: true,
  mergeCardsPick: true,
  grantMapInfo: true,
  nothing: true,
  cardChoice: true,
  upgradeCardTargeted: true,
  gemChoice: true,
  mergeCards: true,
  cardGranted: true,
  cardUpgraded: true,
  alreadySettled: true,
} satisfies Record<RunEventOutcome['kind'], true>;

const RUN_EVENT_OFFER_SELECTION_KINDS = {
  card: true,
  upgrade: true,
  gem: true,
  sellGem: true,
  mergeCards: true,
} satisfies Record<RunEventOfferSelection['kind'], true>;

function staticStringValue(expression: ts.Expression): string | undefined {
  let current = expression;
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return ts.isStringLiteralLike(current) ? current.text : undefined;
}

function objectLiteralKind(node: ts.ObjectLiteralExpression): string | undefined {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name;
    if ((ts.isIdentifier(name) || ts.isStringLiteralLike(name)) && name.text === 'kind') {
      return staticStringValue(property.initializer);
    }
  }
  return undefined;
}

function isDirectCanonicalSelection(node: ts.ObjectLiteralExpression, kind: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(RUN_EVENT_OFFER_SELECTION_KINDS, kind)) return false;
  const parent = node.parent;
  return ts.isCallExpression(parent)
    && parent.arguments[0] === node
    && ts.isIdentifier(parent.expression)
    && parent.expression.text === 'finalizeCurrentRunEventOffer';
}

function sceneMintsRunEventOutcomeLiteral(source: string): boolean {
  const sourceFile = ts.createSourceFile('RunEventScene.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isObjectLiteralExpression(node)) {
      const kind = objectLiteralKind(node);
      if (kind !== undefined
        && Object.prototype.hasOwnProperty.call(RUN_EVENT_OUTCOME_KINDS, kind)
        && !isDirectCanonicalSelection(node, kind)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function withInjectedSceneMember(source: string, member: string): string {
  const classEnd = source.lastIndexOf('}');
  if (classEnd < 0) throw new Error('scene fixture has no class closing brace');
  return `${source.slice(0, classEnd)}\n${member}\n${source.slice(classEnd)}`;
}

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
      const pane = read('ui/RunEventOutcomePane.ts');
      // The shared strategy builds the receipt from the exact picker/answer;
      // the scene commits the answer and passes that receipt back unchanged.
      expect(pane, 'the merge strategy drops the persisted trade receipt').toContain('mergeReceiptForEventPicker(picker, candidate.skillId)');
      expect(src).toContain('this.finalizePicker(finalizeCurrentRunEventOffer(selection), receipt)');
      expect(src).toContain('this.enterOutcome(outcome, run, receipt)');
      expect(src).toContain('this.pane.enter(outcome, run, receipt)');
      expect(pane, 'buildRunRewardViewModel is called without the receipt').toMatch(
        /buildRunRewardViewModel\(state\.outcome, state\.mergeReceipt\)/,
      );
    });

    it(`${scene} finalizes a sellGem pick through the run layer, not by hand`, () => {
      const src = read(scene);
      expect(src).toMatch(/finalizeCurrentRunEventOffer\(\{\s*kind:\s*'sellGem'/);
      expect(src).not.toContain('applyCurrentSellGemPick(');
      expect(src, 'the event scene is selling through the Deck/Bag wrapper again').not.toContain('sellCurrentRunGem');
    });
  }

  /** No file under `src/game` may MINT an `EventOutcome`. Every one of these
   * kinds is a RESOLVED run-layer verdict (what was gained, spent or lost);
   * a scene that builds one is re-implementing a rule the run layer owns —
   * exactly what the `sellGem` duplicate was. Reading `outcome.kind` is
   * untouched by this sweep; only object literals match. */
  it('the ownership ratchet catches a direct scene assignment of an outcome literal', () => {
    const mutated = withInjectedSceneMember(read(EVENT_SCENES[0]!), `
  private mintDirectRegression(): void {
    this.outcome = { kind: 'grantGold', amount: 999 };
  }`);

    expect(sceneMintsRunEventOutcomeLiteral(mutated)).toBe(true);
  });

  it.each([
    ['enterOutcome', 'this.enterOutcome(minted, getActiveRun()!);'],
    ['finalizePicker', 'this.finalizePicker(minted);'],
    ['reward presentation', 'buildRunRewardViewModel(minted);'],
  ])('the ownership ratchet catches a local outcome literal passed to %s', (_sink, use) => {
    const mutated = withInjectedSceneMember(read(EVENT_SCENES[0]!), `
  private mintIndirectRegression(): void {
    const minted: RunEventOutcome = { kind: 'grantGold', amount: 999 };
    ${use}
  }`);

    expect(sceneMintsRunEventOutcomeLiteral(mutated)).toBe(true);
  });

  it('the ownership ratchet allows all five typed selections passed directly to the canonical finalizer', () => {
    const selectionCalls = `
      finalizeCurrentRunEventOffer({ kind: 'card', skillId: 'jab' });
      finalizeCurrentRunEventOffer({ kind: 'upgrade', instanceId: 'card_1' });
      finalizeCurrentRunEventOffer({ kind: 'gem', gemId: 'bramble_sliver' });
      finalizeCurrentRunEventOffer({ kind: 'sellGem', pouchIndex: 0 });
      finalizeCurrentRunEventOffer({ kind: 'mergeCards', skillId: 'jab' });
    `;

    expect(sceneMintsRunEventOutcomeLiteral(selectionCalls)).toBe(false);
  });

  it('no scene mints an EventOutcome literal — resolved outcomes come from src/run only', () => {
    const offenders: string[] = [];
    for (const scene of EVENT_SCENES) {
      if (sceneMintsRunEventOutcomeLiteral(read(scene))) offenders.push(scene);
    }
    expect(offenders).toEqual([]);
  });
});

describe('game seam sweep: tier upgrades are inspectable before commitment', () => {
  it('the shared event picker renders and inspects the resolved destination face while preserving the original pick', () => {
    const src = read('ui/RunRewardPanel.ts');

    expect(src).toContain('tierUpgradePreview(option.skillId, option.from, option.to)');
    expect(src).toMatch(/renderPickableCardRow\([\s\S]*preview\.toSkill[\s\S]*opts\.onPick\(option\)/);
    expect(src).toMatch(/attachCellHoverTip\([\s\S]*preview\.toSkill/);
    expect(src).toMatch(/inspecting\s*=\s*preview\.toSkill/);
    expect(src).toContain('`${option.from.toUpperCase()} → ${option.to.toUpperCase()}`');
  });

  for (const scene of SHOP_SCENES) {
    it(`${scene} warns on the shared conditional preview and offers destination inspect without replacing BUY or MERGE`, () => {
      const src = read(scene);

      expect(src).toMatch(/tierUpgradePreview\(offeredSkillId,\s*mergeTarget\.fromTier,\s*mergeTarget\.toTier\)/);
      expect(src).toContain('if (mergePreview?.conditionalTrade)');
      expect(src).toContain('CONDITIONAL UPGRADE');
      expect(src).toContain('GUARANTEED POWER');
      expect(src).toContain('VIEW ${mergePreview.toSkill.tier.toUpperCase()}');
      expect(src).toMatch(/\{ label: 'BUY',[^}]*fn: doBuy \}/);
      expect(src).toMatch(/\{ label: 'MERGE',[^}]*fn: doMerge \}/);
      expect(src).toContain('this.mergePreviewOpen = true');
      expect(src).toContain('renderCardDetailOverlay(this, mergePreview.toSkill');
      expect(src).toMatch(/this\.renderConfirm\(\);[\s\S]*this\.renderMergePreview\(\);/);
      const profile = scene.includes('Mobile') ? 'MOBILE_PROFILE' : 'DESKTOP_PROFILE';
      expect(src).toContain(`${profile}.minTap, UI.panelMuted`);
    });

    it(`${scene} closes destination inspect back to the unchanged pending confirmation`, () => {
      const src = read(scene);

      expect(src).toMatch(/onClose:\s*\(\)\s*=>\s*\{\s*this\.mergePreviewOpen\s*=\s*false;\s*this\.rerender\(\);\s*\}/);
      expect(src).not.toMatch(/onClose:[^}]*pendingBuy\s*=\s*null/);
    });
  }
});

// ---------------------------------------------------------------------------
// SEAM 4 — the event-chain UI pass (2026-09-02): lock reasons, the recap line,
// discovered rarity, and derived-door family labels. Same posture as SEAM 3
// (no canvas here, so the scene half is held structurally): the run layer
// WORDS these values (`choiceLockReason` / `eventRecapLine` /
// `eventRarityLabel` / `derivedChoiceFamily`,
// src/run/events.ts — see tests/run/events.presenters.test.ts for what they
// say); each sweep below is positioned so that unwiring one of them from
// either scene — the exact both-platforms drift the 2026-08-05 audits caught —
// turns it red.
// ---------------------------------------------------------------------------

describe('game seam sweep: the committed presenter is wired into BOTH event scenes', () => {
  for (const scene of EVENT_SCENES) {
    it(`${scene} renders lock/reward semantics from the committed presentation`, () => {
      const src = read(scene);
      expect(src).toContain('buildRunEventScenePresentation(');
      expect(src).toMatch(/detail:\s*choice\.detail/);
      expect(src).toMatch(/enabled:\s*choice\.enabled/);
      expect(src).not.toContain('choiceLockReason(');
      expect(src).not.toContain('derivedChoiceFamily(');
    });

    it(`${scene} renders recap/body and event metadata from that same presentation`, () => {
      const src = read(scene);
      expect(src).toMatch(/const bodyCopy = event\.body/);
      expect(src).toContain('event.context.rarityLabel');
      expect(src).toContain('event.context.storyStageLabel');
      expect(src).toContain('event.context.visibilityLabel');
      expect(src).toContain('event.context.dueLabel');
      expect(src).not.toContain('eventRecapLine(');
      expect(src).not.toContain('eventRarityLabel(');
      expect(src).not.toContain('event.rarity');
      expect(src).not.toContain('event.requiresAll');
      expect(src).not.toContain('event.biomeIds');
      expect(src).not.toContain('eventRarityEligible(');
      expect(src).not.toContain('eventBiomeEligible(');
    });
  }

  it('DesktopRunEventScene includes the rendered rarity height in its story cursor', () => {
    const src = read('scenes/DesktopRunEventScene.ts');
    expect(src).toMatch(/cursor\s*\+=\s*metadataLabel\.height/);
  });

  it('MobileRunEventScene keeps the rarity in the one-column story flow', () => {
    const src = read('scenes/MobileRunEventScene.ts');
    expect(src).toMatch(/y\s*\+=\s*metadataLabel\.height/);
  });
});

// ---------------------------------------------------------------------------
// SEAM 5 — the "confirm on anything that COSTS" gates (2026-09-06 superseding
// user ruling). Same posture as SEAM 3/4 (no canvas here): the DIALOGS are
// held by `tests/game/unspentPlConfirm.test.ts`'s fake-scene harness; this
// sweep holds the SCENE half — that each scene actually OPENS each gate —
// structurally, positioned so deleting a confirm block from either scene, or
// reintroducing the old board-only merge gate, turns it red.
// ---------------------------------------------------------------------------

describe('game seam sweep: the cost/mergeCards/sellGem confirm gates are wired into BOTH event scenes', () => {
  for (const scene of EVENT_SCENES) {
    it(`${scene} shows the mergeCards confirm UNCONDITIONALLY — no board-only gate`, () => {
      const src = read(scene);
      expect(src).toContain('renderMergeConsumeConfirm(');
      expect(src).toContain('mergeConfirmPreviewForChoice(');
      expect(src, 'the scene re-derived a current-event merge trio instead of using the clicked choice offer')
        .not.toMatch(/\bmergeCardsPreview\(/);
      // The gate this replaced (2026-09-06 superseding ruling: a merge always
      // costs three cards, so the dialog no longer skips a bag-only trade).
      expect(src, 'the old board-only merge gate was reintroduced').not.toMatch(
        /card\.location === 'board'/,
      );
    });

    it(`${scene} refreshes a rejected picker selection from the persisted transaction`, () => {
      const src = read(scene);
      expect(src).toMatch(
        /if \(!outcome\) \{[\s\S]*currentRunEventViewModel\(\)[\s\S]*adoptRecordedResolution\(view, run\)[\s\S]*this\.rerender\(\)/,
      );
      expect(src, 'merge labels were built from board slots without bag/instance identity')
        .toMatch(/buildMergeSpentEntries\(preview\.consumed, run\)/);
    });

    it(`${scene} shows the generic cost confirm for any OTHER rung that costs gold`, () => {
      const src = read(scene);
      expect(src).toContain('renderEventCostConfirm(');
      expect(src).toMatch(/choice\.costConfirm/);
    });

    it(`${scene} shows the sellGem confirm after the specific gem is picked, before it is sold`, () => {
      const src = read(scene);
      expect(src).toContain('renderSellGemConfirm(');
      expect(src).toContain('sellGemConfirmOption');
      // The picker's own onPick no longer finalizes directly — it stores the
      // tapped option and waits for the confirm's own CONFIRM handler.
      expect(read('ui/RunEventOutcomePane.ts')).toContain('onPick: ctx.onSell');
      expect(src).toMatch(/onSell:\s*option\s*=>\s*\{\s*this\.sellGemConfirmOption\s*=\s*option;\s*this\.rerender\(\);\s*\}/);
    });

    it(`${scene} never finalizes a sellGem sale except from the confirm's own CONFIRM handler`, () => {
      const src = read(scene);
      const matches = [...src.matchAll(/finalizeCurrentRunEventOffer\(\{\s*kind:\s*'sellGem'/g)];
      // Exactly one call site: the sellGem confirm's onConfirm in `create()`.
      expect(matches).toHaveLength(1);
    });
  }
});
