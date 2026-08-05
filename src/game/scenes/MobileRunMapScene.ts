import Phaser from 'phaser';
import { shopCatalog } from '../../data/shopTypes';
import { eventThemeBlurb } from '../ui/eventThemeBlurb';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { rebuildScene } from '../sceneRebuild';
import { renderRunChoicePanel, type RunChoiceViewModel } from '../ui/RunChoicePanel';
import { auditTextBlock } from '../ui/controlLayoutAudit';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { renderRunRouteBoard, snapshotRunRoute } from '../ui/RunRouteBoard';
import { runScreenTemplate } from '../ui/runScreenTemplate';
import { addRunArt, eventArtKey, RUN_ART_KEYS, shopArtKey } from '../ui/runArt';
import { renderRunStatPanel } from '../ui/RunStatPanel';
import { renderRunStatsGrid, renderRunStatsOverlay, runStatsPairs } from '../ui/RunStatsPanel';
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
  type RunNode,
  type RunNodeKind,
} from '../runStore';

const F = MOBILE_PROFILE.font;
const TEMPLATE = runScreenTemplate('mobile');
const EMPTY_HUD_SNAPSHOT = { day: 0, wave: 1, gold: 0, heroLevel: 1, lives: 0, bossesCleared: 0, wins: 0, losses: 0 };

/** Steel-blue / gold-bronze / green / red — same palette as the desktop map. */
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
 * Mobile Run Map — the Run Mode node-choice screen: a vertical trail of thin
 * "cleared"/"undiscovered" depth rows around a block of 2-3 pickable next-
 * node panels, a compact header (depth/gold/hero LV/win-loss), and a START
 * RUN panel when no run is active yet. Pure playback/selection surface over
 * `src/game/runStore`. Reachable at ?scene=mrunmap.
 */
export class MobileRunMapScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private statPanelOpen = false;
  private retireConfirmOpen = false;
  private statsOverlayOpen = false;

  constructor() { super('MobileRunMap'); }

  init(): void {
    this.statPanelOpen = false;
    this.retireConfirmOpen = false;
    this.statsOverlayOpen = false;
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);
    addRunArt(this, RUN_ART_KEYS.runMap, { x: 0, y: 0, width: this.W, height: this.H }, 0.2);
    this.add.rectangle(0, 0, this.W, this.H, UI.bg, 0.58).setOrigin(0, 0);

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
      this.scene.start('MobileDraft');
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
        compact: true,
        onCancel: () => { this.statPanelOpen = false; this.rerender(); },
        onConfirm: () => { this.statPanelOpen = false; this.rerender(); },
        onChanged: () => this.rerender(),
      });
    }
    if (this.retireConfirmOpen) {
      renderRetireConfirm(this, {
        compact: true,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { retireActiveRun(); this.rerender(); },
      });
    }
    if (this.statsOverlayOpen) {
      renderRunStatsOverlay(this, {
        compact: true,
        onClose: () => { this.statsOverlayOpen = false; this.rerender(); },
      });
    }
  }

  /** THE run HUD — identical header on every run screen (`runScreenTemplate`).
   * `onOpenStatsOverlay` puts the STATS opener ON the stat strip itself
   * (tap DAY·WAVE·GOLD·LV·LIVES·BOSSES) — replaces the old floating "STATS"
   * corner tag, which read as misplaced floating over the route board. */
  private renderHud(run: NonNullable<ReturnType<typeof getActiveRun>> | undefined): void {
    renderRunHud(this, {
      screen: 'RUN',
      compact: true,
      snapshot: run ? snapshotRunProgress(run) : EMPTY_HUD_SNAPSHOT,
      onOpenStatPanel: run ? () => { this.statPanelOpen = true; this.rerender(); } : undefined,
      onOpenStatsOverlay: run ? () => { this.statsOverlayOpen = true; this.rerender(); } : undefined,
      actions: run ? {
        secondary: { label: 'DECK/BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('MobileDeckBuild'); } },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
      } : undefined,
    });
  }

  // ---------- the trail ----------

  private renderTrail(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    const routeBounds = { x: 10, y: TEMPLATE.regions.content.y, w: this.W - 20, h: 310 };
    const route = snapshotRunRoute(run);
    renderRunRouteBoard(this, routeBounds, route, { mode: 'mobile' });

    if (route.columns.length === 0) return;
    // FIXED position from the template (was derived from the route lane) so the
    // choices never move between stops — same reasoning as desktop.
    const slot = TEMPLATE.contentSlots.choices;
    this.renderChoiceBlock(slot.x, slot.y, slot.width, slot.height);
  }

  private renderChoiceBlock(x: number, top: number, w: number, availableH: number): void {
    // A committed-but-unresolved stop (the player detoured via DECK/BAG,
    // whose back button lands on the MAP) must offer the way BACK IN —
    // choices() is deliberately empty while a node is being resolved, so
    // without this panel the run dead-ends here.
    const pending = currentNode();
    if (pending) {
      const heading = this.add.text(x + w / 2, top, 'STOP IN PROGRESS', {
        fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(0.5, 0);
      auditTextBlock(heading, { name: 'Mobile run map stop-in-progress heading', maxWidth: w, maxHeight: F.tiny * 2, minFontSize: 8 });
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
          const sceneName = pending.kind === 'shop' ? 'MobileShop' : pending.kind === 'event' ? 'MobileRunEvent' : 'MobileRunPrep';
          this.scene.start(sceneName);
        },
      });
      return;
    }
    const options = choices();
    if (options.length === 0) {
      this.add.text(x + w / 2, top + 20, '···', {
        fontSize: `${F.label}px`, color: UI.textSoft, fontFamily: FONT.body,
      }).setOrigin(0.5, 0);
      return;
    }
    const planner = this.add.text(x + w / 2, top, 'CHOOSE YOUR NEXT STOP', {
      fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5, 0);
    auditTextBlock(planner, { name: 'Mobile run map choice planner', maxWidth: w, maxHeight: F.tiny * 2, minFontSize: 8 });
    top += F.tiny + 8;
    availableH -= F.tiny + 8;
    if (options.length === 1) {
      const mandatory = this.add.text(x + w / 2, top, 'MANDATORY', {
        fontSize: `${F.tiny}px`, color: UI.textSoft, fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(0.5, 0);
      auditTextBlock(mandatory, { name: 'Mobile run map mandatory label', maxWidth: w, maxHeight: F.tiny * 2, minFontSize: 8 });
      top += F.tiny + 6;
      availableH -= F.tiny + 6;
    }
    const gap = 10;
    const h = Math.min(94, (availableH - gap * (options.length - 1)) / options.length);
    let y = top;
    for (const node of options) {
      renderRunChoicePanel(this, { x, y, w, h }, this.choiceViewModel(node), {
        font: F,
        onSelect: () => {
          pickNode(node.id);
          const sceneName = node.kind === 'shop' ? 'MobileShop' : node.kind === 'event' ? 'MobileRunEvent' : 'MobileRunPrep';
          this.scene.start(sceneName);
        },
      });
      y += h + gap;
    }
  }

  private choiceViewModel(node: RunNode): RunChoiceViewModel {
    const shop = node.kind === 'shop' && node.shopId ? shopCatalog[node.shopId] : undefined;
    // Event themes come from map-gen, so labelling costs no event-bag draw.
    // Fight nodes (three-tier fight choices, USER-DIRECTED 2026-08-04) slot
    // their EASY/MEDIUM/HARD risk tier into this SAME "KIND · SUFFIX" title
    // grammar — mirrors DesktopRunMapScene's `choiceViewModel`.
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

  /** `'victory'` is legacy (the engine never sets it any more) and is
   * deliberately not handled here — only `'defeat'` (0 lives) and
   * `'retired'` (voluntary RETIRE) ever reach this. */
  private renderBanner(status: 'defeat' | 'retired'): void {
    const retired = status === 'retired';
    this.add.rectangle(0, 0, this.W, this.H, retired ? 0x1c2430 : 0x352019, 1).setOrigin(0, 0);
    const cx = this.W / 2;
    this.add.text(cx, 64, retired ? 'RUN RETIRED' : 'DEFEAT', {
      fontSize: '26px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold',
    }).setOrigin(0.5, 0);
    const run = getActiveRun()!;
    this.add.text(cx, 110, `DAYS SURVIVED ${run.depth}`, {
      fontSize: '13px', color: '#c69948', fontFamily: FONT.body, fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5, 0);
    this.add.text(cx, 132, `GOLD ${run.gold} · HERO LV ${run.heroLevel}`, {
      fontSize: '11px', color: '#9aa4b6', fontFamily: FONT.body, align: 'center', wordWrap: { width: this.W - 60 },
    }).setOrigin(0.5, 0);
    const gridW = this.W - 60;
    const gridTop = 158;
    const gridH = renderRunStatsGrid(this, cx - gridW / 2, gridTop, gridW, runStatsPairs(run), { compact: true });
    const btnY = gridTop + gridH + 30;
    const btn = this.add.rectangle(cx, btnY, 180, 44, 0xb78a46, 1).setOrigin(0.5, 0).setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true });
    this.add.text(cx, btnY + 22, 'MAIN MENU ›', { fontSize: '14px', color: '#1a1208', fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    // Every run ends back at the ONE front door (Start scene), never a
    // map-local start panel — flow consistency per user direction 2026-08-04.
    btn.on('pointerdown', () => { clearRun(); this.scene.start('Start'); });
  }
}
