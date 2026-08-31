import Phaser from 'phaser';
import type { EventChoiceDef, EventDef } from '../../data/events';
import type { DraftCard } from '../../run/draft';
import { isEventChoiceUsable, type EventOutcome, type MergeCardsReceipt, type SellGemOption, type UpgradeCardOption } from '../../run/events';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { auditTextBlock } from '../ui/controlLayoutAudit';
import { choiceOutcomeHint } from '../ui/eventOutcomeText';
import { eventThemeArea } from '../ui/eventThemeBlurb';
import { renderRunChoicePanel, runChoicePanelMinHeight, type RunChoiceViewModel } from '../ui/RunChoicePanel';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { addRunArt, choiceArtKey, eventArtKey } from '../ui/runArt';
import { renderRunBonusDraftPicker, renderRunGemChoicePicker, renderRunMergeCardsPicker, renderRunRewardPanel, renderRunSellGemPicker, renderRunUpgradeCardPicker } from '../ui/RunRewardPanel';
import { buildRunMergeViewModel, type RunMergeViewModel } from '../ui/runMergeViewModel';
import { buildRunRewardViewModel } from '../ui/runRewardViewModel';
import { eventChoiceBlockHeight } from '../ui/runEventStoryLayout';
import { runScreenLayoutRef } from '../ui/runScreenLayout';
import { rebuildScene, wasPointerConsumedByRebuild } from '../sceneRebuild';
import { setDeckBuildContext } from '../deckBuildContext';
import {
  applyCurrentBonusDraftPick,
  applyCurrentGemChoicePick,
  applyCurrentMergeCardsPick,
  applyCurrentSellGemPick,
  applyCurrentUpgradeCardPick,
  currentEventDef,
  currentEventResolution,
  currentRunPieces,
  getActiveRun,
  leaveCurrentEvent,
  reopenCurrentEventPick,
  resolveCurrentEventChoice,
  retireActiveRun,
} from '../runStore';

const F = MOBILE_PROFILE.font;
// LIVE reference: every `TEMPLATE.*` read below resolves against the
// CURRENT viewport (the canvas fills the window -- see game/viewport.ts).
const TEMPLATE = runScreenLayoutRef('mobile');

/** The one flowing story column the CHOOSING phase renders into — computed
 * ONCE by `renderStory` off the event's actual theme/title/body. Once a
 * choice resolves (`outcome`/`bonusDraftPick`), the story column is REPLACED
 * by the reward template (`RunRewardPanel.ts`'s `renderRunRewardPanel`/
 * `renderRunBonusDraftPicker`) rather than shown alongside it — see the
 * module doc for why. */
interface StoryLayout { innerX: number; innerW: number; contentTop: number }

/**
 * Mobile Run Event — the vertical counterpart of `DesktopRunEventScene`: a
 * single top-down story page (area-intro caption → title → body panel) while
 * CHOOSING, stacked above the choice rows. Once a choice resolves, the screen
 * switches to the ONE reward template every outcome kind shares
 * (`RunRewardPanel.ts`'s `renderRunRewardPanel`, driven by
 * `buildRunRewardViewModel`) or, for a `bonusDraft`/`upgradeCardPick`
 * outcome, that same module's `renderRunBonusDraftPicker`/
 * `renderRunUpgradeCardPicker` — the SAME shared renderers
 * `DesktopRunEventScene` calls (this used to be a hand-rolled per-scene
 * stacked-row layout that had drifted from desktop's centered row; it is now
 * one implementation). All three read `TEMPLATE.contentSlots.reward`'s
 * declared rects (`panel` a hard ceiling, `headline`/`feature` sub-rects)
 * instead of the story column, so a card, a gem, or a 5-card draft/upgrade
 * grid always fits by construction. The `outcome` phase's CONTINUE lives
 * ONLY in the HUD's fixed footer primary slot (`renderHud` below) —
 * `RunRewardPanel.ts` no longer
 * draws a second one into its own `buttons` row on mobile (task #33,
 * 2026-08-07: the two used to stack a thumb's-width apart, calling the exact
 * same handler). Reachable at ?scene=mrunevent.
 */
export class MobileRunEventScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private phase: 'choosing' | 'resolved' | 'bonusDraftPick' | 'upgradeCardPick' | 'gemChoicePick' | 'sellGemPick' | 'mergeCardsPick' | 'outcome' = 'choosing';
  private outcome: EventOutcome | null = null;
  private bonusDraftCards: DraftCard[] = [];
  private upgradeCardOptions: UpgradeCardOption[] = [];
  private gemChoiceOptions: string[] = [];
  private sellGemOptions: SellGemOption[] = [];
  /** The PENDING merge trade, built once when the offer arrives (while the run
   * state is still the one the offer was derived from, so the board slots it
   * names are the slots the player is looking at) and held across rebuilds like
   * every other picker's options. Null in every other phase. */
  private mergeOffer: RunMergeViewModel | null = null;
  /** The TAKEN merge's receipt (`applyCurrentMergeCardsPick`'s `merged`), held
   * beside `outcome` for the outcome phase and null for every outcome that is
   * not a merge. It is what lets the resolved screen name the three cards the
   * anvil ate — a merge resolves to a plain `grantCard`, so the outcome alone
   * cannot tell "a card arrived" apart from "three cards were destroyed to make
   * this one". Held as SCENE STATE, not re-derived: by the time this renders,
   * the cards it names are already gone from the run. */
  private mergeReceipt: MergeCardsReceipt | null = null;
  /** The rung this node ALREADY took, adopted from `RunState.eventResolutions`
   * when the screen is re-entered on a resolved node (`adoptRecordedResolution`
   * below); `null` while the choice is still open. Read only by the
   * `'resolved'` phase, to mark which of the rows was the one taken. */
  private resolvedChoiceId: string | null = null;
  private retireConfirmOpen = false;
  /** Which grid index is under the ⓘ inspect overlay in the bonus-draft/
   * upgrade-card picker, `null` when closed — mirrors `MobileDraftScene`'s
   * own `detailSkillId` (state lives on the scene; `RunRewardPanel.ts`'s
   * pickers stay stateless renderers of whichever index this says is
   * inspected). Separate fields (not one shared index) because the two
   * pickers' arrays are indexed independently and only one phase is ever
   * active at a time, but a stale index surviving a phase switch should
   * never silently reappear against the WRONG array. */
  private inspectedDraftIndex: number | null = null;
  private inspectedUpgradeIndex: number | null = null;
  /** Same per-picker inspect index for the MERGE picker's three candidates —
   * its own field for the same reason the two above are separate: only one
   * phase is ever live, but a stale index must never reappear against another
   * picker's array. */
  private inspectedMergeIndex: number | null = null;

  constructor() { super('MobileRunEvent'); }

  init(): void {
    this.phase = 'choosing';
    this.outcome = null;
    this.bonusDraftCards = [];
    this.upgradeCardOptions = [];
    this.gemChoiceOptions = [];
    this.sellGemOptions = [];
    this.mergeOffer = null;
    this.mergeReceipt = null;
    this.resolvedChoiceId = null;
    this.retireConfirmOpen = false;
    this.inspectedDraftIndex = null;
    this.inspectedUpgradeIndex = null;
    this.inspectedMergeIndex = null;
  }

  private rerender(): void { rebuildScene(this); }

  private continueToMap(): void { leaveCurrentEvent(); this.scene.start('MobileRunMap'); }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);

    const run = getActiveRun();
    const event = currentEventDef();
    if (!run || !event) {
      this.scene.start('MobileRunMap');
      return;
    }

    // A RETURN TRIP, NOT A FRESH ARRIVAL: `init()` just reset `phase` to
    // 'choosing', so ask the RUN whether this node's rungs were already
    // taken before offering them again (see `adoptRecordedResolution`).
    if (this.phase === 'choosing') this.adoptRecordedResolution();

    this.renderHud(run);
    if (this.phase === 'outcome' && this.outcome) {
      renderRunRewardPanel(this, TEMPLATE, buildRunRewardViewModel(this.outcome, this.mergeReceipt ?? undefined), {
        font: F,
        eventTitle: event.title,
        onContinue: () => this.continueToMap(),
      });
    } else if (this.phase === 'bonusDraftPick') {
      renderRunBonusDraftPicker(this, TEMPLATE, this.bonusDraftCards, {
        font: F,
        eventTitle: event.title,
        onPick: (card) => {
          const outcome = applyCurrentBonusDraftPick(card);
          if (!outcome) return;
          this.phase = 'outcome';
          this.outcome = outcome;
          this.rerender();
        },
        inspectedIndex: this.inspectedDraftIndex,
        onInspect: (index) => { this.inspectedDraftIndex = index; this.rerender(); },
      });
    } else if (this.phase === 'upgradeCardPick') {
      renderRunUpgradeCardPicker(this, TEMPLATE, this.upgradeCardOptions, {
        font: F,
        eventTitle: event.title,
        onPick: (option) => {
          const outcome = applyCurrentUpgradeCardPick(option.instanceId);
          if (!outcome) return;
          this.phase = 'outcome';
          this.outcome = outcome;
          this.rerender();
        },
        inspectedIndex: this.inspectedUpgradeIndex,
        onInspect: (index) => { this.inspectedUpgradeIndex = index; this.rerender(); },
      });
    } else if (this.phase === 'gemChoicePick') {
      renderRunGemChoicePicker(this, TEMPLATE, this.gemChoiceOptions, {
        font: F,
        eventTitle: event.title,
        onPick: (gemId) => {
          const outcome = applyCurrentGemChoicePick(gemId);
          if (!outcome) return;
          this.phase = 'outcome';
          this.outcome = outcome;
          this.rerender();
        },
      });
    } else if (this.phase === 'sellGemPick') {
      renderRunSellGemPicker(this, TEMPLATE, this.sellGemOptions, {
        font: F,
        eventTitle: event.title,
        // The run layer builds the `sellGem` outcome (`applySellGemPick`, via
        // the store), not this scene — the sale price and the gem it names are
        // ONE rule owned in ONE place, the same way every other picker here
        // finalizes. `option.pouchIndex` is an index this same phase just
        // rendered from the offer, and nothing between the offer and this tap
        // can touch the pouch (leaving for DECK / BAG restarts the scene, which
        // resets `phase` and re-resolves), so the finalizer's defensive throw
        // on a stale index is unreachable from here.
        onPick: (option) => {
          const outcome = applyCurrentSellGemPick(option.pouchIndex);
          if (!outcome) return;
          this.phase = 'outcome';
          this.outcome = outcome;
          this.rerender();
        },
      });
    } else if (this.phase === 'mergeCardsPick' && this.mergeOffer) {
      renderRunMergeCardsPicker(this, TEMPLATE, this.mergeOffer, {
        font: F,
        eventTitle: event.title,
        // BOTH halves of what the finalizer returned are kept: the outcome
        // (a plain `grantCard`) AND the RECEIPT naming the three cards it
        // cost. Dropping the receipt here is the whole bug this wiring closed.
        onPick: (candidate) => {
          const result = applyCurrentMergeCardsPick(candidate.skillId);
          if (!result) return;
          this.phase = 'outcome';
          this.outcome = result.outcome;
          this.mergeReceipt = result.merged ?? null;
          this.mergeOffer = null;
          this.rerender();
        },
        inspectedIndex: this.inspectedMergeIndex,
        onInspect: (index) => { this.inspectedMergeIndex = index; this.rerender(); },
      });
    } else {
      const story = this.renderStory(event, event.choices.length);
      this.renderChoices(run, event, story);
    }
    if (this.retireConfirmOpen) {
      // CORRECTED (audit 2026-08): unlike its RunPrep/RunMap siblings, THIS
      // scene DOES register a scene-level generic pointerdown/pointermove/
      // pointerup/wheel listener — conditionally, only when the event body
      // text is long enough to need the small-scroll idiom (see the
      // `this.input.on('pointerdown', …)` block inside `renderStory` below).
      // So `renderRetireConfirm`'s rebuild-on-close COULD race that
      // listener's stale-vs-fresh scene-level re-dispatch (see
      // `wasPointerConsumedByRebuild`'s doc comment, sceneRebuild.ts). It's
      // covered: that listener's FIRST line is
      // `wasPointerConsumedByRebuild(this, p)`, and it guards ANY
      // `rerender()`-calling handler in this scene automatically — including
      // this RETIRE dialog's — since both close through the same
      // `rebuildScene()` stamp. No PER-DIALOG guard is needed here, but the
      // scene-level listener existing at all is the reason one is needed
      // somewhere, which is not true of its five siblings.
      renderRetireConfirm(this, {
        compact: true,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { retireActiveRun(); this.scene.start('MobileRunMap'); },
      });
    }
  }

  /**
   * THE RE-ENTRY GUARD. `init()` above rebuilds this screen's phase from
   * nothing on every `scene.start` — the HUD's own DECK/BAG button is one, and
   * so is a page reload — so the only thing that can remember a rung was
   * already taken is the RUN, not this scene. `RunState.eventResolutions` is
   * that memory (see `resolveEventChoice`, src/run/events.ts); without it the
   * same node re-resolved every time the player came back, which is a
   * repeatable free-gold loop on a paying rung and a second charge on a paid
   * one.
   *
   * Two returns are possible. A rung whose outcome was DEFERRED and never
   * picked (`pending`) re-opens ITS picker, free of charge — the player paid
   * for that question and has not been answered yet. Anything else shows the
   * node as done: the rungs render locked, with the one that was taken named,
   * and CONTINUE › is the only action.
   */
  private adoptRecordedResolution(): void {
    const resolution = currentEventResolution();
    if (!resolution) return;
    this.resolvedChoiceId = resolution.choiceId;
    if (resolution.pending) {
      const outcome = reopenCurrentEventPick();
      if (outcome) {
        this.enterOutcome(outcome);
        return;
      }
    }
    this.phase = 'resolved';
  }

  /** The ONE place an `EventOutcome` becomes a screen phase — used by the rung
   * the player just tapped AND by a picker re-opened on re-entry, so the two
   * can never disagree about which outcome kinds still owe the player a pick.
   * The scene reads `outcome.kind`; it never mints one (see
   * `tests/game/runEventSeams.test.ts`). */
  private enterOutcome(outcome: EventOutcome): void {
    if (outcome.kind === 'bonusDraft') {
      this.phase = 'bonusDraftPick';
      this.bonusDraftCards = [...outcome.cards];
    } else if (outcome.kind === 'upgradeCardPick') {
      this.phase = 'upgradeCardPick';
      this.upgradeCardOptions = [...outcome.options];
    } else if (outcome.kind === 'gemChoicePick') {
      this.phase = 'gemChoicePick';
      this.gemChoiceOptions = [...outcome.options];
    } else if (outcome.kind === 'sellGemPick') {
      this.phase = 'sellGemPick';
      this.sellGemOptions = [...outcome.options];
    } else if (outcome.kind === 'mergeCardsPick') {
      // The offer is a QUESTION — nothing has been consumed yet, and the view
      // model is built against the board as it stands right now so the three
      // "BOARD n" labels point at the slots the player can see.
      this.phase = 'mergeCardsPick';
      this.mergeOffer = buildRunMergeViewModel(outcome, currentRunPieces());
    } else {
      this.phase = 'outcome';
      this.outcome = outcome;
    }
  }

  /** THE run HUD — identical header on every run screen. The HUD's fixed
   * footer CONTINUE › is the ONLY continue action once the outcome resolves
   * (`renderRunRewardPanel` draws no in-panel one on mobile — see its module
   * doc, task #33) — no dead footer slot while `choosing`/`bonusDraftPick`,
   * which correctly show none. */
  private renderHud(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    renderRunHud(this, {
      screen: 'EVENT',
      compact: true,
      snapshot: snapshotRunProgress(run),
      actions: {
        secondary: { label: 'DECK/BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('MobileDeckBuild'); } },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
        // 'resolved' gets one too: a node the player is only revisiting has
        // nothing left to tap but the way out.
        primary: (this.phase === 'outcome' && this.outcome) || this.phase === 'resolved'
          ? { label: 'CONTINUE ›', onPress: () => this.continueToMap() }
          : undefined,
      },
    });
  }

  // ---------- story (area intro → title → body panel; CHOOSING phase only) ----------

  /** Renders the narrative header (area caption, title, framed body — the
   * body capped + made small-scrollable only if it and `choiceCount`'s own
   * reserved footprint together would overflow the content region) for the
   * CHOOSING phase and returns where the choice rows below it should start.
   *
   * `choiceCount` (not a pre-computed height) so the reserve is always the
   * SAME formula `renderChoices` below actually lays rows out with
   * (`runChoicePanelMinHeight(F)` × count + gaps) — this used to be a
   * hand-picked `count * (80 + 8) - 8` that under-counted the real ~90px row
   * height by 20-30px per screen (2026-08-19 audit alongside the desktop
   * sibling's off-canvas "FREE" label bug), silently giving the body more
   * scroll budget than it should have and letting the last choice row's
   * footer text sit UNDER the fixed bottom action bar rather than fully
   * above it. */
  private renderStory(event: EventDef, choiceCount: number): StoryLayout {
    const rowH = runChoicePanelMinHeight(F);
    const rowGap = 8;
    const reserveBelowH = eventChoiceBlockHeight(choiceCount, rowH, rowGap);
    const innerX = 12;
    const innerW = this.W - 24;
    let y = TEMPLATE.regions.content.y;

    const area = eventThemeArea(event.theme);
    const areaLine = this.add.text(innerX, y, `${area.name} — ${area.blurb}`, {
      fontSize: `${F.tiny}px`, color: UI.textSoft, fontFamily: FONT.body, fontStyle: 'italic',
      wordWrap: { width: innerW }, lineSpacing: 2,
    });
    auditTextBlock(areaLine, { name: 'Mobile run event area intro', maxWidth: innerW, maxHeight: F.tiny * 4 + 8, minFontSize: 8 });
    y += areaLine.height + 8;

    const artH = Math.round(innerW * 0.5);
    addRunArt(this, eventArtKey(event.theme), { x: innerX, y, width: innerW, height: artH }, 0.9);
    this.add.rectangle(innerX, y, innerW, artH, 0x0b1420, 0.16).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.4);
    y += artH + 10;

    const title = this.add.text(innerX, y, event.title, {
      fontSize: `${F.title}px`, color: UI.text, fontFamily: FONT.display, fontStyle: 'bold', wordWrap: { width: innerW },
    });
    auditTextBlock(title, { name: 'Mobile run event title', maxWidth: innerW, maxHeight: F.title * 2, minFontSize: 12 });
    y += title.height + 8;

    const bodyPad = 12;
    const bodyBoxTop = y;
    const bodyBox = this.add.rectangle(0, bodyBoxTop, this.W, 10, UI.panel, 0.9).setOrigin(0, 0).setStrokeStyle(1, UI.chip, 0.6);
    const bodyContainer = this.add.container(innerX, bodyBoxTop + bodyPad);
    const body = this.add.text(0, 0, event.body, {
      fontSize: `${F.body}px`, color: UI.textDim, fontFamily: FONT.body, wordWrap: { width: innerW }, lineSpacing: 4,
    });
    bodyContainer.add(body);
    // Width-overflow guard only — height is handled by the scroll idiom below
    // (req: cap the panel and scroll rather than shrinking under the 9px floor).
    auditTextBlock(body, { name: 'Mobile run event body', maxWidth: innerW, maxHeight: 6000, minFontSize: 9 });

    const naturalH = body.height;
    // Everything below the stats/badge/actions band, above the fixed footer —
    // the CHOOSING phase's choice rows sit in `content`, not the reward
    // template's `panel` (that's only entered once a choice resolves).
    const maxBottom = TEMPLATE.regions.footer.y - 10;
    const budget = Math.max(70, maxBottom - bodyBoxTop - 14 - reserveBelowH);
    const boxInnerBudget = budget - bodyPad * 2;

    let boxH: number;
    if (naturalH > boxInnerBudget && boxInnerBudget > 30) {
      boxH = boxInnerBudget + bodyPad * 2;
      // The SAME small-scroll idiom as `cardInfoBox`/the deck-build gem pouch:
      // mask + pointerdown/move/up + wheel, gated by its own hit-test.
      const maskShape = this.make.graphics({}, false);
      maskShape.fillStyle(0xffffff);
      maskShape.fillRect(innerX, bodyBoxTop + bodyPad, innerW, boxInnerBudget);
      bodyContainer.setMask(maskShape.createGeometryMask());
      const maxScroll = Math.max(0, naturalH - boxInnerBudget);
      let scrollY = 0;
      let dragging = false;
      let startY = 0;
      let startScroll = 0;
      const inBox = (px: number, py: number): boolean => (
        px >= innerX && px <= innerX + innerW && py >= bodyBoxTop && py <= bodyBoxTop + boxH
      );
      this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
        // See `wasPointerConsumedByRebuild` (sceneRebuild.ts) — RETIRE/DECK
        // actions in the HUD (and the choice rows themselves) call
        // `rerender()` from their own pointerdown handler.
        if (wasPointerConsumedByRebuild(this, p)) return;
        if (!inBox(p.worldX, p.worldY)) return;
        dragging = true; startY = p.worldY; startScroll = scrollY;
      });
      this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!dragging) return;
        scrollY = Phaser.Math.Clamp(startScroll + (p.worldY - startY), -maxScroll, 0);
        bodyContainer.setY(bodyBoxTop + bodyPad + scrollY);
      });
      // Trivial today (just clears the local `dragging` flag), but `pointerup`
      // gets the same two-phase re-dispatch risk as `pointerdown` — see
      // `wasPointerConsumedByRebuild`'s doc comment — so it is guarded on the
      // same terms as its sibling above rather than being a silent exception.
      this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (wasPointerConsumedByRebuild(this, p)) return;
        dragging = false;
      });
      this.input.on('wheel', (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
        if (!inBox(pointer.worldX, pointer.worldY)) return;
        scrollY = Phaser.Math.Clamp(scrollY - dy, -maxScroll, 0);
        bodyContainer.setY(bodyBoxTop + bodyPad + scrollY);
      });
    } else {
      boxH = naturalH + bodyPad * 2;
    }
    bodyBox.setSize(this.W, boxH);

    y = bodyBoxTop + boxH + 14;
    return { innerX, innerW, contentTop: y };
  }

  // ---------- choosing ----------

  private renderChoices(run: NonNullable<ReturnType<typeof getActiveRun>>, event: EventDef, story: StoryLayout): void {
    let y = story.contentTop;
    // ASK the panel how tall it needs to be; never guess. The old hand-picked
    // 80 was short of its own content, so `detail` collapsed to an ellipsis
    // (see `runChoicePanelMinHeight`) — same bug as desktop's 84.
    const rowH = runChoicePanelMinHeight(F);
    const gap = 8;
    event.choices.forEach((choice: EventChoiceDef, choiceIndex: number) => {
      const cost = choice.cost ?? 0;
      // `isEventChoiceUsable` (not the bare `gold >= cost` this used to be) —
      // a `sellGem` choice also needs SOMETHING in the pouch to sell (see
      // that function's doc comment, src/run/events.ts); every other outcome
      // kind still reduces to the plain cost check.
      const affordable = isEventChoiceUsable(run, choice);
      const costLabel = cost > 0 ? `COST ${cost} GOLD` : 'FREE';
      // RESOLVED (`adoptRecordedResolution`): the rungs are still drawn, but as
      // the RECORD of a decision already made — every row locked (the shared
      // panel's own affordance then reads LOCKED and drops its handler), the
      // one that was taken named and accented. A resolved node that showed a
      // fresh-looking choice screen is the whole bug.
      const done = this.phase === 'resolved';
      const taken = done && choice.id === this.resolvedChoiceId;
      const model: RunChoiceViewModel = {
        nodeId: `event-${choice.id}`,
        kind: 'event',
        title: choice.label,
        detail: `${taken ? 'TAKEN' : 'REWARD'} · ${choiceOutcomeHint(choice.outcome)}`,
        footer: done ? (taken ? 'ALREADY TAKEN' : 'NOT TAKEN') : costLabel,
        image: { textureKey: choiceArtKey(choice.outcome.kind) },
        accent: taken ? UI.good : UI.chip,
        enabled: !done && affordable,
      };
      renderRunChoicePanel(this, { x: 10, y, w: this.W - 20, h: rowH }, model, {
        font: F,
        sfx: cost > 0 ? 'purchase' : 'uiClick',
        // Staggered fade-and-rise, so the options assemble down the screen
        // instead of all snapping in at once. BOTH platforms opt in — the
        // both-platforms rule; the shared panel does the actual animating.
        appearIndex: choiceIndex,
        onSelect: () => {
          const outcome = resolveCurrentEventChoice(event.id, choice.id);
          if (!outcome) return;
          this.enterOutcome(outcome);
          this.rerender();
        },
      });
      y += rowH + gap;
    });
  }
}
