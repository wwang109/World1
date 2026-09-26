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
import type { RunRouteSnapshot } from './runRouteLayout';
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
  opts: { mode: 'desktop' | 'mobile'; regionName?: string; track?: Phaser.GameObjects.GameObject[] },
): void {
  if (route.columns.length === 0) return;
  const model = expeditionRouteTrackModel(route);
  const inset = opts.mode === 'desktop' ? 12 : 8;
  const compact = opts.mode === 'mobile';
  const header = scene.add.text(bounds.x + inset, bounds.y + 2,
    !opts.regionName ? 'EXPEDITION ROUTE' : compact
      ? `EXPEDITION ROUTE · ${opts.regionName.toUpperCase().replace(/^THE\s+/, '')}`
      : `EXPEDITION ROUTE · CROSSING ${opts.regionName.toUpperCase()}`, {
      ...textRole('kicker'),
      wordWrap: { width: Math.max(80, bounds.w - inset * 2 - (compact ? 62 : 104)) },
    });
  trackObject(opts.track, header);
  auditTextBlock(header, {
    name: `Run route region header (${opts.mode})`,
    maxWidth: Math.max(80, bounds.w - inset * 2 - (compact ? 62 : 104)),
    maxHeight: 18,
    minFontSize: 8,
  });
  const currentDay = scene.add.text(bounds.x + bounds.w - inset, bounds.y + 2, model.currentLabel,
    textRole('kicker', { ink: 'primary' })).setOrigin(1, 0);
  trackObject(opts.track, currentDay);
  auditTextBlock(currentDay, { name: `Run route current day (${opts.mode})`, maxWidth: 116, maxHeight: 18, minFontSize: 8 });

  const mapTop = bounds.y + 22;
  const mapHeight = Math.max(46, bounds.h - 22);
  const mapArt = (scene.textures as Phaser.Textures.TextureManager | undefined)?.exists(RUN_ART_KEYS.runMap)
    ? addRunArt(scene, RUN_ART_KEYS.runMap, { x: bounds.x, y: mapTop, width: bounds.w, height: mapHeight }, 0.52)
    : undefined;
  if (mapArt) trackObject(opts.track, mapArt);
  const mapShade = scene.add.rectangle(bounds.x, mapTop, bounds.w, mapHeight, UI.panelAlt, 0.57).setOrigin(0, 0)
    .setStrokeStyle(1, UI.border, 0.5);
  trackObject(opts.track, mapShade);

  const nodeRadius = compact ? 11 : 13;
  const trackStart = bounds.x + inset + nodeRadius + 2;
  const trackEnd = bounds.x + bounds.w - inset - nodeRadius - 2;
  const step = (trackEnd - trackStart) / 4;
  const centerY = mapTop + (compact ? 20 : 22);
  const rise = compact ? 4 : 6;
  const nodeYs = [centerY + rise, centerY - 1, centerY + rise, centerY, centerY + rise] as const;
  const nodePoints = model.days.map((day) => ({
    x: trackStart + step * (day.day - 1),
    y: nodeYs[day.day - 1]!,
  }));

  for (let dayIndex = 0; dayIndex < nodePoints.length - 1; dayIndex++) {
    const from = nodePoints[dayIndex]!;
    const to = nodePoints[dayIndex + 1]!;
    const color = dayIndex < model.currentDay - 1 ? UI.chip : UI.border;
    const alpha = dayIndex < model.currentDay - 1 ? 0.9 : 0.62;
    const dashCount = compact ? 5 : 7;
    for (let dash = 0; dash < dashCount; dash += 2) {
      const t0 = dash / dashCount;
      const t1 = Math.min(1, (dash + 1) / dashCount);
      const x0 = from.x + (to.x - from.x) * t0;
      const y0 = from.y + (to.y - from.y) * t0;
      const x1 = from.x + (to.x - from.x) * t1;
      const y1 = from.y + (to.y - from.y) * t1;
      const length = Math.hypot(x1 - x0, y1 - y0);
      const segment = scene.add.rectangle((x0 + x1) / 2, (y0 + y1) / 2, length, compact ? 2 : 3, color, alpha)
        .setRotation(Math.atan2(y1 - y0, x1 - x0));
      trackObject(opts.track, segment);
    }
  }

  for (const day of model.days) {
    const x = trackStart + step * (day.day - 1);
    const y = nodeYs[day.day - 1]!;
    const fill = day.state === 'completed' ? UI.chipDark : UI.panelMuted;
    const ringAlpha = day.state === 'upcoming' ? 0.58 : 1;
    const disc = scene.add.circle(x, y, nodeRadius, fill, 0.97)
      .setStrokeStyle(day.state === 'current' ? 3 : 2, day.state === 'upcoming' ? UI.border : UI.chip, ringAlpha);
    trackObject(opts.track, disc);
    if (day.state === 'completed') {
      trackObject(opts.track, scene.add.circle(x, y, nodeRadius - 4, UI.chip, 0.28));
    } else if (day.state === 'current') {
      trackObject(opts.track, scene.add.circle(x, y, nodeRadius + 4, 0, 0).setStrokeStyle(2, UI.chip, 0.95));
    }

    if (day.day === EXPEDITION_DAYS && (scene.textures as Phaser.Textures.TextureManager | undefined)?.exists(RUN_ART_KEYS.icon.bossSkull)) {
      const boss = addRunArt(scene, RUN_ART_KEYS.icon.bossSkull, {
        x: x - nodeRadius + 4,
        y: y - nodeRadius + 4,
        width: (nodeRadius - 4) * 2,
        height: (nodeRadius - 4) * 2,
      }, day.state === 'upcoming' ? 0.62 : 0.95);
      if (boss) trackObject(opts.track, boss);
    } else {
      const waypoint = scene.add.rectangle(x, y, compact ? 6 : 7, compact ? 6 : 7,
        day.state === 'upcoming' ? UI.border : UI.chip, day.state === 'upcoming' ? 0.72 : 0.95)
        .setRotation(Math.PI / 4);
      trackObject(opts.track, waypoint);
    }

    const label = scene.add.text(x, mapTop + mapHeight - 3, day.label,
      textRole('micro', { ink: day.state === 'current' ? 'accent' : day.state === 'completed' ? 'secondary' : 'faint' }))
      .setOrigin(0.5, 1);
    trackObject(opts.track, label);
    auditTextBlock(label, { name: `Run route ${day.label} (${opts.mode})`, maxWidth: Math.max(42, step - 4), maxHeight: 16, minFontSize: 8 });
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
