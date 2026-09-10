// Events — pure resolution over the declarative catalog in
// `src/data/events.ts` (see docs/run-events-design.md §1-3). Two entry
// points: `rollEventForNode` draws (idempotently) which event a node shows,
// `resolveEventChoice` applies a chosen choice's outcome. No Phaser, no
// Date.now/Math.random — every roll flows through the engine's seeded `Rng`
// in a fixed call order, so replaying the same run+path is byte-identical.
//
// BOTH ENTRY POINTS ARE ONCE-PER-NODE. The draw memoizes into
// `RunState.eventInstances`; the CHOICE memoizes into
// `RunState.eventResolutions` (see `eventResolutionAt` below), which is what
// stops a screen re-entry — the event HUD's DECK/BAG button is a
// `scene.start`, and so is a page reload — from resolving the same rung a
// second time. `reopenEventChoice` is the one exception, and it charges
// nothing: it re-asks a deferred picker that was paid for and never answered.
//
// EVENT CHAINS (2026-09-02): those same two memos double as the chains'
// memory. A gate (`EventGate`/`EventTallyGate`, data/events.ts) is a pure
// scan of `eventResolutions` / the run's tally counters — no Rng, no new
// save field — checked per-rung in `isEventChoiceUsable` and per-event in
// `rollEventForNode`, where gated events bypass the bags entirely (see the
// chain scan there for why a locked bag resident would starve its theme).

import { hashSeed, Rng } from '../engine/rng';
import { cardOfferableAtTier, clampTierToCard } from '../engine/types';
import type { Element, SkillDef, SkillTier, WeaponType } from '../engine/types';
import { boardAffinities, IDENTITY_THRESHOLD } from '../engine/combat/typeIdentity';
import {
  eventCatalog,
  eventRuntimeCatalog,
  eventRuntimeCatalogIds,
  type EventChoiceDef,
  type EventDef,
  type EventGate,
  type EventOutcomeSpec,
  type EventRequirement,
  type EventTallyGate,
  type EventTheme,
  type FilterFromSource,
} from '../data/events';
import { eventContentMeta, eventDefAtVersion } from '../data/eventsContent';
import { isEventDefV2, type EventChoiceV2 } from '../data/eventContentV2';
import { isEventDefV3, type EventOutcomeSpecV3, type LoadedEventDefV3 } from '../data/eventContentV3';
import type { LoadedEventDef } from '../data/eventsContent';
import { eventRequirementMet } from './eventEligibility';
import { eventRequirementMetV3 } from './eventEligibilityV3';
import { eventIsChainStarter } from './eventOpportunityHint';
import { materializeReachedEventV3 } from './eventsV3';
import { BOSS_EVERY } from './runMap';
import { previewEventChoicesV3, type EventDeferredOfferV3 } from './eventV3Materialization';
import {
  deliverEventCallback,
  dueEventCallbacks,
  repairDeliveredCallback,
  scheduleEventCallback,
  type EventDefinitionLookup,
} from './eventCallbacks';

const legacyEventDefAtVersion: EventDefinitionLookup<EventDef> = (eventId, contentVersion) => {
  const event = eventDefAtVersion(eventId, contentVersion);
  return event === undefined || isEventDefV3(event) ? undefined : event;
};

/**
 * Selection order from the pre-JSON literal catalog. The public
 * `eventCatalogIds` facade is now canonical code-unit order, but seeded bag
 * shuffles and conditional tie-breaks are player-visible behavior: feeding
 * those algorithms a differently ordered source array would change old runs.
 * Removing this prefix is therefore an intentional run reseed, never cleanup.
 */
const PRE_JSON_EVENT_SELECTION_IDS: readonly string[] = [
  'wandering_tutor',
  'abandoned_cache',
  'recruiter',
  'gemsellers_mishap',
  'crossroads_shrine',
  'veterans_last_lesson',
  'gambler',
  'overloaded_caravan',
  'sparring_circle',
  'hermits_riddle',
  'collapsed_barrow',
  'quartermasters_error',
  'beast_nest',
  'sellsword_camp',
  'circle_of_adepts',
  'field_medic',
  'wandering_smith',
  'ruined_anvil',
  'toll_bridge',
  'fences_offer',
  'cinderworks_regrind',
  'ember_pit',
  'retiring_smith',
  'fortune_teller',
  'weighing_stone',
  'two_ravens',
  'toll_collectors_ledger',
  'broken_axle',
  'thorn_garden_shrine',
  'venomers_den',
  'the_lapidary',
  'sweep_drill',
  'tutors_return',
  'the_reckoning',
  'the_lands_measure',
  'factors_ledger',
  'pyre_watch',
  'flaw_finder',
  'banner_scribe',
  'bell_beneath_ice',
  'the_bell_unbound',
  'the_second_toll',
];

/** Validate the frozen prefix and append genuinely new JSON-authored IDs in
 * canonical order. This keeps future content JSON-only while failing loudly
 * if a pre-cutover ID disappears or either input carries a duplicate. */
export function eventSelectionIdsForCatalog(catalogIds: readonly string[]): readonly string[] {
  const prefixIds = new Set<string>();
  for (const id of PRE_JSON_EVENT_SELECTION_IDS) {
    if (prefixIds.has(id)) throw new Error(`duplicate pre-JSON event id "${id}"`);
    prefixIds.add(id);
  }

  const catalogIdSet = new Set<string>();
  for (const id of catalogIds) {
    if (catalogIdSet.has(id)) throw new Error(`duplicate catalog event id "${id}"`);
    catalogIdSet.add(id);
  }
  for (const id of PRE_JSON_EVENT_SELECTION_IDS) {
    if (!catalogIdSet.has(id)) throw new Error(`missing pre-JSON event id "${id}"`);
  }

  const appended = catalogIds.filter((id) => !prefixIds.has(id)).sort();
  return Object.freeze([...PRE_JSON_EVENT_SELECTION_IDS, ...appended]);
}

const EVENT_SELECTION_IDS = eventSelectionIdsForCatalog(eventRuntimeCatalogIds);
const ORDINARY_EVENT_SELECTION_IDS = ordinaryEventIdsForCatalog(eventRuntimeCatalog, EVENT_SELECTION_IDS);

/** One versioned content source for the live selector. Tests may inject a
 * bounded validated source without creating a second production algorithm. */
export interface EventSelectionContent<TEvent extends LoadedEventDef = LoadedEventDef> {
  catalog: Readonly<Record<string, TEvent>>;
  orderedIds: readonly string[];
  currentVersionOf(eventId: string): number;
}

const ACTIVE_EVENT_SELECTION_CONTENT: EventSelectionContent = {
  catalog: eventRuntimeCatalog,
  orderedIds: EVENT_SELECTION_IDS,
  currentVersionOf: (eventId) => {
    const version = eventContentMeta[eventId]?.version;
    if (version === undefined) throw new Error(`event content has no current version for "${eventId}"`);
    return version;
  },
};

export const EVENT_COMEBACK_CHANCES = [35, 60] as const;

function drawnDepthFor(state: RunState, eventId: string): number | undefined {
  let latest: number | undefined;
  for (const instance of Object.values(state.eventInstances)) {
    if (instance.eventId === eventId && (latest === undefined || instance.drawnDepth > latest)) {
      latest = instance.drawnDepth;
    }
  }
  return latest;
}

/** The comeback roll replaces rarity only; every authored gate remains. */
function eventEligibleForComeback(state: RunState, node: RunNode, event: LoadedEventDef): boolean {
  if (node.kind !== 'event' || event.theme !== node.eventTheme) return false;
  const biomeId = biomeFor(state.map.seed, node.wave, node.biomeId).id;
  if (event.biomeIds !== undefined && !event.biomeIds.includes(biomeId)) return false;
  const previous = drawnDepthFor(state, event.id);
  if (isEventDefV3(event)) {
    return event.delivery.kind === 'ambient'
      && (event.once !== 'run' || previous === undefined)
      && (event.once !== 'node' || state.eventInstances[node.id]?.eventId !== event.id)
      && (previous === undefined || event.cooldownNodes === 0 || node.depth > previous + event.cooldownNodes)
      && eventRequirementMetV3({ state, node }, event.eligibility)
      && hasAffordableChoice(state, event, node);
  }
  if (isEventDefV2(event)) {
    return event.delivery.kind === 'ambient'
      && (event.once !== 'run' || previous === undefined)
      && (event.once !== 'node' || state.eventInstances[node.id]?.eventId !== event.id)
      && (previous === undefined || event.cooldownNodes === 0 || node.depth > previous + event.cooldownNodes)
      && eventRequirementMet({ state, node, event }, event.eligibility)
      && hasAffordableChoice(state, event, node);
  }
  return !isDrawnThisRun(state, event.id)
    && eventBiomeEligible(state, event, node)
    && gatesMet(state, event)
    && hasAffordableChoice(state, event, node);
}

interface ComebackOffer {
  nodeId: string;
  record: MissedEventOpportunity;
  event: LoadedEventDef;
}

function activeComebackOffer(
  state: RunState,
  choices: readonly RunNode[],
  content: EventSelectionContent = ACTIVE_EVENT_SELECTION_CONTENT,
): ComebackOffer | undefined {
  const eventNodes = choices.filter((node) => node.kind === 'event');
  const records = [...(state.missedEventOpportunities ?? [])]
    .sort((left, right) => left.missedDepth - right.missedDepth || left.eventId.localeCompare(right.eventId));
  for (const record of records) {
    const event = content.catalog[record.eventId];
    if (event === undefined || content.currentVersionOf(event.id) !== record.contentVersion) continue;
    if (!eventIsChainStarter(event, content.catalog)) continue;
    const node = eventNodes.find((candidate) => (
      candidate.wave % BOSS_EVERY !== 0
      && candidate.biomeId === record.biomeId
      && eventEligibleForComeback(state, candidate, event)
    ));
    if (node === undefined) continue;
    const chance = node.wave % BOSS_EVERY === BOSS_EVERY - 1
      ? 100
      : EVENT_COMEBACK_CHANCES[Math.min(record.laterOpportunities, EVENT_COMEBACK_CHANCES.length - 1)]!;
    const roll = hashSeed(state.seed, 'eventComeback', record.eventId, record.missedDepth, record.laterOpportunities) % 100;
    if (roll < chance) return { nodeId: node.id, record, event };
  }
  return undefined;
}

/** Route-card preview and selected-node commit share this substitution. */
export function comebackEventForNode(state: RunState, node: RunNode): LoadedEventDef | undefined {
  if (node.kind !== 'event') return undefined;
  const offer = activeComebackOffer(state, availableChoices(state));
  return offer?.nodeId === node.id ? offer.event : undefined;
}
import type { CardFilter, CardFilterClause } from '../data/shopTypes';
import type { DraftCard } from './draft';
import { skillBook } from '../data/skills';
import { gemBook } from '../data/gems';
import { bandIndexOf, biomeFor, counterTypeFor, leanLabel } from './biome';
import { applyGrantMapInfo, mapInfoRevealsAnything, mapIntelRecords } from './eventMapInfo';
import { cardMatchesFilter, gemMatchesFilter, pickWeightedGem, pickWeightedGems, sellPriceOfGem } from './shop';
import {
  availableChoices,
  chooseNode,
  currentEventNode,
  MAX_LEVEL,
  runBagHasRoomFor,
  sellRunGem,
  shopStockDepthForWave,
  tryInsertRunCard,
  type EventResolution,
  type MissedEventOpportunity,
  type RunBagSlot,
  type RunBoardPiece,
  type RunNode,
  type RunState,
} from './runState';
import {
  eventInstanceAt,
  hasDrawnEvent,
  recordEventInstance,
  sameEventInstance,
  type EventInstanceRecord,
} from './eventInstances';

/** Fallback gold grant when a `grantCard`/`bonusDraft` pick can't fit the bag
 * (also reused by `upgradeCard` when nothing owned is eligible to upgrade). */
const CARD_FALLBACK_GOLD = 2;
const DEFAULT_CARD_TIER: SkillTier = 'bronze';
// Exported (2026-09-02) for the same reason as `EVENT_CHOICE_SIZE` below: the
// derived-filter width lint (`tests/run/events.chains.test.ts`) asserts every
// `filterFrom` source's worst-case pool clears the width its outcome deals,
// and `sampleDistinct` silently deals fewer rather than erroring — the test
// must measure against the resolver's own number, never a literal 5.
export const BONUS_DRAFT_SIZE = 5;

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
export const CHAIN_STARTER_OPPORTUNITY_MULTIPLIER = 2;

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
  /** The exact persisted bands newly revealed by a typed map-info outcome. */
  | { kind: 'grantMapInfo'; bandsAhead: 2 | 3; revealedBands: readonly number[] }
  | { kind: 'nothing' };

// ---------------------------------------------------------------------------
// Per-node resolution memo — the CHOICE half of an event node's memory
// (`RunState.eventResolutions`; `eventInstances` is the DRAW half). Every
// reader goes through these four helpers so "absent means nothing resolved
// yet" is decided in one place and an older save with no field at all reads
// exactly like a fresh run.
// ---------------------------------------------------------------------------

/** What `nodeId` already resolved to, or `undefined` if its rungs are still
 * open. THE predicate the UI asks before it offers a rung, and the guard
 * `resolveEventChoice` itself trips on. */
export function eventResolutionAt(state: RunState, nodeId: string): EventResolution | undefined {
  return state.eventResolutions?.[nodeId];
}

/** The resolution of whatever event node is CURRENT, or `undefined` off an
 * event node / on one with its rungs still open. */
export function currentEventResolution(state: RunState): EventResolution | undefined {
  const node = currentEventNode(state);
  return node ? eventResolutionAt(state, node.id) : undefined;
}

function recordEventResolution(state: RunState, nodeId: string, resolution: EventResolution): RunState {
  return { ...state, eventResolutions: { ...(state.eventResolutions ?? {}), [nodeId]: resolution } };
}

/** Whether `outcome` is one of the five that ask a SECOND question — the
 * deferred pickers, whose rung is paid for but not yet delivered. Derived from
 * the union rather than from the spec kind so a sixth picker cannot be added
 * without this list seeing it (`applySpec` maps `cardChoice` onto
 * `bonusDraft`, and `upgradeCard`/`mergeCards` can resolve straight to a
 * non-deferred fallback, so the SPEC kind is not the answer). */
function isDeferredOutcome(outcome: EventOutcome): boolean {
  return outcome.kind === 'bonusDraft'
    || outcome.kind === 'upgradeCardPick'
    || outcome.kind === 'gemChoicePick'
    || outcome.kind === 'sellGemPick'
    || outcome.kind === 'mergeCardsPick';
}

/** Marks the current event node's pending pick as DELIVERED — every one of the
 * five finalizers below ends with this, so a picker can never be re-opened for
 * a second helping (see `reopenEventChoice`). A no-op off an event node or on
 * a node with no pending record, which is what keeps the finalizers callable
 * from tests that drive them against a hand-built state. */
function clearPendingEventPick(state: RunState): RunState {
  const node = currentEventNode(state);
  if (!node) return state;
  const resolution = eventResolutionAt(state, node.id);
  if (!resolution?.pending) return state;
  return recordEventResolution(state, node.id, {
    eventId: resolution.eventId,
    contentVersion: resolution.contentVersion,
    instanceId: resolution.instanceId,
    choiceId: resolution.choiceId,
  });
}

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

/** Weighted shuffle without replacement: starters get two tickets for their
 * next position, but still occur only once in each no-repeat bag cycle. */
function sampleEventBag(
  rng: Rng,
  pool: readonly string[],
  content: EventSelectionContent,
): string[] {
  const remaining = [...pool];
  const result: string[] = [];
  while (remaining.length > 0) {
    const weights = remaining.map((id) => (
      eventIsChainStarter(content.catalog[id]!, content.catalog)
        ? CHAIN_STARTER_OPPORTUNITY_MULTIPLIER
        : 1
    ));
    let ticket = rng.int(weights.reduce((sum, weight) => sum + weight, 0));
    let index = 0;
    while (ticket >= weights[index]!) ticket -= weights[index++]!;
    result.push(remaining[index]!);
    remaining.splice(index, 1);
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

// ---------------------------------------------------------------------------
// Event-chain gates (2026-09-02) — see the EVENT CHAINS block in
// `data/events.ts`. Both predicates are PURE READS of state the run already
// persists (`eventResolutions` and the tally counters), so they are
// reload-stable, spend no Rng, and add zero save fields. One pair implements
// both seams: a gated CHOICE (checked in `isEventChoiceUsable` below) and a
// gated EVENT (checked in `rollEventForNode`'s chain scan).
// ---------------------------------------------------------------------------

/** Whether the run's choice ledger satisfies `gate` — some resolved rung
 * anywhere this run matches `(gate.eventId, one of gate.choiceIds)`. A
 * `pending` resolution counts: the cost is paid and the choice committed the
 * moment `resolveEventChoice` returns; `pending` only means its deferred
 * picker is unanswered. Key order over the record is moot — this is a boolean
 * "some", not a fold. */
export function eventGateMet(state: RunState, gate: EventGate): boolean {
  const resolutions = state.eventResolutions ?? {};
  for (const nodeId of Object.keys(resolutions)) {
    const r = resolutions[nodeId]!;
    if (r.eventId !== gate.eventId) continue;
    if (!gate.choiceIds || gate.choiceIds.includes(r.choiceId)) return true;
  }
  return false;
}

/** The named run counter's CURRENT value — `wins`/`losses`/`bossesCleared`
 * live top-level on `RunState` (the stats ledger deliberately does not
 * duplicate them — see `RunStats`'s doc comment in runState.ts); the other
 * four are `state.stats` fields. One read shared by `eventTallyMet` and the
 * worded presenters below (`choiceLockReason`/`eventRecapLine`), so a lock
 * line can never quote a number the predicate didn't judge. */
function tallyValue(state: RunState, stat: EventTallyGate['stat']): number {
  return stat === 'wins' ? state.wins
    : stat === 'losses' ? state.losses
    : stat === 'bossesCleared' ? state.bossesCleared
    : state.stats[stat];
}

/** Whether the named run counter has reached `gate.atLeast`. */
export function eventTallyMet(state: RunState, gate: EventTallyGate): boolean {
  return tallyValue(state, gate.stat) >= gate.atLeast;
}

export function eventRequirementsMet(
  state: RunState,
  requirements: readonly EventRequirement[] | undefined,
): boolean {
  if (requirements === undefined) return true;
  for (const requirement of requirements) {
    if (requirement.kind === 'resolution') {
      if (!eventGateMet(state, requirement)) return false;
    } else if (!eventTallyMet(state, requirement)) {
      return false;
    }
  }
  return true;
}

/** All event-level requirements at once (absent = open). Choice-level gates
 * remain individually evaluated by `choiceLockReason`. */
function gatesMet(
  state: RunState,
  gated: Pick<EventDef, 'requires' | 'requiresTally' | 'requiresAll'>,
): boolean {
  if (gated.requires && !eventGateMet(state, gated.requires)) return false;
  if (gated.requiresTally && !eventTallyMet(state, gated.requiresTally)) return false;
  return eventRequirementsMet(state, gated.requiresAll);
}

/** A CONDITIONAL event — one that must never enter an ordinary bag (see
 * `rollEventForNode`'s pre-bag scan for the starvation proof). */
export function isConditionalEvent(event: LoadedEventDef): boolean {
  if (isEventDefV3(event)) {
    // Schema-v3 definitions always carry an explicit eligibility AST. Until
    // a later content plan authors a separately tagged ordinary-v3 lane, they
    // are conditional/special content and never participate in legacy bags.
    return true;
  }
  return isEventDefV2(event)
    || event.biomeIds !== undefined
    || event.requires !== undefined
    || event.requiresTally !== undefined
    || event.requiresAll !== undefined;
}

/** Build an ordinary-only pool from an explicit catalog and ordered ID list.
 * Every bag, widen, and final fallback derives from this one filter so a
 * conditional definition cannot leak through a separately maintained path. */
export function ordinaryEventIdsForCatalog(
  catalog: Readonly<Record<string, LoadedEventDef>>,
  orderedIds: readonly string[],
  theme?: EventTheme,
): readonly string[] {
  return orderedIds.filter((id) => {
    const event = catalog[id];
    if (!event) throw new Error(`ordinaryEventIdsForCatalog: unknown event id "${id}"`);
    return (theme === undefined || event.theme === theme) && !isConditionalEvent(event);
  });
}

/** Whether `event` allows the node's resolved biome. An absent allow-list is
 * unrestricted. Old/hand-built nodes without a biome stamp re-derive it from
 * the map seed, never the independently editable top-level state seed. */
export function eventBiomeEligible(state: RunState, event: EventDef, node: RunNode): boolean {
  if (event.biomeIds === undefined) return true;
  const biome = biomeFor(state.map.seed, node.wave, node.biomeId);
  return event.biomeIds.includes(biome.id);
}

/** Isolated appearance roll for conditional events. Common and secret content
 * has no lottery; uncommon/rare use a dedicated hash domain and consume no
 * `Rng`, bag counter, or mutable state. */
export function eventRarityEligible(
  event: LoadedEventDef,
  node: RunNode,
  graph: Readonly<Record<string, LoadedEventDef>> = eventRuntimeCatalog,
): boolean {
  const rarity = event.rarity ?? 'common';
  if (rarity === 'common' || rarity === 'secret') return true;
  const divisor = rarity === 'uncommon' ? 2 : 4;
  const winningTickets = eventIsChainStarter(event, graph)
    ? CHAIN_STARTER_OPPORTUNITY_MULTIPLIER
    : 1;
  return hashSeed('eventRarity', node.eventSeed ?? 0, event.id) % divisor < Math.min(divisor, winningTickets);
}

/** The `filterFrom` source on a card-granting spec, or `undefined` — only
 * `cardChoice`/`bonusDraft` carry the field (see `FilterFromSource` in
 * data/events.ts). */
function filterFromOf(spec: EventOutcomeSpec): FilterFromSource | undefined {
  return spec.kind === 'cardChoice' || spec.kind === 'bonusDraft' ? spec.filterFrom : undefined;
}

/**
 * Substitute a `filterFrom` source for a concrete `CardFilter` — the whole
 * derived-door seam (`FilterFromSource`, data/events.ts) in one pure read.
 * Returns `undefined` when the source cannot resolve (no node for a biome
 * source; a bow-lean band for `biomeCounter` — nothing counters bow; an
 * uncommitted board for `boardIdentity`), which `isEventChoiceUsable` renders
 * as a dark rung and `applySpec` renders as "fall back to the static filter"
 * (the module's standing "never throw over a narrow filter" posture).
 *
 * `boardIdentity` is a UNION over both axes, not the element-first collapse
 * (2026-09-06 ruling: "if they meet the requirements they should have the
 * affinity effect"). A board that earns BOTH an element affinity and a
 * weapon affinity (3 fire + 3 sword) returns a two-clause `CardFilter`
 * (`[{elements:['fire']}, {weapons:['sword']}]`) — `CardFilter` is already an
 * OR of clauses (`data/shopTypes.ts`), so this is a plain union of whichever
 * axes the board has earned, never a forced choice of one. Only when NEITHER
 * axis clears `IDENTITY_THRESHOLD` does this return `undefined` (the
 * uncommitted-board case above).
 *
 * No Rng and no save change: `biomeFor` is a `hashSeed` re-derivation with its
 * own un-stamped-save fallback, and `boardAffinities` is an integer tally
 * over the board pieces (BOARD only — matching the combat fold's own read).
 * The outcome that consumes the result spends its same draws over a different
 * array, so determinism holds: same state, same node, same filter.
 *
 * Exported for the UI's later dynamic-label pass ("Take the local make —
 * FROST"): the scene must read THIS derivation, never re-derive it a second
 * way (`derivedChoiceFilter` below is the per-choice convenience wrapper).
 */
export function resolveFilterFrom(state: RunState, node: RunNode | null, source: FilterFromSource): CardFilter | undefined {
  if (source === 'boardIdentity') {
    const boardSkills: SkillDef[] = [];
    for (const piece of state.pieces) {
      const skill = skillBook[piece.skillId];
      if (skill) boardSkills.push(skill);
    }
    const affinities = boardAffinities(boardSkills);
    const clauses: CardFilterClause[] = [];
    if (affinities.element !== undefined) clauses.push({ elements: [affinities.element] });
    if (affinities.weapon !== undefined) clauses.push({ weapons: [affinities.weapon] });
    return clauses.length > 0 ? clauses : undefined;
  }
  if (!node) return undefined;
  const lean = biomeFor(state.map.seed, node.wave, node.biomeId).lean;
  if (source === 'biomeLean') {
    return lean.kind === 'element' ? [{ elements: [lean.type] }] : [{ weapons: [lean.type] }];
  }
  // `biomeCounter` — the counter of an element lean is itself an element and
  // of a weapon lean a weapon (`ELEMENT_BEATS`/`WEAPON_BEATS` never cross the
  // two triangles), so the lean's own kind types the cast safely.
  const counter = counterTypeFor(lean);
  if (counter === undefined) return undefined;
  return lean.kind === 'element' ? [{ elements: [counter as Element] }] : [{ weapons: [counter as WeaponType] }];
}

/** `resolveFilterFrom` for one catalog choice against the ACTIVE event node —
 * `undefined` both for a choice with no `filterFrom` and for one whose source
 * cannot resolve right now (the caller that needs to tell them apart checks
 * the spec's `filterFrom` field itself, as `isEventChoiceUsable` does). */
export function derivedChoiceFilter(state: RunState, choice: EventChoiceDef): CardFilter | undefined {
  const source = filterFromOf(choice.outcome);
  if (source === undefined) return undefined;
  return resolveFilterFrom(state, currentEventNode(state) ?? null, source);
}

/**
 * The FAMILY a `filterFrom` door resolves to right now, as the display token
 * the scenes suffix onto the door's label ("Take the local make — FROST") —
 * `undefined` for a choice with no `filterFrom` and for one whose source
 * cannot resolve (that rung is dark, and `choiceLockReason` below words WHY
 * instead). A thin read of `derivedChoiceFilter`, exported so neither scene
 * ever re-derives the family a second way (thin client, one authority).
 *
 * SINGLE-LABEL ONLY: `boardIdentity` can now resolve to TWO clauses (a board
 * that earns both an element and a weapon affinity, see `resolveFilterFrom`),
 * but this reads only `filter[0]` — the element clause when both are
 * present, same element-first precedence as `boardTypeIdentity`'s display
 * collapse. The POOL is the honest union either way (this function never
 * narrows it); only the one-word suffix is lossy, and only for the rare
 * dual-affinity board. Showing both types on the label is a UI decision, not
 * made here.
 */
export function derivedChoiceFamily(state: RunState, choice: EventChoiceDef): string | undefined {
  if (filterFromOf(choice.outcome) === undefined) return undefined;
  const filter = derivedChoiceFilter(state, choice);
  const clause = filter?.[0];
  const type = clause?.elements?.[0] ?? clause?.weapons?.[0];
  return type === undefined ? undefined : type.toUpperCase();
}

/** Whether `choice` is USABLE right now — `isEventChoiceAffordable` (the
 * gold gate) PLUS the choice's own gates PLUS any outcome-specific
 * precondition. The preconditions, in check order:
 *
 * GATES (2026-09-02, outcome-agnostic): a rung carrying `requires`/
 * `requiresTally` is dark until the run's ledger satisfies it (`eventGateMet`/
 * `eventTallyMet` above) — the same dark-rung presentation as everything
 * below, which is what makes a chain's locked door legible through the scenes'
 * existing dimming with zero UI changes.
 *
 * `filterFrom` (2026-09-02): a card door whose derived pool source cannot
 * resolve right now (`biomeCounter` on a bow band, `boardIdentity` on an
 * uncommitted board — see `resolveFilterFrom`) is dark rather than a button
 * that would silently fall back to an unfiltered pool.
 *
 * `sellGem`: its picker has nothing to offer with an empty pouch, so a cost-0
 * `sellGem` choice at `state.gemInventory.length === 0` reads as affordable
 * (cost 0 <= any gold) but is NOT usable — this is the gate that keeps
 * `sellGemOutcome` from ever resolving to an empty picker (see that
 * function's doc comment).
 *
 * `mergeCards`: it needs three owned cards of one non-Diamond tier AND a
 * deliverable output, so a cost-0 merge rung is unusable until
 * `mergeCardsPlan` finds a trade (see below). Every other outcome kind has no
 * such precondition and this reduces to affordability + gates alone.
 *
 * This is the predicate the UI should call to dim an individual choice
 * button (not `isEventChoiceAffordable` directly) and the one
 * `hasAffordableChoice`/`rollEventForNode` use to decide whether an event is
 * eligible to be offered at all. Like the resolver's KNOWN GAP for
 * unaffordable priced choices (tests/run/events.test.ts), `resolveEventChoice`
 * does NOT re-check gates: this predicate is the guard, the once-per-node
 * throw kills the dangerous replay class, and a bypassed gate's outcome is an
 * ordinary priced outcome — nothing exploitable behind it.
 *
 * IMPLEMENTED AS `choiceLockReason(state, choice) === null` (2026-09-02, the
 * lock-reason UI pass): the checks themselves live in ONE body so the worded
 * twin below can never disagree with this boolean — a rung this predicate
 * dims always has a reason, and a rung it lights never shows one. */
export function isEventChoiceUsable(state: RunState, choice: EventChoiceDef): boolean {
  return choiceLockReason(state, choice) === null;
}

/** `choice.label` with a trailing " (2 gold)"-style parenthetical stripped —
 * the lock line quotes a PAST choice as a deed, and the price tag it was
 * bought at is not part of the deed. */
function strippedChoiceLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)$/, '');
}

/** Words an unmet `EventGate` for the lock line. Names the exact past door
 * when the gate hangs on ONE choice (that is what teaches "this face is
 * remembered"), the past event when any of its choices would do. The dangling
 * fallback is unreachable for catalog content (lint L1, events.chains.test.ts)
 * but this is a presenter — it must never throw over data. */
function gateLockReason(gate: EventGate): string {
  const target = eventCatalog[gate.eventId];
  if (!target) return 'needs a past deed';
  if (gate.choiceIds && gate.choiceIds.length === 1) {
    const past = target.choices.find((c) => c.id === gate.choiceIds![0]);
    if (past) return `needs "${strippedChoiceLabel(past.label)}"`;
  }
  return `needs a deed at ${target.title}`;
}

/** Worded noun for each tally counter — one map shared by the lock line
 * ("0/1 lives lost") and the recap line ("You have spent 14 gold…" builds its
 * own sentences but from the same `tallyValue` read). */
const TALLY_NOUN: Record<EventTallyGate['stat'], string> = {
  goldSpent: 'gold spent',
  cardsBought: 'cards bought',
  gemsBought: 'gems bought',
  livesLost: 'lives lost',
  wins: 'fights won',
  losses: 'fights lost',
  bossesCleared: 'bosses cleared',
};

/** Words an unmet `EventTallyGate`: the live count against the bar, so the
 * locked rung doubles as a progress readout ("8/12 gold spent"). */
function tallyLockReason(state: RunState, gate: EventTallyGate): string {
  return `${tallyValue(state, gate.stat)}/${gate.atLeast} ${TALLY_NOUN[gate.stat]}`;
}

/** Words an unresolvable `filterFrom` source. `boardIdentity` teaches the
 * threshold itself; `biomeCounter` names the lean nothing counters (the
 * Arrowfell/bow fact, taught a fourth way); the no-node fallback covers a
 * biome source read off an event node this state is not standing on — dead
 * in practice (see `choiceLockReason`'s own reachability note), so it stays
 * honest rather than descriptive. */
function filterFromLockReason(state: RunState, source: FilterFromSource): string {
  if (source === 'boardIdentity') return `need ${IDENTITY_THRESHOLD} cards of one type`;
  const node = currentEventNode(state);
  if (node && source === 'biomeCounter') {
    const lean = biomeFor(state.map.seed, node.wave, node.biomeId).lean;
    if (counterTypeFor(lean) === undefined) return `nothing counters ${leanLabel(lean)}`;
  }
  return 'not available right now';
}

/**
 * Whether `choice`'s outcome, resolved RIGHT NOW, could actually hand over a
 * card — the room-side twin of `mergeCardsPlan`'s bag check, for the three
 * kinds whose finalizer falls back to `CARD_FALLBACK_GOLD` when the bag has
 * none: `grantCard` (immediate — the fallback fires in `grantCardOutcome`,
 * one call down from `choiceLockReason`'s own caller), and `cardChoice`/
 * `bonusDraft` (deferred — the fallback fires one step later, in
 * `applyBonusDraftPick`, but the COST is charged the moment THIS rung is
 * taken, so the gate has to run here, before that charge, not at the picker).
 *
 * NOT A SINGLE BOOLEAN OVER "the bag is full": a filtered pool can hold
 * skills of different SIZES (`SkillSize`, 1-3), so this checks the WORST
 * CASE the player could be shown — every card `applySpec` could possibly
 * pick for this outcome right now (the one named `cardId` for a named
 * `grantCard`; the same tier-narrowed/filtered draw pool
 * `grantCardOutcome`/`cardChoiceOutcome`/`bonusDraftOutcome` build, for
 * everything else) — against `runBagHasRoomFor`. LOCKED (`false`) only when
 * NONE of that pool fits: a guaranteed failure, never a maybe. If some sizes
 * in the pool fit and others don't, this reads USABLE — the roll can still
 * land on a card that fits, and the untouched `CARD_FALLBACK_GOLD` safety net
 * is exactly what covers the unlucky draw, same as it already covers a bag
 * that changes between the roll and the resolve.
 *
 * An empty pool (no skill matches an authored filter at all) is a content bug
 * the existing throws already catch at resolve time — reporting it as usable
 * here changes nothing about that; this predicate only judges bag room, never
 * filter authoring.
 */
function cardOutcomeCanDeliver(state: RunState, choice: EventChoiceDef): boolean {
  const outcome = choice.outcome;
  if (outcome.kind !== 'grantCard' && outcome.kind !== 'cardChoice' && outcome.kind !== 'bonusDraft') return true;
  let pool: readonly SkillDef[];
  if (outcome.kind === 'grantCard') {
    if (outcome.cardId) {
      const named = skillBook[outcome.cardId];
      pool = named ? [named] : [];
    } else {
      const requested = outcome.tier ?? DEFAULT_CARD_TIER;
      const matches = Object.values(skillBook).filter((s) => (outcome.filter ? cardMatchesFilter(s, outcome.filter) : true));
      const offerable = matches.filter((s) => cardOfferableAtTier(s, requested));
      pool = offerable.length > 0 ? offerable : matches;
    }
  } else {
    // cardChoice/bonusDraft: the SAME themed-falling-back-to-the-whole-Bronze-
    // book draw pool `cardChoiceOutcome`/`bonusDraftOutcome` build, with any
    // `filterFrom` door substituted first — already resolved by the time this
    // runs, since the earlier `filterFrom` check in `choiceLockReason` returns
    // before this one on an unresolvable source.
    const source = filterFromOf(outcome);
    const filter = source !== undefined ? derivedChoiceFilter(state, choice) : outcome.filter;
    const all = offerableBook(DEFAULT_CARD_TIER);
    const filtered = filter ? all.filter((s) => cardMatchesFilter(s, filter)) : all;
    pool = filtered.length > 0 ? filtered : all;
  }
  if (pool.length === 0) return true;
  return pool.some((s) => runBagHasRoomFor(state, s.id));
}

/**
 * WHY `choice` is locked right now, as a short lower-case human line for the
 * scenes' disabled-button detail ("LOCKED · needs 2 gold") — or `null` when
 * the choice is usable. THE WORDED TWIN of `isEventChoiceUsable`, and the one
 * body both share (that predicate is now `=== null` over this): same inputs,
 * same checks, same order, so the scenes never re-derive a reason the
 * predicate didn't gate on. Check order is the predicate's historical order —
 * gold first, then gates, then the outcome-specific preconditions — and the
 * FIRST failing check names the reason.
 *
 * `grantCard`/`cardChoice`/`bonusDraft` (2026-09-06): a paid rung whose bag
 * has no room for ANYTHING the outcome could hand over used to charge the
 * choice's cost and then quietly fall back to `CARD_FALLBACK_GOLD` — a rung
 * the player could not benefit from, offered at full price with no warning.
 * `cardOutcomeCanDeliver` is the SAME "is there room" read the outcome
 * functions would hit anyway, run BEFORE the cost is ever charged.
 *
 * `upgradeCard`: the same shape, for the OTHER precondition that outcome can
 * fail on — nothing owned is eligible to bump a tier (every card already
 * Diamond, or none owned at all) — read straight off `upgradeCardOptions`,
 * the exact set `upgradeCardOutcome` itself would offer.
 *
 * `mergeCards` (2026-08-26): a merge needs `MERGE_INPUT_COUNT` owned cards
 * sharing ONE non-Diamond tier AND a deliverable output — all four decisions
 * live in `mergeCardsPlan`, and this gate is the SAME call the offer and the
 * finalizer make, so an event can never advertise a trade it would then
 * refuse (a player with three Diamonds and nothing else, or a bag with no
 * room for anything at tier+1, sees this rung dark instead of spending three
 * cards for a fallback coin).
 *
 * `grantMapInfo` (2026-09-06): "REVEAL N BANDS" when every one of those N
 * bands is already recorded (two overlapping map-info events can cover the
 * same band twice) delivers nothing — `mapInfoRevealsAnything`
 * (`eventMapInfo.ts`) is the same scan `applyGrantMapInfo` itself runs.
 *
 * Pure read, no Rng, ~30 characters worst case for catalog content — sized to
 * one line of the choice panel's detail row on the mobile profile.
 */
export function choiceLockReason(state: RunState, choice: EventChoiceDef): string | null {
  if (!isEventChoiceAffordable(state, choice)) return `needs ${choice.cost ?? 0} gold`;
  if (choice.requires && !eventGateMet(state, choice.requires)) return gateLockReason(choice.requires);
  if (choice.requiresTally && !eventTallyMet(state, choice.requiresTally)) return tallyLockReason(state, choice.requiresTally);
  const source = filterFromOf(choice.outcome);
  if (source !== undefined && resolveFilterFrom(state, currentEventNode(state) ?? null, source) === undefined) {
    return filterFromLockReason(state, source);
  }
  if (
    (choice.outcome.kind === 'grantCard' || choice.outcome.kind === 'cardChoice' || choice.outcome.kind === 'bonusDraft')
    && !cardOutcomeCanDeliver(state, choice)
  ) {
    return 'no room in your bag';
  }
  if (choice.outcome.kind === 'upgradeCard' && upgradeCardOptions(state).length === 0) return 'nothing left to upgrade';
  if (choice.outcome.kind === 'sellGem' && state.gemInventory.length === 0) return 'nothing in your pouch';
  if (choice.outcome.kind === 'mergeCards' && mergeCardsPlan(state) === null) return 'need 3 cards of one grade';
  if (choice.outcome.kind === 'grantMapInfo') {
    const node = currentEventNode(state);
    if (node && !mapInfoRevealsAnything(state, bandIndexOf(node.wave), choice.outcome.bandsAhead)) {
      return 'nothing new to reveal';
    }
  }
  return null;
}

/** A discovered event's visible rarity tag. Common is the unmarked baseline;
 * only authored non-common rarities earn a label. Pure presentation — it
 * neither decides whether the event may draw nor inspects run state. */
export function eventRarityLabel(event: EventDef): string | null {
  const rarity = event.rarity;
  return rarity === undefined || rarity === 'common' ? null : rarity.toUpperCase();
}

/** The authored choice that satisfied one resolution gate, worded as a recap
 * clause. Catalog choice order wins over ledger key order when several past
 * choices satisfy the same gate. */
function resolutionRecapClause(state: RunState, gate: EventGate): string | null {
  const target = eventCatalog[gate.eventId];
  if (!target) return null;
  for (const past of target.choices) {
    if (gate.choiceIds && !gate.choiceIds.includes(past.id)) continue;
    if (!eventGateMet(state, { eventId: target.id, choiceIds: [past.id] })) continue;
    return `"${strippedChoiceLabel(past.label)}" at ${target.title}`;
  }
  return null;
}

/** The legacy tally recap wording, kept in one helper so `requiresTally`
 * retains its exact sentences while conjunctive requirements can fall back
 * to the same presenter authority when they contain only tally gates. */
function tallyRecapLine(state: RunState, gate: EventTallyGate): string {
  const value = tallyValue(state, gate.stat);
  const plural = (one: string, many: string): string => (value === 1 ? one : many);
  switch (gate.stat) {
    case 'goldSpent': return `You have spent ${value} gold on this road.`;
    case 'cardsBought': return `You have bought ${value} ${plural('card', 'cards')} on this road.`;
    case 'gemsBought': return `You have bought ${value} ${plural('gem', 'gems')} on this road.`;
    case 'livesLost': return `The road has taken ${value} of your lives.`;
    case 'wins': return `You have won ${value} ${plural('fight', 'fights')} on this road.`;
    case 'losses': return `You have lost ${value} ${plural('fight', 'fights')} on this road.`;
    case 'bossesCleared': return `You have felled ${value} ${plural('boss', 'bosses')} on this road.`;
  }
}

/**
 * The ONE-LINE "your past choice" recap a chain-payoff event opens with —
 * rendered by both event scenes INSIDE the existing body box, above the body
 * (the box's own height budget absorbs it; the choice-block reservation math
 * is untouched). `null` for anything that is not a chain payoff: an ungated
 * event, or a gated one whose gate is somehow unmet (the priority draw never
 * shows one, but a presenter never trusts that).
 *
 * An EVENT-gated payoff names the deed that opened it — the first choice, in
 * the TARGET event's own authored order (stable catalog data, never ledger
 * key order), that the gate accepts and the run resolved. A conjunctive
 * payoff names each satisfied resolution requirement in its authored order,
 * but only after the whole conjunction is met. A TALLY-gated payoff quotes
 * the live counter through the same `tallyValue` read the gate predicate
 * used. Pure read; no Rng; no save field.
 */
export function eventRecapLine(state: RunState, event: EventDef): string | null {
  // Evaluate the complete event gate before wording any one part. That keeps
  // a conjunctive secret wholly silent until every requirement is met.
  if (!gatesMet(state, event)) return null;

  if (event.requires) {
    const clause = resolutionRecapClause(state, event.requires);
    return clause ? `You chose ${clause}.` : null;
  }
  if (event.requiresTally) return tallyRecapLine(state, event.requiresTally);

  if (event.requiresAll) {
    const clauses: string[] = [];
    for (const requirement of event.requiresAll) {
      if (requirement.kind !== 'resolution') continue;
      const clause = resolutionRecapClause(state, requirement);
      if (!clause) return null;
      clauses.push(clause);
    }
    if (clauses.length > 0) return `You chose ${clauses.join(', then ')}.`;
    const tally = event.requiresAll.find((requirement) => requirement.kind === 'tally');
    if (tally) return tallyRecapLine(state, tally);
  }
  return null;
}

/** An event is eligible to be OFFERED at `state.gold` (and current inventory)
 * if at least one of its choices is both usable AND not the `nothing` no-op
 * outcome — an event whose only usable option is the safe "walk away" exit
 * is exactly the dead-end case this guards against. */
function v3OutcomeHasUsableReward(state: RunState, outcome: EventOutcomeSpecV3): boolean {
  if (outcome.kind === 'weighted') {
    return outcome.branches.some((branch) => v3OutcomeHasUsableReward(state, branch.outcome));
  }
  if (outcome.kind === 'nothing') return false;
  if (outcome.kind === 'sellGem') return state.gemInventory.length > 0;
  if (outcome.kind === 'mergeCards') return mergeCardsPlan(state) !== null;
  return true;
}

function hasAffordableChoice(state: RunState, event: LoadedEventDef, node?: RunNode): boolean {
  if (isEventDefV3(event)) {
    if (node === undefined) return false;
    return previewEventChoicesV3(state.map.seed, `event:${node.id}`, event).some((choice) => (
      (choice.cost ?? 0) <= state.gold
      && (choice.requires === undefined || eventGateMet(state, choice.requires))
      && (choice.requiresTally === undefined || eventTallyMet(state, choice.requiresTally))
      && v3OutcomeHasUsableReward(state, choice.outcome)
    ));
  }
  return event.choices.some((c) => isEventChoiceUsable(state, c) && c.outcome.kind !== 'nothing');
}

/** First id in `ids` (fixed order) eligible at `state.gold`, or -1. */
function firstEligibleIndex(
  ids: readonly string[],
  state: RunState,
  node: RunNode,
  catalog: Readonly<Record<string, LoadedEventDef>>,
): number {
  return ids.findIndex((id) => hasAffordableChoice(state, catalog[id]!, node));
}

/** Resolve the widen/fallback ID from an explicit ordered catalog. The widen
 * pool is always rebuilt through the ordinary-only authority above; if no
 * ordinary event is currently usable, the already-ordinary themed bag head
 * remains the first fallback, followed by the ordinary global head. */
export function eventIdFromOrdinaryWiden(
  state: RunState,
  themedBag: readonly string[],
  catalog: Readonly<Record<string, LoadedEventDef>>,
  orderedIds: readonly string[],
  node?: RunNode,
): string | undefined {
  const widenPool = ordinaryEventIdsForCatalog(catalog, orderedIds);
  const eligibleId = widenPool.find((id) => hasAffordableChoice(state, catalog[id]!, node));
  return eligibleId ?? themedBag[0] ?? widenPool[0];
}

/** First fully eligible conditional candidate in caller-supplied order. This
 * pure seam keeps synthetic eligibility tests detached from the deeply frozen
 * production catalog while `rollEventForNode` supplies the effective legacy-
 * compatible catalog order. */
export function firstEligibleConditionalEvent(
  state: RunState,
  node: RunNode,
  candidates: readonly EventDef[],
): EventDef | undefined;
export function firstEligibleConditionalEvent(
  state: RunState,
  node: RunNode,
  candidates: readonly LoadedEventDef[],
): LoadedEventDef | undefined;
export function firstEligibleConditionalEvent(
  state: RunState,
  node: RunNode,
  candidates: readonly LoadedEventDef[],
): LoadedEventDef | undefined {
  const legacyOnly = !candidates.some(isEventDefV3);
  if (legacyOnly) return (candidates as readonly EventDef[]).find((event) => {
    if (isEventDefV2(event)) {
      return event.delivery.kind === 'ambient'
        && event.theme === node.eventTheme
        && eventEligibleForComeback(state, node, event)
        && eventRarityEligible(event, node)
        && hasAffordableChoice(state, event, node);
    }
    return event.theme === node.eventTheme
      && isConditionalEvent(event)
      && !isDrawnThisRun(state, event.id)
      && eventBiomeEligible(state, event, node)
      && gatesMet(state, event)
      && eventRarityEligible(event, node)
      && hasAffordableChoice(state, event, node);
  });

  const ready = candidates.filter((event) => {
    if (!isEventDefV3(event)) {
      if (isEventDefV2(event)) {
        return event.delivery.kind === 'ambient'
          && event.theme === node.eventTheme
          && eventEligibleForComeback(state, node, event)
          && eventRarityEligible(event, node)
          && hasAffordableChoice(state, event, node);
      }
      return event.theme === node.eventTheme
        && isConditionalEvent(event)
        && !isDrawnThisRun(state, event.id)
        && eventBiomeEligible(state, event, node)
        && gatesMet(state, event)
        && eventRarityEligible(event, node)
        && hasAffordableChoice(state, event, node);
    }
    if (event.delivery.kind !== 'ambient' || event.theme !== node.eventTheme) return false;
    const biomeId = biomeFor(state.map.seed, node.wave, node.biomeId).id;
    if (event.biomeIds !== undefined && !event.biomeIds.includes(biomeId)) return false;
    const previous = Object.values(state.eventInstances)
      .filter((instance) => instance.eventId === event.id)
      .sort((left, right) => right.drawnDepth - left.drawnDepth)[0];
    if (event.once === 'run' && previous !== undefined) return false;
    if (event.once === 'node' && state.eventInstances[node.id]?.eventId === event.id) return false;
    if (previous !== undefined && event.cooldownNodes > 0 && node.depth <= previous.drawnDepth + event.cooldownNodes) return false;
    if (!eventRequirementMetV3({ state, node }, event.eligibility)) return false;
    if (!eventRarityEligible(event, node)) return false;
    return hasAffordableChoice(state, event, node);
  });
  if (ready.length === 0) return undefined;
  const candidatePriority = (event: LoadedEventDef): number => (
    isEventDefV3(event) || isEventDefV2(event) ? event.priority : 0
  );
  const priority = Math.max(...ready.map(candidatePriority));
  const highest = ready.filter((event) => candidatePriority(event) === priority);
  if (!highest.some(isEventDefV3)) return highest[0];
  const canonical = [...highest].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return canonical[hashSeed(state.map.seed, 'event-v3-conditional', node.id, priority) % canonical.length];
}

/** Dormant injected-catalog seam for schema-v3 candidate selection. It uses
 * the same conditional selector as `rollEventForNode`, commits only the node
 * actually reached, then materializes that exact version before returning. */
export function rollEventForNodeFromCandidatesV3(
  state: RunState,
  node: RunNode,
  candidates: readonly LoadedEventDefV3[],
  contentVersionOf: (eventId: string) => number,
): { state: RunState; event: LoadedEventDefV3 } {
  if (node.kind !== 'event') throw new Error(`rollEventForNodeFromCandidatesV3: node "${node.id}" is not an event node`);
  const existing = eventInstanceAt(state, node.id);
  if (existing !== undefined) {
    const event = candidates.find((candidate) => candidate.id === existing.eventId);
    if (event === undefined || existing.contentVersion !== contentVersionOf(event.id)) {
      throw new Error(`rollEventForNodeFromCandidatesV3: missing exact committed content for "${node.id}"`);
    }
    const replay = materializeReachedEventV3(state, node, event, existing.contentVersion);
    if (!replay.ok) throw new Error(`rollEventForNodeFromCandidatesV3: replay failed (${replay.reason})`);
    return { state: replay.state, event };
  }
  const selected = firstEligibleConditionalEvent(state, node, candidates);
  if (selected === undefined || !isEventDefV3(selected)) {
    throw new Error(`rollEventForNodeFromCandidatesV3: no eligible v3 event for "${node.id}"`);
  }
  const contentVersion = contentVersionOf(selected.id);
  const committed = recordEventInstance(state, node.id, {
    eventId: selected.id,
    contentVersion,
    instanceId: `event:${node.id}`,
    drawnDepth: node.depth,
  });
  const materialized = materializeReachedEventV3(committed, node, selected, contentVersion);
  if (!materialized.ok) throw new Error(`rollEventForNodeFromCandidatesV3: materialization failed (${materialized.reason})`);
  return { state: materialized.state, event: selected };
}

// ---------------------------------------------------------------------------
// Event draw — a per-run no-repeat bag over the effective compatibility
// order, mirroring the map-gen shop theme bag but stored/refilled on
// `RunState` itself (which
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

/** ORDINARY catalog ids for one theme, in fixed catalog order — the theme
 * bag's pool. CONDITIONAL events are excluded here, NOT filtered at draw
 * time, because a locked bag resident is a provable starvation bug: skipped
 * entries stay in the bag and a bag refills only at length 0, so one
 * permanently-locked id would pin its theme's bag non-empty forever — the
 * theme never reshuffles again, and once every other id is consumed every
 * draw of that theme takes the widen-to-catalog path (the same first-eligible
 * event, every time, for the rest of the run). Chained events are delivered
 * by `rollEventForNode`'s priority scan instead; because they never join a
 * pool, every seeded sequence is byte-identical until a gate opens. */
function idsForTheme(theme: EventTheme, content: EventSelectionContent): readonly string[] {
  const ordinaryIds = content === ACTIVE_EVENT_SELECTION_CONTENT
    ? ORDINARY_EVENT_SELECTION_IDS
    : ordinaryEventIdsForCatalog(content.catalog, content.orderedIds);
  return ordinaryIds.filter((id) => content.catalog[id]!.theme === theme);
}

/** CONDITIONAL catalog ids for one theme, fixed catalog order — the pre-bag
 * scan's pool (`rollEventForNode`). Fixed order is the tie-break when two
 * eligible events of one theme coincide. */
function conditionalIdsForTheme(theme: EventTheme, content: EventSelectionContent): readonly string[] {
  return content.orderedIds.filter((id) => (
    content.catalog[id]!.theme === theme && isConditionalEvent(content.catalog[id]!)
  ));
}

/** Whether this run has already shown `eventId` at some node. `eventInstances`
 * records every draw and the map never pre-draws unvisited nodes (runMap.ts
 * labels via `node.eventTheme` precisely so labeling doesn't consume a bag),
 * so membership here IS "the player saw it" — the chains' once-per-run bound,
 * for free, from a field the run already maintains. */
function isDrawnThisRun(state: RunState, eventId: string): boolean {
  return hasDrawnEvent(state, eventId);
}

/** The version currently projected into the stable catalog view. */
/** Creates the immutable identity recorded for a newly selected event node. */
function instanceForDraw(
  node: RunNode,
  event: LoadedEventDef,
  content: EventSelectionContent,
): EventInstanceRecord {
  return {
    eventId: event.id,
    contentVersion: content.currentVersionOf(event.id),
    instanceId: `event:${node.id}`,
    drawnDepth: node.depth,
  };
}

function finishSelectedEvent(
  state: RunState,
  node: RunNode,
  event: LoadedEventDef,
  content: EventSelectionContent,
): { state: RunState; event: LoadedEventDef } {
  const instance = instanceForDraw(node, event, content);
  const committed = recordEventInstance(state, node.id, instance);
  if (!isEventDefV3(event)) return { state: committed, event };
  const materialized = materializeReachedEventV3(committed, node, event, instance.contentVersion);
  if (!materialized.ok) {
    throw new Error(`rollEventForNode: could not materialize selected v3 content (${materialized.reason})`);
  }
  return { state: materialized.state, event };
}

/** Draws (idempotently) the event for `node` — repeated calls for the same
 * node return the SAME event without consuming the bag again (the
 * affordability check only runs on this FIRST roll; the memo is authoritative
 * afterward, so a reload/gold change never re-draws a different event for an
 * already-resolved node). Throws if `node` isn't an event node. */
export function rollEventForNode(state: RunState, node: RunNode): { state: RunState; event: LoadedEventDef };
export function rollEventForNode(
  state: RunState,
  node: RunNode,
  callbackLookup: EventDefinitionLookup<LoadedEventDef>,
): { state: RunState; event: LoadedEventDef };
export function rollEventForNode<TEvent extends LoadedEventDef>(
  state: RunState,
  node: RunNode,
  callbackLookup: EventDefinitionLookup<TEvent>,
  content: EventSelectionContent<TEvent>,
): { state: RunState; event: TEvent };
export function rollEventForNode(
  state: RunState,
  node: RunNode,
  callbackLookup: EventDefinitionLookup<EventDef | LoadedEventDefV3> = eventDefAtVersion,
  content: EventSelectionContent = ACTIVE_EVENT_SELECTION_CONTENT,
): { state: RunState; event: EventDef | LoadedEventDefV3 } {
  if (node.kind !== 'event') {
    throw new Error(`rollEventForNode: node "${node.id}" is not an event node`);
  }
  const existing = eventInstanceAt(state, node.id);
  if (existing) {
    const event = callbackLookup(existing.eventId, existing.contentVersion);
    if (!event) {
      throw new Error(
        `rollEventForNode: missing recorded content ${existing.eventId}@v${existing.contentVersion} for node "${node.id}"`,
      );
    }
    const repaired = repairDeliveredCallback(state, existing);
    if (!isEventDefV3(event)) return { state: repaired, event };
    const materialized = materializeReachedEventV3(repaired, node, event, existing.contentVersion);
    if (!materialized.ok) throw new Error(`rollEventForNode: could not replay v3 materialization (${materialized.reason})`);
    return { state: materialized.state, event };
  }

  // A due callback is an earned event, not another conditional candidate: it
  // gets first claim on a compatible node. Failed exact-version lookups leave
  // their entries untouched and scanning continues, so neither a missing nor
  // an incompatible callback can starve ordinary selection.
  for (const callback of dueEventCallbacks(state, node, callbackLookup)) {
    const delivered = deliverEventCallback(state, node, callback, callbackLookup);
    if (!delivered) continue;
    if (!isEventDefV3(delivered.event)) return delivered;
    const materialized = materializeReachedEventV3(delivered.state, node, delivered.event, callback.contentVersion);
    if (!materialized.ok) {
      throw new Error(`rollEventForNode: could not materialize due v3 callback (${materialized.reason})`);
    }
    return { state: materialized.state, event: delivered.event };
  }

  const comeback = content === ACTIVE_EVENT_SELECTION_CONTENT
    ? comebackEventForNode(state, node)
    : undefined;
  if (comeback !== undefined) return finishSelectedEvent(state, node, comeback, content);

  const theme = node.eventTheme;
  if (theme === undefined) {
    // Defensive fallback (no theme on the node) — today's original
    // all-catalog no-repeat bag, now affordability-aware. Its refill pool
    // excludes conditional ids for the same starvation reason `idsForTheme`
    // does; conditional content only ever arrives through the fully eligible
    // themed pre-bag scan below.
    let bag = state.eventBag;
    let refills = state.eventBagRefills;
    if (bag.length === 0) {
      const pool = content === ACTIVE_EVENT_SELECTION_CONTENT
        ? ORDINARY_EVENT_SELECTION_IDS
        : ordinaryEventIdsForCatalog(content.catalog, content.orderedIds);
      const rng = new Rng(hashSeed('eventBag', state.seed, refills));
      bag = sampleEventBag(rng, pool, content);
      refills += 1;
    }
    const eligibleIdx = firstEligibleIndex(bag, state, node, content.catalog);
    if (eligibleIdx === -1) {
      // The whole catalog is this bag's pool already — nothing eligible
      // anywhere means a content bug (every event's every choice is
      // gold-gated or `nothing`). Never throw: fall back to the bag's head.
      const eventId = bag[0]!;
      const event = content.catalog[eventId];
      if (!event) throw new Error(`rollEventForNode: unknown catalog event id "${eventId}"`);
      const nextState: RunState = {
        ...state,
        eventBag: bag.slice(1),
        eventBagRefills: refills,
      };
      return finishSelectedEvent(nextState, node, event, content);
    }
    const eventId = bag[eligibleIdx]!;
    const event = content.catalog[eventId];
    if (!event) throw new Error(`rollEventForNode: unknown catalog event id "${eventId}"`);
    const nextState: RunState = {
      ...state,
      eventBag: [...bag.slice(0, eligibleIdx), ...bag.slice(eligibleIdx + 1)],
      eventBagRefills: refills,
    };
    return finishSelectedEvent(nextState, node, event, content);
  }

  // CONDITIONAL EVENTS: never bagged, scanned in effective legacy-compatible
  // order before the bag is even looked at. The pure scan spends no Rng and
  // mutates no bag/refill bookkeeping; only a fully eligible event is memoized.
  const conditionalCandidates = conditionalIdsForTheme(theme, content).map((id) => content.catalog[id]!);
  const ready = firstEligibleConditionalEvent(state, node, conditionalCandidates);
  if (ready) {
    return finishSelectedEvent(state, node, ready, content);
  }

  const themePool = idsForTheme(theme, content);
  const themeBags = state.eventThemeBags ?? {};
  const themeRefills = state.eventThemeBagRefills ?? {};
  let bag = themeBags[theme] ?? [];
  let refills = themeRefills[theme] ?? 0;
  if (bag.length === 0) {
    const rng = new Rng(hashSeed('eventBag', state.seed, theme, refills));
    bag = sampleEventBag(rng, themePool, content);
    refills += 1;
  }

  const eligibleIdx = firstEligibleIndex(bag, state, node, content.catalog);
  if (eligibleIdx === -1) {
    // Nothing currently in this theme's bag is eligible at this gold. Persist
    // the (possibly just-refilled) bag as-is — it wasn't consumed, only
    // scanned — and widen the draw to the first eligible id in the WHOLE
    // catalog, graceful and non-throwing even if that also comes up empty.
    // Widening is ordinary-only. A conditional event may arrive solely from
    // the fully eligible themed pre-bag scan above; off-theme/off-biome
    // fallback delivery is forbidden.
    const eventId = eventIdFromOrdinaryWiden(state, bag, content.catalog, content.orderedIds, node)!;
    const event = content.catalog[eventId];
    if (!event) throw new Error(`rollEventForNode: unknown catalog event id "${eventId}"`);
    const nextState: RunState = {
      ...state,
      eventThemeBags: { ...themeBags, [theme]: bag },
      eventThemeBagRefills: { ...themeRefills, [theme]: refills },
    };
    return finishSelectedEvent(nextState, node, event, content);
  }

  const eventId = bag[eligibleIdx]!;
  const event = content.catalog[eventId];
  if (!event) throw new Error(`rollEventForNode: unknown catalog event id "${eventId}"`);

  const nextState: RunState = {
    ...state,
    eventThemeBags: { ...themeBags, [theme]: [...bag.slice(0, eligibleIdx), ...bag.slice(eligibleIdx + 1)] },
    eventThemeBagRefills: { ...themeRefills, [theme]: refills },
  };
  return finishSelectedEvent(nextState, node, event, content);
}

/**
 * Commit a route choice while recording graph-derived opportunities the
 * player actually passed. Previewed comeback cards consume their one return
 * whether chosen or skipped; failed rolls merely advance their persisted
 * 35% -> 60% attempt counter. The selected event is committed before the
 * route node so its card can never disagree with the event screen.
 */
export function chooseNodeWithEventOpportunities(state: RunState, nodeId: string): RunState {
  const choices = availableChoices(state);
  const selected = choices.find((node) => node.id === nodeId);
  if (selected === undefined) return chooseNode(state, nodeId);

  const previews = choices
    .filter((node) => node.kind === 'event')
    .map((node) => ({ node, event: rollEventForNode(state, node).event }));
  const offeredComeback = activeComebackOffer(state, choices);
  const comebackSurfaced = offeredComeback !== undefined
    && previews.some(({ node, event }) => node.id === offeredComeback.nodeId && event.id === offeredComeback.event.id);

  let working = state;
  if (selected.kind === 'event') working = rollEventForNode(working, selected).state;

  const used = new Set(working.eventComebackUsedIds ?? []);
  if (comebackSurfaced) used.add(offeredComeback!.event.id);
  const selectedPreview = previews.find(({ node }) => node.id === nodeId)?.event;
  if (selectedPreview !== undefined
    && (working.missedEventOpportunities ?? []).some((record) => record.eventId === selectedPreview.id)) {
    used.add(selectedPreview.id);
  }
  const currentBiomeIds = new Set(choices.map((node) => node.biomeId).filter((id): id is string => id !== undefined));
  const missed: MissedEventOpportunity[] = [];
  for (const record of working.missedEventOpportunities ?? []) {
    const event = ACTIVE_EVENT_SELECTION_CONTENT.catalog[record.eventId];
    const invalid = event === undefined
      || ACTIVE_EVENT_SELECTION_CONTENT.currentVersionOf(record.eventId) !== record.contentVersion
      || used.has(record.eventId)
      || drawnDepthFor(working, record.eventId) !== undefined
      || !eventIsChainStarter(event, ACTIVE_EVENT_SELECTION_CONTENT.catalog)
      || (currentBiomeIds.size > 0 && !currentBiomeIds.has(record.biomeId));
    if (invalid) continue;
    const hadEligibleHost = choices.some((node) => (
      node.wave % BOSS_EVERY !== 0
      && node.biomeId === record.biomeId
      && eventEligibleForComeback(state, node, event)
    ));
    missed.push(hadEligibleHost ? { ...record, laterOpportunities: record.laterOpportunities + 1 } : record);
  }

  const queuedIds = new Set(missed.map((record) => record.eventId));
  for (const { node, event } of previews) {
    if (node.id === nodeId || used.has(event.id) || queuedIds.has(event.id)) continue;
    if (!eventIsChainStarter(event, ACTIVE_EVENT_SELECTION_CONTENT.catalog)) continue;
    missed.push({
      eventId: event.id,
      contentVersion: ACTIVE_EVENT_SELECTION_CONTENT.currentVersionOf(event.id),
      biomeId: node.biomeId ?? biomeFor(state.map.seed, node.wave).id,
      missedDepth: node.depth,
      laterOpportunities: 0,
    });
    queuedIds.add(event.id);
  }

  working = {
    ...working,
    missedEventOpportunities: missed,
    eventComebackUsedIds: [...used],
  };
  return chooseNode(working, nodeId);
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

/** The part of a `MergeCardsOffer` that never needed the choice's `Rng` draw
 * in the first place — which tier merges, and the exact three instances that
 * would be consumed. */
export interface MergeCardsPreview {
  from: SkillTier;
  to: SkillTier;
  consumed: readonly MergeInputCard[];
}

/**
 * The persisted schema-v3 `mergeCards` offer for the CURRENT event node, if
 * one exists — a pure read of `state.eventMaterializations`, never a
 * re-derivation. `undefined` off an event node, before materialization, or
 * for a legacy (schema-1/2) event, none of which ever populate this record.
 */
function persistedMergeCardsOfferV3(state: RunState): Extract<EventDeferredOfferV3, { kind: 'mergeCards' }> | undefined {
  const node = currentEventNode(state);
  if (!node) return undefined;
  const instance = eventInstanceAt(state, node.id);
  if (!instance) return undefined;
  const materialization = state.eventMaterializations[instance.instanceId];
  if (!materialization) return undefined;
  for (const offer of Object.values(materialization.deferredOffersByChoiceId)) {
    if (offer.kind === 'mergeCards') return offer;
  }
  return undefined;
}

/**
 * The merge trade `state` would show right now — the CHOICE ROW and a
 * pre-resolution CONFIRM step both need this to name the exact trio before
 * the player commits to anything.
 *
 * TWO SOURCES, ONE RULE: the PERSISTED schema-v3 offer wins whenever one
 * exists; `mergeCardsPlan`'s live re-derivation is only the FALLBACK for
 * everything that never persists one — every legacy (schema-1/2) event, and
 * a v3 event before its offer materializes. This used to be a single live
 * re-derivation with a doc comment claiming "no persisted offer to go stale,
 * because nothing here is ever stored" — true for legacy (nothing legacy
 * EVER stores an offer, so re-reading `state` fresh is exactly correct there)
 * but FALSE the moment a schema-v3 `mergeCards` event exists: v3 persists its
 * offer's `consumed` at node entry (`materializeReachedEventV3`,
 * `eventsV3.ts`) and the finalizer (`finalizeMergeCardsV3` via
 * `removePersistedMergeInputs`) consumes exactly THAT snapshot, index-and-
 * instanceId matched, with no live re-derivation of its own. A board/bag
 * change between materialization and this call (e.g. a Deck Build reorder
 * that reassigns `.slot` without touching array position) can shift which
 * trio `mergeCardsPlan` would name FRESH — showing a trio the finalizer would
 * not actually be the one to remove. Preferring the persisted offer here is
 * what keeps this function's promise ("names the trio the finalizer takes")
 * true on BOTH schema paths instead of only the one it was proven on.
 *
 * Legacy behavior is unchanged: no legacy event ever writes
 * `eventMaterializations`, so `persistedMergeCardsOfferV3` always returns
 * `undefined` for one and this falls straight through to the live
 * `mergeCardsPlan` read, still reload-stale-proof for the reason the old
 * comment gave.
 */
export function mergeCardsPreview(state: RunState): MergeCardsPreview | null {
  const persisted = persistedMergeCardsOfferV3(state);
  if (persisted) {
    return persisted.status === 'unavailable'
      ? null
      : { from: persisted.from, to: persisted.to, consumed: persisted.consumed };
  }
  const plan = mergeCardsPlan(state);
  if (!plan) return null;
  return { from: plan.from, to: plan.to, consumed: plan.consumed };
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
  return delivered(mergeCardsPickResult(state, skillId));
}

function mergeCardsPickResult(
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

/** A `cardChoice`/`bonusDraft` spec with any `filterFrom` source substituted
 * for the concrete filter it derives to right now (`resolveFilterFrom`) — the
 * existing outcome functions then run unchanged over the swapped array, so
 * the deferred shape stays plain `bonusDraft` and no Rng call moves. An
 * unresolvable source falls back to the spec's own static `filter` (usually
 * none): the known-gap resolve path must never throw over a derivation the
 * usability gate would have dimmed (see `resolveFilterFrom`'s doc comment). */
function withResolvedFilterFrom<S extends Extract<EventOutcomeSpec, { kind: 'cardChoice' | 'bonusDraft' }>>(
  state: RunState,
  node: RunNode,
  spec: S,
): S {
  if (!spec.filterFrom) return spec;
  const derived = resolveFilterFrom(state, node, spec.filterFrom);
  return { ...spec, filter: derived ?? spec.filter };
}

/** Applies a single (already-rolled) outcome spec. `depth` is the
 * node's shop-stock-equivalent depth band (see `grantGemOutcome`'s doc
 * comment) — `grantGem` and `gemChoice` both consume it today. `node` is the
 * active event node, consumed only by the `filterFrom` substitution (the
 * biome sources are node-fixed: a reopened picker on the same node re-derives
 * the same lean, while `boardIdentity` re-derives against the run as it
 * stands — the same class as `upgradeCard`/`mergeCards`, see
 * `reopenEventChoice`). */
function applySpec(
  state: RunState,
  rng: Rng,
  spec: EventOutcomeSpec,
  depth: number,
  node: RunNode,
  sourceEventInstanceId: string | undefined,
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
      return { state, outcome: bonusDraftOutcome(rng, withResolvedFilterFrom(state, node, spec)) };
    case 'cardChoice':
      return { state, outcome: cardChoiceOutcome(rng, withResolvedFilterFrom(state, node, spec)) };
    case 'gemChoice':
      return { state, outcome: gemChoiceOutcome(rng, spec, depth) };
    case 'upgradeCard':
      return upgradeCardOutcome(state);
    case 'sellGem':
      return { state, outcome: sellGemOutcome(state) };
    case 'mergeCards':
      return mergeCardsOutcome(state, rng);
    case 'grantMapInfo': {
      if (!sourceEventInstanceId) throw new Error('grantMapInfo requires a committed source event instance');
      const nextState = applyGrantMapInfo(state, sourceEventInstanceId, bandIndexOf(node.wave), spec.bandsAhead);
      return {
        state: nextState,
        outcome: {
          kind: 'grantMapInfo',
          bandsAhead: spec.bandsAhead,
          revealedBands: mapIntelRecords(nextState)
            .filter((record) => record.sourceEventInstanceId === sourceEventInstanceId)
            .map((record) => record.band),
        },
      };
    }
    case 'nothing':
      return { state, outcome: { kind: 'nothing' } };
    default: {
      const exhaustive: never = spec;
      throw new Error(`applySpec: unknown outcome kind "${(exhaustive as EventOutcomeSpec).kind}"`);
    }
  }
}

/**
 * Resolve one outcome spec through the production seeded/depth-aware path,
 * without catalog lookup, cost deduction, or resolution-ledger mutation.
 * This is the pure seam used by `resolveEventChoice` after it has selected and
 * charged a real choice; content-boundary tests can pass isolated definitions
 * here without mutating the production catalog singleton.
 */
export function resolveEventOutcomeSpec(
  state: RunState,
  node: RunNode,
  choiceId: string,
  spec: EventOutcomeSpec,
  sourceEventInstanceId = eventInstanceAt(state, node.id)?.instanceId,
): { state: RunState; outcome: EventOutcome } {
  const rng = new Rng(hashSeed('event', node.eventSeed!, choiceId));
  return applySpec(state, rng, spec, shopStockDepthForWave(node.wave), node, sourceEventInstanceId);
}

/** Apply the closed v2 mutation vocabulary without deriving behavior from
 * presentation strings. Completion is append-only and idempotent. */
function applyEventMutations(state: RunState, choice: EventChoiceV2): RunState {
  if (!choice.mutations || choice.mutations.length === 0) return state;
  const completed = [...(state.completedStoryIds ?? [])];
  const seen = new Set(completed);
  for (const mutation of choice.mutations) {
    if (!seen.has(mutation.storyId)) {
      seen.add(mutation.storyId);
      completed.push(mutation.storyId);
    }
  }
  return completed.length === (state.completedStoryIds ?? []).length ? state : { ...state, completedStoryIds: completed };
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
  lookup: EventDefinitionLookup = legacyEventDefAtVersion,
): { state: RunState; outcome: EventOutcome } {
  const node = currentEventNode(state);
  if (!node) {
    throw new Error('resolveEventChoice: no event node is currently active');
  }
  const instance = eventInstanceAt(state, node.id);
  if (!instance) {
    throw new Error(`resolveEventChoice: no committed event instance for node "${node.id}"`);
  }
  if (instance.eventId !== eventId) {
    throw new Error(`resolveEventChoice: node "${node.id}" recorded event "${instance.eventId}", not "${eventId}"`);
  }
  const contentVersion = instance.contentVersion;
  const event = lookup(eventId, contentVersion);
  if (!event || event.id !== eventId) {
    throw new Error(`resolveEventChoice: unknown event id "${eventId}"`);
  }
  const choice = event.choices.find((c) => c.id === choiceId);
  if (!choice) {
    throw new Error(`resolveEventChoice: unknown choice id "${choiceId}" on event "${eventId}"`);
  }
  // ONE RUNG PER EVENT NODE, FOREVER. `eventInstances` already made the DRAW
  // idempotent; this is the same guarantee for the CHOICE. Without it a
  // re-entry (DECK/BAG is a `scene.start`, so `init()` rebuilds the screen's
  // phase from nothing) re-ran this whole function on the same node — a
  // repeatable free-gold loop on a paying rung, a repeat charge on a paid one.
  // Throwing (rather than returning the state unchanged) because there is no
  // legitimate second call: the UI now asks `eventResolutionAt` first, and the
  // store wrapper refuses before it ever gets here.
  const already = eventResolutionAt(state, node.id);
  if (already) {
    throw new Error(
      `resolveEventChoice: node "${node.id}" already resolved choice "${already.choiceId}" — an event node offers its rungs exactly once`,
    );
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

  const { state: outcomeState, outcome } = resolveEventOutcomeSpec(
    working,
    node,
    choiceId,
    choice.outcome,
    instance.instanceId,
  );
  const v2Choice = isEventDefV2(event)
    ? event.choices.find((candidate): candidate is EventChoiceV2 => candidate.id === choiceId)
    : undefined;
  let transactionState = outcomeState;
  if (v2Choice) {
    transactionState = applyEventMutations(transactionState, v2Choice);
    if (v2Choice.callback) {
      transactionState = scheduleEventCallback(transactionState, v2Choice.callback, {
        eventInstanceId: instance.instanceId,
        choiceId,
        nodeDepth: node.depth,
        ordinal: 0,
      });
    }
  }
  return {
    state: recordEventResolution(
      { ...transactionState, stats: { ...transactionState.stats, eventsResolved: transactionState.stats.eventsResolved + 1 } },
      node.id,
      {
        eventId,
        contentVersion,
        instanceId: instance.instanceId,
        choiceId,
        ...(isDeferredOutcome(outcome) ? { pending: true } : {}),
      },
    ),
    outcome,
  };
}

/**
 * Re-derives the DEFERRED picker a resolved-but-unfinished event node is still
 * waiting on — the `pending` window described on `EventResolution`
 * (runState.ts). Returns `undefined` when there is no active event node, when
 * its rung was never taken, or when the pick is already finalized (so a second
 * trip through DECK/BAG cannot hand out a second card).
 *
 * FREE OF CHARGE and NOT re-counted: unlike `resolveEventChoice` this deducts
 * no `choice.cost` and does not touch `stats.eventsResolved` — the player
 * already paid for this question and it is the same question, re-asked. Same
 * `hashSeed('event', node.eventSeed, choiceId)` stream, so a `bonusDraft`'s
 * five cards and a `gemChoice`'s three gems come back IDENTICAL; the two
 * state-reading kinds (`upgradeCard`, `mergeCards`) re-derive against the run
 * as it stands NOW, which is what the player is looking at and what their
 * finalizers would re-derive against anyway.
 *
 * The re-derivation can legitimately land on a NON-deferred outcome — a merge
 * whose inputs the player sold in the Deck/Bag screen in between falls back to
 * `applySpec`'s own consolation coin. That is a real resolution, so the
 * `pending` flag is cleared and the caller shows it as the outcome.
 */
export function reopenEventChoice(
  state: RunState,
  lookup: EventDefinitionLookup<EventDef> = legacyEventDefAtVersion,
): { state: RunState; outcome: EventOutcome } | undefined {
  const node = currentEventNode(state);
  if (!node) return undefined;
  const resolution = eventResolutionAt(state, node.id);
  if (!resolution?.pending) return undefined;
  const instance = eventInstanceAt(state, node.id);
  if (!instance) {
    throw new Error(`reopenEventChoice: no committed event instance for node "${node.id}"`);
  }
  if (!sameEventInstance(instance, {
    eventId: resolution.eventId,
    contentVersion: resolution.contentVersion,
    instanceId: resolution.instanceId,
    drawnDepth: instance.drawnDepth,
    ...(instance.callbackInstanceId === undefined ? {} : { callbackInstanceId: instance.callbackInstanceId }),
  })) {
    throw new Error(`reopenEventChoice: resolution for node "${node.id}" does not match committed event instance`);
  }
  const event = lookup(resolution.eventId, resolution.contentVersion);
  const choice = event?.choices.find((c) => c.id === resolution.choiceId);
  if (!choice) return undefined;

  const rng = new Rng(hashSeed('event', node.eventSeed!, resolution.choiceId));
  const { state: nextState, outcome } = applySpec(
    state,
    rng,
    choice.outcome,
    shopStockDepthForWave(node.wave),
    node,
    instance.instanceId,
  );
  return {
    state: isDeferredOutcome(outcome) ? nextState : clearPendingEventPick(nextState),
    outcome,
  };
}

/** THE ONE EXIT every deferred picker's finalizer takes — it stamps the
 * current event node's pending pick as DELIVERED (`clearPendingEventPick`) on
 * the way out, so the picker a re-entry re-opens (`reopenEventChoice`) can
 * never be answered twice. Wrapping here rather than at each of the eight
 * return sites inside the five finalizers is what makes that impossible to
 * forget: a sixth picker's finalizer is wrong the moment it does not go
 * through this function. `merged` (the merge receipt) rides through untouched
 * — see `MergeCardsReceipt`. */
function delivered<T extends { state: RunState }>(result: T): T {
  return { ...result, state: clearPendingEventPick(result.state) };
}

/**
 * Finalizes a `bonusDraft` outcome's deferred pick (the UI shows the 5 rolled
 * cards between `resolveEventChoice` returning `{kind:'bonusDraft', cards}`
 * and calling this). Same nearest-fit bag insert as everything else; falls
 * back to `grantGold(2)` (flagged `fellBack: true`) if the bag has no room.
 */
export function applyBonusDraftPick(state: RunState, pick: DraftCard): { state: RunState; outcome: EventOutcome } {
  return delivered(bonusDraftPickResult(state, pick));
}

function bonusDraftPickResult(state: RunState, pick: DraftCard): { state: RunState; outcome: EventOutcome } {
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
  return delivered(upgradeCardPickResult(state, instanceId));
}

function upgradeCardPickResult(state: RunState, instanceId: string): { state: RunState; outcome: EventOutcome } {
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
  return delivered(gemChoicePickResult(state, gemId));
}

function gemChoicePickResult(state: RunState, gemId: string): { state: RunState; outcome: EventOutcome } {
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
  return delivered(sellGemPickResult(state, pouchIndex));
}

function sellGemPickResult(state: RunState, pouchIndex: number): { state: RunState; outcome: EventOutcome } {
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
