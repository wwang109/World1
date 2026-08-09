import { createHash } from 'node:crypto';

/**
 * THE one hash used by the outcome-baseline regression lock — shared by the
 * capture script (`tests/engine/fixtures/captureOutcomeBaseline.ts`) and its
 * consumer (`tests/engine/outcomeRule.test.ts`) so the two can never drift.
 *
 * WHY A NORMALIZER: the hashed structure includes `finalState`, whose
 * `pieces[].skill` holds the fully resolved `SkillDef` — card `text` and `name`
 * included. Those are PRESENTATION ONLY: the simulation never reads either
 * (`text` is touched exactly once, by `retextScaledNumbers` in
 * `src/engine/cards.ts`, purely to re-word a scaled card). Hashing them made a
 * content-only copy-edit look like an engine regression and forced a pointless
 * fixture regeneration.
 *
 * So the normalizer strips those two and NOTHING else. Every field the sim
 * actually consumes still feeds the hash and is still guarded byte-for-byte:
 * id, archetypes, property, size, speedWeight, cooldownTurns, tier, rarity,
 * element, weapon, effects, scope, aura, special, tierUpgrades — plus the whole
 * event log and all combatant state (including each combatant's own `name`,
 * which is a config input, not card copy).
 *
 * ---------------------------------------------------------------------------
 * KEYS ARE SORTED (2026-08-09). `outcomeHash` finishes with `JSON.stringify`,
 * which serialises keys in INSERTION order — so before this change the physical
 * FIELD ORDER of every hashed object fed the hash. That made the lock sensitive
 * to a thing that is not a behaviour: the card literals in `src/data/skills.ts`
 * order their fields inconsistently (some put `weapon` before `size`, some
 * after), so ANY code that rebuilt a `SkillDef` in a different-but-equivalent
 * key order re-hashed all 400 cases while changing no value the sim reads.
 *
 * That was a live trap on the content-format migration: a loader constructing
 * `SkillDef` objects from JSON necessarily picks its own key order, and would
 * have moved every hash for a provably behaviour-neutral change — the exact
 * "regeneration that hides a real regression" failure this fixture exists to
 * prevent. Sorting here makes the hash a function of the VALUES only, so key
 * order is permanently outside the lock and no future loader, spread, or
 * refactor can churn it.
 *
 * Sorting does NOT weaken the lock: no two distinct field sets collide, because
 * the key NAMES are still serialised alongside their values. It only removes
 * ORDER as a signal, and order was never a behaviour — nothing in the engine
 * iterates `Object.keys` of a `SkillDef` to make a decision.
 */

/** Is this a resolved `SkillDef` (the only place card copy lives)? */
function isSkillDef(o: Record<string, unknown>): boolean {
  return typeof o.id === 'string' && Array.isArray(o.effects) && typeof o.property === 'string';
}

/**
 * Deep copy with presentation-only card fields removed and keys in CANONICAL
 * (sorted) order, so the hash depends on values alone.
 * - `text` is dropped anywhere: no engine-consumed field is ever named `text`
 *   (a `TierUpgrade` carries one too, and it is equally cosmetic).
 * - `name` is dropped ONLY on SkillDef-shaped objects, so `CombatantState.name`
 *   — a real config input — keeps being guarded.
 * - ARRAY order is preserved exactly. Only OBJECT KEY order is canonicalised:
 *   array order IS behaviour here (effects fire in order, the event log is a
 *   sequence), so sorting one would destroy the lock rather than stabilise it.
 */
export function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    const out = new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i += 1) out[i] = normalizeForHash(value[i]);
    return out;
  }
  if (value === null || typeof value !== 'object') return value;
  const src = value as Record<string, unknown>;
  const skillDef = isSkillDef(src);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) {
    if (key === 'text') continue;
    if (key === 'name' && skillDef) continue;
    out[key] = normalizeForHash(src[key]);
  }
  return out;
}

/** Stable 32-hex-char digest of the normalized structure. */
export function outcomeHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(normalizeForHash(value))).digest('hex').slice(0, 32);
}
