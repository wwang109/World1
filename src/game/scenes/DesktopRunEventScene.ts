import Phaser from 'phaser';
import { embeddedEventLayout, positionRunDestination, type EmbeddedRunDestination } from '../ui/RunDestinationHost';
import { eventOutcomePaneTemplate } from '../ui/runRewardGeometry';
import { RunEventOutcomePaneController } from '../ui/RunEventOutcomePane';
import type { MergeCardsReceipt, SellGemOption } from '../../run/events';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, textRole, UI } from '../theme';
import { renderRunChoicePanel, runChoicePanelMinHeight, type RunChoiceViewModel } from '../ui/RunChoicePanel';
import { auditTextBlock } from '../ui/controlLayoutAudit';
import { mergeConfirmBody, sellGemConfirmBody, sellGemConfirmTitle } from '../ui/eventOutcomeText';
import { buildMergeSpentEntries, mergeConfirmPreviewForChoice } from '../ui/runMergeViewModel';
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
import { runScreenLayoutRef } from '../ui/runScreenLayout';
import { rebuildScene } from '../sceneRebuild';
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

const F = DESKTOP_PROFILE.font;
// LIVE reference: every `TEMPLATE.*` read below resolves against the
// CURRENT viewport (the canvas fills the window -- see game/viewport.ts).
const TEMPLATE = runScreenLayoutRef('desktop');

export interface EventChoosingRect { x: number; y: number; width: number; height: number }

export interface DesktopEventChoosingLayout {
  story: EventChoosingRect;
  outcomes: EventChoosingRect;
  outcomeHeader: EventChoosingRect;
  choiceRows: EventChoosingRect[];
}

/** Pure choosing-state geometry. The story and all 2–3 outcomes share one
 * bounded region; the outcome list can therefore never begin below the fold. */
export function desktopEventChoosingLayout(
  content: EventChoosingRect,
  choiceCount: number,
  choiceMinHeight: number,
): DesktopEventChoosingLayout {
  const outerInset = 12;
  const gap = 18;
  const paneHeight = Math.min(620, Math.max(0, content.height - outerInset * 2));
  const y = content.y + Math.max(outerInset, Math.round((content.height - paneHeight) / 2));
  const usableWidth = Math.max(0, content.width - outerInset * 2 - gap);
  const storyWidth = Math.round(usableWidth * 0.4);
  const story = { x: content.x + outerInset, y, width: storyWidth, height: paneHeight };
  const outcomes = {
    x: story.x + story.width + gap,
    y,
    width: usableWidth - storyWidth,
    height: paneHeight,
  };
  const headerHeight = 26;
  const headerGap = 12;
  const rowGap = 10;
  const count = Math.max(1, choiceCount);
  const availableRowsHeight = outcomes.height - headerHeight - headerGap - rowGap * Math.max(0, count - 1) - 18;
  const rowHeight = Math.max(choiceMinHeight, Math.min(150, Math.floor(availableRowsHeight / count)));
  const outcomeHeader = { x: outcomes.x + 18, y: outcomes.y + 16, width: outcomes.width - 36, height: headerHeight };
  const rowX = outcomes.x + 18;
  const rowWidth = outcomes.width - 36;
  const firstRowY = outcomeHeader.y + headerHeight + headerGap;
  const choiceRows = Array.from({ length: choiceCount }, (_, index) => ({
    x: rowX,
    y: firstRowY + index * (rowHeight + rowGap),
    width: rowWidth,
    height: rowHeight,
  }));
  return { story, outcomes, outcomeHeader, choiceRows };
}

/** Desktop Run Event: persistent story/art and one EVENT OUTCOME pane.
 * Choices, all deferred pickers and final receipts reuse the same pane bounds.
 * Compact stacks the story above it with a bounded, scrollable body.
 * Both fresh and re-entered receipts own one pane-local CONTINUE; choosing
 * and picker states have none. Reward mechanics remain in the shared store. */
export class DesktopRunEventScene extends Phaser.Scene {
  private embedded: EmbeddedRunDestination | undefined;
  private readonly pane = new RunEventOutcomePaneController();
  private retireConfirmOpen = false;
  /** See `MobileRunEventScene`'s own field doc — the id of a `mergeCards`
   * choice awaiting its pre-resolution confirm, `null` otherwise. */
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

  constructor() { super('DesktopRunEvent'); }

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
    else this.scene.start('DesktopRunMap');
  }

  create(): void {
    if (!this.embedded) this.cameras.main.setBackgroundColor(UI.bg);
    if (!this.embedded) this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.bg).setOrigin(0, 0);

    const view = currentRunEventViewModel();
    let run = getActiveRun();
    if (!run || !view) {
      // Reached with no active event node (e.g. a stale re-entry) — bounce.
      if (this.embedded) this.embedded.onClose();
      else this.scene.start('DesktopRunMap');
      return;
    }

    if (this.pane.state.kind === 'choices') this.adoptRecordedResolution(view, run);
    run = getActiveRun() ?? run;
    const presentation = buildRunEventScenePresentation(view, run, 'desktop');

    const embeddedLayout = this.embedded ? embeddedEventLayout(this.embedded.bounds, presentation.choices.length, false) : null;
    const layout = embeddedLayout ?? desktopEventChoosingLayout(TEMPLATE.regions.content, presentation.choices.length, runChoicePanelMinHeight(F));
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
      font: F, compact: false, presentation,
      onChoices: () => this.renderChoosing(presentation, layout),
      onContinue: () => this.continueToMap(),
      onFinalize: (selection, receipt) => this.finalizePicker(finalizeCurrentRunEventOffer(selection), receipt),
      onSell: option => { this.sellGemConfirmOption = option; this.rerender(); },
      onChange: () => this.rerender(),
    });
    if (this.retireConfirmOpen) {
      // REVIEWED AND LEFT (audit 2026-08): no scene-level generic pointerdown/pointerup listener at all in this file — grep-confirmed.
      // So `renderRetireConfirm`'s rebuild-on-close can never race a
      // stale-vs-fresh scene-level re-dispatch (see
      // `wasPointerConsumedByRebuild`'s doc comment, sceneRebuild.ts) — the
      // mechanism that guard exists for cannot manifest here. No guard
      // needed. (Contrast `MobileRunEventScene`, which DOES have one — its
      // scroll listener for the event body text.)
      renderRetireConfirm(this, {
        compact: false,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { retireActiveRun(); this.scene.start('DesktopRunMap'); },
      });
    }
    // Same "no scene-level pointer listener" note as RETIRE above — no
    // per-dialog guard needed here either.
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
        this.mergeConfirmChoiceId = null;
      } else {
        const spent = buildMergeSpentEntries(preview.consumed, run);
        renderMergeConsumeConfirm(this, {
          compact: false,
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
          compact: false,
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
        compact: false,
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
   * (`renderChoicePanel`'s `onSelect`). Always rerenders, even when the
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
    if (!view) return;
    if (view.phase.kind === 'open') return;
    if (view.phase.kind === 'pending') {
      const reopened = reopenCurrentRunEventOffer();
      if (reopened && this.enterOutcome(reopened, getActiveRun() ?? run)) return;
    }
    this.pane.settle();
  }

  /** The single semantic adapter used by both fresh choices and exact
   * persisted reopens. `alreadySettled` is deliberately ignored so a stale
   * second tap cannot replace or replay the first committed result. */
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
      compact: false,
      snapshot: snapshotRunProgress(run),
      actions: {
        secondary: { label: 'DECK / BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('DesktopDeck'); } },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
        primary: undefined,
      },
    });
  }

  // ---------- persistent story + replaceable outcome contents ----------

  private renderChoosing(event: RunEventScenePresentation, layout: DesktopEventChoosingLayout): void {
    this.renderChoicePanel(event, layout.outcomes, layout.outcomeHeader, layout.choiceRows);
  }

  private renderStory(event: RunEventScenePresentation, story: EventChoosingRect): void {
    const inset = 18;
    const innerX = story.x + inset;
    const innerW = story.width - inset * 2;
    const storyPanel = this.add.rectangle(story.x, story.y, story.width, story.height, EVENT_REWARD_COLORS.panelAlt, 0.94)
      .setOrigin(0, 0)
      .setStrokeStyle(1, EVENT_REWARD_COLORS.border, 0.72);
    storyPanel.setData('layoutAuditName', 'Desktop event story pane');
    // RUNG 2 (event chains): a chain payoff opens with ONE recap line naming
    // the past this event pays off ("You have spent 14 gold on this road."),
    // worded by the run layer (`eventRecapLine`) off `eventResolutions`/the
    // tally counters. Prepended INSIDE the existing body box so the box's own
    // audited budget absorbs it (a long body shrinks its font within
    // `bodyMaxHeight` exactly as before) and the choice-block reservation math
    // below stays untouched. `null` — the plain body — for every ungated event.
    const bodyCopy = event.body;
    const metadata = [event.context.rarityLabel, event.context.storyStageLabel, event.context.visibilityLabel, event.context.dueLabel]
      .filter((label): label is string => label !== null)
      .join(' · ');

    // Area intro — the stop reads as a place before it reads as a decision.
    const areaLine = this.add.text(
      innerX,
      story.y + inset,
      `${event.context.biomeName} · ${event.context.areaName} — ${event.context.areaBlurb}`,
      {
      fontFamily: FONT.body, fontStyle: 'italic', fontSize: `${F.small}px`, color: EVENT_REWARD_COLORS.textSoft,
      wordWrap: { width: innerW }, lineSpacing: 3,
      },
    );
    auditTextBlock(areaLine, { name: 'Run event area intro', maxWidth: innerW, maxHeight: F.small * 3 + 12, minFontSize: 9 });
    let cursor = story.y + inset + areaLine.height + 12;

    // Real 2:1 event art, large enough to anchor the selected event without
    // consuming the outcome pane's vertical budget.
    const artW = innerW;
    const artH = this.embedded
      ? Math.max(40, Math.min(260, artW * 0.65, story.height * 0.35, story.height - 230))
      : Math.min(220, Math.round(artW * 0.5));
    const artX = innerX;
    const storyArt = addBrightRunArt(
      this,
      eventArtKey(event.context.theme, event.art.kind === 'event' ? event.art.artId : undefined),
      { x: artX, y: cursor, width: artW, height: artH },
      BRIGHT_ART_TREATMENT.story,
    );
    if (event.art.kind === 'event') {
      renderEventArtBorder(this, event.art.kind, { x: artX, y: cursor, width: artW, height: artH });
    } else storyArt.lift.setStrokeStyle(1, EVENT_REWARD_COLORS.border, 0.45);
    cursor += artH + 16;

    // Title and story remain directly below their art in the left pane.
    const title = this.add.text(innerX, cursor, event.title, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: EVENT_REWARD_COLORS.text, wordWrap: { width: innerW },
    });
    auditTextBlock(title, { name: 'Run event title', maxWidth: innerW, maxHeight: F.title * 2, minFontSize: 12 });
    cursor += title.height;
    if (metadata) {
      cursor += 4;
      const metadataLabel = this.add.text(innerX, cursor, metadata, {
        ...textRole('kicker'),
        wordWrap: { width: innerW },
      });
      auditTextBlock(metadataLabel, { name: 'Run event metadata', maxWidth: innerW, maxHeight: F.small * 3, minFontSize: 9 });
      cursor += metadataLabel.height;
      cursor += 10;
    } else {
      cursor += 14;
    }

    const bodyPad = 16;
    const bodyBoxTop = cursor;
    const bodyMaxHeight = Math.max(40, story.y + story.height - inset - bodyBoxTop - bodyPad * 2);
    const bodyBox = this.add.rectangle(story.x, bodyBoxTop, story.width, 10, EVENT_REWARD_COLORS.panelAlt, 0.94).setOrigin(0, 0).setStrokeStyle(2, EVENT_REWARD_COLORS.chip, 0.7);
    const bodyRail = this.add.rectangle(story.x, bodyBoxTop, 6, 10, EVENT_REWARD_COLORS.chip, 0.92).setOrigin(0, 0);
    const body = this.add.text(innerX, bodyBoxTop + bodyPad, bodyCopy, {
      fontFamily: FONT.body, fontSize: `${F.body}px`, color: EVENT_REWARD_COLORS.textDim, wordWrap: { width: innerW }, lineSpacing: 6,
    });
    auditTextBlock(body, { name: 'Run event body', maxWidth: innerW, maxHeight: bodyMaxHeight, minFontSize: 10 });
    const bodyBoxH = this.embedded
      ? Math.max(0, story.y + story.height - bodyBoxTop - inset)
      : Math.min(body.height + bodyPad * 2, story.y + story.height - bodyBoxTop);
    bodyBox.setSize(story.width, bodyBoxH);
    bodyRail.setSize(6, bodyBoxH);
  }

  private renderChoicePanel(
    event: RunEventScenePresentation,
    outcomes: EventChoosingRect,
    outcomeHeader: EventChoosingRect,
    choiceRows: EventChoosingRect[],
  ): void {
    const count = this.add.text(outcomeHeader.x + outcomeHeader.width, outcomeHeader.y, `CHOOSE 1 OF ${event.choices.length}`, {
      ...textRole('kicker'),
      color: UI.textSoft,
    }).setOrigin(1, 0);
    auditTextBlock(count, { name: 'Event outcome choice count', maxWidth: outcomeHeader.width * 0.4, maxHeight: outcomeHeader.height, minFontSize: 9 });

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
          // mergeCards (UNCONDITIONAL, 2026-09-06 user ruling: a merge
          // always costs three cards, so it always pauses here — see
          // MobileRunEventScene's own note).
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
