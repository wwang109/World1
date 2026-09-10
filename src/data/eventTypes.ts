import type { SkillTier } from '../engine/types';
import type { CardFilter, GemFilter } from './shopTypes';

/** Node label/icon-color grouping (docs/run-events-design.md §3b) — drives
 * display only (the map node's "EVENT · <THEME>" label + icon color), never
 * gameplay branching in the resolver. */
export type EventTheme = 'training' | 'cache' | 'recruit' | 'forge' | 'market' | 'omen';

// ===========================================================================
// EVENT CHAINS (2026-09-02) — gates over state the run ALREADY remembers.
//
// Gates read the existing resolution ledger and tally counters; they add no
// RNG and no save fields. Gated events stay out of theme bags: a locked bag
// resident would prevent a refill and starve that theme. Once unlocked, a
// chain is instead drawn by priority at the next matching node. This keeps
// every seed byte-identical until a gate opens.
// ===========================================================================

/** "This unlocks only after the player resolved that." A pure scan of
 * `RunState.eventResolutions` — no Rng, no new save field. A `pending`
 * resolution counts: the cost is paid and the choice committed before a
 * deferred picker is answered. */
export interface EventGate {
  /** Catalog event whose past resolution unlocks this. */
  eventId: string;
  /** Absent means any choice on `eventId` counts. */
  choiceIds?: readonly string[];
}

/** "This unlocks only once a run counter reaches a bar." A pure read of
 * `RunState.stats` for purchase/life tallies and top-level
 * `wins`/`losses`/`bossesCleared` for the rest. */
export interface EventTallyGate {
  stat: 'goldSpent' | 'cardsBought' | 'gemsBought' | 'livesLost' | 'wins' | 'losses' | 'bossesCleared';
  atLeast: number;
}

export type EventRarity = 'common' | 'uncommon' | 'rare' | 'secret';

/** Closed presentation vocabulary for event-specific story illustrations.
 * Map nodes still preview their theme because no event has been resolved there. */
export type EventArtId = 'bell_beneath_ice' | 'second_toll' | 'bell_unbound';

export type EventRequirement =
  | { kind: 'resolution'; eventId: string; choiceIds?: readonly string[] }
  | { kind: 'tally'; stat: EventTallyGate['stat']; atLeast: number };

/**
 * The state a `filterFrom` card pool is derived FROM at resolve time — the
 * seam that lets a door follow the run instead of naming a static category.
 * `resolveFilterFrom` substitutes a concrete `CardFilter`; the existing
 * `cardChoice`/`bonusDraft` resolvers then run unchanged.
 *
 * `biomeLean` reads the active band lean, `biomeCounter` reads the type that
 * counters it (unresolvable on a bow band), and `boardIdentity` reads the
 * board's three-of-a-kind combat identity. An unresolvable source gates its
 * rung dark; the known-gap resolve path falls back to the spec's static
 * `filter` rather than throwing over a narrow pool.
 */
export type FilterFromSource = 'biomeLean' | 'biomeCounter' | 'boardIdentity';

/** The result vocabulary an event choice resolves to. Every grant reuses an
 * existing run system: bag insert, gem pouch, wallet, hero level, or draft. */
export type EventOutcomeSpec =
  | { kind: 'grantCard'; cardId?: string; filter?: CardFilter; tier?: SkillTier }
  | { kind: 'grantGem'; gemId?: string; filter?: GemFilter }
  // `cardChoice`/`gemChoice` are agency-bearing counterparts to blind grants:
  // they deal distinct candidates into the existing deferred-pick shapes.
  // `cardChoice` tier is narrowed to `'bronze'` because the shared DraftCard
  // shape is bronze-only. `filterFrom` replaces, rather than combines with, a
  // static filter, so catalog authors choose exactly one source.
  | { kind: 'cardChoice'; filter?: CardFilter; filterFrom?: FilterFromSource; tier?: 'bronze' }
  | { kind: 'gemChoice'; filter?: GemFilter }
  | { kind: 'grantGold'; amount: number }
  | { kind: 'loseGold'; amount: number }
  | { kind: 'grantLevel' }
  | { kind: 'bonusDraft'; filter?: CardFilter; filterFrom?: FilterFromSource }
  | { kind: 'upgradeCard' }
  // `sellGem` offers owned, unsocketed pouch gems as a deferred pick; it never
  // targets a socketed gem or a catalog-defined gem id.
  | { kind: 'sellGem' }
  // `mergeCards` consumes three owned cards of one tier and offers three cards
  // at tier+1. DIAMOND HAS NOWHERE TO GO, so diamonds are never merge inputs.
  | { kind: 'mergeCards' }
  // A typed run-layer snapshot reward. Its resolver derives no behavior from
  // event title/body/choice labels and never consumes map or bag randomness.
  | { kind: 'grantMapInfo'; bandsAhead: 2 | 3 }
  | { kind: 'nothing' };

export interface EventChoiceDef {
  id: string;
  /** Button label, e.g. "Pay 3 gold" / "Walk away". */
  label: string;
  /** Upfront gold; every event needs a free safe exit. */
  cost?: number;
  /** A locked rung presents like an unusable pouch action; the safe exit must
   * never carry a gate, because a locked exit is no exit. */
  requires?: EventGate;
  requiresTally?: EventTallyGate;
  outcome: EventOutcomeSpec;
}

export interface EventDef {
  id: string;
  title: string;
  body: string;
  /** Which of the 6 event themes this node displays as. */
  theme: EventTheme;
  /** Optional story-panel override; absent events use their theme illustration. */
  artId?: EventArtId;
  rarity?: EventRarity;
  biomeIds?: readonly string[];
  /** A chained event is drawn by priority at the next matching node only
   * after its gate opens. The catalog-linted dependency graph must be acyclic
   * and may span at most two event-to-event edges (three stages). */
  requires?: EventGate;
  requiresTally?: EventTallyGate;
  requiresAll?: readonly EventRequirement[];
  /**
   * 2-3 choices. The upper bound is the largest count the shared story-layout
   * reservation can fit on both platforms: desktop can fit four, but mobile
   * only three. The bound is the MIN across platforms, so a four-choice event
   * would be a mobile rendering defect even when desktop has room.
   */
  choices: readonly EventChoiceDef[];
}
