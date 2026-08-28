// Events — pure resolution over the declarative catalog in
// `src/data/events.ts` (see docs/run-events-design.md §1-3). Two entry
// points: `rollEventForNode` draws (idempotently) which event a node shows,
// `resolveEventChoice` applies a chosen choice's outcome. No Phaser, no
// Date.now/Math.random — every roll flows through the engine's seeded `Rng`
// in a fixed call order, so replaying the same run+path is byte-identical.

import { hashSeed, Rng } from '../engine/rng';
import { cardOfferableAtTier, clampTierToCard } from '../engine/types';
import type { SkillDef, SkillTier } from '../engine/types';
import { eventCatalog, eventCatalogIds, type EventChoiceDef, type EventDef, type EventOutcomeSpec, type EventTheme } from '../data/events';
import type { DraftCard } from './draft';
import { skillBook } from '../data/skills';
import { gemBook } from '../data/gems';
import { cardMatchesFilter, gemMatchesFilter, pickWeightedGem, pickWeightedGems, sellPriceOfGem } from './shop';
import {
  currentEventNode,
  MAX_LEVEL,
  runBagHasRoomFor,
  sellRunGem,
  shopStockDepthForWave,
  tryInsertRunCard,
  type RunBagSlot,
  type RunBoardPiece,
  type RunNode,
  type RunState,
} from './runState';

/** Fallback gold grant when a `grantCard`/`bonusDraft` pick can't fit the bag
 * (also reused by `upgradeCard` when nothing owned is eligible to upgrade). */
const CARD_FALLBACK_GOLD = 2;
const DEFAULT_CARD_TIER: SkillTier = 'bronze';
const BONUS_DRAFT_SIZE = 5;

/**
 * Width of a `cardChoice`/`gemChoice` event outcome's deferred pick
 * (2026-08-18 agency pass — see `EventOutcomeSpec`'s doc comment in
 * `data/events.ts`). Deliberately 3, not `BONUS_DRAFT_SIZE` (5): 5-wide is
 * `bonusDraft`'s own paid identity (its choices cost 0-2 gold across the
 * catalog) — a widened `grantCard`/`grantGem` must not out-earn it, so it
 * gets a narrower pool instead of matching width.
 *
 * PRICING ARITHMETIC for the choices this widening touches (worked in full
 * in the PR that introduced it): a shop Bronze card costs 2 gold
 * (`GOLD_PRICE_BY_TIER.bronze`, shop.ts) and the cheapest (Common) shop gem
 * costs 1 gold (`goldPriceOfGem`, same file) — both already the SAME price
 * every existing paid `grantCard`/`grantGem` event choice in this catalog
 * charges for a single guaranteed pick. Widening 1-of-1 to 1-of-3 at an
 * UNCHANGED cost is therefore a pure value-up for every choice that was
 * already paid — no reprice needed there, it just gets better for the same
 * gold. The 4 choices that were cost-0 are the ones this widening actually
 * cheapens relative to their paid siblings (a free 1-of-3 pick is now
 * strictly better than it was, for the same zero gold, while a sibling event
 * still charges 2g for functionally the same reward category) — against a
 * run income of ~4-7 gold per winning wave, a 1-gold toll is ~15-25% of one
 * wave's income: enough to register as a real cost, not decorative, while
 * staying below every paid sibling's 2-gold price (so the free tier never
 * out-earns the paid one). +1 gold is applied to exactly 2 of the 4
 * (`take_gem`, `take_stone`) — the other 2 (`spare_blade`, `take_armor`)
 * stay cost 0 because repricing them would leave their event with ZERO
 * affordable choices at 0 gold, breaking the catalog's own "every event
 * carries a genuinely safe cost-0 choice" invariant (see the doc comment at
 * the top of `data/events.ts`) — `spare_blade` is `sparring_circle`'s ONLY
 * cost-0 choice, and `take_armor`/`take_gem` were BOTH of
 * `quartermasters_error`'s only two choices, so at most one of that pair can
 * be repriced (gems, called out as the catalog's single biggest RNG win,
 * take the reprice; the card grant stays free).
 */
// Exported so `tests/run/events.test.ts`'s catalog lint can assert every
// `cardChoice`/`gemChoice` filter's pool is at least this wide WITHOUT a
// literal `3` drifting out of sync with the real width (2026-08-18 QA pass,
// closing a coverage gap: neither `sampleDistinct` (below) nor
// `pickWeightedGems`/`sampleGemsWeighted` (shop.ts) error on a too-small
// pool — they just silently hand back FEWER than `count` options).
export const EVENT_CHOICE_SIZE = 3;

/** Tier ladder `upgradeCard` climbs — fixed order, index doubles as "rank". */
const TIER_LADDER: readonly SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];
const TIER_UP: Record<Exclude<SkillTier, 'diamond'>, SkillTier> = {
  bronze: 'silver',
  silver: 'gold',
  gold: 'diamond',
};

// ---------------------------------------------------------------------------
// Display-ready outcome record — what actually happened, for the UI to show.
// ---------------------------------------------------------------------------

/** One eligible upgrade target offered by an `upgradeCardPick` outcome —
 * enough to both DISPLAY the card (`skillId`/`from`) and unambiguously
 * re-identify it later (`instanceId` is globally unique across `pieces` AND
 * `bagSlots`, see `tryInsertRunCard`'s counter), without the picker needing
 * to know whether the card lives on the board or in the bag. */
export interface UpgradeCardOption {
  instanceId: string;
  skillId: string;
  from: SkillTier;
  to: SkillTier;
}

/** One sellable pouch gem offered by a `sellGem` outcome's deferred pick —
 * enough to both DISPLAY the option (`gemId`/`price`) and unambiguously
 * re-identify it later (`pouchIndex` into `RunState.gemInventory`, the same
 * addressing `sellRunGem`/`sellCurrentRunGem` already use — NOT `gemId`
 * alone, since the pouch can hold duplicate gem ids and only the index picks
 * out one specific copy). `price` is `sellPriceOfGem(gemId)` (`shop.ts`) —
 * the SAME half-of-shop-buy-price, floored, min-1-gold formula every other
 * sell surface in the run (`sellRunGem`/`sellRunCard`) already uses; this
 * outcome doesn't invent its own pricing, it only offers the existing one
 * through an event choice instead of the Deck/Bag screen's SELL button. */
export interface SellGemOption {
  pouchIndex: number;
  gemId: string;
  price: number;
}

export type EventOutcome =
  | { kind: 'grantCard'; skillId: string; tier: SkillTier; fellBack?: boolean }
  | { kind: 'grantGem'; gemId: string }
  | { kind: 'grantGold'; amount: number; fellBack?: boolean }
  | { kind: 'loseGold'; amount: number }
  | { kind: 'grantLevel'; level: number }
  // `cardChoice` (2026-08-18, see `EventOutcomeSpec`'s doc comment in
  // data/events.ts) resolves to THIS SAME `bonusDraft` shape, at
  // `EVENT_CHOICE_SIZE` (3) width instead of `BONUS_DRAFT_SIZE` (5) —
  // `cardChoiceOutcome` below is the only other producer of this kind, and
  // `applyBonusDraftPick` finalizes either one identically (a picked
  // `DraftCard` is a picked `DraftCard` regardless of which choice drew it).
  | { kind: 'bonusDraft'; cards: readonly DraftCard[] }
  // Deferred pick (same "roll now, pick later" shape as `bonusDraft` above) —
  // `upgradeCardOutcome` returns this instead of resolving immediately
  // whenever at least one owned card is eligible; `applyUpgradeCardPick`
  // resolves the player's tap into the FINAL `upgradeCard` outcome below.
  | { kind: 'upgradeCardPick'; options: readonly UpgradeCardOption[] }
  // `gemChoice`'s deferred offer (2026-08-18) — unlike `cardChoice`, gems had
  // no pre-existing picker shape to reuse, so this is a genuinely new
  // `EventOutcome` member: `options` is `EVENT_CHOICE_SIZE` distinct gem ids
  // (same depth-gated, rarity-weighted draw a single `grantGem` uses, see
  // `gemChoiceOutcome`). `applyGemChoicePick` finalizes the tapped id into
  // the FINAL `grantGem` outcome above — no new final shape, only the offer
  // is new. NOTE FOR UI INTEGRATION: this member is NOT YET handled by
  // `src/game/ui/eventOutcomeText.ts#outcomeHeadline`'s exhaustive switch
  // (nor by the event scenes' `bonusDraft`/`upgradeCardPick` branch, which
  // this needs a third arm added alongside) — that's `src/game/**` surface,
  // out of this module's ownership; see the PR description for the exact
  // one-case patch needed to keep `outcomeHeadline` compiling.
  | { kind: 'gemChoicePick'; options: readonly string[] }
  // `sellGem`'s deferred offer (2026-08-20, see `EventOutcomeSpec`'s doc
  // comment in `data/events.ts`) — `options` is every pouch gem the player
  // currently owns (deterministic inventory order, no `Rng` draw: unlike
  // `gemChoice`'s freshly-rolled candidates, this is just a READ of
  // `state.gemInventory`, so there is nothing to seed). `applySellGemPick`
  // finalizes the tapped `pouchIndex` into the FINAL `sellGem` outcome below.
  // Gating (the choice must not even be offered with an empty pouch) lives
  // BEFORE resolve, in `isEventChoiceUsable` — see that function's doc
  // comment — so `sellGemOutcome` reaching this with a non-empty
  // `state.gemInventory` is the normal case, not something this member's
  // consumer needs to defend against.
  | { kind: 'sellGemPick'; options: readonly SellGemOption[] }
  // The FINAL, resolved `sellGem` outcome — what `applySellGemPick` produces
  // once the player taps one of `sellGemPick`'s options. `price` mirrors
  // `SellGemOption.price` (the gold actually credited), kept on the resolved
  // shape too so the reward screen's headline doesn't need to re-derive it.
  | { kind: 'sellGem'; gemId: string; price: number }
  // `skillId`/`from`/`to` are omitted (not merely falsy) exactly when
  // `fellBack` is true — this DELIBERATELY differs from `grantCard`'s
  // fallback idiom (which swaps the whole outcome to `grantGold`): a
  // `grantGold`-shaped fallback would render "Bag was full" for what is
  // really "nothing owned is eligible to upgrade", a wrong reason. Staying
  // `upgradeCard` with `fellBack: true` lets the UI show the correct reason
  // while still crediting `CARD_FALLBACK_GOLD` (see `upgradeCardOutcome`/
  // `applyUpgradeCardPick`). This is the FINAL, resolved outcome shown by the
  // reward screen — either the immediate no-choice-available fallback, or
  // what `applyUpgradeCardPick` produced from a picked `UpgradeCardOption`.
  | ({ kind: 'upgradeCard' } & (
      | { fellBack: true; skillId?: undefined; from?: undefined; to?: undefined }
      | { fellBack?: false; skillId: string; from: SkillTier; to: SkillTier }
    ))
  // `mergeCards`'s deferred offer (2026-08-26 run layer, PROMOTED INTO THIS
  // UNION 2026-08-28 by the UI phase) — the FIFTH deferred picker, and shaped
  // exactly like the four above it: roll/derive the question now, resolve the
  // player's tap later (`applyMergeCardsPick`, which re-derives the plan from
  // state and produces the FINAL `grantCard` outcome — no new final shape,
  // only the offer is new, same as `gemChoicePick`).
  //
  // IT USED TO RIDE BESIDE THE OUTCOME. `resolveEventChoice` returned this as
  // an OPTIONAL `merge` field next to `outcome: {kind:'nothing'}`, because the
  // pass that built the mechanic could not add a union member without editing
  // `src/game/ui/eventOutcomeText.ts` (its switch closes on
  // `const exhaustive: never`) and that file was outside its ownership. That
  // was a boundary workaround, and it is now paid off rather than kept: the
  // side channel made this the ONE deferred picker a scene could not reach
  // through the `switch (outcome.kind)` dispatch every other picker uses, and
  // it forced `resolveCurrentEventChoice` (runStore.ts) to widen its return
  // type from `EventOutcome | undefined` to a compound object to carry it.
  // Promoting keeps that signature untouched and makes the `never` guard do
  // its actual job: a sixth picker cannot ship half-wired again.
  //
  // The "nothing has happened yet" truth the old shape was defending is not
  // lost — it is the same truth `bonusDraft`/`upgradeCardPick`/`gemChoicePick`/
  // `sellGemPick` already carry: this union is what the event screen shows
  // NEXT, not a log of state changes, and four of its members already change
  // nothing. `tests/run/cardMerge.test.ts` still asserts the run state is
  // byte-identical after the offer resolves, which is where that guarantee
  // actually lives.
  | ({ kind: 'mergeCardsPick' } & MergeCardsOffer)
  | { kind: 'nothing' };

/** Draw `count` DISTINCT items from `pool` via `rng.int`, fixed call order
 * (same idiom used by draft.ts/shop.ts/runMap.ts). */
function sampleDistinct<T>(rng: Rng, pool: readonly T[], count: number): T[] {
  const remaining = [...pool];
  const result: T[] = [];
  const n = Math.min(count, remaining.length);
  for (let i = 0; i < n; i++) {
    const idx = rng.int(remaining.length);
    result.push(remaining[idx]!);
    remaining.splice(idx, 1);
  }
  return result;
}

function toDraftCard(skillId: string): DraftCard {
  return { skillId, tier: 'bronze' };
}

/**
 * THE BOOK, NARROWED TO CARDS THAT CAN ACTUALLY BE HANDED OVER AT `tier`
 * (`cardOfferableAtTier`, engine/types.ts) — the one pool builder every card-
 * granting outcome in this module draws from, so the tier-minimum rule is
 * applied in ONE place rather than per outcome.
 *
 * EVENTS EXCLUDE, THEY DO NOT CLAMP (with one exception, below). Every card
 * grant here is bought with an authored `choice.cost` in gold, not with a
 * tier-keyed price like a shop shelf's (`goldPriceOfCard`, shop.ts) — so raising
 * a grant's tier raises what the player receives with nothing to raise on the
 * other side of the trade. A 2-gold event choice must not become a Gold card.
 * Narrowing the DRAW POOL keeps the trade exactly as authored.
 *
 * THE EXCEPTION IS A NAMED CARD: `grantCard` with an explicit `spec.cardId`
 * (content pointed at ONE card) has no pool to narrow, so that path clamps and
 * reports the true tier instead — see `grantCardOutcome`.
 *
 * NO Rng CALL CHANGES: every consumer spends the same number of `rng.int`/
 * `rng.pick` draws over a narrower array. `Array#filter` preserves the book's
 * canonical id order. No-op for today's all-Bronze, lock-free book.
 */
function offerableBook(tier: SkillTier): SkillDef[] {
  return Object.values(skillBook).filter((s) => cardOfferableAtTier(s, tier));
}

// ---------------------------------------------------------------------------
// Affordability — a Wave-1 stop happens before any fight (gold is always 0
// there), so an event whose only "does something" choice costs gold reads as
// a broken/dead button. `rollEventForNode` skips events that would offer
// nothing playable at the player's CURRENT gold; `isEventChoiceAffordable` is
// the single predicate authority both this resolver and the UI use, so a
// dimmed button in the scene always agrees with what the resolver would let
// the player actually pick.
// ---------------------------------------------------------------------------

/** Whether `choice` is payable right now — the SAME gate the UI should use to
 * dim an individual choice button (`choice.cost` omitted/0 always affords).
 * Gold-only: an outcome-specific "is there anything to act on" gate (today,
 * `sellGem`'s "does the player own anything to sell") is a SEPARATE concern,
 * see `isEventChoiceUsable` below — kept apart so this function's own
 * contract ("cost <= gold, nothing else") stays simple and doesn't grow a
 * special case per outcome kind. */
export function isEventChoiceAffordable(state: RunState, choice: EventChoiceDef): boolean {
  return (choice.cost ?? 0) <= state.gold;
}

/** Whether `choice` is USABLE right now — `isEventChoiceAffordable` (the
 * gold gate) PLUS any outcome-specific precondition. There are TWO such
 * preconditions today. `sellGem`: its picker has nothing to offer with an
 * empty pouch, so a cost-0 `sellGem` choice at
 * `state.gemInventory.length === 0` reads as affordable (cost 0 <= any gold)
 * but is NOT usable — this is the gate that keeps `sellGemOutcome` from ever
 * resolving to an empty picker (see that function's doc comment).
 * `mergeCards`: it needs three owned cards of one non-Diamond tier AND a
 * deliverable output, so a cost-0 merge rung is unusable until
 * `mergeCardsPlan` finds a trade (see below). Every other outcome kind has no
 * such precondition and this reduces to `isEventChoiceAffordable` alone.
 * This is the predicate the UI should call to dim an individual choice
 * button (not `isEventChoiceAffordable` directly) and the one
 * `hasAffordableChoice`/`rollEventForNode` use to decide whether an event is
 * eligible to be offered at all. */
export function isEventChoiceUsable(state: RunState, choice: EventChoiceDef): boolean {
  if (!isEventChoiceAffordable(state, choice)) return false;
  if (choice.outcome.kind === 'sellGem') return state.gemInventory.length > 0;
  // `mergeCards` (2026-08-26): the second outcome-specific precondition, and the
  // reason this function exists apart from `isEventChoiceAffordable`. A merge
  // needs `MERGE_INPUT_COUNT` owned cards sharing ONE non-Diamond tier AND a
  // deliverable output — all four decisions live in `mergeCardsPlan`, and this
  // gate is the SAME call the offer and the finalizer make, so an event can
  // never advertise a trade it would then refuse (a player with three Diamonds
  // and nothing else, or a bag with no room for anything at tier+1, sees this
  // rung dark instead of spending three cards for a fallback coin).
  if (choice.outcome.kind === 'mergeCards') return mergeCardsPlan(state) !== null;
  return true;
}

/** An event is eligible to be OFFERED at `state.gold` (and current inventory)
 * if at least one of its choices is both usable AND not the `nothing` no-op
 * outcome — an event whose only usable option is the safe "walk away" exit
 * is exactly the dead-end case this guards against. */
function hasAffordableChoice(state: RunState, event: EventDef): boolean {
  return event.choices.some((c) => isEventChoiceUsable(state, c) && c.outcome.kind !== 'nothing');
}

/** First id in `ids` (fixed order) eligible at `state.gold`, or -1. */
function firstEligibleIndex(ids: readonly string[], state: RunState): number {
  return ids.findIndex((id) => hasAffordableChoice(state, eventCatalog[id]!));
}

// ---------------------------------------------------------------------------
// Event draw — a per-run no-repeat bag over `eventCatalogIds`, mirroring the
// map-gen shop theme bag but stored/refilled on `RunState` itself (which
// event nodes actually get visited is path-dependent, so the bag can't be
// pre-rolled at map-gen time the way shop themes are).
//
// A node's `eventTheme` (assigned at map-gen, see runMap.ts) narrows the draw
// to that theme's slice of the catalog: `state.eventThemeBags[theme]` is a
// no-repeat bag over just that theme's event ids, refilled (reshuffled) only
// once ITS theme is exhausted — so two different themes exhaust and refill
// independently. Nodes without an `eventTheme` (older/defensive state) fall
// back to the original all-catalog `state.eventBag`/`eventBagRefills` pair.
//
// Within a bag, the draw takes the FIRST bag entry that's eligible at the
// player's current gold (see `hasAffordableChoice`), not necessarily bag[0] —
// entries the draw skips stay in the bag (order otherwise preserved) so they
// remain available to later nodes once affordable again; the no-repeat
// guarantee is about which id a given node's draw commits to, not the scan
// order. If nothing in the bag is eligible (a gold-heavy theme at 0 gold),
// the draw widens to the first eligible id in the WHOLE catalog (fixed
// catalog order) without touching the theme bag at all — a deliberately rare,
// last-resort path that never throws, even if (in a content bug) literally
// nothing in the catalog is eligible: it then just falls back to the bag's
// own head rather than leaving the node unresolved.
// ---------------------------------------------------------------------------

/** Catalog ids for one theme, in fixed catalog order. */
function idsForTheme(theme: EventTheme): readonly string[] {
  return eventCatalogIds.filter((id) => eventCatalog[id]!.theme === theme);
}

/** Draws (idempotently) the event for `node` — repeated calls for the same
 * node return the SAME event without consuming the bag again (the
 * affordability check only runs on this FIRST roll; the memo is authoritative
 * afterward, so a reload/gold change never re-draws a different event for an
 * already-resolved node). Throws if `node` isn't an event node. */
export function rollEventForNode(state: RunState, node: RunNode): { state: RunState; event: EventDef } {
  if (node.kind !== 'event') {
    throw new Error(`rollEventForNode: node "${node.id}" is not an event node`);
  }
  const existingId = state.eventInstances[node.id];
  if (existingId) {
    const event = eventCatalog[existingId];
    if (!event) throw new Error(`rollEventForNode: unknown recorded event id "${existingId}" for node "${node.id}"`);
    return { state, event };
  }

  const theme = node.eventTheme;
  if (theme === undefined) {
    // Defensive fallback (no theme on the node) — today's original
    // all-catalog no-repeat bag, now affordability-aware.
    let bag = state.eventBag;
    let refills = state.eventBagRefills;
    if (bag.length === 0) {
      const rng = new Rng(hashSeed('eventBag', state.seed, refills));
      bag = sampleDistinct(rng, eventCatalogIds, eventCatalogIds.length);
      refills += 1;
    }
    const eligibleIdx = firstEligibleIndex(bag, state);
    if (eligibleIdx === -1) {
      // The whole catalog is this bag's pool already — nothing eligible
      // anywhere means a content bug (every event's every choice is
      // gold-gated or `nothing`). Never throw: fall back to the bag's head.
      const eventId = bag[0]!;
      const event = eventCatalog[eventId];
      if (!event) throw new Error(`rollEventForNode: unknown catalog event id "${eventId}"`);
      const nextState: RunState = {
        ...state,
        eventBag: bag.slice(1),
        eventBagRefills: refills,
        eventInstances: { ...state.eventInstances, [node.id]: eventId },
      };
      return { state: nextState, event };
    }
    const eventId = bag[eligibleIdx]!;
    const event = eventCatalog[eventId];
    if (!event) throw new Error(`rollEventForNode: unknown catalog event id "${eventId}"`);
    const nextState: RunState = {
      ...state,
      eventBag: [...bag.slice(0, eligibleIdx), ...bag.slice(eligibleIdx + 1)],
      eventBagRefills: refills,
      eventInstances: { ...state.eventInstances, [node.id]: eventId },
    };
    return { state: nextState, event };
  }

  const themePool = idsForTheme(theme);
  const themeBags = state.eventThemeBags ?? {};
  const themeRefills = state.eventThemeBagRefills ?? {};
  let bag = themeBags[theme] ?? [];
  let refills = themeRefills[theme] ?? 0;
  if (bag.length === 0) {
    const rng = new Rng(hashSeed('eventBag', state.seed, theme, refills));
    bag = sampleDistinct(rng, themePool, themePool.length);
    refills += 1;
  }

  const eligibleIdx = firstEligibleIndex(bag, state);
  if (eligibleIdx === -1) {
    // Nothing currently in this theme's bag is eligible at this gold. Persist
    // the (possibly just-refilled) bag as-is — it wasn't consumed, only
    // scanned — and widen the draw to the first eligible id in the WHOLE
    // catalog, graceful and non-throwing even if that also comes up empty.
    const eventId = eventCatalogIds[firstEligibleIndex(eventCatalogIds, state)] ?? bag[0] ?? eventCatalogIds[0]!;
    const event = eventCatalog[eventId];
    if (!event) throw new Error(`rollEventForNode: unknown catalog event id "${eventId}"`);
    const nextState: RunState = {
      ...state,
      eventThemeBags: { ...themeBags, [theme]: bag },
      eventThemeBagRefills: { ...themeRefills, [theme]: refills },
      eventInstances: { ...state.eventInstances, [node.id]: eventId },
    };
    return { state: nextState, event };
  }

  const eventId = bag[eligibleIdx]!;
  const event = eventCatalog[eventId];
  if (!event) throw new Error(`rollEventForNode: unknown catalog event id "${eventId}"`);

  const nextState: RunState = {
    ...state,
    eventThemeBags: { ...themeBags, [theme]: [...bag.slice(0, eligibleIdx), ...bag.slice(eligibleIdx + 1)] },
    eventThemeBagRefills: { ...themeRefills, [theme]: refills },
    eventInstances: { ...state.eventInstances, [node.id]: eventId },
  };
  return { state: nextState, event };
}

// ---------------------------------------------------------------------------
// Outcome application.
// ---------------------------------------------------------------------------

function grantCardOutcome(
  state: RunState,
  rng: Rng,
  spec: Extract<EventOutcomeSpec, { kind: 'grantCard' }>,
): { state: RunState; outcome: EventOutcome } {
  const requested = spec.tier ?? DEFAULT_CARD_TIER;
  let skillId = spec.cardId;
  if (!skillId) {
    const matches = Object.values(skillBook).filter((s) => (spec.filter ? cardMatchesFilter(s, spec.filter) : true));
    if (matches.length === 0) throw new Error('grantCard: no skill matches the given filter');
    // TIER MINIMUMS, BY EXCLUSION (`offerableBook`'s doc comment): prefer the
    // cards that genuinely have a copy at `requested`, so a Bronze grant stays a
    // Bronze grant. Falls back to the unnarrowed matches if the tier filter
    // empties them — the same "never throw over a narrow filter" posture this
    // function already takes, and the clamp below then keeps the grant honest.
    // ONE `rng.pick` either way: the draw count is unchanged, only the array it
    // indexes into is.
    const offerable = matches.filter((s) => cardOfferableAtTier(s, requested));
    skillId = rng.pick(offerable.length > 0 ? offerable : matches).id;
  }
  // THE NAMED-CARD PATH CLAMPS. With `spec.cardId` set there is no pool to
  // narrow — content named exactly this card — so refusing would make the choice
  // dead and stamping `requested` would record a tier the card has no copy at
  // (`applyTier` would resolve the real, higher kit while `sellPriceOfCard` and
  // the merge ladder priced the stamp: a corrupt owned instance). The grant is
  // therefore raised to the card's minimum and REPORTED at the tier actually
  // handed over, so the reward screen and the run's own record agree.
  const named = skillBook[skillId];
  const tier = (named ? clampTierToCard(named, requested) : null) ?? requested;
  const inserted = tryInsertRunCard(state, skillId, tier);
  if (!inserted) {
    return {
      state: {
        ...state,
        gold: state.gold + CARD_FALLBACK_GOLD,
        stats: { ...state.stats, goldEarned: state.stats.goldEarned + CARD_FALLBACK_GOLD },
      },
      outcome: { kind: 'grantGold', amount: CARD_FALLBACK_GOLD, fellBack: true },
    };
  }
  return { state: inserted.state, outcome: { kind: 'grantCard', skillId, tier } };
}

/**
 * `depth` is the SAME wave->depth band `rollShopStock` uses for its own
 * bronze/silver/gold + gem-rarity gating (`shopStockDepthForWave`, shared
 * from `runState.ts`, never re-derived here) — routing an event's gem grant
 * through `pickWeightedGem` (shared from `shop.ts`) means a wave-1 event
 * grant is gated out of Legendary exactly the same as a wave-1 shop shelf
 * is, instead of the old uniform `rng.pick(Object.values(gemBook))` that let
 * a free event hand out an ~11.4%-chance Legendary at ANY depth (shop gates
 * that to ~0% before `LEGENDARY_GATE_DEPTH`). This changes which gem a fixed
 * (state, choiceId) resolves to versus before — see the module-level
 * determinism note this function's caller (`resolveEventChoice`) still
 * honors: one `Rng` per `(eventSeed, choiceId)`, one draw call here, in the
 * same fixed order as before — only the VALUE that draw resolves to differs.
 */
function grantGemOutcome(
  state: RunState,
  rng: Rng,
  spec: Extract<EventOutcomeSpec, { kind: 'grantGem' }>,
  depth: number,
): { state: RunState; outcome: EventOutcome } {
  let gemId = spec.gemId;
  if (!gemId) {
    const pool = Object.values(gemBook).filter((g) => (spec.filter ? gemMatchesFilter(g, spec.filter) : true));
    if (pool.length === 0) throw new Error('grantGem: no gem matches the given filter');
    gemId = pickWeightedGem(rng, pool, depth).id;
  }
  return {
    state: { ...state, gemInventory: [...state.gemInventory, gemId] },
    outcome: { kind: 'grantGem', gemId },
  };
}

/** The immediate, credits-gold-and-reports-`fellBack` no-eligible-cards
 * outcome shared by `upgradeCardOutcome` (nothing was ever eligible) and
 * `applyUpgradeCardPick` (defensive: the picked `instanceId` no longer
 * resolves — see that function's doc comment). Not exported; both call sites
 * live in this module. */
function upgradeCardFallback(state: RunState): { state: RunState; outcome: EventOutcome } {
  return {
    state: {
      ...state,
      gold: state.gold + CARD_FALLBACK_GOLD,
      stats: { ...state.stats, goldEarned: state.stats.goldEarned + CARD_FALLBACK_GOLD },
    },
    outcome: { kind: 'upgradeCard', fellBack: true },
  };
}

/** Every owned card eligible for `upgradeCard` (not already `diamond` — the
 * ladder's top rung) — board `pieces` first (ascending `slot`), then bag
 * `bagSlots` (array order), mirroring the shop/DeckBuild convention of
 * treating board+bag as one owned pool. Pure read, no state change. */
function upgradeCardOptions(state: RunState): UpgradeCardOption[] {
  const options: UpgradeCardOption[] = [];
  for (const piece of [...state.pieces].sort((a, b) => a.slot - b.slot)) {
    if (piece.tier === 'diamond') continue;
    options.push({
      instanceId: piece.instanceId,
      skillId: piece.skillId,
      from: piece.tier,
      to: TIER_UP[piece.tier as Exclude<SkillTier, 'diamond'>],
    });
  }
  for (const card of state.bagSlots) {
    if (!card || card.tier === 'diamond') continue;
    options.push({
      instanceId: card.instanceId,
      skillId: card.skillId,
      from: card.tier,
      to: TIER_UP[card.tier as Exclude<SkillTier, 'diamond'>],
    });
  }
  return options;
}

/**
 * `upgradeCard` — lets the player pick ONE already-owned card to bump +1 tier
 * (see the doc comment on `EventOutcomeSpec`'s `upgradeCard` member in
 * `data/events.ts` for the full picker shape). No `Rng` draw: the ELIGIBLE
 * SET is a pure function of `state.pieces`/`state.bagSlots`, same board-then-
 * bag ordering `upgradeCardOptions` documents.
 *
 * If at least one card is eligible, defers to the player: returns
 * `{kind: 'upgradeCardPick', options}` WITHOUT mutating state (the actual
 * tier bump happens in `applyUpgradeCardPick`, once the UI reports which
 * option was tapped — same two-step shape as `bonusDraftOutcome`/
 * `applyBonusDraftPick`). If nothing is eligible (no owned cards, or every
 * owned card is already diamond), resolves immediately via
 * `upgradeCardFallback` — still credits `CARD_FALLBACK_GOLD` (so the choice's
 * cost was never paid for literally nothing) but reports
 * `{kind: 'upgradeCard', fellBack: true}` rather than switching to a
 * `grantGold`-shaped outcome — see the `EventOutcome` union's `upgradeCard`
 * comment for why this diverges from `grantCard`'s fallback idiom.
 */
function upgradeCardOutcome(state: RunState): { state: RunState; outcome: EventOutcome } {
  const options = upgradeCardOptions(state);
  if (options.length === 0) return upgradeCardFallback(state);
  return { state, outcome: { kind: 'upgradeCardPick', options } };
}

function bonusDraftOutcome(
  rng: Rng,
  spec: Extract<EventOutcomeSpec, { kind: 'bonusDraft' }>,
): EventOutcome {
  // `toDraftCard` stamps Bronze (`DraftCard.tier` is the literal `'bronze'`), so
  // the pool is narrowed to cards that HAVE a Bronze copy before the theme filter
  // runs — the fallback chain is themed-and-Bronze -> whole-book-and-Bronze, and
  // no arm of it can produce a card this mini-draft cannot hand over at Bronze.
  const all = offerableBook(DEFAULT_CARD_TIER);
  const pool = spec.filter ? all.filter((s) => cardMatchesFilter(s, spec.filter!)) : all;
  const picked = sampleDistinct(rng, pool.length > 0 ? pool : all, BONUS_DRAFT_SIZE);
  return { kind: 'bonusDraft', cards: picked.map((s) => toDraftCard(s.id)) };
}

/**
 * `cardChoice` — the widened `grantCard` sibling (see `EventOutcomeSpec`'s
 * doc comment in data/events.ts and `EVENT_CHOICE_SIZE`'s pricing-arithmetic
 * comment above): draws `EVENT_CHOICE_SIZE` DISTINCT skills matching
 * `spec.filter` (same `cardMatchesFilter` the unwidened `grantCard` and the
 * paid `bonusDraft` both already use) at `spec.tier ?? DEFAULT_CARD_TIER`,
 * and returns them as a `bonusDraft`-shaped deferred pick — deliberately
 * `bonusDraftOutcome`'s EXACT resolved shape, just a narrower width and (for
 * the first time) a caller-chosen tier, so `applyBonusDraftPick` finalizes a
 * `cardChoice` pick with zero changes. Falls back to the unfiltered book
 * (same "never throw over a narrow filter" idiom as `grantCard`) only if the
 * filtered pool is EMPTY.
 *
 * If the filtered pool is non-empty but narrower than `EVENT_CHOICE_SIZE`,
 * this THROWS (2026-08-18 QA pass) rather than silently handing the player a
 * 1-of-1 or 1-of-2 "pick" — a build-time-loud content-lint failure, same
 * posture as `grantCard`/`gemChoice`'s existing "no skill/gem matches the
 * given filter" throws on an empty pool, just at the width this outcome
 * actually promises instead of at zero. Every filter in the catalog today
 * matches 17+ skills (see the catalog lint test asserting this), so this can
 * never trip over live content — it only guards a FUTURE narrow filter from
 * shipping silently broken.
 */
function cardChoiceOutcome(
  rng: Rng,
  spec: Extract<EventOutcomeSpec, { kind: 'cardChoice' }>,
): EventOutcome {
  // `spec.tier` is narrowed to `'bronze'` at the type level (see the doc
  // comment on `cardChoice` in data/events.ts) — `toDraftCard` always builds
  // a bronze `DraftCard`, so there's nothing to branch on here today.
  //
  // Bronze-offerable only, exactly as `bonusDraftOutcome` above: the width guard
  // below therefore measures the pool the player can REALLY be shown, so a tier
  // minimum that thinned a filter under `EVENT_CHOICE_SIZE` is reported as the
  // content problem it is rather than silently handing back a 1-of-2 "pick".
  const all = offerableBook(DEFAULT_CARD_TIER);
  const pool = spec.filter ? all.filter((s) => cardMatchesFilter(s, spec.filter!)) : all;
  const drawPool = pool.length > 0 ? pool : all;
  if (drawPool.length < EVENT_CHOICE_SIZE) {
    throw new Error(
      `cardChoice: filtered pool has only ${drawPool.length} card(s), fewer than EVENT_CHOICE_SIZE (${EVENT_CHOICE_SIZE})`,
    );
  }
  const picked = sampleDistinct(rng, drawPool, EVENT_CHOICE_SIZE);
  return { kind: 'bonusDraft', cards: picked.map((s) => toDraftCard(s.id)) };
}

/**
 * `gemChoice` — the widened `grantGem` sibling. Draws `EVENT_CHOICE_SIZE`
 * DISTINCT gem ids matching `spec.filter` (today, no `gemChoice` in the
 * catalog carries one — every conversion was an unfiltered `grantGem`, same
 * as the brief's own audit found for the whole `grantGem` vocabulary), depth-
 * gated and rarity-weighted through the SAME `pickWeightedGems` a single
 * `grantGem` grant (`grantGemOutcome`, via `pickWeightedGem`) and a same-
 * depth shop shelf both draw from — so a wave-1 `gemChoice` is exactly as
 * Legendary-gated as everything else at that depth. Returns a genuinely NEW
 * deferred `{kind:'gemChoicePick', options}` (gem ids only — no display
 * metadata needed, `applyGemChoicePick` re-resolves the picked id against
 * `gemBook` itself), never mutating `state` — same "roll now, pick later,
 * apply nothing until the player taps" contract as `bonusDraft`/
 * `upgradeCard`.
 *
 * Throws if the filtered pool is narrower than `EVENT_CHOICE_SIZE` (2026-08-18
 * QA pass) — same reasoning as `cardChoiceOutcome`'s sibling guard above:
 * `pickWeightedGems` (shop.ts) doesn't error on a too-small pool, it just
 * hands back fewer than `count` distinct gems, so this is the seam that has
 * to catch it. Checked against the RAW filtered pool, before
 * `pickWeightedGems`'s own depth-gating — depth-gating already has its own
 * "eligible is empty -> fall back to the ungated pool" rule (shop.ts), a
 * separate, pre-existing concern this guard doesn't touch. No `gemChoice` in
 * the catalog carries a `filter` today, so this never trips over live
 * content.
 */
function gemChoiceOutcome(
  rng: Rng,
  spec: Extract<EventOutcomeSpec, { kind: 'gemChoice' }>,
  depth: number,
): EventOutcome {
  const pool = Object.values(gemBook).filter((g) => (spec.filter ? gemMatchesFilter(g, spec.filter) : true));
  if (pool.length === 0) throw new Error('gemChoice: no gem matches the given filter');
  if (pool.length < EVENT_CHOICE_SIZE) {
    throw new Error(
      `gemChoice: filtered gem pool has only ${pool.length} gem(s), fewer than EVENT_CHOICE_SIZE (${EVENT_CHOICE_SIZE})`,
    );
  }
  const options = pickWeightedGems(rng, pool, depth, EVENT_CHOICE_SIZE).map((g) => g.id);
  return { kind: 'gemChoicePick', options };
}

/**
 * `sellGem` — offers every gem currently in the player's pouch
 * (`state.gemInventory`, unsocketed only — a socketed gem lives on
 * `BoardPiece.gem` and isn't touched here) as a deferred pick, priced via
 * `sellPriceOfGem` (shop.ts's existing half-of-shop-buy-price, floored,
 * min-1-gold sell formula — the SAME one `sellRunGem`/`sellCurrentRunGem`
 * already use for the Deck/Bag screen's SELL button, so an event sale and a
 * bag sale of the identical gem always pay the identical price). No `Rng`
 * draw and no depth gate: unlike `gemChoice`'s freshly-rolled candidates,
 * this is a pure READ of the player's own inventory in its existing order —
 * nothing here is random, so nothing needs seeding (determinism invariant
 * satisfied trivially).
 *
 * Throws if the pouch is empty — this should never happen in practice, since
 * `isEventChoiceUsable` (the gate `rollEventForNode`'s `hasAffordableChoice`
 * AND the UI both call) refuses to offer a `sellGem` choice as usable with an
 * empty pouch; this is the same "should be gated before resolve, never
 * silently resolve to an empty picker" posture `cardChoiceOutcome`/
 * `gemChoiceOutcome`'s own too-small-pool throws take.
 */
function sellGemOutcome(state: RunState): EventOutcome {
  if (state.gemInventory.length === 0) {
    throw new Error('sellGem: pouch is empty (should be gated unusable before resolve — see isEventChoiceUsable)');
  }
  const options: SellGemOption[] = state.gemInventory.map((gemId, pouchIndex) => ({
    pouchIndex,
    gemId,
    price: sellPriceOfGem(gemId),
  }));
  return { kind: 'sellGemPick', options };
}

// ---------------------------------------------------------------------------
// CARD MERGE (2026-08-26) — three owned cards of ONE tier in, a CHOICE of three
// cards at tier+1 out. The only destructive card outcome in the vocabulary, so
// it is also the only one that has to prove a negative: no path may consume the
// inputs without delivering an output.
//
// FOUR THINGS ARE DECIDED HERE, and `mergeCardsPlan` below is the SINGLE
// authority on all four — the eligibility gate (`isEventChoiceUsable`), the
// offer (`mergeCardsOutcome`) and the finalizer (`applyMergeCardsPick`) all read
// THAT function rather than re-deriving any of it, which is what makes a dimmed
// button, a shown offer and an applied merge incapable of disagreeing (the same
// "one predicate authority" rule `isEventChoiceAffordable` states for gold).
//
//   1. WHICH TIER MERGES — the LOWEST tier that has `MERGE_INPUT_COUNT` owned
//      cards and can actually deliver its output. Lowest, not highest: a Bronze
//      trio is the surplus a run accumulates by accident, while three Golds are
//      three cards the player deliberately built, and an event that quietly ate
//      them because they happened to be the deeper stack would be exactly the
//      trap the same-tier rule exists to remove.
//   2. WHICH THREE ARE CONSUMED — BAG FIRST (array order), then BOARD (ascending
//      `slot`). Deliberately the INVERSE of `upgradeCardOptions`'s board-first
//      order, and for the reason that ordering exists at all: `upgradeCard`
//      IMPROVES what it touches, so it reaches for the board (the cards actually
//      fighting) first; this outcome DESTROYS what it touches, so it reaches for
//      the bag — the un-equipped spares — first, and only breaks into the
//      player's own expressed build when the bag cannot pay. Within one tier the
//      game has no value ordering to prefer by (`sellPriceOfCard` is keyed on
//      tier alone), so there is nothing finer to sort on; a per-instance PICKER
//      for the inputs would need a second deferred step no outcome in this
//      vocabulary has, and is a follow-up, not a v1 omission that loses value —
//      the three instances are NAMED IN THE OFFER before the trade can be taken.
//   3. WHAT COMES BACK — `EVENT_CHOICE_SIZE` (3) distinct candidates drawn from
//      the cards that are OFFERABLE at tier+1 (`cardOfferableAtTier` via
//      `offerableBook`, never a fourth predicate) AND fit the bag the removal
//      leaves behind. Offerable, so the output is neither a husk nor a card
//      stamped at a tier it has no copy at (the `d1ac673` trap); fitting, so the
//      offer cannot contain a card the merge would fail to hand over.
//   4. WHETHER THE TRADE IS OFFERED AT ALL — it is a plan or it is nothing.
//      DIAMOND: the top of the ladder has no tier+1, so a Diamond trio is never
//      an input (the loop skips it) and a player whose ONLY trio is Diamond gets
//      this choice reported UNUSABLE rather than a button that spends three
//      Diamonds for nothing. NO ROOM: if every card at tier+1 is too big for the
//      bag the removal leaves, that tier yields no plan either (the loop moves
//      on to the next tier up, and if none qualifies the choice is unusable) —
//      so "the output cannot fit" is answered BEFORE the inputs are touched, by
//      not making the offer, rather than after, by a refund. Both events
//      carrying this outcome keep another non-`nothing` choice, so the EVENT
//      still appears in either case; only the merge rung is dark.
//
// THE OFFER IS AN `EventOutcome` MEMBER (`mergeCardsPick`), NOT A SIDE FIELD.
// It shipped (2026-08-26) as an optional `merge` riding beside
// `outcome: {kind:'nothing'}`, because the pass that built the mechanic could
// not add a union member without editing `src/game/ui/eventOutcomeText.ts` —
// its switch closes on `const exhaustive: never` — and that file was outside
// its ownership. The UI phase (2026-08-28) owns both sides and paid the
// workaround off instead of building on it; see the `mergeCardsPick` member's
// own comment in the `EventOutcome` union above for the full argument. What
// matters here: `mergeCardsOutcome` changes NOTHING about the run state, and
// the state-unchanged assertions in `tests/run/cardMerge.test.ts` are what
// hold that line — not the shape of the return value.
// ---------------------------------------------------------------------------

/** How many same-tier cards one merge consumes. Exported so the tests (and a
 * future UI) measure against the resolver's own number, never a literal 3. */
export const MERGE_INPUT_COUNT = 3;

/** One owned instance a merge would consume — enough to DISPLAY it
 * (`skillId`/`tier`), to re-identify it (`instanceId`, globally unique across
 * `pieces` AND `bagSlots`, see `tryInsertRunCard`'s counter), and to REMOVE it
 * (`location` + `index`, the same addressing `sellRunCard` takes: an index into
 * `state.pieces` for `'board'`, into `state.bagSlots` for `'bag'` — NOT the
 * board `slot`, which is a different number). */
export interface MergeInputCard {
  instanceId: string;
  skillId: string;
  tier: SkillTier;
  location: 'board' | 'bag';
  index: number;
}

/** One card the merge could hand back — `tier` is always the offer's `to`, and
 * is the tier the card is REALLY delivered at (`cardOfferableAtTier` filtered
 * the pool, `tryInsertRunCard` clamps again), so nothing here is stamped at a
 * tier the card has no copy at. */
export interface MergeCardsCandidate {
  skillId: string;
  tier: SkillTier;
}

/** The whole trade, legible BEFORE it is taken: the three instances that go in,
 * the tier that comes back, and the three cards it could be. */
export interface MergeCardsOffer {
  from: SkillTier;
  to: SkillTier;
  consumed: readonly MergeInputCard[];
  candidates: readonly MergeCardsCandidate[];
}

/** The trade as TAKEN — what `applyMergeCardsPick` actually did, for the reward
 * screen's "3 BRONZE -> 1 SILVER" line. Deliberately not a `MergeCardsOffer`
 * with one candidate left in it: an offer is a set of possibilities, a receipt
 * names the single card that arrived. */
export interface MergeCardsReceipt {
  from: SkillTier;
  to: SkillTier;
  consumed: readonly MergeInputCard[];
  taken: MergeCardsCandidate;
}

/** `MergeCardsOffer` plus the two things only the resolver needs: the state the
 * removal leaves behind, and the FULL set of cards deliverable into it (the
 * offer's `candidates` are `EVENT_CHOICE_SIZE` drawn from this). */
interface MergeCardsPlan {
  from: SkillTier;
  to: SkillTier;
  consumed: readonly MergeInputCard[];
  after: RunState;
  pool: readonly SkillDef[];
}

/** Every owned card stamped exactly `tier`, in CONSUMPTION ORDER — bag (array
 * order) then board (ascending `slot`). See decision 2 in the block comment
 * above for why the bag is first. Pure read. */
function ownedCardsAtTier(state: RunState, tier: SkillTier): MergeInputCard[] {
  const out: MergeInputCard[] = [];
  for (let i = 0; i < state.bagSlots.length; i += 1) {
    const card = state.bagSlots[i];
    if (!card || card.tier !== tier) continue;
    out.push({ instanceId: card.instanceId, skillId: card.skillId, tier: card.tier, location: 'bag', index: i });
  }
  // Board pieces are addressed by their INDEX in `state.pieces` (what removal
  // needs) but ORDERED by `slot` (what the player sees), so the two are tracked
  // separately rather than assuming the array is slot-sorted — nothing in
  // `runState.ts` promises that it is.
  const byIndex: number[] = [];
  for (let i = 0; i < state.pieces.length; i += 1) byIndex.push(i);
  byIndex.sort((a, b) => state.pieces[a]!.slot - state.pieces[b]!.slot);
  for (let k = 0; k < byIndex.length; k += 1) {
    const i = byIndex[k]!;
    const piece = state.pieces[i]!;
    if (piece.tier !== tier) continue;
    out.push({ instanceId: piece.instanceId, skillId: piece.skillId, tier: piece.tier, location: 'board', index: i });
  }
  return out;
}

/**
 * `state` with `consumed` removed — the ONLY destructive step in this module.
 *
 * BOARD: the piece is dropped from `state.pieces` and any SOCKETED GEM comes
 * back to the pouch rather than being destroyed with it, exactly as
 * `sellRunCard` (runState.ts) does for a sold board piece — a merge must not be
 * a quieter way to lose a gem than selling. Surviving pieces keep their own
 * `slot` untouched, so no card's span moves and no multi-slot card can end up
 * straddling a gap: removal only ever LEAVES a hole, which is the same shape
 * selling a board card already leaves and which `canPlace`/`bagOccupiedFrom`
 * both already read as free.
 *
 * BAG: the card's own (leftmost) slot is nulled and nothing else — a size-N
 * card's trailing placeholders read as free the instant the head clears, since
 * bag occupancy is DERIVED by scanning non-null cards and their skill size
 * (`bagOccupiedFrom`, runState.ts). Same idiom, same one-line reason, as
 * `sellRunCard`'s bag branch; no orphan entry can be left behind because there
 * is no second entry to orphan.
 */
function removeOwnedCards(state: RunState, consumed: readonly MergeInputCard[]): RunState {
  const boardIndices: number[] = [];
  const bagIndices: number[] = [];
  for (let i = 0; i < consumed.length; i += 1) {
    const card = consumed[i]!;
    if (card.location === 'board') boardIndices.push(card.index);
    else bagIndices.push(card.index);
  }
  const pieces: RunBoardPiece[] = [];
  const freedGems: string[] = [];
  for (let i = 0; i < state.pieces.length; i += 1) {
    const piece = state.pieces[i]!;
    if (boardIndices.indexOf(i) === -1) {
      pieces.push(piece);
      continue;
    }
    if (piece.gem) freedGems.push(piece.gem.id);
  }
  const bagSlots: RunBagSlot[] = [...state.bagSlots];
  for (let i = 0; i < bagIndices.length; i += 1) bagSlots[bagIndices[i]!] = null;
  return {
    ...state,
    pieces,
    bagSlots,
    gemInventory: freedGems.length > 0 ? [...state.gemInventory, ...freedGems] : state.gemInventory,
  };
}

/**
 * THE MERGE, AS A PURE FUNCTION OF STATE — or `null` when there is no honest
 * trade to offer. No `Rng`: which tier, which three instances and which cards
 * are deliverable are all determined by `state.pieces`/`state.bagSlots` alone,
 * so the gate can call this without a seed and the offer draws its three
 * candidates from the plan's pool afterward. See the block comment above for
 * the four decisions this encodes.
 *
 * The tier loop CONTINUES rather than returning on a tier that cannot deliver:
 * a Bronze trio whose Silver output has nowhere to sit does not block a Silver
 * trio from becoming a Gold card in the same bag (the Silver merge frees three
 * bag/board slots of its own). Only when NO tier qualifies is there no plan.
 */
function mergeCardsPlan(state: RunState): MergeCardsPlan | null {
  for (let t = 0; t < TIER_LADDER.length; t += 1) {
    const from = TIER_LADDER[t]!;
    if (from === 'diamond') continue; // the top rung has no tier+1 — never an input
    const to = TIER_UP[from as Exclude<SkillTier, 'diamond'>];
    const owned = ownedCardsAtTier(state, from);
    if (owned.length < MERGE_INPUT_COUNT) continue;
    const consumed = owned.slice(0, MERGE_INPUT_COUNT);
    const after = removeOwnedCards(state, consumed);
    // OFFERABLE AT `to` AND DELIVERABLE INTO `after` — the two independent
    // reasons a candidate would be a broken promise, both answered before the
    // offer exists. `Array#filter` twice over the book's canonical id order, so
    // the pool is order-stable and the draw below is reproducible.
    const pool = offerableBook(to).filter((s) => runBagHasRoomFor(after, s.id));
    if (pool.length === 0) continue;
    return { from, to, consumed, after, pool };
  }
  return null;
}

/** The trade `state` would be offered right now, or `null`. The plan plus one
 * `sampleDistinct` draw over its pool — the only place a merge spends `Rng`,
 * and it spends it exactly once, from the choice's own
 * `hashSeed('event', eventSeed, choiceId)` stream, so no other outcome's rolls
 * shift. Internal: `isEventChoiceUsable` answers "is there a trade" without a
 * seed via `mergeCardsPlan` directly, so a UI preview needs no draw either. */
function mergeCardsOffer(state: RunState, rng: Rng): MergeCardsOffer | null {
  const plan = mergeCardsPlan(state);
  if (!plan) return null;
  const drawn = sampleDistinct(rng, plan.pool, EVENT_CHOICE_SIZE);
  return {
    from: plan.from,
    to: plan.to,
    consumed: plan.consumed,
    candidates: drawn.map((s) => ({ skillId: s.id, tier: plan.to })),
  };
}

/**
 * `mergeCards` — returns the OFFER and changes nothing. The removal happens in
 * `applyMergeCardsPick`, once the player has picked which of the three
 * candidates to take, so a player who never picks has lost nothing.
 *
 * Throws on an empty plan, the same posture (and for the same reason) as
 * `sellGemOutcome`'s empty-pouch throw: `isEventChoiceUsable` — the gate BOTH
 * `rollEventForNode`'s `hasAffordableChoice` and the UI call — refuses this
 * choice when `mergeCardsPlan` is null, so reaching here without a plan is a
 * wiring bug, not a state to render.
 *
 * NOTE THE OFFER IS FEWER THAN `EVENT_CHOICE_SIZE` CANDIDATES only when the
 * deliverable pool itself is thinner than 3 (a nearly-full bag with room for
 * one small card). Unlike `cardChoice`'s pool — which is authored content and
 * therefore THROWS when it is too thin — this one is a function of the player's
 * bag at that moment, so a narrow offer is a real game state, not a content
 * bug: a 1-of-1 merge is still a legible trade, and refusing it would take away
 * a merge the run can honour.
 */
function mergeCardsOutcome(
  state: RunState,
  rng: Rng,
): { state: RunState; outcome: EventOutcome } {
  const offer = mergeCardsOffer(state, rng);
  if (!offer) {
    throw new Error('mergeCards: no mergeable trio (should be gated unusable before resolve — see isEventChoiceUsable)');
  }
  // `state` is returned UNTOUCHED beside the question — the removal happens in
  // `applyMergeCardsPick` and nowhere else.
  return { state, outcome: { kind: 'mergeCardsPick', ...offer } };
}

/**
 * Finalizes a `mergeCards` offer: consumes the three inputs and inserts
 * `skillId` at tier+1. THE ONLY PLACE THE TRADE IS EXECUTED, and it re-derives
 * the plan from `state` rather than trusting the offer it was shown — the
 * consumed instances therefore cannot be chosen by the caller, which is what
 * keeps a UI bug from turning into "consume any three cards I name".
 *
 * ATOMIC IN BOTH DIRECTIONS. The insert runs against the POST-REMOVAL state, so
 * the three freed slots are available to the output (a size-3 output can sit
 * exactly where a size-3 input was). If anything is wrong — no plan any more,
 * a `skillId` that was never deliverable, or an insert that somehow still fails
 * — the ORIGINAL `state` is returned untouched and the outcome is the same
 * `grantGold`/`fellBack` consolation `applyBonusDraftPick` gives a full bag.
 * There is no ordering in which inputs are consumed and no output arrives.
 *
 * Validation is against the plan's whole deliverable POOL rather than the three
 * candidates the offer happened to draw (which would need the choice's seed
 * again). Same trust model as `applyGemChoicePick` — the picker only ever hands
 * back something it was just shown — but a strictly tighter check than that
 * function's "is it a real id", since pool membership is exactly the "can this
 * be delivered" property.
 */
export function applyMergeCardsPick(
  state: RunState,
  skillId: string,
): { state: RunState; outcome: EventOutcome; merged?: MergeCardsReceipt } {
  const plan = mergeCardsPlan(state);
  const deliverable = plan ? plan.pool.some((s) => s.id === skillId) : false;
  const inserted = plan && deliverable ? tryInsertRunCard(plan.after, skillId, plan.to) : null;
  if (!plan || !inserted) {
    return {
      state: {
        ...state,
        gold: state.gold + CARD_FALLBACK_GOLD,
        stats: { ...state.stats, goldEarned: state.stats.goldEarned + CARD_FALLBACK_GOLD },
      },
      outcome: { kind: 'grantGold', amount: CARD_FALLBACK_GOLD, fellBack: true },
    };
  }
  return {
    state: inserted.state,
    outcome: { kind: 'grantCard', skillId, tier: plan.to },
    merged: {
      from: plan.from,
      to: plan.to,
      consumed: plan.consumed,
      taken: { skillId, tier: plan.to },
    },
  };
}

/** Applies a single (already-rolled) outcome spec. `depth` is the
 * node's shop-stock-equivalent depth band (see `grantGemOutcome`'s doc
 * comment) — `grantGem` and `gemChoice` both consume it today. */
function applySpec(
  state: RunState,
  rng: Rng,
  spec: EventOutcomeSpec,
  depth: number,
): { state: RunState; outcome: EventOutcome } {
  switch (spec.kind) {
    case 'grantCard':
      return grantCardOutcome(state, rng, spec);
    case 'grantGem':
      return grantGemOutcome(state, rng, spec, depth);
    case 'grantGold':
      return {
        state: {
          ...state,
          gold: state.gold + spec.amount,
          stats: { ...state.stats, goldEarned: state.stats.goldEarned + spec.amount },
        },
        outcome: { kind: 'grantGold', amount: spec.amount },
      };
    case 'loseGold': {
      const nextGold = Math.max(0, state.gold - spec.amount);
      const spent = state.gold - nextGold;
      return {
        state: { ...state, gold: nextGold, stats: { ...state.stats, goldSpent: state.stats.goldSpent + spent } },
        outcome: { kind: 'loseGold', amount: spec.amount },
      };
    }
    case 'grantLevel': {
      // Capped at MAX_LEVEL (USER-LOCKED 2026-07-30) — same ceiling the hero's
      // per-fight level-up respects in `recordBattleResult` (runState.ts).
      const level = Math.min(MAX_LEVEL, state.heroLevel + 1);
      return { state: { ...state, heroLevel: level }, outcome: { kind: 'grantLevel', level } };
    }
    case 'bonusDraft':
      return { state, outcome: bonusDraftOutcome(rng, spec) };
    case 'cardChoice':
      return { state, outcome: cardChoiceOutcome(rng, spec) };
    case 'gemChoice':
      return { state, outcome: gemChoiceOutcome(rng, spec, depth) };
    case 'upgradeCard':
      return upgradeCardOutcome(state);
    case 'sellGem':
      return { state, outcome: sellGemOutcome(state) };
    case 'mergeCards':
      return mergeCardsOutcome(state, rng);
    case 'nothing':
      return { state, outcome: { kind: 'nothing' } };
    default: {
      const exhaustive: never = spec;
      throw new Error(`applySpec: unknown outcome kind "${(exhaustive as EventOutcomeSpec).kind}"`);
    }
  }
}

/**
 * Resolves the currently-active event node's `choiceId` on `eventId`: deducts
 * the choice's upfront `cost` (if any), then applies its outcome spec. All
 * rolls derive from `hashSeed('event', node.eventSeed, choiceId)` (fixed call
 * order — e.g. a `grantCard` with a `filter` draw). A `grantGem` outcome's own
 * draw is gated/weighted by the active node's `shopStockDepthForWave(node.wave)`
 * depth band — the SAME gem rarity discipline (`GEM_RARITY_WEIGHT`/
 * `LEGENDARY_GATE_DEPTH`) the shop's shelf roll uses, via the shared
 * `pickWeightedGem` (`shop.ts`) — so an event grant can no longer hand out a
 * Legendary gem a same-depth shop shelf could never offer. Throws if there's
 * no active event node, or `eventId`/`choiceId` don't resolve to a real
 * catalog choice.
 *
 * A `mergeCards` choice resolves to the DEFERRED `mergeCardsPick` outcome (the
 * pending trade: which three go in, which tier comes back, which three cards it
 * could be) and leaves the run state untouched — like every other deferred
 * picker in this union, the question is what comes back and
 * `applyMergeCardsPick` is what changes anything.
 */
export function resolveEventChoice(
  state: RunState,
  eventId: string,
  choiceId: string,
): { state: RunState; outcome: EventOutcome } {
  const node = currentEventNode(state);
  if (!node) {
    throw new Error('resolveEventChoice: no event node is currently active');
  }
  const event = eventCatalog[eventId];
  if (!event) {
    throw new Error(`resolveEventChoice: unknown event id "${eventId}"`);
  }
  const choice = event.choices.find((c) => c.id === choiceId);
  if (!choice) {
    throw new Error(`resolveEventChoice: unknown choice id "${choiceId}" on event "${eventId}"`);
  }

  let working = state;
  if (choice.cost) {
    const nextGold = Math.max(0, working.gold - choice.cost);
    const spent = working.gold - nextGold;
    working = {
      ...working,
      gold: nextGold,
      stats: { ...working.stats, goldSpent: working.stats.goldSpent + spent },
    };
  }

  const rng = new Rng(hashSeed('event', node.eventSeed!, choiceId));
  const { state: nextState, outcome } = applySpec(working, rng, choice.outcome, shopStockDepthForWave(node.wave));
  return {
    state: { ...nextState, stats: { ...nextState.stats, eventsResolved: nextState.stats.eventsResolved + 1 } },
    outcome,
  };
}

/**
 * Finalizes a `bonusDraft` outcome's deferred pick (the UI shows the 5 rolled
 * cards between `resolveEventChoice` returning `{kind:'bonusDraft', cards}`
 * and calling this). Same nearest-fit bag insert as everything else; falls
 * back to `grantGold(2)` (flagged `fellBack: true`) if the bag has no room.
 */
export function applyBonusDraftPick(state: RunState, pick: DraftCard): { state: RunState; outcome: EventOutcome } {
  const inserted = tryInsertRunCard(state, pick.skillId, pick.tier);
  if (!inserted) {
    return {
      state: {
        ...state,
        gold: state.gold + CARD_FALLBACK_GOLD,
        stats: { ...state.stats, goldEarned: state.stats.goldEarned + CARD_FALLBACK_GOLD },
      },
      outcome: { kind: 'grantGold', amount: CARD_FALLBACK_GOLD, fellBack: true },
    };
  }
  return { state: inserted.state, outcome: { kind: 'grantCard', skillId: pick.skillId, tier: pick.tier } };
}

/**
 * Finalizes an `upgradeCard` outcome's deferred pick (the UI shows the
 * eligible cards between `resolveEventChoice` returning
 * `{kind:'upgradeCardPick', options}` and calling this) — bumps the picked
 * `instanceId` +1 tier. Board is checked before bag (mirroring
 * `upgradeCardOptions`'s ordering, though `instanceId` is globally unique —
 * see `tryInsertRunCard`'s counter — so at most one of the two lookups below
 * can ever match). Falls back to `upgradeCardFallback` (credits
 * `CARD_FALLBACK_GOLD`, reports `{fellBack: true}`) if `instanceId` no longer
 * resolves to an eligible owned card — defensive only, since the picker only
 * ever passes back one of the exact options `upgradeCardOutcome` just showed
 * it and nothing else can touch `state` in between.
 */
export function applyUpgradeCardPick(state: RunState, instanceId: string): { state: RunState; outcome: EventOutcome } {
  const boardIndex = state.pieces.findIndex((p) => p.instanceId === instanceId && p.tier !== 'diamond');
  if (boardIndex >= 0) {
    const target = state.pieces[boardIndex]!;
    const to = TIER_UP[target.tier as Exclude<SkillTier, 'diamond'>];
    const pieces = state.pieces.map((p, i) => (i === boardIndex ? { ...p, tier: to } : p));
    return { state: { ...state, pieces }, outcome: { kind: 'upgradeCard', skillId: target.skillId, from: target.tier, to } };
  }
  const bagIndex = state.bagSlots.findIndex((c) => c && c.instanceId === instanceId && c.tier !== 'diamond');
  if (bagIndex >= 0) {
    const target = state.bagSlots[bagIndex]!;
    const to = TIER_UP[target.tier as Exclude<SkillTier, 'diamond'>];
    const bagSlots = state.bagSlots.map((c, i) => (i === bagIndex ? { ...c!, tier: to } : c));
    return { state: { ...state, bagSlots }, outcome: { kind: 'upgradeCard', skillId: target.skillId, from: target.tier, to } };
  }
  return upgradeCardFallback(state);
}

/**
 * Finalizes a `gemChoice` outcome's deferred pick (the UI shows the
 * `EVENT_CHOICE_SIZE` rolled gem ids between `resolveEventChoice` returning
 * `{kind:'gemChoicePick', options}` and calling this) — pushes the picked
 * `gemId` into the gem pouch, same as `grantGemOutcome`'s immediate grant
 * (gems have no capacity limit, so unlike `applyBonusDraftPick`/
 * `applyUpgradeCardPick` there is no "didn't fit" fallback path to reuse).
 * Throws if `gemId` isn't a real catalog id — defensive only, since the
 * picker only ever passes back one of the exact options `gemChoiceOutcome`
 * just showed it and nothing else can touch `state` in between (same
 * "shouldn't happen but never silently corrupt state" posture `grantCard`/
 * `grantGem` take on an unknown/empty pool).
 */
export function applyGemChoicePick(state: RunState, gemId: string): { state: RunState; outcome: EventOutcome } {
  if (!gemBook[gemId]) {
    throw new Error(`applyGemChoicePick: unknown gem id "${gemId}"`);
  }
  return {
    state: { ...state, gemInventory: [...state.gemInventory, gemId] },
    outcome: { kind: 'grantGem', gemId },
  };
}

/**
 * Finalizes a `sellGem` outcome's deferred pick (the UI shows the pouch
 * gems between `resolveEventChoice` returning `{kind:'sellGemPick', options}`
 * and calling this) — removes the picked `pouchIndex` from `gemInventory` and
 * credits its `sellPriceOfGem` gold, by delegating to the SAME `sellRunGem`
 * (`runState.ts`) the Deck/Bag screen's SELL button already calls (via
 * `sellCurrentRunGem`, `src/game/runStore.ts`) — one canonical "sell a pouch
 * gem" implementation, not two that could drift. Addressed by `pouchIndex`
 * (not `gemId`) because the pouch can hold duplicate gem ids and only the
 * index picks out one specific copy — the same reasoning `SellGemOption`'s
 * own doc comment gives.
 *
 * Throws if `pouchIndex` no longer resolves to a populated pouch slot —
 * defensive only, since the picker only ever passes back one of the exact
 * options `sellGemOutcome` just showed it and nothing else can touch `state`
 * in between (same "shouldn't happen but never silently corrupt state"
 * posture `applyGemChoicePick`/`applyUpgradeCardPick` take on their own
 * defensive checks).
 */
export function applySellGemPick(state: RunState, pouchIndex: number): { state: RunState; outcome: EventOutcome } {
  const gemId = state.gemInventory[pouchIndex];
  if (!gemId) {
    throw new Error(`applySellGemPick: no pouch gem at index ${pouchIndex}`);
  }
  const result = sellRunGem(state, pouchIndex);
  if (!result.ok) {
    throw new Error(`applySellGemPick: sellRunGem unexpectedly failed for pouch index ${pouchIndex}`);
  }
  return { state: result.state, outcome: { kind: 'sellGem', gemId, price: result.goldReceived } };
}
