import Phaser from 'phaser';
import { skillBook } from '../../data/skills';
import { applyDraftPicks } from '../draftActions';
import { DRAFT_SET_KEYS, rollStartDraft, type DraftSetKey, type StartDraft } from '../../run/draft';
import { demoState } from '../demoState';
import { FONT, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { renderActionBar, type ActionButton } from '../ui/ActionBar';
import { rebuildScene } from '../sceneRebuild';
import { applyRunDraft, getActiveRun, isRunDrafting } from '../runStore';

const SET_LABEL: Record<DraftSetKey, string> = {
  offense: 'OFFENSE', defense: 'DEFENSE / SUSTAIN', support: 'SUPPORT / UTILITY', wildcard: 'WILDCARD',
};

/**
 * Mobile Draft — the new-game start pick, one set at a time (offense →
 * defense → support → wildcard, `rollStartDraft`) with a "SET n/4"
 * progress header and BACK/NEXT footer nav. Tap a card to pick it for the
 * current set (changeable any time by navigating back); START (only shown
 * once all 4 are picked) replaces the board/bag with the 4 picks and zeroes
 * gold, then goes to Prep. Reachable at ?scene=mobile-draft.
 */
export class MobileDraftScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private picks: Partial<Record<DraftSetKey, string>> = {};
  private setIndex = 0;
  private draft!: StartDraft;
  /** True when a Run Mode run is sitting in 'drafting' status — the
   * discriminator between the sandbox draft (writes demoState) and the
   * run-start draft (writes the active run via `applyRunDraft`). */
  private runContext = false;

  constructor() { super('MobileDraft'); }

  init(): void {
    this.picks = {};
    this.setIndex = 0;
    this.runContext = isRunDrafting();
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);
    const seed = this.runContext ? getActiveRun()!.seed : demoState.seed;
    this.draft = rollStartDraft(seed);
    if (this.runContext) this.renderRunTabs(); else this.renderTabs();
    this.renderHeader();
    this.renderSet();
    this.renderFooter();
  }

  private renderTabs(): void {
    const tabs: Array<[string, boolean, () => void]> = [
      ['PREP', false, () => this.scene.start('MobilePrep')],
      ['DECK', false, () => this.scene.start('MobileDeckBuild')],
      ['WIKI', false, () => this.scene.start('MobileWiki')],
      ['SHOP', false, () => this.scene.start('MobileShop')],
      ['DRAFT', true, () => {}],
    ];
    const gap = 5;
    const w = (this.W - 20 - gap * (tabs.length - 1)) / tabs.length;
    tabs.forEach(([label, active, fn], i) => {
      const x = 10 + i * (w + gap);
      const r = this.add.rectangle(x, 8, w, 34, active ? 0xb78a46 : 0x131f32).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      this.add.text(x + w / 2, 25, label, { fontSize: '9px', color: active ? '#1a1208' : UI.textDim, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    });
  }

  /** Run-context header — no sandbox tabs (those would navigate away from the
   * run mid-draft); a plain title + a small SANDBOX escape, mirroring the run
   * map's own link. */
  private renderRunTabs(): void {
    this.add.text(12, 10, 'RUN · DRAFT', { fontSize: '13px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold' });
    const link = this.add.text(this.W - 12, 10, 'SANDBOX ›', {
      fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    link.on('pointerdown', () => this.scene.start('MobilePrep'));
  }

  private renderHeader(): void {
    const key = DRAFT_SET_KEYS[this.setIndex]!;
    const picked = Object.keys(this.picks).length;
    this.add.text(12, 50, `DRAFT · SET ${this.setIndex + 1}/${DRAFT_SET_KEYS.length}`, { fontSize: '10px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' });
    this.add.text(12, 64, SET_LABEL[key], { fontSize: '15px', color: '#c69948', fontFamily: FONT.display, fontStyle: 'bold' });
    this.add.text(this.W - 12, 64, `${picked}/${DRAFT_SET_KEYS.length} PICKED`, { fontSize: '10px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0);
  }

  private renderSet(): void {
    const key = DRAFT_SET_KEYS[this.setIndex]!;
    const cards = this.draft[key];
    const picked = this.picks[key];
    let y = 96;
    const h = 80;
    const gap = 8;
    for (const card of cards) {
      const skill = skillBook[card.skillId];
      if (!skill) { y += h + gap; continue; }
      const isPicked = picked === card.skillId;
      if (isPicked) {
        this.add.rectangle(10 - 3, y - 3, this.W - 20 + 6, h + 6, 0, 0).setOrigin(0, 0).setStrokeStyle(3, 0xe8b446, 1);
      }
      new CardToken(this, 10 + (this.W - 20) / 2, y + h / 2, skill, { width: this.W - 20, height: h, side: 'left' });
      const hit = this.add.rectangle(10 + (this.W - 20) / 2, y + h / 2, this.W - 20, h, 0xffffff, 0).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => { this.picks[key] = card.skillId; this.rerender(); });
      if (isPicked) {
        this.add.text(this.W - 18, y + 6, '✓ PICKED', { fontSize: '9px', color: '#1a1208', fontFamily: FONT.body, fontStyle: 'bold' })
          .setOrigin(1, 0).setBackgroundColor('#e8b446').setPadding(4, 2, 4, 2);
      }
      y += h + gap;
    }
  }

  private renderFooter(): void {
    const ready = Object.keys(this.picks).length === DRAFT_SET_KEYS.length;
    const buttons: ActionButton[] = [];
    if (this.setIndex > 0) buttons.push({ label: 'BACK', onPress: () => { this.setIndex -= 1; this.rerender(); } });
    if (this.setIndex < DRAFT_SET_KEYS.length - 1) {
      buttons.push({ label: 'NEXT', primary: true, flex: 2, onPress: () => { this.setIndex += 1; this.rerender(); } });
    } else if (ready) {
      buttons.push({
        label: 'START', primary: true, flex: 2, onPress: () => {
          if (this.runContext) {
            applyRunDraft(this.picks);
            this.scene.start('MobileRunMap');
          } else {
            applyDraftPicks(this.picks);
            this.scene.start('MobilePrep');
          }
        },
      });
    } else {
      buttons.push({ label: 'PICK ALL 4 TO START', flex: 2, onPress: () => {} });
    }
    renderActionBar(this, this.W, this.H, buttons);
  }
}
