import Phaser from 'phaser';
import type { EventChoiceDef, EventDef } from '../../data/events';
import type { DraftCard } from '../../run/draft';
import { isEventChoiceUsable, type EventOutcome, type SellGemOption, type UpgradeCardOption } from '../../run/events';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { renderRunChoicePanel, runChoicePanelMinHeight, type RunChoiceViewModel } from '../ui/RunChoicePanel';
import { auditTextBlock } from '../ui/controlLayoutAudit';
import { choiceOutcomeHint } from '../ui/eventOutcomeText';
import { eventThemeArea } from '../ui/eventThemeBlurb';
import { eventArtHeight, eventBodyMaxHeight, eventChoiceBlockHeight, eventStoryLimit } from '../ui/runEventStoryLayout';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { addRunArt, choiceArtKey, eventArtKey } from '../ui/runArt';
import { renderRunBonusDraftPicker, renderRunGemChoicePicker, renderRunRewardPanel, renderRunSellGemPicker, renderRunUpgradeCardPicker } from '../ui/RunRewardPanel';
import { buildRunRewardViewModel } from '../ui/runRewardViewModel';
import { runScreenLayoutRef } from '../ui/runScreenLayout';
import { rebuildScene } from '../sceneRebuild';
import { setDeckBuildContext } from '../deckBuildContext';
import {
  applyCurrentBonusDraftPick,
  applyCurrentGemChoicePick,
  applyCurrentUpgradeCardPick,
  currentEventDef,
  getActiveRun,
  leaveCurrentEvent,
  resolveCurrentEventChoice,
  retireActiveRun,
  sellCurrentRunGem,
} from '../runStore';

const F = DESKTOP_PROFILE.font;
// LIVE reference: every `TEMPLATE.*` read below resolves against the
// CURRENT viewport (the canvas fills the window -- see game/viewport.ts).
const TEMPLATE = runScreenLayoutRef('desktop');

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
 * `bonusDraft`/`upgradeCardPick` outcome, that same module's
 * `renderRunBonusDraftPicker`/`renderRunUpgradeCardPicker` — the SAME shared
 * renderers `MobileRunEventScene` calls, not per-scene copies. All three read
 * `TEMPLATE.contentSlots.reward`'s declared rects (`panel` a hard ceiling,
 * `headline`/`feature` sub-rects, `buttons` a fixed bottom-anchored row
 * reserved BEFORE the panel gets space) instead of the story column, so a
 * card, a gem, or a 5-card draft/upgrade grid always fits by construction —
 * see `runScreenTemplate.ts`'s doc comment on `reward`. Reachable at
 * ?scene=desktop-runevent.
 */
export class DesktopRunEventScene extends Phaser.Scene {
  private phase: 'choosing' | 'bonusDraftPick' | 'upgradeCardPick' | 'gemChoicePick' | 'sellGemPick' | 'outcome' = 'choosing';
  private outcome: EventOutcome | null = null;
  private bonusDraftCards: DraftCard[] = [];
  private upgradeCardOptions: UpgradeCardOption[] = [];
  private gemChoiceOptions: string[] = [];
  private sellGemOptions: SellGemOption[] = [];
  private retireConfirmOpen = false;

  constructor() { super('DesktopRunEvent'); }

  init(): void {
    this.phase = 'choosing';
    this.outcome = null;
    this.bonusDraftCards = [];
    this.upgradeCardOptions = [];
    this.gemChoiceOptions = [];
    this.sellGemOptions = [];
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
        onPick: (option) => {
          const result = sellCurrentRunGem(option.pouchIndex);
          if (!result.ok) return;
          this.phase = 'outcome';
          this.outcome = { kind: 'sellGem', gemId: option.gemId, price: result.goldReceived };
          this.rerender();
        },
      });
    } else {
      const story = this.renderStory(event, event.choices.length);
      this.renderChoicePanel(run, event, story);
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
   * CHOOSING phase and returns where the choice rows below it should start.
   *
   * `choiceCount` drives a RESERVE-FIRST budget (2026-08-19 fix): the choice
   * block's own height (`runChoicePanelMinHeight` × `choiceCount`, the exact
   * same formula `renderChoicePanel` below uses to lay the rows out — no
   * second hand-picked number to drift out of sync) is subtracted from the
   * canvas up front, giving a hard `storyLimit` the art + body must fit
   * above. Before this, the art image was a FIXED 520×260 regardless of how
   * many choice rows followed, so a 3-choice event with a long body pushed
   * its rows past the bottom of a 900px canvas — the 3rd row's "FREE" label
   * rendered 6-18px off-canvas (repro: "Hermit's Riddle", "The Weighing
   * Stone", "The Broken Axle", "Collapsed Barrow", all 3-choice events).
   * The art now SHRINKS (never grows past its 520×260 ideal) to hold back a
   * floor for the title and a readable minimum of body text; the body's
   * `auditTextBlock` maxHeight is then whatever's left of `storyLimit` after
   * the actual (not worst-case) caption/art/title heights are known, so a
   * long body shrinks its own font (and truncates, as a last resort) rather
   * than ever pushing the choice rows off the bottom of the screen — proven
   * against every catalog event by `tests/game/runEventStoryLayout.test.ts`. */
  private renderStory(event: EventDef, choiceCount: number): StoryLayout {
    const { px, py, pw } = this.panelGeometry();
    const inset = 32;
    const innerX = px + inset;
    const innerW = pw - inset * 2;

    // Reserve the choice block's own footprint FIRST — see the doc comment
    // above. `rowGap`/`runChoicePanelMinHeight(F, true)` here MUST stay
    // identical to `renderChoicePanel`'s own — same call, same constant.
    const rowH = runChoicePanelMinHeight(F, true);
    const rowGap = 10;
    const reserveBelowH = eventChoiceBlockHeight(choiceCount, rowH, rowGap);
    const maxBottom = SCREEN.height - DESKTOP_PROFILE.safe.bottom;
    const storyLimit = eventStoryLimit(maxBottom, 0, reserveBelowH, 20, py + 200);

    // 1. Area intro — a small atmospheric caption ABOVE the title, so the
    // stop reads as a PLACE before it reads as a decision.
    const area = eventThemeArea(event.theme);
    const areaLine = this.add.text(innerX, py, `${area.name} — ${area.blurb}`, {
      fontFamily: FONT.body, fontStyle: 'italic', fontSize: `${F.small}px`, color: UI.textSoft,
      wordWrap: { width: innerW }, lineSpacing: 3,
    });
    auditTextBlock(areaLine, { name: 'Run event area intro', maxWidth: innerW, maxHeight: F.small * 3 + 12, minFontSize: 9 });
    let cursor = py + areaLine.height + 14;

    // 2. Art — clamped DOWN from its 520×260 ideal (never up) just far
    // enough to hold back `TITLE_RESERVE` + a `BODY_TEXT_FLOOR` of body room
    // within `storyLimit`, using the title's own worst-case audited height
    // (not yet rendered) so this clamp is a real upper bound, not a guess.
    const TITLE_RESERVE = F.title * 2 + 14;
    const BODY_TEXT_FLOOR = 80;
    const bodyPad = 20;
    const idealArtW = Math.min(innerW, 520);
    const idealArtH = Math.round(idealArtW * 0.5);
    const artH = eventArtHeight(storyLimit, cursor, TITLE_RESERVE, 16, bodyPad, BODY_TEXT_FLOOR, idealArtH, 90);
    const artW = Math.round(idealArtW * (artH / idealArtH));
    const artX = px + (pw - artW) / 2;
    addRunArt(this, eventArtKey(event.theme), { x: artX, y: cursor, width: artW, height: artH }, 0.9);
    this.add.rectangle(artX, cursor, artW, artH, UI.bg, 0.16).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.45);
    cursor += artH + 16;

    // 3. Title.
    const title = this.add.text(innerX, cursor, event.title, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.text, wordWrap: { width: innerW },
    });
    auditTextBlock(title, { name: 'Run event title', maxWidth: innerW, maxHeight: F.title * 2, minFontSize: 12 });
    cursor += title.height + 14;

    // 4. Body — its own framed "page" panel (comfortable line-height), capped
    // to whatever's actually left of `storyLimit` (never the old fixed
    // `F.body * 12 + 24`) so `auditTextBlock` shrinks the font — and, only
    // as a last resort, truncates with an ellipsis — rather than letting the
    // choice rows below lose their reserved room.
    const bodyBoxTop = cursor;
    const bodyMaxHeight = eventBodyMaxHeight(storyLimit, bodyBoxTop, bodyPad, 40);
    const bodyBox = this.add.rectangle(px, bodyBoxTop, pw, 10, UI.panel, 0.94).setOrigin(0, 0).setStrokeStyle(2, UI.chip, 0.7);
    const bodyRail = this.add.rectangle(px, bodyBoxTop, 6, 10, UI.chip, 0.92).setOrigin(0, 0);
    const body = this.add.text(innerX, bodyBoxTop + bodyPad, event.body, {
      fontFamily: FONT.body, fontSize: `${F.body}px`, color: UI.textDim, wordWrap: { width: innerW }, lineSpacing: 6,
    });
    auditTextBlock(body, { name: 'Run event body', maxWidth: innerW, maxHeight: bodyMaxHeight, minFontSize: 10 });
    const bodyBoxH = body.height + bodyPad * 2;
    bodyBox.setSize(pw, bodyBoxH);
    bodyRail.setSize(6, bodyBoxH);

    cursor = bodyBoxTop + bodyBoxH + 20;
    return { px, pw, innerX, innerW, contentTop: cursor };
  }

  // ---------- choosing ----------

  private renderChoicePanel(run: NonNullable<ReturnType<typeof getActiveRun>>, event: EventDef, story: StoryLayout): void {
    const { innerX, innerW } = story;
    // ASK the panel how tall it needs to be; never guess. The old hand-picked
    // 84 was ~15px short of its own content and silently ate the REWARD hint.
    const rowH = runChoicePanelMinHeight(F, true);
    const rowGap = 10;
    let cursor = story.contentTop;

    event.choices.forEach((choice: EventChoiceDef) => {
      const cost = choice.cost ?? 0;
      // `isEventChoiceUsable` (not the bare `gold >= cost` this used to be) —
      // a `sellGem` choice also needs SOMETHING in the pouch to sell (see
      // that function's doc comment, src/run/events.ts); every other outcome
      // kind still reduces to the plain cost check.
      const affordable = isEventChoiceUsable(run, choice);
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
          } else if (outcome.kind === 'upgradeCardPick') {
            this.phase = 'upgradeCardPick';
            this.upgradeCardOptions = [...outcome.options];
          } else if (outcome.kind === 'gemChoicePick') {
            this.phase = 'gemChoicePick';
            this.gemChoiceOptions = [...outcome.options];
          } else if (outcome.kind === 'sellGemPick') {
            this.phase = 'sellGemPick';
            this.sellGemOptions = [...outcome.options];
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
