import type { Element, EnemyDef, SkillDef, WeaponType } from '../engine/types';
import { boardAffinities, cardType } from '../engine/combat/typeIdentity';
import type { BiomeLean } from '../data/biomes';
import { skillBook } from '../data/skills';
import { resolveEncounterForEnemy } from './encounter';

/**
 * VALIDATORS for the enemy-growth-by-level design (Q3, `docs/superpowers/
 * specs/2026-09-06-enemy-growth-by-level-design.md`) — three pure functions,
 * each asserting a PROPERTY of the resolved (grown) board at
 * `GROWTH_VALIDATION_LEVEL`, not a specific enemy's content. They are green
 * TODAY only for whichever of the 59 enemies already clear the bar on their
 * own board (no growth list authored yet, so growth only ever ADDS RANK —
 * see `EnemyDef.growth`'s doc comment); making every enemy pass is the
 * SEPARATE content-authoring pass this module deliberately does not do (no
 * `growth` milestone sequence is populated here). Candidate family, duplicate,
 * fit and completion rules are enforced by the same production resolver these
 * validators call; invalid earned milestones throw its structured diagnostic.
 *
 * WHY LEVEL 2. `growthStepsAt(2) === 1` (`encounter.ts`) — the first level at
 * which ANY growth step has fired. Q7 rules an inert gate at level 1
 * acceptable; these validators are the mechanical enforcement of "every gated
 * card must be live from level 2".
 */
export const GROWTH_VALIDATION_LEVEL = 2;

/**
 * The board this enemy actually FIELDS at `level` — growth resolved via the
 * SAME production path `rollEncounter`/`buildEnemyEncounter` use
 * (`resolveEncounterForEnemy`, the def-taking core `buildEnemyEncounter`
 * delegates to), at a flat `'normal'` title (no rank/extraCards/affix noise)
 * so only growth's own contribution is visible. `growthLevel` is passed
 * explicitly equal to `level` (the default already does this for a solo-style
 * call, but naming it keeps this call site self-documenting).
 */
function maturePieces(enemy: EnemyDef, level: number): readonly { skillId: string }[] {
  return resolveEncounterForEnemy(enemy, level, 'normal', undefined, [], null, undefined, null, level).setup.pieces;
}

/** The element/weapon affinity this enemy's board derives at `level` — the
 * SAME rule `boardAffinities` (`typeIdentity.ts`) gives the engine, applied to
 * the GROWN board rather than the authored floor. */
export function matureAffinityAt(
  enemy: EnemyDef,
  level: number,
): { elementAffinity?: Element; weaponAffinity?: WeaponType } {
  const pieces = maturePieces(enemy, level);
  const skills = pieces
    .map((p) => skillBook[p.skillId])
    .filter((s): s is SkillDef => s !== undefined);
  const { element, weapon } = boardAffinities(skills);
  return { elementAffinity: element, weaponAffinity: weapon };
}

/**
 * VALIDATOR 1 — earns an affinity (either axis) by `GROWTH_VALIDATION_LEVEL`.
 * `true` = the growth mechanism has done its one, non-negotiable job for this
 * enemy: SOME axis clears `IDENTITY_THRESHOLD` by level 2, board-derived,
 * same rule the engine itself uses.
 */
export function earnsAffinityByLevel2(enemy: EnemyDef): boolean {
  const affinity = matureAffinityAt(enemy, GROWTH_VALIDATION_LEVEL);
  return affinity.elementAffinity !== undefined || affinity.weaponAffinity !== undefined;
}

/** Validator 2: the level-2 board earns the listing band's lean on its own axis. */
export function affinityMatchesBandAtLevel2(enemy: EnemyDef, lean: BiomeLean): boolean {
  const affinity = matureAffinityAt(enemy, GROWTH_VALIDATION_LEVEL);
  return lean.kind === 'element' ? affinity.elementAffinity === lean.type
    : affinity.weaponAffinity === lean.type;
}

/**
 * VALIDATOR 3 — every `{{Affinity}}`-gated card on this enemy's GROWN board
 * has its gate OPEN at `GROWTH_VALIDATION_LEVEL` (Q7: "every gated card must
 * be live from level 2"). Mirrors `bossRoster.test.ts`'s identical check,
 * generalized from the boss roster to any enemy — `affinityOpen`
 * (`src/engine/combat/interpreter.ts`) checks the CASTER's affinity against
 * the CARD's own type, so a gated line whose type the mature board does not
 * derive is dead weight the player paid the half-price gate discount for and
 * never gets.
 */
export function everyGatedCardOpenAtLevel2(enemy: EnemyDef): boolean {
  const pieces = maturePieces(enemy, GROWTH_VALIDATION_LEVEL);
  const affinity = matureAffinityAt(enemy, GROWTH_VALIDATION_LEVEL);
  const earned: string[] = [];
  if (affinity.elementAffinity) earned.push(`element:${affinity.elementAffinity}`);
  if (affinity.weaponAffinity) earned.push(`weapon:${affinity.weaponAffinity}`);
  for (const piece of pieces) {
    const skill = skillBook[piece.skillId];
    if (!skill) continue;
    const type = cardType(skill);
    for (const action of skill.effects) {
      if (action.affinity !== true) continue;
      if (!type) return false; // a typeless card can never open a gate it carries
      if (!earned.includes(`${type.kind}:${type.type}`)) return false;
    }
  }
  return true;
}
