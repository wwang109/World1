import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { auditTextBlock } from './controlLayoutAudit';
import { attachButtonFeel } from './motion';
import {
  bandBannerLayout,
  leanColor,
  type BandBannerRowStyle,
  type BandBannerViewModel,
} from './bandBannerViewModel';
import { MARKER_CELLS, MIN_CELL_PX, moreLabel, runRouteLayout, type RunRouteSnapshot } from './runRouteLayout';

export { snapshotRunRoute } from './runRouteLayout';
export type { RunRouteColumnSnapshot, RunRouteSnapshot } from './runRouteLayout';

function trackObject(track: Phaser.GameObjects.GameObject[] | undefined, object: Phaser.GameObjects.GameObject): void {
  track?.push(object);
}

export function renderRunRouteBoard(
  scene: Phaser.Scene,
  bounds: { x: number; y: number; w: number; h: number },
  route: RunRouteSnapshot,
  opts: { mode: 'desktop' | 'mobile'; track?: Phaser.GameObjects.GameObject[] },
): void {
  const profile = opts.mode === 'desktop' ? DESKTOP_PROFILE : MOBILE_PROFILE;
  if (route.columns.length === 0) return;

  const horizontal = opts.mode === 'desktop';
  const primaryStart = horizontal ? bounds.x : bounds.y;
  const primarySize = horizontal ? bounds.w : bounds.h;
  const crossStart = horizontal ? bounds.y : bounds.x;
  const crossSize = horizontal ? bounds.h : bounds.w;
  const inset = profile.gap;
  const usablePrimary = Math.max(0, primarySize - inset * 2);
  // WHICH depths get drawn, and how big each cell is, is decided in the pure
  // `runRouteLayout` — including the case this board could not survive before,
  // a route too long for its lane (see that module's header). Unwindowed, the
  // slot list IS the column list and `cellSize` is the number this function
  // used to compute itself.
  const layout = runRouteLayout(route.columns, usablePrimary, MIN_CELL_PX[opts.mode], MARKER_CELLS[opts.mode]);
  const { slots, cellSize } = layout;
  /** Centre of a slot along the primary axis — a depth spans one cell, a
   * `'more'` marker spans several because its label is a sentence. */
  const centerPrimary = (slot: { cell: number; span: number }): number => primaryStart + inset + cellSize * (slot.cell + slot.span / 2);
  const routeCross = crossStart + Math.max(profile.font.label + profile.gap * 2, crossSize * 0.58);
  const place = (primary: number, cross: number): { x: number; y: number } => horizontal
    ? { x: primary, y: cross }
    : { x: cross, y: primary };

  // --- wave bands ----------------------------------------------------------
  // One band per run of consecutive VISIBLE depths sharing a wave. A windowed
  // trail can open or close mid-wave, so the band is a run of slots rather than
  // a run of depths: a half-shown wave gets a half-height band under the same
  // label, which is the honest drawing of "you are part-way through wave 7".
  const drawBand = (fromCell: number, cells: number, wave: number): void => {
    const bandStart = primaryStart + inset + cellSize * fromCell;
    const bandSize = cellSize * cells;
    const band = horizontal
      ? scene.add.rectangle(bandStart, bounds.y, bandSize, bounds.h, wave % 2 === 0 ? UI.panelMuted : UI.panelAlt, 0.2).setOrigin(0, 0)
      : scene.add.rectangle(bounds.x, bandStart, bounds.w, bandSize, wave % 2 === 0 ? UI.panelMuted : UI.panelAlt, 0.2).setOrigin(0, 0);
    const waveLabelPos = place(bandStart + bandSize / 2, crossStart + profile.gap);
    const waveLabel = scene.add.text(waveLabelPos.x, waveLabelPos.y, horizontal ? `WAVE ${wave}` : `— WAVE ${wave} —`, {
      fontFamily: FONT.body,
      fontStyle: 'bold',
      fontSize: `${profile.font.tiny}px`,
      color: UI.textSoft,
    }).setOrigin(horizontal ? 0.5 : 0, 0);
    trackObject(opts.track, band);
    trackObject(opts.track, waveLabel);
    auditTextBlock(waveLabel, {
      name: `Run route wave ${wave}`,
      maxWidth: horizontal ? Math.max(profile.font.tiny * 5, bandSize - profile.gap * 2) : Math.max(profile.font.tiny * 6, crossSize - profile.gap * 2),
      maxHeight: profile.font.tiny * 2,
      minFontSize: 8,
    });
  };

  let bandFrom = -1;
  let bandCells = 0;
  let bandWave = -1;
  for (let index = 0; index <= slots.length; index++) {
    const slot = slots[index];
    const wave = slot?.kind === 'column' ? slot.column.wave : -1;
    if (wave === bandWave) { bandCells += 1; continue; }
    if (bandFrom >= 0) drawBand(bandFrom, bandCells, bandWave);
    bandFrom = wave >= 0 && slot ? slot.cell : -1;
    bandCells = 1;
    bandWave = wave;
  }

  const first = slots[0];
  const last = slots[slots.length - 1];
  if (!first || !last) return;
  const routeStart = place(centerPrimary(first), routeCross);
  const routeEnd = place(centerPrimary(last), routeCross);
  const routeLine = horizontal
    ? scene.add.rectangle(routeStart.x, routeCross, routeEnd.x - routeStart.x, 1, UI.border, 0.42).setOrigin(0, 0.5)
    : scene.add.rectangle(routeCross, routeStart.y, 1, routeEnd.y - routeStart.y, UI.border, 0.42).setOrigin(0.5, 0);
  trackObject(opts.track, routeLine);

  for (const slot of slots) {
    const primary = centerPrimary(slot);
    const point = place(primary, routeCross);
    const labelPos = place(primary, routeCross - (horizontal ? profile.font.label + profile.gap : crossSize * 0.34));

    // A truncated end SAYS how much it is hiding, in its own cell. A trail that
    // silently started at D14 would be a lie about where the run began; "+13
    // BEHIND" is the same class of fact as "NOTHING COUNTERS THESE MOBS" — the
    // answer, not an absence.
    if (slot.kind === 'more') {
      const marker = scene.add.text(labelPos.x, labelPos.y, moreLabel(slot), {
        fontFamily: FONT.body,
        fontStyle: 'bold',
        fontSize: `${profile.font.tiny}px`,
        color: UI.textAccent,
      }).setOrigin(horizontal ? 0.5 : 0, horizontal ? 1 : 0.5);
      trackObject(opts.track, marker);
      auditTextBlock(marker, {
        name: `Run route hidden ${slot.side}`,
        maxWidth: horizontal ? Math.max(profile.font.tiny * 7, cellSize * slot.span) : Math.max(profile.font.tiny * 7, routeCross - crossStart - profile.gap),
        maxHeight: profile.font.tiny * 2,
        minFontSize: 8,
      });
      const tick = horizontal
        ? scene.add.rectangle(point.x, point.y, 1, 7, UI.border, 0.6)
        : scene.add.rectangle(point.x, point.y, 7, 1, UI.border, 0.6);
      trackObject(opts.track, tick);
      continue;
    }

    const column = slot.column;
    const depthLabel = scene.add.text(labelPos.x, labelPos.y, `D${column.depth}`, {
      fontFamily: FONT.body,
      fontStyle: 'bold',
      fontSize: `${profile.font.tiny}px`,
      color: UI.textDim,
    }).setOrigin(horizontal ? 0.5 : 0, horizontal ? 1 : 0.5);
    trackObject(opts.track, depthLabel);
    auditTextBlock(depthLabel, {
      name: `Run route depth ${column.depth}`,
      maxWidth: horizontal ? Math.max(profile.font.tiny * 3, cellSize - profile.gap) : Math.max(profile.font.tiny * 3, routeCross - crossStart - profile.gap),
      maxHeight: profile.font.tiny * 2,
      minFontSize: 8,
    });

    if (column.state === 'cleared') {
      const pip = scene.add.circle(point.x, point.y, horizontal ? 5 : 4, UI.chip, 0.62);
      trackObject(opts.track, pip);
      continue;
    }
    if (column.state === 'current') {
      const ring = scene.add.circle(point.x, point.y, horizontal ? 7 : 6, 0, 0).setStrokeStyle(2, UI.chip, 1);
      const pip = scene.add.circle(point.x, point.y, horizontal ? 3 : 2, UI.chip, 1);
      trackObject(opts.track, ring);
      trackObject(opts.track, pip);
      continue;
    }

    const previewGap = horizontal ? 16 : 12;
    for (let previewIndex = 0; previewIndex < column.nodeCount; previewIndex++) {
      const offset = (previewIndex - (column.nodeCount - 1) / 2) * previewGap;
      const preview = horizontal
        ? scene.add.rectangle(point.x, point.y + offset, 14, 10, UI.panelMuted, 0.38).setStrokeStyle(1, UI.border, 0.22)
        : scene.add.rectangle(point.x + offset, point.y, 8, 8, UI.panelMuted, 0.38).setStrokeStyle(1, UI.border, 0.22);
      trackObject(opts.track, preview);
    }
  }
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
  const panel = scene.add.rectangle(rect.x, rect.y, rect.w, rect.h, UI.panelMuted, 0.55).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.4);
  trackObject(opts.track, panel);
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
    const text = add(innerX + row.indent, y, row.text, row.height, row.color, { bold: style.bold, display: style.display });
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
 * `renderRunStatsOverlay`. The body is `vm.card`, i.e. `renderBandForecast`'s
 * own output verbatim: mobs, shops, event themes and BOTH counter sentences in
 * the exact words `tests/run/biomeForecastCounter.test.ts` pins. Nothing here
 * re-composes a sentence, so this overlay cannot disagree with the run layer,
 * and the banner above is a summary of a card the player can always open.
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
  attachButtonFeel(scene, closeBtn, { fill: UI.panelMuted, hover: UI.chipDark, follow: [closeLabel], onPress: () => { opts.onClose(); } });
}
