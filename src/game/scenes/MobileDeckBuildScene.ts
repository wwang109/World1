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
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, textRole, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import type { ScalingStats } from '../ui/skillPresentation';
import { deckMetaStatRun, pouchStatRun } from '../ui/statRunModel';
import { renderStatRun } from '../ui/statRunStrip';
import { rebuildScene, wasPointerConsumedByRebuild } from '../sceneRebuild';
import { getDeckBuildContext } from '../deckBuildContext';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { runScreenLayoutRef } from '../ui/runScreenLayout';
import { roundRect } from '../ui/roundedRect';
import {
  currentHeroAllocation, currentHeroLevel,
  commitRunDeckEdit,
  currentCooldownWarningDismissedFor, currentRunBagSlots, currentRunGemInventory, currentRunHeld, currentRunPieces, getActiveRun, retireActiveRun,
  setCooldownWarningDismissedFor, setCurrentRunBagSlots, setCurrentRunGemInventory, setCurrentRunHeld, setCurrentRunPieces,
} from '../runStore';

const F = MOBILE_PROFILE.font;
const SLOTS = 10;
/** Grab margin around the TEMP HOLDING strip's drawn band (see `resolveDrop`). */
const HOLD_GRAB_PAD = 4;
// LIVE reference: every `TEMPLATE.*` read below resolves against the
// CURRENT viewport (the canvas fills the window -- see game/viewport.ts).
const TEMPLATE = runScreenLayoutRef('mobile');

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
 * Mobile Deck Build — vertical: tabs · header · TEMP HOLDING strip · ACTIVE
 * DECK (left) vs BAG (right) columns · TRASH strip. DRAG a card between deck,
 * bag, and holding; drop on TRASH to delete (with confirm). Real demoState
 * mutations. Reachable at ?scene=mdeck.
 */
export class MobileDeckBuildScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  /** SANDBOX ONLY backing store for the TEMP HOLDING strip. In RUN context
   *  the held card is `RunState.held` (persisted, survives a refresh) — see
   *  the `hold` accessor below; the Sandbox never saves anything, so a scene
   *  field is the whole story there, exactly as `demoState` is for the deck
   *  and bag. */
  private sandboxHold: OwnedCard | null = null;
  /** TEMP HOLDING strip band, stamped by `renderHolding` (see there). */
  private holdingTop = 66;
  private holdingH = 34;
  private pendingTrash: Source | null = null;
  /** Open MERGE? confirm dialog — set when a drag ends on another instance of
   *  the SAME skill at the SAME tier (see `canStackMerge`). Survives the
   *  rebuild idiom exactly like `pendingTrash` (it IS a pending dialog): no
   *  init() in this scene, so it persists across a `rerender()`. */
  private pendingMerge: { target: MergeSource; dragged: MergeSource } | null = null;
  /** Deck piece instanceId whose gem-socket panel is open (survives restart —
   *  this scene deliberately has NO init(), mirroring `hold`/`pendingTrash`). */
  private readonly detailActivation = new CardDetailActivation();
  private inspectCard: Source | null = null;
  private socketFor: string | null = null;
  private layout!: ColLayout;
  private draggables: Array<{ token: CardToken; bounds: Phaser.Geom.Rectangle; src: Source }> = [];
  private heroStats!: ScalingStats;
  /** RUN CONTEXT ONLY — see `DesktopDeckBuildScene`'s identical field. */
  private runContext = false;
  private retireConfirmOpen = false;
  private cooldownWarning: { entries: ExtraCooldownWarningEntry[]; moreCount: number } | null = null;
  private cooldownGapLines: string[] = [];
  private cooldownWarningSignature = '';

  private get cooldownWarningDismissedFor(): string | null {
    return this.runContext ? currentCooldownWarningDismissedFor() : demoState.cooldownWarningDismissedFor;
  }
  private set cooldownWarningDismissedFor(next: string | null) {
    if (this.runContext) setCooldownWarningDismissedFor(next); else demoState.cooldownWarningDismissedFor = next;
  }
  /** Uniform downward shift applied to every below-header y so run context's
   * taller HUD (kicker/title/stats/badge/actions) never collides with the
   * Sandbox's shorter tab-row header — same relative layout either way. */
  private get headerOffset(): number { return this.runContext ? TEMPLATE.regions.content.y - 50 : 0; }

  constructor() { super('MobileDeckBuild'); }

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

  create(): void {
    this.detailActivation.reset();
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.draggables = [];
    this.runContext = getDeckBuildContext() === 'run';
    const hero = buildAutoHeroSetup(this.heroLevel, this.pieces.map((p) => ({ ...p })), this.heroAllocation).setup;
    // Hero-scope stat gems fold in here too — see `resolveDisplayHeroStats`.
    const heroStats = resolveDisplayHeroStats(hero.stats, hero.pieces);
    this.heroStats = { attack: heroStats.attack, magicPower: heroStats.magicPower, armor: heroStats.armor, magicResist: heroStats.magicResist };
    const extraCooldown = extraCooldownPieces(this.pieces, skillBook);
    this.cooldownWarning = extraCooldown.length > 0 ? extraCooldownWarningEntries(extraCooldown.map((p) => p.skill)) : null;
    const gap = castableGap(this.pieces, skillBook);
    this.cooldownGapLines = castableGapWarningLines(gap ? gap.needed : null);
    this.cooldownWarningSignature = this.pieces.slice().sort((a, b) => a.slot - b.slot)
      .map((p) => `${p.slot}:${p.skillId}:${p.tier}:${p.gem?.id ?? ''}`).join('|');
    this.cameras.main.setBackgroundColor(UI.bg);
    if (this.runContext) this.renderHud(); else this.renderTabs();
    this.renderHeader();
    this.renderHolding();
    this.renderColumns();
    this.renderTrash();
    // wireDrag() resets ALL global input listeners — call it before any
    // overlay that registers its own (e.g. the socket panel's pouch scroll)
    // so those survive.
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
        compact: true,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { retireActiveRun(); this.scene.start('MobileRunMap'); },
      });
    }
  }

  /** THE run HUD — identical header on every run screen. ‹ MAP is this
   * screen's `back` role. */
  private renderHud(): void {
    const run = getActiveRun();
    if (!run) return;
    renderRunHud(this, {
      screen: 'DECK',
      compact: true,
      snapshot: snapshotRunProgress(run),
      actions: {
        back: { label: '‹ MAP', onPress: () => this.scene.start('MobileRunMap') },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
      },
    });
  }

  /** Manual pointer-drag: hit-test tokens ourselves (Phaser container-drag is
   *  unreliable). Drop resolves against columns / holding / trash. A TAP (< 8px
   *  of movement between down and up) on a DECK card opens the gem-socket
   *  panel instead of resolving as a drop. */
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
      // 2026-08 cleanup) — every dialog below (TRASH/MERGE/socket panel/bag
      // detail/RETIRE) closes via `this.rerender()` from its OWN pointerdown
      // handler, which re-registers THIS listener before Phaser's scene-level
      // POINTER_DOWN for that same click fires (see
      // `wasPointerConsumedByRebuild`'s doc comment, sceneRebuild.ts). The
      // state-flag check below does NOT catch this — the flag is cleared in
      // the same synchronous handler, before the rebuild. This structural
      // guard is what actually protects it.
      if (wasPointerConsumedByRebuild(this, p)) return;
      if (this.pendingTrash || this.pendingMerge || this.socketFor || this.inspectCard || this.retireConfirmOpen) return; // dialog/panel owns input
      const hit = this.draggables.find((d) => d.bounds.contains(p.worldX, p.worldY));
      if (!hit) { this.detailActivation.reset(); return; }
      dragging = { token: hit.token, src: hit.src, home: { x: hit.token.x, y: hit.token.y } };
      totalMove = 0;
      start = { x: p.worldX, y: p.worldY };
      ghost = hit.token.spawnGhost(); // dimmed copy + dashed outline stays in the source slot
      hit.token.setDepth(1000).setAlpha(0.9);
      dropHint = roundRect(this.add.rectangle(0, 0, 10, 10, 0xe8b446, 0.12), 8).setOrigin(0, 0).setStrokeStyle(2, 0xe8b446, 0.9).setVisible(false).setDepth(900);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      totalMove = Math.max(totalMove, Math.hypot(p.worldX - start.x, p.worldY - start.y));
      if (totalMove >= 8) this.detailActivation.reset();
      dragging.token.setPosition(p.worldX, p.worldY);
      // gold drop-target highlight (mockup "drop to place") on the hovered slot
      if (dropHint) {
        const { top, colH, colW, rowH, gap, deckX, bagX } = this.layout;
        if (p.worldY >= top && p.worldY <= top + colH) {
          const row = Math.max(0, Math.min(SLOTS - 1, Math.floor((p.worldY - top) / (rowH + gap))));
          const x = p.worldX >= bagX ? bagX : deckX;
          roundRect(dropHint.setVisible(true).setPosition(x, top + row * (rowH + gap)).setSize(colW, rowH), 8);
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
      if (totalMove < 8) {
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
      compact: true,
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

  private deckOccupied(exclude?: string | string[]): boolean[] {
    const ex = new Set(Array.isArray(exclude) ? exclude : exclude !== undefined ? [exclude] : []);
    const occ = Array<boolean>(SLOTS).fill(false);
    for (const p of this.pieces) {
      if (ex.has(p.instanceId)) continue;
      const size = this.sizeOf(p.skillId);
      for (let i = p.slot; i < p.slot + size && i < SLOTS; i++) occ[i] = true;
    }
    return occ;
  }

  private bagOccupied(exclude?: number | number[]): boolean[] {
    const ex = new Set(Array.isArray(exclude) ? exclude : exclude !== undefined ? [exclude] : []);
    const occ = Array<boolean>(SLOTS).fill(false);
    this.bagSlots.forEach((card, index) => {
      if (!card || ex.has(index)) return;
      const size = this.sizeOf(card.skillId);
      for (let i = index; i < index + size && i < SLOTS; i++) occ[i] = true;
    });
    return occ;
  }

  /** The deck piece whose span covers `row`, if any. */
  private deckPieceAt(row: number): (typeof this.pieces)[number] | undefined {
    return this.pieces.find((p) => row >= p.slot && row < p.slot + this.sizeOf(p.skillId));
  }

  /** The bag entry whose span covers `row`, if any. */
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

  private renderTabs(): void {
    const tabs: Array<[string, boolean, () => void]> = [
      ['MENU', false, () => this.scene.start('Start')],
      ['PREP', false, () => this.scene.start('MobilePrep')],
      ['DECK', true, () => {}],
      ['WIKI', false, () => this.scene.start('MobileWiki')],
      ['SHOP', false, () => this.scene.start('MobileShop')],
      ['DRAFT', false, () => this.scene.start('MobileDraft')],
    ];
    const gap = 5;
    const w = (this.W - 20 - gap * (tabs.length - 1)) / tabs.length;
    tabs.forEach(([label, active, fn], i) => {
      const x = 10 + i * (w + gap);
      const r = roundRect(this.add.rectangle(x, 8, w, 34, active ? 0xb78a46 : 0x131f32), 8).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', () => { playSfx('uiClick'); fn(); });
      this.add.text(x + w / 2, 25, label, { fontSize: `${F.tiny}px`, color: active ? UI.textOnChip : UI.textDim, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    });
  }

  /** Header meta: the hero's live statline plus slots/PL/gems, drawn as
   * label/value pairs by the shared `statRunModel`/`statRunStrip` pair rather
   * than one flat string. */
  private renderHeader(): void {
    const used = this.deckOccupied().filter(Boolean).length;
    let plDeci = 0;
    for (const p of this.pieces) { const s = skillBook[p.skillId]; if (s) plDeci += instancePowerLevelDeci(s, { gem: p.gem ?? null }); }
    // Socketed vs. OWNED (socketed + pouch): the pouch half comes through the
    // context-routed accessor, so both the run pouch (event/shop grants) and
    // the Sandbox pouch (WIKI › ADD TO POUCH) count — see `DeckMetaFacts`.
    const gemsSocketed = this.pieces.filter((p) => p.gem).length;
    const hero = buildAutoHeroSetup(this.heroLevel, this.pieces.map((p) => ({ ...p })), this.heroAllocation).setup;
    // Hero-scope stat gems fold in here too — see `resolveDisplayHeroStats`.
    const s = resolveDisplayHeroStats(hero.stats, hero.pieces);
    const gemAdds = gemHeroStats(hero.pieces);
    // THE LINE THE USER CALLED PLAIN: "LV 1 · HP 100 · ATK 1 · MATK 1 · SPD 10
    // · 0/10 slots · PL 0 · 0 gems" — 74 characters of one colour at one
    // weight in a 412px header, so nothing in it led. `deckMetaStatRun` splits
    // it into label/value pairs, gives SLOTS the lead (it is the one number a
    // deck edit is actually about), inks PL as a `cost` and gems as
    // `capacity`, and drops DEF/MDEF — see the builder for why those two.
    renderStatRun(this, deckMetaStatRun({
      heroLevel: this.heroLevel,
      stats: s,
      gemAdds,
      used,
      slots: SLOTS,
      powerLevel: Math.round(plDeci / 10),
      gemsSocketed,
      gemsOwned: gemsSocketed + this.gemInventory.length,
      // compact=true: the ◆ GEMS label — the socketed/owned value overflows
      // fitRun's floor at 412px under the word label and gets dropped
      // entirely; see `deckMetaStatRun`'s doc for the measured numbers.
    }, true), { x: 12, y: 48 + this.headerOffset, maxWidth: this.W - 24 });
  }

  private renderHolding(): void {
    const y = 66 + this.headerOffset; const h = 34; const w = this.W - 20;
    // The DROP BAND is whatever this render just drew — `resolveDrop` used to
    // hardcode 62..104, which is only where the strip sits in the SANDBOX. In
    // run context `headerOffset` pushes the strip down 50px, so the band the
    // player could actually drop on was an invisible one up in the HUD and
    // the visible strip did nothing. Same idiom as the desktop scene.
    this.holdingTop = y; this.holdingH = h;
    roundRect(this.add.rectangle(10, y, w, h, 0x122033, 0.4)).setOrigin(0, 0).setStrokeStyle(1, 0xb78a46, this.hold ? 1 : 0.7);
    roundRect(this.add.rectangle(18, y + 4, 24, h - 8, 0x16233a), 6).setOrigin(0, 0).setStrokeStyle(1, 0x3a4a62, 0.9);
    if (this.hold) {
      const base = skillBook[this.hold.skillId];
      if (base) {
        // Tier fold (display-only, no gem — a held card can't carry one) so
        // the TEMP HOLDING face matches the card's own owned tier.
        const skill = this.hold.tier === base.tier ? base : applyTier(base, this.hold.tier);
        const tok = new CardToken(this, 52 + 105, y + h / 2, skill, { width: 210, height: h - 6, side: 'left', deck: [skill], stats: this.heroStats });
        this.makeDraggable(tok, { where: 'hold', card: this.hold });
      }
      this.add.text(this.W - 16, y + h / 2, 'HOLDING', { fontSize: `${F.small}px`, color: '#c9a15a', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0.5);
    } else {
      const label = this.add.text(52, y + h / 2, 'TEMP HOLDING', { fontSize: `${F.label}px`, color: '#c9a15a', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0, 0.5);
      this.add.text(label.x + label.width + 6, y + h / 2, '— drop a card to hold it while rearranging', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body }).setOrigin(0, 0.5);
    }
  }

  private renderColumns(): void {
    const CLOSE_SIZE = 40;
    const showWarning = (this.cooldownWarning !== null || this.cooldownGapLines.length > 0)
      && this.cooldownWarningDismissedFor !== this.cooldownWarningSignature;
    const warningLineCount = showWarning
      ? this.cooldownGapLines.length + (this.cooldownWarning ? this.cooldownWarning.entries.length * 2 + (this.cooldownWarning.moreCount > 0 ? 1 : 0) : 0)
      : 0;
    const bandH = showWarning ? Math.max(CLOSE_SIZE + 16, warningLineCount * 12 + 16) : 0;
    const top = 122 + this.headerOffset + bandH;
    const colH = this.H - top - 78;
    const colW = (this.W - 20 - 8) / 2;
    const gap = 5;
    const rowH = (colH - gap * (SLOTS - 1)) / SLOTS;
    const deckX = 10; const bagX = 10 + colW + 8;
    this.layout = { top, colH, colW, rowH, gap, deckX, bagX };

    const deckUsed = this.deckOccupied().filter(Boolean).length;
    const bagUsed = this.bagOccupied().filter(Boolean).length;
    this.add.text(deckX + colW / 2, top - 6, `ACTIVE DECK · ${deckUsed}/${SLOTS}`, { fontSize: `${F.small}px`, color: '#b78a46', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 1);
    this.add.text(bagX + colW / 2, top - 6, `BAG · ${bagUsed}/${SLOTS}`, { fontSize: `${F.small}px`, color: '#b78a46', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 1);

    if (showWarning) {
      const wy = this.holdingTop + this.holdingH + 8;
      let li = 0;
      for (const line of this.cooldownGapLines) {
        this.add.text(10, wy + li * 12, line, { fontSize: `${F.tiny}px`, color: UI.textAlarm, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0, 0);
        li += 1;
      }
      if (this.cooldownWarning) {
        const { entries, moreCount } = this.cooldownWarning;
        for (const entry of entries) {
          this.add.text(10, wy + li * 12, entry.name, { fontSize: `${F.tiny}px`, color: UI.textAlarm, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0, 0);
          li += 1;
          this.add.text(10, wy + li * 12, entry.clause, { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body }).setOrigin(0, 0);
          li += 1;
        }
        if (moreCount > 0) {
          this.add.text(10, wy + li * 12, `+${moreCount} more`, { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body }).setOrigin(0, 0);
          li += 1;
        }
      }
      const closeX = this.W - 10 - CLOSE_SIZE / 2;
      const closeY = this.holdingTop + this.holdingH + bandH / 2;
      const closeBtn = roundRect(this.add.rectangle(closeX, closeY, CLOSE_SIZE, CLOSE_SIZE, 0x1b2940, 1))
        .setStrokeStyle(1, 0x3a4a62, 0.9).setInteractive({ useHandCursor: true });
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
      roundRect(this.add.rectangle(colX + colW / 2, rowTop(row) + rowH / 2, colW, rowH, 0x121e30, 0.45), 8).setOrigin(0.5).setStrokeStyle(1, 0x24344a, 0.9);
      const nx = side === 'left' ? colX + colW - 6 : colX + 6;
      this.add.text(nx, rowTop(row) + 4, `${row + 1}`, { fontSize: `${F.small}px`, color: UI.textMuted, fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(side === 'left' ? 1 : 0, 0);
    };

    // DECK (left)
    const deckOcc = this.deckOccupied();
    const deckBySlot = new Map(this.pieces.map((p) => [p.slot, p]));
    const pouchCount = this.gemInventory.length;
    for (let row = 0; row < SLOTS; row++) {
      const piece = deckBySlot.get(row);
      if (piece) {
        // Tier + socketed-gem fold (resolver seam, display-only) so the deck
        // face's numbers match what the card actually casts — see `resolveDisplaySkill`.
        const skill = resolveDisplaySkill(skillBook[piece.skillId]!, piece);
        const span = this.sizeOf(piece.skillId);
        const h = rowH * span + gap * (span - 1);
        const label = span > 1 ? `${row + 1}-${row + span}` : `${row + 1}`;
        const tok = new CardToken(this, deckX + colW / 2, rowTop(row) + h / 2, skill, {
          width: colW, height: h, side: 'left', slotLabel: label, deck: deckSkills, stats: this.heroStats,
          onInspect: () => { this.inspectCard = { where: 'deck', instanceId: piece.instanceId, card: piece }; this.rerender(); },
          // Accessory rail (see cardTokenSpec.ts): socketed gem shows as a ◆
          // badge; while gems WAIT in the pouch, an empty socket shows the
          // muted ◇ outline in the same rail slot — the existing badge's
          // unfilled twin, not new visual language (a66eca4: the socket panel
          // was real but undiscoverable). Gone again once the pouch empties.
          // KNOWN LIMIT, same as the shipped ◆: at this column width (~192px)
          // the rail spec computes accessoryMax = 0, so NEITHER badge actually
          // draws on mobile today — the spec protects the text clamps. Kept
          // identical to desktop (both-platforms rule) so the cue appears the
          // moment the rail has room; mobile discoverability is carried by
          // the POUCH row below.
          accessories: piece.gem
            ? [{ label: '◆' }]
            : pouchCount > 0 ? [{ label: '◇', textColor: UI.textMuted }] : undefined,
        });
        this.makeDraggable(tok, { where: 'deck', instanceId: piece.instanceId, card: { instanceId: piece.instanceId, skillId: piece.skillId, tier: piece.tier } });
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
        // OWN owned tier, not always the bronze base. See
        // `resolveDisplaySkill`'s doc comment for the general rule this
        // mirrors for gemless previews.
        const base = skillBook[card.skillId]!;
        const skill = card.tier === base.tier ? base : applyTier(base, card.tier);
        const span = this.sizeOf(card.skillId);
        const h = rowH * span + gap * (span - 1);
        const label = span > 1 ? `${row + 1}-${row + span}` : `${row + 1}`;
        const tok = new CardToken(this, bagX + colW / 2, rowTop(row) + h / 2, skill, { width: colW, height: h, side: 'right', slotLabel: label, deck: bagSkills, stats: this.heroStats,
          onInspect: () => { this.inspectCard = { where: 'bag', index: detailIndex, card }; this.rerender(); },
        });
        this.makeDraggable(tok, { where: 'bag', index: row, card: { ...card } });
        row += span - 1;
      } else if (!bagOcc[row]) { empty(bagX, row, 'right'); }
    }

    // AFFINITY pips under the deck column (mockup): "SWORD ■■■ — affinity".
    // ONE ROW PER AXIS the board holds any cards on (0-2 rows) — element and
    // weapon are tallied SEPARATELY (`docs/board-type-identity.md`,
    // 2026-09-06), so a 3-fire + 3-sword deck earns BOTH and gets a FIRE row
    // AND a SWORD row, never a single label picking a winner. Rows stack
    // tightly (13px pitch, matching the pip spacing itself) — this is the
    // narrowest platform and the strip above the TRASH band has little slack.
    // ONE draw closure (not one per branch) so the ratchet's per-file
    // `fontSize:` literal count does not double just because there can now
    // be up to two rows — see `tests/game/textRoleAudit.test.ts`.
    const axisRows = boardAffinityPipAxes(deckSkills);
    const py = top + colH + 8;
    const rowStep = 13;
    const drawAffinityRow = (ry: number, pipLabel: string, count: number, earned: boolean): void => {
      const label = this.add.text(deckX + colW / 2 - 30, ry, pipLabel, { fontSize: `${F.small}px`, color: earned ? '#e8b446' : UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0.5);
      for (let i = 0; i < 3; i++) {
        const filled = i < Math.min(3, count);
        this.add.rectangle(label.x + 8 + i * 13, ry, 9, 9, filled ? 0xb78a46 : 0x16233a).setOrigin(0, 0.5).setStrokeStyle(1, 0x3a4a62, 1);
      }
      this.add.text(label.x + 8 + 3 * 13 + 6, ry, earned ? 'affinity' : '3 to unlock', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body }).setOrigin(0, 0.5);
    };
    if (axisRows.length === 0) {
      drawAffinityRow(py, 'NO TYPE', 0, false);
    } else {
      axisRows.forEach((row, rowIdx) => drawAffinityRow(py + rowIdx * rowStep, row.label, row.count, row.earned));
    }

    const pouchY = py - 8;
    const pouchRun = renderStatRun(this, pouchStatRun(pouchCount), { x: bagX, y: pouchY, maxWidth: colW - 4 });
    this.add.text(bagX, pouchY + pouchRun.height + 2, 'Double-tap: details / gems', {
      ...textRole('micro'), wordWrap: { width: colW - 4 },
    }).setOrigin(0, 0);
  }

  private renderTrash(): void {
    const y = this.H - 44; const h = 34; const w = this.W - 20;
    roundRect(this.add.rectangle(10, y, w, h, 0x2a1412, 0.4)).setOrigin(0, 0).setStrokeStyle(1, 0xb0483c, 0.9);
    const label = this.add.text(52, y + h / 2, 'TRASH', { fontSize: `${F.label}px`, color: '#d05c4e', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0, 0.5);
    roundRect(this.add.rectangle(18, y + 4, 24, h - 8, 0x1c0f0d), 6).setOrigin(0, 0).setStrokeStyle(1, 0x7a4a42, 0.9);
    this.add.text(label.x + label.width + 6, y + h / 2, '— drop to destroy (asks to confirm)', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body }).setOrigin(0, 0.5);
  }

  // ---------- drag ----------

  private makeDraggable(tok: CardToken, src: Source): void {
    this.draggables.push({ token: tok, bounds: new Phaser.Geom.Rectangle(tok.x - tok.width / 2, tok.y - tok.height / 2, tok.width, tok.height), src });
  }

  private resolveDrop(src: Source, px: number, py: number): void {
    // TRASH strip (bottom)
    if (py >= this.H - 48) { this.pendingTrash = src; return; }
    // TEMP HOLDING strip (top) — the band `renderHolding` actually drew,
    // plus the same 4px grab margin the old hardcoded 62..104 band had.
    if (py >= this.holdingTop - HOLD_GRAB_PAD && py < this.holdingTop + this.holdingH + HOLD_GRAB_PAD) { this.toHold(src); return; }
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

  private renderConfirm(): void {
    const src = this.pendingTrash!;
    const skill = skillBook[src.card.skillId];
    this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.72).setOrigin(0, 0).setInteractive();
    const bw = this.W - 60; const bx = 30; const by = this.H / 2 - 70;
    roundRect(this.add.rectangle(bx, by, bw, 140, 0x141d2c)).setOrigin(0, 0).setStrokeStyle(2, 0xd05c4e);
    this.add.text(this.W / 2, by + 24, `Delete ${skill?.name ?? 'card'}?`, { fontSize: `${F.heading}px`, color: UI.textBright, fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(this.W / 2, by + 50, 'This removes it from your collection.', { fontSize: `${F.small}px`, color: UI.textFootnote, fontFamily: FONT.body }).setOrigin(0.5);
    const mk = (dx: number, w: number, label: string, fill: number, color: string, fn: () => void): void => {
      const r = roundRect(this.add.rectangle(dx, by + 88, w, 36, fill)).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      this.add.text(dx + w / 2, by + 106, label, { fontSize: `${F.name}px`, color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    };
    mk(bx + 16, (bw - 40) / 2, 'CANCEL', 0x1b2940, UI.textBright, () => { playSfx('uiBack'); this.pendingTrash = null; this.rerender(); });
    mk(bx + 24 + (bw - 40) / 2, (bw - 40) / 2, 'DELETE', 0x7a2e2a, '#ffffff', () => { playSfx('uiClick'); this.removeSource(src); this.pendingTrash = null; this.rerender(); });
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
    this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.72).setOrigin(0, 0).setInteractive();
    const bw = this.W - 60; const bx = 30; const by = this.H / 2 - 70;
    roundRect(this.add.rectangle(bx, by, bw, 140, 0x141d2c)).setOrigin(0, 0).setStrokeStyle(2, 0xb78a46);
    this.add.text(this.W / 2, by + 16, 'MERGE?', { fontSize: `${F.heading}px`, color: '#e8b446', fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(this.W / 2, by + 42, `2× ${skill?.name ?? 'card'} ${fromTier.toUpperCase()} → ${(toTier ?? fromTier).toUpperCase()}`, {
      fontSize: `${F.small}px`, color: UI.textFootnote, fontFamily: FONT.body, align: 'center', wordWrap: { width: bw - 24 },
    }).setOrigin(0.5);
    const mk = (dx: number, w: number, label: string, fill: number, color: string, fn: () => void): void => {
      const r = roundRect(this.add.rectangle(dx, by + 88, w, 36, fill)).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      this.add.text(dx + w / 2, by + 106, label, { fontSize: `${F.name}px`, color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    };
    mk(bx + 16, (bw - 40) / 2, 'CANCEL', 0x1b2940, UI.textBright, () => { playSfx('uiBack'); this.pendingMerge = null; this.rerender(); });
    mk(bx + 24 + (bw - 40) / 2, (bw - 40) / 2, 'MERGE', 0xb78a46, UI.textOnChip, () => { playSfx('uiClick'); this.applyMerge(); });
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

  /**
   * Read-only BAG card detail (opened by a non-drag TAP on a bag card — see
   * the `totalMove < 8` guard in `wireDrag`). Same veil + big-card + CLOSE
   * idiom as the Wiki's card detail overlay, but info-only (no ADD/tier
   * chips — this card is already owned) plus a glossary entry for every
   * abbreviation/keyword the card uses.
   */


  /**
   * Gem-socket panel for one deck piece (opened by TAPPING a deck card).
   * Every card has one socket: shows the current gem with UNSOCKET, and the
   * pouch inventory with SOCKET/SWAP. run/loadout's socketGem/swapGem/
   * unsocketGem are pure — each returns the new piece rather than mutating
   * `piece`, so every action here splices that new piece back into
   * `this.pieces` (through the setter, so run-context persistence still
   * fires); displaced gems return to `this.gemInventory`. The pouch list is
   * masked + drag/wheel scrollable so an overflowing pouch never draws
   * off-canvas.
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
      compact: true, view: { x: 0, y: 0, width: this.W, height: this.H },
      onClose: close, context: skill.name,
      slots, selectedKey: slots[0]?.key,
      emptyText: this.runContext
        ? 'No gems in the pouch — events and shops on the map grant them.'
        : 'No gems in the pouch — collect some in the WIKI › GEMS tab.',
    });
  }
}
