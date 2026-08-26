// Biome resolution — the pure run-layer routing over `src/data/biomes.ts`.
//
// A BIOME is the identity of one WAVE BAND: `BAND_WAVES` waves ending in that
// band's boss. `bandIndexOf(wave)` is the band a wave belongs to, and
// `biomeForBand(seed, band)` is DEALT — a pure function of `(seed, band)`, not
// chosen (yet: the fork is Phase 3 of docs/biome-paths-proposal.md). Nothing
// here spends an `Rng` call from any existing stream: the deal is a `hashSeed`
// of its own domain, and every binding is a FILTER over a pool the generator
// was already drawing from.
//
// THE DETERMINISM CONTRACT THIS MODULE KEEPS (docs/biome-paths-proposal.md
// §2.3, and the reason the map's structure is byte-identical per seed before
// and after biomes existed):
//
//   Every biome binding is a PREFERENCE over a pool that is already being
//   drawn from. No binding spends a new `Rng` call. Only WHICH array an
//   existing draw indexes into changes.
//
// So `generateWave`'s call order (stop count -> choice counts -> shop count ->
// shop columns -> shop slot/theme -> event themes) is untouched, node ids and
// per-node seeds are untouched, and `hashSeed('wave', seed, wave)` is left
// exactly alone. What moves is the CONTENT a draw lands on: which stall theme,
// which event theme, which enemy id.
//
// NO COMBAT EFFECT, EVER (proposal §6.5). A biome never buffs, debuffs or
// modifies a fight. PL is the balance unit; a biome is supply and legibility.

import type { Element, WeaponType } from '../engine/types';
import { hashSeed } from '../engine/rng';
import { ELEMENT_BEATS, WEAPON_BEATS } from '../engine/elements';
import { biomeCatalog, biomeIds, type BiomeDef, type BiomeLean } from '../data/biomes';

/**
 * Waves per band — one boss block. MUST equal `BOSS_EVERY` in `runMap.ts`, and
 * `tests/run/biomeBands.test.ts` asserts exactly that rather than assuming it.
 *
 * Deliberately a local constant instead of an import: `runMap.ts` imports THIS
 * module (map-gen stamps the band's biome on every node it builds), so importing
 * `BOSS_EVERY` back from `runMap.ts` would create a value-level module cycle
 * that is read during module evaluation — the one import shape ESM does not
 * make safe. One asserted constant is cheaper than a fragile cycle.
 */
export const BAND_WAVES = 5;

/** The 0-indexed band a 1-indexed wave belongs to. Band 0 is waves 1..BAND_WAVES. */
export function bandIndexOf(wave: number): number {
  return Math.floor((Math.max(1, Math.floor(wave)) - 1) / BAND_WAVES);
}

/** First wave of a band (1-indexed). */
export function firstWaveOfBand(band: number): number {
  return Math.max(0, Math.floor(band)) * BAND_WAVES + 1;
}

/** The BOSS wave that closes a band (1-indexed) — the fight the forecast names. */
export function bossWaveOfBand(band: number): number {
  return (Math.max(0, Math.floor(band)) + 1) * BAND_WAVES;
}

/**
 * The biome DEALT to `band` of run `seed` — pure, integer-only, and independent
 * of every other draw in the run (its own `hashSeed` domain, no `Rng` instance
 * at all, so it cannot perturb map-gen's call order no matter when it is asked).
 *
 * NO IMMEDIATE REPEAT: band b never deals the same biome as band b-1 — a run
 * that spent five waves in the Emberwaste and then spends five more there has
 * no path in it. Implemented by dealing band b out of the OTHER `n-1` biomes
 * and shifting past the previous pick, which keeps the deal uniform over those
 * n-1 and keeps the whole thing a pure function of `(seed, band)`. The walk from
 * band 0 is O(band) with band <= runLength/5 — trivially cheap, and it is what
 * makes the rule stateless (no ledger to persist, so a reload re-derives it).
 */
export function biomeIdForBand(seed: number, band: number): string {
  const n = biomeIds.length;
  if (n === 0) throw new Error('biomeIdForBand: the biome catalog is empty');
  const target = Math.max(0, Math.floor(band));
  let prev = -1;
  let idx = 0;
  for (let i = 0; i <= target; i++) {
    const h = hashSeed('biome', seed, i);
    if (prev < 0 || n === 1) {
      idx = h % n;
    } else {
      const r = h % (n - 1);
      idx = r >= prev ? r + 1 : r;
    }
    prev = idx;
  }
  return biomeIds[idx]!;
}

/** The `BiomeDef` dealt to `band` of run `seed`. */
export function biomeForBand(seed: number, band: number): BiomeDef {
  const id = biomeIdForBand(seed, band);
  const def = biomeCatalog[id];
  if (!def) throw new Error(`biomeForBand: unknown biome id "${id}"`);
  return def;
}

/** The `BiomeDef` covering a 1-indexed wave of run `seed`. */
export function biomeForWave(seed: number, wave: number): BiomeDef {
  return biomeForBand(seed, bandIndexOf(wave));
}

/** Look up a stamped `RunNode.biomeId`, falling back to the deal for that wave
 * (a map generated before biomes existed, or a hand-built test node, carries no
 * stamp — it still gets its band's biome rather than an exception). */
export function biomeFor(seed: number, wave: number, biomeId?: string): BiomeDef {
  if (biomeId !== undefined) {
    const def = biomeCatalog[biomeId];
    if (def) return def;
  }
  return biomeForWave(seed, wave);
}

/**
 * How many times a biome's own mobs are repeated inside a fight node's draw
 * pool by `weightIds` — the "mostly, not only" dial. Measured at 60 seeds x 20
 * waves (see `tests/run/biomeMobs.test.ts`): a HARD filter on mobs took the
 * share of fight columns whose three options are three DIFFERENT enemies from
 * 62% (the pre-biome baseline recorded in docs/biome-paths-proposal.md §1.6)
 * down to 9%, with bands that fielded a single enemy for five straight waves —
 * because a biome's mob list intersects a depth tier at 1-2 ids. Weighting
 * keeps the band's identity dominant while leaving every depth-eligible enemy
 * genuinely reachable inside it, and still spends exactly ONE `rng.int` call.
 */
export const BIOME_MOB_WEIGHT = 3;

/**
 * The MOB binding: a weighted preference, not a silo. Returns `pool` with the
 * entries `preferred` names repeated `weight` times IN FRONT of the untouched
 * full pool, so a single `rng.int(pool.length)` draw lands on a biome mob most
 * of the time and on the rest of the depth-eligible roster the remainder — one
 * Rng call either way, and pool ORDER is still fully determined by the input's
 * order (no Set, no sort, no shuffle).
 *
 * Degenerates correctly: an empty `preferred`, an empty `pool`, or a biome whose
 * mobs do not intersect this depth all return `pool` unchanged, which is exactly
 * today's behaviour.
 */
export function weightIds(
  pool: readonly string[],
  preferred: readonly string[],
  weight: number = BIOME_MOB_WEIGHT,
): readonly string[] {
  if (preferred.length === 0 || pool.length === 0 || weight <= 0) return pool;
  const kept = pool.filter((id) => preferred.includes(id));
  if (kept.length === 0 || kept.length === pool.length) return pool;
  const weighted: string[] = [];
  for (let w = 0; w < weight; w++) {
    for (let i = 0; i < kept.length; i++) weighted.push(kept[i]!);
  }
  for (let i = 0; i < pool.length; i++) weighted.push(pool[i]!);
  return weighted;
}

/**
 * THE HARD binding, used where exclusivity IS the promise (the shop theme scan
 * and the boss shortlist): narrow `pool` to the
 * entries `preferred` names, and fall back to the WHOLE `pool` when that would
 * leave nothing. Never removes anything from the game — a biome re-orders what
 * you meet first, it does not delete content (proposal §6.2), which is what
 * keeps every reachability audit green and stops a bad band being a dead end.
 *
 * Array-filtered, `includes` used only as a PREDICATE over an already-ordered
 * array — never a `Set` iteration — so `pool`'s order (which is what fixes the
 * draw for a seed) survives intact.
 */
export function preferIds(pool: readonly string[], preferred: readonly string[]): readonly string[] {
  if (preferred.length === 0 || pool.length === 0) return pool;
  const kept = pool.filter((id) => preferred.includes(id));
  return kept.length > 0 ? kept : pool;
}

/** "FIRE" / "AXE" — the lean chip. */
export function leanLabel(lean: BiomeLean): string {
  return lean.type.toUpperCase();
}

/**
 * The type that gets +50% against this biome's mobs (`ELEMENT_BEATS` /
 * `WEAPON_BEATS` in `src/engine/elements.ts`), or `undefined` when nothing
 * counters it (Beast sits outside the weapon triangle except for Bow).
 *
 * This is NOT decoration. A biome supplies its own type, and same-vs-same is
 * neutral, so building the lean inside the biome is safe — but the counter
 * farms it. Stating the counter is what makes "the Emberwaste supplies Fire"
 * a decision instead of a gotcha.
 */
export function counterTypeFor(lean: BiomeLean): string | undefined {
  if (lean.kind === 'element') {
    for (const [attacker, beaten] of Object.entries(ELEMENT_BEATS)) {
      if (beaten === lean.type) return attacker;
    }
    return undefined;
  }
  for (const [attacker, beaten] of Object.entries(WEAPON_BEATS)) {
    if (beaten === lean.type) return attacker;
  }
  return undefined;
}

/**
 * Every type that gets +50% against a COMBATANT carrying these affinities —
 * the per-enemy counterpart of `counterTypeFor`, which answers the same
 * question for a biome's declared LEAN. Both live here so the forecast cannot
 * derive one of them a second way and disagree with itself.
 *
 * WHY A LIST, NOT A TYPE. A combatant may carry an element affinity AND a
 * weapon affinity at once (`greenwood_sovereign` is nature + bow), and
 * `elements.ts` resolves the two matchups INDEPENDENTLY — a fire card gets its
 * +50% off the nature half whatever the weapon half says. So the honest answer
 * is every counter that applies, not the first one found.
 *
 * Sorted, so identical affinities always render an identical string, and
 * deduped (an element and a weapon counter can never collide today, but the
 * dedupe keeps the array a set without ever iterating a `Set`).
 *
 * EMPTY IS A REAL ANSWER, not a failure: an unaffined kit has no counter, and
 * neither does one whose only affinity is `bow` — `WEAPON_BEATS` has no
 * attacker mapping to it (bow beats beast; nothing beats bow).
 */
export function counterTypesFor(
  elementAffinity?: Element,
  weaponAffinity?: WeaponType,
): readonly string[] {
  const out: string[] = [];
  if (elementAffinity !== undefined) {
    const c = counterTypeFor({ kind: 'element', type: elementAffinity });
    if (c !== undefined && !out.includes(c)) out.push(c);
  }
  if (weaponAffinity !== undefined) {
    const c = counterTypeFor({ kind: 'weapon', type: weaponAffinity });
    if (c !== undefined && !out.includes(c)) out.push(c);
  }
  return out.sort();
}

export type { BiomeDef, BiomeLean };
