import Phaser from 'phaser';
import { renderGemDetailsDrawer, type GemDetailsSlot } from '../ui/gemDetailsDrawer';
import { CardDetailActivation } from '../ui/cardDetailActivation';
import { renderCardDetailsDrawer } from '../ui/cardDetailsDrawer';
import { playSfx } from '../audio/sfxSynth';
import { skillBook } from '../../data/skills';
import { instancePowerLevelDeci } from '../../engine/balance';
import { applyTier, gemHeroStats, resolveDisplayHeroStats, resolveDisplaySkill } from '../../engine/cards';
import { boardAffinityPipAxes } from '../ui/affinityDisplay';
import type { Gem, SkillDef } from '../../engine/types';
import { buildAutoHeroSetup } from '../../run/encounter';
import { castableGap, extraCooldownPieces } from '../../run/extraCooldown';
import { canStackMerge, moveWithinStrip, shiftInsert, socketGem, stackMergePieces, swapGem, unsocketGem } from '../../run/loadout';
import { nextSkillTier } from '../../run/shop';
import { castableGapWarningLines, extraCooldownWarningEntries, type ExtraCooldownWarningEntry } from '../../engine/keywords/compose';
import { gemBook } from '../../data/gems';
import { demoState, type OwnedBoardPiece, type OwnedCard, type InventorySlot } from '../demoState';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, textRole, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { renderDesktopBackground, renderDesktopHeader, DESKTOP_LAYOUT } from '../ui/DesktopNav';
import { addHoverTipZone } from '../ui/hoverTip';
import { gemHoverEntries } from '../ui/gemPresentation';
import { cardHoverEntries } from '../ui/cardHoverEntries';
import type { ScalingStats } from '../ui/skillPresentation';
import { deckInventoryMetaStatRun, deckMetaStatRun, pouchStatRun } from '../ui/statRunModel';
import { renderStatRun } from '../ui/statRunStrip';
import { rebuildScene, wasPointerConsumedByRebuild } from '../sceneRebuild';
import { getDeckBuildContext } from '../deckBuildContext';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { renderRunStatPanel } from '../ui/RunStatPanel';
import { runScreenLayoutRef } from '../ui/runScreenLayout';
import {
  currentHeroAllocation, currentHeroLevel,
  commitRunDeckEdit,
  currentCooldownWarningDismissedFor, currentRunBagSlots, currentRunGemInventory, currentRunHeld, currentRunPieces, getActiveRun, retireActiveRun,
  setCooldownWarningDismissedFor, setCurrentRunBagSlots, setCurrentRunGemInventory, setCurrentRunHeld, setCurrentRunPieces,
} from '../runStore';

const SLOTS = 10;
const F = DESKTOP_PROFILE.font;
const ACCENT_TEXT = UI.textAccent;
// LIVE reference: every `TEMPLATE.*` read below resolves against the
// CURRENT viewport (the canvas fills the window -- see game/viewport.ts).
const TEMPLATE = runScreenLayoutRef('desktop');

type Source =
  | { where: 'deck'; instanceId: string; card: OwnedCard }
  | { where: 'bag'; index: number; card: OwnedCard }
  | { where: 'hold'; card: OwnedCard };

/** A drop PARTICIPANT eligible for stack-merging — deck or bag only (never
 * `hold`: the TEMP HOLDING strip isn't a stack slot, so a card can't be
 * merge-target'd or merge-dragged through it). */
type MergeSource = Extract<Source, { where: 'deck' } | { where: 'bag' }>;

interface ColLayout { top: number; colH: number; colW: number; rowH: number; gap: number; deckX: number; bagX: number; }

/**
 * Desktop Deck Build — full parity with MobileDeckBuildScene: pointer-drag
 * cards between the ACTIVE DECK / BAG columns and the TEMP HOLDING strip,
 * TRASH drop with a confirm dialog, deck identity/affinity readout. Layout is
 * a 1440x900 two-panel spread (deck left, bag right) rather than mobile's
 * portrait stack, but every placement decision routes through the same pure
 * `run/loadout.ts` helpers and mutates `demoState` in place.
 */
export class DesktopDeckBuildScene extends Phaser.Scene {
  /** SANDBOX ONLY backing store for the TEMP HOLDING strip. In RUN context
   *  the held card is `RunState.held` (persisted, survives a refresh) — see
   *  the `hold` accessor below; the Sandbox never saves anything, so a scene
   *  field is the whole story there, exactly as `demoState` is for the deck
   *  and bag. */
  private sandboxHold: OwnedCard | null = null;
  private pendingTrash: Source | null = null;
  /** Open MERGE? confirm dialog — set when a drag ends on another instance of
   *  the SAME skill at the SAME tier (see `canStackMerge`). Survives the
   *  rebuild idiom exactly like `pendingTrash` (it IS a pending dialog). */
  private pendingMerge: { target: MergeSource; dragged: MergeSource } | null = null;
  /** Deck piece instanceId whose gem-socket panel is open (survives restart). */
  private readonly detailActivation = new CardDetailActivation();
  private inspectCard: Source | null = null;
  private socketFor: string | null = null;
  private layout!: ColLayout;
  private draggables: Array<{ token: CardToken; bounds: Phaser.Geom.Rectangle; src: Source }> = [];
  private heroStats!: ScalingStats;
  private holdingTop = 0;
  private holdingH = 0;
  private trashTop = 0;
  private trashH = 0;
  /** RUN CONTEXT ONLY — whether this render pass serves Run Mode (reads/
   * writes the active run's pieces/bagSlots/gemInventory) or the Sandbox
   * (`demoState`), decided by `deckBuildContext.ts` (same idiom as
   * `battleContext.ts`), captured once per `create()` so a mid-render context
   * flip elsewhere never tears a single frame. */
  private runContext = false;
  private retireConfirmOpen = false;
  private statPanelOpen = false;
  private cooldownWarning: { entries: ExtraCooldownWarningEntry[]; moreCount: number } | null = null;
  private cooldownGapLines: string[] = [];
  private cooldownWarningSignature = '';

  private get cooldownWarningDismissedFor(): string | null {
    return this.runContext ? currentCooldownWarningDismissedFor() : demoState.cooldownWarningDismissedFor;
  }
  private set cooldownWarningDismissedFor(next: string | null) {
    if (this.runContext) setCooldownWarningDismissedFor(next); else demoState.cooldownWarningDismissedFor = next;
  }

  constructor() { super('DesktopDeck'); }

  /** State changed → rebuild this frame in place (see sceneRebuild.ts). */
  private rerender(): void {
    rebuildScene(this);
  }

  // ---------- data source (Sandbox demoState vs. the active run) ----------

  private get pieces(): OwnedBoardPiece[] { return this.runContext ? currentRunPieces() : demoState.pieces; }
  private set pieces(next: OwnedBoardPiece[]) { if (this.runContext) setCurrentRunPieces(next); else demoState.pieces = next; }
  private get bagSlots(): InventorySlot[] { return this.runContext ? currentRunBagSlots() : demoState.bagSlots; }
  private set bagSlots(next: InventorySlot[]) { if (this.runContext) setCurrentRunBagSlots(next); else demoState.bagSlots = next; }
  private get gemInventory(): string[] { return this.runContext ? currentRunGemInventory() : demoState.gemInventory; }
  private set gemInventory(next: string[]) { if (this.runContext) setCurrentRunGemInventory(next); else demoState.gemInventory = next; }
  private get heroLevel(): number { return this.runContext ? currentHeroLevel() : demoState.heroLevel; }
  private get heroAllocation() { return this.runContext ? currentHeroAllocation() : demoState.heroAllocation; }
  /** The TEMP HOLDING card — run state in run context, scene state in the
   *  Sandbox. Same context split as `pieces`/`bagSlots` above, and the reason
   *  it exists: a card on the strip is still OWNED, so in a run it has to be
   *  persisted or a refresh deletes it. */
  private get hold(): OwnedCard | null { return this.runContext ? currentRunHeld() : this.sandboxHold; }
  private set hold(next: OwnedCard | null) { if (this.runContext) setCurrentRunHeld(next); else this.sandboxHold = next; }

  init(): void {
    // NOTE: re-renders happen via rerender() → rebuildScene(this), which
    // re-runs create() only — init() runs on scene ENTRY. `hold` (the TEMP
    // HOLDING card) and `pendingTrash` (the open trash-confirm) survive
    // re-renders regardless; leaving them out of init() additionally lets
    // them persist across scene entries.
    this.draggables = [];
    this.holdingTop = 0;
    this.holdingH = 0;
    this.trashTop = 0;
    this.trashH = 0;
    this.runContext = getDeckBuildContext() === 'run';
    this.statPanelOpen = false;
  }

  create(): void {
    this.detailActivation.reset();
    this.draggables = [];
    const hero = buildAutoHeroSetup(this.heroLevel, this.pieces.map((p) => ({ ...p })), this.heroAllocation).setup;
    // Hero-scope stat gems (e.g. +4 SPD) fold in here too, the SAME math the
    // engine applies at cast time — see `resolveDisplayHeroStats`. Without
    // this, every card face's live-stat term understated the gem's bonus.
    const heroStats = resolveDisplayHeroStats(hero.stats, hero.pieces);
    this.heroStats = { attack: heroStats.attack, magicPower: heroStats.magicPower, armor: heroStats.armor, magicResist: heroStats.magicResist };
    const extraCooldown = extraCooldownPieces(this.pieces, skillBook);
    this.cooldownWarning = extraCooldown.length > 0 ? extraCooldownWarningEntries(extraCooldown.map((p) => p.skill)) : null;
    const gap = castableGap(this.pieces, skillBook);
    this.cooldownGapLines = castableGapWarningLines(gap ? gap.needed : null);
    this.cooldownWarningSignature = this.pieces.slice().sort((a, b) => a.slot - b.slot)
      .map((p) => `${p.slot}:${p.skillId}:${p.tier}:${p.gem?.id ?? ''}`).join('|');
    renderDesktopBackground(this);
    if (this.runContext) this.renderHud(); else renderDesktopHeader(this, 'DECK BUILD', 'deck');
    this.renderMeta(heroStats);
    this.renderHolding();
    this.renderColumns();
    this.renderTrash();
    this.wireDrag();
    if (this.pendingTrash) this.renderConfirm();
    if (this.pendingMerge) this.renderMergeConfirm();
    if (this.socketFor) this.renderSocketPanel();
    if (this.inspectCard) this.renderCardDetails();
    if (this.retireConfirmOpen) {
      // `onCancel`/`onConfirm` don't need to manually consume the pointer
      // here (unlike the shop scenes) — this scene's `wireDrag` guards on
      // `wasPointerConsumedByRebuild` instead, which `rebuildScene()` (called
      // by `this.rerender()`) stamps automatically. See wireDrag's comment.
      renderRetireConfirm(this, {
        compact: false,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { retireActiveRun(); this.scene.start('DesktopRunMap'); },
      });
    }
    if (this.runContext && this.statPanelOpen) {
      renderRunStatPanel(this, {
        compact: false,
        onCancel: () => { this.statPanelOpen = false; this.rerender(); },
        onConfirm: () => { this.statPanelOpen = false; this.rerender(); },
        onChanged: () => this.rerender(),
      });
    }
  }

  /** THE run HUD — identical header on every run screen. ‹ MAP is this
   * screen's `back` role (Deck Build is reached FROM the map, not toward a
   * forward action, so there's no primary slot here). */
  private renderHud(): void {
    const run = getActiveRun();
    if (!run) return;
    renderRunHud(this, {
      screen: 'DECK',
      compact: false,
      snapshot: snapshotRunProgress(run),
      onOpenStatPanel: () => { this.statPanelOpen = true; this.rerender(); },
      actions: {
        back: { label: '‹ MAP', onPress: () => this.scene.start('DesktopRunMap') },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
      },
    });
  }

  /** Manual pointer-drag: hit-test tokens ourselves. Drop resolves against
   *  columns / holding / trash, mirroring the mobile scene's flow. */
  private wireDrag(): void {
    this.input.removeAllListeners();
    let dragging: { token: CardToken; src: Source; home: { x: number; y: number } } | null = null;
    let dropHint: Phaser.GameObjects.Rectangle | null = null;
    let ghost: Phaser.GameObjects.Container | null = null;
    let totalMove = 0;
    let start = { x: 0, y: 0 };
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // CONFIRMED INSTANCE (audit 2026-08, previously unguarded): this scene
      // has NO manual pointer-consumption field of its own (same as the shop
      // scenes, which removed their legacy `consumedPointerAt` idiom in the
      // 2026-08 cleanup) — every dialog below (TRASH/MERGE/socket panel/
      // RETIRE) closes via `this.rerender()` from its OWN pointerdown
      // handler, which re-registers THIS listener before Phaser's scene-level
      // POINTER_DOWN for that same click fires (see `wasPointerConsumedByRebuild`'s doc
      // comment, sceneRebuild.ts). The state-flag check below does NOT catch
      // this — the flag is cleared in the same synchronous handler, before
      // the rebuild. This structural guard is what actually protects it.
      if (wasPointerConsumedByRebuild(this, p)) return;
      if (this.pendingTrash || this.pendingMerge || this.socketFor || this.inspectCard || this.statPanelOpen || this.retireConfirmOpen) return; // dialog/panel owns input
      const hit = this.draggables.find((d) => d.bounds.contains(p.worldX, p.worldY));
      if (!hit) { this.detailActivation.reset(); return; }
      dragging = { token: hit.token, src: hit.src, home: { x: hit.token.x, y: hit.token.y } };
      totalMove = 0;
      start = { x: p.worldX, y: p.worldY };
      ghost = hit.token.spawnGhost(); // dimmed copy + dashed outline stays in the source slot
      hit.token.setDepth(1000).setAlpha(0.9);
      dropHint = this.add.rectangle(0, 0, 10, 10, UI.chip, 0.12).setOrigin(0, 0).setStrokeStyle(2, UI.chip, 0.9).setVisible(false).setDepth(900);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      totalMove = Math.max(totalMove, Math.hypot(p.worldX - start.x, p.worldY - start.y));
      if (totalMove >= 6) this.detailActivation.reset();
      dragging.token.setPosition(p.worldX, p.worldY);
      if (dropHint) {
        const { top, colH, colW, rowH, gap, deckX, bagX } = this.layout;
        if (p.worldY >= top && p.worldY <= top + colH) {
          const row = Math.max(0, Math.min(SLOTS - 1, Math.floor((p.worldY - top) / (rowH + gap))));
          const x = p.worldX >= bagX ? bagX : deckX;
          dropHint.setVisible(true).setPosition(x, top + row * (rowH + gap)).setSize(colW, rowH);
        } else dropHint.setVisible(false);
      }
    });
    this.input.on('pointerupoutside', () => {
      this.detailActivation.reset();
      if (dragging) dragging.token.setPosition(dragging.home.x, dragging.home.y).setDepth(0).setAlpha(1);
      dragging = null; dropHint?.destroy(); dropHint = null; ghost?.destroy(); ghost = null;
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      // Symmetric with the `pointerdown` guard above — Phaser's
      // `processUpEvents` has the SAME two-phase (per-object then
      // scene-level) dispatch as `processDownEvents` (see
      // `wasPointerConsumedByRebuild`'s doc comment, sceneRebuild.ts). No
      // object-level `pointerup` handler rebuilds today, so `dragging` being
      // null already protects this listener in practice — this guard is
      // defense-in-depth against the first one that does.
      if (wasPointerConsumedByRebuild(this, p)) return;
      if (!dragging) return;
      const src = dragging.src;
      dragging.token.setPosition(dragging.home.x, dragging.home.y).setDepth(0).setAlpha(1);
      dragging = null;
      dropHint?.destroy(); dropHint = null;
      ghost?.destroy(); ghost = null;
      if (totalMove < 6) {
        const key = src.where === 'deck' ? `deck:${src.instanceId}` : src.where === 'bag' ? `bag:${src.index}` : 'hold';
        if (this.detailActivation.release(key, p.upTime)) {
          this.inspectCard = src;
          this.rerender();
        }
        return;
      }
      this.detailActivation.reset();
      this.resolveDrop(src, p.worldX, p.worldY);
      this.rerender(); // mutations applied above; re-render (snaps back if no move)
    });
  }

  private renderCardDetails(): void {
    const src = this.inspectCard;
    if (!src) return;
    const piece = src.where === 'deck' ? this.pieces.find(p => p.instanceId === src.instanceId) : null;
    const card = src.where === 'deck' ? piece : src.where === 'bag' ? this.bagSlots[src.index] : this.hold;
    if (!card) { this.inspectCard = null; return; }
    const base = skillBook[card.skillId];
    if (!base) { this.inspectCard = null; return; }
    const shown = piece ? resolveDisplaySkill(base, piece) : applyTier(base, card.tier);
    renderCardDetailsDrawer(this, shown, {
      compact: false,
      gem: piece?.gem ? gemBook[piece.gem.id] : null,
      powerDeci: instancePowerLevelDeci(applyTier(base, card.tier), piece ?? {}),
      onClose: () => { this.inspectCard = null; this.rerender(); },
      primaryAction: piece ? { label: 'GEM SOCKET', enabled: true, onPress: () => {
        this.inspectCard = null; this.socketFor = piece.instanceId; this.rerender();
      } } : undefined,
    });
  }

  private sizeOf(skillId: string): number { return Math.max(1, skillBook[skillId]?.size ?? 1); }

  // ---------- occupancy / placement ----------

  private deckOccupied(): boolean[] {
    const occ = Array<boolean>(SLOTS).fill(false);
    for (const p of this.pieces) {
      const size = this.sizeOf(p.skillId);
      for (let i = p.slot; i < p.slot + size && i < SLOTS; i++) occ[i] = true;
    }
    return occ;
  }

  private bagOccupied(): boolean[] {
    const occ = Array<boolean>(SLOTS).fill(false);
    this.bagSlots.forEach((card, index) => {
      if (!card) return;
      const size = this.sizeOf(card.skillId);
      for (let i = index; i < index + size && i < SLOTS; i++) occ[i] = true;
    });
    return occ;
  }

  /** The deck piece whose span covers `row`, if any (stack-merge lookup). */
  private deckPieceAt(row: number): OwnedBoardPiece | undefined {
    return this.pieces.find((p) => row >= p.slot && row < p.slot + this.sizeOf(p.skillId));
  }

  /** The bag entry whose span covers `row`, if any (stack-merge lookup). */
  private bagEntryAt(row: number): { index: number; card: OwnedCard } | undefined {
    for (let i = 0; i < SLOTS; i++) {
      const card = this.bagSlots[i];
      if (!card) continue;
      if (row >= i && row < i + this.sizeOf(card.skillId)) return { index: i, card };
    }
    return undefined;
  }

  // ---------- moves (real demoState / the active run) ----------

  /** The deck + bag arrays with `src` taken OUT — pure, writes nothing. Every
   *  move computes its removal through here so the removal and the card's new
   *  home can be committed together (see `commitTransfer`). */
  private without(src: Source): { pieces: OwnedBoardPiece[]; bagSlots: InventorySlot[] } {
    return {
      pieces: src.where === 'deck' ? this.pieces.filter((p) => p.instanceId !== src.instanceId) : this.pieces,
      bagSlots: src.where === 'bag' ? this.bagSlots.map((card, i) => (i === src.index ? null : card)) : this.bagSlots,
    };
  }

  /** A socketed gem the move would otherwise DESTROY. Only a deck piece can
   *  carry one — neither the bag nor the holding strip has a socket — so a
   *  deck source landing anywhere else pops its gem back to the pouch, the
   *  same `displacedGem` idiom `stackMergePieces` already uses. `undefined`
   *  (pouch untouched) when there is nothing to displace. */
  private displacedGemPouch(src: Source): string[] | undefined {
    if (src.where !== 'deck') return undefined;
    const gem = this.pieces.find((p) => p.instanceId === src.instanceId)?.gem;
    return gem ? [...this.gemInventory, gem.id] : undefined;
  }

  /**
   * Commit ONE card move — the source removal and the card's new home land
   * together. In run context that is a single persisted write
   * (`commitRunDeckEdit`), so no snapshot that reaches storage can own the
   * card in neither place; in the Sandbox it is the same in-memory
   * assignments as before. `next.held` omitted means "derive it": a move OUT
   * of the holding strip empties it, anything else leaves it alone.
   */
  private commitTransfer(src: Source, next: { pieces?: OwnedBoardPiece[]; bagSlots?: InventorySlot[]; gemInventory?: string[]; held?: OwnedCard | null }): void {
    const removed = this.without(src);
    const pieces = next.pieces ?? removed.pieces;
    const bagSlots = next.bagSlots ?? removed.bagSlots;
    const held = next.held === undefined ? (src.where === 'hold' ? null : this.hold) : next.held;
    if (this.runContext) {
      commitRunDeckEdit({ pieces, bagSlots, gemInventory: next.gemInventory, held });
      return;
    }
    this.pieces = pieces;
    this.bagSlots = bagSlots;
    if (next.gemInventory) this.gemInventory = next.gemInventory;
    this.hold = held;
  }

  private removeSource(src: Source): void {
    if (src.where === 'deck') this.pieces = this.without(src).pieces;
    else if (src.where === 'bag') this.bagSlots = this.without(src).bagSlots;
    else this.hold = null;
  }

  /** Park `src` on the TEMP HOLDING strip. The card is STILL OWNED there —
   *  in run context it moves to `RunState.held` in the SAME write that takes
   *  it off the board/out of the bag, so a page refresh finds it on the strip
   *  instead of deleting it (it used to live in this scene's field alone). */
  private toHold(src: Source): boolean {
    if (this.hold) return false;
    this.commitTransfer(src, { held: { ...src.card }, gemInventory: this.displacedGemPouch(src) });
    return true;
  }

  // ---------- render ----------

  /** Header meta line: LV / HP / ATK / MATK / SPD  ·  slots / PL / gems.
   *  `stats` is already the GEM-FOLDED hero stat sheet (see `create()`'s
   *  `resolveDisplayHeroStats` call) — each stat a hero-scope gem bumps gets
   *  its own `◆+N` GAIN-inked delta (see `deckMetaStatRun`) so a gem-boosted
   *  number reads differently from a naturally level-bought one. */
  private renderMeta(stats: { maxHp: number; attack: number; magicPower: number; speed: number }): void {
    const gx = DESKTOP_LAYOUT.gutter;
    const used = this.deckOccupied().filter(Boolean).length;
    let plDeci = 0;
    for (const p of this.pieces) { const s = skillBook[p.skillId]; if (s) plDeci += instancePowerLevelDeci(s, { gem: p.gem ?? null }); }
    // Socketed vs. OWNED (socketed + pouch): the pouch half comes through the
    // context-routed accessor, so both the run pouch (event/shop grants) and
    // the Sandbox pouch (WIKI › ADD TO POUCH) count — see `DeckMetaFacts`.
    const gemsSocketed = this.pieces.filter((p) => p.gem).length;
    const gemAdds = gemHeroStats(this.pieces);
    // Right-aligned; in run context this sits just under the HUD (which
    // already owns the tab row's old position) instead of on top of it.
    // SAME `deckMetaStatRun` as mobile (both-platforms rule) — the desktop
    // reader sees the same eight facts, the same lead on SLOTS, the same PL
    // `cost` ink, just at desktop's own role sizes.
    const y = this.runContext ? TEMPLATE.regions.content.y + 2 : 102 + DESKTOP_LAYOUT.tabH / 2 - 10;
    const facts = {
      heroLevel: this.heroLevel,
      stats,
      gemAdds,
      used,
      slots: SLOTS,
      powerLevel: Math.round(plDeci / 10),
      gemsSocketed,
      gemsOwned: gemsSocketed + this.gemInventory.length,
    };
    renderStatRun(this, this.runContext ? deckInventoryMetaStatRun(facts) : deckMetaStatRun(facts), {
      x: SCREEN.width - gx, y, maxWidth: SCREEN.width - gx * 2, align: 'right',
    });
  }

  /** Dashed rectangle border (matches mobile's transfer/trash strip style). */
  private dashedRect(x: number, y: number, w: number, h: number, color: number, alpha = 0.9): void {
    const g = this.add.graphics();
    g.lineStyle(1, color, alpha);
    const dash = 6; const gapLen = 5;
    const seg = (x1: number, y1: number, x2: number, y2: number): void => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / len; const uy = (y2 - y1) / len;
      for (let s0 = 0; s0 < len; s0 += dash + gapLen) {
        const e = Math.min(s0 + dash, len);
        g.moveTo(x1 + ux * s0, y1 + uy * s0);
        g.lineTo(x1 + ux * e, y1 + uy * e);
      }
    };
    seg(x, y, x + w, y); seg(x + w, y, x + w, y + h); seg(x + w, y + h, x, y + h); seg(x, y + h, x, y);
    g.strokePath();
  }

  /** TEMP HOLDING strip under the header — full content width, mirroring the
   *  TRASH strip at the bottom so the two drop zones read as a matched pair. */
  private renderHolding(): void {
    const gx = DESKTOP_LAYOUT.gutter;
    const y = DESKTOP_LAYOUT.contentTop; const h = 56; const w = SCREEN.width - gx * 2;
    this.holdingTop = y; this.holdingH = h;
    this.add.rectangle(gx, y, w, h, UI.panelAlt, 0.4).setOrigin(0, 0);
    this.dashedRect(gx, y, w, h, UI.chip, this.hold ? 1 : 0.7);
    this.add.rectangle(gx + 12, y + 8, 40, h - 16, UI.slot).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.9);
    if (this.hold) {
      const base = skillBook[this.hold.skillId];
      if (base) {
        // Tier fold (display-only, no gem — a held card can't carry one) so
        // the TEMP HOLDING face matches the card's own owned tier.
        const skill = this.hold.tier === base.tier ? base : applyTier(base, this.hold.tier);
        const tok = new CardToken(this, gx + 12 + 40 + 8 + 170, y + h / 2, skill, { width: 340, height: h - 12, side: 'left', deck: [skill], stats: this.heroStats });
        this.makeDraggable(tok, { where: 'hold', card: this.hold });
        this.attachCardHover(tok, skill);
      }
      this.add.text(gx + w - 16, y + h / 2, 'HOLDING', { fontSize: `${F.label}px`, color: ACCENT_TEXT, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0.5);
    } else {
      const label = this.add.text(gx + 64, y + h / 2 - 8, 'TEMP HOLDING', { fontSize: `${F.label}px`, color: ACCENT_TEXT, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0, 0.5);
      this.add.text(gx + 64, y + h / 2 + 10, 'drop a card to hold it while rearranging', { fontSize: `${F.small}px`, color: UI.textDim, fontFamily: FONT.body }).setOrigin(0, 0.5);
    }
  }

  private renderColumns(): void {
    const gx = DESKTOP_LAYOUT.gutter;
    const CLOSE_SIZE = 28;
    const showWarning = (this.cooldownWarning !== null || this.cooldownGapLines.length > 0)
      && this.cooldownWarningDismissedFor !== this.cooldownWarningSignature;
    const warningLineCount = showWarning
      ? this.cooldownGapLines.length + (this.cooldownWarning ? this.cooldownWarning.entries.length + (this.cooldownWarning.moreCount > 0 ? 1 : 0) : 0)
      : 0;
    const bandH = showWarning ? Math.max(CLOSE_SIZE + 16, warningLineCount * 16 + 16) : 0;
    const top = this.holdingTop + this.holdingH + Math.max(44, bandH);
    const colH = 500;
    const colW = 620;
    const gap = 8;
    const rowH = (colH - gap * (SLOTS - 1)) / SLOTS;
    const deckX = gx; const bagX = SCREEN.width - gx - colW;
    this.layout = { top, colH, colW, rowH, gap, deckX, bagX };

    const deckUsed = this.deckOccupied().filter(Boolean).length;
    const bagUsed = this.bagOccupied().filter(Boolean).length;
    this.add.text(deckX + colW / 2, top - 18, `ACTIVE DECK · ${deckUsed}/${SLOTS}`, { fontSize: `${F.label}px`, color: ACCENT_TEXT, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 1);
    this.add.text(bagX + colW / 2, top - 18, `BAG · ${bagUsed}/${SLOTS}`, { fontSize: `${F.label}px`, color: ACCENT_TEXT, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 1);

    if (showWarning) {
      const by = this.holdingTop + this.holdingH + 8;
      let li = 0;
      for (const line of this.cooldownGapLines) {
        this.add.text(gx, by + li * 16, line, {
          fontSize: `${F.small}px`, color: UI.textAlarm, fontFamily: FONT.body, fontStyle: 'bold',
        }).setOrigin(0, 0);
        li += 1;
      }
      if (this.cooldownWarning) {
        const { entries, moreCount } = this.cooldownWarning;
        for (const entry of entries) {
          this.add.text(gx, by + li * 16, `${entry.name} · ${entry.clause}`, {
            fontSize: `${F.small}px`, color: UI.textAlarm, fontFamily: FONT.body, fontStyle: 'bold',
          }).setOrigin(0, 0);
          li += 1;
        }
        if (moreCount > 0) {
          this.add.text(gx, by + li * 16, `+${moreCount} more`, { fontSize: `${F.small}px`, color: UI.textDim, fontFamily: FONT.body }).setOrigin(0, 0);
          li += 1;
        }
      }
      const closeX = SCREEN.width - gx - CLOSE_SIZE / 2;
      const closeY = this.holdingTop + this.holdingH + bandH / 2;
      const closeBtn = this.add.rectangle(closeX, closeY, CLOSE_SIZE, CLOSE_SIZE, 0x24344a, 1)
        .setStrokeStyle(1, 0x8a94a6, 0.8).setInteractive({ useHandCursor: true });
      this.add.text(closeX, closeY, '×', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.xlarge}px`, color: UI.textBright }).setOrigin(0.5);
      const dismissedFor = this.cooldownWarningSignature;
      closeBtn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        playSfx('uiBack');
        this.cooldownWarningDismissedFor = dismissedFor;
        this.rerender();
      });
    }

    const deckSkills = this.pieces.map((p) => skillBook[p.skillId]).filter((s): s is SkillDef => Boolean(s));
    const bagSkills = this.bagSlots.map((c) => (c ? skillBook[c.skillId] : undefined)).filter((s): s is SkillDef => Boolean(s));
    const rowTop = (row: number): number => top + row * (rowH + gap);
    const empty = (colX: number, row: number, side: 'left' | 'right'): void => {
      this.add.rectangle(colX + colW / 2, rowTop(row) + rowH / 2, colW, rowH, UI.slot, 0.45).setOrigin(0.5).setStrokeStyle(1, UI.border, 0.35);
      const nx = side === 'left' ? colX + colW - 10 : colX + 10;
      this.add.text(nx, rowTop(row) + 6, `${row + 1}`, { fontSize: `${F.small}px`, color: UI.textSoft, fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(side === 'left' ? 1 : 0, 0);
    };

    // DECK (left)
    const deckOcc = this.deckOccupied();
    const deckBySlot = new Map(this.pieces.map((p) => [p.slot, p]));
    const pouchCount = this.gemInventory.length;
    for (let row = 0; row < SLOTS; row++) {
      const piece = deckBySlot.get(row);
      if (piece) {
        const base = skillBook[piece.skillId]!;
        // Tier + socketed-gem fold (resolver seam, display-only) so the deck
        // face's numbers match what the card actually casts — see
        // `resolveDisplaySkill`. `attachCardHover` below keeps the BASE skill
        // (its PL number prices the base card only — see that function's doc
        // comment on why gem-inflated `effects` must never reach `powerLevelDeci`).
        const skill = resolveDisplaySkill(base, piece);
        const span = this.sizeOf(piece.skillId);
        const h = rowH * span + gap * (span - 1);
        const label = span > 1 ? `${row + 1}-${row + span}` : `${row + 1}`;
        const tok = new CardToken(this, deckX + colW / 2, rowTop(row) + h / 2, skill, {
          width: colW, height: h, side: 'left', slotLabel: label, deck: deckSkills, stats: this.heroStats,
          onInspect: () => { this.inspectCard = { where: 'deck', instanceId: piece.instanceId, card: piece }; this.rerender(); },
          // Accessory rail (see cardTokenSpec.ts): socketed gem shows as a ◆
          // badge; while gems WAIT in the pouch, an empty socket shows the
          // muted ◇ outline in the same rail slot — the existing badge's
          // unfilled twin, not new visual language, so the click-to-socket
          // affordance reads on the card itself (a66eca4: the socket panel
          // was real but undiscoverable). Gone again once the pouch empties.
          accessories: piece.gem
            ? [{ label: '◆' }]
            : pouchCount > 0 ? [{ label: '◇', textColor: UI.textMuted }] : undefined,
        });
        this.makeDraggable(tok, { where: 'deck', instanceId: piece.instanceId, card: { instanceId: piece.instanceId, skillId: piece.skillId, tier: piece.tier } });
        this.attachCardHover(tok, base, piece.gem);
        row += span - 1;
      } else if (!deckOcc[row]) { empty(deckX, row, 'left'); }
    }

    // BAG (right)
    const bagOcc = this.bagOccupied();
    for (let row = 0; row < SLOTS; row++) {
      const card = this.bagSlots[row];
      if (card) {
        const detailIndex = row;
        // Tier fold (display-only, no gem — bag cards can't hold one) so a
        // bag card's face — including whether it reads AoE — matches its
        // OWN owned tier, not always the bronze base.
        const base = skillBook[card.skillId]!;
        const skill = card.tier === base.tier ? base : applyTier(base, card.tier);
        const span = this.sizeOf(card.skillId);
        const h = rowH * span + gap * (span - 1);
        const label = span > 1 ? `${row + 1}-${row + span}` : `${row + 1}`;
        const tok = new CardToken(this, bagX + colW / 2, rowTop(row) + h / 2, skill, { width: colW, height: h, side: 'right', slotLabel: label, deck: bagSkills, stats: this.heroStats,
          onInspect: () => { this.inspectCard = { where: 'bag', index: detailIndex, card }; this.rerender(); },
        });
        this.makeDraggable(tok, { where: 'bag', index: row, card: { ...card } });
        this.attachCardHover(tok, skill);
        row += span - 1;
      } else if (!bagOcc[row]) { empty(bagX, row, 'right'); }
    }

    // AFFINITY pips under the deck column — one row PER AXIS the board holds
    // any cards on (0-2 rows). Element and weapon are tallied SEPARATELY
    // (`docs/board-type-identity.md`, 2026-09-06): a 3-fire + 3-sword deck
    // earns BOTH and gets a FIRE row AND a SWORD row, never a single label
    // picking a winner between them the way the old merged tally did.
    // ONE draw closure (not one per branch) so the ratchet's per-file
    // `fontSize:` literal count does not double just because there can now
    // be up to two rows — see `tests/game/textRoleAudit.test.ts`.
    const axisRows = boardAffinityPipAxes(deckSkills);
    const py = top + colH + 20;
    const rowStep = F.label + 12;
    const drawAffinityRow = (ry: number, pipLabel: string, count: number, earned: boolean): void => {
      const label = this.add.text(deckX + 90, ry, pipLabel, { fontSize: `${F.label}px`, color: earned ? ACCENT_TEXT : UI.text, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0.5);
      for (let i = 0; i < 3; i++) {
        const filled = i < Math.min(3, count);
        this.add.rectangle(label.x + 10 + i * 16, ry, 11, 11, filled ? UI.chip : UI.slot).setOrigin(0, 0.5).setStrokeStyle(1, UI.border, 1);
      }
      this.add.text(label.x + 10 + 3 * 16 + 8, ry, earned ? 'affinity' : '3 to unlock', { fontSize: `${F.small}px`, color: UI.textDim, fontFamily: FONT.body }).setOrigin(0, 0.5);
    };
    if (axisRows.length === 0) {
      drawAffinityRow(py, 'NO TYPE', 0, false);
    } else {
      axisRows.forEach((row, rowIdx) => drawAffinityRow(py + rowIdx * rowStep, row.label, row.count, row.earned));
    }

    // POUCH row — the affinity readout's mirror, under the BAG column: the
    // one surface the gem pouch has on the screen that spends it (a66eca4:
    // three event-granted pouch gems were invisible here and the socket panel
    // undiscoverable). Count via the shared `pouchStatRun` (capacity ink,
    // matching the header's GEMS); the teach line hangs off `endX` in the
    // TEMP HOLDING strip's own "— verb phrase" idiom, bottom-aligned to the
    // run's baseline the same way `renderStatRun` aligns its own pieces.
    // `textRole('micro')` — no new px/hex literal, the ratchet stays put.
    const pouchRun = renderStatRun(this, pouchStatRun(pouchCount), { x: bagX, y: py - 10, maxWidth: colW - 8 });
    this.add.text(pouchRun.endX + 8, py - 10 + pouchRun.height, '— double-click for details / gem socket', textRole('micro')).setOrigin(0, 1);
  }

  /** TRASH strip along the bottom of the content area. */
  private renderTrash(): void {
    const gx = DESKTOP_LAYOUT.gutter;
    const h = 56; const w = SCREEN.width - gx * 2;
    const y = SCREEN.height - DESKTOP_PROFILE.safe.bottom - h;
    this.trashTop = y; this.trashH = h;
    this.add.rectangle(gx, y, w, h, UI.badSoft, 0.4).setOrigin(0, 0);
    this.dashedRect(gx, y, w, h, UI.bad, 0.9);
    this.add.rectangle(gx + 12, y + 8, 40, h - 16, UI.panelMuted).setOrigin(0, 0).setStrokeStyle(1, UI.bad, 0.7);
    const badHex = `#${UI.bad.toString(16).padStart(6, '0')}`;
    const label = this.add.text(gx + 64, y + h / 2 - 8, 'TRASH', { fontSize: `${F.label}px`, color: badHex, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.add.text(gx + 64, y + h / 2 + 10, 'drop to destroy (asks to confirm)', { fontSize: `${F.small}px`, color: UI.textDim, fontFamily: FONT.body }).setOrigin(0, 0.5);
    void label;
  }

  // ---------- drag ----------

  private makeDraggable(tok: CardToken, src: Source): void {
    this.draggables.push({ token: tok, bounds: new Phaser.Geom.Rectangle(tok.x - tok.width / 2, tok.y - tok.height / 2, tok.width, tok.height), src });
  }

  /** Hover-tip zone over a card token's own rect — name/tier/PL/full text plus
   * a glossary entry for every abbreviation the face shows (BLD/PSN/BRN,
   * riders, WT, tier, type badge — plus the ◆ socketed-gem badge's own entry
   * when `gem` is supplied, deck pieces only). Shows on `pointerover`; the
   * same zone's `pointerdown` (see `attachHoverTip`) TOGGLES it, so it hides
   * the instant a drag starts from this token (drag itself is driven by the
   * scene-level `pointerdown`/`pointermove` in `wireDrag`, unaffected by this
   * zone). */
  private attachCardHover(tok: CardToken, skill: SkillDef, gem?: Gem | null): void {
    const entries = cardHoverEntries(skill);
    const gemDef = gem ? gemBook[gem.id] : undefined;
    if (gemDef) entries.push(...gemHoverEntries(gemDef));
    // Keep the outward info controls above their own hit area instead of covering them with this later hover zone.
    addHoverTipZone(this, { x: tok.x - tok.width / 2 + 44, y: tok.y - tok.height / 2, w: Math.max(1, tok.width - 88), h: tok.height }, entries);
  }

  private resolveDrop(src: Source, px: number, py: number): void {
    // TRASH strip (bottom)
    if (py >= this.trashTop && py <= this.trashTop + this.trashH) { this.pendingTrash = src; return; }
    // TEMP HOLDING strip (top)
    if (py >= this.holdingTop && py <= this.holdingTop + this.holdingH) { this.toHold(src); return; }
    const { top, colH, rowH, gap, bagX } = this.layout;
    if (py < top || py > top + colH) return; // dropped nowhere valid → snaps back
    const row = Math.max(0, Math.min(SLOTS - 1, Math.floor((py - top) / (rowH + gap))));
    const where: 'deck' | 'bag' = px >= bagX ? 'bag' : 'deck';

    // Stack-merge check: dropping on ANOTHER instance of the same skill at the
    // same tier PROMPTS a merge instead of resolving the ordinary move/swap —
    // never silent (see `canStackMerge`). TEMP HOLDING is excluded on both
    // sides (a merge target/drag must be a deck or bag occupant).
    if (src.where !== 'hold') {
      const occupant: MergeSource | undefined = where === 'deck'
        ? this.deckOccupantAsSource(row)
        : this.bagOccupantAsSource(row);
      if (occupant && canStackMerge(occupant.card, src.card)) {
        this.pendingMerge = { target: occupant, dragged: src };
        return;
      }
    }

    if (where === 'bag') this.toBag(src, row); else this.toDeck(src, row);
  }

  /** The deck occupant covering `row`, reshaped as a `MergeSource` (or
   *  `undefined` if the row is empty) — for the stack-merge check only. */
  private deckOccupantAsSource(row: number): MergeSource | undefined {
    const piece = this.deckPieceAt(row);
    if (!piece) return undefined;
    return { where: 'deck', instanceId: piece.instanceId, card: { instanceId: piece.instanceId, skillId: piece.skillId, tier: piece.tier } };
  }

  /** The bag occupant covering `row`, reshaped as a `MergeSource` (or
   *  `undefined` if the row is empty) — for the stack-merge check only. */
  private bagOccupantAsSource(row: number): MergeSource | undefined {
    const entry = this.bagEntryAt(row);
    if (!entry) return undefined;
    return { where: 'bag', index: entry.index, card: entry.card };
  }

  /** Insert into the deck, shifting existing spans instead of swapping. */
  private toDeck(src: Source, preferRow: number): boolean {
    const size = this.sizeOf(src.card.skillId);
    const sourcePiece = src.where === 'deck'
      ? this.pieces.find((p) => p.instanceId === src.instanceId)
      : undefined;
    if (src.where === 'deck' && sourcePiece) {
      const others = this.pieces.filter((p) => p.instanceId !== src.instanceId)
        .map((p) => ({ id: p.instanceId, start: p.slot, size: this.sizeOf(p.skillId) }));
      const plan = moveWithinStrip(others, size, sourcePiece.slot, preferRow, SLOTS);
      if (!plan) return false;
      this.pieces = this.pieces
        .filter((p) => p.instanceId !== src.instanceId)
        .map((p) => { const moved = plan.moved.find((item) => item.id === p.instanceId); return moved ? { ...p, slot: moved.start } : p; })
        .concat({ ...sourcePiece, slot: plan.movedStart })
        .sort((a, b) => a.slot - b.slot);
      return true;
    }
    const others = this.pieces.map((p) => ({ id: p.instanceId, start: p.slot, size: this.sizeOf(p.skillId) }));
    const plan = shiftInsert(others, size, preferRow, SLOTS);
    if (!plan) return false;
    // `src` is a BAG or HOLDING card here (a deck source took the branch
    // above), so `this.pieces` still reads correctly pre-removal — the
    // removal rides along in the same `commitTransfer` write.
    const nextPieces = this.pieces
      .map((p) => { const moved = plan.moved.find((item) => item.id === p.instanceId); return moved ? { ...p, slot: moved.start } : p; })
      .concat({ instanceId: src.card.instanceId, skillId: src.card.skillId, tier: src.card.tier, slot: plan.movedStart })
      .sort((a, b) => a.slot - b.slot);
    this.commitTransfer(src, { pieces: nextPieces });
    return true;
  }

  /** Insert into the bag, shifting existing spans instead of swapping. */
  private toBag(src: Source, preferRow: number): boolean {
    const size = this.sizeOf(src.card.skillId);
    if (src.where === 'bag') {
      const origin = src.index;
      const others = this.bagSlots.flatMap((card, index) => card && index !== origin
        ? [{ id: String(index), start: index, size: this.sizeOf(card.skillId) }] : []);
      const plan = moveWithinStrip(others, size, origin, preferRow, SLOTS);
      if (!plan) return false;
      const cards = this.bagSlots.map((card, index) => ({ card, index })).filter((item) => item.index !== origin);
      const next: Array<OwnedCard | null> = Array(SLOTS).fill(null);
      for (const item of cards) {
        const moved = plan.moved.find((entry) => entry.id === String(item.index));
        if (moved) next[moved.start] = item.card;
      }
      next[plan.movedStart] = src.card;
      this.bagSlots = next;
      return true;
    }
    const others = this.bagSlots.flatMap((card, index) => card
      ? [{ id: String(index), start: index, size: this.sizeOf(card.skillId) }] : []);
    const plan = shiftInsert(others, size, preferRow, SLOTS);
    if (!plan) return false;
    // `src` is a DECK or HOLDING card here (a bag source took the branch
    // above), so `this.bagSlots` still reads correctly pre-removal — the
    // removal rides along in the same `commitTransfer` write, and a deck
    // source's socketed gem returns to the pouch instead of vanishing.
    const next: Array<OwnedCard | null> = Array(SLOTS).fill(null);
    for (const item of this.bagSlots) {
      if (!item) continue;
      const index = this.bagSlots.indexOf(item);
      const moved = plan.moved.find((entry) => entry.id === String(index));
      if (moved) next[moved.start] = item;
    }
    next[plan.movedStart] = { ...src.card };
    this.commitTransfer(src, { bagSlots: next, gemInventory: this.displacedGemPouch(src) });
    return true;
  }

  /**
   * Gem-socket panel for one deck piece (opened by CLICKING a deck card).
   * Every card has one socket (availability-by-tier is a future rule): shows
   * the current gem with UNSOCKET, and the pouch inventory with SOCKET/SWAP.
   * run/loadout's socketGem/swapGem/unsocketGem are pure — each returns the
   * new piece rather than mutating `piece`, so every action here splices
   * that new piece back into `this.pieces` (through the setter, so run-
   * context persistence still fires); displaced gems return to
   * `this.gemInventory`.
   */
  private renderSocketPanel(): void {
    const piece = this.pieces.find(p => p.instanceId === this.socketFor);
    if (!piece) { this.socketFor = null; return; }
    const skill = skillBook[piece.skillId];
    if (!skill) { this.socketFor = null; return; }
    const close = (): void => { this.socketFor = null; this.rerender(); };
    const slots: GemDetailsSlot[] = [];
    const current = piece.gem ? gemBook[piece.gem.id] : undefined;
    if (current) slots.push({ key: 'socket', label: 'SOCKETED', gem: current, action: {
      label: 'UNSOCKET', enabled: true, onPress: () => {
        playSfx('uiClick');
        const { piece: updated, gem: removed } = unsocketGem(piece);
        this.pieces = this.pieces.map(p => p.instanceId === piece.instanceId ? updated : p);
        if (removed) this.gemInventory = [...this.gemInventory, removed.id];
        close();
      },
    } });
    this.gemInventory.forEach((id, index) => {
      const gem = gemBook[id];
      if (!gem) return;
      slots.push({ key: `pouch:${index}`, label: `POUCH ${index + 1}`, gem, action: {
        label: piece.gem ? 'SWAP' : 'SOCKET', enabled: true, onPress: () => {
          if (this.gemInventory[index] !== gem.id) return;
          const result = piece.gem ? swapGem(piece, gem) : { piece: socketGem(piece, gem), displaced: null };
          if (!result.piece) return;
          playSfx('uiClick');
          this.gemInventory = this.gemInventory.filter((_, i) => i !== index);
          this.pieces = this.pieces.map(p => p.instanceId === piece.instanceId ? result.piece! : p);
          if (result.displaced) this.gemInventory = [...this.gemInventory, result.displaced.id];
          close();
        },
      } });
    });
    renderGemDetailsDrawer(this, current ?? slots[0]?.gem ?? null, {
      compact: false, view: { x: 0, y: 0, width: SCREEN.width, height: SCREEN.height },
      onClose: close, context: skill.name,
      slots, selectedKey: slots[0]?.key,
      emptyText: this.runContext
        ? 'No gems in the pouch — events and shops on the map grant them.'
        : 'No gems in the pouch — collect some in the WIKI › GEMS tab.',
    });
  }
  private renderConfirm(): void {
    const src = this.pendingTrash!;
    const skill = skillBook[src.card.skillId];
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, 0.72).setOrigin(0, 0).setInteractive();
    const bw = 460; const bx = SCREEN.width / 2 - bw / 2; const by = SCREEN.height / 2 - 90;
    this.add.rectangle(bx, by, bw, 180, UI.panelAlt).setOrigin(0, 0).setStrokeStyle(2, UI.bad);
    this.add.text(SCREEN.width / 2, by + 34, `Delete ${skill?.name ?? 'card'}?`, { fontSize: `${F.name}px`, color: UI.text, fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(SCREEN.width / 2, by + 66, 'This removes it from your collection.', { fontSize: `${F.small}px`, color: UI.textDim, fontFamily: FONT.body }).setOrigin(0.5);
    const mk = (dx: number, w: number, label: string, fill: number, color: string, fn: () => void): void => {
      const r = this.add.rectangle(dx, by + 116, w, 44, fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      this.add.text(dx + w / 2, by + 138, label, { fontSize: `${F.body}px`, color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    };
    mk(bx + 20, (bw - 60) / 2, 'CANCEL', UI.panelMuted, UI.text, () => { playSfx('uiBack'); this.pendingTrash = null; this.rerender(); });
    mk(bx + 40 + (bw - 60) / 2, (bw - 60) / 2, 'DELETE', UI.badSoft, '#ffffff', () => { playSfx('uiClick'); this.removeSource(src); this.pendingTrash = null; this.rerender(); });
  }

  /** "MERGE? 2× <NAME> <TIER> → <NEXT TIER>" — CANCEL returns the dragged card
   *  home (nothing was mutated on drop, so a re-render alone restores it,
   *  exactly like `renderConfirm`'s CANCEL); MERGE applies `stackMergePieces`
   *  through the pieces/bagSlots/gemInventory setters. */
  private renderMergeConfirm(): void {
    const { target } = this.pendingMerge!;
    const skill = skillBook[target.card.skillId];
    const fromTier = target.card.tier;
    const toTier = nextSkillTier(fromTier);
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, 0.72).setOrigin(0, 0).setInteractive();
    const bw = 460; const bx = SCREEN.width / 2 - bw / 2; const by = SCREEN.height / 2 - 90;
    this.add.rectangle(bx, by, bw, 180, UI.panelAlt).setOrigin(0, 0).setStrokeStyle(2, UI.chip);
    this.add.text(SCREEN.width / 2, by + 30, 'MERGE?', { fontSize: `${F.name}px`, color: ACCENT_TEXT, fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(SCREEN.width / 2, by + 62, `2× ${skill?.name ?? 'card'} ${fromTier.toUpperCase()} → ${(toTier ?? fromTier).toUpperCase()}`, {
      fontSize: `${F.small}px`, color: UI.textDim, fontFamily: FONT.body, align: 'center', wordWrap: { width: bw - 40 },
    }).setOrigin(0.5);
    const mk = (dx: number, w: number, label: string, fill: number, color: string, fn: () => void): void => {
      const r = this.add.rectangle(dx, by + 116, w, 44, fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      this.add.text(dx + w / 2, by + 138, label, { fontSize: `${F.body}px`, color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    };
    mk(bx + 20, (bw - 60) / 2, 'CANCEL', UI.panelMuted, UI.text, () => { playSfx('uiBack'); this.pendingMerge = null; this.rerender(); });
    mk(bx + 40 + (bw - 60) / 2, (bw - 60) / 2, 'MERGE', UI.chip, UI.textOnChip, () => { playSfx('uiClick'); this.applyMerge(); });
  }

  /** The live gem (if any) currently socketed on a merge participant — only a
   *  DECK piece can carry one (bag cards have no `gem` field in this model),
   *  so this looks past `MergeSource.card` (which omits `gem`, see
   *  `makeDraggable`'s deck entry) to the actual live piece in `this.pieces`. */
  private liveGemOf(ref: MergeSource): Gem | null {
    if (ref.where !== 'deck') return null;
    return this.pieces.find((p) => p.instanceId === ref.instanceId)?.gem ?? null;
  }

  /** Applies the pending stack merge through `run/loadout.ts`'s pure
   *  `stackMergePieces`: the target climbs a tier keeping its own gem; the
   *  dragged copy is removed and its gem (if any) returns to the pouch. */
  private applyMerge(): void {
    const pending = this.pendingMerge;
    this.pendingMerge = null;
    if (pending) {
      const { target, dragged } = pending;
      const draggedGem = this.liveGemOf(dragged);
      if (target.where === 'deck') {
        const live = this.pieces.find((p) => p.instanceId === target.instanceId);
        const result = live ? stackMergePieces(live, { ...dragged.card, gem: draggedGem }) : null;
        if (result) {
          this.removeSource(dragged);
          this.pieces = this.pieces.map((p) => (p.instanceId === target.instanceId ? result.merged : p));
          if (result.displacedGem) this.gemInventory = [...this.gemInventory, result.displacedGem.id];
        }
      } else {
        const live = this.bagSlots[target.index];
        const result = live ? stackMergePieces(live, { ...dragged.card, gem: draggedGem }) : null;
        if (result) {
          this.removeSource(dragged);
          this.bagSlots = this.bagSlots.map((c, i) => (i === target.index ? result.merged : c));
          if (result.displacedGem) this.gemInventory = [...this.gemInventory, result.displacedGem.id];
        }
      }
    }
    this.rerender();
  }
}
