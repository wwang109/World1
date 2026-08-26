import { describe, expect, it, vi } from 'vitest';

/**
 * NO SURFACE MAY OFFER A COPY OF A CARD THAT DOES NOT EXIST — AND MAY NEVER
 * CHARGE FOR ONE TIER WHILE HANDING OVER ANOTHER.
 *
 * A (card, tier) pair is unofferable two independent ways
 * (`cardOfferableAtTier`, engine/types.ts):
 *   • THE CARD HAS NO COPY THERE — tiering only ranks UP, so a card authored at
 *     Gold has no Bronze form (`cardExistsAtTier`);
 *   • THE COPY IS A HUSK — every action is tier-locked above that tier
 *     (`TierLocked`/`tierResolved`), so the copy exists and does nothing.
 * Every acquisition surface, though, picks the CARD and the TIER from two
 * independent draws:
 *   • `rollShopStock` (src/run/shop.ts) draws the card, then rolls a tier that
 *     never looked at it — and PRICES the offer off that tier;
 *   • `rollStartDraft` (src/run/draft.ts) and the event mini-drafts
 *     (`bonusDraft`/`cardChoice`, src/run/events.ts) stamp Bronze flat;
 *   • `grantCard` (src/run/events.ts) grants at `spec.tier ?? DEFAULT_CARD_TIER`.
 * `applyTier` CLAMPS a below-minimum request up rather than throwing, so the
 * player silently receives the higher card — at the lower price, with the lower
 * tier recorded on the owned instance (which then sells and merges as the tier it
 * is not). Nothing anywhere reported it.
 *
 * WHY THIS SUITE MOCKS THE CARD BOOK. Shipped content is 100% Bronze-minimum
 * with no tier locks, so a sweep over the real book passes no matter what the run
 * layer does — the exact condition under which a guard rots (the previous version
 * of this file was that vacuous sweep, and said so). The book is therefore
 * replaced with the real one PLUS four probes that exercise every arm of the rule:
 *
 *   probe_gold_min      Gold-authored     -> offerable Gold/Diamond only
 *   probe_diamond_min   Diamond-authored  -> offerable Diamond only
 *   probe_husk_bronze   Bronze, whole payload locked to Gold -> Gold/Diamond only
 *   probe_aura_only     pure-aura card    -> offerable EVERYWHERE (regression:
 *                       an empty `effects` list is NOT a husk when the payload is
 *                       an `aura`; six shipped cards are this shape)
 *
 * Every assertion below fails on the pre-fix run layer.
 */

const PROBE = {
  goldMin: 'probe_gold_min',
  diamondMin: 'probe_diamond_min',
  huskBronze: 'probe_husk_bronze',
  auraOnly: 'probe_aura_only',
} as const;

/** Probes whose minimum tier is ABOVE Bronze — the ones every free/Bronze-only
 * surface must EXCLUDE and every priced surface must CLAMP AND RE-PRICE. */
const RAISED_MIN_PROBES: readonly string[] = [PROBE.goldMin, PROBE.diamondMin, PROBE.huskBronze];

vi.mock('../../src/data/skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/data/skills')>();
  const book = actual.skillBook;
  // Cloned from REAL cards so shop `cardFilter`s, draft archetype pools and
  // event filters treat the probes exactly as they treat their originals.
  const hitter = book['sword_slash']!;
  const auraCard = book['war_banner']!;
  return {
    skillBook: {
      ...book,
      [PROBE.goldMin]: { ...hitter, id: PROBE.goldMin, tier: 'gold' },
      [PROBE.diamondMin]: { ...hitter, id: PROBE.diamondMin, tier: 'diamond' },
      [PROBE.huskBronze]: {
        ...hitter,
        id: PROBE.huskBronze,
        tier: 'bronze',
        effects: hitter.effects.map((a) => ({ ...a, minTier: 'gold' as const })),
      },
      [PROBE.auraOnly]: { ...auraCard, id: PROBE.auraOnly },
    },
  };
});

const { skillBook } = await import('../../src/data/skills');
const { cardOfferableAtTier, minOfferableTier, tierResolved, TIER_ORDER } = await import('../../src/engine/types');
const { GOLD_PRICE_BY_TIER, goldPriceOfCardForShop, rollShopStock } = await import('../../src/run/shop');
const { rollStartDraft, DRAFT_SET_KEYS } = await import('../../src/run/draft');
const { resolveEventChoice, applyBonusDraftPick } = await import('../../src/run/events');
const {
  applyDraftResult, availableChoices, buyRunCard, chooseNode, createRun, currentEventNode,
  ensureRunShopShelf, leaveEvent, leaveShop, recordBattleResult, tryInsertRunCard,
} = await import('../../src/run/runState');
const { shopCatalog, shopTypeIds } = await import('../../src/data/shopTypes');
const { eventCatalog, eventCatalogIds } = await import('../../src/data/events');

type SkillTier = (typeof TIER_ORDER)[number];
type RunState = ReturnType<typeof createRun>;

const SEEDS = 200;
const DEPTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** The whole rule, in one place: `tier` must be a tier this card really has a
 * usable copy at. Stated independently of `cardOfferableAtTier` (the predicate
 * the FIX uses) so this suite checks the property rather than echoing the
 * implementation: the card must exist at `tier`, and its resolved kit there must
 * actually do something — cast an action or project an aura. */
function whyUnofferable(skillId: string, tier: SkillTier): string | null {
  const card = skillBook[skillId];
  if (!card) return `unknown skill id "${skillId}"`;
  if (TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(card.tier)) {
    return `${skillId} offered at ${tier}, below its authored minimum ${card.tier}`;
  }
  const resolved = tierResolved(card, tier);
  if (resolved.effects.length === 0 && resolved.aura === undefined) {
    return `${skillId} at ${tier} is a HUSK — every action is tier-locked higher and it has no aura`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The probes themselves — if these are wrong, every sweep below is meaningless.
// ---------------------------------------------------------------------------

describe('the probe book', () => {
  it('gives each probe the minimum tier this suite assumes', () => {
    expect(minOfferableTier(skillBook[PROBE.goldMin]!)).toBe('gold');
    expect(minOfferableTier(skillBook[PROBE.diamondMin]!)).toBe('diamond');
    // The husk exists at Bronze (`cardExistsAtTier` says yes) and is still
    // unofferable there — the case a card-level tier check alone cannot see.
    expect(skillBook[PROBE.huskBronze]!.tier).toBe('bronze');
    expect(minOfferableTier(skillBook[PROBE.huskBronze]!)).toBe('gold');
    expect(cardOfferableAtTier(skillBook[PROBE.huskBronze]!, 'bronze')).toBe(false);
  });

  it('and leaves a PURE-AURA card offerable at Bronze (empty `effects` is not a husk)', () => {
    const aura = skillBook[PROBE.auraOnly]!;
    expect(aura.effects.length, 'the probe is the empty-effects shape').toBe(0);
    expect(aura.aura, 'with its payload in an aura').toBeDefined();
    expect(minOfferableTier(aura)).toBe('bronze');
    expect(whyUnofferable(PROBE.auraOnly, 'bronze')).toBeNull();
  });

  it('shipped content really is all Bronze-minimum — which is why the probes are needed', () => {
    const real = Object.values(skillBook).filter((s) => !RAISED_MIN_PROBES.includes(s.id));
    expect(real.every((s) => minOfferableTier(s) === 'bronze')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SHOPS — the priced surface. Clamps up, and RE-PRICES at the clamped tier.
// ---------------------------------------------------------------------------

describe('shop shelves', () => {
  it('never offer a card below its minimum tier, across every theme × depth × 200 seeds', () => {
    const bad: string[] = [];
    let offers = 0;
    for (const shopId of shopTypeIds) {
      for (const depth of DEPTHS) {
        for (let seed = 1; seed <= SEEDS; seed += 1) {
          for (const offer of rollShopStock(shopId, seed, depth).cards) {
            offers += 1;
            const why = whyUnofferable(offer.skillId, offer.tier);
            if (why) bad.push(`${shopId}@d${depth} seed${seed}: ${why}`);
          }
        }
      }
    }
    expect(offers, 'the sweep rolled no offers at all').toBeGreaterThan(10000);
    expect(bad.length, bad.slice(0, 8).join('\n')).toBe(0);
  });

  it('CHARGE FOR THE TIER ACTUALLY HANDED OVER — a clamped card is priced at the clamped tier', () => {
    const bad: string[] = [];
    for (const shopId of shopTypeIds) {
      const shop = shopCatalog[shopId]!;
      for (const depth of DEPTHS) {
        for (let seed = 1; seed <= SEEDS; seed += 1) {
          for (const offer of rollShopStock(shopId, seed, depth).cards) {
            const honest = goldPriceOfCardForShop(offer.tier, shop.priceDelta);
            if (offer.price !== honest) {
              bad.push(`${shopId}@d${depth} seed${seed}: ${offer.skillId} at ${offer.tier} priced ${offer.price}, honest price ${honest}`);
            }
          }
        }
      }
    }
    expect(bad.length, bad.slice(0, 8).join('\n')).toBe(0);
  });

  it('and the sweep really did clamp raised-minimum probes (not merely never draw them)', () => {
    const seen: Record<string, { count: number; tiers: Set<string>; prices: Set<number> }> = {};
    for (const id of RAISED_MIN_PROBES) seen[id] = { count: 0, tiers: new Set(), prices: new Set() };
    for (const shopId of shopTypeIds) {
      const shop = shopCatalog[shopId]!;
      if ((shop.priceDelta ?? 0) !== 0) continue; // read prices off undiscounted shelves only
      for (const depth of DEPTHS) {
        for (let seed = 1; seed <= SEEDS; seed += 1) {
          for (const offer of rollShopStock(shopId, seed, depth).cards) {
            const hit = seen[offer.skillId];
            if (!hit) continue;
            hit.count += 1;
            hit.tiers.add(offer.tier);
            hit.prices.add(offer.price);
          }
        }
      }
    }
    // Each raised-minimum probe must have been offered many times...
    for (const id of RAISED_MIN_PROBES) {
      expect(seen[id]!.count, `${id} was never offered — the sweep proves nothing about it`).toBeGreaterThan(50);
    }
    // ...never at Bronze or Silver, and never at a Bronze/Silver PRICE. This is
    // the trap: pre-fix, a Gold-minimum card sells for GOLD_PRICE_BY_TIER.bronze.
    for (const id of [PROBE.goldMin, PROBE.huskBronze]) {
      expect([...seen[id]!.tiers].sort(), `${id} tiers offered`).toEqual(['gold']);
      expect([...seen[id]!.prices], `${id} prices charged`).toEqual([GOLD_PRICE_BY_TIER.gold]);
    }
    expect([...seen[PROBE.diamondMin]!.tiers], 'diamond-minimum card').toEqual(['diamond']);
    expect([...seen[PROBE.diamondMin]!.prices], 'priced as diamond').toEqual([GOLD_PRICE_BY_TIER.diamond]);
  });

  it('still offer the pure-aura card at Bronze (the fix must not delete aura cards from shelves)', () => {
    let bronzeAuraOffers = 0;
    for (const shopId of shopTypeIds) {
      for (const depth of DEPTHS) {
        for (let seed = 1; seed <= SEEDS; seed += 1) {
          for (const offer of rollShopStock(shopId, seed, depth).cards) {
            if (offer.skillId === PROBE.auraOnly && offer.tier === 'bronze') bronzeAuraOffers += 1;
          }
        }
      }
    }
    expect(bronzeAuraOffers).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// THE START DRAFT — free, so it EXCLUDES rather than clamps.
// ---------------------------------------------------------------------------

describe('the start draft', () => {
  it('offers nothing below its minimum tier, and no raised-minimum card at all, over 200 seeds', () => {
    const bad: string[] = [];
    let cards = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const draft = rollStartDraft(seed);
      for (const key of DRAFT_SET_KEYS) {
        for (const card of draft[key]) {
          cards += 1;
          const why = whyUnofferable(card.skillId, card.tier);
          if (why) bad.push(`seed${seed} ${key}: ${why}`);
          if (RAISED_MIN_PROBES.includes(card.skillId)) {
            bad.push(`seed${seed} ${key}: ${card.skillId} has no Bronze copy and must be EXCLUDED from a free draft, not clamped`);
          }
        }
      }
    }
    expect(cards, 'the sweep drafted nothing').toBe(SEEDS * 4 * 5);
    expect(bad.length, bad.slice(0, 8).join('\n')).toBe(0);
  });

  it('still every set is full — exclusion must not shrink a draft set', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const draft = rollStartDraft(seed);
      for (const key of DRAFT_SET_KEYS) expect(draft[key].length, `seed${seed} ${key}`).toBe(5);
    }
  });

  it('and can still draft the pure-aura card', () => {
    let seen = false;
    for (let seed = 1; seed <= SEEDS && !seen; seed += 1) {
      const draft = rollStartDraft(seed);
      for (const key of DRAFT_SET_KEYS) {
        if (draft[key].some((c) => c.skillId === PROBE.auraOnly)) seen = true;
      }
    }
    expect(seen, 'the aura-only probe never appeared in 200 drafts').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EVENTS — every card-granting outcome in the catalog, driven for real.
// ---------------------------------------------------------------------------

function startedRun(seed: number): RunState {
  const draft = rollStartDraft(seed);
  const picks: Record<string, string> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
  return applyDraftResult(createRun(seed), picks);
}

/** Park a run on an event node (fights won, shops browsed) so
 * `resolveEventChoice` can be driven for any catalog (event, choice) pair. */
function stateAtEventNode(seed: number): RunState | null {
  let state = startedRun(seed);
  for (let guard = 0; guard < 200; guard += 1) {
    const choices = availableChoices(state);
    if (choices.length === 0) return null;
    const event = choices.find((n) => n.kind === 'event');
    if (event) return chooseNode(state, event.id);
    const node = choices[0]!;
    state = chooseNode(state, node.id);
    if (node.kind === 'shop') state = leaveShop(state);
    else if (node.kind === 'event') state = leaveEvent(state);
    else state = recordBattleResult(state, { won: true, goldEarned: 5 });
  }
  return null;
}

/** Every (event, choice) in the catalog whose outcome hands over a card. */
function cardGrantingChoices(): { eventId: string; choiceId: string; kind: string }[] {
  const out: { eventId: string; choiceId: string; kind: string }[] = [];
  for (const eventId of eventCatalogIds) {
    for (const choice of eventCatalog[eventId]!.choices) {
      const kind = choice.outcome.kind;
      if (kind === 'grantCard' || kind === 'bonusDraft' || kind === 'cardChoice') {
        out.push({ eventId, choiceId: choice.id, kind });
      }
    }
  }
  return out;
}

describe('event card grants', () => {
  const GRANTS = cardGrantingChoices();

  it('the catalog really does grant cards (otherwise the sweep below is empty)', () => {
    expect(GRANTS.length).toBeGreaterThan(5);
  });

  it('never hand over a card below its minimum tier, over every card-granting choice × many seeds', () => {
    const bad: string[] = [];
    let resolved = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const parked = stateAtEventNode(seed);
      if (!parked || !currentEventNode(parked)) continue;
      // Fund the wallet so a choice's `cost` never gates what this sweep can reach.
      const funded: RunState = { ...parked, gold: 99 };
      for (const grant of GRANTS) {
        const { outcome } = resolveEventChoice(funded, grant.eventId, grant.choiceId);
        resolved += 1;
        if (outcome.kind === 'grantCard') {
          const why = whyUnofferable(outcome.skillId, outcome.tier);
          if (why) bad.push(`seed${seed} ${grant.eventId}/${grant.choiceId}: ${why}`);
        } else if (outcome.kind === 'bonusDraft') {
          for (const card of outcome.cards) {
            const why = whyUnofferable(card.skillId, card.tier);
            if (why) bad.push(`seed${seed} ${grant.eventId}/${grant.choiceId}: ${why}`);
            if (RAISED_MIN_PROBES.includes(card.skillId)) {
              bad.push(`seed${seed} ${grant.eventId}/${grant.choiceId}: ${card.skillId} offered in a free Bronze mini-draft`);
            }
          }
        }
      }
    }
    expect(resolved, 'no event choice was resolved at all').toBeGreaterThan(50);
    expect(bad.length, bad.slice(0, 8).join('\n')).toBe(0);
  });

  it('and a mini-draft pick is BANKED at the tier it was offered at', () => {
    const state = startedRun(7);
    for (const tierProbe of [PROBE.auraOnly, 'sword_slash']) {
      const banked = applyBonusDraftPick(state, { skillId: tierProbe, tier: 'bronze' });
      if (banked.outcome.kind !== 'grantCard') continue;
      expect(whyUnofferable(banked.outcome.skillId, banked.outcome.tier)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// THE OWNED INSTANCE — the tier that is STAMPED, and the gold actually paid.
// ---------------------------------------------------------------------------

describe('owned instances', () => {
  it('are never stamped below their card minimum, whatever tier a caller asks for', () => {
    const state = startedRun(3);
    for (const id of [...RAISED_MIN_PROBES, PROBE.auraOnly]) {
      for (const asked of TIER_ORDER) {
        const inserted = tryInsertRunCard(state, id, asked);
        if (!inserted) continue; // bag full — nothing was stamped
        const slot = inserted.state.bagSlots.find((c) => c?.instanceId === inserted.instanceId)!;
        expect(whyUnofferable(slot.skillId, slot.tier), `${id} asked at ${asked}`).toBeNull();
      }
    }
  });

  it('the starting board never stamps a tier a drafted card has no copy at', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const state = startedRun(seed);
      for (const piece of state.pieces) {
        expect(whyUnofferable(piece.skillId, piece.tier), `seed${seed} board`).toBeNull();
      }
      for (const slot of state.bagSlots) {
        if (slot) expect(whyUnofferable(slot.skillId, slot.tier), `seed${seed} bag`).toBeNull();
      }
    }
  });

  it('BUYING a clamped card charges the clamped tier and banks it at that tier', () => {
    let purchases = 0;
    // Walk whole runs, visiting EVERY shop node on the way (a single shelf shows
    // 4-6 of ~160 cards, so one shop per seed is not enough to meet the probes).
    for (let seed = 1; seed <= 120 && purchases < 3; seed += 1) {
      let state = startedRun(seed);
      for (let guard = 0; guard < 60 && purchases < 3; guard += 1) {
        const choices = availableChoices(state);
        if (choices.length === 0) break;
        const shop = choices.find((n) => n.kind === 'shop');
        const node = shop ?? choices[0]!;
        state = chooseNode(state, node.id);
        if (node.kind === 'event') { state = leaveEvent(state); continue; }
        if (node.kind !== 'shop') { state = recordBattleResult(state, { won: true, goldEarned: 5 }); continue; }

        // A shop node's shelf is rolled lazily on first BROWSE, not on arrival.
        state = ensureRunShopShelf(state, node.id);
        const shelf = state.shopShelves[node.id];
        const index = shelf ? shelf.cards.findIndex((o) => RAISED_MIN_PROBES.includes(o.skillId)) : -1;
        if (index >= 0) {
          const offer = shelf!.cards[index]!;
          const funded: RunState = { ...state, gold: 99 };
          const bought = buyRunCard(funded, node.id, index);
          if (bought.ok) {
            purchases += 1;
            const banked = bought.state.bagSlots.find((c) => c?.skillId === offer.skillId)!;
            // The gold that left the wallet, the tier charged for, and the tier
            // banked must all be the SAME fact. Pre-fix they were three different
            // facts: a Gold-minimum card rolled Bronze was charged 2 gold, banked
            // as bronze, and resolved in combat as gold.
            expect(funded.gold - bought.state.gold, `${offer.skillId} gold paid`).toBe(offer.price);
            expect(banked.tier, `${offer.skillId} banked tier`).toBe(offer.tier);
            expect(offer.price, `${offer.skillId} priced as ${offer.tier}`).toBe(GOLD_PRICE_BY_TIER[offer.tier]);
            expect(whyUnofferable(banked.skillId, banked.tier)).toBeNull();
            state = bought.state;
          }
        }
        state = leaveShop(state);
      }
    }
    expect(purchases, 'no raised-minimum probe was ever bought — this test proved nothing').toBeGreaterThan(0);
  });
});
