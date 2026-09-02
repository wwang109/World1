// FOE DECK EDITOR — the sandbox overlay that authors a custom enemy board
// (docs/sandbox-features-proposal.md §2.2). One module, two layout profiles,
// the same serve-both-scenes pattern as `affixPresentation.ts`: the prep scene
// owns the open/closed state (a class field, so it survives `rebuildScene`)
// and calls `renderFoeDeckEditor` from `create()`; this module owns the draft
// mutations, the geometry, and the drawing.
//
// WHAT IT EDITS: a working `FoeDeckCard[]` seeded from the RESOLVED encounter
// board (so editing an elite starts from the exact board previewed). APPLY is
// the scene's job — it writes `foe.deck`, clears `foe.affix` (a custom deck
// owns the board — the resolver throws on both, §1.1.7) and `syncPrimaryFoe()`.
//
// DELIBERATELY NOT the DeckBuild scenes (§2.2, evaluated in the spec):
// DeckBuild is built around owned inventory (instanceIds, a bag, TEMP HOLDING,
// an economy); a foe deck has none of that — it is "pick cards from the whole
// book, set tiers, optionally socket a gem". What it does need already exists
// as shared pieces used here: the scrim+panel overlay idiom (the prep scenes'
// own foe picker), `gridWindow` for the 183-row catalogue, `clampTierToCard`
// for tier cycling, and `renderActionBar` for the mobile footer.
//
// LIST INPUT FOLLOWS THE WIKI CATALOGUE IDIOM (MobileWikiScene.wireScroll):
// rows inside a masked viewport are NOT interactive objects — Phaser hit-tests
// ignore geometry masks, so an interactive row scrolled out of view would
// still swallow taps. Instead one scene-level pointer trio drags/taps, hits
// are resolved by arithmetic against the row geometry, and cells are windowed
// via `gridWindow` so 183 rows never all exist at once.

import type Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { gemBook, type GemDef } from '../../data/gems';
import { skillBook } from '../../data/skills';
import { clampTierToCard, TIER_ORDER, type BoardPiece, type SkillDef, type SkillTier } from '../../engine/types';
import { FOE_DECK_SLOTS, type FoeDeckCard } from '../../run/encounter';
import { wasPointerConsumedByRebuild } from '../sceneRebuild';
import { GEM_RARITY_COLOR, PROPERTY_LABEL, TIER_COLOR, UI, textRoleFor, type ResolvedTextStyle } from '../theme';
import { renderActionBar } from './ActionBar';
import { auditControlLabel } from './controlLayoutAudit';
import { gemCatalogOrder } from './gemGlossary';
import { gridWindow, inGridWindow } from './gridWindow';
import { attachButtonFeel, hoverFillFor, pressedFill } from './motion';

// ---------------------------------------------------------------------------
// Draft state — owned by the scene as a class field so it survives rebuilds
// ---------------------------------------------------------------------------

export interface FoeDeckDraft {
  /** The working deck. Tiers are stamped explicitly on every edit; a seeded
   * card without a resolved tier keeps `tier` undefined (= authored tier). */
  cards: FoeDeckCard[];
  /** Row whose gem the catalogue is currently picking, or null = card mode. */
  gemPickRow: number | null;
  /** Catalogue scroll offset (0 at top, negative as content moves up — the
   * `gridWindow` sign convention). Reset when the pane switches mode. */
  catalogScroll: number;
  /** Deck-list scroll offset (mobile only; the desktop list always fits). */
  deckScroll: number;
}

/**
 * Seed a draft from the RESOLVED encounter board (`encounter.setup.pieces`),
 * so the editor opens on the exact board the preview shows — affix cards,
 * rank tiers, forceTier stamps and all. Gems travel as ids (`FoeDeckCard`'s
 * contract: the resolver re-sockets the real `Gem` from the book).
 */
export function seedFoeDeckDraft(pieces: readonly BoardPiece[]): FoeDeckDraft {
  return {
    cards: pieces.map((p) => ({
      skillId: p.skillId,
      slot: p.slot,
      ...(p.tier === undefined ? {} : { tier: p.tier }),
      gemId: p.gem?.id ?? null,
    })),
    gemPickRow: null,
    catalogScroll: 0,
    deckScroll: 0,
  };
}

/** Board slots a deck covers (Σ card size; unknown ids count 1 defensively). */
export function deckSlotsUsed(cards: readonly FoeDeckCard[]): number {
  return cards.reduce((sum, c) => sum + (skillBook[c.skillId]?.size ?? 1), 0);
}

/** Whether `skillId` still fits the deck's remaining slots. */
export function canAddToDeck(cards: readonly FoeDeckCard[], skillId: string): boolean {
  return deckSlotsUsed(cards) + (skillBook[skillId]?.size ?? 1) <= FOE_DECK_SLOTS;
}

/**
 * Re-pack slots contiguously in list order — the editor's ONE slot rule
 * (§2.2): every add/remove re-packs; an imported/seeded deck keeps its slots
 * until that first structural edit. Tier/gem edits never re-pack.
 */
export function packFoeDeck(cards: readonly FoeDeckCard[]): FoeDeckCard[] {
  let cursor = 0;
  return cards.map((c) => {
    const packed = { ...c, slot: cursor };
    cursor += skillBook[c.skillId]?.size ?? 1;
    return packed;
  });
}

/** The tier a deck row displays: its explicit stamp, else the authored tier. */
export function deckCardTier(card: FoeDeckCard): SkillTier {
  return card.tier ?? skillBook[card.skillId]?.tier ?? 'bronze';
}

/**
 * The tier chip's tap: bronze→silver→gold→diamond→bronze, skipping tiers
 * below the card's authored floor (`clampTierToCard` — the same floor
 * `createOwnedCard` stamps with, so the editor can never author a tier the
 * sandbox itself refuses to own).
 */
export function cycleDeckTier(skill: SkillDef, current: SkillTier): SkillTier {
  const next = TIER_ORDER[(TIER_ORDER.indexOf(current) + 1) % TIER_ORDER.length]!;
  return clampTierToCard(skill, next) ?? next;
}

/**
 * The prep scenes' DECK row label — AUTO names the resolved pipeline board it
 * previews, CUSTOM carries its own card/slot ledger.
 */
export function deckRowLabel(deck: readonly FoeDeckCard[] | null | undefined, autoCardCount: number): string {
  if (deck == null) return `DECK · AUTO (${autoCardCount} CARD${autoCardCount === 1 ? '' : 'S'})`;
  return `DECK · CUSTOM (${deck.length} CARD${deck.length === 1 ? '' : 'S'} · ${deckSlotsUsed(deck)}/${FOE_DECK_SLOTS} SLOTS)`;
}

// ---------------------------------------------------------------------------
// Geometry — pure, per profile, exported for the layout tests
// ---------------------------------------------------------------------------

interface Rect { x: number; y: number; w: number; h: number }

export interface FoeDeckEditorLayout {
  panel: Rect;
  /** Deck-list viewport (left column on desktop, top band on mobile). */
  deck: Rect;
  /** Catalogue viewport (right column on desktop, bottom band on mobile). */
  catalog: Rect;
  /** Desktop footer button row; null on mobile (the ActionBar is the footer). */
  buttons: Rect | null;
  /** Row box heights/strides — one value for both lists. */
  rowH: number;
  rowGap: number;
}

/** Editor row height — 40px, the mobile min-tap floor (`LayoutProfile.minTap`);
 * the layout audits gate NEW controls at 40 even though some legacy prep
 * steppers sit at 24. Desktop shares it (rows are also pointer targets). */
const ROW_H = 40;
const ROW_GAP = 4;
/** Rows kept live above/below the catalogue viewport. */
const OVERSCAN_ROWS = 2;
/** Pane label band height (the "DECK · n/10 SLOTS" / mode caption line). */
const PANE_LABEL_H = 18;

export function foeDeckEditorLayout(profile: 'desktop' | 'mobile', screenW: number, screenH: number): FoeDeckEditorLayout {
  if (profile === 'desktop') {
    const panel: Rect = { x: (screenW - 1040) / 2, y: (screenH - 720) / 2, w: 1040, h: 720 };
    const pad = 20;
    const headerH = 36;
    const buttonH = ROW_H;
    const contentTop = panel.y + pad + headerH + PANE_LABEL_H;
    const contentBottom = panel.y + panel.h - pad - buttonH - 16;
    const deckW = 400;
    return {
      panel,
      deck: { x: panel.x + pad, y: contentTop, w: deckW, h: contentBottom - contentTop },
      catalog: { x: panel.x + pad + deckW + 16, y: contentTop, w: panel.w - pad * 2 - deckW - 16, h: contentBottom - contentTop },
      buttons: { x: panel.x + pad, y: panel.y + panel.h - pad - buttonH, w: panel.w - pad * 2, h: buttonH },
      rowH: ROW_H,
      rowGap: ROW_GAP,
    };
  }
  // Mobile: full-screen overlay (the `renderPicker` pattern), footer via
  // `renderActionBar` (FOOTER_HEIGHT 40 + 16 bottom margin — mirrored here
  // rather than imported so this stays pure arithmetic for the tests).
  const pad = 10;
  const headerH = 30;
  const deckTop = pad + headerH + PANE_LABEL_H;
  const deckH = 5 * (ROW_H + ROW_GAP) - ROW_GAP; // max ~5 rows visible, scrolls
  const catalogTop = deckTop + deckH + 8 + PANE_LABEL_H;
  const footerTop = screenH - 40 - 16;
  return {
    panel: { x: 0, y: 0, w: screenW, h: screenH },
    deck: { x: pad, y: deckTop, w: screenW - pad * 2, h: deckH },
    catalog: { x: pad, y: catalogTop, w: screenW - pad * 2, h: footerTop - 8 - catalogTop },
    buttons: null,
    rowH: ROW_H,
    rowGap: ROW_GAP,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface FoeDeckEditorOptions {
  profile: 'desktop' | 'mobile';
  screenW: number;
  screenH: number;
  draft: FoeDeckDraft;
  /** Chassis name for the header ("BANDIT DUELIST'S DECK"). */
  foeName: string;
  /** Draft mutated in place → the scene rebuilds this frame. */
  onChange: () => void;
  /** APPLY — only ever called with ≥1 card (the button disables at 0). */
  onApply: (deck: FoeDeckCard[]) => void;
  /** AUTO — back to the authored pipeline (`deck = null`). */
  onAuto: () => void;
  onCancel: () => void;
}

/** Deck-row inner zones, right-aligned: [name…] [tier chip] [gem chip] [✕]. */
const REMOVE_W = 32;
const GEM_CHIP_W = 76;
const TIER_CHIP_W = 64;
const CHIP_GAP = 4;

interface ListRow { objs: Array<{ setVisible(v: boolean): unknown; setY(y: number): unknown; y: number }>; baseY: number }

export function renderFoeDeckEditor(scene: Phaser.Scene, opts: FoeDeckEditorOptions): void {
  const { draft, profile } = opts;
  const L = foeDeckEditorLayout(profile, opts.screenW, opts.screenH);
  const role = (r: Parameters<typeof textRoleFor>[1], ink?: Parameters<typeof textRoleFor>[2]): ResolvedTextStyle => textRoleFor(profile, r, ink);

  // --- scrim + panel (the prep foe-picker overlay idiom) ---
  const scrim = scene.add.rectangle(0, 0, opts.screenW, opts.screenH, UI.shadow, 0.72).setOrigin(0, 0).setInteractive();
  scrim.on('pointerdown', () => { playSfx('uiBack'); opts.onCancel(); });
  const panel = scene.add.rectangle(L.panel.x, L.panel.y, L.panel.w, L.panel.h, UI.panelAlt, 0.98)
    .setOrigin(0, 0).setStrokeStyle(2, UI.border, 1).setInteractive();
  void panel; // swallows scrim clicks under the panel (topOnly input)

  const pad = profile === 'desktop' ? 20 : 10;
  const headerY = L.panel.y + pad;
  scene.add.text(L.panel.x + pad, headerY, `${opts.foeName.toUpperCase()} — CUSTOM DECK`, role('section')).setOrigin(0, 0);
  const used = deckSlotsUsed(draft.cards);
  scene.add.text(L.panel.x + L.panel.w - pad, headerY, `${used}/${FOE_DECK_SLOTS} SLOTS`, role('kicker', { ink: used >= FOE_DECK_SLOTS ? 'cost' : 'capacity' })).setOrigin(1, 0);

  // --- pane labels ---
  const gemMode = draft.gemPickRow !== null && draft.gemPickRow < draft.cards.length;
  const pickName = gemMode ? (skillBook[draft.cards[draft.gemPickRow!]!.skillId]?.name ?? '?').toUpperCase() : '';
  scene.add.text(L.deck.x, L.deck.y - PANE_LABEL_H, 'DECK — editing re-packs the board', role('micro')).setOrigin(0, 0);
  scene.add.text(
    L.catalog.x, L.catalog.y - PANE_LABEL_H,
    gemMode ? `PICK A GEM FOR ${pickName} — NONE clears` : 'CARD BOOK — tap to add a copy',
    role('micro', { ink: gemMode ? 'accent' : 'faint' }),
  ).setOrigin(0, 0);

  // --- masked viewports ---
  const deckMask = rectMask(scene, L.deck);
  const catMask = rectMask(scene, L.catalog);

  // --- deck list (windowed; scrolls on mobile, always fits on desktop) ---
  const stride = L.rowH + L.rowGap;
  const deckContentH = Math.max(0, draft.cards.length * stride - L.rowGap);
  const deckMaxScroll = Math.max(0, deckContentH - L.deck.h);
  draft.deckScroll = clamp(draft.deckScroll, -deckMaxScroll, 0);
  const deckRows: Array<ListRow | undefined> = new Array<ListRow | undefined>(draft.cards.length);
  const ensureDeckRow = (i: number): ListRow | undefined => {
    const existing = deckRows[i];
    if (existing) return existing;
    const card = draft.cards[i];
    if (!card) return undefined;
    const skill = skillBook[card.skillId];
    const tier = deckCardTier(card);
    const gem = card.gemId != null ? gemBook[card.gemId] : undefined;
    const baseY = i * stride;
    const y = L.deck.y + draft.deckScroll + baseY;
    const objs: ListRow['objs'] = [];
    const rowBg = scene.add.rectangle(L.deck.x, y, L.deck.w, L.rowH, i === draft.gemPickRow ? UI.slotHover : UI.panelMuted, 0.95)
      .setOrigin(0, 0).setStrokeStyle(1, i === draft.gemPickRow ? UI.chip : UI.border, i === draft.gemPickRow ? 1 : 0.5);
    objs.push(rowBg);
    // name + size, clamped to the name zone
    const nameW = L.deck.w - 8 - TIER_CHIP_W - CHIP_GAP - GEM_CHIP_W - CHIP_GAP - REMOVE_W - 8;
    const name = scene.add.text(L.deck.x + 8, y + 6, (skill?.name ?? card.skillId).toUpperCase(), role('label')).setOrigin(0, 0);
    clampTextWidth(name, nameW);
    objs.push(name);
    objs.push(scene.add.text(L.deck.x + 8, y + L.rowH - 6, `SIZE ${skill?.size ?? 1} · SLOT ${card.slot}`, role('micro')).setOrigin(0, 1));
    // tier chip
    const tierX = L.deck.x + L.deck.w - REMOVE_W - CHIP_GAP - GEM_CHIP_W - CHIP_GAP - TIER_CHIP_W;
    const tierRect = scene.add.rectangle(tierX, y + (L.rowH - 24) / 2, TIER_CHIP_W, 24, TIER_COLOR[tier], 0.92).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6);
    const tierText = scene.add.text(tierX + TIER_CHIP_W / 2, y + L.rowH / 2, tier.toUpperCase(), role('micro', { ink: 'onAccent' })).setOrigin(0.5);
    auditControlLabel(tierRect, tierText, { name: `foeDeck:tier:${card.skillId}`, horizontalPadding: 2, verticalPadding: 2 });
    objs.push(tierRect, tierText);
    // gem chip
    const gemX = tierX + TIER_CHIP_W + CHIP_GAP;
    const gemRect = scene.add.rectangle(gemX, y + (L.rowH - 24) / 2, GEM_CHIP_W, 24, gem ? GEM_RARITY_COLOR[gem.rarity] : UI.panelAlt, gem ? 0.92 : 1)
      .setOrigin(0, 0).setStrokeStyle(1, gem ? UI.border : UI.chip, 0.6);
    const gemText = scene.add.text(gemX + GEM_CHIP_W / 2, y + L.rowH / 2, gem ? gem.name.toUpperCase() : 'GEM +', gem ? role('micro', { ink: 'onAccent' }) : role('micro', { ink: 'accent' })).setOrigin(0.5);
    auditControlLabel(gemRect, gemText, { name: `foeDeck:gem:${card.skillId}`, horizontalPadding: 2, verticalPadding: 2 });
    objs.push(gemRect, gemText);
    // remove ✕
    const remX = gemX + GEM_CHIP_W + CHIP_GAP;
    objs.push(scene.add.rectangle(remX, y + (L.rowH - 24) / 2, REMOVE_W, 24, UI.badSoft, 0.9).setOrigin(0, 0).setStrokeStyle(1, UI.bad, 0.8));
    objs.push(scene.add.text(remX + REMOVE_W / 2, y + L.rowH / 2, '✕', role('label', { ink: 'alarm' })).setOrigin(0.5));
    for (const o of objs) (o as unknown as Phaser.GameObjects.Rectangle).setMask(deckMask);
    const row: ListRow = { objs, baseY };
    deckRows[i] = row;
    return row;
  };
  const syncDeck = (): void => {
    const win = gridWindow({ count: draft.cards.length, columns: 1, rowStride: stride, cellH: L.rowH, viewportHeight: L.deck.h, scrollY: draft.deckScroll, overscanRows: OVERSCAN_ROWS });
    for (let i = 0; i < deckRows.length; i += 1) {
      if (inGridWindow(win, i)) {
        const row = ensureDeckRow(i);
        if (!row) continue;
        placeRow(row, L.deck.y + draft.deckScroll);
        for (const o of row.objs) o.setVisible(true);
      } else {
        const row = deckRows[i];
        if (row) for (const o of row.objs) o.setVisible(false);
      }
    }
  };
  if (draft.cards.length === 0) {
    scene.add.text(L.deck.x + L.deck.w / 2, L.deck.y + 24, 'No cards — tap the book to add some.', role('body')).setOrigin(0.5, 0);
  }
  syncDeck();

  // --- catalogue (cards, or gems + NONE when a row is picking) ---
  const cards: SkillDef[] = Object.values(skillBook);
  const gems: GemDef[] = gemCatalogOrder(Object.values(gemBook));
  const catCount = gemMode ? gems.length + 1 : cards.length; // +1 = the NONE row
  const catContentH = Math.max(0, catCount * stride - L.rowGap);
  const catMaxScroll = Math.max(0, catContentH - L.catalog.h);
  draft.catalogScroll = clamp(draft.catalogScroll, -catMaxScroll, 0);
  const catRows: Array<ListRow | undefined> = new Array<ListRow | undefined>(catCount);
  const ensureCatRow = (i: number): ListRow | undefined => {
    const existing = catRows[i];
    if (existing) return existing;
    const baseY = i * stride;
    const y = L.catalog.y + draft.catalogScroll + baseY;
    const objs: ListRow['objs'] = [];
    if (gemMode && i === 0) {
      objs.push(scene.add.rectangle(L.catalog.x, y, L.catalog.w, L.rowH, UI.panelMuted, 0.95).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5));
      objs.push(scene.add.text(L.catalog.x + 8, y + L.rowH / 2, 'NONE — clear this socket', role('label')).setOrigin(0, 0.5));
    } else if (gemMode) {
      const gem = gems[i - 1]!;
      objs.push(scene.add.rectangle(L.catalog.x, y, L.catalog.w, L.rowH, UI.panelMuted, 0.95).setOrigin(0, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.7));
      const name = scene.add.text(L.catalog.x + 8, y + L.rowH / 2, gem.name.toUpperCase(), role('label')).setOrigin(0, 0.5);
      const meta = scene.add.text(L.catalog.x + L.catalog.w - 8, y + L.rowH / 2, `${gem.rarity.toUpperCase()} · ${gem.kind === 'stat' ? 'STAT' : 'EFFECT'}`, role('micro')).setOrigin(1, 0.5);
      clampTextWidth(name, L.catalog.w - 16 - meta.width - 8);
      objs.push(name, meta);
    } else {
      const skill = cards[i]!;
      const fits = canAddToDeck(draft.cards, skill.id);
      objs.push(scene.add.rectangle(L.catalog.x, y, L.catalog.w, L.rowH, UI.panelMuted, fits ? 0.95 : 0.5).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5));
      const name = scene.add.text(L.catalog.x + 8, y + L.rowH / 2, skill.name.toUpperCase(), role('label', fits ? undefined : { ink: 'disabled' })).setOrigin(0, 0.5);
      const meta = scene.add.text(
        L.catalog.x + L.catalog.w - 8, y + L.rowH / 2,
        `${PROPERTY_LABEL[skill.property]} · SIZE ${skill.size} · ${skill.tier.toUpperCase()}`,
        role('micro', fits ? undefined : { ink: 'disabled' }),
      ).setOrigin(1, 0.5);
      clampTextWidth(name, L.catalog.w - 16 - meta.width - 8);
      objs.push(name, meta);
    }
    for (const o of objs) (o as unknown as Phaser.GameObjects.Rectangle).setMask(catMask);
    const row: ListRow = { objs, baseY };
    catRows[i] = row;
    return row;
  };
  const syncCat = (): void => {
    const win = gridWindow({ count: catCount, columns: 1, rowStride: stride, cellH: L.rowH, viewportHeight: L.catalog.h, scrollY: draft.catalogScroll, overscanRows: OVERSCAN_ROWS });
    for (let i = 0; i < catRows.length; i += 1) {
      if (inGridWindow(win, i)) {
        const row = ensureCatRow(i);
        if (!row) continue;
        placeRow(row, L.catalog.y + draft.catalogScroll);
        for (const o of row.objs) o.setVisible(true);
      } else {
        const row = catRows[i];
        if (row) for (const o of row.objs) o.setVisible(false);
      }
    }
    thumb.setVisible(catMaxScroll > 0);
    if (catMaxScroll > 0) {
      const thumbH = Math.max(24, (L.catalog.h / (L.catalog.h + catMaxScroll)) * L.catalog.h);
      thumb.setSize(3, thumbH);
      thumb.setPosition(L.catalog.x + L.catalog.w - 2, L.catalog.y + ((-draft.catalogScroll) / catMaxScroll) * (L.catalog.h - thumbH));
    }
  };
  const thumb = scene.add.rectangle(L.catalog.x + L.catalog.w - 2, L.catalog.y, 3, 24, UI.border, 0.8).setOrigin(0.5, 0).setDepth(1);
  syncCat();

  // --- buttons ---
  const applyEnabled = draft.cards.length > 0;
  if (L.buttons) {
    const b = L.buttons;
    const bw = { cancel: 120, auto: 150, apply: 170 };
    const gap = 12;
    editorButton(scene, b.x + b.w - bw.apply, b.y, bw.apply, b.h, 'APPLY', applyEnabled ? 'primary' : 'disabled', role('label', { ink: applyEnabled ? 'onAccent' : 'disabled' }), () => {
      opts.onApply(draft.cards.map((c) => ({ ...c })));
    });
    editorButton(scene, b.x + b.w - bw.apply - gap - bw.auto, b.y, bw.auto, b.h, 'AUTO DECK', 'default', role('label'), opts.onAuto);
    editorButton(scene, b.x + b.w - bw.apply - gap - bw.auto - gap - bw.cancel, b.y, bw.cancel, b.h, 'CANCEL', 'default', role('label'), opts.onCancel);
    scene.add.text(b.x, b.y + b.h / 2, 'AUTO returns the authored board', role('micro')).setOrigin(0, 0.5);
  } else {
    renderActionBar(scene, opts.screenW, opts.screenH, [
      { label: 'AUTO', onPress: () => { playSfx('uiClick'); opts.onAuto(); } },
      { label: 'CANCEL', onPress: () => { playSfx('uiBack'); opts.onCancel(); } },
      // Disabled APPLY still renders (dim) so the row never reflows; its
      // press is a no-op until the deck has a card.
      {
        label: applyEnabled ? 'APPLY' : 'APPLY (0)',
        primary: applyEnabled,
        flex: 1.4,
        onPress: () => {
          if (!applyEnabled) return;
          playSfx('uiClick');
          opts.onApply(draft.cards.map((c) => ({ ...c })));
        },
      },
    ]);
  }

  // --- scene-level drag/tap wiring (the wiki catalogue idiom) ---
  let drag: { pane: 'deck' | 'catalog'; startY: number; startX: number; startScroll: number; moved: number } | null = null;
  const paneAt = (x: number, y: number): 'deck' | 'catalog' | null => {
    if (inRect(L.deck, x, y)) return 'deck';
    if (inRect(L.catalog, x, y)) return 'catalog';
    return null;
  };
  scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
    // See `wasPointerConsumedByRebuild` (sceneRebuild.ts): every editor tap
    // that mutates the draft rebuilds the scene mid-dispatch, and this
    // scene-level listener is re-registered by that rebuild — without the
    // guard the SAME physical tap would immediately start a phantom drag on
    // the freshly laid-out list underneath.
    if (wasPointerConsumedByRebuild(scene, p)) return;
    const pane = paneAt(p.worldX, p.worldY);
    if (!pane) return;
    drag = { pane, startY: p.worldY, startX: p.worldX, startScroll: pane === 'deck' ? draft.deckScroll : draft.catalogScroll, moved: 0 };
  });
  scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
    if (!drag) return;
    drag.moved = Math.max(drag.moved, Math.hypot(p.worldX - drag.startX, p.worldY - drag.startY));
    const dy = p.worldY - drag.startY;
    if (drag.pane === 'deck') {
      draft.deckScroll = clamp(drag.startScroll + dy, -deckMaxScroll, 0);
      syncDeck();
    } else {
      draft.catalogScroll = clamp(drag.startScroll + dy, -catMaxScroll, 0);
      syncCat();
    }
  });
  scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
    // Symmetric guard — `processUpEvents` re-dispatches to a listener
    // re-registered by a mid-dispatch rebuild exactly like `processDownEvents`
    // (see sceneRebuild.ts).
    if (wasPointerConsumedByRebuild(scene, p)) return;
    if (!drag) return;
    const { pane, moved } = drag;
    drag = null;
    if (moved >= 8) return; // a drag, not a tap
    if (pane === 'deck') tapDeckRow(p.worldX, p.worldY);
    else tapCatalogRow(p.worldY);
  });
  scene.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
    const pane = paneAt(p.worldX, p.worldY);
    if (pane === 'deck') { draft.deckScroll = clamp(draft.deckScroll - dy, -deckMaxScroll, 0); syncDeck(); }
    else if (pane === 'catalog') { draft.catalogScroll = clamp(draft.catalogScroll - dy, -catMaxScroll, 0); syncCat(); }
  });

  function tapDeckRow(worldX: number, worldY: number): void {
    const localY = worldY - L.deck.y - draft.deckScroll;
    const i = Math.floor(localY / stride);
    if (i < 0 || i >= draft.cards.length || localY - i * stride > L.rowH) return;
    const card = draft.cards[i]!;
    const skill = skillBook[card.skillId];
    const tierX = L.deck.x + L.deck.w - REMOVE_W - CHIP_GAP - GEM_CHIP_W - CHIP_GAP - TIER_CHIP_W;
    const gemX = tierX + TIER_CHIP_W + CHIP_GAP;
    const remX = gemX + GEM_CHIP_W + CHIP_GAP;
    if (worldX >= remX) {
      // remove → re-pack (the one slot rule)
      draft.cards.splice(i, 1);
      draft.cards = packFoeDeck(draft.cards);
      if (draft.gemPickRow !== null) draft.gemPickRow = null;
    } else if (worldX >= gemX) {
      // gem chip → the catalogue flips to gem mode for this row
      draft.gemPickRow = draft.gemPickRow === i ? null : i;
      draft.catalogScroll = 0;
    } else if (worldX >= tierX && skill) {
      card.tier = cycleDeckTier(skill, deckCardTier(card));
    } else {
      return; // name zone is informational — no sound, no rebuild
    }
    playSfx('uiClick');
    opts.onChange();
  }

  function tapCatalogRow(worldY: number): void {
    const localY = worldY - L.catalog.y - draft.catalogScroll;
    const i = Math.floor(localY / stride);
    if (i < 0 || i >= catCount || localY - i * stride > L.rowH) return;
    if (gemMode) {
      const row = draft.gemPickRow!;
      const card = draft.cards[row];
      if (!card) { draft.gemPickRow = null; opts.onChange(); return; }
      playSfx('uiClick');
      card.gemId = i === 0 ? null : gems[i - 1]!.id;
      draft.gemPickRow = null;
      draft.catalogScroll = 0;
      opts.onChange();
      return;
    }
    const skill = cards[i]!;
    if (!canAddToDeck(draft.cards, skill.id)) return; // full — the row renders dim
    playSfx('uiClick');
    // append at the packed next free slot, then re-pack everything (add is a
    // structural edit — see packFoeDeck's doc)
    draft.cards = packFoeDeck([...draft.cards, { skillId: skill.id, slot: 0, tier: skill.tier, gemId: null }]);
    opts.onChange();
  }
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function rectMask(scene: Phaser.Scene, r: Rect): Phaser.Display.Masks.GeometryMask {
  const g = scene.make.graphics({}, false);
  g.fillStyle(0xffffff);
  g.fillRect(r.x, r.y, r.w, r.h);
  return g.createGeometryMask();
}

/** Move every object in a row so its content-space `baseY` lands under the
 * viewport's current scroll. Rows are built at their CURRENT world y, so each
 * object's offset from the row top is preserved by translating uniformly. */
function placeRow(row: ListRow, contentTopWorldY: number): void {
  const target = contentTopWorldY + row.baseY;
  const first = row.objs[0];
  if (!first) return;
  const dy = target - first.y;
  if (dy === 0) return;
  for (const o of row.objs) o.setY(o.y + dy);
}

/** Single-line clamp with an ellipsis (the prep scenes' `clamped` idiom). */
function clampTextWidth(t: Phaser.GameObjects.Text, maxW: number): void {
  if (t.width <= maxW) return;
  let cut = t.text;
  while (cut.length > 1 && t.width > maxW) {
    cut = cut.slice(0, -1);
    t.setText(`${cut}…`);
  }
}

function editorButton(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number,
  label: string, kind: 'primary' | 'default' | 'disabled',
  style: ResolvedTextStyle, onPress: () => void,
): void {
  const fill = kind === 'primary' ? UI.chip : kind === 'disabled' ? UI.panelMuted : UI.panelAlt;
  const rect = scene.add.rectangle(x, y, w, h, fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, kind === 'disabled' ? 0.4 : 0.8);
  const text = scene.add.text(x + w / 2, y + h / 2, label, style).setOrigin(0.5);
  auditControlLabel(rect, text, { name: `foeDeckEditor:${label}`, horizontalPadding: 6, verticalPadding: 4 });
  if (kind === 'disabled') return;
  rect.setInteractive({ useHandCursor: true });
  attachButtonFeel(scene, rect, {
    fill,
    hover: hoverFillFor(kind === 'primary' ? 'primary' : 'default', UI),
    press: pressedFill(fill),
    follow: [text],
    onPress: () => { playSfx('uiClick'); onPress(); },
  });
}

// Re-export the shared deck types/consts the scenes need alongside the editor,
// so a scene's DECK row and its editor wiring import from ONE place.
export { FOE_DECK_SLOTS };
export type { FoeDeckCard };
