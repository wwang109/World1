import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI, textRole } from '../theme';
import { auditTextBlock } from './controlLayoutAudit';
import { attachButtonFeel } from './motion';
import { wasPointerConsumedByRebuild } from '../sceneRebuild';
import {
  bandBannerBackdropLayers,
  bandBannerLayout,
  leanColor,
  type BandBannerRowStyle,
  type BandBannerViewModel,
} from './bandBannerViewModel';
import { addRunArt, RUN_ART_KEYS } from './runArt';
import { dayChaptersGeometry, type RunRouteSnapshot } from './runRouteLayout';
import { animateDayChapter, chapterMotionAllowed, chapterMotionTransition, chapterPointAt } from './dayChapterMotion';
import { renderDayChapterViewport } from './dayChapterViewport';
import { BRIGHT_ART_TREATMENT } from './brightArtTreatment';
import type { MapIntelLayoutModel } from './mapIntelLayout';
import type { MapIntelRecord } from '../../run/runState';
import { EXPEDITION_DAYS, expeditionDay } from './travelDay';
import { renderRunHostButton } from './RunDestinationHost';
import { roundRect } from './roundedRect';

export { snapshotRunRoute } from './runRouteLayout';
export type { RunRouteColumnSnapshot, RunRouteSnapshot } from './runRouteLayout';
export { mapIntelLayoutModel } from './mapIntelLayout';
export type { MapIntelLayoutCard, MapIntelLayoutModel, MapIntelRect } from './mapIntelLayout';

function mapIntelTitle(record: MapIntelRecord): string {
  return `BAND ${record.band + 1} · ${record.snapshot.name}`;
}

function mapIntelDetail(record: MapIntelRecord): string {
  const themes = record.snapshot.eventThemes.map((theme) => theme.toUpperCase()).join(' · ');
  return `W${record.snapshot.fromWave}–${record.snapshot.throughWave} · ${record.snapshot.leanLabel}\nEVENTS · ${themes || 'UNKNOWN'}`;
}

/** Desktop's persistent forecast rail. It lives beside—not over—the route;
 * its cards consume only snapshots already stored in the active run. */
export function renderDesktopMapIntelRail(
  scene: Phaser.Scene,
  layout: MapIntelLayoutModel,
): void {
  if (layout.mode !== 'desktop') return;
  const { rail, heading } = layout;
  scene.add.rectangle(rail.x, rail.y, rail.width, rail.height, UI.panelMuted, 0.78).setOrigin(0, 0)
    .setStrokeStyle(1, UI.border, 0.55);
  scene.add.text(heading.x, heading.y, 'MAP INTEL', {
    ...textRole('kicker'),
  });
  if (layout.cards.length === 0) {
    scene.add.text(rail.x + rail.width / 2, rail.y + rail.height / 2, 'NO FORECASTS\nYET', {
      ...textRole('label', { ink: 'faint' }), align: 'center',
    }).setOrigin(0.5);
    return;
  }
  for (const card of layout.cards) {
    const { rect, record } = card;
    scene.add.rectangle(rect.x, rect.y, rect.width, rect.height, UI.panelAlt, 0.9).setOrigin(0, 0)
      .setStrokeStyle(1, UI.border, 0.55);
    const title = scene.add.text(rect.x + 8, rect.y + 7, mapIntelTitle(record), {
      ...textRole('label'),
      wordWrap: { width: Math.max(10, rect.width - 16) },
    });
    const detail = scene.add.text(rect.x + 8, rect.y + Math.min(rect.height - 34, title.height + 11), mapIntelDetail(record), {
      ...textRole('micro'),
      wordWrap: { width: Math.max(10, rect.width - 16) }, lineSpacing: 2,
    });
    auditTextBlock(title, { name: `Desktop map intel band ${record.band}`, maxWidth: rect.width - 16, maxHeight: Math.max(14, rect.height - 30), minFontSize: 8 });
    auditTextBlock(detail, { name: `Desktop map intel detail ${record.band}`, maxWidth: rect.width - 16, maxHeight: Math.max(14, rect.height - title.height - 16), minFontSize: 8 });
  }
}

/** Mobile's deliberately separate MAP INTEL sheet. Its complete-card mask,
 * scroll extent, and close plate all come from `mapIntelLayoutModel`, so the
 * first and last persisted snapshots remain reachable without touching HUD
 * chrome or reforecasting. */
export function renderMobileMapIntelOverlay(
  scene: Phaser.Scene,
  layout: MapIntelLayoutModel,
  onClose: () => void,
): void {
  if (layout.mode !== 'mobile' || !layout.mask || !layout.close) return;
  const { rail, mask, close, heading } = layout;
  scene.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, 0.78).setOrigin(0, 0).setDepth(5500)
    .setInteractive().on('pointerdown', () => onClose());
  const panel = scene.add.rectangle(rail.x, rail.y, rail.width, rail.height, UI.panelAlt, 0.99).setOrigin(0, 0)
    .setStrokeStyle(2, UI.chip, 0.9).setDepth(5501).setInteractive();
  panel.on('pointerdown', () => undefined);
  scene.add.text(heading.x, heading.y, 'MAP INTEL', {
    ...textRole('title'),
  }).setDepth(5502);
  const closeButton = scene.add.rectangle(close.x, close.y, close.width, close.height, UI.panelMuted, 1).setOrigin(0, 0)
    .setStrokeStyle(1, UI.border, 0.75).setDepth(5502).setInteractive({ useHandCursor: true });
  const closeLabel = scene.add.text(close.x + close.width / 2, close.y + close.height / 2, 'CLOSE', {
    ...textRole('kicker', { ink: 'primary' }),
  }).setOrigin(0.5).setDepth(5503);
  attachButtonFeel(scene, closeButton, { fill: UI.panelMuted, hover: UI.chipDark, follow: [closeLabel], sfx: 'uiBack', onPress: onClose });

  if (layout.cards.length === 0) {
    scene.add.text(mask.x + mask.width / 2, mask.y + mask.height / 2, 'NO MAP INTEL YET', {
      ...textRole('label', { ink: 'faint' }),
    }).setOrigin(0.5).setDepth(5502);
    return;
  }

  const cards = scene.add.container(0, 0).setDepth(5502);
  for (const card of layout.cards) {
    const { rect, record } = card;
    const plate = scene.add.rectangle(rect.x, rect.y, rect.width, rect.height, UI.panelMuted, 0.98).setOrigin(0, 0)
      .setStrokeStyle(1, UI.border, 0.6);
    const title = scene.add.text(rect.x + 9, rect.y + 8, mapIntelTitle(record), {
      ...textRole('label'),
      wordWrap: { width: rect.width - 18 },
    });
    const detail = scene.add.text(rect.x + 9, rect.y + 42, mapIntelDetail(record), {
      ...textRole('micro'),
      wordWrap: { width: rect.width - 18 }, lineSpacing: 2,
    });
    cards.add([plate, title, detail]);
  }
  const maskShape = scene.make.graphics({}, false);
  maskShape.fillStyle(0xffffff);
  maskShape.fillRect(mask.x, mask.y, mask.width, mask.height);
  cards.setMask(maskShape.createGeometryMask());

  const trackX = rail.x + rail.width - 7;
  scene.add.rectangle(trackX, mask.y, 3, mask.height, UI.border, 0.32).setOrigin(0.5, 0).setDepth(5503);
  const thumbHeight = layout.maxScroll === 0 ? mask.height : Math.max(28, mask.height * (mask.height / (mask.height + layout.maxScroll)));
  const thumb = scene.add.rectangle(trackX, mask.y, 4, thumbHeight, UI.chip, 0.95).setOrigin(0.5, 0).setDepth(5504);
  let scroll = 0;
  let dragging = false;
  let startY = 0;
  let startScroll = 0;
  const insideMask = (x: number, y: number): boolean => x >= mask.x && x <= mask.x + mask.width && y >= mask.y && y <= mask.y + mask.height;
  const applyScroll = (next: number): void => {
    scroll = Phaser.Math.Clamp(next, 0, layout.maxScroll);
    cards.setY(-scroll);
    const travel = Math.max(0, mask.height - thumbHeight);
    thumb.setY(mask.y + (layout.maxScroll === 0 ? 0 : travel * (scroll / layout.maxScroll)));
  };
  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    // The opener/close control can rebuild this scene synchronously before
    // Phaser redispatches the SAME pointer to this fresh generic listener.
    // Guard before hit-testing so that stale physical click cannot begin a
    // phantom sheet drag; a distinct later pointer still starts normally.
    if (wasPointerConsumedByRebuild(scene, pointer)) return;
    if (!insideMask(pointer.worldX, pointer.worldY)) return;
    dragging = true;
    startY = pointer.worldY;
    startScroll = scroll;
  });
  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (!dragging) return;
    applyScroll(startScroll + startY - pointer.worldY);
  });
  scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    if (wasPointerConsumedByRebuild(scene, pointer)) return;
    dragging = false;
  });
  scene.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
    if (!insideMask(pointer.worldX, pointer.worldY)) return;
    applyScroll(scroll + dy);
  });
}

function trackObject(track: Phaser.GameObjects.GameObject[] | undefined, object: Phaser.GameObjects.GameObject): void {
  track?.push(object);
}

export function renderRunRouteBoard(
  scene: Phaser.Scene,
  bounds: { x: number; y: number; w: number; h: number },
  route: RunRouteSnapshot,
  opts: { mode: 'desktop' | 'mobile'; regionName?: string; biomeArtKey?: string; seed?: number;
    selectedStops?: readonly { nodeId: string; wave: number; artKey: string; iconKey?: string; kind: 'event' | 'shop' | 'fight' | 'boss'; status?: 'pending' | 'completed' }[];
    track?: Phaser.GameObjects.GameObject[]; inputEnabled?: boolean },
): void {
  if (route.columns.length === 0) return;
  const compact = opts.mode === 'mobile';
  const model = expeditionRouteTrackModel(route);
  const currentWave = route.columns.find((column) => column.state === 'current')?.wave
    ?? [...route.columns].reverse().find((column) => column.state === 'cleared')?.wave ?? 1;
  const bandStart = currentWave - expeditionDay(currentWave) + 1;
  const contentWidth = compact ? Math.max(bounds.w, 656) : bounds.w;
  const geometry = dayChaptersGeometry({ ...bounds, w: contentWidth }, compact);
  const gold = 0xeac56b;
  const remember = (object: Phaser.GameObjects.GameObject): void => trackObject(opts.track, object);
  remember(scene.add.rectangle(bounds.x, bounds.y, bounds.w, bounds.h, 0x102c40, 1).setOrigin(0, 0).setStrokeStyle(1.5, gold, 0.8));
  const art = addRunArt(scene, opts.biomeArtKey ?? RUN_ART_KEYS.runMap,
    { x: bounds.x + 1, y: bounds.y + 1, width: bounds.w - 2, height: bounds.h - 2 }, 0.46);
  if (art) remember(art);
  remember(scene.add.rectangle(bounds.x + 1, bounds.y + 32, bounds.w - 2, bounds.h - 33, 0x0d2a3c, 0.78).setOrigin(0, 0));
  remember(scene.add.rectangle(bounds.x + 1, bounds.y + 1, bounds.w - 2, 31, 0x102e42, 0.55).setOrigin(0, 0));
  remember(scene.add.line(0, 0, bounds.x + 1, bounds.y + 32, bounds.x + bounds.w - 1, bounds.y + 32, gold, 0.42).setOrigin(0));
  const header = scene.add.text(bounds.x + 12, bounds.y + 9,
    `EXPEDITION ROUTE${opts.regionName ? ` \u00b7 ${compact ? '' : 'CROSSING '}${opts.regionName.toUpperCase().replace(compact ? /^THE\s+/ : /^$/, '')}` : ''}`,
    { ...textRole('micro'), fontFamily: FONT.display, fontSize: compact ? 11 : 15, color: '#f4dea2', fontStyle: 'bold' });
  remember(header);
  auditTextBlock(header, { name: `Day chapters heading (${opts.mode})`, maxWidth: bounds.w - (compact ? 85 : 114), maxHeight: 20, minFontSize: 9 });
  remember(scene.add.text(bounds.x + bounds.w - 12, bounds.y + 9, model.currentLabel,
    { ...textRole('micro'), fontFamily: FONT.display, fontSize: compact ? 12 : 16, color: '#f4dea2', fontStyle: 'bold' }).setOrigin(1, 0));
  const selections = opts.selectedStops ?? [];
  const currentNodes = selections.filter((stop) => stop.wave >= bandStart && stop.wave < bandStart + 5);
  const selectedIndices = geometry.stops.flatMap((stop, index) => selections.filter((candidate) => candidate.wave === bandStart + stop.day - 1)[stop.index] ? [index] : []);
  const currentIndex = selectedIndices.at(-1) ?? (model.currentDay - 1) * 3;
  const points = geometry.stops.map((stop) => stop.point);
  const bodyExisting = compact ? new Set(scene.children.list) : undefined;
  const pendingPath = scene.add.graphics().lineStyle(compact ? 1 : 1.5, 0x9cb0af, 0.48);
  for (let index = 0; index < points.length - 1; index++) {
    const from = points[index]!, to = points[index + 1]!;
    pendingPath.lineBetween(from.x, from.y, to.x, to.y);
  }
  remember(pendingPath);
  const filledPath = scene.add.graphics();
  const draw = (index: number): void => {
    filledPath.clear();
    const first = points[0]!, last = chapterPointAt(points, index);
    for (const [width, alpha] of [[compact ? 5 : 9, 0.1], [compact ? 2 : 3, 0.95]] as const) {
      filledPath.lineStyle(width, gold, alpha).lineBetween(first.x, first.y, last.x, last.y);
    }
  };
  remember(filledPath);
  model.days.forEach((day, index) => {
    const column = geometry.columns[index]!;
    const current = day.state === 'current';
    if (index > 0) {
      remember(scene.add.line(0, 0, column.x, bounds.y + 48, column.x, bounds.y + bounds.h - 20, gold, 0.35).setOrigin(0));
      remember(scene.add.circle(column.x, points[0]!.y, compact ? 2 : 3, gold, 0.8));
    }
    remember(scene.add.text(column.centerX, bounds.y + (compact ? 44 : 57), day.label,
      { ...textRole('micro'), fontFamily: FONT.display, fontSize: compact ? 14 : 18,
        color: current ? '#ffd57a' : '#f4e8c7', fontStyle: current ? 'bold' : 'normal' }).setOrigin(0.5, 0));
    if (current) remember(scene.add.text(column.centerX, bounds.y + (compact ? 64 : 83), 'IN PROGRESS',
      { ...textRole('micro'), fontSize: compact ? 9 : 10, color: '#f1cd79' }).setOrigin(0.5, 0));
  });
  const iconKeys = { event: RUN_ART_KEYS.icon.routeEvent, shop: RUN_ART_KEYS.icon.routeShop,
    fight: RUN_ART_KEYS.icon.routeBattle, boss: RUN_ART_KEYS.icon.routeBoss };
  geometry.stops.forEach((stop, index) => {
    const actual = selections.filter((candidate) => candidate.wave === bandStart + stop.day - 1)[stop.index];
    const knownKind = actual?.kind ?? (stop.index === 2 ? stop.day === 5 ? 'boss' : 'fight' : undefined);
    const selected = index === currentIndex;
    const { x, y } = stop.point;
    const radius = geometry.radius;
    remember(scene.add.circle(x, y, radius, 0x102b3c, 1).setStrokeStyle(selected ? 2 : compact ? 1 : 1.5,
      actual || selected ? gold : 0x9ba9a8, actual || selected ? 1 : 0.65)
      .setName(actual ? `route-stop-${actual.nodeId}` : `chapter-unknown-${stop.day}-${stop.index}`)
      .setData('kind', actual?.kind).setData('day', stop.day).setData('slot', stop.index + 1));
    if (knownKind) {
      remember(scene.add.image(x, y, actual?.iconKey ?? iconKeys[knownKind]).setDisplaySize(compact ? 20 : 28, compact ? 20 : 28)
        .setAlpha(actual ? 1 : 0.45).setName(`chapter-icon-${stop.day}-${stop.index}`));
    } else remember(scene.add.text(x, y, '?', { ...textRole('micro'), fontSize: compact ? 16 : 20,
      color: actual ? '#f4d089' : '#b9c1ba', fontStyle: 'bold' }).setOrigin(0.5));
  });
  const selectedPoint = points[currentIndex]!;
  const halo = scene.add.circle(selectedPoint.x, selectedPoint.y, geometry.radius + (compact ? 2 : 4), gold, 0.08)
    .setStrokeStyle(compact ? 1.5 : 2, gold, 0.95);
  remember(halo);
  const marker = scene.add.container(0, 0).setName('dayChapterMarker');
  const triangle = scene.add.graphics().fillStyle(gold, 1);
  const markerY = geometry.radius + (compact ? 8 : 11);
  triangle.fillTriangle(0, markerY, compact ? -5 : -8, markerY + (compact ? 6 : 9), compact ? 5 : 8, markerY + (compact ? 6 : 9));
  marker.add(triangle); remember(marker);
  const last = currentNodes.at(-1);
  const stamp = `${bandStart}:${last?.nodeId ?? 'start'}:${model.currentDay}`;
  const transition = chapterMotionTransition(opts.seed ?? 0, stamp, currentIndex, selections.length);
  marker.setData('index', currentIndex).setData('animated', transition.animate && chapterMotionAllowed()).setData('routeStamp', stamp);
  animateDayChapter(scene, { points, from: transition.from, to: currentIndex, animate: transition.animate, marker, halo, draw });
  if (bodyExisting) {
    const body = scene.add.container(0, 0, scene.children.list.filter((child) => !bodyExisting.has(child)));
    renderDayChapterViewport(scene, bounds, body, { seed: opts.seed ?? 0, band: bandStart, stamp, index: currentIndex,
      count: selections.length, contentWidth, markerX: selectedPoint.x, enabled: opts.inputEnabled ?? true });
  }
}

export type ExpeditionRouteDayState = 'completed' | 'current' | 'upcoming';

export interface ExpeditionRouteTrackModel {
  currentDay: number;
  currentLabel: string;
  days: readonly { day: number; label: string; state: ExpeditionRouteDayState }[];
}

/** Display-only regional cadence. Absolute depth/wave remain in run state and
 * the shared HUD; the planner deliberately shows exactly one five-day band. */
export function expeditionRouteTrackModel(route: RunRouteSnapshot): ExpeditionRouteTrackModel {
  const current = route.columns.find((column) => column.state === 'current')
    ?? [...route.columns].reverse().find((column) => column.state === 'cleared')
    ?? route.columns[0];
  const currentDay = expeditionDay(current?.wave ?? 1);
  return {
    currentDay,
    currentLabel: `DAY ${String(currentDay)}/${String(EXPEDITION_DAYS)}`,
    days: Array.from({ length: 5 }, (_, index) => {
      const day = index + 1;
      return {
        day,
        label: `DAY ${String(day)}`,
        state: day < currentDay ? 'completed' : day === currentDay ? 'current' : 'upcoming',
      } satisfies ExpeditionRouteTrackModel['days'][number];
    }),
  };
}

/** The full region read embedded in the planner's destination area. It owns
 * one BACK action and never adds a screen scrim, modal, or run-state write. */
export function renderEmbeddedBandRead(
  scene: Phaser.Scene,
  bounds: { x: number; y: number; w: number; h: number },
  vm: BandBannerViewModel,
  opts: { mode: 'desktop' | 'mobile'; onBack: () => void },
): void {
  const compact = opts.mode === 'mobile';
  const pad = compact ? 12 : 16;
  const topPad = compact ? 10 : 12;
  const panel = scene.add.rectangle(bounds.x, bounds.y, bounds.w, bounds.h, UI.panelAlt, 0.82).setOrigin(0, 0)
    .setStrokeStyle(1, UI.border, 0.55);
  if (compact) roundRect(panel, 12);
  const back = renderRunHostButton(scene, bounds.x + bounds.w - pad, bounds.y + topPad, 'BACK', compact, opts.onBack, true);
  const buttonW = back.width;
  const buttonH = back.height;
  const title = scene.add.text(bounds.x + pad, bounds.y + topPad, vm.name, {
    ...textRole('section'),
    wordWrap: { width: Math.max(80, bounds.w - pad * 3 - buttonW) },
  });
  const bodyY = bounds.y + topPad + buttonH + (compact ? 10 : 12);
  auditTextBlock(title, {
    name: `Embedded region title (${opts.mode})`,
    maxWidth: Math.max(80, bounds.w - pad * 3 - buttonW),
    maxHeight: buttonH,
    minFontSize: 9,
  });
  const innerW = bounds.w - pad * 2;
  const gap = compact ? 6 : 12;
  const cols = compact ? 1 : 2;
  const cellW = (innerW - gap * (cols - 1)) / cols;
  const rows = Math.ceil(vm.guideSections.length / cols);
  const noteH = compact ? 60 : 46;
  const cellH = Math.min(compact ? 80 : 150,
    (bounds.y + bounds.h - pad - noteH - gap - bodyY - gap * (rows - 1)) / rows);
  vm.guideSections.forEach((section, index) => {
    const x = bounds.x + pad + (index % cols) * (cellW + gap);
    const y = bodyY + Math.floor(index / cols) * (cellH + gap);
    const plate = scene.add.rectangle(x, y, cellW, cellH, UI.panelMuted, 0.92).setOrigin(0, 0)
      .setStrokeStyle(1, UI.border, 0.45);
    if (compact) roundRect(plate, 8);
    const heading = scene.add.text(x + 10, y + 8, section.title, textRole('label', { ink: 'accent' }));
    auditTextBlock(heading, { name: `Region guide ${section.title}`, maxWidth: cellW - 20, maxHeight: 20, minFontSize: 10 });
    const textY = y + 10 + heading.height;
    // Accent split mirrors the BIOME EXCLUSIVE tag in RunTravelChoiceCard.ts.
    const accentLineH = section.accent ? 16 : 0;
    const body = scene.add.text(x + 10, textY, section.body, {
      ...textRole('body'), lineSpacing: 2, wordWrap: { width: cellW - 20 },
    });
    auditTextBlock(body, { name: `Region guide ${section.title} content`, maxWidth: cellW - 20,
      maxHeight: Math.max(16, y + cellH - textY - 7 - accentLineH), minFontSize: 10 });
    if (section.accent) {
      const swatchSize = 10;
      const accentY = textY + body.height + 4;
      const swatch = scene.add.rectangle(x + 10, accentY + 2, swatchSize, swatchSize, section.accent.swatchColor, 1).setOrigin(0, 0);
      if (compact) roundRect(swatch, 2);
      const accentTextX = x + 10 + swatchSize + 5;
      const accentText = scene.add.text(accentTextX, accentY, section.accent.text, {
        ...textRole('micro', { ink: 'accent' }), wordWrap: { width: Math.max(1, x + cellW - 10 - accentTextX) },
      });
      auditTextBlock(accentText, { name: `Region guide ${section.title} accent`, maxWidth: Math.max(1, x + cellW - 10 - accentTextX),
        maxHeight: Math.max(12, y + cellH - accentY - 7), minFontSize: 9 });
    }
  });
  const noteY = bodyY + rows * (cellH + gap);
  const note = scene.add.text(bounds.x + pad, noteY, vm.guideNote, {
    ...textRole('micro', { ink: 'secondary' }), lineSpacing: 2, wordWrap: { width: innerW },
  });
  auditTextBlock(note, { name: 'Region guide availability', maxWidth: innerW,
    maxHeight: Math.max(16, bounds.y + bounds.h - pad - noteY), minFontSize: 10 });
}

// ---------------------------------------------------------------------------
// The BAND BANNER — the run map's read of the band it is standing in.
//
// The route board above says WHERE you are; this says WHAT you are in. Both
// live in this module because they are one surface: the trail and the band it
// runs through, drawn from the same lane on both platforms.
//
// Every word here comes from `bandBannerViewModel.ts` (pure, unit-tested), and
// through it from `src/run/biomeForecast.ts` — this function decides pixels and
// nothing else. In particular it NEVER decides what is true about a counter:
// each claim arrives with its subject already inside the sentence and its
// certainty already resolved, and this renderer draws whatever lines it is
// given. A claim with `kind: 'none'` ("NOTHING COUNTERS THESE MOBS") is drawn
// exactly as loudly as a definite one — it is the answer, not a missing value,
// and dropping it (or greying it out as an empty chip) is the bug 3881717
// closed.
// ---------------------------------------------------------------------------

/**
 * Draws the band banner into `rect`. Identical BLOCKS on both platforms (the
 * both-platforms rule is about the information, and a phone must not be told
 * less than a desktop) — only the type ladder differs.
 *
 * NO CURSOR OF ITS OWN. Every y, every height and every colour comes from
 * `bandBannerLayout` (pure, tested), which is also what `bandBannerHeight`
 * sums — so the height a caller reserves and the space this function fills are
 * the same walk of the same list. The mobile run map divides its lane by that
 * number, and when the two disagreed the trail silently lost half its height.
 */
export function renderRunBandBanner(
  scene: Phaser.Scene,
  rect: { x: number; y: number; w: number; h: number },
  vm: BandBannerViewModel,
  opts: { mode: 'desktop' | 'mobile'; track?: Phaser.GameObjects.GameObject[]; onOpenRead?: () => void },
): void {
  const layout = bandBannerLayout(vm, opts.mode);
  const m = layout.metrics;
  const bandColor = leanColor(vm);
  for (const layer of bandBannerBackdropLayers(vm, rect)) {
    if (layer.kind === 'image') {
      const image = addRunArt(scene, layer.textureKey, layer.bounds, layer.alpha);
      if (image) trackObject(opts.track, image);
      continue;
    }
    const scrim = scene.add.rectangle(
      layer.bounds.x,
      layer.bounds.y,
      layer.bounds.width,
      layer.bounds.height,
      layer.color,
      layer.alpha,
    ).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.4);
    trackObject(opts.track, scrim);
  }
  // A hairline in the band's own colour along the top edge: the lean is the
  // first thing the panel says, before a word is read.
  const leanEdge = scene.add.rectangle(rect.x, rect.y, rect.w, 2, bandColor, 0.85).setOrigin(0, 0);
  trackObject(opts.track, leanEdge);

  const innerX = rect.x + m.pad;
  const innerW = rect.w - m.pad * 2;

  const add = (x: number, y: number, text: string, size: number, color: string, style?: { bold?: boolean; display?: boolean }): Phaser.GameObjects.Text => {
    const t = scene.add.text(x, y, text, {
      fontFamily: style?.display ? FONT.display : FONT.body,
      fontStyle: style?.bold ? 'bold' : 'normal',
      fontSize: `${size}px`,
      color,
    });
    trackObject(opts.track, t);
    return t;
  };

  // --- the lean pill ------------------------------------------------------
  // Measured FIRST so the band name gets the width that is actually left over
  // and shrinks into it rather than running under the pill. Measured, then
  // drawn UNDER a rectangle added afterwards would hide it — Phaser draws in
  // insertion order — so the pill's fill goes down first and the label is
  // re-added on top once its width is known.
  const pillPadX = 6;
  const nameTop = rect.y + (layout.rows[0]?.y ?? m.pad);
  const measure = add(0, 0, vm.leanChip, m.lean, '#12202c', { bold: true });
  const pillW = measure.width + pillPadX * 2;
  measure.destroy();
  const pill = scene.add.rectangle(rect.x + rect.w - m.pad - pillW, nameTop, pillW, m.lean + 6, bandColor, 0.95).setOrigin(0, 0);
  trackObject(opts.track, pill);
  add(pill.x + pillPadX, nameTop + 3, vm.leanChip, m.lean, '#12202c', { bold: true });

  /** Per-style drawing rules — the ONLY thing this renderer decides. */
  const STYLE: Record<Exclude<BandBannerRowStyle, 'rule' | 'button'>, { bold: boolean; display: boolean; name: string; heightFactor: number; minFontSize: number; reservePill?: boolean }> = {
    name: { bold: true, display: true, name: 'name', heightFactor: 1.6, minFontSize: 9, reservePill: true },
    wave: { bold: true, display: false, name: 'wave range', heightFactor: 2, minFontSize: 8 },
    heading: { bold: true, display: false, name: 'block heading', heightFactor: 2, minFontSize: 8 },
    bossName: { bold: true, display: true, name: 'boss name', heightFactor: 1.7, minFontSize: 9 },
    bossSub: { bold: false, display: false, name: 'boss rank', heightFactor: 2, minFontSize: 8 },
    bossEntry: { bold: false, display: false, name: 'boss candidate', heightFactor: 2, minFontSize: 8 },
    claim: { bold: true, display: false, name: 'counter claim', heightFactor: 2, minFontSize: 8 },
  };

  for (const row of layout.rows) {
    const y = rect.y + row.y;
    if (row.style === 'rule') {
      const line = scene.add.rectangle(innerX, y, innerW, row.height, UI.border, 0.45).setOrigin(0, 0);
      trackObject(opts.track, line);
      continue;
    }
    if (row.style === 'button') {
      const btn = scene.add.rectangle(innerX, y, innerW, row.height, UI.panelAlt, 0.9).setOrigin(0, 0)
        .setStrokeStyle(1, UI.border, 0.7);
      const btnLabel = add(innerX + innerW / 2, y + row.height / 2, row.text, m.claim, row.color, { bold: true }).setOrigin(0.5);
      trackObject(opts.track, btn);
      auditTextBlock(btnLabel, { name: `Band banner read button (${opts.mode})`, maxWidth: innerW - 8, maxHeight: row.height, minFontSize: 8 });
      if (opts.onOpenRead) {
        const open = opts.onOpenRead;
        btn.setInteractive({ useHandCursor: true });
        attachButtonFeel(scene, btn, { fill: UI.panelAlt, hover: UI.chipDark, follow: [btnLabel], onPress: () => { open(); } });
      }
      continue;
    }
    if (row.bar) {
      const bar = scene.add.rectangle(innerX, y, 3, row.bar.height, row.bar.color, 0.95).setOrigin(0, 0);
      trackObject(opts.track, bar);
    }
    const style = STYLE[row.style];
    const text = add(innerX + row.indent, y, row.text, row.height, row.color, { bold: style.bold, display: style.display })
      .setStroke(BRIGHT_ART_TREATMENT.biome.textStroke, BRIGHT_ART_TREATMENT.biome.textStrokeThickness);
    auditTextBlock(text, {
      name: `Band banner ${style.name} (${opts.mode})`,
      maxWidth: style.reservePill === true
        ? Math.max(row.height * 4, innerW - pillW - 8)
        : innerW - row.indent,
      maxHeight: row.height * style.heightFactor,
      minFontSize: style.minFontSize,
    });
  }
}

/**
 * The FULL read — the forecast card itself, scrim + panel, same modal idiom as
 * `renderRunStatsOverlay`. The body is `vm.card`, composed from the shared
 * `bandForecastRows` model by `bandForecastCardLines`; the complete
 * real/synthetic matrix in `tests/game/bandForecastRows.test.ts` pins its
 * bytes to `renderBandForecast`. This overlay itself does not recompose
 * sentences. The separate map-intel card above still owns its own sentence
 * composer; its unification and the forecast re-layout remain deferred.
 */
export function renderBandReadOverlay(
  scene: Phaser.Scene,
  vm: BandBannerViewModel,
  opts: { compact: boolean; onClose: () => void },
): void {
  const W = SCREEN.width;
  const H = SCREEN.height;
  const body = opts.compact ? 11 : 13;
  const lineSpacing = opts.compact ? 3 : 5;
  const titleSize = opts.compact ? 15 : 19;
  const btnH = opts.compact ? 34 : 38;
  const pad = opts.compact ? 16 : 22;

  scene.add.rectangle(0, 0, W, H, UI.shadow, 0.8).setOrigin(0, 0).setInteractive().setDepth(5500)
    .on('pointerdown', () => { playSfx('uiBack'); opts.onClose(); });

  const pw = Math.min(W - 24, opts.compact ? W - 24 : 460);
  const innerW = pw - pad * 2;
  const text = scene.add.text(0, 0, vm.card.join('\n'), {
    fontFamily: FONT.body,
    fontSize: `${body}px`,
    color: UI.text,
    lineSpacing,
    wordWrap: { width: innerW },
  }).setDepth(5502);
  const ph = pad + titleSize + 10 + text.height + 14 + btnH + pad;
  const px = (W - pw) / 2;
  const py = Math.max(opts.compact ? 12 : 24, (H - ph) / 2);

  scene.add.rectangle(px, py, pw, ph, UI.panelAlt, 0.98).setOrigin(0, 0).setStrokeStyle(2, UI.chip, 1).setInteractive().setDepth(5501);
  const innerX = px + pad;
  let cursor = py + pad;
  scene.add.text(innerX, cursor, 'THE BAND AHEAD', {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${titleSize}px`, color: UI.text,
  }).setDepth(5502);
  cursor += titleSize + 10;
  text.setPosition(innerX, cursor);
  cursor += text.height + 14;

  const closeBtn = scene.add.rectangle(innerX, cursor, innerW, btnH, UI.panelMuted, 1).setOrigin(0, 0)
    .setStrokeStyle(1, UI.border, 0.8).setInteractive({ useHandCursor: true }).setDepth(5502);
  const closeLabel = scene.add.text(innerX + innerW / 2, cursor + btnH / 2, 'CLOSE', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${body + 1}px`, color: UI.text,
  }).setOrigin(0.5).setDepth(5502);
  attachButtonFeel(scene, closeBtn, { fill: UI.panelMuted, hover: UI.chipDark, follow: [closeLabel], sfx: 'uiBack', onPress: opts.onClose });
}
