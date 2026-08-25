// Board Type Identity: pure, integer-only, no RNG, no Date.
//
// Every card is typed by exactly one weapon or element (element takes priority;
// TRUE cards carry a cosmetic element/weapon). When a board leans hard into a
// single type — a unique type with the highest count, that count >= 3 — the
// board takes on that type as its identity. See docs/board-type-identity.md.
//
// This module only DERIVES the identity. Its single effect is wired elsewhere
// through an existing seam: the defensive affinity fold in `state.ts` (combatant
// setup) — a board of 3+ one type gains that type's affinity, which unlocks the
// weapon/element triangle (advantage +50% / disadvantage −25%) via `cardMatchup`
// in the interpreter. There is no flat same-type damage bonus, and an identity
// still grants nothing offensive by itself.
//
// Since 2026-08-25 there is a SECOND, OPT-IN effect: a card may carry an
// `affinityStrike` action — an extra flat hit that resolves only when the caster
// holds the affinity matching that card's own type (`affinityOpen` in the
// interpreter). It is per-card and paid for per-card, so this module's output
// still only DERIVES the identity; nothing here decides what an identity is
// worth. The core combat loop stays feature-agnostic.

import type { Element, SkillDef, WeaponType } from '../types';

/** A board's derived type identity: an element OR a weapon type. */
export type BoardIdentity =
  | { kind: 'element'; type: Element }
  | { kind: 'weapon'; type: WeaponType };

/** Cards of one unique top type needed for a board to take that identity. */
export const IDENTITY_THRESHOLD = 3;

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
 * The board's type identity, or `undefined` when there is none.
 *
 * Count each card's type once (a size-N card still counts once). The identity is
 * the UNIQUE type with the highest count when that count is >= 3; an exact tie
 * for the top count yields no identity. Pure integer tally, arrays walked by
 * index for deterministic order (the parallel `keys`/`identities`/`counts`
 * arrays preserve first-seen order, so ties resolve identically every run).
 */
export function boardTypeIdentity(skills: SkillDef[]): BoardIdentity | undefined {
  const keys: string[] = [];
  const identities: BoardIdentity[] = [];
  const counts: number[] = [];
  for (let i = 0; i < skills.length; i += 1) {
    const id = cardType(skills[i]!);
    if (id === undefined) continue; // untyped card (test-only) — not counted.
    const key = `${id.kind}:${id.type}`;
    let idx = keys.indexOf(key);
    if (idx === -1) {
      keys.push(key);
      identities.push(id);
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
  return identities[bestIdx];
}
