import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { setBattleContext } from '../battleContext';
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
import { addBiomeAmbience, runAmbienceBiomeId } from '../ui/ambience';
import { BRIGHT_ART_TREATMENT } from '../ui/brightArtTreatment';
import { renderRunStatPanel } from '../ui/RunStatPanel';
import { openRunModal } from '../ui/RunModal';
import { renderRunStatsGrid, runStatsGridHeight, runStatsPairs } from '../ui/RunStatsPanel';
import { setDeckBuildContext } from '../deckBuildContext';
import {
  acceptExtraGhostFightOffer,
  activeChallengeFight,
  choices,
  chooseRunBiome,
  clearRun,
  currentMapIntel,
  currentEncounter,
  currentNode,
  declineExtraGhostFightOffer,
  extraGhostFightOffer,
  getActiveRun,
  pendingBiomePick,
  pickNode,
  previewEncounter,
  previewRunEvent,
  retireActiveRun,
  type RunNode,
} from '../runStore';
import { attachButtonFeel } from '../ui/motion';
import { renderPaintedChrome } from '../ui/paintedChrome';
import { renderRegionHeading } from '../ui/regionHeading';
import { renderRunBiomePickPanel } from '../ui/RunBiomePickPanel';
import { renderRunGhostFightOfferPanel } from '../ui/RunGhostFightOfferPanel';
import { renderRunHistoryPanel } from '../ui/RunHistoryPanel';
import { renderRunLogToggle } from '../ui/RunLogToggle';
import { runRouteSelectedStops } from '../ui/runHistoryViewModel';
import { renderRunMapChoiceViewport } from '../ui/runMapChoiceViewport';

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
  private hudObjects: Phaser.GameObjects.GameObject[] = [];
  private statPanelOpen = false;
  private retireConfirmOpen = false;
  private historyScroll = 0;
  private historyOpen = false;
  private choiceScroll = 0;
  private bandReadOpen = false;
  /** A separate, masked read sheet: never squeeze desktop's rail into the
   * phone's route lane. */
  private mapIntelOpen = false;
  private shopMenuOpen = false;
  /** The band model this render drew, kept so the embedded panel shows the
   * SAME read as the region guide (one forecast per render, never a second roll). */
  private band: BandBannerViewModel | null = null;

  constructor() { super('MobileRunMap'); }

  init(): void {
    this.destination.reset();
    this.statPanelOpen = false;
    this.retireConfirmOpen = false;
    this.historyScroll = 0;
    this.historyOpen = false;
    this.choiceScroll = 0;
    this.bandReadOpen = false;
    this.mapIntelOpen = false;
    this.shopMenuOpen = false;
    this.band = null;
  }

  private rerender(): void { rebuildScene(this); }

  private openLedger(): void {
    const run = getActiveRun();
    if (!run) return;
    openRunModal(this, { id: 'run-ledger', title: 'RUN LEDGER', compact: true, width: 388, height: 304,
      onClose: () => {}, render: (scene, layout) => {
        renderRunStatsGrid(scene, layout.body.x, layout.body.y, layout.body.width, runStatsPairs(run), { compact: true });
      },
    });
  }

  create(): void {
    this.data.set('refreshRunHud', () => {
      for (const object of this.hudObjects) if (object.scene) object.destroy();
      this.renderHud(getActiveRun() ?? undefined);
    });
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
    addBiomeAmbience(this, runAmbienceBiomeId(run), { x: 0, y: 0, width: this.W, height: this.H });
    // Freshly-started run (or a stale re-entry mid-draft) — the run-context
    // draft owns installing the starting deck before any node is pickable.
    if (run.status === 'drafting') {
      this.scene.start('MobileDraft');
      return;
    }
    // Resume-safety: a save loaded mid-`challengeFight` restarts that battle.
    if (activeChallengeFight()) {
      setBattleContext('run');
      this.scene.start('MobileBattle');
      return;
    }
    if (run.status === 'defeat' || run.status === 'retired') {
      // Overlay panel over the map, not a full-page takeover (2026-09-21).
      this.renderHud(run, false);
      this.renderEndOverlay(run.status);
      return;
    }

    this.renderHud(run);
    // Every overlay below (stat panel / retire confirm) is a
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
    const modalOpen = this.statPanelOpen || this.retireConfirmOpen || this.mapIntelOpen || this.shopMenuOpen;
    if (!modalOpen) this.renderTrail(run);
    else if (this.statPanelOpen && !this.destination.isOpen('MobileShop')) this.renderTrail(run);
    if (this.shopMenuOpen && !this.statPanelOpen && !this.retireConfirmOpen) {
      this.shopHeaderButton(10, 132, this.W - 20, 'BACK TO SHOP', () => { this.shopMenuOpen = false; this.rerender(); });
    }
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
        onConfirm: () => { playSfx('runLose'); retireActiveRun(); this.rerender(); },
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
  private renderHud(run: NonNullable<ReturnType<typeof getActiveRun>> | undefined, actionsEnabled = true): void {
    if (run && this.destination.isOpen('MobileShop') && !this.shopMenuOpen && !this.bandReadOpen) {
      this.add.rectangle(0, 0, this.W, 62, UI.bg, 0.96).setOrigin(0, 0);
      this.shopHeaderButton(10, 10, 64, '‹ MAP', () => this.destination.close());
      const progress = snapshotRunProgress(run);
      this.add.text(84, 12, 'SHOP', textRole('section', { ink: 'accent' }));
      this.add.text(84, 36, `DAY ${progress.wave} · ${progress.gold} G`, textRole('micro', { ink: 'secondary' }));
      this.shopHeaderButton(this.W - 80, 10, 70, 'MENU', () => { this.shopMenuOpen = true; this.rerender(); });
      return;
    }
    const before = new Set(this.children.list);
    renderRunHud(this, {
      screen: 'RUN',
      compact: true,
      snapshot: run ? snapshotRunProgress(run) : EMPTY_HUD_SNAPSHOT,
      onOpenStatPanel: run && actionsEnabled ? () => { this.statPanelOpen = true; this.rerender(); } : undefined,
      onOpenStatsOverlay: run && actionsEnabled ? () => this.openLedger() : undefined,
      actions: run && actionsEnabled ? {
        back: { label: 'BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('MobileDeckBuild'); } },
        secondary: { label: 'RUN LEDGER', onPress: () => this.openLedger() },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
      } : undefined,
    });
    this.hudObjects = this.children.list.filter(object => !before.has(object));
  }

  private shopHeaderButton(x: number, y: number, width: number, label: string, onPress: () => void): void {
    const plate = this.add.rectangle(x, y, width, 40, UI.panelAlt, 1).setOrigin(0, 0)
      .setStrokeStyle(1, UI.border, 0.8).setInteractive({ useHandCursor: true });
    const caption = this.add.text(x + width / 2, y + 20, label, textRole('label')).setOrigin(0.5);
    attachButtonFeel(this, plate, { fill: UI.panelAlt, hover: UI.chipDark, follow: [caption], onPress });
  }

  // ---------- the trail ----------

  private renderTrail(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    if (this.destination.isOpen('MobileShop') && !this.bandReadOpen) {
      this.destination.render({ x: 6, y: 62, width: this.W - 12, height: this.H - 72 });
      return;
    }
    const content = { ...TEMPLATE.regions.content, height: this.H - TEMPLATE.regions.content.y - 10 };
    const band = bandBannerForWave(run, snapshotRunProgress(run).wave);
    this.band = band;
    const regionPending = pendingBiomePick() !== null;
    const artKey = regionPending ? RUN_ART_KEYS.runMap : band.artKey;
    const name = regionPending ? 'Choose Your Region' : band.name;
    // Compact region identity opens the same complete forecast as desktop.
    const regionH = this.historyOpen ? 132 : 112;
    if (!this.historyOpen) {
      this.add.rectangle(content.x, content.y, content.width, regionH, UI.panel, 0.96).setOrigin(0, 0)
        .setStrokeStyle(1, UI.border, 0.7);
      addRunArt(this, artKey, { x: content.x + 10, y: content.y + 16, width: 80, height: 80 });
      renderPaintedChrome(this, content.x, content.y, content.width, regionH, { borderOnly: true, corner: 16 });
      const textX = content.x + 104;
      const textW = content.width - 112;
      const identityWidth = textW - (currentMapIntel().length > 0 ? 116 : 0);
      renderRegionHeading(this, textX, content.y + 10, name, identityWidth, { compact: true });
      const factsLine = regionPending ? band.waveRange : `${band.leanChip} · ${band.waveRange}`;
      const facts = this.add.text(textX, content.y + 42, factsLine, textRole('micro', { ink: 'secondary' }));
      auditTextBlock(facts, { name: 'Mobile current region day range', maxWidth: identityWidth, maxHeight: 14, minFontSize: 9 });
      const opener = this.add.rectangle(textX, content.y + 62, textW, 40, UI.panelAlt, 0.98).setOrigin(0, 0)
        .setStrokeStyle(1, UI.border, 0.8);
      const openerLabel = this.add.text(textX + textW / 2, content.y + 82, 'RUN LOG', textRole('label', { ink: 'accent' })).setOrigin(0.5);
      auditControlLabel(opener, openerLabel, { name: 'Mobile run log opener', horizontalPadding: 8, verticalPadding: 6, minFontSize: 9 });
      if (!this.statPanelOpen && !this.retireConfirmOpen) opener.setInteractive({ useHandCursor: true });
      attachButtonFeel(this, opener, {
        fill: UI.panelAlt, hover: UI.chipDark, follow: [openerLabel],
        onPress: () => { this.historyOpen = true; this.rerender(); },
      });
    } else {
      renderRunHistoryPanel(this, { x: content.x, y: content.y, width: content.width, height: regionH }, run, {
        compact: true, scroll: this.historyScroll, onScroll: (scroll) => { this.historyScroll = scroll; },
        enabled: !this.statPanelOpen && !this.retireConfirmOpen && !this.mapIntelOpen && !this.shopMenuOpen,
      });
      renderRunLogToggle(this, content.x + content.width - 108, content.y + 4, 100, 24, 'COLLAPSE',
        !this.statPanelOpen && !this.retireConfirmOpen, () => { this.historyOpen = false; this.rerender(); });
    }

    const plannerTop = content.y + regionH + 8;
    this.add.rectangle(content.x, plannerTop, content.width, content.y + content.height - plannerTop, UI.panel, 0.94).setOrigin(0, 0);
    renderPaintedChrome(this, content.x, plannerTop, content.width, content.y + content.height - plannerTop, { borderOnly: true, corner: 12 });
    const routeTop = plannerTop + 8;
    const routeH = 140;
    const intel = currentMapIntel();
    const routeWidth = content.width;
    renderRunRouteBoard(this, { x: content.x, y: routeTop, w: routeWidth, h: routeH }, snapshotRunRoute(run), {
      mode: 'mobile', regionName: regionPending ? undefined : band.name, biomeArtKey: band.artKey,
      seed: run.seed, selectedStops: runRouteSelectedStops(run),
      inputEnabled: !this.statPanelOpen && !this.retireConfirmOpen && !this.mapIntelOpen && !this.shopMenuOpen,
    });
    if (intel.length > 0) {
      const buttonW = 110;
      const buttonH = 24;
      const buttonX = content.x + content.width - buttonW - (this.historyOpen ? 114 : 0);
      const buttonY = content.y + 4;
      const button = this.add.rectangle(buttonX, buttonY, buttonW, buttonH, UI.panelAlt, 0.96).setOrigin(0, 0)
        .setStrokeStyle(1, UI.border, 0.75).setInteractive({ useHandCursor: true });
      const label = this.add.text(buttonX + buttonW / 2, buttonY + buttonH / 2, `MAP INTEL · ${intel.length}`, textRole('micro', { ink: 'accent' })).setOrigin(0.5);
      auditControlLabel(button, label, { name: 'Mobile map intel opener', horizontalPadding: 6, verticalPadding: 6, minFontSize: 9 });
      attachButtonFeel(this, button, {
        fill: UI.panelAlt, hover: UI.chipDark, follow: [label],
        onPress: () => { this.mapIntelOpen = true; this.rerender(); },
      });
    }
    const choicesTop = routeTop + routeH + 6;
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
    const ghostOffer = this.bandReadOpen ? null : extraGhostFightOffer();
    const biomePick = this.bandReadOpen || ghostOffer ? null : pendingBiomePick();
    const pending = currentNode();
    const options = this.destination.choices(pending ? [pending] : choices());
    const boss = pending?.kind === 'boss' ? pending : options.length === 1 && options[0]?.kind === 'boss' ? options[0] : undefined;
    const arrival = boss ? bossArrivalViewModel(getActiveRun()!, boss, pending ? currentEncounter() ?? null : previewEncounter(boss)) : null;
    const plannerTitle = this.bandReadOpen ? 'REGION GUIDE'
      : ghostOffer ? 'EXTRA FIGHT' : biomePick ? 'CHOOSE YOUR REGION' : 'CHOOSE YOUR NEXT STOP';
    const planner = this.add.text(x + 8, top, plannerTitle, textRole('label'));
    auditTextBlock(planner, { name: 'Mobile run map choice planner', maxWidth: w - 132, maxHeight: 18, minFontSize: 9 });
    const status = this.bandReadOpen || ghostOffer ? '' : biomePick ? 'CHOOSE 1 OF 3' : arrival ? '' : pending ? 'STOP IN PROGRESS'
      : options.length === 1 && options[0]?.kind === 'boss' ? 'MANDATORY'
        : options.length === 3 ? 'CHOOSE 1 OF 3' : '';
    const statusText = this.add.text(x + w - 8, top + 2, status, textRole('micro', { ink: 'label' })).setOrigin(1, 0);
    auditTextBlock(statusText, { name: 'Mobile route choice count', maxWidth: 116, maxHeight: 16, minFontSize: 9 });
    if (ghostOffer) {
      renderRunGhostFightOfferPanel(this, { x, y: top + 20, width: w, height: availableH - 20 }, ghostOffer, {
        compact: true,
        onFace: () => { acceptExtraGhostFightOffer(); setBattleContext('run'); this.scene.start('MobileBattle'); },
        onDecline: () => { declineExtraGhostFightOffer(); this.rerender(); },
      });
      return;
    }
    if (biomePick) {
      const contentHeight = Math.max(availableH - 20, biomePick.options.length * 184 + (biomePick.options.length - 1) * 8);
      renderRunMapChoiceViewport(this, { x, y: top + 20, width: w, height: availableH - 20 }, contentHeight, (deferSelection) => {
        renderRunBiomePickPanel(this, { x, y: top + 20, width: w, height: contentHeight }, biomePick, {
          compact: true,
          onChoose: (biomeId) => deferSelection(() => { chooseRunBiome(biomeId); this.choiceScroll = 0; this.rerender(); })(),
        });
      }, { scroll: this.choiceScroll, enabled: !this.statPanelOpen && !this.retireConfirmOpen && !this.mapIntelOpen,
        onScroll: (scroll) => { this.choiceScroll = scroll; },
      });
      return;
    }

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
    const layout = runTravelChoiceCardsLayout(
      { x, y: top + 20, width: w, height: availableH - 20 }, models,
      { compact: true, pending: pending !== undefined },
    );
    renderRunMapChoiceViewport(this, { x, y: top + 20, width: w, height: availableH - 20 }, layout.height, (deferSelection) => {
      options.forEach((node, index) => {
        renderRunTravelChoiceCard(this, layout.cards[index]!, models[index]!, {
          compact: true,
          pending: pending?.id === node.id,
          appearIndex: index,
          deferSelection,
          onSelect: deferSelection(() => {
            const liveNode = currentNode();
            if (liveNode && liveNode.id !== node.id) return;
            if (!liveNode) pickNode(node.id);
            if (node.kind === 'boss') { this.rerender(); return; }
            if (node.kind === 'event') {
              this.destination.open('MobileRunEvent', node.id, options);
              return;
            }
            if (node.kind === 'shop') {
              this.destination.open('MobileShop', node.id, options);
              return;
            }
            this.scene.start('MobileRunPrep');
          }),
        });
      });
    }, { scroll: this.choiceScroll, enabled: !this.statPanelOpen && !this.retireConfirmOpen && !this.mapIntelOpen,
      onScroll: (scroll) => { this.choiceScroll = scroll; },
    });
  }

  private choiceViewModel(node: RunNode): RunTravelChoiceViewModel {
    const run = getActiveRun()!;
    return buildRunTravelChoiceViewModel(run, node, previewRunEvent(node), previewEncounter(node));
  }

  // ---------- defeat / retired end overlay ----------

  /** Panel over the map (2026-09-21), not a full-page takeover — `create()`
   * draws the HUD first, this scrim+panel on top. `'victory'` is legacy (the
   * engine never sets it any more) and is deliberately not handled here. */
  private renderEndOverlay(status: 'defeat' | 'retired'): void {
    const retired = status === 'retired';
    const run = getActiveRun()!;
    this.add.rectangle(0, 0, this.W, this.H, UI.shadow, 0.82).setOrigin(0, 0).setInteractive().setDepth(6000);

    const panelW = Math.min(this.W - 24, 360);
    const px = (this.W - panelW) / 2;
    const py = TEMPLATE.regions.content.y + 12;
    const cx = px + panelW / 2;
    const pad = 20;
    const gridW = panelW - pad * 2;
    const pairs = runStatsPairs(run);
    const gridH = runStatsGridHeight(pairs.length, true);
    const titleY = py + pad;
    const dayY = titleY + 42;
    const factsY = dayY + 24;
    const gridTop = factsY + 28;
    const btnY = gridTop + gridH + 24;
    const btnH = 44;
    const panelH = btnY + btnH + pad - py;

    this.add.rectangle(px, py, panelW, panelH, retired ? 0x1c2430 : 0x352019, 0.98).setOrigin(0, 0)
      .setStrokeStyle(2, retired ? UI.border : UI.bad, 0.9).setInteractive().setDepth(6001);
    // THE ONE FIRST THING on this panel — `display` is spent here and nowhere
    // else in the scene, which is what gives the panel a reading order at all.
    this.add.text(cx, titleY, retired ? 'RUN RETIRED' : 'DEFEAT', textRole('display')).setOrigin(0.5, 0).setDepth(6002);
    this.add.text(cx, dayY, `DAY REACHED ${runCalendar(run).absoluteDay}`, {
      ...textRole('statValue', { ink: 'accent' }), align: 'center',
    }).setOrigin(0.5, 0).setDepth(6002);
    this.add.text(cx, factsY, `GOLD ${run.gold} · HERO LV ${run.heroLevel}`, {
      ...textRole('micro'), align: 'center', wordWrap: { width: gridW },
    }).setOrigin(0.5, 0).setDepth(6002);
    renderRunStatsGrid(this, px + pad, gridTop, gridW, pairs, { compact: true, depth: 6002 });
    const btn = this.add.rectangle(cx, btnY, 180, btnH, 0xb78a46, 1).setOrigin(0.5, 0)
      .setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true }).setDepth(6002);
    const btnLabel = this.add.text(cx, btnY + btnH / 2, 'MAIN MENU ›', textRole('label', { ink: 'onAccent' })).setOrigin(0.5).setDepth(6003);
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
