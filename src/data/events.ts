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
// `EventOutcomeSpec`. At most one choice per event is a `gamble` (a weighted
// table over that SAME vocabulary, minus gamble itself — no nested gambles,
// weights are integer percent and must sum to 100). Every event carries a
// genuinely SAFE choice — cost 0, and if it's a gamble, one whose worst
// branch is `nothing` — so a broke player is never soft-locked.
//
// `upgradeCard` (2026-08-04): bumps ONE already-owned card +1 tier
// (bronze->silver->gold->diamond). v1 has NO picker — the resolver
// (`src/run/events.ts#upgradeCardOutcome`) deterministically targets the
// lowest-tier eligible (non-diamond) card, preferring a board `pieces` slot
// over a bag card, tie-broken by ascending board `slot`/bag array order. If
// nothing is eligible (every owned card is diamond, or the player owns none),
// it STILL credits `CARD_FALLBACK_GOLD` but reports `{fellBack: true}` while
// staying `kind: 'upgradeCard'` (deliberately NOT re-kinded to `grantGold`
// like `grantCard`'s full-bag fallback — "nothing to upgrade" needs its own
// UI line, not "bag was full"). A future pass may add a choose-your-card
// picker UI; this is the deterministic placeholder.

import type { SkillTier } from '../engine/types';
import type { CardFilter, GemFilter } from './shopTypes';

/** Node label/icon-color grouping (docs/run-events-design.md §3b) — drives
 * display only (the map node's "EVENT · <THEME>" label + icon color), never
 * gameplay branching in the resolver. */
export type EventTheme = 'training' | 'cache' | 'recruit' | 'forge' | 'market' | 'omen';

/** The result vocabulary a (non-gamble) event choice resolves to. Small on
 * purpose — every grant reuses an existing system (bag insert, gem pouch,
 * run wallet, hero level, the start-draft set roller). */
export type EventOutcomeSpec =
  | { kind: 'grantCard'; cardId?: string; filter?: CardFilter; tier?: SkillTier }
  | { kind: 'grantGem'; gemId?: string; filter?: GemFilter }
  | { kind: 'grantGold'; amount: number }
  | { kind: 'loseGold'; amount: number }
  | { kind: 'grantLevel' }
  | { kind: 'bonusDraft'; filter?: CardFilter }
  | { kind: 'upgradeCard' }
  | { kind: 'nothing' };

export interface GambleRow {
  /** Integer percent weight; a gamble table's weights must sum to 100. */
  weight: number;
  outcome: EventOutcomeSpec;
}

/** A choice's outcome is either fixed (one `EventOutcomeSpec`) or a seeded
 * gamble over a weighted table of them (never nested — a gamble row can't
 * itself be a gamble). */
export type EventChoiceOutcome = EventOutcomeSpec | { kind: 'gamble'; table: readonly GambleRow[] };

export interface EventChoiceDef {
  id: string;
  /** Button label, e.g. "Pay 3 gold" / "Walk away". */
  label: string;
  /** Upfront gold cost paid before the outcome resolves (omitted/0 = free —
   * every event needs at least one cost-0 choice as its safe exit). */
  cost?: number;
  outcome: EventChoiceOutcome;
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
    body: 'The dust of the Hollow Yard has barely settled from the last duel when an old sellsword rises to meet you, gnarled staff in hand. "Three gold," she says, "and I\'ll show you where you\'re wasting your strength." Her lesson won\'t be free — but it won\'t be forgotten, either.',
    choices: [
      { id: 'pay', label: 'Pay 3 gold for the lesson', cost: 3, outcome: { kind: 'grantLevel' } },
      { id: 'decline', label: 'Keep walking', outcome: { kind: 'nothing' } },
    ],
  },
  {
    id: 'abandoned_cache',
    title: 'Abandoned Cache',
    theme: 'cache',
    body: 'The trail dips into the Silt Hollows, and there, half-swallowed by mud, a supply crate juts from the muck, its lock long rusted through. Someone left here in a hurry — or never came back at all. Pry it open and it could hold anything worth carrying, or nothing at all but the reason it was abandoned.',
    choices: [
      {
        id: 'open',
        label: 'Pry it open',
        outcome: {
          kind: 'gamble',
          table: [
            { weight: 60, outcome: { kind: 'grantCard', tier: 'bronze' } },
            { weight: 40, outcome: { kind: 'nothing' } },
          ],
        },
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
      {
        id: 'help',
        label: 'Help her gather them',
        outcome: {
          kind: 'gamble',
          table: [
            { weight: 70, outcome: { kind: 'grantGem' } },
            { weight: 30, outcome: { kind: 'nothing' } },
          ],
        },
      },
      { id: 'rifle', label: 'Rifle through the spill (2 gold)', cost: 2, outcome: { kind: 'grantGem' } },
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
        outcome: { kind: 'grantCard', filter: [{ elements: ['holy', 'dark'] }] },
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
    body: 'In the shadow of the crossroads shrine, a hooded figure shuffles cards at a folding table, coins stacked at her elbow, never once looking up as travelers pass. "Stake three gold," she says, "double it on the cut, or watch it disappear. Or don\'t play at all — some prefer to keep what little they have."',
    choices: [
      {
        id: 'stake',
        label: 'Stake 3 gold on the cut',
        // The stake is an UPFRONT cost, not a `loseGold` branch: modelling it as
        // loseGold made this a free coin-flip for +3 (loseGold floors at 0, so a
        // broke player risked nothing) and the choice rendered as FREE. With a
        // cost the scene gates it on affordability and the win pays the stake
        // back doubled.
        cost: 3,
        outcome: {
          kind: 'gamble',
          table: [
            { weight: 50, outcome: { kind: 'grantGold', amount: 6 } },
            { weight: 50, outcome: { kind: 'nothing' } },
          ],
        },
      },
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
      {
        id: 'spare_blade',
        label: 'Take a spare blade from the rack',
        outcome: { kind: 'grantCard', filter: [{ archetypes: ['offense'] }], tier: 'bronze' },
      },
    ],
  },
  {
    id: 'hermits_riddle',
    title: "Hermit's Riddle",
    theme: 'training',
    body: 'On a mossy boulder overlooking the Hollow Yard, a hermit sits cross-legged, riddle already half-spoken before you\'ve even stopped walking. Answer it right, she says, and you\'ll understand something about yourself no sparring ring could teach. Answer wrong, and you\'ll simply keep walking, no worse for it.',
    choices: [
      {
        id: 'answer',
        label: 'Answer the riddle',
        outcome: {
          kind: 'gamble',
          table: [
            { weight: 50, outcome: { kind: 'grantLevel' } },
            { weight: 50, outcome: { kind: 'nothing' } },
          ],
        },
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
      {
        id: 'crawl_in',
        label: 'Crawl inside',
        outcome: {
          kind: 'gamble',
          table: [
            { weight: 55, outcome: { kind: 'grantGem' } },
            { weight: 45, outcome: { kind: 'nothing' } },
          ],
        },
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
      {
        id: 'take_armor',
        label: 'Take the armor plating',
        outcome: { kind: 'grantCard', filter: [{ archetypes: ['defensive'] }], tier: 'bronze' },
      },
      { id: 'take_gem', label: 'Take the loose gemstone', outcome: { kind: 'grantGem' } },
    ],
  },
  {
    id: 'beast_nest',
    title: 'Beast Nest',
    theme: 'cache',
    body: 'A trampled nest sits half-sunk in the Silt Hollows\' mud, littered with the shed claws and feathers of something large. Raiding it for a trophy weapon is tempting — if whatever built it doesn\'t come back and cost you a coin purse for the trouble.',
    choices: [
      {
        id: 'raid_it',
        label: 'Raid the nest',
        outcome: {
          kind: 'gamble',
          table: [
            { weight: 60, outcome: { kind: 'grantCard', filter: [{ weapons: ['bow', 'beast'] }], tier: 'bronze' } },
            { weight: 40, outcome: { kind: 'loseGold', amount: 1 } },
          ],
        },
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
        outcome: { kind: 'grantCard', filter: [{ archetypes: ['offense'] }], tier: 'bronze' },
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
      { id: 'take_stone', label: 'Take the stone instead', outcome: { kind: 'grantGem' } },
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
      {
        id: 'reach_in',
        label: 'Thrust your gear into the coals',
        outcome: {
          kind: 'gamble',
          table: [
            { weight: 50, outcome: { kind: 'upgradeCard' } },
            { weight: 50, outcome: { kind: 'nothing' } },
          ],
        },
      },
      { id: 'pay_tender', label: 'Pay 2 gold to steady the coals first', cost: 2, outcome: { kind: 'grantGem' } },
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
      {
        id: 'free_reading',
        label: 'Take the free reading',
        outcome: {
          kind: 'gamble',
          table: [
            { weight: 50, outcome: { kind: 'grantLevel' } },
            { weight: 50, outcome: { kind: 'nothing' } },
          ],
        },
      },
      { id: 'cross_palm', label: 'Cross her palm with 2 gold', cost: 2, outcome: { kind: 'grantGem' } },
    ],
  },
  {
    id: 'weighing_stone',
    title: 'The Weighing Stone',
    theme: 'omen',
    body: "A black basalt stone squats at the crossroads' heart, said to weigh a traveler's resolve at a glance. Press your palm to it and it may show a glimpse of arms you'll carry — or leave your hand simply cold. Others just skirt around it, unwilling to let a stone judge them.",
    choices: [
      {
        id: 'press_palm',
        label: 'Press your palm to the stone',
        outcome: {
          kind: 'gamble',
          table: [
            { weight: 45, outcome: { kind: 'bonusDraft' } },
            { weight: 55, outcome: { kind: 'nothing' } },
          ],
        },
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
      {
        id: 'feed_them',
        label: 'Toss them your scraps (1 gold)',
        cost: 1,
        outcome: {
          kind: 'gamble',
          table: [
            { weight: 55, outcome: { kind: 'grantGem' } },
            { weight: 45, outcome: { kind: 'nothing' } },
          ],
        },
      },
      { id: 'walk_around', label: 'Walk the long way around', outcome: { kind: 'nothing' } },
    ],
  },

  // ---- MARKET ----
  {
    id: 'toll_collectors_ledger',
    title: "The Toll Collector's Ledger",
    theme: 'market',
    body: "A toll collector flags you down on the Tolling Road, ledger open, insisting a road tax is overdue for the wear you've caused passing through. Pay it and he waves you past with a stone from his confiscated crate — refuse, and he shrugs, scrawls something illegible, and lets you walk on regardless.",
    choices: [
      { id: 'pay_tax', label: 'Pay the 2-gold road tax', cost: 2, outcome: { kind: 'grantGem' } },
      { id: 'refuse', label: 'Refuse to pay', outcome: { kind: 'nothing' } },
    ],
  },
  {
    id: 'broken_axle',
    title: 'The Broken Axle',
    theme: 'market',
    body: "A cart lies overturned on the Tolling Road, axle snapped clean through, goods scattered across the ruts. The driver begs anyone passing for a shoulder to right it, promising whatever thanks the wreck still holds — or, if you'd rather not strain yourself, just leave him to sort it out alone.",
    choices: [
      {
        id: 'help_haul',
        label: 'Help haul the cart upright',
        outcome: {
          kind: 'gamble',
          table: [
            { weight: 55, outcome: { kind: 'grantGem' } },
            { weight: 45, outcome: { kind: 'nothing' } },
          ],
        },
      },
      { id: 'leave_him', label: 'Leave him to it', outcome: { kind: 'nothing' } },
    ],
  },
];

export const eventCatalog: Record<string, EventDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

/** Deterministic bag/display order. */
export const eventCatalogIds: readonly string[] = defs.map((d) => d.id);
