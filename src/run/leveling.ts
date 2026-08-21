// Leveling / stat-scaling — the run-layer scaling resolver.
//
// UNIFIED ECONOMY (locked design, 2026-07-24): the player and every monster
// share ONE base statline (see `BASE_HERO_STATS` / `enemies[*].stats` — both
// now the same Level-1 floor: maxHp 100, attack 1, magicPower 1, armor 1,
// magicResist 1, speed 10) and ONE leveling currency: every level grants
// `PL_PER_LEVEL` Power Level, spent via the priced `LEVEL_STAT_COST` table.
//
// An enemy's IDENTITY no longer lives in bespoke floor stats — it lives in
// HOW its profile (`MONSTER_PROFILES`) spends its level PL (weights), plus
// its cards and Title. `allocateMonsterPL` spends a monster's banked PL
// against its profile deterministically (see its doc comment for the exact
// algorithm); the player spends the same currency by hand through a future
// stat-sheet UI, via the `applyPlayerLevelAllocation` guarded entry point.
//
// Pure TS, integer-only, deterministic — no RNG here. The XP->level curve
// (how much XP a level costs) and the player stat-sheet UI are OUT of scope
// for this module (run loop / Codex); this module only knows "given a level,
// how much PL, and how does it turn into stats."
//
// Titles (e.g. "Elite" = +2 levels of stats) are NOT built here — a future
// caller just passes a higher effective `level` into `scaleMonsterToLevel`.

import type { BuffableStat, CombatantSetup, CombatantStats, EnemyDef } from '../engine/types';

/** All stats a level-up can be spent on (maxHp + the 6 BuffableStats). */
export type LevelStat = 'maxHp' | BuffableStat;

/** Fixed order used for deterministic iteration/tie-breaks — no RNG. */
const STAT_ORDER: LevelStat[] = ['maxHp', 'attack', 'magicPower', 'armor', 'magicResist', 'speed'];

export type Allocation = Partial<Record<LevelStat, number>>;

/** Integer weight profile per stat, used by `allocateMonsterPL` for monster identities. */
export type StatProfile = Record<LevelStat, number>;

const ZERO_PROFILE: StatProfile = {
  maxHp: 0,
  attack: 0,
  magicPower: 0,
  armor: 0,
  magicResist: 0,
  speed: 0,
};

function profile(weights: Partial<StatProfile>): StatProfile {
  return { ...ZERO_PROFILE, ...weights };
}

/** Fallback profile for any monster id not explicitly listed below: a flat, balanced spend. */
export const DEFAULT_PROFILE: StatProfile = profile({
  maxHp: 2,
  // Former critPct weight (1) folded into attack (offense-leaning).
  attack: 2,
  magicPower: 1,
  armor: 1,
  magicResist: 1,
  speed: 1,
});

/**
 * Per-monster identity weight profiles, one per current roster id. Weights
 * are relative (integers); only their RATIO matters — a profile's absolute
 * weight total does not change how much PL it spends (that is fixed by
 * `monsterLevelPL`, level-only) nor is it comparable across monsters; two
 * profiles with the same ratio (e.g. `{attack:3,speed:2}` vs
 * `{attack:6,speed:4}`) allocate identically at every level. Add an entry
 * here for every new monster id content-designer ships — unlisted ids fall
 * back to DEFAULT_PROFILE.
 *
 * Since every monster now shares the SAME level-1 floor statline as the
 * player, these weights are the ONLY thing left carrying stat identity as a
 * monster levels up (e.g. `ember_imp`/`mage` carry zero `maxHp` weight —
 * they stay glass cannons because they simply never buy HP; a caster like
 * `seraph` grants itself a little `maxHp` alongside its magic stats to feel
 * sturdier).
 *
 * Theme pass (2026-08-18): re-audited every weight against the theme each
 * monster's cards/comments now declare in `src/data/enemies.ts` (content-
 * designer's same-date re-kit pass). `giant_rat` and `rogue` (now "Lancer")
 * were carrying weights from concepts the roster no longer has (an
 * attack-first rat, and the deleted poison-crit assassin — crit removed
 * from the engine 2026-07-23) and are fixed below; every other profile was
 * checked against its declared theme and left unchanged (see
 * docs/enemy-design.md for the per-monster reasoning).
 */
export const MONSTER_PROFILES: Record<string, StatProfile> = {
  // --- Basic floor ---
  // THIEF (2026-08-18): was attack-dominant (`attack:3, speed:2`), which grew
  // a rat that hits harder than it runs — backwards for "the roster's
  // fastest, lightest" board (see enemies.ts comment: chip damage from a
  // bite + a poison tick, not one big hit). Speed is now dominant, attack
  // stays secondary chip damage, maxHp stays the profile's smallest weight
  // (light). Total weight kept at 7 (unchanged) purely so the before/after
  // magnitude is easy to eyeball — the ratio is what carries identity, not
  // the total (see doc comment above).
  giant_rat: profile({ speed: 4, attack: 2, maxHp: 1 }),
  stone_beetle: profile({ maxHp: 3, armor: 3, attack: 1 }),
  ember_imp: profile({ magicPower: 5, speed: 1 }),

  // --- Elite / boss floor ---
  bandit_duelist: profile({ attack: 3, speed: 2, maxHp: 1 }),
  wolf_king: profile({ attack: 3, maxHp: 2, speed: 1 }),

  // --- Signature roster ---
  seraph: profile({ magicPower: 3, magicResist: 3, maxHp: 1 }),
  knight: profile({ maxHp: 3, armor: 3, attack: 1 }),
  mage: profile({ magicPower: 6 }),
  hunter: profile({ speed: 3, attack: 4 }),
  // LANCE (2026-08-18), was `{speed:2, attack:5}` with ZERO maxHp/armor
  // weight — a pure-burst-glass shape left over from the deleted poison-crit
  // assassin concept the id used to be. Renamed/re-kitted to Lancer, a
  // reach-and-thrust skirmisher (lance_thrust/crippling_strike/hamstring),
  // which is still offense-led (attack stays the dominant weight) but is no
  // longer the zero-survivability assassin read — it now buys a little
  // maxHp as it levels, same pattern every other non-glass-cannon melee
  // identity on the roster uses (bandit_duelist, wolf_king, berserker).
  rogue: profile({ attack: 4, speed: 2, maxHp: 1 }),
  berserker: profile({ attack: 3, maxHp: 3 }),
  necromancer: profile({ magicPower: 3, magicResist: 3 }),
  cleric: profile({ magicPower: 2, magicResist: 2, maxHp: 2 }),

  // --- 2026-08-19 keyword-family roster expansion (docs/enemy-design.md) ---
  // TOXIC DRUID: nature poisoner. Two of its three cards (thorn_bite,
  // blooming_vine) are pure "damage (+MATK) + poison" hits; the third
  // (poison_bloom) is poison + a "heal (+MDEF)" sustain line — magicPower
  // is still the dominant read (2 of 3 cards, and it IS the damage/poison
  // stat), magicResist gets a much lighter secondary weight for the one
  // self-heal card, and it carries zero maxHp — same glass-poisoner shape
  // as Ember Imp/Mage, since nothing on its board buys survivability
  // directly (its own heal is the sustain, not raw HP).
  toxic_druid: profile({ magicPower: 4, magicResist: 1 }),
  // REAVER: axe bleed duelist. All three cards (gutting_cleave, hemorrhage,
  // armor_break) are physical hits that scale off (+ATK) — attack is the
  // whole kit's stat, so it stays the dominant weight, same as every other
  // axe/attack duelist (rogue, berserker). A little maxHp is folded in
  // (same pattern bandit_duelist/rogue/berserker all use) since bleed is a
  // damage-over-time race — Reaver needs to still be standing for its own
  // stacked bleed ticks and follow-up hits to matter, not just its opener.
  // No speed weight: unlike rogue/hunter (explicit speed identity) or
  // Warbreaker (tempo), nothing on this board reads "fast" — it wins by
  // piling damage, not by acting first.
  bleed_reaver: profile({ attack: 4, maxHp: 2 }),
  // WARBREAKER: axe tempo-denial brute. Shockwave Slam/Shield Splitter both
  // scale damage off (+ATK), but the card the enemy comment calls out is
  // the SPREAD BURDEN (its tempo tax), not the raw damage sink — Warbreaker
  // wants to keep landing hits (and therefore keep re-taxing the band) more
  // than it wants to out-damage anyone in one swing. attack and speed are weighted
  // evenly (unlike bandit_duelist's attack-led 3:2 split) to read as
  // "tempo-first" rather than "duelist with some speed"; a light maxHp
  // weight keeps it from being a pure glass burst piece, matching every
  // other non-glass melee identity on the roster.
  warbreaker: profile({ attack: 3, speed: 3, maxHp: 1 }),
  // THORNBACK: beast thorns+shield tank. thorns is a flat stack count (no
  // scaling stat at all — it punishes hits by COUNT, not by a stat term)
  // and Bulwark Thicket's shield scales off (+DEF); Savage Bite is the
  // board's only offense and a minor chip line. Bulk is what actually
  // serves this identity ("sits behind a big shield and counter-punches
  // forever") — maxHp/armor dominant, same ratio as the roster's other
  // armored tank pairs (Stone Beetle, Knight), with attack kept as the
  // same small residual weight those two use for their own minor swing.
  thorn_beast: profile({ maxHp: 3, armor: 3, attack: 1 }),
  // SENTINEL: sword warded-protector elite. Unbreakable Stance's ward+guard
  // is flat (no stat term), but both Iron Bulwark's AND Unbreakable
  // Stance's higher-tier shields scale off (+DEF), and it is explicitly
  // authored as "the wall" — the roster's hardest denial pick. Armor is
  // weighted slightly above maxHp (reversed from Knight/Stone Beetle's
  // even split) to read as more shield-and-mitigation-first than a plain
  // HP tank; Sword Slash is its only offense, so attack stays the same
  // small residual weight the other armored identities carry.
  warded_sentinel: profile({ armor: 4, maxHp: 3, attack: 1 }),

  // --- 2026-08-21 synergy-rider roster expansion (docs/enemy-design.md) ---
  // VENOM STALKER: beast poison->exploit ambusher. Both cards (venom_fang,
  // second_bite) scale off (+ATK), so attack stays the dominant weight, same
  // as the roster's other beast/axe attack-first identities; a little maxHp
  // is folded in because the whole point of this kit is a two-cast LOOP
  // (apply poison, exploit it, re-apply) — it needs to survive long enough
  // for that loop to run more than once, unlike a single-swing glass piece.
  venom_stalker: profile({ attack: 3, maxHp: 2, speed: 1 }),
  // PYRE ACOLYTE: fire caster, burn->stackBonus. All three cards
  // (cinder_dart, ember_lash, burn_detonator) scale off (+MATK), so
  // magicPower stays dominant, same shape as Ember Imp/Mage/Toxic Druid; a
  // speed weight (unlike Ember Imp's near-zero) is added because the combo's
  // whole payoff depends on landing Burn Detonator BEFORE its own burn
  // stacks halve away, so a faster Acolyte banks a bigger detonation more
  // often. A light maxHp keeps it from being a total glass cannon, since
  // this kit needs at least one extra turn of standing to sequence its own
  // combo, unlike Ember Imp's simple DoT-and-wait attrition.
  pyre_acolyte: profile({ magicPower: 4, speed: 2, maxHp: 1 }),
  // SHIELD WARDEN: sword shieldBurst tank. Iron Bulwark's shield AND Aegis
  // Charge's own burst both scale off (+DEF) (a bigger shield banked means a
  // bigger burst spent), so armor/maxHp stay the dominant pair, same ratio
  // as the roster's other armored-tank identities (Stone Beetle, Knight,
  // Thornback) — attack is kept as the same small residual weight those
  // three use for their own minor swing (Aegis Charge's flat 14 (+ATK) line).
  shield_warden: profile({ maxHp: 3, armor: 3, attack: 1 }),
  // BLOODLETTER: axe bleed->stackBonus duelist. Both cards (rupturing_strike,
  // bleed_executioner) scale off (+ATK), so attack stays dominant, same as
  // Reaver/Berserker/Rogue; a speed weight (unlike Reaver's zero) is added to
  // read as a nimble duelist landing its opener quickly rather than a slow
  // brute grinding it out, and a light maxHp keeps it standing for its own
  // two-card sequence to land in full.
  blood_duelist: profile({ attack: 3, speed: 2, maxHp: 1 }),
};

/** Profile lookup for an enemy id, falling back to DEFAULT_PROFILE. */
export function profileFor(enemyId: string): StatProfile {
  return MONSTER_PROFILES[enemyId] ?? DEFAULT_PROFILE;
}

// ---------------------------------------------------------------------------
// The ONE PL-budget leveling economy (locked design, 2026-07-23/24). Both the
// player and every monster spend from this same priced table; only WHO
// decides the spend differs (player picks by hand, monsters auto-spend via
// their profile weights through `allocateMonsterPL`).
// ---------------------------------------------------------------------------

/** Fixed PL granted per level (locked design: 3 PL/level), for player AND monsters. */
export const PL_PER_LEVEL = 3;

/** Price of one "buy" on a given stat: costs `pl`, grants `gain` flat stat points. */
export interface LevelStatCost {
  pl: number;
  gain: number;
}

/**
 * Per-stat buy price for the unified PL-budget leveling economy — shared by
 * the player and every monster.
 */
export const LEVEL_STAT_COST: Record<LevelStat, LevelStatCost> = {
  attack: { pl: 1, gain: 1 },
  magicPower: { pl: 1, gain: 1 },
  armor: { pl: 1, gain: 1 },
  magicResist: { pl: 1, gain: 1 },
  speed: { pl: 2, gain: 1 },
  maxHp: { pl: 1, gain: 5 },
};

/** Total PL banked at `level` (level 1 = 0 PL, no points spent yet). */
export function totalLevelPL(level: number): number {
  return Math.max(0, level - 1) * PL_PER_LEVEL;
}

/**
 * PL spent by an allocation, where `alloc[stat]` is the number of BUYS on
 * that stat (not raw stat points) — each buy costs `LEVEL_STAT_COST[stat].pl`.
 */
export function spentPL(alloc: Allocation): number {
  return STAT_ORDER.reduce((sum, stat) => sum + (alloc[stat] ?? 0) * LEVEL_STAT_COST[stat].pl, 0);
}

/** PL left unspent (banked) at `level` after `alloc`'s buys. Can go negative for an invalid over-spend. */
export function bankedPL(level: number, alloc: Allocation): number {
  return totalLevelPL(level) - spentPL(alloc);
}

/** True if `alloc`'s buys fit within the PL banked at `level` (bankedPL >= 0). */
export function canAfford(level: number, alloc: Allocation): boolean {
  return bankedPL(level, alloc) >= 0;
}

/**
 * Apply a PL-budget allocation (buy counts per stat) to base stats, returning
 * a NEW stats object. Each buy on a stat adds `LEVEL_STAT_COST[stat].gain`;
 * maxHp buys also raise current hp by the same amount. A NEGATIVE buy count
 * un-buys (subtracts) at the same rate — used by the monster title path
 * (e.g. Mob's demotion spends negative PL). Pure — never mutates `base`.
 * Shared by both the player and monster scaling paths.
 */
export function applyLevelAllocation(base: CombatantStats, alloc: Allocation): CombatantStats {
  const next: CombatantStats = { ...base };
  let hpAdded = 0;
  for (const stat of STAT_ORDER) {
    const buys = alloc[stat] ?? 0;
    if (buys === 0) continue; // buys may be NEGATIVE (monster title "un-buys" — see allocateMonsterPL)
    const add = buys * LEVEL_STAT_COST[stat].gain;
    if (stat === 'maxHp') {
      next.maxHp += add;
      hpAdded += add;
    } else {
      next[stat] += add;
    }
  }
  next.hp += hpAdded;
  return next;
}

/**
 * Guarded entry point for the PL-budget economy: applies `alloc` to `base`,
 * but throws (reject rather than silently clamp) if `alloc` spends more PL
 * than is banked at `level`. Used directly by the player path; the monster
 * path (`scaleMonsterToLevel`) builds its allocation via `allocateMonsterPL`,
 * which by construction never over-spends.
 */
export function applyPlayerLevelAllocation(base: CombatantStats, level: number, alloc: Allocation): CombatantStats {
  const banked = bankedPL(level, alloc);
  if (banked < 0) {
    throw new Error(
      `applyPlayerLevelAllocation: over-spend (${spentPL(alloc)} PL spent, ${totalLevelPL(level)} PL available at level ${level})`,
    );
  }
  return applyLevelAllocation(base, alloc);
}

// ---------------------------------------------------------------------------
// Monster auto-spend: turns a monster's identity profile into a PL-budget
// allocation, deterministically.
// ---------------------------------------------------------------------------

/**
 * Spend `totalPL` as a sequence of individual stat "buys" (priced via
 * `LEVEL_STAT_COST`), across the stats weighted by `weights`, deterministically.
 * `totalPL` may be NEGATIVE (a demoted title like Mob "un-buys" stats) — see
 * the direction note below.
 *
 * ALGORITHM — greedy weighted-share deficit, one buy at a time:
 *   1. Only stats with a positive profile weight are eligible ("weighted").
 *   2. Split `totalPL` into a `direction` (+1 spend / -1 un-spend) and a
 *      non-negative `magnitude` — the rest of the algorithm works purely in
 *      magnitude terms, then every buy count gets `direction` applied at the
 *      end (so spending and un-spending follow the identical proportional
 *      logic, just adding vs. subtracting).
 *   3. At each step, for every AFFORDABLE weighted stat (its buy's PL cost
 *      fits in the magnitude remaining), compute its "weight-share deficit":
 *        targetShare(stat) = magnitude * weight(stat) / totalWeight
 *        deficit(stat)      = targetShare(stat) - plAlreadySpentOnStat(stat)
 *      i.e. how far below its proportional share of the whole budget that
 *      stat currently sits.
 *   4. Buy one unit of the stat with the LARGEST deficit (ties broken by
 *      fixed `STAT_ORDER`, first-in-order wins — no RNG). Deduct its PL cost
 *      from the remaining magnitude and repeat.
 *   5. Stop when no weighted stat is affordable any more — any leftover
 *      magnitude (necessarily smaller than the cheapest weighted stat's buy
 *      cost) is simply left unspent, by design (never over-spends, never
 *      invents fractional buys). For a negative `totalPL` this means a
 *      profile with only expensive weighted stats (e.g. only `speed`, at 2
 *      PL/buy) may not fully absorb an odd magnitude — the remainder (< the
 *      cheapest weighted stat's cost) is simply not deducted.
 *
 * NOTE: this operates purely in weight/PL-share terms and does NOT look at
 * the monster's actual current stat values — a heavily negative spend (e.g.
 * Mob's -12 PL) can therefore drive an "un-buy" allocation whose magnitude
 * exceeds what the monster's tiny floor stats can absorb (a 1-point `attack`
 * floor minus a full-weight un-buy easily goes negative). The CALLER
 * (`scaleMonsterToLevel`) is responsible for clamping the resulting stats to
 * a sane in-engine floor — this function only produces the buy counts.
 *
 * This generalizes the old ratio-based allocator to a priced table where
 * different stats cost different PL per buy (e.g. speed costs 2, everything
 * else 1) — a stat's "share" of the budget is judged in PL terms, not raw
 * buy-count terms, so a 2-PL stat naturally gets fewer buys for the same
 * weight. Integer-only, index-ordered, no RNG; the sum of |spent PL| is
 * always <= |totalPL|.
 */
export function allocateMonsterPL(totalPL: number, weights: StatProfile): Allocation {
  if (totalPL === 0) return {};

  const direction = totalPL > 0 ? 1 : -1;
  const magnitude = Math.abs(totalPL);

  const weighted = STAT_ORDER.filter((stat) => (weights[stat] ?? 0) > 0);
  if (weighted.length === 0) return {};

  const totalWeight = weighted.reduce((sum, stat) => sum + weights[stat]!, 0);
  const spentByStat: Record<LevelStat, number> = { maxHp: 0, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 0 };
  const alloc: Allocation = {};

  let remaining = magnitude;
  for (;;) {
    let bestStat: LevelStat | null = null;
    let bestDeficit = -Infinity;
    for (const stat of weighted) {
      const cost = LEVEL_STAT_COST[stat].pl;
      if (cost > remaining) continue;
      const targetShare = (magnitude * weights[stat]!) / totalWeight;
      const deficit = targetShare - spentByStat[stat];
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestStat = stat;
      }
    }
    if (!bestStat) break; // nothing weighted is affordable any more
    alloc[bestStat] = (alloc[bestStat] ?? 0) + direction;
    spentByStat[bestStat] += LEVEL_STAT_COST[bestStat].pl;
    remaining -= LEVEL_STAT_COST[bestStat].pl;
  }

  return alloc;
}

/**
 * Signed PL for MONSTER stat scaling: `(level - 1) * PL_PER_LEVEL`,
 * UNCLAMPED — unlike the player's `totalLevelPL`, this CAN go negative (a
 * demoted title like Mob passes a `level` below 1 here on purpose). Matches
 * `totalLevelPL` exactly for `level >= 1` (the only range the player economy
 * ever sees), so it is safe as the monster-side replacement without touching
 * the locked player function.
 */
export function monsterLevelPL(level: number): number {
  return (level - 1) * PL_PER_LEVEL;
}

/**
 * Clamp a scaled monster's stats to sane in-engine floors after a (possibly
 * negative) PL spend: offensive/defensive stats floor at 0, speed floors at
 * 1 (the engine's turn-order math assumes forward progress), maxHp floors at
 * 1 and hp is kept equal to it. A no-op for a purely positive spend (every
 * universal floor stat only ever grows from there).
 */
function clampMonsterStats(stats: CombatantStats): CombatantStats {
  const maxHp = Math.max(1, stats.maxHp);
  return {
    ...stats,
    maxHp,
    hp: maxHp,
    attack: Math.max(0, stats.attack),
    magicPower: Math.max(0, stats.magicPower),
    armor: Math.max(0, stats.armor),
    magicResist: Math.max(0, stats.magicResist),
    speed: Math.max(1, stats.speed),
  };
}

/**
 * Scale an enemy's floor definition up to `level`. Level 1 returns the floor
 * (base stats, 0 PL spent). `level` may be a Title-adjusted value below 1
 * (Mob's -4 levels can drive it negative) — the PL spend then goes negative
 * too, un-buying stats through the same profile weights, and the result is
 * clamped to a sane floor (see `clampMonsterStats`). Board/pieces/affinities
 * carry over unchanged — only stats scale, via the SAME PL-budget economy
 * the player uses (`monsterLevelPL` for the signed budget, `allocateMonsterPL`
 * to auto-spend it against the monster's identity profile,
 * `applyLevelAllocation` to apply the resulting buys).
 *
 * Hook for titles: a caller wanting an "Elite"/"Mob"/etc. version of a
 * monster just passes a higher (or lower) effective `level` here (e.g.
 * baseLevel + 2, or baseLevel - 4); no separate title system lives in this
 * module.
 */
export function scaleMonsterToLevel(enemy: EnemyDef, level: number): CombatantSetup {
  const totalPL = monsterLevelPL(level);
  const alloc = allocateMonsterPL(totalPL, profileFor(enemy.id));
  const stats = clampMonsterStats(applyLevelAllocation(enemy.stats, alloc));
  return {
    name: enemy.name,
    stats,
    boardSize: enemy.boardSize,
    pieces: enemy.pieces,
    elementAffinity: enemy.elementAffinity,
    weaponAffinity: enemy.weaponAffinity,
  };
}
