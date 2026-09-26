import type { SkillDef } from '../../engine/types';
import { HEADLINE_LABEL } from '../../engine/keywords/text';
import { summarizeEffectSegments, type EffectSegment, type SkillFaceMode } from './skillPresentation';

/**
 * One CLAUSE of a card face — one or more adjacent `EffectSegment`s merged the
 * same way the face itself joins them (`effectSegmentJoiner`'s `joinWithPrevious`
 * rule), so an affinity badge's `AFFIN:` label and its payload read as the one
 * line a player sees, e.g. `AFFIN: DISRUPT 4`.
 */
interface Clause {
  text: string;
  keyword?: string;
}

function toClauses(segments: readonly EffectSegment[]): Clause[] {
  const clauses: Clause[] = [];
  for (const segment of segments) {
    if (segment.joinWithPrevious && clauses.length > 0) {
      const last = clauses[clauses.length - 1]!;
      last.text = `${last.text} ${segment.text}`;
      continue;
    }
    clauses.push({ text: segment.text, keyword: segment.keyword });
  }
  return clauses;
}

const NUMBER_RUN = /[+-]?\d+(?:\.\d+)?/g;
/** Same run, but keeping a unit GLUED directly onto the digits with no space
 * (`25%`, `2t`) so a percent-and-duration badge like `EXPOSE 25% 2t` reads as
 * two paired values, not four bare digits stripped of what they meant. A
 * space-separated word (`BURDEN +8 WT`'s trailing `WT`) is never glued. */
const NUMBER_WITH_UNIT_RUN = /[+-]?\d+(?:\.\d+)?%?[a-zA-Z]*/g;

/** Splits a clause's text into its label (words) and its number(s), e.g.
 * `"BURDEN +8 WT"` -> `{ label: "BURDEN WT", value: "+8" }`. Null when the
 * clause carries no number at all (`AOE`, `PASSIVE`). */
function splitLabelValue(text: string): { label: string; value: string } | null {
  const numbers = text.match(NUMBER_WITH_UNIT_RUN);
  if (!numbers || numbers.length === 0) return null;
  const label = text.replace(NUMBER_WITH_UNIT_RUN, '').replace(/:/g, '').replace(/\s+/g, ' ').trim();
  return { label: label.length > 0 ? label : text, value: numbers.join(', ') };
}

function clauseKey(c: Clause): string {
  if (c.keyword) return `kw:${c.keyword}`;
  return `text:${splitLabelValue(c.text)?.label ?? c.text}`;
}

const HEADLINE_KEYS = new Set([`text:${HEADLINE_LABEL.damage}`, `text:${HEADLINE_LABEL.heal}`, 'kw:shield']);

/**
 * One row of a tier-upgrade diff — a label plus its before/after (or
 * `"unchanged"`) value, already formatted for display. `headline` marks the
 * three accumulated numbers (DMG/HEAL/SHLD) — see `tierUpgradePreview.ts`'s
 * three-state doc comment for why those never collapse to `"unchanged"` even
 * when the number didn't move, unlike every other clause. `gated` marks a
 * line built from an `affinity: true` payload (the `AFFIN: …` clause).
 */
export interface TierUpgradeDiffLine {
  label: string;
  /** Already-formatted `"before > after"`, or the literal word `"unchanged"`. */
  value: string;
  kind: 'unchanged' | 'delta';
  headline: boolean;
  gated: boolean;
}

/** Cosmetic only — the `AFFIN:` label segment's colon reads fine inline on
 * the face but not as a standalone clause label. */
function stripColon(text: string): string {
  return text.replace(/:/g, '').replace(/\s+/g, ' ').trim();
}

function buildLine(fromC: Clause | undefined, toC: Clause | undefined, headline: boolean): TierUpgradeDiffLine {
  const gated = fromC?.keyword === 'affinity' || toC?.keyword === 'affinity';
  if (fromC && toC) {
    if (!headline && fromC.text === toC.text) {
      return { label: stripColon(toC.text), value: 'unchanged', kind: 'unchanged', headline, gated };
    }
    const splitFrom = splitLabelValue(fromC.text);
    const splitTo = splitLabelValue(toC.text);
    if (splitFrom && splitTo) {
      return { label: splitTo.label || splitFrom.label, value: `${splitFrom.value} > ${splitTo.value}`, kind: 'delta', headline, gated };
    }
    return { label: toC.text, value: `${fromC.text} > ${toC.text}`, kind: 'delta', headline, gated };
  }
  if (toC && !fromC) {
    const split = splitLabelValue(toC.text);
    return { label: split?.label ?? toC.text, value: split ? `0 > ${split.value}` : `NEW > ${toC.text}`, kind: 'delta', headline, gated };
  }
  const removedText = fromC?.text ?? '';
  const split = splitLabelValue(removedText);
  return { label: split?.label ?? removedText, value: split ? `${split.value} > 0` : `${removedText} > REMOVED`, kind: 'delta', headline, gated };
}

function parseFirstNumber(text: string): number {
  const match = text.match(NUMBER_RUN);
  return match ? Number(match[0]) : 0;
}

function lineMagnitude(line: TierUpgradeDiffLine): number {
  if (line.kind === 'unchanged') return 0;
  const [before, after] = line.value.split('>');
  return Math.abs(parseFirstNumber(after ?? '') - parseFirstNumber(before ?? ''));
}

function maxByMagnitude(lines: readonly TierUpgradeDiffLine[]): TierUpgradeDiffLine | undefined {
  let best: TierUpgradeDiffLine | undefined;
  let bestMag = -1;
  for (const line of lines) {
    const mag = lineMagnitude(line);
    if (mag > bestMag) { best = line; bestMag = mag; }
  }
  return best;
}

/**
 * THE HEADLINE PICK — guaranteed lines first, gated fallback. Mirrors the
 * guaranteed/gated split `guaranteedPowerLevelDeci` itself makes: the biggest
 * swing among this card's UNGATED lines wins whenever one changed at all;
 * only a `conditionalGain` step — where every ungated line is flat by
 * definition — falls through to the biggest gated swing instead. This is why
 * a trade (e.g. [card] Arcane Bolt) headlines its shrinking DMG line rather
 * than the gated line it grew, and a flat gain (e.g. [card] Ironmarch Tithe)
 * headlines its gated line since nothing ungated moved at all.
 */
function pickHeadline(lines: readonly TierUpgradeDiffLine[]): TierUpgradeDiffLine | undefined {
  const ungated = lines.filter((l) => !l.gated);
  const primary = maxByMagnitude(ungated);
  if (primary && lineMagnitude(primary) > 0) return primary;
  const gated = lines.filter((l) => l.gated);
  const secondary = maxByMagnitude(gated);
  if (secondary && lineMagnitude(secondary) > 0) return secondary;
  return primary ?? lines[0];
}

export interface TierUpgradeDiff {
  lines: TierUpgradeDiffLine[];
  headline?: TierUpgradeDiffLine;
}

/**
 * The before/after diff of one tier rank-up, built ENTIRELY from
 * `summarizeEffectSegments` (`skillPresentation.ts`) — the same face-line
 * renderer every card face and hover-tip already reads — never a second,
 * hand-derived number. Pairs `fromSkill`'s clauses against `toSkill`'s by a
 * label/keyword key so an unchanged clause reads `"unchanged"` instead of
 * being silently dropped, and picks the single most significant line as a
 * one-line headline (see `pickHeadline`).
 */
export function buildTierUpgradeDiff(fromSkill: SkillDef, toSkill: SkillDef, mode: SkillFaceMode = 'summed'): TierUpgradeDiff {
  const fromByKey = new Map<string, Clause[]>();
  for (const clause of toClauses(summarizeEffectSegments(fromSkill, undefined, mode))) {
    const key = clauseKey(clause);
    const bucket = fromByKey.get(key);
    if (bucket) bucket.push(clause); else fromByKey.set(key, [clause]);
  }

  const lines: TierUpgradeDiffLine[] = [];
  for (const toC of toClauses(summarizeEffectSegments(toSkill, undefined, mode))) {
    const key = clauseKey(toC);
    const bucket = fromByKey.get(key);
    const fromC = bucket?.shift();
    lines.push(buildLine(fromC, toC, HEADLINE_KEYS.has(key)));
  }
  for (const bucket of fromByKey.values()) {
    for (const fromC of bucket) lines.push(buildLine(fromC, undefined, HEADLINE_KEYS.has(clauseKey(fromC))));
  }

  return { lines, headline: pickHeadline(lines) };
}

/** `"LABEL   value"` — the one-line form the picker headline and the diff
 * overlay's rows both use. */
export function formatTierUpgradeDiffLine(line: TierUpgradeDiffLine): string {
  return line.label ? `${line.label} ${line.value}` : line.value;
}
