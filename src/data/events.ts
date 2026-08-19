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

import type { SkillTier } from '../engine/types';
import type { CardFilter, GemFilter } from './shopTypes';

/** Node label/icon-color grouping (docs/run-events-design.md §3b) — drives
 * display only (the map node's "EVENT · <THEME>" label + icon color), never
 * gameplay branching in the resolver. */
export type EventTheme = 'training' | 'cache' | 'recruit' | 'forge' | 'market' | 'omen';

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
  // NAMES its reward stays `grantCard`/`grantGem` (the 4 named-card grants
  // in this catalog are deliberately untouched).
  // `tier` is narrowed to `'bronze'` (not the full `SkillTier` `grantCard`
  // takes): the resolver hands this off to `bonusDraft`'s own deferred-pick
  // shape (`DraftCard`, `src/run/draft.ts`), whose `tier` field is itself
  // fixed at `'bronze'` — every existing `bonusDraft` mini-draft in this
  // catalog is bronze-only for the same reason. Every current `cardChoice`
  // conversion is bronze already, so this costs nothing today.
  | { kind: 'cardChoice'; filter?: CardFilter; tier?: 'bronze' }
  | { kind: 'gemChoice'; filter?: GemFilter }
  | { kind: 'grantGold'; amount: number }
  | { kind: 'loseGold'; amount: number }
  | { kind: 'grantLevel' }
  | { kind: 'bonusDraft'; filter?: CardFilter }
  | { kind: 'upgradeCard' }
  | { kind: 'nothing' };

export interface EventChoiceDef {
  id: string;
  /** Button label, e.g. "Pay 3 gold" / "Walk away". */
  label: string;
  /** Upfront gold cost paid before the outcome resolves (omitted/0 = free —
   * every event needs at least one cost-0 choice as its safe exit). */
  cost?: number;
  outcome: EventOutcomeSpec;
}

export interface EventDef {
  id: string;
  title: string;
  body: string;
  /** Which of the 6 event themes this node displays as (docs/run-events-design.md §3b). */
  theme: EventTheme;
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
    body: 'A weapons broker flags you down from beneath a striped awning at the roadside edge of the Muster Road, arms full of blades and bowstrings still warm from the last camp. "Pick your favorite," he grins, laying out a row of five, "or take the coin instead — I won\'t haggle either way."',
    choices: [
      {
        id: 'pick_weapon',
        label: 'Browse the weapons',
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
    body: 'At the heart of the Crossroads Unquiet stands a weathered shrine, carvings split evenly between a rising sun and a crescent moon. Pilgrims leave gold here for a blessing; others, less devout, have been known to pry it apart for scrap and take their chances with whatever hears them do it.',
    choices: [
      {
        id: 'tithe',
        label: 'Leave a tithe (2 gold)',
        cost: 2,
        outcome: { kind: 'cardChoice', filter: [{ elements: ['holy', 'dark'] }] },
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
    body: 'A merchant caravan sits axle-deep in the mud of the Tolling Road, its driver frantic as the sun sinks lower. She\'ll gladly let you rummage her overstuffed trunks for the trouble of pushing — or just toss you a coin for a shoulder at the wheel, no rummaging required.',
    choices: [
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
    body: 'A ring of packed dirt marks the heart of the Hollow Yard, worn smooth by years of practice bouts. A scarred instructor waves you over: "Two gold buys you a real lesson. Or grab a spare blade off the rack and figure it out yourself — that\'s free, and it shows."',
    choices: [
      { id: 'lesson', label: 'Pay 2 gold for a real lesson', cost: 2, outcome: { kind: 'grantLevel' } },
      // Stays cost 0 — the event's ONLY cost-0 choice (`lesson` costs 2); the
      // safe-exit invariant (docs at the top of this file) forbids repricing
      // it, unlike its `take_armor`/`take_stone` siblings below.
      {
        id: 'spare_blade',
        label: 'Take a spare blade from the rack',
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
    body: 'A tired quartermaster at the edge of the Silt Hollows shoves a requisition ledger across the counter, muttering about a shipment that was never meant to reach you. "Take the armor plating," he says, "or the loose gemstone in the corner. Don\'t care which — just take it and go before someone notices."',
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
    body: 'A trampled nest sits half-sunk in the Silt Hollows\' mud, littered with the shed claws and feathers of something large. Raiding it for a trophy weapon is tempting — if whatever built it doesn\'t come back and cost you a coin purse for the trouble.',
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
      {
        id: 'raid_prepared',
        label: 'Raid it properly, gear in hand (2 gold)',
        cost: 2,
        outcome: { kind: 'cardChoice', filter: [{ weapons: ['bow', 'beast'] }], tier: 'bronze' },
      },
      { id: 'leave_it', label: 'Leave the nest be', outcome: { kind: 'nothing' } },
    ],
  },

  // ---- RECRUIT ----
  {
    id: 'sellsword_camp',
    title: 'Sellsword Camp',
    theme: 'recruit',
    body: 'A ring of tents and cookfires along the Muster Road marks a sellsword company between contracts. Their captain sizes you up and offers a look through the company armory — steel of every make, yours to borrow a trick from — or, if you\'d rather not linger, a coin for the road.',
    choices: [
      {
        id: 'browse_armory',
        label: 'Browse the company armory',
        outcome: { kind: 'bonusDraft', filter: [{ weapons: ['sword', 'axe', 'lance', 'bow', 'beast'] }] },
      },
      { id: 'take_coin', label: 'Take a coin for the road', outcome: { kind: 'grantGold', amount: 2 } },
    ],
  },
  {
    id: 'circle_of_adepts',
    title: 'Circle of Adepts',
    theme: 'recruit',
    body: "Camped along the Muster Road, a circle of robed scholars debates arcane theory beneath a floating lattice of light. They'll happily let you leaf through a spellbook of half-finished notations — or, sensing you're not here for lectures, simply press a few coins into your hand instead.",
    choices: [
      {
        id: 'leaf_through',
        label: 'Leaf through the spellbook',
        outcome: { kind: 'bonusDraft', filter: [{ properties: ['magical'] }] },
      },
      { id: 'take_coin', label: 'Take the coins instead', outcome: { kind: 'grantGold', amount: 2 } },
    ],
  },
  {
    id: 'field_medic',
    title: 'Field Medic',
    theme: 'recruit',
    body: 'A field medic has set up a triage tent at the roadside among the Muster Road\'s camps, satchel overflowing with salves, wraps, and half-taught remedies she\'s happy to share with anyone willing to listen. Or, if healing lore isn\'t what you need, she\'ll simply spare a little coin instead.',
    choices: [
      {
        id: 'learn_remedies',
        label: 'Learn her remedies',
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
    body: 'Deep in the Cinderworks, a traveling smith works an anvil under a lean-to, hammer still ringing from the last commission. "Four gold," she grunts, "and I\'ll temper a blade proper — not the bronze rubbish you find lying about." Anything less, and she won\'t bother lighting the forge.',
    choices: [
      {
        id: 'commission',
        label: 'Pay 4 gold for a properly tempered blade',
        cost: 4,
        outcome: { kind: 'grantCard', cardId: 'armor_break', tier: 'silver' },
      },
      { id: 'decline', label: 'Walk on', outcome: { kind: 'nothing' } },
    ],
  },
  {
    id: 'ruined_anvil',
    title: 'Ruined Anvil',
    theme: 'forge',
    body: 'One of the Cinderworks\' many forges stands half-collapsed and long abandoned, its anvil cracked but still serviceable. A rough blade sits cooling on the workbench, yours for the taking — or, for three gold toward proper tools, you could retemper it into something sturdier before you go.',
    choices: [
      { id: 'take_rough', label: 'Take the rough blade as-is', outcome: { kind: 'grantCard', cardId: 'sword_slash', tier: 'bronze' } },
      {
        id: 'retemper',
        label: 'Pay 3 gold to retemper it',
        cost: 3,
        outcome: { kind: 'grantCard', cardId: 'sword_slash', tier: 'silver' },
      },
    ],
  },

  // ---- MARKET ----
  {
    id: 'toll_bridge',
    title: 'Toll Bridge',
    theme: 'market',
    body: 'A rickety toll bridge spans the worst of the Tolling Road\'s ravines, its keeper demanding coin before he\'ll lower the gate. Pay his toll and he throws in something from his cart of confiscated goods — refuse, and there\'s a longer, drier road around.',
    choices: [
      {
        id: 'pay_toll',
        label: 'Pay the 2-gold toll',
        cost: 2,
        outcome: { kind: 'cardChoice', filter: [{ archetypes: ['offense'] }], tier: 'bronze' },
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
    body: "A pit of banked coals glows at the edge of the Cinderworks, deep enough to swallow a blade whole and hand it back changed — or hand back nothing, should the fire's mood sour. Thrust your gear in free and chance it, or pay the tender two gold for a safer cinder-gem instead.",
    choices: [
      // No RNG on rewards (USER-LOCKED): the free choice always grants a
      // small guaranteed reward. The paid choice was ALREADY a guaranteed
      // gem, unrelated to the gamble's own (now-discarded) upgradeCard
      // winning branch — it stays exactly as it was.
      { id: 'reach_in', label: 'Thrust your gear into the coals', outcome: { kind: 'grantGold', amount: 1 } },
      { id: 'pay_tender', label: 'Pay 2 gold to steady the coals first', cost: 2, outcome: { kind: 'gemChoice' } },
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
    body: "Deep in the Silt Hollows, a shrine has vanished beneath a decade of bramble growth, thorned vines lashed so thick across the stone that whatever it once honored is anyone's guess. Something in the tangle glints when the light catches it right — worth the scratches, if you're willing to push through and find out.",
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
    body: 'Off the Muster Road, half-hidden behind a curtain of hanging roots, a venomer keeps her still and her jars in careful rows, breath sharp with something that isn\'t quite smoke. "The weak batch is yours for nothing," she says, nodding at a dull green vial, "or two gold buys you a taste of what I actually sell."',
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
    body: 'A lapidary has set up her wheel at the quiet end of the Cinderworks, trays of uncut facets sorted by what they promise rather than what they cost: a warding cut here, a cleansing cut there, a taunting cut that seems to want attention paid to it just for existing. Beside them, a second tray holds nothing but sharpened, cutting facets meant to lay a foe bare. "Reject bin\'s free to pick through," she says, without looking up. "The good trays aren\'t."',
    choices: [
      { id: 'reject_bin', label: 'Pick through the reject bin', outcome: { kind: 'grantGold', amount: 1 } },
      {
        id: 'warding_cut',
        label: 'Pay 2 gold for a warding cut',
        cost: 2,
        outcome: { kind: 'gemChoice', filter: [{ actionKinds: ['ward', 'cleanse', 'taunt'] }] },
      },
      {
        id: 'cutting_cut',
        label: 'Pay 2 gold for a cutting facet',
        cost: 2,
        outcome: { kind: 'gemChoice', filter: [{ actionKinds: ['expose'] }] },
      },
    ],
  },
  {
    id: 'sweep_drill',
    title: 'The Sweep Drill',
    theme: 'training',
    body: 'A grizzled instructor has cordoned off a stretch of the Hollow Yard for wide, sweeping cuts alone — the kind that catch whatever\'s standing next to your actual target, whether you meant it to or not. "Newer recruits call it splash," she snorts, resting a training axe on her shoulder. "I call it not missing twice. Two gold, and I\'ll show you the stance properly."',
    choices: [
      {
        id: 'proper_stance',
        label: 'Pay 2 gold to learn the stance properly',
        cost: 2,
        outcome: { kind: 'cardChoice', filter: [{ weapons: ['axe', 'lance'], archetypes: ['offense'] }], tier: 'bronze' },
      },
      { id: 'scavenge', label: 'Scavenge the practice yard for scraps', outcome: { kind: 'grantGold', amount: 1 } },
      { id: 'skip', label: 'Skip the drill', outcome: { kind: 'nothing' } },
    ],
  },
];

export const eventCatalog: Record<string, EventDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

/** Deterministic bag/display order. */
export const eventCatalogIds: readonly string[] = defs.map((d) => d.id);
