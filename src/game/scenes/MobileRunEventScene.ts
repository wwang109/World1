import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { skillBook } from '../../data/skills';
import type { EventChoiceDef, EventDef } from '../../data/events';
import type { DraftCard } from '../../run/draft';
import type { EventOutcome } from '../../run/events';
import { applyTier } from '../../engine/cards';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { auditControlLabel, auditTextBlock } from '../ui/controlLayoutAudit';
import { choiceOutcomeHint } from '../ui/eventOutcomeText';
import { eventThemeArea } from '../ui/eventThemeBlurb';
import { renderRunChoicePanel, runChoicePanelMinHeight, type RunChoiceViewModel } from '../ui/RunChoicePanel';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { addRunArt, choiceArtKey, eventArtKey } from '../ui/runArt';
import { renderRunRewardPanel } from '../ui/RunRewardPanel';
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

const F = MOBILE_PROFILE.font;
const TEMPLATE = runScreenTemplate('mobile');

/** The one flowing story column the CHOOSING phase renders into — computed
 * ONCE by `renderStory` off the event's actual theme/title/body. Once a
 * choice resolves (`outcome`/`bonusDraftPick`), the story column is REPLACED
 * by the reward template (`TEMPLATE.contentSlots.reward` via
 * `renderRunRewardPanel`/the bonus-draft picker below) rather than shown
 * alongside it — see the module doc for why. */
interface StoryLayout { innerX: number; innerW: number; contentTop: number }

/**
 * Mobile Run Event — the vertical counterpart of `DesktopRunEventScene`: a
 * single top-down story page (area-intro caption → title → body panel) while
 * CHOOSING, stacked above the choice rows. Once a choice resolves, the screen
 * switches to the ONE reward template every outcome kind shares
 * (`RunRewardPanel.ts`, driven by `buildRunRewardViewModel`) or the
 * bonus-draft picker — both laid into `TEMPLATE.contentSlots.reward`'s
 * declared rects (`panel` a hard ceiling, `headline`/`feature` sub-rects,
 * `buttons` a fixed slot reserved BEFORE the panel gets space) instead of the
 * story column, so a card, a gem, or nothing at all always fits by
 * construction. The HUD's fixed footer primary CONTINUE › still fires the
 * same handler as the reward panel's own CONTINUE button. Reachable at
 * ?scene=mrunevent.
 */
export class MobileRunEventScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private phase: 'choosing' | 'bonusDraftPick' | 'outcome' = 'choosing';
  private outcome: EventOutcome | null = null;
  private bonusDraftCards: DraftCard[] = [];
  private retireConfirmOpen = false;

  constructor() { super('MobileRunEvent'); }

  init(): void {
    this.phase = 'choosing';
    this.outcome = null;
    this.bonusDraftCards = [];
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
        onContinue: () => this.continueToMap(),
      });
    } else if (this.phase === 'bonusDraftPick') {
      this.renderBonusDraftPicker();
    } else {
      const story = this.renderStory(event, event.choices.length * (80 + 8) - 8);
      this.renderChoices(run.gold, event, story);
    }
    if (this.retireConfirmOpen) {
      renderRetireConfirm(this, {
        compact: true,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { retireActiveRun(); this.scene.start('MobileRunMap'); },
      });
    }
  }

  /** THE run HUD — identical header on every run screen. The HUD's fixed
   * footer CONTINUE › still fires once the outcome resolves — same handler
   * as `renderRunRewardPanel`'s own CONTINUE button. */
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
        if (!inBox(p.worldX, p.worldY)) return;
        dragging = true; startY = p.worldY; startScroll = scrollY;
      });
      this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!dragging) return;
        scrollY = Phaser.Math.Clamp(startScroll + (p.worldY - startY), -maxScroll, 0);
        bodyContainer.setY(bodyBoxTop + bodyPad + scrollY);
      });
      this.input.on('pointerup', () => { dragging = false; });
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

  // ---------- bonusDraft picker ----------

  /** The "PICK ONE TO KEEP" mini-draft — laid into the SAME reward template
   * region as the resolved-outcome screen (`TEMPLATE.contentSlots.reward`):
   * the label sits in `headline`, the stacked card rows in `feature`. Since
   * this phase (like `outcome`) replaces the story column rather than
   * sitting below it, `feature`'s generous remainder-of-panel height means
   * the rows are never tight, let alone clipped. */
  private renderBonusDraftPicker(): void {
    const { panel, headline, feature } = TEMPLATE.contentSlots.reward;
    this.add.rectangle(panel.x, panel.y, panel.width, panel.height, UI.panelMuted, 0.94)
      .setOrigin(0, 0).setStrokeStyle(2, UI.chip, 0.6);

    const title = this.add.text(headline.x + headline.width / 2, headline.y, 'PICK ONE TO KEEP', {
      fontSize: `${F.title}px`, color: UI.textAccent, fontFamily: FONT.display, fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5, 0);
    auditTextBlock(title, { name: 'Mobile run event bonus draft title', maxWidth: headline.width - 24, maxHeight: headline.height, minFontSize: 10 });

    const cards = this.bonusDraftCards;
    const n = Math.max(1, cards.length);
    const gap = 8;
    // `feature` is the reward template's own remainder-of-panel rect — a hard
    // ceiling exactly like the resolved outcome's feature visual, never a
    // flat per-row demand: shrink the stacked rows to fit before shrinking
    // below the ideal per-row height.
    const rowH = Math.max(40, Math.min(70, (feature.height - gap * (n - 1)) / n));
    const rowW = Math.min(feature.width, this.W - 20);
    const rowX = feature.x + (feature.width - rowW) / 2;
    let y = feature.y;
    for (const card of cards) {
      const skill = skillBook[card.skillId];
      if (!skill) { y += rowH + gap; continue; }
      const shown = card.tier === skill.tier ? skill : applyTier(skill, card.tier);
      new CardToken(this, rowX + rowW / 2, y + rowH / 2, shown, { width: rowW, height: rowH, side: 'left' });
      const hit = this.add.rectangle(rowX + rowW / 2, y + rowH / 2, rowW, rowH, 0xffffff, 0).setInteractive({ useHandCursor: true });
      const select = this.add.text(rowX + rowW - 10, y + 8, 'SELECT', {
        fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(1, 0);
      auditControlLabel(hit, select, { name: `Mobile run event ${card.skillId} bonus pick`, horizontalPadding: 12, verticalPadding: 5, minFontSize: 8 });
      auditTextBlock(select, { name: `Mobile run event ${card.skillId} select label`, maxWidth: 64, maxHeight: F.tiny * 2, minFontSize: 8 });
      hit.on('pointerdown', () => {
        playSfx('uiClick');
        const outcome = applyCurrentBonusDraftPick(card);
        if (!outcome) return;
        this.phase = 'outcome';
        this.outcome = outcome;
        this.rerender();
      });
      y += rowH + gap;
    }
  }
}
