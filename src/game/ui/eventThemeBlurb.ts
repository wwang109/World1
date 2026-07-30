import type { EventTheme } from '../../data/events';

/**
 * One-line "what's in it for me" per event theme, shown on the Run Map's
 * choice panels. Picking a stop is meant to be a BUILD decision — the theme
 * label alone ("EVENT · FORGE") doesn't tell a new player that FORGE trades
 * gold for a higher-tier card, so the panel says it. Presentation copy only;
 * the authoritative outcomes live in `src/data/events.ts`.
 */
const BLURB: Record<EventTheme, string> = {
  training: 'Train — trade gold or luck for a hero level.',
  cache: 'Search — a card or gem, sometimes a gamble.',
  recruit: 'Recruit — draft an extra card from a set.',
  forge: 'Forge — pay gold for a higher-tier card.',
  market: 'Barter — gold in, gold out, small trades.',
  omen: 'Omen — high risk, the biggest swings.',
};

export function eventThemeBlurb(theme: EventTheme | undefined): string {
  return theme ? BLURB[theme] : 'Text encounter — 2-3 choices.';
}
