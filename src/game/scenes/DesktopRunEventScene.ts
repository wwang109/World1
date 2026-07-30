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
import { choiceOutcomeHint, outcomeHeadline } from '../ui/eventOutcomeText';
import { addHoverTipZone } from '../ui/hoverTip';
import { gemHoverEntry } from '../ui/gemGlossary';
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
    this.add.rectangle(GX, 150 - 16, SCREEN.width - GX * 2, 1, UI.border, 0.7).setOrigin(0, 0);
  }

  private panelGeometry(): { px: number; py: number; pw: number } {
    const pw = 720;
    const px = (SCREEN.width - pw) / 2;
    const py = 170;
    return { px, py, pw };
  }

  // ---------- choosing ----------

  private renderChoicePanel(gold: number, event: EventDef): void {
    const { px, py, pw } = this.panelGeometry();
    const innerX = px + 28;
    const innerW = pw - 56;
    let cursor = py;

    this.add.rectangle(px, py, pw, 440, UI.panel, 0.94).setOrigin(0, 0).setStrokeStyle(2, UI.chip, 0.8);
    cursor += 26;
    this.add.text(px + pw / 2, cursor, event.title, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.text, align: 'center', wordWrap: { width: innerW },
    }).setOrigin(0.5, 0);
    cursor += F.title + 16;
    const body = this.add.text(px + pw / 2, cursor, event.body, {
      fontFamily: FONT.body, fontSize: `${F.body}px`, color: UI.textDim, align: 'center', wordWrap: { width: innerW }, lineSpacing: 4,
    }).setOrigin(0.5, 0);
    cursor += body.height + 28;

    const btnH = 68;
    const gap = 14;
    event.choices.forEach((choice: EventChoiceDef) => {
      const cost = choice.cost ?? 0;
      const affordable = gold >= cost;
      const fill = affordable ? UI.panelAlt : UI.panelMuted;
      const btn = this.add.rectangle(innerX, cursor, innerW, btnH, fill, affordable ? 1 : 0.55)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, affordable ? 0.9 : 0.35);
      this.add.text(innerX + 18, cursor + 14, choice.label, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.body}px`, color: affordable ? UI.text : UI.textSoft,
      });
      const costLabel = cost > 0 ? `COST ${cost} GOLD` : 'FREE';
      this.add.text(innerX + 18, cursor + 14 + F.body + 4, costLabel, {
        fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: affordable ? UI.textDim : UI.textSoft,
      });
      this.add.text(innerX + innerW - 18, cursor + btnH / 2, `→ ${choiceOutcomeHint(choice.outcome)}`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: affordable ? UI.textAccent : UI.textSoft,
      }).setOrigin(1, 0.5);
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
      cursor += btnH + gap;
    });
  }

  // ---------- bonusDraft picker ----------

  private renderBonusDraftPicker(): void {
    const { px, py, pw } = this.panelGeometry();
    const ph = 220;
    this.add.rectangle(px, py, pw, ph, UI.panel, 0.94).setOrigin(0, 0).setStrokeStyle(2, UI.chip, 0.8);
    this.add.text(px + pw / 2, py + 20, 'PICK ONE TO KEEP', {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.textAccent,
    }).setOrigin(0.5, 0);

    const cards = this.bonusDraftCards;
    const n = Math.max(1, cards.length);
    const gap = DESKTOP_PROFILE.gap;
    const cardTop = py + 60;
    const cardH = ph - 80;
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
    const ph = 320;
    this.add.rectangle(px, py, pw, ph, UI.panel, 0.94).setOrigin(0, 0).setStrokeStyle(2, UI.chip, 0.8);
    const { headline, detail } = outcomeHeadline(outcome);
    let cursor = py + 26;
    this.add.text(px + pw / 2, cursor, headline, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.text, align: 'center', wordWrap: { width: pw - 56 },
    }).setOrigin(0.5, 0);
    cursor += F.title + 10;
    if (detail) {
      this.add.text(px + pw / 2, cursor, detail, {
        fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim, align: 'center',
      }).setOrigin(0.5, 0);
      cursor += F.small + 10;
    }
    cursor += 12;

    if (outcome.kind === 'grantCard' && !outcome.fellBack) {
      const skill = skillBook[outcome.skillId];
      if (skill) {
        const shown = outcome.tier === skill.tier ? skill : applyTier(skill, outcome.tier);
        const cardW = 150;
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
    this.add.text(px + pw / 2, btnY + 22, 'CONTINUE ›', {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.textOnChip,
    }).setOrigin(0.5);
    btn.on('pointerdown', () => { leaveCurrentEvent(); this.scene.start('DesktopRunMap'); });
  }
}
