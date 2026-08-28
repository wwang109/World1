import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import { cardOfferableAtTier, type SkillTier } from '../../src/engine/types';
import {
  buildRunMergeViewModel, layoutMergePicker, MERGE_CHIP_H, mergeChipIdeal,
} from '../../src/game/ui/runMergeViewModel';
import { TOKEN_COMPACT_HEIGHT } from '../../src/game/ui/cardTokenSpec';
import { cardRowIdeal, FEATURE_CARD_ROW_H, layoutFeatureGrid, type Box } from '../../src/game/ui/runRewardGeometry';
import { runScreenTemplate, type Rect, type RunTemplatePlatform } from '../../src/game/ui/runScreenTemplate';
import { MERGE_INPUT_COUNT, resolveEventChoice, type MergeCardsOffer } from '../../src/run/events';
import { DRAFT_SET_KEYS, rollStartDraft } from '../../src/run/draft';
import {
  applyDraftResult, availableChoices, chooseNode, createRun, leaveShop, recordBattleResult,
  type RunBagSlot, type RunBoardPiece, type RunState,
} from '../../src/run/runState';

/**
 * THE MERGE PICKER'S VIEW MODEL — the pure half of the only run screen where a
 * tap DESTROYS three owned cards (`src/game/ui/runMergeViewModel.ts`, drawn by
 * `RunRewardPanel.ts`'s `renderRunMergeCardsPicker` on both platforms).
 *
 * The thing worth testing here is not the pixels, it is the PROMISE: the trade
 * has to be legible before it is taken. So this file asserts that every one of
 * the three cards about to be consumed is named — by card name, by grade, and
 * by where it is sitting — beside the three candidates, and that the geometry
 * fits both bands into the REAL reward template on BOTH platforms rather than
 * quietly clipping the half that shows the price.
 *
 * The last block runs a REAL offer out of the REAL resolver through the model,
 * so a change to `MergeCardsOffer`'s shape cannot pass here while breaking the
 * screen.
 */

const ALL = Object.values(skillBook);
const SIZE1 = ALL.filter((s) => s.size === 1 && cardOfferableAtTier(s, 'bronze')).map((s) => s.id);
const PLATFORMS: readonly RunTemplatePlatform[] = ['desktop', 'mobile'];

function offerOf(consumed: MergeCardsOffer['consumed'], candidates: readonly string[], from: SkillTier, to: SkillTier): MergeCardsOffer {
  return { from, to, consumed, candidates: candidates.map((skillId) => ({ skillId, tier: to })) };
}

// ---------------------------------------------------------------------------
describe('buildRunMergeViewModel: the price is named, not counted', () => {
  const offer = offerOf(
    [
      { instanceId: 'card_1', skillId: SIZE1[0]!, tier: 'bronze', location: 'bag', index: 2 },
      { instanceId: 'card_2', skillId: SIZE1[1]!, tier: 'bronze', location: 'board', index: 0 },
      { instanceId: 'card_3', skillId: SIZE1[0]!, tier: 'bronze', location: 'board', index: 1 },
    ],
    [SIZE1[3]!, SIZE1[4]!, SIZE1[5]!],
    'bronze',
    'silver',
  );
  const pieces = [{ slot: 4 }, { slot: 7 }];

  it('names all three inputs — real card names, not ids or a bare count', () => {
    const vm = buildRunMergeViewModel(offer, pieces);
    expect(vm.spent).toHaveLength(MERGE_INPUT_COUNT);
    expect(vm.spent.map((s) => s.name)).toEqual([
      skillBook[SIZE1[0]!]!.name, skillBook[SIZE1[1]!]!.name, skillBook[SIZE1[0]!]!.name,
    ]);
    expect(vm.spent.map((s) => s.instanceId)).toEqual(['card_1', 'card_2', 'card_3']);
    expect(vm.spent.every((s) => s.tierLabel === 'BRONZE')).toBe(true);
  });

  it('says WHERE each one is sitting — a board piece by its 1-based slot, a bag spare as BAG', () => {
    const vm = buildRunMergeViewModel(offer, pieces);
    expect(vm.spent.map((s) => s.whereLabel)).toEqual(['BAG', 'BOARD 5', 'BOARD 8']);
    // ...which is the ONLY thing separating the first and third entries: same
    // card, same tier, two different instances. A model that dropped the
    // location would be asking the player to pick between identical rows.
    expect(vm.spent[0]!.name).toBe(vm.spent[2]!.name);
    expect(vm.spent[0]!.whereLabel).not.toBe(vm.spent[2]!.whereLabel);
  });

  it('degrades to a bare BOARD rather than a WRONG slot when the board is not passed', () => {
    const vm = buildRunMergeViewModel(offer);
    expect(vm.spent.map((s) => s.whereLabel)).toEqual(['BAG', 'BOARD', 'BOARD']);
  });

  it('states the whole trade in one line, and the tier the output really arrives at', () => {
    const vm = buildRunMergeViewModel(offer, pieces);
    expect(vm.title).toBe('3 BRONZE → 1 SILVER');
    expect(vm.pickCaption).toContain('SILVER');
    expect(vm.spentCaption).toContain('SPENT');
    expect(vm.from).toBe('bronze');
    expect(vm.to).toBe('silver');
  });

  it('resolves every candidate AT the output tier, not at the book tier', () => {
    const vm = buildRunMergeViewModel(offer, pieces);
    expect(vm.candidates).toHaveLength(3);
    for (const cand of vm.candidates) {
      expect(cand.tier).toBe('silver');
      expect(cand.skill.tier).toBe('silver');
      expect(cand.skill.id).toBe(cand.skillId);
    }
  });

  it('drops an unknown candidate id instead of rendering a nameless tappable card', () => {
    const broken = offerOf(offer.consumed, [SIZE1[3]!, 'not_a_real_card', SIZE1[5]!], 'bronze', 'silver');
    const vm = buildRunMergeViewModel(broken, pieces);
    expect(vm.candidates).toHaveLength(2);
    expect(vm.candidates.map((c) => c.skillId)).not.toContain('not_a_real_card');
  });

  it('a narrower offer (a nearly-full bag) still reads as a legible trade', () => {
    const thin = offerOf(offer.consumed, [SIZE1[3]!], 'silver', 'gold');
    const vm = buildRunMergeViewModel(thin, pieces);
    expect(vm.title).toBe('3 SILVER → 1 GOLD');
    expect(vm.candidates).toHaveLength(1);
    expect(vm.spent).toHaveLength(MERGE_INPUT_COUNT);
  });
});

// ---------------------------------------------------------------------------
/** Containment for either shape the layout code speaks — a `Box` (`w`/`h`,
 * what `layoutFeatureGrid` returns) or a `Rect` (`width`/`height`, what the
 * template declares). */
function within(inner: Box | Rect, outer: Rect): boolean {
  const w = 'w' in inner ? inner.w : inner.width;
  const h = 'w' in inner ? inner.h : inner.height;
  return inner.x >= outer.x - 1e-6 && inner.y >= outer.y - 1e-6
    && inner.x + w <= outer.x + outer.width + 1e-6
    && inner.y + h <= outer.y + outer.height + 1e-6;
}

describe('layoutMergePicker: both halves of the trade fit the real template, on both platforms', () => {
  for (const platform of PLATFORMS) {
    const t = runScreenTemplate(platform).contentSlots.reward;

    it(`${platform}: the spent strip and the candidate grid never overlap`, () => {
      const bands = layoutMergePicker(t.detail, t.feature, platform, MERGE_INPUT_COUNT);
      expect(bands.spent.height).toBeGreaterThan(0);
      expect(bands.candidates.height).toBeGreaterThan(0);
      expect(bands.spent.y + bands.spent.height).toBeLessThanOrEqual(bands.candidates.y + 1e-6);
    });

    it(`${platform}: both bands stay inside the panel the template reserved`, () => {
      const bands = layoutMergePicker(t.detail, t.feature, platform, MERGE_INPUT_COUNT);
      const band: Rect = {
        x: t.detail.x,
        y: t.detail.y,
        width: t.detail.width,
        height: t.feature.y + t.feature.height - t.detail.y,
      };
      expect(within(bands.spent, band)).toBe(true);
      expect(within(bands.candidates, band)).toBe(true);
      expect(within(bands.candidates, t.panel)).toBe(true);
    });

    it(`${platform}: the CANDIDATES keep the majority — the cost display can never crowd out the choice`, () => {
      const bands = layoutMergePicker(t.detail, t.feature, platform, MERGE_INPUT_COUNT);
      const borrowed = Math.max(0, bands.spent.height - t.detail.height);
      expect(borrowed).toBeLessThanOrEqual(t.feature.height * 0.42 + 1e-6);
      expect(bands.candidates.height).toBeGreaterThan(t.feature.height * 0.5);
    });

    // The spent strip and the candidate grid are BOTH stacks of full-width
    // rows now (2026-08-28) — one chip per row, one card per row, on both
    // platforms. That single shape is what these two cases pin: the previous
    // pair asserted only "a positive-size cell" / "wider than 60px and taller
    // than 90px", which the OLD portrait grid satisfied while wrapping mobile's
    // three candidates into a 2 + 1-orphan grid and squeezing desktop's three
    // chips side by side. Height floors moved with the shape (a card ROW is
    // ~72-92px tall, not 90+); what replaces them is stronger, not weaker —
    // full band width, one column, strictly stacked, and above
    // `TOKEN_COMPACT_HEIGHT` so a candidate still renders its full card face.
    it(`${platform}: all three chips stack as full-width rows inside the strip`, () => {
      const bands = layoutMergePicker(t.detail, t.feature, platform, MERGE_INPUT_COUNT);
      const ideal = mergeChipIdeal(bands.spent, platform);
      const cells = layoutFeatureGrid(bands.spent, MERGE_INPUT_COUNT, ideal.w, ideal.h, 6);
      expect(cells).toHaveLength(MERGE_INPUT_COUNT);
      for (const cell of cells) {
        expect(cell.w).toBeGreaterThan(40);
        expect(cell.h).toBeGreaterThan(10);
        expect(within(cell, bands.spent)).toBe(true);
        // Full width of the band, and a row (wider than tall) — never two or
        // three chips abreast.
        expect(cell.w).toBeCloseTo(bands.spent.width, 6);
        expect(cell.w).toBeGreaterThan(cell.h);
        expect(cell.x).toBeCloseTo(cells[0]!.x, 6);
      }
      // Strictly stacked, top to bottom.
      for (let i = 1; i < cells.length; i++) {
        expect(cells[i]!.y).toBeGreaterThan(cells[i - 1]!.y + cells[i - 1]!.h - 1e-6);
      }
    });

    it(`${platform}: all three candidate cards stack as full-width rows — no wrap, no orphan`, () => {
      const bands = layoutMergePicker(t.detail, t.feature, platform, MERGE_INPUT_COUNT);
      const ideal = cardRowIdeal(bands.candidates, platform);
      const cells = layoutFeatureGrid(bands.candidates, 3, ideal.w, ideal.h, 8);
      expect(cells).toHaveLength(3);
      for (const cell of cells) {
        // A card token below ~60px wide stops being a card and starts being a
        // swatch — this is the floor that catches a future template shrink.
        expect(cell.w).toBeGreaterThan(60);
        expect(within(cell, bands.candidates)).toBe(true);
        // The row spans the whole band, at the platform's own unscaled row
        // height, and stays tall enough for `CardToken`'s full card face
        // (below `TOKEN_COMPACT_HEIGHT` it collapses to one line).
        expect(cell.w).toBeCloseTo(bands.candidates.width, 6);
        expect(cell.h).toBeCloseTo(FEATURE_CARD_ROW_H[platform], 6);
        expect(cell.h).toBeGreaterThan(TOKEN_COMPACT_HEIGHT);
        expect(cell.w).toBeGreaterThan(cell.h);
      }
      // ONE COLUMN: same x for all three, each strictly below the last. A
      // wrapped short last row would sit centred at a DIFFERENT x — the
      // orphaned third card this pass exists to remove.
      for (const cell of cells) expect(cell.x).toBeCloseTo(cells[0]!.x, 6);
      for (let i = 1; i < cells.length; i++) {
        expect(cells[i]!.y).toBeGreaterThan(cells[i - 1]!.y + cells[i - 1]!.h - 1e-6);
      }
    });

    it(`${platform}: a 1-candidate offer still lays out (a nearly-full bag is a real state)`, () => {
      const bands = layoutMergePicker(t.detail, t.feature, platform, MERGE_INPUT_COUNT);
      const ideal = cardRowIdeal(bands.candidates, platform);
      const cells = layoutFeatureGrid(bands.candidates, 1, ideal.w, ideal.h, 8);
      expect(cells).toHaveLength(1);
      expect(cells[0]!.w).toBeGreaterThan(60);
      expect(cells[0]!.h).toBeCloseTo(FEATURE_CARD_ROW_H[platform], 6);
    });

    it(`${platform}: the spent strip reserves room for its own caption, so a chip is never scaled down`, () => {
      // `renderMergeBandCaption` draws the caption INSIDE `bands.spent` and
      // hands the chips only what is left below it. `layoutMergePicker` now
      // includes `MERGE_CAPTION_H` in the height it asks for, so the chips get
      // their full ideal height at full band width instead of being uniformly
      // shrunk (which shipped as visibly narrow mobile chips).
      const bands = layoutMergePicker(t.detail, t.feature, platform, MERGE_INPUT_COUNT);
      const chipsOnly = MERGE_INPUT_COUNT * MERGE_CHIP_H[platform] + (MERGE_INPUT_COUNT - 1) * 6;
      expect(bands.spent.height).toBeGreaterThan(chipsOnly);
    });
  }
});

// ---------------------------------------------------------------------------
// A REAL offer, out of the REAL resolver, through the model the screen draws.
// ---------------------------------------------------------------------------
function stateAtEventNode(seed: number): RunState {
  const draft = rollStartDraft(seed);
  const picks: Record<string, string> = {};
  for (let i = 0; i < DRAFT_SET_KEYS.length; i += 1) picks[DRAFT_SET_KEYS[i]!] = draft[DRAFT_SET_KEYS[i]!][0]!.skillId;
  let state = applyDraftResult(createRun(seed), picks as never);
  for (let guard = 0; guard < 200; guard += 1) {
    const choices = availableChoices(state);
    if (choices.length === 0) break;
    const eventNode = choices.find((n) => n.kind === 'event');
    if (eventNode) return chooseNode(state, eventNode.id);
    const node = choices[0]!;
    state = chooseNode(state, node.id);
    if (node.kind === 'shop') state = leaveShop(state);
    else state = recordBattleResult(state, { won: true, goldEarned: 1 });
  }
  throw new Error(`no event node reachable for seed ${seed}`);
}

describe('the screen reads the resolver, not a fixture', () => {
  it('a live merge offer builds a model whose every named input is really owned, at the named place', () => {
    const base = stateAtEventNode(3);
    const pieces: RunBoardPiece[] = [
      { instanceId: 'card_100', skillId: SIZE1[0]!, tier: 'bronze', slot: 2, gem: null },
      { instanceId: 'card_101', skillId: SIZE1[1]!, tier: 'bronze', slot: 5, gem: null },
    ];
    const bagSlots: RunBagSlot[] = new Array<RunBagSlot>(10).fill(null);
    bagSlots[1] = { instanceId: 'card_102', skillId: SIZE1[2]!, tier: 'bronze' };
    const state: RunState = { ...base, pieces, bagSlots, nextCardInstanceId: 103 };

    const { outcome } = resolveEventChoice(state, 'ruined_anvil', 'beat_together');
    if (outcome.kind !== 'mergeCardsPick') throw new Error(`expected mergeCardsPick, got ${outcome.kind}`);
    const vm = buildRunMergeViewModel(outcome, state.pieces);

    expect(vm.title).toBe('3 BRONZE → 1 SILVER');
    // Bag first, then board in ascending slot — the resolver's own consumption
    // order, surfaced verbatim so the strip reads in the order the anvil eats.
    expect(vm.spent.map((s) => s.whereLabel)).toEqual(['BAG', 'BOARD 3', 'BOARD 6']);
    expect(vm.spent.map((s) => s.instanceId)).toEqual(['card_102', 'card_100', 'card_101']);
    expect(vm.candidates.length).toBeGreaterThan(0);
    for (const cand of vm.candidates) {
      expect(cardOfferableAtTier(skillBook[cand.skillId]!, 'silver')).toBe(true);
      expect(cand.skill.tier).toBe('silver');
    }
  });
});
