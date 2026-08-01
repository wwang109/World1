import Phaser from 'phaser';
import { skillBook } from '../../data/skills';
import { applyDraftPicks } from '../draftActions';
import { DRAFT_SET_KEYS, rollStartDraft, type DraftSetKey, type StartDraft } from '../../run/draft';
import { demoState } from '../demoState';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { DESKTOP_LAYOUT, renderDesktopBackground, renderDesktopHeader } from '../ui/DesktopNav';
import { renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { rebuildScene } from '../sceneRebuild';
import { applyRunDraft, getActiveRun, isRunDrafting } from '../runStore';

const F = DESKTOP_PROFILE.font;

const SET_LABEL: Record<DraftSetKey, string> = {
  offense: 'OFFENSE', defense: 'DEFENSE / SUSTAIN', support: 'SUPPORT / UTILITY', wildcard: 'WILDCARD',
};

/**
 * Desktop Draft — the new-game start pick: 4 rows of 5 bronze cards (offense
 * / defense-sustain / support-utility / wildcard, `rollStartDraft`). Click a
 * card to pick it for its row (changeable any time before START); START
 * (enabled once all 4 rows are picked) replaces the board/bag with the 4
 * picks and zeroes gold, then goes to Prep.
 */
export class DesktopDraftScene extends Phaser.Scene {
  private picks: Partial<Record<DraftSetKey, string>> = {};
  private draft!: StartDraft;
  /** True when a Run Mode run is sitting in 'drafting' status — the discriminator
   * between the sandbox draft (writes demoState) and the run-start draft
   * (writes the active run via `applyRunDraft`). No separate context flag/
   * param needed: the active run's own status IS the context. */
  private runContext = false;

  constructor() { super('DesktopDraft'); }

  init(): void {
    this.picks = {};
    this.runContext = isRunDrafting();
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    const seed = this.runContext ? getActiveRun()!.seed : demoState.seed;
    this.draft = rollStartDraft(seed);
    renderDesktopBackground(this);
    if (this.runContext) {
      // THE run HUD's kicker/title/stats — no DECK/BAG or RETIRE slot yet
      // (the run is still 'drafting': there's no board to manage and RETIRE
      // only applies to an 'active' run).
      const run = getActiveRun()!;
      renderRunHud(this, { screen: 'DRAFT', compact: false, snapshot: snapshotRunProgress(run) });
    } else {
      renderDesktopHeader(this, 'DRAFT', 'draft');
    }
    this.renderIntro();
    this.renderSets();
    this.renderStart();
  }

  private renderIntro(): void {
    const gx = DESKTOP_LAYOUT.gutter;
    const top = DESKTOP_LAYOUT.contentTop;
    const picked = Object.keys(this.picks).length;
    this.add.text(SCREEN.width - gx, top, `PICK ONE PER ROW · ${picked}/${DRAFT_SET_KEYS.length}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textAccent,
    }).setOrigin(1, 0);
  }

  private renderSets(): void {
    const gx = DESKTOP_LAYOUT.gutter;
    const top = DESKTOP_LAYOUT.contentTop + F.label + 14;
    const bottom = SCREEN.height - DESKTOP_PROFILE.safe.bottom - 76;
    const rows = DRAFT_SET_KEYS.length;
    const rowGap = 12;
    const labelH = 20;
    const rowH = (bottom - top - rowGap * (rows - 1)) / rows;
    const cardH = rowH - labelH;
    const cols = 5;
    const cardGap = DESKTOP_LAYOUT.gap;
    const w = SCREEN.width - gx * 2;
    const cardW = (w - cardGap * (cols - 1)) / cols;

    DRAFT_SET_KEYS.forEach((key, rowIndex) => {
      const rowTop = top + rowIndex * (rowH + rowGap);
      const cards = this.draft[key];
      const picked = this.picks[key];
      this.add.text(gx, rowTop, `${SET_LABEL[key]} · SET ${rowIndex + 1}/${rows}`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim,
      });
      cards.forEach((card, i) => {
        const skill = skillBook[card.skillId];
        if (!skill) return;
        const cx = gx + i * (cardW + cardGap);
        const cy = rowTop + labelH;
        const isPicked = picked === card.skillId;
        if (isPicked) {
          this.add.rectangle(cx - 3, cy - 3, cardW + 6, cardH + 6, 0, 0).setOrigin(0, 0).setStrokeStyle(3, UI.chip, 1);
        }
        const tok = new CardToken(this, cx + cardW / 2, cy + cardH / 2, skill, { width: cardW, height: cardH, side: 'left' });
        const hit = this.add.rectangle(cx + cardW / 2, cy + cardH / 2, cardW, cardH, 0xffffff, 0).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => { this.picks[key] = card.skillId; this.rerender(); });
        if (isPicked) {
          this.add.text(cx + cardW - 6, cy + 6, '✓', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.textAccent }).setOrigin(1, 0);
        }
        void tok;
      });
    });
  }

  private renderStart(): void {
    const gx = DESKTOP_LAYOUT.gutter;
    const w = 260;
    const h = 56;
    const x = SCREEN.width - gx - w;
    const y = SCREEN.height - DESKTOP_PROFILE.safe.bottom - h;
    const ready = Object.keys(this.picks).length === DRAFT_SET_KEYS.length;
    const btn = this.add.rectangle(x, y, w, h, ready ? UI.chip : UI.panelMuted, ready ? 1 : 0.5)
      .setOrigin(0, 0).setStrokeStyle(2, UI.border, ready ? 1 : 0.4);
    this.add.text(x + w / 2, y + h / 2, 'START', { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: ready ? UI.textOnChip : UI.textSoft }).setOrigin(0.5);
    if (ready) {
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => {
        if (this.runContext) {
          applyRunDraft(this.picks);
          this.scene.start('DesktopRunMap');
        } else {
          applyDraftPicks(this.picks);
          this.scene.start('DesktopPrep');
        }
      });
    }
  }
}
