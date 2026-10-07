import { weightOf, type SkillDef } from '../../engine/types';
import { renderCtxOf } from '../../engine/keywords/compose';
import { faceClauseOf, faceTokenOf, HEADLINE_LABEL } from '../../engine/keywords/text';
import { stripCardTextMarkup } from './cardTextMarkup';
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
  const label = text.replace(NUMBER_WITH_UNIT_RUN, '').replace(/[:,]/g, '').replace(/\s+/g, ' ').trim();
  return { label: label.length > 0 ? label : text, value: numbers.join(', ') };
}

function clauseKey(c: Clause): string {
  if (c.keyword) return `kw:${c.keyword}`;
  return `text:${splitLabelValue(c.text)?.label ?? c.text}`;
}

const HEADLINE_KEYS = new Set([`text:${HEADLINE_LABEL.damage}`, `text:${HEADLINE_LABEL.heal}`, 'kw:shield']);
const WEIGHT_BADGE_KEYS = new Set([`text:${HEADLINE_LABEL.heavy}`, `text:${HEADLINE_LABEL.lightweight}`]);

/**
 * One row of a tier-upgrade diff — a label plus its before/after (or
 * `"unchanged"`) value, already formatted for display. `headline` marks the
 * three accumulated numbers (DMG/HEAL/SHLD), which never collapse to
 * `"unchanged"` even when the number didn't move, unlike every other clause.
 * `gated` marks a line built from an `affinity: true` payload (the `AFFIN: …`
 * clause).
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

const CLAUSE_NUMBER = /([+-]?\d+(?:\.\d+)?%?)/;

function numberChange(fromClause: string, toClause: string): string | null {
  const fromParts = fromClause.split(CLAUSE_NUMBER);
  const toParts = toClause.split(CLAUSE_NUMBER);
  if (fromParts.length !== toParts.length) return null;
  const changes: string[] = [];
  for (let i = 0; i < fromParts.length; i += 1) {
    const a = fromParts[i]!;
    const b = toParts[i]!;
    if (i % 2 === 0) {
      if (a !== b) return null;
      continue;
    }
    if (a === b) continue;
    const word = fromParts[i - 1]?.match(/([A-Za-z]+)\W*$/)?.[1];
    changes.push(word ? `${word.toUpperCase()} ${a} > ${b}` : `${a} > ${b}`);
  }
  return changes.length > 0 ? changes.join(', ') : null;
}

/** Face-token text -> the change its full face clause shows but the token
 * does not (e.g. a Status Bonus `max`). */
function offTokenChanges(fromSkill: SkillDef, toSkill: SkillDef): Map<string, string> {
  const changes = new Map<string, string>();
  const fromCtx = renderCtxOf(fromSkill);
  const toCtx = renderCtxOf(toSkill);
  const count = Math.min(fromSkill.effects.length, toSkill.effects.length);
  for (let i = 0; i < count; i += 1) {
    const a = fromSkill.effects[i]!;
    const b = toSkill.effects[i]!;
    if (a.kind !== b.kind) continue;
    const token = faceTokenOf(a, fromCtx).text;
    if (token !== faceTokenOf(b, toCtx).text) continue;
    const change = numberChange(stripCardTextMarkup(faceClauseOf(a, fromCtx)), stripCardTextMarkup(faceClauseOf(b, toCtx)));
    if (change) changes.set(token, change);
  }
  return changes;
}

export interface TierUpgradeDiff {
  lines: TierUpgradeDiffLine[];
}

/**
 * The before/after diff of one tier rank-up, built from
 * `summarizeEffectSegments` (`skillPresentation.ts`) — the same face-line
 * renderer every card face and hover-tip already reads — never a second,
 * hand-derived number. Pairs `fromSkill`'s clauses against `toSkill`'s by a
 * label/keyword key so an unchanged clause reads `"unchanged"` instead of
 * being silently dropped.
 */
export function buildTierUpgradeDiff(fromSkill: SkillDef, toSkill: SkillDef, mode: SkillFaceMode = 'summed'): TierUpgradeDiff {
  const weightFrom = weightOf(fromSkill);
  const weightTo = weightOf(toSkill);
  const weightChanged = weightFrom !== weightTo;
  const offToken = offTokenChanges(fromSkill, toSkill);

  const fromByKey = new Map<string, Clause[]>();
  for (const clause of toClauses(summarizeEffectSegments(fromSkill, undefined, mode))) {
    const key = clauseKey(clause);
    if (weightChanged && WEIGHT_BADGE_KEYS.has(key)) continue;
    const bucket = fromByKey.get(key);
    if (bucket) bucket.push(clause); else fromByKey.set(key, [clause]);
  }

  const lines: TierUpgradeDiffLine[] = [];
  for (const toC of toClauses(summarizeEffectSegments(toSkill, undefined, mode))) {
    const key = clauseKey(toC);
    if (weightChanged && WEIGHT_BADGE_KEYS.has(key)) continue;
    const bucket = fromByKey.get(key);
    const fromC = bucket?.shift();
    const line = buildLine(fromC, toC, HEADLINE_KEYS.has(key));
    const offTokenChange = line.kind === 'unchanged' ? offToken.get(toC.text) : undefined;
    lines.push(offTokenChange ? { ...line, value: offTokenChange, kind: 'delta' } : line);
  }
  for (const bucket of fromByKey.values()) {
    for (const fromC of bucket) lines.push(buildLine(fromC, undefined, HEADLINE_KEYS.has(clauseKey(fromC))));
  }
  if (weightChanged) {
    lines.push({ label: 'WEIGHT', value: `${weightFrom} > ${weightTo}`, kind: 'delta', headline: false, gated: false });
  }

  return { lines };
}

/** `"LABEL   value"` — the one-line form the pickers' change list and the
 * diff overlay's rows both use. */
export function formatTierUpgradeDiffLine(line: TierUpgradeDiffLine): string {
  return line.label ? `${line.label} ${line.value}` : line.value;
}

/** Every line that moved, in face order. */
export function changedTierUpgradeLines(diff: TierUpgradeDiff): string[] {
  return diff.lines.filter((line) => line.kind === 'delta').map(formatTierUpgradeDiffLine);
}
