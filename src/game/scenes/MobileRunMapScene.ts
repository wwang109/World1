import Phaser from 'phaser';
import { RunDestinationHost } from '../ui/RunDestinationHost';
import { SCREEN, textRole, UI } from '../theme';
import { rebuildScene } from '../sceneRebuild';
import { renderRunTravelChoiceCard, runTravelChoiceCardsLayout } from '../ui/RunTravelChoiceCard';
import { bossArrivalViewModel } from '../ui/RunBossArrivalPanel';
import { buildRunTravelChoiceViewModel, type RunTravelChoiceViewModel } from '../ui/runTravelChoiceViewModel';
import { auditControlLabel, auditTextBlock } from '../ui/controlLayoutAudit';
import { runCalendar } from '../../run/runCalendar';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { mapIntelLayoutModel, renderEmbeddedBandRead, renderMobileMapIntelOverlay, renderRunRouteBoard, snapshotRunRoute, type MapIntelLayoutModel, type MapIntelRect } from '../ui/RunRouteBoard';
import { bandBannerForWave, type BandBannerViewModel } from '../ui/bandBannerViewModel';
import { runScreenLayoutRef } from '../ui/runScreenLayout';
import { addBrightRunArt, addRunArt, RUN_ART_KEYS } from '../ui/runArt';
import { BRIGHT_ART_TREATMENT } from '../ui/brightArtTreatment';
import { renderRunStatPanel } from '../ui/RunStatPanel';
import { renderRunStatsGrid, renderRunStatsOverlay, runStatsPairs } from '../ui/RunStatsPanel';
import { setDeckBuildContext } from '../deckBuildContext';
import {
  choices,
  clearRun,
  currentMapIntel,
  currentEncounter,
  currentNode,
  getActiveRun,
  pickNode,
  previewEncounter,
  previewRunEvent,
  retireActiveRun,
  type RunNode,
} from '../runStore';
import { attachButtonFeel } from '../ui/motion';

// LIVE reference: every `TEMPLATE.*` read below resolves against the
// CURRENT viewport (the canvas fills the window -- see game/viewport.ts).
const TEMPLATE = runScreenLayoutRef('mobile');
const EMPTY_HUD_SNAPSHOT = { day: 0, wave: 1, gold: 0, heroLevel: 1, lives: 0, bossesCleared: 0, wins: 0, losses: 0 };


/**
 * Mobile Run Map — compact region guide, five-day route and stacked travel
 * cards with each earned receipt kept above its action. Pure playback over
 * `src/game/runStore`. Reachable at ?scene=mrunmap.
 */
export class MobileRunMapScene extends Phaser.Scene {
  private readonly destination = new RunDestinationHost(this, () => this.rerender());
  private W = SCREEN.width;
  private H = SCREEN.height;
  private statPanelOpen = false;
  private retireConfirmOpen = false;
  private statsOverlayOpen = false;
  /** EXPLORE REGION replaces the planner's cards with the current-band read. */
  private bandReadOpen = false;
  /** A separate, masked read sheet: never squeeze desktop's rail into the
   * phone's route lane. */
  private mapIntelOpen = false;
  /** The band model this render drew, kept so the embedded panel shows the
   * SAME read as the region guide (one forecast per render, never a second roll). */
  private band: BandBannerViewModel | null = null;

  constructor() { super('MobileRunMap'); }

  init(): void {
    this.destination.reset();
    this.statPanelOpen = false;
    this.retireConfirmOpen = false;
    this.statsOverlayOpen = false;
    this.bandReadOpen = false;
    this.mapIntelOpen = false;
    this.band = null;
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    this.destination.hide();
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(UI.bg);
    // Mobile keeps its own vertical composition: the cyan mass leads above
    // the fold and the warm mass closes the route near the footer.
    this.add.ellipse(this.W * 0.18, this.H * 0.18, this.W * 1.35, this.H * 0.58, UI.bgBlobA, BRIGHT_ART_TREATMENT.map.ambienceAlpha);
    this.add.ellipse(this.W * 0.86, this.H * 0.82, this.W * 1.05, this.H * 0.5, UI.bgBlobB, BRIGHT_ART_TREATMENT.map.ambienceAlpha * 0.72);
    addBrightRunArt(this, RUN_ART_KEYS.runMap, { x: 0, y: 0, width: this.W, height: this.H }, BRIGHT_ART_TREATMENT.map);

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
    // Every overlay below (stat panel / retire confirm / stats overlay) is a
    // centered, opaque-panel modal over a full-screen scrim — its dialog rect
    // sits ON TOP OF (and, for retire confirm, fully inside) the trail's
    // "STOP IN PROGRESS"/choice block region. Drawing the trail underneath it
    // anyway leaves dead Text objects at the exact same screen coordinates as
    // the dialog's own copy — invisible to the player (the opaque panel is a
    // higher Phaser depth), but still real GameObjects the HUD audit's text-
    // bounds overlap check (rightly) flags, since it has no notion of one
    // object being drawn UNDER another. Skipping the trail while a modal owns
    // the screen is the default for page-replacing modals. The stat sheet is
    // the deliberate exception: its interactive scrim keeps the route inert.
    const modalOpen = this.statPanelOpen || this.retireConfirmOpen || this.statsOverlayOpen || this.mapIntelOpen;
    if (!modalOpen) this.renderTrail(run);
    else if (this.statPanelOpen) this.renderTrail(run);
    if (this.statPanelOpen) {
      renderRunStatPanel(this, {
        compact: true,
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
    if (this.mapIntelOpen) {
      renderMobileMapIntelOverlay(
        this,
        this.mobileIntelLayout(),
        () => { this.mapIntelOpen = false; this.rerender(); },
      );
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
        back: { label: 'DECK/BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('MobileDeckBuild'); } },
        secondary: { label: 'RUN LEDGER', onPress: () => { this.statsOverlayOpen = true; this.rerender(); } },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
      } : undefined,
    });
  }

  // ---------- the trail ----------

  private renderTrail(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    const content = TEMPLATE.regions.content;
    const band = bandBannerForWave(run, snapshotRunProgress(run).wave);
    this.band = band;
    // Compact region identity opens the same complete forecast as desktop.
    const regionH = 88;
    this.add.rectangle(content.x, content.y, content.width, regionH, UI.panel, 0.96).setOrigin(0, 0)
      .setStrokeStyle(1, UI.border, 0.7);
    addRunArt(this, band.artKey, { x: content.x + 4, y: content.y + 4, width: 80, height: 80 });
    const textX = content.x + 104;
    const textW = content.width - 112;
    const name = this.add.text(textX, content.y + 6, band.name, textRole('section'));
    auditTextBlock(name, { name: 'Mobile current region name', maxWidth: textW, maxHeight: 20, minFontSize: 9 });
    const facts = this.add.text(textX, content.y + 27, `${band.leanChip} · ${band.waveRange}`, textRole('micro', { ink: 'secondary' }));
    auditTextBlock(facts, { name: 'Mobile current region day range', maxWidth: textW, maxHeight: 14, minFontSize: 9 });
    const opener = this.add.rectangle(textX, content.y + 44, textW, 40, UI.panelAlt, 0.98).setOrigin(0, 0)
      .setStrokeStyle(1, UI.border, 0.8);
    const openerLabel = this.add.text(textX + textW / 2, content.y + 64,
      this.bandReadOpen ? 'REGION OPEN' : 'EXPLORE REGION ›', textRole('label', { ink: 'accent' })).setOrigin(0.5);
    auditControlLabel(opener, openerLabel, { name: 'Mobile explore region', horizontalPadding: 8, verticalPadding: 6, minFontSize: 9 });
    if (!this.bandReadOpen) {
      opener.setInteractive({ useHandCursor: true });
      attachButtonFeel(this, opener, {
        fill: UI.panelAlt, hover: UI.chipDark, follow: [openerLabel],
        onPress: () => { this.destination.close(false); this.bandReadOpen = true; this.rerender(); },
      });
    }

    const plannerTop = content.y + regionH + 8;
    this.add.rectangle(content.x, plannerTop, content.width, content.y + content.height - plannerTop, UI.panel, 0.94).setOrigin(0, 0);
    const routeTop = plannerTop + 8;
    const routeH = 72;
    const intel = currentMapIntel();
    const routeWidth = content.width - (intel.length > 0 ? 124 : 0);
    renderRunRouteBoard(this, { x: content.x, y: routeTop, w: routeWidth, h: routeH }, snapshotRunRoute(run), {
      mode: 'mobile', regionName: band.name,
    });
    if (intel.length > 0) {
      const buttonW = 112;
      const buttonH = 40;
      const buttonX = content.x + content.width - buttonW;
      const buttonY = routeTop + 8;
      const button = this.add.rectangle(buttonX, buttonY, buttonW, buttonH, UI.panelAlt, 0.96).setOrigin(0, 0)
        .setStrokeStyle(1, UI.border, 0.75).setInteractive({ useHandCursor: true });
      const label = this.add.text(buttonX + buttonW / 2, buttonY + buttonH / 2, `MAP INTEL · ${intel.length}`, textRole('micro', { ink: 'accent' })).setOrigin(0.5);
      auditControlLabel(button, label, { name: 'Mobile map intel opener', horizontalPadding: 6, verticalPadding: 6, minFontSize: 9 });
      attachButtonFeel(this, button, {
        fill: UI.panelAlt, hover: UI.chipDark, follow: [label],
        onPress: () => { this.mapIntelOpen = true; this.rerender(); },
      });
    }
    const choicesTop = routeTop + routeH + 8;
    this.renderChoiceBlock(content.x, choicesTop, content.width, content.y + content.height - choicesTop);
  }

  /** The compact profile also serves narrow desktop windows. Keep its
   * existing masked sheet contract, centered when there is extra width. */
  private mobileIntelLayout(): MapIntelLayoutModel {
    const width = Math.min(this.W, 640);
    const layout = mapIntelLayoutModel(currentMapIntel(), { width, height: this.H });
    const dx = (this.W - width) / 2;
    const move = (rect: MapIntelRect): MapIntelRect => ({ ...rect, x: rect.x + dx });
    return {
      ...layout,
      rail: move(layout.rail),
      route: move(layout.route),
      heading: move(layout.heading),
      cards: layout.cards.map((card) => ({ ...card, rect: move(card.rect) })),
      mask: layout.mask ? move(layout.mask) : undefined,
      close: layout.close ? move(layout.close) : undefined,
    };
  }

  private renderChoiceBlock(x: number, top: number, w: number, availableH: number): void {
    const pending = currentNode();
    const options = this.destination.choices(pending ? [pending] : choices());
    const boss = pending?.kind === 'boss' ? pending : options.length === 1 && options[0]?.kind === 'boss' ? options[0] : undefined;
    const arrival = boss ? bossArrivalViewModel(getActiveRun()!, boss, pending ? currentEncounter() ?? null : previewEncounter(boss)) : null;
    const planner = this.add.text(x + 8, top, 'CHOOSE YOUR NEXT STOP', textRole('label'));
    auditTextBlock(planner, { name: 'Mobile run map choice planner', maxWidth: w - 132, maxHeight: 18, minFontSize: 9 });
    const status = this.bandReadOpen ? 'REGION VIEW' : arrival ? '' : pending ? 'STOP IN PROGRESS'
      : options.length === 1 && options[0]?.kind === 'boss' ? 'MANDATORY'
        : options.length === 3 ? 'CHOOSE 1 OF 3' : '';
    const statusText = this.add.text(x + w - 8, top + 2, status, textRole('micro', { ink: 'label' })).setOrigin(1, 0);
    auditTextBlock(statusText, { name: 'Mobile route choice count', maxWidth: 116, maxHeight: 16, minFontSize: 9 });
    if (this.bandReadOpen && this.band) {
      renderEmbeddedBandRead(this, { x, y: top + 20, w, h: availableH - 20 }, this.band, {
        mode: 'mobile', onBack: () => { this.bandReadOpen = false; this.rerender(); },
      });
      return;
    }
    if (this.destination.render({ x, y: top + 20, width: w, height: availableH - 20 })) return;
    if (boss && arrival) {
      this.destination.renderBoss({ x, y: top + 20, width: w, height: availableH - 20 }, arrival, true, () => {
        if (!currentNode()) pickNode(boss.id);
        this.scene.start('MobileRunPrep');
      });
      return;
    }
    const models = options.map((node) => ({ ...this.choiceViewModel(node), enabled: !pending || node.id === pending.id }));
    if (models.length > 0 && models.every((model) => model.dossier)) {
      this.destination.renderEncounters({ x, y: top + 20, width: w, height: availableH - 20 }, models, true, pending?.id, (nodeId) => {
        if (!pending) pickNode(nodeId);
        this.scene.start('MobileRunPrep');
      });
      return;
    }
    const layout = runTravelChoiceCardsLayout(
      { x, y: top + 20, width: w, height: availableH - 20 }, models,
      { compact: true, pending: pending !== undefined },
    );
    options.forEach((node, index) => {
      renderRunTravelChoiceCard(this, layout.cards[index]!, models[index]!, {
        compact: true,
        pending: pending?.id === node.id,
        appearIndex: index,
        onSelect: () => {
          if (!pending) pickNode(node.id);
          if (node.kind === 'boss') { this.rerender(); return; }
          if (node.kind === 'event') {
            this.scene.start('MobileRunEvent');
            return;
          }
          if (node.kind === 'shop') {
            this.destination.open('MobileShop', node.id, options);
            return;
          }
          this.scene.start('MobileRunPrep');
        },
      });
    });
  }

  private choiceViewModel(node: RunNode): RunTravelChoiceViewModel {
    const run = getActiveRun()!;
    return buildRunTravelChoiceViewModel(run, node, previewRunEvent(node), previewEncounter(node));
  }

  // ---------- defeat / retired end-summary banner ----------

  /** `'victory'` is legacy (the engine never sets it any more) and is
   * deliberately not handled here — only `'defeat'` (0 lives) and
   * `'retired'` (voluntary RETIRE) ever reach this. */
  private renderBanner(status: 'defeat' | 'retired'): void {
    const retired = status === 'retired';
    this.add.rectangle(0, 0, this.W, this.H, retired ? 0x1c2430 : 0x352019, 1).setOrigin(0, 0);
    const cx = this.W / 2;
    // THE ONE FIRST THING on this screen — `display` is spent here and nowhere
    // else in the scene, which is what gives the banner a reading order at all.
    this.add.text(cx, 64, retired ? 'RUN RETIRED' : 'DEFEAT', textRole('display')).setOrigin(0.5, 0);
    const run = getActiveRun()!;
    this.add.text(cx, 106, `DAY REACHED ${runCalendar(run).absoluteDay}`, {
      ...textRole('statValue', { ink: 'accent' }), align: 'center',
    }).setOrigin(0.5, 0);
    this.add.text(cx, 130, `GOLD ${run.gold} · HERO LV ${run.heroLevel}`, {
      ...textRole('micro'), align: 'center', wordWrap: { width: this.W - 60 },
    }).setOrigin(0.5, 0);
    const gridW = this.W - 60;
    const gridTop = 158;
    const gridH = renderRunStatsGrid(this, cx - gridW / 2, gridTop, gridW, runStatsPairs(run), { compact: true });
    const btnY = gridTop + gridH + 30;
    const btn = this.add.rectangle(cx, btnY, 180, 44, 0xb78a46, 1).setOrigin(0.5, 0).setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true });
    const btnLabel = this.add.text(cx, btnY + 22, 'MAIN MENU ›', textRole('label', { ink: 'onAccent' })).setOrigin(0.5);
    // Every run ends back at the ONE front door (Start scene), never a
    // map-local start panel — flow consistency per user direction 2026-08-04.
    // Shared feel (ui/motion) — this button had neither hover nor press
    // feedback. Wired on BOTH platforms in the same change (both-platforms rule).
    attachButtonFeel(this, btn, {
      fill: 0xb78a46,
      hover: UI.chipDark,
      follow: [btnLabel],
      onPress: () => { clearRun(); this.scene.start('Start'); },
    });
  }
}
