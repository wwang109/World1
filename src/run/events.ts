// Events — pure resolution over the declarative catalog in
// `src/data/events.ts` (see docs/run-events-design.md §1-3). Two entry
// points: `rollEventForNode` draws (idempotently) which event a node shows,
// `resolveEventChoice` applies a chosen choice's outcome. No Phaser, no
// Date.now/Math.random — every roll flows through the engine's seeded `Rng`
// in a fixed call order, so replaying the same run+path is byte-identical.

import { hashSeed, Rng } from '../engine/rng';
import type { SkillTier } from '../engine/types';
import { eventCatalog, eventCatalogIds, type EventChoiceOutcome, type EventDef, type EventOutcomeSpec, type EventTheme, type GambleRow } from '../data/events';
import type { DraftCard } from './draft';
import { skillBook } from '../data/skills';
import { gemBook } from '../data/gems';
import { cardMatchesFilter, gemMatchesFilter } from './shop';
import {
  currentEventNode,
  tryInsertRunCard,
  type RunNode,
  type RunState,
} from './runState';

/** Fallback gold grant when a `grantCard`/`bonusDraft` pick can't fit the bag. */
const CARD_FALLBACK_GOLD = 2;
const DEFAULT_CARD_TIER: SkillTier = 'bronze';
const BONUS_DRAFT_SIZE = 5;

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
// ---------------------------------------------------------------------------

/** Catalog ids for one theme, in fixed catalog order. */
function idsForTheme(theme: EventTheme): readonly string[] {
  return eventCatalogIds.filter((id) => eventCatalog[id]!.theme === theme);
}

/** Draws (idempotently) the event for `node` — repeated calls for the same
 * node return the SAME event without consuming the bag again. Throws if
 * `node` isn't an event node. */
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
    // all-catalog no-repeat bag behavior, unchanged.
    let bag = state.eventBag;
    let refills = state.eventBagRefills;
    if (bag.length === 0) {
      const rng = new Rng(hashSeed('eventBag', state.seed, refills));
      bag = sampleDistinct(rng, eventCatalogIds, eventCatalogIds.length);
      refills += 1;
    }
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
  const eventId = bag[0]!;
  const event = eventCatalog[eventId];
  if (!event) throw new Error(`rollEventForNode: unknown catalog event id "${eventId}"`);

  const nextState: RunState = {
    ...state,
    eventThemeBags: { ...themeBags, [theme]: bag.slice(1) },
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
      state: { ...state, gold: state.gold + CARD_FALLBACK_GOLD },
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
      return { state: { ...state, gold: state.gold + spec.amount }, outcome: { kind: 'grantGold', amount: spec.amount } };
    case 'loseGold': {
      const nextGold = Math.max(0, state.gold - spec.amount);
      return { state: { ...state, gold: nextGold }, outcome: { kind: 'loseGold', amount: spec.amount } };
    }
    case 'grantLevel': {
      const level = state.heroLevel + 1;
      return { state: { ...state, heroLevel: level }, outcome: { kind: 'grantLevel', level } };
    }
    case 'bonusDraft':
      return { state, outcome: bonusDraftOutcome(rng, spec) };
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
    working = { ...working, gold: Math.max(0, working.gold - choice.cost) };
  }

  const rng = new Rng(hashSeed('event', node.eventSeed!, choiceId));
  const gambled = choice.outcome.kind === 'gamble';
  const spec: EventOutcomeSpec = gambled
    ? rollGamble(rng, (choice.outcome as Extract<EventChoiceOutcome, { kind: 'gamble' }>).table)
    : (choice.outcome as EventOutcomeSpec);

  const { state: nextState, outcome } = applySpec(working, rng, spec);
  return { state: nextState, outcome: { ...outcome, gambled } };
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
      state: { ...state, gold: state.gold + CARD_FALLBACK_GOLD },
      outcome: { kind: 'grantGold', amount: CARD_FALLBACK_GOLD, fellBack: true },
    };
  }
  return { state: inserted.state, outcome: { kind: 'grantCard', skillId: pick.skillId, tier: pick.tier } };
}
