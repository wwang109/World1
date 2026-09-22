import Phaser from 'phaser';
import { roundRect } from '../ui/roundedRect';
import { positionRunDestination, type EmbeddedRunDestination } from '../ui/RunDestinationHost';
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
  renderEventCostConfirm, renderMergeConsumeConfirm, renderRetireConfirm, renderRunHud,
  renderSellGemConfirm, snapshotRunProgress,
} from '../ui/RunProgressStrip';
import { addBrightRunArt, choiceArtKey, eventArtKey } from '../ui/runArt';
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
  const storyHeight = 96;
  const rowHeight = Math.max(choiceMinHeight,
    (content.height - storyHeight - sectionGap - headerHeight - headerGap - Math.max(0, count - 1) * rowGap) / count);
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
    y: firstRowY + index * (rowHeight + rowGap),
    width: paneWidth,
    height: rowHeight,
  }));
  const outcomeBottom = choiceRows.length > 0
    ? choiceRows[choiceRows.length - 1]!.y + choiceRows[choiceRows.length - 1]!.height
    : outcomeHeader.y + outcomeHeader.height;
  const outcomes = { x, y: outcomeHeader.y, width: paneWidth, height: Math.max(outcomeBottom - outcomeHeader.y, content.y + content.height - outcomeHeader.y) };
  return { story, outcomes, outcomeHeader, choiceRows };
}

/** Mobile Run Event: persistent story/art and one EVENT OUTCOME pane.
 * Choices, all deferred pickers and final receipts reuse the same pane bounds.
 * Compact keeps the story reader separate from the outcome choices.
 * Both fresh and re-entered receipts own one pane-local CONTINUE; choosing
 * and picker states have none. Reward mechanics remain in the shared store. */
export class MobileRunEventScene extends Phaser.Scene {
  private embedded: EmbeddedRunDestination | undefined;
  private W = SCREEN.width;
  private H = SCREEN.height;
  private readonly pane = new RunEventOutcomePaneController();
  private retireConfirmOpen = false;
  private storyOpen = false;
  private storyPage = 0;
  private choicePage = 0;
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
    this.storyOpen = false;
    this.storyPage = 0;
    this.choicePage = 0;
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

    const content = this.embedded
      ? { x: 8, y: 8, width: this.embedded.bounds.width - 16, height: this.embedded.bounds.height - 16 }
      : TEMPLATE.regions.content;
    const minChoiceHeight = runChoicePanelMinHeight(F);
    const allFit = 138 + presentation.choices.length * (minChoiceHeight + 8) <= content.height;
    const pageSize = allFit ? Math.max(1, presentation.choices.length)
      : Math.max(1, Math.floor((content.height - 186) / (minChoiceHeight + 8)));
    const pageCount = Math.max(1, Math.ceil(presentation.choices.length / pageSize));
    this.choicePage = Math.min(this.choicePage, pageCount - 1);
    const shownChoices = presentation.choices.slice(this.choicePage * pageSize, (this.choicePage + 1) * pageSize);
    const layout = mobileEventChoosingLayout({ ...content, height: content.height - (pageCount > 1 ? 48 : 0) }, shownChoices.length, minChoiceHeight);
    const template = this.embedded ? { ...TEMPLATE, canvas: { width: content.width, height: content.height }, regions: { ...TEMPLATE.regions, content } } : TEMPLATE;
    if (this.embedded) {
      this.data.set('embeddedEventOutcomeBounds', layout.outcomes);
      this.embedded.scrollY = 0;
    } else this.data.remove('embeddedEventOutcomeBounds');
    positionRunDestination(this, this.embedded, this.embedded
      ? { x: 0, y: 0, width: this.embedded.bounds.width, height: this.embedded.bounds.height }
      : content);
    if (!this.embedded) this.renderHud(run);
    if (this.storyOpen) {
      this.renderStoryReader(presentation, content);
      this.renderRetirementConfirm();
      return;
    }
    this.renderStory(presentation, layout.story);
    const paneTemplate = eventOutcomePaneTemplate(template, 'icon', layout.outcomes, layout.outcomeHeader);
    renderRunEventOutcomePane(this, paneTemplate);
    this.pane.render({
      scene: this, template, panel: layout.outcomes, header: layout.outcomeHeader,
      font: F, compact: true, presentation,
      onChoices: () => {
        this.renderChoices({ ...presentation, choices: shownChoices }, layout.outcomes, layout.outcomeHeader, layout.choiceRows, presentation.choices.length);
        if (pageCount > 1) this.renderPager(content, this.choicePage, pageCount, (page) => { this.choicePage = page; this.rerender(); });
      },
      onContinue: () => this.continueToMap(),
      onFinalize: (selection, receipt) => this.finalizePicker(finalizeCurrentRunEventOffer(selection), receipt),
      onSell: option => { this.sellGemConfirmOption = option; this.rerender(); },
      onChange: () => this.rerender(),
    });
    this.renderRetirementConfirm();
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

  private renderRetirementConfirm(): void {
    if (!this.retireConfirmOpen) return;
    renderRetireConfirm(this, {
      compact: true,
      onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
      onConfirm: () => { retireActiveRun(); this.scene.start('MobileRunMap'); },
    });
  }

  private storyButton(x: number, y: number, width: number, label: string, onPress: () => void): void {
    const button = roundRect(this.add.rectangle(x, y, width, 40, UI.chipDark), 12).setOrigin(0, 0)
      .setStrokeStyle(1, UI.border, 0.9).setInteractive({ useHandCursor: true });
    this.add.text(x + width / 2, y + 20, label, textRole('label', { ink: 'accent' })).setOrigin(0.5);
    button.on('pointerdown', onPress);
  }

  private renderPager(bounds: MobileEventChoosingRect, page: number, pages: number, onPage: (page: number) => void): void {
    const y = bounds.y + bounds.height - 40;
    const width = Math.min(96, (bounds.width - 100) / 2);
    if (page > 0) this.storyButton(bounds.x, y, width, '‹ PREVIOUS', () => onPage(page - 1));
    if (page + 1 < pages) this.storyButton(bounds.x + bounds.width - width, y, width, 'NEXT ›', () => onPage(page + 1));
    this.add.text(bounds.x + bounds.width / 2, y + 20, `${page + 1} / ${pages}`, textRole('label')).setOrigin(0.5);
  }

  private renderStory(event: RunEventScenePresentation, story: MobileEventChoosingRect): void {
    roundRect(this.add.rectangle(story.x, story.y, story.width, story.height, EVENT_REWARD_COLORS.panelAlt, 0.94), 12).setOrigin(0, 0).setStrokeStyle(1, EVENT_REWARD_COLORS.border, 0.7);
    const title = this.add.text(story.x + 10, story.y + 8, event.title, {
      fontSize: `${F.title}px`, color: EVENT_REWARD_COLORS.text, fontFamily: FONT.display,
      fontStyle: 'bold', wordWrap: { width: story.width - 20 },
    });
    auditTextBlock(title, { name: 'Mobile run event title', maxWidth: story.width - 20, maxHeight: 40, minFontSize: 12 });
    this.storyButton(story.x + 10, story.y + story.height - 48, story.width - 20, 'READ STORY', () => {
      this.storyOpen = true;
      this.storyPage = 0;
      this.rerender();
    });
  }

  private renderStoryReader(event: RunEventScenePresentation, bounds: MobileEventChoosingRect): void {
    const x = bounds.x + 12;
    const width = bounds.width - 24;
    roundRect(this.add.rectangle(bounds.x, bounds.y, bounds.width, bounds.height, EVENT_REWARD_COLORS.panelAlt, 1), 12).setOrigin(0, 0).setStrokeStyle(1, EVENT_REWARD_COLORS.border, 0.7);
    this.storyButton(x, bounds.y + 8, width, '‹ BACK TO EVENT', () => { this.storyOpen = false; this.rerender(); });
    let y = bounds.y + 60;
    const artH = bounds.height >= 440 ? Math.min(110, bounds.height * 0.18) : 0;
    if (artH > 0) {
      const art = addBrightRunArt(this, eventArtKey(event.context.theme, event.art.kind === 'event' ? event.art.artId : undefined),
        { x, y, width, height: artH }, BRIGHT_ART_TREATMENT.story);
      if (event.art.kind === 'event') renderEventArtBorder(this, event.art.kind, { x, y, width, height: artH });
      else art.lift.setStrokeStyle(1, EVENT_REWARD_COLORS.border, 0.4);
      y += artH + 10;
    }
    const metadata = [event.context.rarityLabel, event.context.storyStageLabel, event.context.visibilityLabel, event.context.dueLabel]
      .filter((label): label is string => label !== null).join(' · ');
    const copy = [
      event.title,
      `${event.context.biomeName} · ${event.context.areaName} — ${event.context.areaBlurb}`,
      metadata,
      event.body,
    ].filter(Boolean).join('\n\n');
    const body = this.add.text(x, y, copy, {
      fontSize: `${F.body}px`, color: EVENT_REWARD_COLORS.textDim, fontFamily: FONT.body,
      wordWrap: { width }, lineSpacing: 4,
    });
    const lines = body.getWrappedText(copy);
    const bodyHeight = Math.max(24, bounds.y + bounds.height - 52 - y);
    let pageSize = Math.max(1, Math.floor(bodyHeight / (F.body * 1.4 + 4)));
    body.setText(lines.slice(0, pageSize).join('\n'));
    while (body.height > bodyHeight && pageSize > 1) {
      pageSize -= 1;
      body.setText(lines.slice(0, pageSize).join('\n'));
    }
    const pages = Math.max(1, Math.ceil(lines.length / pageSize));
    this.storyPage = Math.min(this.storyPage, pages - 1);
    body.setText(lines.slice(this.storyPage * pageSize, (this.storyPage + 1) * pageSize).join('\n'));
    this.renderPager(bounds, this.storyPage, pages, (page) => { this.storyPage = page; this.rerender(); });
  }

  private renderChoices(
    event: RunEventScenePresentation,
    outcomes: MobileEventChoosingRect,
    outcomeHeader: MobileEventChoosingRect,
    choiceRows: MobileEventChoosingRect[],
    totalChoices = event.choices.length,
  ): void {
    const count = this.add.text(outcomeHeader.x + outcomeHeader.width, outcomeHeader.y, `CHOOSE 1 OF ${totalChoices}`, {
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
