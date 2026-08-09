// FROZEN list of the 35 gem ids that existed at the JSON content migration
// (the post-2026-08-09 catalog: 46 -> 35, 14C/13R/4E/4L).
//
// WHY FROZEN: tests/data/gemsJsonParity.test.ts proves the JSON book is
// byte-identical to the hand-written TS book in src/data/gems.ts, which is what
// transfers the existing guarantees (gemAudit's exact-band check, the shop/event
// pool tests) onto the JSON book in one step.
//
// It can only compare gems that exist in BOTH. A newly authored gem lives only in
// the JSON, so a whole-book comparison would turn red the moment the first new gem
// lands — and the reflex fix ("delete the parity test") would throw away the
// migration proof while it is still needed. Same reasoning, and same end-of-life,
// as tests/data/migratedSkillIds.ts.
//
// DO NOT append new ids here. When the literals in src/data/gems.ts are deleted,
// delete this file and the parity test with it.
export const MIGRATED_GEM_IDS: readonly string[] = [
  "archmages_core",
  "armor_break_echo",
  "battle_howl_echo",
  "brawlers_core",
  "bulwark_core",
  "concussive_shard",
  "concussive_shot_echo",
  "crippling_strike_echo",
  "empowering_core",
  "enfeebling_shard",
  "fireball_echo",
  "follow_through_echo",
  "frost_ward_echo",
  "hex_of_frailty_echo",
  "iron_bulwark_echo",
  "judgment_light_echo",
  "leeching_fang_echo",
  "lightweight_core",
  "mana_ward_echo",
  "mending_light_echo",
  "prism_barrier_echo",
  "purify_echo",
  "quickening_sliver",
  "resonant_echo",
  "restorative_core",
  "second_wind_echo",
  "shield_splitter_echo",
  "slow_hex_echo",
  "stunning_shard",
  "swift_charm",
  "time_crystal_echo",
  "venom_fang_echo",
  "venom_sliver",
  "war_banner_echo",
  "ward_of_silence_echo",
];
