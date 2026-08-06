import { describe, expect, it } from 'vitest';
import {
  cardTokenSpec, chipBox, CHIP_PAD_X, CHIP_PAD_Y, SLOT_LABEL_MIN_HEIGHT, TOKEN_COMPACT_HEIGHT,
  type ChipTextLike,
} from '../../src/game/ui/cardTokenSpec';

const W = 620;
const H = 84;

/** A fake rendered text object — mirrors the handful of fields `chipBox`
 * reads off a real `Phaser.GameObjects.Text`. */
function fakeText(x: number, y: number, originX: number, originY: number, width: number, height: number): ChipTextLike {
  return { x, y, originX, originY, width, height };
}

describe('cardTokenSpec', () => {
  it('switches to the compact variant below the height threshold', () => {
    expect(cardTokenSpec(W, TOKEN_COMPACT_HEIGHT - 1).compact).toBe(true);
    expect(cardTokenSpec(W, TOKEN_COMPACT_HEIGHT).compact).toBe(false);
  });

  it('mirrors every x for the right column', () => {
    const left = cardTokenSpec(W, H, 'left');
    const right = cardTokenSpec(W, H, 'right');
    expect(right.inwardX).toBe(-left.inwardX);
    expect(right.textX).toBe(-left.textX);
    expect(right.accent.x).toBe(-left.accent.x);
    expect(right.cursorBadge.x).toBe(-left.cursorBadge.x);
    expect(right.accessorySlot(0).x).toBe(-left.accessorySlot(0).x);
    expect(left.cornerOriginX).toBe(1);
    expect(right.cornerOriginX).toBe(0);
    expect(left.textAlign).toBe('left');
    expect(right.textAlign).toBe('right');
  });

  it('keeps every region inside the token bounds', () => {
    for (const side of ['left', 'right'] as const) {
      const spec = cardTokenSpec(W, H, side, 2);
      const inX = (x: number): boolean => Math.abs(x) <= W / 2;
      const inY = (y: number): boolean => Math.abs(y) <= H / 2;
      expect(inX(spec.inwardX)).toBe(true);
      expect(inX(spec.textX)).toBe(true);
      expect(inX(spec.accent.x)).toBe(true);
      expect(inY(spec.slotLabel.y)).toBe(true);
      expect(inY(spec.weight.y)).toBe(true);
      for (let i = 0; i < 2; i++) {
        const box = spec.accessorySlot(i);
        expect(Math.abs(box.x) + box.width / 2).toBeLessThanOrEqual(W / 2);
        expect(Math.abs(box.y) + box.height / 2).toBeLessThanOrEqual(H / 2);
      }
    }
  });

  it('runs the accessory rail inward along the bottom edge, clear of the weight badge', () => {
    const spec = cardTokenSpec(W, H, 'left', 2);
    const first = spec.accessorySlot(0);
    const second = spec.accessorySlot(1);
    // same baseline row
    expect(second.y).toBe(first.y);
    // rail grows toward the token center (left column: decreasing x)
    expect(second.x).toBeLessThan(first.x);
    // no overlap between consecutive boxes
    expect(first.x - second.x).toBeGreaterThanOrEqual(first.width);
    // first box sits fully inward of the weight badge anchor
    expect(first.x + first.width / 2).toBeLessThan(spec.weight.x);
    // rail stays in the bottom corner band
    expect(first.y - first.height / 2).toBeGreaterThan(0);
    // fits the standard ~43px board row
    expect(cardTokenSpec(W, 43, 'left', 1).accessoryMax).toBeGreaterThanOrEqual(1);
  });

  it('shrinks text clamps when accessories are present so lines stay clear', () => {
    const bare = cardTokenSpec(W, H, 'left', 0);
    const withRail = cardTokenSpec(W, H, 'left', 1);
    expect(withRail.effects.maxWidth).toBeLessThan(bare.effects.maxWidth);
    expect(withRail.name.maxWidth).toBeLessThan(bare.name.maxWidth);
    expect(withRail.compactLine.maxWidth).toBeLessThan(bare.compactLine.maxWidth);
  });

  it('drops the slot number once the row is too short to fit it clear of the weight badge', () => {
    expect(cardTokenSpec(W, SLOT_LABEL_MIN_HEIGHT).showSlotLabel).toBe(true);
    expect(cardTokenSpec(W, SLOT_LABEL_MIN_HEIGHT - 1).showSlotLabel).toBe(false);
    // The real bug this guards: short rows (a 2-foe mobile prep column squeezed
    // 10 slots into ~12px each) drew the slot number on top of "W10".
    expect(cardTokenSpec(W, 12).showSlotLabel).toBe(false);
    expect(cardTokenSpec(W, 84).showSlotLabel).toBe(true);
  });

  it('keeps the two corner badges vertically apart whenever the slot number shows', () => {
    // Top badge is ~13px tall and top-aligned; bottom is ~12px and bottom-aligned.
    for (const h of [SLOT_LABEL_MIN_HEIGHT, 43, 60, 84]) {
      const spec = cardTokenSpec(W, h);
      expect(spec.showSlotLabel).toBe(true);
      expect(spec.slotLabel.y + 13).toBeLessThanOrEqual(spec.weight.y - 12 + 1);
    }
  });

  it('keeps the NEXT cursor chip clear of the weight badge', () => {
    // Both sit in the bottom inward corner; anchoring both to the edge drew
    // "▶ NEXT" through "W10" on every cursor card during playback.
    for (const side of ['left', 'right'] as const) {
      const spec = cardTokenSpec(W, H, side);
      expect(Math.abs(spec.cursorBadge.x)).toBeLessThan(Math.abs(spec.weight.x));
      expect(Math.abs(spec.weight.x) - Math.abs(spec.cursorBadge.x)).toBeGreaterThanOrEqual(20);
    }
  });

  it('caps the rail by available width', () => {
    const wide = cardTokenSpec(620, H, 'left');
    const narrow = cardTokenSpec(140, H, 'left');
    expect(wide.accessoryMax).toBeGreaterThan(narrow.accessoryMax);
    expect(narrow.accessoryMax).toBeGreaterThanOrEqual(0);
    expect(wide.accessoryMax).toBeLessThanOrEqual(4);
  });

  it('keeps the corner-label chip a fixed inset from the token edge, independent of label text width', () => {
    // Regression for the "W20 scrim sits on the card edge" bug: the chip's
    // outer edge must land at the same distance from the token edge no
    // matter how wide the rendered label text turns out to be (short "W10"
    // vs a size-N offer's "x2 SLOTS"), at the small token sizes actually
    // shipped (a squeezed mobile board row) as well as the roomy desktop one.
    for (const [w, h] of [[140, SLOT_LABEL_MIN_HEIGHT], [W, H]] as const) {
      for (const side of ['left', 'right'] as const) {
        const spec = cardTokenSpec(w, h, side);
        for (const labelWidth of [10, 24, 48]) {
          const weightBox = chipBox(fakeText(spec.weight.x, spec.weight.y, spec.cornerOriginX, 1, labelWidth, 11));
          const weightOuterX = Math.abs(weightBox.x) + weightBox.width / 2;
          expect(w / 2 - weightOuterX).toBeCloseTo(6);
          const weightOuterY = Math.abs(weightBox.y) + weightBox.height / 2;
          expect(h / 2 - weightOuterY).toBeCloseTo(5);

          const slotBox = chipBox(fakeText(spec.slotLabel.x, spec.slotLabel.y, spec.cornerOriginX, 0, labelWidth, 12));
          const slotOuterX = Math.abs(slotBox.x) + slotBox.width / 2;
          expect(w / 2 - slotOuterX).toBeCloseTo(6);
          const slotOuterY = Math.abs(slotBox.y) + slotBox.height / 2;
          expect(h / 2 - slotOuterY).toBeCloseTo(5);
        }
      }
    }
  });
});

describe('chipBox', () => {
  it('centers on the text\'s true glyph bounds, not its own (possibly corner) origin', () => {
    // origin (1, 0): top-right anchored, as slot labels are on the left column.
    const t = fakeText(100, 50, 1, 0, 20, 12);
    const box = chipBox(t);
    // Text spans x:[80,100] y:[50,62] — the box must be centered on that rect.
    expect(box.x).toBeCloseTo(90);
    expect(box.y).toBeCloseTo(56);
    expect(box.width).toBeCloseTo(20 + CHIP_PAD_X * 2);
    expect(box.height).toBeCloseTo(12 + CHIP_PAD_Y * 2);
  });

  it('pads identically on both sides of both axes for every corner origin', () => {
    for (const originX of [0, 1]) {
      for (const originY of [0, 1]) {
        const t = fakeText(200, 80, originX, originY, 30, 14);
        const box = chipBox(t, 5, 3);
        const textLeft = t.x - originX * t.width;
        const textTop = t.y - originY * t.height;
        const boxLeft = box.x - box.width / 2;
        const boxRight = box.x + box.width / 2;
        const boxTop = box.y - box.height / 2;
        const boxBottom = box.y + box.height / 2;
        expect(textLeft - boxLeft).toBeCloseTo(5);
        expect(boxRight - (textLeft + t.width)).toBeCloseTo(5);
        expect(textTop - boxTop).toBeCloseTo(3);
        expect(boxBottom - (textTop + t.height)).toBeCloseTo(3);
      }
    }
  });

  it('defaults its padding to CHIP_PAD_X / CHIP_PAD_Y', () => {
    const box = chipBox(fakeText(0, 0, 0.5, 0.5, 10, 10));
    expect(box.width).toBe(10 + CHIP_PAD_X * 2);
    expect(box.height).toBe(10 + CHIP_PAD_Y * 2);
  });
});
