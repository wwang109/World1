import Phaser from 'phaser';
import { shopCatalog } from '../../data/shopTypes';
import { eventThemeBlurb } from '../ui/eventThemeBlurb';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { rebuildScene } from '../sceneRebuild';
import { renderRunChoicePanel, runChoicePanelMinHeight, type RunChoiceViewModel } from '../ui/RunChoicePanel';
import { auditTextBlock } from '../ui/controlLayoutAudit';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { renderRunRouteBoard, snapshotRunRoute } from '../ui/RunRouteBoard';
import { runScreenLayoutRef } from '../ui/runScreenLayout';
import { addRunArt, eventArtKey, RUN_ART_KEYS, shopArtKey } from '../ui/runArt';
import { renderRunStatPanel } from '../ui/RunStatPanel';
import { renderRunBossCountdownPanel, renderRunStatsFlankPanel, renderRunStatsGrid, runStatsPairs } from '../ui/RunStatsPanel';
import { setDeckBuildContext } from '../deckBuildContext';
import {
  choices,
  clearRun,
  currentNode,
  encounterHintDetail,
  FIGHT_TIER_LABEL,
  getActiveRun,
  pickNode,
  previewEncounter,
  retireActiveRun,
  WAVE_COUNT,
  type RunNode,
  type RunNodeKind,
} from '../runStore';

const F = DESKTOP_PROFILE.font;
// LIVE reference: every `TEMPLATE.*` read below resolves against the
// CURRENT viewport (the canvas fills the window -- see game/viewport.ts).
const TEMPLATE = runScreenLayoutRef('desktop');

const GX = DESKTOP_PROFILE.safe.x;
const CONTENT_TOP = TEMPLATE.regions.content.y;

/** The HUD's stat strip before a run exists (the "START A NEW RUN" state) —
 * all zeroes, no banked-PL/RETIRE actions to show. */
const EMPTY_HUD_SNAPSHOT = { day: 0, wave: 1, gold: 0, heroLevel: 1, lives: 0, bossesCleared: 0, wins: 0, losses: 0 };

/** Steel-blue / gold-bronze / green / red — all already in the shared UI
 * palette, kept distinct per node kind across every rendering of the map. */
const KIND_COLOR: Record<RunNodeKind, number> = {
  fight: 0x4a7ab5,
  event: UI.chip,
  shop: UI.good,
  boss: UI.bad,
};
const KIND_LABEL: Record<RunNodeKind, string> = {
  fight: 'FIGHT',
  event: 'EVENT',
  shop: 'SHOP',
  boss: 'BOSS',
};

/**
 * Desktop Run Map — the Run Mode node-choice screen: a horizontal trail of
 * depth columns (thin "cleared"/"undiscovered" pips either side of a wide
 * column holding the 2-3 pickable next-node panels), a header with depth/
 * gold/hero LV/win-loss, and a START RUN panel when no run is active yet.
 * A pure playback/selection surface over `src/game/runStore` — no combat or
 * map-generation logic lives here. Reachable at ?scene=desktop-runmap.
 */
export class DesktopRunMapScene extends Phaser.Scene {
  private statPanelOpen = false;
  private retireConfirmOpen = false;

  constructor() { super('DesktopRunMap'); }

  init(): void {
    this.statPanelOpen = false;
    this.retireConfirmOpen = false;
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.bg);
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.bg).setOrigin(0, 0);
    addRunArt(this, RUN_ART_KEYS.runMap, { x: 0, y: 0, width: SCREEN.width, height: SCREEN.height }, 0.2);
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.bg, 0.58).setOrigin(0, 0);

    const run = getActiveRun();
    if (!run) {
      // ONE front door: no duplicate start panel here — the Start scene owns
      // starting runs (seed + reroll live there now).
      this.scene.start('Start');
      return;
    }
    // Freshly-started run (or a stale re-entry mid-draft) — the run-context
    // draft owns installing the starting deck before any node is pickable.
    if (run.status === 'drafting') {
      this.scene.start('DesktopDraft');
      return;
    }
    if (run.status === 'defeat' || run.status === 'retired') {
      this.renderBanner(run.status);
      return;
    }

    this.renderHud(run);
    this.renderTrail(run);
    if (this.statPanelOpen) {
      renderRunStatPanel(this, {
        compact: false,
        onCancel: () => { this.statPanelOpen = false; this.rerender(); },
        onConfirm: () => { this.statPanelOpen = false; this.rerender(); },
        onChanged: () => this.rerender(),
      });
    }
    if (this.retireConfirmOpen) {
      // REVIEWED AND LEFT (audit 2026-08): no scene-level generic pointerdown/pointerup listener at all in this file — grep-confirmed.
      // So `renderRetireConfirm`'s rebuild-on-close can never race a
      // stale-vs-fresh scene-level re-dispatch (see
      // `wasPointerConsumedByRebuild`'s doc comment, sceneRebuild.ts) — the
      // mechanism that guard exists for cannot manifest here. No guard
      // needed. (Contrast `MobileRunEventScene`, which DOES have one.)
      renderRetireConfirm(this, {
        compact: false,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { retireActiveRun(); this.rerender(); },
      });
    }
  }

  /** THE run HUD — identical header on every run screen (`runScreenTemplate`).
   * `run` undefined only on the pre-start "START A NEW RUN" state (no stats
   * to show yet, so the strip reads all zeroes and the actions row is bare). */
  private renderHud(run: NonNullable<ReturnType<typeof getActiveRun>> | undefined): void {
    renderRunHud(this, {
      screen: 'RUN',
      compact: false,
      snapshot: run ? snapshotRunProgress(run) : EMPTY_HUD_SNAPSHOT,
      onOpenStatPanel: run ? () => { this.statPanelOpen = true; this.rerender(); } : undefined,
      actions: run ? {
        secondary: { label: 'DECK / BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('DesktopDeck'); } },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
      } : undefined,
    });
  }

  // ---------- the trail ----------

  private renderTrail(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    const area = SCREEN.width - GX * 2;
    const bottom = SCREEN.height - DESKTOP_PROFILE.safe.bottom;
    const route = snapshotRunRoute(run);
    // The route board owns the FULL-WIDTH band BELOW the choices/flank row —
    // it used to span the whole content region, which put its trail line and
    // pips underneath the flank panels (user report: ledger/milestone covered
    // the map progress). Now nothing overlaps it.
    const slot = TEMPLATE.contentSlots.choices;
    const laneTop = slot.y + slot.height + 16;
    const bounds = { x: GX, y: laneTop, w: area, h: bottom - laneTop };
    renderRunRouteBoard(this, bounds, route, { mode: 'desktop' });

    // FIXED position from the template — the choices used to be centred on the
    // player's current depth, so they slid across the screen as the run
    // advanced and had to be re-found every stop. The route board below still
    // shows where you are; the thing you CLICK never moves.
    this.renderFlanks(run, slot);
    if (route.columns.length === 0) return;
    this.renderChoiceColumn(slot.x, slot.y, slot.width, slot.height);
  }

  /**
   * Density pass (2026-08-04, live user feedback: "a lot of dead space ...
   * stats is in a bad location"): the flanks either side of the FIXED choices
   * column used to sit empty (just the thin route trail passing behind
   * them). Desktop now gives the run ledger a PERMANENT home in the right
   * flank — no tap required, unlike the floating "STATS" corner tag it
   * replaces — and a next-boss-milestone countdown in the left flank, so
   * both margins carry real, always-visible content and the three columns
   * (countdown | choices | ledger) read as one balanced row.
   */
  private renderFlanks(
    run: NonNullable<ReturnType<typeof getActiveRun>>,
    choicesSlot: { x: number; y: number; width: number; height: number },
  ): void {
    const gap = 24;
    const content = TEMPLATE.regions.content;
    const contentRight = content.x + content.width;
    const leftWidth = choicesSlot.x - GX - gap;
    const rightX = choicesSlot.x + choicesSlot.width + gap;
    const rightWidth = contentRight - rightX;
    // Flanks match the choices column's height exactly — the band below the
    // whole row belongs to the route board (full-width map progress), which
    // these panels covered when they stretched to the content floor.
    const flankHeight = choicesSlot.height;

    if (leftWidth > 40) {
      const snapshot = snapshotRunProgress(run);
      const bossEvery = WAVE_COUNT;
      const wavesRemaining = (bossEvery - (snapshot.wave % bossEvery)) % bossEvery;
      renderRunBossCountdownPanel(
        this,
        { x: GX, y: choicesSlot.y, width: leftWidth, height: flankHeight },
        { wavesRemaining, bossWave: snapshot.wave + wavesRemaining },
        run.bossesCleared,
      );
    }
    if (rightWidth > 40) {
      renderRunStatsFlankPanel(this, { x: rightX, y: choicesSlot.y, width: rightWidth, height: flankHeight }, run);
    }
  }

  private renderChoiceColumn(x: number, top: number, w: number, availableH: number): void {
    // A committed-but-unresolved stop (the player detoured via DECK/BAG,
    // whose back button lands on the MAP) must offer the way BACK IN —
    // choices() is deliberately empty while a node is being resolved, so
    // without this panel the run dead-ends here.
    const pending = currentNode();
    if (pending) {
      const heading = this.add.text(x + w / 2, top, 'STOP IN PROGRESS', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
      }).setOrigin(0.5, 0);
      auditTextBlock(heading, { name: 'Desktop run map stop-in-progress heading', maxWidth: w, maxHeight: F.tiny * 2, minFontSize: 8 });
      renderRunChoicePanel(this, { x, y: top + F.tiny + 8, w, h: 94 }, {
        nodeId: pending.id,
        kind: pending.kind,
        title: `RETURN TO ${KIND_LABEL[pending.kind]}`,
        detail: 'Resume where you left off.',
        image: pending.kind === 'shop'
          ? { textureKey: shopArtKey(pending.shopId ?? '') }
          : pending.kind === 'event'
            ? { textureKey: eventArtKey(pending.eventTheme ?? 'training') }
            : pending.kind === 'boss'
              ? { textureKey: RUN_ART_KEYS.icon.bossSkull }
              : undefined,
        accent: KIND_COLOR[pending.kind],
        enabled: true,
      }, {
        font: F,
        onSelect: () => {
          const sceneName = pending.kind === 'shop' ? 'DesktopShop' : pending.kind === 'event' ? 'DesktopRunEvent' : 'DesktopRunPrep';
          this.scene.start(sceneName);
        },
      });
      return;
    }
    const options = choices();
    if (options.length === 0) {
      this.add.text(x + w / 2, top + 20, '···', {
        fontFamily: FONT.body, fontSize: `${F.label}px`, color: UI.textSoft,
      }).setOrigin(0.5, 0);
      return;
    }
    const planner = this.add.text(x + w / 2, top, 'CHOOSE YOUR NEXT STOP', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
    }).setOrigin(0.5, 0);
    auditTextBlock(planner, { name: 'Desktop run map choice planner', maxWidth: w, maxHeight: F.tiny * 2, minFontSize: 8 });
    top += F.tiny + 8;
    availableH -= F.tiny + 8;
    if (options.length === 1) {
      const mandatory = this.add.text(x + w / 2, top, 'MANDATORY', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textSoft,
      }).setOrigin(0.5, 0);
      auditTextBlock(mandatory, { name: 'Desktop run map mandatory label', maxWidth: w, maxHeight: F.tiny * 2, minFontSize: 8 });
      top += F.tiny + 6;
      availableH -= F.tiny + 6;
    }
    const gap = 12;
    // Density pass: compact content-fit rows (name + one hint line) instead of
    // stretching to a big mostly-empty box — cap at 92 (was 170). The 92 is a
    // CEILING on wasted space, never a licence to squeeze below what the stack
    // needs: shop rows carry a footer, and under the floor the detail line
    // silently ellipsizes rather than overflowing (see `runChoicePanelMinHeight`).
    const panelH = Math.max(
      runChoicePanelMinHeight(F, true),
      Math.min(92, (availableH - gap * (options.length - 1)) / options.length),
    );
    let y = top;
    for (const node of options) {
      renderRunChoicePanel(this, { x, y, w, h: panelH }, this.choiceViewModel(node), {
        font: F,
        onSelect: () => {
          pickNode(node.id);
          const sceneName = node.kind === 'shop' ? 'DesktopShop' : node.kind === 'event' ? 'DesktopRunEvent' : 'DesktopRunPrep';
          this.scene.start(sceneName);
        },
      });
      y += panelH + gap;
    }
  }

  private choiceViewModel(node: RunNode): RunChoiceViewModel {
    const shop = node.kind === 'shop' && node.shopId ? shopCatalog[node.shopId] : undefined;
    // Event themes are assigned at map-gen (not by rolling the event), so a
    // choice can advertise what it offers without consuming the event bag.
    // Fight nodes (three-tier fight choices, USER-DIRECTED 2026-08-04) slot
    // their EASY/MEDIUM/HARD risk tier into this SAME "KIND · SUFFIX" title
    // grammar — a fight node never has a shop/event theme, so the two never
    // collide. Boss nodes have no `fightOption`, so their title stays plain.
    const themeSuffix = shop
      ? shop.name.toUpperCase()
      : node.kind === 'fight' && node.fightOption
        ? FIGHT_TIER_LABEL[node.fightOption]
        : node.eventTheme?.toUpperCase();
    const titleLabel = themeSuffix ? `${KIND_LABEL[node.kind]} · ${themeSuffix}` : KIND_LABEL[node.kind];

    if (node.kind === 'shop') {
      return {
        nodeId: node.id,
        kind: node.kind,
        title: titleLabel,
        detail: shop?.tagline ?? '',
        footer: shop ? `${shop.shelf.cards} CARDS · ${shop.shelf.gems} GEMS` : undefined,
        image: { textureKey: shopArtKey(node.shopId ?? '') },
        accent: KIND_COLOR[node.kind],
        enabled: true,
      };
    }

    if (node.kind === 'fight' || node.kind === 'boss') {
      const pack = previewEncounter(node);
      return {
        nodeId: node.id,
        kind: node.kind,
        title: titleLabel,
        detail: pack ? encounterHintDetail(pack, node.kind === 'fight' ? node.fightOption : undefined) : '',
        image: node.kind === 'boss' ? { textureKey: RUN_ART_KEYS.icon.bossSkull } : undefined,
        accent: KIND_COLOR[node.kind],
        enabled: true,
      };
    }

    return {
      nodeId: node.id,
      kind: node.kind,
      title: titleLabel,
      detail: eventThemeBlurb(node.eventTheme),
      image: { textureKey: eventArtKey(node.eventTheme ?? 'training') },
      accent: KIND_COLOR[node.kind],
      enabled: true,
    };
  }

  // ---------- defeat / retired end-summary banner ----------

  /** The run's end screen — reached at 0 lives (`'defeat'`) or a voluntary
   * RETIRE (`'retired'`). `'victory'` is legacy (the engine never sets it any
   * more, see `RunStatus`) and is deliberately not handled here. */
  private renderBanner(status: 'defeat' | 'retired'): void {
    const retired = status === 'retired';
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, retired ? UI.panelMuted : UI.badSoft, 1).setOrigin(0, 0);
    const cx = SCREEN.width / 2;
    this.add.text(cx, 56, retired ? 'RUN RETIRED' : 'DEFEAT', {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.big * 1.6}px`, color: UI.text,
    }).setOrigin(0.5, 0);
    const run = getActiveRun()!;
    this.add.text(cx, 128, `DAYS SURVIVED ${run.depth}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.textAccent,
    }).setOrigin(0.5, 0);
    this.add.text(cx, 156, `GOLD ${run.gold}   ·   HERO LV ${run.heroLevel}`, {
      fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim,
    }).setOrigin(0.5, 0);
    const gridW = Math.min(700, SCREEN.width - 160);
    const gridTop = 190;
    const gridH = renderRunStatsGrid(this, cx - gridW / 2, gridTop, gridW, runStatsPairs(run), { compact: false });
    const btnY = gridTop + gridH + 40;
    const btn = this.add.rectangle(cx, btnY, 220, 48, UI.chip, 1).setOrigin(0.5, 0).setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true });
    this.add.text(cx, btnY + 24, 'MAIN MENU ›', { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.textOnChip }).setOrigin(0.5);
    // Every run ends back at the ONE front door (Start scene), never a
    // map-local start panel — flow consistency per user direction 2026-08-04.
    btn.on('pointerdown', () => { clearRun(); this.scene.start('Start'); });
  }
}
