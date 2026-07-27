import { describe, expect, it } from 'vitest';
import { cardTokenSpec, SLOT_LABEL_MIN_HEIGHT, TOKEN_COMPACT_HEIGHT } from '../../src/game/ui/cardTokenSpec';

const W = 620;
const H = 84;

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
});
