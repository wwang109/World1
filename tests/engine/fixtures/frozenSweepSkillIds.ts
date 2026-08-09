// FROZEN sweep-id list — the id set the 200-fight outcome-baseline sweep
// (tests/engine/helpers/sweepConfigs.ts, consumed by tests/engine/outcomeRule.test.ts /
// tests/engine/fixtures/outcomeBaseline.json) draws cards from.
//
// WHY THIS EXISTS (measured, not theoretical): sweepConfigs.ts used to build its id
// pool as `Object.keys(skillBook).sort()` at call time. With the real 72-card book
// and the real seeded Rng, adding ONE new card anywhere in sort order changed
// 200/200 of the 200-fight sweep's boards (a new id shifts the sort index of every
// id after it, and the pool SIZE changing shifts every `rng.int(SKILL_IDS.length)`
// draw too) — turning outcomeBaseline.json red and forcing a full 400-hash
// regeneration for a change that touched no rule. That defeats the baseline's whole
// purpose: it is meant to catch RULE changes, and routine regeneration trains
// reviewers to wave the lock through.
//
// FIX: freeze the pool to a literal snapshot instead of recomputing it from the
// live book. This is the sorted key list of skillBook AS OF 2026-08-08 (72 ids,
// captured before any content-format migration) — reproduces every existing sweep
// board and baseline hash EXACTLY, so freezing costs zero regeneration.
//
// CONSEQUENCES, BY DESIGN:
//   ADD a card    -> this list (and therefore the baseline) is UNTOUCHED. This is
//                    the routine authoring workflow the freeze exists to protect.
//   EDIT a card   -> the baseline still moves if the edit changes behaviour, exactly
//                    as before. Freezing the ID SET does not freeze card CONTENT.
//   REMOVE a card -> tests/engine/frozenSweepSkillIds.test.ts fails loudly ("skill
//                    removed from skillBook") rather than silently shrinking the
//                    pool. Removing a card is a deliberate act: update this list AND
//                    recapture the baseline together, and say so in the fixture's
//                    `note` field.
//
// Do NOT "fix" this back to `Object.keys(skillBook).sort()` — that reintroduces
// the exact churn this file exists to kill. Do NOT append new ids here when a card
// is added — that changes the pool composition and defeats the freeze; new cards
// simply are not in the sweep, which is the intended, accepted trade (sweep
// COVERAGE of new content is not this fixture's job; it guards the ATTRITION
// THRESHOLD BOUNDARY on the frozen set, see outcomeRule.test.ts).
export const FROZEN_SWEEP_SKILL_IDS: readonly string[] = [
  "aegis_wall",
  "annihilation_strike",
  "arcane_bolt",
  "armor_break",
  "barrage",
  "bastion_stance",
  "battle_howl",
  "blooming_vine",
  "braced_pike",
  "chain_spark",
  "cinder_dart",
  "concussive_shot",
  "crippling_strike",
  "crushing_blow",
  "deep_freeze",
  "ember_lash",
  "fireball",
  "follow_through",
  "fortress_bastion",
  "frost_shackle",
  "frost_ward",
  "glacial_spike",
  "hamstring",
  "hex_of_frailty",
  "hunter_shot",
  "impaling_charge",
  "inferno_eruption",
  "iron_bulwark",
  "judgment_light",
  "lance_thrust",
  "leeching_fang",
  "mana_ward",
  "marksman_shot",
  "mending_aura",
  "mending_light",
  "overcharge",
  "overgrowth",
  "piercing_arrow",
  "piercing_reach",
  "prism_barrier",
  "purging_strike",
  "purify",
  "rapid_volley",
  "rending_claws",
  "renewing_wave",
  "ruinous_hex",
  "rupturing_strike",
  "sanctified_bulwark",
  "savage_bite",
  "scorching_brand",
  "second_wind",
  "shadow_bolt",
  "shield_splitter",
  "slow_hex",
  "soul_rend",
  "static_jolt",
  "storm_surge",
  "stunning_smash",
  "swift_march",
  "sword_slash",
  "thorn_bite",
  "thunder_step",
  "time_crystal",
  "twin_slash",
  "venom_fang",
  "verdant_touch",
  "vital_surge",
  "void_pierce",
  "war_banner",
  "ward_of_silence",
  "warlord_banner",
  "wildfire_surge"
];
