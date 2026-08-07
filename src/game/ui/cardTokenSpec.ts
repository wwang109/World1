/**
 * Card-token layout spec — the single source of truth for the strip token's
 * region geometry (the shared CardToken used by battle boards, deck build,
 * bag, and prep columns). All coordinates are CENTER-relative to the token
 * (0,0 = token center); `side: 'right'` mirrors every x.
 *
 * This is the strip-token counterpart of `fantasyCardTemplateSpec.ts`: when a
 * region needs to grow or a new attachment appears (gem sockets, tier plates,
 * enchant pips…), adjust it HERE — CardToken renders whatever the spec says,
 * so scenes never hand-tune per-screen offsets.
 *
 * Pure module: no Phaser import, unit-tested in tests/game/cardTokenSpec.test.ts.
 */

export type TokenSide = 'left' | 'right';

export interface TokenTextLine {
  /** Vertical offset from token center. */
  dy: number;
  fontSize: number;
  /** Ellipsis clamp width; Infinity = unclamped. */
  maxWidth: number;
}

export interface TokenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CardTokenSpec {
  /** Below this height the token renders the single-line COMPACT variant. */
  compact: boolean;
  /** Colored identity stripe on the outward edge. */
  accent: { x: number; width: number };
  /** Anchor x for inward-corner badges (slot number, weight). */
  inwardX: number;
  /** Origin x (0 or 1) for inward-corner badges and their scrims. */
  cornerOriginX: 0 | 1;
  /** Text block: name / effects / affinity lines (regular variant). */
  textX: number;
  textOriginX: 0 | 1;
  textAlign: 'left' | 'right';
  name: TokenTextLine;
  effects: TokenTextLine;
  affinity: TokenTextLine;
  /** COMPACT variant's single centered line. */
  compactLine: TokenTextLine;
  /** Inward TOP corner (slot number). */
  slotLabel: { x: number; y: number };
  /** False when the row is too short to fit the slot number clear of the weight
   * badge — see `SLOT_LABEL_MIN_HEIGHT`. Renderers must honor it. */
  showSlotLabel: boolean;
  /** Inward BOTTOM corner (weight badge). */
  weight: { x: number; y: number };
  /** Inward BOTTOM corner, inset clear of the weight badge ("▶ NEXT"
   * playback chip). NOT the same inset as `weight` — see
   * `CURSOR_BADGE_INSET`. */
  cursorBadge: { x: number; y: number };
  /**
   * Reserved accessory rail — fixed-size boxes running HORIZONTALLY along the
   * bottom inward corner, starting beside the weight badge and growing toward
   * the token center. Future features (gem socket, tier plate, enchant pip)
   * render into `accessorySlot(i)`; text clamps already account for
   * `accessoryCount`, so adding one never overlaps the lines. Horizontal (not
   * stacked) so the rail fits the standard ~43px board row as well as tall
   * multi-slot tokens.
   */
  accessorySlot: (index: number) => TokenBox;
  accessoryMax: number;
}

export const TOKEN_COMPACT_HEIGHT = 42;
/**
 * Padding tokens for the small chip/scrim pill rendered BEHIND a text label
 * (corner badges, the playback "▶ NEXT" chip). Any caller building one of
 * these pills should go through `chipBox()` below rather than hand-rolling a
 * rect sized from `text.width`/`text.height` — the labels this spec drives
 * use non-center origins (0 or 1) so they can anchor flush to a token edge,
 * and a chip that reused that same origin grows ASYMMETRICALLY (all the
 * extra size lands on one side), which reads as off-center and pressed
 * against the edge. `chipBox()` centers on the text's true glyph bounds
 * instead, so the pad is identical on both sides of both axes no matter what
 * origin the text itself uses.
 */
export const CHIP_PAD_X = 4;
export const CHIP_PAD_Y = 2;

/**
 * Minimal shape `chipBox()` needs from a rendered text object. Matches
 * Phaser's `Text` (x/y/originX/originY/width/height) by duck typing, so
 * `CardToken.ts` can pass a real `Phaser.GameObjects.Text` straight in
 * without this module ever importing Phaser.
 */
export interface ChipTextLike {
  x: number;
  y: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * The chip/pill rect for a text label, centered on the text's TRUE glyph
 * bounds and padded symmetrically on both axes — regardless of what origin
 * the text itself uses to anchor to a token edge. See `CHIP_PAD_X`/`_Y` above
 * for why this exists: a rect built from the text's own (possibly corner)
 * origin grows lopsided, not a pill around the text.
 */
export function chipBox(text: ChipTextLike, padX = CHIP_PAD_X, padY = CHIP_PAD_Y): TokenBox {
  return {
    x: text.x + (0.5 - text.originX) * text.width,
    y: text.y + (0.5 - text.originY) * text.height,
    width: text.width + padX * 2,
    height: text.height + padY * 2,
  };
}

/**
 * True when two `chipBox()` rects overlap on BOTH axes. The intersection
 * test behind the "cursor chip clear of the weight badge" guard — see the
 * `cardTokenSpec.test.ts` case of the same name.
 */
export function boxesOverlap(a: TokenBox, b: TokenBox): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2;
}

/**
 * Below this token height the inward TOP (slot number) and inward BOTTOM
 * (weight) corner badges collide: the slot label is top-aligned at
 * `-h/2 + CORNER_PAD` and ~13px tall, the weight badge bottom-aligned at
 * `h/2 - CORNER_PAD` and ~12px tall, so they meet once `h < 2*CORNER_PAD+25`.
 * The slot number is the one dropped — weight feeds the initiative math,
 * while position is already implied by row order (and empty slots still
 * print their number).
 */
export const SLOT_LABEL_MIN_HEIGHT = 39;
// EDGE_PAD/CORNER_PAD are the label's inset from the token's true edge.
// They're padded out by CHIP_PAD_X/Y so that once chipBox() adds its
// symmetric pill padding, the CHIP's outer edge — not just the text's —
// keeps a steady ~6px / ~5px gap from the card edge on every side.
const EDGE_PAD = 6 + CHIP_PAD_X;
const TEXT_PAD = 10;
const CORNER_PAD = 5 + CHIP_PAD_Y;
const ACCESSORY_SIZE = 16;
const ACCESSORY_GAP = 4;
/** Horizontal room reserved for the weight badge + its scrim ("W10"). */
const WEIGHT_BADGE_CLEARANCE = 34;
/**
 * Horizontal inset of the "▶ NEXT" / "NEXT ◀" playback chip from the
 * token's INWARD edge (see `cursorBadge` below) — deliberately MORE than
 * `WEIGHT_BADGE_CLEARANCE`, which only reserves room for the weight badge's
 * OWN footprint, not the chip's.
 *
 * Both chips anchor with `chipBox()`'s origin trick (see its comment), so
 * each chip's edge flush with its anchor is FIXED regardless of that chip's
 * own text width — only its far edge grows with the text. That means what
 * has to clear the weight badge's (data-driven, variable-width) far edge is
 * this inset, not the "▶ NEXT" chip's own (fixed) text width. Sized for the
 * weight badge's realistic worst case, a 3-digit "W" + digits label (e.g.
 * "W999" ≈ 29px at the badge's shared 9px bold font) plus both chips'
 * `CHIP_PAD_X` pill padding on the facing sides, plus a few px of margin:
 * EDGE_PAD(10) + 29 + 2*CHIP_PAD_X(8) ≈ 47, rounded up to 56. See the
 * "keeps the NEXT cursor chip's pill clear of the weight badge's pill" test
 * for the box-level guard (this constant alone doesn't prove no overlap —
 * that test does, using each chip's real rendered pill).
 */
const CURSOR_BADGE_INSET = 56;

export function cardTokenSpec(
  width: number,
  height: number,
  side: TokenSide = 'left',
  accessoryCount = 0,
): CardTokenSpec {
  const mirror = side === 'left' ? 1 : -1;
  const inwardX = mirror * (width / 2 - EDGE_PAD);
  const textX = -mirror * (width / 2 - TEXT_PAD);
  // Accessories sit inward of the weight badge; shrink text clamps so lines stay clear.
  const accessoryInset = accessoryCount > 0
    ? WEIGHT_BADGE_CLEARANCE + accessoryCount * (ACCESSORY_SIZE + ACCESSORY_GAP)
    : 0;

  const accessorySlot = (index: number): TokenBox => ({
    x: mirror * (width / 2 - EDGE_PAD - WEIGHT_BADGE_CLEARANCE - ACCESSORY_SIZE / 2 - index * (ACCESSORY_SIZE + ACCESSORY_GAP)),
    y: height / 2 - CORNER_PAD - ACCESSORY_SIZE / 2,
    width: ACCESSORY_SIZE,
    height: ACCESSORY_SIZE,
  });
  // How many rail boxes fit in the inward half before crowding the text block.
  const railSpan = width / 2 - EDGE_PAD - WEIGHT_BADGE_CLEARANCE - 40;
  const accessoryMax = Math.max(0, Math.min(4, Math.floor(railSpan / (ACCESSORY_SIZE + ACCESSORY_GAP))));

  return {
    compact: height < TOKEN_COMPACT_HEIGHT,
    accent: { x: -mirror * (width / 2 - 2), width: 4 },
    inwardX,
    cornerOriginX: side === 'left' ? 1 : 0,
    textX,
    textOriginX: side === 'left' ? 0 : 1,
    textAlign: side === 'left' ? 'left' : 'right',
    name: { dy: -14, fontSize: 12, maxWidth: width - TEXT_PAD * 2 - accessoryInset },
    effects: { dy: 1, fontSize: 10, maxWidth: width - TEXT_PAD * 2 - accessoryInset },
    affinity: { dy: 15, fontSize: 9, maxWidth: width - TEXT_PAD * 2 - accessoryInset },
    compactLine: { dy: 0, fontSize: 10, maxWidth: width - 52 - accessoryInset },
    slotLabel: { x: inwardX, y: -height / 2 + CORNER_PAD },
    showSlotLabel: height >= SLOT_LABEL_MIN_HEIGHT,
    weight: { x: inwardX, y: height / 2 - CORNER_PAD },
    // The NEXT chip and the weight badge both live in the bottom INWARD
    // corner (the chip points into the gutter). CURSOR_BADGE_INSET (not
    // WEIGHT_BADGE_CLEARANCE — that one only sizes the weight badge's own
    // footprint) pushes the chip in far enough to clear it; see that
    // constant's comment for the derivation.
    cursorBadge: { x: mirror * (width / 2 - CURSOR_BADGE_INSET), y: height / 2 },
    accessorySlot,
    accessoryMax,
  };
}
