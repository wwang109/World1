import Phaser from 'phaser';
import { embeddedEventLayout, positionRunDestination, type EmbeddedRunDestination } from '../ui/RunDestinationHost';
import { eventOutcomePaneTemplate } from '../ui/runRewardGeometry';
import { RunEventOutcomePaneController } from '../ui/RunEventOutcomePane';
import type { MergeCardsReceipt, SellGemOption } from '../../run/events';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, textRole, UI } from '../theme';
import { auditTextBlock } from '../ui/controlLayoutAudit';
import { mergeConfirmBody, sellGemConfirmBody, sellGemConfirmTitle } from '../ui/eventOutcomeText';
import { buildMergeSpentEntries, mergeConfirmPreviewForChoice } from '../ui/runMergeViewModel';
import { renderRunChoicePanel, runChoicePanelMinHeight, type RunChoiceViewModel } from '../ui/RunChoicePanel';
import {
  renderEventCostConfirm, renderMergeConsumeConfirm, renderRetireConfirm, renderRunHud, renderSellGemConfirm,
  snapshotRunProgress,
} from '../ui/RunProgressStrip';
import { addBrightRunArt, addRunArt, choiceArtKey, eventArtKey } from '../ui/runArt';
import { renderEventArtBorder } from '../ui/eventArtBorder';
import { BRIGHT_ART_TREATMENT } from '../ui/brightArtTreatment';
import { EVENT_REWARD_COLORS, renderRunEventOutcomePane } from '../ui/RunRewardPanel';
import {
  buildRunEventScenePresentation,
  type RunEventScenePresentation,
} from '../ui/runEventScenePresenter';
import { eventBodyScrollLayout, eventBodyScrollThumb } from '../ui/runEventStoryLayout';
import { runScreenLayoutRef } from '../ui/runScreenLayout';
import { rebuildScene, wasPointerConsumedByRebuild } from '../sceneRebuild';
import { setDeckBuildContext } from '../deckBuildContext';
import {
  currentRunEventViewModel,
  finalizeCurrentRunEventOffer,
  getActiveRun,
  leaveCurrentEvent,
  reopenCurrentRunEventOffer,
  resolveCurrentRunEventChoice,
  retireActiveRun,
  type RunEventOutcome,
} from '../runStore';

const F = MOBILE_PROFILE.font;
// LIVE reference: every `TEMPLATE.*` read below resolves against the
// CURRENT viewport (the canvas fills the window -- see game/viewport.ts).
const TEMPLATE = runScreenLayoutRef('mobile');

export interface MobileEventChoosingRect { x: number; y: number; width: number; height: number }

export interface MobileEventChoosingLayout {
  story: MobileEventChoosingRect;
  outcomes: MobileEventChoosingRect;
  outcomeHeader: MobileEventChoosingRect;
  choiceRows: MobileEventChoosingRect[];
}

/** Compact reflow of the desktop hierarchy: story first, then the complete
 * outcome group. Width is capped on square windows so art does not grow tall
 * enough to push a third outcome under the fixed footer. */
export function mobileEventChoosingLayout(
  content: MobileEventChoosingRect,
  choiceCount: number,
  choiceMinHeight: number,
): MobileEventChoosingLayout {
  const paneWidth = Math.min(660, content.width);
  const x = content.x + Math.round((content.width - paneWidth) / 2);
  const sectionGap = 12;
  const headerHeight = 22;
  const headerGap = 8;
  const rowGap = 8;
  const count = Math.max(1, choiceCount);
  const choiceBlockHeight = count * choiceMinHeight + Math.max(0, count - 1) * rowGap;
  const storyHeight = Math.max(
    250,
    content.height - sectionGap - Math.max(390, headerHeight + headerGap + choiceBlockHeight),
  );
  const story = { x, y: content.y, width: paneWidth, height: storyHeight };
  const outcomeHeader = {
    x,
    y: story.y + story.height + sectionGap,
    width: paneWidth,
    height: headerHeight,
  };
  const firstRowY = outcomeHeader.y + headerHeight + headerGap;
  const choiceRows = Array.from({ length: choiceCount }, (_, index) => ({
    x,
    y: firstRowY + index * (choiceMinHeight + rowGap),
    width: paneWidth,
    height: choiceMinHeight,
  }));
  const outcomeBottom = choiceRows.length > 0
    ? choiceRows[choiceRows.length - 1]!.y + choiceRows[choiceRows.length - 1]!.height
    : outcomeHeader.y + outcomeHeader.height;
  const outcomes = { x, y: outcomeHeader.y, width: paneWidth, height: Math.max(outcomeBottom - outcomeHeader.y, content.y + content.height - outcomeHeader.y) };
  return { story, outcomes, outcomeHeader, choiceRows };
}

/** Mobile Run Event: persistent story/art and one EVENT OUTCOME pane.
 * Choices, all deferred pickers and final receipts reuse the same pane bounds.
 * Compact stacks the story above it with a bounded, scrollable body.
 * Both fresh and re-entered receipts own one pane-local CONTINUE; choosing
 * and picker states have none. Reward mechanics remain in the shared store. */
export class MobileRunEventScene extends Phaser.Scene {
  private embedded: EmbeddedRunDestination | undefined;
  private W = SCREEN.width;
  private H = SCREEN.height;
  private readonly pane = new RunEventOutcomePaneController();
  private retireConfirmOpen = false;
  /** The id of a `mergeCards` choice the player just tapped and has not yet
   * confirmed, `null` otherwise. The rebuilt confirm resolves this id back to
   * the exact choice-local persisted offer (or the legacy live preview) and
   * validates every recorded card location. This is a PRE-resolution pause:
   * nothing is recorded in
   * `RunState` while it is open, so CANCEL needs only to clear it and
   * `resolveCurrentRunEventChoice` is not called until CONFIRM. */
  private mergeConfirmChoiceId: string | null = null;
  /** The id of a rung awaiting its generic "SPEND N GOLD?" pre-resolution
   * confirm (`choice.costConfirm`), `null` otherwise — same shape as
   * `mergeConfirmChoiceId` above, for every OTHER cost>0 outcome kind. */
  private costConfirmChoiceId: string | null = null;
  /** The `sellGem` option the player just tapped in its picker, awaiting its
   * own pre-finalize confirm, `null` otherwise — set only from
   * the shared pane's sell callback; nothing is sold until it is
   * confirmed. */
  private sellGemConfirmOption: SellGemOption | null = null;

  constructor() { super('MobileRunEvent'); }

  init(data?: { embedded?: EmbeddedRunDestination }): void {
    this.embedded = data?.embedded;
    this.pane.reset();
    this.retireConfirmOpen = false;
    this.mergeConfirmChoiceId = null;
    this.costConfirmChoiceId = null;
    this.sellGemConfirmOption = null;
  }

  private rerender(): void { rebuildScene(this); this.embedded?.onChanged(); }

  private continueToMap(): void {
    leaveCurrentEvent();
    if (this.embedded) this.embedded.onClose();
    else this.scene.start('MobileRunMap');
  }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    if (!this.embedded) this.cameras.main.setBackgroundColor(UI.bg);

    const view = currentRunEventViewModel();
    let run = getActiveRun();
    if (!run || !view) {
      if (this.embedded) this.embedded.onClose();
      else this.scene.start('MobileRunMap');
      return;
    }

    if (this.pane.state.kind === 'choices') this.adoptRecordedResolution(view, run);
    run = getActiveRun() ?? run;
    const presentation = buildRunEventScenePresentation(view, run, 'mobile');

    const embeddedLayout = this.embedded ? embeddedEventLayout(this.embedded.bounds, presentation.choices.length, true) : null;
    const layout = embeddedLayout ?? mobileEventChoosingLayout(TEMPLATE.regions.content, presentation.choices.length, runChoicePanelMinHeight(F));
    const content = embeddedLayout?.content ?? TEMPLATE.regions.content;
    const template = embeddedLayout ? { ...TEMPLATE, canvas: { width: content.width, height: content.height }, regions: { ...TEMPLATE.regions, content } } : TEMPLATE;
    if (this.embedded) {
      this.data.set('embeddedEventOutcomeBounds', layout.outcomes);
      if (this.costConfirmChoiceId || this.mergeConfirmChoiceId || this.sellGemConfirmOption) {
        this.embedded.scrollY = Math.max(0, layout.outcomes.y);
      }
    } else this.data.remove('embeddedEventOutcomeBounds');
    positionRunDestination(this, this.embedded, content);
    if (!this.embedded) this.renderHud(run);
    this.renderStory(presentation, layout.story);
    const paneTemplate = eventOutcomePaneTemplate(template, 'icon', layout.outcomes, layout.outcomeHeader);
    renderRunEventOutcomePane(this, paneTemplate);
    this.pane.render({
      scene: this, template, panel: layout.outcomes, header: layout.outcomeHeader,
      font: F, compact: true, presentation,
      onChoices: () => this.renderChoosing(presentation, layout),
      onContinue: () => this.continueToMap(),
      onFinalize: (selection, receipt) => this.finalizePicker(finalizeCurrentRunEventOffer(selection), receipt),
      onSell: option => { this.sellGemConfirmOption = option; this.rerender(); },
      onChange: () => this.rerender(),
    });
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
    // Same pointer-consumption note as RETIRE above applies here too — this
    // scene's conditional scroll listener guards ANY `rerender()`-calling
    // dialog, this one included, so no per-dialog guard is needed.
    if (this.mergeConfirmChoiceId !== null) {
      const choiceId = this.mergeConfirmChoiceId;
      // UNCONDITIONAL (2026-09-06 user ruling): a merge always costs three
      // cards, so it always shows this confirm. V3 reads the exact clicked
      // choice's persisted offer; legacy keeps its live preview.
      const choice = view.choices.find((candidate) => candidate.id === choiceId);
      const preview = choice === undefined
        ? null
        : mergeConfirmPreviewForChoice(choice.outcomeHint, run);
      if (!preview) {
        // The live trio vanished between the tap and this render (e.g. a
        // reload landed here with a since-changed board) — nothing to
        // confirm against, so close silently rather than show an empty box.
        this.mergeConfirmChoiceId = null;
      } else {
        const spent = buildMergeSpentEntries(preview.consumed, run);
        renderMergeConsumeConfirm(this, {
          compact: true,
          body: mergeConfirmBody(preview.from, preview.to, spent),
          onCancel: () => { this.mergeConfirmChoiceId = null; this.rerender(); },
          onConfirm: () => { this.mergeConfirmChoiceId = null; this.resolveAndEnter(choiceId); },
        });
      }
    }
    // Any OTHER rung whose outcome costs gold (`choice.costConfirm`) pauses
    // the same way — see `renderEventCostConfirm`'s doc comment.
    if (this.costConfirmChoiceId !== null) {
      const choiceId = this.costConfirmChoiceId;
      const choice = presentation.choices.find((candidate) => candidate.id === choiceId);
      if (!choice || !choice.costConfirm) {
        this.costConfirmChoiceId = null;
      } else {
        const { costConfirm } = choice;
        renderEventCostConfirm(this, {
          compact: true,
          title: costConfirm.title,
          body: costConfirm.body,
          onCancel: () => { this.costConfirmChoiceId = null; this.rerender(); },
          onConfirm: () => { this.costConfirmChoiceId = null; this.resolveAndEnter(choiceId); },
        });
      }
    }
    // The `sellGem` picker's own pre-finalize confirm — see
    // `renderSellGemConfirm`'s doc comment for why this sits here (the
    // picker's `onPick`) rather than before the picker opens.
    if (this.sellGemConfirmOption !== null) {
      const option = this.sellGemConfirmOption;
      renderSellGemConfirm(this, {
        compact: true,
        title: sellGemConfirmTitle(option.gemId),
        body: sellGemConfirmBody(option.price),
        onCancel: () => { this.sellGemConfirmOption = null; this.rerender(); },
        onConfirm: () => {
          this.sellGemConfirmOption = null;
          const outcome = finalizeCurrentRunEventOffer({ kind: 'sellGem', pouchIndex: option.pouchIndex });
          if (!outcome) { this.rerender(); return; }
          const active = getActiveRun();
          if (!active || !this.enterOutcome(outcome, active)) { this.rerender(); return; }
          this.rerender();
        },
      });
    }
  }

  /** Resolves `choiceId` through the run layer and enters whatever it comes
   * back with (a picker or a terminal outcome) — the shared tail of every
   * confirm dialog's CONFIRM handler above, and of a free rung's direct tap
   * (`renderChoices`'s `onSelect`). Always rerenders, even when the
   * resolve/enter fails, so a dialog this closes never leaves a stale frame
   * behind. */
  private resolveAndEnter(choiceId: string): void {
    const outcome = resolveCurrentRunEventChoice(choiceId);
    if (outcome) {
      const run = getActiveRun();
      if (run) this.enterOutcome(outcome, run);
    }
    this.rerender();
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
   * node as settled: its committed choice receipt stays in the same outcome
   * pane, and CONTINUE › is the only action.
   */
  private adoptRecordedResolution(
    view: NonNullable<ReturnType<typeof currentRunEventViewModel>>,
    run: NonNullable<ReturnType<typeof getActiveRun>>,
  ): void {
    if (view.phase.kind === 'open') return;
    if (view.phase.kind === 'pending') {
      const reopened = reopenCurrentRunEventOffer();
      if (reopened && this.enterOutcome(reopened, getActiveRun() ?? run)) return;
    }
    this.pane.settle();
  }

  private enterOutcome(
    outcome: RunEventOutcome,
    run: NonNullable<ReturnType<typeof getActiveRun>>,
    receipt?: MergeCardsReceipt,
  ): boolean {
    return this.pane.enter(outcome, run, receipt);
  }

  private finalizePicker(outcome: RunEventOutcome | undefined, receipt?: MergeCardsReceipt): void {
    if (!outcome) {
      const view = currentRunEventViewModel();
      const run = getActiveRun();
      if (view && run) this.adoptRecordedResolution(view, run);
      this.rerender();
      return;
    }
    const run = getActiveRun();
    if (!run || !this.enterOutcome(outcome, run, receipt)) return;
    this.rerender();
  }

  /** Normal run chrome; CONTINUE belongs only to the outcome receipt pane. */
  private renderHud(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    renderRunHud(this, {
      screen: 'EVENT',
      compact: true,
      snapshot: snapshotRunProgress(run),
      actions: {
        secondary: { label: 'DECK/BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('MobileDeckBuild'); } },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
        primary: undefined,
      },
    });
  }

  // ---------- persistent story + replaceable outcome contents ----------

  private renderChoosing(event: RunEventScenePresentation, layout: MobileEventChoosingLayout): void {
    this.renderChoices(event, layout.outcomes, layout.outcomeHeader, layout.choiceRows);
  }

  private renderStory(event: RunEventScenePresentation, story: MobileEventChoosingRect): void {
    // RUNG 2 (event chains): a chain payoff opens with ONE recap line naming
    // the past this event pays off ("You have spent 14 gold on this road."),
    // worded by the run layer (`eventRecapLine`) off `eventResolutions`/the
    // tally counters. Prepended INSIDE the existing body box so the box's own
    // height budget absorbs it (here it caps + scrolls exactly like a long
    // body) and the choice-block reservation math above stays untouched.
    // `null` — the plain body — for every ungated event.
    const bodyCopy = event.body;
    const metadata = [event.context.rarityLabel, event.context.storyStageLabel, event.context.visibilityLabel, event.context.dueLabel]
      .filter((label): label is string => label !== null)
      .join(' · ');
    const inset = 10;
    const innerX = story.x + inset;
    const innerW = story.width - inset * 2;
    this.add.rectangle(story.x, story.y, story.width, story.height, EVENT_REWARD_COLORS.panelAlt, 0.94)
      .setOrigin(0, 0)
      .setStrokeStyle(1, EVENT_REWARD_COLORS.border, 0.7)
      .setData('layoutAuditName', 'Compact event story pane');
    let y = story.y + inset;

    const areaLine = this.add.text(
      innerX,
      y,
      `${event.context.biomeName} · ${event.context.areaName} — ${event.context.areaBlurb}`,
      {
      fontSize: `${F.tiny}px`, color: EVENT_REWARD_COLORS.textSoft, fontFamily: FONT.body, fontStyle: 'italic',
      wordWrap: { width: innerW }, lineSpacing: 2,
      },
    );
    auditTextBlock(areaLine, { name: 'Mobile run event area intro', maxWidth: innerW, maxHeight: F.tiny * 4 + 8, minFontSize: 8 });
    y += areaLine.height + 8;

    const artH = this.embedded ? Math.min(150, innerW * 0.5, story.height * 0.32) : Math.min(140, Math.round(innerW * 0.5));
    const storyArt = addBrightRunArt(
      this,
      eventArtKey(event.context.theme, event.art.kind === 'event' ? event.art.artId : undefined),
      { x: innerX, y, width: innerW, height: artH },
      BRIGHT_ART_TREATMENT.story,
    );
    if (event.art.kind === 'event') {
      renderEventArtBorder(this, event.art.kind, { x: innerX, y, width: innerW, height: artH });
    } else storyArt.lift.setStrokeStyle(1, EVENT_REWARD_COLORS.border, 0.4);
    y += artH + 10;

    const title = this.add.text(innerX, y, event.title, {
      fontSize: `${F.title}px`, color: EVENT_REWARD_COLORS.text, fontFamily: FONT.display, fontStyle: 'bold', wordWrap: { width: innerW },
    });
    auditTextBlock(title, { name: 'Mobile run event title', maxWidth: innerW, maxHeight: F.title * 2, minFontSize: 12 });
    y += title.height;
    if (metadata) {
      y += 3;
      const metadataLabel = this.add.text(innerX, y, metadata, {
        ...textRole('kicker'),
        wordWrap: { width: innerW },
      });
      auditTextBlock(metadataLabel, { name: 'Mobile run event metadata', maxWidth: innerW, maxHeight: F.tiny * 3, minFontSize: 8 });
      y += metadataLabel.height;
      y += 7;
    } else {
      y += 8;
    }

    const bodyPad = 12;
    const bodyBoxTop = y;
    const bodyBox = this.add.rectangle(story.x, bodyBoxTop, story.width, 10, EVENT_REWARD_COLORS.panelAlt, 0.9).setOrigin(0, 0).setStrokeStyle(1, EVENT_REWARD_COLORS.chip, 0.6);
    const bodyContainer = this.add.container(innerX, bodyBoxTop + bodyPad);
    const body = this.add.text(0, 0, bodyCopy, {
      fontSize: `${F.body}px`, color: EVENT_REWARD_COLORS.textDim, fontFamily: FONT.body, wordWrap: { width: innerW }, lineSpacing: 4,
    });
    bodyContainer.add(body);
    // Width-overflow guard only — height is handled by the scroll idiom below
    // (req: cap the panel and scroll rather than shrinking under the 9px floor).
    auditTextBlock(body, { name: 'Mobile run event body', maxWidth: innerW, maxHeight: 6000, minFontSize: 9 });

    const naturalH = body.height;
    const bodyLineSpacing = 4;
    const bodyLineCount = body.getWrappedText(bodyCopy).length;
    // The story owns a fixed bounded slice; overflow scrolls inside that
    // slice and cannot displace the outcome group below it.
    const maxBottom = story.y + story.height;
    const budget = Math.max(70, maxBottom - bodyBoxTop);
    const boxInnerBudget = budget - bodyPad * 2;

    let boxH: number;
    if (naturalH > boxInnerBudget && boxInnerBudget > 30) {
      const scrollLayout = eventBodyScrollLayout(
        naturalH,
        boxInnerBudget,
        bodyLineCount,
        bodyLineSpacing,
      );
      const viewportH = scrollLayout.viewportHeight;
      boxH = viewportH + bodyPad * 2;
      // The SAME small-scroll idiom as `cardInfoBox`/the deck-build gem pouch:
      // a complete-line mask, persistent track/thumb affordance, and
      // pointerdown/move/up + wheel gated by its own hit-test.
      const maskShape = this.make.graphics({}, false);
      maskShape.fillStyle(0xffffff);
      maskShape.fillRect(innerX, bodyBoxTop + bodyPad, innerW, viewportH);
      bodyContainer.setMask(maskShape.createGeometryMask());
      const maxScroll = scrollLayout.maxScroll;
      let scrollY = 0;
      let dragging = false;
      let startY = 0;
      let startScroll = 0;
      const trackX = story.x + story.width - 5;
      const trackY = bodyBoxTop + bodyPad;
      this.add.rectangle(trackX, trackY, 3, viewportH, EVENT_REWARD_COLORS.border, 0.28).setOrigin(0.5, 0);
      const initialThumb = eventBodyScrollThumb(viewportH, viewportH, naturalH, 0);
      const thumb = this.add.rectangle(trackX, trackY, 4, initialThumb.height, EVENT_REWARD_COLORS.chip, 0.95).setOrigin(0.5, 0);
      const applyScroll = (next: number): void => {
        const clamped = Phaser.Math.Clamp(next, -maxScroll, 0);
        const snapped = Phaser.Math.Clamp(
          -Math.round((-clamped) / scrollLayout.lineAdvance) * scrollLayout.lineAdvance,
          -maxScroll,
          0,
        );
        scrollY = snapped;
        bodyContainer.setY(bodyBoxTop + bodyPad + scrollY);
        const thumbGeometry = eventBodyScrollThumb(viewportH, viewportH, naturalH, -scrollY);
        thumb.setY(trackY + thumbGeometry.offset);
      };
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
        applyScroll(startScroll + (p.worldY - startY));
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
        applyScroll(scrollY - dy);
      });
    } else {
      boxH = naturalH + bodyPad * 2;
    }
    bodyBox.setSize(story.width, Math.min(boxH, maxBottom - bodyBoxTop));
  }

  private renderChoices(
    event: RunEventScenePresentation,
    outcomes: MobileEventChoosingRect,
    outcomeHeader: MobileEventChoosingRect,
    choiceRows: MobileEventChoosingRect[],
  ): void {
    const count = this.add.text(outcomeHeader.x + outcomeHeader.width, outcomeHeader.y, `CHOOSE 1 OF ${event.choices.length}`, {
      ...textRole('kicker'),
      color: UI.textSoft,
    }).setOrigin(1, 0);
    auditTextBlock(count, { name: 'Compact event outcome choice count', maxWidth: outcomes.width * 0.4, maxHeight: outcomeHeader.height, minFontSize: 8 });

    event.choices.forEach((choice, choiceIndex: number) => {
      const row = choiceRows[choiceIndex];
      if (!row) return;
      const model: RunChoiceViewModel = {
        nodeId: `event-${choice.id}`,
        kind: 'event',
        title: choice.title,
        detail: choice.detail,
        footer: choice.footer,
        image: { textureKey: choiceArtKey(choice.iconKind) },
        accent: choice.taken ? UI.good : UI.chip,
        enabled: choice.enabled,
      };
      renderRunChoicePanel(this, { x: row.x, y: row.y, w: row.width, h: row.height }, model, {
        font: F,
        sfx: choice.cost > 0 ? 'purchase' : 'uiClick',
        onSelect: () => {
          // mergeCards (UNCONDITIONAL, 2026-09-06 user ruling: a merge always
          // costs three cards, so it always pauses here) gets a confirm
          // PAUSE before `resolveCurrentRunEventChoice` is ever called.
          // The rebuilt confirm reads this exact choice's persisted V3 offer
          // and validates its recorded locations before rendering.
          if (choice.iconKind === 'mergeCards') {
            this.mergeConfirmChoiceId = choice.id;
            this.rerender();
            return;
          } else if (choice.costConfirm) {
            // Any OTHER rung whose outcome costs gold pauses the same way —
            // see `renderEventCostConfirm`'s doc comment (RunProgressStrip.ts).
            this.costConfirmChoiceId = choice.id;
            this.rerender();
            return;
          }
          this.resolveAndEnter(choice.id);
        },
      });
    });
  }
}
