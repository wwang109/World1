import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../layoutProfile';
import { type RunState } from '../runStore';
import { ELEMENT_COLOR, FONT, SCREEN, UI, WEAPON_COLOR } from '../theme';
import { auditTextBlock } from './controlLayoutAudit';
import { attachButtonFeel } from './motion';
import type { BandClaimKind, BandCounterClaim, BandBannerViewModel } from './bandBannerViewModel';

export interface RunRouteColumnSnapshot {
  depth: number;
  wave: number;
  nodeCount: number;
  state: 'cleared' | 'current' | 'future';
}

export interface RunRouteSnapshot {
  columns: readonly RunRouteColumnSnapshot[];
  currentDepth: number;
  nextDepth: number;
}

function trackObject(track: Phaser.GameObjects.GameObject[] | undefined, object: Phaser.GameObjects.GameObject): void {
  track?.push(object);
}

export function snapshotRunRoute(run: Readonly<RunState>): RunRouteSnapshot {
  const actionableDepth = run.depth + 1;
  const columns = run.map.depths.slice(1).map((nodes, index) => {
    const depth = index + 1;
    return {
      depth,
      wave: nodes[0]?.wave ?? 1,
      nodeCount: nodes.length,
      state: depth < actionableDepth ? 'cleared' : depth === actionableDepth ? 'current' : 'future',
    } satisfies RunRouteColumnSnapshot;
  });

  return {
    columns,
    currentDepth: run.depth,
    nextDepth: run.depth + 1,
  };
}

export function renderRunRouteBoard(
  scene: Phaser.Scene,
  bounds: { x: number; y: number; w: number; h: number },
  route: RunRouteSnapshot,
  opts: { mode: 'desktop' | 'mobile'; track?: Phaser.GameObjects.GameObject[] },
): void {
  const profile = opts.mode === 'desktop' ? DESKTOP_PROFILE : MOBILE_PROFILE;
  const columns = route.columns;
  if (columns.length === 0) return;

  const horizontal = opts.mode === 'desktop';
  const primaryStart = horizontal ? bounds.x : bounds.y;
  const primarySize = horizontal ? bounds.w : bounds.h;
  const crossStart = horizontal ? bounds.y : bounds.x;
  const crossSize = horizontal ? bounds.h : bounds.w;
  const inset = profile.gap;
  const usablePrimary = Math.max(0, primarySize - inset * 2);
  const cellSize = usablePrimary / columns.length;
  const centerPrimary = (index: number): number => primaryStart + inset + cellSize * (index + 0.5);
  const routeCross = crossStart + Math.max(profile.font.label + profile.gap * 2, crossSize * 0.58);
  const place = (primary: number, cross: number): { x: number; y: number } => horizontal
    ? { x: primary, y: cross }
    : { x: cross, y: primary };

  let waveStart = 0;
  for (let index = 0; index < columns.length; index++) {
    const column = columns[index]!;
    const nextWave = columns[index + 1]?.wave;
    if (nextWave === column.wave) continue;

    const bandStart = primaryStart + inset + cellSize * waveStart;
    const bandSize = cellSize * (index - waveStart + 1);
    const band = horizontal
      ? scene.add.rectangle(bandStart, bounds.y, bandSize, bounds.h, column.wave % 2 === 0 ? UI.panelMuted : UI.panelAlt, 0.2).setOrigin(0, 0)
      : scene.add.rectangle(bounds.x, bandStart, bounds.w, bandSize, column.wave % 2 === 0 ? UI.panelMuted : UI.panelAlt, 0.2).setOrigin(0, 0);
    const waveLabelPos = place(bandStart + bandSize / 2, crossStart + profile.gap);
    const waveLabel = scene.add.text(waveLabelPos.x, waveLabelPos.y, horizontal ? `WAVE ${column.wave}` : `— WAVE ${column.wave} —`, {
      fontFamily: FONT.body,
      fontStyle: 'bold',
      fontSize: `${profile.font.tiny}px`,
      color: UI.textSoft,
    }).setOrigin(horizontal ? 0.5 : 0, 0);
    trackObject(opts.track, band);
    trackObject(opts.track, waveLabel);
    auditTextBlock(waveLabel, {
      name: `Run route wave ${column.wave}`,
      maxWidth: horizontal ? Math.max(profile.font.tiny * 5, bandSize - profile.gap * 2) : Math.max(profile.font.tiny * 6, crossSize - profile.gap * 2),
      maxHeight: profile.font.tiny * 2,
      minFontSize: 8,
    });
    waveStart = index + 1;
  }

  const routeStart = place(centerPrimary(0), routeCross);
  const routeEnd = place(centerPrimary(columns.length - 1), routeCross);
  const routeLine = horizontal
    ? scene.add.rectangle(routeStart.x, routeCross, routeEnd.x - routeStart.x, 1, UI.border, 0.42).setOrigin(0, 0.5)
    : scene.add.rectangle(routeCross, routeStart.y, 1, routeEnd.y - routeStart.y, UI.border, 0.42).setOrigin(0.5, 0);
  trackObject(opts.track, routeLine);

  columns.forEach((column, index) => {
    const primary = centerPrimary(index);
    const point = place(primary, routeCross);
    const labelPos = place(primary, routeCross - (horizontal ? profile.font.label + profile.gap : crossSize * 0.34));
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
      return;
    }
    if (column.state === 'current') {
      const ring = scene.add.circle(point.x, point.y, horizontal ? 7 : 6, 0, 0).setStrokeStyle(2, UI.chip, 1);
      const pip = scene.add.circle(point.x, point.y, horizontal ? 3 : 2, UI.chip, 1);
      trackObject(opts.track, ring);
      trackObject(opts.track, pip);
      return;
    }

    const previewGap = horizontal ? 16 : 12;
    for (let previewIndex = 0; previewIndex < column.nodeCount; previewIndex++) {
      const offset = (previewIndex - (column.nodeCount - 1) / 2) * previewGap;
      const preview = horizontal
        ? scene.add.rectangle(point.x, point.y + offset, 14, 10, UI.panelMuted, 0.38).setStrokeStyle(1, UI.border, 0.22)
        : scene.add.rectangle(point.x + offset, point.y, 8, 8, UI.panelMuted, 0.38).setStrokeStyle(1, UI.border, 0.22);
      trackObject(opts.track, preview);
    }
  });
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

interface BandBannerMetrics {
  pad: number;
  name: number;
  lean: number;
  wave: number;
  heading: number;
  bossName: number;
  sub: number;
  claim: number;
  button: number;
  lineGap: number;
  blockGap: number;
}

const BANNER_METRICS: Record<'desktop' | 'mobile', BandBannerMetrics> = {
  desktop: { pad: 14, name: 18, lean: 11, wave: 11, heading: 10, bossName: 15, sub: 10, claim: 12, button: 26, lineGap: 4, blockGap: 8 },
  mobile: { pad: 8, name: 13, lean: 9, wave: 9, heading: 8, bossName: 12, sub: 9, claim: 10, button: 24, lineGap: 3, blockGap: 7 },
};

/** Colour of a COUNTER type — element first, then weapon (the two key spaces
 * never collide), falling back to the generic chip bronze. */
function counterColor(type: string | undefined): number {
  if (type === undefined) return UI.chip;
  return ELEMENT_COLOR[type] ?? WEAPON_COLOR[type] ?? UI.chip;
}

/** Text colour per certainty. `'none'` deliberately gets the SAME danger red
 * the boss-countdown headline uses — "no type helps you here" is a loud fact,
 * not a greyed-out blank. */
function claimTextColor(kind: BandClaimKind): string {
  if (kind === 'none') return '#e0654a';
  if (kind === 'unsure') return UI.textAccent;
  return UI.text;
}

function claimBarColor(claim: BandCounterClaim): number {
  if (claim.kind === 'none') return UI.bad;
  if (claim.kind === 'unsure') return UI.waiting;
  return counterColor(claim.types[0]);
}

/** Exact height `renderRunBandBanner` will occupy for THIS model — claim lines
 * vary (a long type list flips to two lines), so callers reserve the real
 * number instead of guessing one. */
export function bandBannerHeight(vm: BandBannerViewModel, mode: 'desktop' | 'mobile'): number {
  const m = BANNER_METRICS[mode];
  const bossBody = vm.boss.resolved
    ? m.sub + m.lineGap
    : vm.boss.entries.length * (m.sub + m.lineGap);
  return m.pad
    + m.name + m.lineGap
    + m.wave + m.blockGap
    + 1 + m.blockGap
    + m.heading + m.lineGap
    + m.bossName + m.lineGap
    + bossBody
    + vm.bossClaim.lines.length * (m.claim + m.lineGap)
    + 1 + m.blockGap
    + m.heading + m.lineGap
    + vm.mobsClaim.lines.length * (m.claim + m.lineGap)
    + m.button
    + m.pad;
}

/**
 * Draws the band banner into `rect`. Identical BLOCKS on both platforms (the
 * both-platforms rule is about the information, and a phone must not be told
 * less than a desktop) — only the type ladder differs.
 */
export function renderRunBandBanner(
  scene: Phaser.Scene,
  rect: { x: number; y: number; w: number; h: number },
  vm: BandBannerViewModel,
  opts: { mode: 'desktop' | 'mobile'; track?: Phaser.GameObjects.GameObject[]; onOpenRead?: () => void },
): void {
  const m = BANNER_METRICS[opts.mode];
  const leanColor = counterColor(vm.leanType);
  const panel = scene.add.rectangle(rect.x, rect.y, rect.w, rect.h, UI.panelMuted, 0.55).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.4);
  trackObject(opts.track, panel);
  // A hairline in the band's own colour along the top edge: the lean is the
  // first thing the panel says, before a word is read.
  const leanEdge = scene.add.rectangle(rect.x, rect.y, rect.w, 2, leanColor, 0.85).setOrigin(0, 0);
  trackObject(opts.track, leanEdge);

  const innerX = rect.x + m.pad;
  const innerW = rect.w - m.pad * 2;
  let cursor = rect.y + m.pad;

  const add = (x: number, y: number, text: string, size: number, color: string, style?: { bold?: boolean; display?: boolean; wrap?: number }): Phaser.GameObjects.Text => {
    const t = scene.add.text(x, y, text, {
      fontFamily: style?.display ? FONT.display : FONT.body,
      fontStyle: style?.bold ? 'bold' : 'normal',
      fontSize: `${size}px`,
      color,
      ...(style?.wrap !== undefined ? { wordWrap: { width: style.wrap } } : {}),
    });
    trackObject(opts.track, t);
    return t;
  };

  // --- identity -----------------------------------------------------------
  // The lean pill is measured FIRST so the band name gets the width that is
  // actually left over and shrinks into it rather than running under the pill.
  const pillPadX = 6;
  // Measured, then drawn UNDER a rectangle added afterwards would hide it —
  // Phaser draws in insertion order — so the pill's fill goes down first and
  // the label is re-added on top once its width is known.
  const measure = add(0, 0, vm.leanChip, m.lean, '#12202c', { bold: true });
  const pillW = measure.width + pillPadX * 2;
  const pillH = m.lean + 6;
  measure.destroy();
  const pill = scene.add.rectangle(rect.x + rect.w - m.pad - pillW, cursor, pillW, pillH, leanColor, 0.95).setOrigin(0, 0);
  trackObject(opts.track, pill);
  add(pill.x + pillPadX, cursor + 3, vm.leanChip, m.lean, '#12202c', { bold: true });

  const nameText = add(innerX, cursor, vm.name, m.name, UI.text, { bold: true, display: true });
  auditTextBlock(nameText, {
    name: `Band banner name (${opts.mode})`,
    maxWidth: Math.max(m.name * 4, innerW - pillW - 8),
    maxHeight: m.name * 1.6,
    minFontSize: 9,
  });
  cursor += m.name + m.lineGap;

  const waveText = add(innerX, cursor, vm.waveRange, m.wave, UI.textDim, { bold: true });
  auditTextBlock(waveText, { name: `Band banner wave range (${opts.mode})`, maxWidth: innerW, maxHeight: m.wave * 2, minFontSize: 8 });
  cursor += m.wave + m.blockGap;

  const rule = (): void => {
    const line = scene.add.rectangle(innerX, cursor, innerW, 1, UI.border, 0.45).setOrigin(0, 0);
    trackObject(opts.track, line);
    cursor += 1 + m.blockGap;
  };

  /** A claim, drawn as its own stacked lines behind a colour bar. The bar is
   * decoration; the SENTENCE carries the subject, so the block can be read
   * with the colour ignored entirely. */
  const drawClaim = (claim: BandCounterClaim): void => {
    const top = cursor;
    const color = claimTextColor(claim.kind);
    for (const line of claim.lines) {
      const t = add(innerX + 6, cursor, line, m.claim, color, { bold: true });
      auditTextBlock(t, {
        name: `Band banner ${claim.subject.toLowerCase()} counter (${opts.mode})`,
        maxWidth: innerW - 6,
        maxHeight: m.claim * 2,
        minFontSize: 8,
      });
      cursor += m.claim + m.lineGap;
    }
    const bar = scene.add.rectangle(innerX, top, 3, cursor - top - m.lineGap, claimBarColor(claim), 0.95).setOrigin(0, 0);
    trackObject(opts.track, bar);
  };

  // --- BOSS ---------------------------------------------------------------
  rule();
  const bossHeading = add(innerX, cursor, 'BOSS', m.heading, UI.textSoft, { bold: true });
  auditTextBlock(bossHeading, { name: `Band banner boss heading (${opts.mode})`, maxWidth: innerW, maxHeight: m.heading * 2, minFontSize: 8 });
  cursor += m.heading + m.lineGap;

  const bossName = add(innerX, cursor, vm.boss.headline, m.bossName, UI.text, { bold: true, display: true });
  auditTextBlock(bossName, { name: `Band banner boss name (${opts.mode})`, maxWidth: innerW, maxHeight: m.bossName * 1.7, minFontSize: 9 });
  cursor += m.bossName + m.lineGap;

  if (vm.boss.resolved) {
    const sub = add(innerX, cursor, vm.boss.sub, m.sub, UI.textDim, {});
    auditTextBlock(sub, { name: `Band banner boss rank (${opts.mode})`, maxWidth: innerW, maxHeight: m.sub * 2, minFontSize: 8 });
    cursor += m.sub + m.lineGap;
  } else {
    for (const entry of vm.boss.entries) {
      const t = add(innerX, cursor, entry, m.sub, UI.textDim, {});
      auditTextBlock(t, { name: `Band banner boss candidate (${opts.mode})`, maxWidth: innerW, maxHeight: m.sub * 2, minFontSize: 8 });
      cursor += m.sub + m.lineGap;
    }
  }
  drawClaim(vm.bossClaim);

  // --- MOBS ---------------------------------------------------------------
  rule();
  const mobHeading = add(innerX, cursor, 'MOBS', m.heading, UI.textSoft, { bold: true });
  auditTextBlock(mobHeading, { name: `Band banner mobs heading (${opts.mode})`, maxWidth: innerW, maxHeight: m.heading * 2, minFontSize: 8 });
  cursor += m.heading + m.lineGap;
  drawClaim(vm.mobsClaim);

  // --- the full read ------------------------------------------------------
  const btnTop = rect.y + rect.h - m.pad - m.button;
  const btn = scene.add.rectangle(innerX, btnTop, innerW, m.button, UI.panelAlt, 0.9).setOrigin(0, 0)
    .setStrokeStyle(1, UI.border, 0.7);
  const btnLabel = add(innerX + innerW / 2, btnTop + m.button / 2, 'READ THE BAND ›', m.claim, UI.textAccent, { bold: true }).setOrigin(0.5);
  trackObject(opts.track, btn);
  auditTextBlock(btnLabel, { name: `Band banner read button (${opts.mode})`, maxWidth: innerW - 8, maxHeight: m.button, minFontSize: 8 });
  if (opts.onOpenRead) {
    const open = opts.onOpenRead;
    btn.setInteractive({ useHandCursor: true });
    attachButtonFeel(scene, btn, { fill: UI.panelAlt, hover: UI.chipDark, follow: [btnLabel], onPress: () => { open(); } });
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
