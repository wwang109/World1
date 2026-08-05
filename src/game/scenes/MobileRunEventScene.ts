import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { skillBook } from '../../data/skills';
import { gemBook } from '../../data/gems';
import type { EventChoiceDef, EventDef } from '../../data/events';
import type { DraftCard } from '../../run/draft';
import type { EventOutcome } from '../../run/events';
import { applyTier } from '../../engine/cards';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { auditControlLabel, auditTextBlock } from '../ui/controlLayoutAudit';
import { choiceOutcomeHint, outcomeHeadline } from '../ui/eventOutcomeText';
import { eventThemeArea } from '../ui/eventThemeBlurb';
import { addHoverTipZone } from '../ui/hoverTip';
import { gemHoverEntry } from '../ui/gemGlossary';
import { renderRunChoicePanel, type RunChoiceViewModel } from '../ui/RunChoicePanel';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
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

/** The one flowing story column every phase renders into — computed ONCE by
 * `renderStory` off the event's actual theme/title/body (identical across
 * phases, since the body never changes), so choices/outcome always start at
 * the SAME y a fixed pixel below the body, never a far-away hardcoded slot. */
interface StoryLayout { innerX: number; innerW: number; contentTop: number }

/**
 * Mobile Run Event — the vertical counterpart of `DesktopRunEventScene`: a
 * single top-down story page (area-intro caption → title → body panel) with
 * whatever comes next — choices, the bonusDraft picker, or the resolved
 * outcome + an adjacent CONTINUE › — stacked DIRECTLY below the body, no
 * fixed far-away slot. The HUD's fixed footer primary CONTINUE › still fires
 * too (thumb-reachable, the established mobile pattern), but the near one
 * next to the outcome text is what answers the "close option isn't close by"
 * complaint. Long bodies get the small-scroll idiom instead of shrinking
 * below the 9px floor. Reachable at ?scene=mrunevent.
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
    const reserveBelowH = this.phase === 'outcome' && this.outcome ? this.outcomeReserveEstimate(this.outcome)
      : this.phase === 'bonusDraftPick' ? 214
        : event.choices.length * (80 + 8) - 8;
    const story = this.renderStory(event, reserveBelowH);
    if (this.phase === 'outcome' && this.outcome) this.renderOutcome(this.outcome, story);
    else if (this.phase === 'bonusDraftPick') this.renderBonusDraftPicker(story);
    else this.renderChoices(run.gold, event, story);
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
   * as the in-story button directly under the outcome text. */
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

  /** Rough pixel budget the outcome block (headline/detail/reward/CONTINUE)
   * needs below the body — used only to decide whether the body panel must
   * scroll instead of pushing the outcome off-screen; doesn't need to be
   * exact. */
  private outcomeReserveEstimate(outcome: EventOutcome): number {
    let reward = 0;
    if (outcome.kind === 'grantCard' && !outcome.fellBack) reward = 198;
    else if (outcome.kind === 'grantGem') reward = 68;
    return 96 + reward + 66; // headline+detail+gaps, reward token, CONTINUE button+gap
  }

  // ---------- story (area intro → title → body panel) ----------

  /** Renders the narrative header ONCE per phase-render (area caption, title,
   * framed body — the body capped + made small-scrollable only if it and
   * `reserveBelowH` together would overflow the content region) and returns
   * where the phase-specific content below it should start. */
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
    // Everything below the stats/badge/actions band, above the fixed footer.
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
    const rowH = 80;
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

  private renderBonusDraftPicker(story: StoryLayout): void {
    const { innerX, innerW } = story;
    let y = story.contentTop;
    const title = this.add.text(innerX, y, 'PICK ONE TO KEEP', {
      fontSize: `${F.name}px`, color: UI.textAccent, fontFamily: FONT.display, fontStyle: 'bold',
    });
    auditTextBlock(title, { name: 'Mobile run event bonus draft title', maxWidth: innerW, maxHeight: F.name * 2, minFontSize: 10 });
    y += title.height + 10;

    const h = 70;
    const gap = 8;
    for (const card of this.bonusDraftCards) {
      const skill = skillBook[card.skillId];
      if (!skill) { y += h + gap; continue; }
      const shown = card.tier === skill.tier ? skill : applyTier(skill, card.tier);
      new CardToken(this, 10 + (this.W - 20) / 2, y + h / 2, shown, { width: this.W - 20, height: h, side: 'left' });
      const hit = this.add.rectangle(10 + (this.W - 20) / 2, y + h / 2, this.W - 20, h, 0xffffff, 0).setInteractive({ useHandCursor: true });
      const select = this.add.text(this.W - 20, y + 8, 'SELECT', {
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
      y += h + gap;
    }
  }

  // ---------- outcome ----------

  /** Outcome replaces the choices IN PLACE (same `story.contentTop`), and
   * CONTINUE › sits immediately below it — adjacent to the message it
   * confirms, which is this pass's core fix. */
  private renderOutcome(outcome: EventOutcome, story: StoryLayout): void {
    const { innerX, innerW } = story;
    const cardPad = 14;
    const cardTop = story.contentTop;
    const card = this.add.rectangle(0, cardTop, this.W, 10, UI.panelAlt, 0.92).setOrigin(0, 0).setStrokeStyle(1, UI.chip, 0.55);

    let y = cardTop + cardPad;
    const { headline, detail } = outcomeHeadline(outcome);
    const headlineText = this.add.text(innerX, y, headline, {
      fontSize: `${F.title}px`, color: UI.text, fontFamily: FONT.display, fontStyle: 'bold', wordWrap: { width: innerW },
    });
    auditTextBlock(headlineText, { name: 'Mobile run event outcome headline', maxWidth: innerW, maxHeight: F.title * 2, minFontSize: 12 });
    y += headlineText.height + 8;
    if (detail) {
      const detailText = this.add.text(innerX, y, detail, {
        fontSize: `${F.small}px`, color: UI.textDim, fontFamily: FONT.body, wordWrap: { width: innerW },
      });
      auditTextBlock(detailText, { name: 'Mobile run event outcome detail', maxWidth: innerW, maxHeight: F.small * 2, minFontSize: 8 });
      y += detailText.height + 10;
    }
    y += 6;

    if (outcome.kind === 'grantCard' && !outcome.fellBack) {
      const skill = skillBook[outcome.skillId];
      if (skill) {
        const shown = outcome.tier === skill.tier ? skill : applyTier(skill, outcome.tier);
        const cardW = 126;
        const cardH = Math.round(cardW * (690 / 420));
        new CardToken(this, innerX + cardW / 2, y + cardH / 2, shown, { width: cardW, height: cardH, side: 'left' });
        y += cardH + 14;
      }
    } else if (outcome.kind === 'grantGem') {
      const gem = gemBook[outcome.gemId];
      if (gem) {
        const chipW = innerW;
        this.add.rectangle(innerX, y, chipW, 52, UI.panelMuted, 0.94).setOrigin(0, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.9);
        this.add.rectangle(innerX + 22, y + 26, 12, 12, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45);
        const gemName = this.add.text(innerX + 40, y + 17, gem.name, {
          fontSize: `${F.body}px`, color: UI.text, fontFamily: FONT.display, fontStyle: 'bold', wordWrap: { width: chipW - 58 },
        });
        auditTextBlock(gemName, { name: 'Mobile run event gem name', maxWidth: chipW - 58, maxHeight: F.body * 2, minFontSize: 9 });
        addHoverTipZone(this, { x: innerX, y, w: chipW, h: 52 }, [gemHoverEntry(gem)]);
        y += 52 + 14;
      }
    }

    card.setSize(this.W, y - cardTop + (cardPad - 4));
    y += 6;

    // CONTINUE › — immediately below the outcome, adjacent to what it
    // confirms. The HUD's fixed footer CONTINUE › (thumb-reachable, the
    // established mobile pattern) still fires the same handler.
    this.renderInlineContinue(innerX, innerW, y);
  }

  private renderInlineContinue(x: number, w: number, y: number): void {
    const h = 52;
    const btn = this.add.rectangle(x, y, w, h, UI.chip, 1).setOrigin(0, 0).setStrokeStyle(2, UI.border, 0.9).setInteractive({ useHandCursor: true });
    const label = this.add.text(x + w / 2, y + h / 2, 'CONTINUE ›', {
      fontSize: `${F.name + 1}px`, color: UI.textOnChip, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5);
    auditControlLabel(btn, label, { name: 'Mobile run event inline continue', horizontalPadding: 12, verticalPadding: 8, minFontSize: 10 });
    btn.on('pointerdown', () => { playSfx('uiClick'); this.continueToMap(); });
  }
}
