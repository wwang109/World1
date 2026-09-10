import type { Element, EnemyDef, SkillDef, WeaponType } from '../engine/types';
import { boardAffinities } from '../engine/combat/typeIdentity';
import { skillBook } from './skills';

/**
 * DERIVED READER for the non-combat surfaces that used to read an enemy's own
 * authored `elementAffinity`/`weaponAffinity` directly (the band-forecast
 * boss counter, the `combat.enemyDefeated` event fact, the signature-boss
 * roster tests). Those fields are no longer authored on any entry in
 * `src/data/enemies.ts` (2026-09-06 ruling: "affinity are just passive buffs
 * based on the board … there should be no hardcoded enemy that break the
 * rule") — this recomputes the SAME thing combat itself derives at setup
 * (`boardAffinities`, `IDENTITY_THRESHOLD = 3`,
 * `src/engine/combat/typeIdentity.ts`, the same function `initCombatant` now
 * calls) straight from the enemy's own `pieces`, so there is ONE rule for
 * what an enemy's affinity is — a second implementation here could drift
 * from the engine's and would be exactly the kind of hardcoded exception the
 * ruling closes.
 *
 * Returns BOTH axes independently (never the lossy single-type
 * `boardTypeIdentity`): a board can in principle carry an element affinity
 * AND a weapon affinity at once, and `elementAffinity?`/`weaponAffinity?`
 * staying separate optional fields here is what keeps this a drop-in
 * replacement for the deleted authored values at every call site.
 *
 * A SEPARATE MODULE FROM `src/data/enemies.ts` ON PURPOSE. Deriving an
 * affinity needs the skill book (`skillBook`, `./skills`) to resolve each
 * piece's `skillId` into a `SkillDef` before it can be typed — but
 * `enemies.ts` itself has ~20 other consumers (JSON parity/idempotency,
 * depth-band math, encounter generation, ...) that have never needed the
 * skill book and would otherwise start throwing at import time on any
 * unrelated skill-content problem the moment `enemies.ts` pulled it in
 * (found the hard way: `skills.v1.json` was mid-edit and failing its own
 * validator on this same tree while this file was being written). Isolating
 * the skillBook dependency here keeps every other `enemies.ts` consumer
 * exactly as decoupled as it always was.
 *
 * `EnemyDef.elementAffinity?`/`.weaponAffinity?` themselves are NOT deleted
 * from the type (`src/engine/types.ts`) — that file is owned by a parallel
 * in-flight change to the same 2026-09-06 ruling and is out of this change's
 * reach. No entry in `src/data/enemies.ts` sets them any more, and
 * `validateEnemyAffinityMatchesBoard` (`src/data/validateEnemyContent.ts`,
 * enforced by `tests/data/enemyAffinityGuard.test.ts`) is the permanent guard
 * against either field being re-authored with a value this function would
 * not itself produce.
 */
export function enemyDerivedAffinity(enemy: EnemyDef): { elementAffinity?: Element; weaponAffinity?: WeaponType } {
  const skills = enemy.pieces
    .map((piece) => skillBook[piece.skillId])
    .filter((skill): skill is SkillDef => skill !== undefined);
  const { element, weapon } = boardAffinities(skills);
  return { elementAffinity: element, weaponAffinity: weapon };
}
