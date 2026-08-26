// Biome catalog — DECLARATIVE content only (no logic), mirroring
// `shopTypes.ts` / `events.ts`. A BIOME is the identity of one WAVE BAND (one
// `BOSS_EVERY` block of waves, ending in that band's boss): the mobs that live
// there, the boss at the end of it, the stalls that trade there and the event
// themes that happen there. The run layer routes over these lists; nothing
// here has any COMBAT effect (see `docs/biome-paths-proposal.md` §6.5 — PL is
// the balance unit, a biome is SUPPLY and LEGIBILITY only).
//
// MEMBERSHIP LIVES HERE AS ID LISTS. There is deliberately no `biome` field on
// `EnemyDef` / `SkillDef` / `ShopTypeDef`: that would put run-layer routing
// inside the frozen content JSON (`src/data/content/*.v1.json`) which carries
// parity / schema / export-idempotency tests, and would force the enemy book
// to know about a run-layer concept. This is exactly the precedent
// `src/run/enemyDepth.ts` set when it derived depth bands from the existing
// `goldReward` field rather than authoring a 13th enemy field.
//
// PREFER, NEVER SILO. Every list below is a PREFERENCE the run layer applies
// over a pool it was already drawing from, always with a fallback to that full
// pool (`src/run/biome.ts#preferIds`). A biome never removes anything from the
// game: it re-orders what you meet first. That is what keeps
// `tests/run/contentReachability.test.ts` / `affinityReachability.test.ts` /
// `enemyDepthGating.test.ts`'s "no enemy orphaned" audit green, and it is what
// stops a bad band from being unrecoverable.
//
// EVERY LIST IS A SORTED ARRAY, never a Set — pool ORDER is what fixes the
// draw for a given seed (`tests/run/contentPoolOrder.test.ts`), and iteration
// order must never depend on insertion order.

import type { Element, WeaponType } from '../engine/types';
import type { EventTheme } from './events';

/** The type a biome leans into — the whole reason a player reads its name. */
export type BiomeLean =
  | { kind: 'element'; type: Element }
  | { kind: 'weapon'; type: WeaponType };

export interface BiomeDef {
  id: string;
  /** "The Emberwaste" — what the band banner and (later) the fork panel say. */
  name: string;
  /** One line, panel-sized. */
  tagline: string;
  lean: BiomeLean;
  /**
   * Enemy ids this biome PREFERS as its fight anchors/filler. Sorted. Intersected
   * with the depth-gated pool at roll time and dropped entirely (falling back to
   * that pool) if the intersection is empty — so a list that does not span every
   * depth tier is a graceful degradation, not a hole.
   */
  mobs: readonly string[];
  /**
   * Shortlist the BOSS-COLUMN anchor is drawn from — the "predict which boss mob
   * might come up" promise. Sorted. Any roster id is legal here: `isBoss` is an
   * authored display/identity tag, while the BOSS TITLE (`TITLE_PRESETS.boss`,
   * +4 levels / +4 rank / +2 cards) is applied by POSITION to whatever mob rolls
   * at the end of a band — so promoting an existing kit needs no new statline
   * (docs/enemy-design.md: never hand-write one).
   */
  bosses: readonly string[];
  /**
   * Shop theme ids (`shopTypeIds`) this biome PREFERS, in AUTHORED PRIORITY
   * ORDER — index 0 first. `generateWave` walks this list in order and takes the
   * first entry still sitting in the 21-theme no-repeat bag, so position here is
   * load-bearing content, not incidental: [0] is the biome's own single-type
   * stall (the identity, handed over in one visit), [1] is the stall this biome
   * carries for a type NO biome leans on (see BIOME_SHOP_COVERAGE below), and
   * the rest are its generalists.
   */
  shops: readonly string[];
  /** Event themes this biome PREFERS. Sorted. */
  eventThemes: readonly EventTheme[];
}

// ---------------------------------------------------------------------------
// The catalog.
//
// ELEVEN biomes — ONE PER CARD TYPE (2026-08-26). Six shipped first, for the
// six types the roster could staff with mobs; frost, lightning, dark, bow and
// lance had none, so those five identities could not be DECLARED at all, only
// stumbled into (docs/run-structure-patterns.md Q12: "the set of declarable
// identities is the set of regions, whatever the card pool says"). The blocker
// was enemy content, not biome data — it landed as the TYPELESS-BAND MOB ROSTER
// in `src/data/enemies.ts`, and these five bands are what it was for.
//
// EVERY `mobs` LIST IS ON-TYPE, AND THAT IS A CORRECTNESS RULE, NOT A TIDINESS
// ONE. `biomeForecast.ts` prints "<counter> hits these mobs for +50%", where
// the counter is the counter of the biome's declared LEAN. Five of the original
// six lists carried BORROWED off-type members (the Hallowfield's `necromancer`
// is dark, its `knight` is sword; the Thornwild's three beast mobs; the
// Emberwaste's lightning `mage` and axe `blood_duelist`) — borrowed precisely
// because on-type mobs did not exist — and the line was FALSE of every one of
// them. Matchup is resolved against the DEFENDER's affinity
// (`cardMatchup`/`elementMatchup`/`weaponMatchup` in `src/engine/elements.ts`),
// so the line is true exactly when every listed mob carries the lean as an
// affinity. It now does, for all eleven bands, and
// `tests/run/biomeForecastCounter.test.ts` asserts it mob by mob.
//
// A BORROWED MOB IS THEREFORE NOT AVAILABLE AS A FIX for thin depth coverage.
// Where a lean had no kit in a depth tier the answer was to AUTHOR one
// (`vigil_keeper` for holy's deep end, `blight_shambler` for nature's middle),
// never to borrow a neighbour. `computeEnemyDepthBands` splits the 34-strong
// fight pool into 4 goldReward-ranked tiers with bands [1,8] / [5,12] / [9,16]
// / [13,inf); a list that misses a tier degrades gracefully (the weighting finds
// no intersection and the untouched depth pool is used, exactly as before
// biomes existed) rather than lying. Eight of the eleven span three tiers.
// STILL THIN, and named here rather than hidden: fire, nature and beast field
// no tier-3 mob and lance no tier-3 either, so those four bands read generic
// from fight 17 on. That is the next content increment, not a defect in the
// data below.
//
// THE BOSS SHORTLIST IS NOW ALWAYS ON-TYPE TOO: each band names its own
// SIGNATURE boss (the mono-type triad authored for that type in
// `src/data/enemies.ts`) plus its own toughest on-type MOB as a champion — the
// pattern `ironmoot` already used with `blood_duelist`. Before this pass four
// bands hosted another type's boss as a guest (`galewright` in the Emberwaste,
// `hollow_crown` in the Hallowfield, `rime_tyrant` in the Howlmoor,
// `thornpike_marshal` in the Swornhold) because those bosses had no band of
// their own; each has now gone home. `greenwood_sovereign` is deliberately in
// TWO shortlists — it is the only dual-affinity boss (nature + bow), so it is
// genuinely both the Thornwild's and the Arrowfell's.
//
// EACH `shops` LIST NOW OPENS ON ITS OWN SINGLE-TYPE STALL, and with eleven
// bands that alone satisfies the coverage invariant below — priority 1 no
// longer has to carry a homeless type's stall, because no type is homeless.
// ---------------------------------------------------------------------------

const defs: BiomeDef[] = [
  {
    id: 'arrowfell',
    name: 'The Arrowfell',
    tagline: 'Open ground, long sightlines, and someone already aiming.',
    lean: { kind: 'weapon', type: 'bow' },
    // bow core: hunter (tier 0) · cordon_archer (tier 1) · deadeye_stalker
    // (tier 3). No borrowed member.
    //
    // THE BAND WITH NO COUNTER, and it is stated rather than papered over.
    // `WEAPON_BEATS` maps sword->axe->lance->sword and bow->beast; NOTHING maps
    // TO bow, so `counterTypeFor` returns undefined here and the forecast prints
    // "nothing counters these mobs." — real, useful information for a player
    // choosing a route (this is the one band where the type wheel offers no
    // shortcut), not an empty line that reads like a bug.
    mobs: ['cordon_archer', 'deadeye_stalker', 'hunter'],
    // `greenwood_sovereign` is the bow boss AND the roster's only dual-affinity
    // one (nature + bow) — so unlike its mobs it CAN be countered, by fire off
    // its nature half. It sits in the Thornwild's shortlist too, honestly: it is
    // both. `deadeye_stalker` is the pure-bow champion and takes nothing extra
    // from anything, which makes this the catalog's only SPLIT shortlist (the
    // two faces disagree about their counters) — see `BossCounterRead` in
    // `src/run/biomeForecast.ts`, which refuses to promise a type it cannot.
    bosses: ['deadeye_stalker', 'greenwood_sovereign'],
    shops: ['fletchers_loft', 'wildworks', 'assassins_den'],
    eventThemes: ['cache', 'market'],
  },
  {
    id: 'duskbarrow',
    name: 'The Duskbarrow',
    tagline: 'Grave mounds, older than the road that avoids them.',
    lean: { kind: 'element', type: 'dark' },
    // dark core: grave_acolyte (tier 0) · necromancer (tier 1) · barrow_wight
    // (tier 3). No borrowed member.
    mobs: ['barrow_wight', 'grave_acolyte', 'necromancer'],
    // `hollow_crown` is the dark boss — it rode in the Hallowfield until this
    // band existed, which is why that band's card used to promise "dark" over a
    // boss that IS dark. `barrow_wight` is the deep dark mob wearing the title.
    bosses: ['barrow_wight', 'hollow_crown'],
    shops: ['umbral_stall', 'sanctum', 'alchemist', 'relic_vault'],
    eventThemes: ['omen', 'recruit'],
  },
  {
    id: 'emberwaste',
    name: 'The Emberwaste',
    tagline: 'Ash underfoot, cinder overhead. Fire shelves, fire mobs.',
    lean: { kind: 'element', type: 'fire' },
    // fire core: ember_imp (tier 1) · pyre_acolyte (tier 2).
    // CLEANED 2026-08-26: dropped the borrowed `mage` (lightning — it takes
    // -25% from frost, not +50%, so the counter line was worse than merely
    // untrue of it) and `blood_duelist` (axe). Both now have bands of their own
    // (`stormreach`, `ironmoot`). This is the THINNEST list in the catalog — two
    // mobs, tiers 1-2 — because fire has no tier-0 and no tier-3 kit; a fire mob
    // at either end is the next content increment for this band.
    mobs: ['ember_imp', 'pyre_acolyte'],
    // `cinder_monarch` is the fire boss; `pyre_acolyte` is the deepest fire MOB
    // wearing the boss title. `galewright` (lightning) used to ride here for
    // want of a home and is now the Stormreach's.
    bosses: ['cinder_monarch', 'pyre_acolyte'],
    shops: ['emberworks', 'arcanum', 'alchemist'],
    eventThemes: ['forge', 'omen'],
  },
  {
    id: 'frostmarch',
    name: 'The Frostmarch',
    tagline: 'Still air, white ground, and time you do not have.',
    lean: { kind: 'element', type: 'frost' },
    // frost core: rime_wisp (tier 0) · hoarfrost_adept (tier 2) ·
    // glacial_warden (tier 3). All three authored for this band — frost fielded
    // ZERO mobs before it, which is why there was no Frostmarch.
    mobs: ['glacial_warden', 'hoarfrost_adept', 'rime_wisp'],
    // `rime_tyrant` is the frost boss and rode in the Howlmoor for want of a
    // band; this is the country it was written for. `glacial_warden` is its
    // champion, and the whole band tells one story — it takes your TURNS.
    bosses: ['glacial_warden', 'rime_tyrant'],
    shops: ['frosthold', 'arcanum', 'alchemist', 'bulwark'],
    eventThemes: ['cache', 'omen'],
  },
  {
    id: 'hallowfield',
    name: 'The Hallowfield',
    tagline: 'Consecrated ground and the things it keeps out.',
    lean: { kind: 'element', type: 'holy' },
    // holy core: cleric (tier 0) · seraph (tier 1) · vigil_keeper (tier 3).
    // CLEANED 2026-08-26: dropped `necromancer` (dark), `knight` and
    // `warded_sentinel` (sword). The dark one was the clearest instance of the
    // bug — the card said "dark hits these mobs for +50%" over a mob that IS
    // dark and takes nothing from it. `vigil_keeper` was AUTHORED to replace the
    // depth coverage those three borrowed members were carrying, rather than the
    // list simply getting shorter.
    mobs: ['cleric', 'seraph', 'vigil_keeper'],
    // `dawn_arbiter` is the holy boss; `vigil_keeper` is the deep holy mob
    // wearing the title. `hollow_crown` (dark) has gone to the Duskbarrow.
    bosses: ['dawn_arbiter', 'vigil_keeper'],
    shops: ['reliquary', 'sanctum', 'bulwark'],
    eventThemes: ['omen', 'training'],
  },
  {
    id: 'howlmoor',
    name: 'The Howlmoor',
    tagline: 'Open moor, long grass, and something already watching.',
    lean: { kind: 'weapon', type: 'beast' },
    // beast core: giant_rat (tier 0) · thorn_beast / venom_stalker (tier 2).
    // CLEANED 2026-08-26: dropped the borrowed `hunter` (bow — and nothing
    // counters bow at all, so it was the one listed mob NO type could farm) and
    // `bleed_reaver` (axe). Both have bands now (`arrowfell`, `ironmoot`).
    mobs: ['giant_rat', 'thorn_beast', 'venom_stalker'],
    // `wolf_king` is the roster's original `isBoss` kit and the moor is its
    // country; `thorn_beast` is the deepest beast MOB wearing the title.
    // `rime_tyrant` (frost) has gone to the Frostmarch.
    bosses: ['thorn_beast', 'wolf_king'],
    shops: ['beastmoot', 'wildworks', 'assassins_den'],
    eventThemes: ['cache', 'recruit'],
  },
  {
    id: 'ironmoot',
    name: 'The Ironmoot',
    tagline: 'A warband camp. Axes, bleeding, and a price for both.',
    lean: { kind: 'weapon', type: 'axe' },
    // axe core: bleed_reaver (tier 1) · berserker / warbreaker (tier 2) ·
    // blood_duelist (tier 3). CLEANED 2026-08-26: dropped the borrowed `hunter`
    // (bow), which is now the Arrowfell's. Four on-type mobs over three tiers —
    // the catalog's best-staffed band, and the only one that needed no new
    // content at all.
    mobs: ['berserker', 'bleed_reaver', 'blood_duelist', 'warbreaker'],
    // `ruin_warlord` is the axe boss; `blood_duelist` is the roster's hardest
    // axe MOB wearing the boss title — the warband's champion. This pairing is
    // the pattern every band now follows.
    bosses: ['blood_duelist', 'ruin_warlord'],
    shops: ['cleaving_yard', 'armory', 'caravan'],
    eventThemes: ['forge', 'market'],
  },
  {
    id: 'pikewold',
    name: 'The Pikewold',
    tagline: 'Drill ground and hedgerow. Every line here is braced.',
    lean: { kind: 'weapon', type: 'lance' },
    // lance core: pike_conscript (tier 0) · rogue (tier 1, the roster's Lancer)
    // · phalanx_veteran (tier 2). No tier-3 lance kit yet — see the header note.
    mobs: ['phalanx_veteran', 'pike_conscript', 'rogue'],
    // `thornpike_marshal` is the lance boss and rode in the Swornhold for want
    // of a band; `phalanx_veteran` is the champion, and both teach the same
    // lesson — a physical attacker is billed twice for swinging.
    bosses: ['phalanx_veteran', 'thornpike_marshal'],
    shops: ['lancers_rest', 'armory', 'bulwark', 'caravan'],
    eventThemes: ['forge', 'training'],
  },
  {
    id: 'stormreach',
    name: 'The Stormreach',
    tagline: 'High ground under a sky that never settles.',
    lean: { kind: 'element', type: 'lightning' },
    // lightning core: arc_adept (tier 0) · mage (tier 1, the roster's pure
    // arcane blaster) · tempest_herald (tier 3). No borrowed member.
    mobs: ['arc_adept', 'mage', 'tempest_herald'],
    // `galewright` is the lightning boss and rode in the Emberwaste for want of
    // a band; `tempest_herald` is the champion. Both win the readiness race
    // rather than the damage race.
    bosses: ['galewright', 'tempest_herald'],
    shops: ['stormspire', 'arcanum', 'caravan'],
    eventThemes: ['forge', 'omen'],
  },
  {
    id: 'swornhold',
    name: 'The Swornhold',
    tagline: 'A garrison that still keeps its oaths. Steel and shields.',
    lean: { kind: 'weapon', type: 'sword' },
    // sword core: knight (tier 1) · shield_warden (tier 2) · bandit_duelist /
    // warded_sentinel (tier 3). CLEANED 2026-08-26: dropped the borrowed
    // `cleric` (holy), `rogue` (lance) and `warbreaker` (axe) — all three now
    // have bands of their own (`hallowfield`, `pikewold`, `ironmoot`) — and the
    // remaining four on-type mobs still span three tiers, so nothing had to be
    // authored for this one.
    mobs: ['bandit_duelist', 'knight', 'shield_warden', 'warded_sentinel'],
    // `sworn_colossus` is the sword boss; `warded_sentinel` is the roster's
    // hardest sword MOB wearing the title. `thornpike_marshal` (lance) has gone
    // to the Pikewold.
    bosses: ['sworn_colossus', 'warded_sentinel'],
    shops: ['swordwright', 'armory', 'bulwark'],
    eventThemes: ['forge', 'training'],
  },
  {
    id: 'thornwild',
    name: 'The Thornwild',
    tagline: 'Root, spore and venom. Nothing here was tamed.',
    lean: { kind: 'element', type: 'nature' },
    // nature core: stone_beetle / toxic_druid (tier 0) · blight_shambler
    // (tier 2). CLEANED 2026-08-26: dropped `giant_rat`, `thorn_beast` and
    // `venom_stalker` (beast — the wild's fauna thematically, but bow farms
    // them, not fire) and `rogue` (lance). `blight_shambler` was AUTHORED for
    // the middle tier those borrowed members were covering.
    //
    // `stone_beetle` STAYS and is on-type: its `elementAffinity: 'nature'` is a
    // creature-level matchup identity (its shell), not a claim about its cards
    // — see its own note in `enemies.ts` — and matchup reads the DEFENDER's
    // affinity, so "fire hits these mobs for +50%" is literally true of it.
    mobs: ['blight_shambler', 'stone_beetle', 'toxic_druid'],
    // `bramble_matriarch` is the nature boss. `greenwood_sovereign` stays here
    // as well as in the Arrowfell: it is nature AND bow, and its nature half is
    // what fire farms, so it is honestly a face of both bands.
    bosses: ['bramble_matriarch', 'greenwood_sovereign'],
    shops: ['grovekeep', 'wildworks', 'alchemist'],
    eventThemes: ['cache', 'recruit'],
  },
];

// EVERY CARD TYPE'S SINGLE-TYPE STALL IS PREFERRED BY SOME BIOME.
//
// WHY THE INVARIANT EXISTS (measured, 400 seeds, waves 1-10, back when there
// were six biomes): with each band preferring only stalls of its own lean, the
// types NO biome leaned on — frost, lightning and dark — fell from 2.1-2.5
// offers/run to 0.96-1.19 and P(>=3) from 29-34% to 10-16%. Preference crowds
// out whatever it does not name, and `tests/run/affinityReachability.test.ts`
// measures per-SHELF density so it never noticed: the shelves were unchanged, it
// was the FREQUENCY of reaching them that halved. That was patched by parking
// each homeless stall at PRIORITY 1 of the band it read most naturally beside.
//
// ELEVEN BANDS RETIRE THAT PATCH (2026-08-26). Every card type now has a band,
// so every single-type stall sits at PRIORITY 0 of its own band and priority 1
// is free for generalists again. The invariant is unchanged and still asserted —
// it is what stops a future biome pass from re-orphaning a type by re-ordering a
// list, and it is also what would catch a 12th biome that leans a type twice
// while some other type loses its home.
//
// THE COST IS PAID BY THE SIX ORIGINAL LEANS, and it is a fair trade: a given
// type is now preferred on 1/11 of bands rather than 1/6, so fire/holy/nature/
// axe/sword/beast each give up a little supply while frost/lightning/dark/bow/
// lance gain a great deal. Total steering is unchanged (one preferred stall per
// band either way) — it is spread across eleven types instead of six.
// `biomeSupply.test.ts`'s per-type floor is what holds the give-up honest.
//
// THE INVARIANT: every card type's single-type stall sits at priority 0 or 1 of
// some biome. `tests/run/biomeSupply.test.ts` asserts it.
export const biomeCatalog: Record<string, BiomeDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

/** Id-sorted, for deterministic iteration and indexing. */
export const biomeIds: readonly string[] = defs.map((d) => d.id).sort();
