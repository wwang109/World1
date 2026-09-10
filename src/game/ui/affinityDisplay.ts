import type { SkillDef } from '../../engine/types';
import { boardAffinities, cardType } from '../../engine/combat/typeIdentity';

/**
 * Shared board-affinity display derivations for the Prep and Deck Build
 * scenes (both platforms). THE BOARD IS THE ONLY SOURCE
 * (`docs/board-type-identity.md`, 2026-09-06 ruling): element and weapon are
 * tallied SEPARATELY, so a board can earn neither, either, or BOTH axes at
 * once — every reader here shows both when both are present, rather than the
 * old single-label collapse (`boardTypeIdentity`) that could only ever name
 * one and would silently drop a real, earned axis (a 3-fire + 3-sword deck
 * used to read "FIRE — affinity" and never mention sword at all).
 */

/**
 * One axis worth of the deck-build affinity pip readout: the board's current
 * top type on that axis (may sit below the 3-card threshold — the pips are
 * a progress readout, not just a pass/fail badge), its raw count, and
 * whether the board has actually EARNED that axis's affinity (`earned` true
 * iff this axis's top type is also the board's own `boardAffinities` result
 * for that axis — i.e. it cleared the threshold AND wasn't an exact tie).
 * Omitted from the returned list entirely when an axis has zero cards of
 * either type — nothing to report for that axis.
 */
export interface AffinityPipAxis {
  axis: 'element' | 'weapon';
  label: string;
  count: number;
  earned: boolean;
}

/**
 * Per-axis pip data for a deck/board's current skill list. Returns 0-2 rows:
 * one per axis that has at least one card, in `element`-then-`weapon` order
 * (matching `cardType`'s own precedence). A caller with an empty board (no
 * cards placed yet) gets `[]` and should fall back to its own "no cards yet"
 * face.
 */
export function boardAffinityPipAxes(skills: SkillDef[]): AffinityPipAxis[] {
  const affinities = boardAffinities(skills);
  const rows: AffinityPipAxis[] = [];
  for (const axis of ['element', 'weapon'] as const) {
    const tally = new Map<string, number>();
    for (const s of skills) {
      const t = cardType(s);
      if (t && t.kind === axis) tally.set(t.type, (tally.get(t.type) ?? 0) + 1);
    }
    let topType = '';
    let topCount = 0;
    for (const [k, v] of tally) if (v > topCount) { topType = k; topCount = v; }
    if (topCount === 0) continue;
    const earned = axis === 'element' ? affinities.element === topType : affinities.weapon === topType;
    rows.push({ axis, label: topType.toUpperCase(), count: topCount, earned });
  }
  return rows;
}

/**
 * "AFFINITY · FIRE + SWORD" headline for the Prep foe/hero panel — both axes
 * joined with a plain `+` when the board holds both, `undefined` when it
 * holds neither (the caller falls back to a generic label, e.g. `'CARDS'`).
 */
export function boardAffinityHeadline(skills: SkillDef[]): string | undefined {
  const { element, weapon } = boardAffinities(skills);
  const parts: string[] = [];
  if (element) parts.push(element.toUpperCase());
  if (weapon) parts.push(weapon.toUpperCase());
  if (parts.length === 0) return undefined;
  return `AFFINITY · ${parts.join(' + ')}`;
}
