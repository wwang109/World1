import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { setBattleContext } from '../battleContext';
import { RunDestinationHost } from '../ui/RunDestinationHost';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, textRole, UI } from '../theme';
import { rebuildScene } from '../sceneRebuild';
import { renderRunTravelChoiceCard, runTravelChoiceCardsLayout } from '../ui/RunTravelChoiceCard';
import { bossArrivalViewModel } from '../ui/RunBossArrivalPanel';
import { buildRunTravelChoiceViewModel, type RunTravelChoiceViewModel } from '../ui/runTravelChoiceViewModel';
import { runBossCountdownModel } from '../ui/statRunModel';
import { runCalendar } from '../../run/runCalendar';
import { biomeFor } from '../../run/biome';
import { auditControlLabel, auditTextBlock } from '../ui/controlLayoutAudit';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { mapIntelLayoutModel, renderDesktopMapIntelRail, renderEmbeddedBandRead, renderRunRouteBoard, snapshotRunRoute } from '../ui/RunRouteBoard';
import { renderPaintedChrome } from '../ui/paintedChrome';
import { renderRegionHeading } from '../ui/regionHeading';
import { bandBannerForWave, type BandBannerViewModel } from '../ui/bandBannerViewModel';
import { runScreenLayoutRef } from '../ui/runScreenLayout';
import { addBrightRunArt, addRunArt, desktopBiomeArtKey, RUN_ART_KEYS } from '../ui/runArt';
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
import { desktopRunMapPanelColumns } from '../ui/desktopRunMapPanelLayout';
import { renderRunBiomePickPanel } from '../ui/RunBiomePickPanel';
import { renderRunMapChoiceViewport } from '../ui/runMapChoiceViewport';
import { renderRunGhostFightOfferPanel } from '../ui/RunGhostFightOfferPanel';
import { renderRunHistoryPanel } from '../ui/RunHistoryPanel';
import { renderRunLogToggle } from '../ui/RunLogToggle';
import { runRouteSelectedStops } from '../ui/runHistoryViewModel';

const F = DESKTOP_PROFILE.font;
// LIVE reference: every `TEMPLATE.*` read below resolves against the
// CURRENT viewport (the canvas fills the window -- see game/viewport.ts).
const TEMPLATE = runScreenLayoutRef('desktop');
/** The HUD's stat strip before a run exists (the "START A NEW RUN" state) —
 * all zeroes, no banked-PL/RETIRE actions to show. */
const EMPTY_HUD_SNAPSHOT = { day: 0, wave: 1, gold: 0, heroLevel: 1, lives: 0, bossesCleared: 0, wins: 0, losses: 0 };

/**
 * Desktop Run Map — current region and earned intel beside a wide expedition
 * planner, with route/day progress above its destination cards.
 * A pure playback/selection surface over `src/game/runStore` — no combat or
 * map-generation logic lives here. Reachable at ?scene=desktop-runmap.
 */
export class DesktopRunMapScene extends Phaser.Scene {
  private readonly destination = new RunDestinationHost(this, () => this.rerender());
  private hudObjects: Phaser.GameObjects.GameObject[] = [];
  private statPanelOpen = false;
  private retireConfirmOpen = false;
  private historyScroll = 0;
  private historyOpen = false;
  private bandReadOpen = false;
  private choiceScroll = 0;
  /** Desktop-only width toggle. Shops open with the region art collapsed so
   * the embedded workspace can use the room; the player can expand it. */
  private regionPaneCollapsed = false;
  /** The band model this render drew, kept so the embedded panel shows the
   * SAME read as the region pane (one forecast per render, never a second roll). */
  private band: BandBannerViewModel | null = null;

  constructor() { super('DesktopRunMap'); }

  init(): void {
    this.destination.reset();
    this.statPanelOpen = false;
    this.retireConfirmOpen = false;
    this.historyScroll = 0;
    this.historyOpen = false;
    this.bandReadOpen = false;
    this.regionPaneCollapsed = false;
    this.band = null;
  }

  private rerender(): void { rebuildScene(this); }

  private openLedger(): void {
    const run = getActiveRun();
    if (!run) return;
    openRunModal(this, { id: 'run-ledger', title: 'RUN LEDGER', compact: false, width: 620, height: 350,
      onClose: () => {}, render: (scene, layout) => {
        renderRunStatsGrid(scene, layout.body.x, layout.body.y, layout.body.width, runStatsPairs(run), { compact: false });
      },
    });
  }

  /** A width-changing rebuild must wait until the current pointerdown has
   * finished. Otherwise the newly widened child shop can receive that same
   * click at a card position that did not exist when the player pressed. */
  private setRegionPaneCollapsed(collapsed: boolean): void {
    // The embedded scene sits under this scene and Phaser does not clip input
    // to the destination camera. Disable it for the complete pointer gesture so
    // the region toggle cannot also activate a shop card after the resize.
    this.destination.hide();
    this.regionPaneCollapsed = collapsed;
    let applied = false;
    const finish = (): void => {
      if (applied) return;
      applied = true;
      this.rerender();
    };
    const apply = (): void => { this.time.delayedCall(0, finish); };
    this.input.once('pointerup', apply);
    this.input.once('pointerupoutside', apply);
  }

  create(): void {
    this.data.set('refreshRunHud', () => {
      for (const object of this.hudObjects) if (object.scene) object.destroy();
      this.renderHud(getActiveRun() ?? undefined);
    });
    this.destination.hide();
    this.cameras.main.setBackgroundColor(UI.bg);
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.bg).setOrigin(0, 0);
    // Two broad ambient masses keep the page luminous without adding texture;
    // the detailed map painting stays subordinate to the route itself.
    this.add.ellipse(SCREEN.width * 0.16, SCREEN.height * 0.2, SCREEN.width * 0.82, SCREEN.height * 0.74, UI.bgBlobA, BRIGHT_ART_TREATMENT.map.ambienceAlpha);
    this.add.ellipse(SCREEN.width * 0.88, SCREEN.height * 0.82, SCREEN.width * 0.66, SCREEN.height * 0.64, UI.bgBlobB, BRIGHT_ART_TREATMENT.map.ambienceAlpha * 0.72);
    addBrightRunArt(this, RUN_ART_KEYS.runMap, { x: 0, y: 0, width: SCREEN.width, height: SCREEN.height }, BRIGHT_ART_TREATMENT.map);

    const run = getActiveRun();
    if (!run) {
      // ONE front door: no duplicate start panel here — the Start scene owns
      // starting runs (seed + reroll live there now).
      this.scene.start('Start');
      return;
    }
    addBiomeAmbience(this, runAmbienceBiomeId(run), { x: 0, y: 0, width: SCREEN.width, height: SCREEN.height });
    // Freshly-started run (or a stale re-entry mid-draft) — the run-context
    // draft owns installing the starting deck before any node is pickable.
    if (run.status === 'drafting') {
      this.scene.start('DesktopDraft');
      return;
    }
    // Resume-safety: a save loaded mid-`challengeFight` restarts that battle.
    if (activeChallengeFight()) {
      setBattleContext('run');
      this.scene.start('DesktopBattle');
      return;
    }
    if (run.status === 'defeat' || run.status === 'retired') {
      // Overlay panel over the map, not a full-page takeover (2026-09-21).
      this.renderHud(run, false);
      this.renderEndOverlay(run.status);
      return;
    }

    this.renderHud(run);
    // Every overlay below (stat panel / retire confirm) is a centered, opaque-
    // panel modal over a full-screen scrim — its dialog rect sits ON TOP OF
    // (and, for retire confirm, fully inside) the trail's "STOP IN PROGRESS"/
    // choice-column region. Drawing the trail underneath it anyway leaves dead
    // Text objects at the exact same screen coordinates as the dialog's own
    // copy — invisible to the player (the opaque panel is a higher Phaser
    // depth), but still real GameObjects the HUD audit's text-bounds overlap
    // check (rightly) flags, since it has no notion of one object being drawn
    // UNDER another. Skipping the trail while a modal owns the screen is the
    // default for page-replacing modals. The stat drawer is the deliberate
    // exception: its interactive scrim keeps the retained route inert.
    const modalOpen = this.statPanelOpen || this.retireConfirmOpen;
    if (!modalOpen) this.renderTrail(run);
    else if (this.statPanelOpen) this.renderTrail(run);
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
        onConfirm: () => { playSfx('runLose'); retireActiveRun(); this.rerender(); },
      });
    }
    // Embedded destinations are separate Phaser scenes and normally sit above
    // the route owner. A HUD modal belongs to this parent, so restore the
    // parent to the top after drawing it; otherwise the shop obscures level-up
    // and ledger panels even though their scrim was created correctly.
    if (modalOpen) this.scene.bringToTop();
  }

  /** THE run HUD — identical header on every run screen (`runScreenTemplate`).
   * `run` undefined only on the pre-start "START A NEW RUN" state (no stats
   * to show yet, so the strip reads all zeroes and the actions row is bare). */
  private renderHud(run: NonNullable<ReturnType<typeof getActiveRun>> | undefined, actionsEnabled = true): void {
    const before = new Set(this.children.list);
    renderRunHud(this, {
      screen: 'RUN',
      compact: false,
      snapshot: run ? snapshotRunProgress(run) : EMPTY_HUD_SNAPSHOT,
      onOpenStatPanel: run && actionsEnabled ? () => { this.statPanelOpen = true; this.rerender(); } : undefined,
      actions: run && actionsEnabled ? {
        back: { label: 'BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('DesktopDeck'); } },
        secondary: { label: 'RUN LEDGER', onPress: () => this.openLedger() },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
      } : undefined,
    });
    this.hudObjects = this.children.list.filter(object => !before.has(object));
  }

  // ---------- the trail ----------

  private renderTrail(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    const content = TEMPLATE.regions.content;
    const slot = TEMPLATE.contentSlots.choices;
    const columns = desktopRunMapPanelColumns(
      { x: content.x, width: content.width }, slot.x, this.regionPaneCollapsed,
    );
    const band = this.desktopBand(bandBannerForWave(run, snapshotRunProgress(run).wave));
    this.band = band;
    const regionPending = pendingBiomePick() !== null;

    const bottom = content.y + content.height;
    const records = currentMapIntel();
    const intel = mapIntelLayoutModel(records, { width: SCREEN.width, height: SCREEN.height });
    const regionH = records.length > 0 ? intel.rail.y - slot.y - 16 : bottom - slot.y;
    if (this.historyOpen) {
      renderRunHistoryPanel(this, { x: columns.region.x, y: slot.y, width: columns.region.width, height: regionH }, run, {
        compact: false, scroll: this.historyScroll, enabled: !this.statPanelOpen && !this.retireConfirmOpen,
        onScroll: (scroll) => { this.historyScroll = scroll; },
      });
      renderRunLogToggle(this, columns.region.x + columns.region.width - 108, slot.y + 4, 100, 24, 'COLLAPSE',
        !this.statPanelOpen && !this.retireConfirmOpen, () => { this.historyOpen = false; this.rerender(); });
    } else {
      this.renderRegionPane(columns.region.x, slot.y, columns.region.width, regionH, band,
        snapshotRunProgress(run).wave, records.length, regionPending);
    }
    // Earned snapshots retain their existing rail geometry below the pane.
    if (records.length > 0) {
      const dx = content.x - intel.rail.x;
      const dw = columns.region.width - intel.rail.width;
      const relocate = (rect: typeof intel.rail) => ({ ...rect, x: rect.x + dx, width: rect.width + dw });
      renderDesktopMapIntelRail(this, {
        ...intel, rail: relocate(intel.rail), heading: relocate(intel.heading),
        cards: intel.cards.map((card) => ({ ...card, rect: relocate(card.rect) })),
      });
    }

    this.add.rectangle(columns.planner.x, slot.y, columns.planner.width, bottom - slot.y, UI.panel, 0.94).setOrigin(0, 0)
      .setStrokeStyle(1, UI.border, 0.75);
    renderPaintedChrome(this, columns.planner.x, slot.y, columns.planner.width, bottom - slot.y, { borderOnly: true });
    const routeTop = slot.y + 12;
    const routeH = 180;
    renderRunRouteBoard(this, { x: columns.planner.x + 16, y: routeTop, w: columns.planner.width - 32, h: routeH }, snapshotRunRoute(run), {
      mode: 'desktop', regionName: regionPending ? undefined : band.name, biomeArtKey: band.artKey,
      seed: run.seed, selectedStops: runRouteSelectedStops(run),
    });
    const choicesTop = routeTop + routeH + 12;
    this.renderChoiceColumn(columns.planner.x + 16, choicesTop, columns.planner.width - 32, bottom - 16 - choicesTop);
  }

  /** The approved region pane leads with the real biome painting. The lower
   * summary is deliberately short; EXPLORE REGION still owns the full read. */
  private renderRegionPane(x: number, y: number, w: number, h: number, band: BandBannerViewModel, wave: number, intelCount: number, pending: boolean): void {
    const artKey = pending ? RUN_ART_KEYS.runMap : band.artKey;
    const name = pending ? 'Choose Your Region' : band.name;
    if (this.regionPaneCollapsed) {
      this.add.rectangle(x, y, w, h, UI.panel, 0.98).setOrigin(0, 0).setStrokeStyle(1, UI.chip, 0.7);
      addRunArt(this, artKey, { x: x + 1, y: y + 1, width: w - 2, height: h - 2 });
      this.add.rectangle(x + 1, y + h - 132, w - 2, 131, UI.panelMuted, 0.94).setOrigin(0, 0);
      renderPaintedChrome(this, x, y, w, h, { borderOnly: true, corner: 16 });
      this.renderRegionPaneToggle(x, y, w, true);
      renderRegionHeading(this, x + 12, y + h - 116, name, w - 24, { compact: false, collapsed: true });
      const countdown = runBossCountdownModel(wave);
      this.add.text(x + 12, y + h - 48, countdown.headline, textRole('micro', {
        ink: countdown.bossNow ? 'alarm' : 'resource',
      }));
      return;
    }
    const footerH = 64;
    const artH = h - footerH;
    const footerY = y + artH;
    this.add.rectangle(x, y, w, h, UI.panel, 0.98).setOrigin(0, 0).setStrokeStyle(1, UI.chip, 0.7);
    addRunArt(this, artKey, { x: x + 1, y: y + 1, width: w - 2, height: artH - 1 });
    const scrimH = Math.min(260, artH - 1);
    const scrim = this.add.graphics();
    scrim.fillGradientStyle(UI.panelMuted, UI.panelMuted, UI.panelMuted, UI.panelMuted, 0, 0, 0.96, 0.96);
    scrim.fillRect(x + 1, footerY - scrimH, w - 2, scrimH);

    const copyX = x + 18;
    const copyW = w - 36;
    const copyY = footerY - 180;
    const outline = (text: Phaser.GameObjects.Text): Phaser.GameObjects.Text => text
      .setStroke(BRIGHT_ART_TREATMENT.biome.textStroke, BRIGHT_ART_TREATMENT.biome.textStrokeThickness);
    const nameText = renderRegionHeading(this, copyX, copyY, name, copyW, { compact: false });
    const factsLine = pending ? band.waveRange : `${band.leanChip} · ${band.waveRange}`;
    const factsY = nameText.y + nameText.height + 20;
    const facts = outline(this.add.text(copyX, factsY, factsLine, textRole('kicker')));
    auditTextBlock(facts, { name: 'Desktop region lean and days', maxWidth: copyW, maxHeight: 22, minFontSize: 9 });
    if (!pending) {
      const destination = outline(this.add.text(copyX, factsY + facts.height + 12, `DESTINATION · ${band.boss.headline}`, {
        ...textRole('label', { ink: 'secondary' }), wordWrap: { width: copyW },
      }));
      auditTextBlock(destination, { name: 'Desktop region destination', maxWidth: copyW, maxHeight: 42, minFontSize: 9 });
    }
    const countdown = runBossCountdownModel(wave);
    const countdownText = outline(this.add.text(copyX, copyY + 144, countdown.headline,
      textRole('kicker', { ink: countdown.bossNow ? 'alarm' : 'resource' })));
    auditTextBlock(countdownText, { name: 'Desktop region boss countdown', maxWidth: copyW, maxHeight: 22, minFontSize: 9 });

    this.add.rectangle(x + 1, footerY, w - 2, footerH - 1, UI.panelMuted, 0.98).setOrigin(0, 0);
    const buttonW = Math.min(220, w * 0.52);
    const button = this.add.rectangle(x + 16, footerY + 12, buttonW, 40, UI.panelAlt, 0.98).setOrigin(0, 0)
      .setStrokeStyle(1, UI.chip, 0.75);
    const label = this.add.text(x + 16 + buttonW / 2, footerY + 32, 'RUN LOG', textRole('label', { ink: 'accent' })).setOrigin(0.5);
    auditControlLabel(button, label, { name: 'Desktop run log opener', horizontalPadding: 8, verticalPadding: 6, minFontSize: 9 });
    if (!this.statPanelOpen && !this.retireConfirmOpen) button.setInteractive({ useHandCursor: true });
    attachButtonFeel(this, button, {
      fill: UI.panelAlt, hover: UI.chipDark, follow: [label],
      onPress: () => { this.historyOpen = true; this.rerender(); },
    });
    if (intelCount > 0) {
      const status = this.add.text(x + w - 16, footerY + 32, `MAP INTEL · ${intelCount}`,
        textRole('micro', { ink: 'secondary' })).setOrigin(1, 0.5);
      auditTextBlock(status, { name: 'Desktop region discovery status', maxWidth: w - buttonW - 44, maxHeight: 24, minFontSize: 9 });
    }
    renderPaintedChrome(this, x, y, w, h, { borderOnly: true });
    this.renderRegionPaneToggle(x, y, w, false);
  }

  private renderRegionPaneToggle(x: number, y: number, width: number, collapsed: boolean): void {
    const button = this.add.rectangle(x + width - 68, y + 24, 44, 44, UI.chip).setOrigin(0)
      .setName(collapsed ? 'Expand region panel' : 'Collapse region panel')
      .setData('regionPaneToggle', collapsed ? 'expand' : 'collapse').setInteractive({ useHandCursor: true });
    const arrow = this.add.graphics({ x: button.x, y: button.y }).setName('region-pane-toggle-arrow');
    const outer = collapsed ? 19 : 25, tip = collapsed ? 27 : 17;
    arrow.lineStyle(3, 0x142d3b, 1).lineBetween(outer, 14, tip, 22).lineBetween(tip, 22, outer, 30);
    attachButtonFeel(this, button, { fill: UI.chip, hover: UI.border, follow: [arrow], lift: 0,
      onPress: () => this.setRegionPaneCollapsed(!collapsed) });
  }

  private renderChoiceColumn(x: number, top: number, w: number, availableH: number): void {
    const ghostOffer = this.bandReadOpen ? null : extraGhostFightOffer();
    const biomePick = this.bandReadOpen || ghostOffer ? null : pendingBiomePick();
    const pending = currentNode();
    const options = this.destination.choices(pending ? [pending] : choices());
    const boss = pending?.kind === 'boss' ? pending : options.length === 1 && options[0]?.kind === 'boss' ? options[0] : undefined;
    const arrival = boss ? bossArrivalViewModel(getActiveRun()!, boss, pending ? currentEncounter() ?? null : previewEncounter(boss)) : null;
    const plannerTitle = this.bandReadOpen ? 'REGION GUIDE'
      : ghostOffer ? 'EXTRA FIGHT' : biomePick ? 'CHOOSE YOUR REGION' : 'CHOOSE YOUR NEXT STOP';
    const planner = this.add.text(x, top, plannerTitle, textRole('section'));
    auditTextBlock(planner, { name: 'Desktop run map choice planner', maxWidth: w - 160, maxHeight: 30, minFontSize: 9 });
    const status = this.bandReadOpen || ghostOffer ? '' : biomePick ? 'CHOOSE 1 OF 3' : arrival ? '' : pending ? 'STOP IN PROGRESS'
      : options.length === 1 && options[0]?.kind === 'boss' ? 'MANDATORY'
        : options.length === 3 ? 'CHOOSE 1 OF 3' : '';
    const statusText = this.add.text(x + w, top + 4, status, textRole('micro', { ink: 'label' })).setOrigin(1, 0);
    auditTextBlock(statusText, { name: 'Desktop route choice count', maxWidth: 148, maxHeight: 20, minFontSize: 9 });
    if (ghostOffer) {
      renderRunGhostFightOfferPanel(this, { x, y: top + 38, width: w, height: availableH - 38 }, ghostOffer, {
        compact: false,
        onFace: () => { acceptExtraGhostFightOffer(); setBattleContext('run'); this.scene.start('DesktopBattle'); },
        onDecline: () => { declineExtraGhostFightOffer(); this.rerender(); },
      });
      return;
    }
    if (biomePick) {
      renderRunBiomePickPanel(this, { x, y: top + 38, width: w, height: availableH - 38 }, biomePick, {
        compact: false,
        onChoose: (biomeId) => { chooseRunBiome(biomeId); this.choiceScroll = 0; this.rerender(); },
      });
      return;
    }

    if (this.bandReadOpen && this.band) {
      renderEmbeddedBandRead(this, { x, y: top + 38, w, h: availableH - 38 }, this.band, {
        mode: 'desktop', onBack: () => { this.bandReadOpen = false; this.rerender(); },
      });
      return;
    }
    if (this.destination.render({ x, y: top + 38, width: w, height: availableH - 38 })) return;
    if (boss && arrival) {
      this.destination.renderBoss({ x, y: top + 38, width: w, height: availableH - 38 }, arrival, false, () => {
        if (!currentNode()) pickNode(boss.id);
        this.scene.start('DesktopRunPrep');
      });
      return;
    }
    const models = options.map((node) => ({ ...this.choiceViewModel(node), enabled: !pending || node.id === pending.id }));
    const layout = runTravelChoiceCardsLayout(
      { x, y: top + 38, width: w, height: availableH - 38 }, models,
      { compact: false, pending: pending !== undefined },
    );
    renderRunMapChoiceViewport(this, { x, y: top + 38, width: w, height: availableH - 38 }, layout.height, (deferSelection) => {
      options.forEach((node, index) => {
        renderRunTravelChoiceCard(this, layout.cards[index]!, models[index]!, {
          compact: false,
          pending: pending?.id === node.id,
          appearIndex: index,
          deferSelection,
          onSelect: deferSelection(() => {
            this.choiceScroll = 0;
            const liveNode = currentNode();
            if (liveNode && liveNode.id !== node.id) return;
            if (!liveNode) pickNode(node.id);
            if (node.kind === 'boss') { this.rerender(); return; }
            if (node.kind === 'event' || node.kind === 'shop') {
              if (node.kind === 'shop') this.regionPaneCollapsed = true;
              this.destination.open(node.kind === 'event' ? 'DesktopRunEvent' : 'DesktopShop', node.id, options);
              return;
            }
            this.scene.start('DesktopRunPrep');
          }),
        });
      });
    }, { scroll: this.choiceScroll, enabled: !this.statPanelOpen && !this.retireConfirmOpen && !this.historyOpen,
      onScroll: scroll => { this.choiceScroll = scroll; } });
  }

  private choiceViewModel(node: RunNode): RunTravelChoiceViewModel {
    const run = getActiveRun()!;
    const model = buildRunTravelChoiceViewModel(run, node, previewRunEvent(node), previewEncounter(node));
    if (node.kind !== 'fight' || model.artKey === undefined) return model;
    const biome = biomeFor(run.map.seed, node.wave, node.biomeId);
    return { ...model, artKey: desktopBiomeArtKey(biome.id) };
  }

  private desktopBand(band: BandBannerViewModel): BandBannerViewModel {
    return { ...band, artKey: desktopBiomeArtKey(band.biomeId) };
  }

  // ---------- defeat / retired end overlay ----------

  /** Panel over the map (2026-09-21), not a full-page takeover — `create()`
   * draws the HUD first, this scrim+panel on top. `'victory'` is legacy (the
   * engine never sets it any more, see `RunStatus`) and is deliberately not
   * handled here. */
  private renderEndOverlay(status: 'defeat' | 'retired'): void {
    const retired = status === 'retired';
    const run = getActiveRun()!;
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, 0.82).setOrigin(0, 0).setInteractive().setDepth(6000);

    const panelW = Math.min(760, SCREEN.width - 160);
    const px = (SCREEN.width - panelW) / 2;
    const py = TEMPLATE.regions.content.y + 20;
    const cx = px + panelW / 2;
    const pad = 32;
    const gridW = Math.min(700, panelW - pad * 2);
    const pairs = runStatsPairs(run);
    const gridH = runStatsGridHeight(pairs.length, false);
    const titleY = py + pad;
    const dayY = titleY + 72;
    const factsY = dayY + 28;
    const gridTop = factsY + 34;
    const btnY = gridTop + gridH + 40;
    const btnH = 48;
    const panelH = btnY + btnH + pad - py;

    this.add.rectangle(px, py, panelW, panelH, retired ? UI.panelMuted : UI.badSoft, 0.98).setOrigin(0, 0)
      .setStrokeStyle(2, retired ? UI.border : UI.bad, 0.9).setInteractive().setDepth(6001);
    // THE ONE FIRST THING on this panel — `display` is spent here and nowhere
    // else in the scene, and its 56px is the ladder rung that replaced this
    // line's old `F.big * 1.6` expression (see layoutProfile.ts#font.display).
    this.add.text(cx, titleY, retired ? 'RUN RETIRED' : 'DEFEAT', textRole('display')).setOrigin(0.5, 0).setDepth(6002);
    this.add.text(cx, dayY, `DAY REACHED ${runCalendar(run).absoluteDay}`, textRole('statValue', { ink: 'accent' })).setOrigin(0.5, 0).setDepth(6002);
    this.add.text(cx, factsY, `GOLD ${run.gold}   ·   HERO LV ${run.heroLevel}`, {
      fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim,
    }).setOrigin(0.5, 0).setDepth(6002);
    renderRunStatsGrid(this, cx - gridW / 2, gridTop, gridW, pairs, { compact: false, depth: 6002 });
    const btn = this.add.rectangle(cx, btnY, 220, btnH, UI.chip, 1).setOrigin(0.5, 0)
      .setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true }).setDepth(6002);
    const btnLabel = this.add.text(cx, btnY + btnH / 2, 'MAIN MENU ›', { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.textOnChip }).setOrigin(0.5).setDepth(6003);
    // Every run ends back at the ONE front door (Start scene), never a
    // map-local start panel — flow consistency per user direction 2026-08-04.
    // Shared feel (ui/motion) — this button had neither hover nor press
    // feedback. Wired on BOTH platforms in the same change (both-platforms rule).
    attachButtonFeel(this, btn, {
      fill: UI.chip,
      hover: UI.chipDark,
      follow: [btnLabel],
      onPress: () => { clearRun(); this.scene.start('Start'); },
    });
  }
}
