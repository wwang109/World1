import { describe, expect, it } from 'vitest';
import { rollShopStock } from '../../src/run/shop';
import { rollStartDraft, DRAFT_SET_KEYS } from '../../src/run/draft';
import { shopTypeIds } from '../../src/data/shopTypes';
import { skillBook } from '../../src/data/skills';
import { cardExistsAtTier } from '../../src/engine/types';
import type { SkillDef, SkillTier } from '../../src/engine/types';

/**
 * NO SURFACE MAY OFFER A COPY OF A CARD THAT DOES NOT EXIST.
 *
 * A card's MINIMUM TIER is its own `tier` (`cardExistsAtTier`,
 * engine/types.ts): tiering only ranks UP, so a card authored at Gold has no
 * Bronze or Silver copy — its kit is priced against the Gold budget and nothing
 * can scale it down. Every acquisition surface, though, chooses a (card, tier)
 * pair from two independent draws:
 *
 *   • `rollShopStock` (src/run/shop.ts) picks the CARD from `cardPoolForShop`
 *     and then rolls the TIER with `rollOfferedTier` — the roll never looks at
 *     the card, so a Bronze roll on a Gold-minimum card offers something that
 *     cannot exist, at a Bronze price;
 *   • `rollStartDraft` (src/run/draft.ts) stamps `tier: 'bronze'` on every
 *     drafted card unconditionally;
 *   • the event outcomes in src/run/events.ts grant at
 *     `spec.tier ?? DEFAULT_CARD_TIER`.
 *
 * `applyTier` clamps such a request UP rather than throwing (see its doc
 * comment), so the player would silently receive a Gold card for a Bronze price
 * and nothing anywhere would report it. This suite is the detector for that.
 *
 * IT IS VACUOUS TODAY, AND SAYS SO. The book is entirely Bronze-minimum, so
 * every offer trivially passes — which is exactly the condition under which a
 * guard rots. The last test therefore runs the SAME check against a fabricated
 * Gold-minimum offer and requires it to FAIL, so the detector is known to work
 * on the day content authors the first non-Bronze card.
 */

/** The check itself, in one place, so the real sweep and the proof share it. */
function offerIsImpossible(book: Record<string, SkillDef>, skillId: string, tier: SkillTier): boolean {
  const card = book[skillId];
  if (!card) return false;
  return !cardExistsAtTier(card, tier);
}

describe('acquisition surfaces never offer a tier a card has no copy at', () => {
  it('shop shelves, across every shop type and depth band', () => {
    const impossible: string[] = [];
    let offers = 0;
    for (const shopId of shopTypeIds) {
      for (let depth = 1; depth <= 9; depth += 1) {
        for (let seed = 1; seed <= 12; seed += 1) {
          for (const offer of rollShopStock(shopId, seed, depth).cards) {
            offers += 1;
            if (offerIsImpossible(skillBook, offer.skillId, offer.tier)) {
              impossible.push(`${shopId}@depth${depth} seed${seed}: ${offer.skillId} offered at ${offer.tier} (minimum ${skillBook[offer.skillId]!.tier})`);
            }
          }
        }
      }
    }
    expect(impossible, impossible.join('\n')).toEqual([]);
    // The sweep must actually roll shelves, and must reach past Bronze — a run
    // that only ever offered Bronze could not see the bug either.
    expect(offers, 'the sweep rolled no offers at all').toBeGreaterThan(200);
  });

  it('the start draft', () => {
    const impossible: string[] = [];
    for (let seed = 1; seed <= 20; seed += 1) {
      const draft = rollStartDraft(seed);
      for (const key of DRAFT_SET_KEYS) {
        for (const card of draft[key]) {
          if (offerIsImpossible(skillBook, card.skillId, card.tier)) {
            impossible.push(`draft seed${seed}: ${card.skillId} offered at ${card.tier}`);
          }
        }
      }
    }
    expect(impossible, impossible.join('\n')).toEqual([]);
  });

  it('THE DETECTOR FIRES — proof this suite is not just agreeing with an all-Bronze book', () => {
    // Today every card's minimum is Bronze, so the two sweeps above pass no
    // matter what the run layer does. Run the identical check over a book with
    // one Gold-minimum card and require it to catch a Bronze offer of it.
    const goldMin: SkillDef = { ...skillBook.sword_slash!, id: 'gold_min_probe', tier: 'gold' };
    const book = { ...skillBook, [goldMin.id]: goldMin };
    expect(Object.values(skillBook).every((c) => c.tier === 'bronze'),
      'the book is all-Bronze, which is why the sweeps above are vacuous').toBe(true);
    expect(offerIsImpossible(book, goldMin.id, 'bronze'), 'a Bronze offer of a Gold-minimum card').toBe(true);
    expect(offerIsImpossible(book, goldMin.id, 'silver'), 'a Silver offer of a Gold-minimum card').toBe(true);
    expect(offerIsImpossible(book, goldMin.id, 'gold'), 'its own tier is fine').toBe(false);
    expect(offerIsImpossible(book, goldMin.id, 'diamond'), 'and above it is fine').toBe(false);
  });
});
