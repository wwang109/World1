import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { skillBook } from '../../data/skills';
import { powerLevelDeci } from '../../engine/balance';
import { setDeckBuildContext } from '../deckBuildContext';
import { applyDraftPicks } from '../draftActions';
import { DRAFT_SET_KEYS, rollStartDraftAt, type DraftSetKey, type StartDraft } from '../../run/draft';
import { demoState } from '../demoState';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';
import { renderCardInfoBox } from '../ui/cardInfoBox';
import { renderActionBar, type ActionButton } from '../ui/ActionBar';
import { renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { rebuildScene } from '../sceneRebuild';
import {
  applyRunDraft, currentStartDraftHand, currentStartDraftPicks, getActiveRun, isRunDrafting,
  pickCurrentStartDraftCard, rerollCurrentStartDraft,
} from '../runStore';

const F = MOBILE_PROFILE.font;

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
  private setIndex = 0;
  /** The 4x5 offer this render is drawing — snapshotted once per `create()`
   * from `currentHand()` so the four rows can never disagree about what is on
   * screen. */
  private draft!: StartDraft;
  /** True when a Run Mode run is sitting in 'drafting' status — the
   * discriminator between the sandbox draft (writes demoState) and the
   * run-start draft (writes the active run via `applyRunDraft`). */
  private runContext = false;
  /** skillId whose read-only detail overlay is open (the ⓘ corner badge on a
   * draft card — separate hit-zone from the card's own one-tap PICK). */
  private detailSkillId: string | null = null;

  constructor() { super('MobileDraft'); }

  init(): void {
    // NOTHING DRAFT-RELATED IS RESET HERE. `init()` runs again on every
    // `scene.start` — including the Run Map's bounce back into the draft after
    // a page reload — and clearing the reroll count and the picks here is
    // exactly how the player's work was thrown away. Both now live where they
    // survive that: the run (`RunState.draft`), or a scene field the Sandbox
    // keeps for its unsaved session. `setIndex`/`detailSkillId` DO reset: they
    // are where the player is looking, not what they decided.
    this.setIndex = 0;
    this.runContext = isRunDrafting();
    this.detailSkillId = null;
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
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);
    this.draft = this.currentHand();
    if (this.runContext) {
      // THE run HUD's kicker/title/stats — no DECK/BAG or RETIRE slot yet
      // (still 'drafting': no board, and RETIRE only applies once 'active').
      renderRunHud(this, { screen: 'DRAFT', compact: true, snapshot: snapshotRunProgress(getActiveRun()!) });
    } else {
      this.renderTabs();
    }
    this.renderHeader();
    this.renderSet();
    this.renderFooter();
    if (this.detailSkillId) this.renderDetail();
  }

  private renderTabs(): void {
    const tabs: Array<[string, boolean, () => void]> = [
      ['MENU', false, () => this.scene.start('Start')],
      ['PREP', false, () => this.scene.start('MobilePrep')],
      ['DECK', false, () => { setDeckBuildContext('demo'); this.scene.start('MobileDeckBuild'); }],
      ['WIKI', false, () => this.scene.start('MobileWiki')],
      ['SHOP', false, () => this.scene.start('MobileShop')],
      ['DRAFT', true, () => {}],
    ];
    const gap = 5;
    const w = (this.W - 20 - gap * (tabs.length - 1)) / tabs.length;
    tabs.forEach(([label, active, fn], i) => {
      const x = 10 + i * (w + gap);
      const r = this.add.rectangle(x, 8, w, 34, active ? 0xb78a46 : 0x131f32).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', () => { playSfx('uiClick'); fn(); });
      this.add.text(x + w / 2, 25, label, { fontSize: `${F.tiny}px`, color: active ? UI.textOnChip : UI.textDim, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    });
  }

  private renderHeader(): void {
    const key = DRAFT_SET_KEYS[this.setIndex]!;
    const picked = Object.keys(this.picks).length;
    // Run context: the HUD already occupies y≈0-96, so this content starts
    // lower than the Sandbox's own tab-bar layout (y≈50).
    const top = this.runContext ? 100 : 50;
    this.add.text(12, top, `DRAFT · SET ${this.setIndex + 1}/${DRAFT_SET_KEYS.length}`, { fontSize: `${F.small}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' });
    this.add.text(12, top + 14, SET_LABEL[key], { fontSize: `${F.heading}px`, color: UI.textAccent, fontFamily: FONT.display, fontStyle: 'bold' });
    this.add.text(this.W - 12, top + 14, `${picked}/${DRAFT_SET_KEYS.length} PICKED`, { fontSize: `${F.small}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0);
  }

  private renderSet(): void {
    const key = DRAFT_SET_KEYS[this.setIndex]!;
    const cards = this.draft[key];
    const picked = this.picks[key];
    let y = this.runContext ? 146 : 96;
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
      hit.on('pointerdown', () => { playSfx('uiClick'); this.pick(key, card.skillId); this.rerender(); });
      // ⓘ corner badge — a SEPARATE, smaller hit-zone drawn on top (Phaser's
      // default `topOnly` input means only it fires inside its own bounds),
      // so PICK stays a single tap anywhere else on the card. Opens a
      // read-only detail overlay instead of picking.
      const badgeSize = 22;
      const badge = this.add.rectangle(10 + (this.W - 20) - badgeSize / 2 - 4, y + badgeSize / 2 + 4, badgeSize, badgeSize, 0x0b1420, 0.85)
        .setOrigin(0.5).setStrokeStyle(1, UI.chip, 0.9).setInteractive({ useHandCursor: true });
      this.add.text(badge.x, badge.y, 'i', { fontSize: `${F.label}px`, color: UI.textAccent, fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
      badge.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        playSfx('uiClick');
        this.detailSkillId = card.skillId;
        this.rerender();
      });
      if (isPicked) {
        this.add.text(this.W - 18, y + 6, '✓ PICKED', { fontSize: `${F.tiny}px`, color: UI.textOnChip, fontFamily: FONT.body, fontStyle: 'bold' })
          .setOrigin(1, 0).setBackgroundColor('#e8b446').setPadding(4, 2, 4, 2);
      }
      y += h + gap;
    }
  }

  /** Read-only card detail (opened by the ⓘ corner badge, not the card
   * itself — see `renderSet`'s `badge` hit-zone). Veil + big card + full
   * text + a glossary entry for every abbreviation/keyword the card uses;
   * no PICK button here — picking stays the card's own one-tap action. */
  private renderDetail(): void {
    const skill = this.detailSkillId ? skillBook[this.detailSkillId] : undefined;
    if (!skill) { this.detailSkillId = null; return; }

    const close = (): void => { this.detailSkillId = null; this.rerender(); };
    const veil = this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.88).setOrigin(0, 0).setInteractive();
    veil.on('pointerdown', () => { playSfx('uiBack'); close(); });

    const closeBtn = this.add.rectangle(this.W - 30, 46, 28, 28, 0x24344a, 1)
      .setOrigin(0.5).setStrokeStyle(1, 0x8a94a6, 0.8).setInteractive({ useHandCursor: true });
    this.add.text(closeBtn.x, closeBtn.y, '×', { fontSize: `${F.xlarge}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    closeBtn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation(); playSfx('uiBack'); close();
    });

    const paneWidth = this.W - 40;
    const centerX = this.W / 2;
    const cardW = 140;
    const cardH = cardW * (690 / 420);
    let y = 66;
    const cardY = y + cardH / 2;
    new FantasyCardTemplateV2(this, centerX, cardY, skill, { width: cardW, height: cardH, tier: skill.tier, glossary: false });
    y = cardY + cardH / 2 + 10;

    const name = this.add.text(centerX, y, skill.name, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.heading}px`, color: UI.textBright,
      align: 'center', wordWrap: { width: paneWidth },
    }).setOrigin(0.5, 0);
    y += name.height + 4;

    const plDeci = powerLevelDeci(skill);
    const plLine = this.add.text(centerX, y, `POWER ${(plDeci / 10).toFixed(0)} · ${skill.tier.toUpperCase()}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: '#e8b446',
    }).setOrigin(0.5, 0);
    y += plLine.height + 10;

    const infoTop = y;
    const infoH = this.H - infoTop - 20;
    this.add.rectangle(centerX - paneWidth / 2, infoTop, paneWidth, infoH, 0x101a2a, 0.6).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
    renderCardInfoBox(this, centerX - paneWidth / 2, infoTop, paneWidth, infoH, skill);
  }

  private renderFooter(): void {
    const ready = Object.keys(this.picks).length === DRAFT_SET_KEYS.length;
    const buttons: ActionButton[] = [];
    // Fresh 4×5 offer off a deterministic seed stride, with the picks cleared
    // in the same write (`reroll()` above); nav returns to set 1.
    buttons.push({ label: 'REROLL', onPress: () => { playSfx('uiClick'); this.reroll(); this.setIndex = 0; this.rerender(); } });
    if (this.setIndex > 0) buttons.push({ label: 'BACK', onPress: () => { playSfx('uiClick'); this.setIndex -= 1; this.rerender(); } });
    if (this.setIndex < DRAFT_SET_KEYS.length - 1) {
      buttons.push({ label: 'NEXT', primary: true, flex: 2, onPress: () => { playSfx('uiClick'); this.setIndex += 1; this.rerender(); } });
    } else if (ready) {
      buttons.push({
        label: 'START', primary: true, flex: 2, onPress: () => {
          playSfx('uiClick');
          if (this.runContext) {
            applyRunDraft();
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
