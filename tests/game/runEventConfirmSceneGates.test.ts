import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cardOfferableAtTier } from '../../src/engine/types';
import { skillBook } from '../../src/data/skills';
import { recordEventInstance } from '../../src/run/eventInstances';
import type { RunBagSlot, RunNode } from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import {
  applyRunDraft, choices, clearRun, currentEventDef, currentRunEventViewModel, getActiveRun,
  installDevRunFixture, pickCurrentStartDraftCard, pickNode, setCurrentRunBagSlots,
  setCurrentRunPieces, startRun,
} from '../../src/game/runStore';

/**
 * THE CONFIRM GATES, DRIVEN BEHAVIOURALLY (2026-09-07 audit fix).
 *
 * `runEventSeams.test.ts`'s SEAM 5 holds the confirm gates by a plain
 * `expect(src).toContain('renderMergeConsumeConfirm(')` string sweep — proven
 * (2026-09-06 audit, `task-unreported-work-review.md` PART B) to survive a
 * mutant that DISABLES the trigger (skips straight to
 * `resolveAndEnter`/`finalizeCurrentRunEventOffer`) while leaving the render
 * call's text intact elsewhere in the file. That is the exact defect class
 * this project has closed before for other surfaces: the source contains the
 * right words, but nothing ever walks the wire that would prove they fire.
 *
 * This file drives the REAL `onSelect` handler `renderChoices`/
 * `renderChoicePanel` (both scenes) register — not a re-implementation of it —
 * by constructing a real `MobileRunEventScene`/`DesktopRunEventScene`
 * instance and feeding it a duck-typed Phaser stub, the same idiom
 * `tests/game/unspentPlConfirm.test.ts`'s `makeFakeScene` established for the
 * dialogs themselves, extended here to cover the row tap that OPENS them.
 *
 * TWO MOCKS make this possible without a real canvas/DOM:
 *
 *   1. `phaser` itself — the two scene files do `class ... extends
 *      Phaser.Scene`, a genuine VALUE dependency (confirmed empirically:
 *      `require('phaser')` throws `window is not defined` in plain Node).
 *      Mocked to a trivial `Scene` base class plus `Math.Clamp` (the one other
 *      real Phaser value either scene touches, inside the mobile scroll
 *      branch this suite never triggers — see the body-length note below).
 *   2. `../ui/RunRewardPanel` — the resolved-outcome/picker renderer. Its own
 *      transitive graph (`CardToken`, `FantasyCardTemplateV2`, hover tips, gem
 *      chips…) pulls in Phaser `Container`-extending classes and geometry
 *      types this suite has no need to stand up: nothing here ever taps a
 *      dialog's own CONFIRM/MERGE button, so the outcome/picker screens are
 *      never reached, and mocking the module out is honest rather than a
 *      workaround (`renderRunRewardPanel` et al. are simply never exercised
 *      by a test whose entire subject is the PRE-resolution pause).
 *
 * Everything else — `RunChoicePanel`, `RunProgressStrip`'s three confirm
 * renderers, `runArt`, `motion`, `controlLayoutAudit`, `statRunStrip`,
 * `runEventScenePresenter`, `runMergeViewModel`, `runStore` — is the REAL
 * production module, imported normally.
 */

// ---------------------------------------------------------------------------
// Mocks (vi.mock calls are hoisted above every import in this file, so the
// physical position here is cosmetic — both apply before the scene modules
// below are ever evaluated).
// ---------------------------------------------------------------------------

vi.mock('phaser', () => ({
  default: {
    Scene: class FakePhaserScene {
      constructor(_config?: unknown) { /* real Phaser.Scene wires plugin injection later; nothing to do here */ }
    },
    Math: { Clamp: (x: number, min: number, max: number) => Math.min(max, Math.max(min, x)) },
  },
}));

vi.mock('../../src/game/ui/RunRewardPanel', () => ({
  EVENT_REWARD_COLORS: { panelAlt: 0x213d4d, border: 0xd5aa55, chip: 0xd5aa55, text: '#fff0c9', textDim: '#d6b77b', textSoft: '#d6b77b' },
  renderRunEventOutcomePane: () => {},
  renderRunBonusDraftPicker: () => {},
  renderRunGemChoicePicker: () => {},
  renderRunMergeCardsPicker: () => {},
  renderRunRewardPanel: () => {},
  renderRunSellGemPicker: () => {},
  renderRunUpgradeCardPicker: () => {},
}));

const { MobileRunEventScene } = await import('../../src/game/scenes/MobileRunEventScene');
const { DesktopRunEventScene } = await import('../../src/game/scenes/DesktopRunEventScene');

// ---------------------------------------------------------------------------
// A minimal, duck-typed Phaser stand-in — just enough surface for `create()`
// to run to completion for these two scenes with a SHORT event body (so the
// mobile small-scroll branch, the one place either scene touches
// `this.make.graphics`/a scene-level `this.input.on(...)` listener, never
// engages — `ruined_anvil`'s authored body is well under any wrap budget).
// Every `add.*` call is tracked in `children`/`rects`/`texts` so `rebuildScene`
// (the real `sceneRebuild.ts`, unmocked) can destroy-and-recreate exactly as
// it does in the browser.
// ---------------------------------------------------------------------------

type Handler = (pointer: unknown) => void;

interface FakeRect {
  x: number; y: number; w: number; h: number; alpha: number;
  displayWidth: number; displayHeight: number;
  interactive: boolean;
  handlers: Map<string, Handler>;
  on(event: string, fn: Handler): FakeRect;
  setOrigin(...args: unknown[]): FakeRect;
  setStrokeStyle(...args: unknown[]): FakeRect;
  setInteractive(...args: unknown[]): FakeRect;
  setDepth(...args: unknown[]): FakeRect;
  setSize(w: number, h: number): FakeRect;
  setData(...args: unknown[]): FakeRect;
  setFillStyle(...args: unknown[]): FakeRect;
  setPosition(x: number, y: number): FakeRect;
  destroy(): void;
}

interface FakeText {
  x: number; y: number; alpha: number;
  content: string;
  width: number; height: number;
  style: { fontSize: string | number };
  setOrigin(...args: unknown[]): FakeText;
  setPosition(x: number, y: number): FakeText;
  setDepth(...args: unknown[]): FakeText;
  setFontSize(size: number): FakeText;
  setText(value: string): FakeText;
  setData(...args: unknown[]): FakeText;
  setVisible(...args: unknown[]): FakeText;
  getWrappedText(t?: string): string[];
  destroy(): void;
  readonly text: string;
}

interface FakeGraphics {
  setName(...args: unknown[]): FakeGraphics;
  lineStyle(...args: unknown[]): FakeGraphics;
  strokeRect(...args: unknown[]): FakeGraphics;
  beginPath(...args: unknown[]): FakeGraphics;
  moveTo(...args: unknown[]): FakeGraphics;
  lineTo(...args: unknown[]): FakeGraphics;
  strokePath(...args: unknown[]): FakeGraphics;
  destroy(): void;
}

function removeFrom<T>(list: T[], item: T): void {
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
}

/** Applies a Phaser-shaped tween config's target properties IMMEDIATELY
 * (rather than animating) — this suite proves topology (which dialog opened,
 * which handler fired), never pixel motion, and CLAUDE.md's own rule is that
 * tweens carry no gameplay decision, so collapsing them to their end state is
 * a faithful simplification, not a shortcut around one. */
function applyTweenTargets(cfg: Record<string, unknown>): void {
  const targets = Array.isArray(cfg.targets) ? cfg.targets : cfg.targets ? [cfg.targets] : [];
  const skip = new Set(['targets', 'duration', 'delay', 'ease', 'onComplete', 'onUpdate', 'yoyo']);
  for (const target of targets) {
    for (const [key, value] of Object.entries(cfg)) {
      if (skip.has(key)) continue;
      (target as Record<string, unknown>)[key] = value;
    }
  }
  (cfg.onComplete as (() => void) | undefined)?.();
}

interface MountedScene {
  instance: { create: () => void; rerender?: () => void } & Record<string, unknown>;
  rects: FakeRect[];
  texts: FakeText[];
}

function mountScene<T extends object>(SceneCtor: new () => T): MountedScene {
  const children: Array<{ destroy: () => void }> = [];
  const rects: FakeRect[] = [];
  const texts: FakeText[] = [];

  function makeRect(x: number, y: number, w: number, h: number): FakeRect {
    const handlers = new Map<string, Handler>();
    const rect: FakeRect = {
      x, y, w, h, alpha: 1, displayWidth: w, displayHeight: h, interactive: false, handlers,
      on(event, fn) { handlers.set(event, fn); return rect; },
      setOrigin() { return rect; },
      setStrokeStyle() { return rect; },
      setInteractive() { rect.interactive = true; return rect; },
      setDepth() { return rect; },
      setSize(nw, nh) { rect.w = nw; rect.h = nh; rect.displayWidth = nw; rect.displayHeight = nh; return rect; },
      setData() { return rect; },
      setFillStyle() { return rect; },
      setPosition(nx, ny) { rect.x = nx; rect.y = ny; return rect; },
      destroy() { removeFrom(children, rect); removeFrom(rects, rect); },
    };
    children.push(rect);
    rects.push(rect);
    return rect;
  }

  function makeText(x: number, y: number, content: string, style: { fontSize?: string | number }): FakeText {
    const text: FakeText = {
      x, y, alpha: 1, content, width: 10, height: 10, style: { fontSize: style.fontSize ?? '10px' },
      get text() { return text.content; },
      setOrigin() { return text; },
      setPosition(nx, ny) { text.x = nx; text.y = ny; return text; },
      setDepth() { return text; },
      setFontSize(size) { text.style.fontSize = `${String(size)}px`; return text; },
      setText(value) { text.content = value; return text; },
      setData() { return text; },
      setVisible() { return text; },
      getWrappedText(t) { return (t ?? text.content).split('\n'); },
      destroy() { removeFrom(children, text); removeFrom(texts, text); },
    } as FakeText;
    children.push(text);
    texts.push(text);
    return text;
  }

  function makeGraphics(): FakeGraphics {
    const g: FakeGraphics = {
      setName() { return g; }, lineStyle() { return g; }, strokeRect() { return g; },
      beginPath() { return g; }, moveTo() { return g; }, lineTo() { return g; }, strokePath() { return g; },
      destroy() { removeFrom(children, g); },
    };
    children.push(g);
    return g;
  }

  function makeContainer(x: number, y: number): { x: number; y: number; add: (c: unknown) => unknown; setMask: () => unknown; setY: (y: number) => void; destroy: () => void } {
    const container = {
      x, y,
      add(_child: unknown) { return container; },
      setMask() { return container; },
      setY(ny: number) { container.y = ny; },
      destroy() { removeFrom(children, container); },
    };
    children.push(container);
    return container;
  }

  const sceneParts = {
    add: {
      rectangle: (x: number, y: number, w: number, h: number) => makeRect(x, y, w, h),
      text: (x: number, y: number, content: string, style: Record<string, unknown> = {}) => makeText(x, y, content, style),
      graphics: () => makeGraphics(),
      container: (x: number, y: number) => makeContainer(x, y),
      image: (x: number, y: number) => makeRect(x, y, 0, 0),
    },
    cameras: { main: { setBackgroundColor: () => {} } },
    tweens: {
      add: (cfg: Record<string, unknown>) => applyTweenTargets(cfg),
      addCounter: (cfg: Record<string, unknown>) => {
        (cfg.onUpdate as ((t: { getValue: () => number }) => void) | undefined)?.({ getValue: () => 1 });
        (cfg.onComplete as (() => void) | undefined)?.();
      },
      killTweensOf: () => {},
      killAll: () => {},
    },
    time: { removeAllEvents: () => {}, delayedCall: () => {} },
    input: {
      activePointer: { event: undefined },
      on: () => {},
      removeAllListeners: () => {},
    },
    textures: { exists: () => false },
    make: { graphics: () => makeGraphics() },
    children: { list: children },
    scene: { start: () => {} },
  };

  const instance = new SceneCtor() as MountedScene['instance'];
  Object.assign(instance, sceneParts);
  return { instance, rects, texts };
}

/** The interactive plate a row's TITLE sits on — geometry, not draw order,
 * same idiom as `unspentPlConfirm.test.ts`'s `plateUnderLabel`. */
function findRowPanel(fake: { texts: FakeText[]; rects: FakeRect[] }, title: string): FakeRect {
  const text = fake.texts.find((t) => t.content === title);
  expect(text, `row titled "${title}" was not drawn`).toBeDefined();
  const hits = fake.rects.filter((r) => (
    r.interactive
    && text!.x >= r.x && text!.x <= r.x + r.w
    && text!.y >= r.y && text!.y <= r.y + r.h
  ));
  expect(hits.length, `no pressable row under "${title}"`).toBeGreaterThan(0);
  return hits.reduce((smallest, r) => (r.w * r.h < smallest.w * smallest.h ? r : smallest));
}

function tapRow(fake: { texts: FakeText[]; rects: FakeRect[] }, title: string): void {
  const panel = findRowPanel(fake, title);
  const handler = panel.handlers.get('pointerdown');
  expect(handler, `row "${title}" has no pointerdown handler`).toBeDefined();
  handler!({ synthetic: true });
}

function textContents(fake: { texts: FakeText[] }): string[] {
  return fake.texts.map((t) => t.content);
}

// ---------------------------------------------------------------------------
// The fixture: `ruined_anvil` (schema-1) has all three shapes this file needs
// on ONE event — `beat_together` (mergeCards), `retemper` (cost 3, non-merge),
// `take_rough` (free) — so one materialization covers every case.
// ---------------------------------------------------------------------------

const BRONZE_SIZE1 = Object.values(skillBook)
  .filter((s) => s.size === 1 && cardOfferableAtTier(s, 'bronze'))
  .map((s) => s.id);

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
  return picks;
}

function draftRunThroughStore(seed: number): void {
  const picks = draftPicksFor(seed);
  for (const key of DRAFT_SET_KEYS) pickCurrentStartDraftCard(key, picks[key]!);
  applyRunDraft();
}

/** Walks the STORE onto a real `ruined_anvil` event node — the same
 * start/draft/pick-node/force-content seam `runEventSeams.test.ts`'s
 * `storeOnEventNode` already uses for this exact event id — then tops up gold
 * and gives the board a bronze trio so all three of `beat_together`
 * (mergeCards, needs the trio), `retemper` (needs 3+ gold) and `take_rough`
 * (free) render ENABLED. */
function storeOnRuinedAnvil(): RunNode {
  for (let seed = 1; seed <= 60; seed += 1) {
    startRun(seed);
    draftRunThroughStore(seed);
    const node = choices().find((n) => n.kind === 'event');
    if (!node) continue;
    pickNode(node.id);
    const active = getActiveRun();
    if (!active) throw new Error('store lost the active run while entering an event node');
    installDevRunFixture(recordEventInstance(active, node.id, {
      eventId: 'ruined_anvil', contentVersion: 1, instanceId: `event:${node.id}`, drawnDepth: node.depth,
    }));
    if (currentEventDef()?.id !== 'ruined_anvil') {
      throw new Error('the strict ruined_anvil fixture did not resolve ruined_anvil@1');
    }
    installDevRunFixture({ ...getActiveRun()!, gold: 10 });
    const bag: RunBagSlot[] = new Array<RunBagSlot>(10).fill(null);
    for (let i = 0; i < 3; i += 1) bag[i] = { instanceId: `card_90${i}`, skillId: BRONZE_SIZE1[i]!, tier: 'bronze' };
    setCurrentRunPieces([]);
    setCurrentRunBagSlots(bag);
    return node;
  }
  throw new Error('no seed in 1..60 offered a wave-1 event node');
}

const MERGE_ROW = 'Beat three matched pieces into one';
const COST_ROW = 'Pay 3 gold to retemper it';
const FREE_ROW = 'Take the rough blade as-is';

beforeAll(() => {
  const cells = new Map<string, string>();
  vi.stubGlobal('window', {
    location: { search: '' },
    localStorage: {
      getItem: (k: string) => cells.get(k) ?? null,
      setItem: (k: string, v: string) => void cells.set(k, v),
      removeItem: (k: string) => void cells.delete(k),
    },
  });
});
afterAll(() => { clearRun(); vi.unstubAllGlobals(); });
afterEach(() => { clearRun(); });

describe('game seam sweep (behavioural): tapping a mergeCards row opens the confirm, on BOTH platforms', () => {
  it('mobile: MERGE — the row does not resolve on its own tap; the confirm carries CANCEL/MERGE only', () => {
    storeOnRuinedAnvil();
    const fake = mountScene(MobileRunEventScene);
    fake.instance.create();
    expect(textContents(fake), 'the confirm rendered before any tap').not.toContain('MERGE — CARDS LEAVE YOUR BOARD');

    tapRow(fake, MERGE_ROW);

    expect(textContents(fake)).toContain('MERGE — CARDS LEAVE YOUR BOARD');
    expect(textContents(fake)).toContain('CANCEL');
    expect(textContents(fake)).toContain('MERGE');
    // Nothing was actually spent — the rung is still open, waiting on the dialog.
    expect(currentRunEventViewModel()!.phase.kind).toBe('open');
  });

  it('desktop: MERGE — same gate, same platform-independent proof', () => {
    storeOnRuinedAnvil();
    const fake = mountScene(DesktopRunEventScene);
    fake.instance.create();
    expect(textContents(fake)).not.toContain('MERGE — CARDS LEAVE YOUR BOARD');

    tapRow(fake, MERGE_ROW);

    expect(textContents(fake)).toContain('MERGE — CARDS LEAVE YOUR BOARD');
    expect(currentRunEventViewModel()!.phase.kind).toBe('open');
  });
});

describe('game seam sweep (behavioural): tapping a cost>0 (non-merge) row opens the generic cost confirm, on BOTH platforms', () => {
  it('mobile: COST — the gold is not spent until CONFIRM', () => {
    storeOnRuinedAnvil();
    const goldBefore = getActiveRun()!.gold;
    const fake = mountScene(MobileRunEventScene);
    fake.instance.create();
    expect(textContents(fake)).not.toContain('SPEND 3 GOLD?');

    tapRow(fake, COST_ROW);

    expect(textContents(fake)).toContain('SPEND 3 GOLD?');
    expect(textContents(fake)).toContain('CANCEL');
    expect(textContents(fake)).toContain('CONFIRM');
    expect(getActiveRun()!.gold, 'gold moved before CONFIRM was ever pressed').toBe(goldBefore);
    expect(currentRunEventViewModel()!.phase.kind).toBe('open');
  });

  it('desktop: COST — same gate, same proof (this is the exact B3g mutant\'s platform)', () => {
    storeOnRuinedAnvil();
    const goldBefore = getActiveRun()!.gold;
    const fake = mountScene(DesktopRunEventScene);
    fake.instance.create();
    expect(textContents(fake)).not.toContain('SPEND 3 GOLD?');

    tapRow(fake, COST_ROW);

    expect(textContents(fake)).toContain('SPEND 3 GOLD?');
    expect(getActiveRun()!.gold).toBe(goldBefore);
    expect(currentRunEventViewModel()!.phase.kind).toBe('open');
  });
});

describe('game seam sweep (behavioural): a FREE row never pauses on a confirm, on BOTH platforms', () => {
  it('mobile: tapping the free rung resolves immediately — no dialog, real state change', () => {
    storeOnRuinedAnvil();
    const fake = mountScene(MobileRunEventScene);
    fake.instance.create();

    tapRow(fake, FREE_ROW);

    expect(textContents(fake)).not.toContain('MERGE — CARDS LEAVE YOUR BOARD');
    expect(textContents(fake).some((c) => c.startsWith('SPEND '))).toBe(false);
    // The choice actually resolved through the real run layer — a locked-open
    // rung would still read 'open'.
    expect(currentRunEventViewModel()!.phase.kind).toBe('terminal');
  });

  it('desktop: same — free stays one tap', () => {
    storeOnRuinedAnvil();
    const fake = mountScene(DesktopRunEventScene);
    fake.instance.create();

    tapRow(fake, FREE_ROW);

    expect(textContents(fake)).not.toContain('MERGE — CARDS LEAVE YOUR BOARD');
    expect(currentRunEventViewModel()!.phase.kind).toBe('terminal');
  });
});

/**
 * `sellGemConfirmOption` — the sellGem PICKER's own field (set by its
 * `onPick`, per `runEventSeams.test.ts` SEAM 5's own source pin). The picker
 * itself renders through the mocked `RunRewardPanel` (see the module doc
 * above for why), so this proves the narrower, still-real claim: `create()`'s
 * OWN render block for this field is reachable and shows the right dialog —
 * the exact thing B3d's mutant ("sellGem-confirm render unreachable") named.
 * Setting the field directly is the same trigger the picker's real `onPick`
 * uses (`this.sellGemConfirmOption = option; this.rerender();`); it is not
 * standing in for a claim about the picker's own wiring, which SEAM 5's
 * source pin already covers.
 */
describe('game seam sweep (behavioural): the sellGem picker\'s own confirm block renders, on BOTH platforms', () => {
  it('mobile: setting sellGemConfirmOption (as the picker\'s onPick does) renders SELL/CANCEL, not an instant sale', () => {
    storeOnRuinedAnvil();
    const fake = mountScene(MobileRunEventScene);
    fake.instance.create();
    (fake.instance as unknown as { sellGemConfirmOption: unknown }).sellGemConfirmOption =
      { pouchIndex: 0, gemId: 'bramble_sliver', price: 2 };
    fake.instance.create();

    expect(textContents(fake)).toContain('SELL BRAMBLE SLIVER?');
    expect(textContents(fake)).toContain('+2 GOLD');
    expect(textContents(fake)).toContain('SELL');
    expect(textContents(fake)).toContain('CANCEL');
  });

  it('desktop: same block, same proof', () => {
    storeOnRuinedAnvil();
    const fake = mountScene(DesktopRunEventScene);
    fake.instance.create();
    (fake.instance as unknown as { sellGemConfirmOption: unknown }).sellGemConfirmOption =
      { pouchIndex: 0, gemId: 'bramble_sliver', price: 2 };
    fake.instance.create();

    expect(textContents(fake)).toContain('SELL BRAMBLE SLIVER?');
    expect(textContents(fake)).toContain('SELL');
  });
});
