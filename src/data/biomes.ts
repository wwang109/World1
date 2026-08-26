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
// SIX biomes, one per type the CURRENT roster can actually staff with mobs
// (fire · holy · nature · sword · axe · beast). Frost, lightning, dark, bow and
// lance are deliberately NOT biomes yet: the roster fields 1 or 0 mobs each, so
// a "Frostmarch" would be a name with no monsters behind it. They stay
// available through the shop bag's fallback like they are today, and the
// moment content lands for them a biome is five lines.
//
// EACH `mobs` LIST SPANS THE DEPTH TIERS. `computeEnemyDepthBands` splits the
// 21-strong fight pool into 4 goldReward-ordered tiers with bands [1,8] /
// [5,12] / [9,16] / [13,inf); a biome whose mobs all sit in one tier would
// silently fall back to the full pool everywhere else and stop reading as a
// place. Where the lean's own type has no kit in a tier (fire has nothing past
// `pyre_acolyte`, holy nothing in tier 2, ...) the list borrows the nearest
// THEMATIC neighbour and says so in a comment — those are the slots a future
// content pass should replace with a real member of the lean type.
// ---------------------------------------------------------------------------

const defs: BiomeDef[] = [
  {
    id: 'emberwaste',
    name: 'The Emberwaste',
    tagline: 'Ash underfoot, cinder overhead. Fire shelves, fire mobs.',
    lean: { kind: 'element', type: 'fire' },
    // fire core: ember_imp (tier 0) · pyre_acolyte (tier 2).
    // BORROWED: mage (tier 1, lightning) as the elemental caster kin, and
    // blood_duelist (tier 3, axe) as the deep "blood and fire" kit — the roster
    // has no tier-1 or tier-3 fire enemy. Replace both when one exists.
    mobs: ['blood_duelist', 'ember_imp', 'mage', 'pyre_acolyte'],
    // SIGNATURE BOSSES (2026-08-26 boss-roster pass): `cinder_monarch` is the
    // fire boss authored for this band; `galewright` (lightning) rides with it
    // because no biome leans lightning and the Emberwaste already carries its
    // stall and its caster kin (`stormspire`, `mage`).
    bosses: ['cinder_monarch', 'galewright'],
    shops: ['emberworks', 'stormspire', 'alchemist', 'arcanum'],
    eventThemes: ['forge', 'omen'],
  },
  {
    id: 'hallowfield',
    name: 'The Hallowfield',
    tagline: 'Consecrated ground and the things it keeps out.',
    lean: { kind: 'element', type: 'holy' },
    // holy core: cleric (tier 0) · seraph (tier 1).
    // BORROWED: necromancer (tier 2, dark) — the profane thing the field is
    // consecrated AGAINST, and the biome's own counter-element, which is the
    // legible tension the lean is supposed to carry; knight / warded_sentinel
    // (tiers 1/3, sword) as its order-of-arms.
    mobs: ['cleric', 'knight', 'necromancer', 'seraph', 'warded_sentinel'],
    // `dawn_arbiter` is the holy boss; `hollow_crown` is the dark one, and the
    // Hallowfield is the only band that fields the dark it is consecrated
    // against (`necromancer`, `umbral_stall`).
    bosses: ['dawn_arbiter', 'hollow_crown'],
    shops: ['reliquary', 'umbral_stall', 'sanctum', 'bulwark'],
    eventThemes: ['omen', 'training'],
  },
  {
    id: 'thornwild',
    name: 'The Thornwild',
    tagline: 'Root, spore and venom. Nothing here was tamed.',
    lean: { kind: 'element', type: 'nature' },
    // nature core: stone_beetle · toxic_druid (tier 0).
    // BORROWED: giant_rat / venom_stalker / thorn_beast (tiers 0/2/3, beast) —
    // the wild's own fauna; rogue (tier 1, lance) as the poacher working it.
    mobs: ['giant_rat', 'rogue', 'stone_beetle', 'thorn_beast', 'toxic_druid', 'venom_stalker'],
    bosses: ['bramble_matriarch', 'greenwood_sovereign'],
    shops: ['grovekeep', 'fletchers_loft', 'wildworks'],
    eventThemes: ['cache', 'recruit'],
  },
  {
    id: 'ironmoot',
    name: 'The Ironmoot',
    tagline: 'A warband camp. Axes, bleeding, and a price for both.',
    lean: { kind: 'weapon', type: 'axe' },
    // axe core: bleed_reaver (tier 1) · berserker / warbreaker (tier 2) ·
    // blood_duelist (tier 3).
    // BORROWED: hunter (tier 0, bow) as the warband's outriders — the roster has
    // no tier-0 axe kit.
    mobs: ['berserker', 'bleed_reaver', 'blood_duelist', 'hunter', 'warbreaker'],
    // `ruin_warlord` is the axe boss; `blood_duelist` is the roster's hardest
    // axe MOB wearing the boss title — the warband's champion, and a legible
    // second face for the band so the boss line is not one name forever.
    bosses: ['blood_duelist', 'ruin_warlord'],
    shops: ['cleaving_yard', 'armory', 'caravan'],
    eventThemes: ['forge', 'market'],
  },
  {
    id: 'swornhold',
    name: 'The Swornhold',
    tagline: 'A garrison that still keeps its oaths. Steel and shields.',
    lean: { kind: 'weapon', type: 'sword' },
    // sword core: knight (tier 1) · bandit_duelist / shield_warden /
    // warded_sentinel (tier 3).
    // BORROWED: cleric (tier 0, holy) as the garrison chapel; rogue (tier 1,
    // lance) and warbreaker (tier 2, axe) as the hold's other arms — the roster
    // has no tier-0 or tier-2 sword kit.
    mobs: ['bandit_duelist', 'cleric', 'knight', 'rogue', 'shield_warden', 'warbreaker', 'warded_sentinel'],
    bosses: ['sworn_colossus', 'thornpike_marshal'],
    shops: ['swordwright', 'lancers_rest', 'armory', 'bulwark'],
    eventThemes: ['forge', 'training'],
  },
  {
    id: 'howlmoor',
    name: 'The Howlmoor',
    tagline: 'Open moor, long grass, and something already watching.',
    lean: { kind: 'weapon', type: 'beast' },
    // beast core: giant_rat (tier 0) · venom_stalker (tier 2) · thorn_beast
    // (tier 3) — and `wolf_king`, the roster's one `isBoss` kit, as its boss.
    // BORROWED: hunter (tier 0, bow) and bleed_reaver (tier 1, axe) as the
    // trappers working the moor — the roster has no tier-1 beast kit.
    mobs: ['bleed_reaver', 'giant_rat', 'hunter', 'thorn_beast', 'venom_stalker'],
    // `wolf_king` is the roster's original `isBoss` kit and the moor is its
    // country; `rime_tyrant` (frost) rides with it for the same reason the
    // Howlmoor carries `frosthold` — nothing else leans frost yet.
    bosses: ['rime_tyrant', 'wolf_king'],
    shops: ['beastmoot', 'frosthold', 'fletchers_loft', 'wildworks'],
    eventThemes: ['cache', 'recruit'],
  },
];

// EVERY CARD TYPE'S SINGLE-TYPE STALL IS PREFERRED BY SOME BIOME.
//
// Measured cost of the shop preference, 400 seeds, waves 1-10, before adding the
// second column of `shops` above: the three types NO biome leans on (frost,
// lightning, dark — the roster fields no mob for any of them, so there is no
// honest biome to build around them) fell from 2.1-2.5 offers/run to 0.96-1.19,
// P(>=3) from 29-34% to 10-16%. Preference crowds out what it does not name.
// `tests/run/affinityReachability.test.ts` measures per-SHELF density and never
// noticed; the acquisition guarantee it protects would still have been quietly
// halved for those three types.
//
// FIXED HERE, not by weakening the preference: each homeless single-type stall
// is carried at PRIORITY 1 by the biome it reads most naturally beside —
// `stormspire` by the Emberwaste (whose `mage` is already its caster kin),
// `umbral_stall` by the Hallowfield (whose `necromancer` is already the thing
// the ground keeps out), `frosthold` by the Howlmoor (the run's cold open
// country), `fletchers_loft` by the Thornwild (hunting country, and the
// Howlmoor's own priority 1 is already spent on frost).
//
// THE INVARIANT: every card type's single-type stall sits at priority 0 or 1 of
// some biome. `tests/run/biomeSupply.test.ts` asserts it so a future biome pass
// cannot re-orphan a type by re-ordering a list.
export const biomeCatalog: Record<string, BiomeDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

/** Id-sorted, for deterministic iteration and indexing. */
export const biomeIds: readonly string[] = defs.map((d) => d.id).sort();
