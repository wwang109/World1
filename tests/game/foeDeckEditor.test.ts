import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import type { BoardPiece, SkillDef } from '../../src/engine/types';
import { buildEnemyEncounter, FOE_DECK_SLOTS } from '../../src/run/encounter';
import {
  canAddToDeck, cycleDeckTier, deckCardTier, deckRowLabel, deckSlotsUsed,
  foeDeckEditorLayout, packFoeDeck, seedFoeDeckDraft,
} from '../../src/game/ui/foeDeckEditor';
import { MOBILE_PROFILE, DESKTOP_PROFILE } from '../../src/game/layoutProfile';

/**
 * FOE DECK EDITOR — the pure half (docs/sandbox-features-proposal.md §2.2).
 * The overlay's draft mutations, slot arithmetic, tier cycling and geometry
 * are plain functions, so they are driven from Node the way `gridWindow` and
 * `controlLayoutAudit` are; the Phaser half is covered by the browser pass.
 *
 * The LAST describe pins the load-bearing line of the whole feature: both
 * prep scenes passing `deck` into their PREVIEW `buildEnemyEncounter` call.
 * Without it a deck-carrying config would preview the authored board while
 * fighting the custom one — the exact class of preview-vs-fight dishonesty
 * the affix bug already taught this codebase (resolveBattle.ts's lesson).
 * Source-scan stance borrowed from `pointerConsumptionAudit.test.ts`:
 * deliberately cheap to keep true, expensive to silently regress.
 */

describe('game/ui/foeDeckEditor: seeding from the resolved encounter', () => {
  it('maps resolved pieces 1:1 — slots kept, tier kept when stamped, gems as ids', () => {
    // A real resolved board: elite bandit_duelist at rank 2 carries stamped
    // tiers; sockets are exercised via a hand-built piece too.
    const enc = buildEnemyEncounter('bandit_duelist', 3, 'elite', 2);
    const draft = seedFoeDeckDraft(enc.setup.pieces);
    expect(draft.cards).toHaveLength(enc.setup.pieces.length);
    draft.cards.forEach((card, i) => {
      const piece = enc.setup.pieces[i]!;
      expect(card.skillId).toBe(piece.skillId);
      expect(card.slot).toBe(piece.slot);
      expect(card.tier).toBe(piece.tier);
      expect(card.gemId).toBe(piece.gem?.id ?? null);
    });
    expect(draft.gemPickRow).toBeNull();
  });

  it('carries a socketed gem as its id, and an unstamped tier as undefined', () => {
    const pieces: BoardPiece[] = [
      { skillId: 'sword_slash', slot: 0, gem: gemBook.swift_charm },
      { skillId: 'fireball', slot: 1 },
    ];
    const draft = seedFoeDeckDraft(pieces);
    expect(draft.cards[0]).toEqual({ skillId: 'sword_slash', slot: 0, gemId: 'swift_charm' });
    expect(draft.cards[1]).toEqual({ skillId: 'fireball', slot: 1, gemId: null });
    expect(draft.cards[1]!.tier).toBeUndefined();
  });

  it('a seeded deck round-trips through the resolver to the identical board', () => {
    const enc = buildEnemyEncounter('bandit_duelist', 3, 'elite', 2);
    const draft = seedFoeDeckDraft(enc.setup.pieces);
    // APPLY writes the draft as foe.deck; the resolver must reproduce the
    // exact pieces the editor was seeded from (deck replaces the pipeline,
    // and the seed IS that pipeline's output).
    const rebuilt = buildEnemyEncounter('bandit_duelist', 3, 'elite', 2, [], null, undefined, draft.cards);
    expect(rebuilt.setup.pieces.map((p) => ({ skillId: p.skillId, slot: p.slot, tier: p.tier ?? null, gem: p.gem?.id ?? null })))
      .toEqual(enc.setup.pieces.map((p) => ({ skillId: p.skillId, slot: p.slot, tier: p.tier ?? null, gem: p.gem?.id ?? null })));
  });
});

describe('game/ui/foeDeckEditor: slot arithmetic (the 10-slot cap)', () => {
  it('deckSlotsUsed sums card sizes from the book', () => {
    // fireball is size 2 (the default bag's own comment relies on it).
    expect(skillBook.fireball!.size).toBe(2);
    expect(deckSlotsUsed([
      { skillId: 'sword_slash', slot: 0 },
      { skillId: 'fireball', slot: 1 },
    ])).toBe(1 + 2);
  });

  it('canAddToDeck blocks exactly at the boundary — adds are blocked when the size does not fit, so APPLY overflow is unreachable', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ skillId: 'sword_slash', slot: i }));
    expect(deckSlotsUsed(nine)).toBe(9);
    expect(canAddToDeck(nine, 'sword_slash')).toBe(true); // 9 + 1 = 10 fits
    expect(canAddToDeck(nine, 'fireball')).toBe(false);   // 9 + 2 = 11 does not
    const ten = [...nine, { skillId: 'sword_slash', slot: 9 }];
    expect(canAddToDeck(ten, 'sword_slash')).toBe(false);
  });

  it('packFoeDeck re-packs contiguously in list order, respecting sizes', () => {
    const packed = packFoeDeck([
      { skillId: 'fireball', slot: 7 },     // size 2
      { skillId: 'sword_slash', slot: 0 },  // size 1
      { skillId: 'crippling_strike', slot: 3 }, // size 2
    ]);
    expect(packed.map((c) => c.slot)).toEqual([0, 2, 3]);
    // and the packed deck is resolver-legal
    expect(deckSlotsUsed(packed)).toBeLessThanOrEqual(FOE_DECK_SLOTS);
  });

  it('duplicates are allowed (affix precedent: addNamedCards installs copies)', () => {
    const cards = packFoeDeck([
      { skillId: 'sword_slash', slot: 0 },
      { skillId: 'sword_slash', slot: 0 },
    ]);
    expect(cards.map((c) => c.slot)).toEqual([0, 1]);
    const enc = buildEnemyEncounter('bandit_duelist', 1, 'normal', 0, [], null, undefined, cards);
    expect(enc.setup.pieces.filter((p) => p.skillId === 'sword_slash')).toHaveLength(2);
  });
});

describe('game/ui/foeDeckEditor: tier cycling', () => {
  it('cycles bronze→silver→gold→diamond→bronze on a bronze-floored card', () => {
    const skill = skillBook.sword_slash!;
    expect(skill.tier).toBe('bronze'); // the live book is all-Bronze today
    expect(cycleDeckTier(skill, 'bronze')).toBe('silver');
    expect(cycleDeckTier(skill, 'silver')).toBe('gold');
    expect(cycleDeckTier(skill, 'gold')).toBe('diamond');
    expect(cycleDeckTier(skill, 'diamond')).toBe('bronze');
  });

  it('skips tiers below the authored floor (mocked silver-floor card — the live book is all-Bronze, same stance as the codec tier-floor suite)', () => {
    const silverFloored = { ...skillBook.sword_slash!, tier: 'silver' } as SkillDef;
    // diamond wraps to bronze, which is below the floor → clamped to silver
    expect(cycleDeckTier(silverFloored, 'diamond')).toBe('silver');
    expect(cycleDeckTier(silverFloored, 'silver')).toBe('gold');
  });

  it('deckCardTier reads the explicit stamp, else the authored tier', () => {
    expect(deckCardTier({ skillId: 'sword_slash', slot: 0, tier: 'gold' })).toBe('gold');
    expect(deckCardTier({ skillId: 'sword_slash', slot: 0 })).toBe('bronze');
  });
});

describe('game/ui/foeDeckEditor: the DECK row label', () => {
  it('AUTO names the resolved board it previews; CUSTOM carries its own ledger', () => {
    expect(deckRowLabel(null, 4)).toBe('DECK · AUTO (4 CARDS)');
    expect(deckRowLabel(undefined, 1)).toBe('DECK · AUTO (1 CARD)');
    expect(deckRowLabel([
      { skillId: 'sword_slash', slot: 0 },
      { skillId: 'fireball', slot: 1 },
    ], 4)).toBe('DECK · CUSTOM (2 CARDS · 3/10 SLOTS)');
  });
});

describe('game/ui/foeDeckEditor: layout geometry (both profiles)', () => {
  const cases = [
    ['desktop', DESKTOP_PROFILE.canvas.width, DESKTOP_PROFILE.canvas.height],
    ['mobile', MOBILE_PROFILE.canvas.width, MOBILE_PROFILE.canvas.height],
  ] as const;

  for (const [profile, w, h] of cases) {
    it(`${profile}: panel and viewports are inside the canvas with positive area`, () => {
      const L = foeDeckEditorLayout(profile, w, h);
      for (const r of [L.panel, L.deck, L.catalog]) {
        expect(r.w).toBeGreaterThan(0);
        expect(r.h).toBeGreaterThan(0);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(w);
        expect(r.y + r.h).toBeLessThanOrEqual(h);
      }
      // Rows are NEW controls → the 40px min-tap floor, both profiles.
      expect(L.rowH).toBeGreaterThanOrEqual(40);
    });
  }

  it('desktop: the deck list seats all 10 max-size rows WITHOUT scrolling (the no-deck-scroll claim in the renderer)', () => {
    const L = foeDeckEditorLayout('desktop', DESKTOP_PROFILE.canvas.width, DESKTOP_PROFILE.canvas.height);
    const contentH = FOE_DECK_SLOTS * (L.rowH + L.rowGap) - L.rowGap;
    expect(contentH).toBeLessThanOrEqual(L.deck.h);
  });

  it('desktop: the footer button row sits inside the panel below both viewports', () => {
    const L = foeDeckEditorLayout('desktop', DESKTOP_PROFILE.canvas.width, DESKTOP_PROFILE.canvas.height);
    expect(L.buttons).not.toBeNull();
    const b = L.buttons!;
    expect(b.y).toBeGreaterThanOrEqual(Math.max(L.deck.y + L.deck.h, L.catalog.y + L.catalog.h));
    expect(b.y + b.h).toBeLessThanOrEqual(L.panel.y + L.panel.h);
    expect(b.h).toBeGreaterThanOrEqual(40);
  });

  it('mobile: the catalogue viewport clears the ActionBar footer (no buttons rect — the bar IS the footer)', () => {
    const L = foeDeckEditorLayout('mobile', MOBILE_PROFILE.canvas.width, MOBILE_PROFILE.canvas.height);
    expect(L.buttons).toBeNull();
    // renderActionBar geometry: footerY = H - FOOTER_HEIGHT(40) - MARGIN(16).
    const footerY = MOBILE_PROFILE.canvas.height - 40 - 16;
    expect(L.catalog.y + L.catalog.h).toBeLessThanOrEqual(footerY);
    // The deck band shows ~5 rows and scrolls for more (spec §2.2).
    expect(Math.floor((L.deck.h + L.rowGap) / (L.rowH + L.rowGap))).toBe(5);
  });
});

describe('prep scenes: the preview deck passthrough (the load-bearing line)', () => {
  // Source pin, the pointerConsumptionAudit stance: the preview call and the
  // battle request must resolve the SAME deck recipe. `battleRequestOf` and
  // `battleTimeline` are pinned by their own suites; the two PREVIEW calls
  // had nothing holding them until this.
  const SCENES = join(process.cwd(), 'src', 'game', 'scenes');

  it('DesktopPrepScene resolves cfg.deck ?? null in its preview buildEnemyEncounter call', () => {
    const src = readFileSync(join(SCENES, 'DesktopPrepScene.ts'), 'utf8');
    expect(src).toMatch(/buildEnemyEncounter\(cfg\.enemyId,[^;]*cfg\.deck \?\? null\)/s);
  });

  it('MobilePrepScene resolves foe.deck ?? null in its preview buildEnemyEncounter call', () => {
    const src = readFileSync(join(SCENES, 'MobilePrepScene.ts'), 'utf8');
    expect(src).toMatch(/buildEnemyEncounter\(foe\.enemyId,[^;]*foe\.deck \?\? null\)/s);
  });
});
