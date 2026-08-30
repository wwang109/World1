/**
 * THE BATTLE HP BLOCK'S GEOMETRY — every label a combatant's HP block draws,
 * in one pure function per platform.
 *
 * ---------------------------------------------------------------------------
 * THE TWO SHIPPED BUGS THIS CLOSES. Both are the same defect: a label placed at
 * a coordinate picked by hand, next to something else placed at a coordinate
 * picked by hand, in a different function.
 *
 *   DESKTOP — the badges were drawn at `barY + 20` = `panelY + 46`, which is
 *   the EXACT y the caller drew the full statline at, two hundred lines away in
 *   `DesktopBattleScene.render`. `"EXPOSE +50%"` rendered straight over
 *   `"ATK 1 · MATK 1 · DEF 1 · MDEF 1 · SPD 10"` — same x, same y, same panel —
 *   on the hero AND the foe panel, on every enemy, for as long as a status
 *   stood. Audited on screen it read `GUARD 20%PTK 1 · DEF 1 · …`.
 *
 *   MOBILE — the shield/expose/guard chain walked LEFTWARD from the screen edge
 *   with nothing to stop it, straight across the HP bar it was supposed to sit
 *   beside: `+100 (54 P · 46 M)` spanned 270..363 over a bar spanning 120..328,
 *   and with all three standing the chain reached x≈121 and covered the bar
 *   entirely. Correct at wave 1 (no shield card, no guard on the board) and
 *   broken for the whole rest of the run — the same "fine at the start" shape
 *   as the desktop one.
 *
 * THE RULE BOTH NOW FOLLOW. Status labels get a ROW OF THEIR OWN, below the
 * statline and inside the block, and they CHAIN off each other's measured width
 * from the block's right edge — never a hand-picked x, never a row something
 * else is already using. A row with one chain on it and nothing else cannot
 * collide with anything, which is the property that survives shield + expose +
 * guard all standing at once (the real worst case: an ordinary defensive board
 * reaches it).
 *
 * PURE. No Phaser, no scene, no colours — the scene owns styling and drawing,
 * this owns "where, and how wide may it be". That is what lets
 * `tests/game/battlePanelOverlapAudit.test.ts` drive the REAL placement over a
 * state matrix from Node, and what lets that audit still REJECT both pre-fix
 * geometries (`legacyDesktopHpBlockLayout` / `legacyMobileHpBlockLayout`).
 */

/**
 * Rendered line box / font size. Deliberately GENEROUS (measured 1.11–1.15 at
 * the sizes these blocks use) — the modelled band is taller than the real one,
 * so an audit built on it can only ever be stricter than the screen. Same ratio
 * and same reasoning as `ruleClearanceAudit.test.ts`'s `TEXT_LINE_BOX`.
 */
export const HP_BLOCK_LINE_BOX = 1.2;

export type HpBlockLabelKey = 'name' | 'hp' | 'shield' | 'statLine' | 'expose' | 'guard';

/** The three labels that share the block's dedicated STATUS row. */
export const STATUS_ROW_KEYS: readonly HpBlockLabelKey[] = ['shield', 'expose', 'guard'];

/** One label the block wants to draw, with its NATURAL (unclamped) width. */
export interface HpBlockLabel {
  text: string;
  /** Measured width at `fontSize`, in design px, before any ellipsis clamp. */
  width: number;
  fontSize: number;
}

/** A box in design coordinates. */
export interface HpBlockBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A label placed by the layout: where to draw it, how wide it may be, and the
 * box it therefore occupies. `left/top/width/height` is the AUDITED box. */
export interface PlacedHpBlockLabel extends HpBlockBox {
  key: HpBlockLabelKey;
  text: string;
  fontSize: number;
  /** Draw anchor — pass straight to `add.text(x, y, …).setOrigin(originX, 0)`. */
  x: number;
  y: number;
  originX: 0 | 1;
  /** Ellipsis budget for the scene's clamp. */
  maxWidth: number;
}

export interface HpBlockGeometry {
  labels: PlacedHpBlockLabel[];
  /** Convenience lookup — `undefined` for a label this state does not draw. */
  byKey: Partial<Record<HpBlockLabelKey, PlacedHpBlockLabel>>;
  /** The HP bar's own box. No status label may touch it — that was the mobile bug. */
  bar: HpBlockBox;
}

function place(
  key: HpBlockLabelKey, label: HpBlockLabel, y: number,
  x: number, originX: 0 | 1, maxWidth: number,
): PlacedHpBlockLabel {
  const width = Math.min(label.width, Math.max(0, maxWidth));
  return {
    key, text: label.text, fontSize: label.fontSize, x, y, originX,
    maxWidth: Math.max(0, maxWidth),
    left: originX === 1 ? x - width : x,
    top: y,
    width,
    height: label.fontSize * HP_BLOCK_LINE_BOX,
  };
}

function collect(labels: PlacedHpBlockLabel[], bar: HpBlockBox): HpBlockGeometry {
  const byKey: Partial<Record<HpBlockLabelKey, PlacedHpBlockLabel>> = {};
  for (const l of labels) byKey[l.key] = l;
  return { labels, byKey, bar };
}

/** Everything the two platforms' status rows have in common: one right-anchored
 * chain, each link measured off the previous one, none of them past `leftStop`. */
function chainStatusRow(
  input: { shield?: HpBlockLabel; expose?: HpBlockLabel; guard?: HpBlockLabel },
  rowY: number, rightEdge: number, leftStop: number, gap: number,
): PlacedHpBlockLabel[] {
  const out: PlacedHpBlockLabel[] = [];
  let cursor = rightEdge;
  for (const key of STATUS_ROW_KEYS) {
    const label = input[key as 'shield' | 'expose' | 'guard'];
    if (!label) continue;
    const placed = place(key, label, rowY, cursor, 1, cursor - leftStop);
    out.push(placed);
    cursor = placed.left - gap;
  }
  return out;
}

// ---------------------------------------------------------------------------
// DESKTOP — a left-anchored panel: head row, bar, statline row, status row.
// ---------------------------------------------------------------------------

/**
 * The desktop block's row offsets from `panelY`, named once so the scene stops
 * inventing them and the audit can assert the whole block stays inside
 * `blockHeight` (the board column starts exactly there).
 */
export const DESKTOP_HP_BLOCK = {
  /** Name (left) + `hp/max` (right). */
  headRowDy: 0,
  /** Top of the HP bar band (the bar rect is centred at `barRowDy + 8`). */
  barRowDy: 26,
  barHeight: 16,
  /** Full statline (left) + the ailment pips (right). */
  statRowDy: 46,
  /**
   * SHIELD / EXPOSE / GUARD — their OWN row, under the statline and clear of
   * the board column at `blockHeight`. The badges used to be at `statRowDy`
   * (on top of the statline) and the shield total at `barRowDy - 2` (on top of
   * the bar); see the module doc. 61 keeps a modelled 11px statline's line box
   * (46 → 59.2) clear of a modelled 10px status row's (61 → 73), with the board
   * top still 3px below.
   */
  statusRowDy: 61,
  /** Height the caller reserves before the board column — `HP_BLOCK_H`. */
  blockHeight: 76,
  /** Room reserved to the right of the name for the `hp/max` label. */
  nameRightReserve: 90,
  /** Gap between chained labels, and between a label and what it must clear. */
  gap: 8,
  /** Ailment pip geometry on the stat row (right-aligned, one per ailment). */
  pip: { width: 8, pitch: 12, inset: 6 },
} as const;

export interface DesktopHpBlockInput {
  panelX: number;
  panelY: number;
  panelW: number;
  name: HpBlockLabel;
  hp: HpBlockLabel;
  statLine: HpBlockLabel;
  shield?: HpBlockLabel;
  expose?: HpBlockLabel;
  guard?: HpBlockLabel;
  /** Ailment pips drawn right-aligned on the STAT row — the statline is bounded
   * off them too, so a five-ailment unit cannot have its stats run under them. */
  ailmentPips?: number;
}

/** Left edge of the leftmost ailment pip on the stat row (the panel's right edge
 * when there are none) — what the statline must stop short of. */
export function desktopPipLeft(panelX: number, panelW: number, pips: number): number {
  const { width, pitch, inset } = DESKTOP_HP_BLOCK.pip;
  if (pips <= 0) return panelX + panelW;
  return panelX + panelW - inset - (pips - 1) * pitch - width;
}

function desktopBlock(input: DesktopHpBlockInput, statusRowDy: number): HpBlockGeometry {
  const { panelX, panelY, panelW } = input;
  const R = DESKTOP_HP_BLOCK;
  const right = panelX + panelW;
  const labels: PlacedHpBlockLabel[] = [];

  const hp = place('hp', input.hp, panelY + R.headRowDy, right, 1, panelW);
  labels.push(hp);
  labels.push(place('name', input.name, panelY + R.headRowDy, panelX, 0,
    Math.min(panelW - R.nameRightReserve, hp.left - panelX - R.gap)));

  // The statline shares its row with the right-aligned ailment pips, so it is
  // bounded off them — it used to be an unbounded `add.text` on the caller's side.
  const pipLeft = desktopPipLeft(panelX, panelW, input.ailmentPips ?? 0);
  labels.push(place('statLine', input.statLine, panelY + R.statRowDy, panelX, 0, pipLeft - panelX - R.gap));

  labels.push(...chainStatusRow(input, panelY + statusRowDy, right, panelX, R.gap));

  return collect(labels, {
    left: panelX, top: panelY + R.barRowDy, width: panelW, height: R.barHeight,
  });
}

export function desktopHpBlockLayout(input: DesktopHpBlockInput): HpBlockGeometry {
  return desktopBlock(input, DESKTOP_HP_BLOCK.statusRowDy);
}

/**
 * THE PRE-FIX DESKTOP GEOMETRY, reconstructed: badges on the statline's own row
 * (`statRowDy`), left-aligned from `panelX` and chained rightward, plus the
 * shield total two px above the bar. Exported ONLY so the audit can prove it
 * still detects the defect it was written for — if this ever stops producing
 * overlaps, the audit has gone blind.
 */
export function legacyDesktopHpBlockLayout(input: DesktopHpBlockInput): HpBlockGeometry {
  const { panelX, panelY, panelW } = input;
  const R = DESKTOP_HP_BLOCK;
  const labels: PlacedHpBlockLabel[] = [];
  labels.push(place('hp', input.hp, panelY + R.headRowDy, panelX + panelW, 1, panelW));
  labels.push(place('name', input.name, panelY + R.headRowDy, panelX, 0, panelW - R.nameRightReserve));
  // The old caller's `this.add.text(x, top + 46, statLine)` — unbounded.
  labels.push(place('statLine', input.statLine, panelY + R.statRowDy, panelX, 0, Number.POSITIVE_INFINITY));
  if (input.shield) labels.push(place('shield', input.shield, panelY + R.barRowDy - 2, panelX + panelW, 1, panelW));
  // The old `barY + 20` badge row, chained LEFT-to-RIGHT off `panelX`.
  let cursor = panelX;
  for (const key of ['expose', 'guard'] as const) {
    const label = input[key];
    if (!label) continue;
    const placed = place(key, label, panelY + R.statRowDy, cursor, 0, Number.POSITIVE_INFINITY);
    labels.push(placed);
    cursor = placed.left + placed.width + R.gap;
  }
  return collect(labels, { left: panelX, top: panelY + R.barRowDy, width: panelW, height: R.barHeight });
}

// ---------------------------------------------------------------------------
// MOBILE — a full-width strip: head row, bar, statline row, status row.
// ---------------------------------------------------------------------------

export const MOBILE_HP_BLOCK = {
  nameX: 12,
  /** Left edge of the HP bar; the name may not reach it. */
  barX: 120,
  /** Right inset of the `hp/max` label and of the status chain. */
  rightPad: 12,
  /** Right inset of the bar (and of the statline's own budget). */
  barRightPad: 84,
  /** The bar rect's offsets from the strip's row y. */
  barTopDy: 1,
  barHeight: 12,
  /** Statline's offset below the strip's row. */
  statRowDy: 17,
  /** SHIELD / EXPOSE / GUARD — their own row. See the module doc: this chain
   * used to share the HEAD row and walked straight across the bar. */
  statusRowDy: 29,
  /**
   * Vertical pitch between stacked strips (`barRowH` in `MobileBattleScene`).
   * 36 before the status row existed; the extra 12 is that row, and it is the
   * price of the three status labels being readable at all once a defensive
   * board is up.
   */
  rowHeight: 48,
  gap: 6,
  nameClearance: 20,
} as const;

export interface MobileHpBlockInput {
  screenW: number;
  /** The strip's row y (`hpY` / a foe's `barY` in `MobileBattleScene`). */
  rowY: number;
  name: HpBlockLabel;
  hp: HpBlockLabel;
  statLine: HpBlockLabel;
  shield?: HpBlockLabel;
  expose?: HpBlockLabel;
  guard?: HpBlockLabel;
}

function mobileBar(screenW: number, rowY: number): HpBlockBox {
  const R = MOBILE_HP_BLOCK;
  return {
    left: R.barX, top: rowY + R.barTopDy,
    width: screenW - R.barX - R.barRightPad, height: R.barHeight,
  };
}

export function mobileHpBlockLayout(input: MobileHpBlockInput): HpBlockGeometry {
  const R = MOBILE_HP_BLOCK;
  const { screenW, rowY } = input;
  const labels: PlacedHpBlockLabel[] = [];

  const hp = place('hp', input.hp, rowY, screenW - R.rightPad, 1, screenW - R.nameX);
  labels.push(hp);
  labels.push(place('name', input.name, rowY, R.nameX, 0,
    Math.min(R.barX - R.nameClearance, hp.left - R.nameX - R.gap)));

  labels.push(place('statLine', input.statLine, rowY + R.statRowDy, R.barX, 0,
    screenW - R.barX - R.barRightPad));

  labels.push(...chainStatusRow(input, rowY + R.statusRowDy, screenW - R.rightPad, R.nameX, R.gap));

  return collect(labels, mobileBar(screenW, rowY));
}

/**
 * THE PRE-FIX MOBILE GEOMETRY, reconstructed: shield/expose/guard chained
 * LEFTWARD along the HEAD row off the `hp/max` label, with nothing stopping the
 * chain at the bar. Exported ONLY so the audit can prove it still detects the
 * defect — see `legacyDesktopHpBlockLayout`.
 */
export function legacyMobileHpBlockLayout(input: MobileHpBlockInput): HpBlockGeometry {
  const R = MOBILE_HP_BLOCK;
  const { screenW, rowY } = input;
  const labels: PlacedHpBlockLabel[] = [];
  let cursor = screenW - R.rightPad;
  for (const key of ['hp', ...STATUS_ROW_KEYS] as const) {
    const label = key === 'hp' ? input.hp : input[key as 'shield' | 'expose' | 'guard'];
    if (!label) continue;
    const placed = place(key, label, rowY, cursor, 1, Number.POSITIVE_INFINITY);
    labels.push(placed);
    cursor = placed.left - R.gap;
  }
  labels.push(place('name', input.name, rowY, R.nameX, 0, R.barX - R.nameClearance));
  labels.push(place('statLine', input.statLine, rowY + R.statRowDy, R.barX, 0, screenW - R.barX - R.barRightPad));
  return collect(labels, mobileBar(screenW, rowY));
}

// ---------------------------------------------------------------------------
// THE INVARIANTS — what a rendered block may never do.
// ---------------------------------------------------------------------------

export interface HpBlockOverlap {
  a: HpBlockLabelKey | 'bar';
  b: HpBlockLabelKey | 'bar';
  /** Overlapping area, design px² — a positive number here is the bug. */
  area: number;
}

function intersect(a: HpBlockBox, b: HpBlockBox, tolerance: number): number {
  const dx = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const dy = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return dx > tolerance && dy > tolerance ? dx * dy : 0;
}

/**
 * Every pair of placed labels whose boxes intersect on BOTH axes. Empty is the
 * only acceptable answer for a rendered block, in every state it can be in.
 */
export function overlappingHpBlockLabels(
  labels: readonly PlacedHpBlockLabel[],
  tolerance = 0.5,
): HpBlockOverlap[] {
  const out: HpBlockOverlap[] = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]!;
      const b = labels[j]!;
      if (a.width <= 0 || b.width <= 0) continue;
      const area = intersect(a, b, tolerance);
      if (area > 0) out.push({ a: a.key, b: b.key, area });
    }
  }
  return out;
}

/**
 * Status labels (shield/expose/guard) drawn across the HP bar — the mobile bug.
 * The head row's own `name`/`hp` are NOT checked here: they are the bar's row
 * labels and always have been, and clamping `hp/max` off the bar would truncate
 * a five-digit HP number instead (see the audit's note).
 */
export function statusLabelsOverBar(
  geometry: HpBlockGeometry,
  tolerance = 0.5,
): HpBlockOverlap[] {
  const out: HpBlockOverlap[] = [];
  for (const l of geometry.labels) {
    if (!STATUS_ROW_KEYS.includes(l.key) || l.width <= 0) continue;
    const area = intersect(l, geometry.bar, tolerance);
    if (area > 0) out.push({ a: l.key, b: 'bar', area });
  }
  return out;
}
