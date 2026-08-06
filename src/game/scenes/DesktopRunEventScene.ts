import Phaser from 'phaser';
import type { EventChoiceDef, EventDef } from '../../data/events';
import type { DraftCard } from '../../run/draft';
import type { EventOutcome } from '../../run/events';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { renderRunChoicePanel, runChoicePanelMinHeight, type RunChoiceViewModel } from '../ui/RunChoicePanel';
import { auditTextBlock } from '../ui/controlLayoutAudit';
import { choiceOutcomeHint } from '../ui/eventOutcomeText';
import { eventThemeArea } from '../ui/eventThemeBlurb';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { addRunArt, choiceArtKey, eventArtKey } from '../ui/runArt';
import { renderRunBonusDraftPicker, renderRunRewardPanel } from '../ui/RunRewardPanel';
import { buildRunRewardViewModel } from '../ui/runRewardViewModel';
import { runScreenTemplate } from '../ui/runScreenTemplate';
import { rebuildScene } from '../sceneRebuild';
import { setDeckBuildContext } from '../deckBuildContext';
import {
  applyCurrentBonusDraftPick,
  currentEventDef,
  getActiveRun,
  leaveCurrentEvent,
  resolveCurrentEventChoice,
  retireActiveRun,
} from '../runStore';

const F = DESKTOP_PROFILE.font;
const TEMPLATE = runScreenTemplate('desktop');

/** The one flowing story column the CHOOSING phase renders into — computed
 * ONCE by `renderStory` off the event's actual theme/title/body. Once a
 * choice resolves (`outcome`/`bonusDraftPick`), the story column is REPLACED
 * by the reward template (`RunRewardPanel.ts`'s `renderRunRewardPanel`/
 * `renderRunBonusDraftPicker`) rather than shown alongside it — see the
 * module doc for why. */
interface StoryLayout { px: number; pw: number; innerX: number; innerW: number; contentTop: number }

/**
 * Desktop Run Event — a single top-down STORY PAGE for a `event` map node
 * (docs/run-events-design.md §4) while CHOOSING: area-intro caption
 * (`eventThemeArea`) → title → body (in its own framed panel) → the 2-3
 * choice rows. Once a choice resolves, the screen switches to the ONE reward
 * template every outcome kind shares (`RunRewardPanel.ts`'s
 * `renderRunRewardPanel`, driven by `buildRunRewardViewModel`) or, for a
 * `bonusDraft` outcome, that same module's `renderRunBonusDraftPicker` — the
 * SAME shared renderer `MobileRunEventScene` calls, not a per-scene copy.
 * Both read `TEMPLATE.contentSlots.reward`'s declared rects (`panel` a hard
 * ceiling, `headline`/`feature` sub-rects, `buttons` a fixed bottom-anchored
 * row reserved BEFORE the panel gets space) instead of the story column, so a
 * card, a gem, or a 5-card draft grid always fits by construction — see
 * `runScreenTemplate.ts`'s doc comment on `reward`. Reachable at
 * ?scene=desktop-runevent.
 */
export class DesktopRunEventScene extends Phaser.Scene {
  private phase: 'choosing' | 'bonusDraftPick' | 'outcome' = 'choosing';
  private outcome: EventOutcome | null = null;
  private bonusDraftCards: DraftCard[] = [];
  private retireConfirmOpen = false;

  constructor() { super('DesktopRunEvent'); }

  init(): void {
    this.phase = 'choosing';
    this.outcome = null;
    this.bonusDraftCards = [];
    this.retireConfirmOpen = false;
  }

  private rerender(): void { rebuildScene(this); }

  private continueToMap(): void { leaveCurrentEvent(); this.scene.start('DesktopRunMap'); }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.bg);
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.bg).setOrigin(0, 0);

    const run = getActiveRun();
    const event = currentEventDef();
    if (!run || !event) {
      // Reached with no active event node (e.g. a stale re-entry) — bounce.
      this.scene.start('DesktopRunMap');
      return;
    }

    this.renderHud(run);
    if (this.phase === 'outcome' && this.outcome) {
      renderRunRewardPanel(this, TEMPLATE, buildRunRewardViewModel(this.outcome), {
        font: F,
        onContinue: () => this.continueToMap(),
      });
    } else if (this.phase === 'bonusDraftPick') {
      renderRunBonusDraftPicker(this, TEMPLATE, this.bonusDraftCards, {
        font: F,
        onPick: (card) => {
          const outcome = applyCurrentBonusDraftPick(card);
          if (!outcome) return;
          this.phase = 'outcome';
          this.outcome = outcome;
          this.rerender();
        },
      });
    } else {
      const story = this.renderStory(event);
      this.renderChoicePanel(run.gold, event, story);
    }
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
  }

  /** THE run HUD — identical header on every run screen. The HUD's own
   * CONTINUE › (top-right, this screen's primary go-forward action) still
   * fires once the outcome resolves — same handler as `renderRunRewardPanel`'s
   * own CONTINUE button, so whichever one the player reaches for both do the
   * same thing. */
  private renderHud(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    renderRunHud(this, {
      screen: 'EVENT',
      compact: false,
      snapshot: snapshotRunProgress(run),
      actions: {
        secondary: { label: 'DECK / BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('DesktopDeck'); } },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
        primary: this.phase === 'outcome' && this.outcome
          ? { label: 'CONTINUE ›', onPress: () => this.continueToMap() }
          : undefined,
      },
    });
  }

  private panelGeometry(): { px: number; py: number; pw: number } {
    const pw = 760;
    const px = (SCREEN.width - pw) / 2;
    const py = TEMPLATE.regions.content.y + 10;
    return { px, py, pw };
  }

  // ---------- story (area intro → title → body panel; CHOOSING phase only) ----------

  /** Renders the narrative header (area caption, title, framed body) for the
   * CHOOSING phase and returns where the choice rows below it should start. */
  private renderStory(event: EventDef): StoryLayout {
    const { px, py, pw } = this.panelGeometry();
    const inset = 32;
    const innerX = px + inset;
    const innerW = pw - inset * 2;

    // 1. Area intro — a small atmospheric caption ABOVE the title, so the
    // stop reads as a PLACE before it reads as a decision.
    const area = eventThemeArea(event.theme);
    const areaLine = this.add.text(innerX, py, `${area.name} — ${area.blurb}`, {
      fontFamily: FONT.body, fontStyle: 'italic', fontSize: `${F.small}px`, color: UI.textSoft,
      wordWrap: { width: innerW }, lineSpacing: 3,
    });
    auditTextBlock(areaLine, { name: 'Run event area intro', maxWidth: innerW, maxHeight: F.small * 3 + 12, minFontSize: 9 });
    let cursor = py + areaLine.height + 14;

    const artW = Math.min(innerW, 520);
    const artH = Math.round(artW * 0.5);
    const artX = px + (pw - artW) / 2;
    addRunArt(this, eventArtKey(event.theme), { x: artX, y: cursor, width: artW, height: artH }, 0.9);
    this.add.rectangle(artX, cursor, artW, artH, UI.bg, 0.16).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.45);
    cursor += artH + 16;

    // 2. Title.
    const title = this.add.text(innerX, cursor, event.title, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.text, wordWrap: { width: innerW },
    });
    auditTextBlock(title, { name: 'Run event title', maxWidth: innerW, maxHeight: F.title * 2, minFontSize: 12 });
    cursor += title.height + 14;

    // 3. Body — its own framed "page" panel (comfortable line-height), sized
    // to the ACTUAL rendered text height so whatever sits below starts right
    // after it, never a fixed far-away slot.
    const bodyPad = 20;
    const bodyBoxTop = cursor;
    const bodyBox = this.add.rectangle(px, bodyBoxTop, pw, 10, UI.panel, 0.94).setOrigin(0, 0).setStrokeStyle(2, UI.chip, 0.7);
    const bodyRail = this.add.rectangle(px, bodyBoxTop, 6, 10, UI.chip, 0.92).setOrigin(0, 0);
    const body = this.add.text(innerX, bodyBoxTop + bodyPad, event.body, {
      fontFamily: FONT.body, fontSize: `${F.body}px`, color: UI.textDim, wordWrap: { width: innerW }, lineSpacing: 6,
    });
    auditTextBlock(body, { name: 'Run event body', maxWidth: innerW, maxHeight: F.body * 12 + 24, minFontSize: 10 });
    const bodyBoxH = body.height + bodyPad * 2;
    bodyBox.setSize(pw, bodyBoxH);
    bodyRail.setSize(6, bodyBoxH);

    cursor = bodyBoxTop + bodyBoxH + 20;
    return { px, pw, innerX, innerW, contentTop: cursor };
  }

  // ---------- choosing ----------

  private renderChoicePanel(gold: number, event: EventDef, story: StoryLayout): void {
    const { innerX, innerW } = story;
    // ASK the panel how tall it needs to be; never guess. The old hand-picked
    // 84 was ~15px short of its own content and silently ate the REWARD hint.
    const rowH = runChoicePanelMinHeight(F, true);
    const rowGap = 10;
    let cursor = story.contentTop;

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
      renderRunChoicePanel(this, { x: innerX, y: cursor, w: innerW, h: rowH }, model, {
        font: F,
        sfx: cost > 0 ? 'purchase' : 'uiClick',
        onSelect: () => {
          const outcome = resolveCurrentEventChoice(event.id, choice.id);
          if (!outcome) return;
          if (outcome.kind === 'bonusDraft') {
            this.phase = 'bonusDraftPick';
            this.bonusDraftCards = [...outcome.cards];
          } else {
            this.phase = 'outcome';
            this.outcome = outcome;
          }
          this.rerender();
        },
      });
      cursor += rowH + rowGap;
    });
  }
}
