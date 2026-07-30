import Phaser from 'phaser';
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
import { addHoverTipZone } from '../ui/hoverTip';
import { gemHoverEntry } from '../ui/gemGlossary';
import { renderRunChoicePanel, type RunChoiceViewModel } from '../ui/RunChoicePanel';
import { renderRunProgressStrip, snapshotRunProgress } from '../ui/RunProgressStrip';
import { rebuildScene } from '../sceneRebuild';
import { setDeckBuildContext } from '../deckBuildContext';
import {
  applyCurrentBonusDraftPick,
  currentEventDef,
  getActiveRun,
  leaveCurrentEvent,
  resolveCurrentEventChoice,
} from '../runStore';

const F = MOBILE_PROFILE.font;

/**
 * Mobile Run Event — the vertical counterpart of `DesktopRunEventScene`:
 * title/body → stacked choice rows (cost + reward hint, dimmed if
 * unaffordable) → outcome card (granted card/gem shown) → CONTINUE ›. A
 * `bonusDraft` outcome shows a horizontal 1-5 card picker row. Reachable at
 * ?scene=mrunevent.
 */
export class MobileRunEventScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private phase: 'choosing' | 'bonusDraftPick' | 'outcome' = 'choosing';
  private outcome: EventOutcome | null = null;
  private bonusDraftCards: DraftCard[] = [];

  constructor() { super('MobileRunEvent'); }

  init(): void {
    this.phase = 'choosing';
    this.outcome = null;
    this.bonusDraftCards = [];
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);

    const run = getActiveRun();
    const event = currentEventDef();
    if (!run || !event) {
      this.scene.start('MobileRunMap');
      return;
    }

    this.renderHeader(run, event);
    if (this.phase === 'outcome' && this.outcome) this.renderOutcome(this.outcome);
    else if (this.phase === 'bonusDraftPick') this.renderBonusDraftPicker();
    else this.renderChoices(run.gold, event);
  }

  private renderHeader(run: NonNullable<ReturnType<typeof getActiveRun>>, event: EventDef): void {
    const eyebrow = this.add.text(12, 10, 'RUN MODE', {
      fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold',
    });
    const title = this.add.text(12, 24, 'EVENT', {
      fontSize: `${F.title}px`, color: UI.text, fontFamily: FONT.display, fontStyle: 'bold',
    });
    const deckButton = this.add.rectangle(this.W - 104, 10, 92, 22, UI.panelAlt, 1)
      .setOrigin(0, 0).setStrokeStyle(1, UI.chip, 0.8).setInteractive({ useHandCursor: true });
    const deckLabel = this.add.text(this.W - 58, 21, 'DECK / BAG', {
      fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5);
    renderRunProgressStrip(this, { x: 12, y: 49, w: this.W - 24 }, snapshotRunProgress(run), { compact: true });
    const status = this.add.text(12, 100, `EVENT SELECT · ${event.choices.length} PATH${event.choices.length === 1 ? '' : 'S'}`, {
      fontSize: `${F.tiny}px`, color: UI.textSoft, fontFamily: FONT.body, fontStyle: 'bold',
    });
    this.add.rectangle(10, 118, this.W - 20, 1, UI.border, 0.6).setOrigin(0, 0);
    auditTextBlock(eyebrow, { name: 'Mobile run event eyebrow', maxWidth: 100, maxHeight: F.tiny * 2, minFontSize: 8 });
    auditTextBlock(title, { name: 'Mobile run event header', maxWidth: 140, maxHeight: F.title * 2, minFontSize: 12 });
    auditTextBlock(status, { name: 'Mobile run event status', maxWidth: this.W - 24, maxHeight: F.tiny * 2, minFontSize: 8 });
    auditControlLabel(deckButton, deckLabel, { name: 'Mobile run event deck bag', horizontalPadding: 8, verticalPadding: 5, minFontSize: 8 });
    auditTextBlock(deckLabel, { name: 'Mobile run event deck bag label', maxWidth: 76, maxHeight: 12, minFontSize: 8 });
    deckButton.on('pointerdown', () => { setDeckBuildContext('run'); this.scene.start('MobileDeckBuild'); });
  }

  // ---------- choosing ----------

  private renderChoices(gold: number, event: EventDef): void {
    let y = 132;
    const title = this.add.text(12, y, event.title, {
      fontSize: `${F.title}px`, color: UI.text, fontFamily: FONT.display, fontStyle: 'bold', wordWrap: { width: this.W - 24 },
    });
    auditTextBlock(title, { name: 'Mobile run event title', maxWidth: this.W - 24, maxHeight: F.title * 2, minFontSize: 12 });
    y += title.height + 8;
    const body = this.add.text(12, y, event.body, {
      fontSize: `${F.body}px`, color: UI.textDim, fontFamily: FONT.body, wordWrap: { width: this.W - 24 }, lineSpacing: 3,
    });
    auditTextBlock(body, { name: 'Mobile run event body', maxWidth: this.W - 24, maxHeight: F.body * 8 + 16, minFontSize: 9 });
    y += body.height + 16;

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

  private renderBonusDraftPicker(): void {
    const title = this.add.text(12, 132, 'PICK ONE TO KEEP', {
      fontSize: `${F.name}px`, color: UI.textAccent, fontFamily: FONT.display, fontStyle: 'bold',
    });
    const rewardLabel = this.add.text(this.W - 12, 134, 'EVENT REWARD', {
      fontSize: `${F.tiny}px`, color: UI.textSoft, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(1, 0);
    this.add.rectangle(12, 156, this.W - 24, 1, UI.border, 0.55).setOrigin(0, 0);
    auditTextBlock(title, { name: 'Mobile run event bonus draft title', maxWidth: this.W - 150, maxHeight: F.name * 2, minFontSize: 10 });
    auditTextBlock(rewardLabel, { name: 'Mobile run event reward label', maxWidth: 120, maxHeight: F.tiny * 2, minFontSize: 8 });

    let y = 170;
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

  private renderOutcome(outcome: EventOutcome): void {
    const resolved = this.add.text(12, 132, 'EVENT RESOLVED', {
      fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold',
    });
    this.add.rectangle(12, 154, this.W - 24, 1, UI.border, 0.55).setOrigin(0, 0);
    auditTextBlock(resolved, { name: 'Mobile run event resolved label', maxWidth: 160, maxHeight: F.tiny * 2, minFontSize: 8 });

    let y = 172;
    const { headline, detail } = outcomeHeadline(outcome);
    const headlineText = this.add.text(this.W / 2, y, headline, {
      fontSize: `${F.title}px`, color: UI.text, fontFamily: FONT.display, fontStyle: 'bold', align: 'center', wordWrap: { width: this.W - 40 },
    }).setOrigin(0.5, 0);
    auditTextBlock(headlineText, { name: 'Mobile run event outcome headline', maxWidth: this.W - 40, maxHeight: F.title * 2, minFontSize: 12 });
    y += headlineText.height + 8;
    if (detail) {
      const detailText = this.add.text(this.W / 2, y, detail, {
        fontSize: `${F.small}px`, color: UI.textDim, fontFamily: FONT.body, align: 'center', wordWrap: { width: this.W - 40 },
      }).setOrigin(0.5, 0);
      auditTextBlock(detailText, { name: 'Mobile run event outcome detail', maxWidth: this.W - 40, maxHeight: F.small * 2, minFontSize: 8 });
      y += detailText.height + 10;
    }
    y += 12;

    if (outcome.kind === 'grantCard' && !outcome.fellBack) {
      const skill = skillBook[outcome.skillId];
      if (skill) {
        const shown = outcome.tier === skill.tier ? skill : applyTier(skill, outcome.tier);
        const cardW = 126;
        const cardH = Math.round(cardW * (690 / 420));
        new CardToken(this, this.W / 2, y + cardH / 2, shown, { width: cardW, height: cardH, side: 'left' });
        y += cardH + 16;
      }
    } else if (outcome.kind === 'grantGem') {
      const gem = gemBook[outcome.gemId];
      if (gem) {
        const chipW = this.W - 40;
        this.add.rectangle(20, y, chipW, 52, UI.panelMuted, 0.94).setOrigin(0, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.9);
        this.add.rectangle(42, y + 26, 12, 12, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45);
        const gemName = this.add.text(60, y + 17, gem.name, {
          fontSize: `${F.body}px`, color: UI.text, fontFamily: FONT.display, fontStyle: 'bold', wordWrap: { width: chipW - 78 },
        });
        auditTextBlock(gemName, { name: 'Mobile run event gem name', maxWidth: chipW - 78, maxHeight: F.body * 2, minFontSize: 9 });
        addHoverTipZone(this, { x: 20, y, w: chipW, h: 52 }, [gemHoverEntry(gem)]);
        y += 52 + 16;
      }
    }

    const btnW = this.W - 20;
    const btnY = this.H - MOBILE_PROFILE.safe.bottom - 44;
    const btn = this.add.rectangle(10, btnY, btnW, 44, UI.chip, 1).setOrigin(0, 0).setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true });
    const btnText = this.add.text(this.W / 2, btnY + 22, 'CONTINUE ›', {
      fontSize: `${F.name}px`, color: UI.textOnChip, fontFamily: FONT.display, fontStyle: 'bold',
    }).setOrigin(0.5);
    auditControlLabel(btn, btnText, { name: 'Mobile run event continue', horizontalPadding: 14, verticalPadding: 6, minFontSize: 8 });
    btn.on('pointerdown', () => { leaveCurrentEvent(); this.scene.start('MobileRunMap'); });
  }
}
