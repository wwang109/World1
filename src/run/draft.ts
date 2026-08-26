// Start-of-game draft — pure run-layer roll for the new-game card pick. The
// player picks exactly 1 card from each of 4 sets of 5 (3 themed + 1 wildcard);
// the pick logic itself is UI-side (trivial), this module only rolls the sets.
// Deterministic: same seed -> identical sets, no Date.now/Math.random (engine
// Rng only).

import { hashSeed, Rng } from '../engine/rng';
import { skillBook } from '../data/skills';
import { cardOfferableAtTier } from '../engine/types';
import type { SkillDef } from '../engine/types';

export interface DraftCard {
  skillId: string;
  /**
   * BRONZE, AS A LITERAL TYPE, DELIBERATELY. The start draft (and every event
   * mini-draft that reuses this shape, `src/run/events.ts`) hands cards over for
   * FREE — there is no price to re-derive, so a card clamped up to a higher tier
   * would be a silent free upgrade. The tier-minimum rule is therefore honoured
   * here by EXCLUSION, not by clamping: the draw pools contain only cards that
   * are genuinely offerable at Bronze (`cardOfferableAtTier`), which is what lets
   * this field stay a literal instead of widening to `SkillTier`. See
   * `rollStartDraft` below, and `offeredTierForCard` in `shop.ts` for the priced
   * surface that went the other way.
   */
  tier: 'bronze';
}

export interface StartDraft {
  /** Archetype 'offense'. */
  offense: DraftCard[];
  /** Archetype 'defensive' OR 'healing' — defense/sustain. */
  defense: DraftCard[];
  /** Archetype 'support' OR 'debuff' — support/utility. */
  support: DraftCard[];
  /** Anything left in the book — the un-themed fourth pick. */
  wildcard: DraftCard[];
}

export type DraftSetKey = keyof StartDraft;
/** Presentation order for the four sets. */
export const DRAFT_SET_KEYS: readonly DraftSetKey[] = ['offense', 'defense', 'support', 'wildcard'];

const SET_SIZE = 5;

function toDraftCard(skill: SkillDef): DraftCard {
  return { skillId: skill.id, tier: 'bronze' };
}

/** Draw `count` DISTINCT items from `pool` via `rng.int`, fixed call order. */
function sampleDistinct(rng: Rng, pool: readonly SkillDef[], count: number): SkillDef[] {
  const remaining = [...pool];
  const result: SkillDef[] = [];
  const n = Math.min(count, remaining.length);
  for (let i = 0; i < n; i++) {
    const idx = rng.int(remaining.length);
    result.push(remaining[idx]!);
    remaining.splice(idx, 1);
  }
  return result;
}

/**
 * Fill one themed set of `SET_SIZE` distinct cards, excluding ids already
 * used by an earlier-processed set. If the theme's own pool (after exclusion)
 * underfills, backfill deterministically from the FULL remaining skill pool
 * (same Rng, same fixed call order) so every set always reaches SET_SIZE as
 * long as the whole book has enough distinct cards.
 */
function pickThemeSet(rng: Rng, themePool: readonly SkillDef[], fullPool: readonly SkillDef[], used: Set<string>): SkillDef[] {
  const available = themePool.filter((s) => !used.has(s.id));
  const picked = sampleDistinct(rng, available, SET_SIZE);
  if (picked.length < SET_SIZE) {
    const pickedIds = new Set(picked.map((s) => s.id));
    const fallback = fullPool.filter((s) => !used.has(s.id) && !pickedIds.has(s.id));
    picked.push(...sampleDistinct(rng, fallback, SET_SIZE - picked.length));
  }
  for (const s of picked) used.add(s.id);
  return picked;
}

/**
 * Roll the new-game draft: 4 sets of 5 distinct bronze-tier cards — offense /
 * defense-sustain / support-utility / wildcard — no duplicate id anywhere
 * across all 20. The three THEMED sets are processed smallest candidate pool
 * first (stable tie-break: offense, defense, support) so a bigger/overlapping
 * pool never starves a small one; the wildcard set always rolls LAST from
 * whatever the themes did not take (any card in the book qualifies).
 */
export function rollStartDraft(seed: number): StartDraft {
  const rng = new Rng(hashSeed('draft', seed));
  // BRONZE-OFFERABLE ONLY (`cardOfferableAtTier`, engine/types.ts) — the pool
  // filter that makes `DraftCard.tier`'s literal `'bronze'` true rather than
  // merely asserted. A card with no Bronze copy (authored above Bronze, or whose
  // whole payload is tier-locked above it) is EXCLUDED from every set, including
  // the wildcard set and the underfill backfill, because this draft is free and
  // has no price to raise alongside a clamped tier.
  //
  // NO Rng CALL CHANGES: `sampleDistinct` spends exactly one `rng.int` per slot
  // either way; a narrower pool only changes which card each existing draw
  // indexes to. Byte-identical for today's all-Bronze book (the filter removes
  // nothing), and `Array#filter` preserves the book's canonical id order, which
  // `tests/run/contentPoolOrder.test.ts` pins.
  const all = Object.values(skillBook).filter((s) => cardOfferableAtTier(s, 'bronze'));

  const offensePool = all.filter((s) => s.archetypes.includes('offense'));
  const defensePool = all.filter((s) => s.archetypes.includes('defensive') || s.archetypes.includes('healing'));
  const supportPool = all.filter((s) => s.archetypes.includes('support') || s.archetypes.includes('debuff'));

  const themes: { key: 'offense' | 'defense' | 'support'; pool: SkillDef[] }[] = [
    { key: 'offense', pool: offensePool },
    { key: 'defense', pool: defensePool },
    { key: 'support', pool: supportPool },
  ];
  // Stable sort (ties keep the offense/defense/support declaration order).
  const processingOrder = [...themes].sort((a, b) => a.pool.length - b.pool.length);

  const used = new Set<string>();
  const picks: Record<DraftSetKey, SkillDef[]> = { offense: [], defense: [], support: [], wildcard: [] };
  for (const { key, pool } of processingOrder) {
    picks[key] = pickThemeSet(rng, pool, all, used);
  }
  picks.wildcard = pickThemeSet(rng, all, all, used);

  return {
    offense: picks.offense.map(toDraftCard),
    defense: picks.defense.map(toDraftCard),
    support: picks.support.map(toDraftCard),
    wildcard: picks.wildcard.map(toDraftCard),
  };
}
