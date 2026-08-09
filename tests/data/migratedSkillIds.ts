// FROZEN list of the 72 card ids that existed BEFORE the JSON content migration.
//
// WHY FROZEN: tests/data/skillsJsonParity.test.ts proves the JSON book is
// byte-identical to the hand-written TS book in src/data/skills.ts. That proof is
// what transfers every existing guarantee (balance audit, card-text audit, the
// 400-case outcome baseline) onto the JSON book in one step.
//
// But it can only compare cards that EXIST IN BOTH. A newly authored card lives
// only in the JSON — there is nothing in the TS literals to compare it to — so a
// whole-book comparison would turn red the moment the first new card lands, and
// the reflex fix ("just delete the parity test") would throw away the migration
// proof while it is still needed. Scoping to this frozen set keeps the guarantee
// exactly where it applies and lets new content land freely.
//
// Same reasoning as tests/engine/fixtures/frozenSweepSkillIds.ts.
//
// DO NOT append new ids here. When src/data/skills.ts is deleted, delete this
// file and the parity test with it — at that point there is no second book.
export const MIGRATED_SKILL_IDS: readonly string[] = [
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
  "wildfire_surge",
];
