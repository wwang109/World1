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
  /** Outward BOTTOM corner ("▶ NEXT" playback chip). */
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
 * Below this token height the inward TOP (slot number) and inward BOTTOM
 * (weight) corner badges collide: the slot label is top-aligned at
 * `-h/2 + CORNER_PAD` and ~13px tall, the weight badge bottom-aligned at
 * `h/2 - CORNER_PAD` and ~12px tall, so they meet once `h < 35`. The slot
 * number is the one dropped — weight feeds the initiative math, while position
 * is already implied by row order (and empty slots still print their number).
 */
export const SLOT_LABEL_MIN_HEIGHT = 35;
const EDGE_PAD = 6;
const TEXT_PAD = 10;
const CORNER_PAD = 5;
const ACCESSORY_SIZE = 16;
const ACCESSORY_GAP = 4;
/** Horizontal room reserved for the weight badge + its scrim ("W10"). */
const WEIGHT_BADGE_CLEARANCE = 34;

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
    // Inset by the weight clearance: the NEXT chip and the weight badge both
    // live in the bottom INWARD corner (the chip points into the gutter), so
    // anchoring both to the edge drew "▶ NEXT" straight through "W10".
    cursorBadge: { x: mirror * (width / 2 - WEIGHT_BADGE_CLEARANCE), y: height / 2 },
    accessorySlot,
    accessoryMax,
  };
}
