// Event catalog — DECLARATIVE content only (no logic), mirrors shopTypes.ts.
// Events are the third leg of the run (fights spend HP-of-attention, shops
// spend gold, EVENTS spend risk): a text dialogue at a stop-column node
// offering 2-3 choices with deterministic, seeded outcomes. The resolver that
// APPLIES these outcomes lives in `src/run/events.ts` — this module only
// declares WHAT each event offers.
//
// Every choice carries an optional upfront `cost` (gold, paid BEFORE the
// outcome resolves — the "cost/known-reward inline" line the UI shows on each
// button) and exactly ONE outcome from the small vocabulary in
// `EventOutcomeSpec` — deterministic, no RNG gamble tables (the old weighted-
// table `gamble` outcome kind was removed once every catalog choice had
// already been converted to a fixed outcome; see git history for the former
// `GambleRow`/`rollGamble`). Every event carries a genuinely SAFE choice —
// cost 0, `nothing` outcome — so a broke player is never soft-locked.
//
// `upgradeCard` (2026-08-04, picker added 2026-08-08): bumps ONE
// player-CHOSEN already-owned card +1 tier (bronze->silver->gold->diamond).
// The resolver (`src/run/events.ts#upgradeCardOutcome`) collects every
// eligible (non-diamond) owned card — board `pieces` first (ascending
// `slot`), then bag `bagSlots` (array order) — and, when at least one exists,
// returns a deferred `{kind:'upgradeCardPick', options}` outcome instead of
// resolving immediately; the UI shows those options (same "roll now, pick
// later" shape as `bonusDraft`) and `applyUpgradeCardPick` finalizes whichever
// one the player taps. If nothing is eligible (every owned card is diamond,
// or the player owns none), it resolves immediately: STILL credits
// `CARD_FALLBACK_GOLD` but reports `{fellBack: true}` while staying
// `kind: 'upgradeCard'` (deliberately NOT re-kinded to `grantGold` like
// `grantCard`'s full-bag fallback — "nothing to upgrade" needs its own UI
// line, not "bag was full").
//
// ===========================================================================
// STEERABLE CARD REWARDS (2026-08-26) — P19 "put the reward on the door" +
// P22 "guarantee the category, roll the instance"
// (docs/design-reference-roguelite-structure.md §4). CONTENT ONLY: no new
// outcome kind, no new filter machinery, no resolver change. Every filter
// added below is an ordinary `CardFilterClause` (`./shopTypes.ts`), matched by
// the same `cardMatchesFilter` the shops use.
//
// WHAT WAS WRONG. The deck-building payoff runs on TYPE: an `affinity` action
// resolves only when the board holds `IDENTITY_THRESHOLD` (3) cards of ONE
// type (`src/engine/combat/typeIdentity.ts`). Measured over the real catalog
// before this pass, the 14 card-granting event pools contained ZERO
// single-type pools: three were the whole 156-card book, and the widest
// (`sparring_circle`, `toll_bridge` — `archetypes: ['offense']`, 94 cards)
// put ELEVEN types behind a button that says "take a blade". Nothing on any
// event door told the player which type it paid, so no player could route for
// one — the definition of a reward that gets ignored (P22).
//
// WHAT THIS PASS DOES — AND, JUST AS DELIBERATELY, WHAT IT DOES NOT.
// Every card type gains a door whose pool is 100% that type and whose LABEL
// names it (the label is the only place the player can read it:
// `choiceOutcomeHint` in `src/game/ui/eventOutcomeText.ts` renders an offer's
// WIDTH — "MINI-DRAFT", "CHOICE OF 3 CARDS" — never its category):
//
//   sword     recruiter/pick_sword             weapons:['sword']
//   axe       sellsword_camp/browse_axes       weapons:['axe']
//   lance     wandering_smith/pike_blanks      weapons:['lance']
//   bow       overloaded_caravan/bow_staves    weapons:['bow']
//   beast     beast_nest/raid_prepared         weapons:['beast']
//   fire      circle_of_adepts/copy_fire       elements:['fire']
//   lightning circle_of_adepts/copy_lightning  elements:['lightning']
//   nature    field_medic/herb_satchel         elements:['nature']
//   frost     toll_bridge/frost_crate          elements:['frost']
//   holy      crossroads_shrine/tithe          elements:['holy']
//   dark      crossroads_shrine/moon_rite      elements:['dark']
//
// The doors are ADDED BESIDE the broad pools, not swapped in for them. That
// ordering is not a style preference — it is the result of measuring the
// alternative. A first cut of this pass REPLACED each broad pool with a
// single-type one; walked over the real run layer (map gen, node commit, the
// real `resolveEventChoice`) to wave 10, that version raised same-type cards
// OFFERED but cut the same-type cards a committed player actually KEEPS from
// 2.64 to 1.73 per run, and runs where the events handed over an identity
// (3+) fell from 48% to 22%. The reason is structural: a player keeps ONE
// card per event, so a wide pool pays a little to EVERY type at EVERY event
// while a single-type door pays 1.00 to one type and 0 to the other ten. Take
// the breadth away and the door has to be the event you happened to draw.
// Kept side by side, an event pays 1.00 when it is your door and its old
// broad odds when it is not — better on both measures at once, and the
// routing decision is real without the constraint being removed (P23).
//
// Only TWO existing pools were narrowed rather than supplemented, both of
// them two-type pools where splitting is a gain for the types involved and a
// loss for none: `crossroads_shrine/tithe` (holy+dark — 93% holy / 83% dark
// per offer) became the holy door at 100%, with the shrine's third slot taking
// the dark door at 100%; and `beast_nest/raid_prepared` (bow+beast — 93%
// beast / 57% bow) became the beast door, bow being paid back at 100% by
// `overloaded_caravan`'s own new door.
//
// WHAT IT MEASURES OUT AT (same walk, 60 seeds x 11 types, to wave 10): the
// same-type cards the event layer hands a committed player went 2.64 -> 2.91
// per run, runs where events alone deliver an identity 48% -> 56%, runs where
// they deliver NONE of the committed type 8% -> 4%, and same-type cards merely
// OFFERED 3.32 -> 5.59. The number that matters most is not in that list: a
// player who READS the labels now gets 2.91 where one who ignores them gets
// 1.67, against 2.64 versus 2.64 — identical to two decimals, per type —
// before the pass. That gap is the whole point of P19, and
// `tests/run/eventRewardDoors.test.ts` asserts it stays open.
//
// POOL-WIDTH RULE (the one that throws). `cardChoiceOutcome` THROWS when a
// filtered pool is narrower than `EVENT_CHOICE_SIZE` (3), and a `bonusDraft`
// silently deals fewer than its 5 (`sampleDistinct`) — so no filter here may
// go under those widths. The thinnest single-type pools in the book are bow
// and frost at 10 cards, double the wider bound.
// `tests/run/eventRewardDoors.test.ts` pins both widths against the REAL
// resolver, asserts every type still has a door, and re-runs the supply walk.
//
// HONESTY RULE. A choice's text may not imply a category its pool does not
// deliver — that is what made the old "spare blade off the rack" (13% swords)
// and `sweep_drill`'s retired splash filter (7%) defects rather than flavour.
// Every guaranteed door names its type in its label; every pool that stayed
// broad had its body rewritten to say what it actually is (a mixed rack,
// defensive issue, a shelf of debuffs, "anything at all"), and the same test
// file asserts both directions.
// ===========================================================================

import type { SkillTier } from '../engine/types';
import type { CardFilter, GemFilter } from './shopTypes';

/** Node label/icon-color grouping (docs/run-events-design.md §3b) — drives
 * display only (the map node's "EVENT · <THEME>" label + icon color), never
 * gameplay branching in the resolver. */
export type EventTheme = 'training' | 'cache' | 'recruit' | 'forge' | 'market' | 'omen';

// ===========================================================================
// EVENT CHAINS (2026-09-02) — gates over state the run ALREADY remembers.
//
// A gate makes an event (or one rung of an event) conditional on the run's own
// ledger: `RunState.eventResolutions` (which rungs were taken, kept for the
// re-entry/reload idempotency memo) and the tally counters `RunState.stats` /
// `wins`/`losses`/`bossesCleared` already maintain. Both gate shapes below are
// PURE READS — no Rng, and deliberately ZERO new save fields: a chain's whole
// memory is state that every shipped transition was already writing.
//
// The predicate authority lives in `src/run/events.ts` (`eventGateMet` /
// `eventTallyMet`, checked inside `isEventChoiceUsable` and
// `rollEventForNode`) — this module only DECLARES the gates, same
// content/logic split as the outcome specs above.
//
// A GATED EVENT NEVER ENTERS A THEME BAG. Bag entries the draw skips stay in
// the bag and a bag refills only when EMPTY, so one permanently-locked
// resident would pin its theme's bag at length >= 1 forever — the theme never
// reshuffles again and every draw after exhaustion widens to the same
// fixed-order catalog scan (provable starvation, see `rollEventForNode`'s
// chain-scan comment). Instead, an unlocked chain is drawn by PRIORITY at the
// next node of its theme — best delivery a path-dependent map can honestly
// promise (one merge door in the 6-deep forge bag reached only 64.2% of runs;
// a bag resident that must ALSO outlive its unlock reaches strictly fewer).
// Because gated ids never join any pool, every seeded event sequence is
// byte-identical until a gate opens — the same zero-perturbation discipline
// `ruined_anvil/beat_together` documents for the merge door.
// ===========================================================================

/** "This unlocks only after the player resolved that." A pure scan of
 * `RunState.eventResolutions` — no Rng, no new save field. A `pending`
 * resolution counts (the cost is paid and the choice committed the moment
 * `resolveEventChoice` returns; `pending` only means a deferred picker has
 * not been answered yet). */
export interface EventGate {
  /** Catalog event whose past resolution unlocks this. */
  eventId: string;
  /** Which choice ids on that event count; absent = any choice of `eventId`. */
  choiceIds?: readonly string[];
}

/** "This unlocks only once a run counter reaches a bar." A pure read of the
 * fields `RunState` already maintains (`stats.*` for the first four; the
 * top-level `wins`/`losses`/`bossesCleared` for the rest). */
export interface EventTallyGate {
  stat: 'goldSpent' | 'cardsBought' | 'gemsBought' | 'livesLost' | 'wins' | 'losses' | 'bossesCleared';
  atLeast: number;
}

/**
 * The state a `filterFrom` card pool is derived FROM at resolve time — the
 * seam that lets a door follow the run instead of naming a static category
 * (2026-09-02, see `the_lands_measure`/`banner_scribe`). NOT a new outcome
 * kind: `src/run/events.ts#resolveFilterFrom` substitutes a concrete
 * `CardFilter` (a pure read — no Rng, no save change) and the existing
 * `cardChoice`/`bonusDraft` resolvers then run unchanged.
 *
 *   - `biomeLean`    — the active node's band lean (`biomeFor`, run/biome.ts),
 *                      as a single-type element/weapon filter.
 *   - `biomeCounter` — `counterTypeFor(lean)` (run/biome.ts): the type that
 *                      farms what lives here. UNRESOLVABLE on a bow band —
 *                      nothing counters bow — and the rung goes dark.
 *   - `boardIdentity`— `boardTypeIdentity` (engine/combat/typeIdentity.ts)
 *                      over the BOARD pieces only, matching the combat fold's
 *                      own read. Unresolvable until the board commits to
 *                      3-of-a-kind; dark until then (the mergeCards idiom).
 *
 * An unresolvable source gates its rung dark via `isEventChoiceUsable`; if
 * the known-gap resolve path is taken anyway, the resolver falls back to the
 * spec's static `filter` (usually none) — the module's standing "never throw
 * over a narrow filter" posture.
 */
export type FilterFromSource = 'biomeLean' | 'biomeCounter' | 'boardIdentity';

/** The result vocabulary an event choice resolves to. Small on purpose —
 * every grant reuses an existing system (bag insert, gem pouch, run wallet,
 * hero level, the start-draft set roller). */
export type EventOutcomeSpec =
  | { kind: 'grantCard'; cardId?: string; filter?: CardFilter; tier?: SkillTier }
  | { kind: 'grantGem'; gemId?: string; filter?: GemFilter }
  // `cardChoice`/`gemChoice` (2026-08-18): the widened, agency-bearing
  // siblings of `grantCard`/`grantGem` above — same filter/tier vocabulary,
  // but the resolver draws EVENT_CHOICE_SIZE (3, not `bonusDraft`'s 5 — a
  // free/cheap grant must not out-earn `bonusDraft`'s paid 5-wide identity)
  // DISTINCT candidates and hands the player a deferred pick instead of
  // resolving blind. `cardChoice` reuses `bonusDraft`'s own deferred-offer
  // shape 1:1 (`src/run/events.ts#cardChoiceOutcome` returns the exact same
  // `{kind:'bonusDraft', cards}` `EventOutcome` `applyBonusDraftPick` already
  // finalizes — no new resolved shape). `gemChoice` has no existing analogue
  // to reuse (gems never had a picker), so it returns a new deferred
  // `{kind:'gemChoicePick', options}` `EventOutcome`, finalized by the new
  // `applyGemChoicePick`. No `cardId`/`gemId` field — a choice that already
  // NAMES its reward stays `grantCard`/`grantGem`. 4 named-card grants were
  // deliberately untouched by the original 2026-08-18 widening; a 5th
  // (`sweep_drill`'s `proper_stance`, 2026-08-19 defect fix — see that
  // event's own comment) was added afterward for an unrelated reason: its
  // `cardChoice` filter delivered its body's "splash" promise on only 1 of
  // 15 pool cards, so it became a named grant of the one card that keeps
  // the promise, not a widened pool.
  // `tier` is narrowed to `'bronze'` (not the full `SkillTier` `grantCard`
  // takes): the resolver hands this off to `bonusDraft`'s own deferred-pick
  // shape (`DraftCard`, `src/run/draft.ts`), whose `tier` field is itself
  // fixed at `'bronze'` — every existing `bonusDraft` mini-draft in this
  // catalog is bronze-only for the same reason. Every current `cardChoice`
  // conversion is bronze already, so this costs nothing today.
  // `filterFrom` (2026-09-02): derive the pool from run state at resolve time
  // instead of naming it here — see `FilterFromSource`'s doc comment above.
  // Author one of `filter`/`filterFrom`, never both (catalog-linted): when the
  // source resolves it substitutes the whole filter, so a static one would be
  // dead content pretending to matter.
  | { kind: 'cardChoice'; filter?: CardFilter; filterFrom?: FilterFromSource; tier?: 'bronze' }
  | { kind: 'gemChoice'; filter?: GemFilter }
  | { kind: 'grantGold'; amount: number }
  | { kind: 'loseGold'; amount: number }
  | { kind: 'grantLevel' }
  | { kind: 'bonusDraft'; filter?: CardFilter; filterFrom?: FilterFromSource }
  | { kind: 'upgradeCard' }
  // `sellGem` (2026-08-20) — the lapidary event's originally-wanted "sell a
  // gem" outcome, parked until the vocabulary/resolver work below existed.
  // Deliberately the mirror image of `gemChoice`: instead of drawing NEW gems
  // from the catalog, it offers the player's own OWNED, UNSOCKETED pouch gems
  // (`RunState.gemInventory` — a socketed gem lives on `BoardPiece.gem`
  // instead and is out of scope for v1; selling one would require an
  // unsocket step this outcome doesn't build) as a deferred pick, same
  // "roll now [nothing to roll, it's just the pouch's own contents], pick
  // later" shape as `gemChoice`'s own `{kind:'gemChoicePick', options}`. No
  // `filter` field — v1 offers the WHOLE pouch, not a themed slice of it (a
  // themed sell restriction can be added later without a shape change). No
  // `gemId`/fixed target either — unlike `grantGem`, there's nothing to name
  // in advance; which gem sells is entirely the player's pick. See
  // `src/run/events.ts#sellGemOutcome`/`applySellGemPick` for the resolver
  // and `EventOutcome`'s `sellGemPick`/`sellGem` members for the deferred/
  // resolved shapes, and this module's `the_lapidary` entry for the one
  // catalog choice that uses it today.
  | { kind: 'sellGem' }
  // `mergeCards` (2026-08-26) — THREE OWNED CARDS OF ONE TIER IN, A CHOICE OF
  // THREE CARDS AT TIER+1 OUT. The only DESTRUCTIVE card outcome in the
  // vocabulary: every other member above either adds something
  // (`grantCard`/`bonusDraft`/`cardChoice`), rewrites one instance in place
  // (`upgradeCard`), or spends a gem (`sellGem`) — this one removes three owned
  // instances and hands back one.
  //
  // BOTH HALVES OF THE SHAPE ARE DELIBERATE (approved 2026-08-26).
  //   - SAME-TIER INPUT, never mixed. The alternative ("accept any three and
  //     upgrade the LOWEST tier of them") lets a player feed two Bronze and a
  //     Diamond and lose the Diamond's value — a trap, not a decision.
  //   - A CHOICE OF THREE OUT, never one random card. Combat is automatic, so
  //     every decision this game has lives in what goes on the board; a single
  //     rolled result would make the trade a slot machine instead of a way to
  //     steer a build (the same P19/P22 reasoning as the card doors above).
  //
  // No fields: WHICH tier merges, WHICH three instances are consumed and WHAT
  // the three candidates are is entirely a function of the run state plus the
  // choice's own seed, so there is nothing for content to declare. See
  // `src/run/events.ts#mergeCardsPlan` for the (single, shared) authority on
  // all four, `isEventChoiceUsable` for the eligibility gate that keeps this
  // choice from ever being offered when it could not be honoured, and
  // `applyMergeCardsPick` for the finalizer.
  //
  // DIAMOND HAS NOWHERE TO GO, so a trio of Diamonds is NOT a merge input: the
  // plan only ever picks a tier that HAS a tier+1, and a player whose only trio
  // is Diamond gets this choice reported UNUSABLE (`isEventChoiceUsable`) rather
  // than a button that spends three Diamonds for nothing. Both events carrying
  // this outcome keep another non-`nothing` choice, so the EVENT still appears —
  // only the merge rung is dark.
  | { kind: 'mergeCards' }
  | { kind: 'nothing' };

export interface EventChoiceDef {
  id: string;
  /** Button label, e.g. "Pay 3 gold" / "Walk away". */
  label: string;
  /** Upfront gold cost paid before the outcome resolves (omitted/0 = free —
   * every event needs at least one cost-0 choice as its safe exit). */
  cost?: number;
  /** A GATED RUNG: offered only once the named past resolution exists —
   * checked by `isEventChoiceUsable` (the same predicate the scenes already
   * dim buttons with), so a locked rung presents exactly like an
   * empty-pouch `sellGem` rung does today. The event's cost-0 safe exit must
   * never carry one (catalog-linted — a locked exit is no exit). */
  requires?: EventGate;
  /** Same, for a tally bar (see `EventTallyGate`). */
  requiresTally?: EventTallyGate;
  outcome: EventOutcomeSpec;
}

export interface EventDef {
  id: string;
  title: string;
  body: string;
  /** Which of the 6 event themes this node displays as (docs/run-events-design.md §3b). */
  theme: EventTheme;
  /** A CHAINED EVENT: cannot be drawn at all before this gate opens. Gated
   * events never enter a theme bag (see the EVENT CHAINS block above for the
   * starvation proof); once the gate is open and the event undrawn this run,
   * `rollEventForNode` draws it by PRIORITY at the next node of its `theme`
   * — the theme label on the map stays honest (the KIND was readable, the
   * DETAIL is the surprise — biomeForecast.ts's own principle). The gate's
   * TARGET must itself be ungated (depth-1 chains only, catalog-linted:
   * cycles and unreachable ladders are forbidden in one rule). */
  requires?: EventGate;
  /** Same, for a tally bar (see `EventTallyGate`). */
  requiresTally?: EventTallyGate;
  /**
   * 2-3 choices, enforced by `tests/run/events.test.ts`'s "every event has
   * 2-3 choices" catalog lint. The upper bound of 3 is not arbitrary — it is
   * the largest choice count `src/game/ui/runEventStoryLayout.ts`'s
   * reservation math can guarantee fits on BOTH platforms without the choice
   * block's bottom row landing off-canvas (the exact 2026-08-19 bug this
   * module's own doc comment describes):
   *
   *   - DESKTOP tolerates up to 4: at N=4, `eventChoiceBlockHeight` reserves
   *     426px (4×99 + 3×10), leaving `eventStoryLimit` at 430px — still above
   *     its 340px defensive floor. N=5 needs 535px, which floor-clamps the
   *     reservation (the regression this comment exists to prevent).
   *   - MOBILE tolerates only up to 3: at N=3 the reserved 286px
   *     (3×90 + 2×8) leaves the capped body box a 132px budget, comfortably
   *     above its own 70px floor. N=4 needs 384px, which shrinks that budget
   *     to 34px — clamped to the 70px floor, i.e. the SAME failure mode.
   *
   * The bound is the MIN across platforms (3, from mobile), not desktop's
   * own 4 — a 4-choice event would render fine on desktop and broken on
   * mobile. See `tests/game/runEventStoryLayout.test.ts`'s "bound
   * derivation" describe block for the synthetic proof at N=3 (fits) and the
   * documented failure at N=4 (does not).
   */
  choices: readonly EventChoiceDef[];
}

const defs: EventDef[] = [
  {
    id: 'wandering_tutor',
    title: 'The Wandering Tutor',
    theme: 'training',
    body: 'The dust of the Hollow Yard has barely settled from the last duel when an old sellsword rises to meet you, gnarled staff in hand. "Two gold," she says, "and I\'ll show you where you\'re wasting your strength." Her lesson won\'t be free — but it won\'t be forgotten, either.',
    choices: [
      { id: 'pay', label: 'Pay 2 gold for the lesson', cost: 2, outcome: { kind: 'grantLevel' } },
      { id: 'decline', label: 'Keep walking', outcome: { kind: 'nothing' } },
    ],
  },
  {
    id: 'abandoned_cache',
    title: 'Abandoned Cache',
    theme: 'cache',
    body: 'The trail dips into the Silt Hollows, and there, half-swallowed by mud, a supply crate juts from the muck, its lock long rusted through. Someone left here in a hurry — or never came back at all. Pry it open and it could hold anything worth carrying, or nothing at all but the reason it was abandoned.',
    choices: [
      // No RNG on rewards (USER-LOCKED): the free choice always grants a
      // small guaranteed reward; a player who wants the old gamble's WINNING
      // outcome for certain now pays for it instead of rolling for it.
      { id: 'open', label: 'Pry it open', outcome: { kind: 'grantGold', amount: 1 } },
      {
        id: 'search_thoroughly',
        label: 'Search it thoroughly (2 gold)',
        cost: 2,
        outcome: { kind: 'cardChoice', tier: 'bronze' },
      },
      { id: 'leave', label: 'Leave it be', outcome: { kind: 'nothing' } },
    ],
  },
  {
    id: 'recruiter',
    title: 'The Recruiter',
    theme: 'recruit',
    body: 'A weapons broker flags you down from beneath a striped awning at the roadside edge of the Muster Road, arms full of blades and bowstrings still warm from the last camp. "Swords are racked on their own — anything else, you take your chances with what\'s in the cart," he grins, laying out a row of five either way. "Or take the coin instead. I won\'t haggle."',
    choices: [
      // THE SWORD DOOR (2026-08-26 P19/P22 pass — see the header). Added
      // BESIDE `pick_weapon`, never in place of it: the rack is 100% swords
      // and says so, the cart stays the old five-weapon mixed pool for
      // everyone the rack doesn't serve.
      {
        id: 'pick_sword',
        label: 'Browse the sword rack',
        outcome: { kind: 'bonusDraft', filter: [{ weapons: ['sword'] }] },
      },
      {
        id: 'pick_weapon',
        label: 'Dig through the mixed cart',
        outcome: { kind: 'bonusDraft', filter: [{ weapons: ['sword', 'axe', 'lance', 'bow', 'beast'] }] },
      },
      { id: 'take_coin', label: 'Take the coin instead', outcome: { kind: 'grantGold', amount: 2 } },
    ],
  },
  {
    id: 'gemsellers_mishap',
    title: "Gemseller's Mishap",
    theme: 'cache',
    body: 'A peddler\'s cart hits a sinking rut at the edge of the Silt Hollows and her satchel bursts, scattering uncut gems across the mud. She scrambles after them, cursing — there\'s more here than she can gather alone, and more than a few have already rolled to rest against your boots.',
    choices: [
      // No RNG on rewards (USER-LOCKED): the free choice always grants a
      // small guaranteed reward; the paid choice keeps the old gamble's
      // winning outcome, now guaranteed at the catalog gem rate.
      { id: 'help', label: 'Help her gather them', outcome: { kind: 'grantGold', amount: 1 } },
      { id: 'rifle', label: 'Rifle through the spill (2 gold)', cost: 2, outcome: { kind: 'gemChoice' } },
    ],
  },
  {
    id: 'crossroads_shrine',
    title: 'Crossroads Shrine',
    theme: 'omen',
    body: 'At the heart of the Crossroads Unquiet stands a weathered shrine, carvings split evenly between a rising sun and a crescent moon, and the two faces answer separately: tithe at the sun and what comes back is holy work, every time; scratch the moon-mark instead and it is dark work, every time. Others, less devout, simply pry the shrine apart for scrap.',
    choices: [
      // THE HOLY DOOR and THE DARK DOOR. This is the one pool the pass
      // NARROWED rather than supplemented, because splitting it is a strict
      // gain for both of its types and a loss for none: the old shared
      // holy+dark pool offered holy on 93% of draws and dark on 83%, and now
      // each face offers its own at 100%. `tests/run/events.test.ts` asserts
      // `tithe`'s offers stay inside holy/dark — holy-only satisfies that
      // strictly.
      {
        id: 'tithe',
        label: 'Leave a holy tithe (2 gold)',
        cost: 2,
        outcome: { kind: 'cardChoice', filter: [{ elements: ['holy'] }] },
      },
      // Same outcome kind and the same 2 gold as its holy sibling on purpose:
      // two faces of one shrine that differ ONLY in which element they pay.
      // A 5-wide `bonusDraft` here would have made the moon strictly the
      // better buy at an identical price (see `EVENT_CHOICE_SIZE`'s
      // pricing-arithmetic comment in src/run/events.ts) — the catalog's
      // cardChoice count is unchanged overall, `toll_bridge` below trading the
      // other way for the same reason.
      {
        id: 'moon_rite',
        label: 'Scratch the moon-mark for dark work (2 gold)',
        cost: 2,
        outcome: { kind: 'cardChoice', filter: [{ elements: ['dark'] }] },
      },
      { id: 'deface', label: 'Deface it for scrap', outcome: { kind: 'grantGold', amount: 3 } },
    ],
  },
  {
    id: 'veterans_last_lesson',
    title: "Veteran's Last Lesson",
    theme: 'training',
    body: 'At the far end of the Hollow Yard, a retiring blade-master sets down her practice cane and offers you her signature weapon, still humming faintly with old battles. "Take it, and carry what I built," she says, "or take my years instead — I\'ve more use for rest now than for steel."',
    choices: [
      { id: 'take_blade', label: "Take the veteran's blade", outcome: { kind: 'grantCard', cardId: 'crushing_blow', tier: 'silver' } },
      { id: 'take_years', label: 'Take her years of experience instead', outcome: { kind: 'grantLevel' } },
    ],
  },
  {
    id: 'gambler',
    title: 'The Gambler',
    theme: 'omen',
    body: 'In the shadow of the crossroads shrine, a hooded figure shuffles cards at a folding table, coins stacked at her elbow, never once looking up as travelers pass. "Stake two gold on a safe cut," she says, "or five on a bold one — walk off with more than you sat down with, either way. Or don\'t play at all — some prefer to keep what little they have."',
    // No RNG on rewards (USER-LOCKED) — but wagering is THIS event's whole
    // identity, so it doesn't take the generic "free grant / paid grant"
    // template every other gamble in the catalog gets. Instead: two fixed,
    // deterministic stake tiers (no coin flip — you always win the cut), each
    // gated on affordability by its own upfront `cost` (never a `loseGold`
    // branch — see the historical note this replaced: modelling a stake as
    // loseGold made it a free coin-flip for a broke player, since loseGold
    // floors at 0). Small stake: 2g -> 3g (+1, 50% return). Big stake: 5g ->
    // 9g (+4, 80% return) — naturally gated on having the 5-gold surplus to
    // stake in the first place, same affordability gate as everything else.
    // `walk_away` stays the free, no-op safe exit since both real choices
    // cost gold.
    choices: [
      { id: 'stake_small', label: 'Stake 2 gold on a safe cut', cost: 2, outcome: { kind: 'grantGold', amount: 3 } },
      { id: 'stake_big', label: 'Stake 5 gold on a bold cut', cost: 5, outcome: { kind: 'grantGold', amount: 9 } },
      { id: 'walk_away', label: 'Walk away', outcome: { kind: 'nothing' } },
    ],
  },
  {
    id: 'overloaded_caravan',
    title: 'Overloaded Caravan',
    theme: 'market',
    body: 'A merchant caravan sits axle-deep in the mud of the Tolling Road, its driver frantic as the sun sinks lower. A bundle of bowstaves is lashed to the tailgate where anyone can see it; the trunks behind it are packed with no order at all and could hold anything. Push, and she\'ll let you take from either — or just toss you a coin for a shoulder at the wheel.',
    choices: [
      // THE BOW DOOR — added beside the trunks, which stay the catalog's
      // widest offer (the WHOLE 156-card book, ~6-14% per type). Bow is also
      // the type that gave up `beast_nest`'s old shared bow+beast pool, and
      // this pays it back at 100% instead of that pool's 57%.
      {
        id: 'bow_staves',
        label: 'Take a bow off the tailgate (1 gold)',
        cost: 1,
        outcome: { kind: 'bonusDraft', filter: [{ weapons: ['bow'] }] },
      },
      { id: 'rummage', label: 'Push, then rummage the trunks (1 gold)', cost: 1, outcome: { kind: 'bonusDraft' } },
      { id: 'push', label: 'Just push for a coin', outcome: { kind: 'grantGold', amount: 1 } },
    ],
  },

  // ==========================================================================
  // Catalog expansion (2026-07-29, +12 events) — docs/run-events-design.md §3b.
  // Themed to fill out TRAINING/CACHE/RECRUIT/FORGE/MARKET (OMEN stays the 2
  // existing high-variance events, per the design doc's explicit mapping).
  // ==========================================================================

  // ---- TRAINING ----
  {
    id: 'sparring_circle',
    title: 'Sparring Circle',
    theme: 'training',
    body: 'A ring of packed dirt marks the heart of the Hollow Yard, worn smooth by years of practice bouts. A scarred instructor waves you over: "Two gold buys you a real lesson. Or help yourself to the practice rack — it\'s every kind of gear anyone ever left here, all of it meant for hitting things, and no two pieces alike."',
    choices: [
      { id: 'lesson', label: 'Pay 2 gold for a real lesson', cost: 2, outcome: { kind: 'grantLevel' } },
      // Stays cost 0 — the event's ONLY cost-0 choice (`lesson` costs 2); the
      // safe-exit invariant (docs at the top of this file) forbids repricing
      // it, unlike its `take_armor`/`take_stone` siblings below.
      // STAYS BROAD (94 cards, all eleven types) — one of the pass's
      // deliberate non-doors (P23: a catalog where every reward is guaranteed
      // has deleted the routing decision). What changed is the PROMISE: the
      // old label said "a spare blade", which a sword player read as a sword
      // and got one 13% of the time. It is now openly a mixed rack of
      // offensive gear, which is exactly what the filter says.
      {
        id: 'spare_blade',
        label: 'Help yourself to the mixed rack',
        outcome: { kind: 'cardChoice', filter: [{ archetypes: ['offense'] }], tier: 'bronze' },
      },
    ],
  },
  {
    id: 'hermits_riddle',
    title: "Hermit's Riddle",
    theme: 'training',
    body: 'On a mossy boulder overlooking the Hollow Yard, a hermit sits cross-legged, riddle already half-spoken before you\'ve even stopped walking. Answer it right, she says, and you\'ll understand something about yourself no sparring ring could teach. Answer wrong, and you\'ll simply keep walking, no worse for it.',
    choices: [
      // No RNG on rewards (USER-LOCKED): the free choice always grants a
      // small guaranteed reward; a new paid choice guarantees the old
      // gamble's winning outcome at the catalog level-up rate.
      { id: 'answer', label: 'Answer the riddle', outcome: { kind: 'grantGold', amount: 1 } },
      {
        id: 'press_further',
        label: 'Press her for a deeper truth (2 gold)',
        cost: 2,
        outcome: { kind: 'grantLevel' },
      },
      { id: 'walk_away', label: 'Walk away', outcome: { kind: 'nothing' } },
    ],
  },

  // ---- CACHE ----
  {
    id: 'collapsed_barrow',
    title: 'Collapsed Barrow',
    theme: 'cache',
    body: 'A grave-mound in the Silt Hollows has slumped in on itself, exposing a narrow gap into the dark, silt-choked space below. Old barrows like this sometimes hold a forgotten trinket among the bones — and sometimes hold nothing but the bones themselves.',
    choices: [
      // No RNG on rewards (USER-LOCKED): the free choice always grants a
      // small guaranteed reward; a new paid choice guarantees the old
      // gamble's winning outcome at the catalog gem rate.
      { id: 'crawl_in', label: 'Crawl inside', outcome: { kind: 'grantGold', amount: 1 } },
      {
        id: 'dig_further',
        label: 'Dig further for a real find (2 gold)',
        cost: 2,
        outcome: { kind: 'gemChoice' },
      },
      { id: 'seal_it', label: 'Seal it back up and move on', outcome: { kind: 'nothing' } },
    ],
  },
  {
    id: 'quartermasters_error',
    title: "Quartermaster's Error",
    theme: 'cache',
    body: 'A tired quartermaster at the edge of the Silt Hollows shoves a requisition ledger across the counter, muttering about a shipment that was never meant to reach you. "Take the armor plating — it\'s all defensive issue, wards and guards and nothing that hits back," he says, "or the loose gemstone in the corner. Don\'t care which — just take it and go before someone notices."',
    choices: [
      // Both choices here were cost-0 free picks pre-widening; only ONE of an
      // event's choices needs to stay cost-0 for the safe-exit invariant, so
      // `take_gem` (gems are the catalog's single biggest RNG win) takes the
      // +1-gold reprice and `take_armor` stays free.
      {
        id: 'take_armor',
        label: 'Take the armor plating',
        outcome: { kind: 'cardChoice', filter: [{ archetypes: ['defensive'] }], tier: 'bronze' },
      },
      {
        id: 'take_gem',
        label: 'Take the loose gemstone (1 gold)',
        cost: 1,
        outcome: { kind: 'gemChoice' },
      },
    ],
  },
  {
    id: 'beast_nest',
    title: 'Beast Nest',
    theme: 'cache',
    body: 'A trampled nest sits half-sunk in the Silt Hollows\' mud, littered with the shed claws and feathers of something large. Everything worth carrying out of it is beast-work — fang, claw and hide, nothing else — if whatever built it doesn\'t come back and cost you a coin purse for the trouble.',
    choices: [
      // No RNG on rewards (USER-LOCKED) — and this specific choice was also a
      // PROVEN defect: `raid_it` had `cost: 0` (the UI reads its button as
      // FREE) but its 40%-weight losing branch was `loseGold(1)` — the only
      // zero-cost choice in the whole catalog able to take gold from a player
      // who was told the button cost nothing. The fix removes both problems
      // at once: `raid_it` is now a guaranteed, gold-only-ever-GOING-UP
      // grant, and the old gamble's winning outcome (the bow/beast card) is
      // now a separate, honestly-priced paid choice.
      { id: 'raid_it', label: 'Raid the nest', outcome: { kind: 'grantGold', amount: 1 } },
      // THE BEAST DOOR — the second (and last) pool this pass narrowed
      // rather than supplemented: the old bow+beast pool offered beast on 93%
      // of draws and bow on 57%, and a nest full of fangs is beast-work by
      // its own fiction. Bow's replacement is `overloaded_caravan`'s
      // bowstave door at 100%, which is more than the 57% it gave up here.
      {
        id: 'raid_prepared',
        label: 'Take a beast trophy (2 gold)',
        cost: 2,
        outcome: { kind: 'cardChoice', filter: [{ weapons: ['beast'] }], tier: 'bronze' },
      },
      { id: 'leave_it', label: 'Leave the nest be', outcome: { kind: 'nothing' } },
    ],
  },

  // ---- RECRUIT ----
  {
    id: 'sellsword_camp',
    title: 'Sellsword Camp',
    theme: 'recruit',
    body: 'A ring of tents and cookfires along the Muster Road marks a sellsword company between contracts. Their captain sizes you up and waves at the camp: the axes stand in their own rack by the mess tent, company-issue and nothing but axes, while the armory tent behind it is steel of every make thrown in together. Or, if you\'d rather not linger, a coin for the road.',
    choices: [
      // THE AXE DOOR — added beside the armory, which keeps its old
      // five-weapon mixed pool for the four weapons the rack doesn't serve.
      {
        id: 'browse_axes',
        label: 'Borrow from the axe rack',
        outcome: { kind: 'bonusDraft', filter: [{ weapons: ['axe'] }] },
      },
      {
        id: 'browse_armory',
        label: 'Browse the mixed armory tent',
        outcome: { kind: 'bonusDraft', filter: [{ weapons: ['sword', 'axe', 'lance', 'bow', 'beast'] }] },
      },
      { id: 'take_coin', label: 'Take a coin for the road', outcome: { kind: 'grantGold', amount: 2 } },
    ],
  },
  {
    id: 'circle_of_adepts',
    title: 'Circle of Adepts',
    theme: 'recruit',
    body: "Camped along the Muster Road, a circle of robed scholars debates arcane theory beneath a floating lattice of light. Two of their books are single-discipline and copied clean — one fire-work cover to cover, one lightning-work — and the third is the working grimoire, every discipline they practise jammed in together in no order at all. Copy from whichever you like; they're too deep in the argument to care.",
    choices: [
      // THE FIRE DOOR and THE LIGHTNING DOOR, beside the grimoire, which
      // keeps the old `properties: ['magical']` pool (67 cards, all six
      // elements at ~15-18% apiece) for the four elements the two clean books
      // don't cover. This event's old `take_coin` gave up its slot for them:
      // three cost-0 choices, all of them cards, and its recruit-theme
      // siblings (`recruiter`, `sellsword_camp`) both still offer coin.
      {
        id: 'copy_fire',
        label: 'Copy from the fire book',
        outcome: { kind: 'bonusDraft', filter: [{ elements: ['fire'] }] },
      },
      {
        id: 'copy_lightning',
        label: 'Copy from the lightning book',
        outcome: { kind: 'bonusDraft', filter: [{ elements: ['lightning'] }] },
      },
      {
        id: 'leaf_through',
        label: 'Leaf through the mixed grimoire',
        outcome: { kind: 'bonusDraft', filter: [{ properties: ['magical'] }] },
      },
    ],
  },
  {
    id: 'field_medic',
    title: 'Field Medic',
    theme: 'recruit',
    body: 'A field medic has set up a triage tent at the roadside among the Muster Road\'s camps. Her herb satchel is sorted and green to the last cutting — nature work, all of it — while the rest of the tent is whatever keeps people upright: salves, wraps, mending songs, half-taught steadying tricks. Or, if none of it is what you need, she\'ll simply spare a little coin instead.',
    choices: [
      // THE NATURE DOOR, beside the tent's old healing/support pool — 29
      // cards spread over NINE types, the widest scatter-per-card in the
      // catalog, and still the only event surface aimed at keeping a party
      // alive rather than at a type.
      {
        id: 'herb_satchel',
        label: 'Take from her nature satchel',
        outcome: { kind: 'bonusDraft', filter: [{ elements: ['nature'] }] },
      },
      {
        id: 'learn_remedies',
        label: 'Learn her mending remedies',
        outcome: { kind: 'bonusDraft', filter: [{ archetypes: ['healing', 'support'] }] },
      },
      { id: 'take_coin', label: 'Take the coin instead', outcome: { kind: 'grantGold', amount: 2 } },
    ],
  },

  // ---- FORGE ----
  {
    id: 'wandering_smith',
    title: 'Wandering Smith',
    theme: 'forge',
    body: 'Deep in the Cinderworks, a traveling smith works an anvil under a lean-to, hammer still ringing from the last commission. "Four gold," she grunts, "and I\'ll temper a blade proper — not the bronze rubbish you find lying about." Two gold, and you can have your pick of the pike-blanks stacked against the lean-to instead; she forges nothing else on spec, so lance-work is all that stack has ever been. Anything less, and she won\'t bother lighting the forge.',
    choices: [
      {
        id: 'commission',
        label: 'Pay 4 gold for a properly tempered blade',
        cost: 4,
        outcome: { kind: 'grantCard', cardId: 'armor_break', tier: 'silver' },
      },
      // THE LANCE DOOR (2026-08-26 P19/P22 pass — see the header). Nothing
      // was taken away for it: this event had one real choice and a "walk
      // on", and at 4 gold `hasAffordableChoice` skipped it outright for a
      // player under that — the 2-gold rung makes the forge reachable as well
      // as legible.
      {
        id: 'pike_blanks',
        label: 'Pick a lance-blank from the stack (2 gold)',
        cost: 2,
        outcome: { kind: 'bonusDraft', filter: [{ weapons: ['lance'] }] },
      },
      { id: 'decline', label: 'Walk on', outcome: { kind: 'nothing' } },
    ],
  },
  {
    id: 'ruined_anvil',
    title: 'Ruined Anvil',
    theme: 'forge',
    body: 'One of the Cinderworks\' many forges stands half-collapsed and long abandoned, its anvil cracked but still serviceable. A rough blade sits cooling on the workbench, yours for the taking — or, for three gold toward proper tools, you could retemper it into something sturdier before you go. The anvil will still take a heavier job for nothing: lay three pieces of the SAME grade across it and they beat down into one piece of the next grade up, and the scrap left over decides which three you get to pick from.',
    choices: [
      { id: 'take_rough', label: 'Take the rough blade as-is', outcome: { kind: 'grantCard', cardId: 'sword_slash', tier: 'bronze' } },
      {
        id: 'retemper',
        label: 'Pay 3 gold to retemper it',
        cost: 3,
        outcome: { kind: 'grantCard', cardId: 'sword_slash', tier: 'silver' },
      },
      // THE MERGE DOOR (2026-08-26). Added to an event that was ALREADY
      // eligible at every gold (`take_rough` is a cost-0, non-`nothing`
      // choice), and priced at 0 gold, so `hasAffordableChoice` returns
      // exactly what it returned before for every event at every wallet — the
      // event DRAW is byte-identical to before this pass, which is why no
      // seeded event sequence anywhere in the suite moves. The three cards ARE
      // the price; charging gold on top would be a second toll on a trade the
      // player already pays for out of the only currency that is scarce here
      // (board and bag slots).
      { id: 'beat_together', label: 'Beat three matched pieces into one', outcome: { kind: 'mergeCards' } },
    ],
  },

  // ---- MARKET ----
  {
    id: 'toll_bridge',
    title: 'Toll Bridge',
    theme: 'market',
    body: 'A rickety toll bridge spans the worst of the Tolling Road\'s ravines, where the spray off the melt below freezes onto the ropes before it lands. Its keeper wants coin before he\'ll lower the gate, and he has two crates behind him: one is frost-work to the last piece, taken off the traders coming down from the pass, and the other is a jumble of whatever else he has confiscated, all of it made for hitting things. Refuse, and there\'s a longer, drier road around.',
    choices: [
      // THE FROST DOOR, added beside the old confiscated-goods pool
      // (`archetypes: ['offense']` — 94 cards over all eleven types), which
      // keeps every one of its cards and now says on the button that it is a
      // jumble. Both crates are the same outcome kind at the same price, so
      // the only thing the player is choosing between is CATEGORY: a
      // guaranteed element or the wide pile. (`pay_toll` moved cardChoice ->
      // bonusDraft to match its new sibling's width, and `crossroads_shrine`'s
      // `moon_rite` moved the other way, so the catalog's cardChoice count is
      // exactly what it was.)
      {
        id: 'frost_crate',
        label: 'Pay the toll, take the frost crate (2 gold)',
        cost: 2,
        outcome: { kind: 'bonusDraft', filter: [{ elements: ['frost'] }] },
      },
      {
        id: 'pay_toll',
        label: 'Pay the toll, take the mixed crate (2 gold)',
        cost: 2,
        outcome: { kind: 'bonusDraft', filter: [{ archetypes: ['offense'] }] },
      },
      { id: 'go_around', label: 'Take the long way around', outcome: { kind: 'nothing' } },
    ],
  },
  {
    id: 'fences_offer',
    title: "Fence's Offer",
    theme: 'market',
    body: 'A fence works a folding table at the shadowed edge of the Tolling Road, goods of dubious origin spread out under a stained cloth. "Coin, or a stone — your pick, no questions asked either way." She taps the table, already bored with the transaction.',
    choices: [
      { id: 'take_coin', label: 'Take the coin', outcome: { kind: 'grantGold', amount: 2 } },
      // Repriced 0 -> 1 gold (`take_coin` above stays the event's free exit,
      // so the safe-choice invariant holds) — see the arithmetic note near
      // `EVENT_CHOICE_SIZE` in src/run/events.ts.
      { id: 'take_stone', label: 'Take the stone instead (1 gold)', cost: 1, outcome: { kind: 'gemChoice' } },
    ],
  },

  // ==========================================================================
  // Story-forward batch (2026-08-04, +8 events) — deepens the thinnest themes
  // (forge/omen/market) and introduces `upgradeCard`: three Cinderworks events
  // let the player re-temper an owned card in place instead of only ever
  // drawing a fresh one. See the `upgradeCard` doc comment above for the
  // deterministic (no-picker) targeting rule the resolver applies.
  // ==========================================================================

  // ---- FORGE (upgradeCard) ----
  {
    id: 'cinderworks_regrind',
    title: 'The Regrinding Wheel',
    theme: 'forge',
    body: "Deep in the Cinderworks a bent-backed smith works a stone wheel taller than she is, sparks arcing in long white ribbons. \"Five gold,\" she says without looking up, \"and I'll regrind your gear into something properly better.\" Watch instead, and she won't even blink.",
    choices: [
      { id: 'regrind', label: 'Pay 5 gold to regrind your gear', cost: 5, outcome: { kind: 'upgradeCard' } },
      { id: 'watch', label: 'Just watch, and walk on', outcome: { kind: 'nothing' } },
    ],
  },
  {
    id: 'ember_pit',
    title: 'The Ember Pit',
    theme: 'forge',
    body: "A pit of banked coals glows at the edge of the Cinderworks, deep enough to swallow a blade whole and hand it back changed — or hand back nothing, should the fire's mood sour. Thrust your gear in free and chance it, or pay the tender two gold for a safer cinder-gem instead. Three pieces of one grade, fed together, come back out as a single piece of the grade above — the tender lays out three the coals will take, and you choose.",
    choices: [
      // No RNG on rewards (USER-LOCKED): the free choice always grants a
      // small guaranteed reward. The paid choice was ALREADY a guaranteed
      // gem, unrelated to the gamble's own (now-discarded) upgradeCard
      // winning branch — it stays exactly as it was.
      { id: 'reach_in', label: 'Thrust your gear into the coals', outcome: { kind: 'grantGold', amount: 1 } },
      { id: 'pay_tender', label: 'Pay 2 gold to steady the coals first', cost: 2, outcome: { kind: 'gemChoice' } },
      // The second merge door — same zero-perturbation rule as
      // `ruined_anvil/beat_together` above (`reach_in` already made this event
      // eligible at every gold, and this rung is cost 0, so the event draw is
      // unchanged). TWO doors, not one, and the count was MEASURED rather than
      // guessed: walked over the real run layer to wave 10 at 120 seeds, one
      // door alone reached only 64.2% of runs and fired 0.68 merges per run —
      // the forge theme bag is 6 events deep, so a single door is a coin-flip
      // whether the run ever meets it. Both doors: 83.3% of runs and 1.32
      // merges. An event a third of runs never see is a mechanic that was not
      // built. See `tests/run/cardMerge.test.ts` for the walk.
      { id: 'feed_the_coals', label: 'Feed three matched pieces to the coals', outcome: { kind: 'mergeCards' } },
    ],
  },
  {
    id: 'retiring_smith',
    title: "The Smith's Last Commission",
    theme: 'forge',
    body: "At the Cinderworks' last working forge, an old smith banks her fire for good, hammer half-wrapped in oilcloth already. \"Six gold,\" she offers, \"for one more piece done right before I go.\" Decline, and she'll finish wrapping her tools and vanish into the dusk without you.",
    choices: [
      { id: 'commission', label: 'Pay 6 gold for one last commission', cost: 6, outcome: { kind: 'upgradeCard' } },
      { id: 'let_her_go', label: 'Let her go', outcome: { kind: 'nothing' } },
    ],
  },

  // ---- OMEN ----
  {
    id: 'fortune_teller',
    title: 'The Fortune-Teller',
    theme: 'omen',
    body: "A veiled fortune-teller crouches at the crossroads shrine, cards fanned across a cracked marble slab, and offers a free reading of what's coming — the shrine only asks you trust what it shows. Cross her palm with silver instead, and she presses a smooth luck-stone into your hand.",
    choices: [
      // No RNG on rewards (USER-LOCKED): the free choice always grants a
      // small guaranteed reward. The paid choice was ALREADY a guaranteed
      // gem, unrelated to the gamble's own (now-discarded) grantLevel winning
      // branch — it stays exactly as it was.
      { id: 'free_reading', label: 'Take the free reading', outcome: { kind: 'grantGold', amount: 1 } },
      { id: 'cross_palm', label: 'Cross her palm with 2 gold', cost: 2, outcome: { kind: 'gemChoice' } },
    ],
  },
  {
    id: 'weighing_stone',
    title: 'The Weighing Stone',
    theme: 'omen',
    body: "A black basalt stone squats at the crossroads' heart, said to weigh a traveler's resolve at a glance. Press your palm to it and it may show a glimpse of arms you'll carry — or leave your hand simply cold. Others just skirt around it, unwilling to let a stone judge them.",
    choices: [
      // No RNG on rewards (USER-LOCKED): the free choice always grants a
      // small guaranteed reward; a new paid choice guarantees the old
      // gamble's winning outcome (a mini-draft) at the catalog level-up rate.
      { id: 'press_palm', label: 'Press your palm to the stone', outcome: { kind: 'grantGold', amount: 1 } },
      {
        id: 'press_harder',
        label: 'Press harder and hold (2 gold)',
        cost: 2,
        outcome: { kind: 'bonusDraft' },
      },
      { id: 'skirt_around', label: 'Skirt around it', outcome: { kind: 'nothing' } },
    ],
  },
  {
    id: 'two_ravens',
    title: 'Two Ravens',
    theme: 'omen',
    body: 'Two ravens perch unnervingly still on the crossroads shrine\'s arms, and old omen-readers swear feeding them buys good fortune while ignoring them buys nothing at all. Toss them your scraps for a coin\'s trouble, or walk the long way around and let them watch you go.',
    choices: [
      // No RNG on rewards (USER-LOCKED). A guaranteed gem at the OLD 1-gold
      // price would be strictly better than every other "2g -> gem" event in
      // the catalog (gemsellers_mishap/ember_pit/fortune_teller/
      // collapsed_barrow/broken_axle all charge 2 for the same guaranteed
      // gem) — this is the one deliberate price change the ruling calls for,
      // bumping the cost to 2 to match the catalog rate instead of
      // underselling every sibling event.
      { id: 'feed_them', label: 'Toss them your scraps (2 gold)', cost: 2, outcome: { kind: 'gemChoice' } },
      { id: 'walk_around', label: 'Walk the long way around, coin still in your pocket', outcome: { kind: 'nothing' } },
    ],
  },

  // ---- MARKET ----
  {
    id: 'toll_collectors_ledger',
    title: "The Toll Collector's Ledger",
    theme: 'market',
    body: "A toll collector flags you down on the Tolling Road, ledger open, insisting a road tax is overdue for the wear you've caused passing through. Pay it and he waves you past with a stone from his confiscated crate — refuse, and he shrugs, scrawls something illegible, and lets you walk on regardless.",
    choices: [
      { id: 'pay_tax', label: 'Pay the 2-gold road tax', cost: 2, outcome: { kind: 'gemChoice' } },
      { id: 'refuse', label: 'Refuse to pay', outcome: { kind: 'nothing' } },
    ],
  },
  {
    id: 'broken_axle',
    title: 'The Broken Axle',
    theme: 'market',
    body: "A cart lies overturned on the Tolling Road, axle snapped clean through, goods scattered across the ruts. The driver begs anyone passing for a shoulder to right it, promising whatever thanks the wreck still holds — or, if you'd rather not strain yourself, just leave him to sort it out alone.",
    choices: [
      // No RNG on rewards (USER-LOCKED): the free choice always grants a
      // small guaranteed reward; a new paid choice guarantees the old
      // gamble's winning outcome at the catalog gem rate.
      { id: 'help_haul', label: 'Help haul the cart upright', outcome: { kind: 'grantGold', amount: 1 } },
      {
        id: 'salvage_properly',
        label: 'Stay and salvage the wreckage properly (2 gold)',
        cost: 2,
        outcome: { kind: 'gemChoice' },
      },
      { id: 'leave_him', label: 'Leave him to it', outcome: { kind: 'nothing' } },
    ],
  },

  // ==========================================================================
  // New-mechanics batch (2026-08-19, +4 events) — the catalog predated splash,
  // the 4-rung expose gem ladder, ward/cleanse/taunt utility gems, and the
  // poison/thorns/ward hybrid lanes; none of it was ever surfaced through an
  // event. `CardFilter` has no action-kind axis (only `GemFilter` does — see
  // the doc comment at the top of `shopTypes.ts`), so the two card-choice
  // events below reach for the closest existing property/weapon/archetype
  // axis instead of a literal "poison"/"thorns" tag — same approximation the
  // rest of this catalog already leans on (e.g. `sparring_circle`'s
  // "offense"-tagged "spare blade" isn't literally a sellsword's inventory
  // either). Match counts verified against the live skill/gem book at
  // authoring time (content-designer, all comfortably clear of
  // `EVENT_CHOICE_SIZE` = 3): `archetypes: ['defensive']` = 33 cards,
  // `archetypes: ['debuff']` = 37 cards, `weapons: ['axe','lance'],
  // archetypes: ['offense']` = 15 cards, gem `actionKinds: ['ward','cleanse',
  // 'taunt']` = 3 gems (sanctuary_sliver/renewal_sliver/provoker_sliver — the
  // WHOLE utility trio, one apiece), gem `actionKinds: ['expose']` = 4 gems
  // (vulnerability_sliver/weak_point_sliver/exposed_nerve_sliver/
  // raw_nerve_sliver — the full 4-rung ladder; the top rung is Legendary and
  // depth-gated out below wave 2, leaving exactly 3 eligible at wave 1 — still
  // clears the floor). No new card/gem content and no resolver changes; pure
  // catalog additions over the existing `cardChoice`/`gemChoice`/`grantGold`/
  // `nothing` vocabulary.
  // ==========================================================================

  {
    id: 'thorn_garden_shrine',
    title: 'The Thorn Garden Shrine',
    theme: 'cache',
    body: "Deep in the Silt Hollows, a shrine has vanished beneath a decade of bramble growth, thorned vines lashed so thick across the stone that whatever it once honored is anyone's guess. What the tangle has swallowed is all armor-work — wards, guards, thorn-mail, nothing that hits back — worth the scratches, if you're willing to push through for it.",
    choices: [
      { id: 'gather_thorns', label: 'Gather the fallen thorns at the edge', outcome: { kind: 'grantGold', amount: 1 } },
      {
        id: 'push_through',
        label: 'Push through the brambles (2 gold)',
        cost: 2,
        outcome: { kind: 'cardChoice', filter: [{ archetypes: ['defensive'] }], tier: 'bronze' },
      },
      { id: 'leave_it', label: 'Leave the shrine to the thorns', outcome: { kind: 'nothing' } },
    ],
  },
  {
    id: 'venomers_den',
    title: "The Venomer's Den",
    theme: 'recruit',
    body: 'Off the Muster Road, half-hidden behind a curtain of hanging roots, a venomer keeps her still and her jars in careful rows, breath sharp with something that isn\'t quite smoke. "The weak batch is yours for nothing," she says, nodding at a dull green vial, "or two gold buys off the real shelf. Every jar on it does the one job — leaves whatever you use it on worse off than it started. Past that I make no promises about what\'s in the glass."',
    choices: [
      { id: 'weak_batch', label: 'Take the weak batch for free', outcome: { kind: 'grantGold', amount: 1 } },
      {
        id: 'true_batch',
        label: 'Pay 2 gold for what she actually sells',
        cost: 2,
        outcome: { kind: 'cardChoice', filter: [{ archetypes: ['debuff'] }], tier: 'bronze' },
      },
    ],
  },
  {
    id: 'the_lapidary',
    title: 'The Lapidary',
    theme: 'forge',
    body: 'A lapidary has set up her wheel at the quiet end of the Cinderworks, trays of uncut facets sorted by what they promise rather than what they cost: a warding cut here, a cleansing cut there, a taunting cut that seems to want attention paid to it just for existing. "Reject bin\'s free to pick through," she says, without looking up, "and if you\'ve got a stone you\'re done carrying, I\'ll take it off your hands too — fair price, no haggling." The good tray, though, isn\'t free.',
    choices: [
      { id: 'reject_bin', label: 'Pick through the reject bin', outcome: { kind: 'grantGold', amount: 1 } },
      {
        id: 'warding_cut',
        label: 'Pay 2 gold for a warding cut',
        cost: 2,
        outcome: { kind: 'gemChoice', filter: [{ actionKinds: ['ward', 'cleanse', 'taunt'] }] },
      },
      // `sellGem` (2026-08-20, parked-capability build — see the
      // `EventOutcomeSpec` doc comment above): replaces the old
      // `cutting_cut` (expose-filtered `gemChoice`) choice, which stayed a
      // 2-3-choice-bound casualty — the expose ladder it drew from
      // (vulnerability/weak_point/exposed_nerve/raw_nerve_sliver) is still
      // reachable via the Armory shop's gem shelf (see
      // `tests/run/contentReachability.test.ts`), so this trade doesn't strand
      // any gem. Cost 0 (selling nets gold, it doesn't cost an upfront toll)
      // — a SECOND cost-0 choice alongside `reject_bin` in this event, which
      // is fine: the catalog's "genuinely safe exit" invariant only requires
      // AT LEAST one (see `recruiter`/`sellsword_camp`, which already have
      // two cost-0 choices apiece).
      {
        id: 'sell_facet',
        label: "Sell her a facet you're not using",
        outcome: { kind: 'sellGem' },
      },
    ],
  },
  {
    // DEFECT FIX (content-designer, 2026-08-19, adversarial audit of this
    // batch): `proper_stance` used to be a `cardChoice` filtered on
    // `{weapons:['axe','lance'], archetypes:['offense']}`, a 15-card pool of
    // which exactly ONE (`shockwave_slam`) actually carries splash — so the
    // body's "newer recruits call it splash" promise paid off for ~7% of
    // pulls. Converted to a NAMED grant of `shockwave_slam` itself: the
    // instructor is teaching one specific, named technique (same "signature
    // move" shape as `veterans_last_lesson`'s `crushing_blow` and
    // `wandering_smith`'s `armor_break`), so the reward now matches the
    // promise on every pull instead of most of the time missing it. Cost
    // stays 2 gold, unchanged — already the standard price every other paid
    // `grantCard` in this catalog charges for one guaranteed bronze-tier
    // pick (see `EVENT_CHOICE_SIZE`'s pricing-arithmetic comment in
    // src/run/events.ts), and `shockwave_slam` is bronze tier already.
    id: 'sweep_drill',
    title: 'The Sweep Drill',
    theme: 'training',
    body: 'A grizzled instructor has cordoned off a stretch of the Hollow Yard for wide, sweeping cuts alone — the kind that catch whatever\'s standing next to your actual target, whether you meant it to or not. "Newer recruits call it splash," she snorts, resting a training axe on her shoulder. "I call it not missing twice. Two gold, and I\'ll teach you the sweep itself."',
    choices: [
      {
        id: 'proper_stance',
        label: 'Pay 2 gold to learn the sweep',
        cost: 2,
        outcome: { kind: 'grantCard', cardId: 'shockwave_slam', tier: 'bronze' },
      },
      { id: 'scavenge', label: 'Scavenge the practice yard for scraps', outcome: { kind: 'grantGold', amount: 1 } },
      { id: 'skip', label: 'Skip the drill', outcome: { kind: 'nothing' } },
    ],
  },

  // ==========================================================================
  // Event-chain batch (2026-09-02, +7 events) — the run's past becomes doors
  // (see the EVENT CHAINS block above for the gate mechanism and the
  // no-bag/priority-draw delivery rule). FOUR are GATED (`tutors_return`,
  // `the_reckoning`, `factors_ledger`, `pyre_watch`) and never enter a bag —
  // ZERO seeded-sequence movement until a gate opens
  // (`tests/run/events.chains.test.ts` pins the training/omen/forge sequences
  // byte-for-byte against the pre-batch catalog). THREE are ordinary UNGATED
  // additions (`the_lands_measure` cache 6->7, `flaw_finder` market 5->6,
  // `banner_scribe` recruit 5->6) and reshuffle exactly those three theme
  // bags — the same class of movement as the 2026-07-29 +12 batch.
  //
  // Every chain here is a RECOGNITION or TALLY shape: full value was paid at
  // the setup, so a run whose road never reaches the payoff has lost nothing
  // (the loan shape — value now, cost at an event the map may never deal — is
  // banned; see the gambler's own loseGold history for why).
  //
  // Supply walk re-run with the batch in (same harness as the P19 pass,
  // tests/run/eventRewardDoors.test.ts, 24 seeds x 11 types to wave 10):
  // label-readers keep 2.76 same-type cards per run vs 1.56 ignoring them
  // (the P19 gap holds), events alone hand over an identity in 51% of runs,
  // shut-outs stay at 4%. Movement vs the pass's 60-seed numbers (2.91/1.67/
  // 56%/4%) is the three reshuffled bags plus market gaining two non-card
  // doors — every floor that file pins stayed green unchanged.
  // ==========================================================================

  {
    // THE RECOGNITION CHAIN. Setup: `wandering_tutor/pay` (2g grantLevel),
    // whose shipped body already plants the hook ("it won't be forgotten,
    // either") — the setup event changes by zero bytes. The payoff is the
    // second half of the lesson, free where the catalog charges 2 — bounded
    // by once-per-run (priority draw + eventInstances) and by the 2 gold
    // already paid at the setup. `finish_lesson` is cost-0 and non-`nothing`,
    // so the event is eligible at ANY gold the moment the gate opens: it
    // fires at the very next training node.
    id: 'tutors_return',
    title: "The Tutor's Return",
    theme: 'training',
    requires: { eventId: 'wandering_tutor', choiceIds: ['pay'] },
    body: 'You know the gnarled staff before you know the face: the old sellsword from the Hollow Yard, planted at the edge of the practice ring as if the two of you had set an appointment. "You paid for a lesson," she says. "You got half of one. I don\'t leave debts standing — mine or anybody\'s." The second half won\'t cost you a coin. Her sparring circle, though, still charges for the privilege.',
    choices: [
      { id: 'finish_lesson', label: 'Take the second half of the lesson', outcome: { kind: 'grantLevel' } },
      // Catalog-rate paid sibling: 2g bonusDraft, the exact price/width of
      // weighing_stone/press_harder. No undercut of any paid door.
      { id: 'spar_the_yard', label: 'Spar with her circle (2 gold)', cost: 2, outcome: { kind: 'bonusDraft' } },
      { id: 'part_ways', label: 'Tell her the debt is settled', outcome: { kind: 'nothing' } },
    ],
  },
  {
    // THE TALLY CHAIN over the shrine's two faces. The event gate opens for a
    // player who honored EITHER face; each settlement rung is lit only by ITS
    // face's resolution, so a both-faces run sees both lit and must CHOOSE
    // which devotion pays — the tally rendered as agency, not as a computed
    // reward. Defacing the shrine deliberately does NOT summon it: scrap is
    // scrap. Each settlement is the shrine's own paid 3-wide door upgraded to
    // a FREE 5-wide one — same 100%-type discipline (P19), bigger because it
    // is the payoff of a 2-gold investment made at the setup (free
    // single-type bonusDrafts are an established shape: recruiter/pick_sword).
    // Labels name their type ("holy work" / "dark work") — the guaranteed-door
    // honesty lint in tests/run/eventRewardDoors.test.ts requires it.
    id: 'the_reckoning',
    title: 'The Reckoning',
    theme: 'omen',
    requires: { eventId: 'crossroads_shrine', choiceIds: ['tithe', 'moon_rite'] },
    body: 'The shrine finds you, this time. A cairn of crossroads stone stands where no cairn stood yesterday, sun-mark and moon-mark cut fresh into its face — and beneath them, in scratches you never made, a tally of everything you ever left at the Crossroads Unquiet. Whatever keeps the shrine\'s accounts has ruled your devotion paid up, and tonight it settles its side of the ledger.',
    choices: [
      {
        id: 'sun_road',
        label: "Take the sun's settlement in holy work",
        requires: { eventId: 'crossroads_shrine', choiceIds: ['tithe'] },
        outcome: { kind: 'bonusDraft', filter: [{ elements: ['holy'] }] },
      },
      {
        id: 'moon_road',
        label: "Take the moon's settlement in dark work",
        requires: { eventId: 'crossroads_shrine', choiceIds: ['moon_rite'] },
        outcome: { kind: 'bonusDraft', filter: [{ elements: ['dark'] }] },
      },
      { id: 'keep_walking', label: 'Leave the account open', outcome: { kind: 'nothing' } },
    ],
  },
  {
    // THE BIOME-AWARE DOORS (UNGATED — an ordinary cache-bag resident): one
    // door matched to the band's lean (build WITH the land), one to its
    // counter (build AGAINST what lives here — "the counter farms it",
    // run/biome.ts). Both pools are derived at resolve time via `filterFrom`
    // (see FilterFromSource above), so a static label cannot name the type —
    // the body promises LOCALITY, which the pool delivers at 100%, and the
    // band banner on screen names the lean (the honesty rule applied to a
    // derived category). `hunters_edge` is DARK on the one band with no
    // counter (the Arrowfell — nothing counters bow), which teaches that fact
    // a third way beside the biome data and the forecast.
    id: 'the_lands_measure',
    title: "The Land's Measure",
    theme: 'cache',
    body: 'A surveyor\'s drop-box juts from the mud of the Silt Hollows, stenciled with the mark of whatever country you are crossing. The locals cache what the land makes, and any land worth naming only makes one thing well — the box is local work to the last piece. Lashed underneath it rides a hunter\'s kit, picked to hurt what lives here. When anything can.',
    choices: [
      // Both doors at the shrine-door rate (2g cardChoice).
      { id: 'local_make', label: 'Take the local make (2 gold)', cost: 2, outcome: { kind: 'cardChoice', filterFrom: 'biomeLean', tier: 'bronze' } },
      { id: 'hunters_edge', label: "Take the hunter's kit (2 gold)", cost: 2, outcome: { kind: 'cardChoice', filterFrom: 'biomeCounter', tier: 'bronze' } },
      // Safe exit — cost-0 grant, the gemsellers_mishap precedent.
      { id: 'gather_stones', label: 'Pocket the loose stones', outcome: { kind: 'grantGold', amount: 1 } },
    ],
  },
  {
    // THE SPEND-TALLY CHAIN. The run records no purchase provenance
    // (shopShelves keeps remaining offers only), so the chain reads the one
    // thing every spend site already maintains: `stats.goldSpent` — shop
    // buys, rerolls, event tolls alike, which is why the body says "stalls
    // and tolls" (the honesty rule applied to a counter). 12g is roughly two
    // waves of income: it opens mid-run for a spender and never for a
    // hoarder. The credit is a free gemChoice where the catalog rate is 2g —
    // deliberate, bounded generosity: once per run, gated behind 12g of REAL
    // prior spend, so the free tier cannot be farmed and cannot be reached
    // without out-spending every paid sibling first.
    id: 'factors_ledger',
    title: "The Factor's Ledger",
    theme: 'market',
    requiresTally: { stat: 'goldSpent', atLeast: 12 },
    body: 'A trade factor steps into the road with a ledger already open to your page. "Twelve gold and change, through the stalls and tolls of this road, by my count," she says, turning the book so you can see the tally — and it is your tally, coin for coin. "The road pays its regulars. One credit, one time. Spend it or tear the page."',
    choices: [
      { id: 'standing_credit', label: 'Take your standing credit', outcome: { kind: 'gemChoice' } },
      // Catalog-rate paid sibling (abandoned_cache/search_thoroughly).
      { id: 'bulk_order', label: 'Place a bulk order (2 gold)', cost: 2, outcome: { kind: 'cardChoice', tier: 'bronze' } },
      { id: 'tear_the_page', label: 'Tear your page out', outcome: { kind: 'nothing' } },
    ],
  },
  {
    // THE DEFEAT CHAIN. `stats.livesLost` is written by the exact transition
    // that resolves every fight (recordBattleResult), so this event exists
    // only in a run that has LOST one — the run's first defeat becomes a
    // place on the road, which is the cheapest "choices matter later" the
    // game can buy. The gate IS the telegraph: the player just watched the
    // life counter drop. Alms at the standing free-coin rate x2
    // (recruiter/take_coin grants 2) — cost-0 and non-`nothing`, so the event
    // fires at the next omen node regardless of wallet.
    id: 'pyre_watch',
    title: 'The Pyre-Watch',
    theme: 'omen',
    requiresTally: { stat: 'livesLost', atLeast: 1 },
    body: 'A watch-fire burns at the crossroads for the road\'s dead, tended by a hooded keeper who does not ask whose name you are carrying. The fire already knows: you left a life on a field behind you, and the pyre-watch keeps the old custom for anyone who limps past it — alms for the mourner, or arms for the living.',
    choices: [
      { id: 'alms', label: "Accept the mourner's alms", outcome: { kind: 'grantGold', amount: 2 } },
      // THE ARMOR DOOR at the 2g rate — same pool/price as
      // thorn_garden_shrine/push_through (defensive pool, 33+ cards).
      { id: 'arm_the_living', label: 'Buy arms for the living (2 gold)', cost: 2, outcome: { kind: 'cardChoice', filter: [{ archetypes: ['defensive'] }], tier: 'bronze' } },
      { id: 'let_it_burn', label: 'Let it burn, and walk on', outcome: { kind: 'nothing' } },
    ],
  },
  {
    // PURE CATALOG CONTENT (UNGATED), closing two measured gem-surface gaps
    // at once: the 4-rung EXPOSE gem ladder lost its event door when
    // the_lapidary's `cutting_cut` was traded for `sellGem` under the
    // 3-choice bound (shop-only ever since), and `sellGem` itself had exactly
    // ONE catalog surface — and the project's own merge-door measurement says
    // a single door is a coin flip (one door = 64.2% of runs, two = 83.3%).
    // The lapidary is forge; this is her market twin. Expose pool = 4 gems
    // >= EVENT_CHOICE_SIZE (at wave 1 the Legendary top rung is depth-gated
    // out leaving exactly 3 — clears the floor, same note as the 2026-08-19
    // batch header).
    id: 'flaw_finder',
    title: 'The Flaw-Finder',
    theme: 'market',
    body: 'A jeweler\'s loupe glints from a stall no wider than its own strongbox on the Tolling Road. "Every stone has a flaw," its owner says, not as an apology — her whole tray is cut to FIND them, facets ground to open a weakness and hold it open. She buys as readily as she sells, if you are carrying a stone you are done with.',
    choices: [
      { id: 'expose_tray', label: 'Buy from the flaw-cut tray (2 gold)', cost: 2, outcome: { kind: 'gemChoice', filter: [{ actionKinds: ['expose'] }] } },
      // THE SECOND sellGem SURFACE — priced/gated by machinery that already
      // exists end-to-end (sellPriceOfGem pricing, the empty-pouch dark-rung
      // gate in isEventChoiceUsable, picker + finalizer all shipped). At
      // gold < 2 with an empty pouch the event is simply skipped by
      // hasAffordableChoice and stays in the bag — the normal affordability
      // dance, same as the gambler at gold < 2.
      { id: 'sell_flawed', label: 'Sell her a stone of your own', outcome: { kind: 'sellGem' } },
      { id: 'walk_on', label: 'Keep your flaws to yourself', outcome: { kind: 'nothing' } },
    ],
  },
  {
    // THE IDENTITY DOOR (UNGATED) — the direct P19 extension: a door that is
    // the player's OWN committed type, every time it appears. Pool derived at
    // resolve time from `boardTypeIdentity` (board pieces only, matching the
    // combat fold's read — see FilterFromSource above); DARK until the board
    // holds 3-of-a-kind, the mergeCards dark-rung idiom, which itself teaches
    // the threshold. A Deck/Bag detour between resolve and pick re-derives
    // against the board as it stands — the same documented class as
    // upgradeCard/mergeCards re-derivation.
    id: 'banner_scribe',
    title: 'The Banner-Scribe',
    theme: 'recruit',
    body: 'A banner-scribe has set her table among the Muster Road\'s camps, reading fighters\' colors off their gear the way other scribes read letters. One look over your board and she is already mixing paint: if you march under a device, she knows a supplier for it — and if you march under none, she will still pay a copper for the sketch.',
    choices: [
      { id: 'blazon', label: 'Commission gear in your colors (2 gold)', cost: 2, outcome: { kind: 'cardChoice', filterFrom: 'boardIdentity', tier: 'bronze' } },
      // She pays for the sketch — the standard free-coin rung, and the choice
      // that keeps the event eligible at gold 0 with no identity.
      { id: 'sketch_fee', label: 'Let her sketch your kit for a copper', outcome: { kind: 'grantGold', amount: 1 } },
      { id: 'keep_marching', label: 'March on unblazoned', outcome: { kind: 'nothing' } },
    ],
  },
];

export const eventCatalog: Record<string, EventDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

/** Deterministic bag/display order. */
export const eventCatalogIds: readonly string[] = defs.map((d) => d.id);
