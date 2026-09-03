import { INK } from '../theme';
import { KEYWORD_TEXT_COLOR } from './cardTextMarkup';

/**
 * THE battle-status palette — ONE copy, imported by both battle scenes.
 *
 * Until 2026-09-02 `AILMENT_COLOR`/`AILMENT_TINT` lived as two byte-identical
 * module constants in MobileBattleScene.ts AND DesktopBattleScene.ts — the
 * exact "copies drift" shape the 2026-09-02 cardTextMarkup lockstep exists to
 * prevent, and it had ALREADY drifted: desktop's `AILMENT_COLOR` was missing
 * the `ward` entry mobile's tint map carried, so a ward-colored TEXT fallback
 * on desktop silently read the generic coral. Hoisted here (the status-chip
 * feature is the third consumer, which is one past the "two copies" line);
 * `cardTextMarkup.ts`'s palette doc points at this file now.
 *
 * poison / thorns / expose are in LOCKSTEP with `KEYWORD_TEXT_COLOR`
 * (cardTextMarkup.ts, 2026-08-17 reconciliation) — a player who learns a
 * keyword's color on a card face must recognize the same hue on the battle
 * bar. Change them together or not at all (`cardTextMarkup.test.ts` pins it).
 *
 * Every entry is AA-cleared against both battle card fills — see the contrast
 * ledger on `KEYWORD_TEXT_COLOR` (2026-09-02 pass) for the measured floor.
 */
export const AILMENT_COLOR: Record<string, string> = {
  poison: '#92c05f',
  burn: '#e07a3a',
  bleed: '#d05c4e',
  stun: '#c9a15a',
  expose: '#c4a6e5',
  thorns: '#68c3a0',
  guard: '#7a9cc9',
  // `ward` was tint-only before the hoist (see the module doc: the color map's
  // missing entry was the drift) — same sky blue the tint always used, now in
  // string form so text consumers stop falling back to coral.
  ward: '#4fa8d8',
};

/** Number twin of `AILMENT_COLOR`, DERIVED — one source of truth, two forms,
 * so the pair can never drift apart again (they were maintained by hand as
 * separate literals in both scenes). Iteration order follows the source
 * object; consumers key by name, never by index. */
export const AILMENT_TINT: Record<string, number> = Object.fromEntries(
  Object.entries(AILMENT_COLOR).map(([k, v]) => [k, parseInt(v.slice(1), 16)]),
);

/**
 * Text color per STATUS CHIP kind (the per-combatant "PSN 8 · GRD 75%P" row on
 * the battle HP blocks — see `chipsByTurn`, battleTimeline.ts). Superset of
 * the ailment palette: the three kinds with no HP-bar tint of their own are
 * IMPORTED tokens, never new hexes —
 *  - `negate` reads `KEYWORD_TEXT_COLOR.negate`, the color the card face and
 *    glossary already teach for the keyword;
 *  - `buff` is `INK.gain` (a positive delta — the theme's own definition);
 *  - `debuff` is `INK.cost` ("a thing taken from you", which is exactly what
 *    a stat debuff is; NOT `alarm`, which is reserved for act-now moments).
 */
export const STATUS_CHIP_COLOR: Record<string, string> = {
  ...AILMENT_COLOR,
  // Non-null asserted rather than `?? '#hex'`-defaulted on purpose: a pasted
  // fallback hex would be a second copy of the keyword palette's value — the
  // drift this module exists to end. The key is a literal in cardTextMarkup.ts.
  negate: KEYWORD_TEXT_COLOR.negate!,
  buff: INK.gain,
  debuff: INK.cost,
};
