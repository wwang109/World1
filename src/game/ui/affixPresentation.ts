import { ELITE_AFFIX_IDS, MODIFIER_PRESETS } from '../../data/modifiers';
import { skillBook } from '../../data/skills';
import { UI, type InkRole } from '../theme';
import type { EncounterPack } from '../../run/encounter';

/**
 * ELITE AFFIX PRESENTATION — the pure, testable half of "the player can SEE
 * what this elite is before the FIGHT button".
 *
 * `d1ac673` gave every elite exactly one BEHAVIOURAL affix
 * (`EncounterUnit.affix`, dealt by `eliteAffixIdFor`), and `previewEncounter`
 * /`currentEncounter` already hand it to the UI — but nothing rendered it, so
 * the only way to learn an elite was BRACED was to lose to it. This module
 * turns that id into the three things a prep screen has to show, and both
 * platforms' scenes do nothing but draw what it returns (same split as
 * `auraPresentation` / `thornsPresentation` / `skillPresentation`).
 *
 * WHY AN `answer` LINE AT ALL. A name is not a preview here. "BRACED" tells a
 * player nothing about which of their cards still works, and the whole
 * premise of the elite affix is that it is a question the DECK answers — so
 * the chip has to name the answer, not just the threat. The effect half comes
 * verbatim from the preset's own `blurb` (one source of truth, in
 * `src/data/modifiers.ts`); only the answer half is authored here, because it
 * lives in that file as a prose `Answered by:` NOTE rather than as data — see
 * `ANSWER` below.
 *
 * NO COMBAT, NO SIM. This reads content (`MODIFIER_PRESETS`, `skillBook`) and
 * returns strings. `src/game` may never run a battle (CLAUDE.md rule 2), so
 * nothing here derives what an affix does — it reports what the model says.
 */

/**
 * THE ANSWER LINE, one per affix in `ELITE_AFFIX_IDS`.
 *
 * Each entry is a compression of that preset's own `Answered by:` note in
 * `src/data/modifiers.ts` — the design owner of "what beats this" — down to
 * the one clause a player can act on while looking at their board:
 *
 *   braced   → "Answered by: TRUE ... or magical ... hits, which the guard
 *              cannot see at all; or expose to pay the tax back."
 *   hobbling → "Answered by: BUILD LIGHT ... cleanse cannot answer this one."
 *              (said explicitly, because a slow LOOKS like a status)
 *   leeching → "Answered by: the anti-heal world rule — each affliction
 *              CATEGORY ... cuts its lifesteal 20% ... Or out-burst it."
 *   venomous → "Answered by: cleanse ... or ward ... poison BYPASSES SHIELDS."
 *              (the bypass is said, because shields are the instinct)
 *
 * A NEW AFFIX MUST APPEAR HERE. `tests/game/affixPresentation.test.ts` asserts
 * this table covers `ELITE_AFFIX_IDS` exactly, so adding a fifth affix without
 * writing its answer fails the suite instead of shipping a chip that names a
 * threat and no counter.
 */
const ANSWER: Record<string, string> = {
  braced: 'magical or TRUE hits, or expose to pay the tax',
  hobbling: 'build light — cleanse cannot touch this slow',
  leeching: 'DoT, debuff or expose each cut it 20% — or burst',
  venomous: 'cleanse or ward — it bypasses shields',
};

/**
 * Every answer above is written so that `answerLine` — the answer PLUS its
 * `ANSWER · ` label — fits ONE LINE in the narrowest place it is drawn: 60
 * characters, `charsForWidth(396, 11)`, the desktop foe panel's inner width.
 * `tests/game/affixPresentation.test.ts` pins it, because a two-line answer is
 * what pushed the sandbox prep panel past its own bottom edge once already.
 * It is also the mobile-first shape: one fact, one line, nothing to wrap.
 */
export const ANSWER_LINE_BUDGET = 60;

export interface AffixPresentation {
  /** The affix id, e.g. `'braced'`. */
  id: string;
  /** The preset's display name, e.g. `'BRACED'`. */
  name: string;
  /** The chip's own label — the "modifier chip" vocabulary, marked as an affix. */
  chipLabel: string;
  /** What it does. VERBATIM from the preset `blurb` — never re-worded here. */
  effect: string;
  /** What answers it (see `ANSWER`); `''` only for an affix with no entry. */
  answer: string;
  /** Display names of the cards the affix installs onto the elite's deck. */
  cardNames: string[];
  /** Chip fill. An affix is a threat, so it reads in the danger accent
   * rather than the bronze `UI.chip` a selectable modifier chip uses. */
  accent: number;
  /** The SAME colour as a CSS string, for a Phaser text fill — derived from
   * `accent` rather than authored twice, so the chip and its label can never
   * drift apart the way a hand-copied hex pair would. */
  accentText: string;
}

/**
 * Present one `EncounterUnit.affix`. `null`/`undefined` (every normal fight,
 * every boss, every pack) returns `null` — the caller draws nothing, which is
 * what makes the chip CONDITIONAL rather than decorative.
 *
 * An id that is not in `MODIFIER_PRESETS` also returns `null`: a prep screen
 * must not throw mid-render over content. The loud failure for a bad id lives
 * where it belongs, in `eliteAffixPreset` (src/run/encounter.ts), which throws.
 */
export function presentEliteAffix(affixId: string | null | undefined): AffixPresentation | null {
  if (!affixId) return null;
  const preset = MODIFIER_PRESETS[affixId];
  if (!preset) return null;
  return {
    id: affixId,
    name: preset.name,
    chipLabel: `AFFIX · ${preset.name}`,
    effect: preset.blurb,
    answer: ANSWER[affixId] ?? '',
    cardNames: (preset.cards ?? []).map((id) => skillBook[id]?.name ?? id),
    accent: UI.bad,
    accentText: `#${UI.bad.toString(16).padStart(6, '0')}`,
  };
}

/** The `answer` line as it is DRAWN — prefixed, so both platforms label it
 * identically and a test can assert the prefix in one place. */
export function answerLine(affix: AffixPresentation): string {
  return affix.answer ? `ANSWER · ${affix.answer}` : '';
}

/**
 * How many characters of `fontSize`px body text fit in `width` px.
 *
 * A DELIBERATE UNDER-ESTIMATE (0.6em per glyph against a real average nearer
 * 0.5em for this font stack): both prep panels size themselves from the LINE
 * COUNT this produces, so a wrap that guesses too FEW characters costs one
 * extra short line, while one that guesses too many draws text past the panel
 * edge. Cheap failure in one direction only.
 */
export function charsForWidth(width: number, fontSize: number): number {
  return Math.max(8, Math.floor(width / (fontSize * 0.6)));
}

/**
 * Word-wrap to `maxChars`, returning one string per line — the scenes draw one
 * Text object per line rather than handing Phaser a `wordWrap` width, so the
 * block's height is known BEFORE the panel behind it is sized (both foe panels
 * are content-fit, and a mis-sized panel is the bug this avoids).
 *
 * A word longer than `maxChars` is hard-split rather than allowed to overhang.
 * Empty input yields no lines at all (not one empty line).
 */
export function wrapText(text: string, maxChars: number): string[] {
  const limit = Math.max(1, Math.floor(maxChars));
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    let w = word;
    while (w.length > limit) {
      if (line) { lines.push(line); line = ''; }
      lines.push(w.slice(0, limit));
      w = w.slice(limit);
    }
    if (!line) line = w;
    else if (line.length + 1 + w.length <= limit) line += ` ${w}`;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The whole drawn block for one affix, already wrapped to `width` px of
 * `fontSize`px text: the effect line(s) first (what it does), then the answer
 * line(s) (what beats it). Scenes colour the two groups differently, so they
 * come back separated rather than as one list.
 */
export function affixBlockLines(
  affix: AffixPresentation,
  width: number,
  fontSize: number,
): { effect: string[]; answer: string[] } {
  const chars = charsForWidth(width, fontSize);
  return {
    effect: wrapText(affix.effect, chars),
    answer: wrapText(answerLine(affix), chars),
  };
}

/** Every affix id the elite pool can deal, for a chip row that offers them
 * all (the sandbox prep screens' AFFIX selector). Re-exported so a scene
 * imports its affix vocabulary from ONE module. */
export { ELITE_AFFIX_IDS };

// ---------------------------------------------------------------------------
// THE RUN MAP's half — the affix named on the screen where the CHOICE is made.
//
// `76b3033` put the chip on RUN PREP, which is the screen AFTER the player has
// committed to a fight. The easy/medium/hard pick happens one screen earlier,
// on the run map, so until now a player chose a fight and only then learned
// what it carried — the same defect as learning an affix by dying, one step
// milder. This is the map's read of the same value.
//
// READ OFF THE PREVIEWED PACK, NEVER RE-DERIVED. The map already calls
// `previewEncounter(node)` to build its hint line, and that pack's
// `units[0].affix` is the FIELD `RunPrepScene` draws its chip from and the
// field `battleContext.runBattleInput` ships to the battle service. Taking the
// same field costs no extra roll, spends no `Rng` draw, and makes map/prep/
// fight agree BY CONSTRUCTION rather than by two derivations happening to
// match. It also inherits `rollEncounter`'s gate for free:
//
//   • only `title === 'elite'` carries one, so a normal fight and a boss draw
//     byte-identically to before (they present `null`);
//   • a column's `'hard'` option promotes elite -> boss and `'easy'` caps
//     elite -> normal, so the three options of ONE column can disagree about
//     whether they carry the affix even though they agree on WHICH affix that
//     rung of the ladder holds (`eliteAffixIdFor` is keyed on the fight
//     number). Re-deriving from (seed, fight number) would have named the
//     affix on all three and lied on two of them;
//   • a PACK drops the affix with the title (`capPackTitle`), and reading the
//     unit rather than the node picks that up with no branch here at all.
// ---------------------------------------------------------------------------

/**
 * NAME ONLY ON THE MAP — the ink and the reason, in one line: the map choice
 * is WHICH RUNG to take and the affix name is the only part of it that varies
 * between the rungs, while "what answers it" is a deck-building read that
 * belongs on prep, where the deck is and where the full chip + effect + ANSWER
 * block already lives one tap later.
 *
 * `alarm` is the ink because an affix is a threat, not a dial (it is the text
 * twin of the `UI.bad` fill the prep chip uses, and unlike that fill it is a
 * contrast-audited text role — `tests/game/textRoleAudit.test.ts`).
 */
export const AFFIX_MAP_INK: InkRole = 'alarm';

/**
 * The affix a previewed encounter carries, or `null`. The PRIMARY unit is the
 * subject — the same `pack.units[0]` `Desktop/MobileRunPrepScene` present, so
 * the map and prep cannot name two different things.
 */
export function presentPackAffix(
  pack: Pick<EncounterPack, 'units'> | null | undefined,
): AffixPresentation | null {
  return presentEliteAffix(pack?.units[0]?.affix ?? null);
}

/** The two `RunChoiceViewModel` fields an affixed fight choice adds. */
export interface AffixMapFooter {
  footer: string;
  footerInk: InkRole;
}

/**
 * The run map's affix line, ready to SPREAD into a fight/boss
 * `RunChoiceViewModel` — `undefined` for every option that carries no affix,
 * which spreads to nothing and leaves that panel's model byte-identical to
 * before this existed.
 *
 * It lands in the panel's FOOTER slot, which a fight choice has always left
 * empty while `runChoicePanelLayout` reserved its row unconditionally (shop
 * choices use it for "N CARDS · N GEMS"). So the chip costs the map ZERO extra
 * height on a screen that has none to give — the band banner, the windowed
 * trail and a 94px choice panel already share it — and it is wrapped to
 * `footerW`, the width the SELECT/LOCKED affordance leaves free, so it cannot
 * collide with anything the panel already draws.
 *
 * ONE function for both platforms: a phone is told exactly what a desktop is.
 */
export function affixMapFooter(
  pack: Pick<EncounterPack, 'units'> | null | undefined,
): AffixMapFooter | undefined {
  const affix = presentPackAffix(pack);
  return affix ? { footer: affix.chipLabel, footerInk: AFFIX_MAP_INK } : undefined;
}
