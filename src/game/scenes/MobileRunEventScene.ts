import Phaser from 'phaser';
import { skillBook } from '../../data/skills';
import { gemBook } from '../../data/gems';
import type { EventChoiceDef, EventDef } from '../../data/events';
import type { DraftCard } from '../../run/draft';
import type { EventOutcome } from '../../run/events';
import { applyTier } from '../../engine/cards';
import { FONT, GEM_RARITY_COLOR, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { choiceOutcomeHint, outcomeHeadline } from '../ui/eventOutcomeText';
import { rebuildScene } from '../sceneRebuild';
import {
  applyCurrentBonusDraftPick,
  currentEventDef,
  getActiveRun,
  leaveCurrentEvent,
  resolveCurrentEventChoice,
} from '../runStore';

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

    this.renderHeader(run);
    if (this.phase === 'outcome' && this.outcome) this.renderOutcome(this.outcome);
    else if (this.phase === 'bonusDraftPick') this.renderBonusDraftPicker();
    else this.renderChoices(run.gold, event);
  }

  private renderHeader(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    this.add.text(12, 10, 'EVENT', { fontSize: '18px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold' });
    this.add.text(this.W - 12, 14, `GOLD ${run.gold}`, { fontSize: '11px', color: '#c69948', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0);
    this.add.rectangle(10, 36, this.W - 20, 1, UI.border, 0.6).setOrigin(0, 0);
  }

  // ---------- choosing ----------

  private renderChoices(gold: number, event: EventDef): void {
    let y = 50;
    this.add.text(12, y, event.title, { fontSize: '15px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold', wordWrap: { width: this.W - 24 } });
    y += 26;
    const body = this.add.text(12, y, event.body, {
      fontSize: '10px', color: '#9aa4b6', fontFamily: FONT.body, wordWrap: { width: this.W - 24 }, lineSpacing: 3,
    });
    y += body.height + 16;

    const rowH = 70;
    const gap = 8;
    event.choices.forEach((choice: EventChoiceDef) => {
      const cost = choice.cost ?? 0;
      const affordable = gold >= cost;
      const fill = affordable ? 0x16233a : 0x101a2a;
      const btn = this.add.rectangle(10, y, this.W - 20, rowH, fill, affordable ? 1 : 0.55).setOrigin(0, 0).setStrokeStyle(1, UI.border, affordable ? 0.8 : 0.3);
      this.add.text(20, y + 10, choice.label, {
        fontSize: '12px', color: affordable ? '#e8e0c8' : '#5a6880', fontFamily: FONT.body, fontStyle: 'bold', wordWrap: { width: this.W - 40 },
      });
      const costLabel = cost > 0 ? `COST ${cost} GOLD` : 'FREE';
      this.add.text(20, y + rowH - 18, costLabel, { fontSize: '9px', color: affordable ? '#8a94a6' : '#c36a57', fontFamily: FONT.body });
      this.add.text(this.W - 20, y + rowH - 18, `→ ${choiceOutcomeHint(choice.outcome)}`, {
        fontSize: '9px', color: affordable ? '#c69948' : '#5a6880', fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(1, 0);
      if (affordable) {
        btn.setInteractive({ useHandCursor: true });
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
      y += rowH + gap;
    });
  }

  // ---------- bonusDraft picker ----------

  private renderBonusDraftPicker(): void {
    this.add.text(12, 50, 'PICK ONE TO KEEP', { fontSize: '14px', color: '#c69948', fontFamily: FONT.display, fontStyle: 'bold' });
    let y = 80;
    const h = 78;
    const gap = 8;
    for (const card of this.bonusDraftCards) {
      const skill = skillBook[card.skillId];
      if (!skill) { y += h + gap; continue; }
      const shown = card.tier === skill.tier ? skill : applyTier(skill, card.tier);
      new CardToken(this, 10 + (this.W - 20) / 2, y + h / 2, shown, { width: this.W - 20, height: h, side: 'left' });
      const hit = this.add.rectangle(10 + (this.W - 20) / 2, y + h / 2, this.W - 20, h, 0xffffff, 0).setInteractive({ useHandCursor: true });
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
    let y = 60;
    const { headline, detail } = outcomeHeadline(outcome);
    this.add.text(this.W / 2, y, headline, {
      fontSize: '16px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold', align: 'center', wordWrap: { width: this.W - 40 },
    }).setOrigin(0.5, 0);
    y += 30;
    if (detail) {
      this.add.text(this.W / 2, y, detail, { fontSize: '10px', color: '#9aa4b6', fontFamily: FONT.body, align: 'center' }).setOrigin(0.5, 0);
      y += 22;
    }
    y += 12;

    if (outcome.kind === 'grantCard' && !outcome.fellBack) {
      const skill = skillBook[outcome.skillId];
      if (skill) {
        const shown = outcome.tier === skill.tier ? skill : applyTier(skill, outcome.tier);
        const cardW = 140;
        const cardH = Math.round(cardW * (690 / 420));
        new CardToken(this, this.W / 2, y + cardH / 2, shown, { width: cardW, height: cardH, side: 'left' });
        y += cardH + 16;
      }
    } else if (outcome.kind === 'grantGem') {
      const gem = gemBook[outcome.gemId];
      if (gem) {
        const chipW = this.W - 60;
        this.add.rectangle(30, y, chipW, 52, 0x101a2a, 0.94).setOrigin(0, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.9);
        this.add.rectangle(30 + 22, y + 26, 12, 12, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45);
        this.add.text(30 + 40, y + 17, gem.name, { fontSize: '12px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold' });
        y += 52 + 16;
      }
    }

    const btnW = this.W - 60;
    const btnY = this.H - 90;
    const btn = this.add.rectangle(30, btnY, btnW, 44, 0xb78a46, 1).setOrigin(0, 0).setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true });
    this.add.text(this.W / 2, btnY + 22, 'CONTINUE ›', { fontSize: '15px', color: '#1a1208', fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    btn.on('pointerdown', () => { leaveCurrentEvent(); this.scene.start('MobileRunMap'); });
  }
}
