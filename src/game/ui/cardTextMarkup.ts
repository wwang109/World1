/**
 * Card-text keyword markup. Authors may wrap a mechanical verb in double
 * braces — `Deal 12 damage and {{poison}} for 5 for 3 turns.` — and the UI
 * renders that token in the keyword's semantic style while every plain
 * renderer strips the braces. The engine never reads markup; `text` stays
 * display-only.
 *
 * The keyword id is the lowercased brace content; the display text keeps the
 * author's casing.
 */

export interface CardTextSegment {
  text: string;
  /** Lowercased keyword id when this segment came from a {{...}} token. */
  keyword?: string;
}

const MARKUP_PATTERN = /\{\{([^{}]+)\}\}/g;

/** Split text into plain and keyword segments, in order. */
export function parseCardTextMarkup(text: string): CardTextSegment[] {
  const segments: CardTextSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(MARKUP_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, index) });
    }
    const token = match[1]!.trim();
    segments.push({ text: token, keyword: token.toLowerCase() });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }
  return segments;
}

/** Plain rendering: `{{poison}}` -> `poison`. */
export function stripCardTextMarkup(text: string): string {
  return text.replace(MARKUP_PATTERN, (_match, token: string) => token.trim());
}

/** Lowercased keyword ids marked in the text, in order, deduplicated. */
export function markedKeywords(text: string): string[] {
  const keywords: string[] = [];
  for (const match of text.matchAll(MARKUP_PATTERN)) {
    const keyword = match[1]!.trim().toLowerCase();
    if (!keywords.includes(keyword)) keywords.push(keyword);
  }
  return keywords;
}

/**
 * Semantic text color per keyword id. Aligned with the status/archetype
 * palette in theme.ts; extend here when a new mechanical verb gets markup.
 */
export const KEYWORD_TEXT_COLOR: Record<string, string> = {
  poison: '#c07ae0',
  burn: '#f0824c',
  bleed: '#e05555',
  expose: '#e8a2b8',
  stun: '#f2d24c',
  shield: '#7fa8f0',
  guard: '#7fc0e8',
  negate: '#9fd0e8',
  cleanse: '#8fdcA8',
  // Ward is prevention, cleanse is removal — kept in the same cool-green family
  // as cleanse (both are "the ailment is gone") but distinctly lighter.
  ward: '#a8e8d0',
  lifesteal: '#e07a90',
  disrupt: '#e0b060',
  slow: '#d8c078',
  combo: '#e8c060',
  shatter: '#d88f6a',
  thorns: '#9fb86a',
  true: '#e8d5a0',
};

export function keywordTextColor(keyword: string): string | undefined {
  return KEYWORD_TEXT_COLOR[keyword];
}
