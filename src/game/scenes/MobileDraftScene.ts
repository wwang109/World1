import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { skillBook } from '../../data/skills';
import { setDeckBuildContext } from '../deckBuildContext';
import { applyDraftPicks } from '../draftActions';
import { DRAFT_SET_KEYS, rollStartDraftAt, type DraftSetKey, type StartDraft } from '../../run/draft';
import { demoState } from '../demoState';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI, textRole } from '../theme';
import { CardToken } from '../ui/CardToken';
import { CardDetailActivation } from '../ui/cardDetailActivation';
import { renderCardDetailsDrawer } from '../ui/cardDetailsDrawer';
import { buildCardArtPlaceholder } from '../ui/cardArtPlaceholder';
import { whenCardArtReady } from '../ui/cardArtLoader';
import { auditControlLabel } from '../ui/controlLayoutAudit';
import { attachButtonFeel, pressedFill } from '../ui/motion';
import { mobileDraftActionRects, mobileDraftActions, mobileDraftLayout, type MobileDraftActionId } from '../ui/mobileDraftLayout';
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
  private readonly detailActivation = new CardDetailActivation();
  private detailSkillId: string | null = null;

  constructor() { super('MobileDraft'); }

  init(): void {
    this.detailActivation.reset();
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

  private rerender(preserveActivation = false): void {
    if (!preserveActivation) this.detailActivation.reset();
    rebuildScene(this);
  }

  private selectOrInspect(key: DraftSetKey, skillId: string, time: number): void {
    if (this.detailActivation.release(`draft:${key}:${skillId}`, time)) {
      this.detailSkillId = skillId;
      this.rerender();
      return;
    }
    this.pick(key, skillId);
    this.rerender(true);
  }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(UI.bg);
    this.draft = this.currentHand();
    if (this.runContext) {
      renderRunHud(this, { screen: 'DRAFT', compact: true, snapshot: snapshotRunProgress(getActiveRun()!) });
    } else {
      this.renderTabs();
    }
    this.renderHeader();
    this.renderSet();
    this.renderPicks();
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
    const layout = mobileDraftLayout(this.W, this.H, this.runContext);
    const top = layout.header.top;
    if (this.runContext) {
      this.add.text(16, top, `SET ${this.setIndex + 1} OF 4`, textRole('kicker', { ink: 'label' }));
      this.add.text(16, top + 14, SET_LABEL[key], textRole('section', { ink: 'accent' }));
    } else {
      this.add.text(16, top, 'DRAFT', textRole('display', { ink: 'accent' }));
      this.add.text(16, top + 29, `SET ${this.setIndex + 1} OF 4`, textRole('kicker', { ink: 'label' }));
      this.add.text(16, top + 43, SET_LABEL[key], textRole('section', { ink: 'accent' }));
    }

    const progressLeft = this.W - 154;
    for (let index = 0; index < DRAFT_SET_KEYS.length; index += 1) {
      const x = progressLeft + index * 42;
      if (index < DRAFT_SET_KEYS.length - 1) {
        this.add.rectangle(x + 12, top + 17, 30, 2, UI.border, 0.8).setOrigin(0, 0.5);
      }
      const completed = Boolean(this.picks[DRAFT_SET_KEYS[index]!]);
      const current = index === this.setIndex;
      this.add.circle(x, top + 17, 11, current ? UI.chipDark : UI.bg, 1)
        .setStrokeStyle(current ? 2 : 1, current ? UI.chip : UI.border, 1);
      this.add.text(x, top + 17, completed && !current ? '✓' : String(index + 1), {
        ...textRole('label', { ink: current ? 'resource' : 'label' }),
      }).setOrigin(0.5);
      this.add.text(x, top + 35, `SET ${index + 1}`, {
        ...textRole('micro', { ink: current ? 'accent' : 'faint' }),
      }).setOrigin(0.5, 0);
    }

    const final = this.setIndex === DRAFT_SET_KEYS.length - 1;
    this.add.text(16, layout.header.instructionY, final ? 'FINAL PICK' : 'CHOOSE ONE', {
      ...textRole('section'),
    });
    this.add.text(16, layout.header.descriptionY, final ? 'Choose your final card to complete your deck.' : 'Pick one card to continue.', {
      ...textRole('body', { ink: 'faint' }),
    });
  }

  private renderSet(): void {
    const key = DRAFT_SET_KEYS[this.setIndex]!;
    const cards = this.draft[key];
    const picked = this.picks[key];
    const layout = mobileDraftLayout(this.W, this.H, this.runContext);
    for (const [index, card] of cards.entries()) {
      const box = layout.cards[index]!;
      const skill = skillBook[card.skillId];
      if (!skill) continue;
      const isPicked = picked === card.skillId;
      if (isPicked) {
        this.add.rectangle(box.x - 3, box.y - 3, box.w + 6, box.h + 6, 0, 0).setOrigin(0, 0).setStrokeStyle(3, 0xe8b446, 1);
      }
      // PICK is drawn first so CardToken's own interactive inspect button is
      // the topmost hit target. Every other inert token pixel falls through
      // to this full-row surface (the same ordering RunRewardPanel uses).
      const hit = this.add.rectangle(box.x + box.w / 2, box.y + box.h / 2, box.w, box.h, 0xffffff, 0).setInteractive({ useHandCursor: true });
      let pressed: { x: number; y: number } | null = null;
      hit.on('pointerdown', (p: Phaser.Input.Pointer) => { pressed = { x: p.worldX, y: p.worldY }; });
      hit.on('pointerout', () => { if (pressed) this.detailActivation.reset(); pressed = null; });
      hit.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (!pressed) return;
        const moved = Math.hypot(p.worldX - pressed.x, p.worldY - pressed.y);
        pressed = null;
        if (moved >= 8) { this.detailActivation.reset(); return; }
        playSfx('uiClick'); this.selectOrInspect(key, card.skillId, p.upTime);
      });
      new CardToken(this, box.x + box.w / 2, box.y + box.h / 2, skill, {
        width: box.w,
        height: box.h,
        side: 'left',
        onInspect: () => {
          playSfx('uiClick');
          this.detailSkillId = card.skillId;
          this.rerender();
        },
      });
      if (isPicked) {
        // The inward corners belong to CardToken's slot-span and weight
        // badges; keep selection in the otherwise unused bottom centre.
        this.add.text(box.x + box.w - 10, box.y + box.h / 2, 'SELECTED', textRole('kicker', { ink: 'onAccent' }))
          .setOrigin(1, 0.5).setBackgroundColor('#e8b446').setPadding(4, 2, 4, 2);
      }
    }
  }

  private renderPicks(): void {
    const layout = mobileDraftLayout(this.W, this.H, this.runContext);
    this.add.rectangle(10, layout.picksTitleY + 8, 145, 1, UI.border, 0.65).setOrigin(0, 0.5);
    this.add.rectangle(this.W - 155, layout.picksTitleY + 8, 145, 1, UI.border, 0.65).setOrigin(0, 0.5);
    this.add.text(this.W / 2, layout.picksTitleY, 'YOUR PICKS', {
      ...textRole('section', { ink: 'accent' }),
    }).setOrigin(0.5, 0);

    const roleLabels = ['OFFENSE', 'DEFENSE', 'SUPPORT', 'WILD'];
    DRAFT_SET_KEYS.forEach((key, index) => {
      const box = layout.picks[index]!;
      this.add.text(box.art.x + box.art.w / 2, layout.picksRoleY, roleLabels[index]!, {
        ...textRole('kicker', { ink: 'label' }),
      }).setOrigin(0.5, 0);
      const skillId = this.picks[key];
      const skill = skillId ? skillBook[skillId] : undefined;
      if (skill) {
        const maskShape = this.make.graphics({}, false);
        maskShape.fillStyle(0xffffff);
        maskShape.fillRect(box.art.x, box.art.y, box.art.w, box.art.h);
        const mask = maskShape.createGeometryMask();
        const artHost = this.add.container(0, 0);
        const placeholder = buildCardArtPlaceholder(this, skill, box.art.x, box.art.y, box.art.w, box.art.h);
        artHost.add(placeholder);
        placeholder.once(Phaser.GameObjects.Events.DESTROY, () => maskShape.destroy());
        whenCardArtReady(this, skill.id, (artKey) => {
          if (!artHost.scene) return;
          const image = this.add.image(box.art.x + box.art.w / 2, box.art.y + box.art.h / 2, artKey);
          image.setScale(Math.max(box.art.w / image.width, box.art.h / image.height));
          image.setMask(mask);
          artHost.add(image);
        });
        this.add.rectangle(box.art.x, box.art.y, box.art.w, box.art.h, 0, 0)
          .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.9);
        this.add.text(box.name.x + box.name.w / 2, box.name.y, skill.name, {
          ...textRole('micro', { ink: 'secondary' }),
          fontFamily: FONT.display,
          fontStyle: 'bold',
          align: 'center',
          wordWrap: { width: box.name.w },
        }).setOrigin(0.5, 0);
      } else {
        this.add.rectangle(box.art.x, box.art.y, box.art.w, box.art.h, UI.panelMuted, 0.55)
          .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.45);
        this.add.text(box.art.x + box.art.w / 2, box.art.y + box.art.h / 2, '—', {
          ...textRole('section', { ink: 'disabled' }),
        }).setOrigin(0.5);
      }
    });
  }

  /** Read-only card detail (opened by the ⓘ corner badge, not the card
   * itself — see `renderSet`'s `badge` hit-zone). Veil + big card + full
   * text + a glossary entry for every abbreviation/keyword the card uses;
   * no PICK button here — picking stays the card's own one-tap action. */
  private renderDetail(): void {
    const skill = this.detailSkillId ? skillBook[this.detailSkillId] : undefined;
    if (!skill) { this.detailSkillId = null; return; }
    renderCardDetailsDrawer(this, skill, {
      compact: true,
      onClose: () => { this.detailSkillId = null; this.rerender(); },
    });
  }

  private renderFooter(): void {
    const ready = Object.keys(this.picks).length === DRAFT_SET_KEYS.length;
    const key = DRAFT_SET_KEYS[this.setIndex]!;
    const layout = mobileDraftLayout(this.W, this.H, this.runContext);
    const actions = mobileDraftActions(this.setIndex, Boolean(this.picks[key]), ready);
    const rects = mobileDraftActionRects(layout.footer, actions);
    const press = (id: MobileDraftActionId): void => {
      if (id === 'back') {
        this.setIndex -= 1;
        this.rerender();
      } else if (id === 'next') {
        this.setIndex += 1;
        this.rerender();
      } else if (id === 'reroll') {
        this.reroll();
        this.setIndex = 0;
        this.rerender();
      } else {
        if (this.runContext) {
          applyRunDraft();
          this.scene.start('MobileRunMap');
        } else {
          applyDraftPicks(this.picks);
          this.scene.start('MobilePrep');
        }
      }
    };

    actions.forEach((action, index) => {
      const box = rects[index]!;
      const fill = action.enabled ? action.primary ? 0xe8b446 : 0x26394f : UI.panelMuted;
      const border = action.primary && action.enabled ? 0xffd66b : UI.border;
      const plate = this.add.rectangle(box.x, box.y, box.w, box.h, fill, action.enabled ? 1 : 0.7)
        .setOrigin(0, 0).setStrokeStyle(action.primary && action.enabled ? 2 : 1, border, action.enabled ? 0.95 : 0.45);
      const label = this.add.text(box.x + box.w / 2, box.y + box.h / 2, action.label, {
        ...textRole('statValue', { ink: action.enabled && action.primary ? 'onAccent' : action.enabled ? 'primary' : 'disabled' }),
      }).setOrigin(0.5);
      auditControlLabel(plate, label, { name: `mobile-draft:${action.id}`, horizontalPadding: 8, verticalPadding: 5, minFontSize: 9 });
      if (action.enabled) {
        plate.setInteractive({ useHandCursor: true });
        attachButtonFeel(this, plate, {
          fill,
          hover: fill,
          press: pressedFill(fill),
          follow: [label],
          onPress: () => { playSfx('uiClick'); press(action.id); },
        });
      }
    });
  }
}
