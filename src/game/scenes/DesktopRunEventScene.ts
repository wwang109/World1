import Phaser from 'phaser';
import { skillBook } from '../../data/skills';
import { gemBook } from '../../data/gems';
import type { EventChoiceDef, EventDef } from '../../data/events';
import type { DraftCard } from '../../run/draft';
import type { EventOutcome } from '../../run/events';
import { applyTier } from '../../engine/cards';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { auditControlLabel, auditTextBlock } from '../ui/controlLayoutAudit';
import { choiceOutcomeHint, outcomeHeadline } from '../ui/eventOutcomeText';
import { addHoverTipZone } from '../ui/hoverTip';
import { gemHoverEntry } from '../ui/gemGlossary';
import { renderRunProgressStrip, snapshotRunProgress } from '../ui/RunProgressStrip';
import { rebuildScene } from '../sceneRebuild';
import {
  applyCurrentBonusDraftPick,
  currentEventDef,
  getActiveRun,
  leaveCurrentEvent,
  resolveCurrentEventChoice,
} from '../runStore';

const F = DESKTOP_PROFILE.font;
const GX = DESKTOP_PROFILE.safe.x;

/**
 * Desktop Run Event — the parchment-style text dialogue for an `event` map
 * node (docs/run-events-design.md §4): title/body → 2-3 choice buttons
 * (cost + reward hint inline, disabled/dimmed if unaffordable) → an outcome
 * panel showing what actually happened (with the granted card/gem rendered)
 * → CONTINUE › back to the map. A `bonusDraft` outcome opens a single-set
 * picker (reusing the CardToken row idiom from the Draft scenes) before its
 * own outcome panel. Reachable at ?scene=desktop-runevent.
 */
export class DesktopRunEventScene extends Phaser.Scene {
  private phase: 'choosing' | 'bonusDraftPick' | 'outcome' = 'choosing';
  private outcome: EventOutcome | null = null;
  private bonusDraftCards: DraftCard[] = [];

  constructor() { super('DesktopRunEvent'); }

  init(): void {
    this.phase = 'choosing';
    this.outcome = null;
    this.bonusDraftCards = [];
  }

  private rerender(): void { rebuildScene(this); }

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

    this.renderTitle(run);
    if (this.phase === 'outcome' && this.outcome) this.renderOutcomePanel(this.outcome);
    else if (this.phase === 'bonusDraftPick') this.renderBonusDraftPicker();
    else this.renderChoicePanel(run.gold, event);
  }

  private renderTitle(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    this.add.text(GX, 24, 'WORLD1 / RUN MODE', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textAccent,
    });
    this.add.text(GX, 44, 'EVENT', {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.big}px`, color: UI.text,
    });
    this.add.text(SCREEN.width - GX, 44 + F.big - F.name, `GOLD ${run.gold}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.textAccent,
    }).setOrigin(1, 0);
    renderRunProgressStrip(this, { x: GX, y: 92, w: SCREEN.width - GX * 2 }, snapshotRunProgress(run));
  }

  private panelGeometry(): { px: number; py: number; pw: number } {
    const pw = 760;
    const px = (SCREEN.width - pw) / 2;
    const py = 156;
    return { px, py, pw };
  }

  // ---------- choosing ----------

  private renderChoicePanel(gold: number, event: EventDef): void {
    const { px, py, pw } = this.panelGeometry();
    const inset = 32;
    const innerX = px + inset;
    const innerW = pw - inset * 2;
    const rowH = 62;
    const rowGap = 10;
    const headerH = 44;
    const minimumPanelH = 400;

    const panel = this.add.rectangle(px, py, pw, minimumPanelH, UI.panel, 0.94).setOrigin(0, 0).setStrokeStyle(2, UI.chip, 0.8);
    const rail = this.add.rectangle(px, py, 7, minimumPanelH, UI.chip, 0.96).setOrigin(0, 0);
    const plannerLabel = this.add.text(innerX, py + 15, 'EVENT PLANNER', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
    });
    const pathCount = this.add.text(px + pw - inset, py + 15, `${event.choices.length} PATH${event.choices.length === 1 ? '' : 'S'}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textSoft,
    }).setOrigin(1, 0);
    auditTextBlock(plannerLabel, { name: 'Run event planner label', maxWidth: 180, maxHeight: F.tiny * 2, minFontSize: 8 });
    auditTextBlock(pathCount, { name: 'Run event path count', maxWidth: 180, maxHeight: F.tiny * 2, minFontSize: 8 });
    this.add.rectangle(innerX, py + headerH, innerW, 1, UI.border, 0.55).setOrigin(0, 0);

    const titleY = py + headerH + 12;
    const title = this.add.text(innerX, titleY, event.title, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.text, wordWrap: { width: innerW },
    });
    auditTextBlock(title, { name: 'Run event title', maxWidth: innerW, maxHeight: F.title * 2, minFontSize: 12 });
    const bodyY = titleY + title.height + 10;
    const body = this.add.text(innerX, bodyY, event.body, {
      fontFamily: FONT.body, fontSize: `${F.body}px`, color: UI.textDim, wordWrap: { width: innerW }, lineSpacing: 4,
    });
    auditTextBlock(body, { name: 'Run event body', maxWidth: innerW, maxHeight: F.body * 5 + 16, minFontSize: 10 });
    let cursor = bodyY + body.height + 24;

    event.choices.forEach((choice: EventChoiceDef) => {
      const cost = choice.cost ?? 0;
      const affordable = gold >= cost;
      const fill = affordable ? UI.panelAlt : UI.panelMuted;
      const btn = this.add.rectangle(innerX, cursor, innerW, rowH, fill, affordable ? 1 : 0.55)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, affordable ? 0.9 : 0.35);
      const rail = this.add.rectangle(innerX, cursor, 4, rowH, UI.chip, affordable ? 0.96 : 0.4).setOrigin(0, 0);
      void rail;
      const label = this.add.text(innerX + 16, cursor + 9, choice.label, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.body}px`, color: affordable ? UI.text : UI.textSoft, wordWrap: { width: innerW - 32 },
      });
      const costLabel = cost > 0 ? `COST ${cost} GOLD` : 'FREE';
      const costText = this.add.text(innerX + 16, cursor + rowH - 11, costLabel, {
        fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: affordable ? UI.textDim : UI.textSoft,
      }).setOrigin(0, 1);
      const hint = this.add.text(innerX + innerW - 16, cursor + rowH - 11, `→ ${choiceOutcomeHint(choice.outcome)}`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: affordable ? UI.textAccent : UI.textSoft,
      }).setOrigin(1, 1);
      auditControlLabel(btn, label, { name: `Run event ${choice.id} choice`, horizontalPadding: 16, verticalPadding: 7, minFontSize: 8 });
      auditTextBlock(label, { name: `Run event ${choice.id} label`, maxWidth: innerW - 32, maxHeight: F.body * 2, minFontSize: 8 });
      auditTextBlock(costText, { name: `Run event ${choice.id} cost`, maxWidth: innerW / 2 - 16, maxHeight: F.tiny * 2, minFontSize: 8 });
      auditTextBlock(hint, { name: `Run event ${choice.id} outcome hint`, maxWidth: innerW / 2 - 16, maxHeight: F.small * 2, minFontSize: 8 });
      if (affordable) {
        btn.setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => btn.setFillStyle(UI.slotHover));
        btn.on('pointerout', () => btn.setFillStyle(fill));
        btn.on('pointerdown', () => {
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
        });
      }
      cursor += rowH + rowGap;
    });

    const panelH = Math.max(minimumPanelH, cursor - py - rowGap + 28);
    panel.setSize(pw, panelH);
    rail.setSize(7, panelH);
  }

  // ---------- bonusDraft picker ----------

  private renderBonusDraftPicker(): void {
    const { px, py, pw } = this.panelGeometry();
    const ph = 300;
    this.add.rectangle(px, py, pw, ph, UI.panel, 0.94).setOrigin(0, 0).setStrokeStyle(2, UI.chip, 0.8);
    this.add.rectangle(px, py, 7, ph, UI.chip, 0.96).setOrigin(0, 0);
    const title = this.add.text(px + 32, py + 16, 'PICK ONE TO KEEP', {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.textAccent,
    });
    const rewardLabel = this.add.text(px + pw - 32, py + 19, 'EVENT REWARD', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textSoft,
    }).setOrigin(1, 0);
    this.add.rectangle(px + 32, py + 48, pw - 64, 1, UI.border, 0.55).setOrigin(0, 0);
    auditTextBlock(title, { name: 'Run event bonus draft title', maxWidth: pw - 64, maxHeight: F.name * 2, minFontSize: 10 });
    auditTextBlock(rewardLabel, { name: 'Run event reward label', maxWidth: 180, maxHeight: F.tiny * 2, minFontSize: 8 });

    const cards = this.bonusDraftCards;
    const n = Math.max(1, cards.length);
    const gap = DESKTOP_PROFILE.gap;
    const cardTop = py + 70;
    const cardH = ph - 92;
    const cardW = (pw - 56 - gap * (n - 1)) / n;
    cards.forEach((card, i) => {
      const skill = skillBook[card.skillId];
      if (!skill) return;
      const shown = card.tier === skill.tier ? skill : applyTier(skill, card.tier);
      const cx = px + 28 + i * (cardW + gap);
      const tok = new CardToken(this, cx + cardW / 2, cardTop + cardH / 2, shown, { width: cardW, height: cardH, side: 'left' });
      const hit = this.add.rectangle(cx + cardW / 2, cardTop + cardH / 2, cardW, cardH, 0xffffff, 0).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => {
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

  private renderOutcomePanel(outcome: EventOutcome): void {
    const { px, py, pw } = this.panelGeometry();
    const ph = 500;
    this.add.rectangle(px, py, pw, ph, UI.panel, 0.94).setOrigin(0, 0).setStrokeStyle(2, UI.chip, 0.8);
    this.add.rectangle(px, py, 7, ph, UI.chip, 0.96).setOrigin(0, 0);
    const resolvedLabel = this.add.text(px + 32, py + 16, 'EVENT RESOLVED', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
    });
    this.add.rectangle(px + 32, py + 42, pw - 64, 1, UI.border, 0.55).setOrigin(0, 0);
    auditTextBlock(resolvedLabel, { name: 'Run event resolved label', maxWidth: 180, maxHeight: F.tiny * 2, minFontSize: 8 });
    const { headline, detail } = outcomeHeadline(outcome);
    let cursor = py + 62;
    const headlineText = this.add.text(px + pw / 2, cursor, headline, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.text, align: 'center', wordWrap: { width: pw - 64 },
    }).setOrigin(0.5, 0);
    auditTextBlock(headlineText, { name: 'Run event outcome headline', maxWidth: pw - 64, maxHeight: F.title * 2, minFontSize: 12 });
    cursor += headlineText.height + 8;
    if (detail) {
      const detailText = this.add.text(px + pw / 2, cursor, detail, {
        fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim, align: 'center',
      }).setOrigin(0.5, 0);
      auditTextBlock(detailText, { name: 'Run event outcome detail', maxWidth: pw - 64, maxHeight: F.small * 2, minFontSize: 8 });
      cursor += detailText.height + 10;
    }
    cursor += 12;

    if (outcome.kind === 'grantCard' && !outcome.fellBack) {
      const skill = skillBook[outcome.skillId];
      if (skill) {
        const shown = outcome.tier === skill.tier ? skill : applyTier(skill, outcome.tier);
        const cardW = 142;
        const cardH = Math.round(cardW * (690 / 420));
        new CardToken(this, px + pw / 2, cursor + cardH / 2, shown, { width: cardW, height: cardH, side: 'left' });
        cursor += cardH + 16;
      }
    } else if (outcome.kind === 'grantGem') {
      const gem = gemBook[outcome.gemId];
      if (gem) {
        const chipW = 260;
        const chipY = cursor;
        this.add.rectangle(px + pw / 2 - chipW / 2, chipY, chipW, 56, UI.panelMuted, 0.9).setOrigin(0, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.9);
        this.add.rectangle(px + pw / 2 - chipW / 2 + 24, chipY + 28, 14, 14, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45);
        this.add.text(px + pw / 2 - chipW / 2 + 44, chipY + 18, gem.name, {
          fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.text,
        });
        addHoverTipZone(this, { x: px + pw / 2 - chipW / 2, y: chipY, w: chipW, h: 56 }, [gemHoverEntry(gem)]);
        cursor += 56 + 16;
      }
    }

    const btnW = 220;
    const btnY = py + ph - 60;
    const btn = this.add.rectangle(px + pw / 2 - btnW / 2, btnY, btnW, 44, UI.chip, 1).setOrigin(0, 0).setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true });
    const btnText = this.add.text(px + pw / 2, btnY + 22, 'CONTINUE ›', {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.textOnChip,
    }).setOrigin(0.5);
    auditControlLabel(btn, btnText, { name: 'Run event continue', horizontalPadding: 14, verticalPadding: 6, minFontSize: 8 });
    btn.on('pointerdown', () => { leaveCurrentEvent(); this.scene.start('DesktopRunMap'); });
  }
}
