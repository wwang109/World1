import type { EventTheme } from '../../data/events';

/**
 * Area identity per event theme — a short evocative place-name plus a fuller
 * D&D-narrator blurb, so each theme reads as a distinct stretch of road with
 * its own recurring imagery (docs/run-events-design.md §3b groups events by
 * theme; this gives that grouping a face). `blurb` is reserved for a wider
 * presentation surface than the Run Map's node card currently has room for —
 * nothing renders it today, but it's here for the next UI that can afford
 * two sentences (e.g. an area-intro panel). `name` IS consumed, folded into
 * `eventThemeBlurb()` below.
 */
const AREA: Record<EventTheme, { name: string; blurb: string }> = {
  training: {
    name: 'The Hollow Yard',
    blurb: 'A windswept sparring ground of packed dirt and splintered dueling posts, where the ghosts of a thousand practice bouts still hang in the dust. Wandering masters test hopefuls here between wars.',
  },
  cache: {
    name: 'The Silt Hollows',
    blurb: 'Sunken barrows and rusted supply crates lie half-swallowed by mud along this stretch, forgotten by whoever left them. Digging pays off more often than not — but the hollows keep some things buried for a reason.',
  },
  recruit: {
    name: 'The Muster Road',
    blurb: "Waystation camps line this road — sellswords between contracts, robed adepts debating theory, a medic's tent overflowing with salves. Every camp is glad to share a trick with a passing stranger.",
  },
  forge: {
    name: 'The Cinderworks',
    blurb: 'A scatter of smithies and half-collapsed forges, anvils still warm from the last commission. Steel gets tempered proper here — for those willing to pay the price of the fire.',
  },
  market: {
    name: 'The Tolling Road',
    blurb: 'Bridges, caravans, and back-alley fences crowd this thoroughfare, where coin changes hands more freely than trust ever does. Nothing here is given without a toll of some kind.',
  },
  omen: {
    name: 'The Crossroads Unquiet',
    blurb: 'A shrine stands where two roads cross, carved with a rising sun and a crescent moon in equal measure. Every wager made here feels watched by something older than the stones.',
  },
};

/** One-line "what's in it for me" per event theme, shown on the Run Map's
 * choice panels — leads with the area name so the theme reads as a PLACE,
 * not just a mechanic, then closes with the mechanical hint. Picking a stop
 * is meant to be a BUILD decision — the theme label alone ("EVENT · FORGE")
 * doesn't tell a new player that FORGE trades gold for a higher-tier card, so
 * the panel says it. Presentation copy only; the authoritative outcomes live
 * in `src/data/events.ts`. Kept to a single short line (~45 chars) — the Run
 * Map's node card has room for barely two lines at its smallest font. */
const BLURB: Record<EventTheme, string> = {
  training: `${AREA.training.name} — sweat or coin for a level.`,
  cache: `${AREA.cache.name} — dig for a card or gem.`,
  recruit: `${AREA.recruit.name} — browse a camp's wares.`,
  forge: `${AREA.forge.name} — pay to temper it higher.`,
  market: `${AREA.market.name} — gold trades, small stakes.`,
  omen: `${AREA.omen.name} — the biggest gambles.`,
};

export function eventThemeBlurb(theme: EventTheme | undefined): string {
  return theme ? BLURB[theme] : 'Text encounter — 2-3 choices.';
}

/** The area's full name/blurb pair, for any future UI surface that has room
 * for two sentences (not consumed by any scene yet — see file header). */
export function eventThemeArea(theme: EventTheme): { name: string; blurb: string } {
  return AREA[theme];
}
