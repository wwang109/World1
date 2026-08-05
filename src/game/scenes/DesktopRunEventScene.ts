import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { skillBook } from '../../data/skills';
import { gemBook } from '../../data/gems';
import type { EventChoiceDef, EventDef } from '../../data/events';
import type { DraftCard } from '../../run/draft';
import type { EventOutcome } from '../../run/events';
import { applyTier } from '../../engine/cards';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { renderRunChoicePanel, type RunChoiceViewModel } from '../ui/RunChoicePanel';
import { auditControlLabel, auditTextBlock } from '../ui/controlLayoutAudit';
import { choiceOutcomeHint, outcomeHeadline } from '../ui/eventOutcomeText';
import { eventThemeArea } from '../ui/eventThemeBlurb';
import { addHoverTipZone } from '../ui/hoverTip';
import { gemHoverEntry } from '../ui/gemGlossary';
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

const F = DESKTOP_PROFILE.font;
const TEMPLATE = runScreenTemplate('desktop');

/** The one flowing story column every phase renders into — computed ONCE by
 * `renderStory` off the event's actual theme/title/body (identical across
 * phases, since the body never changes), so choices/outcome always start at
 * the SAME y a fixed pixel below the body, never a far-away hardcoded slot. */
interface StoryLayout { px: number; pw: number; innerX: number; innerW: number; contentTop: number }

/**
 * Desktop Run Event — a single top-down STORY PAGE for a `event` map node
 * (docs/run-events-design.md §4): area-intro caption (`eventThemeArea`) →
 * title → body (in its own framed panel) → then, directly below with no gap
 * jump, either the 2-3 choice rows, the bonusDraft picker, or (once a choice
 * resolves) the outcome text with a CONTINUE › button immediately under it —
 * the outcome replaces the choices IN PLACE so the eye never has to travel
 * far to confirm. Reachable at ?scene=desktop-runevent.
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
    const story = this.renderStory(event);
    if (this.phase === 'outcome' && this.outcome) this.renderOutcomePanel(this.outcome, story);
    else if (this.phase === 'bonusDraftPick') this.renderBonusDraftPicker(story);
    else this.renderChoicePanel(run.gold, event, story);
    if (this.retireConfirmOpen) {
      renderRetireConfirm(this, {
        compact: false,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { retireActiveRun(); this.scene.start('DesktopRunMap'); },
      });
    }
  }

  /** THE run HUD — identical header on every run screen. The HUD's own
   * CONTINUE › (top-right, this screen's primary go-forward action) still
   * fires once the outcome resolves — same handler as the in-story button
   * directly under the outcome text (see `renderOutcomePanel`), so whichever
   * one the player reaches for both do the same thing. */
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

  // ---------- story (area intro → title → body panel) ----------

  /** Renders the narrative header ONCE per phase-render (area caption, title,
   * framed body) and returns where the phase-specific content below it should
   * start — the SAME y every phase, since the story content is identical. */
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
    const rowH = 84;
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

  // ---------- bonusDraft picker ----------

  /** Reused from the standalone panel it used to be — now just another block
   * in the same story-flow column, directly under the body. */
  private renderBonusDraftPicker(story: StoryLayout): void {
    const { innerX, innerW } = story;
    let cursor = story.contentTop;

    const label = this.add.text(innerX, cursor, 'PICK ONE TO KEEP', {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.textAccent,
    });
    auditTextBlock(label, { name: 'Run event bonus draft title', maxWidth: innerW, maxHeight: F.name * 2, minFontSize: 10 });
    cursor += label.height + 14;

    const cards = this.bonusDraftCards;
    const n = Math.max(1, cards.length);
    const gap = DESKTOP_PROFILE.gap;
    const cardH = 230;
    const cardW = (innerW - gap * (n - 1)) / n;
    cards.forEach((card, i) => {
      const skill = skillBook[card.skillId];
      if (!skill) return;
      const shown = card.tier === skill.tier ? skill : applyTier(skill, card.tier);
      const cx = innerX + i * (cardW + gap);
      const tok = new CardToken(this, cx + cardW / 2, cursor + cardH / 2, shown, { width: cardW, height: cardH, side: 'left' });
      const hit = this.add.rectangle(cx + cardW / 2, cursor + cardH / 2, cardW, cardH, 0xffffff, 0).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => {
        playSfx('uiClick');
        const outcome = applyCurrentBonusDraftPick(card);
        if (!outcome) return;
        this.phase = 'outcome';
        this.outcome = outcome;
        this.rerender();
      });
      void tok;
    });
  }

  // ---------- outcome ----------

  /** Outcome replaces the choices IN PLACE (same `story.contentTop`), and
   * CONTINUE › sits immediately below it — the confirm action adjacent to
   * the message it confirms (the user's core complaint). */
  private renderOutcomePanel(outcome: EventOutcome, story: StoryLayout): void {
    const { px, pw, innerX, innerW } = story;
    const cardPad = 20;
    const cardTop = story.contentTop;
    const card = this.add.rectangle(px, cardTop, pw, 10, UI.panelMuted, 0.94).setOrigin(0, 0).setStrokeStyle(2, UI.chip, 0.6);

    const { headline, detail } = outcomeHeadline(outcome);
    let cursor = cardTop + cardPad;
    const headlineText = this.add.text(innerX, cursor, headline, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.text, wordWrap: { width: innerW },
    });
    auditTextBlock(headlineText, { name: 'Run event outcome headline', maxWidth: innerW, maxHeight: F.title * 2, minFontSize: 12 });
    cursor += headlineText.height + 8;
    if (detail) {
      const detailText = this.add.text(innerX, cursor, detail, {
        fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim, wordWrap: { width: innerW },
      });
      auditTextBlock(detailText, { name: 'Run event outcome detail', maxWidth: innerW, maxHeight: F.small * 2, minFontSize: 8 });
      cursor += detailText.height + 10;
    }
    cursor += 8;

    if (outcome.kind === 'grantCard' && !outcome.fellBack) {
      const skill = skillBook[outcome.skillId];
      if (skill) {
        const shown = outcome.tier === skill.tier ? skill : applyTier(skill, outcome.tier);
        const cardW = 142;
        const cardH = Math.round(cardW * (690 / 420));
        new CardToken(this, innerX + cardW / 2, cursor + cardH / 2, shown, { width: cardW, height: cardH, side: 'left' });
        cursor += cardH + 16;
      }
    } else if (outcome.kind === 'grantGem') {
      const gem = gemBook[outcome.gemId];
      if (gem) {
        const chipW = 260;
        const chipY = cursor;
        this.add.rectangle(innerX, chipY, chipW, 56, UI.panelAlt, 0.9).setOrigin(0, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.9);
        this.add.rectangle(innerX + 24, chipY + 28, 14, 14, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45);
        this.add.text(innerX + 44, chipY + 18, gem.name, {
          fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.text,
        });
        addHoverTipZone(this, { x: innerX, y: chipY, w: chipW, h: 56 }, [gemHoverEntry(gem)]);
        cursor += 56 + 16;
      }
    }

    const cardBoxH = cursor - cardTop + (cardPad - 16 > 0 ? cardPad - 16 : cardPad);
    card.setSize(pw, Math.max(cardBoxH, headlineText.height + cardPad * 2));
    cursor += 4;

    // CONTINUE › — IMMEDIATELY below the outcome, adjacent to what it
    // confirms. The HUD's own primary CONTINUE (top of screen) still works
    // too (`renderHud`), same handler — this one just puts it where the eye
    // already is.
    this.renderInlineContinue(innerX, innerW, cursor);
  }

  private renderInlineContinue(x: number, w: number, y: number): void {
    const h = 56;
    const btn = this.add.rectangle(x, y, w, h, UI.chip, 1).setOrigin(0, 0).setStrokeStyle(2, UI.border, 0.9).setInteractive({ useHandCursor: true });
    const label = this.add.text(x + w / 2, y + h / 2, 'CONTINUE ›', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.name + 2}px`, color: UI.textOnChip,
    }).setOrigin(0.5);
    auditControlLabel(btn, label, { name: 'Run event inline continue', horizontalPadding: 16, verticalPadding: 10, minFontSize: 10 });
    btn.on('pointerover', () => btn.setFillStyle(UI.chipDark));
    btn.on('pointerout', () => btn.setFillStyle(UI.chip));
    btn.on('pointerdown', () => { playSfx('uiClick'); this.continueToMap(); });
  }
}
