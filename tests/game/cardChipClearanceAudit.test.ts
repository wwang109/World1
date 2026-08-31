import { describe, expect, it } from 'vitest';
import {
  boxCenter, captionCell, captionCellHeight, cellBoxOverlapArea, centeredChipBox,
  gutterCell, legacyShelfPriceChipBox, legacyWikiPlChipBox,
  tokenSlotBadgeBox, tokenWeightBadgeBox,
  DESKTOP_SHELF_CARD_TOKEN_H, MOBILE_SHELF_CARD_CELL_H, MOBILE_WIKI_TOKEN_H,
  SHELF_PRICE_GUTTER_W, SHELF_PRICE_STRIP_H, WIKI_PL_ROW_H, WIKI_PL_ROW_INSET,
  type CellBox,
} from '../../src/game/ui/cardCellLayout';
import { cardTokenSpec, TOKEN_COMPACT_HEIGHT, type TokenSide } from '../../src/game/ui/cardTokenSpec';
import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../../src/game/layoutProfile';

/**
 * CARD-CHIP CLEARANCE AUDIT — a SCENE's own chip may never be drawn into a
 * corner `CardToken` already owns, on EITHER platform, at rest OR scrolled.
 *
 * THE TWO SHIPPED BUGS THIS EXISTS TO CATCH (both found 2026-08-31, both the
 * same shape as the merge picker's `x2 SLO[i]` that `a194fc3` fixed at its
 * cause — this is the third and fourth instance of one class):
 *
 *   MOBILE WIKI. `MobileWikiScene.renderCardCatalog` placed its `PL n` chip at
 *   `top + baseY + (skill.size > 1 ? 24 : 8)` — a hand-tuned dodge of the
 *   `xN SLOTS` badge `CardToken` draws in its inward TOP corner. `applyScroll`,
 *   a hundred lines away, re-placed the SAME chip at a flat `worldTop + 8`. So
 *   the dodge was correct at rest and gone the instant the catalogue moved one
 *   pixel: 297 px2 of `PL 10` over `x2 SLOTS`, on all 52 multi-slot cards.
 *
 *   MOBILE SHOP. `MobileShopScene.renderShelf` drew the price at
 *   `W - 16, y + 6, origin(1, 0)` — that same inward top corner, with no dodge
 *   at all. `x2 SL 2 G` on 12 of 21 shops on one seed, 18 collisions, 210 px2
 *   each, in run mode as well as the sandbox.
 *
 * WHY BOTH SURVIVED. `ruleClearanceAudit.test.ts` (2026-08-28) closed this hole
 * for a drawn RULE crossing a label; `battlePanelOverlapAudit.test.ts`
 * (2026-08-30) closed it for two labels drawn by the SAME renderer. Neither can
 * see a chip drawn by a SCENE landing on a badge drawn by a shared COMPONENT —
 * the two halves of the collision are authored in different files, and the
 * scene never asks the component where its badges are. This is the audit for
 * that seam, and `cardCellLayout.ts`'s `tokenSlotBadgeBox`/`tokenWeightBadgeBox`
 * are how it asks: those read `cardTokenSpec` + `chipBox`, the very functions
 * `CardToken` renders its corners from, so nothing here is a retyped copy of
 * the token's arithmetic.
 *
 * HOW IT CHECKS. Same stance as both predecessors: drive the REAL placement
 * from Node. `cardCellLayout.ts` IS the split all four scenes now use — each
 * scene builds its cell rect, hands it to `captionCell`/`gutterCell` and draws
 * exactly what comes back — so this is the shipping arithmetic. Glyph boxes are
 * modelled at a deliberately GENEROUS `TEXT_PX_PER_CHAR`/`TEXT_LINE_BOX`, so
 * every modelled chip is BIGGER than the real one and the audit can only be
 * stricter than the screen, never looser. Pixel-exactness is covered by the
 * 412x892 / 1440x900 crops in `scratchpad/chipaudit/shots/`.
 *
 * THE TEETH are at the bottom: the same predicates asked about the PRE-FIX
 * geometry, which `cardCellLayout.ts` still exports as `legacy*` for the
 * purpose. If those ever go quiet, this audit has stopped being able to see the
 * defect it was written for.
 */

/** Advance width per character / font size, bold body face. Generous (real
 * bold uppercase measures ~0.55-0.62 at 9-11px). */
const TEXT_PX_PER_CHAR = 0.62;
/** Rendered line box / font size. Generous (measured 1.11-1.15). */
const TEXT_LINE_BOX = 1.2;

function glyphs(text: string, fontSize: number): { w: number; h: number } {
  return { w: text.length * fontSize * TEXT_PX_PER_CHAR, h: fontSize * TEXT_LINE_BOX };
}

/** The widest span badge the catalogue can print. `CardToken` draws it at 9px. */
const SPAN_BADGE = glyphs('×3 SLOTS', 9);
/** The widest slot number an owned token prints (a size-3 card at slots 8-10). */
const SLOT_NUMBER = glyphs('8-10', 10);
/** The widest weight badge realistically reachable, at the badge's own 9px. */
const WEIGHT_BADGE = glyphs('W999', 9);

/**
 * Shop prices at DEPTH. `src/run/shop.ts`'s `priceScaleNum` is unbounded and
 * non-decreasing (x1 through wave 5, x3 at 25, x6 at 100, x10 at 200, x50 at
 * 1000), so the label a shelf prints grows with the ladder forever. Measured
 * live: wave 41 lists `15 G`, wave 500 `66 G`, wave 1000 `168 G`. The five-digit
 * entry is headroom no live wave reaches — if it ever fits, every real price
 * does.
 */
const MOBILE_PRICES = ['2 G', '15 G', '168 G', '9999 G', '99999 G'];
const DESKTOP_PRICES = ['2 GOLD', '15 GOLD', '168 GOLD', '9999 GOLD', '99999 GOLD'];

function contains(outer: CellBox, inner: CellBox): boolean {
  return inner.x >= outer.x - 0.001 && inner.y >= outer.y - 0.001
    && inner.x + inner.w <= outer.x + outer.w + 0.001
    && inner.y + inner.h <= outer.y + outer.h + 0.001;
}

/** Every corner box `CardToken` claims for itself in `token`, NAMED — so a
 * failure says WHICH badge was buried, not merely that something was. */
function tokenOwnedBoxes(token: CellBox, side: TokenSide): Array<{ name: string; box: CellBox }> {
  const out: Array<{ name: string; box: CellBox }> = [];
  const span = tokenSlotBadgeBox(token, side, SPAN_BADGE.w, SPAN_BADGE.h);
  if (span) out.push({ name: '×N SLOTS badge', box: span });
  const slot = tokenSlotBadgeBox(token, side, SLOT_NUMBER.w, SLOT_NUMBER.h);
  if (slot) out.push({ name: 'slot-number badge', box: slot });
  out.push({ name: 'weight badge', box: tokenWeightBadgeBox(token, side, WEIGHT_BADGE.w, WEIGHT_BADGE.h) });
  return out;
}

/** What a chip at `chip` collides with inside `token`, named. */
function collisions(chip: CellBox, token: CellBox, side: TokenSide): string[] {
  const out: string[] = [];
  for (const { name, box } of tokenOwnedBoxes(token, side)) {
    const area = cellBoxOverlapArea(chip, box);
    if (area > 0) out.push(`${name} (${Math.round(area)} px2)`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE SHIPPED CELLS. Widths are BRACKETED rather than retyped: a scene derives
// its cell width from the live viewport, so pinning one number would only pin
// one window size. Every entry below spans the narrowest and widest cell each
// surface can produce between its design canvas and the grown viewports
// `runScreenLayout.test.ts` already pins.
// ---------------------------------------------------------------------------

/** Mobile wiki catalogue: `(W - 20 - ROW_GAP) / 2` per column, W in 412..640. */
const MOBILE_WIKI_CELL_WIDTHS = [(412 - 20 - 8) / 2, (640 - 20 - 8) / 2];
/** Mobile shop shelf row: `W - 20`, W in 412..640. */
const MOBILE_SHELF_WIDTHS = [412 - 20, 640 - 20];
/** Desktop shelf card: `Math.min(260, ...)`, floored by `gridColsFor`'s 240px
 * ideal at the narrowest shelf band. */
const DESKTOP_SHELF_WIDTHS = [200, 240, 260];
/** Desktop wiki gallery: 5 columns of the grid band, 1440..1746 wide. */
const DESKTOP_WIKI_CELL_WIDTHS = [180, 220, 260];

describe('card-chip clearance: the reserved strip is disjoint from the token', () => {
  it('captionCell splits a cell into two boxes that tile it exactly and never overlap', () => {
    const cell: CellBox = { x: 17, y: 23, w: 192, h: 104 };
    const { token, caption } = captionCell(cell, WIKI_PL_ROW_H);
    expect(cellBoxOverlapArea(token, caption)).toBe(0);
    expect(token.h + caption.h).toBe(cell.h);
    expect(token.w).toBe(cell.w);
    expect(caption.w).toBe(cell.w);
    expect(caption.y).toBe(token.y + token.h);
    expect(contains(cell, token)).toBe(true);
    expect(contains(cell, caption)).toBe(true);
  });

  it('gutterCell splits a cell into two boxes that tile it exactly, mirrored by side', () => {
    const cell: CellBox = { x: 10, y: 200, w: 392, h: MOBILE_SHELF_CARD_CELL_H };
    const left = gutterCell(cell, SHELF_PRICE_GUTTER_W, 'left');
    expect(cellBoxOverlapArea(left.token, left.gutter)).toBe(0);
    expect(left.token.w + left.gutter.w).toBe(cell.w);
    // side 'left' = text on the left, INWARD edge on the right: the gutter is
    // on the inward side, so it never sits over the name/effects/affinity block.
    expect(left.gutter.x).toBe(left.token.x + left.token.w);

    const right = gutterCell(cell, SHELF_PRICE_GUTTER_W, 'right');
    expect(cellBoxOverlapArea(right.token, right.gutter)).toBe(0);
    expect(right.gutter.x).toBe(cell.x);
    expect(right.token.x).toBe(cell.x + SHELF_PRICE_GUTTER_W);
  });

  it('captionCellHeight is the exact inverse of captionCell', () => {
    for (const tokenH of [43, 84, 130, 320]) {
      for (const capH of [WIKI_PL_ROW_H, SHELF_PRICE_STRIP_H]) {
        const cell: CellBox = { x: 0, y: 0, w: 200, h: captionCellHeight(tokenH, capH) };
        expect(captionCell(cell, capH).token.h).toBe(tokenH);
      }
    }
  });
});

describe('card-chip clearance: MOBILE WIKI catalogue cell', () => {
  for (const cardW of MOBILE_WIKI_CELL_WIDTHS) {
    for (const side of ['left', 'right'] as const) {
      const label = `${Math.round(cardW)}px column, side "${side}"`;
      const cellH = captionCellHeight(MOBILE_WIKI_TOKEN_H, WIKI_PL_ROW_H);
      const cell: CellBox = { x: 10, y: 142, w: cardW, h: cellH };
      const { token, caption } = captionCell(cell, WIKI_PL_ROW_H);
      // The PL label is centred in the caption row (`setOrigin(0.5, 0)` at
      // `caption.y + WIKI_PL_ROW_INSET`), at the `kicker` rung on mobile.
      const pl = glyphs('PL 100', MOBILE_PROFILE.font.tiny);
      const chip: CellBox = {
        x: boxCenter(caption).x - pl.w / 2,
        y: caption.y + WIKI_PL_ROW_INSET,
        w: pl.w, h: pl.h,
      };

      it(`${label}: the PL chip hits nothing CardToken draws`, () => {
        expect(collisions(chip, token, side)).toEqual([]);
      });

      it(`${label}: the PL chip stays inside its reserved row and inside the cell`, () => {
        expect(contains(caption, chip)).toBe(true);
        expect(contains(cell, chip)).toBe(true);
      });

      it(`${label}: the token keeps its full card face (not the compact variant)`, () => {
        expect(token.h).toBeGreaterThanOrEqual(TOKEN_COMPACT_HEIGHT);
        expect(cardTokenSpec(token.w, token.h, side).compact).toBe(false);
        expect(cardTokenSpec(token.w, token.h, side).showSlotLabel).toBe(true);
      });
    }
  }
});

describe('card-chip clearance: MOBILE SHOP shelf card row', () => {
  for (const rowW of MOBILE_SHELF_WIDTHS) {
    const cell: CellBox = { x: 10, y: 168, w: rowW, h: MOBILE_SHELF_CARD_CELL_H };
    const { token, gutter } = gutterCell(cell, SHELF_PRICE_GUTTER_W, 'left');

    for (const price of MOBILE_PRICES) {
      const g = glyphs(price, MOBILE_PROFILE.font.label);
      const chip = centeredChipBox(gutter, g.w, g.h);

      it(`${rowW}px row: "${price}" hits nothing CardToken draws`, () => {
        expect(collisions(chip, token, 'left')).toEqual([]);
      });

      it(`${rowW}px row: "${price}" fits its reserved gutter (the depth-price question)`, () => {
        expect(contains(gutter, chip)).toBe(true);
        expect(contains(cell, chip)).toBe(true);
      });
    }

    it(`${rowW}px row: the token keeps its full card face and its span badge`, () => {
      const spec = cardTokenSpec(token.w, token.h, 'left');
      expect(spec.compact).toBe(false);
      expect(spec.showSlotLabel).toBe(true);
      expect(token.h).toBe(MOBILE_SHELF_CARD_CELL_H);
    });
  }
});

describe('card-chip clearance: DESKTOP shop shelf card cell', () => {
  for (const cardW of DESKTOP_SHELF_WIDTHS) {
    const cellH = captionCellHeight(DESKTOP_SHELF_CARD_TOKEN_H, SHELF_PRICE_STRIP_H);
    const cell: CellBox = { x: 40, y: 200, w: cardW, h: cellH };
    const { token, caption } = captionCell(cell, SHELF_PRICE_STRIP_H);

    for (const price of DESKTOP_PRICES) {
      const g = glyphs(price, DESKTOP_PROFILE.font.tiny);
      const chip = centeredChipBox(caption, g.w, g.h);

      it(`${cardW}px card: "${price}" hits nothing CardToken draws`, () => {
        expect(collisions(chip, token, 'left')).toEqual([]);
      });

      it(`${cardW}px card: "${price}" fits its reserved price strip`, () => {
        expect(contains(caption, chip)).toBe(true);
      });
    }
  }
});

describe('card-chip clearance: DESKTOP wiki gallery cell', () => {
  for (const cardW of DESKTOP_WIKI_CELL_WIDTHS) {
    const cardH = Math.round(cardW * (690 / 420));
    const cell: CellBox = { x: 60, y: 180, w: cardW, h: captionCellHeight(cardH, WIKI_PL_ROW_H) };
    const { token, caption } = captionCell(cell, WIKI_PL_ROW_H);
    const pl = glyphs('PL 100', DESKTOP_PROFILE.font.tiny);
    const chip: CellBox = {
      x: boxCenter(caption).x - pl.w / 2, y: caption.y + WIKI_PL_ROW_INSET, w: pl.w, h: pl.h,
    };

    it(`${cardW}px card: the PL chip stays inside its reserved row, clear of the card`, () => {
      expect(cellBoxOverlapArea(chip, token)).toBe(0);
      expect(contains(caption, chip)).toBe(true);
    });
  }
});

/**
 * WHY THE TOKEN'S HEIGHT IS NEVER WHAT SHRINKS TO MAKE ROOM. Taking the strip
 * out of the TOKEN instead of out of the CELL is the cheaper-looking fix and it
 * trades one collision for another: `CardToken`'s name line is pinned at a fixed
 * `dy: -14` about the token CENTRE while the corner badge is pinned to the
 * token's TOP, so the two close on each other as the token gets shorter. This
 * pins the threshold, and pins that every shipped token clears it.
 */
describe('card-chip clearance: the token height the corner badge needs', () => {
  function nameClearsSlotBadge(w: number, h: number, side: TokenSide): boolean {
    const token: CellBox = { x: 0, y: 0, w, h };
    const badge = tokenSlotBadgeBox(token, side, SPAN_BADGE.w, SPAN_BADGE.h);
    if (!badge) return true;
    const spec = cardTokenSpec(w, h, side);
    const nameTop = h / 2 + spec.name.dy - (spec.name.fontSize * TEXT_LINE_BOX) / 2;
    return badge.y + badge.h <= nameTop;
  }

  it('a token shorter than ~83px puts its own NAME under its own span badge', () => {
    expect(nameClearsSlotBadge(392, 62, 'left')).toBe(false);
    expect(nameClearsSlotBadge(392, 70, 'left')).toBe(false);
    expect(nameClearsSlotBadge(392, 90, 'left')).toBe(true);
  });

  it('every shipped card token clears it', () => {
    expect(nameClearsSlotBadge(392, MOBILE_SHELF_CARD_CELL_H, 'left')).toBe(true);
    expect(nameClearsSlotBadge(192, MOBILE_WIKI_TOKEN_H, 'left')).toBe(true);
    expect(nameClearsSlotBadge(192, MOBILE_WIKI_TOKEN_H, 'right')).toBe(true);
    expect(nameClearsSlotBadge(260, DESKTOP_SHELF_CARD_TOKEN_H, 'left')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// THE TEETH.
// ---------------------------------------------------------------------------

describe('card-chip clearance: REJECTS the pre-2026-08-31 geometry', () => {
  it('mobile wiki: the PL chip lands ON the span badge after ANY scroll, on both columns', () => {
    const cardW = (412 - 20 - 8) / 2;
    const pl = glyphs('PL 10', MOBILE_PROFILE.font.small);
    for (const side of ['left', 'right'] as const) {
      // The PRE-FIX cell was the token alone (84px, no reserved row).
      const cell: CellBox = { x: 10, y: 142, w: cardW, h: MOBILE_WIKI_TOKEN_H };

      // AT REST the dodge worked — which is exactly why the bug shipped.
      const atRest = legacyWikiPlChipBox(cell, side, pl.w, pl.h, true, false);
      expect(collisions(atRest, cell, side)).toEqual([]);

      // SCROLLED, `applyScroll`'s flat `+8` put it straight back on the badge.
      const scrolled = legacyWikiPlChipBox(cell, side, pl.w, pl.h, true, true);
      const hits = collisions(scrolled, cell, side);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((h) => h.startsWith('×N SLOTS'))).toBe(true);
      // ~297 px2 was measured live on a real drag; the modelled glyphs are
      // bigger, so the modelled area may only be larger.
      const badge = tokenSlotBadgeBox(cell, side, SPAN_BADGE.w, SPAN_BADGE.h)!;
      expect(cellBoxOverlapArea(scrolled, badge)).toBeGreaterThanOrEqual(297);
    }
  });

  it('mobile shop: the price chip lands ON the span badge with no dodge at all', () => {
    const screenW = 412;
    const cell: CellBox = { x: 10, y: 168, w: screenW - 20, h: MOBILE_SHELF_CARD_CELL_H };
    for (const price of ['2 G', '11 G', '168 G']) {
      const g = glyphs(price, MOBILE_PROFILE.font.small);
      const chip = legacyShelfPriceChipBox(cell, screenW, g.w, g.h);
      const hits = collisions(chip, cell, 'left');
      expect(hits.some((h) => h.startsWith('×N SLOTS')), `"${price}"`).toBe(true);
    }
  });

  it('the fixed geometry is clean on the SAME inputs the legacy geometry fails', () => {
    // Same card, same wave, same viewport — only the placement changed.
    const screenW = 412;
    const cell: CellBox = { x: 10, y: 168, w: screenW - 20, h: MOBILE_SHELF_CARD_CELL_H };
    const { token, gutter } = gutterCell(cell, SHELF_PRICE_GUTTER_W, 'left');
    const g = glyphs('11 G', MOBILE_PROFILE.font.label);
    expect(collisions(centeredChipBox(gutter, g.w, g.h), token, 'left')).toEqual([]);
  });
});
