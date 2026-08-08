import Phaser from 'phaser';
import type { EventChoiceDef, EventDef } from '../../data/events';
import type { DraftCard } from '../../run/draft';
import type { EventOutcome, UpgradeCardOption } from '../../run/events';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { auditTextBlock } from '../ui/controlLayoutAudit';
import { choiceOutcomeHint } from '../ui/eventOutcomeText';
import { eventThemeArea } from '../ui/eventThemeBlurb';
import { renderRunChoicePanel, runChoicePanelMinHeight, type RunChoiceViewModel } from '../ui/RunChoicePanel';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { addRunArt, choiceArtKey, eventArtKey } from '../ui/runArt';
import { renderRunBonusDraftPicker, renderRunRewardPanel, renderRunUpgradeCardPicker } from '../ui/RunRewardPanel';
import { buildRunRewardViewModel } from '../ui/runRewardViewModel';
import { runScreenLayoutRef } from '../ui/runScreenLayout';
import { rebuildScene, wasPointerConsumedByRebuild } from '../sceneRebuild';
import { setDeckBuildContext } from '../deckBuildContext';
import {
  applyCurrentBonusDraftPick,
  applyCurrentUpgradeCardPick,
  currentEventDef,
  getActiveRun,
  leaveCurrentEvent,
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
  private phase: 'choosing' | 'bonusDraftPick' | 'upgradeCardPick' | 'outcome' = 'choosing';
  private outcome: EventOutcome | null = null;
  private bonusDraftCards: DraftCard[] = [];
  private upgradeCardOptions: UpgradeCardOption[] = [];
  private retireConfirmOpen = false;

  constructor() { super('MobileRunEvent'); }

  init(): void {
    this.phase = 'choosing';
    this.outcome = null;
    this.bonusDraftCards = [];
    this.upgradeCardOptions = [];
    this.retireConfirmOpen = false;
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

    this.renderHud(run);
    if (this.phase === 'outcome' && this.outcome) {
      renderRunRewardPanel(this, TEMPLATE, buildRunRewardViewModel(this.outcome), {
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
      });
    } else {
      const story = this.renderStory(event, event.choices.length * (80 + 8) - 8);
      this.renderChoices(run.gold, event, story);
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
        primary: this.phase === 'outcome' && this.outcome
          ? { label: 'CONTINUE ›', onPress: () => this.continueToMap() }
          : undefined,
      },
    });
  }

  // ---------- story (area intro → title → body panel; CHOOSING phase only) ----------

  /** Renders the narrative header (area caption, title, framed body — the
   * body capped + made small-scrollable only if it and `reserveBelowH`
   * together would overflow the content region) for the CHOOSING phase and
   * returns where the choice rows below it should start. */
  private renderStory(event: EventDef, reserveBelowH: number): StoryLayout {
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

  private renderChoices(gold: number, event: EventDef, story: StoryLayout): void {
    let y = story.contentTop;
    // ASK the panel how tall it needs to be; never guess. The old hand-picked
    // 80 was short of its own content, so `detail` collapsed to an ellipsis
    // (see `runChoicePanelMinHeight`) — same bug as desktop's 84.
    const rowH = runChoicePanelMinHeight(F, true);
    const gap = 8;
    event.choices.forEach((choice: EventChoiceDef) => {
      const cost = choice.cost ?? 0;
      const affordable = gold >= cost;
      const costLabel = cost > 0 ? `COST ${cost} GOLD` : 'FREE';
      const model: RunChoiceViewModel = {
        nodeId: `event-${choice.id}`,
        kind: 'event',
        title: choice.label,
        detail: `REWARD · ${choiceOutcomeHint(choice.outcome)}`,
        footer: costLabel,
        image: { textureKey: choiceArtKey(choice.outcome.kind) },
        accent: UI.chip,
        enabled: affordable,
      };
      renderRunChoicePanel(this, { x: 10, y, w: this.W - 20, h: rowH }, model, {
        font: F,
        sfx: cost > 0 ? 'purchase' : 'uiClick',
        onSelect: () => {
          const outcome = resolveCurrentEventChoice(event.id, choice.id);
          if (!outcome) return;
          if (outcome.kind === 'bonusDraft') {
            this.phase = 'bonusDraftPick';
            this.bonusDraftCards = [...outcome.cards];
          } else if (outcome.kind === 'upgradeCardPick') {
            this.phase = 'upgradeCardPick';
            this.upgradeCardOptions = [...outcome.options];
          } else {
            this.phase = 'outcome';
            this.outcome = outcome;
          }
          this.rerender();
        },
      });
      y += rowH + gap;
    });
  }
}
