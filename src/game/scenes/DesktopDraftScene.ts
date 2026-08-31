import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { skillBook } from '../../data/skills';
import { applyDraftPicks } from '../draftActions';
import { DRAFT_SET_KEYS, rollStartDraftAt, type DraftSetKey, type StartDraft } from '../../run/draft';
import { demoState } from '../demoState';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { attachHoverTip } from '../ui/hoverTip';
import { cardHoverEntries } from '../ui/cardHoverEntries';
import { DESKTOP_LAYOUT, renderDesktopBackground, renderDesktopHeader } from '../ui/DesktopNav';
import { renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { rebuildScene } from '../sceneRebuild';
import {
  applyRunDraft, currentStartDraftHand, currentStartDraftPicks, getActiveRun, isRunDrafting,
  pickCurrentStartDraftCard, rerollCurrentStartDraft,
} from '../runStore';

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
  /** The 4x5 offer this render is drawing — snapshotted once per `create()`
   * from `currentHand()` so the four rows can never disagree about what is on
   * screen. */
  private draft!: StartDraft;
  /** True when a Run Mode run is sitting in 'drafting' status — the discriminator
   * between the sandbox draft (writes demoState) and the run-start draft
   * (writes the active run via `applyRunDraft`). No separate context flag/
   * param needed: the active run's own status IS the context. */
  private runContext = false;

  constructor() { super('DesktopDraft'); }

  init(): void {
    // NOTHING DRAFT-RELATED IS RESET HERE. `init()` runs again on every
    // `scene.start` — including the Run Map's bounce back into the draft after
    // a page reload — and clearing the reroll count and the picks here is
    // exactly how the player's work was thrown away. Both now live where they
    // survive that: the run (`RunState.draft`), or a scene field the Sandbox
    // keeps for its unsaved session.
    this.runContext = isRunDrafting();
  }

  // ---------- draft state (RUN: persisted · SANDBOX: this scene) ----------
  // BOTH PLATFORMS CARRY THIS BLOCK BYTE FOR BYTE — the bug was identical in
  // the two draft scenes, so a one-sided fix is not a fix
  // (`tests/game/draftRerollPersistence.test.ts` compares the two).

  /** SANDBOX ONLY backing store for the reroll counter and the picks. In RUN
   *  context both live on `RunState.draft` (persisted, survives a refresh) —
   *  see the accessors below. The Sandbox never saves anything, so a scene
   *  field is the whole story there, exactly as `sandboxHold` is for the deck
   *  scenes' TEMP HOLDING strip (`7dac1f0`). Deliberately NOT reset in
   *  `init()`: that reset is what threw the work away. */
  private sandboxRerolls = 0;
  private sandboxPicks: Partial<Record<DraftSetKey, string>> = {};

  /** THE HAND ON SCREEN. In run context the RUN decides it — `init()` rebuilds
   *  this scene from nothing on every `scene.start` (and a page reload resumes
   *  through the Run Map straight back into the draft), so a reroll held in a
   *  scene field was silently discarded and the seed's canonical roll served
   *  again. The stride that turns a reroll count into a seed lives in
   *  `src/run/draft.ts`, once, not in a literal on each platform. */
  private currentHand(): StartDraft {
    return this.runContext ? currentStartDraftHand()! : rollStartDraftAt(demoState.seed, this.sandboxRerolls);
  }

  /** The pick made in each set so far. Run context reads the run's own record,
   *  already filtered to cards the current hand actually offers. */
  private get picks(): Partial<Record<DraftSetKey, string>> {
    return this.runContext ? currentStartDraftPicks() : this.sandboxPicks;
  }

  /** Pick (or re-pick) one set. The run layer refuses a card the current roll
   *  does not offer, so the screen cannot install one. */
  private pick(key: DraftSetKey, skillId: string): void {
    if (this.runContext) pickCurrentStartDraftCard(key, skillId);
    else this.sandboxPicks[key] = skillId;
  }

  /** REROLL — a fresh 4×5 offer AND the picks cleared, in ONE run-state write
   *  (`rerollStartDraft`). They must move together: a pick names a card by
   *  skill id and `applyDraftResult` installs whatever id it is given, so a
   *  pick left over from the previous roll would silently hand the player a
   *  card this hand never showed. */
  private reroll(): void {
    if (this.runContext) rerollCurrentStartDraft();
    else { this.sandboxRerolls += 1; this.sandboxPicks = {}; }
  }

  // ---------- /draft state ----------

  private rerender(): void { rebuildScene(this); }

  create(): void {
    this.draft = this.currentHand();
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
        // Hover-tip explains what the card does (name/tier/PL/text + every
        // abbreviation/keyword it prints) before the player commits a pick.
        attachHoverTip(this, hit, { x: cx, y: cy, w: cardW, h: cardH }, cardHoverEntries(skill));
        hit.on('pointerdown', () => { playSfx('uiClick'); this.pick(key, card.skillId); this.rerender(); });
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
    // REROLL sits beside START: a fresh 4×5 offer off a deterministic seed
    // stride, with the picks cleared in the same write (`reroll()` above).
    const rw = 150;
    const rx = x - rw - 12;
    const reroll = this.add.rectangle(rx, y, rw, h, UI.panelAlt, 1)
      .setOrigin(0, 0).setStrokeStyle(2, UI.border, 0.8).setInteractive({ useHandCursor: true });
    this.add.text(rx + rw / 2, y + h / 2, 'REROLL', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.textBright }).setOrigin(0.5);
    reroll.on('pointerdown', () => { playSfx('uiClick'); this.reroll(); this.rerender(); });
    const btn = this.add.rectangle(x, y, w, h, ready ? UI.chip : UI.panelMuted, ready ? 1 : 0.5)
      .setOrigin(0, 0).setStrokeStyle(2, UI.border, ready ? 1 : 0.4);
    this.add.text(x + w / 2, y + h / 2, 'START', { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: ready ? UI.textOnChip : UI.textSoft }).setOrigin(0.5);
    if (ready) {
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => {
        playSfx('uiClick');
        if (this.runContext) {
          applyRunDraft();
          this.scene.start('DesktopRunMap');
        } else {
          applyDraftPicks(this.picks);
          this.scene.start('DesktopPrep');
        }
      });
    }
  }
}
