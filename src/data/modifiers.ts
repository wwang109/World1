import type { BuffableStat, SkillTier } from '../engine/types';

// Enemy MODIFIERS — rogue-like affixes an encounter can stack on top of an
// enemy's (level + rank + extra cards). This is CONTENT (names, blurbs, and
// the tuning values behind each affix), authored here rather than in the
// run-layer resolver that consumes it (`src/run/encounter.ts`). That module
// still owns the MECHANISM — how a `bonusPL`/`bonusProfile` pair gets
// auto-spent through the level-up PL economy, how `forceTier` overrides
// rank assignment after the fact, and how a `cards` list is installed onto
// the enemy's deck; this module owns only the DATA those mechanisms read.
//
// Each preset is one of:
//   - a bonus PL auto-spend (`bonusPL` + `bonusProfile`), priced through the
//     SAME `LEVEL_STAT_COST` economy as every other stat point in the game
//     (so a Swift enemy's speed is exactly as "expensive" as anyone else's), or
//   - a deck-wide tier override (`forceTier`) applied AFTER rank assignment, or
//   - a BEHAVIOURAL AFFIX (`affix: true` + `cards`), which installs authored
//     cards onto the enemy's deck IN PLACE OF the title's generic filler
//     cards. Add a new affix = add a row here; the resolver in encounter.ts
//     needs no changes.
//
// WHY THESE FOUR CARDS. An affix must be threat-NEUTRAL: it swaps one bronze
// card for another (100 deci-PL either way), so if the card it installs is
// weaker in practice than the plain filler it replaced, the affix quietly
// makes elites EASIER. Pure-defence cards fail that test badly - the filler it
// replaces is a scaling (+ATK) swing, while a flat shield or a one-charge
// negate is not - measured over an identical 288-fight probe (4 enemies x 4
// hero boards x 3 depths x 6 seeds), hero winrate against the plain filler was
// 19%, and bastion_stance took it to 33%, frost_ward to 35%, ward_of_silence
// to 27%: all three are downgrades wearing an affix's name. The four cards
// below measured 19 / 19 / 19 / 21% against the filler's 19 - the substitution
// changes the SHAPE of the threat and not its size. That probe is a NEUTRALITY
// CHECK on a substitution, never a tuning input: no affix carries a number
// that could be tuned, so there is nothing here to fit to a winrate.
// The shape that passes the check is "an offensive card carrying a rider": it
// keeps the scaling (+ATK) swing the filler was, and spends its remaining
// budget on a behaviour. A pure-defence card spends the whole budget on
// something flat, which is why all three failed.
//
// AND THE PAYLOAD HAS TO KEEP PACE. A rider whose magnitude is a flat stack
// count fades as the ladder scales the hero around it - the reason there is no
// THORNS affix here despite thorns being the most interesting hit-count tax in
// the book: a reflect is armor-mitigated with a min-1 floor
// (`reflectThorns`), so a bronze pile of 5-8 stacks degrades to 1 damage per
// hit against any hero who bought armor at all, at every depth. Each affix
// below pays in a currency that does not decay: a PERCENT (braced's guard,
// leeching's 45%, venomous's anti-heal), a shield BYPASS (venomous's poison),
// or flat WEIGHT against card weights that are themselves constants
// (hobbling's slow).
//
// TWO POOLS, NOT ONE (2026-08-26). `ENEMY_MODIFIER_IDS` is the DEEP-RUN
// ESCALATION pool that `fightSpecFor` (src/run/runState.ts) slices one id at a
// time past `MAX_LEVEL`; `ELITE_AFFIX_IDS` is the ELITE AFFIX pool that
// `eliteAffixIdFor` (src/run/encounter.ts) derives one id from per elite
// fight. A preset belongs to exactly one of them, decided by its own `affix`
// flag — so a behavioural affix can never leak into the escalation ramp and
// land on a NORMAL fight, and an escalation modifier can never be dealt as an
// elite's readable identity.

/**
 * The stat weights a `bonusPL` modifier spends against — a subset mirror of
 * `StatProfile` (src/run/leveling.ts) kept LOCAL to this content module so
 * `src/data` never has to import from `src/run`: same field set (`maxHp` +
 * every `BuffableStat`), just declared against the engine's own stat-name
 * type instead of the run layer's allocation type. Structurally identical,
 * so it folds straight into `Partial<StatProfile>` at the resolver call site.
 */
export type ModifierStatBonus = Partial<Record<'maxHp' | BuffableStat, number>>;

export interface EnemyModifierPreset {
  /** The document/book key — carried on the value too, matching the
   * GemDef/EnemyDef convention of a self-describing entry. */
  id: string;
  /** Display name, e.g. chip label. */
  name: string;
  /** One-line effect description for UI. */
  blurb: string;
  /** Extra PL auto-spent (allocateMonsterPL) against `bonusProfile` after level scaling. */
  bonusPL?: number;
  bonusProfile?: ModifierStatBonus;
  /** Force EVERY deck card to this tier after rank assignment (rank reads as the ceiling). */
  forceTier?: SkillTier;
  /**
   * BEHAVIOURAL AFFIX marker. `true` puts this preset in `ELITE_AFFIX_IDS`
   * (one is dealt to every elite fight, `eliteAffixIdFor`) and KEEPS IT OUT
   * of `ENEMY_MODIFIER_IDS` (the deep-run escalation ramp). An affix must
   * carry `cards`: a preset that only says "I am an affix" changes nothing.
   */
  affix?: true;
  /**
   * Card ids installed onto the enemy's deck, consuming the TITLE's own
   * `extraCards` allowance first (`buildEnemyEncounter`) rather than being
   * appended on top of it. That is what makes an affix a DIFFERENT problem
   * instead of a bigger one: every bronze card in this game audits to
   * exactly one bronze tier budget (100 deci-PL — `TIER_BUDGET_DECI`), so
   * swapping the title's generic filler for a characterful card is priced at
   * ZERO. No affix strength was ever chosen, so none can be mis-tuned.
   */
  cards?: readonly string[];
}

export const MODIFIER_PRESETS: Record<string, EnemyModifierPreset> = {
  // AFFIX — taxes ONE DAMAGE PROPERTY, as a percentage that never stops
  // scaling. `guard` only matches its own property (`dealDamage`: "True damage
  // never matches a typed guard"), so a physical guard is a 20% tax on swords,
  // axes, lances, bows and beasts - and completely invisible to a magical or
  // TRUE card. The question it asks the deck is "do you own ANY off-property
  // damage", which is the shape a stat rung can never have.
  // Answered by: TRUE (void_pierce, purging_strike, soul_rend, mortal_wound,
  // annihilation_strike) or magical (arcane_bolt, fireball, shadow_bolt) hits,
  // which the guard cannot see at all; or expose to pay the tax back
  // (piercing_arrow, ruinous_hex, hoarfrost_creed, sundering_roar).
  braced: {
    id: 'braced',
    name: 'BRACED',
    blurb: 'Braced Pike - takes 20% less physical damage while braced',
    affix: true,
    cards: ['braced_pike'],
  },
  diamond: {
    id: 'diamond',
    name: 'DIAMOND-POWERED',
    blurb: 'Every card upgraded to Diamond tier',
    forceTier: 'diamond',
  },
  // AFFIX — taxes TEMPO, and it is the one tax that never decays with depth:
  // card WEIGHTS are constants, so a flat +16 on the hero's next action is
  // worth exactly as much at fight 60 as at fight 6 (every stat-scaled affix
  // has to keep pace with the ladder; this one does not have to). A slow is
  // "one turn, one card": whatever the hero plays for the REST OF THIS TURN
  // costs +16 weight, so a heavy anchor simply does not come out.
  // Answered by: BUILD LIGHT - a board of weight-8 cards (twin_slash,
  // purging_strike, arcane_bolt, static_jolt) pays 24 to act where a
  // weight-20 anchor pays 36, and every point of SPD buys the tax back. It is
  // stored on the piece rather than as a status, so cleanse cannot answer this
  // one: board construction is the whole answer, which is exactly the decision
  // an automatic fight can still ask of a player.
  hobbling: {
    id: 'hobbling',
    name: 'HOBBLING',
    blurb: 'Hamstring - slows your next action by +16 weight',
    affix: true,
    cards: ['hamstring'],
  },
  // AFFIX — taxes THE CLOCK. 45% lifesteal on a scaling (+ATK) hit means a
  // grindy board never closes the gap, however much total damage it holds.
  // Answered by: the anti-heal world rule - each affliction CATEGORY standing
  // on the elite cuts its lifesteal 20%, cap 60%. One DoT (hemorrhage,
  // venom_fang, cinder_dart, rupturing_strike) is the first category, any stat
  // debuff (armor_break, hex_of_frailty, disarming_blow) the second, expose
  // (piercing_arrow, ruinous_hex) the third. Or out-burst it.
  leeching: {
    id: 'leeching',
    name: 'LEECHING',
    blurb: 'Leeching Fang - heals 45% of the damage it deals',
    affix: true,
    cards: ['leeching_fang'],
  },
  swift: {
    id: 'swift',
    name: 'SWIFT',
    blurb: '+8 PL of pure Speed (+4 SPD)',
    bonusPL: 8,
    bonusProfile: { speed: 1 },
  },
  // AFFIX — taxes SHIELDS AND HEALS, the two defences that answer everything
  // else, and COMPOUNDS if left alone. Poison BYPASSES SHIELDS entirely and
  // ticks at END of turn, so a wall build takes it full in the face; while it
  // stands it is an anti-heal category on the hero, docking 20% off every
  // regular heal and lifesteal; and Second Bite's own exploit rider pays +4
  // MORE on a target that is already poisoned, so the second bite is worse
  // than the first unless the first one was answered.
  // Answered by: cleanse, which removes the stacks AND disarms the exploit
  // (purify 4, purge_the_rot 4, graveside_rite 4, poison_ritual 2,
  // penitent_mending 2, warding_prayer 2); or ward, which prevents the ailment
  // before it ever lands (unbreakable_stance, umbral_ward, evasive_cordon,
  // sanctified_vigil, verdant_rebuke, warded_reprisal, aegis_of_the_unbroken,
  // sanctum_thorn).
  // NOT `venom_fang`: that card is already in the resolver's GENERIC FILLER
  // pool (`EXTRA_CARD_POOL`), so on the three enemies whose kit contains
  // `sword_slash` the filler falls through to it and an affixed elite would
  // have been byte-identical to a plain one. The affix must always be the
  // thing that is different.
  venomous: {
    id: 'venomous',
    name: 'VENOMOUS',
    blurb: 'Second Bite - poison that bypasses shields, and bites harder once it lands',
    affix: true,
    cards: ['second_bite'],
  },
};

/**
 * THE DEEP-RUN ESCALATION POOL — every preset that is NOT a behavioural
 * affix, in declaration (id-sorted) order. `fightSpecFor` slices this list
 * (`ENEMY_MODIFIER_IDS.slice(0, count)`) to decide which modifiers an
 * overflow fight past `MAX_LEVEL` carries, so its ORDER is load-bearing, and
 * the affix filter is what keeps that ramp byte-identical to before affixes
 * existed. Also the chip list both Prep scenes render.
 */
export const ENEMY_MODIFIER_IDS: readonly string[] = Object.keys(MODIFIER_PRESETS).filter(
  (id) => MODIFIER_PRESETS[id]?.affix !== true,
);

/**
 * THE ELITE AFFIX POOL — every preset marked `affix: true`, in declaration
 * (id-sorted) order. `eliteAffixIdFor` (src/run/encounter.ts) indexes this
 * list with its own `hashSeed` domain, so its ORDER is load-bearing the same
 * way `ENEMY_MODIFIER_IDS`'s is: reordering it re-deals every elite in every
 * seed. Append, don't insert.
 */
export const ELITE_AFFIX_IDS: readonly string[] = Object.keys(MODIFIER_PRESETS).filter(
  (id) => MODIFIER_PRESETS[id]?.affix === true,
);
