// Events — pure resolution over the declarative catalog in
// `src/data/events.ts` (see docs/run-events-design.md §1-3). Two entry
// points: `rollEventForNode` draws (idempotently) which event a node shows,
// `resolveEventChoice` applies a chosen choice's outcome. No Phaser, no
// Date.now/Math.random — every roll flows through the engine's seeded `Rng`
// in a fixed call order, so replaying the same run+path is byte-identical.

import { hashSeed, Rng } from '../engine/rng';
import type { SkillTier } from '../engine/types';
import { eventCatalog, eventCatalogIds, type EventChoiceDef, type EventChoiceOutcome, type EventDef, type EventOutcomeSpec, type EventTheme, type GambleRow } from '../data/events';
import type { DraftCard } from './draft';
import { skillBook } from '../data/skills';
import { gemBook } from '../data/gems';
import { cardMatchesFilter, gemMatchesFilter } from './shop';
import {
  currentEventNode,
  MAX_LEVEL,
  tryInsertRunCard,
  type RunNode,
  type RunState,
} from './runState';

/** Fallback gold grant when a `grantCard`/`bonusDraft` pick can't fit the bag
 * (also reused by `upgradeCard` when nothing owned is eligible to upgrade). */
const CARD_FALLBACK_GOLD = 2;
const DEFAULT_CARD_TIER: SkillTier = 'bronze';
const BONUS_DRAFT_SIZE = 5;

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

export type EventOutcome =
  | { kind: 'grantCard'; skillId: string; tier: SkillTier; fellBack?: boolean; gambled?: boolean }
  | { kind: 'grantGem'; gemId: string; gambled?: boolean }
  | { kind: 'grantGold'; amount: number; fellBack?: boolean; gambled?: boolean }
  | { kind: 'loseGold'; amount: number; gambled?: boolean }
  | { kind: 'grantLevel'; level: number; gambled?: boolean }
  | { kind: 'bonusDraft'; cards: readonly DraftCard[]; gambled?: boolean }
  // `skillId`/`from`/`to` are omitted (not merely falsy) exactly when
  // `fellBack` is true — this DELIBERATELY differs from `grantCard`'s
  // fallback idiom (which swaps the whole outcome to `grantGold`): a
  // `grantGold`-shaped fallback would render "Bag was full" for what is
  // really "nothing owned is eligible to upgrade", a wrong reason. Staying
  // `upgradeCard` with `fellBack: true` lets the UI show the correct reason
  // while still crediting `CARD_FALLBACK_GOLD` (see `upgradeCardOutcome`).
  | ({ kind: 'upgradeCard'; gambled?: boolean } & (
      | { fellBack: true; skillId?: undefined; from?: undefined; to?: undefined }
      | { fellBack?: false; skillId: string; from: SkillTier; to: SkillTier }
    ))
  | { kind: 'nothing'; gambled?: boolean };

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
 * dim an individual choice button (`choice.cost` omitted/0 always affords). */
export function isEventChoiceAffordable(state: RunState, choice: EventChoiceDef): boolean {
  return (choice.cost ?? 0) <= state.gold;
}

/** An event is eligible to be OFFERED at `state.gold` if at least one of its
 * choices is both affordable AND not the `nothing` no-op outcome — an event
 * whose only affordable option is the safe "walk away" exit is exactly the
 * dead-end case this guards against. (A `gamble` choice's outcome.kind is
 * `'gamble'`, never `'nothing'`, so a free gamble always counts as "does
 * something interesting" even though one of its rows may resolve to nothing.) */
function hasAffordableChoice(state: RunState, event: EventDef): boolean {
  return event.choices.some((c) => isEventChoiceAffordable(state, c) && c.outcome.kind !== 'nothing');
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
  const tier = spec.tier ?? DEFAULT_CARD_TIER;
  let skillId = spec.cardId;
  if (!skillId) {
    const pool = Object.values(skillBook).filter((s) => (spec.filter ? cardMatchesFilter(s, spec.filter) : true));
    if (pool.length === 0) throw new Error('grantCard: no skill matches the given filter');
    skillId = rng.pick(pool).id;
  }
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

function grantGemOutcome(
  state: RunState,
  rng: Rng,
  spec: Extract<EventOutcomeSpec, { kind: 'grantGem' }>,
): { state: RunState; outcome: EventOutcome } {
  let gemId = spec.gemId;
  if (!gemId) {
    const pool = Object.values(gemBook).filter((g) => (spec.filter ? gemMatchesFilter(g, spec.filter) : true));
    if (pool.length === 0) throw new Error('grantGem: no gem matches the given filter');
    gemId = rng.pick(pool).id;
  }
  return {
    state: { ...state, gemInventory: [...state.gemInventory, gemId] },
    outcome: { kind: 'grantGem', gemId },
  };
}

/**
 * `upgradeCard` — bumps ONE already-owned card +1 tier (see the doc comment
 * on `EventOutcomeSpec`'s `upgradeCard` member in `data/events.ts` for the
 * full targeting rule). Deterministic, no `Rng` draw at all: the target is a
 * pure function of `state.pieces`/`state.bagSlots`.
 *
 * Targeting: among every owned card that ISN'T already `diamond` (diamond has
 * no further tier to climb to), find the lowest tier present. Board `pieces`
 * are checked before the bag — if the lowest tier appears on the board, the
 * FIRST such piece by ascending `slot` wins; only if no board piece sits at
 * that lowest tier does the bag get considered, taking the first eligible
 * bag slot in array order. If nothing is eligible (no owned cards, or every
 * owned card is already diamond), STILL credits `CARD_FALLBACK_GOLD` (so the
 * choice's cost was never paid for literally nothing) but reports
 * `{kind: 'upgradeCard', fellBack: true}` rather than switching to a
 * `grantGold`-shaped outcome — see the `EventOutcome` union's `upgradeCard`
 * comment for why this diverges from `grantCard`'s fallback idiom.
 */
function upgradeCardOutcome(state: RunState): { state: RunState; outcome: EventOutcome } {
  let lowestRank = Infinity;
  for (const piece of state.pieces) {
    if (piece.tier === 'diamond') continue;
    lowestRank = Math.min(lowestRank, TIER_LADDER.indexOf(piece.tier));
  }
  for (const card of state.bagSlots) {
    if (!card || card.tier === 'diamond') continue;
    lowestRank = Math.min(lowestRank, TIER_LADDER.indexOf(card.tier));
  }

  if (!Number.isFinite(lowestRank)) {
    return {
      state: {
        ...state,
        gold: state.gold + CARD_FALLBACK_GOLD,
        stats: { ...state.stats, goldEarned: state.stats.goldEarned + CARD_FALLBACK_GOLD },
      },
      outcome: { kind: 'upgradeCard', fellBack: true },
    };
  }
  const targetTier = TIER_LADDER[lowestRank]!;
  const nextTier = TIER_UP[targetTier as Exclude<SkillTier, 'diamond'>];

  const boardTarget = [...state.pieces].sort((a, b) => a.slot - b.slot).find((p) => p.tier === targetTier);
  if (boardTarget) {
    const pieces = state.pieces.map((p) => (p.instanceId === boardTarget.instanceId ? { ...p, tier: nextTier } : p));
    return {
      state: { ...state, pieces },
      outcome: { kind: 'upgradeCard', skillId: boardTarget.skillId, from: targetTier, to: nextTier },
    };
  }

  const bagIndex = state.bagSlots.findIndex((c) => c && c.tier === targetTier);
  const bagTarget = state.bagSlots[bagIndex]!;
  const bagSlots = state.bagSlots.map((c, i) => (i === bagIndex ? { ...c!, tier: nextTier } : c));
  return {
    state: { ...state, bagSlots },
    outcome: { kind: 'upgradeCard', skillId: bagTarget.skillId, from: targetTier, to: nextTier },
  };
}

function bonusDraftOutcome(
  rng: Rng,
  spec: Extract<EventOutcomeSpec, { kind: 'bonusDraft' }>,
): EventOutcome {
  const all = Object.values(skillBook);
  const pool = spec.filter ? all.filter((s) => cardMatchesFilter(s, spec.filter!)) : all;
  const picked = sampleDistinct(rng, pool.length > 0 ? pool : all, BONUS_DRAFT_SIZE);
  return { kind: 'bonusDraft', cards: picked.map((s) => toDraftCard(s.id)) };
}

/** Applies a single (already-rolled, non-gamble) outcome spec. */
function applySpec(state: RunState, rng: Rng, spec: EventOutcomeSpec): { state: RunState; outcome: EventOutcome } {
  switch (spec.kind) {
    case 'grantCard':
      return grantCardOutcome(state, rng, spec);
    case 'grantGem':
      return grantGemOutcome(state, rng, spec);
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
    case 'upgradeCard':
      return upgradeCardOutcome(state);
    case 'nothing':
      return { state, outcome: { kind: 'nothing' } };
    default: {
      const exhaustive: never = spec;
      throw new Error(`applySpec: unknown outcome kind "${(exhaustive as EventOutcomeSpec).kind}"`);
    }
  }
}

/** Rolls a gamble's weighted table (integer percent, fixed call order: one
 * `rng.int(100)` roll, cumulative-weight scan in table order). Falls back to
 * the last row if weights don't sum to exactly 100 (should never happen —
 * the catalog lint test enforces it — but never throws mid-run over content). */
function rollGamble(rng: Rng, table: readonly GambleRow[]): EventOutcomeSpec {
  const roll = rng.int(100);
  let cursor = 0;
  for (const row of table) {
    cursor += row.weight;
    if (roll < cursor) return row.outcome;
  }
  return table[table.length - 1]!.outcome;
}

/**
 * Resolves the currently-active event node's `choiceId` on `eventId`: deducts
 * the choice's upfront `cost` (if any), rolls its gamble table (if any), then
 * applies the resulting outcome spec. All rolls derive from
 * `hashSeed('event', node.eventSeed, choiceId)` (fixed call order: the gamble
 * roll, if any, THEN the outcome's own roll, if any — e.g. a `grantCard` with
 * a `filter` draw). Throws if there's no active event node, or `eventId`/
 * `choiceId` don't resolve to a real catalog choice.
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
  const gambled = choice.outcome.kind === 'gamble';
  const spec: EventOutcomeSpec = gambled
    ? rollGamble(rng, (choice.outcome as Extract<EventChoiceOutcome, { kind: 'gamble' }>).table)
    : (choice.outcome as EventOutcomeSpec);

  const { state: nextState, outcome } = applySpec(working, rng, spec);
  return {
    state: { ...nextState, stats: { ...nextState.stats, eventsResolved: nextState.stats.eventsResolved + 1 } },
    outcome: { ...outcome, gambled },
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
