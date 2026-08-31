import { cardTokenSpec, chipBox, type TokenBox, type TokenSide } from './cardTokenSpec';

/**
 * CARD CELL LAYOUT — where a SCENE's own chip goes when the cell already
 * holds a `CardToken`.
 *
 * THE BUG CLASS THIS EXISTS TO CLOSE (third and fourth instance, 2026-08-31).
 * `CardToken` owns its four corners: the INWARD TOP corner carries the slot
 * number, or — on an unplaced OFFER — the `×N SLOTS` span badge that tells a
 * player how many board slots a card eats; the INWARD BOTTOM corner carries
 * the weight badge and the accessory rail; the OUTWARD TOP corner is the
 * opt-in `ⓘ` inspect button, for which `cardTokenSpec` reserves a full-height
 * text strip. A scene that draws its OWN chip at "the cell's top-right"
 * therefore lands on top of a badge that is already there:
 *
 *   MERGE PICKER  `attachCellInspect` drew a 22px `ⓘ` in that corner and
 *                 printed `×2 SLO[i]`. Fixed at its cause in `a194fc3` by
 *                 handing `onInspect` to the token, so the button lands in
 *                 the OUTWARD corner inside a RESERVED strip.
 *   MOBILE WIKI   the catalogue's `PL n` chip. `renderCardCatalog` dodged the
 *                 badge by dropping the chip 24px on a multi-slot card —
 *                 and `applyScroll` then re-placed it at a flat `+8`, so the
 *                 dodge survived exactly until the player scrolled one pixel.
 *                 297 px² over `×2 SLOTS`, on all 52 multi-slot cards.
 *   MOBILE SHOP   the shelf row's `N G` price chip used that corner outright
 *                 (`x = W-16, y+6, origin(1,0)`), reading as `×2 SL 2 G`.
 *                 12 of 21 shops on one seed, 18 collisions, 210 px² each.
 *
 * THE RULE, AND WHY IT IS GEOMETRY AND NOT A DODGE. A scene chip does not get
 * to share the token's box at all. The CELL is split into a `token` half and
 * a RESERVED half that is the only place the scene may draw, and the two are
 * disjoint by construction — so there is no offset to re-derive at scroll
 * time, no per-card special case, and nothing that can drift when one call
 * site is edited and its twin is not. Both DESKTOP surfaces already worked
 * this way by hand (the desktop wiki's PL row under the card, the desktop
 * shop's price strip under it); this module is that shape, named, shared by
 * all four scenes, and unit-tested — `tests/game/cardChipClearanceAudit.test.ts`.
 *
 * TWO RESERVATIONS, EACH DERIVED FROM ITS OWN CELL'S SHAPE:
 *
 *   `captionCell` — a strip UNDER the token, full cell width. What a TALL,
 *   NARROW cell wants (both wiki grids: 192px wide on mobile, and the desktop
 *   gallery's portrait card). A side gutter there would eat the width the
 *   card's NAME needs and start truncating card names in a card catalogue.
 *
 *   `gutterCell` — a column beside the token on its INWARD edge. What a WIDE,
 *   SHORT row wants (the mobile shop shelf: 392x92). A strip under that row
 *   would cost 24 of the shelf viewport's ~205 visible pixels, and the row is
 *   wide enough that a price column is free.
 *
 * WHY THE TOKEN'S HEIGHT IS NEVER THE THING THAT SHRINKS. Taking the strip
 * out of the token instead of out of the cell looks cheaper and is not:
 * `CardToken`'s name line sits at a FIXED `dy: -14` about the token centre
 * while the corner badge is pinned to the token's TOP, so the two close on
 * each other as the token gets shorter and meet at about h=83 — the mobile
 * wiki's 84px row is already within a pixel of that. Shrinking a token to
 * make room for a chip would trade a chip-over-badge collision for a
 * name-over-badge one. Both helpers therefore keep `token.h`/`token.w` as
 * given and grow or reserve out of the CELL.
 *
 * Pure module: no Phaser import (`cardTokenSpec` is pure too).
 */

/** A rect in the scene's own coordinates, anchored top-left. */
export interface CellBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A cell split into the token and the strip reserved UNDER it. */
export interface CaptionCell {
  token: CellBox;
  /** The ONLY box the scene may draw its own chip into. */
  caption: CellBox;
}

/** A cell split into the token and the column reserved BESIDE it. */
export interface GutterCell {
  token: CellBox;
  /** The ONLY box the scene may draw its own chip into. */
  gutter: CellBox;
}

/**
 * Height of the `PL n` row under a wiki catalogue card, both platforms —
 * `DesktopWikiScene.renderGallery`'s own `plRowH`, now shared with the mobile
 * catalogue rather than re-invented there as an inward-corner chip.
 */
export const WIKI_PL_ROW_H = 20;
/** Inset of the PL label from the top of its row — desktop's `cardH + 4`. */
export const WIKI_PL_ROW_INSET = 4;

/**
 * Height of the price strip under a DESKTOP shop shelf card —
 * `DesktopShopScene.renderShelf`'s own `priceStripH`, unchanged.
 */
export const SHELF_PRICE_STRIP_H = 24;

/**
 * Width of the price column beside a MOBILE shop shelf row. Sized off the
 * widest price the depth curve can actually print rather than off the
 * shelf's opening waves: `src/run/shop.ts`'s `priceScaleNum` is unbounded and
 * non-decreasing, so a wave-1000 Gold offer lists at `168 G` (measured live)
 * and a wave-2000 one at `410 G` — five glyphs at the mobile `label` rung
 * (11px bold), which renders 30px wide. 56 holds seven glyphs with margin on
 * both sides, which covers every price this economy can reach before the
 * ladder runs out of waves; `cardChipClearanceAudit.test.ts` asserts the fit
 * against a modelled `99999 G` rather than trusting it.
 */
export const SHELF_PRICE_GUTTER_W = 56;

/**
 * Height of ONE mobile shop shelf CARD cell (`MobileShopScene.renderShelf`) —
 * token AND its price gutter, since the gutter takes width, not height. Lives
 * here, not in the scene, so `cardChipClearanceAudit.test.ts` measures the
 * SHIPPING cell rather than a retyped copy of it.
 */
export const MOBILE_SHELF_CARD_CELL_H = 92;

/** Height of a DESKTOP shop shelf card's own token (`DesktopShopScene`). */
export const DESKTOP_SHELF_CARD_TOKEN_H = 130;

/** Height of the MOBILE wiki catalogue card's own token (`MobileWikiScene`). */
export const MOBILE_WIKI_TOKEN_H = 84;

/**
 * Split `cell` into the token and a full-width caption strip beneath it. The
 * token keeps the cell's width and everything the strip does not take.
 */
export function captionCell(cell: CellBox, captionH: number): CaptionCell {
  const tokenH = Math.max(0, cell.h - captionH);
  return {
    token: { x: cell.x, y: cell.y, w: cell.w, h: tokenH },
    caption: { x: cell.x, y: cell.y + tokenH, w: cell.w, h: captionH },
  };
}

/**
 * The cell HEIGHT a caption cell needs to hold a token of `tokenH` — the
 * inverse of `captionCell`, so a scene sizes its row stride from the token
 * height it wants instead of subtracting the strip by hand at two call sites.
 */
export function captionCellHeight(tokenH: number, captionH: number): number {
  return tokenH + captionH;
}

/**
 * Split `cell` into the token and a column on the token's INWARD edge (the
 * right for `side: 'left'`, the left for `side: 'right'` — the same mirror
 * `cardTokenSpec` uses). The token keeps the cell's full height.
 */
export function gutterCell(cell: CellBox, gutterW: number, side: TokenSide = 'left'): GutterCell {
  const tokenW = Math.max(0, cell.w - gutterW);
  const tokenX = side === 'left' ? cell.x : cell.x + gutterW;
  const gutterX = side === 'left' ? cell.x + tokenW : cell.x;
  return {
    token: { x: tokenX, y: cell.y, w: tokenW, h: cell.h },
    gutter: { x: gutterX, y: cell.y, w: gutterW, h: cell.h },
  };
}

/** Centre point of a box — what a scene hands `add.text(...).setOrigin(0.5)`. */
export function boxCenter(box: CellBox): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * The chip a label of `textW` x `textH` occupies when it is CENTRED in `box`
 * — what the audit measures, and the same rect a scene's plate would draw.
 */
export function centeredChipBox(box: CellBox, textW: number, textH: number): CellBox {
  return { x: box.x + (box.w - textW) / 2, y: box.y + (box.h - textH) / 2, w: textW, h: textH };
}

/** `cardTokenSpec`'s center-relative `TokenBox` translated into cell coords. */
function toCellBox(token: CellBox, box: TokenBox): CellBox {
  return {
    x: token.x + token.w / 2 + box.x - box.width / 2,
    y: token.y + token.h / 2 + box.y - box.height / 2,
    w: box.width,
    h: box.height,
  };
}

/**
 * The pill `CardToken` draws in its INWARD TOP corner for a token occupying
 * `token` — the slot number, or an offer's `×N SLOTS` span badge — given that
 * label's measured glyph box. `null` when the token is too short to draw it
 * at all (`cardTokenSpec`'s `showSlotLabel`).
 *
 * This is the box every finding in this module's header landed on. It is
 * exported so an audit can assert a scene chip stays out of it WITHOUT
 * retyping `CardToken`'s corner arithmetic — the numbers come from the same
 * `cardTokenSpec` + `chipBox` pair the token itself renders from.
 */
export function tokenSlotBadgeBox(
  token: CellBox,
  side: TokenSide,
  textW: number,
  textH: number,
): CellBox | null {
  const spec = cardTokenSpec(token.w, token.h, side);
  if (!spec.showSlotLabel) return null;
  const pill = chipBox({
    x: spec.slotLabel.x, y: spec.slotLabel.y,
    originX: spec.cornerOriginX, originY: 0,
    width: textW, height: textH,
  });
  return toCellBox(token, pill);
}

/** The pill `CardToken` draws in its INWARD BOTTOM corner (the weight badge). */
export function tokenWeightBadgeBox(
  token: CellBox,
  side: TokenSide,
  textW: number,
  textH: number,
): CellBox {
  const spec = cardTokenSpec(token.w, token.h, side);
  const pill = chipBox({
    x: spec.weight.x, y: spec.weight.y,
    originX: spec.cornerOriginX, originY: 1,
    width: textW, height: textH,
  });
  return toCellBox(token, pill);
}

/** True when two cell boxes share any area. */
export function cellBoxesOverlap(a: CellBox, b: CellBox): boolean {
  return cellBoxOverlapArea(a, b) > 0;
}

/** Shared area of two cell boxes, in px². */
export function cellBoxOverlapArea(a: CellBox, b: CellBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// ---------------------------------------------------------------------------
// THE TEETH — the PRE-FIX geometry, kept so the audit can prove it collided.
// Same stance as `battleHpBlockLayout.ts`'s `legacy*` exports: an audit that
// cannot demonstrate the defect it was written for has stopped being able to
// see it. Nothing in `src/game` calls these; only the test does.
// ---------------------------------------------------------------------------

/**
 * PRE-2026-08-31 `MobileShopScene.renderShelf`: the price chip anchored to the
 * SCREEN's right edge at the row's top — `add.text(W - 16, y + 6, 'N G')`,
 * `origin(1, 0)`, `setPadding(4, 2, 4, 2)` — which is `CardToken`'s inward top
 * corner. `screenW` is the viewport width the row was laid out against.
 */
export function legacyShelfPriceChipBox(
  cell: CellBox, screenW: number, textW: number, textH: number,
): CellBox {
  const padX = 4;
  const padY = 2;
  const right = screenW - 16;
  return { x: right - textW - padX * 2, y: cell.y + 6, w: textW + padX * 2, h: textH + padY * 2 };
}

/**
 * PRE-2026-08-31 `MobileWikiScene`: the `PL n` chip pinned to the token's own
 * inward top corner, `origin(col === 0 ? 1 : 0, 0)`, `setPadding(4, 2, 4, 2)`.
 *
 * `scrolled` is the whole defect. `renderCardCatalog` placed it at
 * `+ (skill.size > 1 ? 24 : 8)` — a hand-tuned dodge of the `×N SLOTS` badge —
 * and `applyScroll` re-placed it at a flat `+ 8`, so every card reverted to the
 * colliding y the moment the catalogue moved.
 */
export function legacyWikiPlChipBox(
  cell: CellBox, side: TokenSide, textW: number, textH: number,
  multiSlot: boolean, scrolled: boolean,
): CellBox {
  const padX = 4;
  const padY = 2;
  const dy = scrolled ? 8 : (multiSlot ? 24 : 8);
  const w = textW + padX * 2;
  const x = side === 'left' ? cell.x + cell.w - 8 - w : cell.x + 8;
  return { x, y: cell.y + dy, w, h: textH + padY * 2 };
}
