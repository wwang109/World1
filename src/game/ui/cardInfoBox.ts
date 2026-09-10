import Phaser from 'phaser';
import type { SkillDef } from '../../engine/types';
import { renderSkillText } from '../../engine/keywords/compose';
import { FONT, UI } from '../theme';
import { stripCardTextMarkup } from './cardTextMarkup';
import { cardGlossaryEntries } from './cardHoverEntries';
import { gemHoverEntries } from './gemPresentation';
import type { GemDef } from '../../data/gems';
import { eventBodyScrollThumb } from './runEventStoryLayout';
import { wasPointerConsumedByRebuild } from '../sceneRebuild';

/**
 * THE TWO INK ROLES THIS BOX USES, named once instead of at each call site.
 *
 * Hoisted (2026-09-06) rather than added to: this file's raw-literal budget in
 * `textRoleAudit.test.ts` is 2, and the gem block below needs the same title
 * ink the glossary titles use. Naming them holds the count at 2 while the
 * number of USES grows — which is the direction the ratchet is asking for
 * anyway (the honest end-state for both is `INK`/`theme.ts`).
 */
const TITLE_INK = '#ffd98a';
const BODY_INK = '#f1efe8';

/** Explicit lifetime for detail panels that rerender without rebuilding their scene. */
export interface CardInfoBoxHandle {
  destroy(): void;
  /**
   * The y of every entry boundary, and the total content height, exactly as
   * the layout below recorded them while laying out. Exposed so a test can
   * measure an ENTRY without re-deriving where entries begin: the pin that
   * needed this had guessed "texts come in title/body pairs from index 0",
   * which pairs the CARD'S OWN FACE LINE with the first title and then walks
   * one text out of step forever, under-measuring the tallest entry (96px
   * where the real answer is 108px, `TEMPO TOLL`). Reading the renderer's own
   * numbers cannot go out of step with the renderer.
   */
  readonly entryTops: readonly number[];
  readonly contentHeight: number;
}

/**
 * "What this card does" block: the card's GENERATED face text
 * (`renderSkillText`, markup stripped), then a
 * title and optional body per glossary entry the card's face uses (type badge,
 * weight, board footprint, rank, Power Level, and one entry per mechanical
 * keyword — bleed/poison/burn/riders).
 * Masked to `(x, y, w, h)` and drag/wheel-scrollable whenever content
 * overflows that box — the SAME small-scroll idiom the deck-build socket
 * panel already uses for its gem pouch (mask + pointerdown/move/up + wheel,
 * each gated by its own hit-test so unrelated scroll regions never collide).
 * Pure rendering: reads a `SkillDef` already resolved elsewhere, decides
 * nothing about gameplay.
 */
export function renderCardInfoBox(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  skill: SkillDef,
  /**
   * `depth` (2026-09-06) puts the box inside a MODAL OVERLAY. Every original
   * caller (DeckBuild's socket panel, MobileDraft's detail, Shop) draws it into
   * a freshly rebuilt scene where the default depth is fine; `MobileWikiScene`'s
   * card detail is a veil at depth 3000+, so without this the glossary rendered
   * UNDERNEATH the veil — present in the scene graph, invisible to the player,
   * which is the same class of silent loss as a destroyed word. Optional, so
   * the existing callers are untouched.
   */
  /**
   * `gem` (2026-09-06) is THE SOCKETED GEM, when this card has one — rendered
   * as its OWN labelled block instead of being mixed into the card's clauses.
   *
   * Both socket panels pass `resolveDisplaySkill(skill, piece)`, which APPENDS
   * the gem's actions to `effects` (marked `fromGem`) so the face's numbers
   * reflect the socket. That is right for a damage/heal number the gem bumps,
   * and wrong for the gem's own extra lines: they used to read as if the card
   * had always done them, with nothing telling a player which half they owned.
   * So this box now SPLITS them — the card's own clauses under its own text,
   * the gem's under a `GEM EFFECT` header (user-locked 2026-09-06: *"its jus
   * for gem for the hover it should say Gem effect or something"*) — on both
   * platforms, from one function. Omitted = no gem = byte-identical to before.
   * It rides in `opts` rather than taking a positional slot so no existing
   * caller (five of them, one already passing `{ depth }`) has to move.
   */
  opts: { titleFontSize?: number; bodyFontSize?: number; depth?: number; gem?: GemDef | null } = {},
): CardInfoBoxHandle {
  const gem = opts.gem;
  const pad = 10;
  const wrapW = w - pad * 2;
  const titleSize = opts.titleFontSize ?? 10;
  const bodySize = opts.bodyFontSize ?? 9;

  const maskShape = scene.make.graphics({}, false);
  maskShape.fillStyle(0xffffff);
  maskShape.fillRect(x, y, w, h);
  const mask = maskShape.createGeometryMask();

  // Invisible interactive "swallow" rect over the whole box: some callers
  // (the mobile bag/draft detail overlays) sit this box directly over a
  // full-screen veil whose OWN pointerdown closes the overlay — without this,
  // a tap/drag-to-scroll here would fall through to the veil (nothing else in
  // the box is interactive) and dismiss the overlay instead of scrolling it.
  const hitSurface = scene.add.rectangle(x, y, w, h, 0xffffff, 0.001)
    .setOrigin(0, 0).setInteractive().setDepth(opts.depth ?? 0);

  const container = scene.add.container(x + pad, y).setDepth(opts.depth ?? 0);
  let cursorY = 0;
  /**
   * The y offset each ENTRY starts at — used to snap scrolling so the TOP of
   * the viewport is always the first line of an entry, never the middle of a
   * sentence. Recorded as the entries are laid out, so it cannot disagree with
   * them (the alternative, re-deriving boundaries from measured text heights
   * afterwards, is the kind of second derivation this file's siblings keep
   * getting caught by).
   */
  const entryTops: number[] = [];
  const markEntry = (): void => { entryTops.push(cursorY); };
  const addLine = (text: string, color: string, size: number, bold: boolean, gapAfter: number): void => {
    const t = scene.add.text(0, cursorY, text, {
      fontFamily: FONT.body, fontStyle: bold ? 'bold' : 'normal', fontSize: `${size}px`, color,
      wordWrap: { width: wrapW, useAdvancedWrap: true }, lineSpacing: 2,
    }).setOrigin(0, 0);
    container.add(t);
    cursorY += t.height + gapAfter;
  };

  // THE CARD'S OWN LINES ONLY. `fromGem` is the resolver's own provenance mark
  // (`GemAppended`, engine/types.ts), set by `resolveEffectiveSkill` and never
  // by content — so this split reads the same field the engine does instead of
  // re-deriving which actions came from where.
  const own: SkillDef = gem
    ? { ...skill, effects: skill.effects.filter((a) => a.fromGem !== true) }
    : skill;
  addLine(stripCardTextMarkup(renderSkillText(own)), UI.textAccent, bodySize + 1, true, 10);
  // THE GEM BLOCK SITS DIRECTLY UNDER THE CARD'S OWN TEXT, before the card's
  // universal entries (type / weight / footprint / tier / PL). Measured, not
  // guessed: this box is 108px tall on mobile and scrolls, and with the gem
  // appended LAST its header was below the fold behind five card entries — a
  // player would have had to scroll to learn their socket did anything. Two
  // facts, in the order they were chosen: what the card does, then what the
  // gem adds.
  if (gem) {
    // The gem's header + its generated face, then the SHARED definitions its
    // keywords open — the same entries a CARD carrying that keyword opens.
    const [header, ...definitions] = gemHoverEntries(gem);
    if (header) {
      markEntry();
      addLine(header.title.toUpperCase(), TITLE_INK, titleSize, true, 2);
      addLine(header.body, UI.textAccent, bodySize, true, 8);
    }
    for (const entry of definitions) {
      markEntry();
      addLine(entry.title.toUpperCase(), TITLE_INK, titleSize, true, 2);
      addLine(entry.body, BODY_INK, bodySize, false, 8);
    }
  }
  for (const entry of cardGlossaryEntries(own)) {
    markEntry();
    const hasBody = entry.body.trim().length > 0;
    addLine(entry.title.toUpperCase(), TITLE_INK, titleSize, true, hasBody ? 2 : 8);
    if (hasBody) addLine(entry.body, BODY_INK, bodySize, false, 8);
  }

  container.setMask(mask);
  const contentH = cursorY;
  const maxScroll = Math.max(0, contentH - h);
  /** Track / thumb / fade — created only when the box actually scrolls, and
   * torn down with it (the handle is used by panels that rerender in place). */
  const scrollDecorations: Phaser.GameObjects.GameObject[] = [];
  let removeInputListeners = (): void => {};
  let destroyed = false;
  const handle: CardInfoBoxHandle = {
    entryTops,
    contentHeight: contentH,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      removeInputListeners();
      container.clearMask();
      mask.destroy();
      maskShape.destroy();
      hitSurface.destroy();
      for (const decoration of scrollDecorations) decoration.destroy();
      for (const child of [...container.list]) child.destroy();
      container.destroy();
    },
  };
  if (maxScroll <= 0) return handle;

  /**
   * THE BOX THAT HOLDS THE ANSWERS MUST NOT DO WHAT THE FACE WAS FIXED FOR
   * DOING (2026-09-06, audit). It scrolled from the day it was written and
   * showed NOTHING to say so — no thumb, no track, no fade, no chevron. At
   * 1440x900 the desktop Wiki gives it ~156px, which holds the card's own text
   * plus three entries, so `(+MDEF) SUFFIX` / `TYPED SHIELDS` /
   * `POISON (AFFINITY)` sat below an invisible fold on the very screen the
   * migration had just made responsible for teaching them.
   *
   * Three affordances, cheapest first:
   *   TRACK + THUMB — the SAME shape mobile events already use
   *     (`eventBodyScrollThumb`, ui/runEventStoryLayout.ts), reused rather than
   *     re-derived so there is one scroll-thumb rule in `src/game`.
   *   ENTRY SNAP — the viewport top always lands on an entry's first line, so
   *     no definition is ever cut mid-sentence at the TOP edge.
   *   EDGE FADES — an edge that still crosses an entry cuts a sentence, and a
   *     hard cut there reads as the sentence ENDING. A fade says "continues".
   *     One per side, each shown only when there is really more content that
   *     way, so they double as direction hints.
   *
   * THE FADES ARE `Rectangle`s AT `UI.bg, 0.55`, WIDTH MINUS THE TRACK — the
   * SAME shape both shop shelves already use for the same job
   * (`DesktopShopScene`/`MobileShopScene`'s `shelfFadeTop`/`shelfFadeBottom`,
   * a scrolling masked list needing edge hints beside a thumb). The first
   * version of this used a `Graphics` gradient, which was a SECOND fade idiom
   * in `src/game` for one problem — and it broke
   * `tests/game/mobileWikiLayout.test.ts` outright, because a `Graphics` was a
   * capability no caller of this function had ever needed. `fillGradientStyle`
   * now appears nowhere but `FantasyCardTemplateV2`'s static art scrim, which
   * is not a scroll affordance at all.
   */
  const trackW = 4;
  const trackX = x + w - trackW;
  const track = scene.add.rectangle(trackX, y + 2, 3, h - 4, UI.border, 0.28)
    .setOrigin(0.5, 0).setDepth(opts.depth ?? 0);
  const initialThumb = eventBodyScrollThumb(h - 4, h, contentH, 0);
  const thumb = scene.add.rectangle(trackX, y + 2, trackW, initialThumb.height, UI.chip, 0.95)
    .setOrigin(0.5, 0).setDepth(opts.depth ?? 0);
  const fadeH = Math.min(14, Math.round(h / 4));
  const fadeTop = scene.add.rectangle(x, y, w - trackW, fadeH, UI.bg, 0.55)
    .setOrigin(0, 0).setDepth(opts.depth ?? 0).setVisible(false);
  const fadeBottom = scene.add.rectangle(x, y + h - fadeH, w - trackW, fadeH, UI.bg, 0.55)
    .setOrigin(0, 0).setDepth(opts.depth ?? 0);
  scrollDecorations.push(track, thumb, fadeTop, fadeBottom);

  let scrollY = 0;
  let dragging = false;
  let startY = 0;
  let startScroll = 0;
  /** Clamp, snap the top to an entry boundary, then move everything together. */
  const applyScroll = (next: number): void => {
    const clamped = Phaser.Math.Clamp(next, -maxScroll, 0);
    // Nearest entry boundary at or above the requested top. `0` is always a
    // valid boundary (the card's own text), and the very bottom is kept
    // reachable so the last entry can always be read in full.
    let snapped = clamped;
    if (-clamped >= maxScroll - 1) snapped = -maxScroll;
    else {
      let best = 0;
      for (const top of entryTops) {
        if (top <= -clamped + 0.5 && top > best) best = top;
      }
      snapped = -Math.min(best, maxScroll);
    }
    scrollY = snapped;
    container.setY(y + scrollY);
    const geometry = eventBodyScrollThumb(h - 4, h, contentH, -scrollY);
    thumb.setY(y + 2 + geometry.offset);
    // Each fade only where there really IS more content that way, so the
    // pair reads as direction hints rather than permanent decoration (the
    // shop shelves' own rule).
    fadeTop.setVisible(-scrollY > 1);
    fadeBottom.setVisible(-scrollY < maxScroll - 1);
  };
  const inBox = (px: number, py: number): boolean => px >= x && px <= x + w && py >= y && py <= y + h;
  const onPointerDown = (p: Phaser.Input.Pointer): void => {
    // See `wasPointerConsumedByRebuild` (sceneRebuild.ts) — this box is
    // mounted inside dialogs (gem socket panel, card detail, …) that a
    // sibling button can close via `rerender()`; without this, that same
    // click can start a phantom scroll-drag over whatever now sits at this
    // pixel in the rebuilt frame.
    if (wasPointerConsumedByRebuild(scene, p)) return;
    if (!inBox(p.worldX, p.worldY)) return;
    dragging = true;
    startY = p.worldY;
    startScroll = scrollY;
  };
  const onPointerMove = (p: Phaser.Input.Pointer): void => {
    if (!dragging) return;
    applyScroll(startScroll + (p.worldY - startY));
  };
  // Trivial today (just clears the local `dragging` flag), but `pointerup`
  // gets the same two-phase re-dispatch risk as `pointerdown` — see
  // `wasPointerConsumedByRebuild`'s doc comment — so it is guarded on the
  // same terms as its sibling above rather than being a silent exception.
  const onPointerUp = (p: Phaser.Input.Pointer): void => {
    if (wasPointerConsumedByRebuild(scene, p)) return;
    dragging = false;
  };
  const onWheel = (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number): void => {
    if (!inBox(pointer.worldX, pointer.worldY)) return;
    applyScroll(scrollY - dy);
  };
  scene.input.on('pointerdown', onPointerDown);
  scene.input.on('pointermove', onPointerMove);
  scene.input.on('pointerup', onPointerUp);
  scene.input.on('wheel', onWheel);
  removeInputListeners = () => {
    scene.input.off('pointerdown', onPointerDown);
    scene.input.off('pointermove', onPointerMove);
    scene.input.off('pointerup', onPointerUp);
    scene.input.off('wheel', onWheel);
  };
  return handle;
}
