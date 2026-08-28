import type { MergeCardsOffer, MergeInputCard } from '../../run/events';
import type { SkillDef, SkillTier } from '../../engine/types';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import type { Rect, RunTemplatePlatform } from './runScreenTemplate';

/**
 * The CARD MERGE picker's view model + geometry — pure, no Phaser, so the one
 * screen in the run that DESTROYS three owned cards can be unit-tested on the
 * thing that matters (does it name what is being spent?) rather than only
 * eyeballed. `RunRewardPanel.ts`'s `renderRunMergeCardsPicker` draws whatever
 * this returns and derives nothing itself, exactly as `runRewardViewModel.ts`
 * stands to `renderRunRewardPanel`.
 *
 * THE ONE REQUIREMENT THIS MODULE EXISTS FOR: the trade must be legible BEFORE
 * it is taken. Three cards leave and one arrives, so the picker shows the three
 * NAMED INSTANCES going in (name, tier, and where they are sitting right now)
 * beside the three candidates coming back, on the same screen, with no confirm
 * step in between hiding either half. The run layer went out of its way to make
 * that information available — `MergeCardsOffer.consumed` carries the exact
 * instances `applyMergeCardsPick` will remove, not a count — and a UI that
 * showed only the candidates would be throwing it away and asking the player to
 * spend three cards they cannot see.
 */

/** Ideal (never-exceeded) size of ONE spent-card chip, per platform — fed to
 * `layoutFeatureGrid` exactly like `FEATURE_CARD_SIZE`/`FEATURE_GEM_CHIP_SIZE`
 * are, so the strip wraps by the same rule every other reward grid wraps by:
 * three across on a wide desktop panel, one per row on a narrow phone (which is
 * also the more readable stacking — one card, one line). */
export const MERGE_CHIP_SIZE: Record<RunTemplatePlatform, { w: number; h: number }> = {
  desktop: { w: 250, h: 46 },
  mobile: { w: 250, h: 40 },
};

/** Gap between chips in the spent strip, per platform. */
const MERGE_CHIP_GAP: Record<RunTemplatePlatform, number> = { desktop: 10, mobile: 6 };

/** Share of the `feature` rect the spent strip may take when `detail` alone
 * cannot hold it (mobile, where the chips stack). A hard ceiling: the CANDIDATE
 * cards are what the player is choosing between and must never be squeezed into
 * a sliver by the cost display, however many rows it wants. */
const MERGE_SPENT_MAX_FEATURE_SHARE = 0.42;

/** One card the merge will consume, ready to draw: `name` for identity,
 * `tierLabel` for what grade it is, `whereLabel` for where it is sitting right
 * now ("BOARD 3" / "BAG"). `instanceId` is carried through so a renderer can
 * key on the real instance rather than a name that may appear twice. */
export interface MergeSpentEntry {
  instanceId: string;
  skillId: string;
  name: string;
  tier: SkillTier;
  tierLabel: string;
  whereLabel: string;
}

/** One card the merge could hand back — `skill` is already resolved AT the
 * output tier (`applyTier`), the same way `runRewardViewModel.ts` resolves a
 * `grantCard` feature, so a renderer never stamps a card with a tier's frame
 * while showing another tier's numbers. */
export interface MergeCandidateEntry {
  skillId: string;
  tier: SkillTier;
  skill: SkillDef;
}

export interface RunMergeViewModel {
  from: SkillTier;
  to: SkillTier;
  /** "3 BRONZE → 1 SILVER" — the whole trade in one line, and the reason this
   * screen's headline is a STATEMENT rather than the imperative its sibling
   * pickers use ("PICK ONE TO KEEP"): here the price is the thing the player
   * has not been told yet. The imperative moves to `pickCaption` below. */
  title: string;
  /** "THESE THREE ARE SPENT" — the spent strip's caption. */
  spentCaption: string;
  /** "PICK ONE — IT ARRIVES AT SILVER" — the candidates' caption. */
  pickCaption: string;
  spent: readonly MergeSpentEntry[];
  candidates: readonly MergeCandidateEntry[];
}

/** Where one consumed instance is sitting, in the player's own vocabulary.
 * BOARD pieces name their SLOT (1-based, the `SLOT ${slot + 1}` convention the
 * shop's buy-destination label already uses) when the caller passes the board,
 * because a player with two copies of the same card at the same tier can
 * otherwise not tell which one the anvil is about to eat. Falls back to a bare
 * "BOARD" if the board wasn't passed or the index doesn't resolve — a missing
 * slot number is worth strictly less than a wrong one. */
function whereLabel(card: MergeInputCard, pieces?: readonly { slot: number }[]): string {
  if (card.location === 'bag') return 'BAG';
  const piece = pieces?.[card.index];
  return piece ? `BOARD ${piece.slot + 1}` : 'BOARD';
}

/**
 * Pure mapping from a pending `MergeCardsOffer` to the picker's display.
 *
 * `pieces` is the run's CURRENT board (`runStore.currentRunPieces()`), used
 * only to turn a consumed board piece's array index into the slot number the
 * player sees. It is optional so this module stays a pure function of the offer
 * — a caller that has no board to hand still gets a correct, if slightly less
 * specific, model rather than a crash.
 *
 * A candidate whose `skillId` is missing from the book is DROPPED rather than
 * rendered as a blank cell: `mergeCardsPlan` draws candidates from
 * `offerableBook(to)`, so this cannot happen for a live offer, and a hole in
 * the grid is a better failure than a tappable card with no identity.
 */
export function buildRunMergeViewModel(
  offer: MergeCardsOffer,
  pieces?: readonly { slot: number }[],
): RunMergeViewModel {
  const spent: MergeSpentEntry[] = [];
  for (let i = 0; i < offer.consumed.length; i += 1) {
    const card = offer.consumed[i]!;
    spent.push({
      instanceId: card.instanceId,
      skillId: card.skillId,
      name: skillBook[card.skillId]?.name ?? card.skillId,
      tier: card.tier,
      tierLabel: card.tier.toUpperCase(),
      whereLabel: whereLabel(card, pieces),
    });
  }
  const candidates: MergeCandidateEntry[] = [];
  for (let i = 0; i < offer.candidates.length; i += 1) {
    const cand = offer.candidates[i]!;
    const base = skillBook[cand.skillId];
    if (!base) continue;
    candidates.push({
      skillId: cand.skillId,
      tier: cand.tier,
      skill: cand.tier === base.tier ? base : applyTier(base, cand.tier),
    });
  }
  return {
    from: offer.from,
    to: offer.to,
    title: `${offer.consumed.length} ${offer.from.toUpperCase()} → 1 ${offer.to.toUpperCase()}`,
    spentCaption: `THESE ${offer.consumed.length === 3 ? 'THREE' : offer.consumed.length} ARE SPENT`,
    pickCaption: `PICK ONE — IT ARRIVES AT ${offer.to.toUpperCase()}`,
    spent,
    candidates,
  };
}

/**
 * Splits the reward template's `detail` + `feature` rects into the picker's two
 * bands: the SPENT strip (what leaves) on top, the CANDIDATE grid (what
 * arrives) below.
 *
 * `detail` is free real estate here — the other three pickers
 * (`renderPickHeader` + a grid) never draw into it — so the strip starts there
 * and only borrows from the top of `feature` when it needs more, which is the
 * narrow-phone case where the chips stack one per row. The borrow is capped at
 * `MERGE_SPENT_MAX_FEATURE_SHARE` of `feature`, so however many rows the strip
 * wants, the cards the player is actually choosing between keep the majority of
 * the space. On a wide desktop panel the three chips fit across `detail` alone
 * and `feature` is handed to the candidate grid untouched — the merge picker's
 * cards then read at exactly the same size as the bonus-draft picker's.
 *
 * Pure geometry, no Phaser, unit-tested against the REAL template rects in
 * `tests/game/runMergeViewModel.test.ts` (the same discipline
 * `runRewardGeometry.test.ts` applies to `layoutFeatureGrid`).
 */
export function layoutMergePicker(
  detail: Rect,
  feature: Rect,
  platform: RunTemplatePlatform,
  count: number,
): { spent: Rect; candidates: Rect } {
  const chip = MERGE_CHIP_SIZE[platform];
  const gap = MERGE_CHIP_GAP[platform];
  const cols = Math.max(1, Math.min(count, Math.floor((detail.width + gap) / (chip.w + gap))));
  const rows = count > 0 ? Math.ceil(count / cols) : 0;
  const wanted = rows > 0 ? rows * chip.h + (rows - 1) * gap : 0;
  const ceiling = detail.height + feature.height * MERGE_SPENT_MAX_FEATURE_SHARE;
  const spentH = Math.max(0, Math.min(wanted, ceiling));
  const borrowed = Math.max(0, spentH - detail.height);
  return {
    spent: { x: detail.x, y: detail.y, width: detail.width, height: spentH },
    candidates: {
      x: feature.x,
      y: feature.y + borrowed,
      width: feature.width,
      height: Math.max(0, feature.height - borrowed),
    },
  };
}
