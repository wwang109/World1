// Board Type Identity: pure, integer-only, no RNG, no Date.
//
// Every card is typed by exactly one weapon or element (element takes priority;
// TRUE cards carry a cosmetic element/weapon). When a board leans hard into a
// single type — a unique type with the highest count on ITS OWN AXIS, that count
// >= 3 — the board takes on that type's affinity. See docs/board-type-identity.md.
//
// TWO AXES, TALLIED SEPARATELY (user ruling 2026-09-06: "affinity are just
// passive buffs based on the board … if they meet the requirements they should
// have the affinity effect"). Element and weapon are ORTHOGONAL: a combatant
// carries an `elementAffinity` AND a `weaponAffinity` (state.ts), the interpreter
// reads element for magical cards and weapon for physical ones (`cardMatchup`),
// and the affinity gate reads whichever axis the CARD's own type sits on
// (`affinityOpen`). Merging both axes into one tally therefore answered a
// question nothing asks: a board of 3 nature + 3 bow "tied" and earned NOTHING,
// even though each axis independently met the threshold. Now each axis is
// tallied on its own and a board may hold both. A tie WITHIN an axis (3 fire +
// 3 frost) still yields no affinity on that axis — that rule is unchanged, and
// it is the one a player going wide is most likely to trip over.
//
// THE BOARD IS THE ONLY SOURCE (same ruling: "there should be no hardcoded enemy
// that break the rule"). `initCombatant` derives both axes here and reads no
// authored value; the deprecated `CombatantSetup.elementAffinity` /
// `.weaponAffinity` fields are ignored by the engine.
//
// This module only DERIVES the affinities. Their effects are wired elsewhere
// through existing seams: the defensive attunement fold in `state.ts` (combatant
// setup) unlocks the weapon/element triangle (advantage +50% / disadvantage
// −25%) via `cardMatchup` in the interpreter. There is no flat same-type damage
// bonus, and an affinity still grants nothing offensive by itself.
//
// Since 2026-08-25 there is a SECOND, OPT-IN effect: ANY action may carry
// `affinity: true` (`AffinityGated`, ../types.ts) and then resolves only when the
// caster holds the affinity matching that card's own type (`affinityOpen` in the
// interpreter). Affinity is a MODIFIER, not a keyword — one gate check and one
// pricing refund cover every keyword in the game. It is opt-in per action and
// paid for per action, so this module's output still only DERIVES the affinity;
// nothing here decides what an affinity is worth. The core loop stays
// feature-agnostic.

import type { Element, SkillDef, WeaponType } from '../types';

/** A board's derived type identity: an element OR a weapon type. */
export type BoardIdentity =
  | { kind: 'element'; type: Element }
  | { kind: 'weapon'; type: WeaponType };

/**
 * BOTH AXES of a board's derived affinity. Either, both, or neither may be
 * present — they are independent tallies, not alternatives. This is the honest
 * shape and the one the engine consumes (`initCombatant` fills
 * `CombatantState.elementAffinity` / `.weaponAffinity` straight from it).
 */
export interface BoardAffinities {
  element?: Element;
  weapon?: WeaponType;
}

/** Cards of one unique top type needed for a board to take that affinity. */
export const IDENTITY_THRESHOLD = 3;

/**
 * Every card type whose count independently reaches the effect threshold.
 * Unlike `BoardAffinities`, this list does not choose a winner and does not
 * cancel tied types. It exists specifically for actions carrying
 * `affinity: true`; defensive matchup affinity remains the singular per-axis
 * calculation above.
 */
export function boardEffectAffinities(skills: readonly SkillDef[]): BoardIdentity[] {
  const keys: BoardIdentity[] = [];
  const counts: number[] = [];
  for (let i = 0; i < skills.length; i += 1) {
    const identity = cardType(skills[i]!);
    if (identity === undefined) continue;
    let index = keys.findIndex((key) => key.kind === identity.kind && key.type === identity.type);
    if (index === -1) {
      keys.push(identity);
      counts.push(0);
      index = keys.length - 1;
    }
    counts[index] = counts[index]! + 1;
  }
  const active: BoardIdentity[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    if (counts[i]! >= IDENTITY_THRESHOLD) active.push(keys[i]!);
  }
  return active;
}

/**
 * A card's single type: its `element` if present, else its `weapon`. Shipped
 * cards always have exactly one (enforced by tests/engine/elements.test.ts);
 * an untyped card (only reachable via bespoke test books) returns `undefined`
 * and is simply ignored by the identity tally rather than crashing the sim.
 */
export function cardType(skill: SkillDef): BoardIdentity | undefined {
  if (skill.element !== undefined) return { kind: 'element', type: skill.element };
  if (skill.weapon !== undefined) return { kind: 'weapon', type: skill.weapon };
  return undefined;
}

/**
 * ONE AXIS of the tally: the UNIQUE most-common value in `values` when its count
 * is >= `IDENTITY_THRESHOLD`, else `undefined` (too few, or an exact tie at the
 * top). Pure integer tally; the parallel `keys`/`counts` arrays are walked BY
 * INDEX and preserve first-seen order, so the result is identical every run.
 */
function topType<T extends string>(values: readonly T[]): T | undefined {
  const keys: T[] = [];
  const counts: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]!;
    let idx = keys.indexOf(value);
    if (idx === -1) {
      keys.push(value);
      counts.push(0);
      idx = keys.length - 1;
    }
    counts[idx] = counts[idx]! + 1;
  }
  let bestIdx = -1;
  let bestCount = 0;
  let tied = false;
  for (let i = 0; i < counts.length; i += 1) {
    const n = counts[i]!;
    if (n > bestCount) {
      bestCount = n;
      bestIdx = i;
      tied = false;
    } else if (n === bestCount) {
      tied = true;
    }
  }
  if (bestIdx === -1 || bestCount < IDENTITY_THRESHOLD || tied) return undefined;
  return keys[bestIdx];
}

/**
 * The board's derived affinities — the element axis and the weapon axis, each
 * decided on its own.
 *
 * Count each card's type once (a size-N card still counts once) into the tally
 * for ITS axis. An axis yields its affinity when one type there has the highest
 * count on that axis and that count is >= `IDENTITY_THRESHOLD`; an exact tie for
 * the top of an axis yields nothing FOR THAT AXIS and never touches the other.
 * A board can therefore hold an element affinity, a weapon affinity, both, or
 * neither.
 */
export function boardAffinities(skills: SkillDef[]): BoardAffinities {
  const elements: Element[] = [];
  const weapons: WeaponType[] = [];
  for (let i = 0; i < skills.length; i += 1) {
    const id = cardType(skills[i]!);
    if (id === undefined) continue; // untyped card (test-only) — not counted.
    if (id.kind === 'element') elements.push(id.type);
    else weapons.push(id.type);
  }
  const affinities: BoardAffinities = {};
  const element = topType(elements);
  if (element !== undefined) affinities.element = element;
  const weapon = topType(weapons);
  if (weapon !== undefined) affinities.weapon = weapon;
  return affinities;
}

/**
 * The single label for a board that holds BOTH affinities — element first, the
 * same precedence `cardType` already applies to a single card.
 *
 * LOSSY BY CONSTRUCTION. `boardAffinities` is the honest answer; this exists for
 * the callers that can only show or filter on one type (the deck-build affinity
 * banner, the run layer's `boardIdentity` event filter, the `boardIdentity` UI
 * hook on `CombatantState`). Nothing the engine DOES reads it — both axes reach
 * `cardMatchup` and `affinityOpen` through the combatant's two separate fields.
 */
export function primaryIdentity(affinities: BoardAffinities): BoardIdentity | undefined {
  if (affinities.element !== undefined) return { kind: 'element', type: affinities.element };
  if (affinities.weapon !== undefined) return { kind: 'weapon', type: affinities.weapon };
  return undefined;
}

/**
 * The board's single headline type identity, or `undefined` when it has none —
 * `primaryIdentity(boardAffinities(skills))`, defined in terms of the pair so
 * the two can never disagree.
 *
 * Prefer `boardAffinities` for anything that can carry two answers. Before
 * 2026-09-06 this WAS the whole rule, and its single merged tally is why a board
 * with a clear lean on each axis earned nothing at all.
 */
export function boardTypeIdentity(skills: SkillDef[]): BoardIdentity | undefined {
  return primaryIdentity(boardAffinities(skills));
}
